// Auditoría 500 (seguridad y permisos, docs/auditoria-500/seguridad-permisos.csv): arreglos del lado del servidor.
// 1) «limpia el inventario», «pon todo en 0», «vacía la caja»… = pedido de borrar todo: sin tarjetas, solo «Eso necesita la clave del Admin.».
//    Un producto puntual («pon el arroz en 0») o una pregunta («¿qué productos están en 0?») siguen normales.
// 2) PIN / clave / contraseña: el número se tapa en el texto ANTES de ir al modelo, aunque venga varias palabras (o un «?») después.
//    Precios, cantidades y códigos de producto en frases normales no se tocan.
// 3) «avisos» (Avisos y confirmaciones): solo el Admin. Nivel 3 + «costos y cambios»: 403 sin leer la base, en chat y en confirm.
// 4) Varias tarjetas de cambio en una respuesta: el texto dice cuántos productos y que cada uno se aplica aparte (lo pone el servidor).
// Datos inventados; el modelo siempre simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { CONFIG_CARD, CONFIG_KEY_NAMES } from '../../tools/cloudflare-lab/src/pos-assistant-config-route.js';
import { COSTS_ROLE } from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';

const { assistantChatRoute, assistantConfirmRoute, createMemoryUsageStore, isResetRequest, parseChatBody, toolsForRole, toProposal, employeeToolGuard, buildDeepSeekRequest, sanitizeContext } = A;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'seguridad-500-secret-1234567890', OHMYAGENT_API_KEY: 'test-only' };
const OWNER = { principalId: 'session:owner-s500', posRole: 'owner' };
const EMP = { principalId: 'session:emp-s500', posRole: 'empleado' };
const PRODUCTS = [
  { id: 'p1', nombre: 'Arroz Costeño 1 kg', controla: true, stock: 30, min: 5, precio: 4.2, costo: 3.5 },
  { id: 'p2', nombre: 'Azúcar Rubia 1 kg', controla: true, stock: 10, min: 2, precio: 4.5, costo: 3.8 },
  { id: 'p3', nombre: 'Aceite Primor 1 L', controla: true, stock: 8, min: 2, precio: 11.5, costo: 9.8 }
];
const reader = { products: async () => PRODUCTS, credits: async () => [], customers: async () => [] };
async function chat(body, { role = 'owner', auth = role === 'owner' ? OWNER : EMP, responses = [{ content: 'Respuesta de prueba' }], db } = {}) {
  const requests = [], audit = [];
  const deps = { store: createMemoryUsageStore(), now: () => 200000, resolveRole: async () => role, audit: async (_d, r) => { audit.push(...r); return r.length; }, reader, mockChunkMs: 0, readBusinessName: async () => 'Negocio',
    ...(db ? { db } : {}),
    fetch: async (_u, init) => { requests.push(JSON.parse(init.body)); const m = responses[Math.min(requests.length - 1, responses.length - 1)]; return json({ choices: [{ message: m }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); } };
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ context: { products: PRODUCTS.map(({ costo, ...x }) => x) }, ...body }) }), env, auth, json, deps);
  const raw = await res.text(); let parsed = null; try { parsed = JSON.parse(raw); } catch { parsed = null; }
  return { status: res.status, body: parsed, raw, requests, audit, deps };
}
const calls = (...list) => ({ content: '', tool_calls: list.map(([name, args], i) => ({ id: 'c' + i + '-' + name, type: 'function', function: { name, arguments: JSON.stringify(args) } })) });
const userTexts = (req) => req.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

