// SPEC-885-delta2 O-D2-1: the per-isolate ledger list must never hide a ledger
// that was created after the list was read. Schema WITHOUT 0032
// (canonical_expense_revisions), warm cache, then 0032 lands and an expense
// revision takes id X: the very next command with X must be 409 cross_ledger,
// never 201 with two operations sharing X. turso: the real fast sale with a
// long-lived adapter (the path that failed open on ef7dc5c8). d1: the same flow
// on the D1 contract (session path) plus the 'd1' cache key directly.
// With all 14 ledgers present (incl. pos_purchases, delta 3b) the list stays
// cached: 0 standalone sqlite_master reads.
// Synthetic data only; in-process SQLite; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { tursoSqlite } from './turso-sqlite-protocol.mjs';
import { canUseCanonicalSaleFastPath } from '../../tools/cloudflare-lab/src/a6-commerce.js';
import { getDatabase } from '../../tools/cloudflare-lab/src/database-binding.js';
import { OPERATION_LEDGER_TABLES, operationLedgers, operationLedgerCacheKey, cachedOperationLedgers }
  from '../../tools/cloudflare-lab/src/operation-ledgers.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const ALL = readdirSync(new URL('../../infra/database/migrations/', import.meta.url)).filter((n) => /^00(1[4-9]|[2-9]\d)_/.test(n)).sort();
