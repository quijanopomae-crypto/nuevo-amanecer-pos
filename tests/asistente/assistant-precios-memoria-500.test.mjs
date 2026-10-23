// Auditoría 500 (precios P-054, P-055, P-059, P-060; evidencia/precios-memoria, 1ff1af74): la tabla de stock «ganaba» también aquí.
// - P-054 ranking de margen: la consulta pasa a ganancia y se aclara que es ganancia en soles (no hay margen % por producto);
// - P-055 «¿cuánto subió el costo desde la última compra?»: no se guarda el costo anterior; se dice, con el costo actual, sin tarjeta;
// - P-059 unidad a 2.5 y caja de 12 a 27: la cuenta (12 × 2.50 = 30; 2.25 la unidad, 10 % menos), sin guardar nada;
// - P-060 «costo + 1.20» a dos cervezas: dos tarjetas con costo real + 1.20 (nunca precio + 1.20); sin costo, se dice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();
const sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const delta = (d, fin) => sse({ choices: [{ delta: d, ...(fin ? { finish_reason: fin } : {}) }] });
const consult = (producto, id = 'c1') => ({ index: 0, id, function: { name: 'consultar', arguments: JSON.stringify({ tipo: 'stock_producto', producto }) } });
const precio = (product_id, precio_nuevo, index = 0, id = 'p' + index) => ({ index, id, function: { name: 'proponer_cambio_precio', arguments: JSON.stringify({ product_id, precio_nuevo }) } });
const PRODUCTS = [
  { id: 'G1', nombre: 'Leche Gloria 24x395', controla: true, stock: -2, min: 5, precio: 3.8, costo: 3.1 },
  { id: 'G2', nombre: 'Leche Gloria 48x170', controla: true, stock: 10, min: 5, precio: 2.2, costo: 1.7 },
  { id: 'S1', nombre: 'Galleta Soda Field', controla: true, stock: 30, min: 5, precio: 0.6, costo: 0.45 },
  { id: 'A1', nombre: 'Arroz Costeño 1kg', controla: true, stock: 40, min: 5, precio: 3.5, costo: 3.2 },
  { id: 'A2', nombre: 'Arroz Faraón 1kg', controla: true, stock: 20, min: 5, precio: 3.9, costo: 3.4 },
  { id: 'K1', nombre: 'Inka Kola 500ml', controla: true, stock: 48, min: 12, precio: 2.5, costo: 1.9 },
  { id: 'C1', nombre: 'Cerveza Pilsen 630ml', controla: true, stock: 24, min: 12, precio: 6.5, costo: 5 },
  { id: 'C2', nombre: 'Cerveza Cusqueña 620ml', controla: true, stock: 12, min: 6, precio: 6, costo: 3.84 },
  { id: 'C3', nombre: 'Cerveza Cristal 650ml', controla: true, stock: 12, min: 6, precio: 6, costo: null },
  { id: 'T1', nombre: 'Atún Florida', controla: true, stock: 15, min: 5, precio: 6, costo: 4.8 },
  { id: 'O1', nombre: 'Aceite Primor 1L', controla: true, stock: 10, min: 3, precio: 12.5, costo: 10 },
  { id: 'D1', nombre: 'Detergente Bolívar 500g', controla: true, stock: 8, min: 3, precio: 8, costo: 6.5 },
  { id: 'Q1', nombre: 'Gaseosa Kola Real 3L', controla: true, stock: 6, min: 3, precio: 5, costo: 4.2 }];
const SALES = [{ product_id: 'O1', q: 10, c: 12500 }, { product_id: 'K1', q: 20, c: 5000 }];
const READER = { products: async () => PRODUCTS.map((p) => ({ ...p })), itemsByProduct: async () => SALES.map((x) => ({ ...x })) };
const consultTipo = (tipo, extra = {}, id = 'c1') => ({ index: 0, id, function: { name: 'consultar', arguments: JSON.stringify({ tipo, ...extra }) } });
const answer = (t) => [delta({ content: t }), delta({}, 'stop')];
const tools = (...c) => [delta({ tool_calls: c }), delta({}, 'tool_calls')];
function seq(list, bodies) { let n = 0; return async (_u, init) => { bodies.push(JSON.parse(init.body)); const parts = list[Math.min(n++, list.length - 1)];
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); }; }
async function chat(text, script, bodies, role = 'owner') {
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, text }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: role }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: seq(script, bodies), reader: READER, audit: async () => {}, statusEveryMs: 60000 });
  const raw = await new Response(r.body).text(); const out = []; C.createSseParser((e, d) => out.push({ ev: e, d })).feed(raw);
  return out.find((x) => x.ev === 'final')?.d;
}
const quiet = (t) => { const o = console.log; console.log = () => {}; t.after(() => { console.log = o; }); };
const cards = (f, type = 'precio') => (f.proposals || []).filter((p) => p.type === type);
const TABLE = /unid\.$/; // el texto de la tabla de stock («Arroz (S/ 4.00): 40 unid.»)
const toolNames = (b) => (b.tools || []).map((t) => t.function.name);
const system = (b) => b.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');


