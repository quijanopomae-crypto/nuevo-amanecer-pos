// Sobre 58200f60. 1) (Bot 2/4/5) la serie de comprobante va en <span class="na-asst-code"> (nowrap) con el guion ASCII; solo createElement/
// textContent: texto del modelo con etiquetas sale como texto, sin más elementos que la span. En texto, celdas, tarjetas (filas con etiqueta)
// y la nota de la tarjeta de compra. 2) (Bots 3/5) /confirm tras respuesta perdida: misma sesión dueño + misma propuesta + mismo «manual» →
// 200 con la MISMA propuesta aplicada; otra sesión o datos distintos → 409 already_confirmed sin propuesta; empleado → 403. Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { toProposal, issueConfirmToken, assistantConfirmRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });

// ---------- 1) span de la serie ----------
let created = [];
class N { constructor(tag) { this.tagName = tag.toUpperCase(); this.childNodes = []; this.attrs = {}; this.className = ''; this.classList = { add() {}, remove() {} }; created.push(this); }
  appendChild(k) { this.childNodes.push(k); k.parentNode = this; return k; } insertBefore(k) { this.childNodes.push(k); k.parentNode = this; return k; } get nextSibling() { return null; }
  setAttribute(a, v) { this.attrs[a] = String(v); } get textContent() { return this.childNodes.map((k) => (k.nodeType === 3 ? k.data : k.textContent)).join(''); }
  set textContent(v) { this.childNodes = v ? [{ nodeType: 3, data: String(v) }] : []; }
  set innerHTML(_) { throw new Error('innerHTML usado'); } set outerHTML(_) { throw new Error('outerHTML usado'); } insertAdjacentHTML() { throw new Error('insertAdjacentHTML usado'); } }
const D = { createElement: (t) => new N(t), createTextNode: (t) => ({ nodeType: 3, data: String(t) }) };
const walk = (n, f) => { for (const k of n.childNodes || []) { f(k); if (k.childNodes) walk(k, f); } };
const codeSpans = (n) => { const o = []; walk(n, (k) => { if (typeof k.className === 'string' && k.className.split(' ')[0] === 'na-asst-code') o.push(k); }); return o; };
function paint(txt, step, opts) { created = []; const host = new N('div'); created = []; const r = C.createReplyRenderer(D, (n) => host.appendChild(n), opts);
  for (let i = 0; i < txt.length; i += step) r.push(txt.slice(i, i + step)); r.finish(); return host; }
const STEPS = [1, 2, 3, 7, 47, 9999];

test('texto: cada serie en UNA span nowrap con «-» ASCII, sin U+2011; serie al final, partida en el guion, 9 dígitos y fechas sin span', () => {
  const cases = [
    ['B001-00000123', ['B001-00000123']],
    ['Doc: F001-1\nGuía E001-87654321.', ['F001-1', 'E001-87654321']],
    ['Serie 0001-00012345, fecha 2024-12345, F001-123456789 y xB001-12 y B001-12a.', ['0001-00012345']],
    ['(B001-00000123)·T001-9', ['B001-00000123', 'T001-9']]
  ];
  for (const [txt, want] of cases) for (const step of STEPS) {
    const h = paint(txt, step); const out = h.textContent;
    assert.equal(out, txt, step + ': ' + JSON.stringify(out)); assert.ok(!out.includes('\u2011'));
    const sp = codeSpans(h); assert.deepEqual(sp.map((x) => x.textContent), want, step + ' ' + txt);
    for (const s of sp) { assert.equal(s.tagName, 'SPAN'); assert.equal(s.childNodes.length, 1); assert.equal(s.childNodes[0].nodeType, 3); }
  }
});

