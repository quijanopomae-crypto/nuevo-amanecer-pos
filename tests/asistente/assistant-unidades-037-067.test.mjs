// fix/asist-unidades-037-067 (auditoría 500, unidades y cajas). Frases exactas del arnés con el modelo real (evidencia
// docs/auditoria-500/evidencia/unidades-036-070/UNI-037.json y UNI-067.json, commit 1d3d074b); aquí el modelo siempre simulado, sin red.
//  UNI-037: «vendo por kilo y el saco me costo 157» con «AZUCAR RUBIA X 50KG»: el modelo puso 3.14 por kilo (157 / 50) y el servidor
//           no leía «X 50KG» como tamaño del paquete: borraba el costo y la tarjeta salía con costo 0.
//  UNI-067: «compre 2 cajas y 3 sueltos de primor»: el lector del texto partía en « y 3» y sumaba una 2.ª fila suelta
//           («sueltos de primor», 3): la compra sumaba 30 en vez de 27.
// Revisión del PR #997 (líder de acuerdo):
//  - El costo por kilo o litro (157 / 50 = 3.14) solo vale si el producto del POS se VENDE por kilo o litro (unidad de venta en la
//    base del servidor, products.unit). Saco que se vende entero, o unidad desconocida: el costo queda en 157 (el del saco), marcado.
//  - Solo tamaños a granel (KG o LT de 2 para arriba): «GASEOSA 500ML» o «X 170GR» ya no hacen pasar números inventados.
//  - Fila mixta «2 cajas y 3 sueltos» sin el producto del modelo: cantidad vacía y «Falta cuántas trae la caja»; nunca 3.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { adjustRequests } from '../../tools/cloudflare-lab/src/pos-assistant-varios.js';

const { assistantChatRoute, createMemoryUsageStore, parseArrivalItems, clearUnstatedCosts } = A;
const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'unidades-037-067-secret-0123456789', OHMYAGENT_API_KEY: 'test-only' };
const auth = { principalId: 'owner-uni', sessionId: 'session-uni' };
const PRODUCTS = [
  { id: 'u07', nombre: 'ACEITE PRIMOR CLASICO 900ML X 12BOT', controla: true, precio: 10.5, stock: -3, costo: 8.3 },
  { id: 'u13', nombre: 'AZUCAR RUBIA X 50KG', controla: true, precio: 4, stock: 35, costo: 3.14, unidad: 'kilogramo' }, // se vende por kilo
  { id: 'u14', nombre: 'ARROZ ALEJANDRINA X 50KG', controla: true, precio: 180, stock: 20, costo: 150, unidad: 'unidad' }, // saco entero
  { id: 'u15', nombre: 'ARROZ JAIRITO X 49KG', controla: true, precio: 3.8, stock: 49, costo: 3.2 }, // unidad de venta desconocida
  { id: 'u16', nombre: 'AVENA 3 OSITOS BOLSA X 5KG', controla: true, precio: 28, stock: 4, costo: 23.5 },
  { id: 'u30', nombre: 'SEMILLAS DE GIRASOL X 500GR', controla: true, precio: 6, stock: 10, costo: 4 },
  { id: 'u31', nombre: 'ACEITE VEGETAL GRANEL X 20LT', controla: true, precio: 9, stock: 5, costo: 7, unidad: 'litro' }
];
const READER = { products: async () => PRODUCTS, purchases: async () => [], credits: async () => [], customers: async () => [] };
const call = (name, args) => ({ content: '', tool_calls: [{ id: 'c-' + name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
async function chat(text, message, { history = [] } = {}) {
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text, history, context: { products: PRODUCTS } }) }), env, auth,
    (d, s = 200) => new Response(JSON.stringify(d), { status: s }), {
      store: createMemoryUsageStore(), now: () => 200000, resolveRole: async () => 'owner', audit: async () => {}, reader: READER,
      fetch: async () => new Response(JSON.stringify({ choices: [{ message }] }))
    });
  return { status: res.status, body: await res.json() };
}
const rows = (b) => b.proposals.filter((p) => p.type === 'compra').flatMap((p) => p.lineas.map((l) => [l.product_id, l.nombre, l.cantidad, l.costo_unitario]));

// ---------- UNI-037 ----------
const UNI036 = [{ role: 'user', content: 'compre 2 sacos de azucar rubia de 50' },
  { role: 'assistant', content: 'Preparé el borrador. Revisa las cantidades, presentaciones y costos; pulsa Confirmar para abrir Nueva compra. El stock se suma solo al registrar la compra.' }];