// ---------- 1) borrar todo con otras palabras ----------
const RESET_YES = [
  'limpia el inventario', 'limpiame todo el inventario', 'Limpia el stock', 'limpia todos los productos', 'linpia el inbentario',
  'vacía el inventario', 'vacia la caja', 'vaciar todo el stock', 'baciar el inventario', 'vacía todos los productos',
  'pon todo en 0', 'pon todo en cero', 'ponme todo el stock en 0', 'pon todo el inventario en cero', 'pon en 0 todo el inventario',
  'pon el inventario en 0', 'pon el stock en cero', 'pon todos los productos en 0', 'pon la caja en 0', 'poner todo a cero',
  'ponme la caja en 0', 'deja todo en 0', 'deja todo en cero', 'déjame todo el inventario en 0', 'deja el stock en cero', 'deja la caja en 0', 'dejar todos los productos en cero',
  'borra todo el inventario', 'borra el inventario', 'borra el stock', 'borra todos los productos', 'borra la caja', 'elimina todo el stock',
  'resetea el inventario', 'reinicia el stock', 'reinicia todos los productos', 'setea todo en 0', 'pon todo el stock a 0 porfa'
];
const RESET_NO = [
  'pon el arroz en 0', 'pon en 0 el stock del arroz', 'deja el arroz en cero', '¿qué productos están en 0?', 'que productos estan en cero',
  'el stock está en 0', 'cuánto hay en caja', 'cierra la caja', 'borra el producto arroz', 'borra la venta de ayer', 'reinicia la caja',
  'todo bien, gracias', 'pon el stock del arroz en 0', 'deja el stock de azúcar en cero', '¿cómo limpio la pantalla?', 'limpia el filtro de búsqueda',
  'pon el precio del arroz en 4.50', '¿por qué el inventario está en 0?', 'muéstrame los productos con stock en 0', 'abre la caja con 0 soles'
];
test('1) «limpia el inventario», «pon todo en 0», «vacía la caja»…: pedido de borrar todo (con faltas y sin tildes)', () => {
  for (const t of RESET_YES) assert.equal(isResetRequest(t), true, t);
  for (const t of ['resetea el sistema', 'borra todo', 'Borra todos los registros', 'reinicia todo desde cero', 'limpia la base de datos']) assert.equal(isResetRequest(t), true, t);
});
test('1) negativos: un producto puntual o una pregunta no son «borrar todo»', () => {
  for (const t of RESET_NO) assert.equal(isResetRequest(t), false, t);
});
test('1) ruta: «pon todo en 0» con tarjetas de ajuste del modelo -> sin tarjetas, solo «Eso necesita la clave del Admin.»', async () => {
  for (const role of ['owner', COSTS_ROLE, 'empleado:consultas']) {
    for (const text of ['pon todo en 0', 'limpia el inventario', 'vacía la caja', 'ponme la caja en 0']) {
      const r = await chat({ text }, { role, responses: [calls(['proponer_ajuste_stock', { product_id: 'p1', tipo: 'salida', cantidad: 30, motivo: 'conteo' }], ['proponer_ajuste_stock', { product_id: 'p2', tipo: 'salida', cantidad: 10, motivo: 'conteo' }]), { content: 'Listo.' }] });
      assert.equal(r.status, 200, role + ' ' + text + ' ' + r.raw);
      assert.equal(r.body.proposals.length, 0, role + ' ' + text);
      assert.match(r.body.reply, /^Eso necesita la clave del Admin\./, role + ' ' + text);
      assert.doesNotMatch(r.body.reply, /Confirmar|Aplicar|¿/);
    }
  }
  // un producto puntual sigue dando su tarjeta
  const one = await chat({ text: 'pon el arroz en 0' }, { responses: [calls(['proponer_ajuste_stock', { product_id: 'p1', tipo: 'salida', cantidad: 30, motivo: 'conteo' }])] });
  assert.equal(one.status, 200, one.raw); assert.equal(one.body.proposals.length, 1); assert.doesNotMatch(one.body.reply, /clave del Admin/);
});

