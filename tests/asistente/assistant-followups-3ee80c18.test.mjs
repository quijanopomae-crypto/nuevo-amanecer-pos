// Sobre 3ee80c18 (Bot 5 ev-3ee80c18; decisión de la sala con Bots 2/5): 1) la excepción de código/EAN/barras nunca tras «pin» y, tras
// clave/contraseña, solo con «producto»/«artículo» en medio (sin importar los dígitos); 2) lo escrito a mano: NFC, fuera \p{Cf}, U+FE00-FE0F,
// U+E0000-E007F, U+034F y marcas combinantes sueltas, igual en servidor y celular; 3) CONTRATO.md al día con el código; 4) tras un 200, «Nueva
// compra» toma lo escrito del cuerpo que se MANDÓ (sentBody.manual). Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
const { toProposal, issueConfirmToken, assistantConfirmRoute, createMemoryUsageStore, normManual, manualBad } = A;
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas_documentos';
const has = (t, v) => new RegExp('(^|[^\\w])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])').test(t);
const vias = { emp: A.redactFor(EMP), own: A.redactFor('owner'), mEmp: A.redactText, mOwn: A.redactModelOwner };
function stream(role, t, step) { const red = A.redactFor(role); let o = '', seen = ''; const e = A.createTextEmitter((d) => { if (d.reset) o = ''; else { o += d.t || ''; seen += d.t || ''; } }, A.REPLY_MAX, red, role === 'owner' ? null : A.ownerHold);
  for (let i = 0; i < t.length; i += step) e.push(t.slice(i, i + step)); e.flush(); return { o, seen }; }

// Sondas de Bot 5 (pin-3ee.mjs, FALLA 1) + las 3 de la sala: tapadas en las 4 vías y en partes
const SECRET_PIN = [
  ['pin código 4321', '4321'], ['clave: código 4321', '4321'], ['contraseña cod 4321', '4321'], ['pin del EAN 4321', '4321'], ['pin cód. 4321', '4321'],
  ['PIN EAN-13 4321', '4321'], ['el pin es el código 4321', '4321'], ['la clave de la caja es código 4321', '4321'], ['clave de barras 4321', '4321'],
  ['contraseña del código 4321', '4321'], ['pin de acceso código 4321', '4321'], ['clave código: 4321', '4321'], ['pin códigos 4321', '4321'],
  ['la clave del wifi: cod 98765432', '98765432'], ['la clave del código de barras de la caja es 4321', '4321'], ['el código de acceso del pin es 4321', '4321'],
  ['clave del wifi código 12345678', '12345678'], ['contraseña del local cod 12345678', '12345678'],   ['pin código 77501234', '77501234'], ['pin del producto código 77501234', '77501234'], ['Clave: cód. 4321', '4321'],
  // las 4 regresiones de Bot 2 siguen tapadas
  ['la clave de la caja fuerte 4321', '4321'], ['la clave de la caja chica 4321', '4321'], ['la clave de la caja fuerte: 4321', '4321'], ['clave de la caja en 2024 era 4321', '4321'],
];

test('FALLA 1: código/EAN/barras ya no suelta un PIN tras «pin» ni tras clave/contraseña sin «producto/artículo» (4 vías)', () => {
  for (const [t, v] of SECRET_PIN) for (const [via, f] of Object.entries(vias)) assert.ok(!has(f(t), v), via + ': ' + JSON.stringify(t) + ' → ' + JSON.stringify(f(t)));
});

test('FALLA 1 en partes de 1/3/7: nunca se ve el número y el final es igual al texto entero', () => {
  for (const [t, v] of SECRET_PIN) for (const role of [EMP, 'owner']) for (const step of [1, 3, 7]) {
    const s = stream(role, t, step), fin = A.capReply(A.redactFor(role)(t));
    assert.equal(s.o, fin, role + '/' + step + ' ' + JSON.stringify(t)); assert.ok(!has(s.seen, v), 'se vio en partes ' + role + '/' + step + ' ' + JSON.stringify(t) + ' → ' + JSON.stringify(s.seen));
  }
});

