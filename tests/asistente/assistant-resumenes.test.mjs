// Resúmenes del día y del mes (asistente del Admin): períodos en hora de Lima, contado/crédito (mixto por cash-movements),
// cobros de créditos, top por monto y por unidades, comparación con el período anterior; SOLO Admin (empleado: 403
// summary_admin_only, sin leer la base ni llamar al modelo) y al modelo nunca le llegan nombres, DNI ni teléfonos.
// Datos inventados; DeepSeek siempre simulado. Corre con Node 20 (no usa node:sqlite).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore, toolsForRole, employeeSummaryDenied, toProposal, redactDeep, redactText } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { runAssistantQuery, memoryReader, summaryPeriods, paymentDay, QUERY_TYPES, SUMMARY_TYPES, protectProductRefs } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const tool = (name, args, id = 'call_' + name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
// 2026-10-22 15:00 en Lima (20:00Z).
const NOW = Date.parse('2026-10-22T20:00:00.000Z');
const at = (day, h) => new Date(Date.parse(day + 'T00:00:00Z') + (h + 5) * 3600000).toISOString(); // hora de Lima -> ISO
// Datos personales que NUNCA pueden llegar al modelo (aparecen en clientes, créditos y abonos del lector).
const PII = ['Rosa Quispe Huamán', 'Juan Mamani', '40112233', '45556677', '987654321', '+51 912 345 678', 'Jr. Las Flores 123', 'rosa@correo.pe'];
const DATA = {
  products: [{ id: 'P1', nombre: 'Arroz 1 kg', precio: 4, costo: 3, stock: 50, min: 5, controla: true }, { id: 'P2', nombre: 'Aceite 1 L', precio: 10, costo: 8, stock: 20, min: 5, controla: true },
    { id: 'P3', nombre: 'Fideos 500 g', precio: 2.5, costo: 1.8, stock: 80, min: 10, controla: true }],
  customers: [{ id: 'C1', nombre: PII[0], dni: PII[2], telefono: PII[4], direccion: PII[6] }, { id: 'C2', nombre: PII[1], dni: PII[3], telefono: PII[5] }],
  credits: [{ cliente: 'C1', saldo: 30, vence: '2026-10-01' }, { cliente: 'C2', saldo: 12, vence: '2026-11-01' }],
  sales: [
    { sale_id: 'S1', created_at: at('2026-10-22', 9), metodo: 'efectivo', total_cents: 2000 },
    { sale_id: 'S2', created_at: at('2026-10-22', 11), metodo: 'credito', total_cents: 1000, cliente: 'C1' },
    { sale_id: 'S3', created_at: at('2026-10-22', 12), metodo: 'mixto', total_cents: 3000, cliente: 'C2' },
    { sale_id: 'S4', created_at: at('2026-10-22', 13), metodo: 'yape', total_cents: 9900, anulada: true }, // anulada: no cuenta
    { sale_id: 'S5', created_at: at('2026-10-21', 23.5), metodo: 'efectivo', total_cents: 4000 },         // 21 a las 23:30 Lima = 22 04:30Z: es del 21
    { sale_id: 'S6', created_at: at('2026-09-10', 10), metodo: 'plin', total_cents: 1500 },
    { sale_id: 'S7', created_at: at('2026-09-30', 10), metodo: 'efectivo', total_cents: 7000 }             // 30/09: fuera del «1 al 22» de septiembre
  ],
  saleItems: [
    { sale_id: 'S1', product_id: 'P1', quantity: 5, line_total_cents: 2000 },
    { sale_id: 'S2', product_id: 'P3', quantity: 4, line_total_cents: 1000 },
    { sale_id: 'S3', product_id: 'P2', quantity: 3, line_total_cents: 3000 },
    { sale_id: 'S4', product_id: 'P2', quantity: 99, line_total_cents: 9900 },
    { sale_id: 'S5', product_id: 'P1', quantity: 10, line_total_cents: 4000 }
  ],
  cashMovements: [{ sale_id: 'S3', credit_cents: 1200 }], // mixto: 18 al contado y 12 al crédito
  payments: [
    { payment_timestamp: at('2026-10-22', 10), amount_cents: 500, source_customer_name: PII[0], source_customer_document: PII[2] },
    { payment_date: '2026-10-22', payment_date_known: 1, amount_cents: 700, source_customer_name: PII[1] },
    { payment_date: '2026-10-22', payment_date_known: 0, amount_cents: 99999 }, // fecha no conocida: no cuenta
    { payment_timestamp: at('2026-10-21', 18), amount_cents: 300 }
  ]
};
const reader = () => memoryReader(DATA);
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

