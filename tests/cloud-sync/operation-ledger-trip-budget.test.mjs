// Trip budget of the cross-ledger check (PR #885) on the REAL production entry:
// worker-entry.js + DB_PROVIDER=turso + the real Turso adapter against an
// instrumented in-process /v3/pipeline (SQLite). env.DB and nuevo_amanecer_lab
// are instrumented D1 decoys: not one statement may reach them.
// Exact Worker->Turso round trips per command must equal ed480383, warm AND
// cold (empty per-isolate ledger cache): the ledger list rides in reads that
// already exist (session auth, stock-lots/schema probes). The atomic fences of
// product.update / customer.contact.set ride inside their write batch.
// Synthetic data only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import workerEntry from '../../tools/cloudflare-lab/src/worker-entry.js';
import { TursoD1Adapter } from '../../tools/cloudflare-lab/src/turso-d1-adapter.js';
import { resetOperationLedgerCache, operationLedgerCacheKey } from '../../tools/cloudflare-lab/src/operation-ledgers.js';
import { activeCanon, device } from './canon-browser-harness.mjs';

const TURSO_URL = 'https://budget-ledgers.turso.test';
// Measured on ed480383 with this same flow (plan-p1/fix-crossledger/reads-per-sale).
const BASE_TRIPS = {
  'sale.create efectivo': 3, 'sale.create mixto': 3, 'sale.create credito': 4,
  'inventory.adjust': 10, 'expense.create': 9, 'product.update': 5,
  'customer.contact.set': 7, 'payment.batch': 3,
};
const FENCED_IN_BATCH = ['product.update', 'customer.contact.set'];
const MIGRATIONS = readdirSync(new URL('../../infra/database/migrations/', import.meta.url)).filter((n) => /^00(1[4-9]|[2-9]\d)_/.test(n)).sort();
const POS = (name) => readFileSync(new URL('../../POS/js/' + name, import.meta.url), 'utf8');
const SALE_SCRIPTS = ['canonical-sale-intent', 'canonical-sale-outbox', 'canonical-sale-projection', 'canonical-sale-integration', 'canonical-sale-view'];

