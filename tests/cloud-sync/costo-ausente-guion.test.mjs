// Costo ausente (#884/#886): el servidor omite cost_cents para roles de empleado y la réplica offline
// lo borra. Ausente (undefined/null) NO es 0: se muestra «—» y nunca se guarda 0. Un 0 real se conserva.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const MIGRATIONS = ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql',
  '0017_canonical_live_customers.sql', '0018_canonical_customer_credit_policy.sql', '0020_canonical_customer_contacts.sql', '0022_canonical_product_revisions.sql'];
const BRIDGE = ['canonical-product-bridge.js', read('POS/js/sync/canonical-product-bridge.js')];

function utilsContext() {
  const c = vm.createContext({ console });
  c.window = c;
  vm.runInContext(read('POS/js/core/utils.js'), c);
  return c;
}

test('utils: ausente ≠ 0; 0 real y costo normal se conservan', () => {
  const c = utilsContext();
  for (const absent of [undefined, null, '', '   ', '—']) {
    assert.equal(c._naCostKnown(absent), false, JSON.stringify(absent));
    assert.equal(c._naCostValue(absent), undefined, JSON.stringify(absent));
  }
  assert.equal(c._naCostKnown(Number.NaN), false);
  for (const [value, expected] of [[0, 0], ['0', 0], ['0.00', 0], [1.25, 1.25], ['1,25', 1.25], [-3, 0]]) {
    assert.equal(c._naCostKnown(value), true, JSON.stringify(value));
    assert.equal(c._naCostValue(value), expected, JSON.stringify(value));
  }
  assert.equal(c.NA_COST_ABSENT, '—');
});

test('adaptador CANON: cost_cents ausente queda sin costo; 0 y normal se convierten', () => {
  const c = vm.createContext({ console });
  c.globalThis = c;
  vm.runInContext(read('POS/js/adapters/canonical-ui-adapter.js'), c);
  const A = c.NuevoAmanecerCanonicalUIAdapter;
  const base = { product_id: 'P1', name: 'X', price_cents: 250 };
  assert.equal(A.product({ ...base }).costo, undefined);
  assert.equal(A.product({ ...base, cost_cents: null }).costo, undefined);
  assert.equal(A.product({ ...base, cost_cents: 0 }).costo, 0);
  assert.equal(A.product({ ...base, cost_cents: 125 }).costo, 1.25);
  // La línea de venta CANON toma el costo del producto: ausente sigue ausente (no ganancia = venta).
  const snap = (cost) => A.snapshot({
    authority: 'canonical',
    products: [{ ...base, ...(cost === undefined ? {} : { cost_cents: cost }) }],
    sales: [{ sale_id: 'S1', created_at: '2026-10-21T15:00:00Z', total_cents: 500, payment_method: 'efectivo' }],
    saleItems: [{ sale_id: 'S1', product_id: 'P1', quantity: 2, unit_price_cents: 250, line_total_cents: 500 }],
  });
  const item = (cost) => { const s = snap(cost).sales[0]; return s && s.items && s.items[0]; };
  assert.equal(item(undefined).costo, undefined);
  assert.equal(item(0).costo, 0);
  assert.equal(item(125).costo, 1.25);
});

test('KPI de Ventas y reportes: sin costo la ganancia es «—», con costo 0 o normal es un monto', () => {
  const c = vm.createContext({ console, productos: [], ventas: [], clientes: [], creditos: [], gastos: [], cajMovs: [], ventasRender() {}, _naIsSaleIncomeMove: () => false, _naIsSaleReversalMove: () => false, document: { addEventListener() {}, getElementById() { return null; } } });
  c.window = c;
  vm.runInContext(read('POS/js/core/utils.js'), c);
  vm.runInContext('var totalV=v=>v.total;var _naUnitsSold=i=>i.qty;var _naCategoryLabel=x=>x;', c);
  vm.runInContext(read('POS/js/core/lima-time.js'), c);
  vm.runInContext(read('POS/js/legacy-inline/inline-05.js'), c);
  const sale = (costo) => ({ id: 'v', fecha: '2026-10-21', total: 10, items: [{ id: 1, name: 'P', precio: 5, qty: 2, ...(costo === undefined ? {} : { costo }) }] });
  assert.equal(c._naF8SaleMetrics([sale(undefined)]).gross, null);
  assert.equal(c._naF8SaleMetrics([sale(0)]).gross, 10);
  assert.equal(c._naF8SaleMetrics([sale(3)]).gross, 4);
  // inline-10 pinta null como «—» y no como S/ 0.00.
  const src = read('POS/js/legacy-inline/inline-10.js');
  const fn = src.match(/function _naSecKpiText\(value\)\{[^\n]*\}/)[0];
  vm.runInContext(fn, c);
  assert.equal(c._naSecKpiText(null), '—');
  assert.equal(c._naSecKpiText(0), 'S/ 0.00');
  assert.equal(c._naSecKpiText(4), 'S/ 4.00');
  assert.match(src, /metrics\.gross==null\?null:_naF8Money\(metrics\.gross-operating\)/);
});

