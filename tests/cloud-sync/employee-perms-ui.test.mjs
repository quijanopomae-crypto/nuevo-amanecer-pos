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

test('hoy el candado permisos-por-empleado está cerrado y no hay entradas nuevas en FEATURE_LOCKS/FEATURE_ROLES/SCREENS', () => {
  const ctx = vm.createContext({});
  vm.runInContext(read('POS/js/config/pos-permissions.js'), ctx);
  const P = ctx.NA_PERMISSIONS;
  assert.equal(P.featureLocked('permisos-por-empleado'), true);
  assert.ok(!('permisos-por-empleado' in P.FEATURE_LOCKS) && !('permisos-por-empleado' in P.FEATURE_ROLES));
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
