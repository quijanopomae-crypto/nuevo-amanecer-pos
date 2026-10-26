// Race on the /auth/purchases header (delta 3b, pos-purchases.js header batch):
// another ledger (expense.update/void -> canonical_expense_revisions) commits the
// same operation_id AFTER the purchase's claim read (which folds the cross-ledger
// pre-check) but BEFORE its header batch commits. The atomic fence inside that
// batch must abort it: 409 operation_id_conflict / cross_ledger / expense_revision,
// no header, no lines, no stock, no leaked assertions. d1 and turso.
// Also: the id already owned by another ledger before the request -> 409 (pre-check,
// with the fence as second line). Synthetic data only; no migration; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { tursoSqlite } from './turso-sqlite-protocol.mjs';

const MIGRATIONS = readdirSync(new URL('../../infra/database/migrations/', import.meta.url)).filter((n) => /^00(1[4-9]|[2-9]\d)_/.test(n)).sort();
const PRODUCT = '00001';
const HEADER_INSERT = /^INSERT INTO pos_purchases\(/;

async function fixture(t, mode) {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  const real = mode === 'turso' ? tursoSqlite(f.database).adapter : f.env.DB ?? f.env.nuevo_amanecer_lab;
  if (mode === 'turso') f.env.nuevo_amanecer_lab = { prepare() { throw Error('no D1'); } };
  // Injection point: when the purchase prepares its header INSERT (after the claim
  // read, before the batch runs), the other ledger commits the same id first.
  let armed = null; let headerPrepared = 0;
  f.env.DB = new Proxy(real, { get(target, key) {
    if (key !== 'prepare') { const v = Reflect.get(target, key, target); return typeof v === 'function' ? v.bind(target) : v; }
    return (sql) => {
      if (HEADER_INSERT.test(sql)) headerPrepared++;
      if (armed && armed.match.test(sql)) { const a = armed; armed = null; a.inject(); }
      return target.prepare(sql);
    };
  } });
  const tab = await device(f, { token: 'pr-token', deviceId: 'pr-device' });
  await tab.api.refresh();
  await tab.api.openCash({ session_id: 'cash-pr', opening_cents: 10000 });
  await tab.api.refresh();
  await tab.api.createExpense({ amount_cents: 100, concept: 'Gasto sintetico', category: 'otros', payment_method: 'efectivo', expense_date: '2026-10-21', session_id: 'cash-pr' });
  await tab.api.refresh();
  const expense = f.sql('SELECT expense_id, promotion_id FROM canonical_expenses LIMIT 1');
  let revision = 0;
  const expenseRevision = (op) => () => f.database.prepare(`INSERT INTO canonical_expense_revisions
    (operation_id,expense_id,promotion_id,revision,action,request_hash,created_at) VALUES(?,?,?,?,'edit',?,?)`)
    .run(op, expense.expense_id, expense.promotion_id, ++revision, 'b'.repeat(64), '2026-10-21T15:30:00.000Z');
  const post = async (body) => {
    const res = await f.fetch('http://localhost/auth/purchases', { method: 'POST', headers: { authorization: 'Bearer pr-token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const purchase = (op) => { const c = f.control(); return { operation_id: op, promotion_id: c.active_promotion_id, client_contract: 'a6-gate-c-v1',
    authority_epoch: c.authority_epoch, expected_control_revision: c.revision, created_at: '2026-10-21T15:30:00.000Z',
    supplier: 'Proveedor sintetico', document_ref: 'F-001', lines: [{ line: 1, product_id: PRODUCT, quantity: 2, unit_cost_cents: 100 }] }; };
  const stock = () => f.sql('SELECT current_stock_quantity q, stock_revision r FROM products WHERE product_id=?', PRODUCT);
  const rows = (op) => ({
    header: f.sql('SELECT COUNT(*) n FROM pos_purchases WHERE purchase_id=?', op).n,
    lines: f.sql('SELECT COUNT(*) n FROM pos_purchase_lines WHERE purchase_id=?', op).n,
    inventory: f.sql("SELECT COUNT(*) n FROM canonical_inventory_operations WHERE operation_id=? OR operation_id LIKE ? || ':%'", op, op).n,
    revisions: f.sql('SELECT COUNT(*) n FROM canonical_expense_revisions WHERE operation_id=?', op).n,
  });
  const leaked = () => f.sql('SELECT (SELECT COUNT(*) FROM canonical_assertions)+(SELECT COUNT(*) FROM canonical_write_guards) n').n;
  return { f, post, purchase, stock, rows, leaked, expenseRevision,
    arm: (op) => { armed = { match: HEADER_INSERT, inject: expenseRevision(op) }; },
    armedLeft: () => armed, headerPrepared: () => headerPrepared };
}

const crossed = (res) => {
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.deepEqual([res.body.error, res.body.conflict, res.body.ledger], ['operation_id_conflict', 'cross_ledger', 'expense_revision']);
};

for (const mode of ['d1', 'turso']) {
  test(`${mode}: purchase header loses the race to an expense revision with the same id -> 409, nothing applied`, async (t) => {
    const x = await fixture(t, mode);
    const before = x.stock();
    const op = 'PUR-race-' + mode;
    x.arm(op);
    const res = await x.post(x.purchase(op));
    assert.equal(x.armedLeft(), null, 'the injection ran between the claim read and the header batch');
    crossed(res);
    assert.deepEqual(x.rows(op), { header: 0, lines: 0, inventory: 0, revisions: 1 });
    assert.deepEqual(x.stock(), before, 'no stock moved');
    assert.equal(x.leaked(), 0, 'no assertion or guard rows left behind');
    // A fresh id still goes through (fence leaves nothing that blocks later purchases).
    const ok = await x.post(x.purchase('PUR-ok-' + mode));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal((await x.post(x.purchase('PUR-ok-' + mode))).body.status, 'already_processed');
  });

  test(`${mode}: purchase whose id another ledger already owns -> 409 cross_ledger, nothing applied`, async (t) => {
    const x = await fixture(t, mode);
    const before = x.stock();
    const op = 'PUR-taken-' + mode;
    x.expenseRevision(op)();
    const prepared = x.headerPrepared();
    crossed(await x.post(x.purchase(op)));
    assert.deepEqual(x.rows(op), { header: 0, lines: 0, inventory: 0, revisions: 1 });
    assert.deepEqual(x.stock(), before);
    assert.equal(x.leaked(), 0);
    // Which line stopped it (no assertion: either is correct; the pre-check avoids the write attempt).
    t.diagnostic('stopped by ' + (x.headerPrepared() === prepared ? 'pre-check (no header batch attempted)' : 'atomic fence (header batch attempted and aborted)'));
  });
}