test('«pin cód. 4321»: el punto de «cód.» no corta la frase y no se tapa la palabra «cód»', () => {
  assert.equal(A.redactOwnerText('pin cód. 4321'), 'pin cód. [oculto]'); assert.equal(A.redactText('pin cód. 4321'), 'pin cód. [oculto]');
  assert.equal(A.redactOwnerText('pin código 4321'), 'pin código [oculto]'); assert.equal(A.redactOwnerText('pin del EAN 4321'), 'pin del EAN [oculto]');
});

test('con «producto/artículo» en medio, tras clave/contraseña el dueño ve su código (sin importar los dígitos); nunca tras «pin»', () => {
  const VIS = [['clave del producto Arroz código 77501234', '77501234'], ['clave del producto código 77501234', '77501234'], ['clave del producto Arroz código EAN 7750123', '7750123'],
    ['contraseña del artículo cód. 4321', '4321'], ['clave de los productos código 4321', '4321']];
  for (const [t, v] of VIS) for (const f of [A.redactOwnerText, A.redactModelOwner]) assert.ok(has(f(t), v), JSON.stringify(t) + ' → ' + JSON.stringify(f(t)));
  for (const [t, v] of VIS) for (const step of [1, 3, 7]) assert.ok(has(stream('owner', t, step).o, v), 'partes ' + step + ' ' + JSON.stringify(t));
  // sin «producto»: tapado de más aceptado
  assert.ok(!has(A.redactOwnerText('clave de barras del arroz 77501234'), '77501234'));
  // el empleado nunca ve 8 dígitos sueltos
  assert.ok(!has(A.redactFor(EMP)('clave del producto Arroz código 77501234'), '77501234'));
});

test('sin pin/clave/contraseña no cambia nada (lo decide el dueño)', () => {
  for (const t of ['código de acceso 4321', 'el código de la caja fuerte es 4321', 'código de la alarma 1234', 'código de seguridad 4321'])
    for (const f of [A.redactOwnerText, A.redactModelOwner]) assert.equal(f(t), t);
  assert.equal(A.redactOwnerText('Producto clave de la semana 2500 unidades'), 'Producto clave de la semana 2500 unidades');
  assert.equal(A.redactOwnerText('clave de la venta S/ 1250'), 'clave de la venta S/ [oculto]');
});

test('un «[oculto]» de OTRA etiqueta no deja a la vista el valor de la primera (texto entero = en partes)', () => {
  const T = [['api key sk-123456, la clave 4321', 'sk-123456'], ['token abc123xyz y el pin 4321', 'abc123xyz'], ['clave Zq9xK2 y pin 4321', 'Zq9xK2'],
    ['lo compré a S/ 1.10. api key sk-123456,  + name + , la clave del wifi: cod 98765432 | Galleta |', 'sk-123456']];
  for (const [t, v] of T) { for (const [via, f] of Object.entries(vias)) { assert.ok(!has(f(t), v), via + ' ' + JSON.stringify(f(t))); assert.ok(!has(f(t), '4321') && !has(f(t), '98765432')); }
    for (const role of [EMP, 'owner']) for (const step of [1, 3, 7]) { const s = stream(role, t, step); assert.equal(s.o, A.capReply(A.redactFor(role)(t))); assert.ok(!has(s.seen, v)); } }
  assert.equal(A.redactOwnerText('pin por favor 4321'), 'pin por favor [oculto]');
  assert.equal(A.redactOwnerText('pin 1111 y la clave 2222'), 'pin [oculto] y la clave [oculto]');
});

// ---------- 2) normalización de lo escrito ----------
const MARKS = [['U+0301', '*\u0301*6789'], ['U+20DD', '•\u20DD•6789'], ['U+00AD', '*\u00AD*\u00AD*6789'], ['U+2061', '*\u2061*6789'], ['U+FE0F', '*\uFE0F*6789'],
  ['U+034F', '*\u034F*6789'], ['U+E0020', '*\u{E0020}*6789'], ['U+FE00', '*\uFE00*6789'], ['U+200E', '*\u200E*6789'], ['U+2064', '*\u2064*6789'], ['U+180E', '*\u180E*6789'],
  ['solo marcas', '\u0301\u20DD'], ['solo bidi', '\u202E\u202C\u2066\u2069'], ['solo etiquetas', '\u{E0041}\u{E0042}']];
