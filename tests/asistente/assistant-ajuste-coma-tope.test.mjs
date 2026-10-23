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

// ---------- INV-057 (revisión de #996): la conversación completa, sin depender de que el modelo repita las mismas tarjetas ----------
// Un solo almacén y el historial firmado que devuelve cada respuesta; el aparato manda stock 999 (viejo): el servidor usa SU stock.
function convo(role = 'owner') {
  const store = PA.createMemoryUsageStore(); let history = [];
  return {
    store,
    setRole(r) { role = r; },
    async say(text, calls = [], content = '') {
      const sent = [];
      const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text, history, context: { products: P.map(({ controla, min, ...p }) => ({ ...p, stock: 999 })) } }) }), ENV,
        { principalId: 'session:o', posRole: role }, (d, s = 200) => new Response(JSON.stringify(d), { status: s }),
        { store, resolveRole: async () => role, verifyApproval: async () => true, reader, audit: async () => {}, readBusinessName: async () => 'Bodega',
          fetch: async (_u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content, tool_calls: sent.length === 1 ? calls : [] } }] })); } });
      const body = await r.json();
      if (Array.isArray(body.turns)) history = [...history, ...body.turns.map(({ role: rr, content: c, sig, n, iat }) => ({ role: rr, content: c, sig, n, iat }))];
      return { status: r.status, body, sent };
    }
  };
}
const ids = (r) => r.body.proposals.map((p) => p.product_id);
const range = (a, b) => P.slice(a - 1, b).map((p) => p.id);

test('INV-057: pedido masivo -> pregunta; «sí» -> lista en texto + primeras 5; «siguientes» de 5 en 5 hasta el final; sin volver al modelo', async () => {
  const c = convo();
  const q = await c.say('sumale 10 a todo el stock', sumAll(19), 'Listo, preparé 19 tarjetas.');
  assert.equal(q.body.reply, 'Son 19 productos; ¿le muestro la lista para revisarla antes?');
  assert.equal(q.body.proposals.length, 0);

  const yes = await c.say('sí');
  assert.equal(yes.status, 200);
  assert.equal(yes.sent.length, 0, 'sin llamada al modelo');
  const lines = yes.body.reply.split('\n');
  assert.equal(lines[0], 'Esta es la lista (19 productos):');
  assert.equal(lines.length, 21, yes.body.reply);
  assert.equal(lines[1], '1. Arroz Costeño 750 g: stock 10 → 20 (+10)', 'stock del servidor, no el 999 del aparato');
  assert.equal(lines[3], '3. Mantequilla Laive 200 g: stock 4 → 14 (+10)');
  assert.equal(lines[19], '19. Huevos x15: stock 28 → 38 (+10)');
  assert.equal(lines[20], 'Le preparo los primeros 5 para aplicar; dígame "siguientes" para los demás.');
  assert.doesNotMatch(yes.body.reply, /999|se aplica aparte|Sin tarjeta/);
  assert.deepEqual(ids(yes), range(1, 5));
  assert.ok(yes.body.proposals.every((p) => p.type === 'ajuste' && p.needsConfirm && p.confirm_token && p.stock_actual !== 999 && p.cantidad === 10));
  assert.equal(yes.body.proposals[2].stock_actual, 4); assert.equal(yes.body.proposals[2].stock_despues, 14);

  const b2 = await c.say('siguientes');
  assert.equal(b2.sent.length, 0);
  assert.deepEqual(ids(b2), range(6, 10));
  assert.equal(b2.body.reply, 'Aquí van los productos 6 a 10 de 19. Dígame "siguientes" para los demás.');
  const b3 = await c.say('dame los siguientes');
  assert.deepEqual(ids(b3), range(11, 15));
  assert.equal(b3.body.reply, 'Aquí van los productos 11 a 15 de 19. Dígame "siguientes" para los demás.');
  const b4 = await c.say('Siguientes.');
  assert.deepEqual(ids(b4), range(16, 19));
  assert.equal(b4.body.reply, 'Aquí van los productos 16 a 19 de 19. Ya no quedan más.');
  assert.ok(b4.body.proposals.every((p) => p.confirm_token));

  // Terminado: la lista ya no está; otro «siguientes» va al modelo como cualquier mensaje.
  const after = await c.say('siguientes', [], 'No hay más tarjetas pendientes.');
  assert.equal(after.sent.length, 1); assert.equal(after.body.proposals.length, 0);
  assert.deepEqual(Object.keys(c.store._map.get(await PA.bulkKey({ principalId: 'session:o' })).value), []);
});

test('INV-057: «sí» sin la pregunta antes, o con otro rol, no saca la lista guardada', async () => {
  const c = convo();
  await c.say('sumale 10 a todo el stock', sumAll(8), 'Listo.');
  const other = await c.say('cuanto arroz hay', [], 'Hay 10.');
  assert.equal(other.sent.length, 1);
  const yes = await c.say('si', [], 'Ok.');
  assert.equal(yes.sent.length, 1, 'la última respuesta no era la pregunta: va al modelo'); assert.equal(yes.body.proposals.length, 0);

  const e = convo();
  await e.say('sumale 10 a todo el stock', sumAll(8), 'Listo.');
  e.setRole('empleado:completo'); // mismo aparato, ahora sin permiso de ajustes: el historial del Admin no vale y no sale ninguna tarjeta
  const emp = await e.say('sí', [], 'Ok.');
  assert.equal(emp.status, 200, JSON.stringify(emp.body)); assert.equal(emp.sent.length, 1, 'va al modelo'); assert.equal(emp.body.proposals.length, 0);
  assert.doesNotMatch(String(emp.body.reply), /Esta es la lista|stock \d/);
});

test('INV-057: si no se puede leer el stock del servidor, no hay tarjetas y la lista sigue guardada', async () => {
  const c = convo();
  await c.say('sumale 10 a todo el stock', sumAll(7), 'Listo.');
  const save = reader.products; reader.products = async () => { throw new Error('base caída'); };
  try {
    const r = await c.say('dale');
    assert.equal(r.sent.length, 0); assert.equal(r.body.proposals.length, 0);
    assert.equal(r.body.reply, PA.BULK_READ_FAILED_TEXT);
  } finally { reader.products = save; }
});