function encodeValue(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'bigint') return { type: 'integer', value: String(v) };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  if (typeof v === 'string') return { type: 'text', value: v };
  if (v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') };
  throw new TypeError('unsupported value');
}
function decodeArg(a) {
  if (a.type === 'null') return null;
  if (a.type === 'integer') { const n = BigInt(a.value); return Number.isSafeInteger(Number(n)) ? Number(n) : n; }
  if (a.type === 'float') return Number(a.value);
  if (a.type === 'text') return a.value;
  if (a.type === 'blob') return Buffer.from(a.base64, 'base64');
  throw new TypeError('unsupported arg');
}
function fakeTurso(database) {
  const calls = [];
  const run = (stmt) => {
    const s = database.prepare(stmt.sql), args = (stmt.args || []).map(decodeArg);
    if (!stmt.want_rows || !s.columns().length) { const info = s.run(...args); return { cols: [], rows: [], affected_row_count: Number(info.changes), last_insert_rowid: null }; }
    const cols = s.columns().map((c) => ({ name: c.name }));
    return { cols, rows: s.all(...args).map((r) => cols.map((c) => encodeValue(r[c.name]))), affected_row_count: 0, last_insert_rowid: null };
  };
  const fetchImpl = async (url, init) => {
    assert.ok(String(url).startsWith(TURSO_URL), 'only the emulated Turso host: ' + url);
    const body = JSON.parse(init.body), sqls = [];
    const results = body.requests.map((r) => {
      if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
      if (r.type === 'execute') { sqls.push(r.stmt.sql); try { return { type: 'ok', response: { type: 'execute', result: run(r.stmt) } }; } catch (e) { return { type: 'error', error: { message: String(e.message) } }; } }
      if (r.type === 'batch') {
        const steps = r.batch.steps, sr = [], se = [];
        const holds = (c) => !c ? true : c.type === 'ok' ? !!sr[c.step] : c.type === 'not' ? !holds(c.cond) : false;
        steps.forEach((st, i) => { sr[i] = null; se[i] = null; if (!holds(st.condition)) return; sqls.push(st.stmt.sql); try { sr[i] = run(st.stmt); } catch (e) { se[i] = { message: String(e.message) }; } });
        return { type: 'ok', response: { type: 'batch', result: { step_results: sr, step_errors: se } } };
      }
      return { type: 'error', error: { message: 'unsupported' } };
    });
    calls.push({ sqls });
    return new Response(JSON.stringify({ baton: null, results }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}
function d1Decoy(name, hits) {
  const hit = (op) => () => { hits.push(name + '.' + op); throw new Error('D1 decoy ' + name + ' used: ' + op); };
  return { prepare: hit('prepare'), batch: hit('batch'), exec: hit('exec'), dump: hit('dump'), withSession: hit('withSession') };
}

async function productionShop(t) {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  const turso = fakeTurso(f.database), d1Hits = [];
  const env = { ...f.env, DB: d1Decoy('DB', d1Hits), nuevo_amanecer_lab: d1Decoy('nuevo_amanecer_lab', d1Hits),
    RUNTIME_ENVIRONMENT: 'production', CANONICAL_RUNTIME_ENABLED: 'enabled', DB_PROVIDER: 'turso',
    TURSO_DATABASE_URL: TURSO_URL, TURSO_AUTH_TOKEN: 'budget-ledgers-token' };
  const log = [];
  let coldNext = false;
  const tab = await device(f, { token: 'device-a-token', deviceId: 'device-a',
    scripts: [['lexical-runtime', 'let cart=[],productos=[],ventas=[],clientes=[],creditos=[],cajEstado={},cajMovs=[],posProc=false,posPayM=\'efectivo\';'], ...SALE_SCRIPTS.map((n) => [n, POS('sync/' + n + '.js')])],
    globals: { isModuleLocked: () => false, _naSessionOpen: () => true, _naPaymentState: () => ({ valid: true }), _naTracksStock: () => true, _naUnitsSold: (i) => i.qty, _naUnitsPerQty: () => 1, posUpdateCart() {}, posRender() {} },
    async onFetch(url, rest) {
      const u = new URL(url), path = u.pathname;
      if (path.startsWith('/commands/') && coldNext) { resetOperationLedgerCache(); coldNext = false; }
      const original = globalThis.fetch, before = turso.calls.length;
      globalThis.fetch = turso.fetchImpl; // every route, reads included, goes to Turso like production
      try {
        const res = await workerEntry.fetch(new Request('https://prod.example' + path + u.search, rest), env, {});
        const sqls = turso.calls.slice(before).flatMap((c) => c.sqls);
        log.push({ path, status: res.status, trips: turso.calls.length - before, sqls });
        return res;
      } finally { globalThis.fetch = original; }
    } });
  await tab.api.refresh();
  await tab.api.openCash({ session_id: 'budget-session', opening_cents: 10000 });
  await tab.api.refresh();
  await tab.api.setCustomerCreditPolicy({ customer_id: '000C', mode: 'MANUAL', manual_limit_cents: 100000000, reason: 'Linea sintetica de presupuesto', administrator_id: 'a', administrator_name: 'Admin sintetico' });
  const pid = 'BLG-' + randomUUID().slice(0, 6);
  await tab.api.refresh();
  await tab.api.createProduct({ product_id: pid, name: 'Prod presupuesto', sku: pid + 's', barcode: pid + 'b', alternate_codes: [], category: 't', brand: 'T', description: null, icon: '📦', image: null, unit: 'unidad', purchase_unit: 'unidad', purchase_factor: 1, cost_cents: 100, price_cents: 1000, box_price_cents: null, units_per_box: null, initial_stock_quantity: 1000, stock_min_quantity: 0, expiry_date: null, includes_igv: true, tax_type: 'gravado', complementary_tax: '', tracks_inventory: true });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  let seq = 0;
  const intent = (extra) => tab.context.NuevoAmanecerCanonicalSaleIntent.build({ sale_id: 'V-' + String(++seq).padStart(3, '0'), items: [{ product_id: pid, quantity: 1, precio: 10 }], ...extra });
  const ops = {
    'sale.create efectivo': () => tab.api.createSale(intent({ payment_method: 'efectivo', session_id: 'budget-session' })),
    'sale.create mixto': () => tab.api.createSale(intent({ payment_method: 'mixto', session_id: 'budget-session', payment: { cash_cents: 400, digital_cents: 600, digital_method: 'plin', reference: 'MIX-' + randomUUID().slice(0, 8) } })),
    'sale.create credito': () => tab.api.createSale(intent({ payment_method: 'credito', customer_id: '000C', credit_due: '2099-12-31' })),
    'inventory.adjust': () => tab.api.adjustInventory({ product_id: pid, movement_type: 'ENTRADA', quantity: 1, reason: 'presupuesto' }),
    'expense.create': () => tab.api.createExpense({ amount_cents: 100, concept: 'Gasto sintetico', category: 'otros', payment_method: 'efectivo', expense_date: today, session_id: 'budget-session' }),
    'product.update': () => { const raw = tab.api.snapshot().products.find((p) => p.product_id === pid);
      return tab.api.updateProduct({ product_id: raw.product_id, name: raw.name, sku: raw.sku, barcode: raw.barcode, alternate_codes: [], category: raw.category, brand: raw.brand, description: raw.description, icon: raw.icon, cost_cents: raw.cost_cents ?? 0, price_cents: raw.price_cents + 1, box_price_cents: null, units_per_box: null, stock_min_quantity: 0, expiry_date: null }); },
    'customer.contact.set': () => tab.api.setCustomerContact({ customer_id: '000C', name: 'Cliente sintetico ' + (++seq), phone: null }),
    'payment.batch': () => tab.api.createPaymentBatch([{ credit_id: 'CR:001', amount_cents: 1, payment_method: 'efectivo', session_id: 'budget-session', reference: '' }]),
  };
  const measure = async (name, { cold = false } = {}) => {
    await tab.api.refresh();
    coldNext = cold;
    await ops[name]();
    const route = '/commands/' + name.split(' ')[0];
    const row = log.filter((r) => r.path === route).at(-1);
    assert.ok(row && row.status < 300, name + ': ' + JSON.stringify(row && { status: row.status }));
    return row;
  };
  return { f, env, tab, log, turso, d1Hits, measure };
}

test('PR #885 adds no Worker->Turso round trip, warm or cold, and the D1 decoy gets 0 statements', async (t) => {
  const shop = await productionShop(t);
  const db = (await import('../../tools/cloudflare-lab/src/database-binding.js')).getDatabase(shop.env);
  assert.ok(db instanceof TursoD1Adapter);
  assert.equal(operationLedgerCacheKey(db), 'turso:' + TURSO_URL, 'cache key is the Turso URL, never the D1 binding');
  const report = {};
  for (const name of Object.keys(BASE_TRIPS)) {
    const warm = [];
    for (let i = 0; i < 3; i++) warm.push((await shop.measure(name)).trips);
    const cold = await shop.measure(name, { cold: true });
    report[name] = { warm, cold: cold.trips };
    assert.deepEqual(warm, [BASE_TRIPS[name], BASE_TRIPS[name], BASE_TRIPS[name]], name + ' warm trips vs ed480383');
    assert.equal(cold.trips, BASE_TRIPS[name], name + ' cold trips (empty ledger cache) vs ed480383');
    assert.equal(cold.sqls.filter((s) => /^SELECT name FROM sqlite_master/.test(s)).length, 0, name + ': no standalone ledger probe even cold');
    if (FENCED_IN_BATCH.includes(name)) assert.ok(cold.sqls.some((s) => /INSERT INTO canonical_assertions/.test(s)), name + ': atomic fence inside the write batch');
  }
  t.diagnostic('trips ' + JSON.stringify(report));
  assert.deepEqual(shop.d1Hits, [], 'no statement may reach the D1 binding when DB_PROVIDER=turso');
  assert.equal(shop.f.sql('SELECT COUNT(*) n FROM canonical_assertions').n, 0, 'fences leave no rows');
});
