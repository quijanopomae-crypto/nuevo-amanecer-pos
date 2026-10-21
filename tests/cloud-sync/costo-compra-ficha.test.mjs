import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Misión 2: costo de compra en la ficha. Datos sintéticos.
const read = p => readFileSync(p, 'utf8');
const source = read('POS/js/products/costo-compra-ficha.js');
function context(extra = {}) {
  const ctx = vm.createContext(extra);
  vm.runInContext(read('POS/js/inventory/historial-compras.js'), ctx);
  vm.runInContext(source, ctx);
  return ctx;
}
const api = context().NA_COSTO_COMPRA_FICHA;

test('elige la última compra con costo por defecto y el promedio solo si se pide', async () => {
  const moves = [
    { id: 'm1', productId: 'p1', type: 'ENTRADA', delta: 10, reason: 'Compra A', unit_cost_cents: 300, timestamp: '2026-10-01T10:00:00Z' },
    { id: 'm2', productId: 'p1', type: 'ENTRADA', delta: 10, reason: 'Compra B', unit_cost_cents: 450, timestamp: '2026-10-10T10:00:00Z' },
    { id: 'm3', productId: 'p1', type: 'ENTRADA', delta: 5, reason: 'Compra sin costo', timestamp: '2026-10-12T10:00:00Z' },
    { id: 'm4', productId: 'p1', type: 'ENTRADA', delta: 50, reason: 'ajuste:v1:{"t":"correccion","u":{"n":"A"}}', unit_cost_cents: 1, timestamp: '2026-10-13T10:00:00Z' }
  ];
  const ctx = context({ inventoryMovements: moves });
  const s = await ctx.NA_COSTO_COMPRA_FICHA.summaryFor('p1');
  assert.equal(s.lastPurchase.unitCostCents, 450, 'la compra sin costo y el ajuste no cuentan');
  assert.equal(api.pick(s, 'ultima'), 4.5);
  assert.equal(api.pick(s, undefined), 4.5);
  assert.equal(api.pick(s, 'promedio'), 3.75);
  assert.equal(api.pick({ lastPurchase: null, weightedUnitCostCents: null }, 'ultima'), null);
});

test('margen recalculado igual que calcMargen ((venta-costo)/costo)', () => {
  assert.equal(api.margin(4.5, 6), 33.3);
  assert.equal(api.margin(0, 6), null);
});

test('solo dueño: isOwner en try/catch; sin permiso no llena el costo', () => {
  for (const roles of [undefined, { isOwner: () => false }, { isOwner() { throw new Error('x'); } }]) {
    const input = { value: '4.00' };
    const ctx = context({ NA_ROLES: roles, document: { getElementById: id => (id === 'pCosto' ? input : null), querySelector: () => null } });
    assert.equal(ctx.NA_COSTO_COMPRA_FICHA.apply('ultima', { lastPurchase: { unitCostCents: 999 } }), false);
    assert.equal(input.value, '4.00');
  }
  let calls = 0; const input = { value: '4.00' };
  const ctx = context({ NA_ROLES: { isOwner: () => true }, calcMargen: () => { calls++; }, document: { getElementById: id => (id === 'pCosto' ? input : null), querySelector: () => null } });
  assert.equal(ctx.NA_COSTO_COMPRA_FICHA.apply('ultima', { lastPurchase: { unitCostCents: 455 } }), true);
  assert.equal(input.value, '4.55'); assert.equal(calls, 1);
});

test('no guarda por su cuenta ni toca ventas, pagos o stock; sin innerHTML', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /innerHTML|updateProduct|saveProd|saveAllData|fetch\s*\(|\bventas\b|\bcajMovs\b|\.stock\s*=/);
});

test('servidor: el costo de la ficha se guarda por product.update (solo dueño) y no se revierte; las compras no reescriben el costo', () => {
  const worker = read('tools/cloudflare-lab/src/worker.js'), products = read('tools/cloudflare-lab/src/a6-products.js');
  const canonical = read('tools/cloudflare-lab/src/a6-canonical.js'), purchases = read('tools/cloudflare-lab/src/pos-purchases.js');
  assert.match(worker, /financialCommand === 'product\.update'\) \{\s*const gated = await ownerGate/);
  assert.match(products, /const UPDATE_FIELDS = \[[\s\S]*'cost_cents'/);
  assert.match(canonical, /PRODUCT_REVISION_FIELDS=\[[^\]]*'cost_cents'/, 'la revisión más reciente gana en la réplica');
  assert.doesNotMatch(purchases, /UPDATE\s+products[^;]*cost_cents/i);
  const bridge = read('POS/js/sync/canonical-product-bridge.js');
  assert.match(bridge, /cost_cents: input\.cost_cents/);
  assert.match(bridge, /recordFichaPrice\(id, legacy, input\)/);
});
