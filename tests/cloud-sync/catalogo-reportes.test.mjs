import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('POS/js/modules/catalogo-reportes.js', 'utf8');
const permissionsSource = readFileSync('POS/js/config/pos-permissions.js', 'utf8');
const indexHtml = readFileSync('POS/index.html', 'utf8');
const sw = readFileSync('POS/sw.js', 'utf8');
function permissions(unlock = {}) {
  const c = vm.createContext({ module: { exports: {} } });
  vm.runInContext(permissionsSource, c);
  const P = c.NA_PERMISSIONS;
  // Copia no congelada con candados de prueba; no modifica pos-permissions.js.
  return { canAccessScreen: P.canAccessScreen, featureLocked: id => Object.prototype.hasOwnProperty.call(unlock, id) ? unlock[id] : P.featureLocked(id), real: P };
}
function load(extra = {}) {
  const context = vm.createContext({ module: { exports: {} }, ...extra });
  vm.runInContext(source, context);
  return context.module.exports;
}
const owner = { isOwner: () => true };

test('el candado catalogo-reportes sigue cerrado y la pantalla es solo dueño', () => {
  const P = permissions().real;
  assert.equal(P.FEATURE_LOCKS['catalogo-reportes'], true);
  assert.deepEqual(Array.from(P.FEATURE_ROLES['catalogo-reportes']), ['owner']);
  assert.equal(P.canAccessScreen('owner', 'pageCatalogoReportes'), true);
  assert.equal(P.canAccessScreen('empleado', 'pageCatalogoReportes'), false);
  assert.equal(P.canAccessScreen('', 'pageCatalogoReportes'), false);
  const C = load({ NA_ROLES: owner, NA_PERMISSIONS: permissions() });
  assert.equal(C.screenAllowed(), false, 'con el candado cerrado no se abre');
});

test('falla cerrado sin NA_ROLES, sin NA_PERMISSIONS, con error o sin ser dueño', () => {
  const open = permissions({ 'catalogo-reportes': false });
  assert.equal(load({ NA_PERMISSIONS: open }).screenAllowed(), false);
  assert.equal(load({ NA_ROLES: owner }).screenAllowed(), false);
  assert.equal(load({ NA_ROLES: { isOwner: () => { throw new Error('x'); } }, NA_PERMISSIONS: open }).screenAllowed(), false);
  assert.equal(load({ NA_ROLES: { isOwner: () => 'true' }, NA_PERMISSIONS: open }).screenAllowed(), false);
  assert.equal(load({ NA_ROLES: { isOwner: () => false }, NA_PERMISSIONS: open }).visible('').length, 0);
  assert.equal(load({ NA_ROLES: owner, NA_PERMISSIONS: open }).screenAllowed(), true);
  assert.equal(load({ NA_ROLES: owner, NA_PERMISSIONS: { canAccessScreen: () => true, featureLocked: () => { throw new Error('x'); } } }).visible('').length, 0);
});

test('cada reporte apunta a una página que existe, tiene descripción y categoría', () => {
  const C = load();
  assert.ok(C.REPORTS.length >= 15);
  const ids = new Set();
  for (const r of C.REPORTS) {
    assert.ok(indexHtml.includes(`id="${r.page}"`), r.page);
    assert.ok(C.CATEGORIES.includes(r.category), r.id);
    assert.ok(r.name && r.description && r.description.length < 100, r.id);
    assert.ok(!ids.has(r.id)); ids.add(r.id);
    if (r.feature) assert.ok(Object.prototype.hasOwnProperty.call(permissions().real.FEATURE_LOCKS, r.feature), r.feature);
  }
});

test('respeta el candado propio de cada destino', () => {
  const C = load({ NA_ROLES: owner, NA_PERMISSIONS: permissions({ 'catalogo-reportes': false }) });
  const P = permissions().real;
  for (const r of C.REPORTS) assert.equal(C.canOpen(r), !r.feature || P.FEATURE_LOCKS[r.feature] === false, r.id);
  const locked = load({ NA_ROLES: owner, NA_PERMISSIONS: permissions({ 'catalogo-reportes': false, kardex: true }) });
  assert.equal(locked.visible('').some(r => r.id === 'kardex'), false);
  const noScreen = load({ NA_ROLES: owner, NA_PERMISSIONS: { canAccessScreen: (_, id) => id !== 'ventas:reportes', featureLocked: () => false } });
  assert.equal(noScreen.visible('').some(r => r.id === 'reportes-ventas'), false);
});

test('búsqueda sin tildes ni mayúsculas, por nombre, descripción o categoría', () => {
  const C = load({ NA_ROLES: owner, NA_PERMISSIONS: permissions({ 'catalogo-reportes': false }) });
  assert.deepEqual(Array.from(C.visible('KÁRDEX'), r => r.id), ['kardex']);
  assert.ok(C.visible('clientes').every(r => r.category === 'Clientes' || /client/i.test(r.name + r.description)));
  assert.equal(C.visible('valorizacion inventario')[0].id, 'valorizacion');
  assert.equal(C.visible('zzz').length, 0);
});

test('open navega con goPage solo si el destino se puede abrir', () => {
  const calls = [];
  const ctx = { NA_ROLES: owner, NA_PERMISSIONS: permissions({ 'catalogo-reportes': false }), goPage: id => { calls.push(id); } };
  const C = load(ctx);
  assert.equal(C.open('kardex'), true);
  assert.equal(C.open('no-existe'), false);
  assert.deepEqual(calls, ['pageKardex']);
  assert.equal(load({ NA_ROLES: owner, NA_PERMISSIONS: permissions() }).canOpen(C.REPORTS[0]), false, 'catálogo cerrado: nada se lista');
  const L = load({ ...ctx, NA_PERMISSIONS: permissions() });
  assert.equal(L.open('kardex'), false);
  assert.deepEqual(calls, ['pageKardex']);
});

test('solo textContent, sin montos, y en el service worker', () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(source, /typeof (ventas|productos|gastos|cajEstado)|root\.(ventas|productos|gastos)\b|formatMoney|localStorage|fetch\(/);
  assert.match(source, /roles\.isOwner\(\) === true\); \} catch \(_\) \{ return false; \}/);
  assert.ok(sw.includes("'./js/modules/catalogo-reportes.js'") && sw.includes("'./css/catalogo-reportes.css'"));
});

test('la vista previa de la tarjeta muestra Reporte y Categoría, no Usuarios', () => {
  const reg = readFileSync('POS/js/modules/proximamente-registry.js', 'utf8');
  const c = vm.createContext({ module: { exports: {} } });
  vm.runInContext(reg, c);
  const card = Array.from(c.module.exports).find(f => f.id === 'catalogo-reportes');
  assert.ok(card);
  assert.deepEqual(Array.from(card.preview.columns), ['Reporte', 'Categoría']);
});
