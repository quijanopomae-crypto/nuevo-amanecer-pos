// Auditoría 500 (ajustes de stock AJ-006, 009, 011, 013, 016, 027, 033, 034; evidencia/ajustes-velocidad, 0ad72c5f): «me sobraron 5»,
// «se rompieron 3», «un cliente me devolvió 1», «conté 15» recibían SOLO la consulta de stock. Ahora la segunda llamada puede proponer la
// tarjeta de siempre (proponer_ajuste_stock: entrada/salida) o se pregunta cuál; conteo = diferencia con el stock; salida que deja negativo: aviso.
// (La confirmación y su 409 «el stock cambió» no se tocan aquí.)
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
const PRODUCTS_OLD = [
  { id: 'G1', nombre: 'Leche Gloria 24x395', controla: true, stock: -2, min: 5, precio: 3.8, costo: 3.1 },
  { id: 'G2', nombre: 'Leche Gloria 48x170', controla: true, stock: 10, min: 5, precio: 2.2, costo: 1.7 },
  { id: 'S1', nombre: 'Galleta Soda Field', controla: true, stock: 30, min: 5, precio: 0.6, costo: 0.45 },
  { id: 'A1', nombre: 'Arroz Costeño 1kg', controla: true, stock: 40, min: 5, precio: 3.5, costo: 3.2 },
  { id: 'A2', nombre: 'Arroz Faraón 1kg', controla: true, stock: 20, min: 5, precio: 3.9, costo: 3.4 },
  { id: 'K1', nombre: 'Inka Kola 500ml', controla: true, stock: 48, min: 12, precio: 2.5, costo: 1.9 },
  { id: 'C1', nombre: 'Cerveza Pilsen 630ml', controla: true, stock: 24, min: 12, precio: 6.5, costo: 5 },
  { id: 'T1', nombre: 'Atún Florida', controla: true, stock: 15, min: 5, precio: 6, costo: 4.8 },
  { id: 'O1', nombre: 'Aceite Primor 1L', controla: true, stock: 10, min: 3, precio: 12.5, costo: 10 },
  { id: 'D1', nombre: 'Detergente Bolívar 500g', controla: true, stock: 8, min: 3, precio: 8, costo: 6.5 },
  { id: 'Q1', nombre: 'Gaseosa Kola Real 3L', controla: true, stock: 6, min: 3, precio: 5, costo: 4.2 }];
const PRODUCTS = [
  { id: 'G1', nombre: 'Leche Gloria tarro grande', controla: true, stock: 12, min: 5, precio: 3.8, costo: 3.1 },
  { id: 'G2', nombre: 'Leche Gloria tarro chico', controla: true, stock: 10, min: 5, precio: 2.2, costo: 1.7 },
  { id: 'O1', nombre: 'Aceite Primor 1L', controla: true, stock: 8, min: 3, precio: 12.5, costo: 10 },
  { id: 'O2', nombre: 'Aceite Sao 1L', controla: true, stock: 0, min: 3, precio: 11, costo: 9 },
  { id: 'T1', nombre: 'Atún Florida', controla: true, stock: 20, min: 5, precio: 6, costo: 4.8 },
  { id: 'T2', nombre: 'Atún Real', controla: true, stock: -3, min: 5, precio: 5, costo: 4 },
  { id: 'A1', nombre: 'Arroz Costeño 1kg', controla: true, stock: 12, min: 5, precio: 3.5, costo: 3.2 },
  { id: 'Q1', nombre: 'Gaseosa Guaraná 3L', controla: true, stock: 9, min: 3, precio: 7, costo: 5.5 },
  { id: 'M1', nombre: 'Caramelo Globopop', controla: true, stock: 100, min: 20, precio: 0.2, costo: 0.1 },
  { id: 'M2', nombre: 'Caramelo Halls', controla: true, stock: 12, min: 5, precio: 1, costo: 0.6 }];
const READER = { products: async () => PRODUCTS.map((p) => ({ ...p })), productsById: async (ids) => new Map(PRODUCTS.filter((p) => ids.includes(p.id)).map((p) => [p.id, { ...p }])) };
const ajuste = (product_id, tipo, cantidad, motivo, index = 0) => ({ index, id: 'a' + index, function: { name: 'proponer_ajuste_stock', arguments: JSON.stringify({ product_id, tipo, cantidad, motivo }) } });
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


