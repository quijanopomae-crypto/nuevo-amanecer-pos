// Auditoría 500 (precios P-018, P-033..P-047 salvo P-044): cuando la frase nombra un producto, el modelo consultaba stock_producto y la
// respuesta era SOLO la tabla de stock (directQueryReply), también para «pon la leche gloria a 4.20». Ahora:
// - lectura (precio de caja, six pack, saco, descuento máximo, IGV): segunda llamada; la respuesta es la del modelo;
// - pedido de cambio: la segunda llamada puede proponer la tarjeta de siempre (proponer_cambio_precio); varios productos -> «¿cuál?»;
//   sin monto -> «¿a qué precio?»; precio 0 -> se explica; «11.90… no, mejor 11.50» -> una tarjeta de 11.50; bajo costo y >50 %: avisos de siempre;
// - precio por caja: no hay tarjeta (es por unidad) -> pasos en la ficha; ofertas y descuentos: no existen, se dice claro, sin tarjeta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { rivalsOf, precioPromptLines, OFFER_TEXT, DISCOUNT_DATA_TEXT, DISCOUNT_NOTE, BOX_PRICE_TEXT, BOX_PRICE_NOTE, BOX_READ_NOTE, ZERO_PRICE_TEXT } from '../../tools/cloudflare-lab/src/pos-assistant-precio-foco.js';
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
  { id: 'T1', nombre: 'Atún Florida', controla: true, stock: 15, min: 5, precio: 6, costo: 4.8 },
  { id: 'O1', nombre: 'Aceite Primor 1L', controla: true, stock: 10, min: 3, precio: 12.5, costo: 10 },
  { id: 'D1', nombre: 'Detergente Bolívar 500g', controla: true, stock: 8, min: 3, precio: 8, costo: 6.5 },
  { id: 'Q1', nombre: 'Gaseosa Kola Real 3L', controla: true, stock: 6, min: 3, precio: 5, costo: 4.2 }];
const READER = { products: async () => PRODUCTS.map((p) => ({ ...p })) };
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

