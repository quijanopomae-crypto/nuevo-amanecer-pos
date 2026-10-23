// Créditos atrasados (solo Admin): tabla con nombre y borrador del recordatorio en la pantalla del Admin; al modelo solo totales,
// rangos y el código del cliente. El empleado no recibe la consulta. Datos inventados; el modelo siempre simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, createMemoryUsageStore, toolsForRole, toProposal, employeeToolGuard, ADMIN_ONLY_QUERY_TYPES } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { runAssistantQuery, memoryReader, dueDay, safeClientCode, reminderDraft, parseCuotas, overduePart, termDue } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const SECRET = 'secreto-de-prueba-0123456789abcdef';
// 2026-10-22 12:00 en Lima (UTC-5) -> hoy en Lima = 2026-10-22
const NOW = Date.parse('2026-10-22T17:00:00.000Z');
const CUSTOMERS = [
  { id: 'C1', nombre: 'Rosa Quispe', dni: '45678912', tel: '987654321' },
  { id: 'C2', nombre: 'Juan Pérez', dni: '41234567', tel: '912345678' },
  { id: '41112222', nombre: 'Ana Torres', dni: '41112222', tel: '955555555' }, // id igual al DNI: nunca va como código
  { id: 'C4', nombre: 'Luis Ramos', dni: '40000001', tel: '944444444' }
];
const CREDITS = [
  { cliente: 'C1', saldo: 30, vence: '2026-10-15' },  // 7 días
  { cliente: 'C1', saldo: 20, vence: '2026-09-01' },  // 51 días (el más viejo manda)
  { cliente: 'C2', saldo: 12.5, vence: '21/10/2026' }, // 1 día, formato DD/MM/AAAA
  { cliente: '41112222', saldo: 100, vence: '2026-06-01' }, // 143 días
  { cliente: 'C4', saldo: 50, vence: '2026-10-22' },  // vence hoy: no está atrasado
  { cliente: 'C4', saldo: 0, vence: '2026-01-01' },   // pagado: no cuenta
  { cliente: 'C2', saldo: 9, vence: null }            // sin fecha: no cuenta, se avisa
];
const reader = memoryReader({ customers: CUSTOMERS, credits: CREDITS, products: [] });

test('dueDay: AAAA-MM-DD y DD/MM/AAAA; fechas inválidas -> null', () => {
  assert.equal(dueDay('2026-10-15'), '2026-10-15'); assert.equal(dueDay('2026-10-15T00:00:00Z'), '2026-10-15');
  assert.equal(dueDay('5/1/2026'), '2026-01-05'); assert.equal(dueDay('05-01-2026'), '2026-01-05'); assert.equal(dueDay('05-01-2026 10:30'), '2026-01-05'); assert.equal(dueDay('2026-02-30'), null); assert.equal(dueDay(''), null); assert.equal(dueDay(null), null);
});

test('safeClientCode: el id no sale si es el DNI o el teléfono, ni si tiene caracteres raros', () => {
  assert.equal(safeClientCode('C1', CUSTOMERS[0]), 'C1');
  assert.equal(safeClientCode('41112222', CUSTOMERS[2]), null);
  assert.equal(safeClientCode('Rosa Quispe', null), null);
});

test('creditos_atrasados: solo vencidos con saldo, agrupados por cliente, ordenados por atraso; pantalla con nombre y borrador', async () => {
  const r = await runAssistantQuery(reader, { tipo: 'creditos_atrasados' }, NOW);
  assert.ok(!r.error);
  assert.equal(r.clientes, 3); assert.equal(r.total, 3, 'total = filas (Mostrando N de total)'); assert.equal(r.total_soles, 162.5);
  assert.deepEqual(r.filas.map((f) => [f[0], f[2], f[3]]), [['Ana Torres', 100, 143], ['Rosa Quispe', 50, 51], ['Juan Pérez', 12.5, 1]]);
  assert.match(r.filas[1][4], /^Hola Rosa Quispe, .*S\/ 50\.00 vencido desde el 01\/09\/2026/);
  assert.match(r.texto, /3 clientes tienen créditos atrasados por S\/ 162\.50/); assert.match(r.texto, /1 crédito con saldo y sin fecha/);
  for (const c of CUSTOMERS) assert.ok(!r.texto.includes(c.nombre), 'el texto (que queda en el historial) no lleva nombres');
});