const product = (id, extra = {}) => ({ product_id: id, name: 'Prod ' + id, sku: id + '-SKU', barcode: id + '-BAR', alternate_codes: [], category: 'test',
  brand: 'T', description: null, icon: '📦', image: null, unit: 'unidad', purchase_unit: 'unidad', purchase_factor: 1, cost_cents: 100,
  price_cents: 250, box_price_cents: null, units_per_box: null, initial_stock_quantity: 10, stock_min_quantity: 0, expiry_date: null,
  includes_igv: true, tax_type: 'gravado', complementary_tax: '', tracks_inventory: true, ...extra });

// Simula #886: el servidor no envía cost_cents a un empleado en ninguna lectura.
async function scrubCost(_url, opt, real) {
  const res = await real();
  if ((opt.method || 'GET') !== 'GET' || !/json/.test(res.headers.get('content-type') || '')) return res;
  const json = await res.json();
  const strip = (node) => {
    if (Array.isArray(node)) { node.forEach(strip); return; }
    if (!node || typeof node !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(node, 'product_id')) delete node.cost_cents;
    Object.values(node).forEach(strip);
  };
  strip(json);
  return new Response(JSON.stringify(json), { status: res.status, headers: res.headers });
}

function fillForm(tab, legacy) {
  const set = (id, v) => { tab.el(id).value = v == null ? '' : String(v); };
  set('pNombre', legacy.name); set('pSku', legacy.sku); set('pBarcode', legacy.barcode); set('pMarca', legacy.marca);
  set('pUnidad', legacy.unidad); set('pUnidadCompra', legacy.unidadCompra); set('pFactorCompra', legacy.factorCompra);
  set('pCosto', legacy.costo); set('pPrecio', legacy.precio); set('pStock', legacy.stock); set('pStockMin', legacy.stockMin);
  set('pVenc', legacy.venc); set('pIcon', legacy.icon); set('pPrecioCaja', ''); set('pUnidCaja', '');
  set('pCat', legacy.cat); set('pTipoImpuesto', legacy.tipoImpuesto || 'gravado'); set('pImpuestoComplementario', legacy.impuestoComplementario);
  tab.el('pIncluyeIGV').checked = legacy.incluyeIGV !== false; tab.el('pControlInventario').checked = legacy.controlInventario !== false;
}
const updatePosts = (tab) => tab.fetchLog.filter((x) => x.method === 'POST' && /product\.update/.test(x.url)).map((x) => JSON.parse(x.body));
const globals = (id) => ({ invEditId: id, imagenProducto: null, readAltBarcodes: () => [], invRender() {}, posRender() {}, updateDashboard() {}, appConfig: { margenActive: true } });

test('empleado sin costo (#886): la ficha llega vacía, el control bajo costo se omite y product.update NO envía cost_cents', async (t) => {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  const owner = await device(f, { token: 'owner-c', deviceId: 'owner-c' });
  await owner.api.createProduct(product('P-SIN', { cost_cents: 500 })); await owner.api.refresh();
  const tab = await device(f, { token: 'emp-c', deviceId: 'emp-c', scripts: [BRIDGE], globals: globals('P-SIN'), onFetch: scrubCost });
  const raw = tab.api.snapshot().products.find((p) => p.product_id === 'P-SIN');
  assert.equal(raw.cost_cents, undefined, 'la réplica del empleado no trae costo');
  const legacy = tab.api.legacySnapshot().products.find((p) => String(p.id) === 'P-SIN');
  assert.equal(legacy.costo, undefined, 'costo ausente, no 0');
  fillForm(tab, legacy);
  assert.equal(tab.el('pCosto').value, '', 'campo vacío, nunca 0');
  // Precio menor que el costo real (5.00) que el empleado no conoce: el cliente no lo compara contra 0 ni lo bloquea.
  tab.el('pPrecio').value = '3.00';
  await tab.context.NuevoAmanecerCanonicalProductBridge.save();
  assert.ok(!tab.toasts.some(([m]) => /menor al costo|debajo del costo/.test(m)), JSON.stringify(tab.toasts));
  const posts = updatePosts(tab);
  assert.equal(posts.length >= 1, true, 'se intentó product.update');
  for (const body of posts) {
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'cost_cents'), false, 'cost_cents omitido: ' + JSON.stringify(body));
    assert.equal(body.price_cents, 300);
  }
  // El costo del dueño en el servidor no cambió a 0 (lo que el servidor haga con la omisión lo decide el dueño aparte).
  await owner.api.refresh();
  assert.equal(owner.api.snapshot().products.find((p) => p.product_id === 'P-SIN').cost_cents, 500);
});

