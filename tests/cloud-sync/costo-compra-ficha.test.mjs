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
  assert.deepEqual(plain(sent[0]), { product_id: 'p1', expected_metadata_revision: 3, name: 'Aceite', sku: 'A-1', barcode: '775', alternate_codes: ['X-1', 'a-1'],
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
  assert.equal(t.sent[0].cost_cents, 368, 'promedio: 10×3.00 previas + 5×4.20 + 5×4.50 de la compra recién registrada = 3.675');
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

test('un ajuste ENTRADA de #856 con costo nunca cuenta como compra (ni última ni promedio)', async () => {
  const reason = 'ajuste:v1:' + JSON.stringify({ t: 'correccion', u: { n: 'Compra · "Ana" | 1', i: 'C-1' }, n: 'compra mal contada' });
  const moves = [
    { id: 'c1', productId: 'p9', type: 'ENTRADA', delta: 4, reason: 'Compra proveedor', unit_cost_cents: 200, timestamp: '2026-10-01T10:00:00Z' },
    { id: 'a1', productId: 'p9', type: 'ENTRADA', delta: 100, reason, source: 'ADJUSTMENT', unit_cost_cents: 9999, timestamp: '2026-10-20T10:00:00Z' },
    { operation_id: 'a2', product_id: 'p9', movement_type: 'ENTRADA', quantity: 100, reason, unit_cost_cents: 9999, created_at: '2026-10-21T10:00:00Z' }
  ];
  const s = await context({ inventoryMovements: moves }).NA_COSTO_COMPRA_FICHA.summaryFor('p9');
  assert.equal(s.lastPurchase.unitCostCents, 200);
  assert.equal(s.weightedUnitCostCents, 200);
  assert.equal(api.lastCosted([{ unitCostCents: 5, timestamp: 2 }, { unitCostCents: null, timestamp: 9 }]).unitCostCents, 5);
});

test('product.update: se envían exactamente los campos que el Worker reescribe, idénticos salvo cost_cents', () => {
  const products = read('tools/cloudflare-lab/src/a6-products.js');
  const fields = products.match(/const UPDATE_FIELDS = \[([\s\S]*?)\];/)[1].match(/'([a-z_]+)'/g).map(x => x.slice(1, -1));
  const envelope = ['operation_id', 'promotion_id', 'authority_epoch', 'expected_control_revision', 'client_contract', 'created_at']; // los pone canonical-client
  const raw = { product_id: 'p1', metadata_revision: 7, name: 'Leche', sku: 'L-1', barcode: null, alternate_codes_json: '["Z-1","z-2"]', legacy_alternate_code: 'OLD',
    category: 'lacteos', brand: '', description: 'Entera', icon: '🥛', cost_cents: 300, price_cents: 450, box_price_cents: null, units_per_box: null, stock_min_quantity: 3, expiry_date: '2026-12-01',
    image: 'img://x', tracks_inventory: 1, unit: 'unidad', tax_type: 'gravado', current_stock_quantity: 12, activo: true };
  const sent = plain(api.updatePayload(raw, 333));
  assert.deepEqual(Object.keys(sent).sort(), fields.filter(f => !envelope.includes(f)).sort());
  const map = { expected_metadata_revision: 'metadata_revision', alternate_codes: 'alternate_codes_json' };
  for (const k of Object.keys(sent)) {
    if (k === 'cost_cents') { assert.equal(sent[k], 333); continue; }
    const want = k === 'alternate_codes' ? JSON.parse(raw.alternate_codes_json) : raw[map[k] || k];
    assert.deepEqual(sent[k], want, k);
  }
  for (const k of ['image', 'tracks_inventory', 'unit', 'tax_type', 'current_stock_quantity', 'activo', 'legacy_alternate_code']) assert.ok(!(k in sent), k + ' no viaja');
  assert.doesNotMatch(read('tools/cloudflare-lab/src/a6-canonical.js').match(/PRODUCT_REVISION_FIELDS=\[[^\]]*\]/)[0], /image|tracks_inventory|unit'|tax_type|stock_quantity/);
});

test('CANON: el historial queda como «Compra» con ref (recordPurchase) y la actualización no agrega «Ficha»', async () => {
  const { ctx, sent } = canonCtx();
  ctx.NA_ROLES = { isOwner: () => true, label: 'Ana', deviceId: 'dev-1' };
  ctx.NA_PERMISSIONS = Object.assign({}, ctx.NA_PERMISSIONS, { featureLocked: id => id !== 'historial-precios-producto' }); // CM-162: candado abierto
  vm.runInContext(read('POS/js/products/price-history.js'), ctx);
  ctx.productos = [{ id: 'p1', costo: 4 }, { id: 'p2', costo: 0.5 }];
  ctx.NA_PRICE_HISTORY.recordPurchase('PUR-7', lines, applied); // lo que hace submit antes del gancho
  await ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-7', lines, applied);
  assert.equal(sent.length, 2);
  const all = Object.values(JSON.parse(ctx.localStorage.getItem('na_price_history_v1'))).flat();
  assert.deepEqual(plain(all.map(e => [e.type, e.origin, e.ref, e.after]).sort()), [['costo', 'compra', 'PUR-7:1:costo', 4.2], ['costo', 'compra', 'PUR-7:2:costo', 4.5], ['costo', 'compra', 'PUR-7:3:costo', 0.7]]);
  assert.ok(!all.some(e => e.origin === 'ficha'));
});

// Servidor sintético con concurrencia optimista igual que a6-products.js (409 stale_product).
function twoDevices({ bEdits = 1 } = {}) {
  const server = { product_id: 'p1', metadata_revision: 3, name: 'Aceite', sku: 'A-1', barcode: null, alternate_codes_json: '[]', category: null, brand: null,
    description: null, icon: null, cost_cents: 400, price_cents: 600, box_price_cents: null, units_per_box: null, stock_min_quantity: 0, expiry_date: null, image: 'img://keep' };
  let replica = { ...server }, pending = null, edits = 0;
  const deviceBChangesPrice = () => { server.price_cents += 100; server.metadata_revision++; };
  const client = { enabled: () => true,
    snapshot: () => ({ products: [replica], inventoryMovements: [] }),
    // B cambia el precio justo después de que A refresca (A queda con revisión vieja).
    refresh: async () => { replica = { ...server }; if (edits < bEdits) { edits++; deviceBChangesPrice(); } },
    pendingSnapshot: () => pending,
    discardRejectedProduct: async () => { if (pending && pending.last_error === 'stale_product') { pending = null; return true; } return false; },
    updateProduct: async b => {
      pending = { command: 'product.update', last_status: 409, last_error: null, payload: { product_id: b.product_id } }; // como el journal real
      if (b.expected_metadata_revision !== server.metadata_revision) { pending.last_error = 'stale_product'; throw new Error('stale_product'); }
      Object.assign(server, { name: b.name, price_cents: b.price_cents, cost_cents: b.cost_cents, metadata_revision: server.metadata_revision + 1 }); pending = null; return { ok: true };
    } };
  const warnings = [];
  const ctx = context({ NA_ROLES: { isOwner: () => true }, localStorage: store(), NuevoAmanecerCanonical: client, toast: (m, k) => warnings.push([m, k]) });
  return { ctx, server, warnings };
}
const one = [{ line: 1, product_id: 'p1', quantity: 2, unit_cost_cents: 450 }];

test('Worker: product.update rechaza una revisión vieja (409 stale_product) y nuestro payload la envía', () => {
  const products = read('tools/cloudflare-lab/src/a6-products.js');
  assert.match(products, /if \(Number\(state\.metadata_revision\)!==body\.expected_metadata_revision\)\s*return json\(\{error:'stale_product'/);
  assert.match(products, /if \(Number\(fresh\.metadata_revision\)!==body\.expected_metadata_revision\)\s*return json\(\{error:'stale_product'/);
  assert.equal(api.updatePayload({ product_id: 'x', metadata_revision: 9, name: 'n', price_cents: 1 }, 1).expected_metadata_revision, 9);
  assert.match(read('tools/cloudflare-lab/src/pos-purchases.js'), /INSERT INTO pos_purchases\(purchase_id,[\s\S]*?\.bind\(b\.operation_id,/, 'el Worker guarda la compra con purchase_id = operation_id');
});

test('dos aparatos: B cambia el precio, la actualización vieja de A se rechaza sin pisar nada y se reintenta una vez con los datos de B', async () => {
  const { ctx, server } = twoDevices({ bEdits: 1 });
  const r = await ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-2', one, { applied: [{ line: 1 }] });
  assert.equal(r.updated.length, 1);
  assert.equal(server.price_cents, 700, 'se conserva el precio de B');
  assert.equal(server.cost_cents, 450);
  assert.equal(server.image, 'img://keep');
});

test('dos aparatos: si vuelve a quedar vieja tras el reintento, no se pisa nada y se avisa', async () => {
  const { ctx, server, warnings } = twoDevices({ bEdits: 5 });
  const r = await ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-3', one, { applied: [{ line: 1 }] });
  assert.deepEqual(plain(r.failed), [{ product_id: 'p1', error: 'stale_product' }]);
  assert.equal(server.cost_cents, 400, 'el costo no cambió');
  assert.equal(server.price_cents, 800, 'solo quedaron los cambios de B');
  assert.equal(warnings.length, 1); assert.match(warnings[0][0], /no se actualizó el costo/);
});

test('promedio: la compra recién registrada no se cuenta dos veces si /auth/purchases ya la trae (por purchase_id u operation_id)', async () => {
  for (const shape of [{ purchase_id: 'PUR-9' }, { purchase_id: 'srv-123', operation_id: 'PUR-9' }]) {
    const listed = { ...shape, status: 'aplicada', created_at: '2026-10-20T10:00:00Z', lines: [{ line_number: 1, product_id: 'p1', quantity: 10, unit_cost_cents: 500 }] };
    const ctx = context({ NA_ROLES: { isOwner: () => true, api: async () => ({ purchases: [listed, { purchase_id: 'PUR-1', status: 'aplicada', created_at: '2026-10-01T10:00:00Z', lines: [{ line_number: 1, product_id: 'p1', quantity: 10, unit_cost_cents: 300 }] }] }) },
      NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => ({ products: [], inventoryMovements: [] }) } });
    const extra = { purchase_id: 'PUR-9', status: 'aplicada', created_at: '2026-10-20T10:00:00Z', lines: [{ line_number: 1, product_id: 'p1', quantity: 10, unit_cost_cents: 500 }] };
    const s = await ctx.NA_COSTO_COMPRA_FICHA.summaryFor('p1', extra);
    assert.equal(s.weightedUnitCostCents, 400, JSON.stringify(shape));
  }
});

// ---- Seguimiento de la revisión de #858 ----
test('costo 0 (regalo), negativo o no finito nunca pone el costo del producto en 0: la línea se omite', async () => {
  const bad = [0, -50, 0.4, NaN, Infinity, -Infinity, 'abc', ''];
  assert.deepEqual(plain([...api.lineCosts(bad.map((c, i) => ({ line: i + 1, product_id: 'p1', unit_cost_cents: c })))]), [], 'ninguna línea mala cuenta');
  // Si el regalo es la última línea del mismo producto, gana la línea anterior con costo.
  assert.deepEqual(plain([...api.lineCosts([{ line: 1, product_id: 'p1', unit_cost_cents: 450 }, { line: 2, product_id: 'p1', unit_cost_cents: 0 }])]), [['p1', 450]]);
  // CANON: una compra con solo el regalo no envía product.update.
  let t = canonCtx();
  let r = await t.ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-G', [{ line: 1, product_id: 'p1', quantity: 1, unit_cost_cents: 0 }], { applied: [{ line: 1 }] });
  assert.equal(t.sent.length, 0); assert.equal(r.updated.length, 0);
  t = canonCtx();
  await t.ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-G', [{ line: 1, product_id: 'p1', quantity: 1, unit_cost_cents: 450 }, { line: 2, product_id: 'p1', quantity: 1, unit_cost_cents: 0 }], { applied: [{ line: 1 }, { line: 2 }] });
  assert.deepEqual(plain(t.sent.map(x => x.cost_cents)), [450]);
  // Local: el regalo no toca productos[].costo ni guarda.
  const productos = [{ id: 'l1', costo: 4 }]; let saves = 0;
  const ctx = context({ NA_ROLES: { isOwner: () => true }, localStorage: store(), productos, saveAllData: async () => { saves++; return { ok: 1 }; }, _naWasPersisted: x => !!x?.ok });
  for (const unitCost of [0, '0', -1, Infinity, 'abc']) {
    r = await ctx.NA_COSTO_COMPRA_FICHA.afterLocalPurchase('OCR-G', { ok: true, applied: [{ sourceIndex: 1, productId: 'l1', quantity: 1, unitCost }] });
    assert.equal(productos[0].costo, 4, 'costo intacto con ' + String(unitCost)); assert.equal(r.updated.length, 0);
  }
  assert.equal(saves, 0);
});

test('un rechazo pendiente de OTRO producto no se descarta: solo se descarta el del mismo product_id', async () => {
  const rejected = { command: 'product.update', state: 'PENDING', last_status: 409, last_error: 'stale_product', payload: { product_id: 'p-otro' } };
  let pending = null, discards = 0;
  const raw = { product_id: 'p1', metadata_revision: 3, name: 'Aceite', cost_cents: 400, price_cents: 600, stock_min_quantity: 0 };
  const client = { enabled: () => true, snapshot: () => ({ products: [raw], inventoryMovements: [] }), refresh: async () => {},
    pendingSnapshot: () => pending,
    discardRejectedProduct: async () => { discards++; pending = null; return true; }, // el real descarta lo que haya en el journal, sin mirar el producto
    updateProduct: async () => { pending = rejected; throw new Error('stale_product'); } };
  const ctx = context({ NA_ROLES: { isOwner: () => true }, localStorage: store(), NuevoAmanecerCanonical: client, toast: () => {} });
  const r = await ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-X', one, { applied: [{ line: 1 }] });
  assert.equal(discards, 0, 'el rechazo de p-otro sigue en el journal');
  assert.equal(pending, rejected);
  assert.deepEqual(plain(r.failed), [{ product_id: 'p1', error: 'stale_product' }]);
  // El mismo caso con el rechazo de p1 sí se descarta (y se reintenta una vez).
  rejected.payload.product_id = 'p1';
  await ctx.NA_COSTO_COMPRA_FICHA.afterCanonPurchase('PUR-Y', one, { applied: [{ line: 1 }] });
  assert.equal(discards, 2, 'un descarte por intento, solo del mismo producto');
});

test('el comentario de cabecera describe la actualización automática (no dice «No guarda nada»)', () => {
  const header = source.slice(0, source.indexOf('(function (root)'));
  assert.doesNotMatch(header, /No guarda nada/);
  assert.match(header, /afterCanonPurchase/); assert.match(header, /afterLocalPurchase/);
  assert.match(header, /autom[aá]ticamente/); assert.match(header, /product\.update/); assert.match(header, /saveAllData/);
});