test('creditos_atrasados: al modelo solo totales, rangos y código; nunca nombre, DNI ni teléfono', async () => {
  const r = await runAssistantQuery(reader, { tipo: 'creditos_atrasados' }, NOW);
  const sent = JSON.stringify(r.resumen);
  for (const c of CUSTOMERS) { assert.ok(!sent.includes(c.nombre), c.nombre); assert.ok(!sent.includes(c.dni), c.dni); assert.ok(!sent.includes(c.tel), c.tel); }
  assert.ok(!/Hola|recuerd/i.test(sent), 'el borrador no va al modelo');
  assert.deepEqual(r.resumen.por_rango, { '1-7 días': 1, '8-30 días': 0, '31-90 días': 1, 'más de 90 días': 1 });
  assert.deepEqual(r.resumen.mas_atrasados.map((x) => x.cliente), ['Cliente 1', 'cliente #C1', 'cliente #C2']);
  assert.equal(r.resumen.total_vencido_soles, 162.5); assert.equal(r.resumen.sin_fecha, 1);
});

test('sin atrasados: mensaje claro', async () => {
  const r = await runAssistantQuery(memoryReader({ customers: CUSTOMERS, credits: [{ cliente: 'C1', saldo: 5, vence: '2027-01-01' }] }), { tipo: 'creditos_atrasados' }, NOW);
  assert.equal(r.clientes, 0); assert.equal(r.texto, 'Ningún cliente tiene créditos atrasados.');
});

test('reminderDraft: es un borrador de texto, sin enlaces ni envío', () => {
  const t = reminderDraft('Rosa', 10, '2026-10-01');
  assert.ok(!/https?:|wa\.me/i.test(t)); assert.match(t, /S\/ 10\.00/);
});

test('empleado: la consulta no se le ofrece y, si el modelo la pide, se descarta', () => {
  for (const role of ['empleado:consultas', 'empleado:consultas_documentos']) {
    const c = toolsForRole(role).find((t) => t.function.name === 'consultar');
    assert.ok(!c || !JSON.stringify(c).includes('creditos_atrasados'), role);
    const p = toProposal({ id: 'x', name: 'consultar', arguments: JSON.stringify({ tipo: 'creditos_atrasados' }) }, role, { products: [] }, 0);
    assert.equal(p.dropped, 'query_admin_only', role);
    const caja = toProposal({ id: 'y', name: 'consultar', arguments: JSON.stringify({ tipo: 'caja_abierta' }) }, role, { products: [] }, 0);
    assert.equal(caja.dropped, 'query_admin_only', role + ': caja_abierta también es solo del Admin');
    assert.equal(employeeToolGuard(role)({ name: 'consultar', arguments: '{"tipo":"caja_abierta"}' }), 'query_admin_only', role + ': guard a mitad del texto');
  }
  assert.ok(ADMIN_ONLY_QUERY_TYPES.includes('caja_abierta'));
  const owner = toolsForRole('owner').find((t) => t.function.name === 'consultar');
  assert.ok(JSON.stringify(owner).includes('creditos_atrasados'));
});

function route(text, role) {
  const cap = [], reads = [], store = createMemoryUsageStore();
  const spy = Object.fromEntries(Object.entries(reader).map(([k, fn]) => [k, (...a) => { reads.push(k); return fn(...a); }]));
  const f = async (url, init) => { cap.push(String(init.body)); const n = cap.length;
    const msg = n === 1 ? { content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'consultar', arguments: JSON.stringify({ tipo: 'creditos_atrasados' }) } }] } : { content: 'Tiene clientes atrasados; revise la tabla.' };
    return json({ choices: [{ message: msg }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); };
  return assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, json,
    { store, resolveRole: async () => role, fetch: f, reader: spy, audit: async () => {}, mockChunkMs: 0, now: () => NOW }).then(async (r) => ({ r, cap, store, reads }));
}

test('chat del Admin: la tabla llega a su pantalla y al modelo solo el resumen sin nombres', async () => {
  const { r, cap } = await route('¿Quiénes tienen créditos atrasados?', 'owner');
  assert.equal(r.status, 200); const body = await r.text();
  assert.ok(body.includes('Rosa Quispe') && body.includes('Recordatorio'), 'la pantalla del Admin ve nombres y borrador');
  assert.equal(cap.length, 1, 'consulta simple: va el texto de la consulta, sin segunda llamada (#960)');
  for (const c of CUSTOMERS) for (const v of [c.nombre, c.dni, c.tel]) assert.ok(!cap.join('\n').includes(v), 'al modelo: ' + v);
});

