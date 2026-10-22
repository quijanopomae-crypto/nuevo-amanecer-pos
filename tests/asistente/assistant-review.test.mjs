// (22-10) «Revisión del punto de venta» (solo Admin) y OhMyAgent como proveedor principal con Routeway de respaldo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { assistantReviewRoute, sanitizeReview, buildReviewSummary, cleanReviewText, REVIEW_PATH, REVIEW_DENIED } from '../../tools/cloudflare-lab/src/pos-assistant-review.js';
import { createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { PROVIDERS, configFor, resolveProvider, providerOverview, callModel } from '../../tools/cloudflare-lab/src/pos-assistant-providers.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const LOADER = readFileSync('POS/js/modules/asistente/asistente-loader.js', 'utf8');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const WORKER = readFileSync('tools/cloudflare-lab/src/worker.js', 'utf8');
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const OK_JSON = (content) => jsonR({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
const K1 = 'clave-prueba-ohmyagent', K2 = 'clave-prueba-routeway';

// ---------- cargador: captura en el aparato del Admin ----------
function el(attrs = {}, parent = null, cls = '') {
  return { attrs, parentNode: parent, className: cls, id: attrs.id || '', getAttribute(n) { return this.attrs[n] ?? null; },
    matches(sel) { return sel.split(',').some((s) => match(this, s.trim())); }, closest(sel) { let e = this; while (e) { if (e.matches(sel)) return e; e = e.parentNode; } return null; } };
}
function match(e, s) {
  if (s === 'button') return e.attrs.tag === 'button'; if (s === 'a') return e.attrs.tag === 'a';
  if (s === '[onclick]') return e.attrs.onclick != null; if (s === '[data-action]') return e.attrs['data-action'] != null;
  if (s === '.page') return /\bpage\b/.test(e.className); if (s === '.modal') return /\bmodal\b/.test(e.className);
  if (s === '[id^="naAsst"]') return /^naAsst/.test(e.id); if (s === '[class*="na-asst"]') return /na-asst/.test(e.className);
  return false;
}
function boot(acc) {
  const store = new Map([['na_asistente_proto', '1']]); if (acc) store.set('na_asistente_acc', acc);
  const L = {}, D = {}, obs = [];
  const on = (o) => (n, f) => { (o[n] = o[n] || []).push(f); };
  const document = { readyState: 'complete', hidden: false, documentElement: { classList: { add() {}, remove() {} } }, createElement: () => ({}), getElementById: () => null,
    head: { appendChild() {} }, body: { appendChild() {} }, addEventListener: on(D) };
  const fetch = async () => ({ status: 200, json: async () => ({ ok: true, role: acc === 'owner' ? 'owner' : 'empleado:consultas' }) });
  const window = { location: { search: '', href: 'https://pos.example/index.html', origin: 'https://pos.example' }, document, navigator: { onLine: true },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    requestIdleCallback: () => {}, addEventListener: on(L), AbortController, fetch,
    PerformanceObserver: class { constructor(cb) { this.cb = cb; obs.push(this); } observe(o) { this.opts = o; } } };
  vm.runInNewContext(LOADER, { window, URLSearchParams, URL, setTimeout, clearTimeout, Date, JSON, String, Object, Number });
  const fire = (o, n, e) => (o[n] || []).forEach((f) => f(e));
  return { window, store, L, D, obs, fire, fetch, saved: () => { fire(L, 'pagehide'); return JSON.parse(store.get('na_asst_rev') || 'null'); } };
}

test('captura (Admin): error, promesa y API 4xx/5xx se guardan limpios y agrupados en el aparato; fetch no se envuelve', () => {
  const b = boot('owner'); const R = b.window.NA_ASISTENTE_REVISION;
  assert.equal(R.installed(), true); assert.equal(b.window.fetch, b.fetch, 'fetch intacto (escuchas pasivas)');
  assert.equal(b.obs.length, 1); assert.equal(JSON.stringify(b.obs[0].opts), '{"type":"resource","buffered":true}');
  const msg = 'TypeError: falló al cobrar S/ 25.50 a juan@correo.com DNI 45678912 token=abc123 Bearer eyJhbGciOiJIUzI1NiJ9xxxxxxxxxxxxxxxx';
  b.fire(b.L, 'error', { message: msg, filename: 'https://pos.example/js/app.js?v=99', lineno: 120 });
  b.fire(b.L, 'error', { message: msg, filename: 'https://pos.example/js/app.js?v=99', lineno: 120 });
  b.fire(b.L, 'unhandledrejection', { reason: { name: 'Error', message: 'red caída' } });
  b.obs[0].cb({ getEntries: () => [{ name: 'https://w.example/commands/sale.create?id=12345678', initiatorType: 'fetch', responseStatus: 500 },
    { name: 'https://w.example/read/ok', initiatorType: 'fetch', responseStatus: 200 }, { name: 'https://pos.example/img/x.png', initiatorType: 'img', responseStatus: 404 }] });
  const s = b.saved();
  assert.equal(s.e.length, 3);
  const e0 = s.e.find((x) => x.kind === 'error');
  assert.equal(e0.count, 2, 'el mismo error se agrupa'); assert.equal(e0.src, '/js/app.js:120');
  for (const bad of ['25.50', 'juan@', '45678912', 'abc123', 'eyJhbGci']) assert.ok(!JSON.stringify(s).includes(bad), bad);
  assert.equal(e0.msg, 'TypeError', 'solo el tipo del error, nunca su mensaje');
  assert.deepEqual(s.e.filter((x) => x.kind === 'api').map((x) => [x.msg, x.status]), [['w.example/commands/sale.create', 500]]);
  assert.equal(s.e.find((x) => x.kind === 'promesa').msg, 'Error'); assert.ok(!JSON.stringify(s).includes('red caída'));
  assert.equal(R.newErrors(), 3); R.markSeen(); assert.equal(R.newErrors(), 0);
});

test('captura: tope de 200 errores (los últimos); de cada error solo el tipo, archivo y línea', () => {
  const b = boot('owner');
  for (let i = 0; i < 230; i++) b.fire(b.L, 'error', { message: 'Error n' + i + ' ' + 'abc defghij '.repeat(30), filename: 'a.js', lineno: i + 1 });
  const s = b.saved(); assert.equal(s.e.length, 200); assert.ok(s.e.every((x) => x.msg === 'Error'));
  assert.equal(s.e[199].src, '/a.js:230', 'el último que llegó queda'); assert.ok(!s.e.some((x) => x.src === '/a.js:1'), 'los más viejos salen');
  assert.ok(!JSON.stringify(s).includes('defghij'));
});

test('uso: pantalla + función/id del botón (sin textos ni datos), el asistente no cuenta, tope de claves', () => {
  const b = boot('owner');
  const pos = el({}, null, 'page'); pos.id = 'pagePOS';
  const btn = el({ tag: 'button', onclick: "goPage('pageCaja')" }, pos);
  const named = el({ tag: 'button' }, pos); // botón con el nombre de un cliente, sin id ni función: no cuenta
  const byId = el({ tag: 'button', id: 'btnCobrar' }, pos);
  const own = el({ tag: 'button', onclick: 'x()' }, el({}, null, 'na-asst-panel'));
  const fn = (x) => b.fire(b.D, 'click', { target: x });
  fn(btn); fn(btn); fn(named); fn(byId); fn(own);
  const s = b.saved(); assert.deepEqual(s.u, { 'pagePOS:goPage:pageCaja': 2, 'pagePOS:btnCobrar': 1 });
  const ds = b.D.click ? b.D.click.length : 0; assert.equal(ds, 1);
});

test('empleado o sin dato: no se instala ninguna escucha ni se guarda nada', () => {
  for (const acc of ['on', null]) { const b = boot(acc);
    assert.equal(b.window.NA_ASISTENTE_REVISION.installed(), false); assert.ok(!b.L.error && !b.L.unhandledrejection && !b.D.click, String(acc)); assert.equal(b.obs.length, 0); }
  assert.match(LOADER, /if \(!disabled && ls\('na_asistente_acc'\) === 'owner'\) \{ reserve\(\); revInstall\(\); \}/);
  assert.match(LOADER, /\{ capture: true, passive: true \}/);
});

// ---------- servidor ----------
async function route(body, { role = 'owner', posRole = 'owner', env = {}, fetch, method = 'POST', raw } = {}) {
  let calls = 0; const seen = [];
  const f = fetch || (async () => { calls++; return OK_JSON('x'); });
  const r = await assistantReviewRoute(new Request('https://w.test' + REVIEW_PATH, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: raw ?? JSON.stringify(body) } : {}) }),
    { ASSISTANT_ENABLED: '1', ...env }, { principalId: 'session:x', posRole }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: async (u, i) => { seen.push({ u, i, b: JSON.parse(i.body) }); return f(u, i); } });
  return { r, d: await r.json(), seen, calls: () => calls };
}
const SAMPLE = { errors: [{ kind: 'api', status: 500, msg: 'w.example/commands/sale.create', src: '', count: 7 }, { kind: 'error', msg: 'TypeError: x is undefined S/ 9.90 ana@x.pe 12345678', src: '/js/app.js:5', count: 2 },
  { kind: 'api', status: 401, msg: 'w.example/read/sales', count: 1 }], usage: { 'pagePOS:goPage:pageCaja': 50, 'pagePOS:btnCobrar': 30, 'pageGastos:btnNuevoGasto': 2, 'pageKardex:verKardex': 1, 'pageConfig:switchCfgCategory': 4, 'pageClientes:btnNuevo': 9, 'mal clave!': 3 } };

