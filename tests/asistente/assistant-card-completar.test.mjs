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

test('B) servidor: confirm sin valor para «completar» → 422 fields_required con los nombres; nada se marca usado; con valor → 200 y la compra lleva lo escrito', async () => {
  const p = toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345 pedido 87654321', lineas: LINEAS } }, 'owner', { products: [] }, 1);
  assert.deepEqual(p.completar, ['proveedor', 'documento']);
  const store = createMemoryUsageStore();
  for (const fill of [undefined, {}, { proveedor: '   ' }, { proveedor: 'Bodega Juan RUC *******9012', documento: 'F001-00012345 pedido 87654321' }, { proveedor: 'Bodega Juan [dato del dueño]', documento: 'x' },
    { proveedor: ['Bodega'], documento: 'x' }, { proveedor: 'Bodega Juan RUC 10456789012' }, 'Bodega']) {
    const r = await confirm(p, fill === undefined ? {} : { fill }, store);
    assert.equal(r.status, 422, JSON.stringify(fill)); assert.equal(r.body.error, 'fields_required'); assert.ok(!r.body.ok && Array.isArray(r.body.fields) && r.body.fields.length, JSON.stringify(r.body));
    assert.ok(r.writes.some((w) => w.outcome === 'rejected:fields_required'), 'queda en la bitácora'); }
  // con los dos valores (sin máscara): 200 y lo escrito sale en la propuesta aplicada; la propuesta firmada no cambió
  const fill = { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345 pedido 87654321' };
  const ok = await confirm(p, { fill }, store); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.ok, true);
  assert.equal(ok.body.proposal.proveedor, fill.proveedor); assert.equal(ok.body.proposal.documento, fill.documento);
  // reenvío (corte de señal): already_confirmed con lo mismo
  const again = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token: ok.token, proposal: p, fill }) }), { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET }, AUTH, jsonR,
    { store, resolveRole: async () => 'owner', reader, audit: async () => {} });
  const ab = await again.json(); assert.equal(ab.already_confirmed, true); assert.equal(ab.proposal.proveedor, fill.proveedor);
  // reglas del hash: poner lo escrito DENTRO de la propuesta firmada → 409 proposal_changed
  const changed = await confirm({ ...p, proveedor: fill.proveedor, documento: fill.documento }, { fill }, createMemoryUsageStore(), p); assert.equal(changed.status, 409); assert.equal(changed.body.error, 'proposal_changed');
  // solo lo nombrado: el que falta aparece en fields
  const one = await confirm(p, { fill: { proveedor: fill.proveedor } }, createMemoryUsageStore()); assert.deepEqual(one.body.fields, ['documento']);
});

test('B) servidor: una máscara en CUALQUIER campo de la propuesta (firmada así) → 422 fields_required; sin máscara ni completar, como siempre', async () => {
  const base = toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Alicorp SAC', documento: 'F001-00012345', lineas: LINEAS } }, 'owner', { products: [] }, 1);
  const clean = await confirm(base, {}, createMemoryUsageStore()); assert.equal(clean.status, 200, JSON.stringify(clean.body));
  for (const [k, v] of [['proveedor', 'Alicorp RUC *******5237'], ['documento', 'F001-[DNI oculto]'], ['title', 'Compra [dato del dueño]'], ['lineas', [{ nombre: 'Galleta DNI ****5678', cantidad: 1, costo_unitario: 1 }]]]) {
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
test('celular (Bot 2 A / Bot 4): campo con la parte exacta de inicio; 422 fields_required → aviso junto al campo, foco, lo escrito y la tarjeta quedan; fill va aparte', async () => {
  const doc = fakeDoc(), p = { id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: 'Alicorp SAC', documento: 'F001-', completar: ['documento'], lineas: [] };
  const need = C.needFields(doc, p, () => {}); const [d] = need.inputs; assert.equal(d.value, 'F001-'); assert.equal(need.missing(), 1);
  d.fire('input'); assert.equal(need.missing(), 1, 'la parte exacta sola no cuenta'); d.value = 'F001-00012345'; d.fire('input'); assert.equal(need.missing(), 0);
  Object.defineProperty(p, '_manual', { value: need.state, enumerable: false });
  assert.deepEqual(C.fillValues(p), { documento: 'F001-00012345' }); assert.ok(!JSON.stringify(p).includes('00012345'), 'fill fuera de la propuesta firmada');
  // el servidor rechaza: la puerta deja la tarjeta pendiente y pasa los nombres
  const owner = { role: 'owner', isOwner: () => true }; let sent = null;
  const g = C.createGate({ roles: () => owner, online: () => true, productos: () => [], confirm: async (pp) => { sent = C.fillValues(pp); return { ok: false, error: 'fields_required', fields: ['documento', 'lineas'] }; } });
  const key = g.add(p); const r = await g.execute(key, { confirmed: true });
  assert.equal(r.ok, false); assert.equal(r.code, 'fields_required'); assert.deepEqual(r.fields, ['documento', 'lineas']); assert.equal(g.state(key) || 'pending', 'pending'); assert.deepEqual(sent, { documento: 'F001-00012345' });
  const v = C.confirmFailureView(r); assert.equal(v.kind, 'fields'); assert.equal(v.button, 'Confirmar'); assert.doesNotMatch(v.msg, /_|HTTP|error|\d{3}/);
  const hint = d.parentNode.children[2]; const rest = need.flag(v.fields);
  assert.deepEqual(rest, ['lineas']); assert.equal(hint.hidden, false); assert.equal(hint.textContent, 'Complete este dato'); assert.equal(d.getAttribute('aria-invalid'), 'true'); assert.equal(fakeDoc.focused, d);
  assert.equal(d.value, 'F001-00012345', 'lo escrito queda'); assert.equal(need.state.documento, 'F001-00012345');
  assert.equal(C.confirmFailureView({ ok: false, code: 'fields_required', fields: ['documento'] }).msg, 'Complete los datos marcados y vuelva a confirmar.');
  // cableado: confirmRemote manda fill; la tarjeta marca los campos y deja el aviso con textContent; nada de innerHTML en lo nuevo
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8'), CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
  assert.match(UI, /var fill = C\.fillValues \? C\.fillValues\(p\) : null; if \(fill\) body\.fill = fill;/);
  assert.match(UI, /if \(f\.kind === 'fields'\) \{ var rest = need \? need\.flag\(f\.fields\) : f\.fields; res\.textContent = /);
  const fn = CORE.slice(CORE.indexOf('function needFields'), CORE.indexOf('var needSeq')); assert.ok(/function flag/.test(fn) && !/innerHTML|insertAdjacentHTML/.test(fn));
  assert.match(CORE, /fields_required: \['Complete los datos marcados y vuelva a confirmar\.'\]/);
});
