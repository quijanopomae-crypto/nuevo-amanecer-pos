// Lentitud 22-10 (paso 3): una consulta simple se contesta con el texto armado por el servidor, SIN segunda llamada al modelo.
// Conservador: una sola consulta, sin texto del modelo, sin otras herramientas, lectura completa y sin error, sin pedido de explicación.
// La privacidad queda igual (el texto pasa por el MISMO filtro del rol) y el modelo recibe MENOS (no le llega el resumen).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore, directQueryReply } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();
const sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const delta = (d, fin) => sse({ choices: [{ delta: d, ...(fin ? { finish_reason: fin } : {}) }] });
const call = (i, id, tipo, extra = {}) => ({ index: i, id, function: { name: 'consultar', arguments: JSON.stringify({ tipo, producto: 'Arroz', ...extra }) } });
const CANARY = ['777.77', '313.13', '919.19', '42.42'];
const OWNER_READER = { products: async () => [{ id: 'A', nombre: 'Arroz', controla: true, stock: 40, min: 5, precio: 4, costo: 313.13, margen: 919.19, ganancia: 42.42 }] };
const SECOND = [delta({ content: 'Explicación del modelo.' }), delta({}, 'stop')];
function seq(list, bodies) { let n = 0; return async (_u, init) => { bodies.push(init.body); const parts = list[Math.min(n++, list.length - 1)];
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); }; }
async function chat(body, { role = 'owner', fetch, reader = OWNER_READER } = {}) {
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, ...body }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch, reader, audit: async () => {}, statusEveryMs: 60000 });
  const raw = await new Response(r.body).text(); const out = []; const p = C.createSseParser((e, d) => out.push({ ev: e, d })); p.feed(raw);
  return { raw, ev: out, final: out.find((x) => x.ev === 'final')?.d };
}
const first = (...calls) => [...calls.map((c) => delta({ tool_calls: [c] })), delta({}, 'tool_calls')];
const quiet = (t) => { const o = console.log; console.log = () => {}; t.after(() => { console.log = o; }); };

// (#957) stock_producto lleva el precio: «Arroz (S/ 4.00): 40 unid.».
test('Admin, consulta simple: una sola llamada; la respuesta es el texto de la consulta, también en partes', async (t) => {
  quiet(t); const bodies = [];
  const r = await chat({ text: '¿cuánto arroz hay?' }, { fetch: seq([first(call(0, 'c1', 'stock_producto')), SECOND], bodies) });
  assert.equal(bodies.length, 1, 'sin segunda llamada');
  assert.equal(r.final.reply, 'Arroz (S/ 4.00): 40 unid.'); assert.equal(r.final.timings.second_call, false); assert.equal(r.final.timings.ms_model2, undefined);
  assert.equal(r.ev.filter((x) => x.ev === 'text' && x.d.t).map((x) => x.d.t).join(''), 'Arroz (S/ 4.00): 40 unid.');
  assert.equal(r.final.proposals[0].type, 'consulta'); assert.ok(r.final.proposals[0].result.filas.length === 1);
  assert.equal(r.final.turns.length, 2, 'el par firmado sigue igual');
});

test('empleado, consulta simple: una sola llamada y ningún dato del Admin en el canal (igual que con segunda llamada)', async (t) => {
  quiet(t); const bodies = [];
  const r = await chat({ text: '¿cuánto arroz hay?', context: { products: [{ id: 'A', nombre: 'Arroz', precio: 4, costo: 777.77, stock: 40 }] } }, { role: 'empleado:consultas', fetch: seq([first(call(0, 'c1', 'stock_producto')), SECOND], bodies) });
  assert.equal(bodies.length, 1);
  for (const c of CANARY) { assert.ok(!r.raw.includes(c), 'canal con ' + c); assert.ok(!bodies[0].includes(c), 'modelo con ' + c); }
  assert.ok(!/costo|margen|ganancia/i.test(r.raw)); assert.match(r.final.reply, /Arroz/); assert.equal(r.final.role, 'empleado:consultas');
});

test('casos que SIGUEN con segunda llamada: pide explicación, dos consultas, texto del modelo, lista cortada, lectura con error', async (t) => {
  quiet(t);
  const cases = [
    ['explicación', { text: '¿qué me falta reponer y por qué?' }, [first(call(0, 'c1', 'bajo_stock')), SECOND], OWNER_READER],
    ['dos consultas', { text: 'stock y sin costo' }, [first(call(0, 'c1', 'bajo_stock'), call(1, 'c2', 'sin_costo')), SECOND], OWNER_READER],
    ['texto del modelo', { text: 'stock de arroz' }, [[delta({ content: 'Reviso. ' }), ...first(call(0, 'c1', 'stock_producto'))], SECOND], OWNER_READER],
    ['lista cortada', { text: 'qué falta' }, [first(call(0, 'c1', 'bajo_stock')), SECOND], { products: async () => Object.assign([{ id: 'A', nombre: 'Arroz', controla: true, stock: 0, min: 5 }], { truncated: true }) }],
    ['error de lectura', { text: 'qué falta' }, [first(call(0, 'c1', 'bajo_stock')), SECOND], { products: async () => { throw new Error('x'); } }],
    ['mensaje largo', { text: 'qué falta ' + 'x'.repeat(200) }, [first(call(0, 'c1', 'bajo_stock')), SECOND], OWNER_READER]
  ];
  for (const [name, body, script, reader] of cases) {
    const bodies = []; const r = await chat(body, { fetch: seq(script, bodies), reader });
    assert.equal(bodies.length, 2, name + ': con segunda llamada'); assert.equal(r.final.timings.second_call, true, name);
    assert.equal(r.final.reply, 'Explicación del modelo.', name);
  }
});

test('directQueryReply: foto, descartes u otra herramienta -> nunca directo', () => {
  const base = { result: { content: '', calls: [{ name: 'consultar' }] }, proposals: [{ type: 'consulta' }], dropped: [], consultas: [{ result: { texto: 'Hay 3.' } }], queryCut: false, text: 'qué falta' };
  assert.equal(directQueryReply(base), 'Hay 3.');
  assert.equal(directQueryReply({ ...base, image: 'data:x' }), null);
  assert.equal(directQueryReply({ ...base, dropped: [{ dropped: 'forbidden_role' }] }), null);
  assert.equal(directQueryReply({ ...base, result: { content: '', calls: [{ name: 'preparar_compra' }] } }), null);
  assert.equal(directQueryReply({ ...base, consultas: [{ result: { error: 'query_failed', texto: 'No pude' } }] }), null);
  assert.equal(directQueryReply({ ...base, text: '¿me recomiendas qué pedir?' }), null);
});