const WITHOUT_0032 = ALL.filter((n) => !n.startsWith('0032'));
const PRODUCT = '00001';
const LEDGER_PROBE = /^SELECT name FROM sqlite_master WHERE type='table' AND name IN \('sales'/;

async function shop(t, mode, migrations) {
  const f = await activeCanon(t, { migrations });
  let turso = null;
  if (mode === 'turso') {
    // One long-lived adapter (what P-1 of SPEC-885 would make the production default).
    turso = tursoSqlite(f.database);
    f.env.DB = turso.adapter;
    f.env.nuevo_amanecer_lab = { prepare() { throw Error('no D1'); } };
    f.env.RUNTIME_ENVIRONMENT = 'production';
    f.env.CANONICAL_RUNTIME_ENABLED = 'enabled';
  }
  const tab = await device(f, { token: 'ml-token', deviceId: 'ml-device' });
  await tab.api.adjustInventory({ product_id: PRODUCT, movement_type: 'ENTRADA', quantity: 20, reason: 'stock sintetico' });
  await tab.api.refresh();
  await tab.api.openCash({ session_id: 'cash-ml', opening_cents: 10000 });
  await tab.api.refresh();
  await tab.api.createExpense({ amount_cents: 100, concept: 'Gasto sintetico', category: 'otros', payment_method: 'efectivo', expense_date: '2026-10-21', session_id: 'cash-ml' });
  const call = async (command, body) => {
    const before = turso ? turso.calls.length : 0;
    const r = await f.fetch('http://localhost/commands/' + command, { method: 'POST', headers: { authorization: 'Bearer ml-token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const sqls = turso ? turso.calls.slice(before).flatMap((c) => c.requests.flatMap((q) => q.type === 'execute' ? [q.stmt.sql] : q.type === 'batch' ? q.batch.steps.map((s) => s.stmt.sql) : [])) : [];
    return { status: r.status, body: await r.json().catch(() => null), trips: turso ? turso.calls.length - before : null, probes: sqls.filter((s) => LEDGER_PROBE.test(s)).length };
  };
  const common = (op) => { const c = f.control(); return { operation_id: op, promotion_id: c.active_promotion_id, client_contract: 'a6-gate-c-v1', authority_epoch: c.authority_epoch, expected_control_revision: c.revision, created_at: '2026-10-21T15:30:00.000Z' }; };
  const rev = () => f.sql('SELECT stock_revision r FROM products WHERE product_id=?', PRODUCT).r;
  const sale = (op, cents = 250) => ({ ...common(op), sale_id: 'V-' + op, payment_method: 'efectivo', total_cents: cents, session_id: 'cash-ml',
    items: [{ product_id: PRODUCT, quantity: 1, unit_price_cents: cents, line_total_cents: cents, expected_stock_revision: rev() }],
    payment: { cash_cents: cents, digital_cents: 0, credit_cents: 0 } });
  const inventory = (op) => ({ ...common(op), product_id: PRODUCT, movement_type: 'ENTRADA', quantity: 1, expected_stock_revision: rev(), reason: 'sintetico' });
  let n = 0;
  const expenseRevision = (op) => { const e = f.sql('SELECT expense_id, promotion_id FROM canonical_expenses LIMIT 1');
    f.database.prepare(`INSERT INTO canonical_expense_revisions (operation_id,expense_id,promotion_id,revision,action,request_hash,created_at) VALUES(?,?,?,?,'edit',?,?)`)
      .run(op, e.expense_id, e.promotion_id, ++n, 'b'.repeat(64), '2026-10-21T15:30:00.000Z'); };
  const migrate0032 = () => f.database.exec(read('infra/database/migrations/0032_canonical_expense_revisions.sql'));
  const rows = (op) => ({ sales: f.sql('SELECT COUNT(*) n FROM sales WHERE operation_id=?', op).n,
    inventory: f.sql('SELECT COUNT(*) n FROM canonical_inventory_operations WHERE operation_id=?', op).n,
    revisions: f.sql('SELECT COUNT(*) n FROM canonical_expense_revisions WHERE operation_id=?', op).n });
  return { f, tab, turso, call, sale, inventory, expenseRevision, migrate0032, rows, db: getDatabase(f.env) };
}

const crossed = (res) => {
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.deepEqual([res.body.error, res.body.conflict, res.body.ledger], ['operation_id_conflict', 'cross_ledger', 'expense_revision']);
};

for (const mode of ['d1', 'turso']) {
  test(`${mode}: ledger created after the list was read -> next request is 409 cross_ledger, never a 201 duplicate`, async (t) => {
    const x = await shop(t, mode, WITHOUT_0032);
    assert.equal(operationLedgerCacheKey(x.db), mode === 'turso' ? 'turso:https://synthetic.turso.test' : 'd1');
    assert.equal(canUseCanonicalSaleFastPath(x.sale('probe'), x.f.env), mode === 'turso', 'turso exercises the fast sale (no session read)');
    const warm = await x.call('sale.create', x.sale(`ML-warm-${mode}`));
    assert.equal(warm.status, 201, JSON.stringify(warm.body));
    // The isolate has seen the 12-ledger schema; an incomplete list is not kept as cacheable.
    assert.equal((await operationLedgers(x.db)).includes('canonical_expense_revisions'), false);
    assert.equal(cachedOperationLedgers(x.db), null, 'incomplete list is never served from the cache');

    x.migrate0032(); // migration lands while the isolate (and, on turso, the adapter) stays warm
    const X = `ML-X-${mode}`; x.expenseRevision(X);
    const s = await x.call('sale.create', x.sale(X));
    crossed(s);
    assert.deepEqual(x.rows(X), { sales: 0, inventory: 0, revisions: 1 }, 'no second operation with the same id');
    if (mode === 'turso') assert.equal(s.probes, 1, 'partial schema: the fast sale re-read the ledger list (1 read)');

    const Y = `ML-Y-${mode}`; x.expenseRevision(Y);
    crossed(await x.call('inventory.adjust', x.inventory(Y)));
    assert.deepEqual(x.rows(Y), { sales: 0, inventory: 0, revisions: 1 });

    // Now all 14 exist (0028 pos_purchases is already in this schema): cached for the
    // isolate's life, so the next fast sale pays no standalone sqlite_master read.
    assert.deepEqual(cachedOperationLedgers(x.db), [...OPERATION_LEDGER_TABLES]);
    const ok = await x.call('sale.create', x.sale(`ML-ok-${mode}`));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.probes, 0, 'complete list: no standalone sqlite_master read');
    const Z = `ML-Z-${mode}`; x.expenseRevision(Z);
    crossed(await x.call('sale.create', x.sale(Z)));
    assert.equal(x.rows(Z).sales, 0);
  });

  test(`${mode}: cache key '${mode === 'd1' ? 'd1' : 'turso:<url>'}' never hides a ledger created between two reads; complete list costs 0 reads`, async (t) => {
    const f = await activeCanon(t, { migrations: WITHOUT_0032 });
    const counted = [];
    const base = mode === 'turso' ? tursoSqlite(f.database).adapter : (f.env.DB ?? f.env.nuevo_amanecer_lab);
    const db = new Proxy(base, { get(target, key) {
      const v = Reflect.get(target, key, target);
      if (key === 'prepare') return (sql) => { if (LEDGER_PROBE.test(sql)) counted.push(sql); return v.call(target, sql); };
      return typeof v === 'function' ? v.bind(target) : v;
    } });
    // Same key as the unwrapped adapter (instanceof survives the proxy).
    assert.equal(operationLedgerCacheKey(db), mode === 'turso' ? 'turso:https://synthetic.turso.test' : 'd1');
    assert.equal((await operationLedgers(db)).length, OPERATION_LEDGER_TABLES.length - 1);
    assert.equal((await operationLedgers(db)).length, OPERATION_LEDGER_TABLES.length - 1);
    assert.equal(counted.length, 2, 'incomplete: every call re-reads sqlite_master');
    f.database.exec(read('infra/database/migrations/0032_canonical_expense_revisions.sql'));
    assert.deepEqual(await operationLedgers(db), [...OPERATION_LEDGER_TABLES], 'the new ledger is seen on the very next call');
    for (let i = 0; i < 5; i++) await operationLedgers(db);
    assert.equal(counted.length, 3, 'complete: cached, 0 further reads');
  });
}