const KEEP = [['\u202E1234-100F\u202C', '1234-100F'], ['\u2066F001-00012345\u2069', 'F001-00012345'], ['\u202AF001-0001\u202C', 'F001-0001'],
  ['Jose\u0301 Pe\u0301rez', 'José Pérez'], ['Distribuidora Nin\u0303o', 'Distribuidora Niño'], ['Ferretería XXL SAC', 'Ferretería XXL SAC'], ['Bodega\u00AD Juan', 'Bodega Juan'],
  ['1\u20DD2\u20DD34-F001', '1234-F001'], ['Ana\uFE0F Lopez', 'Ana Lopez']];

test('normManual: servidor y celular IGUALES carácter por carácter; marcas y formato fuera; «José» combinante válido', () => {
  for (const [, v] of MARKS) for (const n of ['proveedor', 'documento']) {
    const s = normManual(v), c = C.normManual(v); assert.equal(c, s, JSON.stringify(v));
    assert.equal(manualBad(n, s), true, n + ' ' + JSON.stringify(v) + ' → ' + JSON.stringify(s)); assert.equal(C.manualBad(n, c), true, n + ' celular ' + JSON.stringify(v));
  }
  for (const [v, want] of KEEP) { const s = normManual(v), c = C.normManual(v); assert.equal(s, want, JSON.stringify(v)); assert.equal(c, s);
    assert.equal(manualBad('proveedor', s), false, JSON.stringify(v)); assert.equal(C.manualBad('proveedor', c), false); }
  assert.ok(!/[\u202A-\u202E\u2066-\u2069]/.test(normManual('\u202E1234-100F\u202C')), 'sin controles de dirección');
  assert.equal(normManual('Jose\u0301'), 'Jos\u00E9'); assert.equal(C.normManual('Jose\u0301'), 'Jos\u00E9');
});

test('normManual: paridad servidor = celular en cada carácter \\p{Cf}/\\p{M} entre relleno y junto a una letra', () => {
  const cps = [0x00AD, 0x0300, 0x0301, 0x0327, 0x034F, 0x0600, 0x061C, 0x200B, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064,
    0x2066, 0x2067, 0x2068, 0x2069, 0x20DD, 0x20E3, 0xFE00, 0xFE0E, 0xFE0F, 0xFEFF, 0xE0001, 0xE0020, 0xE007F];
  for (const cp of cps) { const ch = String.fromCodePoint(cp);
    for (const v of ['*' + ch + '*6789', 'a' + ch + 'b', ch + 'F001-1', '1' + ch + '2']) { const s = normManual(v), c = C.normManual(v); assert.equal(c, s, cp.toString(16) + ' ' + JSON.stringify(v));
      assert.ok(!/[\p{Cf}\uFE00-\uFE0F\u034F]/u.test(s), 'quedó formato ' + cp.toString(16)); }
    assert.equal(manualBad('documento', normManual('*' + ch + '*6789')), true, cp.toString(16));
  }
});

const SECRET = 'secreto-de-prueba-1234567890', AUTH = { principalId: 'session:dueno', posRole: 'owner' };
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const reader = { products: async () => [], productsById: async () => new Map(), purchases: async () => [] };
async function confirm(proposal, manual) {
  const token = await issueConfirmToken(proposal, 'owner', AUTH, SECRET, Date.now());
  const res = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token, proposal, manual }) }), { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET }, AUTH, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', reader, audit: async () => {} });
  return { status: res.status, body: await res.json() };
}
const prop = () => toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345 pedido 87654321', lineas: [{ nombre: 'Galleta', cantidad: 3, costo_unitario: 1.2 }] } }, 'owner', { products: [] }, 1);