test('períodos en hora de Lima: día vs. día anterior; mes en curso vs. los mismos días del mes anterior; meses cerrados completos', () => {
  assert.deepEqual([summaryPeriods('resumen_dia', {}, NOW).actual.desde, summaryPeriods('resumen_dia', {}, NOW).anterior.desde], ['2026-10-22', '2026-10-21']);
  const d = summaryPeriods('resumen_dia', {}, NOW).actual;
  assert.equal(d.fromIso, '2026-10-22T05:00:00.000Z'); assert.equal(d.toIso, '2026-10-23T05:00:00.000Z');
  const m = summaryPeriods('resumen_mes', {}, NOW);
  assert.deepEqual([m.actual.desde, m.actual.hasta, m.anterior.desde, m.anterior.hasta, m.en_curso], ['2026-10-01', '2026-10-22', '2026-09-01', '2026-09-22', true]);
  const sep = summaryPeriods('resumen_mes', { hasta: '2026-09' }, NOW);
  assert.deepEqual([sep.actual.desde, sep.actual.hasta, sep.anterior.desde, sep.anterior.hasta, sep.en_curso], ['2026-09-01', '2026-09-30', '2026-08-01', '2026-08-31', false]);
  const ene = summaryPeriods('resumen_mes', { hasta: '2026-01-15' }, NOW);
  assert.deepEqual([ene.anterior.desde, ene.anterior.hasta], ['2025-12-01', '2025-12-31']);
  const mar = summaryPeriods('resumen_mes', {}, Date.parse('2026-03-31T20:00:00Z'));
  assert.deepEqual([mar.anterior.desde, mar.anterior.hasta], ['2026-02-01', '2026-02-28'], '31 de marzo se compara hasta el último día de febrero');
  assert.equal(summaryPeriods('resumen_dia', { hasta: '2027-01-01' }, NOW).actual.desde, '2026-10-22', 'una fecha futura queda en hoy');
  assert.equal(summaryPeriods('resumen_dia', { hasta: 'ayer; DROP TABLE' }, NOW).actual.desde, '2026-10-22');
  assert.equal(paymentDay({ payment_timestamp: '2026-10-22T03:00:00.000Z' }), '2026-10-21');
  assert.equal(paymentDay({ payment_date: '2026-10-22', payment_date_known: 0 }), null);
  assert.equal(paymentDay({ payment_date: '22/10/2026' }), null);
});

test('resumen del día: totales, contado/crédito (mixto por cash-movements), cobros, top por monto y por unidades, comparación; anuladas fuera', async () => {
  assert.ok(SUMMARY_TYPES.every((t) => QUERY_TYPES.includes(t)));
  const r = await runAssistantQuery(reader(), { tipo: 'resumen_dia' }, NOW);
  assert.ok(!r.error);
  const a = r.resumen.actual, b = r.resumen.anterior;
  assert.deepEqual([a.total_soles, a.ventas, a.contado_soles, a.credito_soles, a.cobros_soles, a.cobros, a.ticket_promedio], [60, 3, 38, 22, 12, 2, 20]);
  assert.deepEqual(a.por_metodo, { Efectivo: 20, Crédito: 10, Mixto: 30 });
  assert.deepEqual([b.desde, b.total_soles, b.ventas, b.cobros_soles], ['2026-10-21', 40, 1, 3]);
  assert.equal(r.resumen.cambio_pct.total, 50); assert.equal(r.resumen.cambio_pct.ventas, 200);
  assert.deepEqual(r.resumen.top_por_monto.map((x) => x.producto), ['producto #P2', 'producto #P1', 'producto #P3']);
  assert.deepEqual(r.resumen.top_por_unidades.map((x) => x.producto), ['producto #P1', 'producto #P3', 'producto #P2']);
  assert.ok(!/Aceite|Arroz|Fideos/.test(JSON.stringify(r.resumen) + r.texto), 'al modelo y en el texto: solo códigos de producto');
  assert.ok(r.filas.some((f) => f[0] === 'Top 1 por monto: Aceite 1 L (producto #P2, 3 unid.)'), 'la tabla del Admin sí lleva el nombre');
  assert.deepEqual(r.columnas, ['Detalle', 'Hoy', 'Día anterior', 'Cambio']);
  assert.deepEqual(r.filas[0], ['Ventas S/', 60, 40, '+50 %']);
  assert.match(r.texto, /S\/ 60\.00 en 3 ventas/); assert.match(r.texto, /contado S\/ 38\.00 y al crédito S\/ 22\.00/); assert.match(r.texto, /Cobros de créditos: S\/ 12\.00/);
  assert.ok(!/\.\./.test(r.texto), 'frases con un solo punto');
  assert.equal(r.total, undefined, 'sin «total» arriba: la tarjeta no muestra «Mostrando N de total»');
  assert.ok(JSON.stringify(r.resumen).length < 1500);
});

