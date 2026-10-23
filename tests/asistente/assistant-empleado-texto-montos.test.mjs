// Auditoría 500 (pedido de alfa sobre #984): employeeQueryResult deja pasar el `texto` de la consulta tal cual al empleado.
// Aquí se comprueba, por la entrada real del chat (assistantChatRoute, modelo simulado que llama «consultar»), que NINGÚN nivel de
// empleado llega a una consulta cuyo texto traiga montos: ventas, ganancia, costos, caja, deudas, compras. Datos sembrados con
// cifras únicas para que cualquier fuga se vea. Control positivo: el Admin, con las mismas llamadas, SÍ ve esas cifras (la prueba
// no pasa por vacía). Lado de ENTRADA (lo que entrega la consulta); el tapado de la respuesta final es de fix/asist-seguridad-500.
// Precio de venta: permitido (es la misma columna «Precio S/» de la lista de precios del empleado).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore, employeeQueryResult } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader, runAssistantQuery, QUERY_TYPES } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { LEVEL_NAMES, COSTS_ROLE, capabilitiesFor, seesOwnerData } from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const NOW = Date.parse('2026-10-22T20:00:00.000Z'); // 15:00 en Lima
const at = (h) => new Date(Date.parse('2026-10-22T00:00:00Z') + (h + 5) * 3600000).toISOString();

// Cifras únicas: si alguna aparece en lo que recibe el empleado, hay fuga.
const DATA = {
  products: [
    { id: 'P1', nombre: 'Arroz 1 kg', precio: 4.5, costo: 3.1, stock: 2, min: 5, controla: true },
    { id: 'P2', nombre: 'Aceite 1 L', precio: 7.25, costo: 5.9, stock: 40, min: 5, controla: true },
    { id: 'P3', nombre: 'Galleta suelta', precio: 1.5, costo: 0, stock: 9, min: 1, controla: true }
  ],
  customers: [{ id: 'C-0001', nombre: 'C-0001' }, { id: 'C-0002', nombre: 'C-0002' }],
  credits: [
    { cliente: 'C-0001', saldo: 876.54, vence: '2026-09-01', fecha: '2026-08-01' },
    { cliente: 'C-0002', saldo: 321.09, vence: '2026-10-01', fecha: '2026-09-01' }
  ],
  sales: [
    { sale_id: 'S1', created_at: at(9), metodo: 'efectivo', total_cents: 123457 },
    { sale_id: 'S2', created_at: at(11), metodo: 'yape', total_cents: 98765 }
  ],
  saleItems: [
    { sale_id: 'S1', product_id: 'P1', quantity: 2743, line_total_cents: 123457, unit_price_cents: 450 },
    { sale_id: 'S2', product_id: 'P2', quantity: 1362, line_total_cents: 98765, unit_price_cents: 725 }
  ],
  cashMovements: [],
  payments: [],
  purchases: [{ created_at: '2026-10-21T15:00:00.000Z', supplier: 'PROV-1', document_ref: 'F001-1', total_cost_cents: 4321099, line_count: 3 }],
  cash: { ready: true, open: { opened_at: at(7), opening_cents: 55555, expected_cents: 66666 }, rows: [{ k: 'venta', metodo: 'efectivo', n: 1, a: 123457, b: 0, c: 0 }] }
};
const SECRET_FIGURES = ['1234.57', '987.65', '2222.22', '876.54', '321.09', '1197.63', '43210.99', '555.55', '666.66', '3.10', '5.90'];
const SALE_PRICES = ['4.50', '7.25', '1.50'];
const ARGS = { producto: 'arroz', cliente_id: 'C-0001', periodo: 'hoy' };