test('servidor: empleado, empleado con nivel y aparato sin rol -> 403 review_admin_only, sin modelo ni cupo', async () => {
  for (const [role, posRole] of [['empleado:consultas', 'empleado'], ['empleado:consultas_documentos', 'empleado'], ['sin_rol', 'owner'], ['owner', 'empleado']]) {
    const x = await route(SAMPLE, { role, posRole, env: { OHMYAGENT_API_KEY: K1 } });
    assert.equal(x.r.status, 403, role); assert.deepEqual(x.d, REVIEW_DENIED); assert.equal(x.seen.length, 0);
  }
  assert.equal((await route(SAMPLE, { env: { ASSISTANT_ENABLED: '0' } })).r.status, 404);
  assert.equal((await route(null, { method: 'GET' })).r.status, 405);
  assert.equal((await route(null, { raw: '{"errors":"' + 'x'.repeat(100000) + '"}' })).r.status, 413);
  assert.equal((await route(null, { raw: '{no' })).r.status, 400);
  assert.ok(!/admin_only'?:/.test(UI.match(/ACCESS_LOST = \{[^}]*\}/)[0].replace('admin_only: 1', '')) && !/review_admin_only/.test(UI.match(/ACCESS_LOST = \{[^}]*\}/)[0]), 'el 403 de la revisión no quita el asistente');
});

test('servidor: Admin sin proveedor -> informe fijo (errores agrupados con veces, más/menos usado, sugerencias), limpio y sin markdown', async () => {
  const x = await route(SAMPLE);
  assert.equal(x.r.status, 200); assert.equal(x.d.source, 'resumen'); assert.equal(x.seen.length, 0);
  const t = x.d.report;
  assert.match(t, /^Revisión del punto de venta/); assert.match(t, /3 tipos, 10 veces/); assert.match(t, /7 veces: Respuesta 500 de la API/);
  assert.match(t, /Lo más usado: Vender · ir a Caja \(50\)/); assert.match(t, /Lo menos usado: Kardex · verKardex \(1\)/);
  assert.match(t, /Sugerencias:\n• Revisar el servidor en w\.example\/commands\/sale\.create/); assert.match(t, /401\/403/);
  for (const bad of ['9.90', 'ana@', '12345678', 'mal clave', '**']) assert.ok(!JSON.stringify(x.d).includes(bad), bad);
  assert.equal(x.d.errors_total, 10); assert.equal(x.d.top[0].key, 'pagePOS:goPage:pageCaja'); assert.equal(x.d.bottom[0].key, 'pageKardex:verKardex');
});

test('servidor: con OhMyAgent el modelo redacta el informe con SOLO datos limpios; 429/5xx pasa a Routeway; cuenta como una pregunta', async () => {
  const env = { OHMYAGENT_API_KEY: K1, ROUTEWAY_API_KEY: K2 };
  let x = await route(SAMPLE, { env, fetch: async () => OK_JSON('**Errores**\n- 7 veces la venta falló — revisar') });
  assert.equal(x.d.source, 'modelo'); assert.equal(x.seen.length, 1);
  assert.equal(x.seen[0].u, 'https://ohhmyagent.com/v1/chat/completions'); assert.equal(x.seen[0].b.model, 'gpt-6.1-sol'); assert.equal(x.seen[0].i.headers.authorization, 'Bearer ' + K1);
  const prompt = JSON.stringify(x.seen[0].b.messages); for (const bad of ['9.90', 'ana@', '12345678']) assert.ok(!prompt.includes(bad), bad);
  assert.ok(!x.d.report.includes('**') && !x.d.report.includes('\u2014'), x.d.report);
  // OhMyAgent con 503 dos veces -> Routeway gemma (con SU clave)
  x = await route(SAMPLE, { env: { ...env }, fetch: async (u) => (u.startsWith('https://ohhmyagent.com') ? jsonR({}, 503) : OK_JSON('Informe de respaldo')) });
  assert.deepEqual(x.seen.map((s) => [new URL(s.u).host, s.b.model, s.i.headers.authorization]), [['ohhmyagent.com', 'gpt-6.1-sol', 'Bearer ' + K1], ['ohhmyagent.com', 'gpt-6.1-sol', 'Bearer ' + K1], ['api.routeway.ai', 'gemma-4-26b-a4b-it-luminous:free', 'Bearer ' + K2]]);
  assert.equal(x.d.report, 'Informe de respaldo');
  // todo falla -> informe fijo igual
  x = await route(SAMPLE, { env, fetch: async () => jsonR({}, 500) }); assert.equal(x.d.source, 'resumen'); assert.match(x.d.report, /Sugerencias/);
});

test('limpieza del servidor: mismo redactor del asistente + montos, correos, claves, números largos; claves de uso válidas', () => {
  assert.equal(cleanReviewText('pago S/ 12.50 de pepe@a.com con api_key=XYZ y 987654321 en https://x.pe/a?dni=12345678', 200), 'pago [monto] de [correo] con [clave] y [num] en https://x.pe/a');
  const d = sanitizeReview({ errors: Array.from({ length: 300 }, (_, i) => ({ kind: 'nope', msg: 'TypeError: no se pudo con Rosa Quispe', src: 'js/a' + (i % 3) + '.js:1' })), usage: { 'pagePOS:x': 1, '<script>': 2, 'a:b:c:d': 3 } });
  assert.ok(d.groups.every((g) => g.msg === 'TypeError'), 'el servidor también deja solo el tipo'); assert.ok(!JSON.stringify(d).includes('Rosa'));
  assert.equal(sanitizeReview({ errors: [{ kind: 'error', msg: 'algo de Rosa', src: 'https://pos.example/js/x.js:9 Rosa' }] }).groups[0].src, 'js/x.js:9');
  assert.equal(d.groups.length, 3); assert.equal(d.groups.reduce((t, g) => t + g.count, 0), 200, 'solo los 200 primeros'); assert.ok(d.groups.every((g) => g.kind === 'error'));
  assert.deepEqual(d.usage.map((u) => u.key), ['pagePOS:x']);
  assert.match(buildReviewSummary({ groups: [], usage: [] }), /ninguno guardado[\s\S]*Cuelgues: ninguno[\s\S]*Lentitud: nada lento[\s\S]*todavía no hay contadores[\s\S]*Todo en orden/);
});

// ---------- proveedores ----------
test('OhMyAgent principal (gpt-6.1-sol) con Routeway gemma de respaldo; claves separadas por proveedor, nada en el código', async () => {
  const p = PROVIDERS.ohmyagent;
  assert.deepEqual([p.kind, p.base, p.key, p.model, p.next], ['openai', 'https://ohhmyagent.com/v1', 'OHMYAGENT_API_KEY', 'gpt-6.1-sol', 'routeway']);
  assert.equal(resolveProvider({ OHMYAGENT_API_KEY: K1, ROUTEWAY_API_KEY: K2, DEEPSEEK_API_KEY: 'd' }).id, 'ohmyagent');
  const c = resolveProvider({ OHMYAGENT_API_KEY: K1, ROUTEWAY_API_KEY: K2 });
  assert.deepEqual(c.fallbacks.map((f) => [f.id, f.model, f.key]), [['routeway', 'gemma-4-26b-a4b-it-luminous:free', K2], ['routeway', 'minimax-m2.7:free', K2]]);
  assert.deepEqual(resolveProvider({ OHMYAGENT_API_KEY: K1 }).fallbacks, [], 'sin clave de Routeway no hay respaldo');
  assert.deepEqual(resolveProvider({ AI_PROVIDER: 'ohmyagent', AI_API_KEY: K1 }).fallbacks, [], 'AI_API_KEY no se usa para el respaldo (claves separadas)');
  assert.equal(configFor({}, 'ohmyagent').reason, 'missing_key');
  const ov = JSON.stringify(providerOverview({ OHMYAGENT_API_KEY: K1, ROUTEWAY_API_KEY: K2 }));
  assert.ok(!ov.includes(K1) && !ov.includes(K2) && !ov.includes('ohhmyagent.com'));
  // reintento 5xx en el principal y luego respaldo, con espera corta
  const seen = []; const cfg = { ...c, retryWaits: [30, 30] }; const t0 = Date.now();
  const r = await callModel(cfg, { messages: [] }, async (u, i) => { seen.push(new URL(u).host); return u.includes('ohhmyagent') ? jsonR({}, 502) : OK_JSON('ok'); }, 5000);
  assert.deepEqual(seen, ['ohhmyagent.com', 'ohhmyagent.com', 'api.routeway.ai']); assert.equal(r.provider, 'routeway'); assert.ok(Date.now() - t0 >= 25);
  // con foto: el respaldo que no lee fotos no se usa
  const seen2 = [];
  await callModel({ ...c, vision: true, retryWaits: [0, 0] }, { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] }] }, async (u) => { seen2.push(new URL(u).host); return jsonR({}, 429); }, 5000);
  assert.deepEqual(seen2, ['ohhmyagent.com', 'ohhmyagent.com']);
  const src = readFileSync('tools/cloudflare-lab/src/pos-assistant-providers.js', 'utf8');
  assert.ok(!/\b(?:sk|rw|om|key)-[A-Za-z0-9]{16,}/.test(src));
});

