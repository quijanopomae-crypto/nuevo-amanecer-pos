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
// Interruptor B1: la omisión de cost_cents solo se activa si /auth/me anuncia capabilities.product_update_absent_cost === true
// (Worker de #886). Sin NA_ROLES, sin confirmar, sin capacidad o con false = apagado (Worker actual: se envía 0).
const ROLES_ON = { confirmed: true, isOwner: () => true, capabilities: { product_update_absent_cost: true } };
const CAPS_OFF = [['sin NA_ROLES', undefined], ['sin capabilities', { confirmed: true, isOwner: () => true }],
  ['capacidad false', { confirmed: true, isOwner: () => true, capabilities: { product_update_absent_cost: false } }],
  ['capacidad "true" (texto)', { confirmed: true, isOwner: () => true, capabilities: { product_update_absent_cost: 'true' } }],
  ['sin confirmar (offline)', { confirmed: false, isOwner: () => true, capabilities: { product_update_absent_cost: true } }]];

test('pos-roles-client: capabilities.product_update_absent_cost solo con /auth/me confirmado y === true; sin red o Worker viejo = false', async () => {
  const src = read('POS/js/config/pos-roles-client.js');
  const load = (me, status = 200) => {
    const store = new Map([['na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://x.test', token: 't' })]]);
    const el = () => ({ classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, setAttribute() {}, appendChild() {}, querySelector: () => null, remove() {} });
    const c = vm.createContext({ console, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, dispatchEvent() {}, addEventListener() {},
      localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
      NA_PERMISSIONS: { canAccessScreen: () => true },
      fetch: async () => status === 0 ? Promise.reject(new TypeError('offline')) : new Response(JSON.stringify(me), { status, headers: { 'content-type': 'application/json' } }) });
    c.window = c; c.self = c; c.globalThis = c;
    c.document = { documentElement: el(), body: el(), readyState: 'complete', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: el };
    vm.runInContext(src, c);
    return c.NA_ROLES;
  };
  const base = { pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'd' };
  const cases = [[{ ...base, capabilities: { product_update_absent_cost: true } }, 200, true], [{ ...base }, 200, false],
    [{ ...base, capabilities: { product_update_absent_cost: false } }, 200, false], [{ ...base, capabilities: { product_update_absent_cost: 1 } }, 200, false],
    [{ error: 'x' }, 500, false], [null, 0, false]];
  for (const [me, status, expected] of cases) {
    const R = load(me, status);
    assert.equal(R.capabilities.product_update_absent_cost, false, 'antes de /auth/me: apagado');
    await R.refresh();
    assert.equal(R.capabilities.product_update_absent_cost, expected, JSON.stringify([me, status]));
  }
});

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

for (const [label, roles] of CAPS_OFF) test(`capacidad apagada (${label}): costo desconocido con campo vacío envía cost_cents: 0 como antes de #892; la ficha sigue vacía`, async (t) => {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  const owner = await device(f, { token: 'owner-off', deviceId: 'owner-off' });
  await owner.api.createProduct(product('P-OFF', { cost_cents: 500 })); await owner.api.refresh();
  const tab = await device(f, { token: 'emp-off', deviceId: 'emp-off', scripts: [BRIDGE], globals: { ...globals('P-OFF'), appConfig: { margenActive: false }, ...(roles ? { NA_ROLES: roles } : {}) }, onFetch: scrubCost });
  assert.equal(tab.api.snapshot().products.find((p) => p.product_id === 'P-OFF').cost_cents, undefined);
  const legacy = tab.api.legacySnapshot().products.find((p) => String(p.id) === 'P-OFF');
  assert.equal(legacy.costo, undefined, 'se sigue mostrando como ausente («—»), no 0');
  fillForm(tab, legacy);
  assert.equal(tab.el('pCosto').value, '');
  tab.el('pPrecio').value = '3.00';
  assert.equal(await tab.context.NuevoAmanecerCanonicalProductBridge.save(), true, JSON.stringify(tab.toasts));
  const posts = updatePosts(tab);
  assert.equal(posts.length >= 1, true, 'se intentó product.update');
  for (const body of posts) {
    assert.equal(body.cost_cents, 0, 'cost_cents: 0 con el Worker actual: ' + JSON.stringify(body));
    assert.equal(body.price_cents, 300);
  }
});

