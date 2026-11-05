// Auditoría 500 (CANON, inventario): en el celular «Nueva conversación» dejaba la respuesta anterior en el texto oculto del panel
// (.na-asst-live, la región aria-live para el lector de pantalla: recortada con clip, NO display:none, así que sigue en innerText).
// INV-009 «repitió» el texto de INV-008: era el aviso del lector que quedó de la charla anterior. Código REAL de asistente-ui.js
// (announce + newChat) sobre un DOM mínimo.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { makeDoc, Node_ } from './fake-dom.mjs';

const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const sliceFn = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
if (!Object.getOwnPropertyDescriptor(Node_.prototype, 'children')) Object.defineProperty(Node_.prototype, 'children', { get() { return this.childNodes.filter((n) => n.nodeType === 1); } });
if (!Node_.prototype.remove) Node_.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OLD = 'Arroz Costeño 1 kg: te quedan 12 unid. (mínimo 10).';

function panel() {
  const doc = makeDoc(), mk = (c) => { const n = doc.createElement('div'); n.className = c; return n; };
  const panelEl = mk('na-asst-panel'), msgsEl = mk('na-asst-msgs'), liveEl = mk('na-asst-live'), chips = mk('na-asst-chips');
  panelEl.appendChild(msgsEl); panelEl.appendChild(liveEl); panelEl.appendChild(chips);
  panelEl.querySelector = (s) => panelEl.byClass(s.replace(/^\./, ''))[0] || null;
  const ctx = vm.createContext({ doc, panelEl, msgsEl, liveEl, liveT: 0, newBtn: null, inputEl: null, busy: false, history: [], gate: {}, C: {}, setTimeout, clearTimeout, String,
    el: (t, c) => { const n = doc.createElement(t); if (c) n.className = c; return n; } });
  // Anclado en announce (existe en la base): sin el arreglo falla por el aviso que reaparece, no por no encontrar el código.
  // liveT va en el contexto porque su «var» queda justo antes de announce.
  vm.runInContext(sliceFn(UI, '  function announce(t)', '  function addMsg(') + sliceFn(UI, '  function newChat() {', '  // Enter mientras responde'), ctx);
  const a = doc.createElement('div'); a.className = 'na-asst-msg a'; a.textContent = OLD; msgsEl.appendChild(a);
  return { ctx, panelEl, liveEl };
}

test('«Nueva conversación»: la respuesta anterior no queda en el panel ni en su texto oculto (región del lector)', async () => {
  const { ctx, panelEl, liveEl } = panel();
  ctx.announce(OLD); await sleep(60);
  assert.equal(liveEl.textContent, OLD, 'antes: el lector tiene la respuesta');
  ctx.newChat();
  assert.equal(liveEl.textContent, '', 'la región oculta queda vacía');
  assert.ok(!panelEl.textContent.includes(OLD), 'nada de la respuesta anterior en el texto del panel: ' + panelEl.textContent);
  assert.match(panelEl.textContent, /Conversación nueva\./);
});

test('«Nueva conversación» justo después de terminar (aviso del lector aún pendiente, 30 ms): no reaparece después', async () => {
  const { ctx, panelEl, liveEl } = panel();
  ctx.announce(OLD); ctx.newChat(); await sleep(60);
  assert.equal(liveEl.textContent, '');
  assert.ok(!panelEl.textContent.includes(OLD));
  ctx.announce('Nueva respuesta'); await sleep(60);
  assert.equal(liveEl.textContent, 'Nueva respuesta', 'lo siguiente se sigue anunciando');
});
