// Lentitud 22-10 (paso 2): tiempos por paso en la respuesta, en la consola y en la fila de bitácora. Sin textos ni datos de clientes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, createMemoryUsageStore, countingDb } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { auditWrite, cleanTimings } from '../../tools/cloudflare-lab/src/pos-assistant-audit.js';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const tool = (name, args, id = 'call_1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const KEYS = ['attempts', 'db_stmts', 'fallback', 'ms_db', 'ms_gates', 'ms_model1', 'ms_total', 'model', 'provider'];
const PRODUCTS = Array.from({ length: 30 }, (_, i) => ({ id: 'P' + i, nombre: 'Producto ' + i, precio: 2, costo: 1, stock: i % 4, min: 2, controla: true }));
function scripted(list, cap = []) { let i = 0; return async (url, init) => { cap.push({ url, body: JSON.parse(init.body) }); const x = list[Math.min(i++, list.length - 1)]; return typeof x === 'number' ? new Response('{}', { status: x }) : jsonR({ choices: [{ message: x }] }); }; }
async function chat(body, { env = {}, fetch, rows = [], reader, db } = {}) {
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ context: { products: PRODUCTS }, ...body }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, OHMYAGENT_API_KEY: 'k1', ...env }, { principalId: 'session:o', posRole: 'owner' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', fetch, reader: reader || memoryReader({ products: PRODUCTS }), audit: async (_d, x) => { rows.push(...x); return x.length; }, ...(db ? { db } : {}) });
  return { status: r.status, body: await r.json(), rows };
}
function quiet(t) { const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' ')); t.after(() => { console.log = orig; }); return logs; }

test('pregunta simple: timings con los campos acordados, sin textos; una línea de consola estructurada', async (t) => {
  const logs = quiet(t);
  const r = await chat({ text: 'hola, soy Juan Pérez con DNI 12345678' }, { fetch: scripted([{ content: 'Hola Admin.' }]) });
  assert.equal(r.status, 200);
  const tm = r.body.timings; assert.deepEqual(Object.keys(tm).sort(), [...KEYS].sort());
  assert.equal(tm.provider, 'ohmyagent'); assert.equal(tm.model, 'gpt-6.1-sol'); assert.equal(tm.attempts, 1); assert.equal(tm.fallback, false);
  for (const k of ['ms_gates', 'ms_model1', 'ms_db', 'ms_total', 'db_stmts']) assert.ok(Number.isInteger(tm[k]) && tm[k] >= 0, k);
  const line = logs.find((l) => l.startsWith('[asistente] tiempos ')); assert.ok(line);
  assert.deepEqual(JSON.parse(line.slice('[asistente] tiempos '.length)), tm);
  assert.ok(!/Juan|12345678|Hola/.test(line + JSON.stringify(tm)), 'sin textos del chat');
});

test('consulta: segunda llamada medida (ms_model2), y la fila de bitácora lleva los mismos tiempos', async (t) => {
  quiet(t);
  const r = await chat({ text: 'qué me falta y explícame por qué' }, { fetch: scripted([{ content: '', tool_calls: [tool('consultar', { tipo: 'bajo_stock' }), tool('consultar', { tipo: 'sin_costo' }, 'call_2')] }, { content: 'Te faltan varios.' }]) });
  assert.equal(r.status, 200); assert.ok(Number.isInteger(r.body.timings.ms_model2)); assert.equal(r.body.timings.second_call, true); assert.equal(r.body.timings.attempts, 2);
  assert.ok(r.rows.length >= 1); assert.deepEqual(r.rows[0].timings, r.body.timings);
});

test('respaldo: OhMyAgent ocupado (429) -> Routeway responde; attempts y fallback lo dicen', async (t) => {
  quiet(t);
  const cap = [];
  const r = await chat({ text: 'hola' }, { env: { ROUTEWAY_API_KEY: 'k2' }, fetch: scripted([429, 429, { content: 'Hola.' }], cap) });
  assert.equal(r.status, 200); assert.equal(r.body.timings.fallback, true); assert.equal(r.body.timings.attempts, 3);
  assert.equal(r.body.timings.provider, 'routeway'); assert.match(cap[2].url, /routeway/);
});

test('error del proveedor: la respuesta de error también trae los tiempos', async (t) => {
  quiet(t);
  const r = await chat({ text: 'hola' }, { fetch: scripted([401]) });
  assert.equal(r.status, 502); assert.equal(r.body.timings.attempts, 1); assert.ok(Number.isInteger(r.body.timings.ms_total));
});

test('db_stmts cuenta las sentencias del pedido (rol, proveedor, cupo, consulta, bitácora aparte) y batch pasa las sentencias reales', async (t) => {
  quiet(t);
  const seen = []; const raw = { prepare(sql) { const st = { sql, bind() { return { ...st, bound: true }; }, async first() { seen.push(sql); return null; }, async all() { seen.push(sql); return { results: [] }; }, async run() { seen.push(sql); return { meta: { changes: 1 } }; } }; return st; },
    async batch(list) { assert.ok(list.every((x) => x.bound && !x.__raw), 'batch recibe las sentencias originales'); seen.push('batch'); return []; } };
  const c = { n: 0 }, db = countingDb(raw, c);
  await db.prepare('SELECT 1').bind(1).first(); await db.batch([db.prepare('INSERT 1').bind(1), db.prepare('INSERT 2').bind(2)]);
  assert.equal(c.n, 2); assert.deepEqual(seen, ['SELECT 1', 'batch']);
});

test('bitácora: solo números, booleanos y nombres cortos (lo demás se cae)', async () => {
  assert.deepEqual(cleanTimings({ ms_total: 12.6, attempts: '2', provider: 'ohmyagent', model: 'gpt-6.1-sol', fallback: false, texto: 'Juan', ms_db: 'x', model2: 'a b' }),
    { ms_total: 13, attempts: 2, provider: 'ohmyagent', model: 'gpt-6.1-sol', fallback: false });
  const stmts = []; const db = { prepare: (sql) => ({ bind: (...v) => ({ sql, v }) }), batch: async (l) => { stmts.push(...l); return []; } };
  await auditWrite(db, [{ device_id: 'session:o', role: 'owner', tool: 'consultar', type: 'consulta', outcome: 'proposed', card_id: 'c1', timings: { ms_total: 5, provider: 'ohmyagent', note: 'nombre de cliente' } }]);
  const val = JSON.parse(stmts[0].v[1]); assert.deepEqual(val.timings, { ms_total: 5, provider: 'ohmyagent' });
});
