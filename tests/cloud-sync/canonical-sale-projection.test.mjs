import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../POS/js/sync/canonical-sale-projection.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const context = vm.createContext({ fetch() { throw Error('fetch forbidden'); }, localStorage: { getItem() { throw Error('storage forbidden'); }, setItem() { throw Error('storage forbidden'); } }, document: {}, crypto: { randomUUID() { throw Error('crypto forbidden'); } } });
  vm.runInContext(source, context);
  return context.NuevoAmanecerCanonicalSaleProjection;
}
function intent(id, productId = 'p1', quantity = 1, extra = {}) {
  return { version: 1, operation_id: `op-${id}`, sale_id: `sale-${id}`, created_at: `2026-01-0${id.length}T00:00:00.000Z`, payment_method: 'efectivo', total_cents: 250, payment: { cash_cents: 250, digital_cents: 0, credit_cents: 0, digital_method: null, reference: '' }, items: [{ product_id: productId, quantity, unit_price_cents: 250, line_total_cents: 250, price_label: 'exact' }], ...extra };
}
const base = () => ({ products: [{ id: 'p1', stock: 10 }], customers: [], credits: [{ id: 'remote-credit', amount_cents: 99 }], sales: [] });
const snapshot = (...intents) => ({ version: 1, intents });

test('projects FIFO sales and stock without changing remote stock', () => {
  const result = fixture().project(base(), snapshot(intent('A', 'p1', 2), intent('B', 'p1', 3)));
  assert.equal(result.products[0].stock, 10);
  assert.equal(result.products[0].projected_stock, 5);
  assert.deepEqual(copy(result.sales.map(sale => sale.id)), ['sale-A', 'sale-B']);
});
test('reload and repeated execution serialize byte-identically', () => {
  const input = base(), queue = snapshot(intent('A', 'p1', 2), intent('B', 'p1', 3));
  const first = JSON.stringify(fixture().project(input, queue));
  const second = JSON.stringify(fixture().project(input, queue));
  assert.equal(second, first);
});
test('preserves item price and mixed payment exactly', () => {
  const item = { product_id: 'p1', quantity: 1, unit_price_cents: 247, line_total_cents: 247, discount_cents: 3 };
  const payment = { cash_cents: 100, digital_cents: 147, digital_method: 'yape', reference: 'mix-ref' };
  const result = fixture().project(base(), snapshot(intent('M', 'p1', 1, { items: [item], payment_method: 'mixto', total_cents: 247, payment })));
  assert.deepEqual(copy(result.sales[0].items), [item]);
  assert.deepEqual(copy(result.sales[0].payment), payment);
});
test('projects credit separately and leaves remote credits unchanged', () => {
  const customer = { id: 'c1' }, credit = { ...intent('C', 'p1', 1, { payment_method: 'credito', customer_id: 'c1', credit_due: '2026-12-31' }) };
  const input = { ...base(), customers: [customer] };
  const result = fixture().project(input, snapshot(credit));
  assert.deepEqual(copy(result.credits), [input.credits[0], { id: 'pending:sale-C', sale_id: 'sale-C', customer_id: 'c1', amount_cents: 250, balance_cents: 250, due: '2026-12-31', status: 'PENDING_SYNC', source: 'CANONICAL_OUTBOX' }]);
});
test('marks accumulated stock shortage deterministically', () => {
  const result = fixture().project(base(), snapshot(intent('A', 'p1', 7), intent('B', 'p1', 4)));
  assert.equal(result.sales[0].conflict, false);
  assert.equal(result.sales[1].conflict, true);
  assert.equal(result.sales[1].reason, 'INSUFFICIENT_PROJECTED_STOCK');
  assert.equal(result.products[0].projected_stock, 3);
});
test('missing product conflicts without creating a product', () => {
  const result = fixture().project(base(), snapshot(intent('A', 'missing')));
  assert.equal(result.sales[0].conflict, true);
  assert.equal(result.sales[0].reason, 'PRODUCT_NOT_FOUND');
  assert.equal(result.products.length, 1);
});
test('missing credit customer conflicts without projecting credit', () => {
  const credit = intent('C', 'p1', 1, { payment_method: 'credito', customer_id: 'missing', credit_due: '2026-12-31' });
  const result = fixture().project(base(), snapshot(credit));
  assert.equal(result.sales[0].conflict, true);
  assert.equal(result.sales[0].reason, 'CUSTOMER_NOT_FOUND');
  assert.equal(result.credits.length, 1);
});
test('does not mutate base or snapshot', () => {
  const input = base(), queue = snapshot(intent('A', 'p1', 2));
  const beforeInput = structuredClone(input), beforeQueue = structuredClone(queue);
  fixture().project(input, queue);
  assert.deepEqual(input, beforeInput);
  assert.deepEqual(queue, beforeQueue);
});
test('forbidden side-effect APIs are never invoked', () => {
  const api = fixture();
  api.project(base(), snapshot(intent('A')));
  assert.doesNotMatch(source, /\bfetch\s*\(|\blocalStorage\b|\bdocument\b|\bcrypto\b/);
});
test('invalid or unsupported outbox snapshots fail closed', () => {
  const api = fixture();
  assert.throws(() => api.project(base(), { version: 2, intents: [] }));
  assert.throws(() => api.project(base(), { version: 1, intents: [null] }));
});
