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
const plain = v => JSON.parse(JSON.stringify(v));

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
  const code = source.split('// ---- Actualización automática')[0].replace(/\/\*[\s\S]*?\*\//g, '');
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

// ---- Actualización automática al registrar la compra ----
function store(init = {}) { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }
function canonCtx({ owner = true, raw, mode, fail } = {}) {
  const sent = [];
  const products = [raw || { product_id: 'p1', metadata_revision: 3, name: 'Aceite', sku: 'A-1', barcode: '775', alternate_codes_json: '["X-1","a-1"]', legacy_alternate_code: 'OLD-9',
    category: 'abarrotes', brand: 'Sol', description: null, icon: '🛢️', cost_cents: 400, price_cents: 600, box_price_cents: 6500, units_per_box: 12, stock_min_quantity: 2, expiry_date: null },
    { product_id: 'p2', metadata_revision: 1, name: 'Pan', cost_cents: 50, price_cents: 80, stock_min_quantity: 0 }];
  const ctx = context({ NA_ROLES: { isOwner: () => owner }, localStorage: store(mode ? { na_costo_compra_modo_v1: mode } : {}),
    NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => ({ products, inventoryMovements: [
      { movement_id: 'old', product_id: 'p1', type: 'ENTRADA', reason: 'Compra vieja', quantity: 10, unit_cost_cents: 300, created_at: '2026-10-01T10:00:00Z' }] }),
      updateProduct: async b => { if (fail) throw new Error('CANONICAL_FINANCIAL_PENDING'); sent.push(b); return { ok: true }; }, refresh: async () => {} } });
  return { ctx, sent };
}
const lines = [{ line: 1, product_id: 'p1', quantity: 5, unit_cost_cents: 420 }, { line: 2, product_id: 'p1', quantity: 5, unit_cost_cents: 450 },
  { line: 3, product_id: 'p2', quantity: 5, unit_cost_cents: 70 }, { line: 4, product_id: 'p2', quantity: 1, unit_cost_cents: null }];
const applied = { applied: [{ line: 1 }, { line: 2 }, { line: 3 }, { line: 4 }] };

test('CANON: el dueño actualiza el costo con la ÚLTIMA línea de la compra por product.update, conservando el resto de la ficha', async () => {
  const { ctx, sent } = canonCtx();
  const r = await ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-1', lines, applied);
  assert.deepEqual(plain(r.updated.map(u => [u.product_id, u.before_cents, u.after_cents])), [['p1', 400, 450], ['p2', 50, 70]]);
  assert.deepEqual(plain(sent[0]), { product_id: 'p1', expected_metadata_revision: 3, name: 'Aceite', sku: 'A-1', barcode: '775', alternate_codes: ['X-1', 'OLD-9'],
    category: 'abarrotes', brand: 'Sol', description: null, icon: '🛢️', cost_cents: 450, price_cents: 600, box_price_cents: 6500, units_per_box: 12, stock_min_quantity: 2, expiry_date: null });
});

test('CANON: solo líneas aplicadas; reenvío idempotente y empleado no actualizan nada', async () => {
  let t = canonCtx(); await t.ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-1', lines, { applied: [{ line: 3 }] });
  assert.deepEqual(plain(t.sent.map(x => x.product_id)), ['p2']);
  t = canonCtx(); await t.ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-1', lines, { ...applied, idempotent: true });
  assert.equal(t.sent.length, 0);
  for (const roles of [{ isOwner: () => false }, { isOwner() { throw new Error('x'); } }]) {
    t = canonCtx(); t.ctx.NA_ROLES = roles;
    const r = await t.ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-1', lines, applied);
    assert.equal(t.sent.length, 0); assert.deepEqual(plain(r.skipped), ['not_owner']);
  }
});

test('CANON: promedio solo si el dueño lo eligió; un fallo detiene el resto', async () => {
  let t = canonCtx({ mode: 'promedio' });
  await t.ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-1', lines, applied);
  assert.equal(t.sent[0].cost_cents, 300, 'promedio ponderado de lo registrado');
  t = canonCtx({ fail: true });
  const r = await t.ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-1', lines, applied);
  assert.equal(r.failed.length, 1); assert.equal(r.updated.length, 0);
  const c = canonCtx(); c.ctx.NA_ROLES = { isOwner: () => false };
  assert.equal(c.ctx.NA_COSTO_COMPRA_FICHA.setCostMode('promedio'), false, 'solo el dueño cambia la preferencia');
});

test('modo local: el dueño actualiza productos[].costo, guarda y anota «Compra» en el historial; revierte si no persiste', async () => {
  const productos = [{ id: 'l1', costo: 4 }, { id: 'l2', costo: 1 }], hist = [];
  const result = { ok: true, applied: [{ sourceIndex: 1, productId: 'l1', quantity: 2, unitCost: 4.6 }, { sourceIndex: 2, productId: 'l2', quantity: 1, unitCost: 1 }] };
  const ctx = context({ NA_ROLES: { isOwner: () => true }, localStorage: store(), productos, saveAllData: async () => ({ ok: 1 }), _naWasPersisted: r => !!r?.ok,
    NA_PRICE_HISTORY: { recordDiff: o => hist.push(o) } });
  const r = await ctx.NA_COSTO_COMPRA_FICHA.afterLocalPurchase('OCR-1', result);
  assert.equal(productos[0].costo, 4.6); assert.equal(productos[1].costo, 1);
  assert.deepEqual(plain(hist), [{ productId: 'l1', origin: 'compra', ref: 'OCR-1:1', partial: true, before: { costo: 4 }, after: { costo: 4.6 } }]);
  assert.equal(r.updated.length, 1);
  ctx.saveAllData = async () => ({ ok: 0 }); productos[0].costo = 4; hist.length = 0;
  const f = await ctx.NA_COSTO_COMPRA_FICHA.afterLocalPurchase('OCR-2', result);
  assert.equal(productos[0].costo, 4); assert.equal(hist.length, 0); assert.equal(f.failed.length, 1);
  ctx.NA_ROLES = { isOwner: () => false }; ctx.saveAllData = async () => ({ ok: 1 });
  await ctx.NA_COSTO_COMPRA_FICHA.afterLocalPurchase('OCR-3', result);
  assert.equal(productos[0].costo, 4, 'empleado no cambia el costo');
});

test('los flujos de Compras llaman a la actualización después de confirmar la compra', () => {
  const client = read('POS/js/config/pos-purchases-client.js');
  const submit = client.slice(client.indexOf('async function submit'), client.indexOf('function overlay'));
  assert.ok(submit.indexOf('afterCanonPurchase(operationId, lines, out)') > submit.indexOf("R.api('/auth/purchases'"), 'después del POST confirmado');
  assert.ok(submit.indexOf('afterCanonPurchase') > submit.indexOf('recordPurchase(operationId, lines, out)'));
  const ocr = read('POS/js/ocr/ocr-purchase-integration.js');
  assert.match(ocr, /if \(!canonicalOn\) \{ try \{ if \(root && root\.NA_COSTO_COMPRA_FICHA[^\n]*afterLocalPurchase\(currentBatch\.operationId, result\)/);
  assert.ok(ocr.indexOf('afterLocalPurchase') > ocr.indexOf('if (!result || !result.ok)'));
});
