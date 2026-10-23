// Sobre 84a49517 (Bot 2 A/B, Bot 4): A) un campo de la tarjeta de compra con máscara conserva su parte EXACTA y pide solo lo que falta;
// B) el servidor rechaza confirm (422 fields_required, nada creado ni marcado usado) si un campo de «completar» no trae valor (no vacío, sin
// máscara) en body.fill, o si cualquier campo de la propuesta trae una máscara; la propuesta firmada no cambia. Celular: aviso junto al campo,
// la tarjeta sigue editable y conserva lo escrito; solo createElement/textContent. Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { toProposal, issueConfirmToken, assistantConfirmRoute, createMemoryUsageStore, cardPrefix } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const SECRET = 'secreto-de-prueba-1234567890', AUTH = { principalId: 'session:dueno', posRole: 'owner' };
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const reader = { products: async () => [], productsById: async () => new Map(), purchases: async () => [] };
const LINEAS = [{ nombre: 'Galleta', cantidad: 3, costo_unitario: 1.2 }];
const MASK = /\*{3}|\[[^\]]*(?:oculto|dato|omitid)/i;
async function confirm(proposal, extra, store, signed = proposal) {
  const token = await issueConfirmToken(signed, 'owner', AUTH, SECRET, Date.now()); const writes = [];
  const res = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token, proposal, ...extra }) }), { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET }, AUTH, jsonR,
    { store, resolveRole: async () => 'owner', reader, audit: async (db, rows) => { writes.push(...rows); } });
  return { status: res.status, body: await res.json(), token, writes };
}

test('A) la tarjeta conserva la parte exacta antes de la máscara (sin etiqueta suelta) y pide solo lo que falta; nunca una máscara', () => {
  for (const [docu, want] of [['F001-12345678 pedido 87654321', 'F001-12345678 pedido'], ['Guía T001-00012345 DNI 45678912', 'Guía T001-00012345'], ['DNI 45678912', ''], ['pin: 4321 F001-9', ''], ['F001-00012345 cód. 12345678', null]]) {
    const p = toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Alicorp SAC', documento: docu, lineas: LINEAS } }, 'owner', { products: [] }, 1);
    if (want === null) { assert.equal(p.documento, docu); assert.equal(p.completar, undefined); continue; }
    assert.equal(p.documento, want, docu); assert.deepEqual(p.completar, ['documento']); assert.ok(!MASK.test(JSON.stringify(p)), JSON.stringify(p)); }
  const p = toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-1', lineas: LINEAS } }, 'owner', { products: [] }, 1);
  assert.equal(p.proveedor, 'Bodega Juan'); assert.deepEqual(p.completar, ['proveedor']);
  assert.equal(cardPrefix('F001-[DNI oculto]'), 'F001-'); assert.equal(cardPrefix('RUC N°: *******9012'), ''); assert.equal(cardPrefix('Alicorp'), 'Alicorp');
});

