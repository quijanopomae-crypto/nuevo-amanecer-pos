// Auditoría 500 de clientes y créditos, filas restantes (CLI-016, CLI-022, CLI-025, CLI-029):
// - CLI-016 «No encontré deudas de cliente #9999» no decía si el cliente NO DEBE o si ese código NO EXISTE / no hay datos. Ahora
//   deuda_cliente separa: existe y no debe («no tiene deudas pendientes»), el código no está en Clientes («No existe cliente #X en
//   Clientes») y no se pudo revisar la lista («No tengo ese dato»). Nunca un monto inventado.
// - CLI-022 el empleado preguntó «quienes estan atrasados»: no había 403 y el modelo cortaba la respuesta a media frase. Ahora es el
//   mismo 403 query_admin_only de las demás consultas solo del Admin, ANTES del modelo, sin montos.
// - CLI-025 dos clientes con el mismo nombre (el aparato manda «cliente #1 o cliente #13»): el asistente pregunta cuál con los
//   códigos, nunca elige uno por su cuenta, y da los pasos a mano para revisar un pago que no aparece.
// - CLI-029 el proveedor rechazó el mensaje por su filtro de contenido (content_filter) y el aparato veía un 502. Ahora es una
//   respuesta normal (200) que pide escribirlo de otra forma.
// Nunca van nombres de clientes a la IA (solo C-000N). DeepSeek siempre simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mockAssistantReply } from '../../tools/cloudflare-lab/src/pos-assistant-mock.js';
import { assistantChatRoute, createMemoryUsageStore, systemPrompt, employeeQueryDenied, clientAlternatives } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader, runAssistantQuery } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const NOW = Date.parse('2026-10-23T20:00:00.000Z');
const NAMES = /Rosa|Quispe|Mamani|Carmen|Flores/i;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const call = (name, args, id = 'call_1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const msg = (m, fin) => json({ choices: [{ message: m, ...(fin ? { finish_reason: fin } : {}) }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
const enc = new TextEncoder();
const sseResp = (chunks) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const sseMsg = (m) => sseResp([...(m.content ? ['data: ' + JSON.stringify({ choices: [{ delta: { content: m.content } }] }) + '\n\n'] : []),
  ...(m.tool_calls || []).map((c, index) => 'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, ...c }] } }] }) + '\n\n'),
  'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: m.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\n', 'data: [DONE]\n\n']);
const sseEvents = (text) => text.split('\n\n').filter(Boolean).map((b) => { const e = /^event: (\w+)/m.exec(b)?.[1]; const d = /^data: (.*)$/m.exec(b)?.[1]; return { e, d: d ? JSON.parse(d) : null }; });
const DATA = {
  products: [{ id: 'P1', nombre: 'Arroz 1 kg', precio: 4, costo: 3, stock: 50, min: 5, controla: true }],
  customers: [{ id: '1', nombre: 'Rosa Quispe' }, { id: '13', nombre: 'Rosa Mamani' }, { id: '3', nombre: 'Carmen Flores' }, { id: '7', nombre: 'Carmen Quispe' }],
  credits: [{ cliente: '1', saldo: 120, vence: '2026-10-10' }, { cliente: '13', saldo: 50, vence: '2026-11-05' }, { cliente: '3', saldo: 30, vence: '2026-09-01' }]
};
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, OHMYAGENT_API_KEY: 'k-ohmy', ROUTEWAY_API_KEY: 'k-rw' };
const q = (args, reader = memoryReader(DATA)) => runAssistantQuery(reader, args, NOW);
// Códigos neutros que la IA vio en el último mensaje del usuario (en orden).
const neutralCodes = (body) => { const m = JSON.parse(body).messages.filter((x) => x.role === 'user').pop(); return [...String(m.content).matchAll(/#(C-\d{4})/g)].map((x) => x[1]); };

async function route(text, responder, { role = 'owner', stream = false, data = DATA } = {}) {
  const cap = [];
  // El responder devuelve un Response o el mensaje del modelo ({ content, tool_calls }); en modo stream el mensaje va en trozos SSE.
  const f = async (_url, init) => { cap.push(String(init.body)); const out = await responder(cap.length - 1, String(init.body));
    return out instanceof Response ? out : JSON.parse(String(init.body)).stream ? sseMsg(out) : msg(out); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { products: data.products }, text, ...(stream ? { stream: true } : {}) }) }),
    ENV, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, json,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: f, reader: memoryReader(data), audit: async () => {}, mockChunkMs: 0, now: () => NOW });
  return { r, cap };
}
const noNames = (cap) => { for (const b of cap) assert.ok(!NAMES.test(b), 'llegó un nombre a la IA: ' + b.slice(0, 300)); };