// ---------- Pedidos de cambio ----------
test('P-018 «pon la leche gloria a 4.20» (dos Gloria): nunca la tabla ni una tarjeta adivinada -> «¿Cuál de estos?» con las dos', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('pon la leche gloria a 4.20', [tools(consult('leche gloria')), tools(precio('G1', 4.2))], bodies);
  assert.equal(bodies.length, 2, 'segunda llamada');
  assert.deepEqual(toolNames(bodies[1]), ['proponer_cambio_precio'], 'la segunda llamada puede proponer la tarjeta de precio');
  assert.equal(bodies[1].tool_choice, 'auto', 'varios productos: puede preguntar cuál');
  assert.equal(cards(f).length, 0, 'sin tarjeta adivinada');
  assert.match(f.reply, /^¿Cuál de estos\? .*24x395.*48x170/);
  assert.doesNotMatch(f.reply, TABLE);
});
test('P-018 con el producto exacto: la segunda llamada propone proponer_cambio_precio -> tarjeta firmada (no la tabla)', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('pon la leche gloria 24x395 a 4.20', [tools(consult('leche gloria 24x395')), tools(precio('G1', 4.2))], bodies);
  const [c] = cards(f);
  assert.ok(c, 'tarjeta de precio'); assert.equal(c.product_id, 'G1'); assert.equal(c.precio_nuevo, 4.2); assert.equal(c.precio_actual, 3.8);
  assert.ok(c.confirm_token, 'firmada'); assert.equal(c.cambioGrande, false);
  assert.equal(f.reply, 'Listo. Revisa y pulsa Confirmar.');
  assert.deepEqual(bodies[1].tool_choice, { type: 'function', function: { name: 'proponer_cambio_precio' } }, 'un solo producto y con monto: tarjeta obligatoria');
});
test('P-018 primera llamada directa a la tarjeta con un producto que no vino del aparato: se busca en el catálogo', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('pon la leche gloria 48x170 a 2.50', [tools(precio('G2', 2.5))], bodies);
  assert.equal(cards(f).length, 1); assert.equal(cards(f)[0].nombre, 'Leche Gloria 48x170');
});
test('P-034 «súbele 1 sol a la caja de cerveza pero la unidad déjala igual»: sin tarjeta por unidad; pasos en la ficha (Precio por caja)', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('subele 1 sol a la caja de cerveza pero la unidad dejala igual', [tools(consult('cerveza')), tools(precio('C1', 7.5))], bodies);
  assert.equal(cards(f).length, 0, 'no cambia el precio por unidad');
  assert.equal(f.reply, BOX_PRICE_TEXT); assert.match(f.reply, /«Precio por caja \(S\/\)»/);
});
test('P-035 «el paquete de galleta soda a 4.50 y la unidad a 0.50»: tarjeta de la unidad + el paquete va en la ficha', async (t) => {
  quiet(t); const bodies = [];
  const said = 'Ojo: 0.50 × 6 = S/ 3.00, menos que el paquete a S/ 4.50; conviene más comprar por unidad.';
  const f = await chat('el paquete de galleta soda a 4.50 y la unidad a 0.50', [tools(consult('galleta soda')), [delta({ content: said }), delta({ tool_calls: [precio('S1', 0.5)] }), delta({}, 'tool_calls')]], bodies);
  assert.equal(cards(f).length, 1); assert.equal(cards(f)[0].precio_nuevo, 0.5);
  assert.ok(f.reply.startsWith(said)); assert.ok(f.reply.endsWith(BOX_PRICE_NOTE));
});
test('P-039 «pon en oferta el detergente bolivar 2x15 esta semana»: ofertas no existen; sin tarjeta', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('pon en oferta el detergente bolivar 2x15 esta semana', [tools(precio('D1', 7.5))], bodies);
  assert.equal(cards(f).length, 0); assert.equal(f.reply, OFFER_TEXT);
});
test('P-038 «hazle 10% de descuento al #C0012 en todo lo q lleve hoy»: no existe; pasos a mano (Aplicar descuento)', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('hazle 10% de descuento al #C0012 en todo lo q lleve hoy', [answer('Listo, le apliqué 10% de descuento al cliente.')], bodies);
  assert.equal(f.reply, OFFER_TEXT); assert.match(f.reply, /«Aplicar descuento»/);
});
test('P-042 «ponlo a 11.90… no mejor 11.50»: una sola tarjeta con 11.50 (dos tarjetas o una de 11.90)', async (t) => {
  quiet(t);
  let f = await chat('el aceite primor ponlo a 11.90... no mejor 11.50', [tools(precio('O1', 11.9, 0), precio('O1', 11.5, 1))], []);
  assert.deepEqual(cards(f).map((c) => c.precio_nuevo), [11.5]);
  f = await chat('el aceite primor ponlo a 11.90... no mejor 11.50', [tools(precio('O1', 11.9))], []);
  assert.deepEqual(cards(f).map((c) => c.precio_nuevo), [11.5]); assert.ok(cards(f)[0].confirm_token);
});
test('P-043 «súbele al arroz»: sin monto -> pregunta a qué precio y cuál; ninguna tarjeta inventada', async (t) => {
  quiet(t); const bodies = [];
  const f = await chat('subele al arroz', [tools(consult('arroz')), answer('Listo, subí el arroz a S/ 4.00.')], bodies);
  assert.equal(cards(f).length, 0);
  assert.match(f.reply, /^¿A qué precio lo pongo\? Dime también cuál: .*Costeño.*Faraón/);
  assert.deepEqual(toolNames(bodies[1]), [], 'sin monto: la segunda llamada no puede proponer tarjeta');
  const g = await chat('subele al arroz', [tools(precio('A1', 4))], []);
  assert.equal(cards(g).length, 0, 'monto inventado por el modelo: fuera');
});
test('P-045 «cambia el precio de la leche a 0»: se explica y se pregunta (no «No puedo hacer eso…» seco)', async (t) => {
  quiet(t);
  const f = await chat('cambia el precio de la leche a 0', [tools(precio('G1', 0))], []);
  assert.equal(cards(f).length, 0); assert.equal(f.reply, ZERO_PRICE_TEXT);
  const g = await chat('cambia el precio de la leche a 0', [tools(consult('leche')), answer('Leche Gloria 24x395 (S/ 3.80): -2 unid.')], []);
  assert.equal(g.reply, ZERO_PRICE_TEXT, 'tampoco la tabla');
});
test('P-046 «baja la gaseosa a 1 sol aunque pierda»: tarjeta con aviso bajo costo y el aviso de cambio grande (>50 %) de siempre', async (t) => {
  quiet(t);
  const f = await chat('baja la gaseosa a 1 sol aunque pierda, es pa sacarla', [tools(consult('gaseosa')), tools(precio('Q1', 1))], []);
  const [c] = cards(f); assert.ok(c); assert.equal(c.precio_nuevo, 1); assert.equal(c.bajoCosto, true); assert.equal(c.cambioGrande, true);
});