const EMPLOYEE_ROLES = LEVEL_NAMES.map((n) => 'empleado:' + n).concat(['empleado', 'sin_rol', 'empleado:desconocido']);
// Nivel 3 + «costos y cambios»: ve ventas y ganancia a propósito (lo da el Admin), pero nunca deudas, caja, créditos, sugerencias ni resúmenes.
const COSTS_FORBIDDEN = ['deudas_clientes', 'deuda_cliente', 'creditos_atrasados', 'caja_abierta', 'sugerencias_compra', 'resumen_dia', 'resumen_mes'];

function countingReader() {
  const base = memoryReader(DATA), reads = [];
  const r = {}; for (const k of Object.keys(base)) r[k] = async (...a) => { reads.push(k); return base[k](...a); };
  return [r, reads];
}
const toolCall = (tipo) => ({ id: 'call_q', type: 'function', function: { name: 'consultar', arguments: JSON.stringify({ tipo, ...ARGS }) } });
// 1ª llamada: solo «consultar». 2ª (si la hay): texto sin cifras. Se guardan los pedidos al modelo.
function scripted(tipo, cap) {
  let i = 0;
  return async (_u, init) => { cap.push(String(init.body));
    const msg = i++ === 0 ? { role: 'assistant', content: '', tool_calls: [toolCall(tipo)] } : { role: 'assistant', content: 'Listo, eso es lo que encontré.' };
    return json({ choices: [{ message: msg }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); };
}
const enc = new TextEncoder(), sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
function scriptedStream(tipo, cap) {
  let i = 0;
  return async (_u, init) => { cap.push(String(init.body));
    const chunks = i++ === 0
      ? [sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_q', function: { name: 'consultar', arguments: JSON.stringify({ tipo, ...ARGS }) } }] } }] }), sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })]
      : [sse({ choices: [{ delta: { content: 'Listo, eso es lo que encontré.' } }] }), sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })];
    return new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
}
async function chat(role, tipo, { text = '¿me das el dato?', stream = false } = {}) {
  const cap = [], [rd, reads] = countingReader();
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, stream, context: { products: DATA.products } }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, json,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: stream ? scriptedStream(tipo, cap) : scripted(tipo, cap), reader: rd, audit: async () => {}, now: () => NOW });
  let out;
  if (stream && /event-stream/.test(r.headers.get('content-type') || '')) {
    const ev = []; const p = C.createSseParser((e, d) => ev.push({ e, d }));
    const rr = r.body.getReader(), dec = new TextDecoder(); for (;;) { const { value, done } = await rr.read(); if (done) break; p.feed(dec.decode(value, { stream: true })); }
    out = JSON.stringify(ev);
  } else out = await r.text();
  return { status: r.status, out, toModel: cap.slice(1).join('\n'), reads };
}
const amounts = (s) => [...String(s).matchAll(/S\/\s*(-?\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')).toFixed(2));
function assertNoMoney(label, s, { prices = true } = {}) {
  for (const f of SECRET_FIGURES) assert.ok(!s.includes(f), `${label}: aparece la cifra ${f}: ${s.slice(0, 400)}`);
  for (const a of amounts(s)) assert.ok(prices && SALE_PRICES.includes(a), `${label}: monto S/ ${a} que no es precio de venta: ${s.slice(0, 400)}`);
}

test('control: con estos datos el Admin SÍ recibe montos en el texto (la prueba no es vacía)', async () => {
  for (const [tipo, fig] of [['ventas_periodo', '2222.22'], ['ganancia', ''], ['deudas_clientes', '1197.63'], ['caja_abierta', '666.66'], ['compras_recientes', '43210.99'], ['ventas_por_hora', ''], ['top_productos', '1234.57']]) {
    const r = await chat('owner', tipo);
    assert.equal(r.status, 200, tipo);
    assert.ok(amounts(r.out).length > 0, `${tipo}: el Admin ve S/ en el texto: ${r.out.slice(0, 300)}`);
    if (fig) assert.ok(r.out.includes(fig), `${tipo}: el Admin ve ${fig}`);
  }
  // y la consulta cruda trae montos en el texto en cada tipo con plata
  for (const tipo of ['ventas_periodo', 'top_productos', 'ganancia', 'deudas_clientes', 'deuda_cliente', 'creditos_atrasados', 'caja_abierta', 'compras_recientes', 'ventas_por_hora', 'sugerencias_compra']) {
    const q = await runAssistantQuery(memoryReader(DATA), { tipo, ...ARGS }, NOW);
    assert.ok(amounts(q.texto).length > 0, `${tipo} trae S/ en el texto: ${q.texto}`);
  }
});

test('niveles de empleado sin «costos»: solo stock_producto y bajo_stock están permitidos (fuente única de niveles)', () => {
  for (const role of EMPLOYEE_ROLES) {
    assert.equal(seesOwnerData(role), false, role);
    const c = capabilitiesFor(role).consultas;
    assert.ok(Array.isArray(c) && c.every((t) => ['stock_producto', 'bajo_stock'].includes(t)), `${role}: ${JSON.stringify(c)}`);
  }
});

for (const stream of [false, true]) {
  test(`empleado (todos los niveles sin «costos»${stream ? ', en partes' : ''}): ninguna consulta le entrega montos; las de plata ni se leen`, async () => {
    for (const role of EMPLOYEE_ROLES) for (const tipo of QUERY_TYPES) {
      const label = `${role} / ${tipo}${stream ? ' / partes' : ''}`;
      const r = await chat(role, tipo, { stream });
      assert.ok([200, 403].includes(r.status), `${label}: ${r.status}`);
      assertNoMoney(label, r.out);
      assertNoMoney(label + ' (al modelo)', r.toModel);
      if (!['stock_producto', 'bajo_stock'].includes(tipo)) {
        const money = r.reads.filter((k) => k !== 'products' && k !== 'productsById');
        assert.deepEqual(money, [], `${label}: no lee ventas, créditos, caja ni compras`);
      }
    }
  });
}

test('empleado nivel 1-3: stock_producto solo trae el precio de venta y bajo_stock ninguna cifra en soles', async () => {
  for (const role of ['empleado:consultas', 'empleado:consultas_documentos', 'empleado:completo']) {
    const s = await chat(role, 'stock_producto');
    assert.equal(s.status, 200, role);
    assert.ok(s.out.includes('Arroz 1 kg'), `${role}: la consulta sí corrió: ${s.out.slice(0, 300)}`);
    assert.deepEqual([...new Set(amounts(s.out))], ['4.50'], `${role}: solo el precio de venta`);
    const b = await chat(role, 'bajo_stock');
    assert.equal(b.status, 200, role); assert.ok(b.out.includes('Arroz 1 kg'), role);
    assert.deepEqual(amounts(b.out), [], `${role}: bajo_stock sin S/`);
  }
});

test(`${COSTS_ROLE}: nunca llega a deudas, caja, créditos atrasados, sugerencias ni resúmenes`, async () => {
  for (const tipo of COSTS_FORBIDDEN) for (const stream of [false, true]) {
    const r = await chat(COSTS_ROLE, tipo, { stream });
    assert.ok([200, 403].includes(r.status), `${tipo}: ${r.status}`);
    assertNoMoney(`${COSTS_ROLE} / ${tipo}`, r.out); assertNoMoney(`${COSTS_ROLE} / ${tipo} (al modelo)`, r.toModel);
    assert.deepEqual(r.reads.filter((k) => k !== 'products' && k !== 'productsById'), [], `${tipo}: no se lee`);
  }
});

test('employeeQueryResult: para las consultas del empleado el texto que deja pasar no trae montos (solo precio de venta)', async () => {
  for (const tipo of ['stock_producto', 'bajo_stock']) {
    const e = employeeQueryResult(await runAssistantQuery(memoryReader(DATA), { tipo, ...ARGS }, NOW));
    assertNoMoney(tipo, JSON.stringify(e));
  }
});
