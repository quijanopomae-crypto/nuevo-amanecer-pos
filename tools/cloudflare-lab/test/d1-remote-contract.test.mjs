// Prueba del contrato de idempotencia/conflicto directamente contra D1 (local o remota)
// usando `wrangler d1 execute`, con la misma sentencia INSERT ... ON CONFLICT DO NOTHING
// que ejecuta el Worker. Sirve cuando no hay workers.dev para hospedar el Worker.
// Uso: node test/d1-remote-contract.test.mjs [--local|--remote]   (default --remote)
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const mode = process.argv.includes('--local') ? '--local' : '--remote';
const DB = 'nuevo-amanecer-lab';
const results = {};
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;

function d1(command) {
  const proc = spawnSync(
    process.execPath,
    ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', DB, mode, '--json', '--command', command],
    { encoding: 'utf8' },
  );
  const start = proc.stdout.indexOf('[');
  if (proc.status !== 0 || start < 0) {
    throw new Error(`wrangler d1 execute failed (exit ${proc.status}): ${proc.stderr.slice(0, 600)}`);
  }
  const parsed = JSON.parse(proc.stdout.slice(start));
  return parsed[0];
}

function record(name, pass, detail) {
  results[name] = pass ? 'PASS' : 'FAIL';
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
}

const operationId = `op-${randomUUID()}`;
const payload = JSON.stringify({ sale_id: 'S-0002', total_cents: 4300, lines: [{ sku: 'ACEITE-1L', qty: 1 }] });
const op = {
  operation_id: operationId,
  device_id: 'caja-01',
  device_sequence: 2,
  entity_type: 'sale',
  entity_id: 'S-0002',
  payload,
  payload_hash: sha256(payload),
  created_at: new Date().toISOString(),
};

// Misma sentencia que src/worker.js: nunca sobrescribe una fila existente.
const insertSql = (o) =>
  `INSERT INTO sync_operations (operation_id, device_id, device_sequence, entity_type, entity_id, payload, payload_hash, created_at)
   VALUES (${sql(o.operation_id)}, ${sql(o.device_id)}, ${o.device_sequence}, ${sql(o.entity_type)}, ${sql(o.entity_id)}, ${sql(o.payload)}, ${sql(o.payload_hash)}, ${sql(o.created_at)})
   ON CONFLICT(operation_id) DO NOTHING`;

const selectSql = `SELECT operation_id, payload_hash, payload, device_sequence, received_at FROM sync_operations WHERE operation_id = ${sql(operationId)}`;
const countSql = `SELECT COUNT(*) AS n FROM sync_operations WHERE operation_id = ${sql(operationId)}`;

// Reproduce la decisión del Worker. El Worker usa meta.changes del binding D1; aquí se usa
// el conteo de filas porque `d1 execute --local --json` no informa `changes`.
const rowCount = () => d1(countSql).results[0].n;
function apply(incoming) {
  const before = rowCount();
  const result = d1(insertSql(incoming));
  const after = rowCount();
  if (before === 0 && after === 1) return { decision: 'inserted', changes: result.meta.changes };
  const existing = d1(selectSql).results[0];
  return { decision: existing.payload_hash === incoming.payload_hash ? 'already_processed' : 'conflict', changes: result.meta.changes };
}

const health = d1('SELECT 1 AS one');
record('D1_HEALTH', health.success && health.results[0].one === 1, { served_by: health.meta.served_by, region: health.meta.served_by_region });

const first = apply(op);
record('INSERT_TEST', first.decision === 'inserted', { ...first, operation_id: operationId });

const selected = d1(selectSql).results[0];
record('SELECT_TEST', selected?.operation_id === operationId && selected?.payload_hash === op.payload_hash && selected?.payload === payload, {
  operation_id: selected?.operation_id,
  received_at: selected?.received_at,
});

const retry = apply(op);
record('IDEMPOTENCY', retry.decision === 'already_processed', retry);

const tampered = JSON.stringify({ sale_id: 'S-0002', total_cents: 1, lines: [] });
const conflictOp = { ...op, payload: tampered, payload_hash: sha256(tampered) };
const conflict = apply(conflictOp);
record('CONFLICT_TEST', conflict.decision === 'conflict', { ...conflict, stored_hash: op.payload_hash, incoming_hash: conflictOp.payload_hash });

const after = d1(selectSql).results[0];
record('CONFLICT_NOT_OVERWRITTEN', after?.payload_hash === op.payload_hash && after?.payload === payload, { stored_payload_hash: after?.payload_hash });

const count = rowCount();
record('ROW_COUNT_AFTER_RETRY', count === 1, { rows_for_operation_id: count });

console.log(`\nMODE=${mode}\nOPERATION_ID=${operationId}`);
for (const [name, value] of Object.entries(results)) console.log(`${name}=${value}`);
process.exit(Object.values(results).every((v) => v === 'PASS') ? 0 : 1);
