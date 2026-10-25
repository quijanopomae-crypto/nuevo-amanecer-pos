// Sobre f773911f (Bots 2/3/4/5) y pedido del dueño del 22-10 (mascota v11). Una prueba por punto acordado. Sin red, datos inventados.
//  1) supresión de la comilla/envoltorio sin cierre tras la etiqueta («[oculto]» UNA vez hasta cierre, salto, fin de frase, otra etiqueta o 400)
//  2) número tras 1–2 saltos y marca de cita/lista; 3) S/4.50, S/.4.50, S/. 4.50 = moneda; 4) invisibles en la cabecera, flechas, «>» pegado,
//  «—»/«–» solo con credencial, DNI sin repetir; 5) excepción del adjetivo; 6) decisiones del dueño pendientes SIN cambio;
//  7) puntos «escribiendo» visibles; 8) etiquetas y vallas solo en pantalla, en partes = entero; 9) 412×760; 10) /confirm 200 cortado;
//  11) /confirm no guarda el nivel de empleado; 12) mascota v11 (diferida, solo en el panel, sin sitios externos)
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const MASC = require('../../POS/js/modules/asistente/asistente-mascota.js');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const rd = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const UI = rd('POS/js/modules/asistente/asistente-ui.js'), CSS = rd('POS/css/asistente.css'), LOADER = rd('POS/js/modules/asistente/asistente-loader.js');
const EMP = 'empleado:consultas_documentos';
const VIAS = { emp: [A.redactFor(EMP), A.ownerHold], own: [A.redactFor('owner'), null], mEmp: [A.redactText, null], mOwn: [A.redactModelOwner, null] };
const has = (t, v) => new RegExp('(^|[^\\p{L}\\p{N}_])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'u').test(t);
function emit(red, hold, t, cuts) { let o = '', seen = ''; const e = A.createTextEmitter((d) => { if (d.reset) o = ''; else { o += d.t || ''; seen += d.t || ''; } }, A.REPLY_MAX, red, hold);
  let at = 0; for (const x of [...cuts, t.length]) { e.push(t.slice(at, x)); at = x; } e.flush(); return { o, seen }; }
// paridad en TODOS los cortes simples y en pasos 1..13, en las 4 vías; y ningún valor se ve en partes si no se ve en el texto entero
function parity(t, vals = []) {
  for (const [k, [red, hold]] of Object.entries(VIAS)) {
    const full = A.capReply(red(t)); const cuts = [];
    for (let i = 1; i < t.length; i += t.length > 600 ? 5 : 1) cuts.push([i]);
    for (let s = 1; s <= 13; s++) { const c = []; for (let i = s; i < t.length; i += s) c.push(i); cuts.push(c); }
    for (const c of cuts) { const r = emit(red, hold, t, c); assert.equal(r.o, full, k + ' ' + JSON.stringify(c.slice(0, 3)) + ' ' + JSON.stringify(t.slice(0, 60)));
      for (const v of vals) assert.ok(!(has(r.seen, v) && !has(full, v)), k + ' fuga en partes ' + v); }
  }
}
const W = 'perro azul verde amarillo rojo naranja morado gris blanco negro plateado marrón violeta turquesa celeste dorado rosado lila crema beige ocre coral índigo magenta cian oliva'.split(' ');
const phrase = (n) => { let s = '', i = 0; while (s.length < n) { s += (s ? ' ' : '') + W[i % W.length]; i++; } return s.slice(0, n).replace(/\s+$/, ''); };

test('1) supresión: comilla/envoltorio sin cierre tras la etiqueta → «[oculto]» una vez; termina en cierre, salto, «. », otra etiqueta o 400 (+ fin de palabra)', () => {
  const P = phrase(150);
  assert.equal(A.redactText('la clave del wifi es "' + P + ' y sigue sin cerrar'), 'la clave del wifi es "[oculto]');
  for (const op of ['"', '«', '“', '**', '`', '(', '<b>', '_']) { const o = A.redactText('la clave del wifi es ' + op + P); assert.ok(!/azul|morado|violeta|turquesa/.test(o), op + ' ' + o); assert.equal((o.match(/\[oculto\]/g) || []).length, 1, o); }
  // termina: salto de línea, fin de frase, otra etiqueta
  assert.equal(A.redactText('la clave del wifi es "' + P + '\nOtra línea visible'), 'la clave del wifi es "[oculto]\nOtra línea visible');
  assert.equal(A.redactText('contraseña: "' + P + '. Luego vamos'), 'contraseña: "[oculto]. Luego vamos');
  { const o = A.redactText('la clave del wifi es "' + P + ' y la clave es 4321'); assert.ok(o.startsWith('la clave del wifi es "[oculto] la clave es') || o.includes('[oculto] y la clave es [oculto]') || /"\[oculto\].*clave es \[oculto\]$/.test(o), o); assert.ok(!o.includes('4321'), o); }
  // con cierre después de los 80: se tapa hasta el cierre y lo de después se ve
  assert.equal(A.redactText('la clave del wifi es "' + P + '" y listo'), 'la clave del wifi es "[oculto]" y listo');
  // tope de 400: lo que sigue a la palabra que cruza el tope se ve (diseño acordado)
  { const L = phrase(600), o = A.redactText('la clave del wifi es "' + L); assert.ok(o.startsWith('la clave del wifi es "[oculto]'), o); assert.ok(o.length < 260, o.length); }
  // paridad en partes = entero (todas las vías)
  for (const t of ['la clave del wifi es "' + phrase(120) + ' Tortuga22 y sigue', 'clave: «' + phrase(95) + '\nOtra 4321', 'password (' + phrase(101) + '. Luego Tortuga22', 'la contraseña es <b>' + phrase(130) + ' y la clave es 4321']) parity(t, ['perro', 'azul']);
});

test('2) número tras «:»/verbo + hasta 2 saltos y marca de cita o lista: se tapa (PIN tras línea en blanco)', () => {
  for (const t of ['El PIN de la caja es:\n\n> 4321', 'pin:\n\n> 4321', 'La clave de la caja:\n4321', 'La clave de la caja:\n\n4321 listo', 'el pin del local:\r\n\r\n4321 ok', 'pin:\n\n- 4321', 'pin:\n\n1. 4321', 'la clave es:\n\n* 4321']) {
    for (const [k, [red]] of Object.entries(VIAS)) assert.ok(!red(t).includes('4321'), k + ' ' + JSON.stringify(t) + ' → ' + red(t));
    parity(t, ['4321']); }
  // tres saltos ya es otro párrafo: como antes
  assert.equal(A.redactText('pin:\n\n\n\nEl año 4321'), A.redactText('pin:\n\n\n\nEl año 4321'));
});

test('3) S/4.50, S/.4.50, S/. 4.50, S/ siempre moneda (nunca «valor de letras y dígitos»)', () => {
  for (const c of ['S/ ', 'S/', 'S/.', 'S/. ']) {
    assert.equal(A.redactText('la clave del precio es de ' + c + '4.50 y listo'), 'la clave del precio es de ' + c + '4.50 y listo');
    assert.equal(A.redactText('precio clave ' + c + '4.50 hoy'), 'precio clave ' + c + '4.50 hoy');
    assert.ok(!A.redactText('clave de la caja ' + c + '4321 listo').includes('4321'));
    assert.ok(!A.redactText('pin ' + c + '43.21 ok').includes('43.21'));
    assert.ok(!/\[oculto\]\.50/.test(A.redactText('la clave del precio es de ' + c + '4.50')));
  }
  for (const t of ['la clave del precio es de S/4.50 y listo', 'clave de la caja S/.4321 listo', 'pin S/43.21 ok']) parity(t, ['4321', '43.21']);
});

test('4) invisibles en la cabecera, flechas como «:», «>» pegado, «—»/«–» solo con credencial, DNI sin repetir', () => {
  assert.ok(!A.redactText('clave del wifi:' + ' \u200b'.repeat(40) + '"tortuga"').includes('tortuga'));
  assert.ok(!A.redactText('clave del wifi:' + ' \u200b'.repeat(130) + '"tortuga" ok').includes('tortuga'));
  for (const t of ['pin → Tortuga22', 'pin -> tortuga', 'clave => tortuga', 'clave del wifi:\n>tortuga', 'pin — tortuga', 'clave del wifi — tortuga', 'password – tortuga']) assert.ok(!/tortuga/i.test(A.redactText(t)), t + ' → ' + A.redactText(t));
  assert.equal(A.redactText('la clave — dijo él — es vender'), 'la clave — dijo él — es vender');
  assert.equal(A.redactText('el DNI del cliente es 45678912'), 'el DNI del cliente es ****8912');
  assert.equal(A.redactText('documento 12345678'), 'documento ****5678');
  assert.equal(A.redactText('Mi DNI es 45678912'), 'Mi DNI es ****8912');
  for (const t of ['pin → Tortuga22 y sigue', 'clave del wifi:\n>tortuga ok', 'la clave — dijo él — es vender', 'el DNI del cliente es 45678912']) parity(t, ['Tortuga22', 'tortuga']);
});

test('5) excepción del adjetivo: «producto/cliente/proveedor/punto/dato/insumo clave» suelta SOLO montos con céntimos en moneda; nunca cerca de pin/contraseña/wifi/caja/local/alarma', () => {
  assert.equal(A.redactText('producto clave S/ 4.50'), 'producto clave S/ 4.50');
  assert.equal(A.redactText('| producto clave | S/ 4.50 |'), '| producto clave | S/ 4.50 |');
  assert.ok(A.redactText('producto clave: Arroz a S/ 4.50, costo S/ 3.20').includes('S/ 4.50'));
  for (const t of ['producto clave 4321', 'dato clave: 4321', 'producto clave 4.50', 'producto clave de la caja S/ 4.50', 'cliente clave S/ 12.50 wifi', 'insumo clave S/ 4.50 de la alarma', 'el pin del producto clave S/ 4.50', 'clave del producto S/ 4.50'])
    assert.ok(/\[oculto\]/.test(A.redactText(t)), t + ' → ' + A.redactText(t));
  for (const t of ['producto clave S/ 4.50 y la caja', 'producto clave S/ 4.50 y listo', 'dato clave: tortuga']) parity(t);
});

test('6) decisiones del dueño PENDIENTES: «código de acceso 4321» y «Cambié la clave de la caja en 2019» siguen exactamente como en f773911f', () => {
  // f773911f: ambas se ven tal cual. No se cambia hasta que el dueño decida.
  for (const t of ['código de acceso 4321', 'el código de acceso es 4321', 'Cambié la clave de la caja en 2019', 'Cambié la clave de la caja en 2019 y listo'])
    for (const [k, [red]] of Object.entries(VIAS)) assert.equal(red(t), t, k + ' ' + t);
});

test('7) puntos «escribiendo» dentro de la burbuja: visibles (opacidad 1, color del texto), alto reservado, quietos con menos movimiento', () => {
  assert.match(CSS, /\.na-asst-msg \.na-asst-dots\{display:flex;position:static;[^}]*opacity:1;height:10px/);
  assert.match(CSS, /\.na-asst-msg \.na-asst-dots i\{[^}]*opacity:1!important;background:currentColor;[^}]*animation:na-asst-dot-b [^}]*!important\}/);
  assert.match(CSS, /\.na-asst-msg\.na-asst-thinking,\.na-asst-msg\[aria-busy="true"\]\{padding-bottom:0\}/, 'la línea de 10 px ocupa el relleno de abajo (sin saltos)');
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)\{\.na-asst-msg \.na-asst-dots i\{animation:none!important;opacity:1;transform:none\}\}/);
  assert.match(CSS, /@keyframes na-asst-dot-b\{0%,80%,100%\{transform:translateY\(0\)\}40%\{transform:translateY\(-3px\)\}\}/, 'la animación solo mueve (no cambia la opacidad)');
  // en el aparato: se ponen al pensar, siguen mientras llega (aria-busy) y se quitan al terminar
  assert.match(UI, /function doneBubble\(\) \{ if \(bubble && dots\.parentNode === bubble\) bubble\.removeChild\(dots\); if \(bubble\) bubble\.removeAttribute\('aria-busy'\); \}/);
});

