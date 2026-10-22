// Asistente: abrir funciones y configurar (asistente-acciones.js). Permisos de la sesión, cerrado por defecto, confirmar antes de guardar, sin cobros.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL('../../POS/' + p, import.meta.url), 'utf8');
const PERMS = read('js/config/pos-permissions.js'), TOGGLES = read('js/config/pos-employee-toggles.js'), EMP = read('js/config/employee-perms-client.js'), ACC = read('js/modules/asistente/asistente-acciones.js');

// unlock: ids cuyo candado se abre SOLO en esta prueba (el archivo real queda igual).
function boot({ role = 'owner', confirmed = true, unlock = ['asistente-acceso-total'], allow = {}, cfg = { igvActive: false, stockMin: 5 } } = {}) {
  const saves = [], nav = [];
  const ctx = { console, CustomEvent: class { constructor(t) { this.type = t; } }, dispatchEvent() {}, addEventListener() {}, appConfig: cfg };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(PERMS, ctx);
  const real = ctx.NA_PERMISSIONS;
  ctx.NA_PERMISSIONS = Object.freeze(Object.assign({}, real, { featureLocked: (id) => unlock.includes(id) ? false : real.featureLocked(id) }));
  ctx.NA_ROLES = { role, confirmed, isOwner: () => role === 'owner' && confirmed };
  vm.runInContext(TOGGLES, ctx); vm.runInContext(EMP, ctx);
  ctx.NA_EMPLOYEE_PERMS.set({ allow });
  ctx.saveAppState = () => saves.push(JSON.stringify(ctx.appConfig));
  ctx.NA_MENU_NAVIGATION = { navigate: (p) => { nav.push(p); return true; } };
  vm.runInContext(ACC, ctx);
  return { A: ctx.NA_ASISTENTE_ACCIONES, ctx, saves, nav, real };
}

test('candado real: asistente-acceso-total está en true (apagado) y apagado handle() devuelve null', () => {
  const { A, real } = boot({ unlock: [] });
  assert.equal(real.FEATURE_LOCKS['asistente-acceso-total'], true);
  assert.equal(A.enabled(), false);
  assert.equal(A.handle('abre kardex'), null);
  assert.equal(A.handle('activa el igv'), null);
});

test('dueño: abre cualquier pantalla de la lista cuyo candado está abierto', () => {
  const { A, nav } = boot();
  for (const [t, page] of [['abre kardex', 'pageKardex'], ['llévame a configuración', 'pageConfig'], ['ir a gastos', 'pageGastos'], ['muestra productos sin movimiento', 'pageProductosSinMovimiento'], ['abre valorización', 'pageValorizacion']]) {
    const r = A.handle(t); assert.equal(r.ok, true, t); assert.equal(r.page, page);
  }
  assert.deepEqual(nav, ['pageKardex', 'pageConfig', 'pageGastos', 'pageProductosSinMovimiento', 'pageValorizacion']);
});

test('empleado: no obtiene pantallas del dueño por el asistente (costos, totales, proveedores)', () => {
  const { A, nav } = boot({ role: 'empleado' });
  for (const t of ['abre kardex', 'abre valorización', 'ir a gastos', 'abre configuración', 'abre arqueos', 'abre historial de compras', 'abre ventas y stock', 'abre productos sin movimiento', 'abre etiquetas']) {
    const r = A.handle(t); assert.equal(r.ok, false, t); assert.match(r.msg, /solo para el Admin|Próximamente/);
  }
  assert.deepEqual(nav, []);
  assert.equal(A.handle('abre caja').ok, true); // pantalla de empleado
});

test('empleado: con su casilla del #924 prendida sí la abre; sin casilla no', () => {
  const on = boot({ role: 'empleado', allow: { 'productos-sin-movimiento': true } });
  assert.equal(on.A.handle('abre productos sin movimiento').ok, true);
  assert.equal(on.A.handle('abre etiquetas').ok, false);
  // casilla prendida pero candado de la función puesto: gana el candado
  const lockedFeat = boot({ role: 'empleado', allow: { 'etiquetas-precios': true } });
  assert.equal(lockedFeat.A.canOpen('pageKardex').ok, false);
});

