// Caja abierta (solo Admin, SOLO LECTURA): el asistente lee la sesión abierta de la vista canonical_cash_state (la misma que pinta
// «Efectivo esperado» en Caja y con la que el servidor acepta el cierre) en 2 consultas, con el desglose sumado en SQL.
// Base SQLite en memoria con la vista COPIADA de la migración 0017 (no una réplica a mano); filas inventadas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runAssistantQuery, canonicalReader, memoryReader, QUERY_TYPES } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { assistantChatRoute, createMemoryUsageStore, toolsForRole, systemPrompt, redactText } from '../../tools/cloudflare-lab/src/pos-assistant.js';

const MIG = new URL('../../infra/database/migrations/0017_canonical_live_customers.sql', import.meta.url);
const VIEW = /CREATE VIEW canonical_cash_state AS[\s\S]*?;\n/.exec(readFileSync(MIG, 'utf8'))[0];
const NAMES = ['Rosa Quispe', 'Juan Cajero', 'Cliente Secreto'];

function fakeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE canonical_control(id INTEGER PRIMARY KEY, active_promotion_id TEXT, mode TEXT);
    CREATE TABLE canonical_cash_sessions(session_id TEXT PRIMARY KEY, promotion_id TEXT, open_operation_id TEXT, opening_cents INTEGER, cash_movement_watermark INTEGER, opened_at TEXT,
      opened_by_user_id TEXT, opened_by_name TEXT);
    CREATE TABLE canonical_cash_closures(session_id TEXT PRIMARY KEY, close_operation_id TEXT, expected_cents INTEGER, counted_cents INTEGER, difference_cents INTEGER,
      cash_movement_watermark INTEGER, closed_at TEXT, closed_by_user_id TEXT, closed_by_name TEXT);
    CREATE TABLE canonical_financial_events(event_id TEXT PRIMARY KEY, operation_id TEXT, promotion_id TEXT, event_type TEXT, session_id TEXT, credit_id TEXT, credit_provenance TEXT,
      credit_delta_cents INTEGER DEFAULT 0, cash_delta_cents INTEGER DEFAULT 0, payment_method TEXT, reference TEXT, reason TEXT, compensates_operation_id TEXT, created_at TEXT);
    CREATE TABLE canonical_expenses(expense_id TEXT PRIMARY KEY, operation_id TEXT, promotion_id TEXT, session_id TEXT, amount_cents INTEGER, cash_delta_cents INTEGER, concept TEXT,
      category TEXT, payment_method TEXT, expense_date TEXT, note TEXT, created_at TEXT);
    CREATE TABLE canonical_sale_context(sale_id TEXT PRIMARY KEY, promotion_id TEXT);
    CREATE TABLE cash_movements(movement_id TEXT PRIMARY KEY, operation_id TEXT, sale_id TEXT, payment_method TEXT, amount_cents INTEGER, cash_cents INTEGER, digital_cents INTEGER,
      credit_cents INTEGER, digital_method TEXT, reference TEXT, created_at TEXT);
    ${VIEW}
    INSERT INTO canonical_control VALUES(1,'P1','ACTIVE');`);
  let calls = 0;
  const d1 = { prepare(sql) { calls++; const st = db.prepare(sql); let args = [];
    const o = { bind(...a) { args = a; return o; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { throw new Error('escritura prohibida'); } };
    return o; } };
  let mv = 0;
  const sale = (id, at, cash, digital, credit, dm = null) => { mv++; db.prepare('INSERT INTO canonical_sale_context VALUES(?,?)').run(id, 'P1');
    db.prepare('INSERT INTO cash_movements VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('M' + mv, 'op-m' + mv, id, credit ? 'credito' : digital && cash ? 'mixto' : digital ? dm : 'efectivo', cash + digital + credit, cash, digital, credit, dm, null, at); };
  const maxRow = () => db.prepare('SELECT COALESCE(MAX(rowid),0) AS m FROM cash_movements').get().m;
  return { db, d1, sale, maxRow, calls: () => calls, reset: () => { calls = 0; } };
}

// Sesión cerrada ayer (con ventas que NO deben contar hoy) + sesión abierta hoy con pagos mixtos, cobros, ingreso, egreso, anulación y gasto.
function scenario({ open = true } = {}) {
  const f = fakeDb(), { db } = f;
  db.prepare("INSERT INTO canonical_cash_sessions VALUES('S0','P1','o0',5000,0,'2026-10-21T13:00:00.000Z','u1',?)").run(NAMES[1]);
  f.sale('V0', '2026-10-21T15:00:00.000Z', 99900, 0, 0);
  db.prepare("INSERT INTO canonical_cash_closures VALUES('S0','c0',104900,104900,0,?,'2026-10-22T02:00:00.000Z','u1',?)").run(f.maxRow(), NAMES[1]);
  if (!open) return f;
  db.prepare("INSERT INTO canonical_cash_sessions VALUES('S1','P1','o1',10000,?,'2026-10-22T13:15:00.000Z','u1',?)").run(f.maxRow(), NAMES[1]);
  f.sale('V1', '2026-10-22T14:00:00.000Z', 2500, 0, 0);               // efectivo 25.00
  f.sale('V2', '2026-10-22T14:10:00.000Z', 0, 1800, 0, 'yape');        // yape 18.00
  f.sale('V3', '2026-10-22T14:20:00.000Z', 1000, 700, 0, 'plin');      // mixto: 10.00 efectivo + 7.00 plin
  f.sale('V4', '2026-10-22T14:30:00.000Z', 0, 0, 4000);                // crédito 40.00
  f.sale('V5', '2026-10-22T14:40:00.000Z', 300, 0, 0);                 // efectivo 3.00 (luego anulada)
  const ev = db.prepare('INSERT INTO canonical_financial_events(event_id,operation_id,promotion_id,event_type,session_id,credit_id,credit_delta_cents,cash_delta_cents,payment_method,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  ev.run('E1', 'oe1', 'P1', 'PAYMENT', 'S1', 'CR1', -1500, 1500, 'efectivo', null, '2026-10-22T15:00:00.000Z');          // cobro efectivo 15.00
  ev.run('E2', 'oe2', 'P1', 'PAYMENT', null, 'CR2', -900, 0, 'yape', null, '2026-10-22T15:05:00.000Z');                 // cobro yape 9.00 (sin caja)
  ev.run('E2b', 'oe2b', 'P1', 'PAYMENT', null, 'CR2', -555, 0, 'yape', null, '2026-10-21T15:05:00.000Z');               // de ayer: no cuenta
  ev.run('E3', 'oe3', 'P1', 'ADJUSTMENT', 'S1', null, 0, 2000, null, 'Sencillo para vuelto', '2026-10-22T15:10:00.000Z'); // ingreso 20.00
  ev.run('E4', 'oe4', 'P1', 'ADJUSTMENT', 'S1', null, 0, -1200, null, 'Retiro ' + NAMES[0], '2026-10-22T15:20:00.000Z'); // egreso 12.00
  ev.run('E5', 'oe5', 'P1', 'ADJUSTMENT', 'S1', null, 0, -300, null, 'Anulación de venta V5: error', '2026-10-22T15:30:00.000Z'); // devolución 3.00
  db.prepare("INSERT INTO canonical_expenses VALUES('G1','og1','P1','S1',800,-800,'Agua','Servicios','efectivo','2026-10-22',?,'2026-10-22T16:00:00.000Z')").run(NAMES[2]);
  db.prepare("INSERT INTO canonical_expenses VALUES('G2','og2','P1','S1',1100,0,'Luz','Servicios','yape','2026-10-22',null,'2026-10-22T16:10:00.000Z')").run();
  return f;
}
// Esperado = fondo 100 + ventas efectivo (25+10+3) + cobro efectivo 15 + ingreso 20 − egreso 12 − devolución 3 − gasto efectivo 8 = 150.00
const ESPERADO = 150;

test('caja abierta: pagos mixtos y movimientos -> Esperado igual a la vista canonical_cash_state (pantalla Caja / cierre)', async () => {
  const f = scenario(); f.reset();
  const r = await runAssistantQuery(canonicalReader(f.d1), { tipo: 'caja_abierta' });
  assert.ok(!r.error);
  const view = f.db.prepare("SELECT expected_cents FROM canonical_cash_state WHERE status='OPEN'").get().expected_cents;
  assert.equal(view / 100, ESPERADO, 'la vista misma da 150.00');
  const m = r.resumen;
  assert.equal(m.caja_abierta, true); assert.equal(m.abierta_desde, '2026-10-22 08:15');
  assert.equal(m.fondo_inicial_soles, 100); assert.equal(m.efectivo_esperado_soles, ESPERADO); assert.equal(r.total, ESPERADO);
  assert.equal(m.desglose_cuadra, true, 'fondo + efectivo ventas + cobros + ingresos − egresos − devoluciones − gastos = Esperado');
  assert.equal(m.ventas, 5); assert.equal(m.ventas_soles, 103);
  assert.deepEqual(m.por_metodo, { Efectivo: 38, Yape: 18, Plin: 7, 'Crédito': 40 });
  assert.equal(m.cobros_efectivo_soles, 15); assert.equal(m.cobros_digitales_soles, 9, 'cobro digital sin caja desde la apertura; el de ayer no');
  assert.equal(m.ingresos_soles, 20); assert.equal(m.egresos_soles, 12); assert.equal(m.devoluciones_anulacion_soles, 3);
  assert.equal(m.gastos, 2); assert.equal(m.gastos_efectivo_soles, 8); assert.equal(m.gastos_total_soles, 19);
  assert.match(r.texto, /La caja todavía está abierta/); assert.match(r.texto, /S\/ 150\.00/);
  assert.ok(!/contado|diferencia/i.test(JSON.stringify(r.filas)), 'sin cifras de cierre');
  assert.ok(!JSON.stringify(r).includes('999'), 'la venta de la caja de ayer no entra');
});

test('caja abierta: a lo más 2 consultas a la base (sin paginar ventas), nada escribe', async () => {
  const f = scenario();
  for (let i = 0; i < 300; i++) f.sale('X' + i, '2026-10-22T17:00:00.000Z', 100, 0, 0);
  f.reset();
  const r = await runAssistantQuery(canonicalReader(f.d1), { tipo: 'caja_abierta' });
  assert.equal(f.calls(), 2, 'una lectura de la sesión + una del desglose agrupado');
  assert.equal(r.resumen.ventas, 305); assert.equal(r.resumen.efectivo_esperado_soles, ESPERADO + 300); assert.equal(r.resumen.desglose_cuadra, true);
  const g = scenario({ open: false }); g.reset();
  await runAssistantQuery(canonicalReader(g.d1), { tipo: 'caja_abierta' });
  assert.equal(g.calls(), 1, 'sin caja abierta: una sola lectura');
});

test('sin caja abierta: «No hay caja abierta» con la fecha del último cierre y ninguna cifra', async () => {
  const f = scenario({ open: false });
  const r = await runAssistantQuery(canonicalReader(f.d1), { tipo: 'caja_abierta' });
  assert.equal(r.texto, 'No hay caja abierta. La última caja se cerró el 21/10/2026.');
  assert.deepEqual(r.resumen, { caja_abierta: false, ultimo_cierre: '2026-10-21' });
  assert.deepEqual(r.filas, []); assert.ok(!/\d+\.\d{2}|S\//.test(r.texto + JSON.stringify(r.resumen)), 'ningún monto');
  // Sin esquema de caja (tabla faltante) o sin promoción activa: tampoco hay números.
  const bare = { prepare() { return { bind() { return this; }, async first() { throw new Error('D1_ERROR: no such table: canonical_cash_state'); }, async all() { throw new Error('no such table'); } }; } };
  const r2 = await runAssistantQuery(canonicalReader(bare), { tipo: 'caja_abierta' });
  assert.equal(r2.resumen.sin_datos, true); assert.ok(!/S\//.test(r2.texto));
  const r3 = await runAssistantQuery(memoryReader({}), { tipo: 'caja_abierta' });
  assert.equal(r3.resumen.sin_datos, true);
});

test('al modelo solo totales: sin nombres de cajero, clientes ni conceptos; y pasa el filtro tal cual', async () => {
  const f = scenario();
  const r = await runAssistantQuery(canonicalReader(f.d1), { tipo: 'caja_abierta' });
  const all = JSON.stringify(r);
  for (const n of NAMES) assert.ok(!all.includes(n), 'filtró ' + n);
  for (const w of ['Agua', 'Luz', 'Sencillo', 'CR1', 'S1', 'V1']) assert.ok(!all.includes('"' + w) && !all.includes(w + '"'), 'filtró ' + w);
  const forModel = JSON.stringify({ tipo: r.tipo, resumen: r.resumen });
  assert.equal(redactText(forModel), forModel, 'el filtro de datos sensibles no tapa nada (no hay nada personal)');
  assert.ok(forModel.length < 1500);
});

test('empleado: no ve la consulta y si el modelo la pide igual recibe 403 query_admin_only sin leer la base', async () => {
  assert.ok(QUERY_TYPES.includes('caja_abierta'));
  const emp = JSON.stringify(toolsForRole('empleado:consultas_documentos'));
  assert.ok(!emp.includes('caja_abierta'), 'el empleado no la tiene en su lista');
  assert.ok(JSON.stringify(toolsForRole('owner')).includes('caja_abierta'));
  assert.match(systemPrompt('owner', {}), /caja_abierta/);
  let reads = 0; const reader = { cashOpen: async () => { reads++; return { ready: true, open: { opened_at: '2026-10-22T13:00:00Z', opening_cents: 77777, expected_cents: 77777 }, rows: [] }; } };
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  const bodies = [];
  const fetch = async (url, init) => { bodies.push(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'consultar', arguments: '{"tipo":"caja_abierta"}' } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })); };
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: '¿cuánto hay en caja?', context: { products: [] } }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef', DEEPSEEK_API_KEY: 'k' }, { principalId: 'dev-emp', posRole: 'empleado' }, json,
    { store: createMemoryUsageStore(), resolveRole: async () => 'empleado:consultas', fetch, reader });
  assert.equal(res.status, 403, 'caja_abierta es solo del Admin: 403, no 200 con la consulta descartada');
  const body = await res.json();
  assert.equal(body.error, 'query_admin_only');
  assert.equal(reads, 0, 'no se leyó la caja');
  assert.ok(!JSON.stringify(body).includes('777'), 'ninguna cifra de caja');
  assert.equal(bodies.length, 1, 'sin segunda llamada con datos');
});
