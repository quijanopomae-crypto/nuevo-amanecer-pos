// GROKBOT 5 (pruebas y calidad), P0-C: exactitud de ventas / ganancia / períodos y propagación de «datos incompletos».
// Nivel A: determinista, SIN modelo real, SIN red, SIN base real: lector en memoria (memoryReader) con fixtures SINTÉTICOS y las
// cifras esperadas calculadas AQUÍ en céntimos enteros (no copiadas de la salida del código).
// Hoy simulado = lunes 26-oct-2026 15:00 Lima (20:00Z). Las pruebas marcadas {todo} documentan bugs REALES encontrados (no se esconden:
// siguen fallando a propósito hasta que se aplique el arreglo mínimo del informe pruebas-calidad-grokbot5.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { runAssistantQuery, memoryReader, dateWordRange, DATE_WORDS, summaryPeriods } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const NOW = Date.parse('2026-10-26T20:00:00.000Z');
const at = (day, h) => new Date(Date.parse(day + 'T00:00:00Z') + (h + 5) * 3600000).toISOString(); // hora de Lima -> ISO
const PRODUCTS = [
  { id: 'G1', nombre: 'PRUEBA Galleta 6 UND', precio: 1.5, costo: 1.15, stock: 40, min: 5, controla: true }, // 1.15*100 = 114.99999999999999 en coma flotante
  { id: 'L1', nombre: 'PRUEBA Leche 1 L', precio: 4.2, costo: 3.1, stock: 12, min: 6, controla: true },
  { id: 'A1', nombre: 'PRUEBA Arroz 1 KG', precio: 3.99, costo: null, stock: 30, min: 5, controla: true }, // SIN costo registrado
  { id: 'P1', nombre: 'PRUEBA Paracetamol', precio: 0.5, costo: 0.3, stock: 100, min: 20, controla: true }
];
const SALES = [
  { sale_id: 'S1', created_at: at('2026-10-26', 8), metodo: 'efectivo', total_cents: 1020 },        // G1 x4 (600) + L1 x1 (420)
  { sale_id: 'S2', created_at: at('2026-10-26', 9.5), metodo: 'yape', total_cents: 399 },           // A1 x1
  { sale_id: 'S3', created_at: at('2026-10-25', 23 + 59 / 60), metodo: 'efectivo', total_cents: 2500 }, // 23:59 Lima de AYER (04:59Z de hoy)
  { sale_id: 'S4', created_at: at('2026-10-26', 0), metodo: 'plin', total_cents: 150 },            // 00:00 Lima de HOY exacto
  { sale_id: 'S5', created_at: at('2026-10-26', 11), metodo: 'efectivo', total_cents: 99999, anulada: true } // anulada: no cuenta
];
const ITEMS = [
  { sale_id: 'S1', product_id: 'G1', quantity: 4, line_total_cents: 600 }, { sale_id: 'S1', product_id: 'L1', quantity: 1, line_total_cents: 420 },
  { sale_id: 'S2', product_id: 'A1', quantity: 1, line_total_cents: 399 },
  { sale_id: 'S3', product_id: 'L1', quantity: 5, line_total_cents: 2500 }, // 5 x 5.00 (precio distinto: promoción de ayer)
  { sale_id: 'S4', product_id: 'P1', quantity: 3, line_total_cents: 150 },
  { sale_id: 'S5', product_id: 'L1', quantity: 99, line_total_cents: 99999 }
];
const DATA = { products: PRODUCTS, sales: SALES, saleItems: ITEMS, cashMovements: [], payments: [] };
const rd = (extra = {}) => memoryReader({ ...DATA, ...extra });
const soles = (cents) => Math.round(cents) / 100;

