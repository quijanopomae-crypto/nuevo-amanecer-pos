// #967, lado del TELÉFONO: tarjetas «configuracion» con destino:'servidor' (datos del negocio y del ticket).
// - Las aplica el Admin o el nivel 3 con «costos y cambios» (roles.cambios del ping); las del aparato (#972) siguen solo del Admin.
// - Van a /auth/assistant/confirm (el servidor guarda); el teléfono NO usa su ejecutor de Configuración. 409 → aviso claro, sin marcar aplicada.
// - Al aplicar, se vuelven a leer pos.business, pos.ticket y pos.flags (NA_CONFIG_G.pullSettings) sin recargar la página.
// - RUC tapado: la tarjeta llega sin valor y con el campo a completar; se escribe en el teléfono (11 dígitos), va en body.manual del confirm
//   y en ningún pedido al chat/IA.
// Sin red: fetch falso; el confirm de punta a punta usa la ruta real del Worker con pos_settings en memoria.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { assistantChatRoute, assistantConfirmRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { COSTS_ROLE } from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';
import { makeDoc } from './fake-dom.mjs';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });

const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
const sliceFn = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

// Núcleo + post/confirmRemote REALES del teléfono, con fetch falso en la ventana.
function phone(fetchImpl) {
  const win = { addEventListener() {}, removeEventListener() {} };
  const ctx = vm.createContext({ window: win, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, console, Intl, URL, TextEncoder, TextDecoder });
  vm.runInContext(CORE, ctx); const C = win.NA_ASISTENTE_CORE;
  const calls = []; win.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return fetchImpl(url, init, calls.length); };
  const ui = vm.createContext({ C, root: win, reqInit: (path, body) => ({ url: path, init: { method: 'POST', body: JSON.stringify(body) } }), setTimeout, Promise, Object, JSON, Error, Array });
  vm.runInContext(sliceFn(UI, '  async function post(', '  // Confirmación: el MISMO token') + sliceFn(UI, '  async function confirmRemote(', '  // ---------- Funciones existentes del POS'), ui);
  return { C, win, calls, confirmRemote: ui.confirmRemote };
}
const assertJ = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const resp = (d, s = 200) => ({ status: s, ok: s >= 200 && s < 300, json: async () => d });
const ADMIN = { role: 'owner', level: undefined, isOwner: () => true };
const L3C = { role: 'empleado', level: 'consultas_documentos', cambios: true };
const L3 = { role: 'empleado', level: 'consultas_documentos', cambios: false };
const L2 = { role: 'empleado', level: 'consultas_documentos' }, L1 = { role: 'empleado', level: 'consultas' };
let seq = 0;
const serverCard = (over = {}) => ({ id: 'cfg-' + (++seq), type: 'configuracion', needsConfirm: true, title: 'Cambiar configuración', ajuste: 'ticket_pie', nombre: 'Pie del ticket', alcance: 'todos los aparatos', destino: 'servidor', antes: '¡GRACIAS!', valor: 'Vuelva pronto', confirm_token: 'tok-' + seq, ...over });
const deviceCard = (over = {}) => ({ id: 'dev-' + (++seq), type: 'configuracion', needsConfirm: true, title: 'Cambiar configuración', ajuste: 'modo', nombre: 'Modo', alcance: 'este aparato', antes: 'claro', valor: 'noche', confirm_token: 'tok-' + seq, ...over });
function gateFor(C, roles, confirm, extra = {}) {
  const log = { reload: 0, device: 0 };
  const deps = { roles: () => roles, confirm, online: () => true, reloadSettings: () => { log.reload++; return Promise.resolve(); }, applyConfiguration: async () => { log.device++; return { ok: true, msg: 'aparato' }; }, ...extra };
  return { gate: C.createGate(deps), log };
}

