// Lote en vivo 22-10 (preguntas de un usuario nuevo en el POS web): nombres reales de pantallas, total de deudas, «pulsa Confirmar» solo
// con tarjeta de cambio, productos nombrados a medias, correcciones revisadas, «¿qué te enseñé?», borrar todo y nombre de producto (Admin).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { runAssistantQuery, matchProducts } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { taughtFact } from '../../tools/cloudflare-lab/src/pos-assistant-invoice-memory.js';

const { assistantChatRoute, createMemoryUsageStore, systemPrompt } = A;
const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'lote-vivo-test-secret-1234567890', OHMYAGENT_API_KEY: 'test-only' };
const auth = { principalId: 'owner-lv', sessionId: 'session-lv' };
const PRODUCTS = [
  { id: 'p1', nombre: 'Leche Gloria Azul 400 g (1-24)', controla: true, stock: 30, min: 5, precio: 4.2, costo: 3.5 },
  { id: 'p2', nombre: 'Leche Gloria Light 400 g', controla: true, stock: 10, min: 2, precio: 4.5, costo: 3.8 },
  { id: 'p3', nombre: 'Leche Gloria Niños 1 L', controla: true, stock: 6, min: 2, precio: 6.9, costo: 5.9 },
  { id: 'p4', nombre: 'Aceite Primor 1 L', controla: true, stock: 8, min: 2, precio: 11.5, costo: 9.8 },
  { id: 'p5', nombre: 'Cerveza Pilsen six pack', controla: true, stock: 4, min: 1, precio: 27, costo: 22 }
];
async function chat(body, { role = 'owner', responses = [{ content: 'Respuesta de prueba' }], now = 200000, reader } = {}) {
  const requests = [];
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify(body) }), env, auth, (d, s = 200) => new Response(JSON.stringify(d), { status: s }), {
    store: createMemoryUsageStore(), now: () => now, resolveRole: async () => role, audit: async () => {},
    reader: reader || { products: async () => PRODUCTS, credits: async () => [{ cliente: 'c1', saldo: 50 }, { cliente: 'c2', saldo: 25.5 }], customers: async () => [{ id: 'c1', nombre: 'Rosa Pérez' }, { id: 'c2', nombre: 'Juan Díaz' }] },
    fetch: async (_u, init) => { requests.push(JSON.parse(init.body)); const m = responses[Math.min(requests.length - 1, responses.length - 1)]; return new Response(JSON.stringify({ choices: [{ message: m }] })); }
  });
  return { status: res.status, body: await res.json(), requests };
}
const call = (name, args) => ({ content: '', tool_calls: [{ id: 'c-' + name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

test('pantallas: los nombres del prompt son los del menú real (POS/index.html); no existen «Venta» ni «Deudas»', () => {
  const html = readFileSync('POS/index.html', 'utf8');
  const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
  for (const id of A.MENU_SCREENS) {
    const re = new RegExp('data-menu-target="' + id + '"[\\s\\S]{0,400}?</(?:a|button|li)>');
    const m = html.match(re); assert.ok(m, 'menú ' + id);
    assert.ok(strip(m[0].replace(/^[^>]*>/, '')).includes(A.SCREEN_LABELS[id].label), id + ': «' + A.SCREEN_LABELS[id].label + '» no está en el menú');
  }
  for (const id of Object.keys(A.SCREEN_LABELS).filter((x) => !A.MENU_SCREENS.includes(x))) {
    const i = html.indexOf('id="' + id + '"'); assert.ok(i > 0, id);
    const h = html.slice(i, i + 4000).match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/); assert.ok(h && strip(h[1]).includes(A.SCREEN_LABELS[id].label), id + ' título');
  }
  for (const id of A.ADMIN_SCREENS) assert.ok(A.SCREEN_LABELS[id], 'sin nombre: ' + id);
  for (const role of ['owner', 'empleado:consultas']) {
    const sp = systemPrompt(role);
    assert.doesNotMatch(sp, /\ben Venta\b|Deudas \(|\(pageReporteDeuda\)|Registrar compra|Nuevo producto =/);
    assert.match(sp, /Punto de Venta/); assert.match(sp, /no existen «Venta» ni «Deudas»/);
    assert.match(sp, /Clientes > Reporte de deuda/); assert.match(sp, /Clientes \(«Clientes y Créditos»\)/); assert.match(sp, /Inventario > Compras > Nueva compra/);
  }
});

test('«cuánto me deben»: regla con consultar deudas_clientes solo para el Admin; el total sale del servidor sin nombres', async () => {
  assert.match(systemPrompt('owner'), /CUÁNTO LE DEBEN[^\n]*deudas_clientes[^\n]*total/);
  assert.doesNotMatch(systemPrompt('empleado:consultas'), /CUÁNTO LE DEBEN/);
  const r = await chat({ text: '¿cómo sé cuánto me deben? Explícame.' }, { responses: [call('consultar', { tipo: 'deudas_clientes' }), { content: 'Le deben S/ 75.50 entre 2 clientes. El detalle está en Clientes > Reporte de deuda.' }] });
  assert.equal(r.status, 200); assert.match(r.body.reply, /75\.50/);
  const toModel = JSON.stringify(r.requests[1].messages.filter((m) => m.role === 'tool'));
  assert.equal(JSON.parse(JSON.parse(toModel)[0].content).resumen.total_soles, 75.5); assert.doesNotMatch(toModel, /Rosa|Juan/);
  const emp = await chat({ text: '¿cuánto me deben?' }, { role: 'empleado:consultas', responses: [call('consultar', { tipo: 'deudas_clientes' })] });
  assert.ok(emp.status === 403 || !(emp.body.proposals || []).some((p) => p.type === 'consulta'), 'empleado sin deudas');
});

test('«pulsa Confirmar» solo con tarjeta de cambio: pasos y consultas no lo dicen', async () => {
  const pasos = await chat({ text: '¿cómo registro una compra?' }, { responses: [call('explicar_pasos', { tema: 'Compra', pasos: ['Entra a Inventario', 'Pulsa Compras'], pantalla: 'pageInventario' })] });
  assert.doesNotMatch(pasos.body.reply, /Confirmar/); assert.ok(pasos.body.reply.length > 0);
  const said = await chat({ text: '¿cómo veo el kardex?' }, { responses: [{ ...call('explicar_pasos', { tema: 'Kardex', pasos: ['Entra a Inventario'] }), content: 'Te dejo los pasos. Revisa y pulsa Confirmar.' }] });
  assert.equal(said.body.reply, 'Te dejo los pasos.');
  const precio = await chat({ text: 'sube el aceite a 12', context: { products: [{ id: 'p4', nombre: 'Aceite Primor 1 L', precio: 11.5 }] } }, { responses: [call('proponer_cambio_precio', { product_id: 'p4', precio_nuevo: 12 })] });
  assert.match(precio.body.reply, /pulsa Confirmar/);
  assert.equal(A.stripConfirmHint('Listo. Revisa y pulsa Confirmar.'), 'Listo.');
  assert.match(systemPrompt('owner'), /NUNCA digas "pulsa Confirmar"/);
});

test('producto nombrado a medias: lista los que coinciden con precio; costo solo al Admin', async () => {
  assert.match(systemPrompt('owner'), /PRODUCTO NOMBRADO A MEDIAS[^\n]*stock_producto[^\n]*precio y su costo/);
  assert.doesNotMatch(systemPrompt('empleado:consultas'), /PRODUCTO NOMBRADO A MEDIAS[^\n]*costo/);
  const reader = { products: async () => PRODUCTS };
  const r = await runAssistantQuery(reader, { tipo: 'stock_producto', producto: 'leche gloria' });
  assert.equal(r.filas.length, 3); assert.equal(r.resumen.encontrados, 3);
  assert.deepEqual(r.resumen.productos.map((p) => p.precio), [4.2, 4.5, 6.9]); assert.match(r.texto, /S\/ 4\.20/);
  assert.equal(matchProducts(PRODUCTS, 'six pack de cerveza').length, 1); assert.equal(matchProducts(PRODUCTS, 'aceites').length, 1);
  const own = await chat({ text: 'leche gloria, explícame' }, { responses: [call('consultar', { tipo: 'stock_producto', producto: 'leche gloria' }), { content: 'Hay 3 Leche Gloria.' }] });
  const card = own.body.proposals.find((p) => p.type === 'consulta');
  assert.ok(card.result.columnas.includes('Costo S/')); assert.equal(card.result.filas.length, 3);
  const emp = await chat({ text: 'leche gloria, explícame' }, { role: 'empleado:consultas', responses: [call('consultar', { tipo: 'stock_producto', producto: 'leche gloria' }), { content: 'Hay 3.' }] });
  const ec = emp.body.proposals.find((p) => p.type === 'consulta');
  assert.ok(!ec.result.columnas.includes('Costo S/') && ec.result.columnas.includes('Precio S/'));
  const toModel = JSON.stringify(emp.requests[1].messages.filter((m) => m.role === 'tool'));
  assert.doesNotMatch(toModel, /costo|3\.5\b/i); assert.equal(JSON.parse(JSON.parse(toModel)[0].content).resumen.productos[0].precio, 4.2);
});

test('correcciones: comparar con el sistema antes de aceptarlas («El sistema dice 24, ¿lo cambio?»)', () => {
  for (const role of ['owner', 'empleado:consultas']) {
    const sp = systemPrompt(role);
    assert.match(sp, /CORRECCIONES DEL USUARIO[^\n]*compáralo con el dato del sistema[^\n]*«El sistema dice 24, ¿lo cambio\?»[^\n]*Nunca digas «tomo la corrección»/);
  }
  assert.match(systemPrompt('owner'), /MEMORIA DE BOLETA[^\n]*una corrección explícita más reciente prevalece/); // la de boleta cede ante CORRECCIONES
});

test('«¿qué te enseñé?»: lo enseñado sigue llegando al modelo aunque salga de los últimos 8 mensajes', async () => {
  const first = await chat({ text: 'la caja de leche Gloria trae 24 latas', history: [] });
  assert.equal(typeof first.body.invoice_memory, 'string', 'sin boleta igual guarda lo enseñado');
  let token = first.body.invoice_memory;
  token = (await chat({ text: 'recuerda que el six pack de Pilsen cuesta 27 soles', invoice_memory: token })).body.invoice_memory;
  for (let i = 0; i < 10; i++) token = (await chat({ text: '¿cuánto stock hay de aceite?', invoice_memory: token })).body.invoice_memory;
  const ask = await chat({ text: '¿qué te enseñé hoy?', invoice_memory: token, history: [] });
  const payload = JSON.stringify(ask.requests[0].messages.filter((m) => m.role !== 'system'));
  assert.match(payload, /ensenado_por_usuario/); assert.match(payload, /trae 24 latas/); assert.match(payload, /cuesta 27 soles/);
  assert.doesNotMatch(payload, /cuánto stock hay de aceite\?.*dicho_por_el_usuario|dicho_por_el_usuario[^\]]*aceite/);
  assert.doesNotMatch(payload, /boleta_recordada/, 'sin boleta no se inventa una');
  assert.match(systemPrompt('owner'), /«¿qué te enseñé\?»[^\n]*lista TODOS/);
  const emp = await chat({ text: '¿qué te enseñé?', invoice_memory: token }, { role: 'empleado:consultas' });
  assert.doesNotMatch(JSON.stringify(emp.requests[0].messages), /trae 24 latas/); assert.equal(emp.body.invoice_memory, undefined);
});

test('«resetea el sistema» / «borra todo»: «Eso necesita la clave del Admin» y nunca ofrece borrar', async () => {
  for (const t of ['resetea el sistema', 'borra todo', 'Borra todos los registros', 'reinicia todo desde cero', 'limpia la base de datos']) assert.equal(A.isResetRequest(t), true, t);
  for (const t of ['borra el producto arroz', 'borra la venta de ayer', 'reinicia la caja', 'todo bien, gracias']) assert.equal(A.isResetRequest(t), false, t);
  for (const role of ['owner', 'empleado:consultas']) {
    const r = await chat({ text: 'resetea el sistema' }, { role, responses: [{ content: '¿Quieres borrar todos los registros? Puedo ayudarte con los pasos.' }] });
    assert.equal(r.status, 200); assert.match(r.body.reply, /^Eso necesita la clave del Admin\./); assert.doesNotMatch(r.body.reply, /quieres|¿/i);
    assert.equal(r.body.proposals.length, 0);
  }
  const p = await chat({ text: 'borra todo' }, { responses: [call('explicar_pasos', { tema: 'Borrar', pasos: ['Entra a Configuración', 'Borra los datos'] })] });
  assert.equal(p.body.proposals.length, 0); assert.match(p.body.reply, /clave del Admin/);
  assert.match(systemPrompt('owner'), /BORRAR TODO O REINICIAR[^\n]*«Eso necesita la clave del Admin\.»[^\n]*No lo ofrezcas/);
});

test('Admin: el texto nombra el producto, no «producto #id»; el empleado sin cambios', async () => {
  const ctx = { products: [{ id: 'p17abc', nombre: 'Leche Gloria Azul 400 g', precio: 4.2, stock: 3 }] };
  const own = await chat({ text: '¿qué producto está bajo?', context: ctx }, { responses: [{ content: 'El producto #p17abc tiene 3 unid.' }] });
  assert.equal(own.body.reply, 'El producto Leche Gloria Azul 400 g tiene 3 unid.');
  const emp = await chat({ text: '¿qué producto está bajo?', context: ctx }, { role: 'empleado:consultas', responses: [{ content: 'El producto #p17abc tiene 3 unid.' }] });
  assert.match(emp.body.reply, /#p17abc/);
  assert.equal(A.nameProductRefs('cliente #c1 compró', ctx.products), 'cliente #c1 compró');
  // Con la base: los productos de un resumen siguen como «producto #código» (assistant-resumenes.test.mjs); el resto se nombra en el servidor.
  assert.doesNotMatch(systemPrompt('owner'), /Nombra los productos por su NOMBRE/);
});

// ---------- Lote 3 ----------
const JAIRITO = [...PRODUCTS, { id: 'p9', nombre: 'Arroz Jairito 1 kg', controla: true, stock: 20, min: 2, precio: 3.5, costo: 2.8 }];
async function chatOn(store, body, { role = 'owner', now = 200000, products = JAIRITO } = {}) {
  const requests = [];
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify(body) }), env, auth, (d, s = 200) => new Response(JSON.stringify(d), { status: s }), {
    store, now: () => now, resolveRole: async () => role, audit: async () => {},
    reader: { products: async () => products, credits: async () => [], customers: async () => [] },
    fetch: async (_u, init) => { requests.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: 'Listo.' } }] })); }
  });
  return { status: res.status, body: await res.json(), requests };
}
const dataMsg = (req, tag) => req.messages.find((m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('<' + tag + '>'));
const dataJson = (msg, tag) => JSON.parse(msg.content.slice(tag.length + 2).replace('</' + tag + '>', '').trim().replace(/\\u003c/g, '<').replace(/\\u003e/g, '>'));

test('lote 3: precio por nombre a medias desde los datos reales (sin depender de la pantalla); costo solo para el Admin', async () => {
  for (const text of ['a cuanto vendo el arroz jairito?', 'cuánto cuesta el jairito', 'precio del arroz']) {
    const o = await chatOn(createMemoryUsageStore(), { text, context: { products: [] } });
    const m = dataMsg(o.requests[0], 'precios_del_sistema'); assert.ok(m, text + ': sin <precios_del_sistema>');
    const row = dataJson(m, 'precios_del_sistema').productos.find((p) => /Jairito/.test(p.nombre));
    assert.deepEqual(row, { nombre: 'Arroz Jairito 1 kg', precio: 3.5, costo: 2.8 }, text);
  }
  const e = await chatOn(createMemoryUsageStore(), { text: 'a cuanto vendo el arroz jairito?' }, { role: 'empleado:consultas' });
  const rows = dataJson(dataMsg(e.requests[0], 'precios_del_sistema'), 'precios_del_sistema').productos;
  assert.deepEqual(rows, [{ nombre: 'Arroz Jairito 1 kg', precio: 3.5 }], 'empleado: precio sí, costo nunca');
  assert.ok(!JSON.stringify(e.requests[0]).includes('2.8'));
  assert.match(systemPrompt('owner'), /<precios_del_sistema>[^\n]*nunca digas que no tienes ese precio/);
  const plain = await chatOn(createMemoryUsageStore(), { text: 'hay arroz jairito?' }); // sin pregunta de precio no se agrega nada
  assert.equal(dataMsg(plain.requests[0], 'precios_del_sistema'), undefined);
});

test('lote 3: «qué te enseñé hoy» lee lo guardado HOY en el servidor (corrección de producto + proveedor), sin historial ni token', async () => {
  const store = createMemoryUsageStore();
  assert.equal(taughtFact('mi proveedor del arroz es distribuidora san juan'), 'mi proveedor del arroz es distribuidora san juan');
  assert.equal(taughtFact('a quien le compro el arroz?'), null);
  await chatOn(store, { text: 'apunta: la caja de inka kola de 500ml trae 12' });
  await chatOn(store, { text: 'te equivocaste, la leche gloria azul viene 24 por caja, no 48' });
  await chatOn(store, { text: 'mi proveedor del arroz es distribuidora san juan' });
  for (let i = 0; i < 10; i++) await chatOn(store, { text: 'cuanto vendí hoy ' + i }, { now: 200000 + i * 1000 });
  const q = await chatOn(store, { text: 'que te enseñé hoy' }, { now: 300000 }); // sin history ni invoice_memory: solo el servidor
  const m = dataMsg(q.requests[0], 'ensenado_por_usuario'); assert.ok(m, 'sin <ensenado_por_usuario>');
  const list = dataJson(m, 'ensenado_por_usuario').dicho_por_el_usuario;
  assert.ok(list.some((x) => /inka kola de 500ml trae 12/.test(x)), 'Inka Kola: ' + JSON.stringify(list));
  assert.ok(list.some((x) => /viene 24 por caja/.test(x)), 'corrección de producto');
  assert.ok(list.some((x) => /distribuidora san juan$/.test(x)), 'proveedor completo: ' + JSON.stringify(list));
  assert.equal(list.length, 3, 'las preguntas no se guardan');
  const tomorrow = await chatOn(store, { text: 'que te enseñé hoy' }, { now: 300000 + 24 * 3600e3 });
  assert.equal(dataMsg(tomorrow.requests[0], 'ensenado_por_usuario'), undefined, 'otro día: lista nueva');
  const est = createMemoryUsageStore();
  await chatOn(est, { text: 'apunta: la caja de inka kola de 500ml trae 12' }, { role: 'empleado:consultas' });
  assert.ok(![...est._map.keys()].some((k) => k.startsWith(A.LESSONS_PREFIX)), 'el empleado no guarda lecciones');
  const eq = await chatOn(store, { text: 'que te enseñé hoy' }, { role: 'empleado:consultas', now: 300000 });
  assert.equal(dataMsg(eq.requests[0], 'ensenado_por_usuario'), undefined, 'el empleado no las recibe');
});

test('lote 3: Admin ve el NOMBRE aunque la pantalla no mande productos (se busca en los datos reales)', async () => {
  const store = createMemoryUsageStore(), requests = [];
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: 'que tal el p9', context: { products: [] } }) }), env, auth, (d, s = 200) => new Response(JSON.stringify(d), { status: s }), {
    store, now: () => 200000, resolveRole: async () => 'owner', audit: async () => {},
    reader: { products: async () => JAIRITO, credits: async () => [], customers: async () => [] },
    fetch: async (_u, init) => { requests.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: 'El producto #p9 tiene 20 unidades.' } }] })); }
  });
  assert.equal((await res.json()).reply, 'El producto Arroz Jairito 1 kg tiene 20 unidades.');
});

