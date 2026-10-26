// Mezcla de #991 (caja: texto enfocado del Admin, `focus`) con #1001 (marca que la tienda no tiene). Los dos conviven:
// - una pregunta de caja NO trae aviso de marca;
// - el texto enfocado de caja sigue saliendo y el aviso «No tengo esa marca; lo más parecido es…» no se pierde;
// - el aviso del servidor va para Admin Y empleado (no queda dentro del bloque solo del Admin), también con segunda llamada;
// - el aviso nunca repite la palabra escrita ni nombres de persona (respuesta ni lo que recibe el modelo).
// Datos de prueba inventados (memoryReader), sin base real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader, BRAND_NOTICE } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const SECRET = 'secreto-de-prueba-0123456789abcdef';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();
const sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const delta = (d, fin) => sse({ choices: [{ delta: d, ...(fin ? { finish_reason: fin } : {}) }] });
const call = (i, id, args) => ({ index: i, id, function: { name: 'consultar', arguments: JSON.stringify(args) } });
const first = (...calls) => [...calls.map((c) => delta({ tool_calls: [c] })), delta({}, 'tool_calls')];
const say = (t) => [delta({ content: t }), delta({}, 'stop')];
const stream = (parts) => new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const LIMA = 5 * 3600000, NOW = Date.now();
const limaIso = (hh) => new Date(Date.parse(new Date(NOW - LIMA).toISOString().slice(0, 10) + 'T' + hh + ':00-05:00')).toISOString();
const DATA = {
  products: [{ id: 'P1', nombre: 'FIDEO ESPIGA DE ORO TALLARIN 500GR', controla: true, stock: -5, min: 2, precio: 3.5, costo: 1.11 },
    { id: 'P2', nombre: 'FIDEO DON VITTORIO SPAGHETTI 500GR', controla: true, stock: 12, min: 2, precio: 4, costo: 1.11 }],
  sales: [], saleItems: [], credits: [], customers: [{ id: 'CLI-PEDRO', nombre: 'Pedro Huamán' }],
  cash: { ready: true, open: { opened_at: limaIso('00:00'), opening_cents: 10000, expected_cents: 8800 }, lastClosedAt: null, rows: [{ k: 'gasto', n: 1, a: -1200, b: 1200 }] }
};
async function chat(text, fetch, role = 'owner') {
  const bodies = [];
  const f = async (u, init) => { bodies.push(init?.body); return fetch(u, init); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, text }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: f, reader: memoryReader(DATA), audit: async () => {}, statusEveryMs: 60000 });
  const raw = await new Response(r.body).text(); const out = []; C.createSseParser((e, d) => out.push({ ev: e, d })).feed(raw);
  return { raw, bodies, final: out.find((x) => x.ev === 'final')?.d };
}
const toolParts = (body) => JSON.parse(body).messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
const quiet = (t) => { const o = console.log; console.log = () => {}; t.after(() => { console.log = o; }); };
const NOTICE_RE = /No tengo esa marca; lo más parecido es/;
const TEXT = 'cuanto se fue en gastos hoy y cuanto fideo lavaggi me queda';
const CALLS = first(call(0, 'c1', { tipo: 'caja_abierta' }), call(1, 'c2', { tipo: 'stock_producto', producto: 'fideo lavaggi' }));

test('caja sola (Admin): texto enfocado de gastos y SIN aviso de marca', async (t) => {
  quiet(t); let n = 0;
  const { final } = await chat('cuanto se fue en gastos hoy', async () => stream(n++ === 0 ? first(call(0, 'c1', { tipo: 'caja_abierta' })) : say('Se fueron S/ 12.00 en gastos.')));
  assert.match(final.reply, /S\/ 12\.00/, final.reply);
  assert.ok(!/No tengo/.test(final.reply), final.reply);
});

test('foco de caja + marca inexistente, la segunda llamada falla: queda el texto enfocado Y el aviso fijo', async (t) => {
  quiet(t); let n = 0;
  const { final } = await chat(TEXT, async () => (n++ === 0 ? stream(CALLS) : new Response('{"error":"x"}', { status: 500 })));
  assert.match(final.reply, /Gastos de hoy en la caja: S\/ 12\.00 en efectivo/, final.reply);
  assert.match(final.reply, NOTICE_RE, final.reply);
  assert.ok(!/lavaggi/i.test(final.reply), 'no repite la palabra: ' + final.reply);
});

test('foco de caja + marca inexistente, segunda llamada que no lo dice: el servidor pone el aviso primero', async (t) => {
  quiet(t); let n = 0;
  const { final } = await chat(TEXT, async () => stream(n++ === 0 ? CALLS : say('Se fueron S/ 12.00 en gastos. El fideo Espiga de Oro tiene Faltan 5.')));
  assert.ok(final.reply.startsWith(BRAND_NOTICE + '\n'), final.reply);
  assert.match(final.reply, /S\/ 12\.00/);
  assert.ok(!/lavaggi/i.test(final.reply), final.reply);
});

test('Admin y empleado, marca inexistente con segunda llamada: el aviso del servidor sale para los dos (no solo el Admin)', async (t) => {
  quiet(t);
  for (const role of ['owner', 'empleado:consultas']) {
    let n = 0;
    const { final, bodies } = await chat('por q el fideo lavaggi sale -5? explícame', async () => stream(n++ === 0 ? first(call(0, 'c1', { tipo: 'stock_producto', producto: 'fideo lavaggi' })) : say('El fideo Espiga de Oro tiene Faltan 5: revisa el Kardex.')), role);
    assert.equal(bodies.length, 2, role);
    assert.ok(final.reply.startsWith(BRAND_NOTICE + '\n'), role + ': ' + final.reply);
    assert.ok(!/lavaggi/i.test(final.reply), role + ': ' + final.reply);
  }
});

test('Admin y empleado, respuesta directa: «No tengo esa marca; lo más parecido es: …»', async (t) => {
  quiet(t);
  for (const role of ['owner', 'empleado:consultas']) {
    let n = 0;
    const { final } = await chat('cuánto fideo lavaggi me queda', async () => stream(n++ === 0 ? first(call(0, 'c1', { tipo: 'stock_producto', producto: 'fideo lavaggi' })) : say('x')), role);
    assert.match(final.reply, /^No tengo esa marca; lo más parecido es: /, role + ': ' + final.reply);
    assert.ok(!/lavaggi/i.test(final.reply), role);
  }
});

test('Admin y empleado: nombre de persona (cliente) no vuelve en la respuesta ni en lo que el servidor manda al modelo', async (t) => {
  quiet(t);
  for (const role of ['owner', 'empleado:consultas']) {
    let n = 0;
    // el empleado no lee la caja (403 aparte): solo la consulta de stock
    const calls = role === 'owner' ? first(call(0, 'c1', { tipo: 'caja_abierta' }), call(1, 'c2', { tipo: 'stock_producto', producto: 'fideo de pedro' }))
      : first(call(0, 'c2', { tipo: 'stock_producto', producto: 'fideo de pedro' }));
    const text = role === 'owner' ? 'cuanto se fue en gastos hoy y el fideo de pedro? explícame' : 'tienes el fideo de pedro? explícame';
    const { final, bodies } = await chat(text, async () => stream(n++ === 0 ? calls : say('Revisa la lista.')), role);
    assert.equal(bodies.length, 2, role);
    assert.ok(final && !/pedro|huam/i.test(final.reply), role + ': ' + final?.reply);
    assert.ok(!/pedro|huam/i.test(toolParts(bodies[1])), role + ': ' + toolParts(bodies[1]));
  }
});
