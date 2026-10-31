// One operation_id = one command across ALL canonical write modules (follow-up to
// T-03 §4). inventory.adjust vs adjustment.create / expense.create / product.create /
// customer.create / credit-account.create, both orders: 409 operation_id_conflict with
// conflict:'cross_ledger' + ledger, nothing applied; identical replays stay
// already_processed. Local, synthetic, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { tursoSqlite } from './turso-sqlite-protocol.mjs';

const MIGRATIONS = ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql', '0017_canonical_live_customers.sql', '0018_canonical_customer_credit_policy.sql', '0024_pos_roles_owner_pin.sql'];
const PRODUCT = '00001';

async function fixture(t, mode) {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  if (mode === 'turso') {
    f.env.DB = tursoSqlite(f.database).adapter;
    f.env.nuevo_amanecer_lab = { prepare() { throw Error('no D1'); } };
  }
  const tab = await device(f, { token: 'ol-token', deviceId: 'ol-device' });
  await tab.api.adjustInventory({ product_id: PRODUCT, movement_type: 'ENTRADA', quantity: 20, reason: 'Synthetic ledger stock' });
  await tab.api.refresh();
  await tab.api.openCash({ session_id: 'cash-ol', opening_cents: 10000 });
  await tab.api.refresh();
  const call = async (command, body) => {
    const res = await f.fetch('http://localhost/commands/' + command, { method: 'POST',
      headers: { authorization: 'Bearer ol-token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const common = (operation_id) => { const c = f.control(); return { operation_id, promotion_id: c.active_promotion_id, client_contract: 'a6-gate-c-v1',
    authority_epoch: c.authority_epoch, expected_control_revision: c.revision, created_at: '2026-10-21T15:30:00.000Z' }; };
  const rev = () => f.sql('SELECT stock_revision r FROM products WHERE product_id=?', PRODUCT).r;
  const sessionRev = () => f.sql("SELECT revision r FROM canonical_cash_state WHERE session_id='cash-ol'").r;
  const bodies = {
    'inventory.adjust': (op) => ({ ...common(op), product_id: PRODUCT, movement_type: 'ENTRADA', quantity: 1, expected_stock_revision: rev(), reason: 'ledger test' }),
    'adjustment.create': (op) => ({ ...common(op), session_id: 'cash-ol', expected_session_revision: sessionRev(), amount_cents: 100, reason: 'ledger test' }),
    'expense.create': (op, n = 1) => ({ ...common(op), expense_id: 'G-OL-' + op, amount_cents: 100 + n, concept: 'ledger test', category: 'otros', payment_method: 'efectivo', expense_date: '2026-10-21' }),
  };
  // Commands whose body the real client builds: capture its last POST and reuse it.
  const captured = (command) => JSON.parse(tab.fetchLog.filter((r) => new URL(r.url).pathname === '/commands/' + command).at(-1).body);
  const counts = () => ({
    stock: f.sql('SELECT current_stock_quantity q, stock_revision r FROM products WHERE product_id=?', PRODUCT),
    inventory_ops: f.sql('SELECT COUNT(*) n FROM canonical_inventory_operations').n,
    financial_ops: f.sql('SELECT COUNT(*) n FROM canonical_financial_operations').n,
    expense_ops: f.sql('SELECT COUNT(*) n FROM canonical_expense_operations').n,
    product_ops: f.sql('SELECT COUNT(*) n FROM canonical_product_operations').n,
    customer_ops: f.sql('SELECT COUNT(*) n FROM canonical_customer_operations').n,
    credit_accounts: f.sql('SELECT COUNT(*) n FROM canonical_credit_accounts').n,
    cash: f.sql("SELECT expected_cents e, revision r FROM canonical_cash_state WHERE session_id='cash-ol'"),
    leaked: f.sql('SELECT (SELECT COUNT(*) FROM canonical_write_guards)+(SELECT COUNT(*) FROM canonical_assertions) n').n,
  });
  return { f, tab, call, bodies, captured, counts };
}

const crossed = (res, ledger) => {
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.deepEqual([res.body.error, res.body.conflict, res.body.ledger], ['operation_id_conflict', 'cross_ledger', ledger]);
  assert.doesNotMatch(res.body.error, /^stale_/);
};

for (const mode of ['d1', 'turso']) {
  for (const [command, ledger] of [['adjustment.create', 'financial'], ['expense.create', 'expense']]) {
    test(`ledgers (${mode}): inventory -> ${command} and ${command} -> inventory with the same id are 409 cross_ledger; replays stay already_processed`, async (t) => {
      const { call, bodies, counts } = await fixture(t, mode);
      const inv = bodies['inventory.adjust']('OL-inv-' + command);
      assert.equal((await call('inventory.adjust', inv)).status, 201);
      let before = counts();
      crossed(await call(command, bodies[command]('OL-inv-' + command)), 'inventory');
      assert.deepEqual(counts(), before, 'nothing applied');

      const own = bodies[command]('OL-own-' + command);
      assert.equal((await call(command, own)).status, 201);
      before = counts();
      crossed(await call('inventory.adjust', bodies['inventory.adjust']('OL-own-' + command)), ledger);
      // Identical replays of both originals: own ledger first, never the cross check.
      const replayOwn = await call(command, own);
      assert.deepEqual([replayOwn.status, replayOwn.body.status], [200, 'already_processed']);
      const replayInv = await call('inventory.adjust', inv);
      assert.deepEqual([replayInv.status, replayInv.body.status], [200, 'already_processed']);
      assert.deepEqual(counts(), before);
      assert.equal(before.leaked, 0);
    });
  }

  test(`ledgers (${mode}): product.create / customer.create / credit-account.create vs inventory, both orders`, async (t) => {
    const { f, tab, call, bodies, captured, counts } = await fixture(t, mode);
    // Real client bodies, created once each.
    await tab.api.createProduct({ product_id: 'OL-P1', name: 'Producto OL', sku: 'OL-P1-SKU', barcode: 'OL-P1-BAR', alternate_codes: [], category: 'abarrotes', brand: 'Sintetica', description: null, icon: '📦', image: null, unit: 'unidad', purchase_unit: 'unidad', purchase_factor: 1, cost_cents: 60, price_cents: 100, box_price_cents: null, units_per_box: null, initial_stock_quantity: 5, stock_min_quantity: 0, expiry_date: null, includes_igv: true, tax_type: 'gravado', complementary_tax: '', tracks_inventory: true });
    const product = captured('product.create');
    await tab.api.refresh();
    await tab.api.createCustomer({ customer_id: 'OL-C1', name: 'Cliente OL', document: '44556677', phone: null, address: null, color: 1 });
    const customer = captured('customer.create');
    await tab.api.refresh();
    await tab.api.createCreditAccount({ customer_id: 'OL-C1', account_id: 'ol-acc', name: 'Cuenta OL', mode: 'separate' });
    const account = captured('credit-account.create');
    await tab.api.refresh();

    // X -> inventory (reverse direction): 409 naming X's ledger.
    let before = counts();
    for (const [body, ledger] of [[product, 'product'], [customer, 'customer'], [account, 'credit_account']])
      crossed(await call('inventory.adjust', bodies['inventory.adjust'](body.operation_id)), ledger);
    assert.deepEqual(counts(), before);

    // inventory -> X: the inventory id reused by a fresh product / customer / account.
    const inv = bodies['inventory.adjust']('OL-inv-x');
    assert.equal((await call('inventory.adjust', inv)).status, 201);
    before = counts();
    crossed(await call('product.create', { ...product, operation_id: 'OL-inv-x', product_id: 'OL-P2', sku: 'OL-P2-SKU', barcode: 'OL-P2-BAR' }), 'inventory');
    crossed(await call('customer.create', { ...customer, operation_id: 'OL-inv-x', customer_id: 'OL-C2', document: '99887766' }), 'inventory');
    crossed(await call('credit-account.create', { ...account, operation_id: 'OL-inv-x', account_id: 'ol-acc-2', name: 'Cuenta OL 2' }), 'inventory');
    assert.deepEqual(counts(), before, 'no product, customer or account created');

    // Identical replays keep their own receipt.
    for (const [command, body] of [['product.create', product], ['customer.create', customer], ['credit-account.create', account]]) {
      const res = await call(command, body);
      assert.deepEqual([res.status, res.body.status], [200, 'already_processed'], command + ' ' + JSON.stringify(res.body));
    }
    // Distinct ids still work everywhere.
    assert.equal((await call('product.create', { ...product, operation_id: 'OL-free-p', product_id: 'OL-P3', sku: 'OL-P3-SKU', barcode: 'OL-P3-BAR' })).status, 201);
    assert.equal((await call('inventory.adjust', bodies['inventory.adjust']('OL-free-i'))).status, 201);
    assert.equal(f.sql('SELECT (SELECT COUNT(*) FROM canonical_write_guards)+(SELECT COUNT(*) FROM canonical_assertions) n').n, 0);
  });

  test(`ledgers (${mode}): cross-ledger is reported before CAS (stale_session/stale_stock) so restore replay quarantines it`, async (t) => {
    const { f, call, bodies, counts } = await fixture(t, mode);
    assert.equal((await call('inventory.adjust', bodies['inventory.adjust']('OL-order'))).status, 201);
    const stale = { ...bodies['adjustment.create']('OL-order'), expected_session_revision: 9999 };
    crossed(await call('adjustment.create', stale), 'inventory');
    const control = await call('adjustment.create', { ...stale, operation_id: 'OL-order-free' });
    assert.deepEqual([control.status, control.body.error], [409, 'stale_session']);
    assert.equal((await call('adjustment.create', bodies['adjustment.create']('OL-adj'))).status, 201);
    const staleInv = { ...bodies['inventory.adjust']('OL-adj'), expected_stock_revision: 0 };
    crossed(await call('inventory.adjust', staleInv), 'financial');
    assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_assertions').n, 0);
  });
}
