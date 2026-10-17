// Sobre 58200f60 (Bot 5, ev-58200f60/LEEME.md; Bot 4). Sondas de Bot 5 como pruebas:
// 1) línea de TEXTO «Esa es la utilidad: S/ 0.70» / «Ese es el margen: S/ 0.70» tapa el monto de arriba (empleado); «El costo lo ve el dueño.» se ve.
// 2) tabla de VENTA con tabuladores (cabecera PVP / P. venta / Venta): 1.ª celda del dueño tapa su fila y abre la regla fija.
// 3) máscaras no ASCII en «manual» y en la propuesta; prefijo de la tarjeta sin máscara ni etiqueta pegada.
// 4) /confirm no revisa lineas[].nombre con product_id («Leche 12345678»).
// 5) PIN numérico acotado. 6) celular: tras un 422 «Confirmar» apagado hasta cambiar el campo; 422 sin nada editable → solo «Cancelar». Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas_documentos', emp = A.redactFor(EMP), own = A.redactFor('owner');
const has = (t, m) => new RegExp('(^|[^\\d])' + m.replace(/[.$*+?()[\]{}|\\^]/g, '\\$&') + '(?![\\d])').test(t);
const emitN = (t, n, role) => { const red = A.redactFor(role); let o = ''; const e = A.createTextEmitter((d) => { if (d.reset) o = ''; else o += d.t || ''; }, 1e9, red, role === 'owner' ? null : A.ownerHold); for (let i = 0; i < t.length; i += n) e.push(t.slice(i, i + n)); e.flush(); return o; };
function chk(t, hidden, shown = []) {
  const o = emp(t);
  for (const m of hidden) assert.ok(!has(o, m), 'empleado ve ' + m + ' en ' + JSON.stringify(t) + ' → ' + JSON.stringify(o));
  for (const m of shown) assert.ok(has(o, m), 'tapado de más ' + m + ' en ' + JSON.stringify(t) + ' → ' + JSON.stringify(o));
  for (const n of [1, 3, 7, 48]) assert.equal(emitN(t, n, EMP), o, 'en partes de ' + n + ': ' + JSON.stringify(t));
}

test('1) línea de texto con demostrativo/«es» + ganancia/margen/utilidad/costo: el monto de arriba se tapa; «El costo lo ve el dueño.» se ve', () => {
  for (const pre of ['Galleta S/ 1.80', 'Galleta S/ 1.80.', 'Galleta: S/ 1.80'])
    for (const nx of ['Esa es la utilidad: S/ 0.70', 'Ese es el margen: S/ 0.70', 'Esa es la ganancia S/ 0.70', 'Este es el margen S/ 0.70', 'esta es la utilidad S/ 0.70 por unidad vendida hoy',
      'Es el margen: S/ 0.70', 'Esa utilidad: S/ 0.70', 'Ese margen es de S/ 0.70 por cada paquete', 'Esa es la utilidad', 'ese es el costo']) {
      chk(pre + '\n' + nx + '\n', ['1.80', ...(/0\.70/.test(nx) ? ['0.70'] : [])]); }
  // costo con SU monto suelta el de arriba (precio), como antes; un «El» suelto no es comienzo
  chk('Galleta S/ 2.50\nEste es el costo: S/ 1.20\n', ['1.20'], ['2.50']);
  chk('Galleta S/ 2.50\nEl costo lo ve el dueño.\n', [], ['2.50']);
  chk('Galleta S/ 2.50\nEsta semana vendimos bastante, sigue igual.\n', [], ['2.50']);
  // el dueño ve todo
  assert.equal(own('Galleta S/ 1.80\nEsa es la utilidad: S/ 0.70\n'), 'Galleta S/ 1.80\nEsa es la utilidad: S/ 0.70\n');
});

