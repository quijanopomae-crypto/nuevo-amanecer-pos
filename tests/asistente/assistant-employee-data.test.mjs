// Defensa en los DATOS (Bot 5 sobre 1c17310c): en un turno de EMPLEADO, ningún dato del dueño (costo, precio de compra, margen, proveedor,
// compras) llega al modelo: ni en el system prompt, ni en <datos_pos>, ni en el historial (aunque el dueño haya charlado antes en el aparato),
// ni en los resultados de herramientas, ni en documentos. Se captura el cuerpo de cada pedido al proveedor de mentira (sin red).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, createMemoryUsageStore, HISTORY_OMITTED } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { PROVIDERS } from '../../tools/cloudflare-lab/src/pos-assistant-providers.js';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const enc = new TextEncoder();
const SECRET = 'secreto-de-prueba-1234567890';
const KEY = 'sk-test-FAKE-datos';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const ENV_OF = (id) => ({ AI_PROVIDER: id, [PROVIDERS[id].key]: KEY });
// Valores únicos del dueño: si aparecen en un pedido al proveedor, se filtró algo.
const SECRET_VALUES = ['7.77', '777', '6.66', '666', '2.22', 'Distribuidora Secreta', 'F001-99', '55.55', '5555'];
const OWNER_KEYS = /"(?:costo|cost|cost_cents|costo_unitario|costo_actual|precio_compra|margen|ganancia|proveedor|supplier|total_cost_cents|total_soles)\\?"\s*:/i;
const reader = {
  products: async () => [{ id: 'P1', nombre: 'Galleta Soda', stock: 3, min: 5, costo: 7.77, precio: 9.5, controla: true }, { id: 'P2', nombre: 'Arroz', stock: 10, min: 2, costo: 6.66, precio: 8, controla: true }],
  productsById: async () => new Map(),
  purchases: async () => [{ supplier: 'Distribuidora Secreta SAC', document_ref: 'F001-99', total_cost_cents: 5555, line_count: 2, status: 'ok', created_at: '2026-10-16T10:00:00Z' }]
};
const CONTEXT = { screen: 'pageInventario', products: [{ id: 'P1', nombre: 'Galleta Soda', precio: 9.5, stock: 3, costo: 7.77, cost: 7.77, margen: 2.22, proveedor: 'Distribuidora Secreta SAC', precio_compra: 6.66 }] };
// Charla del dueño en el mismo aparato (historial que manda el celular).
const OWNER_HISTORY = [{ role: 'user', content: '¿A cuánto compré la Galleta Soda?' }, { role: 'assistant', content: 'La compraste a S/ 7.77 a Distribuidora Secreta SAC; tu margen es S/ 2.22.' },
  { role: 'user', content: 'ok' }, { role: 'assistant', content: 'El costo de Arroz es 6.66 soles.' }, { role: 'assistant', content: 'Hay 3 galletas.' }];
const CALLS = [{ id: 'c1', name: 'consultar', args: { tipo: 'stock_producto', producto: 'galleta' } }, { id: 'c2', name: 'consultar', args: { tipo: 'sin_costo' } },
  { id: 'c3', name: 'consultar', args: { tipo: 'compras_recientes' } }, { id: 'c4', name: 'preparar_documento', args: { tipo: 'lista_precios' } }];
const FIRST = {
  deepseek: () => ({ choices: [{ message: { content: '', tool_calls: CALLS.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }),
  anthropic: () => ({ content: CALLS.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })), usage: { input_tokens: 5, output_tokens: 5 } }),
  gemini: () => ({ candidates: [{ content: { parts: CALLS.map((c) => ({ functionCall: { name: c.name, args: c.args } })) }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 } })
};
const TEXT = {
  deepseek: (t) => ({ choices: [{ message: { content: t } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }),
  anthropic: (t) => ({ content: [{ type: 'text', text: t }], usage: { input_tokens: 5, output_tokens: 5 } }),
  gemini: (t) => ({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 } })
};
function provider(make) { const calls = []; const f = async (url, init) => { calls.push(String(init.body)); return make(calls.length); }; f.calls = calls; return f; }
const sseOf = (chunks) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const d = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
function route(body, { env, role, fetch }) {
  return assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, ...env }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch, reader, audit: async () => {}, mockChunkMs: 0 });
}
async function drain(r) { if (!r.body) return ''; const rd = r.body.getReader(), dec = new TextDecoder(); let s = ''; for (;;) { const { value, done } = await rd.read(); if (done) break; s += dec.decode(value, { stream: true }); } return s; }
const leaks = (bodies) => bodies.flatMap((b) => [...SECRET_VALUES.filter((v) => b.includes(v)), ...(OWNER_KEYS.test(b) ? ['clave: ' + OWNER_KEYS.exec(b)[0]] : [])]);

