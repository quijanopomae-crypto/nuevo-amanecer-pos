// fix/asist-compra-filas-fantasma (auditoría 500, compras): el modelo arma bien la compra pero el servidor sumaba una 2.ª fila
// copiada del texto (CP-003/006/023/025: la tarjeta sumaría el doble de stock); además no inventa proveedor de un producto (CP-012),
// ni un menú para borrar compras (CP-027), ni un costo que nadie dijo; y si quita una fila dice por qué y cuánto (CP-037).
// Frases exactas del arnés con el modelo real; aquí el modelo siempre simulado, sin red, datos inventados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';

const { assistantChatRoute, createMemoryUsageStore, systemPrompt, parseArrivalItems } = A;
const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'compras-fantasma-secret-0123456789', OHMYAGENT_API_KEY: 'test-only' };
const auth = { principalId: 'owner-cf', sessionId: 'session-cf' };
const PRODUCTS = [
  { id: 'p1', nombre: 'Arroz Costeño 1 kg', controla: true, precio: 4, stock: 40, costo: 3.4 },
  { id: 'p2', nombre: 'Leche Gloria Azul tarro grande 400 g', controla: true, precio: 4.2, stock: -2, costo: 3.6 },
  { id: 'p3', nombre: 'Leche Gloria tarro chico 170 g', controla: true, precio: 2, stock: 30, costo: 1.6 },
  { id: 'p4', nombre: 'Leche Gloria Light 400 g', controla: true, precio: 4.5, stock: 12, costo: 3.8 },
  { id: 'p6', nombre: 'Inca Kola 500 ml', controla: true, precio: 2.5, stock: 36, costo: 1.6 },
  { id: 'p8', nombre: 'Atún Florida 170 g', controla: true, precio: 6.5, stock: 18, costo: 5.2 },
  { id: 'p23', nombre: 'Pan francés', controla: false, precio: 0.2, stock: null, costo: 0.12 }
];
const PURCHASES = [{ purchase_id: 'c1', supplier: 'Distribuidora San Juan', document_ref: 'F001-2231', created_at: '2026-10-23T10:00:00Z', total_cost_cents: 18640, lines: 3 },
  { purchase_id: 'c2', supplier: 'Alicorp', document_ref: 'B002-551', created_at: '2026-10-22T10:00:00Z', total_cost_cents: 24000, lines: 4 }];
const READER = { products: async () => PRODUCTS, purchases: async () => PURCHASES, credits: async () => [], customers: async () => [] };
const call = (name, args) => ({ content: '', tool_calls: [{ id: 'c-' + name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
async function chat(text, responses, { history = [] } = {}) {
  const requests = [];
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text, history, context: { products: PRODUCTS } }) }), env, auth,
    (d, s = 200) => new Response(JSON.stringify(d), { status: s }), {
      store: createMemoryUsageStore(), now: () => 200000, resolveRole: async () => 'owner', audit: async () => {}, reader: READER,
      fetch: async (_u, init) => { requests.push(JSON.parse(init.body)); const m = responses[Math.min(requests.length - 1, responses.length - 1)]; return new Response(JSON.stringify({ choices: [{ message: m }] })); }
    });
  return { status: res.status, body: await res.json(), requests };
}
const rows = (b) => b.proposals.filter((p) => p.type === 'compra').flatMap((p) => p.lineas.map((l) => [l.product_id, l.nombre, l.cantidad, l.costo_unitario]));

