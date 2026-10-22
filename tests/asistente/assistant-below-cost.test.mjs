// (22-10) «Ventas bajo costo» (solo Admin): solo lectura; al modelo solo «producto #código» y totales, nunca nombres.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { belowCostRoute, findBelowCost, buildBelowCostReport, belowCostPeriod, BELOW_COST_PATH, BELOW_COST_DENIED } from '../../tools/cloudflare-lab/src/pos-assistant-below-cost.js';
import { memoryReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const WORKER = readFileSync('tools/cloudflare-lab/src/worker.js', 'utf8');
const SRC = readFileSync('tools/cloudflare-lab/src/pos-assistant-below-cost.js', 'utf8');
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const NOW = Date.parse('2026-10-22T17:00:00Z');
const ENV = { ASSISTANT_ENABLED: '1' };
const OWNER = { principalId: 'dev-admin', posRole: 'owner' }, EMP = { principalId: 'dev-emp', posRole: 'empleado' };
const owner = async () => 'owner';
const DATA = {
  products: [
    { id: '12', nombre: 'Arroz Costeño 5 kg', costo: 20, precio: 24 },
    { id: '123', nombre: 'Aceite Primor 1 L', costo: 9, precio: 8.5 },   // precio actual < costo
    { id: 'p-3', nombre: 'Leche Gloria', costo: 4, precio: 4.5 },
    { id: 'p-4', nombre: 'Chicle', costo: 0, precio: 0.5 }               // sin costo
  ],
  sales: [
    { sale_id: 's1', created_at: '2026-10-20T15:00:00Z', metodo: 'efectivo', total_cents: 3800 },
    { sale_id: 's2', created_at: '2026-10-21T15:00:00Z', metodo: 'efectivo', total_cents: 1700 },
    { sale_id: 's3', created_at: '2026-10-21T16:00:00Z', metodo: 'efectivo', total_cents: 100, anulada: true },
    { sale_id: 's4', created_at: '2026-08-01T15:00:00Z', metodo: 'efectivo', total_cents: 100 }
  ],
  saleItems: [
    { sale_id: 's1', product_id: '12', quantity: 2, unit_price_cents: 1900, line_total_cents: 3800 },   // 2 × (20 − 19) = 2
    { sale_id: 's2', product_id: '123', quantity: 2, unit_price_cents: 850, line_total_cents: 1700 },  // 2 × 0,50 = 1
    { sale_id: 's2', product_id: 'p-3', quantity: 1, unit_price_cents: 450, line_total_cents: 450 },
    { sale_id: 's2', product_id: 'p-4', quantity: 1, unit_price_cents: 50, line_total_cents: 50 },
    { sale_id: 's3', product_id: 'p-3', quantity: 1, unit_price_cents: 100, line_total_cents: 100 },   // anulada: no cuenta
    { sale_id: 's4', product_id: 'p-3', quantity: 1, unit_price_cents: 100, line_total_cents: 100 }    // fuera del período
  ]
};
const NAMES = ['Arroz', 'Aceite', 'Leche', 'Chicle', 'Rosa Quispe'];
const req = (body = {}, method = 'POST') => new Request('https://w.example' + BELOW_COST_PATH, { method, body: method === 'POST' ? JSON.stringify(body) : undefined });

test('período: por defecto los últimos 30 días; tope de 92', () => {
  assert.deepEqual([belowCostPeriod({}, NOW).desde, belowCostPeriod({}, NOW).hasta], ['2026-09-23', '2026-10-22']);
  assert.equal(belowCostPeriod({ desde: '2025-01-01', hasta: '2026-10-22' }, NOW).desde, '2026-07-22');
});

test('cálculo: pérdida por producto, catálogo con precio < costo, sin costo aparte, anuladas y fuera de fecha no cuentan', async () => {
  const R = memoryReader(DATA), p = belowCostPeriod({}, NOW);
  const s = findBelowCost(await R.products(), await R.saleLines(p));
  assert.deepEqual(s.ventas.map((g) => [g.id, g.ventas, g.unidades, g.precio_min, g.perdida]), [['12', 1, 2, 19, 2], ['123', 1, 2, 8.5, 1]]);
  assert.deepEqual(s.catalogo.map((c) => [c.id, c.precio, c.costo]), [['123', 8.5, 9]]);
  assert.equal(s.perdida_total, 3); assert.equal(s.sin_costo, 1); assert.equal(s.lineas_revisadas, 3);
  const r = buildBelowCostReport(s, p);
  assert.match(r, /producto #12: 1 venta, 2 unid\., precio más bajo S\/ 19\.00 con costo S\/ 20\.00, pérdida S\/ 2\.00/);
  for (const n of NAMES) assert.ok(!r.includes(n), n);
  assert.doesNotMatch(r, /\*\*/);
});

test('empleado o aparato sin rol: 403 sin leer ni llamar al modelo', async () => {
  let read = 0, called = 0; const rd = { async products() { read++; return []; }, async saleLines() { read++; return []; } };
  for (const [auth, role] of [[EMP, 'empleado:consultas'], [EMP, 'empleado:consultas_documentos'], [OWNER, 'empleado:off'], [EMP, 'owner']]) {
    const r = await belowCostRoute(req(), ENV, auth, jsonR, { resolveRole: async () => role, reader: rd, store: createMemoryUsageStore(), fetch: async () => { called++; } });
    assert.equal(r.status, 403); assert.deepEqual(await r.json(), BELOW_COST_DENIED);
  }
  assert.equal(read, 0); assert.equal(called, 0);
});

test('bandera apagada 404, GET 405, cuerpo roto 400, lectura fallida 502', async () => {
  const d = { resolveRole: owner, reader: memoryReader(DATA) };
  assert.equal((await belowCostRoute(req(), {}, OWNER, jsonR, d)).status, 404);
  assert.equal((await belowCostRoute(req({}, 'GET'), ENV, OWNER, jsonR, d)).status, 405);
  assert.equal((await belowCostRoute(new Request('https://w.example/x', { method: 'POST', body: '{roto' }), ENV, OWNER, jsonR, d)).status, 400);
  const bad = await belowCostRoute(req(), ENV, OWNER, jsonR, { resolveRole: owner, reader: { async products() { throw new Error('x'); }, async saleLines() { return []; } } });
  assert.equal(bad.status, 502);
});

test('Admin sin proveedor: informe fijo con el nombre de SU producto en pantalla («#123» no se confunde con «#12»)', async () => {
  const r = await belowCostRoute(req(), ENV, OWNER, jsonR, { resolveRole: owner, reader: memoryReader(DATA), store: createMemoryUsageStore(), now: () => NOW });
  const d = await r.json(); assert.equal(r.status, 200); assert.equal(d.source, 'resumen');
  assert.match(d.report, /• Arroz Costeño 5 kg: 1 venta/); assert.match(d.report, /• Aceite Primor 1 L: 1 venta/); assert.doesNotMatch(d.report, /producto #/);
  assert.equal(d.perdida_total, 3); assert.equal(d.ventas[0].nombre, 'Arroz Costeño 5 kg');
});

test('con proveedor: al modelo solo «producto #código» y totales; nunca nombres', async () => {
  const sent = [];
  const fetchFn = async (u, init) => { sent.push(String(init?.body || '')); return jsonR({ choices: [{ message: { content: 'Revise producto #123 y producto #12.' } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }); };
  const r = await belowCostRoute(req(), { ...ENV, OHMYAGENT_API_KEY: 'clave-prueba-ohmyagent' }, OWNER, jsonR, { resolveRole: owner, reader: memoryReader(DATA), store: createMemoryUsageStore(), now: () => NOW, fetch: fetchFn });
  const d = await r.json();
  assert.equal(sent.length, 1); assert.match(sent[0], /producto #12:/); assert.match(sent[0], /producto #123:/);
  for (const n of NAMES) assert.ok(!sent[0].includes(n), 'al modelo: ' + n);
  assert.equal(d.source, 'modelo'); assert.equal(d.report, 'Revise Aceite Primor 1 L y Arroz Costeño 5 kg.');
});

test('sin hallazgos no se gasta cupo ni se llama al modelo', async () => {
  let called = 0;
  const r = await belowCostRoute(req(), { ...ENV, OHMYAGENT_API_KEY: 'k' }, OWNER, jsonR, { resolveRole: owner, reader: memoryReader({ products: [], sales: [], saleItems: [] }), store: createMemoryUsageStore(), now: () => NOW, fetch: async () => { called++; } });
  const d = await r.json(); assert.equal(called, 0); assert.match(d.report, /Ninguna venta del período/);
});

test('solo lectura: el módulo no escribe en la base ni toca compras o códigos duplicados', () => {
  assert.doesNotMatch(SRC, /INSERT|UPDATE |DELETE|\.run\(|codigos-duplicados|pos_purchases/i);
});

test('pantalla y Worker: solo Admin, ruta con la misma bandera, mensaje amable', () => {
  assert.match(UI, /isOwnerAccess\(\) && BELOW_RE\.test\(text\)/);
  assert.match(UI, /data-q="Ventas bajo costo"/);
  assert.match(WORKER, /url\.pathname === ASSISTANT_BELOW_COST_PATH\) \{\n\s+if \(String\(env\.ASSISTANT_ENABLED \|\| ''\) !== '1'\) return json\(\{ error: 'not_found' \}, 404\);\n\s+const auth = await authorizeSession/);
  assert.equal(C.friendlyError('below_cost_admin_only').msg, 'Las alertas de venta bajo costo son solo para el Admin.');
  const re = new RegExp(UI.match(/var BELOW_RE = \/(.+)\/i;/)[1], 'i');
  for (const t of ['Ventas bajo costo', '¿Vendí algo por debajo del costo?', 'pérdidas en ventas', 'vendimos a pérdida']) assert.ok(re.test(t), t);
  for (const t of ['Productos sin costo', '¿Cuánto vendimos hoy?', 'Revisión del punto de venta']) assert.ok(!re.test(t), t);
});
