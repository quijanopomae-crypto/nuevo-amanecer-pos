// Auditoría 500 (ajustes y velocidad, arnés con modelo real): VE-010, AJ-043, AJ-002 y AJ-026. El modelo va simulado con las MISMAS
// llamadas que hizo el modelo real en la evidencia (docs/auditoria-500/evidencia/ajustes-velocidad/ en audit/asistente-500).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, createMemoryUsageStore, parseChatBody, ASSISTANT_LIMITS } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { matchProducts, runAssistantQuery, memoryReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { readerData } from '../../tools/asistente-proto/demo-data.mjs';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' };
const tool = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const P = [
  { id: 'p01', nombre: 'Arroz Costeño 750 g', precio: 3.8, costo: 3.2, stock: 12, min: 10, controla: true },
  { id: 'p04', nombre: 'Azúcar Rubia Cartavio 1 kg', precio: 4, costo: 3.3, stock: 10, min: 5, controla: true },
  { id: 'p11', nombre: 'Inca Kola 500 ml', precio: 2.5, costo: 1.9, stock: 24, min: 6, controla: true },
  { id: 'p12', nombre: 'Inca Kola 1.5 L', precio: 7, costo: 5.5, stock: 6, min: 3, controla: true },
  { id: 'p13', nombre: 'Coca-Cola 500 ml', precio: 2.5, costo: 1.85, stock: 18, min: 6, controla: true },
  { id: 'p16', nombre: 'Sprite 500 ml', precio: 2.5, costo: 1.8, stock: -1, min: 6, controla: true },
  { id: 'p17', nombre: 'Galleta Soda Field x6', precio: 3, costo: 2.2, stock: -2, min: 5, controla: true },
  { id: 'p23', nombre: 'Atún Real 170 g', precio: 6, costo: 4.6, stock: -3, min: 4, controla: true },
  { id: 'p29', nombre: 'Fideo Lavaggi Tallarín 500 g', precio: 2.8, costo: 2.1, stock: -5, min: 5, controla: true },
  { id: 'p30', nombre: 'Fósforos Llama', precio: 0.5, costo: 0.3, stock: -1, min: 10, controla: true },
  { id: 'p31', nombre: 'Velas Misioneras', precio: 1, costo: 0.6, stock: -4, min: 0, controla: false }
];
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
const sysText = (req) => req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');

// ---------- VE-010 ----------
test('VE-010: el mensaje real de la evidencia (1829 caracteres, 4.º pedido pasado el 1500) ya no pierde el atún en silencio', () => {
  const max = ASSISTANT_LIMITS.maxMessageChars;
  const head = 'Hoy llegó el pedido de la distribuidora y quiero registrar varias cosas con calma. '.repeat(30).slice(0, max - 20);
  const t = head + ' Primero el arroz.   Cuarto pedido: salida de 2 atun florida porque se rompieron las latas. ' + 'Gracias. '.repeat(30);
  const p = parseChatBody({ text: t }, 'owner');
  assert.ok(p.text.length <= max);
  assert.ok(p.cut, 'debe marcar el corte');
  assert.equal(p.cut.leidos, max); assert.equal(p.cut.faltan, t.length - max);
  assert.match(p.cut.desde, /atun florida/);
  const short = parseChatBody({ text: 'entrada 10 arroz' }, 'owner');
  assert.equal(short.cut, null);
});

test('VE-010: más largo que el tope -> se corta, pero el modelo y la persona saben cuánto faltó y desde dónde', async () => {
  const max = ASSISTANT_LIMITS.maxMessageChars, t = 'x'.repeat(max) + ' PEDIDO4 salida de 2 atun florida' + ' y'.repeat(200);
  const p = parseChatBody({ text: t }, 'owner');
  assert.equal(p.text.length, max);
  assert.ok(p.cut && p.cut.leidos === max && p.cut.faltan === t.length - max, JSON.stringify(p.cut));
  const r = await chat(t, [], 'Listo, lo reviso.');
  assert.equal(r.status, 200);
  assert.match(sysText(r.sent[0]), /MENSAJE CORTADO/);
  const lines = r.body.reply.split('\n');
  assert.equal(lines[0], 'Listo, lo reviso.');
  assert.match(lines[lines.length - 1], new RegExp('^Tu mensaje era muy largo: leí solo los primeros ' + max + ' caracteres\\. Quedó fuera desde «PEDIDO4 salida de 2 atun florida'));
  assert.deepEqual(r.body.texto_cortado, { leidos: max, faltan: t.length - max });
});

test('VE-010: un mensaje normal no lleva aviso ni bytes de más; primera llamada del Admin bajo 17000 bytes', async () => {
  const r = await chat('¿Cuánto vendí hoy?', [], 'Vendiste poco.');
  assert.equal(r.body.reply, 'Vendiste poco.'); assert.equal(r.body.texto_cortado, undefined);
  assert.doesNotMatch(sysText(r.sent[0]), /MENSAJE CORTADO|VARIOS MOVIMIENTOS|TODOS LOS NEGATIVOS/);
  const [b1] = r.body.payload_bytes; assert.ok(b1 > 0 && b1 < 17000, 'bytes ' + b1);
  const long = await chat('pon 1 arroz '.repeat(400).slice(0, ASSISTANT_LIMITS.maxMessageChars), [], 'ok');
  console.log('# bytes primera llamada Admin: corto=' + b1 + ' con ' + ASSISTANT_LIMITS.maxMessageChars + ' caracteres=' + long.body.payload_bytes[0]);
});