// ---------- 1) filas fantasma: las cuatro frases exactas del arnés, con la llamada que hizo el modelo real ----------
const CASES = [
  ['CP-003', 'compré 24 inca kola 500ml pagué 36 en total', [{ product_id: 'p6', nombre: 'Inca Kola 500 ml', cantidad: 24, costo_unitario: 1.5 }], [['p6', 'Inca Kola 500 ml', 24, 1.5]]],
  ['CP-006', 'compre 10 atun florida a 5.20 no espera a 5.50', [{ product_id: 'p8', nombre: 'Atún Florida 170 g', cantidad: 10, costo_unitario: 5.5 }], [['p8', 'Atún Florida 170 g', 10, 5.5]]],
  ['CP-023', 'compre leche gloria tarro grande y chico, 12 de cada uno', [{ product_id: 'p2', nombre: 'Leche Gloria Azul tarro grande 400 g', cantidad: 12, costo_unitario: 0 },
    { product_id: 'p3', nombre: 'Leche Gloria tarro chico 170 g', cantidad: 12, costo_unitario: 0 }], [['p2', 'Leche Gloria Azul tarro grande 400 g', 12, 0], ['p3', 'Leche Gloria tarro chico 170 g', 12, 0]]],
  ['CP-025', 'compre 20 de un producto nuevo que no tengo, chizito grande a 1.20', [{ product_id: '', nombre: 'Chizito grande', cantidad: 20, costo_unitario: 1.2 }], [[null, 'Chizito grande', 20, 1.2]]]
];
for (const [id, text, lineas, want] of CASES) {
  test('1) ' + id + ' «' + text + '»: UNA fila por producto, sin fila fantasma copiada del texto', async () => {
    const { status, body } = await chat(text, [call('preparar_compra', { proveedor: '', documento: '', lineas })]);
    assert.equal(status, 200);
    assert.deepEqual(body.proposals.map((p) => p.type), ['compra']);
    assert.deepEqual(rows(body), want);
    const total = body.proposals[0].lineas.reduce((n, l) => n + l.cantidad, 0);
    assert.equal(total, want.reduce((n, r) => n + r[2], 0), 'el stock no se suma dos veces');
  });
}

test('1) el texto se lee sin precio, pago ni relleno en el nombre', () => {
  assert.deepEqual(parseArrivalItems('compré 24 inca kola 500ml pagué 36 en total'), [{ nombre: 'inca kola 500ml', cantidad: 24, costo_unitario: 1.5 }]);
  assert.deepEqual(parseArrivalItems('compre 10 atun florida a 5.20 no espera a 5.50'), [{ nombre: 'atun florida', cantidad: 10, costo_unitario: 5.5 }]);
  assert.deepEqual(parseArrivalItems('compre leche gloria tarro grande y chico, 12 de cada uno'), [], '«12 de cada uno» no es un producto');
  assert.deepEqual(parseArrivalItems('compre 20 de un producto nuevo que no tengo, chizito grande a 1.20'), [{ nombre: 'chizito grande', cantidad: 20, costo_unitario: 1.2 }]);
});

test('1) lo que el modelo de verdad olvidó se sigue sumando (y sin fantasma de lo que sí puso)', async () => {
  const { body } = await chat('compré 24 inca kola 500ml pagué 36 en total y 10 atun florida a 5.50', [call('preparar_compra', { lineas: [{ product_id: 'p6', nombre: 'Inca Kola 500 ml', cantidad: 24, costo_unitario: 1.5 }] })]);
  assert.deepEqual(rows(body), [['p6', 'Inca Kola 500 ml', 24, 1.5], ['p8', 'Atún Florida 170 g', 10, 5.5]]);
  const b2 = await chat('compre 20 chizito grande a 1.20 y 5 papitas lays', [call('preparar_compra', { lineas: [{ nombre: 'Chizito grande', cantidad: 20, costo_unitario: 1.2 }] })]);
  assert.deepEqual(rows(b2.body), [[null, 'Chizito grande', 20, 1.2], [null, 'papitas lays', 5, 0]]);
});

