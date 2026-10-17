// Sobre c16a407d (Bot 4, INFORME 5646a4c9): 1) el CAMPO de la tarjeta muestra lo limpio (U+202E, U+00AD, U+200B… fuera al escribir y al pegar,
// el cursor retrocede lo quitado antes de él, sin tocar durante una composición y limpiando en compositionend); lo visible = lo que se manda;
// 2) los campos conservan na-asst-ltr (y na-asst-need) en los ciclos lleno/vacío/422 (classList, no className); 3) la propuesta con U+00AD
// («F001-000-­/12345») sale limpia en el servidor (cardField, línea) y en el celular (purchaseValue, appendCoded, inicio del campo). Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const UI_SRC = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const CORE_SRC = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const FMT = /[\p{Cf}\u00AD]/u;

// documento falso con classList y selección como un <input> real
function classList(n) { const set = () => String(n.className || '').split(/\s+/).filter(Boolean);
  return { add: (k) => { const a = set(); if (!a.includes(k)) a.push(k); n.className = a.join(' '); }, remove: (k) => { n.className = set().filter((x) => x !== k).join(' '); },
    toggle: (k, on) => { const a = set().filter((x) => x !== k); if (on) a.push(k); n.className = a.join(' '); return !!on; }, contains: (k) => set().includes(k) }; }
