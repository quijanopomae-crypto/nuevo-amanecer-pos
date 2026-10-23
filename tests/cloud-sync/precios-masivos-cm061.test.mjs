// CM-061: +10 % solo a seleccionados, costo y stock intactos, reintento con el mismo id no duplica, deshacer.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('POS/js/modules/precios-masivos.js', 'utf8');
class N { constructor(t) { this.tagName = t; this.children = []; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.className = ''; this.attrs = {}; }
  addEventListener() {} closest() { return null; } matches() { return false; }
  replaceChildren(...c) { this.children = c; } appendChild(c) { this.children.push(c); return c; } append(...c) { this.children.push(...c); } setAttribute(k, v) { this.attrs[k] = v; } }
function load({ owner = true, saveOk = true } = {}) {
  const sel = {}; for (const k of ['main', 'status', 'content', 'apply', 'category', 'mode', 'value', 'search', 'log', 'undo']) sel[`[data-pm-${k}]`] = new N(k);
  sel['[data-pm-mode]'].value = 'porcentaje'; sel['[data-pm-value]'].value = '10';
  const page = { querySelector: s => sel[s], addEventListener() {}, classList: { contains: () => false } };
  const store = {};
  const ctx = { document: { readyState: 'complete', getElementById: id => id === 'pageEdicionPrecios' ? page : null, createElement: t => new N(t) },
    addEventListener() {}, confirm: () => true, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    NA_PERMISSIONS: { canAccessScreen: () => true, featureLocked: id => id !== 'edicion-masiva-precios' },
    _naSecurity: { pinEnabled: true, pinHash: 'h' }, _naPinValid: () => true,
    productos: [
      { id: 'p1', nombre: 'Arroz', cat: 'Abarrotes', precio: 10, costo: 7, stock: 5 },
      { id: 'p2', nombre: 'Azúcar', cat: 'Abarrotes', precio: 4, costo: 3, stock: 9 },
      { id: 'p3', nombre: 'Jabón', cat: 'Limpieza', precio: 2.5, costo: 2, stock: 1 }], saves: 0 };
  ctx.NA_ROLES = { isOwner: () => owner, askPin: async () => true };
  ctx.saveAllData = async () => { ctx.saves++; return saveOk; };
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return { api: ctx.NA_PRECIOS_MASIVOS, sel, ctx, store };
}
const snap = ctx => ctx.productos.map(p => [p.id, p.precio, p.costo, p.stock]);
const rowsOf = sel => sel['[data-pm-content]'].children[0].children[0].children[1].children;

test('subir 10% solo seleccionados, costo y stock intactos, reintento no duplica', async () => {
  const { api, sel, ctx } = load();
  sel['[data-pm-category]'].value = 'Abarrotes';
  assert.equal(api.render(), true);
  assert.equal(rowsOf(sel).length, 2);
  api.include('p2', false); // el dueño desmarca Azúcar en la vista previa
  assert.equal(sel['[data-pm-apply]'].textContent, 'Aplicar a 1 producto');
  const op = api.opId();
  const out = await api.apply();
  assert.equal(out.done.length, 1);
  assert.deepEqual(snap(ctx), [['p1', 11, 7, 5], ['p2', 4, 3, 9], ['p3', 2.5, 2, 1]]);
  // Reintento con el mismo id de operación (misma vista previa): no vuelve a subir.
  sel['[data-pm-value]'].value = '10'; api.include('p2', false); api.render();
  assert.equal(api.opId(), op);
  assert.equal(await api.apply(), null);
  assert.deepEqual(snap(ctx), [['p1', 11, 7, 5], ['p2', 4, 3, 9], ['p3', 2.5, 2, 1]]);
  assert.equal(ctx.saves, 1);
  const log = api.readLog();
  assert.equal(log.length, 1); assert.equal(log[0].opId, op);
  assert.deepEqual(JSON.parse(JSON.stringify(log[0].rows)), [{ id: 'p1', name: 'Arroz', before: 1000, after: 1100 }]);
  assert.ok(!JSON.stringify(log).includes('cost'));
});

test('reintento tras fallo: solo aplica los que faltan', async () => {
  const { api, ctx } = load();
  const rows = api.plan(api.catalog(), { mode: 'porcentaje', value: 10 });
  const log = [{ opId: 'x', kind: 'cambio', done: ['p1'], rows: [] }];
  assert.deepEqual(api.pendingRows(rows, log, 'x').map(r => r.id).sort(), ['p2', 'p3']);
  assert.equal(api.pendingRows(rows, log, 'otro').length, 3);
  void ctx;
});

test('precio cambiado por otro lado: el lote no lo pisa', async () => {
  const { api, sel, ctx } = load();
  sel['[data-pm-category]'].value = 'Limpieza'; api.render();
  ctx.productos[2].precio = 3; // cambió entre la vista previa y el clic
  const out = await api.apply();
  assert.equal(out.done.length, 0);
  assert.equal(ctx.productos[2].precio, 3);
});

test('no se guarda: revierte en memoria y no registra', async () => {
  const { api, ctx } = load({ saveOk: false });
  api.render();
  const out = await api.apply();
  assert.equal(out.done.length, 0);
  assert.deepEqual(snap(ctx), [['p1', 10, 7, 5], ['p2', 4, 3, 9], ['p3', 2.5, 2, 1]]);
  assert.equal(api.readLog().length, 0);
});

test('deshacer último lote: vuelve al precio anterior una sola vez y respeta cambios posteriores', async () => {
  const { api, sel, ctx } = load();
  sel['[data-pm-category]'].value = 'Abarrotes'; api.render();
  await api.apply();
  assert.deepEqual(snap(ctx).map(r => r[1]), [11, 4.4, 2.5]);
  ctx.productos[1].precio = 5; // Azúcar se cambió a mano después
  const u = api.undoPlan(api.readLog(), api.catalog());
  assert.equal(u.rows.length, 1); assert.equal(u.skipped, 1);
  api.render(); assert.equal(sel['[data-pm-undo]'].hidden, false);
  const out = await api.undo();
  assert.equal(out.done.length, 1);
  assert.deepEqual(snap(ctx), [['p1', 10, 7, 5], ['p2', 5, 3, 9], ['p3', 2.5, 2, 1]]);
  assert.equal(await api.undo(), null); // ya deshecho
  assert.equal(api.readLog()[0].reverted, true);
});

test('empleado o candado cerrado: no aplica ni deshace', async () => {
  const e = load({ owner: false }); assert.equal(e.api.render(), false); assert.equal(await e.api.apply(), null); assert.equal(await e.api.undo(), null);
  const c = load(); c.ctx.NA_PERMISSIONS.featureLocked = () => true; assert.equal(c.api.render(), false); assert.equal(await c.api.apply(), null); assert.equal(c.ctx.saves, 0);
});

test('registro visible con hora de Lima', async () => {
  const { api, sel } = load();
  api.render(); await api.apply(); api.render();
  const li = sel['[data-pm-log]'].children[1].children[0].textContent;
  const lima = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  assert.ok(li.startsWith(lima), li);
  assert.match(li, /\+10 % · 3 productos$/);
});

test('plan con búsqueda: solo los que coinciden; costo no cambia', () => {
  const { api } = load();
  const items = api.catalog();
  const rows = api.plan(items, { mode: 'porcentaje', value: 10, search: 'arr' });
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(r => [r.id, r.before, r.after]))), [['p1', 1000, 1100]]);
});