test('resumen del mes: en curso (1 al 22) contra septiembre 1 al 22; sin ventas -> texto claro; cobros no disponibles -> null', async () => {
  const r = await runAssistantQuery(reader(), { tipo: 'resumen_mes' }, NOW);
  assert.deepEqual([r.resumen.periodo, r.resumen.en_curso, r.resumen.actual.total_soles, r.resumen.actual.ventas, r.resumen.anterior.total_soles, r.resumen.anterior.ventas], ['mes', true, 100, 4, 15, 1]);
  assert.deepEqual(r.columnas, ['Detalle', 'Este mes', 'Mes anterior', 'Cambio']);
  const empty = await runAssistantQuery(reader(), { tipo: 'resumen_dia', hasta: '2026-10-10' }, NOW);
  assert.match(empty.texto, /No hay ventas registradas el 2026-10-10/);
  const noPays = await runAssistantQuery(memoryReader({ ...DATA, payments: undefined }), { tipo: 'resumen_dia' }, NOW);
  assert.equal(noPays.resumen.actual.cobros_soles, null); assert.ok(noPays.filas.some((f) => f[1] === 'no disponible'));
  assert.deepEqual(await runAssistantQuery({ products: async () => [] }, { tipo: 'resumen_dia' }, NOW), { error: 'no_summary' });
});

test('al modelo: solo totales y códigos de producto; nunca nombres, DNI, teléfonos, direcciones ni códigos de cliente', async () => {
  for (const tipo of SUMMARY_TYPES) {
    const r = await runAssistantQuery(reader(), { tipo }, NOW), sent = JSON.stringify(r.resumen) + JSON.stringify(r.filas) + r.texto;
    for (const v of PII) assert.ok(!sent.includes(v), tipo + ': no debe ir ' + v);
    assert.ok(!/C1|C2|cliente/i.test(JSON.stringify(r.resumen)), tipo + ': ni siquiera códigos de cliente');
  }
});

test('chat del Admin: consultar resumen_dia -> la 2.ª llamada lleva el resumen; NINGÚN pedido al modelo trae datos personales', async () => {
  const cap = [];
  const r = await chat({ text: 'Dame el resumen del día' }, { rd: reader(), fetch: scripted([{ content: '', tool_calls: [tool('consultar', { tipo: 'resumen_dia' }, 'call_1')] }, { content: 'Hoy vendiste S/ 60, un 50 % más que ayer.' }], cap) });
  assert.equal(r.status, 200); assert.equal(cap.length, 2);
  const p = r.body.proposals.find((x) => x.type === 'consulta');
  assert.ok(p && /Resumen del día/.test(p.result.titulo)); assert.equal(p.result.filas[0][1], 60);
  const toolMsg = JSON.parse(cap[1]).messages.find((m) => m.role === 'tool');
  assert.equal(toolMsg.tool_call_id, 'call_1'); assert.ok(toolMsg.content.length <= 2000);
  const sent = JSON.parse(toolMsg.content); assert.equal(sent.tipo, 'resumen_dia'); assert.equal(sent.resumen.actual.total_soles, 60);
  for (const body of cap) for (const v of PII) assert.ok(!body.includes(v), 'al modelo llegó ' + v);
  assert.match(r.body.reply, /S\/ 60/);
  // La herramienta del dueño ofrece los dos tipos.
  const def = toolsForRole('owner').find((t) => t.function.name === 'consultar');
  assert.ok(SUMMARY_TYPES.every((t) => def.function.parameters.properties.tipo.enum.includes(t)));
});

test('demostración (sin clave): «resumen del mes» arma la tarjeta de consulta del Admin', async () => {
  const r = await chat({ text: 'Quiero el resumen del mes' }, { rd: reader(), e: env({ ASSISTANT_DEMO: '1' }) });
  assert.equal(r.status, 200);
  const p = r.body.proposals.find((x) => x.type === 'consulta'); assert.ok(p, JSON.stringify(r.body));
  assert.match(p.result.titulo, /Resumen del mes 2026-10-01 a 2026-10-22/);
});