// ---------- 2) PIN / clave / contraseña antes del modelo ----------
const PIN_TEXTS = [
  ['¿cuál era el pin de la caja? creo q era 4321', '4321'],
  ['el pin… creo q era 4321', '4321'],
  ['mi clave es como 1234 creo', '1234'],
  ['la clave del wifi... creo que era 55667788', '55667788'],
  ['olvidé mi contraseña! era algo como 9876', '9876'],
  ['¿la contrasena? creo que es 2468', '2468'],
  ['el password del admin? ya me acordé: 135790', '135790'],
  ['mi clabe es 7777', '7777'],
  ['PIN: 0042', '0042'],
  ['la contraseña era sol2024', 'sol2024'],
  ['la clave de la caja es 4321 y el arroz cuesta 4.50', '4321']
];
const SAFE_TEXTS = [
  ['cambia el precio del arroz a 4.50', ['4.50']],
  ['llegaron 1200 unidades del código 77501234', ['1200', '77501234']],
  ['el producto 00003 cuesta 12.34', ['00003', '12.34']],
  ['producto clave S/ 4.50', ['4.50']],
  ['vendí 2500 soles hoy', ['2500']]
];
test('2) maskCredentialValues: tapa el número aunque venga varias palabras o un «?» después de pin/clave/contraseña', () => {
  assert.equal(typeof A.maskCredentialValues, 'function');
  for (const [t, secret] of PIN_TEXTS) { const m = A.maskCredentialValues(t); assert.ok(!m.includes(secret), t + ' -> ' + m); assert.ok(!m.includes(secret.slice(-4)), t + ' -> ' + m); }
  assert.match(A.maskCredentialValues('la clave de la caja es 4321 y el arroz cuesta 4.50'), /4\.50/);
  for (const [t, keep] of SAFE_TEXTS) { const m = A.maskCredentialValues(t); assert.equal(m, t, t); for (const k of keep) assert.ok(m.includes(k), t); }
});
test('2) parseChatBody y ruta: el texto y el historial del usuario llegan al modelo sin el PIN; precios y códigos intactos', async () => {
  for (const role of ['owner', COSTS_ROLE, 'empleado:consultas']) {
    for (const [t, secret] of PIN_TEXTS) {
      const p = parseChatBody({ text: t }, role); assert.ok(!p.text.includes(secret), role + ' ' + t + ' -> ' + p.text);
      const h = parseChatBody({ text: 'hola', history: [{ role: 'user', content: t }, { role: 'assistant', content: 'Ok.' }] }, role);
      assert.ok(!JSON.stringify(h.history.map((m) => m.content)).includes(secret), role + ' historial ' + t);
    }
    // (el empleado ya tapaba números de 8 cifras como un DNI: eso no es de este arreglo)
    for (const [t, keep] of SAFE_TEXTS) { const p = parseChatBody({ text: t }, role); for (const k of keep.filter((x) => role === 'owner' || x.length !== 8)) assert.ok(p.text.includes(k), role + ' ' + t + ' -> ' + p.text); }
    const r = await chat({ text: '¿cuál era el pin de la caja? creo q era 4321' }, { role });
    assert.equal(r.status, 200, r.raw); assert.ok(r.requests.length >= 1);
    for (const req of r.requests) assert.doesNotMatch(JSON.stringify(req.messages), /4321/, role);
    assert.doesNotMatch(r.raw, /4321/, role + ': ni en turns ni en la respuesta');
  }
  const ok = await chat({ text: 'cambia el precio del arroz a 4.50' });
  assert.match(userTexts(ok.requests[0]), /4\.50/);
});

