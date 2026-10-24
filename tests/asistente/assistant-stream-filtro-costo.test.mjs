// (22-10, fix/asist-filtro-partes, diseño simple) texto en partes: sin etiqueta sale en vivo; desde la primera etiqueta peligrosa se retiene
// y al cerrar sale el resto del filtro del texto entero (una vez). Costo acotado: < 20 ms para 4000 caracteres llenos de «clave»/«pin».
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextEmitter, redactFor, capReply, ownerHold, createStatusBeat, streamHoldStatus, STREAM_LABELS, LABEL_TAIL, REPLY_MAX } from '../../tools/cloudflare-lab/src/pos-assistant.js';

const EMP = 'empleado:consultas';
const ROLES = ['owner', EMP];
const mk = (role, max = REPLY_MAX) => { const o = { text: '', ev: [] }; const e = createTextEmitter((d) => { o.ev.push(d); if (d.t) o.text += d.t; }, max, redactFor(role), role === 'owner' ? null : ownerHold); return [e, o]; };

test('retención: la cola cubre la etiqueta más larga menos 1 (con tilde descompuesta y mayúsculas)', () => {
  const longest = Math.max(...STREAM_LABELS.flatMap((l) => [l, l.toUpperCase(), l.normalize('NFD')]).map((l) => l.length));
  assert.ok(LABEL_TAIL >= longest - 1, LABEL_TAIL + ' < ' + (longest - 1));
  assert.ok(LABEL_TAIL >= 'contraseña'.length - 1);
});

test('retención: sin etiqueta sale en vivo (antes de cerrar) y al final igual al texto entero', () => {
  const t = 'Hola, el arroz cuesta S/ 4.50 y quedan 12 unid. en la tienda. '.repeat(8);
  for (const role of ROLES) { const [e, o] = mk(role); for (const w of t.split(/(?<=\s)/)) e.push(w);
    assert.ok(o.text.length > 300, role + ': salió en vivo ' + o.text.length); assert.equal(e.holding(), false);
    e.flush(); assert.equal(o.text, capReply(redactFor(role)(t))); }
});

test('retención: desde la etiqueta no sale nada más hasta cerrar; luego el resto del texto entero, sin reset', () => {
  const pre = 'Buenos días, le cuento cómo va la tienda hoy con las ventas del local. ';
  for (const lab of ['clave', 'CONTRASEÑA', 'pin', 'Password', 'token', 'api key']) for (const role of ROLES) for (const cutIn of [0, 2]) {
    const t = pre + lab + ' abc123 y el resto del mensaje sigue aquí por un buen rato.';
    const [e, o] = mk(role), cut = pre.length + cutIn; // corte dentro de la etiqueta («cl» | «ave»)
    for (const ch of [...t.slice(0, cut)]) e.push(ch);
    e.push(t.slice(cut, cut + 3)); e.push(t.slice(cut + 3));
    const before = o.text; assert.ok(e.holding(), role + ' ' + lab + ': retiene');
    assert.ok(pre.startsWith(before), role + ' ' + lab + ': solo sale lo de antes de la etiqueta (ni un pedazo de ella): ' + JSON.stringify(before));
    assert.ok(before.length > 20, role + ': lo de antes salió en vivo');
    e.flush(); assert.equal(o.text, capReply(redactFor(role)(t))); assert.ok(!o.ev.some((d) => d.reset));
  }
});

test('retención: con etiqueta y respuesta más larga que REPLY_MAX, el corte y el aviso quedan como capReply', () => {
  for (const role of ROLES) { const t = 'la clave es «perro azul '.repeat(170); const [e, o] = mk(role);
    for (let k = 0; k < t.length; k += 5) e.push(t.slice(k, k + 5)); e.flush(); assert.equal(o.text, capReply(redactFor(role)(t))); }
});

test('retención: mientras retiene con texto ya pintado, el latido manda status «pensando» (una sola función: streamHoldStatus)', () => {
  const sent = []; const sse = { send: (ev, d) => sent.push([ev, d]) };
  const [e] = mk('owner'); const beat = createStatusBeat(sse, e, 1e9);
  e.push('Hola, le cuento cómo va la tienda hoy con las ventas del local y lo demás. '); beat.tick(); assert.equal(sent.length, 0, 'con texto y sin retener: nada');
  e.push('la clave abc123'); assert.ok(e.holding()); beat.tick(); assert.deepEqual(sent.at(-1), ['status', { s: 'pensando' }]);
  assert.deepEqual(streamHoldStatus(e), { s: 'pensando' });
  const [e2] = mk('owner'); assert.deepEqual(streamHoldStatus(e2), { s: 'buscando' }); beat.stop();
});

// costo: el menor de varias corridas (robusto a la carga de la máquina)
const PATS = ['clave "abcde ', 'precio clave ', 'la clave es «perro azul ', 'pin ', 'pin 1234 clave abc123 S/ 1.10 tel 987654321 ', 'mi clave del wifi es tortuga99. ', 'Hola, el arroz cuesta S/ 4.50 y quedan 12 unid. '];
const cost = (s, role, max, ch) => { let best = Infinity; for (let r = 0; r < 7; r++) { const a = performance.now();
  const e = createTextEmitter(() => {}, max, redactFor(role), role === 'owner' ? null : ownerHold); for (let k = 0; k < s.length; k += ch) e.push(s.slice(k, k + ch)); e.flush();
  best = Math.min(best, performance.now() - a); } return best; };
test('6b) costo del filtro en partes: 4000 caracteres llenos de etiquetas < 20 ms (sin tope y con REPLY_MAX), menor de 7 corridas', () => {
  for (const u of PATS) for (const role of ROLES) for (const max of [1e9, REPLY_MAX]) for (const ch of [1, 5]) {
    const s = u.repeat(Math.ceil(4000 / u.length)).slice(0, 4000), ms = cost(s, role, max, ch);
    assert.ok(ms < 20, JSON.stringify(u) + ' ' + role + ' max ' + max + ' de a ' + ch + ': ' + ms.toFixed(1) + ' ms'); }
});