test('8) en pantalla: etiquetas HTML literales y vallas ``` se quitan DESPUÉS del filtro; en partes = texto entero; etiqueta incompleta retenida ≤ 10', () => {
  const S = C.stripDisplay;
  assert.equal(S('la clave es <b>[oculto]</b> y <code>F001-1</code>'), 'la clave es [oculto] y F001-1');
  assert.equal(S('```text\nhola\n```'), 'hola\n');
  assert.equal(S('a < b y 3<4 <img src=x> <script>x</script>'), 'a < b y 3<4 <img src=x> <script>x</script>', 'lo que no es etiqueta de formato queda como texto');
  assert.equal(S('`código`'), '`código`');
  const T = ['Precio **<strong>S/ 4.50</strong>**\n```js\nconsole\n```\nfin <kbd>Ctrl</kbd>', '<pre>\n| a | b |\n</pre>', 'x </stro', 'abc ``', 'a <em', '```'];
  for (const t of T) for (let s = 1; s <= 12; s++) { const d = C.createDisplayStripper(); let o = ''; for (let i = 0; i < t.length; i += s) { const p = d.push(t.slice(i, i + s)); o += p; } o += d.flush(); assert.equal(o, S(t), s + ' ' + JSON.stringify(t)); }
  // retención: a lo sumo la etiqueta incompleta del final
  { const d = C.createDisplayStripper(); assert.equal(d.push('hola </stron'), 'hola '); assert.equal(d.push('g> chau'), ' chau'); }
  { const d = C.createDisplayStripper(); assert.equal(d.push('hola <abcdefghijk'), 'hola <abcdefghijk', 'no es etiqueta conocida: no se retiene'); }
  // el renderizador usa el mismo filtro: lo que se ve en partes = lo que se ve con el texto entero
  class N { constructor(t) { this.tagName = t.toUpperCase(); this.childNodes = []; this.className = ''; this.classList = { add() {}, remove() {} }; }
    appendChild(k) { this.childNodes.push(k); k.parentNode = this; return k; } insertBefore(k) { return this.appendChild(k); } setAttribute() {} get nextSibling() { return null; }
    get textContent() { return this.childNodes.map((k) => (k.nodeType === 3 ? k.data : k.textContent)).join(''); } set textContent(v) { this.childNodes = v ? [{ nodeType: 3, data: String(v) }] : []; }
    set innerHTML(_) { throw new Error('innerHTML'); } }
  const D = { createElement: (t) => new N(t), createTextNode: (t) => ({ nodeType: 3, data: String(t) }) };
  const paint = (t, s) => { const h = new N('div'), r = C.createReplyRenderer(D, (n) => h.appendChild(n)); for (let i = 0; i < t.length; i += s) r.push(t.slice(i, i + s)); r.finish(); return h.textContent; };
  for (const t of T) { const whole = paint(t, 1e9); for (const s of [1, 2, 3, 5, 8]) assert.equal(paint(t, s), whole, s + ' ' + JSON.stringify(t)); assert.ok(!/<\/?(?:strong|kbd|pre)>|```/.test(whole), whole); }
});

test('9) 412×760: la tarjeta que se confirma se trae a la vista («Reconectando…» visible) y «Ver nuevo ↓» no la tapa', () => {
  assert.match(UI, /function revealCard\(c, nodes\) \{/);
  assert.match(UI, /onRetry: function \(\) \{ if \(!c\.isConnected\) return; ok\.textContent = C\.RECONNECT_MSG; res\.textContent = C\.RECONNECT_MSG; revealCard\(c, \[res, ok\]\); \}/);
  assert.match(UI, /function showNew\(\) \{ if \(!newBtn \|\| !msgsEl \|\| noteSeen\(\) \|\| \(liveCard && inView\(liveCard\)\)\) return;/);
  // revealCard con rectángulos de mentira: el estado queda dentro de la lista (8 px de margen) moviendo SOLO la lista
  const src = UI.slice(UI.indexOf('  function inView(n)'), UI.indexOf('  function showNew()'));
  const run = (resTop, resBot) => { const msgs = { scrollTop: 100, getBoundingClientRect: () => ({ top: 60, bottom: 700 }) }, nb = { hidden: false };
    const res = { isConnected: true, hidden: false, getBoundingClientRect: () => ({ top: resTop - (msgs.scrollTop - 100), bottom: resBot - (msgs.scrollTop - 100) }) };
    new Function('msgsEl', 'newBtn', 'res', 'var liveCard = null;' + src + '; revealCard({ isConnected: true }, [res]);')(msgs, nb, res); return { msgs, nb, r: res.getBoundingClientRect() }; };
  { const { r, nb } = run(720, 760); assert.ok(r.bottom <= 692 && r.top >= 68, JSON.stringify(r)); assert.equal(nb.hidden, true); }
  { const { r } = run(20, 50); assert.ok(r.top >= 68, JSON.stringify(r)); }
  { const { msgs } = run(200, 240); assert.equal(msgs.scrollTop, 100, 'ya a la vista: no se mueve'); }
});

// ---------- 10) /confirm: 200 con el cuerpo cortado ----------
function loadConfirm(plan, seen) {
  const win = { addEventListener() {}, removeEventListener() {} };
  const ctx = vm.createContext({ window: win, setTimeout, clearTimeout, setInterval, clearInterval, Date, AbortController, console, Intl, URL, TextEncoder, TextDecoder });
  vm.runInContext(rd('POS/js/modules/asistente/asistente-core.js'), ctx); const CC = win.NA_ASISTENTE_CORE;
  win.fetch = (url, init) => { seen.push(init.body); const m = plan.shift();
    if (m === 'cut') return Promise.resolve({ status: 200, ok: true, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
    if (m === 'null') return Promise.resolve({ status: 200, ok: true, json: async () => null });
    if (m === 'ok') return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true, replay: true, operation_id: 'op-1' }) });
    if (m === '409') return Promise.resolve({ status: 409, ok: false, json: async () => ({ error: 'already_confirmed', already_confirmed: true, operation_id: 'op-1' }) });
    if (m === '403') return Promise.resolve({ status: 403, ok: false, json: async () => ({ error: 'other_device' }) });
    return Promise.reject(new TypeError('Failed to fetch')); };
  const sl = (a, b) => { const i = UI.indexOf(a), j = UI.indexOf(b, i + 1); return UI.slice(i, j); };
  const ui = vm.createContext({ C: CC, root: win, reqInit: (path, body) => ({ url: path, init: { method: 'POST', body: JSON.stringify(body) } }), setTimeout, Promise, Object, JSON, Error, Array });
  vm.runInContext(sl('  async function post(', '  // Confirmación: el MISMO token') + sl('  async function confirmRemote(', '  // ---------- Funciones existentes del POS'), ui);
  return { CC, confirmRemote: ui.confirmRemote };
}
test('10) /confirm 200 con JSON cortado = corte: «Reconectando…» y UN reintento con el MISMO cuerpo; 409/403 del reintento tal cual; reloj monótono', async () => {
  const p = { id: 'p1', type: 'compra', confirm_token: 'tok-1', proveedor: 'X', lineas: [] };
  for (const [plan, want] of [[['cut', 'ok'], { ok: true }], [['null', 'ok'], { ok: true }], [['cut', '409'], { ok: false, error: 'already_confirmed', status: 409 }], [['cut', '403'], { ok: false, error: 'other_device', status: 403 }]]) {
    const seen = [], { confirmRemote } = loadConfirm(plan.slice(), seen); let retries = 0;
    const r = await confirmRemote(p, null, { onRetry: () => { retries++; } });
    assert.equal(seen.length, 2, plan.join()); assert.equal(seen[0], seen[1], 'mismo cuerpo (token, propuesta, manual)'); assert.equal(retries, 1);
    for (const [k, v] of Object.entries(want)) assert.equal(r[k], v, plan.join() + ' ' + k);
  }
  { const seen = [], { confirmRemote } = loadConfirm(['cut', 'cut'], seen); await assert.rejects(confirmRemote(p, null, {}), (e) => e.message === 'network' && !!e.sentBody); assert.equal(seen.length, 2, 'un solo reintento'); }
  // request: 2xx roto → bodyError; 4xx roto → error de servidor normal (sin reintento)
  { const seen = [], { CC } = loadConfirm([], seen);
    const r = await CC.request(async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('x'); } }), 'u', {}, 5000); assert.equal(r.bodyError, true); assert.deepEqual({ ...r.data }, {}); }
  const CORE = rd('POS/js/modules/asistente/asistente-core.js');
  assert.match(CORE, /var t0 = monoNow\(\)/); assert.match(CORE, /if \(monoNow\(\) - t0 >= ms\) fire\(\);/); assert.ok(!/Date\.now\(\) - t0/.test(CORE), 'el límite no usa el reloj de pared');
});

test('11) /confirm no guarda ni cambia el nivel de un empleado: solo la marca de uso de la tarjeta; empleado → 403', async () => {
  const SECRET = 'secreto-de-prueba-1234567890', OWNER = { principalId: 'session:dueno', posRole: 'owner', sessionId: 'S-1', credentialHash: 'h1' };
  const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  const p = A.toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Bodega Juan', documento: 'F001-1', lineas: [{ nombre: 'Galleta', cantidad: 3, costo_unitario: 1.2 }] } }, 'owner', { products: [] }, 1);
  const store = A.createMemoryUsageStore(), token = await A.issueConfirmToken(p, 'owner', OWNER, SECRET, Date.now());
  const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET };
  const send = async (role) => { const res = await A.assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token, proposal: p }) }), env, OWNER, jsonR,
    { store, resolveRole: async () => role, reader: { products: async () => [], productsById: async () => new Map(), purchases: async () => [] }, audit: async () => {} }); return res.status; };
  assert.equal(await send('empleado:consultas_documentos'), 403); assert.equal(store._map.size, 0, 'el empleado no escribe nada');
  assert.equal(await send('owner'), 200); assert.ok(store._map.size >= 1);
  for (const k of store._map.keys()) { assert.ok(!k.startsWith('internal:asst:lvl:'), k); assert.ok(k.startsWith(A.USAGE_PREFIX), k); }
  const CT = rd('docs/asistente/CONTRATO.md'); assert.match(CT, /`\/auth\/assistant\/confirm` \| POST \| solo dueño/); assert.match(CT, /nunca\*\* guarda ni cambia el nivel de un empleado/);
  assert.ok(!/dueño, empleado \(nivel revisado OTRA vez\)/.test(CT), 'la línea vieja (empleado podía confirmar) ya no está');
});

// ---------- 12) mascota v11 ----------
function fakeDom({ saveData = false, reduced = false } = {}) {
  const calls = [];
  const masc = { speak: (t) => calls.push(['speak', t]), react: (k) => calls.push(['react', k]), show: () => calls.push(['show']), hide: () => calls.push(['hide']) };
  const innerDoc = { body: { dataset: { naReady: '1' } }, head: { appendChild: (n) => calls.push(['style', n.textContent]) }, createElement: () => ({}), getElementById: () => ({ setAttribute() {}, tabIndex: 0 }) };
  let frame = null; const timers = [];
  const doc = { createElement: (t) => { const L = {}; const n = { tagName: t, attrs: {}, setAttribute(a, v) { this.attrs[a] = v; }, addEventListener(e, f) { L[e] = f; }, fire(e) { L[e] && L[e](); }, parentNode: null };
    Object.defineProperty(n, 'contentDocument', { get: () => innerDoc }); Object.defineProperty(n, 'contentWindow', { get: () => ({ NAMascota: masc }) }); return n; } };
  const cls = new Set();
  const host = { ownerDocument: doc, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) }, appendChild(n) { frame = n; n.parentNode = this; }, removeChild(n) { if (frame === n) frame = null; } };
  const win = { navigator: { connection: { saveData } }, matchMedia: () => ({ matches: reduced }), setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {} };
  return { host, win, calls, cls, frame: () => frame };
}
test('12) mascota v11: archivo del dueño tal cual, sin sitios externos; diferida al abrir el panel; solo en la cabecera; reacciona y habla; menos movimiento; ahorro de datos; si falla queda la cara', () => {
  // el archivo: el mismo que mandó el dueño (2,2 MB), Three.js adentro, sin pedidos a otros sitios
  const H = rd('POS/assets/asistente/mascota-v11.html');
  assert.ok(H.includes('Mascota 2.5D v11') && statSync(new URL('../../POS/assets/asistente/mascota-v11.html', import.meta.url)).size > 2e6);
  assert.ok(!/<script[^>]+src=|<link[^>]+href=["']?https?:|@import|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|importScripts|document\.cookie|localStorage/.test(H), 'sin recursos ni pedidos externos');
  const urls = (H.match(/https?:\/\/[^\s"')<>]+/g) || []).filter((u) => !/^http:\/\/www\.w3\.org\//.test(u) && !/^https:\/\/jcgt\.org\//.test(u)); assert.deepEqual(urls, [], 'solo el espacio de nombres SVG y una cita en un comentario de Three.js');
  assert.ok(!/sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]|secret\s*[:=]|password\s*[:=]/i.test(H), 'sin claves');
  // diferida: ni el cargador ni el arranque la piden; la UI la pide al abrir el panel, en un momento libre
  assert.ok(!/mascota/i.test(LOADER), 'el cargador del POS no baja nada de la mascota');
  assert.match(UI, /function openPanel\(\) \{\n    panelEl\.hidden = false; rootEl\.hidden = true; place\(\); applyPause\(\); mascotOn\(\);/);
  assert.match(UI, /sc\.src = 'js\/modules\/asistente\/asistente-mascota\.js'; sc\.async = true;/);
  assert.match(UI, /panelEl\.querySelector\('\.na-asst-head \.na-asst-char'\)/, 'solo en la cabecera del panel');
  assert.ok(UI.indexOf('mascotOn()') > UI.indexOf('function mount()') || /function openPanel\(\)[\s\S]{0,200}mascotOn\(\)/.test(UI));
  assert.match(UI, /if \(mascot\) mascot\.state\(s\);/); assert.match(UI, /if \(mascot\) mascot\.speak\(shown\);/); assert.match(UI, /if \(mascot\) mascot\.visible\(false\);/);
  // CSS: mismo hueco de 46 px, sin toques, transparente; menos movimiento sin transición; el diseño del celular del POS no se toca
  assert.match(CSS, /\.na-asst-m11\{position:absolute;[^}]*width:120px;height:120px;[^}]*pointer-events:none;/);
  assert.match(CSS, /\.na-asst-head \.na-asst-char\{width:46px;height:46px;flex:0 0 46px\}/);
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)\{\.na-asst-m11\{transition:none\}\}/);
  // comportamiento con un DOM de mentira
  { const f = fakeDom(), m = MASC.create(f.host, { win: f.win, quality: 'low' }); assert.equal(m.load(), true); const fr = f.frame();
    assert.equal(fr.tagName, 'iframe'); assert.equal(fr.src, 'assets/asistente/mascota-v11.html?widget=1&q=low');
    assert.equal(fr.attrs['aria-hidden'], 'true'); assert.equal(fr.attrs.tabindex, '-1'); assert.equal(fr.attrs.inert, ''); assert.equal(fr.attrs.sandbox, 'allow-scripts allow-same-origin');
    m.state('feliz'); assert.equal(f.calls.length, 0, 'antes de estar lista no hace nada');
    fr.fire('load'); assert.equal(m.ready(), true); assert.ok(f.cls.has('na-asst-m11-on'));
    assert.ok(f.calls.some((c) => c[0] === 'style' && /\.na-bubble/.test(c[1])), 'sin el globo del widget');
    f.calls.length = 0; m.state('feliz'); m.state('error'); m.state('pensando'); m.speak('x'.repeat(500));
    assert.deepEqual(f.calls.map((c) => c[0] + (c[0] === 'speak' ? c[1].length : c[1] ? ':' + c[1] : '')), ['react:venta', 'react:error', 'speak240', 'show']);
    f.calls.length = 0; m.visible(false); assert.deepEqual(f.calls, [['hide']]);
    m.destroy(); assert.equal(f.frame(), null); assert.ok(!f.cls.has('na-asst-m11-on'), 'vuelve la cara de siempre'); }
  { const f = fakeDom({ reduced: true }), m = MASC.create(f.host, { win: f.win }); m.load(); f.frame().fire('load'); f.calls.length = 0; m.state('feliz'); m.speak('hola'); assert.deepEqual(f.calls, [], 'menos movimiento: ni salta ni habla'); }
  { const f = fakeDom({ saveData: true }), m = MASC.create(f.host, { win: f.win }); assert.equal(m.load(), false); assert.equal(f.frame(), null, 'ahorro de datos: no se baja'); }
  { const f = fakeDom(), m = MASC.create(f.host, { win: f.win }); m.load(); f.frame().fire('error'); assert.equal(f.frame(), null); assert.equal(m.ready(), false); m.speak('x'); }
});