// ---------- aparato (UI) y Worker ----------
test('UI: la revisión es solo del Admin (chip, texto o aviso de errores nuevos), redactada antes de salir, sin innerHTML; ruta en el Worker', () => {
  const chips = UI.slice(UI.indexOf('function chipsHtml()'), UI.indexOf('function chipsHtml()') + 1400).split('\n');
  assert.match(chips[1], /^    if \(isOwnerAccess\(\)\) return .*data-q="Revisión del punto de venta">Revisión del POS<\/button>';$/);
  assert.ok(!chips.slice(2, 4).join('\n').includes('Revisión'), 'el empleado no ve el chip');
  assert.match(UI, /if \(!image && isOwnerAccess\(\) && isReview\(text\)\) \{/);
  const rv = UI.slice(UI.indexOf('function reviewData()'), UI.indexOf('async function send('));
  assert.match(rv, /msg: x\.kind === 'api' \? C\.redactText\(String\(x\.msg \|\| ''\)\)\.slice\(0, 160\) : errType\(x\.msg\)/); assert.ok(!/innerHTML/.test(rv));
  assert.match(rv, /post\('\/auth\/assistant\/review', C\.compactReview \? C\.compactReview\(reviewData\(\)\) : reviewData\(\)/); assert.match(rv, /R\.markSeen\(\)/);
  assert.match(rv, /isOwnerAccess\(\) && R && R\.newErrors \? R\.newErrors\(\) : 0/);
  assert.match(UI, /reviewNotice\(\);\n    var off = root\.navigator\.onLine === false;/);
  assert.equal(C.friendlyError('review_admin_only').msg, 'La revisión del punto de venta es solo para el Admin.');
  for (const t of ['Revisión del punto de venta', 'revisa el POS', 'errores del punto de venta']) assert.match(t, new RegExp(UI.match(/var REVIEW_RE = \/(.*)\/i;/)[1], 'i'), t);
  assert.ok(!/revis/i.test('¿Cuánto vendimos hoy?'.replace(new RegExp(UI.match(/var REVIEW_RE = \/(.*)\/i;/)[1], 'i'), 'revis')));
  assert.match(WORKER, /if \(url\.pathname === ASSISTANT_REVIEW_PATH\) \{\n\s+if \(String\(env\.ASSISTANT_ENABLED \|\| ''\) !== '1'\) return json\(\{ error: 'not_found' \}, 404\);\n\s+const auth = await authorizeSession\(request, env\);/);
});