test('permisos: Admin y nivel 3 con «cambios» aplican tarjetas del servidor; las del aparato (#972) solo el Admin; nivel 3 sin cambios, 2 y 1 no', () => {
  const { C } = phone(async () => resp({}));
  for (const k of C.SERVER_CONFIG_KEYS) { assert.equal(C.canExecute(ADMIN, serverCard({ ajuste: k })).ok, true, k); assert.equal(C.canExecute(L3C, serverCard({ ajuste: k })).ok, true, k); }
  assertJ([...C.SERVER_CONFIG_KEYS].sort(), ['avisos', 'negocio_direccion', 'negocio_nombre', 'negocio_ruc', 'ticket_ancho', 'ticket_forma_pago', 'ticket_igv', 'ticket_logo', 'ticket_pie']);
  assert.equal(C.canExecute(ADMIN, deviceCard()).ok, true);
  const dv = C.canExecute(L3C, deviceCard()); assert.equal(dv.ok, false); assert.match(dv.msg, /solo del Admin/);
  // una clave de #972 marcada «servidor» o una clave desconocida tampoco
  assert.equal(C.canExecute(L3C, serverCard({ ajuste: 'stock_minimo' })).ok, false); assert.equal(C.canExecute(L3C, serverCard({ ajuste: 'pin' })).ok, false);
  for (const r of [L3, L2, L1, { ...L1, cambios: true }]) {
    const res = C.canExecute(r, serverCard());
    assert.equal(res.ok, false, JSON.stringify(r)); assert.match(res.msg, /Admin/); }
  // cambios:true no abre nada más (compra, precio, costo, ajuste, producto siguen del Admin)
  for (const type of ['compra', 'precio', 'costo', 'ajuste', 'producto']) assert.equal(C.canExecute(L3C, { type, needsConfirm: true }).ok, false, type);
  // sin nivel del servidor, cambios no sirve
  assert.equal(C.canExecute({ role: 'empleado', level: 'off', cambios: true }, serverCard()).ok, false);
});

test('nivel 1 con cambios:true (no lo manda el servidor) sigue sin poder: el permiso es solo del nivel 3', () => {
  // El servidor solo marca cambios para el nivel 3 + «costos y cambios»; si un ping raro lo trajera con nivel 1, la barrera final es el confirm (403).
  const { C } = phone(async () => resp({}));
  assert.equal(C.canExecute({ role: 'empleado', level: 'consultas', cambios: true }, serverCard()).ok, false);
});

test('tarjeta del servidor: va a /auth/assistant/confirm con destino, NO al ejecutor del aparato, y recarga la configuración', async () => {
  for (const roles of [ADMIN, L3C]) {
    const { C, calls, confirmRemote } = phone(async () => resp({ ok: true, confirmed: true, operation_id: 'op-1', proposal: { ...card, resultado: { ok: true, aplicado: ['ticket_pie'] } } }));
    const card = serverCard(); const { gate, log } = gateFor(C, roles, confirmRemote);
    const key = gate.add(card); const r = await gate.execute(key, { confirmed: true });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.match(r.msg, /todos los aparatos/); assert.equal(gate.state(key), 'done');
    assert.equal(calls.length, 1); assert.equal(calls[0].url, '/auth/assistant/confirm'); assert.equal(calls[0].body.proposal.destino, 'servidor');
    assert.equal(calls[0].body.proposal.ajuste, 'ticket_pie'); assert.equal(calls[0].body.token, card.confirm_token); assert.equal(calls[0].body.proposal.confirm_token, undefined);
    assert.equal(log.device, 0, 'el ejecutor de Configuración del aparato no se usa'); assert.equal(log.reload, 1, 'se vuelve a leer pos.business/pos.ticket/pos.flags');
    // un segundo toque no repite nada
    assert.equal((await gate.execute(key, { confirmed: true })).ok, true); assert.equal(calls.length, 1); assert.equal(log.reload, 1);
  }
  // la tarjeta del aparato (#972) del Admin sigue con su ejecutor local, sin recargar ajustes del servidor
  const { C, confirmRemote } = phone(async () => resp({ ok: true, confirmed: true, operation_id: 'op-2' }));
  const { gate, log } = gateFor(C, ADMIN, confirmRemote); const k2 = gate.add(deviceCard());
  assert.equal((await gate.execute(k2, { confirmed: true })).ok, true); assert.equal(log.device, 1); assert.equal(log.reload, 0);
});

