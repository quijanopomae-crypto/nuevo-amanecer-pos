// Auditoría 500 de clientes y créditos (CLI-010, CLI-014, CLI-024). Con una sola consulta la respuesta del chat ES el texto de la
// consulta (directQueryReply), así que el texto mismo tiene que contestar lo que se preguntó:
// - CLI-010 «cuánto es lo máximo que le puedo fiar»: deuda_cliente decía solo la deuda («no tiene deudas pendientes») y el límite
//   quedaba confundido con la deuda. Ahora trae el límite de fiado registrado (canonical_customer_credit_policies, modo MANUAL) y
//   cuánto le queda; sin límite fijo lo dice y dice dónde se ve, sin inventar un monto.
// - CLI-014 «quién me debe más»: deudas_clientes decía solo el total; ahora nombra al que más debe (solo «cliente #código»).
// - CLI-024 «cuánto cobré de fiados esta semana»: no había consulta de cobros y salían las VENTAS de la semana. Ahora cobros_creditos
//   (solo Admin) suma los cobros de créditos del período; si el modelo igual pide ventas_periodo para esa pregunta, va cobros_creditos.
// Nunca van nombres de clientes a la IA (solo C-000N). DeepSeek siempre simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, createMemoryUsageStore, toolsForRole, toProposal, employeeToolGuard, ADMIN_ONLY_QUERY_TYPES, systemPrompt } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader, canonicalReader, runAssistantQuery, QUERY_TYPES } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { mockAssistantReply } from '../../tools/cloudflare-lab/src/pos-assistant-mock.js';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const NOW = Date.parse('2026-10-23T20:00:00.000Z'); // viernes 23-10-2026, 15:00 en Lima (semana: 19 al 23)
const NAMES = /Carmen|Quispe|Rosa|Flores|Huam/i;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const call = (name, args, id = 'call_1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const msg = (m) => json({ choices: [{ message: m }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
const DATA = {
  products: [{ id: 'P1', nombre: 'Arroz 1 kg', precio: 4, costo: 3, stock: 50, min: 5, controla: true }],
  customers: [{ id: '3', nombre: 'Carmen Quispe' }, { id: '5', nombre: 'Rosa Huamán' }, { id: '7', nombre: 'Carmen Flores' }],
  credits: [
    { cliente: '3', saldo: 100, vence: '2026-11-01' }, { cliente: '3', saldo: 50, vence: '2026-11-10' },
    { cliente: '5', saldo: 80, vence: '2026-11-05' }, { cliente: '7', saldo: 0, vence: '2026-10-01' }
  ],
  // Límite de fiado (canonical_customer_credit_policies): 7 y 5 con línea MANUAL; 3 sin fila (línea automática del POS).
  creditPolicies: { 7: { mode: 'MANUAL', manual_limit_cents: 20000 }, 5: { mode: 'MANUAL', manual_limit_cents: 10000 } },
  sales: [
    { sale_id: 'S1', created_at: '2026-10-20T15:00:00.000Z', metodo: 'efectivo', total_cents: 40000 },
    { sale_id: 'S2', created_at: '2026-10-22T15:00:00.000Z', metodo: 'yape', total_cents: 19900 }
  ],
  saleItems: [{ sale_id: 'S1', product_id: 'P1', quantity: 100, line_total_cents: 40000 }, { sale_id: 'S2', product_id: 'P1', quantity: 50, line_total_cents: 19900 }],
  // Cobros de créditos: 20 + 14 + 10 = S/ 44 esta semana; el del 16 es de la semana pasada.
  payments: [
    { payment_timestamp: '2026-10-20T16:00:00.000Z', amount_cents: 2000 },
    { payment_date: '2026-10-22', amount_cents: 1400 },
    { payment_timestamp: '2026-10-23T14:00:00.000Z', amount_cents: 1000 },
    { payment_timestamp: '2026-10-16T16:00:00.000Z', amount_cents: 9900 }
  ]
};
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, OHMYAGENT_API_KEY: 'k-ohmy', ROUTEWAY_API_KEY: 'k-rw' };
const q = (args, data = DATA) => runAssistantQuery(memoryReader(data), args, NOW);

