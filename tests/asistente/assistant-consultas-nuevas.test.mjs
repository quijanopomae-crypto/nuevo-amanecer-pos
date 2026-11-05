// Consultas nuevas del asistente (solo lectura): ganancia, productos_sin_ventas, deuda_cliente y ventas_por_hora.
// Números exactos sobre datos inventados, bordes del día de Lima, ganancia SOLO con permiso de costos y, en deuda_cliente,
// nada de nombres, DNI ni teléfonos hacia el modelo. El SQL (fecha filtrada en la base, anuladas fuera, LIMIT) se prueba con
// node:sqlite (Node 22+) y además corre sobre la base real del arnés canónico. DeepSeek siempre simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { assistantChatRoute, createMemoryUsageStore, toolsForRole, toProposal, costQueryAllowed, COSTS_ADMIN_ONLY, systemPrompt } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { runAssistantQuery, memoryReader, canonicalReader, QUERY_TYPES, COST_QUERY_TYPES, NEW_QUERY_LIMITS, DATE_WORDS, dateWord, dateWordRange, period, summaryPeriods, limaCalendarLine } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { mockAssistantReply } from '../../tools/cloudflare-lab/src/pos-assistant-mock.js';
import { activeCanon } from '../cloud-sync/canon-browser-harness.mjs';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const tool = (name, args, id = 'call_' + name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const NOW = Date.parse('2026-10-22T20:00:00.000Z'); // 2026-10-22 15:00 en Lima
const at = (day, h) => new Date(Date.parse(day + 'T00:00:00Z') + (h + 5) * 3600000).toISOString(); // hora de Lima -> ISO
const PII = ['Rosa Quispe Huamán', 'Juan Mamani', '40112233', '45556677', '987654321', '+51 912 345 678', 'Jr. Las Flores 123'];
const NEW = ['ganancia', 'productos_sin_ventas', 'deuda_cliente', 'ventas_por_hora'];
const DATA = {
  products: [
    { id: 'P1', nombre: 'Arroz 1 kg', precio: 4, costo: 3, stock: 50, min: 5, controla: true },
    { id: 'P2', nombre: 'Aceite 1 L', precio: 10, costo: 8, stock: 20, min: 5, controla: true },
    { id: 'P3', nombre: 'Fideos 500 g', precio: 2.5, costo: 1.8, stock: 80, min: 10, controla: true },
    { id: 'P4', nombre: 'Galleta suelta', precio: 2.5, costo: 0, stock: 3, min: 1, controla: true },      // sin costo
    { id: 'P5', nombre: 'Lejía 1 L', precio: 3, costo: 2, stock: 7, min: 2, controla: true },            // vendido solo en septiembre
    { id: 'P6', nombre: 'Bolsa de regalo', precio: 1, costo: 0.5, stock: 0, min: 0, controla: false }     // nunca vendido, sin control
  ],
  customers: [{ id: 'C1', nombre: PII[0], dni: PII[2], telefono: PII[4], direccion: PII[6] }, { id: '12', nombre: PII[1], dni: PII[3], telefono: PII[5] }],
  credits: [
    { cliente: 'C1', saldo: 30, vence: '2026-10-01', fecha: '2026-09-01', nombre: PII[0], dni: PII[2] },
    { cliente: 'C1', saldo: 5, vence: '2026-11-10', fecha: '2026-10-10', nombre: PII[0], telefono: PII[4] },
    { cliente: 'C1', saldo: 0, vence: '2026-08-30', fecha: '2026-08-01' },                                 // pagado: no cuenta
    { cliente: '12', saldo: 12, vence: '2026-11-01', fecha: '2026-10-15', nombre: PII[1] }
  ],
  sales: [
    { sale_id: 'S9', created_at: '2026-10-22T05:00:00.000Z', metodo: 'efectivo', total_cents: 700 },     // 00:00 Lima del 22: es de hoy
    { sale_id: 'S1', created_at: at('2026-10-22', 9), metodo: 'efectivo', total_cents: 2000 },
    { sale_id: 'S8', created_at: at('2026-10-22', 9.5), metodo: 'yape', total_cents: 500 },
    { sale_id: 'S2', created_at: at('2026-10-22', 11), metodo: 'credito', total_cents: 1000 },
    { sale_id: 'S3', created_at: at('2026-10-22', 12), metodo: 'mixto', total_cents: 3000 },
    { sale_id: 'S4', created_at: at('2026-10-22', 13), metodo: 'yape', total_cents: 9900, anulada: true }, // anulada: no cuenta
    { sale_id: 'S5', created_at: '2026-10-22T04:59:59.000Z', metodo: 'efectivo', total_cents: 4000 },    // 21 a las 23:59 Lima (22 en UTC): es de AYER
    { sale_id: 'S10', created_at: '2026-10-23T05:00:00.000Z', metodo: 'efectivo', total_cents: 111 },    // 00:00 Lima del 23: no es de hoy
    { sale_id: 'S6', created_at: at('2026-09-10', 10), metodo: 'plin', total_cents: 600 }
  ],
  saleItems: [
    { sale_id: 'S9', product_id: 'P3', quantity: 2, line_total_cents: 700 },
    { sale_id: 'S1', product_id: 'P1', quantity: 5, line_total_cents: 2000 },
    { sale_id: 'S8', product_id: 'P4', quantity: 2, line_total_cents: 500 },
    { sale_id: 'S2', product_id: 'P3', quantity: 4, line_total_cents: 1000 },
    { sale_id: 'S3', product_id: 'P2', quantity: 3, line_total_cents: 3000 },
    { sale_id: 'S4', product_id: 'P2', quantity: 99, line_total_cents: 9900 },
    { sale_id: 'S5', product_id: 'P1', quantity: 10, line_total_cents: 4000 },
    { sale_id: 'S10', product_id: 'P6', quantity: 1, line_total_cents: 111 },
    { sale_id: 'S6', product_id: 'P5', quantity: 2, line_total_cents: 600 }
  ]
};
const reader = () => memoryReader(DATA);
const q = (tipo, args = {}, rd = reader()) => runAssistantQuery(rd, { tipo, ...args }, NOW);
const env = (x = {}) => ({ ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, ...x });
async function chat(body, { role = 'owner', fetch, rd, e = env({ DEEPSEEK_API_KEY: 'k' }) } = {}) {
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { products: DATA.products }, ...body }) }),
    e, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, json,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch, reader: rd, audit: async () => {}, now: () => NOW });
  return { status: r.status, body: await r.json() };
}
function scripted(responses, cap) {
  let i = 0;
  return async (_u, init) => { cap.push(String(init.body)); return new Response(JSON.stringify({ choices: [{ message: responses[Math.min(i++, responses.length - 1)] }], usage: { prompt_tokens: 1, completion_tokens: 1 } })); };
}
function counting(base) { const n = { reads: 0 }; const r = {}; for (const k of Object.keys(base)) r[k] = async (...a) => { n.reads++; return base[k](...a); }; return [r, n]; }
const row = (r, label) => r.filas.find((f) => String(f[0]).startsWith(label));