// ---------- AJ-043 ----------
test('AJ-043: tres movimientos en un mensaje y el modelo solo atiende el arroz -> se dice cuáles quedaron sin tarjeta', async () => {
  const r = await chat('entrada 10 arroz, salida 2 azucar, entrada 5 fideo', [adj('p01', 'entrada', 10, 1)]);
  assert.equal(r.status, 200);
  assert.match(sysText(r.sent[0]), /VARIOS MOVIMIENTOS EN UN MENSAJE/);
  assert.deepEqual(r.body.proposals.map((p) => p.product_id), ['p01']);
  const last = r.body.reply.split('\n').pop();
  assert.match(last, /^Sin tarjeta todavía: «salida 2 azucar» y «entrada 5 fideo»\./);
  assert.doesNotMatch(last, /arroz/);
});

test('AJ-043: si llegan las tres tarjetas no hay aviso; un solo movimiento tampoco lo lleva', async () => {
  const r = await chat('entrada 10 arroz, salida 2 azucar, entrada 5 fideo', [adj('p01', 'entrada', 10, 1), adj('p04', 'salida', 2, 2), adj('p29', 'entrada', 5, 3)]);
  assert.equal(r.body.proposals.length, 3); assert.doesNotMatch(r.body.reply, /Sin tarjeta/);
  const one = await chat('entrada 10 arroz', [adj('p01', 'entrada', 10, 1)]);
  assert.doesNotMatch(one.body.reply, /Sin tarjeta/); assert.doesNotMatch(sysText(one.sent[0]), /VARIOS MOVIMIENTOS/);
  const price = await chat('precio 5 arroz, 3 azucar', []);
  assert.doesNotMatch(price.body.reply, /Sin tarjeta/);
});

// ---------- AJ-002 ----------
test('AJ-002: «todos los negativos a diez» -> cuántos hay, que no existe ajuste masivo y cuáles quedaron sin tarjeta, en su propia línea', async () => {
  const r = await chat('Todos los productos negativos quiero ponerlos en diez unidades', [adj('p16', 'entrada', 11, 1), adj('p17', 'entrada', 12, 2), adj('p23', 'entrada', 13, 3)]);
  assert.equal(r.status, 200);
  assert.match(sysText(r.sent[0]), /TODOS LOS NEGATIVOS: no existe un ajuste masivo/);
  assert.equal(r.body.proposals.length, 3);
  const lines = r.body.reply.split('\n'), last = lines[lines.length - 1];
  assert.ok(lines.length >= 2, 'línea aparte: ' + r.body.reply);
  // 5 con control de stock (las velas no llevan control y no cuentan)
  assert.match(last, /^Hay 5 productos con stock negativo\. No existe un ajuste masivo: cada producto va con su propia tarjeta o se corrige en Inventario\. Sin tarjeta: /);
  assert.match(last, /Fideo Lavaggi Tallarín 500 g/); assert.match(last, /Fósforos Llama/); assert.doesNotMatch(last, /Sprite|Velas/);
});

test('AJ-002: sin tarjetas igual dice cuántos hay; una pregunta por los negativos no lleva el aviso', async () => {
  const r = await chat('pon todos los negativos en 10', [], 'Eso no lo puedo hacer de golpe.');
  assert.match(r.body.reply, /\nHay 5 productos con stock negativo\. No existe un ajuste masivo/);
  const q = await chat('¿cuáles productos están en negativo?', [], 'Tienes varios.');
  assert.equal(q.body.reply, 'Tienes varios.');
});

// ---------- AJ-026 ----------
test('AJ-026: «inka» encuentra Inca Kola (c/k/qu); lo exacto no cambia', async () => {
  assert.deepEqual(matchProducts(P, 'inka').map((p) => p.id), ['p11', 'p12']);
  assert.deepEqual(matchProducts(P, 'inca').map((p) => p.id), ['p11', 'p12']);
  assert.deepEqual(matchProducts(P, 'koka').map((p) => p.id), ['p13'], 'también al revés: k -> c');
  assert.deepEqual(matchProducts(P, 'coca').map((p) => p.id), ['p13'], 'con coincidencia exacta no se mezcla Inca Kola');
  assert.deepEqual(matchProducts(P, 'quaker'), []);
  const q = await runAssistantQuery(memoryReader({ ...readerData, products: P }), { tipo: 'stock_producto', producto: 'inka' });
  assert.equal(q.total, 2); assert.match(q.texto, /Inca Kola 500 ml/);
});