test('dueño: costo 0 real se envía como 0 y costo normal como centavos; omitir el costo con réplica que sí lo tiene se rechaza', async (t) => {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  const seed = await device(f, { token: 'seed-0', deviceId: 'seed-0' });
  await seed.api.createProduct(product('P-CERO', { cost_cents: 0 })); await seed.api.refresh();
  await seed.api.createProduct(product('P-NORMAL', { cost_cents: 120 })); await seed.api.refresh();
  const zero = await device(f, { token: 'own-0', deviceId: 'own-0', scripts: [BRIDGE], globals: globals('P-CERO') });
  const l0 = zero.api.legacySnapshot().products.find((p) => String(p.id) === 'P-CERO');
  assert.equal(l0.costo, 0, 'un 0 real sigue siendo 0');
  fillForm(zero, l0);
  assert.equal(zero.el('pCosto').value, '0');
  zero.el('pPrecio').value = '2.60';
  assert.equal(await zero.context.NuevoAmanecerCanonicalProductBridge.save(), true, JSON.stringify(zero.toasts));
  assert.equal(updatePosts(zero).at(-1).cost_cents, 0);
  const normal = await device(f, { token: 'own-n', deviceId: 'own-n', scripts: [BRIDGE], globals: globals('P-NORMAL') });
  const ln = normal.api.legacySnapshot().products.find((p) => String(p.id) === 'P-NORMAL');
  assert.equal(ln.costo, 1.2);
  fillForm(normal, ln);
  normal.el('pPrecio').value = '1.00';
  // Con costo conocido el control bajo costo sigue activo.
  assert.equal(await normal.context.NuevoAmanecerCanonicalProductBridge.save(), false);
  assert.match(normal.toasts.at(-1)[0], /menor al costo/);
  normal.el('pPrecio').value = '3.00';
  assert.equal(await normal.context.NuevoAmanecerCanonicalProductBridge.save(), true, JSON.stringify(normal.toasts));
  assert.equal(updatePosts(normal).at(-1).cost_cents, 120);
  // El cliente no permite omitir cost_cents si la réplica sí tiene costo (nunca borra un costo por accidente).
  const raw = normal.api.snapshot().products.find((p) => p.product_id === 'P-NORMAL');
  const before = normal.fetchLog.length;
  await assert.rejects(normal.api.updateProduct({ product_id: 'P-NORMAL', expected_metadata_revision: raw.metadata_revision, name: raw.name, sku: raw.sku,
    barcode: raw.barcode, alternate_codes: [], category: raw.category, brand: raw.brand, description: null, icon: raw.icon,
    price_cents: 300, box_price_cents: null, units_per_box: null, stock_min_quantity: 0, expiry_date: null }), /INVALID_CANONICAL_PRODUCT/);
  assert.equal(normal.fetchLog.slice(before).filter((x) => x.method === 'POST').length, 0);
});

test('sugerencias de compra: sin costo la inversión y la ganancia potencial son «—»; 0 real y normal son montos', () => {
  const product = (id, extra) => ({ id, sku: 'S' + id, name: 'P' + id, stock: 0, stockMin: 3, precio: 2, ...extra });
  const products = [product(1, {}), product(2, { costo: 0 }), product(3, { costo: 1.5 })];
  const sales = [{ fecha: '2026-10-09', items: products.map((p) => ({ id: p.id, cantidad: 30 })) }];
  const ctx = vm.createContext({ console, _naEffectiveExpiry: () => null, productos: products, ventas: sales, appConfig: {},
    document: { addEventListener() {}, getElementById() { return null; } }, invBadges() {}, invRender() {}, _naNormalizeData() {},
    _naTracksStock: () => true, _naUnitsSold: (i) => Number(i.cantidad || 0), obtenerHoy: () => '2026-10-10', diasHasta: () => null,
    _naCategoryTitle: (x) => String(x), _naCategoryLabel: (x) => String(x) });
  ctx.window = ctx;
  vm.runInContext(read('POS/js/core/utils.js'), ctx);
  vm.runInContext(read('POS/js/legacy-inline/inline-06.js'), ctx);
  const [absent, zero, normal] = products.map((p) => ctx._naF9AnalyzeProduct(p));
  assert.ok(absent.suggestedUnits > 0 && zero.suggestedUnits > 0 && normal.suggestedUnits > 0);
  assert.equal(absent.investment, null);
  assert.equal(absent.potentialProfit, null);
  assert.equal(zero.investment, 0);
  assert.equal(zero.potentialProfit, zero.potentialRevenue);
  assert.equal(normal.investment, normal.suggestedUnits * 1.5);
  assert.equal(ctx._naF9Money(absent.investment), '—');
  assert.equal(ctx._naF9Money(zero.investment), 'S/ 0.00');
  assert.equal(ctx._naF9Summary([absent, normal]).investment, null);
  assert.equal(ctx._naF9Summary([zero, normal]).investment, normal.investment);
  assert.match(ctx._naF9Card(absent), /Inversión estimada: —\./);
});