test('UNI-037 «vendo por kilo y el saco me costo 157» con producto que se vende por KILO: el costo por kilo del modelo (157 / 50 = 3.14) se queda', async () => {
  const { status, body } = await chat('vendo por kilo y el saco me costo 157',
    call('preparar_compra', { proveedor: '', documento: '', lineas: [{ product_id: 'u13', nombre: 'AZUCAR RUBIA X 50KG', cantidad: 100, costo_unitario: 3.14 }] }), { history: UNI036 });
  assert.equal(status, 200);
  assert.deepEqual(rows(body), [['u13', 'AZUCAR RUBIA X 50KG', 100, 3.14]]);
  assert.equal(body.proposals[0].lineas[0].revisar, undefined, 'sin marca «costo»');
  assert.doesNotMatch(body.reply, /Falta el costo/);
});

test('UNI-037: tamaños por peso o volumen (KG, LT, decimales) dan el costo por kilo o litro SOLO si el producto se vende por kilo o litro', () => {
  const KG = new Map([['p', 'kilogramo']]), LT = new Map([['p', 'litro']]);
  const keep = (nombre, cantidad, costo, texts, units) => { const p = [{ type: 'compra', lineas: [{ product_id: 'p', nombre, cantidad, costo_unitario: costo }] }]; clearUnstatedCosts(p, texts, units); return p[0].lineas[0].costo_unitario; };
  assert.equal(keep('AZUCAR RUBIA X 50KG', 100, 3.14, ['el saco me costo 157'], KG), 3.14);
  assert.equal(keep('ARROZ JAIRITO X 49KG', 49, 3.2, ['compre 1 saco de jairito a 156.80'], new Map([['p', 'kg']])), 3.2);
  assert.equal(keep('7 SEMILLAS X 50KG', 50, 2.5, ['compre un saco de semillas, 125 soles'], new Map([['p', 'Kilo']])), 2.5);
  assert.equal(keep('AVENA 3 OSITOS BOLSA X 5KG', 10, 5, ['compre 2 bolsas de avena a 25 la bolsa'], KG), 5);
  assert.equal(keep('ACEITE VEGETAL GRANEL X 20LT', 20, 7, ['compre un bidon de aceite granel, 140'], LT), 7);
  assert.equal(keep('AZUCAR X 2.5KG', 5, 4, ['compre 2 bolsas de azucar de 2.5 a 10 cada una'], KG), 4);
  // se vende entero (unidad, saco, bolsa…) o no se sabe: NO se divide; queda el costo que dijo la persona (el del saco)
  assert.equal(keep('AZUCAR RUBIA X 50KG', 2, 3.14, ['el saco me costo 157'], new Map([['p', 'unidad']])), 157);
  assert.equal(keep('AZUCAR RUBIA X 50KG', 2, 3.14, ['el saco me costo 157'], new Map([['p', 'bolsa']])), 157);
  assert.equal(keep('AZUCAR RUBIA X 50KG', 2, 3.14, ['el saco me costo 157']), 157, 'sin unidad conocida');
  assert.equal(keep('ACEITE VEGETAL GRANEL X 20LT', 1, 7, ['compre un bidon de aceite granel, 140'], new Map()), 140);
  // lo que nadie dijo sigue sin inventarse: 0 y marcado para revisar (la persona lo escribe en Nueva compra)
  assert.equal(keep('AZUCAR RUBIA X 50KG', 100, 3.14, ['compre 2 sacos de azucar rubia de 50'], KG), 0, 'costo copiado de <datos_pos>');
  assert.equal(keep('SEMILLAS DE GIRASOL X 500GR', 10, 4, ['compre 10 bolsas de girasol'], KG), 0);
});

test('UNI-037: el costo corregido al del saco no queda en silencio: marca «costo» y no se manda como «Falta el costo»', () => {
  const p = [{ type: 'compra', lineas: [{ product_id: 'u14', nombre: 'ARROZ ALEJANDRINA X 50KG', cantidad: 2, costo_unitario: 3.14 }] }];
  const names = clearUnstatedCosts(p, ['el saco me costo 157'], new Map([['u14', 'unidad']]));
  assert.equal(p[0].lineas[0].costo_unitario, 157); assert.deepEqual(p[0].lineas[0].revisar, ['costo']);
  assert.deepEqual([...names], [], 'no es un costo que falte');
  assert.deepEqual(names.porSaco, ['ARROZ ALEJANDRINA X 50KG']);
});