test('cerrado por defecto: pantalla desconocida, rol sin confirmar, rol distinto al del asistente', () => {
  const { A } = boot();
  assert.equal(A.canOpen('pageNoExiste').ok, false);
  assert.equal(A.canOpen('__proto__').ok, false);
  assert.equal(A.canOpen(undefined).ok, false);
  assert.equal(A.handle('abre la nave espacial').ok, false);
  assert.equal(A.canOpen('pageKardex', 'empleado').ok, false); // el ping dijo empleado: no se usa el rol owner
  assert.equal(boot({ confirmed: false }).A.canOpen('pageKardex').ok, false);
  assert.equal(boot({ role: 'raro' }).A.canOpen('pageCaja').ok, false);
  assert.equal(A.canConfigure('constructor').ok, false);
});

test('pantalla con candado puesto: ni el dueño la abre (queda en Próximamente)', () => {
  const { A, real } = boot();
  assert.equal(real.featureLocked('kardex'), false);
  // simula candado puesto en kardex
  const b = boot({ unlock: ['asistente-acceso-total'] });
  const P = b.ctx.NA_PERMISSIONS; b.ctx.NA_PERMISSIONS = Object.freeze(Object.assign({}, P, { featureLocked: (id) => id === 'kardex' ? true : P.featureLocked(id) }));
  const r = b.A.handle('abre kardex'); assert.equal(r.ok, false); assert.match(r.msg, /Próximamente/);
  assert.ok(A);
});

test('configuración: dueño recibe propuesta que NO guarda hasta confirmar; token de un solo uso', () => {
  const { A, saves, ctx } = boot();
  const r = A.handle('activa el IGV');
  assert.equal(r.ok, true); assert.equal(r.needsConfirm, true); assert.equal(r.key, 'igvActive'); assert.equal(r.value, true);
  assert.equal(saves.length, 0); assert.equal(ctx.appConfig.igvActive, false);
  assert.equal(A.confirm('inventado').ok, false); assert.equal(saves.length, 0);
  const r2 = A.handle('pon stock mínimo en 12'); assert.equal(r2.key, 'stockMin'); assert.equal(r2.value, 12);
  assert.equal(A.handle('pon stock mínimo en 999999').ok, false);
});

test('configuración: empleado nunca, ni siquiera con casillas', () => {
  const { A } = boot({ role: 'empleado', allow: { 'productos-sin-movimiento': true } });
  const r = A.handle('activa el igv'); assert.equal(r.ok, false); assert.match(r.msg, /Solo el Admin/);
});

test('nunca cobra, paga, anula, toca pagos pendientes ni borra', () => {
  const { A, nav, saves } = boot();
  for (const t of ['cobra la venta', 'presiona Pagar', 'Cobrar', 'anula la venta 12', 'elimina el producto arroz', 'borra el cliente', 'registra un abono', 'paga la deuda', 'revisa los pagos pendientes', 'devuelve el dinero', 'abre pagos pendientes']) {
    const r = A.handle(t); assert.equal(r.kind, 'forbidden', t); assert.equal(r.ok, false);
  }
  assert.deepEqual(nav, []); assert.equal(saves.length, 0);
  assert.deepEqual(Array.from(A.ACTION_KINDS), ['open', 'config']);
  assert.doesNotMatch(ACC, /sale\.annul|payment\.|cash\.close|\.click\(\)|innerHTML|insertAdjacentHTML/);
});