test('2) tabla de venta con tabuladores: 1.ª celda del dueño tapa su fila y TODAS las de abajo (regla fija); sin ella, todo se ve', () => {
  for (const h of ['Producto\tPVP', 'Producto\tP. venta', 'Producto\tVenta', 'Producto\tPrecio de venta'])
    for (const c of ['(mi costo)', '(Mi costo)', 'costo unitario', 'Costo', 'mi margen', 'Esa es la ganancia', 'Utilidad', '- costo', '1. costo']) {
      chk(h + '\nGalleta\tS/ 1.80\n' + c + '\tS/ 1.20\nArroz\tS/ 1.21\nAzúcar\tS/ 3.50\n', ['1.20', '1.21', '3.50'], ['1.80']); }
  chk('Producto\tPVP\nGalleta\tS/ 1.80\nArroz\tS/ 1.21\n', [], ['1.80', '1.21']);
  chk('Producto\tPVP\tStock\nGalleta\tS/ 1.80\t12\nArroz\tS/ 1.21\t4\n', [], ['1.80', '1.21']);
  // la misma regla con «|» (sin cambios)
  chk('| Producto | PVP |\n|---|---|\n| Galleta | S/ 1.80 |\n| (mi costo) | S/ 1.20 |\n| Arroz | S/ 1.21 |\n', ['1.20', '1.21'], ['1.80']);
});

test('3) máscaras no ASCII: cuentan en «manual», en la propuesta y en el celular; el prefijo de la tarjeta no las conserva ni deja etiqueta', async () => {
  const masks = ['∗∗∗∗6789', '＊＊＊＊6789', '••••6789', '●●●●6789', 'xxxx6789', 'XXXX6789', '**6789', '…6789', 'Juan RUC ••••6789', 'F001-xxxx5678', 'Alicorp (oculto)', '··6789'];
  for (const v of masks) { assert.ok(A.MASK_LEFT_RE.test(v), v); assert.ok(C.maskLeft(v), 'celular ' + v); }
  for (const v of ['**Galleta**', 'Galleta · S/ 1.80', 'F001-00012345', 'Caja x12', 'Pack xx2', 'Alicorp SAC']) { assert.ok(!A.MASK_LEFT_RE.test(v), v); assert.ok(!C.maskLeft(v), 'celular ' + v); }
  assert.equal(A.cardPrefix('F001-**345678 [oculto]'), 'F001-'); assert.equal(A.cardPrefix('F001-DNI ****5678'), 'F001-'); assert.equal(A.cardPrefix('Ana (RUC ****'), 'Ana');
  assert.equal(A.cardPrefix('Juan RUC ••••6789'), 'Juan'); assert.equal(A.cardPrefix('F001-12345678 pedido [DNI oculto]'), 'F001-12345678 pedido');
  // tarjeta escrita por el modelo con una máscara no ASCII → completar
  const p = A.toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Juan RUC ••••6789', documento: 'F001-xxxx5678', lineas: [{ nombre: 'Galleta', cantidad: 1, costo_unitario: 1 }] } }, 'owner', { products: [] }, 1);
  assert.deepEqual(p.completar, ['proveedor', 'documento']); assert.equal(p.proveedor, 'Juan'); assert.equal(p.documento, 'F001-');
  // «manual» con máscara no ASCII → 422, nada marcado
  const SECRET = 'secreto-de-prueba-1234567890', AUTH = { principalId: 'session:dueno', posRole: 'owner', sessionId: 'S1' }, store = A.createMemoryUsageStore();
  const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  const reader = { products: async () => [], productsById: async () => new Map(), purchases: async () => [] };
  const send = async (prop, manual) => { const token = await A.issueConfirmToken(prop, 'owner', AUTH, SECRET, Date.now());
    const r = await A.assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token, proposal: prop, manual }) }), { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET }, AUTH, jsonR,
      { store, resolveRole: async () => 'owner', reader, audit: async () => {} }); return { status: r.status, body: await r.json() }; };
  // (decisión final sobre d72b7601) «XX6789» y las demás máscaras de MASK_LEFT_RE cuentan solo en documento/RUC; en el proveedor, solo tiras de
  // relleno, «[oculto]/(oculto)» o vacío. Por eso las máscaras con x/X o «…» se prueban en el documento.
  for (const m of masks) { const doc = /x|…/i.test(m); const r = await send(p, doc ? { proveedor: 'Juan Pérez', documento: m } : { proveedor: m, documento: 'F001-00012345' }); assert.equal(r.status, 422, m); assert.deepEqual(r.body.fields, [doc ? 'documento' : 'proveedor'], m); }
  assert.equal([...store._map.values()].filter((x) => x.value.op).length, 0, 'ningún rechazo marcó la tarjeta');
  assert.equal((await send(p, { proveedor: 'Juan Pérez', documento: 'F001-00012345' })).status, 200);
});