test('tablas y tarjetas: la serie en la celda (con etiqueta de tarjeta y con máscara al lado) va en una span; texto igual en trozos de 1/2/3/7/47', () => {
  const txt = 'Compras:\n| Doc | Proveedor | Monto |\n|---|---|---|\n| B001-00000123 | Alicorp | S/ 10.00 |\n| F001-7 y T001-00012345 | [dato del Admin] | [dato del Admin] |\nFin E001-5';
  for (const step of STEPS) {
    const h = paint(txt, step); const sp = codeSpans(h);
    assert.deepEqual(sp.map((x) => x.textContent), ['B001-00000123', 'F001-7', 'T001-00012345', 'E001-5'], 'trozos de ' + step);
    let tds = 0; walk(h, (k) => { if (k.tagName === 'TD') tds++; }); assert.equal(tds, 6);
    for (const s of sp.slice(0, 3)) { assert.equal(s.parentNode.className, 'na-asst-tv na-asst-tvc', 'dentro del valor de la celda (tarjeta a 480; tvc: puede bajar bajo la etiqueta)');
      // (Bots 3/4 sobre d72b7601) en la celda: serie+guion, <wbr>, número; cada parte nowrap (CSS); nunca entre dígitos
      assert.equal(s.className, 'na-asst-code na-asst-cc'); assert.deepEqual(s.childNodes.map((k) => k.tagName + '.' + k.className), ['SPAN.na-asst-cs', 'WBR.', 'SPAN.na-asst-cn']);
      assert.match(s.childNodes[0].textContent, /^[A-Z0-9]{4}-$/); assert.match(s.childNodes[2].textContent, /^\d+$/); assert.equal(s.childNodes[1].childNodes.length, 0); }
    // en la burbuja (texto fuera de la tabla) la serie va entera, sin wbr
    assert.equal(sp[3].className, 'na-asst-code'); assert.equal(sp[3].childNodes.length, 1); assert.equal(sp[3].childNodes[0].nodeType, 3);
    let plain = 0; walk(h, (k) => { if (k.className === 'na-asst-tv') plain++; }); assert.equal(plain, 4, 'celdas sin serie: sin tvc');
    assert.ok(!h.textContent.includes('\u2011'));
  }
  // nota de la tarjeta de compra (proveedor · documento · fecha): misma función, solo textContent
  created = []; const note = new N('div'); created = [];
  C.appendCoded(D, note, 'Alicorp SAC · F001-00012345 · 2026-10-17');
  assert.equal(note.textContent, 'Alicorp SAC · F001-00012345 · 2026-10-17'); assert.deepEqual(codeSpans(note).map((x) => x.textContent), ['F001-00012345']);
  assert.deepEqual(created.map((x) => x.className), ['na-asst-code']);
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  assert.match(UI, /'<div class="note" data-docnote><\/div>'/);
  // (Bot 4 sobre 3ee80c18) cada valor en su span (proveedor y documento aislados de izquierda a derecha), la serie sigue por appendCoded
  assert.match(UI, /var dn = c\.querySelector\('\[data-docnote\]'\); if \(dn\) \[\[p\.proveedor, true\], \[p\.documento, true\], \[p\.fecha, false\]\]/);
  assert.match(UI, /if \(x\[1\]\) ltrIsolate\(sp\); C\.appendCoded\(doc, sp, String\(x\[0\]\)\)/);
});