test('P-054 «producto q más margen me deja y el q menos»: la consulta pasa a ganancia (no stock_producto) y se aclara que no hay margen %', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('cual es el producto q mas margen me deja y el q menos', [tools(consultTipo('stock_producto', { producto: '?' })), answer('Lo que más ganancia dejó fue el aceite.')], bodies);
  assert.match(f.reply, /^Ganancia \d{4}-\d\d-\d\d a /, 'la consulta es ganancia (no stock_producto)');
  assert.doesNotMatch(f.reply, /No encontré ese producto/);
  assert.match(f.reply, /no hay un ranking de margen %/);
  assert.match(system(bodies[0]), /RANKING DE MARGEN/);
});
test('P-055 «cuánto subió el costo del aceite desde la última compra y le subo el precio igual?»: no inventa el costo anterior, da el actual, sin tarjeta', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('cuanto subio el costo del aceite desde la ultima compra y le subo el precio igual?', [tools(consult('aceite')), [delta({ content: 'Subió 1.50; ' }), delta({ tool_calls: [precio('O1', 14)] }), delta({}, 'tool_calls')]], bodies);
  assert.equal(cards(f).length, 0, 'sin tarjeta inventada');
  assert.match(f.reply, /^No guardo el costo anterior/);
  assert.match(f.reply, /Costo actual: Aceite Primor 1L S\/ 10\.00/);
  assert.doesNotMatch(f.reply, /Subió 1\.50/);
  assert.match(system(bodies[0]), /COSTO ANTERIOR/);
});
test('P-059 «inka kola 500 a 2.5 la unidad y la caja de 12 a 27, ¿está bien?»: segunda llamada y la cuenta 30 vs 27 (2.25 la unidad), sin tarjeta', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('la inka kola de 500 la vendo a 2.5 la unidad y la caja de 12 a 27, esta bien?', [tools(consult('inka kola 500')), answer('Está bien, deja margen.')], bodies);
  assert.equal(bodies.length, 2, 'no se queda en la tabla');
  assert.equal(cards(f).length, 0, 'no guarda nada');
  assert.match(f.reply, /12 × S\/ 2\.50 = S\/ 30\.00; la caja a S\/ 27\.00 sale a S\/ 2\.25 la unidad \(10 % menos/);
  assert.doesNotMatch(f.reply, TABLE);
});
test('P-060 «pon el precio d la cerveza cuzqueña igual al costo + 1.20 y la pilsen igual»: dos tarjetas costo + 1.20 (no precio + 1.20)', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('pon el precio d la cerveza cuzqueña igual al costo + 1.20 y la pilsen igual', [tools(consult('cerveza')), tools(precio('C2', 7.2, 0), precio('C1', 7.7, 1))], bodies);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].tool_choice, 'auto', 'nombra dos productos: no se obliga a una sola tarjeta');
  const byId = Object.fromEntries(cards(f).map((c) => [c.product_id, c.precio_nuevo]));
  assert.deepEqual(byId, { C2: 5.04, C1: 6.2 }, 'costo real + 1.20');
  assert.ok(cards(f).every((c) => c.confirm_token), 'firmadas');
  assert.match(system(bodies[0]), /COSTO \+ MONTO/);
});
test('P-060 sin costo registrado: no hay tarjeta de ese producto y se dice', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('pon el precio de la cerveza cristal al costo + 1.20', [tools(precio('C3', 7.2))], bodies);
  assert.equal(cards(f).length, 0);
  assert.match(f.reply, /«Cerveza Cristal 650ml» no tiene costo registrado/);
});