test('servidor /confirm: 422 con marcas/formato entre relleno; bidi fuera y «José» combinante se guardan normalizados', async () => {
  for (const [, v] of MARKS) for (const n of ['proveedor', 'documento']) {
    const other = n === 'proveedor' ? { documento: 'F001-00012345' } : { proveedor: 'Bodega Juan SAC' };
    const r = await confirm(prop(), { ...other, [n]: v }); assert.equal(r.status, 422, n + ' ' + JSON.stringify(v)); assert.deepEqual(r.body.fields, [n]);
  }
  const r1 = await confirm(prop(), { proveedor: 'Jose\u0301 Pe\u0301rez', documento: '\u202E1234-100F\u202C' });
  assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.equal(r1.body.proposal.proveedor, 'José Pérez'); assert.equal(r1.body.proposal.documento, '1234-100F');
});

// ---------- 4) 200: «Nueva compra» con lo que se MANDÓ ----------
const owner = { role: 'owner', isOwner: () => true };
test('200: «Nueva compra» toma sentBody.manual (lo mandado), no lo escrito en vivo en los campos', async () => {
  let filled = null; const p = { id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 'tok-c1', proveedor: 'Bodega Juan', documento: 'F001-', completar: ['documento'], lineas: [{ nombre: 'Galleta', cantidad: 1, costo_unitario: 1 }] };
  const live = { documento: 'F001-00012345' }; Object.defineProperty(p, '_manual', { value: live, enumerable: false, configurable: true });
  const signed = JSON.parse(JSON.stringify(p)); delete signed.confirm_token;
  const sentBody = { token: 'tok-c1', proposal: signed, manual: { documento: 'F001-00012345' } };
  const deps = { roles: () => owner, online: () => true, productos: () => [], navigate: () => {}, openPurchase: () => ({ querySelector: () => null }),
    fillPurchase: (w, ap) => { filled = C.purchaseValue(ap, 'documento'); return true; },
    confirm: async () => { live.documento = 'F001-99999999'; const r = { ok: true, operation_id: 'AST-1', proposal: JSON.parse(JSON.stringify(signed)) }; Object.defineProperty(r, 'sentBody', { value: sentBody }); return r; } };
  const g = C.createGate(deps), key = g.add(p); const r = await g.execute(key, { confirmed: true });
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(filled, 'F001-00012345', 'lo mandado, no lo forzado en el campo después');
  // sin cuerpo guardado (puerta sin confirmRemote): lo escrito, como antes
  let f2 = null; const p2 = { ...p }; Object.defineProperty(p2, '_manual', { value: { documento: 'F001-00054321' }, enumerable: false, configurable: true });
  const g2 = C.createGate({ ...deps, fillPurchase: (w, ap) => { f2 = C.purchaseValue(ap, 'documento'); return true; }, confirm: async () => ({ ok: true, operation_id: 'AST-2', proposal: JSON.parse(JSON.stringify(signed)) }) });
  const k2 = g2.add(p2); assert.ok((await g2.execute(k2, { confirmed: true })).ok); assert.equal(f2, 'F001-00054321');
  const CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
  assert.match(CORE, /var km2 = sentNow \? \(sentNow\.manual/);
});

// ---------- 3) CONTRATO.md ----------
test('CONTRATO.md: 409 same_session con propuesta firmada, «otra sesión» con already_confirmed, «otro aparato» solo con 403 other_device', () => {
  const md = readFileSync(new URL('../../docs/asistente/CONTRATO.md', import.meta.url), 'utf8');
  assert.doesNotMatch(md, /409 `already_confirmed` → nota corta «Esta compra ya se confirmó en otro aparato\.»/);
  assert.match(md, /409 `\{ error:'already_confirmed_same_session'[^`]*proposal \}` con la propuesta FIRMADA/);
  assert.ok(md.includes('«' + C.FRIENDLY.already_confirmed[0] + '»')); assert.equal(C.FRIENDLY.already_confirmed[0], 'Esta compra ya se confirmó en otra sesión.');
  assert.ok(md.includes('«' + C.OTHER_DEVICE_DONE_MSG + '» SOLO con 403 `other_device` + `confirmed:true`'));
  assert.ok(md.includes('«' + C.SAME_SESSION_MSG + '»'));
  assert.match(md, /## Ampliación sobre 3ee80c18/);
});

// ---------- Ronda Bot 2 / Bot 4 sobre 3ee80c18 ----------
test('A) dinero tras pin/clave/contraseña: S/, $, PEN ya no sueltan el número solos; sí con precio/costo/monto en medio; decimales nunca entran', () => {
  const MASK = [['clave de la caja S/ 4321', '4321'], ['pin de cobro S/ 1250', '1250'], ['clave $4321', '4321'], ['contraseña PEN 4321', '4321'], ['clave: EAN 4321', '4321'],
    ['la clave es cód 4321', '4321'], ['contraseña: barras 87654321', '87654321'], ['clave de acceso, código 12345678', '12345678'], ['el pin del cajero es código de barras 4321', '4321'],
    ['clave de la caja: código 4321', '4321'], ['el pin es código 4321', '4321']];
  for (const [t, v] of MASK) { for (const [via, f] of Object.entries(vias)) assert.ok(!has(f(t), v), via + ' ' + JSON.stringify(t) + ' → ' + f(t));
    for (const role of [EMP, 'owner']) for (const step of [1, 3, 7]) { const s = stream(role, t, step); assert.ok(!has(s.seen, v), role + '/' + step + ' ' + t); assert.equal(s.o, A.capReply(A.redactFor(role)(t))); } }
  // (Bots 2/5 sobre 6e0b3c5d, regla final, a propósito) un ENTERO tras clave/contraseña ya no se suelta por dinero: «clave del precio: S/ 4521»,
  // «la clave del costo es S/ 1250», «clave del monto PEN 3000» se tapan; con céntimos y palabra de precio justo antes, sí se ve
  for (const [t, v] of [['clave del precio: S/ 4521', '4521'], ['la clave del costo es S/ 1250', '1250'], ['clave del monto PEN 3000', '3000']])
    for (const f of [A.redactOwnerText, A.redactModelOwner]) assert.ok(!has(f(t), v), JSON.stringify(t) + ' → ' + f(t));
  for (const [t, v] of [['clave del precio S/ 43.21', '43.21'], ['Factura F001-00012345 total S/ 4521.00', '4521.00']])
    for (const f of [A.redactOwnerText, A.redactModelOwner]) assert.ok(has(f(t), v), JSON.stringify(t) + ' → ' + f(t));
  // (Bot 2 sobre 5646a4c9, a propósito) «clave S/ 43.21» ya NO se ve: un decimal tras clave/contraseña solo se ve con precio/costo/monto
  for (const f of [A.redactOwnerText, A.redactModelOwner]) assert.ok(!has(f('clave S/ 43.21'), '43.21'));
  // (Bot 5 sobre 5646a4c9, a propósito) «pin del precio S/ 4321» ya NO se ve: tras «pin» ninguna excepción de dinero (ver assistant-followups-5646a4c9)
  for (const f of [A.redactOwnerText, A.redactModelOwner]) assert.ok(!has(f('pin del precio S/ 4321'), '4321'));
  // códigos del dueño sin pin/clave: exactos
  for (const t of ['código 12345678', 'EAN 7751234567890', 'cód. 4521', 'cód. 4521 Arroz']) { assert.equal(A.redactOwnerText(t), t); assert.equal(A.redactModelOwner(t), t); }
});

test('B) menos tapado de más: paquetes/cajas/bolsas/docenas/sacos/botellas y año tras «del año/el año/en» (solo clave/contraseña); el 4321 que sigue se tapa', () => {
  // (Bot 2 sobre 5646a4c9, a propósito) con «:» o es/era entre la etiqueta y el número la unidad ya no suelta: «La clave de este mes: vender 3000 paquetes»,
  // «la clave es comprar 2000 cajas», «la clave es pedir 1200 docenas», «la clave es tener 4000 sacos» se tapan (ver assistant-followups-5646a4c9)
  for (const t of ['La clave de este mes: vender 3000 paquetes', 'la clave es comprar 2000 cajas', 'la clave es pedir 1200 docenas', 'la clave es tener 4000 sacos']) assert.ok(!/\d{4}/.test(A.redactOwnerText(t)), t);
  const SHOW = [['clave del mes 1500 bolsas', '1500'], ['clave del verano 2500 botellas', '2500'], ['clave del día 1000 paquete', '1000'], ['clave del año 2024', '2024'], ['la clave del éxito en 2024 fue el arroz', '2024'],
    ['Cambié la clave de la caja en 2024', '2024'], ['contraseña del año 2024', '2024'], ['Mi clave para el año 2025: vender más', '2025']];
  for (const [t, v] of SHOW) for (const f of [A.redactOwnerText, A.redactModelOwner, A.redactFor(EMP)]) assert.ok(has(f(t), v), JSON.stringify(t) + ' → ' + f(t));
  for (const [t, v] of SHOW) for (const step of [1, 3, 7]) assert.equal(stream('owner', t, step).o, A.capReply(A.redactOwnerText(t)));
  const MASK = [['clave de la caja en 2024 era 4321', '4321'], ['pin 4321 paquetes', '4321'], ['pin 4321 cajas', '4321'], ['el pin del año 2024', '2024'], ['pin en 2019', '2019'],
    ['clave del año 2024 es 4321', '4321'], ['clave en 2580', '2580'], ['clave del año 1234', '1234'], ['la clave de la caja fuerte 4321', '4321']];
  for (const [t, v] of MASK) { for (const [via, f] of Object.entries(vias)) assert.ok(!has(f(t), v), via + ' ' + JSON.stringify(t) + ' → ' + f(t));
    for (const role of [EMP, 'owner']) for (const step of [1, 3, 7]) assert.ok(!has(stream(role, t, step).seen, v), role + '/' + step + ' ' + t); }
});

const UI_SRC = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const CSS_SRC = readFileSync(new URL('../../POS/css/asistente.css', import.meta.url), 'utf8');
test('C) documento/RUC/proveedor: dir="ltr" + unicode-bidi:isolate en la tarjeta, en «Complete este dato» y en «Nueva compra» (solo desde asistente-ui.js)', async () => {
  const vm = await import('node:vm');
  assert.match(CSS_SRC, /\.na-asst-ltr\{direction:ltr;unicode-bidi:isolate\}/);
  assert.match(UI_SRC, /if \(x\[1\]\) ltrIsolate\(sp\); C\.appendCoded\(doc, sp, String\(x\[0\]\)\)/);
  assert.match(UI_SRC, /if \(need && need\.inputs\) need\.inputs\.forEach\(function \(i\) \{ ltrIsolate\(i\); \}\)/);
  const mk = (id) => ({ id, attrs: {}, className: id === 'naPurDoc' ? 'x' : '', style: {}, value: '', dataset: {}, setAttribute(k, v) { this.attrs[k] = String(v); } });
  // ltrIsolate real
  const i0 = UI_SRC.indexOf('  function ltrIsolate('), i1 = UI_SRC.indexOf('\n  var deps = {', i0); assert.ok(i0 > 0 && i1 > i0);
  const ctx = vm.createContext({}); vm.runInContext(UI_SRC.slice(i0, i1), ctx);
  const sp = mk('sp'); ctx.ltrIsolate(sp); assert.equal(sp.attrs.dir, 'ltr'); assert.match(sp.className, /\bna-asst-ltr\b/); assert.equal(sp.style.unicodeBidi, 'isolate'); assert.equal(sp.style.direction, 'ltr');
  // fillPurchase real con «U+202E 1234-100F» ya normalizado
  const j0 = UI_SRC.indexOf('fillPurchase: function (w, p) {'), j1 = UI_SRC.indexOf('    // Ficha EXISTENTE', j0);
  const src = UI_SRC.slice(j0, j1).replace(/^fillPurchase: /, '').replace(/,\s*$/, '');
  const sup = mk('naPurSupplier'), dn = mk('naPurDoc');
  const w = { dataset: {}, querySelector: (q) => (q === '#naPurSupplier' ? sup : q === '#naPurDoc' ? dn : null), querySelectorAll: () => [], dispatchEvent() {} };
  const fill = vm.runInContext('(' + src + ')', vm.createContext({ C, Event: class { constructor(t) { this.type = t; } }, deps: { productos: () => [] } }));
  const typed = '\u202E1234-100F\u202C', norm = C.normManual(typed); assert.equal(norm, '1234-100F'); assert.equal(normManual(typed), norm);
  const p = { type: 'compra', proveedor: 'Bodega Juan RUC 20123456789', documento: 'F001-', completar: ['documento'], lineas: [] };
  Object.defineProperty(p, '_manual', { value: { documento: typed }, enumerable: false });
  fill(w, p);
  assert.equal(dn.value, '1234-100F'); assert.ok(!/[\u202A-\u202E\u2066-\u2069]/.test(dn.value));
  for (const n of [sup, dn]) { assert.equal(n.attrs.dir, 'ltr'); assert.match(n.className, /\bna-asst-ltr\b/); assert.equal(n.style.unicodeBidi, 'isolate'); }
  assert.match(dn.className, /^x na-asst-ltr$/, 'conserva la clase del POS');
  // sin tocar el núcleo de compras
  assert.doesNotMatch(readFileSync(new URL('../../POS/js/config/pos-purchases-client.js', import.meta.url), 'utf8'), /na-asst-ltr/);
});

test('D) normalización: revisiones sobre NFC y copia NFKC; ∙ ✱ ⁎ y ancho completo; «x x 6789» en documento; «*6789» en proveedor; servidor = celular', () => {
  const BAD = [['documento', '＿＿＿＿6789'], ['documento', '＃＃＃＃6789'], ['proveedor', '＿＿＿＿'], ['proveedor', '＃＃＃＃'], ['proveedor', '∙∙∙∙'], ['proveedor', '✱✱✱✱'], ['proveedor', '⁎⁎⁎⁎'],
    ['documento', '∙∙∙∙6789'], ['documento', 'x x 6789'], ['documento', 'X-X-6789'], ['documento', 'F001-x x 6789'], ['documento', 'XX6789'], ['proveedor', '*6789'], ['proveedor', 'Bodega *6789'],
    ['proveedor', '＊6789'], ['proveedor', '∗6789'], ['documento', '*6789'], ['documento', '…6789'], ['proveedor', '……'], ['proveedor', 'Bodega ••••']];
  const OK = [['proveedor', 'Ferretería XXL SAC'], ['proveedor', 'Distribuidora XX'], ['proveedor', 'XX6789'], ['proveedor', 'Promo 2*1 SAC'], ['proveedor', 'Juan ∙ Lima'],
    ['documento', 'Taxi x 6789'], ['documento', 'F001-00012345'], ['proveedor', 'ＡＢＣ ＳＡＣ'], ['proveedor', 'José Pérez'], ['documento', '0001-123']];
  for (const [n, v] of BAD) { const s = normManual(v), c = C.normManual(v); assert.equal(c, s); assert.equal(manualBad(n, s), true, n + ' ' + v); assert.equal(C.manualBad(n, c), true, n + ' celular ' + v); }
  for (const [n, v] of OK) { const s = normManual(v), c = C.normManual(v); assert.equal(c, s); assert.equal(manualBad(n, s), false, n + ' ' + v); assert.equal(C.manualBad(n, c), false, n + ' celular ' + v); }
  // se guarda el NFC (no el NFKC): el ancho completo queda como se escribió
  assert.equal(normManual('ＡＢＣ ＳＡＣ'), 'ＡＢＣ ＳＡＣ'); assert.equal(C.normManual('ＡＢＣ ＳＡＣ'), 'ＡＢＣ ＳＡＣ');
});

test('D) servidor /confirm: 422 con ＿＿＿＿6789, x x 6789, *6789 en proveedor; 200 con «Promo 2*1 SAC»', async () => {
  for (const [n, v] of [['documento', '＿＿＿＿6789'], ['documento', 'x x 6789'], ['proveedor', '*6789'], ['proveedor', '✱✱✱✱']]) {
    const other = n === 'proveedor' ? { documento: 'F001-00012345' } : { proveedor: 'Bodega Juan SAC' };
    const r = await confirm(prop(), { ...other, [n]: v }); assert.equal(r.status, 422, n + ' ' + v); assert.deepEqual(r.body.fields, [n]);
  }
  const r = await confirm(prop(), { proveedor: 'Promo 2*1 SAC', documento: 'F001-00012345' }); assert.equal(r.status, 200, JSON.stringify(r.body));
});