// ---------- CLI-016: «no debe» vs «no existe / sin datos» ----------
test('CLI-016 cliente que existe y no debe: «no tiene deudas pendientes» (sin cambio)', async () => {
  const r = await q({ tipo: 'deuda_cliente', cliente_id: '7' });
  assert.match(r.texto, /^cliente #7 no tiene deudas pendientes\./);
  assert.ok(!/No encontré deudas/.test(r.texto));
});

test('CLI-016 código que no está en Clientes: dice que NO EXISTE ese cliente, no que «no encontró deudas»; sin montos', async () => {
  const r = await q({ tipo: 'deuda_cliente', cliente_id: '9999' });
  assert.match(r.texto, /No existe cliente #9999 en Clientes/);
  assert.match(r.texto, /Revise el código/);
  assert.ok(!/No encontré deudas|no tiene deudas|S\/\s*\d/.test(r.texto), r.texto);
  assert.equal(r.resumen.cliente_encontrado, false);
  assert.deepEqual(r.filas, []);
});

test('CLI-016 sin poder leer Clientes (falla, no hay lector o la lista vino cortada): «No tengo ese dato», nunca «no debe»', async () => {
  const base = memoryReader(DATA);
  const sinLista = { ...base, customers: undefined };
  const falla = { ...base, customers: async () => { throw new Error('d1 caído'); } };
  const cortada = { ...base, customers: async () => Object.assign([{ id: '1', nombre: 'x' }], { truncated: true }) };
  for (const rd of [sinLista, falla, cortada]) {
    const r = await q({ tipo: 'deuda_cliente', cliente_id: '9999' }, rd);
    assert.match(r.texto, /^No tengo ese dato/, r.texto);
    assert.match(r.texto, /cliente #9999/);
    assert.ok(!/no tiene deudas|No existe|S\/\s*\d/.test(r.texto), r.texto);
    assert.equal(r.resumen.cliente_encontrado, null);
  }
});

test('CLI-016 en el chat: la respuesta dice que el código no existe (no «No encontré deudas»)', async () => {
  const { r, cap } = await route('¿cuánto debe el cliente #9999?', (i, body) => i === 0
    ? ({ content: '', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: neutralCodes(body)[0] || '9999' })] })
    : ({ content: 'Listo.' }));
  const b = await r.json();
  assert.equal(r.status, 200); assert.match(b.reply, /No existe cliente #9999 en Clientes/);
  assert.ok(!/No encontré deudas/.test(b.reply));
  noNames(cap);
});

// ---------- CLI-022: empleado pide los atrasados ----------
test('CLI-022 empleado «quienes estan atrasados» y parecidos: 403 query_admin_only ANTES del modelo, sin montos', async () => {
  for (const text of ['quienes estan atrasados', 'Quiénes están atrasados con sus pagos?', 'quien esta atrasado', 'quiénes están en mora',
    'qué fiados están vencidos', 'dame las deudas atrasadas', 'quiénes no me han pagado', 'quienes andan atrasados']) {
    for (const stream of [false, true]) {
      const { r, cap } = await route(text, () => ({ content: 'cliente #C-0001 debe S/ 120.00 desde' }), { role: 'empleado:consultas', stream });
      assert.equal(r.status, 403, text); assert.match(r.headers.get('content-type'), /json/);
      const b = await r.json(); assert.equal(b.error, 'query_admin_only', text);
      assert.match(b.message, /solo para el Admin/); assert.ok(!/S\/|\d/.test(b.message));
      assert.equal(cap.length, 0, 'sin modelo: ' + text);
    }
    assert.equal(employeeQueryDenied('empleado:consultas', text), true, text);
    assert.equal(employeeQueryDenied('owner', text), false, text);
  }
  // Lo del empleado que no son deudas sigue al modelo.
  for (const t of ['¿cuánto stock de arroz hay?', '¿qué productos están por vencer?', 'el pedido del proveedor está atrasado', '¿quién está de turno?'])
    assert.equal(employeeQueryDenied('empleado:consultas', t), false, t);
});

// ---------- CLI-025: dos clientes con el mismo nombre ----------
const ROSA = 'la señora cliente #1 o cliente #13 dice que me pago 50 ayer pero no aparece';
test('CLI-025 la IA solo ve códigos neutros y el prompt pide preguntar cuál, sin elegir', async () => {
  const p = systemPrompt('owner', {}, ROSA);
  assert.match(p, /VARIOS CLIENTES/);
  assert.ok(!/VARIOS CLIENTES/.test(systemPrompt('owner', {}, '¿cuánto debe el cliente #1?')));
});

test('CLI-025 si la IA consulta solo uno de los dos: no elige; pregunta cuál con los códigos y da los pasos', async () => {
  for (const stream of [false, true]) {
    const { r, cap } = await route(ROSA, (i, body) => i === 0
      ? ({ content: '', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: neutralCodes(body)[0] })] })
      : ({ content: 'cliente #C-0001 debe S/ 120.00.' }), { stream });
    const text = await r.text(); assert.equal(r.status, 200);
    const b = stream ? sseEvents(text).find((e) => e.e === 'final').d : JSON.parse(text);
    assert.match(b.reply, /cliente #1\b/); assert.match(b.reply, /cliente #13\b/); assert.match(b.reply, /¿/);
    assert.ok(!/debe S\/|120/.test(b.reply), 'eligió uno: ' + b.reply);
    assert.match(b.reply, /Clientes > /); assert.match(b.reply, /Registrar pago/); assert.ok(!/Abonar/.test(b.reply), 'botón que no existe: ' + b.reply);
    assert.ok(!(b.proposals || []).some((p) => p.type === 'consulta'), JSON.stringify(b.proposals));
    noNames(cap);
  }
});

