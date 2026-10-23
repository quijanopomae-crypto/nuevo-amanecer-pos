// Datos y ayudas compartidas de assistant-empleado-texto-montos.test.mjs y de empleado-lista-abierta.mjs (proceso aparte con la lista
// de consultas del empleado abierta a propósito). Cifras únicas: si alguna aparece en lo que recibe el empleado, hay fuga.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
export const NOW = Date.parse('2026-10-22T20:00:00.000Z'); // 15:00 en Lima
const at = (h) => new Date(Date.parse('2026-10-22T00:00:00Z') + (h + 5) * 3600000).toISOString();

// Cifras únicas: si alguna aparece en lo que recibe el empleado, hay fuga.
export const DATA = {
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
export const SECRET_FIGURES = ['1234.57', '987.65', '2222.22', '876.54', '321.09', '1197.63', '43210.99', '555.55', '666.66', '3.10', '5.90'];
export const SALE_PRICES = ['4.50', '7.25', '1.50'];
export const ARGS = { producto: 'arroz', cliente_id: 'C-0001', periodo: 'hoy' };

export function countingReader() {
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
// route: assistantChatRoute (el proceso de la lista abierta pasa el suyo, cargado con los niveles cambiados).
export async function chatWith(assistantChatRoute, role, tipo, { text = '¿me das el dato?', stream = false } = {}) {
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
export const amounts = (s) => [...String(s).matchAll(/S\/\s*(-?\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')).toFixed(2));
export function assertNoMoney(label, s, { prices = true } = {}) {
  for (const f of SECRET_FIGURES) assert.ok(!s.includes(f), `${label}: aparece la cifra ${f}: ${s.slice(0, 400)}`);
  for (const a of amounts(s)) assert.ok(prices && SALE_PRICES.includes(a), `${label}: monto S/ ${a} que no es precio de venta: ${s.slice(0, 400)}`);
}

// Resultados de «consulta» que llegaron a la pantalla (respuesta JSON o eventos en partes).
export function consultaResults(out) {
  const found = [];
  const walk = (v) => {
    if (typeof v === 'string') { if (/^[[{]/.test(v.trim())) { try { walk(JSON.parse(v)); } catch { /* texto */ } } return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') { if (v.type === 'consulta' && v.result) found.push(v.result); Object.values(v).forEach(walk); }
  };
  try { walk(JSON.parse(out)); } catch { /* no es JSON */ }
  return found;
}