// ---------- Lote 4 (a-d) y alfa ----------
// (#960) una consulta simple responde sin segunda llamada: las pruebas que revisan lo que recibe el modelo piden «explícame».
test('a) sin dato: compras vacías -> «No tengo ese dato registrado» + dónde; al modelo va sin_dato; regla SIN DATO (flete en Gastos)', async () => {
  const empty = { products: async () => PRODUCTS, purchases: async () => [], credits: async () => [], customers: async () => [] };
  const q = await runAssistantQuery(empty, { tipo: 'compras_recientes' }, 200000);
  assert.match(q.texto, /^No tengo ese dato registrado/); assert.match(q.texto, /Inventario > Compras > Nueva compra/); assert.match(q.texto, /Compras > Historial/);
  assert.match(q.resumen.sin_dato, /No tengo ese dato registrado/);
  const r = await chat({ text: 'a qué precio compré el aceite? Explícame.' }, { reader: empty, responses: [call('consultar', { tipo: 'compras_recientes' }), { content: 'No tengo ese dato registrado; las compras se registran en Inventario > Compras > Nueva compra.' }] });
  assert.equal(r.status, 200); assert.equal(r.requests.length, 2);
  const tool = r.requests[1].messages.find((m) => m.role === 'tool'); assert.match(tool.content, /No tengo ese dato registrado/);
  for (const role of ['owner', 'empleado:consultas']) {
    const sp = systemPrompt(role);
    assert.match(sp, /SIN DATO \(flete en Gastos[^\n]*«No tengo ese dato registrado» y dónde se registra o se ve; no preguntes de vuelta/);
    assert.match(sp, /PANTALLAS REALES[^\n]*Gastos/, 'Gastos es una pantalla real');
  }
});

test('b) «compré 10 Inka Kola y no aparecen en el stock»: pasos con pantallas reales (Inventario > Compras > Historial, Nueva compra, stock y Kardex)', () => {
  const ui = readFileSync('POS/js/config/pos-purchases-client.js', 'utf8');
  assert.match(ui, /textContent = 'Compras'/); assert.match(ui, /<h3>Nueva compra<\/h3>/); assert.match(ui, />Historial<\/button>/);
  for (const role of ['owner', 'empleado:consultas']) {
    const q = 'Compré 10 Inka Kola y no aparecen en el stock';
    assert.ok(A.STOCK_NOT_UP_RE.test(q)); assert.ok(A.STOCK_NOT_UP_RE.test('registré la compra del arroz pero no sube')); assert.ok(!A.STOCK_NOT_UP_RE.test('cuánto stock de inka kola hay?'));
    assert.ok(!systemPrompt(role, {}, 'hola').includes('COMPRA QUE NO SUBE'), 'solo cuando preguntan eso');
    const line = systemPrompt(role, {}, q).split('\n').find((l) => l.startsWith('COMPRA QUE NO SUBE EL STOCK')); assert.ok(line, role);
    assert.match(line, /Inventario > Compras > Historial: ¿se guardó\?/); assert.match(line, /Nueva compra/); assert.match(line, /stock_producto/); assert.match(line, /Kardex/);
    assert.match(systemPrompt(role), /Kardex valorizado por producto/, 'Kardex es una pantalla real');
  }
  return (async () => { // llega al modelo en el pedido real
    const r = await chat({ text: 'Compré 10 Inka Kola y no aparecen en el stock' });
    assert.match(r.requests[0].messages[0].content, /COMPRA QUE NO SUBE EL STOCK: 1\) Inventario > Compras > Historial/);
  })();
});