for (const id of ['deepseek', 'anthropic', 'gemini']) {
  test('empleado (' + id + ', JSON): ningún costo, precio de compra, margen ni proveedor llega al modelo (contexto, historial del dueño, consultas, documentos)', async () => {
    const f = provider((n) => jsonR(n === 1 ? FIRST[id]() : TEXT[id]('Hay 3 Galleta Soda.')));
    const r = await route({ text: 'stock de galleta y arma la lista de precios', context: CONTEXT, history: OWNER_HISTORY }, { env: ENV_OF(id), role: 'empleado:consultas_documentos', fetch: f });
    assert.equal(r.status, 200, await r.clone().text()); const out = await r.text();
    assert.ok(f.calls.length >= 1); assert.deepEqual(leaks(f.calls), [], 'filtrado al proveedor');
    assert.ok(f.calls[0].includes(HISTORY_OMITTED), 'el historial del dueño se omite');
    assert.ok(f.calls[0].includes('Hay 3 galletas.'), 'el historial sin datos del dueño sigue');
    assert.ok(!/7\.77|6\.66|Distribuidora Secreta/.test(out), 'tampoco al aparato');
    if (f.calls.length > 1) assert.match(f.calls[1], /Galleta Soda/); // la consulta permitida sí llega (stock), sin costos
  });
}
test('empleado (en partes, deepseek): el pedido con stream tampoco lleva datos del dueño; la segunda llamada solo con el resumen permitido', async () => {
  const tc = CALLS.map((c, i) => d({ choices: [{ delta: { tool_calls: [{ index: i, id: c.id, function: { name: c.name, arguments: JSON.stringify(c.args) } }] } }] }));
  const f = provider((n) => (n === 1 ? sseOf([...tc, d({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), 'data: [DONE]\n\n'])
    : sseOf([d({ choices: [{ delta: { content: 'Hay 3 Galleta Soda.' } }] }), d({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'])));
  const r = await route({ text: 'stock de galleta', context: CONTEXT, history: OWNER_HISTORY, stream: true }, { env: ENV_OF('deepseek'), role: 'empleado:consultas_documentos', fetch: f });
  const out = await drain(r);
  assert.ok(f.calls.length >= 1); assert.deepEqual(leaks(f.calls), []); assert.ok(!/7\.77|6\.66|Distribuidora Secreta/.test(out));
});
test('control: con el DUEÑO los mismos datos sí llegan al modelo (la prueba de arriba detecta filtraciones de verdad)', async () => {
  const f = provider((n) => jsonR(n === 1 ? FIRST.deepseek() : TEXT.deepseek('Listo.')));
  const r = await route({ text: 'stock de galleta', context: CONTEXT, history: OWNER_HISTORY }, { env: ENV_OF('deepseek'), role: 'owner', fetch: f });
  assert.equal(r.status, 200); await r.text();
  const all = f.calls.join('\n'); assert.ok(all.includes('7.77'), 'el dueño ve su costo'); assert.ok(all.includes('Distribuidora Secreta'), 'y su proveedor');
});
test('Bot 2: empleado con «Consultas y documentos» pega el texto de una factura de proveedor: si el modelo repite los costos, la respuesta los tapa (JSON y en partes)', async () => {
  const FACT = 'Factura F001-123 Distribuidora Lima: Galleta Soda x 12 unid, costo unitario S/ 1.80, total S/ 21.60. Arroz 5 kg a S/ 3.10 c/u.';
  const ECHO = 'Según la factura, el costo unitario de la Galleta Soda es S/ 1.80 y lo compraste a S/ 21.60 la caja. El arroz te salió a S/ 3.10.';
  for (const stream of [false, true]) {
    const f = provider(() => (stream ? sseOf([...ECHO.match(/.{1,7}/gs).map((t) => d({ choices: [{ delta: { content: t } }] })), d({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n']) : jsonR(TEXT.deepseek(ECHO))));
    const r = await route({ text: FACT, ...(stream ? { stream: true } : {}) }, { env: ENV_OF('deepseek'), role: 'empleado:consultas_documentos', fetch: f });
    const out = stream ? await drain(r) : JSON.stringify(await r.json());
    assert.ok(!/1\.80|21\.60|3\.10/.test(out), (stream ? 'partes' : 'json') + ': ' + out.slice(0, 400)); assert.match(out, /dato del dueño/);
  }
});