test('UNI-037: solo tamaños a granel (KG o LT de 2 para arriba): gramos y mililitros ya no hacen pasar números inventados', () => {
  const keep = (nombre, cantidad, costo, texts) => { const p = [{ type: 'compra', lineas: [{ nombre, cantidad, costo_unitario: costo }] }]; clearUnstatedCosts(p, texts, new Map()); return p[0].lineas[0].costo_unitario; };
  assert.equal(keep('GASEOSA 500ML', 6, 12, ['compre 6 gaseosas']), 0, '6 / 0.5 = 12 no lo dijo nadie');
  assert.equal(keep('GASEOSA 500ML', 6, 1000, ['compre 6 gaseosas de 500ml']), 0, '500 / 0.5');
  assert.equal(keep('GALLETA SODA X 170GR', 17, 100, ['compre 17 galletas soda']), 0, '17 / 0.17 = 100');
  assert.equal(keep('GALLETA SODA X 170GR', 17, 1000, ['compre 17 galletas soda de 170gr']), 0, '170 / 0.17');
  assert.equal(keep('LECHE 1LT', 12, 4, ['compre 12 leches a 4']), 4, 'lo dicho sigue valiendo');
  assert.equal(keep('AZUCAR X 1.5KG', 3, 4, ['compre 3 bolsas de azucar, 6 soles']), 0, '6 / 1.5: no es a granel');
});

test('UNI-037: saco que se vende ENTERO (unidad de venta «unidad» en el servidor): «el saco me costo 157» queda en 157', async () => {
  const { status, body } = await chat('compre 2 sacos de arroz alejandrina, el saco me costo 157',
    call('preparar_compra', { lineas: [{ product_id: 'u14', nombre: 'ARROZ ALEJANDRINA X 50KG', cantidad: 2, costo_unitario: 157 }] }));
  assert.equal(status, 200);
  assert.deepEqual(rows(body), [['u14', 'ARROZ ALEJANDRINA X 50KG', 2, 157]]);
  assert.equal(body.proposals[0].lineas[0].revisar, undefined);
});

test('UNI-037: el modelo pone 3.14 (por kilo) a un saco que se vende ENTERO: se corrige a 157, marcado y avisado', async () => {
  const { status, body } = await chat('el saco me costo 157',
    call('preparar_compra', { lineas: [{ product_id: 'u14', nombre: 'ARROZ ALEJANDRINA X 50KG', cantidad: 2, costo_unitario: 3.14 }] }),
    { history: [{ role: 'user', content: 'compre 2 sacos de arroz alejandrina de 50' }, UNI036[1]] });
  assert.equal(status, 200);
  assert.deepEqual(rows(body), [['u14', 'ARROZ ALEJANDRINA X 50KG', 2, 157]]);
  assert.deepEqual(body.proposals[0].lineas[0].revisar, ['costo']);
  assert.match(body.reply, /«ARROZ ALEJANDRINA X 50KG» no figura como venta por kilo ni por litro/);
  assert.doesNotMatch(body.reply, /Falta el costo/);
});

test('UNI-037: producto sin unidad de venta conocida: tampoco se divide (queda 156.80, marcado)', async () => {
  const { body } = await chat('compre 1 saco de jairito a 156.80',
    call('preparar_compra', { lineas: [{ product_id: 'u15', nombre: 'ARROZ JAIRITO X 49KG', cantidad: 49, costo_unitario: 3.2 }] }));
  assert.deepEqual(rows(body), [['u15', 'ARROZ JAIRITO X 49KG', 49, 156.8]]);
  assert.ok(body.proposals[0].lineas[0].revisar.includes('costo'), 'marcado (y «costo_raro»: 156.80 contra 3.20 del inventario)');
  assert.match(body.reply, /«ARROZ JAIRITO X 49KG» no figura como venta por kilo ni por litro/);
});

test('UNI-037: sin costo dicho la tarjeta no queda en 0 en silencio: marca «costo» y la respuesta lo pide', async () => {
  const { body } = await chat('compre 2 sacos de azucar rubia de 50',
    call('preparar_compra', { lineas: [{ product_id: 'u13', nombre: 'AZUCAR RUBIA X 50KG', cantidad: 100, costo_unitario: 3.14 }] }));
  const l = body.proposals[0].lineas[0];
  assert.equal(l.costo_unitario, 0); assert.deepEqual(l.revisar, ['costo']);
  assert.match(body.reply, /Falta el costo de «AZUCAR RUBIA X 50KG»/);
});