test('c) RUC del proveedor: nunca «no puedo compartir»; «No tengo ese dato registrado» y dónde verlo', async () => {
  for (const text of ['cuál es el RUC de mi proveedor Gloria?', 'dame el ruc del proveedor del arroz']) {
    const r = await chat({ text }, { responses: [{ content: 'Lo siento, no puedo compartir el RUC del proveedor.' }] });
    assert.equal(r.body.reply, A.RUC_MISSING_TEXT, text);
    assert.doesNotMatch(r.body.reply, /no puedo compartir/i); assert.match(r.body.reply, /No tengo ese dato registrado[^]*factura o boleta[^]*Inventario > Compras > Historial/);
  }
  const other = await chat({ text: 'cuánto cuesta la leche?' }, { responses: [{ content: 'No puedo darte ese dato ahora.' }] });
  assert.equal(other.body.reply, 'No puedo darte ese dato ahora.', 'sin RUC en la pregunta no se toca');
  assert.match(systemPrompt('owner'), /ni digas «no puedo compartir»/);
});

test('d) montos «que te indiqué» que nunca se dijeron: se quita la referencia; si sí se dijeron, queda', async () => {
  const r = await chat({ text: 'cuánto pago de flete?' }, { responses: [{ content: 'Sobre los S/ 0 que te indiqué, no tengo el flete registrado.' }] });
  assert.equal(r.body.reply, 'Sobre S/ 0, no tengo el flete registrado.');
  assert.doesNotMatch(r.body.reply, /que te indiqu/);
  assert.equal(A.dropUnsaidAmountRefs('Los S/ 15 que te dije siguen igual.', 'El flete fue S/ 15.'), 'Los S/ 15 que te dije siguen igual.');
  assert.equal(A.dropUnsaidAmountRefs('Los S/ 12,50 que te mencioné.', 'Costó S/ 12.50'), 'Los S/ 12,50 que te mencioné.');
  assert.equal(A.dropUnsaidAmountRefs('Los S/ 12,50 que te mencioné.', 'Costó S/ 9'), 'S/ 12,50.');
  assert.match(systemPrompt('owner'), /No cites montos que no dijiste antes/);
});

