// fix/asist-placeholder-doble: una marca de tapado ya puesta («[clave oculta]» de maskCredentialValues, «[nombre oculto]»…) no se vuelve a
// tapar a medias en el filtro de siempre. Antes, con el Admin y con el empleado, «pin 4321» llegaba al modelo como «pin [oculto] oculta]»,
// y una respuesta del modelo con «pin [clave oculta]» salía igual de rota (texto entero y en partes de 1, 3 y 7).
// Datos inventados; el modelo siempre simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { COSTS_ROLE } from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';

const { assistantChatRoute, createMemoryUsageStore, parseChatBody, maskCredentialValues, createTextEmitter, redactFor, redactText, redactModelOwner, ownerHold, capReply, REPLY_MAX } = A;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'placeholder-doble-secret-1234567890', OHMYAGENT_API_KEY: 'test-only' };
const OWNER = { principalId: 'session:owner-phd', posRole: 'owner' };
const EMP = { principalId: 'session:emp-phd', posRole: 'empleado' };
const PRODUCTS = [{ id: 'p1', nombre: 'Arroz Costeño 1 kg', controla: true, stock: 30, min: 5, precio: 4.2, costo: 3.5 }];
const reader = { products: async () => PRODUCTS, credits: async () => [], customers: async () => [] };
async function chat(body, { role = 'owner', responses = [{ content: 'Listo.' }] } = {}) {
  const requests = [];
  const deps = { store: createMemoryUsageStore(), now: () => 200000, resolveRole: async () => role, audit: async (_d, r) => r.length, reader, mockChunkMs: 0, readBusinessName: async () => 'Negocio',
    fetch: async (_u, init) => { requests.push(JSON.parse(init.body)); const m = responses[Math.min(requests.length - 1, responses.length - 1)]; return json({ choices: [{ message: m }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); } };
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ context: { products: PRODUCTS.map(({ costo, ...x }) => x) }, ...body }) }), env, role === 'owner' ? OWNER : EMP, json, deps);
  const raw = await res.text(); let parsed = null; try { parsed = JSON.parse(raw); } catch { parsed = null; }
  return { status: res.status, body: parsed, raw, requests };
}
const ROLES = ['owner', COSTS_ROLE, 'empleado:consultas'];
// ninguna marca rota: «[oculto] oculta]», «[clave [oculto]», «[[oculto]]», «"[oculto]clave …»
const BROKEN = /\[oculto\]\s*(?:oculta|oculto|omitid[ao]|anterior|largo|del)\b|\[(?:clave|correo|nombre|teléfono|imagen|mensaje|texto|dato)\s*\[oculto\]|\[\[oculto\]\]|\[oculto\](?:clave|nombre)/i;
const IN = [
  ['pin 4321', 'pin [clave oculta]'],
  ['mi clave es 4321', 'mi clave es [clave oculta]'],
  ['¿cuál era el pin de la caja? creo q era 4321', '¿cuál era el pin de la caja? creo q era [clave oculta]'],
  ['la contraseña abc123 y el pin 9876', 'la contraseña [clave oculta] y el pin [clave oculta]'],
  ['PIN: 0042 por favor', 'PIN: [clave oculta] por favor'],
  ['la clave "4321" del wifi', 'la clave "[clave oculta]" del wifi'],
  ['password x9y8z7', 'password [clave oculta]']
];
const userTexts = (req) => req.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

test('entrada al modelo: la clave tapada llega como UNA «[clave oculta]» limpia (Admin, nivel 3 con costos y empleado)', () => {
  for (const [t, want] of IN) {
    assert.equal(maskCredentialValues(t), want, 'maskCredentialValues ' + t);
    assert.equal(redactModelOwner(want), want, 'filtro modelo-dueño ' + t);
    assert.equal(redactText(want), want, 'filtro completo ' + t);
    for (const role of ROLES) {
      const p = parseChatBody({ text: t }, role);
      assert.equal(p.text, want, role + ' ' + t + ' -> ' + p.text);
      const h = parseChatBody({ text: 'hola', history: [{ role: 'user', content: t }, { role: 'assistant', content: 'Ok.' }] }, role);
      assert.equal(h.history[0].content, want, role + ' historial ' + t + ' -> ' + h.history[0].content);
    }
  }
});
test('ruta: lo que recibe el modelo trae una sola marca limpia, sin dígitos ni pedazos de «oculta]»', async () => {
  for (const role of ROLES) {
    const r = await chat({ text: '¿cuál era el pin de la caja? creo q era 4321'}, { role }); // (el historial sin firma no llega a la ruta; se prueba arriba con parseChatBody)
    assert.equal(r.status, 200, r.raw); assert.ok(r.requests.length >= 1);
    for (const req of r.requests) {
      const u = userTexts(req);
      assert.doesNotMatch(u, BROKEN, role + ': ' + u); assert.doesNotMatch(u, /4321/, role);
      assert.match(u, /creo q era \[clave oculta\]/, role + ': ' + u);
    }
  }
});
const OUT = [
  'Su pin [clave oculta] ya no se muestra por seguridad.',
  'Anoté que la clave es [clave oculta]; la contraseña: [clave oculta] también.',
  'La señora [nombre oculto] pagó; el pin [nombre oculto] no aplica.',
  'pin [correo oculto] y clave [teléfono oculto], listo.',
  'La clave "[clave oculta]" quedó guardada.'
];
test('respuesta final (texto entero): las marcas del modelo salen tal cual para el Admin y el empleado', () => {
  for (const t of OUT) for (const role of ['owner', 'empleado:consultas']) {
    const got = redactFor(role)(t); assert.equal(got, t, role + ' ' + t + ' -> ' + got); assert.doesNotMatch(got, BROKEN);
  }
});
test('respuesta en partes (1, 3 y 7): lo pintado nunca trae una marca rota y al cerrar es igual al texto entero', () => {
  const pre = 'Buenos días, le cuento cómo quedó su consulta de hoy en la tienda. ';
  for (const role of ['owner', 'empleado:consultas']) for (const t0 of OUT) for (const ch of [1, 3, 7]) {
    const t = pre + t0; let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, REPLY_MAX, redactFor(role), role === 'owner' ? null : ownerHold);
    for (let k = 0; k < t.length; k += ch) { e.push(t.slice(k, k + ch)); assert.doesNotMatch(o, BROKEN, role + ' ' + ch + ': ' + o); }
    e.flush(); assert.equal(o, capReply(t), role + ' de a ' + ch + ': ' + o);
  }
  // camino incremental del filtro modelo-dueño / completo (mismas etapas)
  for (const red of [redactModelOwner, redactText]) for (const t0 of OUT) for (const ch of [1, 3, 7]) {
    const t = pre + t0; let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, REPLY_MAX, red);
    for (let k = 0; k < t.length; k += ch) { e.push(t.slice(k, k + ch)); assert.doesNotMatch(o, BROKEN, red.name + ' ' + ch + ': ' + o); }
    e.flush(); assert.equal(o, capReply(red(t)), red.name + ' de a ' + ch); assert.equal(red(t), t, red.name + ' entero');
  }
});
test('ruta: la respuesta del modelo con «pin [clave oculta]» sale limpia (Admin y empleado), y un PIN real al lado sigue tapado', async () => {
  for (const role of ['owner', 'empleado:consultas']) {
    const r = await chat({ text: 'pin 4321' }, { role, responses: [{ content: 'Su pin [clave oculta] no lo guardo. La señora [nombre oculto] pagó.' }] });
    assert.equal(r.status, 200, r.raw); assert.equal(r.body.reply, 'Su pin [clave oculta] no lo guardo. La señora [nombre oculto] pagó.', role);
    const s = await chat({ text: 'hola' }, { role, responses: [{ content: 'la clave es [clave oculta] 4321' }] });
    assert.equal(s.status, 200, s.raw); assert.doesNotMatch(s.body.reply, /4321/); assert.doesNotMatch(s.body.reply, BROKEN, role + ': ' + s.body.reply);
    assert.match(s.body.reply, /^la clave es \[clave oculta\] \[oculto\]/, role + ': ' + s.body.reply);
  }
});
test('lo de afuera no puede fabricar una marca: los caracteres privados sueltos se quitan y el PIN sigue tapado', () => {
  for (const red of [redactText, redactModelOwner, redactFor('owner'), redactFor('empleado:consultas')]) {
    const got = red('x [oculto]\uF8E0 y el pin 4321'); assert.doesNotMatch(got, /[\uF8E0-\uF8E9]|clave oculta|4321/, got);
  }
});