test('4) /confirm: el nombre de una línea con product_id no se revisa («Leche 12345678»); sin product_id sí; otros campos de la línea sí', async () => {
  const SECRET = 'secreto-de-prueba-1234567890', AUTH = { principalId: 'session:dueno', posRole: 'owner', sessionId: 'S1' };
  const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  const reader = { products: async () => [], productsById: async (ids) => new Map(ids.map((id) => [id, { id, nombre: 'Leche 12345678' }])), purchases: async () => [] };
  const send = async (prop) => { const token = await A.issueConfirmToken(prop, 'owner', AUTH, SECRET, Date.now());
    const r = await A.assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token, proposal: prop }) }), { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET }, AUTH, jsonR,
      { store: A.createMemoryUsageStore(), resolveRole: async () => 'owner', reader, audit: async () => {} }); return { status: r.status, body: await r.json() }; };
  const base = { id: 'p1-preparar_compra', type: 'compra', needsConfirm: true, title: 'Preparar compra', proveedor: 'Gloria SA', documento: 'F001-1', fecha: '' };
  const ok = await send({ ...base, lineas: [{ product_id: 'P1', nombre: 'Leche DNI ****5678', cantidad: 2, costo_unitario: 3 }] }); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const no = await send({ ...base, lineas: [{ product_id: null, nombre: 'Leche DNI ****5678', cantidad: 2, costo_unitario: 3 }] }); assert.equal(no.status, 422); assert.deepEqual(no.body.fields, ['lineas']);
  const no2 = await send({ ...base, lineas: [{ product_id: 'P1', nombre: 'Leche', unidad: 'caja ••••5678', cantidad: 2, costo_unitario: 3 }] }); assert.equal(no2.status, 422);
  // el celular: esa 422 (lineas, sin campo para escribir) → bloqueada, solo «Cancelar»
  const v = C.confirmFailureView({ ok: false, code: 'fields_required', fields: ['lineas'] }, { editable: [], type: 'compra' });
  assert.equal(v.kind, 'blocked'); assert.equal(v.msg, 'No se puede confirmar esta compra desde el asistente. Ábrala en Nueva compra.');
});

test('5) PIN numérico: a lo sumo 2 palabras tras el enlace, sin unidad ni «en/del…» justo antes; con letras, igual que antes; dueño, empleado y modelo', () => {
  const masked = ['clave de producto 4521', 'El pin de la caja: 4321', 'El pin de la caja es 4321', 'El pin para la caja 4321', 'la contraseña de mi caja 98765432', 'la clave del pin es 1234', 'pin: 4321', 'El pin de la caja = 4321',
    'La clave del wifi: Zq9xK2mPw7', 'La clave del wifi Zq9xK2mPw7', 'El token de la api: Ab12Cd34Ef', 'La clave del wifi de la tienda: Zq9xK2mPw7', 'La clave del wifi de la tienda Zq9xK2mPw7'];
  const shown = [['Producto clave de la semana 2500 unidades', '2500'], ['El token de la sesión del 2026 venció', '2026'],
    ['La clave de la promo 2500 soles', '2500'], ['clave de la oferta 1500 S/ menos', '1500'], ['clave del mes 30%', '30']];
  // (decisión final sobre d72b7601 se tapaban; Bot 2 sobre 3ee80c18: año tras «en»/«del año» y «paquetes» como unidad) ahora se ven otra vez
  for (const [t, v] of [['Cambié la clave de la caja en 2024', '2024'], ['La clave del negocio en 2024 fue el arroz.', '2024']]) assert.ok(own(t).includes(v), t);
  // (Bot 2 sobre 5646a4c9, a propósito) unidad tras «:» ya no suelta el número
  assert.ok(!own('La clave de este mes: vender 3000 paquetes.').includes('3000'));
  // (Bot 2 sobre c16a407d, a propósito) credencial en la etiqueta (caja): la unidad ya no suelta el número
  assert.ok(!own('clave de la caja 4521 kg').includes('4521'));
  for (const f of [A.redactText, own, emp]) {
    for (const t of masked) { const o = f(t); assert.match(o, /\[oculto\]/, t + ' → ' + o); assert.ok(!/4521|4321|98765432|1234|Zq9xK2mPw7|Ab12Cd34Ef/.test(o), t + ' → ' + o); }
    for (const [t, v] of shown) { const o = f(t); assert.ok(o.includes(v), t + ' → ' + o); }
  }
  for (const t of [...masked, ...shown.map((x) => x[0])]) for (const n of [1, 3, 7]) { assert.equal(emitN(t, n, 'owner'), own(t), t); assert.equal(emitN(t, n, EMP), emp(t), t); }
});