test('empleado: pedir el resumen con todas las letras -> 403 summary_admin_only ANTES del modelo y sin leer la base', async () => {
  for (const role of ['empleado:consultas', 'empleado:consultas_documentos']) {
    for (const text of ['Dame el resumen del día', 'resumen del mes', 'Resumen mensual por favor', 'quiero el resumen de ventas de hoy']) {
      const cap = [], [rd, n] = counting(reader());
      const r = await chat({ text }, { role, rd, fetch: scripted([{ content: 'x' }], cap) });
      assert.equal(r.status, 403, role + ' ' + text); assert.equal(r.body.error, 'summary_admin_only');
      assert.equal(cap.length, 0, 'sin llamada al modelo'); assert.equal(n.reads, 0, 'sin leer la base');
    }
  }
  assert.equal(employeeSummaryDenied('owner', 'resumen del día'), false);
  assert.equal(employeeSummaryDenied('empleado:consultas', '¿cuánto arroz hay?'), false);
});

test('empleado: si el modelo igual pide resumen_dia/resumen_mes -> 403 summary_admin_only, sin leer la base ni 2.ª llamada', async () => {
  for (const tipo of SUMMARY_TYPES) {
    const cap = [], [rd, n] = counting(reader());
    const r = await chat({ text: 'cómo vamos' }, { role: 'empleado:consultas', rd, fetch: scripted([{ content: '', tool_calls: [tool('consultar', { tipo }, 'c1')] }], cap) });
    assert.equal(r.status, 403, tipo); assert.equal(r.body.error, 'summary_admin_only');
    assert.equal(n.reads, 0); assert.equal(cap.length, 1);
  }
  // El empleado ni ve esos tipos en su herramienta.
  const def = toolsForRole('empleado:consultas').find((t) => t.function.name === 'consultar');
  assert.ok(def && SUMMARY_TYPES.every((t) => !def.function.parameters.properties.tipo.enum.includes(t)));
  assert.equal(toProposal({ name: 'consultar', arguments: JSON.stringify({ tipo: 'resumen_mes' }) }, 'empleado:consultas', { products: [] }, 1).dropped, 'forbidden_summary');
  assert.equal(toProposal({ name: 'consultar', arguments: JSON.stringify({ tipo: 'resumen_mes' }) }, 'owner', { products: [] }, 1).type, 'consulta');
});

test('celular: el 403 summary_admin_only se muestra en palabras simples (sin código) y no es «permiso perdido»', () => {
  const f = C.friendlyError('summary_admin_only');
  assert.match(f.msg, /solo para el Admin/); assert.ok(!/summary_admin_only|403/.test(f.msg));
});

test('empleado en partes (stream): resumen pedido por el modelo a mitad -> se corta, 403 summary_admin_only, nada del resumen sale', async () => {
  const enc = new TextEncoder(), sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
  const parts = [sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'consultar', arguments: JSON.stringify({ tipo: 'resumen_dia' }) } }] } }] }), sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), 'data: [DONE]\n\n'];
  const bodies = [], [rd, n] = counting(reader());
  const fetch = async (_u, init) => { bodies.push(String(init.body)); let i = 0; return new Response(new ReadableStream({ pull(c) { if (i < parts.length) c.enqueue(enc.encode(parts[i++])); else c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'cómo vamos', stream: true }) }),
    env({ DEEPSEEK_API_KEY: 'k' }), { principalId: 'session:x', posRole: 'empleado' }, json, { store: createMemoryUsageStore(), resolveRole: async () => 'empleado:consultas', fetch, reader: rd, audit: async () => {}, now: () => NOW });
  const raw = await new Response(r.body).text();
  assert.match(raw, /summary_admin_only/); assert.ok(!/S\/ 60|Arroz 1 kg|producto #/.test(raw), 'nada del resumen en el canal');
  assert.equal(n.reads, 0); assert.equal(bodies.length, 1);
});

