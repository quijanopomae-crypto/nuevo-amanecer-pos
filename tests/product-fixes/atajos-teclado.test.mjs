import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync('POS/js/modules/atajos-teclado.js', 'utf8');
const load = (ctx = {}) => { const c = vm.createContext(ctx); vm.runInContext(source, c); return c.NA_ATAJOS_TECLADO; };
const api = load();
const base = { featureLocked: false, touchOnly: false, locked: false, posActive: true, modalOpen: false, helpOpen: false, editable: false, freeSaleKey: 'F2' };
const ev = (key, extra = {}) => ({ key, ...extra });
const act = (key, state = {}, extra = {}) => api.resolveAction(ev(key, extra), { ...base, ...state });

test('F3 busca, F4 abre cobro, F1 ayuda en Venta', () => {
  assert.equal(act('F3'), 'search');
  assert.equal(act('F4'), 'pay');
  assert.equal(act('F1'), 'help');
  assert.equal(act('?'), null);
});
test('F-keys funcionan aunque se esté escribiendo; letras no', () => {
  assert.equal(act('F3', { editable: true }), 'search');
  assert.equal(act('F4', { editable: true }), 'pay');
  assert.equal(act('F1', { editable: true }), 'help');
  assert.equal(act('a', { editable: true }), null);
  assert.equal(act('Enter'), null);
});
test('Esc solo cierra si hay ventana abierta, en cualquier pantalla', () => {
  assert.equal(act('Escape'), null);
  assert.equal(act('Escape', { modalOpen: true, posActive: false }), 'close');
  assert.equal(act('Escape', { helpOpen: true }), 'help');
});
test('con una ventana abierta (p. ej. el cobro) F4 no vuelve a actuar ni confirma', () => {
  assert.equal(act('F4', { modalOpen: true }), null);
  assert.equal(act('F3', { modalOpen: true }), null);
});
test('ignora fuera de Venta, en teléfono, con sesión bloqueada y con modificadores', () => {
  assert.equal(act('F4', { posActive: false }), null);
  assert.equal(act('F4', { touchOnly: true }), null);
  assert.equal(act('Escape', { touchOnly: true, modalOpen: true }), null);
  assert.equal(act('F4', { locked: true }), null);
  assert.equal(act('F4', {}, { ctrlKey: true }), null);
  assert.equal(act('F4', {}, { defaultPrevented: true }), null);
});
test('no pisa la tecla configurada para Venta libre', () => {
  assert.equal(act('F2'), null);
  assert.equal(act('F4', { freeSaleKey: 'F4' }), null);
  assert.equal(act('F3', { freeSaleKey: 'VS' }), 'search');
});
test('la ayuda usa textContent, está en español y nunca confirma ventas', () => {
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|confirmarVenta|outerHTML/);
  assert.deepEqual(JSON.parse(JSON.stringify(api.SHORTCUTS.map(s => s.key))), ['F3', 'F4', 'Esc', 'F1']);
  assert.match(source, /Buscar producto/);
});
test('se carga en index.html y en la caché del service worker', () => {
  const index = readFileSync('POS/index.html', 'utf8'), sw = readFileSync('POS/sw.js', 'utf8');
  assert.match(index, /<script src="js\/modules\/atajos-teclado\.js"><\/script>/);
  assert.match(index, /href="css\/atajos-teclado\.css"/);
  assert.match(sw, /'\.\/js\/modules\/atajos-teclado\.js'/);
  assert.match(sw, /'\.\/css\/atajos-teclado\.css'/);
});
test('F4 arma un seguro: el primer Enter en el cobro no confirma', () => {
  assert.match(source, /armEnterGuard\(\)/);
  assert.match(source, /addEventListener\('keydown', guardKeydown, true\)/);
  assert.match(source, /stopImmediatePropagation/);
});

const fakeDoc = () => { const added = []; return { added, readyState: 'complete', addEventListener: (t) => added.push(t), body: null }; };
test('candado cerrado: no registra atajos y no resuelve ninguna acción', () => {
  const document = fakeDoc();
  const a = load({ document, NA_PERMISSIONS: { featureLocked: id => id === 'atajos-teclado' ? true : false } });
  assert.equal(a.featureLocked(), true);
  assert.equal(a.isReady(), false);
  assert.deepEqual(document.added, []);
  for (const k of ['F1', 'F3', 'F4', 'Escape']) assert.equal(act(k, { featureLocked: true, modalOpen: k === 'Escape' }), null);
  assert.equal(api.resolveAction(ev('F4'), { ...base, featureLocked: undefined }), null);
});
test('sin permisos o si featureLocked falla: falla cerrado', () => {
  for (const NA_PERMISSIONS of [undefined, {}, { featureLocked: () => { throw new Error('x'); } }]) {
    const document = fakeDoc();
    const a = load({ document, NA_PERMISSIONS });
    assert.equal(a.featureLocked(), true);
    assert.equal(a.isReady(), false);
    assert.deepEqual(document.added, []);
  }
});
test('candado abierto: registra los atajos', () => {
  const document = fakeDoc();
  const a = load({ document, NA_PERMISSIONS: { featureLocked: () => false } });
  assert.equal(a.featureLocked(), false);
  assert.equal(a.isReady(), true);
  assert.ok(document.added.includes('keydown'));
});
test('el candado real sigue cerrado en pos-permissions.js', () => {
  assert.match(readFileSync('POS/js/config/pos-permissions.js', 'utf8'), /'atajos-teclado': true/);
});