// ---------- Lecturas ----------
const READS = [
  ['P-033', 'a cuanto vendo la caja de inka kola', 'inka kola', 'La Inka Kola 500ml está a S/ 2.50 la unidad.', (f) => assert.ok(f.reply.endsWith(BOX_READ_NOTE))],
  ['P-036', 'cuanto me sale la unidad del six pack de pilsen si lo vendo a 32', 'pilsen', 'Si vendes el six pack a S/ 32, cada unidad sale a S/ 5.33 (32 ÷ 6).', (f) => assert.equal(f.reply, 'Si vendes el six pack a S/ 32, cada unidad sale a S/ 5.33 (32 ÷ 6).')],
  ['P-037', 'vendo el arroz por kilo y por saco de 50, el saco a cuanto lo pongo', 'arroz', 'Con el kilo a S/ 3.50, el saco de 50 serían S/ 175.00; por mayor ponlo entre S/ 165 y S/ 168.', (f) => assert.match(f.reply, /175/)],
  ['P-040', 'q descuento maximo le puedo hacer al atun sin perder', 'atun', 'Al Atún Florida le puedes bajar hasta S/ 1.20 (20 % del precio) sin perder.', (f) => assert.equal(f.reply, DISCOUNT_NOTE + ' Al Atún Florida le puedes bajar hasta S/ 1.20 (20 % del precio) sin perder.')],
  ['P-047', 'mi precio incluye igv? cuanto es sin igv el aceite', 'aceite', 'Depende de Configuración > Ticket (IGV). Como referencia, S/ 12.50 sin IGV son S/ 10.59.', (f) => assert.match(f.reply, /10\.59/)]
];
for (const [id, text, producto, said, check] of READS) {
  test(id + ' «' + text + '»: segunda llamada (no la tabla); sin tarjeta', async (t) => {
    quiet(t); const bodies = [];
    const f = await chat(text, [tools(consult(producto)), answer(said)], bodies);
    assert.equal(bodies.length, 2, 'segunda llamada'); assert.equal(f.timings.second_call, true);
    assert.doesNotMatch(f.reply, TABLE); assert.equal(cards(f).length, 0); check(f);
  });
}
test('P-041 «cuanto descuento di este mes»: no hay ese dato; nunca un monto inventado', async (t) => {
  quiet(t);
  const f = await chat('cuanto descuento di este mes', [answer('Este mes diste S/ 50.00 en descuentos.')], []);
  assert.equal(f.reply, DISCOUNT_DATA_TEXT);
});
test('líneas de precio del prompt: solo cuando la frase las pide (el primer envío de siempre no crece)', async (t) => {
  quiet(t);
  assert.deepEqual(precioPromptLines('hola'), []); assert.deepEqual(precioPromptLines('¿cuánto arroz hay?'), []);
  const bodies = [];
  await chat('q descuento maximo le puedo hacer al atun sin perder', [tools(consult('atun')), answer('ok')], bodies);
  assert.match(system(bodies[0]), /DESCUENTOS Y OFERTAS: no existen/);
  const b2 = []; await chat('mi precio incluye igv? cuanto es sin igv el aceite', [tools(consult('aceite')), answer('ok')], b2);
  assert.match(system(b2[0]), /÷ 1\.18/);
  const b3 = []; await chat('pon la leche gloria a 4.20', [tools(consult('leche gloria')), answer('ok')], b3);
  assert.match(system(b3[0]), /CAMBIO DE PRECIO pedido/);
});
test('empleado: «pon la leche gloria a 4.20» no abre la herramienta de precio en la segunda llamada', async (t) => {
  quiet(t); const bodies = [];
  await chat('pon la leche gloria a 4.20', [tools(consult('leche gloria')), answer('Eso lo cambia el dueño.')], bodies, 'employee');
  for (const b of bodies.slice(1)) assert.ok(!toolNames(b).includes('proponer_cambio_precio'));
});