test('capacidad anunciada (Worker #886): empleado sin costo, la ficha llega vacía, el control bajo costo se omite y product.update NO envía cost_cents', async (t) => {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  const owner = await device(f, { token: 'owner-c', deviceId: 'owner-c' });
  await owner.api.createProduct(product('P-SIN', { cost_cents: 500 })); await owner.api.refresh();
  const tab = await device(f, { token: 'emp-c', deviceId: 'emp-c', scripts: [BRIDGE], globals: { ...globals('P-SIN'), NA_ROLES: ROLES_ON }, onFetch: scrubCost });
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
    // Worker #886 (ee7a7f7b): la clave debe faltar del todo; cost_cents: null se rechaza con 400.
    assert.doesNotMatch(JSON.stringify(body), /cost_cents/);
    assert.equal(body.price_cents, 300);
  }
  // El costo del dueño en el servidor no cambió a 0 (lo que el servidor haga con la omisión lo decide el dueño aparte).
  await owner.api.refresh();
  assert.equal(owner.api.snapshot().products.find((p) => p.product_id === 'P-SIN').cost_cents, 500);
});

for (const [flag, roles] of [['apagada', undefined], ['anunciada', ROLES_ON]]) test(`dueño (capacidad ${flag}): costo 0 real se envía como 0 y costo normal como centavos; omitir el costo con réplica que sí lo tiene se rechaza`, async (t) => {
  const g = (id) => ({ ...globals(id), ...(roles ? { NA_ROLES: roles } : {}) });
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  const seed = await device(f, { token: 'seed-0', deviceId: 'seed-0' });
  await seed.api.createProduct(product('P-CERO', { cost_cents: 0 })); await seed.api.refresh();
  await seed.api.createProduct(product('P-NORMAL', { cost_cents: 120 })); await seed.api.refresh();
  const zero = await device(f, { token: 'own-0', deviceId: 'own-0', scripts: [BRIDGE], globals: g('P-CERO') });
  const l0 = zero.api.legacySnapshot().products.find((p) => String(p.id) === 'P-CERO');
  assert.equal(l0.costo, 0, 'un 0 real sigue siendo 0');
  fillForm(zero, l0);
  assert.equal(zero.el('pCosto').value, '0');
  zero.el('pPrecio').value = '2.60';
  assert.equal(await zero.context.NuevoAmanecerCanonicalProductBridge.save(), true, JSON.stringify(zero.toasts));
  assert.equal(updatePosts(zero).at(-1).cost_cents, 0);
  const normal = await device(f, { token: 'own-n', deviceId: 'own-n', scripts: [BRIDGE], globals: g('P-NORMAL') });
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
  // M1: mixto => suma de los conocidos marcada como parcial con N sin costo; todos sin costo => «—»; ninguno => normal.
  const mixed = ctx._naF9Summary([absent, normal]);
  assert.equal(mixed.investment, normal.investment); assert.equal(mixed.partial, true); assert.equal(mixed.noCost, 1);
  assert.equal(ctx._naF9Summary([absent]).investment, null); assert.equal(ctx._naF9Summary([absent]).partial, false);
  const known = ctx._naF9Summary([zero, normal]);
  assert.equal(known.investment, normal.investment); assert.equal(known.partial, false); assert.equal(known.noCost, 0);
  const i6 = read('POS/js/legacy-inline/inline-06.js');
  assert.match(i6, /\$\{summary\.partial\?`\$\{summary\.noCost\} sin costo`:'Inversión sugerida'\}<\/span><strong>\$\{_naF9Money\(summary\.investment\)\}\$\{summary\.partial\?'\*':''\}/);
  assert.match(ctx._naF9Card(absent), /Inversión estimada: —\./);
});