function fakeDoc() {
  const mk = (tag) => { const n = { tag, children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, style: {}, _v: '', selectionStart: 0, selectionEnd: 0, sets: 0,
    get value() { return this._v; }, set value(v) { this._v = String(v); this.selectionStart = this.selectionEnd = this._v.length; this.sets++; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    appendChild(k) { this.children.push(k); k.parentNode = this; return k; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, fire(t, ev = {}) { (this.listeners[t] || []).forEach((f) => f({ target: this, ...ev })); }, focus() {} };
    n.classList = classList(n); return n; };
  return { createElement: mk };
}
// escribe/pega «text» en el cursor (reemplaza la selección) como el navegador: valor nuevo, cursor al final de lo insertado, luego «input»
function insert(inp, text, ev = {}) { const v = inp.value, s = inp.selectionStart, e = inp.selectionEnd; inp._v = v.slice(0, s) + text + v.slice(e); inp.selectionStart = inp.selectionEnd = s + text.length; inp.fire('input', ev); }
const prop = (extra = {}) => ({ id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: '', documento: '', completar: ['proveedor', 'documento'], lineas: [], ...extra });
const ltrIsolateReal = async () => { const vm = await import('node:vm'); const i0 = UI_SRC.indexOf('  function ltrIsolate('), i1 = UI_SRC.indexOf('\n  var deps = {', i0); assert.ok(i0 > 0 && i1 > i0);
  const ctx = vm.createContext({}); vm.runInContext(UI_SRC.slice(i0, i1), ctx); return ctx.ltrIsolate; };

test('Bot 4 / 1) el campo muestra lo limpio: U+202E, U+00AD, ZWSP escritos o pegados se quitan del valor visible; lo visible = lo enviado', () => {
  const need = C.needFields(fakeDoc(), prop(), () => {}); const [pv, dv] = need.inputs;
  // pegado entero con U+202E: se ve «1234-100F» (no «F001-4321») y es lo que se manda
  insert(dv, '\u202E1234-100F'); assert.equal(dv.value, '1234-100F'); assert.equal(need.state.documento, '1234-100F'); assert.equal(dv.selectionStart, 9);
  for (const [raw, want] of [['F001-\u00AD00012345', 'F001-00012345'], ['F001\u200B-0001\u200B2345', 'F001-00012345'], ['\u2066F001-00012345\u2069', 'F001-00012345'], ['F001\u2011000\uFEFF12', 'F001-00012'], ['F\u034F001-7\uFE0F7', 'F001-77'], ['\uDB40\uDC41F001-99', 'F001-99']]) {
    dv._v = ''; dv.selectionStart = dv.selectionEnd = 0; insert(dv, raw);
    assert.equal(dv.value, want, JSON.stringify(raw)); assert.ok(!FMT.test(dv.value)); assert.equal(dv.value.trim(), C.normManual(raw)); assert.equal(need.values().documento, dv.value.trim());
  }
  // escrito carácter por carácter, con invisibles en medio
  pv._v = ''; pv.selectionStart = pv.selectionEnd = 0; for (const ch of 'Sur\u00AD \u202ESAC\u200B') insert(pv, ch);
  assert.equal(pv.value, 'Sur SAC'); assert.equal(need.state.proveedor, 'Sur SAC'); assert.equal(pv.selectionStart, 7);
  // «José» con acento combinante queda (NFC), sin mover el cursor más de la cuenta
  pv._v = ''; pv.selectionStart = pv.selectionEnd = 0; insert(pv, 'Jose\u0301 Pérez'); assert.equal(pv.value, 'José Pérez'); assert.equal(pv.selectionStart, 10);
  // la función es la misma que la del servidor + recorte
  for (const raw of ['\u202E1234-100F ', ' F001\u00AD-1\u00A02', 'a\x01\x02b']) assert.equal(C.inputClean(raw).trim(), A.normManual(raw));
});

test('Bot 4 / 1) cursor: escribir en medio no lo mueve; pegar con U+202E deja el cursor al final de lo pegado; sin cambios no se reescribe', () => {
  const need = C.needFields(fakeDoc(), prop(), () => {}); const [, dv] = need.inputs;
  insert(dv, 'F001-0012345'); const sets0 = dv.sets;
  // escribir normal en medio: el valor no se reescribe (el navegador no pierde el cursor)
  dv.selectionStart = dv.selectionEnd = 5; insert(dv, '0'); assert.equal(dv.value, 'F001-00012345'); assert.equal(dv.selectionStart, 6); assert.equal(dv.sets, sets0, 'sin reescritura');
  // invisible tecleado en medio: se quita y el cursor queda donde estaba
  dv.selectionStart = dv.selectionEnd = 4; insert(dv, '\u200B'); assert.equal(dv.value, 'F001-00012345'); assert.equal(dv.selectionStart, 4); assert.equal(dv.selectionEnd, 4);
  // pegar en medio con U+202E/U+00AD: cursor al final de lo pegado (menos lo quitado)
  dv.selectionStart = dv.selectionEnd = 5; insert(dv, '\u202E99\u00AD8\u202C'); assert.equal(dv.value, 'F001-99800012345'); assert.equal(dv.selectionStart, 8); assert.equal(dv.selectionEnd, 8);
  // pegar reemplazando una selección
  dv.selectionStart = 5; dv.selectionEnd = 8; insert(dv, '\u2066\u2069'); assert.equal(dv.value, 'F001-00012345'); assert.equal(dv.selectionStart, 5);
  // invisibles antes del cursor y después: solo cuentan los de antes
  dv._v = '\u200BF001-\u00AD12|\u200B34'; dv.selectionStart = dv.selectionEnd = 10; dv.fire('input'); assert.equal(dv.value, 'F001-12|34'); assert.equal(dv.selectionStart, 8);
  // selección que abarca invisibles
  dv._v = 'A\u200BB\u200BC\u200BD'; dv.selectionStart = 1; dv.selectionEnd = 6; dv.fire('input'); assert.equal(dv.value, 'ABCD'); assert.equal(dv.selectionStart, 1); assert.equal(dv.selectionEnd, 3);
  assert.equal(need.state.documento, 'ABCD', 'lo enviado = lo visible');
});

test('Bot 4 / 1) composición (IME / acentos): no se reescribe a mitad de palabra; se limpia en compositionend', () => {
  const need = C.needFields(fakeDoc(), prop(), () => {}); const [pv] = need.inputs;
  insert(pv, 'Sur '); pv.fire('compositionstart'); const sets0 = pv.sets;
  insert(pv, 'S', { isComposing: true }); insert(pv, '\u00AD', { isComposing: true }); insert(pv, 'A\u0301', { isComposing: true });
  assert.equal(pv.value, 'Sur S\u00ADA\u0301', 'sin tocar mientras compone'); assert.equal(pv.sets, sets0);
  pv.fire('compositionend'); assert.equal(pv.value, 'Sur SÁ'); assert.equal(pv.selectionStart, 6); assert.equal(need.state.proveedor, 'Sur SÁ');
  // isComposing sin compositionstart (algunos teclados) tampoco reescribe
  insert(pv, '\u200B', { isComposing: true }); assert.equal(pv.value, 'Sur SÁ\u200B'); insert(pv, 'C'); assert.equal(pv.value, 'Sur SÁC');
  // la fuente: escucha compositionstart/compositionend e isComposing
  const fn = CORE_SRC.slice(CORE_SRC.indexOf('function needFields'), CORE_SRC.indexOf('var needSeq'));
  assert.match(fn, /compositionstart/); assert.match(fn, /compositionend/); assert.match(fn, /isComposing/); assert.ok(!/innerHTML|insertAdjacentHTML/.test(fn));
});

test('Bot 4 / 2) documento y proveedor conservan na-asst-ltr y na-asst-need en lleno → vacío → 422 → lleno', async () => {
  const ltrIsolate = await ltrIsolateReal(); const need = C.needFields(fakeDoc(), prop(), () => {}); const [pv, dv] = need.inputs;
  need.inputs.forEach((i) => ltrIsolate(i)); // como addCard
  const keeps = (i) => { assert.ok(i.classList.contains('na-asst-ltr'), i.className); assert.ok(i.classList.contains('na-asst-need'), i.className); assert.equal(i.attrs.dir, 'ltr'); };
  for (const i of [pv, dv]) keeps(i);
  insert(dv, 'F001-00012345'); keeps(dv); assert.ok(dv.classList.contains('ok'));
  dv._v = ''; dv.fire('input'); keeps(dv); assert.ok(!dv.classList.contains('ok'));
  insert(dv, 'F001-00012345'); insert(pv, 'Sur SAC'); keeps(dv); keeps(pv); assert.equal(need.missing(), 0);
  need.flag(['documento', 'proveedor']); keeps(dv); keeps(pv); assert.ok(!dv.classList.contains('ok')); assert.ok(!pv.classList.contains('ok'));
  insert(dv, '9'); keeps(dv); assert.ok(dv.classList.contains('ok'));
  for (let k = 0; k < 5; k++) { dv._v = ''; dv.fire('input'); insert(dv, '\u202EF001-1' + k); need.flag(['documento']); }
  keeps(dv); assert.equal(dv.className.split(' ').filter((x) => x === 'na-asst-ltr').length, 1, 'sin repetir');
  // sin classList (navegador viejo / pruebas viejas): se cambia solo «ok»
  const d2 = fakeDoc(), mk = d2.createElement; d2.createElement = (t) => { const n = mk(t); delete n.classList; return n; };
  const n2 = C.needFields(d2, prop(), () => {}); const [, dv2] = n2.inputs; dv2.className += ' na-asst-ltr';
  insert(dv2, 'F001-1'); assert.equal(dv2.className, 'na-asst-need na-asst-ltr ok'); n2.flag(['documento']); assert.equal(dv2.className, 'na-asst-need na-asst-ltr');
  // la fuente ya no pisa className en el campo
  const fn = CORE_SRC.slice(CORE_SRC.indexOf('function needFields'), CORE_SRC.indexOf('var needSeq')); assert.equal((fn.match(/inp\.className\s*=/g) || []).length, 1, 'solo al crear el campo');
});

test('Bot 4 / 3) propuesta con U+00AD («F001-000-­/12345»): limpia en el servidor, en purchaseValue, appendCoded y en el inicio del campo', () => {
  const ctx = { products: [{ id: 'P1', nombre: 'Galleta Soda', precio: 2, stock: 5 }] };
  const p = A.toProposal({ name: 'preparar_compra', arguments: JSON.stringify({ proveedor: 'Sur\u00AD SAC', documento: 'F001-000-\u00AD/12345', fecha: '2026-10-\u00AD17', lineas: [{ nombre: 'Gall\u00ADeta', cantidad: 2, costo_unitario: 1 }] }) }, 'owner', ctx, 0);
  for (const v of [p.proveedor, p.documento, p.fecha, ...p.lineas.map((l) => l.nombre)]) assert.ok(!FMT.test(String(v)), JSON.stringify(v));
  assert.equal(p.documento, 'F001-000-/12345'); assert.equal(p.proveedor, 'Sur SAC'); assert.equal(A.fmtClean('F001-000-\u00AD/12345'), 'F001-000-/12345');
  const raw = { type: 'compra', proveedor: 'Sur\u00AD SAC', documento: 'F001-000-\u00AD/12345', lineas: [] };
  assert.equal(C.purchaseValue(raw, 'documento'), 'F001-000-/12345'); assert.equal(C.purchaseValue(raw, 'proveedor'), 'Sur SAC'); assert.equal(C.fmtClean(raw.documento), A.fmtClean(raw.documento));
  const nodes = []; const doc = { createTextNode: (t) => ({ t }), createElement: (tag) => ({ tag, kids: [], className: '', set textContent(v) { this.t = v; }, get textContent() { return this.t; }, appendChild(k) { this.kids.push(k); } }) };
  C.appendCoded(doc, { appendChild: (k) => nodes.push(k) }, raw.documento); const txt = (n) => n.t != null ? n.t : (n.kids || []).map(txt).join('');
  assert.equal(nodes.map(txt).join(''), 'F001-000-/12345');
  // inicio del campo «completar» (servidor viejo / factura alterada que trae «F001-» con U+00AD/U+202E): se muestra limpio
  const need = C.needFields(fakeDoc(), prop({ documento: 'F001\u00AD-\u202E' }), () => {}); assert.equal(need.inputs[1].value, 'F001-'); assert.equal(need.missing(), 2);
});