test('nivel 3 sin cambios / niveles 1-2: ni siquiera se llama al servidor', async () => {
  for (const roles of [L3, L2, L1]) {
    const { C, calls, confirmRemote } = phone(async () => resp({ ok: true }));
    const { gate, log } = gateFor(C, roles, confirmRemote); const key = gate.add(serverCard());
    const r = await gate.execute(key, { confirmed: true }); assert.equal(r.ok, false); assert.equal(calls.length, 0); assert.equal(log.reload, 0); assert.equal(gate.state(key), 'denied'); }
  // nivel 3 con cambios y tarjeta del aparato: tampoco
  const { C, calls, confirmRemote } = phone(async () => resp({ ok: true }));
  const { gate } = gateFor(C, L3C, confirmRemote); const k = gate.add(deviceCard());
  assert.equal((await gate.execute(k, { confirmed: true })).ok, false); assert.equal(calls.length, 0);
});

test('409 revision_conflict: aviso claro en palabras, la tarjeta NO queda aplicada (ni se reenvía igual) y se relee la configuración', async () => {
  const { C, calls, confirmRemote } = phone(async () => resp({ error: 'revision_conflict', message: 'La Configuración cambió en otro aparato. Pide la tarjeta de nuevo.' }, 409));
  const { gate, log } = gateFor(C, L3C, confirmRemote); const key = gate.add(serverCard());
  const r = await gate.execute(key, { confirmed: true });
  assert.equal(r.ok, false); assert.equal(r.code, 'revision_conflict'); assert.match(r.msg, /Otro aparato cambió la Configuración/); assert.match(r.msg, /Pide la tarjeta de nuevo/);
  assert.ok(!C.looksTechnical(r.msg)); assert.notEqual(gate.state(key), 'done'); assert.equal(gate.state(key), 'denied'); assert.equal(log.device, 0);
  await new Promise((res) => setImmediate(res)); assert.equal(log.reload, 1, 'toma la del servidor');
  const v = C.confirmFailureView(r, { type: 'configuracion' }); assert.equal(v.again, true); assert.equal(v.button, null); assert.equal(v.msg, r.msg);
  assert.equal((await gate.execute(key, { confirmed: true })).ok, false); assert.equal(calls.length, 1, 'no se reenvía');
  // config_sin_datos (409) también: mensaje del servidor en palabras
  const b = phone(async () => resp({ error: 'config_sin_datos', message: 'Ese ajuste todavía no está guardado en el servidor. Ábrelo una vez en Configuración.' }, 409));
  const g2 = gateFor(b.C, ADMIN, b.confirmRemote); const k2 = g2.gate.add(serverCard()); const r2 = await g2.gate.execute(k2, { confirmed: true });
  assert.equal(r2.ok, false); assert.match(r2.msg, /Ábrelo una vez en Configuración/); assert.equal(g2.gate.state(k2), 'denied'); assert.equal(g2.log.reload, 0);
});

test('403 forbidden_role (perdió el permiso «cambios»): la tarjeta sale y el aviso es de Configuración, no de compras', async () => {
  const { C, confirmRemote } = phone(async () => resp({ error: 'forbidden_role' }, 403));
  const { gate, log } = gateFor(C, L3C, confirmRemote); const key = gate.add(serverCard());
  const r = await gate.execute(key, { confirmed: true });
  assert.equal(r.ok, false); assert.equal(r.code, 'forbidden_role'); assert.equal(r.dropped, true); assert.equal(r.msg, C.CONFIG_LOST_MSG); assert.doesNotMatch(r.msg, /compra/);
  assert.equal(gate.state(key), null, 'olvidada'); assert.equal(log.reload, 0);
  assert.match(UI, /roleLost\(c, key, p, need\)/); assert.match(UI, /p\.type === 'configuracion' && C\.CONFIG_LOST_MSG \? C\.CONFIG_LOST_MSG : C\.ROLE_LOST_MSG/);
});