test('producto con nombre de cliente («Encargo Sra. Rosa Quispe»): nunca llega al modelo; solo su código, también con código numérico largo', async () => {
  const NAME = 'Encargo Sra. Rosa Quispe', ID = '12345678'; // código de 8 cifras: el redactor lo taparía como DNI si no se protege
  const data = { ...DATA, products: [...DATA.products, { id: ID, nombre: NAME, precio: 50, costo: 40, stock: 1, min: 0, controla: true }],
    saleItems: [...DATA.saleItems, { sale_id: 'S1', product_id: ID, quantity: 1, line_total_cents: 9000 }] };
  for (const tipo of SUMMARY_TYPES) {
    const r = await runAssistantQuery(memoryReader(data), { tipo }, NOW);
    assert.ok(!JSON.stringify(r.resumen).includes('Rosa') && !r.texto.includes('Rosa'), tipo);
    assert.equal(r.resumen.top_por_monto[0].producto, 'producto #' + ID);
    assert.ok(r.filas.some((f) => String(f[0]).includes(NAME)), tipo + ': el nombre solo en la tabla del Admin');
  }
  const cap = [];
  // El modelo «explica» citando el código; la respuesta al Admin conserva el código (vuelve como historial) y la tarjeta trae el nombre.
  const r = await chat({ text: 'Dame el resumen del día', context: {} }, { rd: memoryReader(data), fetch: scripted([{ content: '', tool_calls: [tool('consultar', { tipo: 'resumen_dia' }, 'c1')] }, { content: 'Lo que más vendió fue producto #' + ID + '.' }], cap) });
  assert.equal(r.status, 200); assert.equal(cap.length, 2);
  for (const body of cap) { assert.ok(!body.includes('Rosa') && !body.includes('Quispe') && !body.includes('Encargo'), 'al modelo llegó el nombre'); for (const v of PII) assert.ok(!body.includes(v)); }
  const toolMsg = JSON.parse(cap[1]).messages.find((m) => m.role === 'tool');
  assert.ok(toolMsg.content.includes('producto #' + ID), 'el código pasa por redactText sin taparse: ' + toolMsg.content.slice(0, 300));
  assert.equal(r.body.reply, 'Lo que más vendió fue producto #' + ID + '.');
  assert.ok(!r.body.reply.includes('Rosa'));
  assert.ok(r.body.proposals[0].result.filas.some((f) => String(f[0]).includes(NAME)));
  // Un código con caracteres raros no se copia al modelo.
  const odd = await runAssistantQuery(memoryReader({ ...DATA, saleItems: [{ sale_id: 'S1', product_id: 'Rosa Quispe <b>', quantity: 1, line_total_cents: 100 }] }), { tipo: 'resumen_dia' }, NOW);
  assert.equal(odd.resumen.top_por_monto[0].producto, 'producto #sin-código');
});

test('tope de lectura (truncado): aviso en la PRIMERA fila de la tabla del Admin, en el texto y «truncado: true» al modelo', async () => {
  for (const tipo of SUMMARY_TYPES) {
    const r = await runAssistantQuery(memoryReader({ ...DATA, truncated: true }), { tipo }, NOW);
    assert.match(String(r.filas[0][0]), /^Aviso: datos incompletos/); assert.match(r.texto, /datos incompletos/);
    assert.equal(r.resumen.truncado, true); assert.equal(r.resumen.actual.truncado, true); assert.equal(r.resumen.anterior.truncado, true);
  }
  const ok = await runAssistantQuery(reader(), { tipo: 'resumen_dia' }, NOW);
  assert.equal(ok.resumen.truncado, false); assert.equal(ok.resumen.actual.truncado, false); assert.ok(!/Aviso/.test(String(ok.filas[0][0])));
  // Lector real: el tope de sale-items (no solo el de sales) también marca truncado.
  const src = (await import('node:fs')).readFileSync(new URL('../../tools/cloudflare-lab/src/pos-assistant-queries.js', import.meta.url), 'utf8');
  assert.match(src, /cut = !!\(sales\.truncated \|\| items\.truncated\)/);
});

test('venta «credito» con credit_cents 0 en cash-movements: sigue siendo crédito (no pasa a contado); mixto usa credit_cents > 0', async () => {
  const data = { ...DATA, cashMovements: [{ sale_id: 'S2', credit_cents: 0 }, { sale_id: 'S1', credit_cents: 0 }, { sale_id: 'S3', credit_cents: 1200 }] };
  const r = await runAssistantQuery(memoryReader(data), { tipo: 'resumen_dia' }, NOW);
  assert.equal(r.resumen.actual.credito_soles, 22, 'S2 (credito, 10) + parte crédito de S3 (12)'); assert.equal(r.resumen.actual.contado_soles, 38);
});

