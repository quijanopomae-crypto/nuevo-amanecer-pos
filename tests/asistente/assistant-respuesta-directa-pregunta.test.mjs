// Auditoría 500 (CP-001, CP-017, CP-039, P-025 y los casos CAJ/CLI «solo la tabla»): con UNA consulta directa el servidor devolvía el texto de la
// tabla sin segunda llamada, y el modelo nunca contestaba lo preguntado (cuál Gloria, cuánto falta para 20, confirmar «1000 cajas», el margen).
// Ahora, si la pregunta trae algo que la tabla no contesta, va la segunda llamada con el resultado de la consulta y la respuesta es la del modelo.
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
const call = (producto) => ({ index: 0, id: 'c1', function: { name: 'consultar', arguments: JSON.stringify({ tipo: 'stock_producto', producto }) } });
const READER = { products: async () => [
  { id: 'G1', nombre: 'Leche Gloria 24x395', controla: true, stock: -2, min: 5, precio: 3.8, costo: 3.1 },
  { id: 'G2', nombre: 'Leche Gloria 48x170', controla: true, stock: 10, min: 5, precio: 2.2, costo: 1.7 },
  { id: 'S1', nombre: 'Galleta Soda Field', controla: true, stock: 30, min: 5, precio: 1.2, costo: null },
  { id: 'A', nombre: 'Arroz', controla: true, stock: 40, min: 5, precio: 4, costo: 3 }] };
const answer = (t) => [delta({ content: t }), delta({}, 'stop')];
const first = (c) => [delta({ tool_calls: [c] }), delta({}, 'tool_calls')];
function seq(list, bodies) { let n = 0; return async (_u, init) => { bodies.push(init.body); const parts = list[Math.min(n++, list.length - 1)];
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); }; }
async function chat(text, script, bodies) {
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, text }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: 'owner' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', fetch: seq(script, bodies), reader: READER, audit: async () => {}, statusEveryMs: 60000 });
  const raw = await new Response(r.body).text(); const out = []; C.createSseParser((e, d) => out.push({ ev: e, d })).feed(raw);
  return out.find((x) => x.ev === 'final')?.d;
}
const quiet = (t) => { const o = console.log; console.log = () => {}; t.after(() => { console.log = o; }); };
// La segunda llamada recibe el resultado de la consulta (tool message) para poder contestar.
const toolMsg = (body) => JSON.parse(body).messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');

const CASES = [
  ['CP-001', 'me llego mercaderia de san juan 2 cajas de leche gloria y 1 saco de arroz', 'leche gloria',
    '¿Cuál Leche Gloria llegó: la 24x395 o la 48x170? Con eso armo la compra de San Juan con el arroz.', /24x395[\s\S]*48x170|48x170[\s\S]*24x395/],
  ['CP-017', 'cuanto tengo que comprar de leche para tener 20', 'leche',
    'De Leche Gloria 24x395 tienes -2, así que para llegar a 20 te faltan 22 unidades (20 - (-2) = 22).', /-2/],
  ['CP-039', 'compre 1000 cajas de leche', 'leche',
    '¿Seguro que fueron 1000 cajas? Es mucho más de lo normal; confírmame la cantidad y cuál leche antes de armar la compra.', /Gloria/],
  ['P-025', 'cual es mi margen en la galleta soda', 'galleta soda',
    'No puedo darte el margen de Galleta Soda Field: no tiene costo registrado. Dime cuánto te cuesta y lo calculo.', /Galleta Soda/]
];
for (const [id, text, producto, modelAnswer, inTool] of CASES) {
  test(id + ': «' + text + '» -> segunda llamada; la respuesta contesta la pregunta, no repite la tabla', async (t) => {
    quiet(t); const bodies = [];
    const f = await chat(text, [first(call(producto)), answer(modelAnswer)], bodies);
    assert.equal(bodies.length, 2, 'con segunda llamada al modelo');
    assert.equal(f.timings.second_call, true);
    assert.match(toolMsg(bodies[1]), inTool, 'el modelo recibe el resultado de la consulta');
    assert.equal(f.reply, modelAnswer);
    assert.equal(f.proposals.filter((p) => p.type === 'consulta').length, 1, 'la tarjeta de la consulta sigue');
  });
}

test('consulta simple sin nada más sigue directa (latencia de #directa intacta)', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('¿cuánto arroz hay?', [first(call('Arroz')), answer('no debería llamarse')], bodies);
  assert.equal(bodies.length, 1); assert.equal(f.reply, 'Arroz (S/ 4.00): 40 unid.');
});

test('directQueryReply: CAJ/CLI «solo la tabla» (método, gastos, quién debe) -> segunda llamada; con frase enfocada del servidor -> esa frase', () => {
  const base = (tipo, text) => ({ result: { content: '', calls: [{ name: 'consultar' }] }, proposals: [{ type: 'consulta' }], dropped: [],
    consultas: [{ query: { tipo }, result: { texto: 'Ventas 2026-10-23: S/ 216.90 en 10 ventas.' } }], queryCut: false, text });
  assert.equal(directQueryReply(base('ventas_periodo', 'cuanto vendi hoy')), 'Ventas 2026-10-23: S/ 216.90 en 10 ventas.');
  for (const [tipo, text] of [['ventas_periodo', 'cuanto entro en efectivo hoy'], ['ventas_periodo', 'cuanto vendi por yape hoy'], ['resumen_dia', 'cuanto se fue en gastos hoy'],
    ['deudas_clientes', 'quien me debe mas'], ['ventas_periodo', 'cuanto gane hoy'], ['stock_producto', 'cuanto me falta para tener 30 de arroz']]) {
    assert.equal(directQueryReply(base(tipo, text)), null, tipo + ' / ' + text);
  }
  assert.equal(directQueryReply({ ...base('caja_abierta', 'cuanto se fue en gastos hoy'), focused: 'Gastos de hoy en la caja: S/ 12.00.' }), 'Gastos de hoy en la caja: S/ 12.00.');
  assert.equal(directQueryReply(base('ventas_periodo', 'cuanto vendi el 2026-10-20')), 'Ventas 2026-10-23: S/ 216.90 en 10 ventas.', 'una fecha no cuenta como número de la pregunta');
});

// (merge de prueba con #984, VEN-027) «el 31 de septiembre» (con p) dejaba el 31 como «número de la pregunta» y la respuesta directa con el
// aviso «no existe» se perdía en una segunda llamada. Los meses (septiembre/setiembre) y los periodos («últimos 7 días») no son números de la pregunta.
test('directQueryReply: fechas y periodos con número siguen directos (septiembre, setiembre, «últimos 7 días»)', () => {
  const base = (tipo, text) => ({ result: { content: '', calls: [{ name: 'consultar' }] }, proposals: [{ type: 'consulta' }], dropped: [],
    consultas: [{ query: { tipo }, result: { texto: 'Ventas: S/ 10.00.' } }], queryCut: false, text });
  for (const text of ['cuanto vendi el 31 de septiembre', 'cuanto vendi el 15 de setiembre de 2026', 'cuanto vendi el 3 de Septiembre',
    'cuanto vendi los ultimos 7 dias', 'ventas de las ultimas 2 semanas', 'cuanto vendi hace 3 días']) {
    assert.equal(directQueryReply(base('ventas_periodo', text)), 'Ventas: S/ 10.00.', text);
  }
  assert.equal(directQueryReply(base('stock_producto', 'cuanto me falta para tener 30 de arroz')), null, 'un número de cantidad sigue yendo al modelo');
});