function fakeDoc() {
  const mk = (tag) => ({ tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, value: '', id: '',
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, fire(t) { (this.listeners[t] || []).forEach((f) => f({ target: this })); }, focus() {} });
  return { createElement: mk };
}
test('6) celular (Bot 4): tras un 422 «Confirmar» sigue apagado hasta que el campo marcado cambie; 422 sin nada editable → aviso claro y solo «Cancelar»', () => {
  const doc = fakeDoc(), p = { id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: 'Juan', documento: 'F001-', completar: ['proveedor', 'documento'], lineas: [] };
  let changes = 0; const need = C.needFields(doc, p, () => { changes++; }); const [pv, dv] = need.inputs;
  pv.value = 'Juan Pérez'; pv.fire('input'); dv.value = 'F001-00012345'; dv.fire('input'); assert.equal(need.missing(), 0);
  // el servidor rechaza el documento (p. ej. tenía una máscara no ASCII que el celular no vio)
  assert.deepEqual(need.flag(['documento']), []); assert.equal(need.missing(), 1, 'apagado'); assert.equal(dv.value, 'F001-00012345', 'lo escrito queda');
  dv.fire('input'); assert.equal(need.missing(), 1, 'mismo valor: sigue apagado'); pv.value = 'Juan P.'; pv.fire('input'); assert.equal(need.missing(), 1, 'otro campo no cuenta');
  dv.value = 'F001-00012346'; dv.fire('input'); assert.equal(need.missing(), 0, 'cambió: se enciende'); assert.ok(changes >= 5);
  // los dos marcados: hay que cambiar los dos
  need.flag(['proveedor', 'documento']); assert.equal(need.missing(), 2); pv.value = 'Juan Pérez SAC'; pv.fire('input'); assert.equal(need.missing(), 1);
  // vistas
  const E = { editable: need.names, type: 'compra' };
  assert.equal(C.confirmFailureView({ ok: false, code: 'fields_required', fields: ['documento'] }, E).kind, 'fields');
  for (const r of [{ ok: false, code: 'fields_required', fields: ['lineas'] }, { ok: false, code: 'fields_required', fields: ['documento', 'title'] }, { ok: false, code: 'fields_required', fields: [] },
    { ok: false, code: 'over_limit', rows: [] }]) {
    const v = C.confirmFailureView(r, E); assert.equal(v.kind, 'blocked', JSON.stringify(r)); assert.equal(v.button, null); assert.equal(v.again, false); assert.equal(v.cancelOnly, true);
    assert.equal(v.msg, 'No se puede confirmar esta compra desde el asistente. Ábrala en Nueva compra.'); }
  const va = C.confirmFailureView({ ok: false, code: 'over_limit', rows: [], msg: 'La cantidad pasa el límite de 9999. Hazlo desde Inventario.' }, { editable: [], type: 'ajuste' });
  assert.equal(va.kind, 'blocked'); assert.equal(va.msg, 'La cantidad pasa el límite de 9999. Hazlo desde Inventario.');
  assert.equal(C.confirmFailureView({ ok: false, code: 'over_limit', rows: [1] }, E).kind, 'limit', 'con filas para quitar sigue editable');
  // cableado en la tarjeta: opciones al armar la vista; «blocked» esconde Confirmar y «Pedir de nuevo» y deja solo «Cancelar»
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  assert.match(UI, /C\.confirmFailureView\(r, \{ editable: need \? need\.names : \[\], type: p\.type \}\)/);
  assert.match(UI, /if \(f\.kind === 'blocked'\) \{ res\.textContent = f\.msg; if \(ok\) \{ ok\.hidden = true; ok\.disabled = true; \} if \(again\) again\.hidden = true; no\.hidden = false; no\.disabled = false; no\.textContent = 'Cancelar'; return; \}/);
  assert.match(UI, /ok\.disabled = n > 0 \|\| miss > 0;/);
});

