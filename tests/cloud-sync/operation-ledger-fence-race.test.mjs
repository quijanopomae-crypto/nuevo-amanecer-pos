// Race between the cross-ledger pre-read and the write (SPEC-885 O-2): another
// command (expense.update/void -> canonical_expense_revisions, which the 0020 and
// 0022 triggers do NOT watch) claims the same operation_id after product.update /
// customer.contact.set pass their pre-read but before their write commits.
// With the in-batch fence the write must abort: 409 operation_id_conflict /
// cross_ledger / expense_revision and none of its rows. No migration. Local only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { tursoSqlite } from './turso-sqlite-protocol.mjs';

// Every migration production has (0014-0034): 0032 adds canonical_expense_revisions, which 0020/0022 do not watch.
const MIGRATIONS = readdirSync(new URL('../../infra/database/migrations/', import.meta.url)).filter((n) => /^00(1[4-9]|[2-9]\d)_/.test(n)).sort();
const PRODUCT = '00001', CUSTOMER = '000C';

async function fixture(t, mode) {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  const real = mode === 'turso' ? tursoSqlite(f.database).adapter : f.env.DB ?? f.env.nuevo_amanecer_lab;
  if (mode === 'turso') f.env.nuevo_amanecer_lab = { prepare() { throw Error('no D1'); } };
  // Injection point: when the command prepares its write, the other ledger
  // commits the same operation_id first (synchronously, straight into SQLite).
  let armed = null;
  f.env.DB = new Proxy(real, { get(target, key) {
    if (key !== 'prepare') { const v = Reflect.get(target, key, target); return typeof v === 'function' ? v.bind(target) : v; }
    return (sql) => {
      if (armed && armed.match.test(sql)) { const a = armed; armed = null; a.inject(); }
      return target.prepare(sql);
    };
  } });
  const tab = await device(f, { token: 'race-token', deviceId: 'race-device' });
  await tab.api.refresh();
  await tab.api.openCash({ session_id: 'cash-race', opening_cents: 10000 });
  await tab.api.refresh();
  await tab.api.createExpense({ amount_cents: 100, concept: 'Gasto sintetico', category: 'otros', payment_method: 'efectivo', expense_date: '2026-10-21', session_id: 'cash-race' });
  await tab.api.refresh();
  const expense = f.sql('SELECT expense_id, promotion_id FROM canonical_expenses LIMIT 1');
  let revision = 0; // what expense.update/void would commit (one revision per injection)
  const expenseRevision = (op) => () => f.database.prepare(`INSERT INTO canonical_expense_revisions
    (operation_id,expense_id,promotion_id,revision,action,request_hash,created_at) VALUES(?,?,?,?,'edit',?,?)`)
    .run(op, expense.expense_id, expense.promotion_id, ++revision, 'b'.repeat(64), '2026-10-21T15:30:00.000Z');
  const post = async (command, body) => {
    const res = await f.fetch('http://localhost/commands/' + command, { method: 'POST', headers: { authorization: 'Bearer race-token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const captured = (command) => JSON.parse(tab.fetchLog.filter((r) => new URL(r.url).pathname === '/commands/' + command).at(-1).body);
  const fresh = (body, op) => { const c = f.control(); return { ...body, operation_id: op, authority_epoch: c.authority_epoch, expected_control_revision: c.revision }; };
  const arm = (match, op) => { armed = { match, inject: expenseRevision(op) }; };
  const leaked = () => f.sql('SELECT (SELECT COUNT(*) FROM canonical_assertions)+(SELECT COUNT(*) FROM canonical_write_guards) n').n;
  return { f, tab, post, captured, fresh, arm, leaked, armedLeft: () => armed };
}

const crossed = (res) => {
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.deepEqual([res.body.error, res.body.conflict, res.body.ledger], ['operation_id_conflict', 'cross_ledger', 'expense_revision']);
};

for (const mode of ['d1', 'turso']) {
  test(`${mode}: product.update loses the race to an expense revision with the same operation_id -> 409, nothing applied`, async (t) => {
    const x = await fixture(t, mode);
    const live = x.tab.api.snapshot().products.find((p) => p.product_id === PRODUCT);
    await x.tab.api.updateProduct({ product_id: live.product_id, name: live.name, sku: live.sku, barcode: live.barcode, alternate_codes: [], category: live.category, brand: live.brand, description: live.description, icon: live.icon, cost_cents: live.cost_cents ?? 0, price_cents: live.price_cents + 1, box_price_cents: null, units_per_box: null, stock_min_quantity: 0, expiry_date: null });
    const first = x.captured('product.update');
    const state = () => x.f.sql('SELECT COALESCE(MAX(revision),0) r, COUNT(*) n FROM canonical_product_revisions WHERE product_id=?', PRODUCT);
    const before = state();
    const op = 'race-product-' + mode;
    x.arm(/INSERT INTO canonical_product_revisions/, op);
    const res = await x.post('product.update', x.fresh({ ...first, expected_metadata_revision: Number(before.r), price_cents: first.price_cents + 5 }, op));
    assert.equal(x.armedLeft(), null, 'the injection ran between pre-read and write');
    crossed(res);
    assert.equal(x.f.sql('SELECT COUNT(*) n FROM canonical_product_revisions WHERE operation_id=?', op).n, 0);
    assert.equal(x.f.sql('SELECT COUNT(*) n FROM canonical_expense_revisions WHERE operation_id=?', op).n, 1);
    assert.deepEqual(state(), before);
    assert.equal(x.leaked(), 0);
    // Own-ledger idempotency is untouched: the first update replays.
    assert.equal((await x.post('product.update', first)).body.status, 'already_processed');
  });

  test(`${mode}: customer.contact.set loses the race to an expense revision with the same operation_id -> 409, nothing applied`, async (t) => {
    const x = await fixture(t, mode);
    await x.tab.api.setCustomerContact({ customer_id: CUSTOMER, name: 'Cliente sintetico uno', phone: null });
    const first = x.captured('customer.contact.set');
    const rev = x.f.sql('SELECT COALESCE(MAX(revision),0) r FROM canonical_customer_contacts WHERE customer_id=?', CUSTOMER).r;
    for (const identity of [false, true]) {
      const op = `race-contact-${mode}-${identity ? 'id' : 'plain'}`;
      x.arm(/INSERT INTO canonical_customer_contacts/, op);
      const body = x.fresh({ ...first, name: 'Cliente sintetico dos', expected_contact_revision: Number(rev), ...(identity ? { document: '12345678', address: 'Jr. Sintetico 1' } : {}) }, op);
      const res = await x.post('customer.contact.set', body);
      assert.equal(x.armedLeft(), null, 'the injection ran between pre-read and write');
      crossed(res);
      assert.equal(x.f.sql('SELECT COUNT(*) n FROM canonical_customer_contacts WHERE operation_id=?', op).n, 0);
      assert.equal(x.f.sql('SELECT COUNT(*) n FROM canonical_customer_identities WHERE operation_id=?', op).n, 0);
      assert.equal(x.f.sql('SELECT COUNT(*) n FROM canonical_expense_revisions WHERE operation_id=?', op).n, 1);
    }
    assert.equal(x.f.sql('SELECT COALESCE(MAX(revision),0) r FROM canonical_customer_contacts WHERE customer_id=?', CUSTOMER).r, rev);
    assert.equal(x.leaked(), 0);
    assert.equal((await x.post('customer.contact.set', first)).body.status, 'already_processed');
  });
}