test('A5-D1) ventas de hoy: total, n.º de ventas y ticket promedio exactos; 00:00 Lima entra HOY, 23:59 Lima queda en AYER; anuladas fuera', async () => {
  const r = await runAssistantQuery(rd(), { tipo: 'ventas_periodo', periodo: 'hoy' }, NOW);
  const cents = 1020 + 399 + 150; // S1+S2+S4
  assert.equal(r.total, soles(cents)); assert.equal(r.ventas, 3);
  assert.equal(r.resumen.total_soles, 15.69);
  assert.match(r.texto, /S\/ 15\.69 en 3 ventas\. Ticket promedio S\/ 5\.23\./);
  assert.deepEqual(Object.values(r.resumen.por_metodo).sort((a, b) => a - b), [1.5, 3.99, 10.2], 'efectivo 10.20, yape 3.99, plin 1.50 (sin la anulada)');
  const ayer = await runAssistantQuery(rd(), { tipo: 'ventas_periodo', periodo: 'ayer' }, NOW);
  assert.equal(ayer.total, 25); assert.equal(ayer.ventas, 1, 'la venta de las 23:59 Lima es de ayer, no de hoy');
});

test('A5-D2) resumen del día vs. día anterior: variación porcentual y contado/crédito en céntimos', async () => {
  const r = await runAssistantQuery(rd(), { tipo: 'resumen_dia' }, NOW);
  assert.equal(r.total_soles, 15.69); assert.equal(r.ventas, 3);
  const cambio = Math.round(((1569 - 2500) / 2500) * 1000) / 10; // -37.2
  assert.equal(r.resumen.cambio_pct.total, cambio);
  assert.equal(r.resumen.anterior.total_soles, 25);
  const fila = r.filas.find((f) => f[0] === 'Ventas S/'); assert.deepEqual(fila.slice(1, 3), [15.69, 25]);
});

test('A5-D3) ganancia de hoy: costo ACTUAL × unidades en céntimos (sin error de coma flotante 1.15), lo SIN costo no entra, margen sobre lo que sí tiene costo', async () => {
  const r = await runAssistantQuery(rd(), { tipo: 'ganancia', periodo: 'hoy' }, NOW);
  const costo = Math.round(1.15 * 100) * 4 + 310 * 1 + 30 * 3; // G1 x4 + L1 x1 + P1 x3 = 460 + 310 + 90 = 860
  const conCosto = 600 + 420 + 150; // 1170 (A1 sin costo: 399 queda aparte)
  assert.equal(r.resumen.costo_soles, soles(costo)); assert.equal(r.resumen.ventas_con_costo_soles, soles(conCosto));
  assert.equal(r.resumen.ganancia_soles, soles(conCosto - costo)); // 3.10
  assert.equal(r.resumen.margen_pct, Math.round(((conCosto - costo) / conCosto) * 1000) / 10);
  assert.equal(r.resumen.ventas_sin_costo_soles, 3.99); assert.equal(r.resumen.productos_sin_costo, 1);
  assert.equal(r.resumen.ventas_soles, 15.69, 'ventas totales = con costo + sin costo');
  assert.match(r.texto, /3\.99 vendidos de productos sin costo no se cuentan/);
  assert.equal(r.resumen.base_costo, 'costo actual del producto', 'el modelo recibe que es costo ACTUAL');
});

test('A5-D4) ganancia: una venta bajo costo sale marcada y la ganancia puede ser negativa (no se redondea a 0 ni se oculta)', async () => {
  const data = { ...DATA, products: [{ ...PRODUCTS[0], costo: 2 }, ...PRODUCTS.slice(1)] }; // galleta vendida a 1.50 con costo 2.00
  const r = await runAssistantQuery(memoryReader(data), { tipo: 'ganancia', periodo: 'hoy' }, NOW);
  assert.ok(r.resumen.bajo_costo.length >= 1);
  const f = r.filas.find((x) => /^Vendido bajo costo/.test(x[0])); assert.ok(f); assert.equal(f[1], -2); // 600 - 4*200 = -200 cts
});