test('CLI-025 si la IA ya pregunta cuál: se agregan los pasos a mano para el pago que no aparece', async () => {
  const { r, cap } = await route(ROSA, (i, body) => { const [a, c] = neutralCodes(body); return ({ content: '¿El pago es de cliente #' + a + ' o de cliente #' + c + '?' }); });
  const b = await r.json(); assert.equal(r.status, 200);
  assert.match(b.reply, /cliente #1 o de cliente #13/);
  assert.match(b.reply, /Clientes > toque al cliente \(Ficha financiera\) > HISTORIAL DE PAGOS/); assert.match(b.reply, /Registrar pago/);
  assert.match(b.reply, /CUENTAS Y CRÉDITOS/); assert.ok(!/Abonar/.test(b.reply), 'botón que no existe: ' + b.reply); assert.match(b.reply, /no cambia deudas/);
  noNames(cap);
});

// (revisión #1006) «Abonar» no existe en la app: en la ficha del cliente («Ficha financiera») el botón es «Registrar pago» (en CUENTAS Y
// CRÉDITOS) y los abonos están en HISTORIAL DE PAGOS (GESTIÓN DEL CLIENTE). Mismo nombre en el teléfono y en la PC (misma app web).
test('revisión #1006: ningún paso ni botón del asistente dice «Abonar» (no existe); «Anular abono» y «abono/abonos» siguen bien', () => {
  const dir = new URL('../../tools/cloudflare-lab/src/', import.meta.url);
  // Solo el texto visible: literales de cadena fuera de comentarios. Las regex (p. ej. DEBT_VERB con «abona/abonaba») no cuentan.
  const strings = (src) => [...src.replace(/^\s*\/\/.*$/gm, '').matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
  const BUTTON = /(?<![\p{L}])Abonar(?![\p{L}])|«\s*abonar\s*»/iu;
  for (const f of readdirSync(dir).filter((n) => /^pos-assistant.*\.js$/.test(n))) {
    const bad = strings(readFileSync(new URL(f, dir), 'utf8')).filter((x) => BUTTON.test(x));
    assert.deepEqual(bad.map((x) => x.slice(0, 120)), [], f + ' nombra «Abonar»');
  }
  for (const role of ['owner', 'empleado:consultas']) for (const t of ['hola', ROSA, '¿cómo registro un abono?'])
    assert.ok(!BUTTON.test(systemPrompt(role, {}, t)), role + ': ' + t);
  assert.match(systemPrompt('owner', {}, 'hola'), /Abono = Clientes > cliente > CUENTAS Y CRÉDITOS > Registrar pago/);
  const pasos = JSON.stringify(mockAssistantReply({ role: 'owner', ctx: {}, text: 'como registro un abono' }));
  assert.match(pasos, /Registrar pago/); assert.match(pasos, /Ficha financiera/); assert.match(pasos, /CUENTAS Y CRÉDITOS/); assert.ok(!BUTTON.test(pasos), pasos);
  assert.ok(!BUTTON.test('Anular abono') && !BUTTON.test('sus abonos') && !BUTTON.test('el cliente abona'), 'el filtro no toca «abono»');
});

// (regla del dueño 23-10) El empleado también ve en pantalla el nombre real del cliente: la regla VARIOS CLIENTES (preguntar cuál, con
// los pasos a mano) va también en el prompt del empleado. A la IA siguen yendo solo códigos neutros. Los permisos de consultas no cambian:
// el empleado no consulta deudas de clientes (deuda_cliente), así que su regla no le pide consultar a todos ni nombra deuda_cliente.
test('regla del dueño 23-10: VARIOS CLIENTES y sus pasos a mano van al Admin y también al empleado', () => {
  const owner = systemPrompt('owner', {}, ROSA);
  assert.match(owner, /VARIOS CLIENTES/); assert.match(owner, /HISTORIAL DE PAGOS/); assert.match(owner, /Registrar pago/); assert.match(owner, /consulta a todos/);
  for (const role of ['empleado:consultas', 'empleado', 'empleado:costos']) {
    const p = systemPrompt(role, {}, ROSA);
    assert.match(p, /VARIOS CLIENTES/, role); assert.match(p, /HISTORIAL DE PAGOS/, role); assert.match(p, /Registrar pago/, role);
    assert.ok(!/consulta a todos|deuda_cliente/.test(p.slice(p.indexOf('VARIOS CLIENTES'), p.indexOf('VARIOS CLIENTES') + 600)), role + ': la regla del empleado no pide consultar deudas');
    assert.ok(!/VARIOS CLIENTES/.test(systemPrompt(role, {}, '¿cuánto vendí hoy?')), role);
  }
});

test('regla del dueño 23-10: el empleado con dos clientes del mismo nombre recibe la pregunta y los pasos a mano; a la IA solo códigos', async () => {
  for (const stream of [false, true]) {
    const { r, cap } = await route(ROSA, (i, body) => { const [a, c] = neutralCodes(body); return ({ content: '¿El pago es de cliente #' + a + ' o de cliente #' + c + '?' }); }, { role: 'empleado:consultas', stream });
    const text = await r.text(); assert.equal(r.status, 200, text.slice(0, 300));
    const b = stream ? sseEvents(text).find((e) => e.e === 'final').d : JSON.parse(text);
    assert.match(b.reply, /cliente #1 o de cliente #13/);
    assert.match(b.reply, /Clientes > toque al cliente \(Ficha financiera\) > HISTORIAL DE PAGOS/); assert.match(b.reply, /Registrar pago/);
    assert.match(b.reply, /no cambia deudas/); assert.ok(!/Abonar/.test(b.reply), b.reply);
    assert.deepEqual(neutralCodes(cap[0]), ['C-0001', 'C-0002']);
    assert.match(JSON.parse(cap[0]).messages.find((m) => m.role === 'system').content, /VARIOS CLIENTES/);
    noNames(cap);
  }
});

// (revisión #1006) El aparato junta los clientes con el mismo nombre solo con « o »; una lista con comas son clientes distintos.
test('revisión #1006: la regla de «mismo nombre» sale solo con « o », no con una lista separada por comas', async () => {
  for (const t of ['cuánto deben cliente #1, cliente #2', 'cliente #1, cliente #2 y cliente #3 me pagaron', 'cliente #1 y cliente #2 pagaron']) {
    assert.ok(clientAlternatives(t).length <= 1, t + ' → ' + clientAlternatives(t));
    assert.ok(!/VARIOS CLIENTES/.test(systemPrompt('owner', {}, t)), t);
  }
  assert.deepEqual(clientAlternatives('cliente #1 o cliente #13'), ['1', '13']);
  assert.deepEqual(clientAlternatives('¿es cliente #1 o cliente #13 o cliente #20?'), ['1', '13', '20']);
  // Con comas y la IA consulta solo a uno: se responde normal, sin «¿es cliente #1 o …?» ni pasos a mano.
  const { r } = await route('cuánto me pagaron cliente #1, cliente #13', (i, body) => i === 0
    ? ({ content: '', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: neutralCodes(body)[0] })] })
    : ({ content: 'Listo.' }));
  const b = await r.json(); assert.equal(r.status, 200);
  assert.ok(!/más de un cliente posible|HISTORIAL DE PAGOS/.test(b.reply), b.reply);
});