// ---------- 2) CP-012: «a quién le compro el arroz» ----------
test('2) CP-012: no nombra al proveedor de la última compra como si fuera el del arroz; dice que no tiene ese dato', async () => {
  const { body } = await chat('a quien le compro el arroz', [call('consultar', { tipo: 'compras_recientes', producto: 'Arroz Costeño 1 kg', periodo: 'este_mes' })]);
  assert.doesNotMatch(body.reply, /La más reciente/);
  assert.doesNotMatch(body.reply, /San Juan|Alicorp/);
  assert.match(body.reply, /^No tengo registrado quién te vende cada producto/);
  assert.match(body.reply, /Inventario > Historial de compras por producto/); assert.equal(A.SCREEN_LABELS.pageHistorialCompras.label, "Historial de compras por producto", "pantalla real");
  for (const t of ['a quién le compro el arroz?', 'quién me vende la leche gloria', 'cuál es el proveedor del aceite', 'quien me trae el atun']) assert.ok(A.SUPPLIER_OF_PRODUCT_RE.test(t), t);
  for (const t of ['cuánto le compré a San Juan este mes', 'compré 10 arroz', 'cuál es el RUC de mi proveedor', 'mis últimas compras', 'a quién le compré el lunes', 'a quién le compré más este mes', 'cuál es el proveedor de la última compra']) assert.ok(!A.SUPPLIER_OF_PRODUCT_RE.test(t), t);
  const sp = systemPrompt('owner', {}, 'a quien le compro el arroz');
  assert.match(sp, /PROVEEDOR DE UN PRODUCTO: /);
  assert.ok(!systemPrompt('owner', {}, 'hola').includes('PROVEEDOR DE UN PRODUCTO'), 'solo cuando lo preguntan');
});

// ---------- 3) CP-027: «borra la compra que hice hoy» ----------
test('3) CP-027: no inventa un menú para borrar compras; una compra registrada no se borra ni se anula', async () => {
  const ui = readFileSync('POS/js/config/pos-purchases-client.js', 'utf8');
  assert.doesNotMatch(ui, /(?:Borrar|Eliminar|Anular) compra/, 'el POS no tiene esa opción');
  assert.match(ui, /Cerrar como parcial/);
  const { body } = await chat('borra la compra que hice hoy', [{ content: 'Admin, borrar una compra se hace a mano en Inventario > Compras; no tengo una herramienta para hacerlo desde aquí.' }]);
  assert.equal(body.reply, A.PURCHASE_VOID_TEXT);
  assert.match(body.reply, /no se puede borrar ni anular/); assert.match(body.reply, /Movimiento/); assert.doesNotMatch(body.reply, /dueño/);
  const sp = systemPrompt('owner', {}, 'borra la compra que hice hoy');
  assert.match(sp, /COMPRA REGISTRADA: no se puede borrar ni anular/);
  assert.match(systemPrompt('owner'), /Nunca inventes menús, botones ni pantallas/);
  const other = await chat('borra la venta de ayer', [{ content: 'No puedo anular ventas desde aquí: se hace en Ventas.' }]);
  assert.notEqual(other.body.reply, A.PURCHASE_VOID_TEXT, 'ventas no se tocan');
});

// ---------- 4) CP-037: costo inventado y fila quitada en silencio ----------
test('4) CP-037: «medio ciento de panes» sin control de stock: dice por qué y la cantidad (50)', async () => {
  const { body } = await chat('compre medio ciento de panes', [call('preparar_compra', { proveedor: '', documento: '', lineas: [{ product_id: 'p23', nombre: 'Pan francés', cantidad: 50, costo_unitario: 0.12 }] })]);
  assert.equal(body.proposals.length, 0);
  assert.match(body.reply, /«Pan francés» no lleva control de stock/);
  assert.match(body.reply, /\b50\b/, 'la persona ve el 50');
});