// ---------- 3) «avisos»: solo Admin ----------
function memDb() {
  const rows = new Map(Object.entries({
    'pos.business': { nombre: 'Negocio de prueba', ruc: '', direccion: 'Jr. Inventado 1', telefono: '' },
    'pos.ticket': { ancho: '80mm', pie: 'Gracias', showLogo: true, showIGV: false, showPayment: true },
    'pos.flags': { alertsEnabled: true, stockMin: 5 }
  }).map(([k, v]) => [k, { value_json: JSON.stringify(v), revision: 3, updated_by: 'session:owner-s500' }]));
  const reads = [], writes = [];
  return { rows, reads, writes, prepare(sql) {
    return { bind: (...a) => ({
      first: async () => { reads.push(a[0]); if (!/^SELECT/i.test(sql)) return null; const r = rows.get(a[0]); return r ? { ...r } : null; },
      all: async () => { reads.push(sql); return { results: [] }; },
      run: async () => {
        if (/^UPDATE pos_settings SET value_json/i.test(sql)) { const r = rows.get(a[0]); if (!r || r.revision !== a[4]) return { meta: { changes: 0 } };
          rows.set(a[0], { value_json: a[1], revision: r.revision + 1, updated_by: a[3] }); writes.push(a[0]); return { meta: { changes: 1 } }; }
        writes.push(sql); return { meta: { changes: 1 } };
      } }) };
  } };
}
const avisosCall = calls(['configurar_app', { ajuste: 'avisos', valor: false }]);
async function confirm(card, role, auth, db) {
  const { confirm_token, ...proposal } = card;
  const r = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token: confirm_token, proposal }) }), env, auth,
    json, { store: createMemoryUsageStore(), db, resolveRole: async () => role, audit: async () => 0, now: () => 200000 });
  return { status: r.status, body: await r.json() };
}
test('3) nivel 3 + «costos y cambios» NO cambia «avisos»: 403 sin leer la base; sí negocio/ticket', async () => {
  const db = memDb();
  const r = await chat({ text: 'Desactiva los avisos y confirmaciones' }, { role: COSTS_ROLE, db, responses: [avisosCall, { content: 'Listo.' }] });
  assert.equal(r.status, 403, r.raw); assert.equal(r.body.error, 'config_forbidden'); assert.match(r.body.message, /solo el Admin/);
  assert.equal(db.reads.length, 0, 'sin leer la base'); assert.equal(r.requests.length, 1, 'sin segunda llamada');
  assert.equal(toProposal({ name: 'configurar_app', arguments: JSON.stringify({ ajuste: 'avisos', valor: false }) }, COSTS_ROLE, { products: [] }, 1).dropped, 'config_admin_only');
  assert.equal(employeeToolGuard(COSTS_ROLE)({ name: 'configurar_app', arguments: JSON.stringify({ ajuste: 'avisos', valor: false }) }), 'config_admin_only');
  assert.ok(!employeeToolGuard(COSTS_ROLE)({ name: 'configurar_app', arguments: JSON.stringify({ ajuste: 'ticket_pie', valor: 'x' }) }));
  // el nivel 3 no ve «avisos» ni en la herramienta ni en el catálogo
  const tool = toolsForRole(COSTS_ROLE).find((t) => t.function.name === 'configurar_app');
  assert.ok(!tool.function.parameters.properties.ajuste.enum.includes('avisos'));
  assert.deepEqual([...tool.function.parameters.properties.ajuste.enum], CONFIG_KEY_NAMES.filter((k) => k !== 'avisos'));
  const req = buildDeepSeekRequest({ role: COSTS_ROLE, ctx: sanitizeContext({ products: [] }, COSTS_ROLE), history: [], text: 'Cambia los avisos del ticket' });
  assert.doesNotMatch(JSON.stringify(req.messages), /"clave":"avisos"/);
  // negocio/ticket siguen
  const db2 = memDb();
  const ok = await chat({ text: 'Cambia el pie del ticket' }, { role: COSTS_ROLE, db: db2, responses: [calls(['configurar_app', { ajuste: 'ticket_pie', valor: 'Vuelva pronto' }]), { content: 'Listo.' }] });
  assert.equal(ok.status, 200, ok.raw); assert.ok(ok.body.proposals.some((p) => p.type === CONFIG_CARD && p.ajuste === 'ticket_pie'));
});
test('3) tarjeta «avisos» firmada para el Admin: el nivel 3 recibe 403 al confirmar, sin leer ni escribir la base; el Admin sí la aplica', async () => {
  const db = memDb();
  const r = await chat({ text: 'Desactiva los avisos y confirmaciones' }, { role: 'owner', auth: EMP, db, responses: [avisosCall, { content: 'Listo.' }] });
  assert.equal(r.status, 200, r.raw); const card = r.body.proposals.find((p) => p.type === CONFIG_CARD && p.ajuste === 'avisos'); assert.ok(card?.confirm_token, r.raw);
  db.reads.length = 0;
  const c = await confirm(card, COSTS_ROLE, EMP, db); assert.equal(c.status, 403, JSON.stringify(c.body));
  // tarjeta «avisos» firmada para el nivel 3 (p. ej. emitida antes de este arreglo, aún dentro de sus 5 minutos): 403 config_forbidden
  const { confirm_token: _t, ...bare } = card;
  const old = { ...bare, confirm_token: await A.issueConfirmToken(bare, COSTS_ROLE, EMP, env.ASSISTANT_CONFIRM_SECRET, 200000) };
  const c2 = await confirm(old, COSTS_ROLE, EMP, db); assert.equal(c2.status, 403, JSON.stringify(c2.body)); assert.equal(c2.body.error, 'config_forbidden'); assert.match(c2.body.message, /solo el Admin/);
  assert.equal(db.reads.length, 0); assert.equal(db.writes.length, 0); assert.equal(JSON.parse(db.rows.get('pos.flags').value_json).alertsEnabled, true);
  const o = await confirm(card, 'owner', EMP, db); assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.equal(JSON.parse(db.rows.get('pos.flags').value_json).alertsEnabled, false);
  // y por si acaso: applyConfigCard tampoco lo guarda para quien no es Admin
  const { applyConfigCard } = await import('../../tools/cloudflare-lab/src/pos-assistant-config-route.js');
  const db3 = memDb(); const x = await applyConfigCard(db3, EMP, COSTS_ROLE, { ajuste: 'avisos', destino: 'servidor', valor: false }, 'op1', async () => 0);
  assert.equal(x.status, 403); assert.equal(db3.reads.length, 0); assert.equal(db3.writes.length, 0);
});