const adj = (f) => cards(f, 'ajuste');
const forced = { type: 'function', function: { name: 'proponer_ajuste_stock' } };

test('AJ-006 «me sobraron 5 de leche gloria» (dos Gloria): no la tabla -> «¿Cuál de estos?» con su stock', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('me sobraron 5 de leche gloria', [tools(consult('leche gloria')), tools(ajuste('G1', 'entrada', 5, 'Ajuste de inventario'))], bodies);
  assert.equal(bodies.length, 2, 'segunda llamada');
  assert.deepEqual(toolNames(bodies[1]), ['proponer_ajuste_stock']);
  assert.equal(bodies[1].tool_choice, 'auto');
  assert.equal(adj(f).length, 0, 'sin tarjeta adivinada');
  assert.match(f.reply, /^¿Cuál de estos\? Leche Gloria tarro grande \(stock 12\) · Leche Gloria tarro chico \(stock 10\)/);
  assert.match(system(bodies[0]), /AJUSTE DE STOCK pedido/);
});
test('AJ-006 respuesta a «¿cuál?»: «el tarro grande» -> tarjeta entrada 5', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('me sobraron 5 de leche gloria tarro grande', [tools(consult('leche gloria tarro grande')), tools(ajuste('G1', 'entrada', 5, 'Ajuste de inventario'))], bodies);
  assert.deepEqual(bodies[1].tool_choice, forced, 'un solo producto: tarjeta obligatoria');
  const [c] = adj(f); assert.ok(c?.confirm_token); assert.equal(c.tipo, 'entrada'); assert.equal(c.cantidad, 5); assert.equal(c.stock_despues, 17);
  assert.equal(f.reply, 'Listo. Revisa y pulsa Confirmar.');
});
test('AJ-009 «se me rompieron 3 botellas de aceite»: dos aceites -> «¿cuál?» (no la tabla)', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('se me rompieron 3 botellas de aceite', [tools(consult('aceite')), answer('¿De cuál aceite?')], bodies);
  assert.equal(bodies.length, 2);
  assert.match(f.reply, /^¿Cuál de estos\? Aceite Primor 1L \(stock 8\) · Aceite Sao 1L \(stock 0\)/);
  assert.doesNotMatch(f.reply, TABLE);
});
test('AJ-009 con el producto: salida 3 Merma / daño', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('se me rompieron 3 botellas de aceite primor', [tools(consult('aceite primor')), tools(ajuste('O1', 'salida', 3, 'Merma / daño'))], bodies);
  const [c] = adj(f); assert.equal(c.tipo, 'salida'); assert.equal(c.cantidad, 3); assert.equal(c.motivo, 'Merma / daño');
});
test('AJ-011 «un cliente me devolvió 1 atún»: dos atunes -> «¿cuál?»; sin la regla de devoluciones de caja', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('un cliente me devolvio 1 atun', [tools(consult('atún')), tools(ajuste('T1', 'entrada', 1, 'Devolución'))], bodies);
  assert.equal(adj(f).length, 0);
  assert.match(f.reply, /^¿Cuál de estos\? Atún Florida \(stock 20\) · Atún Real \(stock -3\)/);
  assert.doesNotMatch(system(bodies[0]), /GASTOS, DEVOLUCIONES, COBROS/);
});
test('AJ-013 «conté y tengo 15 de arroz pero el sistema dice 12»: entrada de 3 (la diferencia), nunca 15', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('conte y tengo 15 de arroz pero el sistema dice 12', [tools(consult('arroz')), tools(ajuste('A1', 'entrada', 15, 'Ajuste de inventario'))], bodies);
  const [c] = adj(f); assert.ok(c?.confirm_token); assert.equal(c.tipo, 'entrada'); assert.equal(c.cantidad, 3); assert.equal(c.motivo, 'Ajuste de inventario'); assert.equal(c.stock_despues, 15);
});
test('AJ-016 «pon el stock de gaseosa en 20»: entrada por la diferencia (20 − 9 = 11)', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('pon el stock de gaseosa en 20', [tools(consult('gaseosa')), tools(ajuste('Q1', 'entrada', 20, 'Ajuste de inventario'))], bodies);
  assert.deepEqual(bodies[1].tool_choice, forced);
  const [c] = adj(f); assert.equal(c.tipo, 'entrada'); assert.equal(c.cantidad, 11); assert.equal(c.stock_despues, 20);
});
test('AJ-016 conteo igual al sistema: no hay tarjeta y se dice', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('pon el stock de gaseosa en 9', [tools(consult('gaseosa')), tools(ajuste('Q1', 'entrada', 9, 'Ajuste de inventario'))], bodies);
  assert.equal(adj(f).length, 0); assert.match(f.reply, /ya tiene 9 en el sistema: no hay nada que ajustar/);
});
test('AJ-027 «salida de 1000 de arroz»: tarjeta con aviso de stock negativo en el texto', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('salida de 1000 de arroz', [tools(consult('arroz')), tools(ajuste('A1', 'salida', 1000, 'Ajuste de inventario'))], bodies);
  const [c] = adj(f); assert.ok(c?.quedaNegativo);
  assert.match(f.reply, /quedaría en -988/);
});
test('AJ-033 «regalé 2 caramelos»: dos caramelos -> «¿cuál?»', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('regale 2 caramelos', [tools(consult('caramelos')), answer('Tienes Globopop 100 y Halls 12.')], bodies);
  assert.match(f.reply, /^¿Cuál de estos\? Caramelo Globopop \(stock 100\) · Caramelo Halls \(stock 12\)/);
});
test('AJ-034 «consumo propio 1 gaseosa»: una sola gaseosa -> salida 1 (tarjeta obligatoria en la segunda llamada)', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('consumo propio 1 gaseosa', [tools(consult('gaseosa')), tools(ajuste('Q1', 'salida', 1, 'Ajuste de inventario'))], bodies);
  assert.deepEqual(bodies[1].tool_choice, forced);
  const [c] = adj(f); assert.equal(c.tipo, 'salida'); assert.equal(c.cantidad, 1); assert.doesNotMatch(f.reply, TABLE);
});
test('guardas: compras siguen siendo compras; preguntas de stock siguen con la tabla; empleado sin herramienta de ajuste en la segunda llamada', async (t) => {
  quiet(t); let bodies = [];
  await chat('cuanto stock de arroz tengo', [tools(consult('arroz')), answer('x')], bodies);
  assert.equal(bodies.length, 1, 'la tabla responde la pregunta de stock');
  bodies = [];
  await chat('me sobraron 5 de leche gloria', [tools(consult('leche gloria')), answer('x')], bodies, 'cashier');
  assert.ok(!(bodies[1]?.tools || []).some((x) => x.function.name === 'proponer_ajuste_stock'));
});