// ---------- UNI-067 ----------
test('UNI-067 «compre 2 cajas y 3 sueltos de primor»: UNA fila de 27 (la del modelo), sin fila suelta de 3', async () => {
  const { status, body } = await chat('compre 2 cajas y 3 sueltos de primor',
    call('preparar_compra', { proveedor: '', documento: '', lineas: [{ product_id: 'u07', nombre: 'ACEITE PRIMOR CLASICO 900ML X 12BOT', cantidad: 27, costo_unitario: 0 }] }));
  assert.equal(status, 200);
  assert.deepEqual(rows(body), [['u07', 'ACEITE PRIMOR CLASICO 900ML X 12BOT', 27, 0]]);
  assert.equal(body.proposals[0].sinProducto, 0);
  assert.equal(body.proposals[0].lineas.reduce((n, l) => n + l.cantidad, 0), 27, 'no suma 30');
  assert.doesNotMatch(body.reply, /líneas por vincular/);
});

test('UNI-067: «N cajas y M sueltos de X» es UN renglón del texto; varios productos se siguen partiendo', () => {
  assert.deepEqual(parseArrivalItems('compre 2 cajas y 3 sueltos de primor'), [{ nombre: 'primor (2 cajas y 3 sueltos)', cantidad: null, costo_unitario: null, mixta: true }]);
  assert.deepEqual(parseArrivalItems('compre 1 caja y 5 unidades de leche gloria'), [{ nombre: 'leche gloria (1 caja y 5 unidades)', cantidad: null, costo_unitario: null, mixta: true }]);
  assert.deepEqual(parseArrivalItems('me llegaron 20 arroz costeño y 10 azucar rubia'), [{ nombre: 'arroz costeño', cantidad: 20, costo_unitario: null }, { nombre: 'azucar rubia', cantidad: 10, costo_unitario: null }]);
  assert.deepEqual(parseArrivalItems('compre 2 cajas de aceite primor y 3 azucar rubia'), [{ nombre: 'cajas de aceite primor', cantidad: 2, costo_unitario: null }, { nombre: 'azucar rubia', cantidad: 3, costo_unitario: null }]);
  assert.deepEqual(parseArrivalItems('compre 3 sueltos de primor'), [{ nombre: 'sueltos de primor', cantidad: 3, costo_unitario: null }]);
});

test('UNI-067: si el modelo no puso el producto mixto, la fila queda sin vincular, con CANTIDAD VACÍA y «Falta cuántas trae la caja» (nunca 3)', async () => {
  const { body } = await chat('compre 10 azucar rubia y 2 cajas y 3 sueltos de primor',
    call('preparar_compra', { lineas: [{ product_id: 'u13', nombre: 'AZUCAR RUBIA X 50KG', cantidad: 10 }] }));
  const c = body.proposals.find((p) => p.type === 'compra');
  assert.deepEqual(c.lineas.map((l) => [l.product_id, l.nombre, l.cantidad]), [['u13', 'AZUCAR RUBIA X 50KG', 10], [null, 'primor (2 cajas y 3 sueltos)', null]]);
  const mixed = c.lineas[1];
  assert.ok(mixed.revisar.includes('Falta cuántas trae la caja'), 'aviso visible en la tarjeta (texto de «revisar»)');
  assert.ok(mixed.limite && mixed.limite.includes('cantidad'), 'no se puede registrar sin la cantidad: «Está bien» no la deja pasar');
  assert.ok(!c.lineas.some((l) => l.cantidad === 3), 'nunca 3');
  assert.match(body.reply, /Falta cuántas trae la caja de «primor \(2 cajas y 3 sueltos\)»/);
  assert.deepEqual(A.overLimit(c.lineas).rows, [1], 'al confirmar, el servidor la rechaza si no se quita o se corrige');
});

test('UNI-067: AJ-043 (adjustRequests) sigue partiendo varios movimientos y no cambia', () => {
  assert.equal(adjustRequests('suma 5 arroz costeño y 3 azucar rubia').length, 2);
  assert.deepEqual(adjustRequests('agrega 5 arroz').length, 0);
});
