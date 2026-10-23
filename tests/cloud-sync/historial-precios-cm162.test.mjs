// CM-162: historial de precios por producto (solo en el aparato). Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const PM = readFileSync('POS/js/modules/precios-masivos.js', 'utf8');
const PH = readFileSync('POS/js/products/price-history.js', 'utf8');
const UI = readFileSync('POS/js/products/price-history-ui.js', 'utf8');
const OPEN = id => !['edicion-masiva-precios', 'historial-precios-producto'].includes(id);
class N { constructor(t) { this.tagName = t; this.children = []; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.className = ''; this.attrs = {}; }
  addEventListener() {} closest() { return null; } matches() { return false; }
  replaceChildren(...c) { this.children = c; } appendChild(c) { this.children.push(c); return c; } append(...c) { this.children.push(...c); } setAttribute(k, v) { this.attrs[k] = v; } }
function load({ owner = true, featureLocked = OPEN, storage, canon } = {}) {
  const sel = {}; for (const k of ['main', 'status', 'content', 'apply', 'category', 'mode', 'value', 'search', 'log', 'undo']) sel[`[data-pm-${k}]`] = new N(k);
  sel['[data-pm-mode]'].value = 'porcentaje'; sel['[data-pm-value]'].value = '10';
  const page = { querySelector: s => sel[s], addEventListener() {}, classList: { contains: () => false } };
  const store = {};
  const ctx = { document: { readyState: 'complete', getElementById: id => id === 'pageEdicionPrecios' ? page : null, createElement: t => new N(t) },
    addEventListener() {}, confirm: () => true,
    localStorage: storage || { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    NA_PERMISSIONS: { canAccessScreen: () => true, featureLocked },
    _naSecurity: { pinEnabled: true, pinHash: 'h' }, _naPinValid: () => true,
    productos: [
      { id: 'p1', nombre: 'Arroz', cat: 'Abarrotes', precio: 10, costo: 7, stock: 5 },
      { id: 'p2', nombre: 'Azúcar', cat: 'Abarrotes', precio: 4, costo: 3, stock: 9 }], saves: 0 };
  ctx.NA_ROLES = { label: 'Ana', deviceId: 'C-0001', isOwner: () => owner, role: owner ? 'owner' : 'empleado', confirmed: true, askPin: async () => true, approve: async () => true };
  ctx.saveAllData = async () => { ctx.saves++; return true; };
  if (canon) ctx.NuevoAmanecerCanonical = canon;
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(PH, ctx); vm.runInContext(PM, ctx);
  return { pm: ctx.NA_PRECIOS_MASIVOS, ph: ctx.NA_PRICE_HISTORY, sel, ctx, store };
}
const plain = v => JSON.parse(JSON.stringify(v));
const brief = rows => plain(rows).map(r => [r.type, r.before, r.after, r.origin, r.user, r.userId]);

test('masivo local: registra venta con origen «Edición masiva», usuario Nombre · código y sin costo', async () => {
  const { pm, ph } = load();
  pm.render(); const out = await pm.apply();
  assert.equal(out.done.length, 2);
  assert.deepEqual(brief(ph.list('p1')), [['venta', 10, 11, 'masivo', 'Ana', 'C-0001']]);
  assert.equal(ph.labels.origin.masivo, 'Edición masiva');
});

test('mismo lote (mismo opId) reintentado: no duplica; ref = opId:producto', () => {
  const { ph } = load();
  const o = { productId: 'p1', origin: 'masivo', ref: 'op-1:p1', partial: true, before: { venta: 10 }, after: { venta: 11 } };
  assert.equal(ph.recordDiff(o).length, 1);
  assert.equal(ph.recordDiff(o).length, 0);
  assert.equal(ph.list('p1').length, 1);
});

test('deshacer: registra solo los productos devueltos; los omitidos no', async () => {
  const { pm, ph, ctx } = load();
  pm.render(); await pm.apply();
  ctx.productos[1].precio = 9; // Azúcar cambió después: deshacer lo omite
  pm.render(); const out = await pm.undo();
  assert.deepEqual(plain(out.done.map(r => r.id)), ['p1']);
  assert.deepEqual(brief(ph.list('p1'))[0], ['venta', 11, 10, 'deshacer', 'Ana', 'C-0001']);
  assert.equal(ph.list('p2').filter(r => r.origin === 'deshacer').length, 0);
});

test('masivo en CANON: una sola entrada por producto con ref del lote', async () => {
  const products = [{ product_id: 'p1', name: 'Arroz', category: 'Abarrotes', price_cents: 1000, cost_cents: 700, metadata_revision: 1, active: 1 }];
  const canon = { enabled: () => true, snapshot: () => ({ products }), refresh: async () => {}, updateProduct: async b => { products[0].price_cents = b.price_cents; products[0].metadata_revision++; } };
  const { pm, ph } = load({ canon });
  pm.render(); const out = await pm.apply();
  assert.equal(out.done.length, 1);
  const rows = ph.list('p1');
  assert.equal(rows.length, 1); assert.equal(rows[0].origin, 'masivo'); assert.equal(rows[0].after, 11);
});

for (const [name, featureLocked] of [['cerrado', id => id !== 'edicion-masiva-precios'], ['lanza error', id => { if (id === 'historial-precios-producto') throw new Error('x'); return false; }]]) {
  test(`candado ${name}: no registra ni lista, y el precio se guarda igual`, async () => {
    const { pm, ph, ctx, store } = load({ featureLocked });
    assert.equal(ph.enabled(), false);
    pm.render(); const out = await pm.apply();
    assert.equal(out.done.length, 2); assert.equal(ctx.productos[0].precio, 11);
    assert.equal(store[ph.KEY], undefined); assert.deepEqual(plain(ph.list('p1')), []);
  });
}
test('sin NA_PERMISSIONS: historial cerrado', () => {
  const ctx = vm.createContext({ localStorage: { getItem: () => null, setItem() {} } }); vm.runInContext(PH, ctx);
  assert.equal(ctx.NA_PRICE_HISTORY.enabled(), false);
  assert.deepEqual(plain(ctx.NA_PRICE_HISTORY.recordDiff({ productId: 'p', origin: 'ficha', before: { venta: 1 }, after: { venta: 2 } })), []);
});

test('falla al escribir el historial: el precio masivo se guarda igual', async () => {
  const storage = { getItem: k => k === 'na_price_history_v1' ? (() => { throw new Error('roto'); })() : null, setItem: k => { if (k === 'na_price_history_v1') throw new Error('roto'); } };
  const { pm, ctx } = load({ storage });
  pm.render(); const out = await pm.apply();
  assert.equal(out.done.length, 2); assert.equal(ctx.productos[0].precio, 11); assert.equal(ctx.saves, 1);
  // Y si recordDiff mismo lanza, tampoco bloquea.
  const b = load(); b.ctx.NA_PRICE_HISTORY = { recordDiff() { throw new Error('boom'); } };
  b.pm.render(); assert.equal((await b.pm.apply()).done.length, 2);
});

test('empleado: ve venta, nunca costo; dueño sí y puede filtrar por tipo', () => {
  const { ph, ctx } = load();
  ph.recordDiff({ productId: 'p1', origin: 'ficha', before: { venta: 10, mayorista: null, costo: 7 }, after: { venta: 12, mayorista: null, costo: 8 } });
  assert.deepEqual(plain(ph.list('p1').map(r => r.type).sort()), ['costo', 'venta']);
  assert.deepEqual(plain(ph.list('p1', { type: 'costo' }).map(r => r.type)), ['costo']);
  ctx.NA_ROLES.isOwner = () => false;
  assert.deepEqual(plain(ph.list('p1').map(r => r.type)), ['venta']);
  assert.deepEqual(plain(ph.list('p1', { type: 'costo' })), []);
});

test('importación y compra siguen registrando con su origen', () => {
  const { ph } = load();
  ph.recordCatalogDiff([{ id: 'p1', precio: 10, costo: 7 }], [{ id: 'p1', precio: 13, costo: 7 }], 'importacion');
  assert.deepEqual(plain(ph.list('p1').map(r => [r.type, r.origin])), [['venta', 'importacion']]);
  ph.recordPurchase('op-c', [{ line: 1, product_id: 'p2', unit_cost_cents: 350 }], { applied: [{ line: 1 }] }, [{ id: 'p2', costo: 3 }]);
  ph.recordPurchase('op-c', [{ line: 1, product_id: 'p2', unit_cost_cents: 350 }], { applied: [{ line: 1 }] }, [{ id: 'p2', costo: 3 }]);
  assert.deepEqual(plain(ph.list('p2').map(r => [r.type, r.after, r.origin])), [['costo', 3.5, 'compra']]);
});

test('fuente: solo textContent, sin ownerAllowed', () => {
  for (const s of [PH, UI]) { assert.doesNotMatch(s, /innerHTML|insertAdjacentHTML|outerHTML/); assert.doesNotMatch(s, /ownerAllowed/); }
  assert.doesNotMatch(PM, /ownerAllowed/);
  assert.match(PH, /featureLocked\(LOCK_ID\) === false/);
});