test('B) servidor: «manual» fuera de la propuesta firmada; cada rechazo (4xx, nada aplicado ni marcado usado) y el camino feliz', async () => {
  const p = toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345 pedido 87654321', lineas: LINEAS } }, 'owner', { products: [] }, 1);
  assert.deepEqual(p.completar, ['proveedor', 'documento']);
  const store = createMemoryUsageStore();
  const good = { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345 pedido 87654321' };
  // 422 fields_required: falta, vacío, con máscara, no texto
  for (const manual of [undefined, {}, { proveedor: '   ', documento: good.documento }, { proveedor: 'Bodega Juan RUC *******9012', documento: good.documento }, { proveedor: 'Bodega Juan [dato del Admin]', documento: 'x' },
    { proveedor: ['Bodega'], documento: 'x' }, { proveedor: good.proveedor }]) {
    const r = await confirm(p, manual === undefined ? {} : { manual }, store);
    assert.equal(r.status, 422, JSON.stringify(manual)); assert.equal(r.body.error, 'fields_required'); assert.ok(!r.body.ok && !r.body.proposal && r.body.fields.length, JSON.stringify(r.body));
    assert.ok(r.writes.some((w) => w.outcome === 'rejected:fields_required'), 'queda en la bitácora'); }
  // 400 manual_not_allowed: cualquier clave fuera del «completar» firmado, o «manual» que no es un objeto plano
  for (const manual of [{ ...good, precio: 1 }, { ...good, cantidad: 99 }, { ...good, producto: 'X' }, { ...good, product_id: 'P9' }, { ...good, lineas: [] }, { ...good, completar: [] }, { ...good, fecha: '2026-01-01' },
    'Bodega', ['Bodega'], 7, true]) {
    const r = await confirm(p, { manual }, store);
    assert.equal(r.status, 400, JSON.stringify(manual)); assert.equal(r.body.error, 'manual_not_allowed'); assert.ok(!r.body.ok && !r.body.proposal); }
  // con «completar» vacío, cualquier «manual» con claves → 400
  const plain = toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Alicorp SAC', documento: 'F001-1', lineas: LINEAS } }, 'owner', { products: [] }, 1);
  const pr = await confirm(plain, { manual: { proveedor: 'Otro' } }, createMemoryUsageStore()); assert.equal(pr.status, 400); assert.deepEqual(pr.body.fields, ['proveedor']);
  // sesión de empleado: 403 antes de mirar nada
  const tokE = await issueConfirmToken(p, 'owner', AUTH, SECRET, Date.now());
  const re = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token: tokE, proposal: p, manual: good }) }), { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET }, AUTH, jsonR,
    { store, resolveRole: async () => 'empleado:consultas_documentos', reader, audit: async () => {} });
  assert.equal(re.status, 403); const eb = await re.json(); assert.ok(!eb.ok && !eb.proposal);
  // la propuesta firmada no cambia por /confirm: lo escrito DENTRO de la propuesta → 409 proposal_changed
  const changed = await confirm({ ...p, ...good }, { manual: good }, createMemoryUsageStore(), p); assert.equal(changed.status, 409); assert.equal(changed.body.error, 'proposal_changed');
  // camino feliz (los rechazos no marcaron la tarjeta usada): 200, lo escrito en la propuesta aplicada
  const ok = await confirm(p, { manual: good }, store); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.ok, true); assert.ok(!ok.body.already_confirmed);
  assert.equal(ok.body.proposal.proveedor, good.proveedor); assert.equal(ok.body.proposal.documento, good.documento); assert.deepEqual(ok.body.proposal.lineas, p.lineas);
  // respuesta perdida y reintento: already_confirmed con lo mismo (confirm no crea registros: solo marca la tarjeta usada)
  const again = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token: ok.token, proposal: p, manual: good }) }), { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET }, AUTH, jsonR,
    { store, resolveRole: async () => 'owner', reader, audit: async () => {} });
  const ab = await again.json(); assert.equal(ab.already_confirmed, true); assert.equal(ab.operation_id, ok.body.operation_id); assert.equal(ab.proposal.proveedor, good.proveedor);
});

test('B) servidor: una máscara en CUALQUIER campo de la propuesta (firmada así) → 422 fields_required; sin máscara ni completar, como siempre', async () => {
  const base = toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Alicorp SAC', documento: 'F001-00012345', lineas: LINEAS } }, 'owner', { products: [] }, 1);
  const clean = await confirm(base, {}, createMemoryUsageStore()); assert.equal(clean.status, 200, JSON.stringify(clean.body));
  for (const [k, v] of [['proveedor', 'Alicorp RUC *******5237'], ['documento', 'F001-[DNI oculto]'], ['title', 'Compra [dato del Admin]'], ['lineas', [{ nombre: 'Galleta DNI ****5678', cantidad: 1, costo_unitario: 1 }]]]) {
    const p = { ...base, [k]: v }; const r = await confirm(p, {}, createMemoryUsageStore());
    assert.equal(r.status, 422, k); assert.equal(r.body.error, 'fields_required'); assert.ok(r.body.fields.includes(k), JSON.stringify(r.body)); }
  // otro tipo de tarjeta con máscara: igual
  const aj = { id: 'aj1', type: 'ajuste', needsConfirm: true, title: 'Ajuste', product_id: 'P1', nombre: 'Arroz [oculto]', cantidad: 1 };
  const r = await confirm(aj, {}, createMemoryUsageStore()); assert.equal(r.status, 422); assert.deepEqual(r.body.fields, ['nombre']);
});