test('alfa: lo enseñado que se guarda en pos_settings no lleva nombres, DNI ni teléfonos de clientes (solo «cliente #código»)', async () => {
  const store = createMemoryUsageStore();
  const CUST = [{ id: 'c1', nombre: 'Rosa Pérez Quispe' }, { id: 'c2', nombre: 'Juan Díaz' }];
  const run = (text) => assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text }) }), env, auth, (d, s = 200) => new Response(JSON.stringify(d), { status: s }), {
    store, now: () => 200000, resolveRole: async () => 'owner', audit: async () => {},
    reader: { products: async () => PRODUCTS, credits: async () => [], customers: async () => CUST },
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Anotado.' } }] }))
  });
  await run('apunta: rosa perez me debe 3 cajas de leche, su dni es 45678912 y su cel 987654321');
  await run('apunta: la señora Marta Flores lleva 2 inka kola, su teléfono 987 654 321, correo marta@x.com');
  const saved = await store.get(await A.lessonsKey(auth)), raw = JSON.stringify(saved.value);
  assert.equal(saved.value.items.length, 2, raw);
  for (const bad of ['rosa', 'Rosa', 'perez', 'Pérez', 'Marta', 'Flores', '45678912', '8912', '987654321', '987 654 321', 'marta@x.com']) assert.ok(!raw.includes(bad), 'guardado: ' + bad + ' en ' + raw);
  assert.match(saved.value.items[0], /cliente #c1 me debe 3 cajas de leche/); assert.match(saved.value.items[1], /lleva 2 inka kola/);
  assert.equal(A.sanitizeLesson('JUAN DIAZ compra 12 cervezas', CUST), 'cliente #c2 compra 12 cervezas');
  assert.equal(A.sanitizeLesson('mi proveedor del arroz es distribuidora san juan', CUST), 'mi proveedor del arroz es distribuidora san juan');
  // también por la puerta directa
  await A.saveLesson(store, { principalId: 'otro' }, 200000, 'el cliente Pedro Ramos paga los viernes, dni 41234567', CUST);
  const o = JSON.stringify((await store.get(await A.lessonsKey({ principalId: 'otro' }))).value);
  assert.ok(!/Pedro|Ramos|41234567|4567/.test(o), o);
});