test('los 4 tipos nuevos están en el enum del Admin y responden sin error con resumen chico', async () => {
  for (const t of NEW) assert.ok(QUERY_TYPES.includes(t), t);
  assert.deepEqual([...COST_QUERY_TYPES], ['ganancia']);
  const def = toolsForRole('owner').find((t) => t.function.name === 'consultar').function;
  for (const t of NEW) assert.ok(def.parameters.properties.tipo.enum.includes(t), t);
  assert.ok(def.parameters.properties.cliente_id, 'cliente_id en el esquema');
  for (const w of ['cuánto gané hoy', 'qué productos no se venden', 'cuánto debe el cliente 12', 'a qué hora vendo más']) assert.ok(def.description.includes(w), w);
  for (const tipo of NEW) {
    const r = await q(tipo, { cliente_id: 'C1' });
    assert.ok(!r.error, tipo); assert.ok(Array.isArray(r.filas) && r.texto && r.resumen, tipo);
    assert.ok(JSON.stringify(r.resumen).length < 1500, tipo);
  }
});

test('ganancia de hoy: ventas − costo de lo vendido; sin costo aparte; anuladas y otros días fuera', async () => {
  const r = await q('ganancia');
  assert.equal(r.titulo, 'Ganancia 2026-10-22');
  const s = r.resumen;
  assert.equal(s.ventas_soles, 72);             // 7 + 20 + 5 + 10 + 30 (S4 anulada, S5 de ayer, S10 de mañana)
  assert.equal(s.ventas_con_costo_soles, 67);   // sin P4 (5 soles sin costo)
  assert.equal(s.costo_soles, 49.8);            // P1 5×3 + P3 6×1.8 + P2 3×8
  assert.equal(s.ganancia_soles, 17.2);
  assert.equal(s.margen_pct, 25.7);
  assert.equal(s.ventas_sin_costo_soles, 5); assert.equal(s.productos_sin_costo, 1);
  assert.deepEqual(s.top_ganancia.map((x) => [x.producto, x.ganancia_soles]), [['producto #P3', 6.2], ['producto #P2', 6], ['producto #P1', 5]]);
  assert.equal(row(r, 'Ganancia')[1], 17.2); assert.equal(row(r, 'Ventas sin costo')[1], 5);
  assert.match(row(r, 'Top 1')[0], /Fideos 500 g \(producto #P3\)/, 'el nombre solo en la tabla del Admin');
  assert.ok(!/Arroz|Aceite|Fideos|Galleta/.test(JSON.stringify(s) + r.texto), 'al modelo solo códigos');
  assert.match(r.texto, /S\/ 17\.20/);
  const ayer = await q('ganancia', { periodo: 'ayer' });
  assert.equal(ayer.resumen.ventas_soles, 40); assert.equal(ayer.resumen.ganancia_soles, 10); // S5: 10 × (4 − 3)
  const vacio = await q('ganancia', { desde: '2026-08-01', hasta: '2026-08-02' });
  assert.equal(vacio.resumen.ventas_soles, 0); assert.match(vacio.texto, /No hay ventas/);
});

test('productos sin ventas: por defecto 30 días de Lima, de más stock a menos, tope de 50 filas', async () => {
  const r = await q('productos_sin_ventas');
  assert.deepEqual([r.desde, r.hasta], ['2026-09-23', '2026-10-22']);
  assert.deepEqual(r.filas, [['Lejía 1 L (producto #P5)', 7], ['Bolsa de regalo (producto #P6)', 'sin control']]); // P6 vendido «mañana» no cuenta
  assert.equal(r.total, 2); assert.equal(r.resumen.sin_ventas, 2); assert.equal(r.resumen.revisados, 6);
  assert.deepEqual(r.resumen.primeros, [{ producto: 'producto #P5', stock: 7 }, { producto: 'producto #P6', stock: null }]);
  assert.ok(!/Lejía|Bolsa/.test(JSON.stringify(r.resumen) + r.texto));
  const sep = await q('productos_sin_ventas', { periodo: 'mes_pasado' });
  assert.deepEqual(sep.filas.map((f) => f[0].match(/#(\w+)/)[1]), ['P3', 'P1', 'P2', 'P4', 'P6']);
  const many = Array.from({ length: 120 }, (_, i) => ({ id: 'X' + i, nombre: 'Producto ' + i, stock: i, min: 0, controla: true }));
  const big = await q('productos_sin_ventas', {}, memoryReader({ ...DATA, products: many }));
  assert.equal(big.filas.length, NEW_QUERY_LIMITS.idleRows); assert.equal(big.total, 120); assert.equal(big.filas[0][1], 119);
  assert.ok(big.resumen.primeros.length <= 8); assert.ok(JSON.stringify(big.resumen).length < 1500);
});

test('deuda de un cliente por código: saldo, créditos abiertos y cuál vence primero (misma lectura que deudas_clientes); sin código pide el código', async () => {
  const r = await q('deuda_cliente', { cliente_id: 'C1' });
  assert.deepEqual(r.resumen, { cliente: 'cliente #C1', saldo_soles: 35, creditos_abiertos: 2, vence_primero: '2026-10-01' });
  assert.deepEqual(r.filas, [['2026-10-01', 30], ['2026-11-10', 5]]);
  assert.equal(r.texto, 'cliente #C1 debe S/ 35.00 en 2 créditos abiertos; el primero vence el 2026-10-01.');
  assert.deepEqual((await q('deuda_cliente', { cliente_id: '12' })).resumen, { cliente: 'cliente #12', saldo_soles: 12, creditos_abiertos: 1, vence_primero: '2026-11-01' });
  const none = await q('deuda_cliente', { cliente_id: 'C9' });
  // (auditoría 500, CLI-016) antes «No encontré deudas de cliente #C9» (¿no debe o no existe?): C9 no está en Clientes -> «No existe».
  assert.equal(none.resumen.cliente_encontrado, false); assert.match(none.texto, /^No existe cliente #C9 en Clientes/); assert.ok(!/S\/\s*\d/.test(none.texto));
  const sin = await q('deuda_cliente', {});
  assert.ok(!sin.error); assert.deepEqual(sin.filas, []); assert.equal(sin.resumen.falta, 'cliente_id');
  for (const bad of ['Rosa Quispe', '40112233', '987654321', "C1' OR 1=1"]) assert.equal((await q('deuda_cliente', { cliente_id: bad })).resumen.falta, 'cliente_id', bad);
  for (const x of [r, none]) for (const v of PII) assert.ok(!JSON.stringify(x).includes(v), v);
});

test('ventas por hora de Lima: bordes del día (00:00 y 23:59) y anuladas fuera', async () => {
  const r = await q('ventas_por_hora', { periodo: 'hoy' });
  assert.deepEqual(r.filas, [['00:00–00:59', 1, 7], ['09:00–09:59', 2, 25], ['11:00–11:59', 1, 10], ['12:00–12:59', 1, 30]]);
  assert.equal(r.resumen.ventas, 5); assert.equal(r.resumen.total_soles, 72);
  assert.deepEqual(r.resumen.mejor_hora, { hora: '12:00', ventas: 1, soles: 30 });
  assert.match(r.texto, /12:00–12:59/); assert.match(r.texto, /Con más ventas: 09:00–09:59 \(2\)/);
  const ayer = await q('ventas_por_hora', { periodo: 'ayer' });
  assert.deepEqual(ayer.filas, [['23:00–23:59', 1, 40]], '23:59 de Lima (04:59Z del 22) es del 21 a las 23');
  const dos = await q('ventas_por_hora', { desde: '2026-10-21', hasta: '2026-10-22' });
  assert.equal(dos.resumen.ventas, 6); assert.equal(dos.filas.at(-1)[0], '23:00–23:59');
});

test('ganancia: empleado sin permiso de costos -> 403 costs_admin_only, sin leer la base ni 2.ª llamada; ni la ve en su herramienta', async () => {
  for (const role of ['empleado:consultas', 'empleado:consultas_documentos']) {
    assert.equal(costQueryAllowed(role, 'ganancia'), false); assert.equal(costQueryAllowed(role, 'bajo_stock'), true);
    const cap = [], [rd, n] = counting(reader());
    const r = await chat({ text: 'cuánto gané hoy' }, { role, rd, fetch: scripted([{ content: '', tool_calls: [tool('consultar', { tipo: 'ganancia' }, 'c1')] }], cap) });
    assert.equal(r.status, 403, role); assert.deepEqual(r.body, { ...COSTS_ADMIN_ONLY });
    assert.equal(n.reads, 0, 'sin leer la base'); assert.equal(cap.length, 1, 'sin 2.ª llamada');
    const def = toolsForRole(role).find((t) => t.function.name === 'consultar');
    assert.ok(def && !def.function.parameters.properties.tipo.enum.includes('ganancia'));
    assert.equal(toProposal({ name: 'consultar', arguments: JSON.stringify({ tipo: 'ganancia' }) }, role, { products: [] }, 1).dropped, 'forbidden_costs');
    // Demostración: el mismo pedido en palabras también acaba en 403 sin leer nada.
    const [rd2, n2] = counting(reader());
    const d = await chat({ text: 'cuánto gané hoy' }, { role, rd: rd2, e: env({ ASSISTANT_DEMO: '1' }) });
    assert.equal(d.status, 403); assert.equal(d.body.error, 'costs_admin_only'); assert.equal(n2.reads, 0);
  }
  assert.equal(costQueryAllowed('owner', 'ganancia'), true);
  assert.equal(toProposal({ name: 'consultar', arguments: JSON.stringify({ tipo: 'ganancia' }) }, 'owner', { products: [] }, 1).type, 'consulta');
});

test('chat del Admin: deuda_cliente manda al modelo SOLO código, saldo, créditos y fecha; nunca nombre, DNI ni teléfono', async () => {
  const cap = [];
  // «explícame»: va la segunda llamada (con #960 una consulta simple responde sin ella) y se revisa lo que recibe el modelo.
  const r = await chat({ text: '¿Cuánto debe el cliente #C1? Explícame.' }, { rd: reader(), fetch: scripted([{ content: '', tool_calls: [tool('consultar', { tipo: 'deuda_cliente', cliente_id: 'C1' }, 'call_1')] }, { content: 'cliente #C1 debe S/ 35.00.' }], cap) });
  assert.equal(r.status, 200); assert.equal(cap.length, 2);
  const toolMsg = JSON.parse(cap[1]).messages.find((m) => m.role === 'tool');
  const sent = JSON.parse(toolMsg.content);
  assert.deepEqual(sent, { tipo: 'deuda_cliente', resumen: { cliente: 'cliente #C-0001', saldo_soles: 35, creditos_abiertos: 2, vence_primero: '2026-10-01' } });
  // Hacia la IA el código va neutro (pos-assistant-codigos.js); el aparato recibe el real.
  for (const body of cap) { assert.ok(!/#C1\b|"C1"/.test(body), 'al modelo llegó el código real'); for (const v of PII) assert.ok(!body.includes(v), 'al modelo llegó ' + v); }
  const p = r.body.proposals.find((x) => x.type === 'consulta'); assert.equal(p.result.filas.length, 2); assert.equal(p.query.cliente_id, 'C1'); assert.match(r.body.reply, /cliente #C1\b/);
  // Un nombre en vez de código no llega a la consulta.
  assert.equal(toProposal({ name: 'consultar', arguments: JSON.stringify({ tipo: 'deuda_cliente', cliente_id: PII[0] }) }, 'owner', { products: [] }, 1).query.cliente_id, null);
});

test('chat del Admin: ganancia y ventas por hora llegan al modelo solo con códigos de producto y números', async () => {
  for (const [tipo, check] of [['ganancia', (s) => assert.equal(s.ganancia_soles, 17.2)], ['ventas_por_hora', (s) => assert.equal(s.mejor_hora.hora, '23:00', 'sin período = esta semana: el 21 a las 23:00 vendió S/ 40')], ['productos_sin_ventas', (s) => assert.equal(s.sin_ventas, 2)]]) {
    const cap = [];
    const r = await chat({ text: 'dime y explícame' }, { rd: reader(), fetch: scripted([{ content: '', tool_calls: [tool('consultar', { tipo }, 'call_1')] }, { content: 'Listo.' }], cap) }); // «explícame»: segunda llamada (#960)
    assert.equal(r.status, 200, tipo);
    const content = JSON.parse(cap[1]).messages.find((m) => m.role === 'tool').content, sent = JSON.parse(content);
    assert.equal(sent.tipo, tipo); check(sent.resumen);
    // El resultado de la consulta (lo único que agrega la 2.ª llamada) va sin nombres de producto: solo códigos.
    assert.ok(!/Arroz|Aceite|Fideos|Galleta|Lejía|Bolsa/.test(content), tipo + ': sin nombres de producto');
    if (tipo !== 'ventas_por_hora') assert.match(content, /producto #P/, tipo + ': el código sobrevive a la redacción');
    for (const v of PII) assert.ok(!cap.join('').includes(v), v);
  }
});

test('demostración: las cuatro preguntas van al tipo correcto', async () => {
  for (const [text, tipo, extra] of [['¿Cuánto gané hoy?', 'ganancia'], ['¿Qué productos no se venden?', 'productos_sin_ventas'], ['¿Cuánto debe el cliente 12?', 'deuda_cliente', (p) => assert.equal(p.result.texto, 'cliente #12 debe S/ 12.00 en 1 crédito abierto; el primero vence el 2026-11-01.')], ['¿A qué hora vendo más?', 'ventas_por_hora']]) {
    const r = await chat({ text }, { rd: reader(), e: env({ ASSISTANT_DEMO: '1' }) });
    assert.equal(r.status, 200, text);
    const p = r.body.proposals.find((x) => x.type === 'consulta'); assert.ok(p, text + ' ' + JSON.stringify(r.body));
    assert.equal(p.query.tipo, tipo, text); assert.ok(!p.result.error, text);
    if (extra) extra(p);
  }
});

// Base SQLite mínima con la forma de D1 (prepare/bind/first/all) para probar el SQL de las consultas nuevas.
function sqliteD1(setup) {
  const db = new DatabaseSync(':memory:'); db.exec(setup);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => db.prepare(sql).run(...args) });
  return { prepare: (sql) => stmt(sql), raw: db };
}
const SCHEMA = `CREATE TABLE canonical_control(id INTEGER PRIMARY KEY, mode TEXT, active_promotion_id TEXT);
CREATE TABLE sales(sale_id TEXT PRIMARY KEY, created_at TEXT, total_cents INTEGER, payment_method TEXT);
CREATE TABLE sale_items(sale_id TEXT, line_number INTEGER, product_id TEXT, quantity REAL, unit_price_cents INTEGER, line_total_cents INTEGER);
CREATE TABLE canonical_sale_context(sale_id TEXT PRIMARY KEY, promotion_id TEXT);`;
function seed(db, { annulTable = true, mode = 'ACTIVE' } = {}) {
  db.raw.exec(`INSERT INTO canonical_control VALUES(1,'${mode}','PROMO')`);
  if (annulTable) db.raw.exec(`CREATE TABLE pos_sale_annulments(sale_id TEXT, status TEXT)`);
  for (const s of DATA.sales) {
    db.raw.prepare('INSERT INTO sales VALUES(?,?,?,?)').run(s.sale_id, s.created_at, s.total_cents, s.metodo);
    db.raw.prepare('INSERT INTO canonical_sale_context VALUES(?,?)').run(s.sale_id, 'PROMO');
    if (s.anulada && annulTable) db.raw.prepare("INSERT INTO pos_sale_annulments VALUES(?,'anulada')").run(s.sale_id);
  }
  for (const [i, it] of DATA.saleItems.entries()) db.raw.prepare('INSERT INTO sale_items VALUES(?,?,?,?,?,?)').run(it.sale_id, i + 1, it.product_id, it.quantity, 0, it.line_total_cents);
  // Una venta de OTRA promoción (no es de la base activa) no cuenta.
  db.raw.exec(`INSERT INTO sales VALUES('OTRA','${at('2026-10-22', 12)}',99900,'efectivo'); INSERT INTO canonical_sale_context VALUES('OTRA','VIEJA');
    INSERT INTO sale_items VALUES('OTRA',1,'P1',999,0,99900);`);
  if (annulTable) db.raw.exec(`INSERT INTO pos_sale_annulments VALUES('S1','pendiente')`); // pendiente: la venta sigue contando
}

test('SQL: la fecha se filtra en la base (rango de Lima), por promoción activa, anuladas fuera, agrupado y con LIMIT', async () => {
  const db = sqliteD1(SCHEMA); seed(db);
  const seen = []; const spy = { prepare: (sql) => { seen.push(sql); return db.prepare(sql); } };
  const rd = canonicalReader(spy), p = { desde: '2026-10-22', hasta: '2026-10-22', fromIso: '2026-10-22T05:00:00.000Z', toIso: '2026-10-23T05:00:00.000Z' };
  assert.deepEqual(await rd.salesByHour(p), [{ h: 0, n: 1, c: 700 }, { h: 9, n: 2, c: 2500 }, { h: 11, n: 1, c: 1000 }, { h: 12, n: 1, c: 3000 }]);
  const items = await rd.itemsByProduct(p);
  assert.deepEqual(items.map((x) => [x.product_id, x.q, x.c]), [['P2', 3, 3000], ['P1', 5, 2000], ['P3', 6, 1700], ['P4', 2, 500]]);
  assert.equal(items.truncated, false);
  const ayer = await rd.salesByHour({ fromIso: '2026-10-21T05:00:00.000Z', toIso: '2026-10-22T05:00:00.000Z' });
  assert.deepEqual(ayer, [{ h: 23, n: 1, c: 4000 }]);
  for (const sql of seen.filter((s) => /sale_items|strftime/.test(s))) {
    assert.match(sql, /julianday\(r\.created_at\).*>=.*julianday\(\?2\).*julianday\(r\.created_at\).*<.*julianday\(\?3\)/, 'fecha por momento (#960), en SQL'); assert.match(sql, /x\.promotion_id=\?1/); assert.match(sql, /LIMIT \?4$/); assert.match(sql, /pos_sale_annulments/);
    assert.ok(/^SELECT /.test(sql) && !/INSERT|UPDATE|DELETE|DROP/i.test(sql), 'solo lectura');
  }
  // Sin la tabla de anulaciones (base vieja): no hay anuladas, no falla. Antes de ACTIVE: tabla sales tal cual.
  const old = sqliteD1(SCHEMA); seed(old, { annulTable: false, mode: 'CANONICAL_READ_ONLY' });
  const h = await canonicalReader(old).salesByHour(p);
  assert.equal(h.find((x) => x.h === 13).c, 9900); assert.equal(h.find((x) => x.h === 12).c, 3000 + 99900);
  // Sin publicar: falla cerrado.
  const off = sqliteD1(SCHEMA); off.raw.exec(`INSERT INTO canonical_control VALUES(1,'DORMANT','PROMO')`);
  await assert.rejects(canonicalReader(off).salesByHour(p), /canonical_not_published/);
});

test('base real del arnés canónico: las 4 consultas nuevas corren sin error y sin clientes al modelo', async (t) => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  const rd = canonicalReader(f.env.nuevo_amanecer_lab);
  for (const tipo of NEW) {
    const r = await runAssistantQuery(rd, { tipo, cliente_id: '000C' }, NOW);
    assert.ok(!r.error, tipo + ' ' + JSON.stringify(r));
    const sent = JSON.stringify(r.resumen); assert.ok(!sent.includes('sintético'), tipo); assert.ok(sent.length < 1500, tipo);
  }
  const d = await runAssistantQuery(rd, { tipo: 'deuda_cliente', cliente_id: '000C' }, NOW);
  assert.deepEqual(Object.keys(d.resumen).sort(), ['cliente', 'creditos_abiertos', 'saldo_soles', 'vence_primero']);
  assert.equal(d.resumen.saldo_soles, 7); assert.equal(d.resumen.vence_primero, null); // el crédito del arnés no trae vencimiento
});

// ---------- Palabras de fecha nuevas: antier, el mismo día de la semana pasada y un día exacto (fecha) ----------
const lima = (day, h, m = 0) => Date.parse(day + 'T00:00:00Z') + ((h + 5) * 60 + m) * 60000;

test('antier = hoy − 2 y mismo_dia_semana_pasada = mismo día de la semana 7 días atrás, en días de Lima', () => {
  const now = lima('2026-10-22', 15); // jueves
  assert.deepEqual(dateWordRange('antier', now), { desde: '2026-10-20', hasta: '2026-10-20' });
  assert.deepEqual(dateWordRange('mismo_dia_semana_pasada', now), { desde: '2026-10-15', hasta: '2026-10-15' }, 'jueves 22 -> jueves 15 (no el martes 13)');
  // Bordes de Lima: 23:59 del jueves 22 en Lima ya es viernes 23 en UTC; 00:00 del viernes 23 en Lima sí corre todo un día.
  assert.deepEqual(dateWordRange('antier', lima('2026-10-22', 23, 59)), { desde: '2026-10-20', hasta: '2026-10-20' });
  assert.deepEqual(dateWordRange('mismo_dia_semana_pasada', lima('2026-10-22', 23, 59)), { desde: '2026-10-15', hasta: '2026-10-15' });
  assert.deepEqual(dateWordRange('antier', lima('2026-10-23', 0, 0)), { desde: '2026-10-21', hasta: '2026-10-21' });
  assert.deepEqual(dateWordRange('antier', lima('2026-11-01', 0, 30)), { desde: '2026-10-30', hasta: '2026-10-30' }, 'cruza el mes');
  assert.deepEqual(dateWordRange('mismo_dia_semana_pasada', lima('2027-01-03', 10)), { desde: '2026-12-27', hasta: '2026-12-27' }, 'cruza el año');
  const p = period({ periodo: 'antier' }, now);
  assert.deepEqual([p.fromIso, p.toIso], ['2026-10-20T05:00:00.000Z', '2026-10-21T05:00:00.000Z']);
  // La semana sigue empezando el lunes.
  assert.deepEqual(dateWordRange('esta_semana', now), { desde: '2026-10-19', hasta: '2026-10-22' });
  assert.deepEqual(dateWordRange('semana_pasada', now), { desde: '2026-10-12', hasta: '2026-10-18' });
  assert.deepEqual(dateWordRange('esta_semana', lima('2026-10-26', 0, 30)), { desde: '2026-10-26', hasta: '2026-10-26' }, 'lunes 00:30 Lima');
  assert.deepEqual(dateWordRange('mismo_dia_semana_pasada', lima('2026-10-26', 0, 30)), { desde: '2026-10-19', hasta: '2026-10-19' }, 'lunes -> lunes');
});

test('alias: antier, anteayer, antes de ayer, «era antier», «el mismo día de la otra semana»; fecha AAAA-MM-DD exacta', () => {
  for (const w of ['antier', 'Anteayer', 'antes de ayer', 'ante ayer', 'era antier', 'antier?']) assert.equal(dateWord(w), 'antier', w);
  for (const w of ['mismo_dia_semana_pasada', 'el mismo día de la otra semana', 'mismo día de la semana pasada', 'hoy hace una semana', 'hace 7 días']) assert.equal(dateWord(w), 'mismo_dia_semana_pasada', w);
  assert.equal(dateWord('ayer'), 'ayer');
  // (auditoría VEN-028) «mañana» ya no se descarta (antes null → la consulta contaba HOY en silencio): se reconoce y la consulta avisa que es futura.
  // Sigue fuera de DATE_WORDS (el enum del esquema no cambia).
  assert.equal(dateWord('mañana'), 'manana'); assert.ok(!DATE_WORDS.includes('manana'));
  assert.ok(DATE_WORDS.includes('antier') && DATE_WORDS.includes('mismo_dia_semana_pasada'));
  const now = lima('2026-10-22', 15);
  assert.deepEqual([period({ fecha: '2026-10-07' }, now).desde, period({ fecha: '2026-10-07' }, now).hasta], ['2026-10-07', '2026-10-07']);
  assert.equal(period({ fecha: 'basura' }, now).desde, '2026-10-22');
  assert.equal(period({ periodo: 'antier', fecha: '2026-10-07' }, now).desde, '2026-10-20', 'periodo manda');
  assert.equal(summaryPeriods('resumen_dia', { periodo: 'antier' }, now).actual.desde, '2026-10-20');
  assert.equal(summaryPeriods('resumen_dia', { periodo: 'mismo_dia_semana_pasada' }, now).anterior.desde, '2026-10-14');
  assert.equal(summaryPeriods('resumen_dia', { fecha: '2026-10-07' }, now).actual.desde, '2026-10-07');
});

test('herramienta y prompt: enum y descripción con antier / mismo día; calendario con las fechas; corregir la fecha = consultar de nuevo', () => {
  const c = toolsForRole('owner').find((t) => t.function.name === 'consultar').function.parameters.properties;
  assert.deepEqual(c.periodo.enum, [...DATE_WORDS]); assert.match(c.periodo.description, /antier/); assert.match(c.periodo.description, /mismo_dia_semana_pasada/);
  assert.ok(c.fecha, 'fecha en el esquema');
  const line = limaCalendarLine(lima('2026-10-22', 15));
  assert.match(line, /antier \(anteayer\) fue martes 2026-10-20/);
  assert.match(line, /el mismo día de la semana pasada .* fue jueves 2026-10-15/);
  assert.match(line, /«era antier».*periodo NUEVO/);
  assert.ok(systemPrompt('owner', {}).includes('antier (anteayer) fue'));
  const prop = (args) => toProposal({ name: 'consultar', arguments: JSON.stringify(args) }, 'owner', { products: [] }, 1).query;
  assert.equal(prop({ tipo: 'ventas_periodo', periodo: 'antier' }).periodo, 'antier');
  assert.equal(prop({ tipo: 'ventas_periodo', periodo: 'el mismo día de la otra semana' }).periodo, 'mismo_dia_semana_pasada');
  assert.equal(prop({ tipo: 'ventas_periodo', fecha: '2026-10-07' }).fecha, '2026-10-07');
  assert.equal(prop({ tipo: 'ventas_periodo', fecha: '7 de octubre' }).fecha, null);
  // Demostración: las palabras van como periodo.
  const args = (text) => JSON.parse(mockAssistantReply({ role: 'owner', ctx: { products: [] }, text }).calls[0].arguments);
  assert.equal(args('ventas de antier').periodo, 'antier');
  assert.equal(args('ventas de antes de ayer').periodo, 'antier');
  assert.equal(args('ventas del mismo dia de la otra semana').periodo, 'mismo_dia_semana_pasada');
  assert.equal(args('resumen de antier').periodo, 'antier');
});

test('chat: «era antier» tras «ayer» vuelve a consultar con periodo antier (otros números, no los de ayer)', async () => {
  const D = { ...DATA, sales: [...DATA.sales, { sale_id: 'A1', created_at: at('2026-10-20', 10), metodo: 'efectivo', total_cents: 1234 }] };
  const ask = async (text, periodo, history) => {
    const cap = [];
    const r = await chat({ text, ...(history ? { history } : {}) }, { rd: memoryReader(D), fetch: scripted([{ content: '', tool_calls: [tool('consultar', { tipo: 'ventas_por_hora', periodo }, 'c1')] }, { content: 'Listo.' }], cap) });
    assert.equal(r.status, 200); return { r, cap, p: r.body.proposals.find((x) => x.type === 'consulta') };
  };
  const a = await ask('¿a qué hora vendí ayer?', 'ayer');
  assert.equal(a.p.query.periodo, 'ayer'); assert.equal(a.p.result.titulo, 'Ventas por hora 2026-10-21');
  const b = await ask('era antier', 'antier', [{ role: 'user', content: '¿a qué hora vendí ayer?' }, { role: 'assistant', content: 'Ayer vendiste a las 23:00.' }]);
  assert.equal(b.p.query.periodo, 'antier'); assert.equal(b.p.result.titulo, 'Ventas por hora 2026-10-20');
  assert.deepEqual(b.p.result.filas, [['10:00–10:59', 1, 12.34]]);
  assert.match(JSON.parse(b.cap[0]).messages[0].content, /periodo NUEVO/, 'el prompt pide volver a consultar');
});

// Prompt y herramientas por rol (alfa, 22-10): el empleado solo ve sus tipos y sus líneas; el Admin recibe todo.
const ADMIN_TYPES = ['ganancia', 'caja_abierta', 'creditos_atrasados', 'deuda_cliente', 'deudas_clientes', 'resumen_dia', 'resumen_mes', 'sin_costo', 'ventas_periodo', 'compras_recientes', 'productos_sin_ventas', 'ventas_por_hora', 'top_productos'];
const ADMIN_LINES = [/CAJA DE HOY/, /caja_abierta/, /MEMORIA DE BOLETA/, /leer_factura_compra/, /deuda_cliente/, /estado de cuenta/, /ganancia/i, /creditos_atrasados|créditos atrasados/];
const consultarOf = (role) => toolsForRole(role).find((t) => t.function.name === 'consultar').function;
test('por rol: el enum de consultar del empleado no trae tipos del Admin ni de costos; el del Admin los trae todos', () => {
  for (const role of ['empleado:consultas', 'empleado:consultas_documentos']) {
    const c = consultarOf(role);
    assert.deepEqual(c.parameters.properties.tipo.enum, ['stock_producto', 'bajo_stock'], role);
    for (const t of ADMIN_TYPES) assert.ok(!c.description.includes(t), role + ': la descripción no nombra ' + t);
    assert.doesNotMatch(c.description, /ganancia|costo|caja|deuda|atrasad/i, role);
    assert.equal(c.parameters.properties.cliente_id, undefined, role + ': sin cliente_id');
    const all = JSON.stringify(toolsForRole(role));
    for (const t of ['ganancia', 'caja_abierta', 'creditos_atrasados', 'deuda_cliente']) assert.ok(!all.includes(t), role + ': ' + t);
  }
  const a = consultarOf('owner');
  assert.deepEqual(a.parameters.properties.tipo.enum, [...QUERY_TYPES]);
  for (const t of ['ganancia', 'productos_sin_ventas', 'deuda_cliente', 'ventas_por_hora', 'resumen_dia', 'resumen_mes']) assert.ok(a.description.includes(t), 'Admin: ' + t);
  assert.match(a.description, /créditos atrasados \(vencidos, con borrador de recordatorio/);
  assert.match(a.description, /el sistema las pone en hora de Lima/);
  assert.ok(a.parameters.properties.cliente_id);
});
test('por rol: el prompt del empleado no trae las líneas de ganancia, costos, caja, boleta ni deudas; el del Admin sí', () => {
  for (const role of ['empleado:consultas', 'empleado:consultas_documentos']) {
    const p = systemPrompt(role, {});
    for (const re of ADMIN_LINES) assert.doesNotMatch(p, re, role + ': ' + re);
    assert.match(p, /Hablas con un EMPLEADO/, role); assert.match(p, /cliente #código/, role); assert.match(p, /Hoy \(Lima\) es /, role);
  }
  const o = systemPrompt('owner', {});
  for (const re of [/CAJA DE HOY/, /caja_abierta/, /MEMORIA DE BOLETA/, /leer_factura_compra/, /estado de cuenta/, /consultar deuda_cliente con cliente_id = ese código/]) assert.match(o, re, 'Admin: ' + re);
  assert.match(o, /«el mismo día de la otra semana»/); assert.match(o, /el sistema calcula las fechas/);
  assert.ok(o.length > systemPrompt('empleado:consultas', {}).length, 'el empleado recibe menos texto');
});

// Herramientas por nivel (alfa, 22-10, tras el #939): cada nivel recibe SUS tipos de pos-assistant-levels.js; nivel 2 y 3 no quedan
// con los del empleado a secas; el nivel 3 con costos recibe ganancia; deuda_cliente, caja y créditos atrasados siguen solo del Admin.
const LEVELS = [
  ['nivel 1', 'empleado:consultas', ['stock_producto', 'bajo_stock'], ['explicar_pasos', 'consultar'], 'ventas_periodo'],
  ['nivel 2', 'empleado:consultas_documentos', ['stock_producto', 'bajo_stock'], ['explicar_pasos', 'consultar', 'preparar_documento'], 'ganancia'],
  ['nivel 3 sin costos', 'empleado:completo', ['stock_producto', 'bajo_stock'], ['explicar_pasos', 'consultar', 'preparar_documento'], 'ganancia'],
  ['nivel 3 con costos', 'empleado:completo+costos', ['stock_producto', 'bajo_stock', 'sin_costo', 'ventas_periodo', 'top_productos', 'compras_recientes', 'ganancia', 'productos_sin_ventas', 'ventas_por_hora'],
    ['explicar_pasos', 'consultar', 'preparar_documento', 'proponer_cambio_precio', 'preparar_compra', 'proponer_ajuste_stock', 'proponer_producto_nuevo', 'configurar_app'], 'deuda_cliente']
];
for (const [label, role, types, names, denied] of LEVELS) {
  test('por nivel (' + label + '): consultar trae solo sus tipos y sus herramientas; un tipo ajeno no pasa y no se lee la base', async () => {
    const tools = toolsForRole(role), c = consultarOf(role);
    assert.deepEqual(tools.map((t) => t.function.name).sort(), [...names].sort(), label + ': herramientas');
    assert.deepEqual([...c.parameters.properties.tipo.enum].sort(), [...types].sort(), label + ': tipos de consultar');
    assert.ok(!('cliente_id' in c.parameters.properties), label + ': sin cliente_id');
    for (const t of types) assert.ok(c.description.includes(t), label + ': la descripción nombra ' + t);
    assert.ok(!/deuda|crédito|credito|caja/i.test(c.description), label + ': la descripción no habla de deudas, créditos ni caja');
    for (const t of ['deuda_cliente', 'deudas_clientes', 'caja_abierta', 'creditos_atrasados', 'resumen_dia']) assert.ok(!c.parameters.properties.tipo.enum.includes(t), label + ': ' + t);
    const cap = [], [rd, n] = counting(reader());
    const r = await chat({ text: 'dime' }, { role, rd, fetch: scripted([{ content: '', tool_calls: [tool('consultar', { tipo: denied, cliente_id: 'C1' }, 'c1')] }, { content: 'Listo.' }], cap) });
    // Tipo fuera de su nivel: la tarjeta se descarta (forbidden_query) y no se lee nada de la base.
    assert.equal(toProposal({ name: 'consultar', arguments: JSON.stringify({ tipo: denied }) }, role, { products: [] }, 1).dropped, denied === 'ganancia' ? 'forbidden_costs' : 'forbidden_query', label);
    assert.ok([200, 403].includes(r.status), label + ': ' + r.status); assert.equal(n.reads, 0, label + ': sin leer la base');
    assert.ok(!(r.body.proposals || []).some((p) => p.type === 'consulta'), label + ': sin tarjeta de ' + denied);
  });
}
test('por nivel (Admin): consultar trae todos los tipos, con cliente_id; deuda_cliente con un código de letras y guiones da el total', async () => {
  const c = consultarOf('owner');
  for (const t of [...QUERY_TYPES]) assert.ok(c.parameters.properties.tipo.enum.includes(t), 'Admin: ' + t);
  assert.ok('cliente_id' in c.parameters.properties);
  assert.equal(toProposal({ name: 'consultar', arguments: JSON.stringify({ tipo: 'deuda_cliente', cliente_id: 'C1' }) }, 'owner', { products: [] }, 1).type, 'consulta');
  const D = { ...DATA, credits: [...DATA.credits, { cliente: 'SIN-DOC-MISAEL', saldo: 4000, vence: '2026-10-05', fecha: '2026-09-05' }, { cliente: 'SIN-DOC-MISAEL', saldo: 125, vence: '2026-11-05', fecha: '2026-10-05' }] };
  const r = await q('deuda_cliente', { cliente_id: 'SIN-DOC-MISAEL' }, memoryReader(D));
  assert.deepEqual(r.resumen, { cliente: 'cliente #SIN-DOC-MISAEL', saldo_soles: 4125, creditos_abiertos: 2, vence_primero: '2026-10-05' });
  assert.equal((await q('deuda_cliente', { cliente_id: 'cliente #SIN-DOC-MISAEL' }, memoryReader(D))).resumen.saldo_soles, 4125, 'también con «cliente #»');
});
test('ventas por hora sin período: esta semana de Lima (lunes 19 a hoy), sin preguntar; con fecha o período, lo pedido', async () => {
  const r = await q('ventas_por_hora');
  assert.equal(r.resumen.desde, '2026-10-19'); assert.equal(r.resumen.hasta, '2026-10-22');
  assert.ok(!r.resumen.falta); assert.equal(r.resumen.ventas, 6);
  assert.equal((await q('ventas_por_hora', { periodo: 'ayer' })).resumen.desde, '2026-10-21');
  assert.equal((await q('ventas_por_hora', { fecha: '2026-10-20' })).resumen.desde, '2026-10-20');
});