test('UI: reloadSettings usa NA_CONFIG_G.pullSettings (sin recargar la página); roles() lleva cambios del ping; pastilla y nota de la tarjeta', async () => {
  const line = UI.split('\n').find((l) => /^\s*reloadSettings: function/.test(l)); assert.ok(line);
  const root = { NA_CONFIG_G: { pulls: 0, pullSettings() { this.pulls++; return Promise.resolve({ ok: true }); } } };
  const fn = new Function('root', 'return {' + line.trim().replace(/,\s*$/, '') + '}.reloadSettings;')(root);
  await fn(); assert.equal(root.NA_CONFIG_G.pulls, 1); assert.equal(new Function('root', 'return {' + line.trim().replace(/,\s*$/, '') + '}.reloadSettings;')({})(), null);
  assert.doesNotMatch(line, /location|reload\(\)/);
  assert.match(UI, /cambios: access\.cambios === true/); assert.match(UI, /access\.cambios = d\.role !== 'owner' && d\.cambios === true/);
  assert.match(UI, /C\.isServerConfig\(p\) \? '<span class=\"pill\">Toda la tienda<\/span>' : '<span class=\"pill\">Solo Admin<\/span>'/);
  // pull de config-g.js: lee pos.business, pos.ticket y pos.flags con los setters existentes
  const G = readFileSync(new URL('../../POS/js/config/config-g.js', import.meta.url), 'utf8');
  for (const k of ['pos.business', 'pos.ticket', 'pos.flags']) assert.ok(G.includes("'" + k + "'"), k); assert.match(G, /pullSettings/);
});

// Contrato de #967 (74d80b39): RUC tapado/vacío → { ajuste:'negocio_ruc', nombre:'RUC', destino:'servidor', completar:['valor'], valor:'' };
// el confirm lleva manual:{ valor } fuera de la firma (igual que completar→manual de la compra).
const rucCard = (over = {}) => serverCard({ ajuste: 'negocio_ruc', nombre: 'RUC', antes: '', valor: '', completar: ['valor'], ...over });
const typeRuc = (C, card, v) => { const n = C.needFields(makeDoc(), card, () => {}); n.inputs[0].value = v; n.inputs[0].dispatch('input');
  Object.defineProperty(card, '_manual', { value: n.state, enumerable: false, configurable: true }); return n; };