test('A5-D5) palabras de fecha (el modelo NO calcula fechas): lunes 26-oct-2026', () => {
  const dr = (w) => dateWordRange(w, NOW); const o = (d, h) => ({ desde: d, hasta: h });
  assert.deepEqual(dr('hoy'), o('2026-10-26', '2026-10-26')); assert.deepEqual(dr('ayer'), o('2026-10-25', '2026-10-25'));
  assert.deepEqual(dr('esta_semana'), o('2026-10-26', '2026-10-26'), 'la semana empieza el lunes: hoy lunes es solo hoy');
  assert.deepEqual(dr('semana_pasada'), o('2026-10-19', '2026-10-25'));
  assert.deepEqual(dr('mismo_dia_semana_pasada'), o('2026-10-19', '2026-10-19'), '«el lunes pasado» cuando hoy es lunes = hace 7 días');
  assert.deepEqual(dr('este_mes'), o('2026-10-01', '2026-10-26')); assert.deepEqual(dr('mes_pasado'), o('2026-09-01', '2026-09-30'));
  assert.deepEqual(dateWordRange('este_mes', Date.parse('2026-03-01T06:00:00Z')), o('2026-03-01', '2026-03-01'));
  assert.deepEqual(dateWordRange('mes_pasado', Date.parse('2026-03-31T20:00:00Z')), o('2026-02-01', '2026-02-28'));
  assert.deepEqual(dateWordRange('mes_pasado', Date.parse('2026-01-05T20:00:00Z')), o('2025-12-01', '2025-12-31'), 'cruce de año');
  // 23:30 Lima del 25 = 04:30Z del 26: debe seguir siendo «hoy» = 25, no 26
  assert.deepEqual(dateWordRange('hoy', Date.parse('2026-10-26T04:30:00Z')), o('2026-10-25', '2026-10-25'));
  assert.ok(DATE_WORDS.length === 8, 'si se añade una palabra de fecha, añadir su caso aquí');
});

test('A5-D6) período sin ventas: dice claro que no hay ventas (no inventa ceros disfrazados de dato) y no divide entre cero', async () => {
  const r = await runAssistantQuery(rd(), { tipo: 'ventas_periodo', periodo: 'mes_pasado' }, NOW);
  assert.equal(r.ventas, 0); assert.match(r.texto, /^No hay ventas registradas 2026-09-01 a 2026-09-30\.$/);
  const g = await runAssistantQuery(rd(), { tipo: 'ganancia', periodo: 'mes_pasado' }, NOW);
  assert.match(g.texto, /^No hay ventas registradas/); assert.equal(g.resumen.margen_pct, null, 'margen desconocido = null, no 0 ni NaN');
  const d = await runAssistantQuery(rd(), { tipo: 'resumen_dia', hasta: '2026-09-15' }, NOW);
  assert.ok(Number.isFinite(d.total_soles)); assert.equal(d.resumen.cambio_pct.total, null);
});

test('A5-D7) costo desconocido en TODO lo vendido: sin ganancia inventada (margen null) y se avisa cuánto quedó sin costo', async () => {
  const data = { ...DATA, products: PRODUCTS.map((p) => ({ ...p, costo: null })) };
  const r = await runAssistantQuery(memoryReader(data), { tipo: 'ganancia', periodo: 'hoy' }, NOW);
  assert.equal(r.resumen.margen_pct, null); assert.equal(r.resumen.ganancia_soles, 0);
  assert.equal(r.resumen.ventas_sin_costo_soles, 15.69); assert.equal(r.resumen.productos_sin_costo, 4);
});

test('A5-D8a) la ganancia se rotula como estimada (usa costo ACTUAL, no el histórico) en el TEXTO que lee el dueño', { todo: 'Hallazgo P0/P1 del informe (§4). Arreglado por /workspace/patches/a3-worker-truncado-y-ganancia-estimada.patch (texto «Ganancia estimada …»); este test pasa al aplicarlo y entonces puede quitarse el {todo}. No se duplica el arreglo aquí.' }, async () => {
  const r = await runAssistantQuery(rd(), { tipo: 'ganancia', periodo: 'hoy' }, NOW);
  assert.match(r.texto, /bruta|estimad/i, 'el texto debe decir que es una estimación');
});