// Revisión M1 de #892: un solo producto sin costo ya no borra las cifras de «Costo inv.» y «Ganancia pot.».
test('KPIs de inventario: ninguno ausente, algunos ausentes (dueño y empleado) y todos ausentes; 0 real cuenta como conocido', () => {
  const c = utilsContext();
  const p = (precio, stock, costo) => ({ precio, stock, ...(costo === undefined ? {} : { costo }) });
  const S = (rows, owner) => JSON.parse(JSON.stringify(c._naInvCostSummary(rows, owner)));
  // Ninguno ausente (incluye un 0 real): sin cambios respecto a antes.
  for (const owner of [true, false]) {
    assert.deepEqual(S([p(2, 3, 1), p(4, 2, 0)], owner), { costText: 'S/3', gainText: 'S/11', saleText: 'S/14', costLabel: 'Costo inv.', absent: 0 });
  }
  // Algunos ausentes: suma de costos conocidos con «*», rótulo «N sin costo»; ganancia del dueño solo sobre costo conocido.
  const some = [p(2, 3, 1), p(4, 2, 0), p(10, 5), p(7, 1, null), p(9, 0)];
  assert.deepEqual(S(some, true), { costText: 'S/3*', gainText: 'S/11*', saleText: 'S/71', costLabel: '2 sin costo', absent: 2 });
  // Empleado: la ganancia queda «—» si falta cualquier costo; el costo inv. parcial igual se muestra.
  assert.deepEqual(S(some, false), { costText: 'S/3*', gainText: '—', saleText: 'S/71', costLabel: '2 sin costo', absent: 2 });
  // Todos los relevantes (stock > 0) ausentes: «—» como hasta ahora; un ausente sin stock no cuenta.
  for (const owner of [true, false]) {
    assert.deepEqual(S([p(10, 5), p(7, 1, ''), p(3, 0, 2)], owner), { costText: '—', gainText: '—', saleText: 'S/57', costLabel: 'Costo inv.', absent: 2 });
  }
  // Sin stock ausente: un producto sin costo y sin stock no marca nada.
  assert.equal(S([p(2, 3, 1), p(10, 0)], true).costText, 'S/3');
});

test('invBadges pinta el resumen M1 en invS3/invS5 y el rótulo existente de «Costo inv.» (sin elementos nuevos)', () => {
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', attrs: {}, removeAttribute(k) { delete this.attrs[k]; } });
  const lbl = { textContent: 'Costo inv.', classList: { contains: (k) => k === 'ss-lbl' }, attrs: {}, set title(v) { this.attrs.title = v; }, get title() { return this.attrs.title; }, removeAttribute(k) { delete this.attrs[k]; } };
  const run = (products, owner) => {
    const c = vm.createContext({ console, productos: products, appConfig: { stockAlertActive: true }, NA_ROLES: { isOwner: () => owner },
      _naTracksStock: () => true, _naCriticalStock: () => false, diasHasta: () => null, _naEffectiveExpiry: () => null, _naExpiryBuckets: () => ({ expired: [] }), NA_EXPIRY_SOON_DAYS: 30,
      document: { getElementById: (id) => { const e = el(id); if (id === 'invS3') e.nextElementSibling = lbl; return e; } } });
    c.window = c;
    vm.runInContext(read('POS/js/core/utils.js'), c);
    const i3 = read('POS/js/legacy-inline/inline-03.js');
    vm.runInContext('var invBadges;' + i3.slice(i3.indexOf('invBadges=function'), i3.indexOf('\n', i3.indexOf('invBadges=function'))), c);
    c.invBadges();
  };
  const rows = [{ precio: 2, stock: 3, costo: 1 }, { precio: 10, stock: 5 }];
  run(rows, true);
  assert.equal(els.invS3.textContent, 'S/3*'); assert.equal(els.invS5.textContent, 'S/3*'); assert.equal(els.invS4.textContent, 'S/56');
  assert.equal(lbl.textContent, '1 sin costo'); assert.equal(lbl.title, 'Costo inv. · 1 sin costo');
  run(rows, false);
  assert.equal(els.invS5.textContent, '—');
  run([{ precio: 2, stock: 3, costo: 1 }], false);
  assert.equal(els.invS3.textContent, 'S/3'); assert.equal(els.invS5.textContent, 'S/3');
  assert.equal(lbl.textContent, 'Costo inv.'); assert.equal(lbl.title, undefined);
});

