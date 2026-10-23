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
import { activeCanon } from '../cloud-sync/canon-browser-harness.mjs';

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

async function route(text, responses, role = 'owner', data = DATA) {
  const cap = [];
  const f = async (url, init) => { cap.push(String(init.body)); const r = responses[Math.min(cap.length - 1, responses.length - 1)]; return msg(r); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { products: DATA.products }, text }) }),
    ENV, { principalId: 'session:x', posRole: role }, json,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: f, reader: memoryReader(data), audit: async () => {}, mockChunkMs: 0, now: () => NOW });
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

// ---------- Revisión del PR #995 ----------
// Cobros con anulación: la anulación (fila negativa) descuenta el monto y el cobro. +20, −20, +5 = S/ 5.00 en 1 cobro.
// Cada crédito trae su id (credito) y cada cobro el id del crédito (credit_id): así se separan los cobros de UN cliente.
const DATA_CR = {
  ...DATA,
  credits: [
    { credito: 'CR3a', cliente: '3', saldo: 100, vence: '2026-11-01' }, { credito: 'CR3b', cliente: '3', saldo: 50, vence: '2026-11-10' },
    { credito: 'CR5', cliente: '5', saldo: 80, vence: '2026-11-05' }, { credito: 'CR7', cliente: '7', saldo: 0, vence: '2026-10-01' }
  ],
  payments: [
    { credit_id: 'CR5', payment_timestamp: '2026-10-20T16:00:00.000Z', amount_cents: 2000 },
    { credit_id: 'CR5', payment_timestamp: '2026-10-20T16:30:00.000Z', amount_cents: -2000 }, // anulación del cobro anterior
    { credit_id: 'CR5', payment_timestamp: '2026-10-21T16:00:00.000Z', amount_cents: 500 },
    { credit_id: 'CR3a', payment_date: '2026-10-22', amount_cents: 1400 },
    { credit_id: 'CR3b', payment_timestamp: '2026-10-23T14:00:00.000Z', amount_cents: 1000 },
    { credit_id: 'CR5', payment_timestamp: '2026-10-16T16:00:00.000Z', amount_cents: 9900 }
  ]
};