test('4) costo que nadie dijo: no se inventa (queda en 0 y marcado para revisar); el que sí dijo se respeta', async () => {
  const { body } = await chat('compre 50 inca kola', [call('preparar_compra', { lineas: [{ product_id: 'p6', nombre: 'Inca Kola 500 ml', cantidad: 50, costo_unitario: 1.6 }] })]);
  const l = body.proposals[0].lineas[0];
  assert.equal(l.costo_unitario, 0); assert.deepEqual(l.revisar, ['costo']);
  assert.match(body.reply, /Falta el costo/);
  const said = await chat('compre 50 inca kola a 1.60', [call('preparar_compra', { lineas: [{ product_id: 'p6', nombre: 'Inca Kola 500 ml', cantidad: 50, costo_unitario: 1.6 }] })]);
  assert.equal(said.body.proposals[0].lineas[0].costo_unitario, 1.6); assert.equal(said.body.proposals[0].lineas[0].revisar, undefined);
  const total = await chat('compre 50 inca kola, pagué 80', [call('preparar_compra', { lineas: [{ product_id: 'p6', nombre: 'Inca Kola 500 ml', cantidad: 50, costo_unitario: 1.6 }] })]);
  assert.equal(total.body.proposals[0].lineas[0].costo_unitario, 1.6, 'total / cantidad');
  const cents = await chat('compre 30 inca kola a 50 centimos', [call('preparar_compra', { lineas: [{ product_id: 'p6', nombre: 'Inca Kola 500 ml', cantidad: 30, costo_unitario: 0.5 }] })]);
  assert.equal(cents.body.proposals[0].lineas[0].costo_unitario, 0.5, 'céntimos');
  const hist = await chat('sí, prepárala', [call('preparar_compra', { lineas: [{ product_id: 'p6', nombre: 'Inca Kola 500 ml', cantidad: 50, costo_unitario: 1.6 }] })],
    { history: [{ role: 'user', content: 'compré 50 inca kola a 1.60' }, { role: 'assistant', content: '¿Preparo la compra?' }] });
  assert.equal(hist.body.proposals[0].lineas[0].costo_unitario, 1.6, 'dicho en un turno anterior');
  assert.match(systemPrompt('owner'), /Si no dicen el costo, omite costo_unitario/);
});