// ---------- 4) varias tarjetas de cambio ----------
test('4) varias tarjetas de cambio: el texto dice cuántos productos y que cada uno se aplica aparte (lo pone el servidor)', async () => {
  const three = calls(['proponer_cambio_precio', { product_id: 'p1', precio_nuevo: 4.5 }], ['proponer_cambio_precio', { product_id: 'p2', precio_nuevo: 4.8 }], ['proponer_cambio_precio', { product_id: 'p3', precio_nuevo: 12 }]);
  for (const responses of [[three], [{ ...three, content: 'Te preparé los cambios de precio.' }]]) {
    const r = await chat({ text: 'sube el arroz a 4.50, el azúcar a 4.80 y el aceite a 12' }, { responses });
    assert.equal(r.status, 200, r.raw); assert.equal(r.body.proposals.filter((p) => p.needsConfirm).length, 3, r.raw);
    assert.match(r.body.reply, /Son 3 productos; cada uno se aplica aparte con su «Aplicar»\./, r.body.reply);
    assert.equal(r.body.turns?.[1]?.content ?? r.body.reply, r.body.reply);
  }
  const mixed = await chat({ text: 'sube el arroz a 4.50 y saca 2 de azúcar' }, { responses: [calls(['proponer_cambio_precio', { product_id: 'p1', precio_nuevo: 4.5 }], ['proponer_ajuste_stock', { product_id: 'p2', tipo: 'salida', cantidad: 2, motivo: 'merma' }])] });
  assert.equal(mixed.status, 200, mixed.raw); assert.match(mixed.body.reply, /Son 2 productos; cada uno se aplica aparte/);
  // una sola tarjeta o solo consultas: sin la frase
  const one = await chat({ text: 'sube el arroz a 4.50' }, { responses: [calls(['proponer_cambio_precio', { product_id: 'p1', precio_nuevo: 4.5 }])] });
  assert.equal(one.body.proposals.length, 1); assert.doesNotMatch(one.body.reply, /Son \d+ productos/);
  const info = await chat({ text: '¿cómo cambio un precio?' }, { responses: [calls(['explicar_pasos', { tema: 'Precio', pasos: ['Entra a Inventario', 'Edita el producto'] }])] });
  assert.doesNotMatch(info.body.reply, /Son \d+ productos/);
  // si el modelo ya lo dijo con el mismo número, no se repite
  const said = await chat({ text: 'sube los tres' }, { responses: [{ ...three, content: 'Son 3 productos; cada uno se aplica aparte con su «Aplicar».' }] });
  assert.equal((said.body.reply.match(/Son 3 productos/g) || []).length, 1, said.body.reply);
});