test('RUC tapado: la tarjeta trae el campo VACÍO con la etiqueta «RUC»; Confirmar apagado hasta 11 dígitos válidos; lo escrito va en body.manual.valor', async () => {
  const { C, calls, confirmRemote } = phone(async (url) => url === '/auth/assistant/confirm' ? resp({ ok: true, confirmed: true, operation_id: 'op-r', proposal: { ...card, resultado: { ok: true } } }) : resp({ ok: true, reply: 'ok' }));
  const card = rucCard();
  const doc = makeDoc(); let changes = 0;
  const need = C.needFields(doc, card, () => changes++); assert.ok(need); assertJ(need.names, ['valor']); const [inp] = need.inputs;
  assert.equal(inp.value, '', 'vacío: lo tapado no se muestra'); assert.equal(inp.getAttribute('inputmode'), 'numeric'); assert.equal(need.missing(), 1);
  assert.equal(inp.parentNode.childNodes[0].textContent, 'RUC'); assert.match(inp.parentNode.childNodes[2].textContent, /11 dígitos/);
  // misma regla que el servidor tras quitar espacios/puntos/guiones: 11 dígitos y prefijo 10/15/16/17/20
  for (const bad of ['123', '2012345678', '201234567890', '30123456789', '11123456789', '*******6789', '[RUC oculto]', 'RUC 2012345678x']) { inp.value = bad; inp.dispatch('input'); assert.equal(need.missing(), 1, bad); }
  for (const good of ['10456789012', '15123456789', '16123456789', '17123456789']) { inp.value = good; inp.dispatch('input'); assert.equal(need.missing(), 0, good); }
  inp.value = '20 123-456.789'; inp.dispatch('input'); assert.equal(need.missing(), 0); assert.equal(need.state.valor, '20123456789');
  Object.defineProperty(card, '_manual', { value: need.state, enumerable: false, configurable: true });
  assert.equal(JSON.stringify(C.fillValues(card)), JSON.stringify({ valor: '20123456789' })); assert.ok(!JSON.stringify(card).includes('20123456789'), 'fuera de la propuesta firmada');
  const { gate, log } = gateFor(C, L3C, confirmRemote); const key = gate.add(card);
  assert.ok(!JSON.stringify(gate.summary()).includes('20123456789'), 'el resumen de tarjetas que viaja al chat no lo lleva');
  const r = await gate.execute(key, { confirmed: true }); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(log.reload, 1); assert.ok(!r.msg.includes('20123456789'));
  const conf = calls.filter((c) => c.url === '/auth/assistant/confirm'); assert.equal(conf.length, 1);
  assertJ(conf[0].body.manual, { valor: '20123456789' }); assert.ok(!JSON.stringify(conf[0].body.proposal).includes('20123456789')); assert.equal(conf[0].body.proposal.valor, '');
  assert.ok(calls.filter((c) => c.url !== '/auth/assistant/confirm').every((c) => !JSON.stringify(c.body).includes('20123456789')));
  assert.equal(card._manual, undefined, 'tras aplicar, el RUC escrito sale de la memoria del teléfono');
  // una tarjeta de otra clave con completar no pide nada; compra sigue igual
  assert.equal(C.needFields(makeDoc(), serverCard({ completar: ['valor'] })), null);
  assert.equal(C.needFields(makeDoc(), { type: 'compra', completar: ['ruc'] }), null);
  assertJ(C.needFields(makeDoc(), { type: 'compra', proveedor: '', completar: ['proveedor'] }).names, ['proveedor']);
  assert.match(UI, /rucNeed\?'Escríbalo abajo'/);
  // la regla que tapa DNI/RUC en el chat no cambia (un RUC 10… escrito en el chat sigue tapado)
  assert.doesNotMatch(C.redactText('mi RUC es 10456789012'), /10456789012/);
});

test('RUC: el servidor rechaza lo escrito sin guardar → su aviso tal cual en la tarjeta y junto al campo; sigue editable', async () => {
  for (const [status, body] of [[400, { error: 'config_invalid', fields: ['valor'], message: 'El RUC debe tener 11 dígitos.' }],
    [400, { error: 'config_invalid', fields: ['valor'], message: 'El RUC debe empezar con 10, 15, 16, 17 o 20.' }],
    [422, { error: 'fields_required', fields: ['valor'], message: 'Complete los datos marcados y vuelva a confirmar.' }]]) {
    const { C, calls, confirmRemote } = phone(async () => resp(body, status));
    const card = rucCard(); const need = typeRuc(C, card, '20123456789');
    const { gate, log } = gateFor(C, ADMIN, confirmRemote); const key = gate.add(card);
    const r = await gate.execute(key, { confirmed: true });
    assert.equal(r.ok, false); assert.equal(r.msg, body.message, body.error); assert.equal(gate.state(key), 'pending'); assert.equal(log.reload, 0); assert.equal(calls.length, 1);
    const v = C.confirmFailureView(r, { editable: need.names, type: 'configuracion' }); assert.equal(v.kind, 'fields'); assert.equal(v.msg, body.message); assertJ(v.fields, ['valor']);
    need.flag(v.fields, v.msg); assert.equal(need.inputs[0].parentNode.childNodes[2].textContent, body.message); assert.equal(need.missing(), 1, 'hasta que lo cambie');
  }
  // 400 manual_not_allowed: no es para reescribir; aviso de pedir la tarjeta de nuevo
  const b = phone(async () => resp({ error: 'manual_not_allowed', fields: ['valor'] }, 400));
  const c2 = rucCard(); typeRuc(b.C, c2, '20123456789');
  const g2 = gateFor(b.C, ADMIN, b.confirmRemote); const r2 = await g2.gate.execute(g2.gate.add(c2), { confirmed: true });
  assert.equal(r2.ok, false); assert.notEqual(r2.code, 'fields_required'); assert.match(r2.msg, /Pedir de nuevo/);
  // 409: conflicto, se pide la tarjeta de nuevo
  const d = phone(async () => resp({ error: 'revision_conflict', message: 'x' }, 409));
  const c3 = rucCard(); typeRuc(d.C, c3, '20123456789');
  const g3 = gateFor(d.C, ADMIN, d.confirmRemote); const k3 = g3.gate.add(c3); const r3 = await g3.gate.execute(k3, { confirmed: true });
  assert.equal(r3.code, 'revision_conflict'); assert.equal(r3.msg, d.C.CONFIG_CONFLICT_MSG); assert.equal(g3.gate.state(k3), 'denied');
  assert.match(UI, /p\.type === 'configuracion'\) \{ if \(need\) need\.flag\(f\.fields, f\.msg\); res\.textContent = f\.msg; \}/);
});

