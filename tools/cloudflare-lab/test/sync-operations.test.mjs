// Prueba de contrato contra un Worker en ejecución (local `wrangler dev` o remoto).
// Uso: node test/sync-operations.test.mjs <baseUrl>   (SYNC_TOKEN en el entorno)
import { createHash, randomUUID } from 'node:crypto';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8787';
const token = process.env.SYNC_TOKEN;
if (!token) {
  console.error('SYNC_TOKEN missing in environment');
  process.exit(2);
}

const results = {};
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

async function call(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-sync-token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function record(name, pass, detail) {
  results[name] = pass ? 'PASS' : 'FAIL';
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
}

const operationId = `op-${randomUUID()}`;
const payload = JSON.stringify({ sale_id: 'S-0001', total_cents: 12500, lines: [{ sku: 'ARROZ-1KG', qty: 2 }] });
const operation = {
  operation_id: operationId,
  device_id: 'caja-01',
  device_sequence: 1,
  entity_type: 'sale',
  entity_id: 'S-0001',
  payload,
  payload_hash: sha256(payload),
  created_at: new Date().toISOString(),
};

const preflightResponse = await fetch(baseUrl + '/sync/operations', {
  method: 'OPTIONS',
  headers: { origin: 'null', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-sync-token' },
});
record(
  'CORS_PREFLIGHT',
  preflightResponse.status === 204 &&
    preflightResponse.headers.get('access-control-allow-origin') === '*' &&
    preflightResponse.headers.get('access-control-allow-methods')?.includes('POST') &&
    preflightResponse.headers.get('access-control-allow-headers')?.includes('x-sync-token'),
  { status: preflightResponse.status },
);

const healthResponse = await fetch(baseUrl + '/health');
const health = { status: healthResponse.status, body: await healthResponse.json() };
record('HEALTH', health.status === 200 && health.body.ok === true && health.body.d1 === 'ok' && healthResponse.headers.get('access-control-allow-origin') === '*', health);

const noAuth = await fetch(baseUrl + '/sync/operations', { method: 'POST', body: JSON.stringify(operation) });
record('AUTH_REQUIRED', noAuth.status === 401, { status: noAuth.status });

const insert = await call('POST', '/sync/operations', operation);
record('INSERT_TEST', insert.status === 201 && insert.body.status === 'inserted', insert);

const select = await call('GET', `/sync/operations/${encodeURIComponent(operationId)}`);
record(
  'SELECT_TEST',
  select.status === 200 &&
    select.body.operation?.operation_id === operationId &&
    select.body.operation?.payload_hash === operation.payload_hash &&
    select.body.operation?.payload === payload &&
    select.body.operation?.device_sequence === 1,
  { status: select.status, operation_id: select.body.operation?.operation_id, received_at: select.body.operation?.received_at },
);

const retry = await call('POST', '/sync/operations', operation);
record('IDEMPOTENCY', retry.status === 200 && retry.body.status === 'already_processed', retry);

const tamperedPayload = JSON.stringify({ sale_id: 'S-0001', total_cents: 99999, lines: [] });
const conflict = await call('POST', '/sync/operations', { ...operation, payload: tamperedPayload, payload_hash: sha256(tamperedPayload) });
record('CONFLICT_TEST', conflict.status === 409 && conflict.body.status === 'conflict', conflict);

const afterConflict = await call('GET', `/sync/operations/${encodeURIComponent(operationId)}`);
record(
  'CONFLICT_NOT_OVERWRITTEN',
  afterConflict.status === 200 && afterConflict.body.operation?.payload_hash === operation.payload_hash && afterConflict.body.operation?.payload === payload,
  { stored_payload_hash: afterConflict.body.operation?.payload_hash },
);

const badHash = await call('POST', '/sync/operations', { ...operation, operation_id: `op-${randomUUID()}`, payload_hash: sha256('otro') });
record('HASH_MISMATCH_REJECTED', badHash.status === 400 && badHash.body.error === 'payload_hash_mismatch', { status: badHash.status, error: badHash.body.error });

const missing = await call('GET', `/sync/operations/op-does-not-exist`);
record('SELECT_MISSING_404', missing.status === 404, { status: missing.status });

console.log('\nOPERATION_ID=' + operationId);
for (const [name, value] of Object.entries(results)) console.log(`${name}=${value}`);
process.exit(Object.values(results).every((v) => v === 'PASS') ? 0 : 1);