function fakeDoc() {
  const mk = (tag) => ({ tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, value: '', id: '',
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, fire(t) { (this.listeners[t] || []).forEach((f) => f({ target: this })); }, focus() { fakeDoc.focused = this; } });
  return { createElement: mk };
}
test('celular (Bot 2 A / Bot 4): campo con la parte exacta de inicio; 422 fields_required → aviso junto al campo, foco, lo escrito y la tarjeta quedan; «manual» va aparte', async () => {
  const doc = fakeDoc(), p = { id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: 'Alicorp SAC', documento: 'F001-', completar: ['documento'], lineas: [] };
  const need = C.needFields(doc, p, () => {}); const [d] = need.inputs; assert.equal(d.value, 'F001-'); assert.equal(need.missing(), 1);
  d.fire('input'); assert.equal(need.missing(), 1, 'la parte exacta sola no cuenta'); d.value = 'F001-00012345'; d.fire('input'); assert.equal(need.missing(), 0);
  Object.defineProperty(p, '_manual', { value: need.state, enumerable: false });
  assert.deepEqual(C.fillValues(p), { documento: 'F001-00012345' }); assert.ok(!JSON.stringify(p).includes('00012345'), 'manual fuera de la propuesta firmada');
  // el servidor rechaza: la puerta deja la tarjeta pendiente y pasa los nombres
  const owner = { role: 'owner', isOwner: () => true }; let sent = null;
  const g = C.createGate({ roles: () => owner, online: () => true, productos: () => [], confirm: async (pp) => { sent = C.fillValues(pp); return { ok: false, error: 'fields_required', fields: ['documento'] }; } });
  const key = g.add(p); const r = await g.execute(key, { confirmed: true });
  assert.equal(r.ok, false); assert.equal(r.code, 'fields_required'); assert.deepEqual(r.fields, ['documento']); assert.equal(g.state(key) || 'pending', 'pending'); assert.deepEqual(sent, { documento: 'F001-00012345' });
  const v = C.confirmFailureView(r, { editable: need.names, type: 'compra' }); assert.equal(v.kind, 'fields'); assert.equal(v.button, 'Confirmar'); assert.doesNotMatch(v.msg, /_|HTTP|error|\d{3}/);
  const hint = d.parentNode.children[2]; const rest = need.flag(v.fields);
  assert.deepEqual(rest, []); assert.equal(hint.hidden, false); assert.equal(hint.textContent, 'Complete este dato'); assert.equal(d.getAttribute('aria-invalid'), 'true'); assert.equal(fakeDoc.focused, d);
  assert.equal(d.value, 'F001-00012345', 'lo escrito queda'); assert.equal(need.state.documento, 'F001-00012345');
  // (Bot 4 sobre 58200f60) tras el 422, «Confirmar» sigue apagado hasta que el campo marcado CAMBIE (el mismo valor no cuenta)
  assert.equal(need.missing(), 1, 'apagado tras el 422'); d.fire('input'); assert.equal(need.missing(), 1, 'sin cambio: sigue apagado'); assert.equal(hint.hidden, false);
  d.value = 'F001-00012346'; d.fire('input'); assert.equal(need.missing(), 0, 'cambió: se enciende'); assert.equal(hint.hidden, true);
  // un 422 que nombra un campo que la tarjeta no deja escribir (lineas) → bloqueado: aviso claro y solo «Cancelar»
  const vb = C.confirmFailureView({ ok: false, code: 'fields_required', fields: ['documento', 'lineas'] }, { editable: need.names, type: 'compra' });
  assert.equal(vb.kind, 'blocked'); assert.equal(vb.button, null); assert.equal(vb.again, false); assert.equal(vb.cancelOnly, true); assert.equal(vb.msg, 'No se puede confirmar esta compra desde el asistente. Ábrala en Nueva compra.');
  assert.equal(C.confirmFailureView({ ok: false, code: 'fields_required', fields: ['documento'] }).msg, 'Complete los datos marcados y vuelva a confirmar.');
  // cableado: confirmRemote manda fill; la tarjeta marca los campos y deja el aviso con textContent; nada de innerHTML en lo nuevo
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8'), CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
  assert.match(UI, /var manual = C\.fillValues \? C\.fillValues\(p\) : null; if \(manual\) body\.manual = manual;/);
  assert.match(UI, /ok\.textContent = gate\.locked && gate\.locked\(key\) \? C\.RECONNECT_MSG : 'Guardando…'/); assert.match(UI, /class="na-asst-bits" aria-hidden="true"/);
  assert.match(UI, /if \(f\.kind === 'fields'\) \{ var rest = need \? need\.flag\(f\.fields\) : f\.fields; res\.textContent = /);
  const fn = CORE.slice(CORE.indexOf('function needFields'), CORE.indexOf('var needSeq')); assert.ok(/function flag/.test(fn) && !/innerHTML|insertAdjacentHTML/.test(fn));
  assert.match(CORE, /fields_required: \['Complete los datos marcados y vuelva a confirmar\.'\]/);
});

test('celular (Bot 4): lo escrito llega a «Nueva compra» con la propuesta que devuelve /confirm (respuesta simulada); sin respuesta → «Sin conexión. Toque Reintentar», mismo cuerpo, sin editar (d72b7601)', async () => {
  const owner = { role: 'owner', isOwner: () => true };
  const p = { id: 'c2', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: 'Bodega Juan', documento: 'F001-', completar: ['proveedor', 'documento'], lineas: [{ nombre: 'Galleta', cantidad: 1, costo_unitario: 1 }] };
  Object.defineProperty(p, '_manual', { value: { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345' }, enumerable: false });
  let filled = null, calls = 0, sentBody = null;
  const deps = { roles: () => owner, online: () => true, productos: () => [],
    confirm: async (pp, rv, o) => { calls++; if (calls === 2) assert.equal(o && o.body, sentBody, '«Reintentar» reenvía el MISMO cuerpo (d72b7601)');
      sentBody = o && o.body ? o.body : { manual: C.fillValues(pp), proposal: JSON.parse(JSON.stringify(pp)) };
      if (calls === 1) { const e = new Error('cortada'); e.timeout = true; e.sentBody = sentBody; throw e; } // respuesta cortada a medias (confirmRemote adjunta el cuerpo)
      return { ok: true, operation_id: 'AST-1', type: 'compra', proposal: { ...sentBody.proposal } }; }, // servidor viejo: sin los valores escritos
    openPurchase: () => ({ querySelector: () => null }), fillPurchase: (w, ap) => { filled = { proveedor: C.purchaseValue(ap, 'proveedor'), documento: C.purchaseValue(ap, 'documento') }; return true; },
    navigate: () => {} };
  const g = C.createGate(deps); const key = g.add(p);
  const r1 = await g.execute(key, { confirmed: true }); assert.equal(r1.ok, false); assert.equal(g.state(key) || 'pending', 'pending');
  const v = C.confirmFailureView(r1); assert.equal(v.kind, 'network'); assert.equal(v.button, 'Reintentar'); assert.equal(v.msg, 'Sin conexión. Toque Reintentar'); assert.equal(r1.locked, true); assert.equal(g.locked(key), true); assert.doesNotMatch(v.msg, /_|HTTP|error|\d{3}/);
  assert.deepEqual(sentBody.manual, { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345' }); assert.equal(sentBody.proposal.proveedor, 'Bodega Juan', 'la propuesta enviada es la firmada');
  await g.execute(key, { confirmed: true });
  assert.ok(filled, 'se abrió Nueva compra'); assert.deepEqual(filled, { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345' });
});
test('pantalla (Bot 4): borde de alerta en Nocturno gana a theme-dark.css (contraste ≥ 3); serie de comprobante no se parte al pintar', () => {
  const CSS = readFileSync(new URL('../../POS/css/asistente.css', import.meta.url), 'utf8'), DARK = readFileSync(new URL('../../POS/css/theme-dark.css', import.meta.url), 'utf8');
  const spec = (sel) => { const a = (sel.match(/#[\w-]+/g) || []).length; const b = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!not\()[\w-]+/g) || []).length; const c = (sel.replace(/:not\(|\)|\[[^\]]+\]|\.[\w-]+|#[\w-]+|:[\w-]+/g, ' ').match(/\b[a-z]+\b/g) || []).length; return a * 1e4 + b * 100 + c; };
  const darkSel = 'body.dark input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])'; assert.ok(DARK.includes(darkSel));
  const m = CSS.match(/body\.dark input\.na-asst-need:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\):not\(\[type="color"\]\)\{[^}]*border-color:(#[0-9a-f]{6})/); assert.ok(m, 'regla nocturna del campo');
  assert.ok(spec(m[0].split('{')[0]) > spec(darkSel), 'especificidad');
  assert.match(CSS, /body\.dark input\.na-asst-need\.ok:not\(\[type="checkbox"\]\)[^{]*\{border-color:#4ade80\}/);
  const lum = (h) => { const v = h.match(/\w\w/g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const bg of ['#10241a', '#07130c']) { assert.ok(ratio(m[1], bg) >= 3, m[1] + ' sobre ' + bg); assert.ok(ratio('#4ade80', bg) >= 3); }
  // (Bot 2 sobre 58200f60) la serie va entera en una span nowrap con el guion ASCII «-»: el texto de la burbuja (lo que se copia) es el original,
  // sin U+2011, en trozos de 1/2/3/7/47 (y entero)
  const CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
  assert.ok(!/\\u2011|\u2011/.test(CORE), 'sin U+2011 en el núcleo'); assert.match(CORE, /var DOC_CODE_RE = \/\\b\(\?:\[FBET\]\[A-Z0-9\]\{3\}\|0\\d\{3\}\)-\\d\{1,8\}\\b\/g;/);
  assert.match(CSS, /\.na-asst-code\{white-space:nowrap;overflow-wrap:normal;word-break:keep-all;display:inline-block;max-width:100%;overflow-x:auto/);
  class N { constructor(tag) { this.tagName = tag.toUpperCase(); this.childNodes = []; this.attrs = {}; this.className = ''; }
    appendChild(k) { this.childNodes.push(k); k.parentNode = this; return k; } insertBefore(k) { this.childNodes.push(k); k.parentNode = this; return k; } get nextSibling() { return null; }
    setAttribute(a, v) { this.attrs[a] = String(v); } get textContent() { return this.childNodes.map((k) => (k.nodeType === 3 ? k.data : k.textContent)).join(''); }
    set textContent(v) { this.childNodes = v ? [{ nodeType: 3, data: String(v) }] : []; } set innerHTML(_) { throw new Error('innerHTML usado'); } }
  const d2 = { createElement: (t) => new N(t), createTextNode: (t) => ({ nodeType: 3, data: String(t) }) };
  const spans = (n, out = []) => { for (const k of n.childNodes || []) { if (k.className === 'na-asst-code') out.push(k); if (k.childNodes) spans(k, out); } return out; };
  const txt = 'Factura B001-00000123 y guía T001-00012345, serie 0001-00012345; fecha 2024-12345 y F001 suelto.';
  for (const step of [1, 2, 3, 7, 47, 999]) { const host = new N('div'); const r = C.createReplyRenderer(d2, (n) => host.appendChild(n)); for (let i = 0; i < txt.length; i += step) r.push(txt.slice(i, i + step)); r.finish();
    const out = host.textContent; assert.equal(out, txt, 'trozos de ' + step + ': ' + out); assert.ok(out.includes('B001-00000123') && !out.includes('\u2011'));
    assert.deepEqual(spans(host).map((x) => x.textContent), ['B001-00000123', 'T001-00012345', '0001-00012345'], 'trozos de ' + step);
    for (const sp of spans(host)) { assert.equal(sp.tagName, 'SPAN'); assert.equal(sp.childNodes.length, 1, 'una sola span por serie'); } }
});