// Mezcla con #987 (seguridad, prueba 4): «sube el arroz a 4.50 y saca 2 de azúcar» son DOS productos distintos, cada uno con su palabra;
// el empate de puntaje entre ellos no es «¿cuál?». Solo es ambiguo si otro producto comparte la palabra de la tarjeta (dos «arroz»).
const ajusteCall = (product_id, cantidad, index = 1) => ({ index, id: 'a' + index, function: { name: 'proponer_ajuste_stock', arguments: JSON.stringify({ product_id, tipo: 'salida', cantidad, motivo: 'merma' }) } });
test('precio + ajuste de productos distintos en una frase: las dos tarjetas quedan (sin «¿Cuál de estos?»)', async (t) => {
  quiet(t);
  const f = await chat('sube el detergente a 9 y saca 2 de atún', [tools(precio('D1', 9), ajusteCall('T1', 2))], []);
  assert.deepEqual(cards(f).map((p) => p.product_id), ['D1'], f.reply); // (la tarjeta de ajuste de este arnés no trae el producto en el contexto del aparato)
  assert.doesNotMatch(f.reply, /¿Cuál de estos\?/);
  // la misma regla en las tarjetas de ajuste (pos-assistant-ajuste-foco.js usa rivalsOf)
  const H = PRODUCTS.filter((p) => ['A1', 'A2', 'T1', 'D1'].includes(p.id));
  assert.deepEqual(rivalsOf(H, 'saca 2 de atún y sube el detergente a 9', 'T1'), []);
  assert.deepEqual(rivalsOf(H, 'saca 2 de arroz y 1 de atún', 'A1').map((p) => p.id), ['A1', 'A2']);
  // dos «arroz» con una tarjeta: sigue siendo «¿cuál?»
  const h = await chat('sube el arroz a 4 y saca 2 de atún', [tools(precio('A1', 4), ajusteCall('T1', 2))], []);
  assert.equal(cards(h).length, 0); assert.match(h.reply, /^¿Cuál de estos\? .*Costeño.*Faraón/); assert.doesNotMatch(h.reply, /Atún/);
});

// Mezcla con #987 (prueba 4): «sube los tres» se refiere a lo que ya se habló (los montos vienen de antes): las tarjetas del modelo quedan.
// «súbele al arroz» (P-043, sin monto ni referencia) sigue preguntando a qué precio.
test('«sube los tres» / «ponles a todos»: tarjetas con monto de lo ya hablado quedan; sin referencia sigue «¿A qué precio?»', async (t) => {
  quiet(t);
  const three = tools(precio('A1', 4.5, 0), precio('T1', 6.5, 1), precio('O1', 13, 2));
  for (const text of ['sube los tres', 'súbeles a todos', 'cámbiales a esos']) {
    const f = await chat(text, [three], []);
    assert.deepEqual(cards(f).map((p) => p.product_id), ['A1', 'T1', 'O1'], text + ' -> ' + f.reply);
  }
  const g = await chat('súbele al atún', [tools(precio('T1', 7))], []);
  assert.equal(cards(g).length, 0); assert.match(g.reply, /^¿A qué precio lo pongo\?/);
});
