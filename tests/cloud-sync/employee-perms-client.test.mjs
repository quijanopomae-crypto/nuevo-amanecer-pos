// Permisos por empleado, lado del aparato: NA_EMPLOYEE_PERMS falla cerrado. Solo fixtures locales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const ID = 'productos-sin-movimiento';
const unlocked = { featureLocked: () => false };
const emp = { role: 'empleado', confirmed: true };
function load({ toggles = true, perms = unlocked, roles = emp } = {}) {
  const ctx = vm.createContext({ Object, CustomEvent: class { constructor(t) { this.type = t; } }, dispatchEvent() {}, NA_PERMISSIONS: perms, NA_ROLES: roles });
  if (toggles) vm.runInContext(read('POS/js/config/pos-employee-toggles.js'), ctx);
  vm.runInContext(read('POS/js/config/employee-perms-client.js'), ctx);
  return ctx.NA_EMPLOYEE_PERMS;
}

test('abre solo con: empleado confirmado, id en la lista, candado === false y allow === true', () => {
  const e = load(); e.set({ allow: { [ID]: true } });
  assert.equal(e.may(ID), true);
  assert.equal(e.mayScreen('pageProductosSinMovimiento'), true);
  assert.equal(e.mayScreen('pageConfig'), false);
});

test('cerrado de fábrica (sin mapa del servidor)', () => {
  assert.equal(load().may(ID), false);
});

test('cerrado sin NA_EMPLOYEE_TOGGLES', () => {
  const e = load({ toggles: false }); e.set({ allow: { [ID]: true } });
  assert.equal(e.may(ID), false);
});

test('cerrado con candado cerrado, candado no booleano o sin tabla de permisos', () => {
  for (const perms of [{ featureLocked: () => true }, { featureLocked: () => undefined }, {}, null]) {
    const e = load({ perms }); e.set({ allow: { [ID]: true } });
    assert.equal(e.may(ID), false);
  }
});

test('cerrado si el id no está en la lista, aunque el servidor lo mande en true', () => {
  const e = load(); e.set({ allow: { 'valorizacion-inventario': true, 'tesoreria': true } });
  assert.equal(e.may('valorizacion-inventario'), false);
  assert.equal(e.may('tesoreria'), false);
  assert.equal(e.may(undefined), false);
});

test('cerrado si allow no es exactamente true', () => {
  for (const v of ['true', 1, {}, [], null, false]) {
    const e = load(); e.set({ allow: { [ID]: v } });
    assert.equal(e.may(ID), false, JSON.stringify(v));
  }
  for (const bad of [null, 'x', [], { allow: [ID] }, { allow: 'x' }]) {
    const e = load(); e.set(bad); assert.equal(e.may(ID), false);
  }
});

test('cerrado ante errores lanzados (candado, rol, fuente)', async () => {
  let e = load({ perms: { featureLocked: () => { throw new Error('x'); } } }); e.set({ allow: { [ID]: true } });
  assert.equal(e.may(ID), false);
  const roles = { get role() { throw new Error('x'); }, confirmed: true };
  e = load({ roles }); e.set({ allow: { [ID]: true } });
  assert.equal(e.may(ID), false);
  e = load(); e.setSource(async () => { throw new Error('red'); });
  await e.refresh(); assert.equal(e.may(ID), false);
});

test('solo empleado confirmado: el dueño o un rol sin confirmar no usan este camino', () => {
  for (const roles of [{ role: 'owner', confirmed: true }, { role: 'empleado', confirmed: false }, null]) {
    const e = load({ roles }); e.set({ allow: { [ID]: true } });
    assert.equal(e.may(ID), false);
  }
});

test('refresh usa la fuente conectable; fuente de fábrica lee employee_allow de /auth/me', async () => {
  let e = load(); e.setSource(async () => ({ allow: { [ID]: true } }));
  await e.refresh(); assert.equal(e.may(ID), true);
  const roles = { ...emp, api: async () => ({ pos_role: 'empleado' }) };
  e = load({ roles }); await e.refresh(); assert.equal(e.may(ID), false, 'hoy /auth/me no lo trae: cerrado');
  const roles2 = { ...emp, api: async () => ({ pos_role: 'empleado', employee_allow: { [ID]: true } }) };
  e = load({ roles: roles2 }); await e.refresh(); assert.equal(e.may(ID), true);
});

test('fuente de fábrica: lee employee_allow ({ id: true }) de /auth/me solo para empleado', async () => {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const rd = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
  const mk = me => {
    const ctx = vm.createContext({ NA_ROLES: { role: me.pos_role, confirmed: true, api: async () => me }, NA_PERMISSIONS: { featureLocked: () => false } });
    vm.runInContext(rd('POS/js/config/pos-employee-toggles.js'), ctx); vm.runInContext(rd('POS/js/config/employee-perms-client.js'), ctx); return ctx.NA_EMPLOYEE_PERMS;
  };
  let e = mk({ pos_role: 'empleado', employee_allow: { 'ventas-espera': true, kardex: true } });
  assert.equal(JSON.stringify(await e.refresh()), '{"ventas-espera":true}');
  assert.equal(e.may('ventas-espera'), true); assert.equal(e.may('kardex'), false);
  e = mk({ pos_role: 'empleado' }); assert.equal(JSON.stringify(await e.refresh()), '{}');
  e = mk({ pos_role: 'empleado', employee_allow: [true] }); assert.equal(JSON.stringify(await e.refresh()), '{}');
});

test('menú sin el ayudante de permisos por empleado: el dueño ve su menú normal y el empleado no ve pantallas de casillas', () => {
  const nav = read('POS/js/navigation/menu-navigation.js');
  const start = nav.indexOf('  function canShowDrawerPage('), end = nav.indexOf('\n  function ', start + 1);
  const pctx = vm.createContext({}); pctx.globalThis = pctx;
  vm.runInContext(read('POS/js/config/pos-permissions.js'), pctx);
  const P = pctx.NA_PERMISSIONS;
  const ctx = vm.createContext({ NA_PERMISSIONS: P }); ctx.root = ctx; // sin employeeMayScreen ni NA_EMPLOYEE_PERMS
  const canShow = vm.runInContext('(' + nav.slice(start, end).trim() + ')', ctx);
  const client = read('POS/js/config/employee-perms-client.js');
  const togglePages = [...client.slice(client.indexOf('SCREEN_FEATURE'), client.indexOf('});', client.indexOf('SCREEN_FEATURE'))).matchAll(/(page\w+):/g)].map(m => m[1]);
  assert.ok(togglePages.length >= 4, 'pantallas de casillas encontradas');
  const pages = ['pageMenu', 'pagePOS', 'pageInventario', 'pageVentas', 'pageClientes', 'pageCaja', 'pageGastos', 'pageConfig', 'pageKardex', 'pageValorizacion', ...togglePages];
  ctx.NA_ROLES = { isOwner: () => true };
  for (const p of pages) assert.equal(canShow(p), p === 'pageMenu' || P.canAccessScreen('owner', p), 'dueño ' + p);
  for (const p of ['pagePOS', 'pageInventario', 'pageVentas', 'pageClientes', 'pageCaja', 'pageConfig', 'pageKardex', ...togglePages]) assert.equal(canShow(p), true, 'dueño ve ' + p);
  ctx.NA_ROLES = { isOwner: () => false, role: 'empleado' };
  for (const p of togglePages) assert.equal(canShow(p), false, 'empleado sin ayudante no ve ' + p);
  for (const p of ['pagePOS', 'pageInventario', 'pageVentas', 'pageClientes', 'pageCaja']) assert.equal(canShow(p), true, 'empleado ve ' + p);
});