test('no se toca ownerAllowed(); la UI usa el módulo con el rol del ping', () => {
  assert.doesNotMatch(ACC, /ownerAllowed/);
  const UI = read('js/modules/asistente/asistente-ui.js');
  assert.match(UI, /NA_ASISTENTE_ACCIONES, aRes = AA \? AA\.handle\(text, \{ accessRole: access \? access\.role : 'none'/);
});

test('render: tarjeta con Guardar/Cancelar (textContent); Guardar guarda una vez, Cancelar no guarda', async () => {
  const { A, saves, ctx } = boot();
  // DOM mínimo
  const mk = (tag) => { const e = { tag, children: [], className: '', attrs: {}, listeners: {}, disabled: false, _t: '', type: '',
    set textContent(v) { this._t = String(v); this.children = []; }, get textContent() { return this._t + this.children.map(c => c.textContent).join(''); },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; } }; return e; };
  const doc = { createElement: mk };
  const find = (n, cls) => n.className === cls ? n : n.children.map(c => find(c, cls)).find(Boolean);
  const card = A.render(doc, A.handle('activa el igv'));
  assert.match(card.textContent, /Calcular IGV: Apagado → Encendido/);
  find(card, 'na-asst-acc-ok').listeners.click();
  assert.equal(saves.length, 1); assert.equal(ctx.appConfig.igvActive, true);
  find(card, 'na-asst-acc-ok').listeners.click(); assert.equal(saves.length, 1);
  const card2 = A.render(doc, A.handle('pon stock mínimo en 8'));
  find(card2, 'na-asst-acc-no').listeners.click(); assert.equal(saves.length, 1); assert.equal(ctx.appConfig.stockMin, 5);
  // la sesión dejó de ser dueño entre la propuesta y el botón: no guarda
  const card3 = A.render(doc, A.handle('desactiva el igv'));
  ctx.NA_ROLES.role = 'empleado';
  find(card3, 'na-asst-acc-ok').listeners.click(); await new Promise(r => setTimeout(r, 0)); assert.equal(saves.length, 1); assert.match(find(card3, 'na-asst-acc-out').textContent, /Solo el Admin/);
});

const mkDoc = () => { const mk = (tag) => ({ tag, children: [], className: '', attrs: {}, listeners: {}, disabled: false, _t: '', type: '',
  set textContent(v) { this._t = String(v); this.children = []; }, get textContent() { return this._t + this.children.map(c => c.textContent).join(''); },
  appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; } }); return { createElement: mk }; };
const findCls = (n, cls) => n.className === cls ? n : n.children.map(c => findCls(c, cls)).find(Boolean);
const tick = () => new Promise(r => setTimeout(r, 0));

test('token vence a los 2 minutos: después no guarda', async () => {
  const { A, ctx, saves } = boot();
  let t = 1_000_000; vm.runInContext('Date.now = () => globalThis.__t', ctx); ctx.__t = t;
  assert.equal(A.TOKEN_TTL_MS, 120000);
  const card = A.render(mkDoc(), A.handle('activa el igv'));
  ctx.__t = t + 120001;
  findCls(card, 'na-asst-acc-ok').listeners.click(); await tick();
  assert.equal(saves.length, 0); assert.equal(ctx.appConfig.igvActive, false);
  assert.match(findCls(card, 'na-asst-acc-out').textContent, /venció/);
  // dentro de los 2 minutos sí guarda
  ctx.__t = t; const card2 = A.render(mkDoc(), A.handle('activa el igv'));
  ctx.__t = t + 119000; findCls(card2, 'na-asst-acc-ok').listeners.click(); await tick();
  assert.equal(saves.length, 1); assert.equal(ctx.appConfig.igvActive, true);
});

test('guardar falla (excepción): se revierte el valor', async () => {
  const { A, ctx } = boot();
  ctx.saveAppState = () => { throw new Error('disco'); };
  const card = A.render(mkDoc(), A.handle('activa el igv'));
  findCls(card, 'na-asst-acc-ok').listeners.click(); await tick();
  assert.equal(ctx.appConfig.igvActive, false);
  assert.match(findCls(card, 'na-asst-acc-out').textContent, /No se pudo guardar/);
});

test('guardar falla (promesa rechazada): se revierte; promesa ok: queda guardado', async () => {
  const { A, ctx } = boot();
  ctx.saveAppState = () => Promise.reject(new Error('red'));
  const card = A.render(mkDoc(), A.handle('pon stock mínimo en 9'));
  findCls(card, 'na-asst-acc-ok').listeners.click(); await tick(); await tick();
  assert.equal(ctx.appConfig.stockMin, 5);
  assert.match(findCls(card, 'na-asst-acc-out').textContent, /No se pudo guardar/);
  // clave que no existía: se borra al revertir
  delete ctx.appConfig.printAuto;
  const r = A.render(mkDoc(), A.handle('activa imprimir automatico'));
  findCls(r, 'na-asst-acc-ok').listeners.click(); await tick(); await tick();
  assert.equal(Object.prototype.hasOwnProperty.call(ctx.appConfig, 'printAuto'), false);
  ctx.saveAppState = () => Promise.resolve();
  const ok = A.render(mkDoc(), A.handle('pon stock mínimo en 9'));
  findCls(ok, 'na-asst-acc-ok').listeners.click(); await tick(); await tick();
  assert.equal(ctx.appConfig.stockMin, 9); assert.match(findCls(ok, 'na-asst-acc-out').textContent, /Guardado/);
});