// Revisión O1 de #892: en edición, el campo de costo vacío conserva el costo conocido (réplica o lista local), nunca 0.
for (const [flag, roles] of [['apagada', undefined], ['anunciada', ROLES_ON]]) test(`O1 (capacidad ${flag}): ficha vacía con costo conocido reenvía ese costo; 0 real se reenvía como 0`, async (t) => {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  const owner = await device(f, { token: 'own-o1-' + flag, deviceId: 'own-o1-' + flag });
  await owner.api.createProduct(product('P-REP', { cost_cents: 500 })); await owner.api.refresh();
  await owner.api.createProduct(product('P-LOC', { cost_cents: 700 })); await owner.api.refresh();
  await owner.api.createProduct(product('P-Z', { cost_cents: 0 })); await owner.api.refresh();
  const extra = roles ? { NA_ROLES: roles } : {};
  // 1) La réplica trae el costo pero la lista local no (p. ej. carrera de #884): se reenvía el de la réplica.
  const a = await device(f, { token: 'o1-a-' + flag, deviceId: 'o1-a-' + flag, scripts: [BRIDGE], globals: { ...globals('P-REP'), ...extra, productos: [{ id: 'P-REP' }] } });
  const la = a.api.legacySnapshot().products.find((p) => String(p.id) === 'P-REP');
  fillForm(a, { ...la, costo: undefined });
  assert.equal(a.el('pCosto').value, '');
  a.el('pPrecio').value = '6.00';
  assert.equal(await a.context.NuevoAmanecerCanonicalProductBridge.save(), true, JSON.stringify(a.toasts));
  assert.equal(updatePosts(a).at(-1).cost_cents, 500, 'conserva el costo de la réplica, no 0');
  // Con el costo conservado el control bajo costo sigue activo.
  a.el('pPrecio').value = '4.00';
  assert.equal(await a.context.NuevoAmanecerCanonicalProductBridge.save(), false);
  assert.match(a.toasts.at(-1)[0], /menor al costo/);
  // 2) La réplica no trae el costo pero la lista local sí: se reenvía el de la lista.
  const b = await device(f, { token: 'o1-b-' + flag, deviceId: 'o1-b-' + flag, scripts: [BRIDGE], globals: { ...globals('P-LOC'), ...extra, productos: [{ id: 'P-LOC', costo: 7 }] }, onFetch: scrubCost });
  assert.equal(b.api.snapshot().products.find((p) => p.product_id === 'P-LOC').cost_cents, undefined);
  fillForm(b, { ...b.api.legacySnapshot().products.find((p) => String(p.id) === 'P-LOC'), costo: undefined });
  b.el('pPrecio').value = '8.00';
  assert.equal(await b.context.NuevoAmanecerCanonicalProductBridge.save(), true, JSON.stringify(b.toasts));
  assert.equal(updatePosts(b).at(-1).cost_cents, 700, 'conserva el costo de la lista local, no 0 ni omitido');
  // 3) 0 real en la réplica con el campo vacío: se reenvía 0 (es el costo conocido), no se omite.
  const z = await device(f, { token: 'o1-z-' + flag, deviceId: 'o1-z-' + flag, scripts: [BRIDGE], globals: { ...globals('P-Z'), ...extra, productos: [{ id: 'P-Z' }] } });
  fillForm(z, { ...z.api.legacySnapshot().products.find((p) => String(p.id) === 'P-Z'), costo: undefined });
  z.el('pPrecio').value = '2.00';
  assert.equal(await z.context.NuevoAmanecerCanonicalProductBridge.save(), true, JSON.stringify(z.toasts));
  const last = updatePosts(z).at(-1);
  assert.equal(Object.prototype.hasOwnProperty.call(last, 'cost_cents'), true);
  assert.equal(last.cost_cents, 0);
  await owner.api.refresh();
  const costs = Object.fromEntries(owner.api.snapshot().products.map((p) => [p.product_id, p.cost_cents]));
  assert.deepEqual([costs['P-REP'], costs['P-LOC'], costs['P-Z']], [500, 700, 0], 'ningún costo conocido se sobrescribió con 0');
});