// (re-corrida con el modelo real) La consulta de stock no le pasa el id al modelo y la segunda llamada forzada venía con product_id «»:
// la tarjeta se caía y quedaba la tabla. Con UN solo producto nombrado, el servidor pone ese id (nunca adivina entre varios).
test('modelo real: segunda llamada con product_id vacío y un solo producto nombrado -> la tarjeta de ese producto (ajuste y precio)', async (t) => {
  quiet(t);
  const b1 = [];
  const f1 = await chat('se me rompieron 3 botellas de aceite primor', [tools(consult('aceite primor')), tools(ajuste('', 'salida', 3, 'Merma / daño'))], b1);
  assert.equal(b1.length, 2); assert.deepEqual(b1[1].tool_choice, { type: 'function', function: { name: 'proponer_ajuste_stock' } });
  const a = cards(f1, 'ajuste'); assert.equal(a.length, 1, JSON.stringify(f1.proposals)); assert.equal(a[0].product_id, 'O1');
  assert.doesNotMatch(f1.reply, TABLE);
  const b2 = [];
  const f2 = await chat('baja la gaseosa a 1 sol aunque pierda, es pa sacarla', [tools(consult('gaseosa')), tools(precio('', 1))], b2);
  assert.equal(b2.length, 2);
  const p = cards(f2); assert.equal(p.length, 1, JSON.stringify(f2.proposals)); assert.equal(p[0].product_id, 'Q1');
  assert.doesNotMatch(f2.reply, TABLE);
  // Varios productos posibles: no se adivina; se pregunta cuál.
  const b3 = [];
  const f3 = await chat('se me rompieron 3 botellas de aceite', [tools(consult('aceite')), tools(ajuste('', 'salida', 3, 'Merma / daño'))], b3);
  assert.equal(cards(f3, 'ajuste').length, 0); assert.match(f3.reply, /¿Cuál de estos\?/);
});