// ---- De punta a punta con la ruta REAL del Worker (#967): tarjeta del chat → teléfono → confirm → pos_settings ----
function memDb(seed) {
  const rows = new Map(Object.entries(seed).map(([k, v]) => [k, { value_json: JSON.stringify(v), revision: 3, updated_by: 'session:dev-owner' }]));
  return { rows, prepare(sql) { return { bind: (...a) => ({
    first: async () => { if (!/^SELECT/i.test(sql)) return null; const r = rows.get(a[0]); return r ? { ...r } : null; },
    all: async () => ({ results: [] }),
    run: async () => { if (/^UPDATE pos_settings SET value_json/i.test(sql)) { const r = rows.get(a[0]); if (!r || r.revision !== a[4]) return { meta: { changes: 0 } };
      rows.set(a[0], { value_json: a[1], revision: r.revision + 1, updated_by: a[3] }); return { meta: { changes: 1 } }; } return { meta: { changes: 1 } }; } }) }; } };
}
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef', DEEPSEEK_API_KEY: 'k' };
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
async function e2e(role, auth, args) {
  const db = memDb({ 'pos.ticket': { ancho: '80mm', pie: '¡GRACIAS!', showLogo: true, showIGV: false, showPayment: true }, 'pos.business': { nombre: 'Tienda', ruc: '', direccion: 'Jr. X 1' }, 'pos.flags': { alertsEnabled: true } });
  let n = 0; const modelBodies = []; const model = async (_u, init) => { n++; modelBodies.push(String(init && init.body || '')); return json({ choices: [{ message: n === 1 ? { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'configurar_app', arguments: JSON.stringify(args) } }] } : { content: 'Listo.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); };
  const deps = { store: createMemoryUsageStore(), db, resolveRole: async () => role, fetch: model, audit: async (_d, r) => r.length, readBusinessName: async () => 'Tienda', mockChunkMs: 0 };
  const cr = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: 'Cambia el pie del ticket' }) }), ENV, auth, json, deps);
  const card = ((await cr.json()).proposals || []).find((p) => p.type === 'configuracion');
  const ph = phone(async (url, init) => { const r = await assistantConfirmRoute(new Request('https://w.test' + url, { method: 'POST', body: init.body }), ENV, auth, json, deps); return resp(await r.json(), r.status); });
  return { card, db, deps, modelBodies, ...ph };
}
test('punta a punta: nivel 3 + «costos y cambios» aplica el pie del ticket en el servidor con un toque; luego un 409 por otro aparato', async () => {
  const auth = { principalId: 'session:emp-caja2', posRole: 'empleado' };
  const { card, db, C, confirmRemote, calls } = await e2e(COSTS_ROLE, auth, { ajuste: 'ticket_pie', valor: 'Vuelva pronto' });
  assert.ok(card, 'llega la tarjeta'); assert.equal(card.destino, 'servidor');
  const { gate, log } = gateFor(C, L3C, confirmRemote); const key = gate.add(card);
  const r = await gate.execute(key, { confirmed: true }); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(log.reload, 1); assert.equal(log.device, 0);
  assert.equal(JSON.parse(db.rows.get('pos.ticket').value_json).pie, 'Vuelva pronto'); assert.equal(calls[0].url, '/auth/assistant/confirm');
  // otra tarjeta armada con el «antes» viejo: el servidor contesta 409 y el teléfono no la marca aplicada
  const x = await e2e('owner', { principalId: 'session:dev-owner', posRole: 'owner' }, { ajuste: 'ticket_pie', valor: 'Otro pie' });
  const row = x.db.rows.get('pos.ticket'); x.db.rows.set('pos.ticket', { ...row, value_json: JSON.stringify({ ...JSON.parse(row.value_json), pie: 'Cambiado en caja 1' }), revision: row.revision + 1 });
  const g2 = gateFor(x.C, ADMIN, x.confirmRemote); const k2 = g2.gate.add(x.card); const r2 = await g2.gate.execute(k2, { confirmed: true });
  assert.equal(r2.ok, false); assert.equal(r2.code, 'revision_conflict'); assert.equal(g2.gate.state(k2), 'denied'); assert.equal(JSON.parse(x.db.rows.get('pos.ticket').value_json).pie, 'Cambiado en caja 1');
});

