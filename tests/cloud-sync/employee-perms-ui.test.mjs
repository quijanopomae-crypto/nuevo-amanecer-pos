// Pantalla de permisos por empleado: reglas de visibilidad (falla cerrada) y lista compartida. Solo fixtures locales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const UI = read('POS/js/config/employee-perms-ui.js');
function load(extra) {
  const ctx = vm.createContext({ document: {}, Date, Math, ...extra });
  vm.runInContext(read('POS/js/config/pos-employee-toggles.js'), ctx);
  vm.runInContext(UI, ctx);
  return ctx;
}
const perms = locked => ({ featureLocked: id => (id === 'permisos-por-empleado' ? locked : true) });
const owner = v => ({ isOwner: () => v });

test('visible solo con candado propio abierto Y dueño confirmado; cualquier error cierra', () => {
  assert.equal(load({ NA_PERMISSIONS: perms(false), NA_ROLES: owner(true) }).NA_EMPLOYEE_PERMS_UI.canShow(), true);
  assert.equal(load({ NA_PERMISSIONS: perms(true), NA_ROLES: owner(true) }).NA_EMPLOYEE_PERMS_UI.canShow(), false, 'candado cerrado');
  assert.equal(load({ NA_PERMISSIONS: perms(false), NA_ROLES: owner(false) }).NA_EMPLOYEE_PERMS_UI.canShow(), false, 'empleado');
  assert.equal(load({ NA_PERMISSIONS: perms(false), NA_ROLES: { isOwner: () => { throw new Error('x'); } } }).NA_EMPLOYEE_PERMS_UI.canShow(), false);
  assert.equal(load({ NA_PERMISSIONS: { featureLocked: () => { throw new Error('x'); } }, NA_ROLES: owner(true) }).NA_EMPLOYEE_PERMS_UI.canShow(), false);
  assert.equal(load({ NA_ROLES: owner(true) }).NA_EMPLOYEE_PERMS_UI.canShow(), false, 'sin tabla de permisos');
  assert.equal(load({ NA_PERMISSIONS: { featureLocked: () => undefined }, NA_ROLES: owner(true) }).NA_EMPLOYEE_PERMS_UI.canShow(), false, 'solo === false abre');
  assert.equal(load({ NA_PERMISSIONS: perms(false), NA_ROLES: owner(true) }).NA_EMPLOYEE_PERMS_UI.mount(null), false);
});

test('desbloqueo #924: el candado permisos-por-empleado está abierto, sin pantalla nueva en SCREENS', () => {
  const ctx = vm.createContext({});
  vm.runInContext(read('POS/js/config/pos-permissions.js'), ctx);
  const P = ctx.NA_PERMISSIONS;
  assert.equal(P.FEATURE_LOCKS['permisos-por-empleado'], false);
  assert.equal(P.featureLocked('permisos-por-empleado'), false);
  assert.ok(!('permisos-por-empleado' in P.FEATURE_ROLES));
});

test('normalize: solo ids de la lista y valor true; todo lo demás cerrado', () => {
  const T = load({}).NA_EMPLOYEE_TOGGLES;
  assert.equal(JSON.stringify(T.normalize({ allow: { 'ventas-espera': true, kardex: true, 'clonar-venta': 'true', __proto__: { x: 1 } } })), '{"ventas-espera":true}');
  for (const v of [null, 1, 'x', [], { allow: [] }, { allow: null }, {}]) assert.equal(JSON.stringify(T.normalize(v)), '{}');
  assert.equal(T.KEY, 'internal:emp:perm:v1');
  assert.equal(T.IDS.length, 10);
});

test('el módulo no usa innerHTML, no define ownerAllowed y arranca todo apagado', () => {
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(UI));
  assert.ok(!/ownerAllowed/.test(UI));
  assert.match(UI, /cb\.checked = false; cb\.disabled = true;/);
  const html = read('POS/index.html');
  assert.ok(html.indexOf('js/config/pos-employee-toggles.js') < html.indexOf('js/config/employee-perms-ui.js'));
  assert.ok(html.indexOf('js/config/employee-perms-ui.js') < html.indexOf('js/config/config-g.js'));
});

