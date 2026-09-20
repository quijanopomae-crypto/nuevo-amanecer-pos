import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { workerFixture } from './worker-fixture.mjs';
import { buildManifest, sha256Hex, stableStringify } from '../../tools/cloudflare-lab/src/a5-import-core.js';
import { A6_MAPPING_VERSION, A6_SCHEMA_VERSION, a6PolicyHash } from '../../tools/cloudflare-lab/src/a6-mapping.js';

// Synthetic only. Real SQLite transactions/constraints, NOT a mock of persistence
// and NOT a claim of Cloudflare D1 limits, private baseline or browser coverage.
export const TABLES = ['products', 'customers', 'credits', 'credit_payments'];
export const READ_ROUTES = [...TABLES.map(x => x.replaceAll('_', '-')), 'sales', 'sale-items', 'inventory-movements', 'cash-movements', 'status'];
export const WRITER = { 'x-device-id': 'a6-writer', 'x-sync-token': 'a6-writer-secret' };
export const READER = { 'x-read-token': 'fixture-read-token' };
export const LOCAL_DB = 'a6-synthetic-memory-database';

export function syntheticRows(productCount = 28) {
  const rows = [];
  const add = (type, key, payload, row = rows.length + 1) => rows.push({ entity_type: type, source_key: key, source_name: 'synthetic:fuente.json', source_row: row, payload });
  for (let i = 0; i < productCount; i++) {
    const id = String(i).padStart(5, '0');
    add('products', id, { id, name: `Synthetic ${id}`, sku: `00${i}`, barcode: `000${i}`, codigosAlternativos: ['0007', '0007', '0010'], codigoAlternativo: '0000',
      cat: 'A', marca: 'Marca', descripcion: 'Descripción', icon: 'box', imagen: null, unidad: 'kg', unidadCompra: 'caja', factorCompra: 2.5,
      costo: '0.29', precio: '12,34', precioCaja: '24.68', unidCaja: 2.5, stock: i === 0 ? -2.75 : i === 1 ? 0 : 1.125,
      stockMin: 0.25, venc: '2028-02-29', incluyeIGV: i % 2 === 0, tipoImpuesto: 'IGV', impuestoComplementario: null, controlInventario: i % 2 !== 0,
      audit_only: { token: 'synthetic-source-secret', nested: ['<script>never execute</script>', null, false, 0] } });
  }
  add('customers', '000C', { id: '000C', nombre: 'Cliente sintético', Documento: '000C', telefono: '000123', direccion: null, color: null,
    'Saldo documentos': '7.00', 'Crédito histórico': '10.00', 'Pagado histórico': '3.00', 'Primer crédito': '2026-01-01' });
  add('credits', 'CR:001', { id: 'CR:001', cliente_id: '000C', monto_cents: 1000, pagado_cents: 300, saldo_cents: 700,
    'Crédito original': '10.00', 'Total abonado': '3.00', Saldo: '7.00', Emisión: '2026-01-01', Vencimiento: null, pagos: [{ history: 'do not replay' }] });
  add('credit_payments', 'ambiguous:credit:pay:unknown', { id: 'PAY:0', credito_id: 'CR:001', monto_cents: 100, fecha: null, fecha_conocida: false, 'Fecha y hora': 'No registrada', 'N.º operación': '-' }, 100);
  add('credit_payments', 'ambiguous:credit:pay:date', { id: 'PAY:1', credito_id: 'CR:001', monto_cents: 100, fecha: '2026-02-28', fecha_conocida: true, Fecha: '2026-02-28' }, 100);
  add('credit_payments', 'ambiguous:credit:pay:timestamp', { id: 'PAY:2', credito_id: 'CR:001', monto_cents: 100, fecha: '2026-03-01', fecha_conocida: true,
    Fecha: '2026-03-01T03:04:05.000Z', 'Fecha y hora': '2026-02-28T22:04:05.000-05:00' }, 100);
  return rows;
}

export async function syntheticManifest(id = 'a6-run-1', rows = syntheticRows()) {
  const bytes = stableStringify(rows);
  return buildManifest({ importId: id, sources: [{ name: `${id}.json`, type: 'POS_JSON', sha256: await sha256Hex(bytes), bytes: Buffer.byteLength(bytes) }], rows });
}

export async function response(response, expected) {
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}

