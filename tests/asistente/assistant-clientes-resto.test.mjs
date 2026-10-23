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
import { assistantChatRoute, createMemoryUsageStore, systemPrompt, employeeQueryDenied } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader, runAssistantQuery } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const NOW = Date.parse('2026-10-23T20:00:00.000Z');
const NAMES = /Rosa|Quispe|Mamani|Carmen|Flores/i;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const call = (name, args, id = 'call_1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const msg = (m, fin) => json({ choices: [{ message: m, ...(fin ? { finish_reason: fin } : {}) }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
const enc = new TextEncoder();
const sseResp = (chunks) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
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
  const f = async (_url, init) => { cap.push(String(init.body)); return responder(cap.length - 1, String(init.body)); };
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
    ? msg({ content: '', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: neutralCodes(body)[0] || '9999' })] })
    : msg({ content: 'Listo.' }));
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
      const { r, cap } = await route(text, () => msg({ content: 'cliente #C-0001 debe S/ 120.00 desde' }), { role: 'empleado:consultas', stream });
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
      ? msg({ content: '', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: neutralCodes(body)[0] })] })
      : msg({ content: 'cliente #C-0001 debe S/ 120.00.' }), { stream });
    const text = await r.text(); assert.equal(r.status, 200);
    const b = stream ? sseEvents(text).find((e) => e.e === 'final').d : JSON.parse(text);
    assert.match(b.reply, /cliente #1\b/); assert.match(b.reply, /cliente #13\b/); assert.match(b.reply, /¿/);
    assert.ok(!/debe S\/|120/.test(b.reply), 'eligió uno: ' + b.reply);
    assert.match(b.reply, /Clientes > /); assert.match(b.reply, /Abonar/);
    assert.ok(!(b.proposals || []).some((p) => p.type === 'consulta'), JSON.stringify(b.proposals));
    noNames(cap);
  }
});

test('CLI-025 si la IA ya pregunta cuál: se agregan los pasos a mano para el pago que no aparece', async () => {
  const { r, cap } = await route(ROSA, (i, body) => { const [a, c] = neutralCodes(body); return msg({ content: '¿El pago es de cliente #' + a + ' o de cliente #' + c + '?' }); });
  const b = await r.json(); assert.equal(r.status, 200);
  assert.match(b.reply, /cliente #1 o de cliente #13/);
  assert.match(b.reply, /Clientes > ficha/); assert.match(b.reply, /Abonar/); assert.match(b.reply, /no cambia deudas/);
  noNames(cap);
});

test('CLI-025 consultar los dos está bien (no se borra nada)', async () => {
  const { r } = await route(ROSA, (i, body) => { const [a, c] = neutralCodes(body); return i === 0
    ? msg({ content: '', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: a }, 'c1'), call('consultar', { tipo: 'deuda_cliente', cliente_id: c }, 'c2')] })
    : msg({ content: 'Listo.' }); });
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