// Confirmación tardía del rol y sin doble montaje (DOM mínimo de prueba, solo fixtures locales).
function fakeDom() {
  const mk = (tag) => {
    const n = { tagName: tag, children: [], parentNode: null, className: '', id: '', dataset: {}, attrs: {}, textContent: '', type: '', checked: false, disabled: false,
      appendChild(c) { c.parentNode = n; n.children.push(c); return c; },
      insertBefore(c) { return n.appendChild(c); },
      remove() { if (n.parentNode) { n.parentNode.children = n.parentNode.children.filter(x => x !== n); n.parentNode = null; } },
      setAttribute(k, v) { n.attrs[k] = v; }, addEventListener() {}, closest() { return null; },
      all() { return n.children.flatMap(c => [c, ...c.all()]); },
      querySelectorAll(sel) { return n.all().filter(c => match(c, sel)); },
      querySelector(sel) { return n.querySelectorAll(sel)[0] || null; } };
    return n;
  };
  const match = (c, sel) => sel === '#naEmpPerm' ? c.id === 'naEmpPerm' : sel === '#naEmpPermSave' ? c.id === 'naEmpPermSave'
    : sel === 'input[data-perm]' ? c.tagName === 'input' && 'perm' in c.dataset : sel === '.na-emp-perm-status' ? c.className.split(' ').includes('na-emp-perm-status') : false;
  const cont = mk('div');
  const document = { createElement: mk, querySelector: sel => (sel === '.na9-bd[data-sec="pin"]' ? cont : null) };
  return { cont, document };
}
function loadLive(role) {
  const { cont, document } = fakeDom(); const listeners = [];
  const ctx = vm.createContext({ document, Date, Math, NA_PERMISSIONS: perms(false), NA_ROLES: { isOwner: () => role.owner, api: async () => ({ allow: {} }), pinSet: true },
    addEventListener: (t, f) => { if (t === 'na:role') listeners.push(f); } });
  vm.runInContext(read('POS/js/config/pos-employee-toggles.js'), ctx);
  vm.runInContext(UI, ctx);
  return { ctx, cont, fire: () => listeners.forEach(f => f()), count: () => cont.querySelectorAll('#naEmpPerm').length, listeners };
}

test('rol confirmado tarde: na:role monta el panel en Usuarios y PIN', () => {
  const role = { owner: false }; const t = loadLive(role);
  assert.equal(t.listeners.length, 1);
  assert.equal(t.ctx.NA_EMPLOYEE_PERMS_UI.mount(t.cont), false, 'sin confirmar no se monta');
  assert.equal(t.count(), 0);
  t.fire(); assert.equal(t.count(), 0, 'na:role sin dueño confirmado sigue cerrado');
  role.owner = true; t.fire();
  assert.equal(t.count(), 1, 'al confirmar aparece');
});

test('sin doble montaje: varios na:role y mount previo dejan un solo panel', () => {
  const role = { owner: true }; const t = loadLive(role);
  assert.equal(t.ctx.NA_EMPLOYEE_PERMS_UI.mount(t.cont), true);
  const first = t.cont.querySelector('#naEmpPerm');
  t.fire(); t.fire(); t.fire();
  assert.equal(t.count(), 1);
  assert.equal(t.cont.querySelector('#naEmpPerm'), first, 'no se reconstruye el mismo panel');
});

test('falla cerrada: si el rol deja de ser dueño confirmado, na:role quita el panel', () => {
  const role = { owner: true }; const t = loadLive(role);
  t.fire(); assert.equal(t.count(), 1);
  role.owner = false; t.fire(); assert.equal(t.count(), 0);
  role.owner = () => { throw new Error('x'); }; t.ctx.NA_ROLES.isOwner = () => { throw new Error('x'); }; t.fire(); assert.equal(t.count(), 0);
});

test('sw.js precarga employee-perms-ui.js (el panel no depende de la red)', () => {
  const sw = read('POS/sw.js');
  const block = sw.slice(sw.indexOf('const PRECACHE_URLS = ['), sw.indexOf('];', sw.indexOf('const PRECACHE_URLS = [')));
  assert.ok(block.includes("'./js/config/employee-perms-ui.js'"));
});