test('cardPrefix: «F001-DNI» y «F001-RUC» (con o sin máscara) → «F001-»; «F001-0001» y valores normales quedan exactos', () => {
  for (const v of ['F001-DNI', 'F001-RUC', 'F001-DNI ****5678', 'F001-RUC *******9012', 'F001-RUC N°: ••••9012', 'F001-dni', 'F001-DNI:']) assert.equal(A.cardPrefix(v), 'F001-', v);
  for (const v of ['F001-0001', 'F001-00012345', 'B001-1', 'Alicorp SAC', 'Gloria (Lima)', 'Ruc Industrial SAC']) assert.equal(A.cardPrefix(v), v, v);
});

test('403 forbidden_role al confirmar: la propuesta y lo escrito salen de la memoria, sin reintento; igual sea cual sea el rol guardado en el aparato', async () => {
  const roleSets = [{ role: 'owner', isOwner: () => true }, { role: 'owner' }];
  const results = [];
  for (const start of roleSets) for (const after of [null, { role: 'empleado', level: 'consultas' }, { role: 'owner', isOwner: () => true }, undefined]) {
    let cur = start, calls = 0, opened = 0;
    const p = { id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: 'Juan', documento: 'F001-', completar: ['documento'], lineas: [{ nombre: 'G', cantidad: 1, costo_unitario: 1 }] };
    const manual = { documento: 'F001-00012345' }; Object.defineProperty(p, '_manual', { value: manual, enumerable: false, configurable: true });
    // el rol guardado cambia mientras el confirm está en curso: no debe importar
    const g = C.createGate({ roles: () => cur, online: () => true, productos: () => [], confirm: async () => { calls++; cur = after; return { ok: false, error: 'forbidden_role' }; },
      openPurchase: () => { opened++; return null; }, fillPurchase: () => true, navigate: () => {} });
    const key = g.add(p); const r = await g.execute(key, { confirmed: true });
    assert.equal(r.code, 'forbidden_role'); assert.equal(r.dropped, true); assert.equal(r.msg, 'Esta sesión ya no es de Admin. Vuelva a entrar como Admin y pida la compra de nuevo.');
    assert.equal(g.state(key), null, 'la puerta la olvidó'); assert.equal(g.proposal(key), null); assert.equal(g.size(), 0);
    assert.deepEqual(Object.keys(manual), [], 'lo escrito se vació'); assert.equal(p._manual, undefined);
    const again = await g.execute(key, { confirmed: true }); assert.equal(again.ok, false); assert.equal(calls, 1, 'sin reintento'); assert.equal(opened, 0);
    results.push(JSON.stringify({ code: r.code, msg: r.msg, dropped: r.dropped, state: g.state(key), size: g.size(), again: again.msg }));
  }
  assert.equal(new Set(results).size, 1, 'mismo resultado con cualquier rol guardado');
  // la tarjeta: sale del DOM, sin rol del aparato ni reintento; aviso con «Cerrar», solo createElement/textContent
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  assert.match(UI, /if \(r && r\.code === 'forbidden_role'\) \{ roleLost\(c, key, p, need\); return; \}/);
  const fn = UI.slice(UI.indexOf('function roleLost'), UI.indexOf('function accessLost'));
  assert.ok(/gate\.forget\(key\)/.test(fn) && /wipeCard\(c\)/.test(fn) && /card\.remove\(\)/.test(UI.slice(UI.indexOf('function wipeCard'), UI.indexOf('function roleLost'))) && /C\.wipeManual\(p\)/.test(fn) && /b\.textContent = 'Cerrar'/.test(fn) && /t\.textContent = C\.ROLE_LOST_MSG/.test(fn));
  // (Bot 5 sobre d72b7601) ahora sí pregunta el rol al SERVIDOR (refreshAccess) tras olvidar todo; sigue sin mirar el rol guardado ni reintentar
  assert.ok(!/access\b|roles\(|isOwner|setTimeout|send\(|innerHTML|localStorage/.test(fn), 'no mira el rol guardado ni reintenta');
  assert.ok(UI.indexOf("r.code === 'forbidden_role'") < UI.indexOf('if (r && ACCESS_LOST[r.code])'), 'antes del cierre general');
});