test('A5-D8b) la fila «Ganancia S/» de la TABLA también se rotula (WORK pinta la tabla, no el texto)', { todo: 'Hueco que deja el parche de A3: título y fila «Ganancia» siguen sin rótulo. Arreglo mínimo: pos-assistant-queries.js (consulta ganancia, ~1012-1030) fila «Ganancia estimada S/».' }, async () => {
  const r = await runAssistantQuery(rd(), { tipo: 'ganancia', periodo: 'hoy' }, NOW);
  assert.match(String(r.filas.find((f) => /^Ganancia/.test(f[0]))[0]), /bruta|estimad/i);
});

test('A5-F1) «datos incompletos» (lectura cortada): TODAS las consultas con tope marcan `truncado` en el nivel que lee WORK (result.truncado) — resumen_dia/mes', { todo: 'BUG P0-C confirmado: summaryQuery (pos-assistant-queries.js:982) pone truncado solo en resumen.truncado; pos-assistant.js:3477 y work-host.js:278 leen r.truncado => WORK no muestra el aviso estructurado. Arreglado por /workspace/patches/a3-worker-truncado-y-ganancia-estimada.patch (liftCut en runAssistantQuery); pasa al aplicarlo y entonces puede quitarse el {todo}. No se duplica el arreglo.' }, async () => {
  for (const tipo of ['resumen_dia', 'resumen_mes']) {
    const r = await runAssistantQuery(rd({ truncated: true }), { tipo }, NOW);
    assert.equal(r.resumen.truncado, true, tipo + ': el modelo sí lo recibe');
    assert.equal(r.truncado, true, tipo + ': el nivel superior (el que usan chat y WORK) también debe llevarlo');
  }
});

test('A5-F2) mismo bug por la ruta REAL del chat: la propuesta «consulta» del resumen truncado debe llevar result.truncado=true hacia WORK', { todo: 'BUG P0-C (ver A5-F1): p.result no incluye truncado para resumen_dia/resumen_mes' }, async () => {
  const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef', DEEPSEEK_API_KEY: 'k' };
  const jr = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  let n = 0;
  const fetch = async () => new Response(JSON.stringify({ choices: [{ message: n++ === 0 ? { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'consultar', arguments: JSON.stringify({ tipo: 'resumen_dia' }) } }] } : { content: 'Resumen listo.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: '¿cuánto vendí hoy?', context: { products: PRODUCTS } }) }), ENV, { principalId: 'session:a5', posRole: 'owner' }, jr,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', fetch, reader: rd({ truncated: true }), audit: async () => {}, now: () => NOW });
  const body = await res.json();
  const q = body.proposals.find((p) => p.type === 'consulta'); assert.ok(q && q.result, JSON.stringify(body).slice(0, 300));
  assert.match(String(q.result.filas[0][0]), /^Aviso: datos incompletos/, 'la primera fila SÍ avisa (lo que ya funciona)');
  assert.equal(q.result.truncado, true);
});

test('A5-F3) guardia de lo que SÍ funciona: ganancia / sugerencias / créditos atrasados con lectura cortada muestran aviso en la tabla y resumen.truncado', async () => {
  const items = rd(); const base = items.itemsByProduct.bind(items);
  items.itemsByProduct = async (p) => { const l = await base(p); l.truncated = true; return l; };
  const g = await runAssistantQuery(items, { tipo: 'ganancia', periodo: 'hoy' }, NOW);
  assert.match(String(g.filas[0][0]), /^Aviso: hay más productos vendidos/); assert.equal(g.resumen.truncado, true);
  const c = await runAssistantQuery(memoryReader({ ...DATA, credits: [{ cliente: 'C1', saldo: 10, vence: '2026-10-01' }], customers: [{ id: 'C1', nombre: 'X' }], creditsTruncated: true }), { tipo: 'creditos_atrasados' }, NOW);
  assert.equal(c.truncado, true); assert.match(c.texto, /se cortó: puede faltar alguno/);
});

test('A5-F4) los períodos de resumen no se desfasan al cambiar de mes: 31-oct compara contra septiembre completo (30 días) sin desbordar', () => {
  const p = summaryPeriods('resumen_mes', {}, Date.parse('2026-10-31T20:00:00Z'));
  assert.deepEqual([p.actual.desde, p.actual.hasta, p.anterior.desde, p.anterior.hasta], ['2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30']);
});