export async function a6Fixture(t, { runs = 1, rows = syntheticRows() } = {}) {
  const f = workerFixture();
  t.after(() => f.close());
  f.addDevice('a6-writer', 'writer', 'active', WRITER['x-sync-token']);
  f.addDevice('a6-reader', 'read_only', 'active', 'a6-reader-secret');
  f.sql = (sql, ...params) => f.database.prepare(sql).get(...params);
  f.all = (sql, ...params) => f.database.prepare(sql).all(...params);
  f.exec = (sql, ...params) => f.database.prepare(sql).run(...params);
  f.control = () => f.sql('SELECT * FROM canonical_control WHERE id=1');
  f.counts = (promotion = 'a6-promotion-1') => Object.fromEntries(TABLES.map(table => [table, f.sql(`SELECT COUNT(*) n FROM ${table} WHERE promotion_id=?`, promotion).n]));
  f.post = (path, body, headers = WRITER) => f.fetch(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  f.read = (route, query = '', headers = READER) => f.fetch(`http://localhost/read/canonical/${route}${query}`, { headers });
  f.export = (promotion, table, query = '', headers = WRITER) => f.fetch(`http://localhost/imports/canonical/${promotion}?entity_type=${table}${query}`, { headers });
  f.rotate = () => f.exec('UPDATE devices SET credential_hash=? WHERE device_id=?', createHmac('sha256', f.env.DEVICE_CREDENTIAL_PEPPER).update('rotated-secret').digest('hex'), 'a6-writer');
  f.bumpControl = (extra = '') => f.database.exec(`UPDATE canonical_control SET revision=revision+1,authority_epoch=authority_epoch+1${extra} WHERE id=1`);
  f.manifests = [];
  // Both source runs MUST exist while LEGACY. No bypass of the freeze trigger.
  for (let i = 1; i <= runs; i++) {
    const manifest = await syntheticManifest(`a6-run-${i}`, structuredClone(rows));
    assert.equal(manifest.report.verdict, 'PASS', JSON.stringify(manifest.report));
    const base = { import_id: manifest.import_id };
    await response(await f.post('/commands/import.stage', { ...base, action: 'start', source_hash: manifest.source_hash, manifest_hash: manifest.manifest_hash,
      transform_version: manifest.transform_version, source_files: 1, sources: manifest.sources, row_count: manifest.rows.length, report_json: JSON.stringify(manifest.report) }), 201);
    for (let n = 0; n < manifest.rows.length; n += 50) await response(await f.post('/commands/import.stage', { ...base, action: 'rows', rows: manifest.rows.slice(n, n + 50) }), 200);
    await response(await f.post('/commands/import.stage', { ...base, action: 'finish', manifest_hash: manifest.manifest_hash, verdict: 'PASS', issue_count: 0 }), 200);
    f.manifests.push(manifest);
  }
  Object.assign(f.env, { A6_LOCAL_GATE: 'enabled', A6_LOCAL_DATABASE_ID: LOCAL_DB });
  f.selectRun = async (index = 0) => {
    const m = f.manifests[index];
    const staged = f.sql('SELECT revision FROM import_runs WHERE import_id=?', m.import_id);
    const expected = Object.fromEntries(['products','customers','credits','credit_payments','sales','sale_items','cash_movements','inventory_movements','expenses','cash_closures'].map(key => [key, m.report.counts[key] ?? 0]));
    Object.assign(expected, m.report.amounts, { known_payment_dates: m.rows.filter(r => r.entity_type === 'credit_payments' && r.payload.fecha_conocida).length,
      unknown_payment_dates: m.rows.filter(r => r.entity_type === 'credit_payments' && !r.payload.fecha_conocida).length });
    f.manifest = { environment: 'local', database_id: LOCAL_DB, worker_hash: await sha256Hex('synthetic worker descriptor'), client_hash: await sha256Hex('synthetic client descriptor'),
      operator: 'synthetic-test-only', backup_hash: await sha256Hex('synthetic backup descriptor'), run: { import_id: m.import_id, source_hash: m.source_hash, manifest_hash: m.manifest_hash, transform_version: m.transform_version, staging_revision: staged.revision },
      mapping_version: A6_MAPPING_VERSION, schema_version: A6_SCHEMA_VERSION, policy_hash: await a6PolicyHash(), expected, local_pending_count: 0, local_delta_count: 0 };
    f.env.A6_OPERATIONAL_MANIFEST = JSON.stringify(f.manifest);
    f.request = { operation_id: `a6-promote-${index + 1}`, promotion_id: `a6-promotion-${index + 1}`, import_id: m.import_id, expected_source_hash: m.source_hash,
      expected_manifest_hash: m.manifest_hash, expected_transform_version: m.transform_version, expected_staging_revision: staged.revision,
      mapping_version: A6_MAPPING_VERSION, schema_version: A6_SCHEMA_VERSION, policy_hash: f.manifest.policy_hash, expected_control_revision: f.control().revision + 1 };
  };
  await f.selectRun();
  f.freeze = (id = `freeze-${f.control().revision}`) => f.post('/commands/canonical.freeze', { operation_id: id, expected_control_revision: f.control().revision });
  f.promote = (phase = 'publish', changes = {}) => f.post('/commands/import.promote', { ...f.request, phase, ...changes });
  f.rollback = (changes = {}) => f.post('/commands/canonical.rollback', { operation_id: 'a6-rollback', promotion_id: f.request.promotion_id, expected_control_revision: f.control().revision, ...changes });
  return f;
}

// Intercept only the public binding. Every successful statement still executes
// SQLite; throwing inside _run uses its real BEGIN/ROLLBACK, not fake meta.changes.
export function intercept(f, hook) {
  const base = f.binding;
  const metadata = new WeakMap();
  const wrapped = {
    prepare(sql) {
      const statement = base.prepare(sql);
      const meta = { sql, params: [] };
      metadata.set(statement, meta);
      const bind = statement.bind;
      statement.bind = function (...values) { meta.params = values; return bind.apply(this, values); };
      for (const method of ['first', 'all', 'run']) {
        const execute = statement[method];
        statement[method] = async function () {
          await hook({ when: 'before', method, ...meta });
          const result = await execute.call(this);
          await hook({ when: 'after', method, ...meta, result });
          return result;
        };
      }
      return statement;
    },
    async batch(statements) {
      const entries = statements.map(s => metadata.get(s));
      const kind = entries.some(e => e.sql.includes("SET status='COMMITTED'")) ? 'publish'
        : entries.some(e => e.sql.startsWith('INSERT INTO products(') || e.sql.startsWith('INSERT INTO customers(') || e.sql.startsWith('INSERT INTO credits(') || e.sql.startsWith('INSERT INTO credit_payments(')) ? 'prepare'
        : entries.some(e => e.sql.includes("'rollback'")) ? 'rollback' : entries.some(e => e.sql.includes("'freeze'")) ? 'freeze' : 'other';
      const event = { method: 'batch', kind, entries, statements };
      await hook({ ...event, when: 'before' });
      const result = await base.batch(statements);
      await hook({ ...event, when: 'after', result });
      return result;
    },
  };
  f.env.nuevo_amanecer_lab = wrapped;
  return () => { f.env.nuevo_amanecer_lab = base; };
}

export function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

export function trafficIsZero(f) {
  for (const table of ['sales', 'sale_items', 'cash_movements', 'inventory_movements', 'sync_operations']) assert.equal(f.sql(`SELECT COUNT(*) n FROM ${table}`).n, 0, table);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_assertions').n, 0, 'no leaked guards');
}

export const SALE = { operation_id: 'stale-sale-op', sale_id: 'stale-sale', created_at: '2026-01-01T00:00:00Z', payment_method: 'efectivo', total_cents: 100,
  payment: { cash_cents: 100, digital_cents: 0, credit_cents: 0 }, items: [{ product_id: '00000', quantity: 1, unit_price_cents: 100 }] };

export async function syncOperation() {
  const payload = '{"synthetic":true}';
  return { operation_id: 'legacy-stale-op', device_id: 'a6-writer', device_sequence: 1, entity_type: 'sales', entity_id: 'legacy-sale', payload, payload_hash: await sha256Hex(payload), created_at: '2026-01-01T00:00:00Z' };
}

// Fully reconciled source assertions, with one pending and one paid-off credit.
// Payment sequence deliberately differs from source-key/date order. No synthetic
// payment is created by promotion: all four histories are present in A5 staging.
export function assertedFinancialRows() {
  const rows = syntheticRows();
  const customer = rows.find(r => r.entity_type === 'customers').payload;
  Object.assign(customer, {
    'Saldo imágenes': '7.00', 'Saldo documentos': '7.00', Diferencia: '0.00',
    'Docs. totales': 2, 'Docs. pendientes': 1, 'Docs. pagados': 1, 'N.º abonos': 4,
    'Crédito original pendiente': '10.00', 'Abonado en créditos pendientes': '3.00',
    '% avance pendiente': 0.3, 'Crédito histórico': '15.00', 'Pagado histórico': '8.00',
  });
  Object.assign(rows.find(r => r.entity_type === 'credits').payload, {
    'N.º abonos': 3, '% avance': 0.3,
    'Saldo imágenes cliente': '7.00', 'Saldo documentos cliente': '7.00', 'Diferencia cliente': '0.00',
  });
  for (const row of rows.filter(r => r.entity_type === 'credit_payments')) {
    const sequence = { 'PAY:0': 3, 'PAY:1': 1, 'PAY:2': 2 }[row.payload.id];
    Object.assign(row.payload, {
      'Pago N.º (secuencia)': sequence, 'Pagado acumulado': `${sequence}.00`,
      'Saldo después del pago': `${10 - sequence}.00`, 'Avance acumulado': sequence / 10,
      'Crédito original': '10.00', 'Saldo actual documento': '7.00',
      'Documento cliente': customer.Documento, Cliente: customer.nombre,
    });
  }
  rows.push({ entity_type: 'credits', source_key: 'CR:PAID', source_name: 'synthetic:fuente.json', source_row: 110,
    payload: { id: 'CR:PAID', cliente_id: customer.id, monto_cents: 500, pagado_cents: 500, saldo_cents: 0,
      'N.º abonos': 1, '% avance': 1, 'Saldo imágenes cliente': '7.00', 'Saldo documentos cliente': '7.00', 'Diferencia cliente': '0.00' } });
  rows.push({ entity_type: 'credit_payments', source_key: 'paid:history', source_name: 'synthetic:fuente.json', source_row: 111,
    payload: { id: 'PAY:PAID', credito_id: 'CR:PAID', monto_cents: 500, fecha: null, fecha_conocida: false,
      'Pago N.º (secuencia)': 1, 'Pagado acumulado': '5.00', 'Saldo después del pago': '0.00', 'Avance acumulado': 1,
      'Crédito original': '5.00', 'Saldo actual documento': '0.00', 'Documento cliente': customer.Documento, Cliente: customer.nombre } });
  return rows;
}
