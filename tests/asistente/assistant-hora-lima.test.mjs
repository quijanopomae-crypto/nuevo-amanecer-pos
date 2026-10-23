// Tarea 7: «hoy», «ayer», «esta semana», «este mes» (y la semana / el mes pasado) se calculan en el SERVIDOR en hora de Lima
// (America/Lima = UTC-5, sin horario de verano), con el mismo ayudante de los resúmenes (#931). Datos inventados; sin modelo real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toProposal, toolsForRole, systemPrompt } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { mockAssistantReply } from '../../tools/cloudflare-lab/src/pos-assistant-mock.js';
import { runAssistantQuery, memoryReader, period, summaryPeriods, dateWord, dateWordRange, limaToday, limaDay, limaDateOf, limaBounds, limaCalendarLine, DATE_WORDS }
  from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const lima = (day, hh, mm = 0) => Date.parse(day + 'T00:00:00Z') + ((hh + 5) * 60 + mm) * 60000; // hora de Lima -> ms
const iso = (day, hh, mm = 0) => new Date(lima(day, hh, mm)).toISOString();

test('23:30 en Lima del día X sigue siendo «hoy» X aunque en UTC ya sea X+1', () => {
  const now = lima('2026-10-22', 23, 30);
  assert.equal(new Date(now).toISOString().slice(0, 10), '2026-10-23'); // UTC ya cambió de día
  assert.equal(limaToday(now), '2026-10-22');
  assert.deepEqual(dateWordRange('hoy', now), { desde: '2026-10-22', hasta: '2026-10-22' });
  assert.deepEqual(dateWordRange('ayer', now), { desde: '2026-10-21', hasta: '2026-10-21' });
  const p = period({ periodo: 'hoy' }, now);
  assert.equal(p.fromIso, '2026-10-22T05:00:00.000Z'); assert.equal(p.toIso, '2026-10-23T05:00:00.000Z');
});

test('00:30 en Lima ya es el día nuevo; «ayer» es el anterior (en UTC todavía son las 05:30 del mismo día)', () => {
  const now = lima('2026-10-23', 0, 30);
  assert.equal(new Date(now).toISOString().slice(0, 10), '2026-10-23');
  assert.equal(limaToday(now), '2026-10-23');
  assert.deepEqual(dateWordRange('ayer', now), { desde: '2026-10-22', hasta: '2026-10-22' });
  // 04:30 UTC del 23 = 23:30 Lima del 22: todavía «hoy» 22 aunque UTC diga 23.
  assert.equal(limaToday(Date.parse('2026-10-23T04:30:00Z')), '2026-10-22');
  assert.equal(limaToday(Date.parse('2026-10-23T05:00:00Z')), '2026-10-23'); // medianoche exacta de Lima
});

test('la semana empieza el lunes (Lima), también el domingo de noche y el lunes de madrugada', () => {
  // Jueves 22-10-2026 -> lunes 19.
  assert.deepEqual(dateWordRange('esta_semana', lima('2026-10-22', 15)), { desde: '2026-10-19', hasta: '2026-10-22' });
  // Domingo 25 a las 23:30 Lima (UTC ya es lunes 26): la semana sigue siendo la del lunes 19.
  assert.deepEqual(dateWordRange('esta_semana', lima('2026-10-25', 23, 30)), { desde: '2026-10-19', hasta: '2026-10-25' });
  // Lunes 26 a las 00:30 Lima: semana nueva de un solo día; la pasada va del 19 al 25.
  assert.deepEqual(dateWordRange('esta_semana', lima('2026-10-26', 0, 30)), { desde: '2026-10-26', hasta: '2026-10-26' });
  assert.deepEqual(dateWordRange('semana_pasada', lima('2026-10-26', 0, 30)), { desde: '2026-10-19', hasta: '2026-10-25' });
  // Un lunes a las 02:00 UTC todavía es domingo en Lima.
  assert.deepEqual(dateWordRange('esta_semana', Date.parse('2026-10-26T02:00:00Z')), { desde: '2026-10-19', hasta: '2026-10-25' });
});

