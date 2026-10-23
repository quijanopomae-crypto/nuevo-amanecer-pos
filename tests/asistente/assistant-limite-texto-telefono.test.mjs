// Teléfono (pedido de alfa sobre #983): (a) el campo de Inicio tiene maxlength="500" y cortaba EN SILENCIO lo escrito o pegado de más:
// ahora se ve un contador cerca del tope y un aviso al llegar o al pegar algo que no entra. (b) Si la respuesta del chat trae
// «texto_cortado» (#986: { leidos, faltan }), sale un botón para mandar el resto del mensaje. El campo se lee a la defensiva: puede no venir.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../POS/css/asistente.css', import.meta.url), 'utf8');
const sliceFn = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

test('core: contador cerca del tope y aviso al llegar a 500', () => {
  assert.equal(typeof C.inputLimitNote, 'function');
  assert.equal(C.inputLimitNote(0, 500), null); assert.equal(C.inputLimitNote(449, 500), null);
  assert.equal(C.inputLimitNote(450, 500), '450/500');
  assert.match(C.inputLimitNote(500, 500), /máximo de 500 caracteres/); assert.match(C.inputLimitNote(500, 500), /otro mensaje/);
});

test('core: lo pegado que no entra se cuenta y se avisa', () => {
  assert.equal(C.pastedOverflow(490, 0, 30, 500), 20);
  assert.equal(C.pastedOverflow(490, 10, 20, 500), 0, 'lo seleccionado se reemplaza');
  assert.equal(C.pastedOverflow(0, 0, 500, 500), 0);
  assert.equal(C.pastedOverflow(0, 0, 1829, 500), 1329);
  assert.match(C.pasteLostNote(1329, 500), /1329 caracteres/); assert.match(C.pasteLostNote(1329, 500), /500/);
});

test('core: texto_cortado -> el resto exacto de lo enviado; datos raros -> null (sin botón)', () => {
  const sent = 'a'.repeat(1500) + ' y 3 atún florida';
  assert.equal(C.cutRest(sent, { leidos: 1500, faltan: 17 }), 'y 3 atún florida');
  assert.equal(C.cutRest(sent, { faltan: 17 }), 'y 3 atún florida', 'solo «faltan» también sirve');
  for (const bad of [undefined, null, 'x', 5, [], {}, { leidos: '1500' }, { leidos: -1 }, { leidos: 0 }, { leidos: 99999 }, { leidos: 1.5 }, { leidos: NaN }, { faltan: 0 }, { faltan: 99999 }])
    assert.equal(C.cutRest(sent, bad), null, JSON.stringify(bad));
  assert.equal(C.cutRest('hola     ', { leidos: 4 }), null, 'solo espacios: nada que mandar');
  assert.equal(C.cutRest(null, { leidos: 3 }), null);
});

// Pequeño DOM falso para correr las funciones reales de asistente-ui.js.
function fakeEl(tag) {
  const e = { tagName: tag, className: '', textContent: '', hidden: false, children: [], parentNode: null, attrs: {}, listeners: {}, type: '',
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    remove() { if (this.parentNode) { const p = this.parentNode; p.children.splice(p.children.indexOf(this), 1); this.parentNode = null; } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(k, f) { (this.listeners[k] = this.listeners[k] || []).push(f); },
    fire(k, ev) { (this.listeners[k] || []).forEach((f) => f(ev || {})); } };
  return e;
}

test('Inicio: el campo de 500 muestra contador y aviso (no corta en silencio)', () => {
  const hero = sliceFn(UI, "    else heroEl.innerHTML = txt + vis + '<form class=\"h-in\"", '    heroEl.classList.toggle');
  assert.match(hero, /maxlength="500"/, 'el tope del campo sigue (la burbuja de Inicio es corta)');
  assert.match(hero, /<p class="h-lim" role="status" aria-live="polite" hidden><\/p>/);
  assert.match(UI, /wireLimit\(form\.querySelector\('input'\), heroEl\.querySelector\('\.h-lim'\)\)/);
  assert.match(CSS, /\.na-asst-hero \.h-lim\[hidden\]\{display:none\}/);
  const ctx = vm.createContext({ C });
  vm.runInContext(sliceFn(UI, '  function wireLimit(', '  // fin wireLimit') + '; this.wireLimit = wireLimit;', ctx);
  const inp = fakeEl('input'); inp.setAttribute('maxlength', '500'); inp.value = ''; const note = fakeEl('p'); note.hidden = true;
  ctx.wireLimit(inp, note);
  inp.value = 'x'.repeat(100); inp.fire('input'); assert.equal(note.hidden, true);
  inp.value = 'x'.repeat(470); inp.fire('input'); assert.equal(note.hidden, false); assert.equal(note.textContent, '470/500');
  inp.value = 'x'.repeat(500); inp.fire('input'); assert.match(note.textContent, /máximo de 500/);
  // pegar 1829 caracteres en el campo vacío: el navegador deja 500; el aviso dice cuántos quedaron fuera
  inp.value = ''; inp.selectionStart = 0; inp.selectionEnd = 0;
  inp.fire('paste', { clipboardData: { getData: () => 'y'.repeat(1829) } }); inp.value = 'y'.repeat(500); inp.fire('input');
  assert.equal(note.hidden, false); assert.match(note.textContent, /1329 caracteres/);
  inp.value = 'hola'; inp.fire('input'); assert.equal(note.hidden, true, 'al borrar se va el aviso');
  // al enviar se limpia
  assert.match(sliceFn(UI, '    if (form) form.onsubmit', '    heroEl.onclick'), /lim\.hidden = true/);
});

test('chat: texto_cortado -> botón «Enviar el resto» que manda exactamente lo que faltó; sin el campo no hay botón', () => {
  const chat = sliceFn(UI, '      (d.proposals || []).forEach(function (x) { addCard(x, text); });', '      if (stick)');
  assert.match(chat, /C\.cutRest\(body\.text, d\.texto_cortado\)/);
  const sent = []; const msgs = fakeEl('div');
  const ctx = vm.createContext({ C, msgsEl: msgs, el: (tag, cls) => { const e = fakeEl(tag); if (cls) e.className = cls; return e; }, send: (t) => sent.push(t) });
  vm.runInContext(sliceFn(UI, '  function restButton(', '  // fin restButton') + '; this.restButton = restButton;', ctx);
  const w = ctx.restButton('y 3 atún florida');
  assert.equal(msgs.children.length, 1); const b = w.children[0];
  assert.equal(b.tagName, 'button'); assert.equal(b.type, 'button'); assert.match(b.textContent, /Enviar el resto/); assert.match(b.textContent, /16 caracteres/);
  b.onclick(); assert.deepEqual(sent, ['y 3 atún florida']); assert.equal(msgs.children.length, 0, 'el botón se va al usarlo (no se manda dos veces)');
  // respuesta simulada de #986 y una sin el campo (antes de #986)
  const body = { text: 'a'.repeat(1500) + ' y 3 atún florida' };
  assert.equal(C.cutRest(body.text, { leidos: 1500, faltan: 17 }), 'y 3 atún florida');
  assert.equal(C.cutRest(body.text, undefined), null);
});