async function route(text, responses, role = 'owner') {
  const cap = [];
  const f = async (url, init) => { cap.push(String(init.body)); const r = responses[Math.min(cap.length - 1, responses.length - 1)]; return msg(r); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { products: DATA.products }, text }) }),
    ENV, { principalId: 'session:x', posRole: role }, json,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: f, reader: memoryReader(DATA), audit: async () => {}, mockChunkMs: 0, now: () => NOW });
  return { r, cap };
}
const noNames = (cap) => { for (const b of cap) assert.ok(!NAMES.test(b), 'llegó un nombre a la IA: ' + b.slice(0, 300)); };

// ---------- CLI-010: límite de fiado ----------
test('CLI-010 deuda_cliente trae el límite de fiado registrado y cuánto le queda (el límite no es la deuda)', async () => {
  const sin = await q({ tipo: 'deuda_cliente', cliente_id: '7' });
  assert.match(sin.texto, /^cliente #7 no tiene deudas pendientes\./);
  assert.match(sin.texto, /Límite de fiado registrado: S\/ 200\.00/);
  assert.match(sin.texto, /puede fiarle hasta S\/ 200\.00 más/);
  assert.equal(sin.resumen.limite_fiado_soles, 200); assert.equal(sin.resumen.disponible_fiado_soles, 200);
  const con = await q({ tipo: 'deuda_cliente', cliente_id: '5' });
  assert.match(con.texto, /cliente #5 debe S\/ 80\.00/);
  assert.match(con.texto, /Límite de fiado registrado: S\/ 100\.00/);
  assert.match(con.texto, /puede fiarle hasta S\/ 20\.00 más/);
  assert.equal(con.resumen.saldo_soles, 80); assert.equal(con.resumen.disponible_fiado_soles, 20);
  // Pasado del límite: le queda 0, nunca un negativo.
  const pasado = await q({ tipo: 'deuda_cliente', cliente_id: '5' }, { ...DATA, creditPolicies: { 5: { mode: 'MANUAL', manual_limit_cents: 5000 } } });
  assert.match(pasado.texto, /ya llegó a su límite/); assert.equal(pasado.resumen.disponible_fiado_soles, 0);
});

test('CLI-010 sin límite fijo (línea automática o sin registrar): lo dice y dónde se ve, sin inventar un monto', async () => {
  const r = await q({ tipo: 'deuda_cliente', cliente_id: '3' });
  assert.match(r.texto, /cliente #3 debe S\/ 150\.00/);
  assert.match(r.texto, /No tengo registrado un límite de fiado fijo para cliente #3/);
  assert.match(r.texto, /Clientes > ficha del cliente > Línea de crédito/);
  assert.equal(r.resumen.limite_fiado, 'no_registrado');
  assert.ok(!('limite_fiado_soles' in r.resumen));
  const auto = await q({ tipo: 'deuda_cliente', cliente_id: '5' }, { ...DATA, creditPolicies: { 5: { mode: 'AUTOMATIC', manual_limit_cents: null } } });
  assert.match(auto.texto, /No tengo registrado un límite de fiado fijo/);
  // Código que no existe: no se habla de límite.
  const nadie = await q({ tipo: 'deuda_cliente', cliente_id: '999' });
  assert.ok(!/límite/i.test(nadie.texto));
});

test('CLI-010 lector canónico: lee el límite de canonical_customer_credit_policies (promoción activa); sin tabla = no disponible', async () => {
  const seen = [];
  const fake = (rows, missing = false) => ({ prepare(sql) {
    const st = { binds: [], bind(...a) { st.binds = a; return st; },
      async first() {
        if (/canonical_control/.test(sql)) return { mode: 'ACTIVE', active_promotion_id: 'PROMO1' };
        if (/canonical_customer_credit_policies/.test(sql)) { seen.push([sql, st.binds]); if (missing) throw new Error('D1_ERROR: no such table: canonical_customer_credit_policies'); return rows[st.binds[1]] || null; }
        return null; } };
    return st; } });
  const rd = canonicalReader(fake({ 7: { mode: 'MANUAL', manual_limit_cents: 20000 }, 5: { mode: 'AUTOMATIC', manual_limit_cents: null } }));
  assert.equal(typeof rd.creditPolicy, 'function');
  assert.deepEqual(await rd.creditPolicy('7'), { mode: 'MANUAL', limite: 200 });
  assert.deepEqual(await rd.creditPolicy('5'), { mode: 'AUTOMATIC', limite: null });
  assert.equal(await rd.creditPolicy('3'), null);
  assert.deepEqual(seen[0][1], ['PROMO1', '7']);
  assert.match(seen[0][0], /promotion_id=\?1 AND customer_id=\?2/);
  assert.equal(await canonicalReader(fake({}, true)).creditPolicy('7'), undefined);
});

test('CLI-010 chat del Admin: «cuánto es lo máximo que le puedo fiar» contesta con el límite, no solo con la deuda; a la IA solo C-000N', async () => {
  const { r, cap } = await route('¿Cuánto es lo máximo que le puedo fiar al cliente #7?', [{ content: '', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: 'C-0001' })] }]);
  assert.equal(r.status, 200); const d = await r.json();
  assert.notEqual(d.reply.trim(), 'cliente #7 no tiene deudas pendientes.');
  assert.match(d.reply, /Límite de fiado registrado: S\/ 200\.00/);
  assert.match(d.reply, /puede fiarle hasta S\/ 200\.00 más/);
  noNames(cap);
  assert.match(JSON.parse(cap[0]).messages[0].content, /LÍMITE DE FIADO/);
});

// ---------- CLI-014: quién me debe más ----------
test('CLI-014 deudas_clientes nombra al que más debe (código y monto), no solo el total', async () => {
  const r = await q({ tipo: 'deudas_clientes' });
  assert.match(r.texto, /^2 clientes deben en total S\/ 230\.00\./);
  assert.match(r.texto, /Debe más: cliente #3 \(S\/ 150\.00\)\./);
  assert.ok(!NAMES.test(r.texto) && !NAMES.test(JSON.stringify(r.resumen)));
  const uno = await q({ tipo: 'deudas_clientes' }, { ...DATA, credits: [{ cliente: '5', saldo: 80 }] });
  assert.equal(uno.texto, '1 cliente debe en total S/ 80.00.');
  const nadie = await q({ tipo: 'deudas_clientes' }, { ...DATA, credits: [] });
  assert.equal(nadie.texto, 'Ningún cliente tiene deuda.');
});

test('CLI-014 chat del Admin: «quién me debe más» contesta con el cliente #código de mayor saldo; a la IA sin nombres', async () => {
  const { r, cap } = await route('quien me debe mas', [{ content: '', tool_calls: [call('consultar', { tipo: 'deudas_clientes' })] }]);
  assert.equal(r.status, 200); const d = await r.json();
  assert.match(d.reply, /Debe más: cliente #3 \(S\/ 150\.00\)/);
  noNames(cap);
  assert.match(JSON.parse(cap[0]).messages[0].content, /quién debe más/);
});

// ---------- CLI-024: cobros de fiados del período ----------
test('CLI-024 cobros_creditos: cobros de créditos del período (no ventas), solo Admin', async () => {
  assert.ok(QUERY_TYPES.includes('cobros_creditos'));
  assert.ok(ADMIN_ONLY_QUERY_TYPES.includes('cobros_creditos'));
  const r = await q({ tipo: 'cobros_creditos', periodo: 'esta_semana' });
  assert.equal(r.texto, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 44.00 en 3 cobros.');
  assert.deepEqual(r.resumen, { desde: '2026-10-19', hasta: '2026-10-23', cobros_soles: 44, cobros: 3 });
  assert.ok(!/Ventas|599/.test(r.texto));
  assert.equal((await q({ tipo: 'cobros_creditos', periodo: 'ayer' })).texto, 'Cobros de fiados 2026-10-22: S/ 14.00 en 1 cobro.');
  assert.match((await q({ tipo: 'cobros_creditos', fecha: '2026-10-18' })).texto, /^No hubo cobros de fiados 2026-10-18\./);
  // Sin la lectura de cobros: lo dice, sin un número inventado.
  const { payments: _p, ...sinPagos } = DATA;
  const nd = await q({ tipo: 'cobros_creditos', periodo: 'esta_semana' }, sinPagos);
  assert.match(nd.texto, /No tengo ese dato disponible/); assert.ok(!/S\/ \d/.test(nd.texto));
});

test('CLI-024 chat del Admin: «cuánto cobré de fiados esta semana» contesta los cobros aunque el modelo pida ventas_periodo', async () => {
  for (const tipo of ['cobros_creditos', 'ventas_periodo']) {
    const { r, cap } = await route('cuanto cobre de fiados esta semana', [{ content: '', tool_calls: [call('consultar', { tipo, periodo: 'esta_semana' })] }]);
    assert.equal(r.status, 200); const d = await r.json();
    assert.equal(d.reply.trim(), 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 44.00 en 3 cobros.', tipo);
    assert.match(JSON.parse(cap[0]).messages[0].content, /COBROS DE FIADOS/);
    noNames(cap);
  }
  // Si también pregunta por ventas, ventas_periodo se respeta.
  const { r } = await route('cuanto vendi y cuanto cobre de fiados esta semana', [{ content: '', tool_calls: [call('consultar', { tipo: 'ventas_periodo', periodo: 'esta_semana' })] }]);
  const d = await r.json(); assert.match(d.reply, /Ventas/);
});

// (pedido de alfa, 23-10) Negativos: lo VENDIDO al fiado no es lo COBRADO. «¿cuánto vendí al fiado hoy?», «¿cuánto fié esta semana?»
// y variantes se quedan en ventas_periodo; si el mensaje habla de ventas o de fiar (fié, fío…) aunque también pregunte por cobros,
// tampoco se cambia (igual que «cuánto vendí y cuánto cobré»). Los positivos siguen cambiando.
const VENDIDO_AL_FIADO = [
  '¿cuánto vendí al fiado hoy?', '¿cuánto fié esta semana?', 'cuánto vendí a crédito esta semana', '¿cuánto he vendido al crédito esta semana?',
  'el fiado que vendí esta semana', 'ventas al fiado de esta semana', 'cuánto vendo fiado por semana', '¿cuánto fío a la semana?',
  '¿cuánto fié y cuánto me pagaron de fiados esta semana?', 'cuánto fié esta semana y cuánto cobré de deudas', 'ventas a crédito y cobros de fiados de esta semana',
];
const COBRADO_DE_FIADOS = ['¿cuánto cobré de fiados esta semana?', 'cuánto me pagaron de fiados esta semana', 'cuánto cobré de créditos esta semana', '¿cuánto me abonaron esta semana?'];

test('CLI-024 negativos: lo vendido al fiado se queda en ventas_periodo; lo cobrado de fiados sí va a cobros_creditos', async () => {
  for (const text of VENDIDO_AL_FIADO) {
    const { r, cap } = await route(text, [{ content: '', tool_calls: [call('consultar', { tipo: 'ventas_periodo', periodo: 'esta_semana' })] }]);
    assert.equal(r.status, 200, text); const d = await r.json();
    assert.match(d.reply, /Ventas/, text);
    assert.ok(!/Cobros de fiados|44\.00/.test(d.reply), text + ' -> ' + d.reply);
    if (!/cobr|pagaron/.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) assert.ok(!/COBROS DE FIADOS/.test(JSON.parse(cap[0]).messages[0].content), text);
    noNames(cap);
    // El modo demostración tampoco lo manda a los cobros.
    const m = mockAssistantReply({ role: 'owner', ctx: { products: [] }, text });
    assert.ok(!(m.calls || []).some((c) => /cobros_creditos/.test(c.function?.arguments ?? JSON.stringify(c))), 'mock ' + text);
  }
  for (const text of COBRADO_DE_FIADOS) {
    const { r } = await route(text, [{ content: '', tool_calls: [call('consultar', { tipo: 'ventas_periodo', periodo: 'esta_semana' })] }]);
    const d = await r.json();
    assert.equal(d.reply.trim(), 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 44.00 en 3 cobros.', text);
    const m = mockAssistantReply({ role: 'owner', ctx: { products: [] }, text });
    assert.ok((m.calls || []).some((c) => /cobros_creditos/.test(c.function?.arguments ?? JSON.stringify(c))), 'mock ' + text);
  }
});

test('CLI-024 empleado: cobros_creditos no existe para él y si la pide es solo del Admin (barrera de montos intacta)', async () => {
  for (const role of ['empleado:consultas', 'empleado:completo', 'empleado:completo+costos']) {
    const c = toolsForRole(role).find((t) => t.function.name === 'consultar')?.function;
    assert.ok(!c.parameters.properties.tipo.enum.includes('cobros_creditos'), role);
    assert.ok(!/cobros_creditos/.test(c.description), role);
    assert.equal(toProposal({ name: 'consultar', arguments: JSON.stringify({ tipo: 'cobros_creditos', periodo: 'esta_semana' }) }, role, { products: [] }, 1).dropped, 'query_admin_only', role);
    assert.equal(employeeToolGuard(role)({ name: 'consultar', arguments: '{"tipo":"cobros_creditos"}' }), 'query_admin_only', role);
  }
  for (const tipo of ['cobros_creditos', 'ventas_periodo']) {
    // El empleado que pregunta por cobros de fiados nunca recibe los cobros (ni con ventas_periodo: no se cambia a la consulta del Admin).
    const { r } = await route('cuanto cobre de fiados esta semana', [{ content: '', tool_calls: [call('consultar', { tipo, periodo: 'esta_semana' })] }], 'empleado:completo+costos');
    const body = await r.text(); assert.ok(!/44\.00|Cobros de fiados/.test(body), tipo + ': sin cobros para el empleado');
  }
});

// ---------- descripción de la herramienta, reglas del prompt y modo demostración ----------
test('descripción de consultar: solo se AGREGA texto (límite de fiado y cobros_creditos); reglas solo cuando se pregunta', () => {
  const c = toolsForRole('owner').find((t) => t.function.name === 'consultar').function;
  for (const part of ['Consulta números del negocio (solo lectura): stock de un producto, productos por reponer', 'deuda_cliente (cuánto debe UN cliente: manda cliente_id con el código de «cliente #CODIGO»',
    'ventas_por_hora (número de ventas y total por hora: «a qué hora vendo más», «horas de más venta»)', 'en los resúmenes, hasta = el día pedido o un día del mes pedido (por defecto hoy).']) assert.ok(c.description.includes(part), part);
  assert.match(c.description, /cobros_creditos/); assert.match(c.description, /límite de fiado/);
  assert.ok(c.parameters.properties.tipo.enum.includes('cobros_creditos'));
  const plain = systemPrompt('owner', { products: [] }, 'hola');
  assert.ok(!/LÍMITE DE FIADO|COBROS DE FIADOS/.test(plain), 'sin la pregunta no se suman bytes');
  assert.match(systemPrompt('owner', { products: [] }, 'cuanto le puedo fiar al cliente #7'), /LÍMITE DE FIADO/);
  assert.match(systemPrompt('owner', { products: [] }, '¿cuánto cobré de fiados hoy?'), /COBROS DE FIADOS/);
  assert.ok(!/LÍMITE DE FIADO|COBROS DE FIADOS/.test(systemPrompt('empleado:completo+costos', { products: [] }, '¿cuánto cobré de fiados hoy? cuanto le puedo fiar')), 'empleado: sin reglas del Admin');
});

test('modo demostración: cobros de fiados y límite de fiado van a su consulta', () => {
  const tipoOf = (text) => JSON.parse(mockAssistantReply({ role: 'owner', ctx: { products: [] }, text }).calls[0].arguments);
  assert.equal(tipoOf('cuanto cobre de fiados esta semana').tipo, 'cobros_creditos');
  assert.equal(tipoOf('cuanto me abonaron hoy').tipo, 'cobros_creditos');
  assert.deepEqual(tipoOf('cuanto le puedo fiar al cliente #7'), { tipo: 'deuda_cliente', cliente_id: '7' });
  assert.equal(tipoOf('quien me debe mas').tipo, 'deudas_clientes');
});