// ---------- VE-010 + SEG 500 (al unir #987): el PIN se tapa sobre el texto COMPLETO antes del corte ----------
// Un PIN que cae justo en la posición 1500 no puede quedar a medias sin tapar: ni en lo que va al modelo ni en el aviso «Quedó fuera desde…».
// solo lo que escribió la persona (<dato_usuario>…</dato_usuario>), sin los datos del punto de venta que sí llevan números
const userSent = (req) => req.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
  .map((c) => { const m = /<dato_usuario>([\s\S]*?)<\/dato_usuario>/.exec(c); return m ? m[1] : ''; }).join('\n');
const preview = (reply) => { const m = /Quedó fuera desde «([^»]*)»/.exec(reply); return m ? m[1] : null; };
for (const [label, cred, digits] of [['pin 4321', 'pin 4321', '4321'], ['pin: 123456', 'pin: 123456', '123456']]) {
  test('VE-010 + SEG: «' + label + '» justo en el corte de 1500 -> ni el modelo ni el aviso ven sus dígitos; el aviso de corte sigue', async () => {
    const max = ASSISTANT_LIMITS.maxMessageChars;
    for (const split of [1, 2, Math.ceil(digits.length / 2)]) {
      // los dígitos empiezan `split` caracteres antes del corte: una parte queda dentro y otra fuera
      const lead = 'Hoy llegó el pedido de la distribuidora y quiero registrar varias cosas con calma. '.repeat(40);
      const before = lead.slice(0, max - split - cred.length + digits.length) + ' ';
      const t = before.slice(1) + cred + ' es el de la caja, y luego anota la salida de arroz por favor. ' + 'Gracias. '.repeat(20);
      const at = t.indexOf(digits);
      assert.ok(at < max && at + digits.length > max, 'el PIN debe cruzar el corte (en ' + at + ', split ' + split + ')');
      const p = parseChatBody({ text: t }, 'owner');
      assert.ok(p.cut, 'debe marcar el corte');
      assert.doesNotMatch(p.text, /\d/, 'texto al modelo: ' + p.text.slice(-60));
      assert.doesNotMatch(p.cut.desde, /\d/, 'vista previa: ' + p.cut.desde);
      const r = await chat(t, [], 'Listo, lo reviso.');
      assert.equal(r.status, 200);
      const us = userSent(r.sent[0]); assert.ok(us.length > 1000, 'llega el mensaje cortado'); assert.match(us, /pin:? \[/);
      assert.doesNotMatch(us, /\d/, 'lo que va al modelo no lleva ni una parte del PIN');
      assert.ok(!JSON.stringify(r.sent).includes(digits), 'payload sin el PIN');
      assert.match(sysText(r.sent[0]), /MENSAJE CORTADO/);
      const pv = preview(r.body.reply);
      assert.ok(pv !== null, 'el aviso de corte sigue: ' + r.body.reply);
      assert.doesNotMatch(pv, /\d/, 'vista previa del corte: ' + pv);
      assert.ok(!r.body.reply.includes(digits), 'la respuesta no repite el PIN');
      assert.match(r.body.reply.split('\n').pop(), /^Tu mensaje era muy largo: leí solo los primeros 1500 caracteres\./);
    }
  });
}

// ---------- AJ-043 / AJ-002 + «Son N productos…» (#987): cada aviso en su línea, sin repetir ni perderse ----------
test('AJ-043 + #987: dos tarjetas de tres pedidos -> «Son 2 productos…» pegada a la respuesta y el aviso de lo que faltó en su propia línea', async () => {
  const r = await chat('entrada 10 arroz, salida 2 azucar, entrada 5 fideo', [adj('p01', 'entrada', 10, 1), adj('p04', 'salida', 2, 2)], 'Listo.');
  assert.equal(r.status, 200);
  assert.equal(r.body.proposals.length, 2);
  const lines = r.body.reply.split('\n');
  assert.equal(lines.length, 2, r.body.reply);
  assert.equal(lines[0], 'Listo. Son 2 productos; cada uno se aplica aparte con su «Aplicar».');
  assert.match(lines[1], /^Sin tarjeta todavía: «entrada 5 fideo»\./);
  assert.equal(r.body.reply.match(/Son \d+ productos/g).length, 1, 'la frase va una sola vez');
});

test('AJ-002 + #987: negativos con tres tarjetas -> «Son 3 productos…» y «Hay 5 productos con stock negativo…» en líneas distintas', async () => {
  const r = await chat('Todos los productos negativos quiero ponerlos en diez unidades', [adj('p16', 'entrada', 11, 1), adj('p17', 'entrada', 12, 2), adj('p23', 'entrada', 13, 3)], 'Preparé las tarjetas.');
  const lines = r.body.reply.split('\n');
  assert.equal(lines.length, 2, r.body.reply);
  assert.equal(lines[0], 'Preparé las tarjetas. Son 3 productos; cada uno se aplica aparte con su «Aplicar».');
  assert.match(lines[1], /^Hay 5 productos con stock negativo\. No existe un ajuste masivo/);
  assert.doesNotMatch(lines[1], /Son \d+ productos/);
});
