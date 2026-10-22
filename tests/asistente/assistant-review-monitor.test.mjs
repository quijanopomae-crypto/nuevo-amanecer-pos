// (22-10) Revisión del POS: lentitud, cuelgues, lectura de boletas, informe a pedido y clientes SOLO por su código interno.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assistantReviewRoute, sanitizeReview, buildReviewSummary, REVIEW_PATH } from '../../tools/cloudflare-lab/src/pos-assistant-review.js';
import { createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { makeDoc } from './fake-dom.mjs';
const LOADER = readFileSync('POS/js/modules/asistente/asistente-loader.js', 'utf8');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const OK = (content) => jsonR({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
const CLI = { id: 1729550000000, nombre: 'Rosa Quispe Mamani', dni: '45678912', telefono: '987654321', direccion: 'Jr. Lima 123' };

function el(attrs = {}, parent = null, cls = '') {
  return { attrs, parentNode: parent, className: cls, id: attrs.id || '', getAttribute(n) { return this.attrs[n] ?? null; },
    matches(sel) { return sel.split(',').some((s) => match(this, s.trim())); }, closest(sel) { let e = this; while (e) { if (e.matches(sel)) return e; e = e.parentNode; } return null; } };
}
function match(e, s) {
  if (s === 'button') return e.attrs.tag === 'button'; if (s === '[onclick]') return e.attrs.onclick != null; if (s === '.page') return /\bpage\b/.test(e.className);
  if (s === '[data-cli-id],[data-client-id]') return false; return false;
}
function boot({ longtask = true } = {}) {
  const store = new Map([['na_asistente_proto', '1'], ['na_asistente_acc', 'owner']]);
  const L = {}, D = {}, obs = [], timers = [], later = []; let now = Date.parse('2026-10-22T04:00:00Z');
  const on = (o) => (n, f) => { (o[n] = o[n] || []).push(f); };
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const document = { readyState: 'complete', hidden: false, documentElement: { classList: { add() {}, remove() {} } }, createElement: () => ({}), getElementById: () => null,
    querySelector: (s) => (s === '.page.active' ? { id: 'pageClientes' } : null), head: { appendChild() {} }, body: { appendChild() {} }, addEventListener: on(D) };
  class PO { constructor(cb) { this.cb = cb; obs.push(this); } observe(o) { this.opts = o; } }
  PO.supportedEntryTypes = longtask ? ['resource', 'longtask'] : ['resource'];
  const opened = [];
  const window = { location: { search: '', href: 'https://pos.example/index.html', origin: 'https://pos.example' }, document, navigator: { onLine: true },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    requestIdleCallback: () => {}, addEventListener: on(L), AbortController, fetch: async () => ({ status: 200, json: async () => ({ ok: true, role: 'owner' }) }),
    setInterval: (f, ms) => { timers.push({ f, ms }); return timers.length; }, setTimeout: (f) => { later.push(f); return later.length; }, PerformanceObserver: PO };
  const ctx = { window, URLSearchParams, URL, setTimeout, clearTimeout, Date: FakeDate, JSON, String, Object, Number, Math,
    clientes: [CLI, { id: 'c-77', nombre: 'Otro', dni: '11111111' }], creditos: [{ id: 555, cliId: CLI.id }], abrirCred: (id) => opened.push(id), cliCredId: null, pagoCredId: null };
  vm.runInNewContext(LOADER, ctx);
  const fire = (o, n, e) => (o[n] || []).forEach((f) => f(e));
  return { window, store, L, D, obs, timers, fire, opened, flush: () => later.splice(0).forEach((f) => f()), tick: (ms) => { now += ms; }, R: window.NA_ASISTENTE_REVISION,
    saved: () => { fire(L, 'pagehide'); return JSON.parse(store.get('na_asst_rev') || 'null'); } };
}

test('lentitud: API > 3 s (solo la ruta), tareas largas, y latido: cuelgue si la pantalla visible se congela > 5 s (sin contar doble)', () => {
  const b = boot();
  assert.equal(b.timers.length, 1); assert.equal(b.timers[0].ms, 1000);
  const res = b.obs.find((o) => o.opts.type === 'resource'), lt = b.obs.find((o) => o.opts.type === 'longtask');
  res.cb({ getEntries: () => [{ name: 'https://w.example/read/sales?desde=2026-10-01', initiatorType: 'fetch', responseStatus: 200, duration: 4200 },
    { name: 'https://w.example/read/ok', initiatorType: 'fetch', responseStatus: 200, duration: 800 }, { name: 'https://pos.example/img/big.png', initiatorType: 'img', duration: 9000 }] });
  b.tick(1000); b.R._test.beat(); b.tick(7000); b.R._test.beat(); // 7 s sin latido...
  lt.cb({ getEntries: () => [{ duration: 6900 }, { duration: 60 }] }); b.flush(); // ...que el navegador reporta como tarea larga: cuenta UNA vez
  b.tick(1000); b.R._test.beat(); b.tick(30000); b.R._test.beat(); b.flush(); // 30 s congelada sin tarea larga -> cuelgue
  b.window.document.hidden = true; b.tick(60000); b.R._test.beat(); b.window.document.hidden = false; // en segundo plano no cuenta
  const s = b.saved();
  assert.deepEqual(s.s.map((x) => [x.kind, x.name, x.count]), [['api', 'w.example/read/sales', 1], ['cuelgue', 'pageClientes', 2]]);
  assert.equal(s.s[1].ms_max, 29000);
  lt.cb({ getEntries: () => [{ duration: 1600 }] }); assert.equal(b.saved().s.find((x) => x.kind === 'tarea').ms_max, 1600, 'tarea larga de 1 a 5 s = «tarea»');
  const d = b.R.data(); assert.equal(d.slow[0].ms_avg, 4200); assert.ok(!JSON.stringify(d).includes('desde='));
  assert.equal(b.R.newErrors(), 1, 'el cuelgue cuenta como novedad para el aviso');
});

test('cliente: un error justo después de tocar un cliente guarda SOLO su código interno y la acción; nunca nombre, DNI, teléfono ni dirección', () => {
  const b = boot(); const page = el({}, null, 'page'); page.id = 'pageClientes';
  const click = (oc) => b.fire(b.D, 'click', { target: el({ tag: 'button', onclick: oc }, page) });
  click('abrirCred(1729550000000)');
  b.fire(b.L, 'error', { message: 'TypeError: no se pudo registrar a Rosa Quispe Mamani', filename: 'https://pos.example/js/a.js', lineno: 9 });
  click('abrirPago(555)'); b.fire(b.L, 'unhandledrejection', { reason: { name: 'Error', message: 'pago falló' } });
  click('guardarCli()'); // sin id: usa el cliente abierto (cliCredId) si lo hay; aquí no hay -> sin código
  b.fire(b.L, 'error', { message: 'otro', filename: 'a.js', lineno: 1 });
  b.tick(20000); b.fire(b.L, 'error', { message: 'tarde', filename: 'a.js', lineno: 2 }); // pasó la ventana de 15 s
  const s = b.saved();
  // Solo el TIPO del error: el mensaje (con el nombre del cliente) nunca se guarda.
  assert.deepEqual(s.e.map((x) => [x.msg, x.cli || null, x.accion || null]), [['TypeError', '1729550000000', 'venta a crédito'], ['Error', '1729550000000', 'abono'], ['Error', null, null], ['Error', null, null]]);
  const all = JSON.stringify(s) + JSON.stringify(b.R.data());
  for (const bad of ['Rosa', 'Quispe', 'Mamani', 'no se pudo registrar', 'pago falló', '45678912', '987654321', 'Jr. Lima']) assert.ok(!all.includes(bad), bad);
  assert.ok(!/"nombre"|"dni"|"telefono"/.test(all));
  // el nombre se resuelve SOLO en el aparato y abre al cliente con la función del POS
  assert.equal(b.R.customerName('1729550000000'), 'Rosa Quispe Mamani'); assert.equal(b.R.customerName('999'), null);
  assert.equal(b.R.openCustomer('1729550000000'), true); assert.deepEqual(b.opened, [CLI.id]);
  assert.equal(b.R.openCustomer('no-existe'), false);
});

test('lecturas de boletas: duración, fallas, tiempo y correcciones por boleta (sin foto ni datos)', () => {
  const b = boot();
  b.R.ocr({ ok: true, ms: 24000 }); b.R.ocr({ ok: false, ms: 91000, timeout: true }); b.R.ocr({ confirmed: true, corrections: 3 });
  const o = b.R.data().ocr; assert.deepEqual([o.reads, o.fails, o.timeouts, o.ms_sum, o.ms_max, o.confirmed, o.corrections], [2, 1, 1, 115000, 91000, 1, 3]);
  assert.deepEqual(b.saved().s.map((x) => [x.kind, x.name]), [['api', 'leer boleta']]);
});

// ---------- servidor ----------
async function route(body, env = {}, fetch) {
  const seen = [];
  const r = await assistantReviewRoute(new Request('https://w.test' + REVIEW_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1', ...env }, { principalId: 'session:x', posRole: 'owner' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', fetch: async (u, i) => { seen.push(JSON.parse(i.body)); return (fetch || (async () => OK('x')))(u, i); } });
  return { r, d: await r.json(), seen };
}
const BODY = { errors: [{ kind: 'error', msg: 'TypeError: x', src: '/js/a.js:9', count: 3, cli: '1729550000000', accion: 'abono', nombre: 'Rosa Quispe', dni: '45678912' },
  { kind: 'api', status: 500, msg: 'w.example/commands/credit.payment', count: 2, cli: 'Rosa Quispe', accion: 'abono' }],
  usage: { 'pageClientes:abrirCred': 20, 'pagePOS:goPage:pageCaja': 9 },
  slow: [{ kind: 'cuelgue', name: 'pageClientes', count: 2, ms_avg: 8000, ms_max: 12000, cli: '1729550000000', accion: 'venta a crédito' }, { kind: 'api', name: 'w.example/read/sales', count: 4, ms_avg: 4200, ms_max: 6100 }, { kind: 'raro', name: 'x' }],
  ocr: { reads: 5, fails: 2, timeouts: 1, ms_sum: 200000, ms_max: 78000, confirmed: 3, corrections: 12 } };

test('servidor: errores, lentitud, cuelgues y boletas en el informe; clientes SOLO como «cliente #código» (código inválido se descarta)', async () => {
  const d = sanitizeReview(BODY);
  assert.deepEqual(d.groups.map((g) => [g.kind, g.cli || null, g.accion || null]), [['error', '1729550000000', 'abono'], ['api', null, null]], 'un «código» con espacios (nombre) no pasa');
  assert.deepEqual(d.slow.map((x) => x.kind), ['cuelgue', 'api']);
  const t = buildReviewSummary(d);
  assert.match(t, /\[cliente #1729550000000, abono\]/); assert.match(t, /Cuelgues: 2/); assert.match(t, /Se colgó en Clientes, hasta 12 s \[cliente #1729550000000, venta a crédito\]/);
  assert.match(t, /Llamada lenta a w\.example\/read\/sales, promedio 4,2 s/); assert.match(t, /Lectura de boletas: 5 lecturas, 40% fallidas \(1 por tiempo\), promedio 40 s, 4 correcciones por boleta confirmada/);
  assert.match(t, /Sugerencias:[\s\S]*Revisar cliente #1729550000000/);
  const x = await route(BODY); assert.equal(x.d.source, 'resumen'); assert.deepEqual(x.d.customers, ['1729550000000']); assert.equal(x.d.hangs_total, 2);
  assert.match(x.d.report, /cliente #1729550000000/);
});

test('payload al proveedor: lleva el código del cliente y NO su nombre ni DNI (ni lo que el aparato mande de más)', async () => {
  const x = await route(BODY, { ASSISTANT_AI_API_KEY_4: 'k4' }, async () => OK('Errores: • 3 veces con cliente #1729550000000 (abono).'));
  assert.equal(x.seen.length, 1); const p = JSON.stringify(x.seen[0].messages);
  assert.ok(p.includes('cliente #C-0001') && !p.includes('1729550000000')); // hacia la IA, código neutro
  for (const bad of ['Rosa', 'Quispe', '45678912', '"nombre"', '"dni"']) assert.ok(!p.includes(bad), bad);
  assert.equal(x.d.source, 'modelo'); assert.match(x.d.report, /cliente #1729550000000/); assert.deepEqual(x.d.customers, ['1729550000000']);
});

// ---------- UI: el nombre se resuelve en el aparato ----------
function uiFns() {
  const a = UI.indexOf('  var CLI_RE = '), b = UI.indexOf('  // ---------- «Leer boleta con IA»');
  return UI.slice(a, b);
}
test('UI: «cliente #código» se vuelve enlace con el nombre buscado EN EL APARATO y abre al cliente; lo que se manda no lleva el nombre', () => {
  const doc = makeDoc(), opened = [], said = [];
  const R = { customerName: (c) => (c === '1729550000000' ? 'Rosa Quispe Mamani' : null), openCustomer: (c) => { opened.push(c); return true; },
    data: () => ({ errors: [{ kind: 'error', msg: 'falló', src: 'a.js', count: 1, cli: '1729550000000', accion: 'abono', nombre: 'Rosa' }], usage: {}, slow: [{ kind: 'cuelgue', name: 'pageClientes', count: 1, ms_avg: 6000, ms_max: 6000, cli: 'mal código!' }], ocr: null }) };
  const root = { NA_ASISTENTE_REVISION: R };
  const C = { redactText: (s) => s };
  const el = (t, c) => { const e = doc.createElement(t); if (c) e.className = c; return e; };
  const f = new Function('root', 'doc', 'C', 'el', 'addMsg', uiFns() + '\nreturn { linkCustomers: linkCustomers, reviewData: reviewData };');
  const api = f(root, doc, C, el, (k, t) => said.push(t));
  const sent = api.reviewData(); const js = JSON.stringify(sent);
  assert.ok(js.includes('"cli":"1729550000000"') && !js.includes('Rosa') && !js.includes('mal código'), js);
  const m = doc.createElement('div'); const p = doc.createElement('p'); p.textContent = '• 3 veces: Error [cliente #1729550000000, abono]. También cliente #42 (no vino del aparato).'; m.appendChild(p);
  assert.equal(api.linkCustomers(m, ['1729550000000']), 1);
  const btn = m.byClass('na-asst-cli')[0]; assert.equal(btn.tagName, 'BUTTON'); assert.equal(btn.textContent, 'cliente #1729550000000 (Rosa Quispe Mamani)'); assert.equal(btn.dataset.cli, '1729550000000');
  assert.match(m.textContent, /^• 3 veces: Error \[cliente #1729550000000 \(Rosa Quispe Mamani\), abono\]\. También cliente #42/);
  btn.click(); assert.deepEqual(opened, ['1729550000000']);
  assert.match(UI, /b\.classList\.add\('na-asst-review'\); linkCustomers\(b, Array\.isArray\(d\.customers\) \? d\.customers : \[\]\);/);
  // el informe se pide con botón o con palabras
  const re = new RegExp(UI.match(/var REVIEW_RE = \/(.*)\/i;/)[1], 'i');
  for (const t of ['hazme el informe', 'Hágame un informe', 'dame el informe', 'informe del POS', 'Revisión del punto de venta']) assert.match(t, re, t);
  assert.doesNotMatch('¿Cuánto vendimos hoy?', re);
});