// ---------- VE-002 (ajustes-velocidad): 15 líneas dictadas; «coca cola litro y medio» salía 2 veces (Coca-Cola 1.5 L vinculada + fila fantasma sin vincular) ----------
const VE_PRODUCTS = [{"id": "p01", "nombre": "Arroz Costeño 750 g", "precio": 3.8, "stock": 12, "costo": 3.2, "controla": true}, {"id": "p02", "nombre": "ARROZ COSTEÑO 750G", "precio": 3.8, "stock": 3, "costo": 3.2, "controla": true}, {"id": "p03", "nombre": "Arroz Jairito 1 kg", "precio": 3.5, "stock": 40, "costo": 3.18, "controla": true}, {"id": "p04", "nombre": "Azúcar Rubia Cartavio 1 kg", "precio": 4, "stock": 10, "costo": 3.3, "controla": true}, {"id": "p05", "nombre": "Azúcar Blanca Paramonga 1 kg", "precio": 4.6, "stock": 6, "costo": 3.9, "controla": true}, {"id": "p06", "nombre": "Leche Gloria Tarro Grande 395 g (caja 24)", "precio": 4.2, "stock": 30, "costo": 3.1, "controla": true}, {"id": "p07", "nombre": "Leche Gloria Tarro Chico 170 g (caja 48)", "precio": 2.2, "stock": 20, "costo": 1.65, "controla": true}, {"id": "p08", "nombre": "Yogurt Gloria Fresa 1 L", "precio": 6.5, "stock": 6, "costo": 5.3, "controla": true}, {"id": "p09", "nombre": "Aceite Primor 1 L", "precio": 11.5, "stock": 8, "costo": 9.8, "controla": true}, {"id": "p10", "nombre": "Aceite Sao 900 ml", "precio": 9.9, "stock": 0, "costo": 8.2, "controla": true}, {"id": "p11", "nombre": "Inca Kola 500 ml", "precio": 2.5, "stock": 24, "costo": 1.9, "controla": true}, {"id": "p12", "nombre": "Inca Kola 1.5 L", "precio": 7, "stock": 6, "costo": 5.5, "controla": true}, {"id": "p13", "nombre": "Coca-Cola 500 ml", "precio": 2.5, "stock": 18, "costo": 1.85, "controla": true}, {"id": "p14", "nombre": "Coca-Cola 1.5 L", "precio": 7, "stock": 4, "costo": 5.4, "controla": true}, {"id": "p15", "nombre": "Coca-Cola lata 355 ml", "precio": 3, "stock": 0, "costo": 2.2, "controla": true}, {"id": "p17", "nombre": "Galleta Soda Field x6", "precio": 1.5, "stock": -2, "costo": 1.2, "controla": true}, {"id": "p18", "nombre": "Galleta Casino Menta", "precio": 1, "stock": 0, "costo": 0.75, "controla": true}, {"id": "p19", "nombre": "Galleta Oreo", "precio": 1.2, "stock": 15, "costo": 0.8, "controla": true}, {"id": "p20", "nombre": "Wafer Nik", "precio": 0.6, "stock": 3, "costo": 0.45, "controla": true}, {"id": "p22", "nombre": "Atún Florida 170 g", "precio": 6, "stock": 20, "costo": 4.7, "controla": true}, {"id": "p23", "nombre": "Atún Real 170 g", "precio": 5.2, "stock": -3, "costo": 4.1, "controla": true}, {"id": "p24", "nombre": "Cerveza Pilsen 630 ml", "precio": 7, "stock": 24, "costo": 5.2, "controla": true}, {"id": "p25", "nombre": "Cerveza Cristal lata 355 ml", "precio": 4.5, "stock": 0, "costo": 3.4, "controla": true}, {"id": "p26", "nombre": "Caramelos Globopop", "precio": 0.2, "stock": 100, "costo": 0.08, "controla": true}];
const VE_TEXT = "me llego mercaderia de distribuidora el sol: 2 cajas de leche gloria tarro grande a 74.40 la caja, 1 caja de leche gloria tarro chico a 79.20, 20 arroz costeño 750 a 3.20, 20 azucar rubia cartavio a 3.30, 12 aceite primor a 9.80, 24 inca kola 500 a 1.90, 24 coca cola 500 a 1.85, 12 coca cola litro y medio a 5.40, 20 galleta soda field a 1.20, 24 galleta oreo a 0.80, 72 wafer nik a 0.45, 24 atun florida a 4.70, 12 cerveza pilsen a 5.20, 100 caramelos globopop a 0.08 y 20 fideo don vittorio a 2.60";
const VE_CALL = {"proveedor": "Distribuidora El Sol", "documento": "", "lineas": [{"product_id": "p06", "nombre": "Leche Gloria Tarro Grande 395 g (caja 24)", "cantidad": 48, "costo_unitario": 3.1}, {"product_id": "p07", "nombre": "Leche Gloria Tarro Chico 170 g (caja 48)", "cantidad": 48, "costo_unitario": 1.65}, {"product_id": "", "nombre": "Arroz Costeño 750 g", "cantidad": 20, "costo_unitario": 3.2}, {"product_id": "p04", "nombre": "Azúcar Rubia Cartavio 1 kg", "cantidad": 20, "costo_unitario": 3.3}, {"product_id": "p09", "nombre": "Aceite Primor 1 L", "cantidad": 12, "costo_unitario": 9.8}, {"product_id": "p11", "nombre": "Inca Kola 500 ml", "cantidad": 24, "costo_unitario": 1.9}, {"product_id": "p13", "nombre": "Coca-Cola 500 ml", "cantidad": 24, "costo_unitario": 1.85}, {"product_id": "p14", "nombre": "Coca-Cola 1.5 L", "cantidad": 12, "costo_unitario": 5.4}, {"product_id": "p17", "nombre": "Galleta Soda Field x6", "cantidad": 20, "costo_unitario": 1.2}, {"product_id": "p19", "nombre": "Galleta Oreo", "cantidad": 24, "costo_unitario": 0.8}, {"product_id": "p20", "nombre": "Wafer Nik", "cantidad": 72, "costo_unitario": 0.45}, {"product_id": "p22", "nombre": "Atún Florida 170 g", "cantidad": 24, "costo_unitario": 4.7}, {"product_id": "p24", "nombre": "Cerveza Pilsen 630 ml", "cantidad": 12, "costo_unitario": 5.2}, {"product_id": "p26", "nombre": "Caramelos Globopop", "cantidad": 100, "costo_unitario": 0.08}, {"product_id": "", "nombre": "Fideo Don Vittorio", "cantidad": 20, "costo_unitario": 2.6}]};
async function veChat(text, args) {
  const reader = { ...READER, products: async () => VE_PRODUCTS };
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text, context: { products: VE_PRODUCTS } }) }), env, auth,
    (d, s = 200) => new Response(JSON.stringify(d), { status: s }), { store: createMemoryUsageStore(), now: () => 200000, resolveRole: async () => 'owner', audit: async () => {}, reader,
      fetch: async () => new Response(JSON.stringify({ choices: [{ message: call('preparar_compra', args) }] })) });
  return res.json();
}
test('1) VE-002 «… 12 coca cola litro y medio a 5.40 …» (15 líneas): 15 filas, Coca-Cola 1.5 L una sola vez y vinculada', async () => {
  const body = await veChat(VE_TEXT, VE_CALL);
  const r = rows(body);
  assert.equal(r.length, 15, JSON.stringify(r));
  const coca15 = r.filter((x) => /coca/i.test(x[1]) && !/500/.test(x[1]));
  assert.deepEqual(coca15, [['p14', 'Coca-Cola 1.5 L', 12, 5.4]]);
  assert.ok(!r.some((x) => /litro y medio/i.test(x[1])), 'sin fila fantasma');
  // los costos que dijo (incluido «a 74.40 la caja» de 24) se respetan
  assert.ok(r.every((x) => x[3] > 0), JSON.stringify(r));
});
test('1) tamaños distintos no se tapan: si el modelo solo puso la Coca-Cola 1.5 L, la de 500 que olvidó se suma', async () => {
  const body = await veChat('compre 12 coca cola litro y medio a 5.40, 24 coca cola 500 a 1.85', { lineas: [{ product_id: 'p14', nombre: 'Coca-Cola 1.5 L', cantidad: 12, costo_unitario: 5.4 }] });
  const r = rows(body);
  assert.equal(r.length, 2, JSON.stringify(r));
  assert.deepEqual(r[0], ['p14', 'Coca-Cola 1.5 L', 12, 5.4]);
  assert.equal(r[1][2], 24); assert.equal(r[1][3], 1.85); assert.match(r[1][1], /coca.cola 500/i);
});