test('punta a punta RUC: chat con RUC tapado → tarjeta vacía → se escribe en el teléfono → se guarda; el RUC nunca va al chat ni a la IA', async () => {
  const RUC = '20123456789';
  const auth = { principalId: 'session:emp-caja2', posRole: 'empleado' };
  const x = await e2e(COSTS_ROLE, auth, { ajuste: 'negocio_ruc', valor: '*******6789' });
  assert.ok(x.card, 'llega la tarjeta'); assert.equal(x.card.ajuste, 'negocio_ruc'); assertJ(x.card.completar, ['valor']); assert.equal(x.card.valor, '');
  const need = typeRuc(x.C, x.card, '20.123.456-789'); assert.equal(need.missing(), 0);
  const { gate, log } = gateFor(x.C, L3C, x.confirmRemote); const r = await gate.execute(gate.add(x.card), { confirmed: true });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(log.reload, 1); assert.equal(JSON.parse(x.db.rows.get('pos.business').value_json).ruc, RUC);
  assertJ(x.calls[0].body.manual, { valor: RUC });
  assert.ok(x.modelBodies.length > 0); assert.ok(x.modelBodies.every((b) => !b.includes(RUC) && !b.includes('20.123.456-789')), 'ningún pedido a la IA lleva el RUC');
  assert.ok(!r.msg.includes(RUC) && !JSON.stringify(gate.summary()).includes(RUC));
  // la charla siguiente (con el resumen de tarjetas) tampoco lo lleva
  const before = x.modelBodies.length;
  await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: '¿Quedó?', cards: gate.summary() }) }), ENV, auth, json, x.deps);
  assert.ok(x.modelBodies.length > before); assert.ok(x.modelBodies.every((b) => !b.includes(RUC)));
  // inválido según el servidor (el teléfono ya lo bloquea; aquí se fuerza): 400 con su mensaje, nada guardado
  const y = await e2e('owner', { principalId: 'session:dev-owner', posRole: 'owner' }, { ajuste: 'negocio_ruc', valor: '' });
  const clean = { ...y.card }; delete clean.confirm_token;
  for (const [v, m] of [['30123456789', 'El RUC debe empezar con 10, 15, 16, 17 o 20.'], ['2012345678', 'El RUC debe tener 11 dígitos.']]) {
    const res = await y.confirmRemote(y.card, null, { body: { token: y.card.confirm_token, proposal: clean, manual: { valor: v } } });
    assert.equal(res.status, 400, JSON.stringify(res)); assert.equal(res.error, 'config_invalid'); assert.equal(res.message, m); }
  assert.equal(JSON.parse(y.db.rows.get('pos.business').value_json).ruc, '', 'nada guardado');
});