test('límite de mes: 31 a las 23:30 Lima sigue siendo el mes viejo; el 1 a las 00:30 es el mes nuevo', () => {
  const late = lima('2026-10-31', 23, 30);
  assert.equal(new Date(late).toISOString().slice(0, 7), '2026-11');
  assert.deepEqual(dateWordRange('este_mes', late), { desde: '2026-10-01', hasta: '2026-10-31' });
  assert.deepEqual(dateWordRange('mes_pasado', late), { desde: '2026-09-01', hasta: '2026-09-30' });
  const early = lima('2026-11-01', 0, 30);
  assert.deepEqual(dateWordRange('este_mes', early), { desde: '2026-11-01', hasta: '2026-11-01' });
  assert.deepEqual(dateWordRange('ayer', early), { desde: '2026-10-31', hasta: '2026-10-31' });
  assert.deepEqual(dateWordRange('mes_pasado', early), { desde: '2026-10-01', hasta: '2026-10-31' });
  // Enero -> diciembre del año anterior; año nuevo a las 23:30 del 31-12 sigue en el año viejo.
  assert.deepEqual(dateWordRange('mes_pasado', lima('2027-01-10', 9)), { desde: '2026-12-01', hasta: '2026-12-31' });
  assert.equal(limaToday(lima('2026-12-31', 23, 30)), '2026-12-31');
  // Febrero bisiesto.
  assert.deepEqual(dateWordRange('mes_pasado', lima('2028-03-01', 0, 30)), { desde: '2028-02-01', hasta: '2028-02-29' });
});

test('palabras aceptadas: con tildes, mayúsculas, espacios o guion bajo; lo demás no es palabra de fecha', () => {
  for (const [w, k] of [['Hoy', 'hoy'], ['oy', 'hoy'], ['AYER', 'ayer'], ['esta semana', 'esta_semana'], ['esta_semana', 'esta_semana'], ['la semana pasada', 'semana_pasada'],
    ['Este Mes', 'este_mes'], ['mes pasado', 'mes_pasado']]) assert.equal(dateWord(w), k, w);
  for (const w of ['', null, '2026-10-22', 'Rosa', 'hoyy']) assert.equal(dateWord(w), null, String(w));
  assert.equal(dateWord('mañana'), 'manana'); // (auditoría VEN-028) se reconoce para avisar que es futura; no está en DATE_WORDS
  assert.deepEqual([...DATE_WORDS], ['hoy', 'ayer', 'antier', 'mismo_dia_semana_pasada', 'esta_semana', 'semana_pasada', 'este_mes', 'mes_pasado']); // antier y mismo día: #consultas-nuevas
  assert.equal(limaBounds('2026-10-01', '2026-10-31').toIso, '2026-11-01T05:00:00.000Z');
});

test('period(): «periodo» manda; una palabra en desde/hasta también se entiende; las fechas AAAA-MM-DD siguen igual', () => {
  const now = lima('2026-10-22', 23, 30);
  assert.deepEqual(period({ periodo: 'ayer', desde: '2026-01-01', hasta: '2026-01-02' }, now).desde, '2026-10-21');
  assert.deepEqual([period({ hasta: 'ayer' }, now).desde, period({ hasta: 'ayer' }, now).hasta], ['2026-10-21', '2026-10-21']); // antes caía en «hoy»
  assert.deepEqual([period({ desde: 'esta_semana', hasta: 'esta_semana' }, now).desde, period({ hasta: 'esta_semana' }, now).hasta], ['2026-10-19', '2026-10-22']);
  const d = period({ desde: '2026-10-01', hasta: '2026-10-05' }, now);
  assert.deepEqual([d.desde, d.hasta, d.fromIso, d.toIso], ['2026-10-01', '2026-10-05', '2026-10-01T05:00:00.000Z', '2026-10-06T05:00:00.000Z']);
  assert.equal(period({}, now).desde, '2026-10-22'); // por defecto: hoy en Lima, no el 23 de UTC
});

const DATA = {
  products: [{ id: 'P1', nombre: 'Paracetamol 500 mg', stock: 10, min: 2, costo: 0.1, precio: 0.5, controla: true }],
  sales: [
    { sale_id: 'A', created_at: iso('2026-10-22', 23, 30), metodo: 'efectivo', total_cents: 1000 }, // 23-10 04:30Z: es del 22 (hoy)
    { sale_id: 'B', created_at: iso('2026-10-22', 0, 30), metodo: 'yape', total_cents: 500 },       // 22-10 05:30Z: hoy
    { sale_id: 'C', created_at: iso('2026-10-21', 23, 59), metodo: 'efectivo', total_cents: 300 },  // 22-10 04:59Z: ayer (aunque UTC diga 22)
    { sale_id: 'D', created_at: iso('2026-10-19', 0, 5), metodo: 'efectivo', total_cents: 200 },    // lunes: esta semana
    { sale_id: 'E', created_at: iso('2026-10-18', 23, 0), metodo: 'efectivo', total_cents: 700 },   // domingo 18: semana pasada (UTC ya es lunes 19)
    { sale_id: 'F', created_at: iso('2026-09-30', 23, 30), metodo: 'efectivo', total_cents: 900 }   // 01-10 04:30Z: es de septiembre
  ],
  saleItems: [{ sale_id: 'A', product_id: 'P1', quantity: 2, line_total_cents: 1000 }, { sale_id: 'C', product_id: 'P1', quantity: 1, line_total_cents: 300 }]
};
const NOW = lima('2026-10-22', 23, 45); // en UTC ya es 23-10 04:45

