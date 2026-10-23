// Sobre d72b7601 (Bot 2 2/3, Bot 4 1, decisión final): normalización de lo escrito a mano (servidor y celular, misma regla), «XX6789» solo en
// documento/RUC, nombre de catálogo en la tarjeta, texto del 403 igual en el código y en CONTRATO.md, 14 px de la serie en la tabla del asistente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { toProposal, issueConfirmToken, assistantConfirmRoute, createMemoryUsageStore, normManual, manualBad } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const SECRET = 'secreto-de-prueba-1234567890', AUTH = { principalId: 'session:dueno', posRole: 'owner' };
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const reader = { products: async () => [], productsById: async () => new Map(), purchases: async () => [] };
const LINEAS = [{ nombre: 'Galleta', cantidad: 3, costo_unitario: 1.2 }];
async function confirm(proposal, manual) {
  const token = await issueConfirmToken(proposal, 'owner', AUTH, SECRET, Date.now()); const writes = [];
  const res = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token, proposal, manual }) }), { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET }, AUTH, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', reader, audit: async (db, rows) => { writes.push(...rows); } });
  return { status: res.status, body: await res.json() };
}
const prop = () => { const p = toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345 pedido 87654321', lineas: LINEAS } }, 'owner', { products: [] }, 1);
  assert.deepEqual(p.completar, ['proveedor', 'documento']); return p; };

const ZW = '\u200B', NB = '\u00A0';
// [campo, escrito, normalizado esperado | null (rechazado)]
const CASES = [
  ['documento', 'F001\u201100012345', 'F001-00012345'], ['documento', 'F001\u201000012345', 'F001-00012345'], ['documento', 'F001\u201400012345', 'F001-00012345'],
  ['documento', ZW + 'F001-' + ZW + '00012345\uFEFF', 'F001-00012345'], ['documento', NB + 'F001-00012345\u202F', 'F001-00012345'], ['documento', 'F001\u2007-\u20070001', 'F001 - 0001'],
  ['documento', '■■■■', null], ['documento', '××××', null], ['documento', 'XX6789', null], ['documento', 'xx-6789', null], ['documento', 'F001-XX6789', null], ['documento', ZW + ZW + '\u2060', null],
  ['documento', NB + NB, null], ['documento', '----', null], ['documento', '▪▪▪▪', null], ['documento', '____6789', null], ['documento', '####6789', null], ['documento', 'F001-[oculto]', null],
  ['proveedor', 'Ferretería XXL SAC', 'Ferretería XXL SAC'], ['proveedor', 'Distribuidora XX', 'Distribuidora XX'], ['proveedor', 'Distribuidora XX 2024', 'Distribuidora XX 2024'],
  ['proveedor', 'Juan' + NB + 'Pérez' + ZW, 'Juan Pérez'], ['proveedor', 'Alicorp\u2011Sur', 'Alicorp-Sur'],
  ['proveedor', '▪▪▪▪', null], ['proveedor', '■■■■', null], ['proveedor', '××××', null], ['proveedor', '____', null], ['proveedor', '####', null], ['proveedor', '****', null], ['proveedor', '••••', null],
  ['proveedor', 'Bodega ••••', null], ['proveedor', ZW + '\uFEFF', null], ['proveedor', '', null],
];

test('normalización: servidor (normManual/manualBad) y celular (C.normManual/C.manualBad) dan lo mismo en cada caso', () => {
  for (const [n, v, want] of CASES) {
    const s = normManual(v), c = C.normManual(v);
    assert.equal(c, s, 'misma normalización ' + JSON.stringify(v));
    assert.equal(manualBad(n, s), want === null, n + ' ' + JSON.stringify(v) + ' (servidor)'); assert.equal(C.manualBad(n, c), want === null, n + ' ' + JSON.stringify(v) + ' (celular)');
    if (want !== null) assert.equal(s, want);
  }
});

test('servidor: 422 fields_required en el campo malo; lo bueno se guarda y reenvía NORMALIZADO', async () => {
  for (const [n, v, want] of CASES) {
    const other = n === 'proveedor' ? { documento: 'F001-00012345' } : { proveedor: 'Bodega Juan SAC' };
    const r = await confirm(prop(), { ...other, [n]: v });
    if (want === null) { assert.equal(r.status, 422, n + ' ' + JSON.stringify(v)); assert.equal(r.body.error, 'fields_required'); assert.deepEqual(r.body.fields, [n]); assert.ok(!r.body.proposal); }
    else { assert.equal(r.status, 200, n + ' ' + JSON.stringify(v) + ' ' + JSON.stringify(r.body)); assert.equal(r.body.proposal[n], want, 'normalizado'); }
  }
});