// ---------- 3b) revisión de alfa: el empleado no puede ajustar stock, así que no se le ofrece el movimiento ----------
async function chatAs(role, text, message) {
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text, context: { products: PRODUCTS } }) }), env,
    role === 'owner' ? auth : { principalId: 'session:emp', posRole: 'empleado' }, (d, s = 200) => new Response(JSON.stringify(d), { status: s }), {
      store: createMemoryUsageStore(), now: () => 200000, resolveRole: async () => role, audit: async () => {}, reader: READER,
      fetch: async () => new Response(JSON.stringify({ choices: [{ message }] })) });
  return res.json();
}
test('3) CP-027 empleado: «borra la compra» sin ofrecerle el movimiento (no puede ajustar stock): «pídeselo al Admin»; el Admin sigue con la oferta', async () => {
  const invented = { content: 'Borrar una compra se hace a mano en Inventario > Compras.' };
  for (const role of ['empleado:completo', 'empleado:consultas']) {
    const body = await chatAs(role, 'borra la compra que hice hoy', invented);
    assert.match(body.reply, /no se puede borrar ni anular/, role);
    assert.match(body.reply, /pídeselo al Admin\.$/, role);
    assert.doesNotMatch(body.reply, /te preparo|Movimiento|dueño/, role);
    assert.doesNotMatch(systemPrompt(role, {}, 'borra la compra que hice hoy'), /COMPRA REGISTRADA[^\n]*proponer_ajuste_stock/, 'al empleado no se le pide ofrecer el ajuste');
  }
  const admin = await chatAs('owner', 'borra la compra que hice hoy', invented);
  assert.equal(admin.reply, A.PURCHASE_VOID_TEXT);
  assert.match(admin.reply, /te preparo el movimiento\.$/); assert.doesNotMatch(admin.reply, /pídeselo/);
});