test('XSS (Bot 5): etiquetas alrededor/dentro de una serie salen como texto; 0 elementos creados aparte de la span; nada de innerHTML', () => {
  const evil = [
    '<b>B001-00000123</b>',
    '<img src=x onerror=alert(1)>F001-00012345<script>alert(1)</script>',
    'B001-<i>00000123</i> y T001-00012345"><svg onload=alert(1)>',
    '<span class="na-asst-code">E001-1</span>'
  ];
  for (const txt of evil) for (const step of STEPS) {
    // (Bots 4/5/3 sobre f773911f) las etiquetas de formato escritas como texto (<b> <i> …) ya no se ven en la burbuja; el resto sale como texto, igual
    const h = paint(txt, step); assert.equal(h.textContent, txt.replace(/<\/?(?:code|strong|b|em|i|u|mark|kbd|pre)>/gi, ''), step);
    const els = created.filter((x) => x !== h); assert.ok(els.every((x) => x.className === 'na-asst-code' && x.tagName === 'SPAN'), JSON.stringify(els.map((x) => x.tagName + '.' + x.className)));
    assert.equal(els.length, codeSpans(h).length); for (const s of codeSpans(h)) assert.ok(/^(?:[FBET][A-Z0-9]{3}|0\d{3})-\d{1,8}$/.test(s.textContent), s.textContent);
    walk(h, (k) => { if (k.attrs) assert.deepEqual(Object.keys(k.attrs), [], 'ningún atributo desde el texto'); });
  }
  // en una celda también
  const h = paint('| Doc | X |\n|---|---|\n| <b>B001-1</b><img src=x onerror=alert(1)> | <script>T001-2</script> |\n', 3);
  assert.deepEqual(codeSpans(h).map((x) => x.textContent), ['B001-1', 'T001-2']);
  const odd = created.filter((x) => !['DIV', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SPAN', 'WBR'].includes(x.tagName)); assert.deepEqual(odd, []);
  assert.ok(created.filter((x) => x.tagName === 'WBR').every((w) => w.parentNode && w.parentNode.className === 'na-asst-code na-asst-cc' && !Object.keys(w.attrs).length), 'wbr solo dentro de la serie de una celda');
  const CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
  const fn = CORE.slice(CORE.indexOf('function codeSpan'), CORE.indexOf('var AMOUNT_RE'));
  assert.ok(fn.includes("doc.createElement('span')") && fn.includes('.textContent = v') && !/innerHTML|insertAdjacentHTML|outerHTML|`/.test(fn));
});

// ---------- 2) reenvío de /confirm ----------
const SECRET = 'secreto-de-prueba-1234567890', OWNER = { principalId: 'session:dueno', posRole: 'owner', sessionId: 'S-1', credentialHash: 'h1' };
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const reader = { products: async () => [], productsById: async () => new Map(), purchases: async () => [] };
const LINEAS = [{ nombre: 'Galleta', cantidad: 3, costo_unitario: 1.2 }, { nombre: 'Arroz', cantidad: 2, costo_unitario: 4 }];
const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET };
function card() { return toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345 pedido 87654321', lineas: LINEAS } }, 'owner', { products: [] }, 1); }
const GOOD = { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345 pedido 87654321' };
async function send(token, proposal, extra, store, auth = OWNER, role = 'owner') {
  const res = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token, proposal, ...extra }) }), env, auth, jsonR,
    { store, resolveRole: async () => role, reader, audit: async () => {} });
  return { status: res.status, body: await res.json() };
}

test('reenvío de la MISMA sesión con los mismos datos → 200 con la misma propuesta aplicada; respuesta cortada a medias + reintento', async () => {
  const p = card(), store = createMemoryUsageStore(), token = await issueConfirmToken(p, 'owner', OWNER, SECRET, Date.now());
  const first = await send(token, p, { manual: GOOD }, store); assert.equal(first.status, 200, JSON.stringify(first.body)); assert.ok(!first.body.already_confirmed);
  // lo guardado en el uso: hashes, no la sesión ni lo escrito en claro
  const saved = [...store._map.values()].map((r) => r.value).find((v) => v.op); assert.ok(saved.s && saved.rh); assert.ok(!JSON.stringify(saved).includes('S-1') && !JSON.stringify(saved).includes('Bodega'));
  for (const _ of [1, 2]) { const again = await send(token, p, { manual: GOOD }, store);
    assert.equal(again.status, 200); assert.equal(again.body.ok, true); assert.equal(again.body.replay, true); assert.equal(again.body.operation_id, first.body.operation_id);
    assert.deepEqual(again.body.proposal, first.body.proposal); }
  // espacios de más en lo escrito: se normaliza igual que la primera vez
  const sp = await send(token, p, { manual: { proveedor: '  ' + GOOD.proveedor + ' ', documento: GOOD.documento } }, store); assert.equal(sp.status, 200); assert.deepEqual(sp.body.proposal, first.body.proposal);
  // de punta a punta: la 1.ª respuesta se pierde (el servidor sí la procesó), el celular reintenta y abre «Nueva compra» llena
  const p2 = card(); p2.confirm_token = await issueConfirmToken(p2, 'owner', OWNER, SECRET, Date.now()); Object.defineProperty(p2, '_manual', { value: { ...GOOD }, enumerable: false });
  const st2 = createMemoryUsageStore(); let calls = 0, filled = null, opened = 0;
  const confirm = async (pp) => { calls++; const clean = JSON.parse(JSON.stringify(pp)); delete clean.confirm_token;
    const r = await send(pp.confirm_token, clean, { manual: C.fillValues(pp) }, st2); if (calls === 1) { const e = new Error('cortada'); e.timeout = true; throw e; } return r.body; };
  const g = C.createGate({ roles: () => ({ role: 'owner', isOwner: () => true }), online: () => true, productos: () => [], confirm,
    openPurchase: () => { opened++; return { querySelector: () => null }; }, fillPurchase: (w, ap) => { filled = { proveedor: C.purchaseValue(ap, 'proveedor'), documento: C.purchaseValue(ap, 'documento'), n: ap.lineas.length }; return true; }, navigate: () => {} });
  const key = g.add(p2); const r1 = await g.execute(key, { confirmed: true }); assert.equal(r1.ok, false); assert.equal(r1.code, 'network'); assert.equal(g.state(key), 'pending');
  const r2 = await g.execute(key, { confirmed: true }); assert.equal(calls, 2); assert.ok(r2.ok, JSON.stringify(r2)); assert.equal(g.state(key), 'done');
  assert.deepEqual(filled, { ...GOOD, n: 2 }); assert.equal(opened, 1);
});

test('otra sesión o registro viejo → 409 already_confirmed SIN propuesta ni lo escrito; misma sesión con otros datos → 409 already_confirmed_same_session con la propuesta firmada y SIN lo escrito (d72b7601); empleado → 403', async () => {
  const p = card(), store = createMemoryUsageStore(), token = await issueConfirmToken(p, 'owner', OWNER, SECRET, Date.now());
  const first = await send(token, p, { manual: GOOD }, store); assert.equal(first.status, 200);
  const no = (r, why) => { assert.equal(r.status, 409, why + ' ' + JSON.stringify(r.body)); assert.equal(r.body.error, 'already_confirmed'); assert.equal(r.body.already_confirmed, true);
    assert.ok(!r.body.ok && !r.body.proposal, why); assert.ok(!JSON.stringify(r.body).includes('Bodega') && !JSON.stringify(r.body).includes('87654321'), why); };
  no(await send(token, p, { manual: GOOD }, store, { ...OWNER, sessionId: 'S-2', credentialHash: 'h2' }), 'otra sesión del mismo aparato');
  // (Bots 3/4/5 sobre d72b7601) mismo aparato y misma sesión dueño, otros datos: la propuesta FIRMADA (sin lo escrito), nunca el «manual» guardado
  const same = (r, sent, why) => { assert.equal(r.status, 409, why + ' ' + JSON.stringify(r.body)); assert.equal(r.body.error, 'already_confirmed_same_session'); assert.equal(r.body.already_confirmed, true);
    assert.equal(r.body.operation_id, first.body.operation_id); assert.ok(!r.body.ok && !r.body.replay && !('manual' in r.body), why);
    const { confirm_token, ...signed } = p; assert.deepEqual({ ...r.body.proposal, aceptadas: undefined, quitadas: undefined }, { ...signed, aceptadas: undefined, quitadas: undefined }, why);
    const js = JSON.stringify(r.body); for (const x of ['10456789012', ...(sent ? Object.values(sent) : [])]) assert.ok(!js.includes(x), why + ': ' + x); };
  same(await send(token, p, { manual: { ...GOOD, documento: 'F001-00099999' } }, store), { d: 'F001-00099999' }, 'otro documento');
  same(await send(token, p, { manual: { proveedor: GOOD.proveedor } }, store), null, 'falta un campo');
  same(await send(token, p, {}, store), null, 'sin manual');
  same(await send(token, p, { manual: GOOD, review: { op: first.body.operation_id, drop: [1] } }, store), null, 'otra fila quitada');
  // un «review» con otro operation_id se ignora (como en la 1.ª vez): sigue siendo el mismo reenvío
  assert.equal((await send(token, p, { manual: GOOD, review: { op: 'AST-otro', drop: [1] } }, store)).status, 200);
  const emp = await send(token, p, { manual: GOOD }, store, OWNER, 'empleado:consultas_documentos'); assert.equal(emp.status, 403); assert.ok(!emp.body.proposal);
  const oth = await send(token, p, { manual: GOOD }, store, { principalId: 'session:otro', posRole: 'owner', sessionId: 'S-9' }); assert.equal(oth.status, 403); assert.equal(oth.body.error, 'other_device');
  // registro guardado antes de este cambio (sin hashes): nunca se devuelve la propuesta
  const p3 = card(), st3 = createMemoryUsageStore(), t3 = await issueConfirmToken(p3, 'owner', OWNER, SECRET, Date.now());
  assert.equal((await send(t3, p3, { manual: GOOD }, st3)).status, 200);
  for (const [k, r] of st3._map) if (r.value.op) st3._map.set(k, { value: { op: r.value.op, at: r.value.at, t: 'compra', drop: [], manual: GOOD }, revision: r.revision });
  no(await send(t3, p3, { manual: GOOD }, st3), 'registro viejo');
});

test('dos envíos a la vez: misma sesión → uno nuevo y otro reenvío con la misma propuesta; otra sesión a la vez → 409', async () => {
  const p = card(), store = createMemoryUsageStore(), token = await issueConfirmToken(p, 'owner', OWNER, SECRET, Date.now());
  const rs = await Promise.all([send(token, p, { manual: GOOD }, store), send(token, p, { manual: GOOD }, store), send(token, p, { manual: GOOD }, store, { ...OWNER, sessionId: 'S-3' })]);
  const fresh = rs.filter((r) => r.status === 200 && !r.body.replay), rep = rs.filter((r) => r.body.replay), rej = rs.filter((r) => r.status === 409);
  assert.equal(fresh.length, 1, JSON.stringify(rs.map((r) => r.status)));
  if (rs[2].status === 200) { assert.ok(!rs[2].body.replay); assert.equal(rej.length, 2); } // ganó la otra sesión: las dos de S-1 → 409
  else { assert.equal(rep.length, 1); assert.deepEqual(rep[0].body.proposal, fresh[0].body.proposal); assert.equal(rej.length, 1); }
});

test('celular: 409 already_confirmed (otra sesión) → nota corta «Esta compra ya se confirmó en otra sesión.», sin abrir «Nueva compra» ni texto técnico', async () => {
  const owner = { role: 'owner', isOwner: () => true }; let opened = 0;
  const p = { id: 'c9', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: 'A', documento: 'F001-1', lineas: [{ nombre: 'G', cantidad: 1, costo_unitario: 1 }] };
  const g = C.createGate({ roles: () => owner, online: () => true, productos: () => [], confirm: async () => ({ ok: false, error: 'already_confirmed' }), openPurchase: () => { opened++; return null; }, fillPurchase: () => true, navigate: () => {} });
  const key = g.add(p); const r = await g.execute(key, { confirmed: true });
  assert.equal(r.ok, false); assert.equal(r.code, 'already_confirmed'); assert.equal(r.msg, 'Esta compra ya se confirmó en otra sesión.'); assert.equal(opened, 0); assert.equal(g.state(key), 'denied');
  const v = C.confirmFailureView(r); assert.equal(v.kind, 'elsewhere'); assert.equal(v.msg, 'Esta compra ya se confirmó en otra sesión.'); assert.equal(v.again, true); assert.doesNotMatch(v.msg, /_|HTTP|error|\d{3}/);
  // otra tarjeta (no compra): mismo aviso con «cambio»
  const g2 = C.createGate({ roles: () => owner, online: () => true, productos: () => [{ id: 'P1', nombre: 'X' }], stockMoveReady: () => null, confirm: async () => ({ ok: false, error: 'already_confirmed' }) });
  const k2 = g2.add({ id: 'a9', type: 'ajuste', needsConfirm: true, confirm_token: 't', product_id: 'P1', cantidad: 1 }); const r2 = await g2.execute(k2, { confirmed: true });
  assert.equal(r2.msg, 'Este cambio ya se confirmó en otra sesión.');
  assert.equal(C.friendlyError('already_confirmed').msg, 'Esta compra ya se confirmó en otra sesión.');
});
