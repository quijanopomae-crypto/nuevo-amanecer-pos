// Auditoría 500 (inventario, arnés con modelo real): INV-045 y INV-057.
// - INV-045: «conte 0 de mantequilla pero el sistema dice 4, ponlo en 0» sacaba «Sin tarjeta todavía: «ponlo en 0»»: el trozo después de la coma
//   no es otro producto, es el mismo pedido (ponlo/déjalo/súbelo… en N). Solo cuenta como pedido aparte un trozo con palabra de producto.
// - INV-057: «súmale 10 a todo el stock» sacó 19 tarjetas de ajuste en una respuesta; solo la regla del prompt lo frenaba. Tope del SERVIDOR:
//   más de 5 tarjetas de cambio -> ninguna tarjeta y la pregunta «Son N productos; ¿le muestro la lista para revisarla antes?».
import test from 'node:test';
import assert from 'node:assert/strict';
import * as PA from '../../tools/cloudflare-lab/src/pos-assistant.js';
const { assistantChatRoute, createMemoryUsageStore } = PA;
import { adjustRequests } from '../../tools/cloudflare-lab/src/pos-assistant-varios.js';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' };
const tool = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const NAMES = ['Arroz Costeño 750 g', 'Azúcar Rubia Cartavio 1 kg', 'Mantequilla Laive 200 g', 'Aceite Primor 900 ml', 'Atún Florida 170 g', 'Fideo Don Vittorio 500 g',
  'Leche Gloria Azul 400 g', 'Inca Kola 500 ml', 'Coca-Cola 500 ml', 'Sprite 500 ml', 'Galleta Soda Field x6', 'Fósforos Llama', 'Sal Emsal 1 kg', 'Avena Quaker 500 g',
  'Café Altomayo 50 g', 'Detergente Bolívar 500 g', 'Jabón Camay', 'Papel Higiénico Elite x4', 'Huevos x15', 'Yogurt Gloria 1 L'];
const P = NAMES.map((nombre, i) => ({ id: 'p' + String(i + 1).padStart(2, '0'), nombre, precio: 5, costo: 4, stock: 10 + i, min: 2, controla: true }));
P[2].stock = 4; // mantequilla: el sistema dice 4
const reader = { products: async () => P.map((p) => ({ ...p })), productsById: async (ids) => new Map(P.filter((p) => ids.map(String).includes(p.id)).map((p) => [p.id, { ...p }])) };
async function chat(text, calls, content = '') {
  const sent = [];
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text, context: { products: P.map(({ controla, min, ...p }) => p) } }) }), ENV,
    { principalId: 'session:o', posRole: 'owner' }, (d, s = 200) => new Response(JSON.stringify(d), { status: s }),
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', reader, audit: async () => {}, readBusinessName: async () => 'Bodega',
      fetch: async (_u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content, tool_calls: sent.length === 1 ? calls : [] } }] })); } });
  return { status: r.status, body: await r.json(), sent };
}
const adj = (id, tipo, cantidad, n) => tool('proponer_ajuste_stock', { product_id: id, tipo, cantidad, motivo: 'Ajuste de inventario' }, 'c' + n);
const sumAll = (n) => P.slice(0, n).map((p, i) => adj(p.id, 'entrada', 10, i + 1));

// ---------- INV-045 ----------
test('INV-045: «conte 0 de mantequilla pero el sistema dice 4, ponlo en 0» con su tarjeta -> sin falso «Sin tarjeta todavía»', async () => {
  const r = await chat('conte 0 de mantequilla pero el sistema dice 4, ponlo en 0', [adj('p03', 'salida', 4, 1)], 'Listo: salida de 4, queda en 0.');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.proposals.map((p) => p.product_id), ['p03']);
  assert.doesNotMatch(r.body.reply, /Sin tarjeta/, r.body.reply);
  assert.doesNotMatch(r.body.reply, /ponlo en 0/);
});

test('INV-045: trozos de continuación después de la coma no son otro producto', () => {
  for (const t of ['conte 0 de mantequilla pero el sistema dice 4, ponlo en 0', 'salida 2 arroz, déjalo en 10', 'salida 2 arroz, pónlo en 0', 'entrada 5 azucar, súbelo a 20',
    'salida 3 aceite, bájalo a 2', 'conte 15 de arroz, ajústalo a 15', 'entrada 4 atun, y en 20', 'entrada 4 atun, a 20', 'entrada 4 atun, 20', 'salida 1 sal, mejor déjala en 5 nomas',
    'conte 8 de leche y el sistema marca 10, cámbialo a 8 por favor', 'entrada 6 avena, súmale 2 mas'])
    assert.deepEqual(adjustRequests(t), [], t);
});

test('INV-045: los pedidos reales de varios productos siguen contando (y el que falta sí lleva el aviso)', async () => {
  const two = adjustRequests('entrada 10 arroz, azucar en 20');
  assert.deepEqual(two.map((x) => x.texto), ['entrada 10 arroz', 'azucar en 20']);
  assert.equal(adjustRequests('entrada 10 arroz, salida 2 azucar, entrada 5 fideo').length, 3);
  const r = await chat('entrada 10 arroz, salida 2 azucar', [adj('p01', 'entrada', 10, 1)], 'Listo.');
  assert.match(r.body.reply.split('\n').pop(), /^Sin tarjeta todavía: «salida 2 azucar»\./);
  const ok = await chat('entrada 10 arroz, azucar en 20', [adj('p01', 'entrada', 10, 1), adj('p02', 'entrada', 10, 2)], 'Listo.');
  assert.equal(ok.body.proposals.length, 2); assert.doesNotMatch(ok.body.reply, /Sin tarjeta/);
});

// ---------- INV-057 ----------
test('INV-057: el tope del servidor es 5 tarjetas de cambio por respuesta', () => { assert.equal(PA.MAX_CHANGE_CARDS, 5); });

for (const n of [6, 19]) {
  test('INV-057: «súmale 10 a todo el stock» con ' + n + ' tarjetas -> ninguna tarjeta y la pregunta con el número real', async () => {
    const r = await chat('sumale 10 a todo el stock', sumAll(n), 'Listo, preparé ' + n + ' tarjetas. Revisa y pulsa Aplicar.');
    assert.equal(r.status, 200);
    assert.equal(r.body.proposals.length, 0, 'ninguna tarjeta');
    assert.equal(r.body.reply, 'Son ' + n + ' productos; ¿le muestro la lista para revisarla antes?');
    assert.doesNotMatch(r.body.reply, /se aplica aparte|Aplicar|Sin tarjeta/);
    assert.equal(r.body.dropped.filter((d) => d.reason === 'tope_tarjetas').length, n);
    assert.equal(r.body.turns.length ? r.body.turns[1].content : r.body.reply, r.body.reply);
  });
}

test('INV-057: con 5 tarjetas pasan las 5 y sigue la frase de #987', async () => {
  const r = await chat('sumale 10 al arroz, azucar, mantequilla, aceite y atun', sumAll(5), 'Listo.');
  assert.equal(r.body.proposals.length, 5);
  assert.equal(r.body.reply.split('\n')[0], 'Listo. Son 5 productos; cada uno se aplica aparte con su «Aplicar».');
  assert.doesNotMatch(r.body.reply, /le muestro la lista/);
});