test('ventas_periodo: hoy / ayer / esta semana / este mes / mes pasado con ventas cerca de medianoche', async () => {
  const R = memoryReader(DATA), q = (periodo) => runAssistantQuery(R, { tipo: 'ventas_periodo', periodo }, NOW);
  const hoy = await q('hoy'); assert.equal(hoy.desde, '2026-10-22'); assert.equal(hoy.ventas, 2); assert.equal(hoy.total, 15);
  const ayer = await q('ayer'); assert.equal(ayer.desde, '2026-10-21'); assert.equal(ayer.ventas, 1); assert.equal(ayer.total, 3);
  const sem = await q('esta_semana'); assert.deepEqual([sem.desde, sem.hasta, sem.ventas], ['2026-10-19', '2026-10-22', 4]);
  const pas = await q('semana_pasada'); assert.deepEqual([pas.desde, pas.hasta, pas.ventas, pas.total], ['2026-10-12', '2026-10-18', 1, 7]);
  const mes = await q('este_mes'); assert.deepEqual([mes.desde, mes.ventas], ['2026-10-01', 5]);
  const sep = await q('mes_pasado'); assert.deepEqual([sep.desde, sep.hasta, sep.ventas, sep.total], ['2026-09-01', '2026-09-30', 1, 9]);
  // Los días por fila también van en Lima: la venta A (04:30Z del 23) sale en el día 22.
  assert.ok(sem.filas.some((f) => f[0] === 'Día 2026-10-22' && f[1] === 15));
  assert.ok(!sem.filas.some((f) => f[0] === 'Día 2026-10-23'));
});

test('top_productos de hoy en Lima: cuenta la venta de las 23:30 y no la de ayer 23:59', async () => {
  const r = await runAssistantQuery(memoryReader(DATA), { tipo: 'top_productos', periodo: 'hoy' }, NOW);
  assert.equal(r.desde, '2026-10-22'); assert.equal(r.filas.length, 1); assert.equal(r.filas[0][1], 2);
  const ay = await runAssistantQuery(memoryReader(DATA), { tipo: 'top_productos', periodo: 'ayer' }, NOW);
  assert.equal(ay.filas[0][1], 1);
});

test('resúmenes: «ayer» y «mes pasado» usan el día de Lima como referencia; «hoy» a las 23:45 Lima es el 22', async () => {
  assert.equal(summaryPeriods('resumen_dia', { periodo: 'hoy' }, NOW).actual.desde, '2026-10-22');
  const ay = summaryPeriods('resumen_dia', { periodo: 'ayer' }, NOW);
  assert.deepEqual([ay.actual.desde, ay.anterior.desde, ay.en_curso], ['2026-10-21', '2026-10-20', false]);
  const mp = summaryPeriods('resumen_mes', { periodo: 'mes_pasado' }, NOW);
  assert.deepEqual([mp.actual.desde, mp.actual.hasta, mp.anterior.desde, mp.en_curso], ['2026-09-01', '2026-09-30', '2026-08-01', false]);
  assert.equal(summaryPeriods('resumen_mes', { hasta: 'este_mes' }, NOW).actual.hasta, '2026-10-22');
  // 31-10 a las 23:30 Lima: el resumen del mes sigue siendo octubre completo.
  const fin = summaryPeriods('resumen_mes', {}, lima('2026-10-31', 23, 30));
  assert.deepEqual([fin.actual.desde, fin.actual.hasta, fin.en_curso], ['2026-10-01', '2026-10-31', true]);
  const r = await runAssistantQuery(memoryReader(DATA), { tipo: 'resumen_dia', periodo: 'hoy' }, NOW);
  assert.equal(r.ventas, 2); assert.equal(r.total_soles, 15);
});

