// Delta 3b (optional): the /auth/purchases header (pos_purchases.purchase_id) is a
// ledger. A sale may not reuse a purchase header id, and a purchase may not reuse
// a sale id: 409 operation_id_conflict / cross_ledger, nothing applied. Before 3b
// both were accepted (no double money/stock effect, but two commands with one id).
// d1 and a long-lived turso adapter (fast sale). Synthetic data; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { tursoSqlite } from './turso-sqlite-protocol.mjs';
import { canUseCanonicalSaleFastPath } from '../../tools/cloudflare-lab/src/a6-commerce.js';
import { OPERATION_LEDGER_TABLES } from '../../tools/cloudflare-lab/src/operation-ledgers.js';

const ALL = readdirSync(new URL('../../infra/database/migrations/', import.meta.url)).filter((n) => /^00(1[4-9]|[2-9]\d)_/.test(n)).sort();
const PRODUCT = '00001';

async function shop(t, mode) {
  const f = await activeCanon(t, { migrations: ALL });
  let turso = null;
  if (mode === 'turso') {
    turso = tursoSqlite(f.database);
    f.env.DB = turso.adapter;
    f.env.nuevo_amanecer_lab = { prepare() { throw Error('no D1'); } };
    f.env.RUNTIME_ENVIRONMENT = 'production';
    f.env.CANONICAL_RUNTIME_ENABLED = 'enabled';
  }
  const tab = await device(f, { token: 'ph-token', deviceId: 'ph-device' });
  await tab.api.adjustInventory({ product_id: PRODUCT, movement_type: 'ENTRADA', quantity: 20, reason: 'stock sintetico' });
  await tab.api.refresh();
  await tab.api.openCash({ session_id: 'cash-ph', opening_cents: 10000 });
  await tab.api.refresh();
  const post = async (path, body) => {
    const before = turso ? turso.calls.length : 0;
    const r = await f.fetch('http://localhost' + path, { method: 'POST', headers: { authorization: 'Bearer ph-token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), trips: turso ? turso.calls.length - before : null };
  };
  const common = (op) => { const c = f.control(); return { operation_id: op, promotion_id: c.active_promotion_id, client_contract: 'a6-gate-c-v1', authority_epoch: c.authority_epoch, expected_control_revision: c.revision, created_at: '2026-10-21T15:30:00.000Z' }; };
  const stock = () => f.sql('SELECT current_stock_quantity q, stock_revision r FROM products WHERE product_id=?', PRODUCT);
  const sale = (op, cents = 250) => ({ ...common(op), sale_id: 'V-' + op, payment_method: 'efectivo', total_cents: cents, session_id: 'cash-ph',
    items: [{ product_id: PRODUCT, quantity: 1, unit_price_cents: cents, line_total_cents: cents, expected_stock_revision: stock().r }],
    payment: { cash_cents: cents, digital_cents: 0, credit_cents: 0 } });
  const purchase = (op) => ({ ...common(op), supplier: 'Proveedor sintetico', document_ref: 'F-001', lines: [{ line: 1, product_id: PRODUCT, quantity: 2, unit_cost_cents: 100 }] });
  const rows = (op) => ({ sales: f.sql('SELECT COUNT(*) n FROM sales WHERE operation_id=?', op).n,
    purchases: f.sql('SELECT COUNT(*) n FROM pos_purchases WHERE purchase_id=?', op).n,
    lines: f.sql("SELECT COUNT(*) n FROM canonical_inventory_operations WHERE operation_id LIKE ? || ':%'", op).n });
  return { f, post, sale, purchase, rows, stock, fast: canUseCanonicalSaleFastPath(sale('probe'), f.env) };
}

const crossed = (res, ledger) => {
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.deepEqual([res.body.error, res.body.conflict, res.body.ledger], ['operation_id_conflict', 'cross_ledger', ledger]);
};

test('pos_purchases is the 14th ledger', () => {
  assert.equal(OPERATION_LEDGER_TABLES.length, 14);
  assert.equal(OPERATION_LEDGER_TABLES.at(-1), 'pos_purchases');
});

for (const mode of ['d1', 'turso']) {
  test(`${mode}: a sale reusing a purchase header id -> 409 cross_ledger/purchase, nothing applied`, async (t) => {
    const x = await shop(t, mode);
    assert.equal(x.fast, mode === 'turso');
    const P = `PUR-ph-${mode}`;
    const p = await x.post('/auth/purchases', x.purchase(P));
    assert.equal(p.status, 201, JSON.stringify(p.body));
    if (mode === 'turso') t.diagnostic('purchase POST trips ' + p.trips);
    const stockAfterPurchase = x.stock().q;
    assert.deepEqual(x.rows(P), { sales: 0, purchases: 1, lines: 1 });
    crossed(await x.post('/commands/sale.create', x.sale(P)), 'purchase');
    assert.deepEqual(x.rows(P), { sales: 0, purchases: 1, lines: 1 });
    assert.equal(x.stock().q, stockAfterPurchase, 'no stock moved by the rejected sale');
    assert.equal(x.f.sql('SELECT COUNT(*) n FROM canonical_assertions').n + x.f.sql('SELECT COUNT(*) n FROM canonical_write_guards').n, 0);
    // Own idempotency untouched.
    assert.equal((await x.post('/auth/purchases', x.purchase(P))).body.status, 'already_processed');
    // A fresh id still sells.
    assert.equal((await x.post('/commands/sale.create', x.sale(`ok-${mode}`))).status, 201);
  });

  test(`${mode}: a purchase reusing a sale id -> 409 cross_ledger/sale, no header, no stock`, async (t) => {
    const x = await shop(t, mode);
    const S = `SALE-ph-${mode}`;
    assert.equal((await x.post('/commands/sale.create', x.sale(S))).status, 201);
    const before = x.stock().q;
    crossed(await x.post('/auth/purchases', x.purchase(S)), 'sale');
    assert.deepEqual(x.rows(S), { sales: 1, purchases: 0, lines: 0 });
    assert.equal(x.stock().q, before);
    assert.equal(x.f.sql('SELECT COUNT(*) n FROM canonical_assertions').n, 0);
  });
}
