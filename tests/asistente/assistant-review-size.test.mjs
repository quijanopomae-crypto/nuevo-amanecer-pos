// «Revisión del punto de venta» con las listas del monitor LLENAS (200 errores, 200 lentos, 300 contadores, textos al tope): antes el
// envío pasaba el tope del servidor (96 KB) y se rechazaba con 413. Ahora el aparato lo compacta (C.compactReview) bajo REVIEW_BUDGET y el
// servidor lo acepta. Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assistantReviewRoute, REVIEW_PATH, REVIEW_LIMITS } from '../../tools/cloudflare-lab/src/pos-assistant-review.js';
import { createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const bytes = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
const pad = (s, n) => (s + 'ñ'.repeat(n)).slice(0, n); // ñ: 2 bytes en UTF-8 (el peor caso del tope en bytes)
const iso = (i) => new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString();

// lo que arma reviewData() con las listas del cargador al máximo (REV_MAX 200, REV_SLOW_MAX 200, REV_USAGE_MAX 300; msg 160, src/name 80)
function fullData() {
  const errors = Array.from({ length: 200 }, (_, i) => ({ kind: i % 2 ? 'api' : 'error', msg: i % 2 ? pad('w.example/commands/sale.create ' + i + ' ', 160) : 'TypeError', src: pad('/js/modules/archivo-' + i + '.js:' + i, 80),
    status: i % 2 ? 500 : null, count: (i * 7) % 50 + 1, first: iso(i), last: iso(i + 500), cli: 'c' + String(i).padStart(39, '0'), accion: pad('venta a crédito', 30) }));
  const slow = Array.from({ length: 200 }, (_, i) => ({ kind: ['api', 'pantalla', 'tarea', 'cuelgue'][i % 4], name: pad('pantalla-' + i + '-', 80), count: (i * 3) % 40 + 1, ms_avg: 1000 + i, ms_max: 9000 + i, last: iso(i),
    cli: 'c' + String(i).padStart(39, '0'), accion: pad('ver cliente', 30) }));
  const usage = {}; for (let i = 0; i < 300; i++) usage[('p' + i + 'x'.repeat(30)).slice(0, 31) + ':' + ('b' + i + 'y'.repeat(40)).slice(0, 40) + ':' + ('z' + i + 'w'.repeat(40)).slice(0, 40)] = (i * 13) % 97 + 1;
  return { errors, usage, slow, ocr: { reads: 10, fails: 1, timeouts: 0, ms_sum: 12345, ms_max: 4000, confirmed: 8, corrections: 3 } };
}

test('listas llenas: sin compactar pasa el tope del servidor; compactado queda bajo REVIEW_BUDGET (< 96 KB) y conserva lo más importante', () => {
  const full = fullData();
  assert.ok(bytes(full) > REVIEW_LIMITS.maxBodyBytes, 'el caso de prueba reproduce el 413: ' + bytes(full));
  const c = C.compactReview(full);
  assert.ok(bytes(c) <= C.REVIEW_BUDGET && C.REVIEW_BUDGET < REVIEW_LIMITS.maxBodyBytes, 'compactado: ' + bytes(c) + ' bytes');
  assert.ok(c.errors.length > 0 && c.slow.length > 0 && Object.keys(c.usage).length > 0, 'no se vacía');
  // errores por veces (y lo más reciente); lentos con los cuelgues primero; contadores por veces
  const maxCount = Math.max(...full.errors.map((e) => e.count)); assert.equal(c.errors[0].count, maxCount);
  for (let i = 1; i < c.errors.length; i++) assert.ok(c.errors[i - 1].count >= c.errors[i].count);
  assert.equal(c.slow[0].kind, 'cuelgue');
  const uv = Object.values(c.usage); for (let i = 1; i < uv.length; i++) assert.ok(uv[i - 1] >= uv[i]);
  assert.ok(c.errors.every((e) => String(e.msg).length <= 120 && String(e.src).length <= 80));
  assert.deepEqual(c.ocr, full.ocr);
  // datos chicos: no cambia nada salvo el orden
  const small = { errors: [{ kind: 'error', msg: 'TypeError', src: '/a.js:1', count: 1 }], usage: { 'pagePOS:btnCobrar': 3 }, slow: [], ocr: null };
  assert.deepEqual(C.compactReview(small), { errors: [{ kind: 'error', msg: 'TypeError', src: '/a.js:1', status: undefined, count: 1, first: undefined, last: undefined }], usage: { 'pagePOS:btnCobrar': 3 }, slow: [], ocr: null });
  assert.deepEqual(C.compactReview(null), { errors: [], usage: {}, slow: [], ocr: null });
});

test('servidor: el envío compactado con listas llenas se ACEPTA (200, informe); el completo daba 413', async () => {
  const call = async (body) => assistantReviewRoute(new Request('https://w.test' + REVIEW_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1', OHMYAGENT_API_KEY: 'clave-prueba-ohmyagent' }, { principalId: 'session:x', posRole: 'owner' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', fetch: async () => jsonR({ choices: [{ message: { content: 'Informe de prueba.' } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }) });
  const full = fullData();
  assert.equal((await call(full)).status, 413);
  const r = await call(C.compactReview(full)), d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d)); assert.equal(d.ok, true); assert.ok(String(d.report || '').length > 0);
});

test('UI: «Revisión del punto de venta» manda C.compactReview(reviewData())', () => {
  assert.match(UI, /post\('\/auth\/assistant\/review', C\.compactReview \? C\.compactReview\(reviewData\(\)\) : reviewData\(\), null, C\.TIMEOUTS\.chat\)/);
});