function fakeDoc() {
  const mk = (tag) => ({ tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, value: '', id: '',
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, fire(t) { (this.listeners[t] || []).forEach((f) => f({ target: this })); }, focus() {} });
  return { createElement: mk };
}
test('celular: el campo malo queda con «Complete este dato» (estilo de alerta) y no cuenta; lo bueno va normalizado en body.manual', () => {
  const p = { id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: '', documento: 'F001-', completar: ['proveedor', 'documento'], lineas: [] };
  const need = C.needFields(fakeDoc(), p, () => {}); const [pv, dv] = need.inputs; const hint = (inp) => inp.parentNode.children[2];
  for (const [n, v, want] of CASES) {
    const inp = n === 'proveedor' ? pv : dv; inp.value = v; inp.fire('input');
    if (want === null || (n === 'documento' && want === 'F001-')) { assert.equal(need.state[n], '', JSON.stringify(v)); assert.equal(inp.getAttribute('aria-invalid'), 'true'); assert.equal(inp.className, 'na-asst-need'); assert.equal(hint(inp).hidden, false); assert.equal(hint(inp).textContent, 'Complete este dato'); }
    else { assert.equal(need.state[n], want, JSON.stringify(v)); assert.equal(inp.getAttribute('aria-invalid'), 'false'); assert.equal(hint(inp).hidden, true); }
  }
  // 422 del servidor: mismo aviso junto al campo
  pv.value = 'Ferretería XXL SAC'; pv.fire('input'); dv.value = 'F001\u201100012345'; dv.fire('input'); assert.equal(need.missing(), 0); assert.deepEqual(need.values(), { proveedor: 'Ferretería XXL SAC', documento: 'F001-00012345' });
  need.flag(['documento']); assert.equal(hint(dv).textContent, 'Complete este dato'); assert.equal(hint(dv).hidden, false); assert.equal(dv.className, 'na-asst-need');
  // fillValues / purchaseValue: normalizado; nunca relleno
  const q = { ...p, _manual: { proveedor: 'Distribuidora' + NB + 'XX' + ZW, documento: 'XX6789' } };
  assert.deepEqual(C.fillValues(q), { proveedor: 'Distribuidora XX' }); assert.equal(C.purchaseValue(q, 'proveedor'), 'Distribuidora XX'); assert.equal(C.purchaseValue(q, 'documento'), 'F001-');
});

test('tarjeta: una línea con product_id del catálogo local muestra el nombre del catálogo (no el tapado de la propuesta)', () => {
  const src = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function lineName(l)'), src.indexOf('function cardHtml(p)'));
  const lineName = new Function('deps', body + '\nreturn lineName;')({ productos: () => [{ id: 7, nombre: 'Leche Gloria 400g' }] });
  assert.equal(lineName({ product_id: 7, nombre: 'Leche DNI ****5678' }), 'Leche Gloria 400g');
  assert.equal(lineName({ product_id: '7', nombre: 'x' }), 'Leche Gloria 400g');
  assert.equal(lineName({ product_id: 99, nombre: 'Galleta' }), 'Galleta'); assert.equal(lineName({ nombre: 'Arroz' }), 'Arroz');
  assert.match(src, /E\(l\.cantidad\) \+ ' × '\) \+ E\(lineName\(l\)\)/); // (fila-mixta) sin cantidad: «Falta la cantidad · nombre»
});

test('403: el texto de asistente-core.js es EXACTAMENTE el de CONTRATO.md', () => {
  const want = 'Esta sesión ya no es de Admin. Vuelva a entrar como Admin y pida la compra de nuevo.';
  assert.equal(C.ROLE_LOST_MSG, want);
  const doc = readFileSync(new URL('../../docs/asistente/CONTRATO.md', import.meta.url), 'utf8');
  const line = doc.split('\n').find((l) => l.includes('403 `forbidden_role` al confirmar')); assert.ok(line, 'línea del 403 en CONTRATO.md');
  const quoted = [...line.matchAll(/«([^»]+)»/g)].map((m) => m[1]); assert.ok(quoted.includes(C.ROLE_LOST_MSG), JSON.stringify(quoted));
});

test('CSS: la serie en la tabla del asistente va a 14 px con selector de la tabla del asistente (gana a base.css td 12px)', () => {
  const css = readFileSync(new URL('../../POS/css/asistente.css', import.meta.url), 'utf8');
  assert.match(css, /\.na-asst-tbl \.na-asst-code\.na-asst-cc\{[^}]*font-size:14px/);
  assert.ok(!/(^|\})\s*td\s*\{[^}]*font-size/.test(css), 'sin tocar td sueltos');
});