test('sin cash-movements (null, como el lector real si la lectura falla): con ventas mixtas, contado/crédito «no disponible»', async () => {
  const r = await runAssistantQuery(memoryReader({ ...DATA, cashMovements: undefined }), { tipo: 'resumen_dia' }, NOW);
  assert.equal(r.resumen.actual.contado_soles, null); assert.equal(r.resumen.actual.credito_soles, null);
  assert.deepEqual(r.filas.find((f) => f[0] === 'Al contado S/').slice(1, 2), ['no disponible']);
  assert.deepEqual(r.filas.find((f) => f[0] === 'Al crédito S/').slice(1, 2), ['no disponible']);
  assert.ok(!/Al contado/.test(r.texto), 'el texto no inventa la división');
  // Sin mixtas no hace falta cash-movements: el día anterior (solo efectivo) sí se calcula por método.
  assert.equal(r.resumen.anterior.contado_soles, 40); assert.equal(r.resumen.anterior.credito_soles, 0);
});

test('#931 + #934: redactDeep con «producto #código» protegido; el resto (DNI, teléfono) se sigue tapando', () => {
  const ids = ['12345678', 'P1'];
  const fn = (t) => protectProductRefs(t, ids, redactText);
  const v = { top_por_monto: [{ producto: 'producto #12345678', monto: 90 }, { producto: 'producto #P1', monto: 20 }], nota: 'Rosa Quispe DNI 45678912 cel 987654321', otro: ['+51 912 345 678'] };
  const out = redactDeep(v, 0, fn);
  assert.equal(out.top_por_monto[0].producto, 'producto #12345678'); assert.equal(out.top_por_monto[1].producto, 'producto #P1'); assert.equal(out.top_por_monto[0].monto, 90);
  const s = fn(JSON.stringify(out));
  assert.ok(s.includes('producto #12345678'), s);
  for (const x of ['45678912', '987654321', '912 345 678']) assert.ok(!s.includes(x), x + ' en ' + s);
  // sin el protector, el código de 8 cifras se tapa (por eso hace falta)
  assert.ok(!JSON.stringify(redactDeep(v)).includes('#12345678'));
  // por defecto redactDeep sigue igual que en #934
  assert.deepEqual(redactDeep({ a: ['x 987654321'] }), { a: ['x ' + redactText('987654321')] });
});

test('#931 + #934: chat del Admin con resumen_mes -> al modelo ningún nombre, DNI, teléfono ni dirección de cliente', async () => {
  const cap = [];
  const r = await chat({ text: 'resumen del mes', context: {} }, { rd: memoryReader(DATA), fetch: scripted([{ content: '', tool_calls: [tool('consultar', { tipo: 'resumen_mes' }, 'c1')] }, { content: 'Listo.' }], cap) });
  assert.equal(r.status, 200);
  for (const body of cap) for (const v of PII) assert.ok(!body.includes(v), v);
  const toolMsg = JSON.parse(cap[cap.length - 1]).messages.find((m) => m.role === 'tool');
  assert.ok(toolMsg && /producto #P\d/.test(toolMsg.content), toolMsg && toolMsg.content.slice(0, 300));
});

// (22-10, prueba en vivo) líneas genéricas («GENERIC:<uuid>», una por línea, p. ej. VARIOS/VERDURAS): en el resumen van juntas como
// «Producto genérico» / «producto genérico»; nunca el id crudo en la tabla ni en lo que ve el modelo.
test('resumen: líneas genéricas juntas como «Producto genérico», sin el id GENERIC:<uuid>', async () => {
  const g = (n) => 'GENERIC:11111111-aaaa-4bbb-8ccc-00000000000' + n;
  const data = { ...DATA, sales: DATA.sales.concat([{ sale_id: 'G1', created_at: at('2026-10-22', 14), metodo: 'efectivo', total_cents: 6000 }, { sale_id: 'G2', created_at: at('2026-10-22', 15), metodo: 'efectivo', total_cents: 5000 }]),
    saleItems: DATA.saleItems.concat([{ sale_id: 'G1', product_id: g(1), quantity: 2, line_total_cents: 6000 }, { sale_id: 'G2', product_id: g(2), quantity: 1, line_total_cents: 5000 }]) };
  const r = await runAssistantQuery(memoryReader(data), { tipo: 'resumen_dia' }, NOW);
  const all = JSON.stringify(r);
  assert.ok(!all.includes('GENERIC:'), all);
  assert.ok(r.filas.some((f) => /^Top 1 por monto: Producto genérico \(producto genérico, 3 unid\.\)$/.test(f[0]) && f[1] === 110), JSON.stringify(r.filas));
});