test('chat del empleado, frase clara: 403 query_admin_only sin modelo, sin cupo y sin leer la base', async () => {
  for (const role of ['empleado:consultas', 'empleado:consultas_documentos']) {
    const { r, cap, store, reads } = await route('¿Quiénes tienen créditos atrasados?', role);
    assert.equal(r.status, 403, role); const d = await r.json(); assert.equal(d.error, 'query_admin_only');
    assert.equal(cap.length, 0, 'sin modelo'); assert.equal(store._map.size, 0, 'sin cupo'); assert.equal(reads.length, 0, 'sin leer la base');
    for (const c of CUSTOMERS) assert.ok(!JSON.stringify(d).includes(c.nombre), c.nombre);
  }
});

test('chat del empleado, el modelo la pide igual: 403 sin leer la base ni segunda llamada', async () => {
  const { r, cap, reads } = await route('Dame el reporte de cobranza', 'empleado:consultas_documentos');
  assert.equal(r.status, 403); const body = await r.text(); assert.match(body, /query_admin_only/);
  assert.equal(cap.length, 1, 'una sola llamada al modelo'); assert.equal(reads.length, 0, 'sin leer la base');
  for (const c of CUSTOMERS) assert.ok(!body.includes(c.nombre), c.nombre);
  assert.ok(!/162\.5|Recordatorio/.test(body));
});

test('cuotas: solo cuenta lo pendiente de las cuotas vencidas; lo pagado cubre primero las más antiguas', () => {
  const cuotas = parseCuotas(JSON.stringify([{ number: 2, due_date: '2026-10-01', amount_cents: 3000 }, { number: 1, due_date: '2026-09-01', amount_cents: 3000 }, { number: 3, due_date: '2026-11-01', amount_cents: 3000 }]));
  assert.deepEqual(cuotas, [{ vence: '2026-09-01', soles: 30 }, { vence: '2026-10-01', soles: 30 }, { vence: '2026-11-01', soles: 30 }]);
  // vence final en noviembre, pero la 1 y la 2 ya vencieron: sin abonos, S/ 60 desde el 01/09
  assert.deepEqual(overduePart({ saldo: 90, original: 90, vence: '2026-11-01', cuotas }, '2026-10-22'), { soles: 60, desde: '2026-09-01' });
  // abonó S/ 40: la cuota 1 está pagada y de la 2 faltan S/ 20
  assert.deepEqual(overduePart({ saldo: 50, original: 90, vence: '2026-11-01', cuotas }, '2026-10-22'), { soles: 20, desde: '2026-10-01' });
  assert.equal(overduePart({ saldo: 30, original: 90, cuotas }, '2026-10-22'), null);
  // saldo inicial que no coincide con las cuotas: lo pagado se calcula con la suma de cuotas (90 - 50 = 40), no con 120 - 50
  assert.deepEqual(overduePart({ saldo: 50, original: 120, vence: '2026-11-01', cuotas }, '2026-10-22'), { soles: 20, desde: '2026-10-01' });
  // saldo mayor que las cuotas: lo de fuera cuenta desde el vencimiento del crédito si ya pasó
  assert.deepEqual(overduePart({ saldo: 100, vence: '2026-08-15', cuotas }, '2026-10-22'), { soles: 70, desde: '2026-08-15' });
  assert.deepEqual(overduePart({ saldo: 100, vence: '2026-12-01', cuotas }, '2026-10-22'), { soles: 60, desde: '2026-09-01' });
  assert.deepEqual(parseCuotas('roto'), []); assert.deepEqual(parseCuotas('[]'), []);
});

test('créditos sin vencimiento propio: emisión + plazo; sin plazo siguen «sin fecha»', () => {
  assert.equal(termDue('2026-09-01', 30), '2026-10-01'); assert.equal(termDue('01/09/2026', 0), '2026-09-01');
  assert.equal(termDue('2026-09-01', null), null); assert.equal(termDue(null, 30), null);
});

test('lista cortada: se avisa y al modelo va «Cliente N», nunca un id sin ficha', async () => {
  const rd = memoryReader({ customers: [], customersTruncated: true, credits: [{ cliente: '45678912', saldo: 10, vence: '2026-10-01' }] });
  const r = await runAssistantQuery(rd, { tipo: 'creditos_atrasados' }, NOW);
  assert.equal(r.truncado, true); assert.equal(r.resumen.truncado, true); assert.match(r.texto, /se cortó/);
  assert.deepEqual(r.resumen.mas_atrasados.map((x) => x.cliente), ['Cliente 1']); assert.ok(!JSON.stringify(r.resumen).includes('45678912'));
});