// ---------- 5) nombres de clientes en plural / diminutivo (CLI-030: «hay dos rosas» llegó al modelo) ----------
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../../POS/js/modules/asistente/asistente-core.js');
const CLI5 = [{ id: 'C-0001', nombre: 'Rosa Quispe Mamani' }, { id: 'C-0002', nombre: 'Rosa Huamán' }, { id: 'C-0003', nombre: 'Juan Pérez' },
  { id: 'C-0004', nombre: 'Pilar' }, { id: 'C-0005', nombre: 'Flor Ramos' }, { id: 'C-0006', nombre: 'Luz Torres' }, { id: 'C-0007', nombre: 'Marcos Díaz' }];
const PROD5 = [{ id: 'P1', nombre: 'Leche Gloria 400g' }, { id: 'P2', nombre: 'Gaseosa Pilares 500ml' }];
test('5) aparato: plural y diminutivo de un nombre de cliente también se tapan antes de salir (CLI-030)', () => {
  const m = (t) => C.maskCustomers(t, CLI5, PROD5).text;
  assert.equal(m('la sra rosa le debe a la sra rosa? jaja hay dos rosas'), 'la sra cliente #C-0001 o cliente #C-0002 le debe a la sra cliente #C-0001 o cliente #C-0002? jaja hay dos cliente #C-0001 o cliente #C-0002');
  for (const t of ['hay dos Rosas', 'las ROSAS pagaron', 'Rosita pagó 10', 'las rositas', 'los Quispes vinieron', 'los Pérez y los Perezes', 'Juancito debe'])
    assert.ok(!/ros[ai]|quisp|p[eé]rez|pilar|juanc/i.test(m(t)), t + ' -> ' + m(t));
  assert.match(m('hay dos rosas'), /cliente #C-0001 o cliente #C-0002$/);
  assert.equal(C.maskCustomers('las dos Pilares vinieron', CLI5, []).text, 'las dos cliente #C-0004 vinieron', 'sin producto «Pilares»: el plural es el cliente');
});
test('5) aparato: palabras comunes que solo se parecen a un nombre NO se tapan', () => {
  const m = (t) => C.maskCustomers(t, CLI5, PROD5).text;
  for (const t of ['vendemos juanes los domingos', 'se quemaron las luces', 'compré flores para la tienda', 'quedan 20 soles', 'precio de Gaseosa Pilares',
    'Rosalinda compró arroz', 'el rosado no se vende', 'marco de la puerta'])
    assert.equal(m(t), t, t);
});

// ---------- 8) filtro final: DNI y nombres tras «señora…» (todos), costos para quien no ve datos del dueño (también en partes) ----------
const { maskReplyPeople, createTextEmitter, redactFor, capReply, ownerHold, finalReplyFilter, REPLY_MAX } = A;
const PEOPLE_YES = [
  ['La señora Rosa Quispe tiene DNI 45678912 y debe S/ 20.', 'La señora [nombre oculto] tiene DNI ****8912 y debe S/ 20.'],
  ['la sra rosa debe S/ 12.50', 'la sra [nombre oculto] debe S/ 12.50'],
  ['La Sra. Rosa Quispe Mamani pagó', 'La Sra. [nombre oculto] pagó'],
  ['su dni es 45678912', 'su dni es ****8912'], ['DNI: 45678912', 'DNI: ****8912'], ['documento de identidad 45678912', 'documento de identidad ****8912'],
  ['Don Pepe vino', 'Don [nombre oculto] vino'], ['el señor Juan Pérez llamó', 'el señor [nombre oculto] llamó'], ['doña Carmen fió', 'doña [nombre oculto] fió']
];
const PEOPLE_NO = ['la señora cliente #C-0001 debe S/ 20', 'cliente #C-0001 y cliente #C-0002 deben', 'Código 45678912 del producto', 'boleta B001-45678912',
  'el señor de la tienda', 'tiene un don para vender', 'documento B001-00012345', 'Señores, buen día', 'Arroz S/ 4.50 x 12', 'vendiste 45678912 soles'];
test('8) filtro final: DNI escrito por el modelo y nombre tras «señora/sr./don…» se tapan; «cliente #C-000N» y códigos no', () => {
  for (const [t, want] of PEOPLE_YES) for (const role of ['owner', 'empleado:consultas']) {
    const got = maskReplyPeople(redactFor(role)(t)); assert.doesNotMatch(got, /rosa|quispe|pepe|juan|carmen|45678912/i, role + ' ' + t + ' -> ' + got);
    if (role === 'owner') assert.equal(got, want, t); }
  for (const t of PEOPLE_NO) assert.equal(maskReplyPeople(redactFor('owner')(t)), redactFor('owner')(t), t);
});
const COST_YES = ['El arroz te cuesta S/ 3.18 y lo vendes a S/ 4.50', 'Te cuesta 3.18 soles', 'ganas S/ 1.32 por unidad', 'nos cuesta S/ 9.80 la caja', 'el costo es S/ 3.18'];
const COST_NO = ['te sale a S/ 4.50', 'el arroz cuesta S/ 4.50', 'el precio es S/ 4.50', 'al cliente le cuesta S/ 4.50', 'lo vendes a S/ 4.50', 'Arroz Costeño 1 kg: S/ 4.20'];
const empWhole = (t) => maskReplyPeople(A.redactOwnerData(A.redactEmployeeText(t)));
test('8) costos: «te cuesta S/ 3.18», «ganas…» se tapan para quien no ve datos del dueño; los precios de venta no', () => {
  for (const t of COST_YES) { const g = empWhole(t); assert.doesNotMatch(g, /3\.18|1\.32|9\.80/, t + ' -> ' + g); assert.match(g, /\[dato del Admin\]/, t); }
  assert.match(empWhole(COST_YES[0]), /S\/ 4\.50/, 'el precio de venta sigue');
  for (const t of COST_NO) assert.equal(empWhole(t), A.redactEmployeeText(t), t);
  for (const t of COST_YES) assert.equal(maskReplyPeople(redactFor('owner')(t)), redactFor('owner')(t), 'el Admin ve su costo: ' + t);
});
const mkEmit = (role, noChange) => { const o = { text: '', ev: [] }; const e = createTextEmitter((d) => { o.ev.push(d); if (d.t) o.text += d.t; }, REPLY_MAX, redactFor(role), role === 'owner' ? null : ownerHold); return [e, o]; };
test('8) en partes (cualquier corte): lo pintado nunca muestra el nombre, el DNI ni el costo, y al cerrar es igual al filtro del texto entero', () => {
  const pre = 'Buenos días, le cuento cómo va la tienda hoy con las ventas del local. ';
  const texts = [pre + 'La señora Rosa Quispe tiene DNI 45678912 y debe S/ 20.', pre + 'la sra rosa debe, y su dni es 45678912.', pre + 'El arroz te cuesta S/ 3.18 y lo vendes a S/ 4.50.',
    pre + 'Don Pepe vino; ganas S/ 1.32 por unidad.', pre + 'la señora cliente #C-0001 debe S/ 20.'];
  for (const role of ['owner', 'empleado:consultas']) for (const t of texts) for (const ch of [1, 2, 3, 5, 7, 64]) {
    const [e, o] = mkEmit(role); let live = '';
    for (let k = 0; k < t.length; k += ch) { e.push(t.slice(k, k + ch)); live = o.text;
      assert.doesNotMatch(live, /rosa|quispe|pepe|45678912/i, role + ' ' + ch + ': ' + live); if (role !== 'owner') assert.doesNotMatch(live, /3\.18|1\.32/, role + ' ' + ch + ': ' + live); }
    e.flush(); const whole = capReply(role === 'owner' ? maskReplyPeople(redactFor(role)(t)) : empWhole(t));
    assert.equal(o.text, whole, role + ' de a ' + ch); assert.ok(!o.ev.some((d) => d.reset), role + ' sin reset');
    assert.ok(o.text.startsWith(pre.slice(0, 20)), 'lo de antes sale');
  }
});
test('8) en partes con «pulsa Confirmar» retenido (patrón #962): flush({ noChange }) aplica el mismo filtro final', () => {
  for (const role of ['owner', 'empleado:consultas']) for (const noChange of [true, false]) {
    const t = 'La señora Rosa debe S/ 20; DNI 45678912. Pulsa Confirmar para guardar.'; const [e, o] = mkEmit(role);
    for (let k = 0; k < t.length; k += 3) e.push(t.slice(k, k + 3));
    assert.doesNotMatch(o.text, /rosa|45678912|confirmar/i, role); e.flush({ noChange });
    const base = role === 'owner' ? maskReplyPeople(redactFor(role)(t)) : empWhole(t);
    assert.equal(o.text, capReply(finalReplyFilter(base, { change: !noChange })), role + ' ' + noChange); assert.doesNotMatch(o.text, /rosa|45678912/i);
  }
});
test('8) ruta: la respuesta del modelo con «señora Rosa» y DNI sale tapada para el Admin; el costo tapado para nivel 1, visible para costos', async () => {
  const o = await chat({ text: '¿quién debe?' }, { responses: [{ content: 'La señora Rosa Quispe (DNI 45678912) debe S/ 20; cliente #C-0001 también.' }] });
  assert.equal(o.status, 200, o.raw); assert.equal(o.body.reply, 'La señora [nombre oculto] (DNI ****8912) debe S/ 20; cliente #C-0001 también.');
  const e1 = await chat({ text: 'arroz' }, { role: 'empleado:consultas', responses: [{ content: 'El arroz te cuesta S/ 3.18 y lo vendes a S/ 4.50.' }] });
  assert.equal(e1.status, 200, e1.raw); assert.doesNotMatch(e1.body.reply, /3\.18/); assert.match(e1.body.reply, /S\/ 4\.50/);
  const c = await chat({ text: 'arroz' }, { role: COSTS_ROLE, responses: [{ content: 'El arroz te cuesta S/ 3.18 y lo vendes a S/ 4.50.' }] });
  assert.equal(c.status, 200, c.raw); assert.match(c.body.reply, /S\/ 3\.18/, 'nivel 3 con costos ve el costo');
});

// ---------- OCR-023: «CHUPETIN PIN POP» salía «PIN [oculto]». «pin» + palabra de solo letras es nombre; la clave es un número ----------
test('OCR-023) «PIN» dentro de un nombre de producto no se tapa (entrada al modelo, respuesta Admin/empleado, celular); el PIN numérico sí', () => {
  const C5 = C;
  const NAMES = ['CHUPETIN PIN POP', 'Chupetín Pin Pop x 24', 'CHUPETIN PIN POP S/ 0.50', 'pin pon', 'Pin Pon de colores 12 unid', 'pinza', 'pinza para ropa x 12', 'Pinzas Tramontina', 'Pin Pop fresa 100 unid'];
  const all = (t) => [A.redactText(t), A.redactModelOwner(t), A.redactFor('owner')(t), A.redactFor('empleado:consultas')(t), C5.redactText(t), A.maskCredentialValues(t)];
  for (const t of NAMES) for (const got of all(t)) assert.equal(got, t, t);
  const table = '| Producto | Cant | Importe |\n|---|---|---|\n| CHUPETIN PIN POP | 24 | S/ 12.00 |\n| Pinza ropa | 12 | S/ 6.00 |';
  assert.equal(A.redactFor('owner')(table), table);
  for (const t of ['el PIN es 4321', 'PIN 4321', 'pin: 123456', 'pin de la caja 4321', 'PIN POP 4321', 'pin caja 98765', 'mi pin es tortuga', 'pin -> tortuga'])
    assert.match(A.redactText(t), /\[oculto\]/, t);
  for (const t of ['el PIN es 4321', 'PIN 4321', 'pin: 123456']) assert.match(C5.redactText(t), /\[oculto\]/, 'celular: ' + t);
  // en partes también: el nombre sale igual y el PIN numérico tapado
  for (const t of ['Compré CHUPETIN PIN POP a S/ 0.50 y pin pon x 12.', 'Chupetín Pin Pop; y el PIN es 4321.']) for (const role of ['owner', 'empleado:consultas']) for (const ch of [1, 3, 7]) {
    let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, REPLY_MAX, redactFor(role), role === 'owner' ? null : ownerHold);
    for (let k = 0; k < t.length; k += ch) e.push(t.slice(k, k + ch)); e.flush();
    assert.equal(o, capReply(redactFor(role)(t)), role + ' ' + ch); assert.match(o, /Pin Pop|PIN POP/); assert.doesNotMatch(o, /4321/);
  }
});