test('CLI-025 consultar los dos está bien (no se borra nada)', async () => {
  const { r } = await route(ROSA, (i, body) => { const [a, c] = neutralCodes(body); return i === 0
    ? ({ content: '', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: a }, 'c1'), call('consultar', { tipo: 'deuda_cliente', cliente_id: c }, 'c2')] })
    : ({ content: 'Listo.' }); });
  const b = await r.json(); assert.equal(r.status, 200);
  assert.equal((b.proposals || []).filter((p) => p.type === 'consulta').length, 2, JSON.stringify(b.proposals));
});

// ---------- CLI-029: filtro de contenido del proveedor ----------
const FILTER_400 = () => json({ error: { message: "The response was filtered due to the prompt triggering Azure OpenAI's content management policy.", type: 'invalid_request_error', param: 'prompt', code: 'content_filter', status: 400 } }, 400);
const FRIENDLY = /de otra forma/;
test('CLI-029 400 content_filter: respuesta normal 200 que pide escribirlo de otra forma (no 502), sin texto del proveedor', async () => {
  for (const stream of [false, true]) {
    const { r, cap } = await route('la cliente #3 es una tal por cual, no me paga', FILTER_400, { stream });
    assert.equal(r.status, 200, 'stream=' + stream);
    const text = await r.text();
    const b = stream ? sseEvents(text).find((e) => e.e === 'final').d : JSON.parse(text);
    assert.equal(b.ok, true); assert.match(b.reply, FRIENDLY);
    assert.ok(!/Azure|policy|content_filter|upstream/i.test(text), text.slice(0, 300));
    assert.equal(cap.length, 1, 'sin reintentos ni otro proveedor para un filtro de contenido');
  }
});

test('CLI-029 el filtro llega dentro del stream o como finish_reason: misma respuesta amable', async () => {
  const chunkErr = () => sseResp(['data: ' + JSON.stringify({ error: { code: 'content_filter', message: 'filtered' } }) + '\n\n']);
  const finFilter = () => sseResp(['data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'content_filter' }] }) + '\n\n', 'data: [DONE]\n\n']);
  for (const resp of [chunkErr, finFilter]) {
    const { r } = await route('la cliente #3 no me paga', resp, { stream: true });
    assert.equal(r.status, 200); const b = sseEvents(await r.text()).find((e) => e.e === 'final').d;
    assert.equal(b.ok, true); assert.match(b.reply, FRIENDLY);
  }
  const { r } = await route('la cliente #3 no me paga', () => msg({ content: null }, 'content_filter'));
  assert.equal(r.status, 200); assert.match((await r.json()).reply, FRIENDLY);
});

test('CLI-029 un 400 cualquiera (no filtro) sigue siendo error del proveedor', async () => {
  const { r } = await route('hola', () => json({ error: { message: 'bad', code: 'invalid_value' } }, 400));
  assert.ok(r.status >= 500, String(r.status)); assert.equal((await r.json()).error, 'upstream_error');
});