test('compras recientes: la fecha mostrada es el día de Lima (compra de las 23:30 no salta al día siguiente)', async () => {
  const R = memoryReader({ purchases: [{ supplier: 'Distribuidora X', document_ref: 'F1', total_cost_cents: 5000, line_count: 2, created_at: iso('2026-10-21', 23, 30) },
    { supplier: 'Distribuidora Y', document_ref: 'F2', total_cost_cents: 100, line_count: 1, created_at: '2026-10-20T08:00:00-05:00' }] });
  const r = await runAssistantQuery(R, { tipo: 'compras_recientes' }, NOW);
  assert.deepEqual(r.filas.map((f) => f[0]), ['2026-10-21', '2026-10-20']);
  assert.equal(limaDateOf('2026-10-20'), '2026-10-20'); assert.equal(limaDateOf('basura'), ''); assert.equal(limaDay('2026-10-23T04:59:59Z'), '2026-10-22');
});

test('herramienta consultar: «periodo» en el esquema; la validación guarda la palabra (sin recortarla) y descarta lo raro', () => {
  const c = toolsForRole('owner').find((t) => t.function.name === 'consultar');
  assert.deepEqual(c.function.parameters.properties.periodo.enum, [...DATE_WORDS]);
  const prop = (args) => toProposal({ name: 'consultar', arguments: JSON.stringify(args) }, 'owner', { products: [] }, 1).query;
  assert.equal(prop({ tipo: 'ventas_periodo', periodo: 'esta_semana' }).periodo, 'esta_semana');
  // (auditoría VEN-028) antes «pasado mañana» se descartaba (null → la consulta contaba HOY sin decirlo); ahora llega y la consulta avisa que es futura.
  assert.equal(prop({ tipo: 'ventas_periodo', periodo: 'pasado mañana' }).periodo, 'pasado_manana');
  assert.equal(prop({ tipo: 'ventas_periodo', periodo: 'pasado mañana o lo que sea' }).periodo, null);
  assert.equal(prop({ tipo: 'ventas_periodo', desde: 'esta semana' }).desde, 'esta_semana'); // antes: «esta seman» -> hoy
  assert.equal(prop({ tipo: 'ventas_periodo', desde: '2026-10-01', hasta: '2026-10-05' }).hasta, '2026-10-05');
  // «periodo» no abre nada al empleado: ventas y más vendidos siguen fuera de sus consultas.
  const emp = toProposal({ name: 'consultar', arguments: JSON.stringify({ tipo: 'top_productos', periodo: 'ayer' }) }, 'empleado:consultas', { products: [] }, 1);
  assert.equal(emp.dropped, 'forbidden_query');
});

test('mensaje del sistema: trae hoy, ayer, semana (desde el lunes) y mes de Lima; solo fechas', () => {
  const line = limaCalendarLine(lima('2026-10-25', 23, 30)); // domingo de noche en Lima, lunes en UTC
  assert.match(line, /Hoy \(Lima\) es domingo 2026-10-25/);
  assert.match(line, /ayer fue 2026-10-24/);
  assert.match(line, /esta semana \(de lunes a hoy\) va de 2026-10-19 a 2026-10-25/);
  assert.match(line, /este mes va de 2026-10-01 a 2026-10-25/);
  assert.ok(systemPrompt('owner', {}).includes('Hoy (Lima) es '));
});

test('modo demostración: manda la palabra en «periodo» y el servidor pone las fechas; los documentos siguen con AAAA-MM-DD', () => {
  const args = (text) => JSON.parse(mockAssistantReply({ role: 'owner', ctx: { products: [] }, text }).calls[0].arguments);
  assert.equal(args('ventas de ayer').periodo, 'ayer');
  assert.equal(args('ventas de esta semana').periodo, 'esta_semana');
  assert.equal(args('ventas del mes pasado').periodo, 'mes_pasado');
  assert.equal(args('mas vendidos del mes').periodo, 'este_mes');
  assert.equal(args('ventas').periodo, 'hoy');
  assert.equal(args('resumen de ayer').periodo, 'ayer');
  const doc = args('reporte de ventas de esta semana');
  assert.match(doc.desde, /^\d{4}-\d{2}-\d{2}$/); assert.match(doc.hasta, /^\d{4}-\d{2}-\d{2}$/); assert.equal(doc.periodo, undefined);
});
