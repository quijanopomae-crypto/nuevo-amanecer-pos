// T-03 §4: one operation_id names one command across every canonical ledger.
// sale.create (fast Turso path and normal path, D1 and Turso) must reject an
// operation_id already used by inventory.adjust/expense/cash, and vice versa,
// with 409 operation_id_conflict and no effect. Local, synthetic, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { tursoSqlite } from './turso-sqlite-protocol.mjs';
import { canUseCanonicalSaleFastPath } from '../../tools/cloudflare-lab/src/a6-commerce.js';
import { getDatabase } from '../../tools/cloudflare-lab/src/database-binding.js';
import { OPERATION_LEDGER_TABLES, foreignOperationAssertion, foreignOperationSql } from '../../tools/cloudflare-lab/src/operation-ledgers.js';

const MIGRATIONS = ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql', '0024_pos_roles_owner_pin.sql'];
const MODES = ['d1', 'turso-normal', 'turso-fast'];
const PRODUCT = '00001';

async function fixture(t, mode) {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  if (mode !== 'd1') {
    f.env.DB = tursoSqlite(f.database).adapter;
    f.env.nuevo_amanecer_lab = { prepare() { throw Error('no D1'); } };
  }
  if (mode === 'turso-fast') { f.env.RUNTIME_ENVIRONMENT = 'production'; f.env.CANONICAL_RUNTIME_ENABLED = 'enabled'; }
  const tab = await device(f, { token: 'ns-token', deviceId: 'ns-device' });
  await tab.api.adjustInventory({ product_id: PRODUCT, movement_type: 'ENTRADA', quantity: 20, reason: 'Synthetic namespace stock' });
  await tab.api.refresh();
  await tab.api.openCash({ session_id: 'cash-ns', opening_cents: 10000 });
  const call = async (command, body) => {
    const res = await f.fetch('http://localhost/commands/' + command, { method: 'POST',
      headers: { authorization: 'Bearer ns-token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const common = (operation_id) => { const c = f.control(); return { operation_id, promotion_id: c.active_promotion_id, client_contract: 'a6-gate-c-v1',
    authority_epoch: c.authority_epoch, expected_control_revision: c.revision, created_at: '2026-10-21T15:30:00.000Z' }; };
  const rev = () => f.sql('SELECT stock_revision r FROM products WHERE product_id=?', PRODUCT).r;
  const sale = (op, sale_id, cents = 250) => ({ ...common(op), sale_id, payment_method: 'efectivo', total_cents: cents, session_id: 'cash-ns',
    items: [{ product_id: PRODUCT, quantity: 1, unit_price_cents: cents, line_total_cents: cents, expected_stock_revision: rev() }],
    payment: { cash_cents: cents, digital_cents: 0, credit_cents: 0 } });
  const inventory = (op, type = 'ENTRADA') => ({ ...common(op), product_id: PRODUCT, movement_type: type, quantity: 1, expected_stock_revision: rev(), reason: 'namespace test' });
  const counts = () => ({
    sales: f.sql('SELECT COUNT(*) n FROM sales').n,
    cash_cents: f.sql('SELECT COALESCE(SUM(cash_cents),0) s FROM cash_movements').s,
    inventory_ops: f.sql('SELECT COUNT(*) n FROM canonical_inventory_operations').n,
    stock: f.sql('SELECT current_stock_quantity q, stock_revision r FROM products WHERE product_id=?', PRODUCT),
    guards: f.sql('SELECT COUNT(*) n FROM canonical_write_guards').n,
    assertions: f.sql('SELECT COUNT(*) n FROM canonical_assertions').n,
  });
  return { f, call, sale, inventory, common, counts };
}

for (const mode of MODES) {
  test(`T-03 §4 (${mode}): inventory.adjust first, sale.create with the same operation_id -> 409 operation_id_conflict, nothing applied`, async (t) => {
    const { f, call, sale, inventory, counts } = await fixture(t, mode);
    const first = await call('inventory.adjust', inventory('NS-inv-1'));
    assert.equal(first.status, 201);
    const body = sale('NS-inv-1', 'V-NS-1');
    assert.equal(canUseCanonicalSaleFastPath(body, f.env), mode === 'turso-fast');
    const before = counts();
    const res = await call('sale.create', body);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'operation_id_conflict');
    assert.equal(res.body.conflict, 'cross_ledger');
    assert.equal(res.body.ledger, 'inventory');
    assert.deepEqual(counts(), before, 'no sale, cash, stock or leaked guard');
    assert.equal(before.guards + before.assertions, 0);
  });

  test(`T-03 §4 (${mode}): sale.create first, inventory.adjust with the same operation_id -> 409, stock untouched`, async (t) => {
    const { call, sale, inventory, counts } = await fixture(t, mode);
    { const r = await call('sale.create', sale('NS-sale-1', 'V-NS-2')); assert.equal(r.status, 201, JSON.stringify(r.body)); }
    const before = counts();
    const res = await call('inventory.adjust', inventory('NS-sale-1'));
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'operation_id_conflict');
    assert.deepEqual([res.body.conflict, res.body.ledger], ['cross_ledger', 'sale']);
    assert.deepEqual(counts(), before);
  });

  test(`T-03 §4 (${mode}): identical sale replay stays already_processed; altered replay stays operation_id_conflict`, async (t) => {
    const { call, sale, counts } = await fixture(t, mode);
    const body = sale('NS-sale-2', 'V-NS-3');
    assert.equal((await call('sale.create', body)).status, 201);
    const before = counts();
    const replay = await call('sale.create', body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.status, 'already_processed');
    assert.equal(replay.body.sale_id, 'V-NS-3');
    const altered = await call('sale.create', { ...body, total_cents: 300, items: [{ ...body.items[0], unit_price_cents: 300, line_total_cents: 300 }], payment: { cash_cents: 300, digital_cents: 0, credit_cents: 0 } });
    assert.equal(altered.status, 409);
    assert.equal(altered.body.error, 'operation_id_conflict');
    assert.equal(altered.body.conflict, undefined, 'same-ledger mismatch keeps the plain conflict');
    assert.deepEqual(counts(), before);
  });

  test(`T-03 §4 (${mode}): distinct operation_ids keep working in both orders`, async (t) => {
    const { call, sale, inventory, counts } = await fixture(t, mode);
    const start = counts();
    assert.equal((await call('inventory.adjust', inventory('NS-inv-2'))).status, 201);
    assert.equal((await call('sale.create', sale('NS-sale-3', 'V-NS-4'))).status, 201);
    assert.equal((await call('inventory.adjust', inventory('NS-inv-3', 'SALIDA'))).status, 201);
    assert.equal((await call('sale.create', sale('NS-sale-4', 'V-NS-5'))).status, 201);
    const end = counts();
    assert.equal(end.sales - start.sales, 2);
    assert.equal(end.cash_cents - start.cash_cents, 500);
    assert.equal(end.inventory_ops - start.inventory_ops, 2);
    assert.equal(end.stock.q, start.stock.q - 2);
    assert.equal(end.guards + end.assertions, 0);
  });

  test(`T-03 §4 (${mode}): expense / cash adjustment first, sale with the same operation_id -> explicit operation_id_conflict`, async (t) => {
    const { f, call, sale, common, counts } = await fixture(t, mode);
    const expense = await call('expense.create', { ...common('NS-exp-1'), expense_id: 'G-NS-1', amount_cents: 100, concept: 'ns', category: 'otros', payment_method: 'efectivo', expense_date: '2026-10-21' });
    assert.equal(expense.status, 201, JSON.stringify(expense.body));
    const sessionRevision = f.sql("SELECT revision r FROM canonical_cash_state WHERE session_id='cash-ns'").r;
    const adjustment = await call('adjustment.create', { ...common('NS-adj-1'), session_id: 'cash-ns', expected_session_revision: sessionRevision, amount_cents: 100, reason: 'ns' });
    assert.equal(adjustment.status, 201, JSON.stringify(adjustment.body));
    const before = counts();
    for (const [op, id, ledger] of [['NS-exp-1', 'V-NS-6', 'expense'], ['NS-adj-1', 'V-NS-7', 'financial']]) {
      const res = await call('sale.create', sale(op, id));
      assert.equal(res.status, 409);
      assert.deepEqual([res.body.error, res.body.conflict, res.body.ledger], ['operation_id_conflict', 'cross_ledger', ledger]);
    }
    assert.deepEqual(counts(), before);
  });

  // Restore replay contract (SPEC-restauracion H7/H8): authority -> own-ledger
  // idempotency -> cross-ledger -> CAS. A row in another ledger must never turn an
  // identical replay of the SAME sale into a conflict, and a cross-ledger id must
  // never be reported as stale_* (stale_* means "the operation does not exist").
  test(`T-03 §4 (${mode}): check order — own-ledger replay first, then cross-ledger, then stock CAS`, async (t) => {
    const { f, call, sale, inventory, counts } = await fixture(t, mode);
    const body = sale('NS-order-1', 'V-NS-8');
    assert.equal((await call('sale.create', body)).status, 201);
    // Stock moves on: the retained payload now carries a stale expected_stock_revision.
    assert.equal((await call('inventory.adjust', inventory('NS-order-inv'))).status, 201);
    // Synthetic row in another ledger with the SAME operation_id (cannot happen through the API any more).
    f.exec("INSERT INTO canonical_command_receipts(operation_id,command,request_hash,result_json) VALUES('NS-order-1','freeze','" + 'a'.repeat(64) + "','{}')");
    const before = counts();
    const replay = await call('sale.create', body);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.status, 'already_processed');
    assert.equal(replay.body.sale_id, 'V-NS-8');
    const altered = await call('sale.create', { ...body, sale_id: 'V-NS-9' });
    assert.deepEqual([altered.status, altered.body.error, altered.body.conflict], [409, 'operation_id_conflict', undefined]);
    // A new sale whose id lives only in another ledger AND whose stock revision is stale:
    // cross-ledger wins over CAS, so the client quarantines it instead of "retrying fresh".
    f.exec("INSERT INTO canonical_command_receipts(operation_id,command,request_hash,result_json) VALUES('NS-order-2','freeze','" + 'a'.repeat(64) + "','{}')");
    const stale = { ...sale('NS-order-2', 'V-NS-10') };
    stale.items = [{ ...stale.items[0], expected_stock_revision: stale.items[0].expected_stock_revision - 1 }];
    const crossed = await call('sale.create', stale);
    assert.equal(crossed.status, 409);
    assert.deepEqual([crossed.body.error, crossed.body.conflict, crossed.body.ledger], ['operation_id_conflict', 'cross_ledger', 'control']);
    assert.doesNotMatch(crossed.body.error, /^stale_/);
    // Control: same stale payload with a free id is a plain CAS failure.
    const control = await call('sale.create', { ...stale, operation_id: 'NS-order-3', sale_id: 'V-NS-11' });
    assert.equal(control.status, 409);
    assert.match(control.body.error, /^(stale_stock|insufficient_stock)$/);
    assert.deepEqual(counts(), before, 'nothing applied by replay, conflict or CAS failure');
  });
}

test('operation-ledgers: the in-batch fence aborts when another ledger owns the id (race after the pre-read)', async (t) => {
  const { f, call, inventory } = await fixture(t, 'd1');
  assert.equal((await call('inventory.adjust', inventory('NS-race-1'))).status, 201);
  const db = getDatabase(f.env);
  const ledgers = OPERATION_LEDGER_TABLES.filter(name => f.sql("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?", name).n === 1);
  assert.ok(ledgers.includes('canonical_inventory_operations'));
  await assert.rejects(() => db.batch([foreignOperationAssertion(db, 'race:fence', 'NS-race-1', ledgers, ['sales'])]));
  // Own ledger is excluded, and a free id passes; nothing leaks.
  await db.batch([foreignOperationAssertion(db, 'race:own', 'NS-race-1', ledgers, ['canonical_inventory_operations']),
    foreignOperationAssertion(db, 'race:free', 'NS-free-1', ledgers, ['sales']),
    db.prepare("DELETE FROM canonical_assertions WHERE assertion_id LIKE 'race:%'")]);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_assertions').n, 0);
  assert.equal(foreignOperationSql([], ['sales']), '0');
});