test('M1 Ventas KPI: ninguno sin costo normal; mixto dueño «S/ X*» + «N sin costo»; mixto empleado «—»; todos sin costo «—»', () => {
  const run = (items, owner) => {
    const c = vm.createContext({ console, productos: [], ventas: [], clientes: [], creditos: [], gastos: [], cajMovs: [], ventasRender() {}, _naIsSaleIncomeMove: () => false, _naIsSaleReversalMove: () => false,
      document: { addEventListener() {}, getElementById() { return null; } }, NA_ROLES: { isOwner: () => owner } });
    c.window = c;
    vm.runInContext(read('POS/js/core/utils.js'), c);
    vm.runInContext('var totalV=v=>v.total;var _naUnitsSold=i=>i.qty;var _naCategoryLabel=x=>x;var ventasTab="todo";', c);
    vm.runInContext(read('POS/js/core/lima-time.js'), c);
    vm.runInContext(read('POS/js/legacy-inline/inline-05.js'), c);
    const src = read('POS/js/legacy-inline/inline-10.js');
    const block = src.slice(src.indexOf('function _naSecComputeKpis'), src.indexOf('function _naSecRenderSaleKpis'));
    vm.runInContext(block, c);
    c._naF8SaleRows = () => [{ id: 'v', fecha: '2026-10-21', total: items.reduce((a, i) => a + i.precio * i.qty, 0), items }];
    c._naF8UnifiedExpenses = () => [{ monto: 1, cat: 'luz' }];
    const values = c._naSecComputeKpis();
    return { texts: [0, 1, 2, 3].map((i) => c._naSecKpiText(values[i])), labels: ['Ventas', 'Ganancia bruta', 'Gastos operativos', 'Ganancia neta'].map((l, i) => c._naSecKpiLabel(l, i, values)) };
  };
  const it = (id, precio, qty, costo) => ({ id, name: 'P' + id, precio, qty, ...(costo === undefined ? {} : { costo }) });
  const LABELS = ['Ventas', 'Ganancia bruta', 'Gastos operativos', 'Ganancia neta'];
  // Ninguno sin costo (incluye 0 real): sin cambios.
  for (const owner of [true, false]) {
    assert.deepEqual(JSON.parse(JSON.stringify(run([it(1, 5, 2, 3), it(2, 4, 1, 0)], owner))), { texts: ['S/ 14.00', 'S/ 8.00', 'S/ 1.00', 'S/ 7.00'], labels: LABELS });
  }
  // Mixto: dueño, ganancia solo sobre líneas con costo conocido (10 - 6 = 4), marcada.
  const mixed = [it(1, 5, 2, 3), it(2, 10, 1), it(3, 7, 1, null)];
  assert.deepEqual(JSON.parse(JSON.stringify(run(mixed, true))), { texts: ['S/ 27.00', 'S/ 4.00*', 'S/ 1.00', 'S/ 3.00*'], labels: ['Ventas', '2 sin costo', 'Gastos operativos', 'Ganancia neta'] });
  // Mixto: empleado, «—».
  assert.deepEqual(JSON.parse(JSON.stringify(run(mixed, false))), { texts: ['S/ 27.00', '—', 'S/ 1.00', '—'], labels: LABELS });
  // Todos sin costo: «—» para ambos roles.
  for (const owner of [true, false]) {
    assert.deepEqual(JSON.parse(JSON.stringify(run([it(2, 10, 1), it(3, 7, 1, null)], owner))), { texts: ['S/ 17.00', '—', 'S/ 1.00', '—'], labels: LABELS });
  }
});

test('O5: calcularGanancias (legado, solo visual) respeta un 0 real de la venta (V10/inline-17 retirado en #1041)', () => {
  const src = read('POS/js/legacy-inline/inline-02.js');
  const line = src.split('\n').find((l) => l.startsWith('calcularGanancias=function(){'));
  const c = vm.createContext({ console, document: { addEventListener() {}, getElementById() { return null; } } });
  c.window = c;
  vm.runInContext(read('POS/js/core/utils.js'), c);
  vm.runInContext('var calcularGanancias;var totalV=v=>v.total;var _naUnitsSold=i=>i.qty;var obtenerHoy=()=>"2026-10-21";var cajMovs=[];' +
    'var productos=[{id:1,name:"A",costo:4},{id:2,name:"B"}];' +
    'var ventas=[{fecha:"2026-10-21",total:30,items:[{id:1,name:"A",qty:2,precio:5,costo:0},{id:2,name:"B",qty:2,precio:10}]}];' + line, c);
  const g = c.calcularGanancias();
  assert.equal(g.gananciaBruta, 30, '0 real guardado en la venta: no toma el costo 4 actual; ausente queda 0 (legado)');
});