test('#995 cobros netos: +20, −20 (anulación), +5 = S/ 5.00 en 1 cobro; la anulación descuenta monto y cuenta', async () => {
  const data = { ...DATA, payments: [
    { payment_timestamp: '2026-10-21T15:00:00.000Z', amount_cents: 2000 },
    { payment_timestamp: '2026-10-21T15:10:00.000Z', amount_cents: -2000 },
    { payment_timestamp: '2026-10-21T16:00:00.000Z', amount_cents: 500 }
  ] };
  const r = await q({ tipo: 'cobros_creditos', fecha: '2026-10-21' }, data);
  assert.equal(r.texto, 'Cobros de fiados 2026-10-21: S/ 5.00 en 1 cobro.');
  assert.equal(r.resumen.cobros_soles, 5); assert.equal(r.resumen.cobros, 1);
  // Semana de toda la tienda con anulación: 20 − 20 + 5 + 14 + 10 = 29 en 3 cobros (4 cobros − 1 anulado).
  const w = await q({ tipo: 'cobros_creditos', periodo: 'esta_semana' }, DATA_CR);
  assert.equal(w.texto, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 29.00 en 3 cobros.');
  // Un cobro anulado solo, sin otro: no hubo cobros (nunca un conteo negativo).
  const anul = await q({ tipo: 'cobros_creditos', fecha: '2026-10-20' }, { ...DATA, payments: data.payments.slice(0, 2).map((x) => ({ ...x, payment_timestamp: x.payment_timestamp.replace('21', '20') })) });
  assert.match(anul.texto, /^No hubo cobros de fiados 2026-10-20\./);
});

test('#995 lector canónico real: cobros vivos con anulación (COMPENSATION) dan S/ 5.00 en 1 cobro; por cliente vía credit_id', async (t) => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  const db = f.database;
  const promo = db.prepare('SELECT active_promotion_id AS p FROM canonical_control WHERE id=1').get().p;
  const cr = db.prepare('SELECT credit_id, customer_id FROM credits WHERE promotion_id=?').all(promo);
  assert.equal(cr.length, 1);
  // Solo prueba: eventos insertados directo (sin las validaciones del flujo de cobro, que tiene sus propias pruebas).
  db.exec('PRAGMA foreign_keys=OFF');
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='canonical_financial_events'").all()) db.exec('DROP TRIGGER ' + name);
  const ev = db.prepare('INSERT INTO canonical_financial_events(event_id,operation_id,promotion_id,event_type,credit_id,credit_provenance,credit_delta_cents,payment_method,reason,compensates_operation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  ev.run('E1', 'o1', promo, 'PAYMENT', cr[0].credit_id, 'IMPORT', -2000, 'efectivo', null, null, '2026-10-21T15:00:00.000Z');
  ev.run('E2', 'o2', promo, 'COMPENSATION', cr[0].credit_id, 'IMPORT', 2000, null, 'Anulación del cobro', 'o1', '2026-10-21T15:10:00.000Z');
  ev.run('E3', 'o3', promo, 'PAYMENT', cr[0].credit_id, 'IMPORT', -500, 'yape', null, null, '2026-10-21T16:00:00.000Z');
  const rd = canonicalReader(f.env.nuevo_amanecer_lab);
  const pays = (await rd.creditPayments()).filter((x) => x.dia === '2026-10-21');
  assert.deepEqual(pays.map((x) => x.c), [2000, -2000, 500]); // céntimos
  assert.ok(pays.every((x) => x.cr === cr[0].credit_id), 'cada cobro trae su crédito');
  assert.equal((await rd.credits())[0].credito, cr[0].credit_id);
  const todo = await runAssistantQuery(rd, { tipo: 'cobros_creditos', fecha: '2026-10-21' }, NOW);
  assert.equal(todo.texto, 'Cobros de fiados 2026-10-21: S/ 5.00 en 1 cobro.');
  const uno = await runAssistantQuery(rd, { tipo: 'cobros_creditos', fecha: '2026-10-21', cliente_id: cr[0].customer_id }, NOW);
  assert.equal(uno.texto, `Cobros de fiados de cliente #${cr[0].customer_id} 2026-10-21: S/ 5.00 en 1 cobro.`);
  const otro = await runAssistantQuery(rd, { tipo: 'cobros_creditos', fecha: '2026-10-21', cliente_id: 'NADIE' }, NOW);
  assert.ok(!/S\/ 5\.00/.test(otro.texto), otro.texto);
});

test('#995 cobros_creditos con cliente_id: solo los cobros de ESE cliente, nunca el total de la tienda', async () => {
  const r = await q({ tipo: 'cobros_creditos', periodo: 'esta_semana', cliente_id: '5' }, DATA_CR);
  assert.equal(r.texto, 'Cobros de fiados de cliente #5 2026-10-19 a 2026-10-23: S/ 5.00 en 1 cobro.');
  assert.equal(r.resumen.cliente, 'cliente #5'); assert.equal(r.resumen.cobros_soles, 5);
  const tres = await q({ tipo: 'cobros_creditos', periodo: 'esta_semana', cliente_id: 'cliente #3' }, DATA_CR);
  assert.equal(tres.texto, 'Cobros de fiados de cliente #3 2026-10-19 a 2026-10-23: S/ 24.00 en 2 cobros.');
  const nada = await q({ tipo: 'cobros_creditos', periodo: 'esta_semana', cliente_id: '7' }, DATA_CR);
  assert.match(nada.texto, /^No hubo cobros de fiados de cliente #7 2026-10-19 a 2026-10-23\./);
  // Sin forma de separar por cliente (cobros sin crédito): lo dice; nunca el total de la tienda como si fuera del cliente.
  const sin = await q({ tipo: 'cobros_creditos', periodo: 'esta_semana', cliente_id: '5' });
  assert.ok(!/S\/ \d/.test(sin.texto), sin.texto); assert.match(sin.texto, /cliente #5/); assert.match(sin.texto, /ficha del cliente/);
});

test('#995 toProposal pasa cliente_id en cobros_creditos; un código desconocido no se convierte en el total de la tienda', () => {
  const p = toProposal({ name: 'consultar', arguments: JSON.stringify({ tipo: 'cobros_creditos', periodo: 'esta_semana', cliente_id: '5' }) }, 'owner', { products: [] }, 1);
  assert.equal(p.query.cliente_id, '5');
  const u = toProposal({ name: 'consultar', arguments: JSON.stringify({ tipo: 'cobros_creditos', periodo: 'esta_semana', cliente_id: '#?' }) }, 'owner', { products: [] }, 1);
  assert.equal(u.dropped, 'unknown_customer');
  const c = toolsForRole('owner').find((t) => t.function.name === 'consultar').function;
  assert.ok(c.parameters.properties.cliente_id.description.includes('el código de «cliente #CODIGO», sin el nombre.'));
  assert.match(c.parameters.properties.cliente_id.description, /cobros_creditos/);
});

test('#995 chat del Admin: «cuánto me pagó cliente #5 de su deuda esta semana» da SOLO lo de cliente #5 (ventas_periodo, cobros_creditos con y sin cliente_id)', async () => {
  const text = '¿cuánto me pagó cliente #5 de su deuda esta semana?';
  const want = 'Cobros de fiados de cliente #5 2026-10-19 a 2026-10-23: S/ 5.00 en 1 cobro.';
  for (const args of [{ tipo: 'ventas_periodo', periodo: 'esta_semana' }, { tipo: 'cobros_creditos', periodo: 'esta_semana', cliente_id: 'C-0001' }, { tipo: 'cobros_creditos', periodo: 'esta_semana' }]) {
    const { r, cap } = await route(text, [{ content: '', tool_calls: [call('consultar', args)] }], 'owner', DATA_CR);
    assert.equal(r.status, 200); const d = await r.json();
    assert.equal(d.reply.trim(), want, JSON.stringify(args));
    assert.ok(!/29\.00|Ventas/.test(d.reply), 'nunca el total de la tienda: ' + JSON.stringify(args));
    noNames(cap);
    assert.ok(!/cliente #5/.test(cap[0]), 'a la IA solo el código neutral');
  }
  const m = JSON.parse(mockAssistantReply({ role: 'owner', ctx: { products: [] }, text }).calls[0].arguments);
  assert.deepEqual([m.tipo, m.cliente_id], ['cobros_creditos', '5']);
});

test('#995 saldo a favor: deudas 80 y −30 con límite 100 = puede fiarle S/ 50.00', async () => {
  const data = { ...DATA, credits: [{ cliente: '5', saldo: 80 }, { cliente: '5', saldo: -30 }] };
  const r = await q({ tipo: 'deuda_cliente', cliente_id: '5' }, data);
  assert.match(r.texto, /puede fiarle hasta S\/ 50\.00 más/);
  assert.equal(r.resumen.disponible_fiado_soles, 50);
  // Solo saldo a favor: el disponible nunca pasa del límite.
  const favor = await q({ tipo: 'deuda_cliente', cliente_id: '5' }, { ...DATA, credits: [{ cliente: '5', saldo: -30 }] });
  assert.equal(favor.resumen.disponible_fiado_soles, 100);
});

test('#995 creditPolicy no distingue mayúsculas: «cliente #c7» encuentra el límite de C7', async () => {
  const data = { ...DATA, customers: [{ id: 'C7', nombre: 'Carmen Flores' }], credits: [{ cliente: 'C7', saldo: 30 }], creditPolicies: { C7: { mode: 'MANUAL', manual_limit_cents: 20000 } } };
  const r = await q({ tipo: 'deuda_cliente', cliente_id: 'c7' }, data);
  assert.match(r.texto, /Límite de fiado registrado: S\/ 200\.00/);
  assert.equal(r.resumen.disponible_fiado_soles, 170);
  assert.deepEqual(await memoryReader(data).creditPolicy('c7'), { mode: 'MANUAL', limite: 200 });
});

test('#995 límite de fiado con «fío», «fía», «fiarle»; «cuánto fío a la semana» no', () => {
  for (const text of ['¿hasta cuánto le fío al cliente #7?', '¿cuánto le fía al cliente #7?', '¿cuánto es lo máximo para fiarle al cliente #7?']) {
    assert.match(systemPrompt('owner', { products: [] }, text), /LÍMITE DE FIADO/, text);
    assert.deepEqual(JSON.parse(mockAssistantReply({ role: 'owner', ctx: { products: [] }, text }).calls[0].arguments), { tipo: 'deuda_cliente', cliente_id: '7' }, 'mock ' + text);
  }
  assert.ok(!/LÍMITE DE FIADO/.test(systemPrompt('owner', { products: [] }, '¿cuánto fío a la semana?')));
});

test('#995 «registra un pago de deuda de cliente #5» es una acción: sin regla de COBROS ni cambio a cobros_creditos', async () => {
  for (const text of ['registra un pago de deuda de cliente #5 por 20 soles', 'anota el abono de crédito de cliente #5: 20 soles']) {
    assert.ok(!/COBROS DE FIADOS/.test(systemPrompt('owner', { products: [] }, text)), text);
    const { r } = await route(text, [{ content: '', tool_calls: [call('consultar', { tipo: 'ventas_periodo', periodo: 'hoy' })] }], 'owner', DATA_CR);
    const d = await r.json(); assert.ok(!/Cobros de fiados/.test(d.reply), text + ' -> ' + d.reply);
    const m = mockAssistantReply({ role: 'owner', ctx: { products: [] }, text });
    assert.ok(!(m.calls || []).some((c) => /cobros_creditos/.test(c.function?.arguments ?? c.arguments ?? JSON.stringify(c))), 'mock ' + text);
  }
});

test('#995 + #998: con el mensaje tapado para el modelo («doña [nombre oculto]»), la detección de cobros sigue sobre el texto original', async () => {
  const { r, cap } = await route('ya vino doña Rosa. ¿cuánto cobré de fiados esta semana?', [{ content: '', tool_calls: [call('consultar', { tipo: 'ventas_periodo', periodo: 'esta_semana' })] }]);
  assert.equal(r.status, 200); const d = await r.json();
  assert.equal(d.reply.trim(), 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 44.00 en 3 cobros.');
  assert.match(JSON.parse(cap[0]).messages[0].content, /COBROS DE FIADOS/);
  noNames(cap);
});

// ---------- Segunda revisión del PR #995 ----------
// «el cliente 5» (sin «#», como enseña la herramienta: «cliente 12 -> cliente_id 12») también es UN cliente; una persona sin código
// («doña Rosa», «doña [nombre oculto]», «me pagó Rosa … de su deuda») pide el código, nunca el total de la tienda; «cliente #99» que
// no existe lo dice; dos códigos en la misma pregunta preguntan cuál. «¿cuánto cobré de fiados esta semana?» sigue siendo de la tienda.
const enc995 = new TextEncoder();
const sse995 = (m) => {
  const ch = [];
  if (m.content) ch.push('data: ' + JSON.stringify({ choices: [{ delta: { content: m.content } }] }) + '\n\n');
  (m.tool_calls || []).forEach((c, i) => ch.push('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: i, id: c.id, function: c.function }] } }] }) + '\n\n'));
  ch.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: m.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\n', 'data: [DONE]\n\n');
  let i = 0;
  return new Response(new ReadableStream({ pull(c) { if (i < ch.length) c.enqueue(enc995.encode(ch[i++])); else c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
};
// Mismo pedido con y sin partes (stream): devuelve la respuesta final y los cuerpos que fueron a la IA.
async function ask995(text, args, stream) {
  const cap = [], m = { content: '', tool_calls: [call('consultar', args)] };
  const f = async (url, init) => { cap.push(String(init.body)); return stream ? sse995(m) : msg(m); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { products: DATA.products }, text, ...(stream ? { stream: true } : {}) }) }),
    ENV, { principalId: 'session:x', posRole: 'owner' }, json,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', fetch: f, reader: memoryReader(DATA_CR), audit: async () => {}, mockChunkMs: 0, now: () => NOW });
  assert.equal(r.status, 200);
  if (!stream) return { reply: (await r.json()).reply.trim(), cap };
  const fin = (await r.text()).split('\n\n').filter((b) => /^event: final/m.test(b)).map((b) => JSON.parse(/^data: (.*)$/m.exec(b)[1]))[0];
  assert.ok(fin, 'stream sin evento final');
  return { reply: String(fin.reply).trim(), cap };
}
const WEEK = { periodo: 'esta_semana' };
// (3ª revisión, punto 2) el servidor deja «cliente #5» como en toda respuesta; el nombre lo pone el aparato (linkCustomers), sin doble nombre.
const ROSA_REPLY = 'Cobros de fiados de cliente #5 2026-10-19 a 2026-10-23: S/ 5.00 en 1 cobro.';
const SALES_ARGS = [{ tipo: 'ventas_periodo', ...WEEK }, { tipo: 'cobros_creditos', ...WEEK }];

test('#995 (2ª) «el cliente 5» sin «#»: con ventas_periodo o cobros_creditos sin cliente_id da SOLO lo de cliente #5 (con y sin partes)', async () => {
  const want = 'Cobros de fiados de cliente #5 2026-10-19 a 2026-10-23: S/ 5.00 en 1 cobro.';
  for (const text of ['¿cuánto me pagó el cliente 5 de su deuda esta semana?', '¿cuánto me pagó el cliente nro. 5 de su deuda esta semana?', '¿cuánto me pagó el cliente N° 5 de su deuda esta semana?'])
    for (const args of SALES_ARGS) for (const stream of [false, true]) {
      const { reply, cap } = await ask995(text, args, stream);
      assert.equal(reply, want, text + ' ' + JSON.stringify(args) + ' stream=' + stream);
      noNames(cap);
    }
  const m = JSON.parse(mockAssistantReply({ role: 'owner', ctx: { products: [] }, text: '¿cuánto me pagó el cliente 5 de su deuda esta semana?' }).calls[0].arguments);
  assert.deepEqual([m.tipo, m.cliente_id], ['cobros_creditos', '5']);
});

test('#995 (2ª) «cliente nuevo», «clientes», «cliente frecuente» no son códigos: siguen siendo el total de la tienda', async () => {
  for (const text of ['¿cuánto cobré de fiados esta semana a los clientes?', '¿cuánto cobré de fiados esta semana? hoy vino un cliente nuevo', '¿cuánto me pagaron de fiados esta semana los clientes frecuentes?'])
    for (const stream of [false, true]) {
      const { reply } = await ask995(text, { tipo: 'cobros_creditos', ...WEEK }, stream);
      assert.equal(reply, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 29.00 en 3 cobros.', text + ' stream=' + stream);
    }
});

test('#995 (2ª, regla nueva) una persona: «doña Rosa» / «me pagó Rosa» = cliente #5 resuelto aquí; sin nombre («[nombre oculto]», «el señor») pide nombre o código; nunca el total', async () => {
  for (const text of ['¿cuánto me pagó doña Rosa de su deuda esta semana?', '¿cuánto me pagó Rosa de su deuda esta semana?'])
    for (const args of SALES_ARGS) for (const stream of [false, true]) {
      const { reply, cap } = await ask995(text, args, stream);
      assert.equal(reply, ROSA_REPLY, text + ' ' + JSON.stringify(args) + ' stream=' + stream);
      noNames(cap);
    }
  for (const text of ['¿cuánto me pagó doña [nombre oculto] de su deuda esta semana?', '¿cuánto me abonó el señor de su fiado esta semana?'])
    for (const args of SALES_ARGS) for (const stream of [false, true]) {
      const { reply, cap } = await ask995(text, args, stream);
      assert.ok(!/S\/ \d/.test(reply), 'nunca un monto: ' + text + ' -> ' + reply);
      assert.match(reply, /código del cliente/, text + ' stream=' + stream);
      noNames(cap);
    }
  // Lo general sigue con el total de la tienda (también con una persona nombrada en otra frase).
  for (const text of ['¿cuánto cobré de fiados esta semana?', 'ya vino doña Rosa. ¿cuánto cobré de fiados esta semana?', '¿cuánto me pagaron de fiados esta semana?'])
    for (const args of SALES_ARGS) for (const stream of [false, true]) {
      const { reply, cap } = await ask995(text, args, stream);
      assert.equal(reply, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 29.00 en 3 cobros.', text + ' ' + JSON.stringify(args) + ' stream=' + stream);
      noNames(cap);
    }
});

test('#995 (2ª) «cliente #99» que no existe: «No encontré cliente #99», no «No hubo cobros»', async () => {
  const r = await q({ tipo: 'cobros_creditos', ...WEEK, cliente_id: '99' }, DATA_CR);
  assert.match(r.texto, /^No encontré cliente #99/); assert.ok(!/No hubo cobros/.test(r.texto));
  assert.equal(r.resumen.cliente_encontrado, false);
  for (const stream of [false, true]) {
    const { reply } = await ask995('¿cuánto me pagó cliente #99 de su deuda esta semana?', { tipo: 'cobros_creditos', ...WEEK }, stream);
    assert.match(reply, /^No encontré cliente #99/, 'stream=' + stream);
  }
  // Existe sin créditos (cliente #7 tiene uno saldado; uno sin ningún crédito): «No hubo cobros».
  const sinCred = await q({ tipo: 'cobros_creditos', ...WEEK, cliente_id: '8' }, { ...DATA_CR, customers: [...DATA_CR.customers, { id: '8', nombre: 'X' }] });
  assert.match(sinCred.texto, /^No hubo cobros de fiados de cliente #8/);
});

test('#995 (2ª) «cliente #5 o cliente #9» en cobros: pregunta cuál, no elige el primero', async () => {
  for (const text of ['¿cuánto me pagó cliente #5 o cliente #9 de su deuda esta semana?', '¿cuánto me pagó el cliente 5 o el cliente 9 de su deuda esta semana?'])
    // Con «#» a la IA va el neutro (C-0001 = 5); sin «#» el número va tal cual.
    for (const args of [...SALES_ARGS, { tipo: 'cobros_creditos', ...WEEK, cliente_id: text.includes('#') ? 'C-0001' : '5' }]) for (const stream of [false, true]) {
      const { reply } = await ask995(text, args, stream);
      assert.ok(!/S\/ \d/.test(reply), text + ' -> ' + reply);
      assert.match(reply, /cuál/i); assert.match(reply, /cliente #5/); assert.match(reply, /cliente #9/);
    }
});

// ---------- #995: modo demostración con «cliente nro. 5» / «N° 5» / «cliente 5» ----------
const mockArgs = (text) => (mockAssistantReply({ role: 'owner', ctx: { products: [] }, text }).calls || []).map((c) => JSON.parse(c.function?.arguments ?? c.arguments));
test('#995 mock: «cliente nro. 5», «N° 5», «cliente 5» dan cliente_id 5 en cobros_creditos (como el chat real) y en deuda_cliente', async () => {
  for (const text of ['¿cuánto me pagó el cliente nro. 5 de su deuda esta semana?', '¿cuánto me pagó el cliente N° 5 de su deuda esta semana?', '¿cuánto me pagó el cliente 5 de su deuda esta semana?', '¿cuánto me pagó cliente #5 de su deuda esta semana?']) {
    const a = mockArgs(text);
    assert.equal(a.length, 1, text); assert.equal(a[0].tipo, 'cobros_creditos', text); assert.equal(a[0].cliente_id, '5', text);
    // El chat real (modelo que pide ventas_periodo) contesta lo mismo: los cobros de cliente #5.
    for (const stream of [false, true]) {
      const { reply } = await ask995(text, { tipo: 'ventas_periodo', ...WEEK }, stream);
      assert.equal(reply, 'Cobros de fiados de cliente #5 2026-10-19 a 2026-10-23: S/ 5.00 en 1 cobro.', text + ' stream=' + stream);
    }
  }
  for (const text of ['¿cuánto debe el cliente nro. 5?', '¿cuánto debe el cliente N° 5?', '¿cuánto debe el cliente 5?', '¿cuánto debe el cliente #5?', '¿hasta cuánto le fío al cliente nro. 7?']) {
    const a = mockArgs(text);
    assert.equal(a.length, 1, text); assert.equal(a[0].tipo, 'deuda_cliente', text); assert.equal(a[0].cliente_id, /7/.test(text) ? '7' : '5', text);
  }
  // «cliente nuevo» no es un código: no es deuda de un cliente «nuevo».
  assert.ok(!mockArgs('¿cuánto debe el cliente nuevo?').some((a) => a.cliente_id === 'nuevo'));
});

// ---------- #995: lista cortada sin cobros encontrados = no hay dato completo (nunca «No hubo cobros») ----------
test('#995 listas cortadas y nada encontrado: dice que no tiene el dato completo, no «No hubo cobros… (se revisó una parte)»', async () => {
  const cut = { ...DATA_CR, paymentsTruncated: true, creditsTruncated: true };
  for (const args of [{ tipo: 'cobros_creditos', ...WEEK, cliente_id: '7' }, { tipo: 'cobros_creditos', fecha: '2026-10-01' }]) {
    const r = await q(args, cut);
    assert.ok(!/No hubo cobros/.test(r.texto), JSON.stringify(args) + ' -> ' + r.texto);
    assert.ok(!/S\/ \d/.test(r.texto), r.texto);
    assert.match(r.texto, /no tengo el dato completo/i, r.texto);
    assert.equal(r.resumen.lista_cortada, true); assert.equal(r.resumen.cobros_soles, undefined);
  }
  // Solo una de las dos listas cortada: igual, no se afirma cero.
  for (const data of [{ ...DATA_CR, paymentsTruncated: true }, { ...DATA_CR, creditsTruncated: true }]) {
    const r = await q({ tipo: 'cobros_creditos', ...WEEK, cliente_id: '7' }, data);
    assert.ok(!/No hubo cobros/.test(r.texto), r.texto); assert.match(r.texto, /no tengo el dato completo/i);
  }
  // Con cobros encontrados en una lista cortada: el monto con el aviso de que se revisó una parte (como antes).
  const parte = await q({ tipo: 'cobros_creditos', ...WEEK, cliente_id: '5' }, cut);
  assert.equal(parte.texto, 'Cobros de fiados de cliente #5 2026-10-19 a 2026-10-23: S/ 5.00 en 1 cobro. (lista larga: se revisó una parte)');
  // Sin cortar: «No hubo cobros» sigue igual.
  assert.match((await q({ tipo: 'cobros_creditos', ...WEEK, cliente_id: '7' }, DATA_CR)).texto, /^No hubo cobros de fiados de cliente #7/);
});

// Las 4 frases del bloqueo, cada una con y sin partes y con ventas_periodo / cobros_creditos sin cliente_id.
test('#995 frases del bloqueo, con y sin partes: cliente 5 = sus cobros; doña Rosa = cliente #5 (regla nueva); doña [nombre oculto] = pide el código; general = total de la tienda', async () => {
  const cases = [
    ['¿cuánto me pagó el cliente 5 de su deuda esta semana?', (r) => assert.equal(r, 'Cobros de fiados de cliente #5 2026-10-19 a 2026-10-23: S/ 5.00 en 1 cobro.')],
    ['¿cuánto me pagó doña Rosa de su deuda esta semana?', (r) => assert.equal(r, ROSA_REPLY)],
    ['¿cuánto me pagó doña [nombre oculto] de su deuda esta semana?', (r) => { assert.match(r, /código del cliente/); assert.ok(!/S\/ \d/.test(r)); }],
    ['¿cuánto cobré de fiados esta semana?', (r) => assert.equal(r, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 29.00 en 3 cobros.')]
  ];
  for (const [text, check] of cases) for (const args of SALES_ARGS) for (const stream of [false, true]) {
    const { reply, cap } = await ask995(text, args, stream);
    try { check(reply); } catch (e) { e.message = text + ' ' + JSON.stringify(args) + ' stream=' + stream + ': ' + e.message; throw e; }
    noNames(cap);
  }
});

// ---------- #995 (regla nueva, 23-10 19:04): una persona nombrada sin código se resuelve AQUÍ con la lista de Clientes ----------
// Un cliente coincide (nombre o nombre completo, sin importar mayúsculas ni tildes): a la IA va «cliente #código» (neutro C-000N) y la
// respuesta en pantalla lleva el nombre. Varios: pregunta cuál con los nombres completos (Admin y empleado). Ninguno: «No encontré a un
// cliente llamado …» sin llamar a la IA. El nombre nunca va a la IA (mensaje, historial ni resumen). Sin lista: se pide el código.
const NAMES_P = /Carmen|Quispe|Rosa|Flores|Huam|Elmer|Paz\b|Pedro/i;
const DATA_P = { ...DATA_CR, customers: [...DATA_CR.customers, { id: '9', nombre: 'Elmer Paz' }],
  credits: [...DATA_CR.credits, { credito: 'CR9', cliente: '9', saldo: 40, vence: '2026-11-20' }],
  payments: [...DATA_CR.payments, { credit_id: 'CR9', payment_timestamp: '2026-10-22T18:00:00.000Z', amount_cents: 300 }] };
const ENV_DEMO = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, ASSISTANT_DEMO: '1' };
// Pedido completo: devuelve lo que se ve (reply), el cuerpo final, los turnos que vuelven como historial y TODO lo que fue a la IA.
async function askP(text, { args = { tipo: 'cobros_creditos', ...WEEK }, stream = false, data = DATA_CR, role = 'owner', history, resumen, reader, env = ENV } = {}) {
  const cap = [], m = { content: '', tool_calls: [call('consultar', args)] };
  const f = async (url, init) => { cap.push(String(init.body)); return stream ? sse995(m) : msg(m); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: { products: DATA.products }, text, ...(history ? { history } : {}), ...(resumen ? { resumen } : {}), ...(stream ? { stream: true } : {}) }) }),
    env, { principalId: 'session:x', posRole: role }, json,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: f, reader: reader || memoryReader(data), audit: async () => {}, mockChunkMs: 0, now: () => NOW });
  let body;
  if (!stream) body = await r.json();
  else { body = (await r.text()).split('\n\n').filter((b) => /^event: (final|error)/m.test(b)).map((b) => JSON.parse(/^data: (.*)$/m.exec(b)[1]))[0]; assert.ok(body, 'stream sin evento final'); }
  return { status: r.status, body, reply: String(body.reply ?? '').trim(), cap };
}
const noNamesP = (cap, why) => { for (const b of cap) assert.ok(!NAMES_P.test(b), 'llegó un nombre a la IA (' + why + '): ' + b.slice(0, 400)); };
// El historial que vuelve (turns) tampoco lleva el nombre: el próximo pedido lo manda a la IA.
const turnsNoNames = (body, why) => { for (const t of body.turns || []) assert.ok(!NAMES_P.test(t.content), 'nombre en el historial (' + why + '): ' + t.content); };
const ARGS_ALL = [...SALES_ARGS, { tipo: 'cobros_creditos', ...WEEK, cliente_id: 'C-0001' }];
// Las 4 frases de la revisión: «abonó Rosa», Rosa antes del verbo, «rosa» en minúsculas (y «Rosa y Elmer» abajo).
const ROSA_PHRASES = ['¿cuánto me abonó Rosa de su deuda esta semana?', '¿Rosa cuánto me pagó de su deuda esta semana?', 'Rosa me abonó de su fiado; ¿cuánto fue esta semana?', '¿cuánto me pagó rosa de su deuda esta semana?', '¿cuánto me pagó ROSA HUAMÁN de su deuda esta semana?'];

test('#995 nombre → un cliente: «abonó Rosa», «Rosa … pagó», «rosa», nombre completo = SOLO cliente #5 (el nombre lo pone el aparato; con y sin partes); a la IA sin nombre', async () => {
  for (const text of ROSA_PHRASES) for (const args of ARGS_ALL) for (const stream of [false, true]) {
    const why = text + ' ' + JSON.stringify(args) + ' stream=' + stream;
    const { reply, cap, body } = await askP(text, { args, stream });
    assert.equal(reply, ROSA_REPLY, why);
    assert.equal(cap.length >= 1, true, 'contesta normal (con la IA): ' + why);
    noNamesP(cap, why);
    // A la IA va el código neutro del cliente (no el nombre ni el código real).
    assert.match(JSON.parse(cap[0]).messages.at(-1).content, /cliente #C-0001/, why);
    if (!stream) turnsNoNames(body, why);
  }
});

test('#995 nombre → varios clientes («Carmen»): pregunta cuál con los nombres completos, sin monto y SIN llamar a la IA (Admin y empleado, con y sin partes)', async () => {
  for (const role of ['owner', 'empleado:completo+costos']) for (const text of ['¿cuánto me pagó Carmen de su deuda esta semana?', '¿carmen cuánto me abonó de su fiado esta semana?'])
    for (const stream of [false, true]) {
      const why = role + ' ' + text + ' stream=' + stream;
      const { status, reply, cap, body } = await askP(text, { stream, role });
      assert.equal(status, 200, why);
      assert.equal(reply, '¿De cuál cliente quiere los cobros: Carmen Quispe o Carmen Flores? Pregunte por uno a la vez.', why);
      assert.deepEqual(body.opciones, [{ cliente_id: '3', nombre: 'Carmen Quispe' }, { cliente_id: '7', nombre: 'Carmen Flores' }], why);
      assert.equal(cap.length, 0, 'sin IA: ' + why);
      if (!stream) turnsNoNames(body, why);
    }
  // «Carmen Quispe» (nombre completo) es uno solo.
  for (const stream of [false, true]) {
    const { reply, cap } = await askP('¿cuánto me pagó Carmen Quispe de su deuda esta semana?', { stream });
    assert.equal(reply, 'Cobros de fiados de cliente #3 2026-10-19 a 2026-10-23: S/ 24.00 en 2 cobros.', 'stream=' + stream);
    noNamesP(cap, 'Carmen Quispe');
  }
});

test('#995 «Rosa y Elmer» (dos personas): pregunta cuál con los dos nombres; si Elmer no está, «No encontré a un cliente llamado Elmer»; nunca el total ni la IA', async () => {
  for (const text of ['¿cuánto me pagaron Rosa y Elmer de su deuda esta semana?', 'Rosa y Elmer me abonaron de su fiado, ¿cuánto fue esta semana?']) for (const stream of [false, true]) {
    const why = text + ' stream=' + stream;
    const two = await askP(text, { stream, data: DATA_P });
    assert.equal(two.reply, '¿De cuál cliente quiere los cobros: Rosa Huamán o Elmer Paz? Pregunte por uno a la vez.', why);
    assert.deepEqual(two.body.opciones, [{ cliente_id: '5', nombre: 'Rosa Huamán' }, { cliente_id: '9', nombre: 'Elmer Paz' }], why);
    assert.equal(two.cap.length, 0, why);
    const miss = await askP(text, { stream, data: DATA_CR });
    assert.match(miss.reply, /^No encontré a un cliente llamado Elmer\./, why);
    assert.ok(!/S\/ \d/.test(miss.reply), why); assert.equal(miss.cap.length, 0, why);
    if (!stream) { turnsNoNames(two.body, why); turnsNoNames(miss.body, why); }
  }
});

test('#995 nombre que no está en Clientes: «No encontré a un cliente llamado Pedro», sin IA y sin el total de la tienda (con y sin partes)', async () => {
  for (const role of ['owner', 'empleado:completo+costos']) for (const text of ['¿cuánto me pagó Pedro de su deuda esta semana?', '¿cuánto me abonó doña Pedro de su fiado esta semana?', 'pedro me pagó de su deuda, ¿cuánto fue esta semana?'])
    for (const stream of [false, true]) {
      const why = role + ' ' + text + ' stream=' + stream;
      const { status, reply, cap, body } = await askP(text, { stream, role });
      assert.equal(status, 200, why);
      assert.equal(reply, 'No encontré a un cliente llamado Pedro. Revise el nombre en Clientes o dígame su código («cliente #código»).', why);
      assert.equal(cap.length, 0, why);
      if (!stream) turnsNoNames(body, why);
    }
});

test('#995 historial y resumen: el nombre del cliente no va a la IA en el mensaje, el historial ni el resumen (con y sin partes)', async () => {
  const history = [{ role: 'user', content: 'ayer vino Rosa Huamán y también Carmen' }, { role: 'assistant', content: 'Entendido.' }];
  const resumen = 'Se habló de Rosa y de Carmen Flores.';
  for (const text of ROSA_PHRASES.slice(0, 4)) for (const stream of [false, true]) {
    const why = text + ' stream=' + stream;
    const { reply, cap } = await askP(text, { stream, history, resumen });
    assert.equal(reply, ROSA_REPLY, why);
    assert.ok(cap.length >= 1, why); noNamesP(cap, why);
    const sent = JSON.parse(cap[0]);
    assert.ok(sent.messages.some((m) => /Entendido/.test(m.content)), 'el historial sí va (sin nombres): ' + why);
  }
  // Lo general (total de la tienda) con historial y resumen: tampoco van los nombres.
  for (const stream of [false, true]) {
    const { reply, cap } = await askP('¿cuánto cobré de fiados esta semana?', { stream, history, resumen });
    assert.equal(reply, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 29.00 en 3 cobros.');
    noNamesP(cap, 'general stream=' + stream);
  }
});

test('#995 frases del total de la tienda (negativos): siguen con el total y sin nombres a la IA (con y sin partes)', async () => {
  for (const text of ['¿cuánto cobré de fiados esta semana?', 'ya vino doña Rosa. ¿cuánto cobré de fiados esta semana?', 'ya vino Rosa. ¿cuánto cobré de fiados esta semana?', '¿cuánto me pagaron de fiados esta semana?'])
    for (const args of SALES_ARGS) for (const stream of [false, true]) {
      const why = text + ' ' + JSON.stringify(args) + ' stream=' + stream;
      const { reply, cap } = await askP(text, { args, stream });
      assert.equal(reply, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 29.00 en 3 cobros.', why);
      noNamesP(cap, why);
    }
});

test('#995 sin lista de Clientes (no se pudo leer): se pide el código como antes y el nombre tampoco va a la IA', async () => {
  const base = memoryReader(DATA_CR);
  const reader = { ...base, customers: async () => { throw new Error('sin lista'); } };
  for (const text of ['¿cuánto me pagó doña Rosa de su deuda esta semana?', '¿cuánto me abonó Rosa de su deuda esta semana?', '¿cuánto me pagó rosa de su deuda esta semana?'])
    for (const args of SALES_ARGS) for (const stream of [false, true]) {
      const why = text + ' ' + JSON.stringify(args) + ' stream=' + stream;
      const { reply, cap } = await askP(text, { args, stream, reader });
      assert.match(reply, /código del cliente/, why); assert.ok(!/S\/ \d/.test(reply), why);
      noNamesP(cap, why);
    }
});

test('#995 modo demostración: el nombre se resuelve igual (Rosa = cliente #5; Carmen = pregunta cuál; Pedro = no encontrado; «#5 o el #9» = pregunta cuál)', async () => {
  for (const stream of [false, true]) {
    const one = await askP('¿cuánto me abonó Rosa de su deuda esta semana?', { stream, env: ENV_DEMO });
    assert.equal(one.reply, ROSA_REPLY, 'stream=' + stream);
    const two = await askP('¿cuánto me pagó Carmen de su deuda esta semana?', { stream, env: ENV_DEMO });
    assert.match(two.reply, /^¿De cuál cliente quiere los cobros: Carmen Quispe o Carmen Flores\?/);
    const none = await askP('¿cuánto me pagó Pedro de su deuda esta semana?', { stream, env: ENV_DEMO });
    assert.match(none.reply, /^No encontré a un cliente llamado Pedro\./);
    const both = await askP('¿cuánto me pagó el cliente #5 o el #9 de su deuda esta semana?', { stream, env: ENV_DEMO, data: DATA_P });
    assert.ok(!/S\/ \d/.test(both.reply), both.reply); assert.match(both.reply, /cuál/); assert.match(both.reply, /cliente #5/); assert.match(both.reply, /cliente #9/);
  }
});

test('#995 (punto 3) «cliente #5 o el #9», «#5 o #9», «#5, #9 y #11»: todos los códigos; en cobros pregunta cuál (con y sin partes)', async () => {
  const { clientCodesInText } = await import('../../tools/cloudflare-lab/src/pos-assistant-queries.js');
  assert.deepEqual(clientCodesInText('¿cuánto me pagó el cliente #5 o el #9?'), ['5', '9']);
  assert.deepEqual(clientCodesInText('cliente #5 o #9'), ['5', '9']);
  assert.deepEqual(clientCodesInText('clientes: cliente #5, #9 y #11'), ['5', '9', '11']);
  for (const text of ['¿cuánto me pagó el cliente #5 o el #9 de su deuda esta semana?', '¿cuánto me pagó cliente #5 o #9 de su deuda esta semana?'])
    for (const args of SALES_ARGS) for (const stream of [false, true]) {
      const { reply } = await askP(text, { args, stream, data: DATA_P });
      assert.ok(!/S\/ \d/.test(reply), text + ' -> ' + reply);
      assert.match(reply, /cuál/i); assert.match(reply, /cliente #5/); assert.match(reply, /cliente #9/);
    }
  // Modo demostración (sin ruta): con dos códigos no elige el primero.
  for (const text of ['¿cuánto me pagó el cliente #5 o el #9 de su deuda esta semana?', '¿cuánto debe el cliente #5 o el #9?'])
    assert.ok(!mockArgs(text).some((a) => a.cliente_id === '5'), text);
});

test('#995 (punto 2) número con unidad no es un código: «cliente 2 kilos», «cliente 5kg», «cliente 3 soles»', async () => {
  const { clientCodesInText } = await import('../../tools/cloudflare-lab/src/pos-assistant-queries.js');
  for (const text of ['¿cuánto le fié al cliente 2 kilos de arroz?', 'el cliente 5kg de azúcar', 'el cliente 3 soles de pan', 'cliente 2 litros de aceite', 'cliente 1.5 kg'])
    assert.deepEqual(clientCodesInText(text), [], text);
  assert.deepEqual(clientCodesInText('¿cuánto me pagó el cliente 5 de su deuda?'), ['5']);
  assert.deepEqual(clientCodesInText('cliente #2 kilos'), ['2']); // con «#» sí es un código
  assert.ok(!mockArgs('¿cuánto debe el cliente 2 kilos?').some((a) => a.cliente_id === '2'));
  for (const stream of [false, true]) {
    const { reply } = await askP('¿cuánto me pagaron de fiados esta semana? el cliente 2 kilos de arroz no', { stream });
    assert.equal(reply, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 29.00 en 3 cobros.', 'stream=' + stream);
  }
});

// (3ª revisión) Las 4 frases TAL CUAL, también sin «fiado/deuda». En 0b626c24 daban el total de la tienda (S/ 50.00 en 5 cobros).
const REVIEW3 = ['¿cuánto me abonó Rosa esta semana?', '¿Rosa cuánto me pagó de fiado esta semana?', '¿cuánto me pagaron Rosa y Elmer de fiado esta semana?', '¿cuánto me pagó rosa esta semana?'];
const STORE_TOTAL = /^Cobros de fiados \d{4}|^Ventas|en \d+ cobros\.$/;
test('#995 (3ª revisión) las 4 frases tal cual, con y sin partes, con ventas o cobros del modelo: Rosa = solo cliente #5; Rosa y Elmer = cuál; nunca el total; sin nombre a la IA', async () => {
  for (const text of REVIEW3) for (const args of ARGS_ALL) for (const stream of [false, true]) {
    const why = text + ' ' + JSON.stringify(args) + ' stream=' + stream;
    const { reply, cap, body } = await askP(text, { args, stream, data: DATA_P });
    assert.ok(!STORE_TOTAL.test(reply) || reply === ROSA_REPLY, 'total de la tienda: ' + why + ' -> ' + reply);
    noNamesP(cap, why); if (!stream) turnsNoNames(body, why);
    if (/Elmer/.test(text)) {
      assert.equal(reply, '¿De cuál cliente quiere los cobros: Rosa Huamán o Elmer Paz? Pregunte por uno a la vez.', why);
      assert.deepEqual(body.opciones, [{ cliente_id: '5', nombre: 'Rosa Huamán' }, { cliente_id: '9', nombre: 'Elmer Paz' }], why);
      assert.equal(cap.length, 0, 'sin IA: ' + why);
    } else {
      assert.equal(reply, ROSA_REPLY, why);
      assert.match(JSON.parse(cap[0]).messages.at(-1).content, /cliente #C-0001/, why);
    }
  }
  // Elmer no está en la lista: «No encontré…», sin IA ni monto.
  for (const stream of [false, true]) {
    const { reply, cap } = await askP(REVIEW3[2], { stream });
    assert.match(reply, /^No encontré a un cliente llamado Elmer\./, 'stream=' + stream); assert.equal(cap.length, 0); assert.ok(!/S\/ \d/.test(reply));
  }
});

test('#995 (3ª revisión) sin «fiado/deuda»: nadie en la lista = «No encontré…»; modo demostración igual; sin lista = pide el código; preguntas sin persona no cambian', async () => {
  for (const text of ['¿cuánto me pagó Pedro esta semana?', '¿cuánto me abonó doña Pedro esta semana?']) for (const stream of [false, true]) for (const args of SALES_ARGS) {
    const { reply, cap } = await askP(text, { args, stream });
    assert.equal(reply, 'No encontré a un cliente llamado Pedro. Revise el nombre en Clientes o dígame su código («cliente #código»).', text + ' stream=' + stream);
    assert.equal(cap.length, 0);
  }
  for (const text of REVIEW3) for (const stream of [false, true]) {
    const { reply } = await askP(text, { stream, env: ENV_DEMO, data: DATA_P });
    if (/Elmer/.test(text)) assert.equal(reply, '¿De cuál cliente quiere los cobros: Rosa Huamán o Elmer Paz? Pregunte por uno a la vez.', 'demo ' + text);
    else assert.equal(reply, ROSA_REPLY, 'demo ' + text + ' stream=' + stream);
  }
  const reader = { ...memoryReader(DATA_P), customers: async () => { throw new Error('sin lista'); } };
  for (const text of [REVIEW3[0], REVIEW3[3]]) for (const args of SALES_ARGS) for (const stream of [false, true]) {
    const why = text + ' ' + JSON.stringify(args) + ' stream=' + stream;
    const { reply, cap } = await askP(text, { args, stream, reader });
    assert.match(reply, /código del cliente/, why); assert.ok(!/S\/ \d/.test(reply), why); noNamesP(cap, why);
  }
  // Sin persona: igual que antes (la IA contesta; con cobros del modelo, el total de fiados).
  for (const text of ['¿cuánto me pagaron esta semana?', '¿Cuánto me pagaron en Yape esta semana?', '¿cuánto me abonaron en Octubre?']) for (const stream of [false, true]) {
    const { reply, cap } = await askP(text, { stream });
    assert.ok(cap.length >= 1, text); assert.ok(!/No encontré|De cuál cliente/.test(reply), text + ' -> ' + reply);
  }
});

test('#995 (3ª revisión, punto 2) sin doble nombre: un cliente queda «cliente #N» (el aparato pone el nombre); dos con el MISMO nombre se distinguen por código', async () => {
  const data = { ...DATA_P, customers: [...DATA_P.customers, { id: '12', nombre: 'Rosa Huamán' }] };
  for (const stream of [false, true]) {
    const { reply, cap, body } = await askP('¿cuánto me pagó Rosa Huamán esta semana?', { stream, data });
    assert.equal(reply, '¿De cuál cliente quiere los cobros: cliente #5 o cliente #12? Pregunte por uno a la vez.', 'stream=' + stream);
    assert.deepEqual(body.opciones, [{ cliente_id: '5', nombre: 'Rosa Huamán' }, { cliente_id: '12', nombre: 'Rosa Huamán' }]);
    assert.equal(cap.length, 0);
    const one = await askP('¿cuánto me abonó Rosa esta semana?', { stream, data: DATA_P });
    assert.ok(!/\(cliente #/.test(one.reply) && !NAMES_P.test(one.reply), one.reply);
  }
});

// (revisión tras la base, bloqueo 1) Palabras comunes junto al verbo NO son nombres: en 0b626c24 daban ventas S/ 400 / cobros S/ 50;
// en 81551029 «No encontré a un cliente llamado Alguien / Mis». Esas palabras (lista fija) siguen el camino de antes; cualquier otra que no
// esté en Clientes sigue siendo «No encontré…» (decisión del lead: mejor eso que arriesgar el total de la tienda).
const COMMON_PAY = ['¿me pagó alguien hoy?', '¿cuánto me pagaron mis clientes esta semana?', '¿me pagó alguien de fiado esta semana?', '¿cuánto me pagaron nuestros clientes esta semana?',
  '¿me pagaron varios esta semana?', '¿cuánto me pagaron ellos esta semana?', '¿solo me pagaron de fiado esta semana?', '¿quién me pagó recién?', '¿cuánto me pagaron entre todos esta semana?',
  '¿cuánto me pagó cada uno esta semana?', '¿cuánto me pagó la gente esta semana?', '¿cuánto me pagó la vecina esta semana?', '¿cuánto me pagaron ambos esta semana?',
  '¿cuánto me pagaron sus clientes esta semana?', '¿Alguien me pagó de fiado esta semana?', '¿Mis clientes me pagaron esta semana?'];
test('#995 (bloqueo tras la base) palabras comunes junto al verbo («alguien», «mis clientes», «la vecina», «cada uno»…) no son nombres: la respuesta de la tienda, nunca «No encontré» (con y sin partes)', async () => {
  for (const text of COMMON_PAY) for (const data of [DATA_CR, DATA_P]) for (const stream of [false, true]) {
    const why = text + ' stream=' + stream;
    const cob = await askP(text, { stream, data });
    assert.equal(cob.reply, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ ' + (data === DATA_P ? '32.00 en 4' : '29.00 en 3') + ' cobros.', 'cobros: ' + why);
    assert.ok(cob.cap.length >= 1, why);
    const ven = await askP(text, { stream, data, args: { tipo: 'ventas_periodo', ...WEEK } });
    assert.ok(!/No encontré|De cuál cliente|código del cliente/.test(ven.reply), 'ventas: ' + why + ' -> ' + ven.reply);
    assert.ok(ven.cap.length >= 1, why);
  }
  // Otra palabra que no está en Clientes sigue siendo «No encontré…» (sin IA).
  for (const stream of [false, true]) {
    const { reply, cap } = await askP('¿cuánto me pagó pedro esta semana?', { stream });
    assert.match(reply, /^No encontré a un cliente llamado Pedro\./); assert.equal(cap.length, 0);
  }
  // «rosa» en minúscula SÍ está en Clientes: sigue siendo cliente #5.
  for (const stream of [false, true]) assert.equal((await askP('¿cuánto me pagó rosa esta semana?', { stream })).reply, ROSA_REPLY);
});

// (bloqueo 2) «cliente 5 S/», «cliente 5 s/.», «cliente 5%» no son el código 5.
test('#995 (bloqueo tras la base) «cliente 5%», «cliente 5 S/», «cliente 5 s/.» no son códigos; «… el cliente 5% descuento» = total de la tienda', async () => {
  const { clientCodesInText } = await import('../../tools/cloudflare-lab/src/pos-assistant-queries.js');
  for (const text of ['el cliente 5 S/ de descuento', 'el cliente 5 s/. de vuelto', 'el cliente 5% descuento', 'el cliente 5 % descuento', 'cliente 5s/ más'])
    assert.deepEqual(clientCodesInText(text), [], text);
  assert.deepEqual(clientCodesInText('el cliente 5 y el #9'), ['5', '9']);
  assert.deepEqual(clientCodesInText('el cliente 5 de su deuda'), ['5']);
  for (const stream of [false, true]) {
    const { reply } = await askP('¿cuánto cobré de fiados esta semana? el cliente 5% descuento', { stream });
    assert.equal(reply, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 29.00 en 3 cobros.', 'stream=' + stream);
  }
});

// (bloqueo en 764d2ee3) Una palabra de la lista fija, un artículo o una palabra de tiempo ENTRE el verbo y el nombre no rompe la cercanía:
// el nombre se busca igual. Sin Rosa en Clientes: «No encontré a un cliente llamado Rosa», nunca el total; con Rosa: cliente #5.
const GAP_ROSA = ['¿cuánto me pagó solo Rosa esta semana?', '¿cuánto me pagó solo rosa esta semana?', '¿me pagó recién Rosa?', '¿me pagaron ellos, Rosa?',
  '¿me pagó entre todos Rosa?', '¿me pagó hoy Rosa?', '¿me pagó ayer Rosa?', '¿me pagó mi Rosa esta semana?', '¿me pagó mañana Rosa?', '¿me pagó anoche Rosa?', '¿me pagó temprano Rosa?'];
const noRosa = (d) => ({ ...d, customers: d.customers.filter((c) => c.id !== '5') });
test('#995 (bloqueo en 764d2ee3) «me pagó solo/recién/hoy/ayer/mi/ellos, Rosa»: sin Rosa = «No encontré… Rosa» sin IA ni total; con Rosa = cliente #5 (con y sin partes)', async () => {
  for (const text of GAP_ROSA) for (const stream of [false, true]) for (const args of [{ tipo: 'cobros_creditos', ...WEEK }, { tipo: 'ventas_periodo', ...WEEK }]) {
    const why = text + ' stream=' + stream + ' ' + args.tipo;
    const miss = await askP(text, { stream, args, data: noRosa(DATA_CR) });
    assert.equal(miss.reply, 'No encontré a un cliente llamado Rosa. Revise el nombre en Clientes o dígame su código («cliente #código»).', why);
    assert.equal(miss.cap.length, 0, why);
    const hit = await askP(text, { stream, args });
    assert.equal(hit.reply, ROSA_REPLY, why); noNamesP(hit.cap, why);
  }
  for (const data of [DATA_CR, noRosa(DATA_CR)]) for (const stream of [false, true]) {
    const { reply, cap } = await askP('¿cuánto me pagó la vecina Gumercinda?', { stream, data });
    assert.match(reply, /^No encontré a un cliente llamado Gumercinda\./, 'stream=' + stream); assert.equal(cap.length, 0);
  }
});
test('#995 (bloqueo en 764d2ee3) «¿cuánto me pagó cada uno, Rosa y Elmer?» sin Rosa: dice que Rosa no está, nunca solo lo de Elmer (con y sin partes)', async () => {
  for (const stream of [false, true]) for (const args of [{ tipo: 'cobros_creditos', ...WEEK }, { tipo: 'ventas_periodo', ...WEEK }]) {
    const why = 'stream=' + stream + ' ' + args.tipo;
    const { reply, cap } = await askP('¿cuánto me pagó cada uno, Rosa y Elmer?', { stream, args, data: noRosa(DATA_P) });
    assert.match(reply, /^No encontré a un cliente llamado Rosa\./, why); assert.ok(!/S\/ \d/.test(reply), why); assert.equal(cap.length, 0, why);
    const both = await askP('¿cuánto me pagó cada uno, Rosa y Elmer?', { stream, args, data: DATA_P });
    assert.match(both.reply, /^¿De cuál cliente/, why); assert.equal(both.cap.length, 0, why);
  }
  // Sin nombre después siguen con el total de la tienda.
  for (const text of ['¿me pagó alguien hoy?', '¿cuánto me pagaron mis clientes esta semana?', '¿cuánto me pagó la vecina esta semana?', '¿cuánto me pagó cada uno esta semana?'])
    for (const stream of [false, true]) assert.equal((await askP(text, { stream })).reply, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 29.00 en 3 cobros.', text);
});

// (decisión del lead, 764d2ee3) «ella» / «él» junto a un verbo de pago, sin cliente que resolver: se pregunta de qué cliente, sin IA y nunca
// el total de la tienda ni «No encontré… Ella». (Tomar el cliente del turno anterior queda para después.)
const PRON_PAY = ['¿me pagó ella?', '¿cuánto me pagó él esta semana?', '¿Ella me pagó de su deuda esta semana?', '¿él me abonó hoy?', '¿cuánto me pagó ella de fiado esta semana?'];
test('#995 (decisión del lead) «me pagó ella / él»: «¿De qué cliente? Escríbame su nombre.» sin IA ni total (con y sin partes)', async () => {
  for (const text of PRON_PAY) for (const stream of [false, true]) for (const args of [{ tipo: 'cobros_creditos', ...WEEK }, { tipo: 'ventas_periodo', ...WEEK }]) {
    const why = text + ' stream=' + stream + ' ' + args.tipo;
    const { status, reply, cap } = await askP(text, { stream, args });
    assert.equal(status, 200, why); assert.equal(reply, '¿De qué cliente? Escríbame su nombre.', why); assert.equal(cap.length, 0, why);
  }
  // «ellos» sigue siendo la lista fija (total de la tienda); «el cliente 5» (artículo) sigue siendo el código a un cliente nombrado.
  for (const stream of [false, true]) {
    assert.equal((await askP('¿cuánto me pagaron ellos esta semana?', { stream })).reply, 'Cobros de fiados 2026-10-19 a 2026-10-23: S/ 29.00 en 3 cobros.');
    assert.equal((await askP('¿cuánto me pagó el cliente 5 esta semana?', { stream })).reply, ROSA_REPLY);
  }
});

// (bloqueo en b4072c52) Sin tope de palabras entre el verbo y el nombre (hasta el inicio o el fin de la oración; la coma no corta) y «en», «a»,
// «la», «tarde», «noche», «mañana», «nomás» se saltan y nunca son nombres. Sin Rosa: «No encontré… Rosa», sin IA ni total; con Rosa: cliente #5.
const FAR_ROSA = ['¿me pagó ya hoy temprano solo la Rosa?', '¿me pagó ya hoy temprano solo la rosa?', '¿me pagó hoy en la mañana Rosa?', '¿me pagó ayer a la tarde Rosa?',
  '¿me pagó recién nomás Rosa?', '¿me pagó anoche en la noche, ya tarde, Rosa?', '¿Rosa ya hoy en la tarde temprano me pagó?'];
test('#995 (bloqueo en b4072c52) 5 o más palabras entre el verbo y el nombre: sin Rosa = «No encontré… Rosa» sin IA; con Rosa = cliente #5 (con y sin partes)', async () => {
  for (const text of FAR_ROSA) for (const stream of [false, true]) for (const args of [{ tipo: 'cobros_creditos', ...WEEK }, { tipo: 'ventas_periodo', ...WEEK }]) {
    const why = text + ' stream=' + stream + ' ' + args.tipo;
    const miss = await askP(text, { stream, args, data: noRosa(DATA_CR) });
    assert.equal(miss.reply, 'No encontré a un cliente llamado Rosa. Revise el nombre en Clientes o dígame su código («cliente #código»).', why);
    assert.equal(miss.cap.length, 0, why);
    const hit = await askP(text, { stream, args });
    assert.equal(hit.reply, ROSA_REPLY, why); noNamesP(hit.cap, why);
  }
});
