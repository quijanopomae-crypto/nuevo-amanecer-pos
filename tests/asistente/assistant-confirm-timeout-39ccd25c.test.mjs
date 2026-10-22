// Sobre 39ccd25c (Bot 3, escenario 7a «señal débil»): el reintento automático de Confirmar no salió a los ~12,6 s y el pedido llegó a los 59,6 s.
// Cada intento arma SU límite antes de llamar a fetch y lo quita solo en finally; además un reloj de pared (Date.now, cada segundo y al volver la
// pantalla/la red) corta el intento aunque el navegador demore el temporizador largo (pestaña en segundo plano). Reloj falso, sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
const sliceFn = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };

// Reloj falso: los temporizadores de throttleMin ms o más llegan «throttle» ms tarde (como una pestaña en segundo plano); Date.now avanza normal.
function makeClock({ throttle = 0, throttleMin = 5000 } = {}) {
  let now = 1_800_000_000_000, id = 0; const q = new Map();
  const add = (fn, ms, rep) => { const d = Math.max(0, Number(ms) || 0); q.set(++id, { fn, at: now + d + (d >= throttleMin ? throttle : 0), rep: rep ? Math.max(1, d) + (d >= throttleMin ? throttle : 0) : 0, d }); return id; };
  const FakeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
  return {
    setTimeout: (fn, ms) => add(fn, ms, false), setInterval: (fn, ms) => add(fn, ms, true), clearTimeout: (k) => q.delete(k), clearInterval: (k) => q.delete(k), Date: FakeDate,
    get now() { return now; }, pending: () => [...q.values()],
    async advanceTo(T) { for (;;) { await flush(); let best = null, bk = 0; for (const [k, t] of q) if (t.at <= T && (!best || t.at < best.at)) { best = t; bk = k; }
      if (!best) break; now = best.at; if (best.rep) best.at += best.rep; else q.delete(bk); best.fn(); } now = T; await flush(); },
  };
}
function makeWin() { const L = new Map(); return { addEventListener(n, f) { if (!L.has(n)) L.set(n, new Set()); L.get(n).add(f); }, removeEventListener(n, f) { L.get(n) && L.get(n).delete(f); },
  dispatch(n) { for (const f of [...(L.get(n) || [])]) f({ type: n }); }, count() { let c = 0; for (const s of L.values()) c += s.size; return c; } }; }
function load(clk) {
  const win = makeWin();
  const ctx = vm.createContext({ window: win, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, setInterval: clk.setInterval, clearInterval: clk.clearInterval, Date: clk.Date,
    AbortController, console, Intl, URL, TextEncoder, TextDecoder });
  vm.runInContext(CORE, ctx); const C = win.NA_ASISTENTE_CORE; assert.ok(C && C.request, 'núcleo cargado');
  const ui = vm.createContext({ C, root: win, reqInit: (path, body) => ({ url: path, init: { method: 'POST', body: JSON.stringify(body) } }), setTimeout: clk.setTimeout, Promise, Object, JSON, Error, Array });
  vm.runInContext(sliceFn(UI, '  async function post(', '  // Confirmación: el MISMO token') + sliceFn(UI, '  async function confirmRemote(', '  // ---------- Funciones existentes del POS'), ui);
  return { C, win, confirmRemote: ui.confirmRemote };
}
// fetch falso: «hang» no contesta nunca (solo el abort lo corta), «body» manda cabeceras y el cuerpo no llega, «net» falla al toque, «late» falla
// justo cuando vence el límite (carrera con el temporizador), «ok»/«bad_token» contestan
function makeFetch(clk, plan, seen) {
  return (url, init) => { const mode = plan.shift() || 'hang', t = clk.now;
    // el límite de ESTE intento ya está armado cuando se llama a fetch
    seen.push({ mode, t, armed: clk.pending().some((x) => x.d === 12000 && !x.rep) && clk.pending().some((x) => x.rep) });
    const onAbort = (rej) => init.signal && init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
    if (mode === 'net') return Promise.reject(new TypeError('Failed to fetch'));
    if (mode === 'late') return new Promise((_, rej) => { onAbort(rej); clk.setTimeout(() => rej(new TypeError('Failed to fetch')), 11999); });
    if (mode === 'ok') return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true, confirmed: true, operation_id: 'op-1' }) });
    if (mode === 'bad_token') return Promise.resolve({ status: 403, ok: false, json: async () => ({ error: 'bad_token' }) });
    if (mode === 'body') return Promise.resolve({ status: 200, ok: true, json: () => new Promise((_, rej) => onAbort(rej)) });
    return new Promise((_, rej) => onAbort(rej)); };
}
async function run7a({ throttle = 0, throttleMin = 5000, plan = ['hang', 'hang'], wakeAt = null } = {}) {
  const clk = makeClock({ throttle, throttleMin }), { C, win, confirmRemote } = load(clk), seen = [], t0 = clk.now;
  win.fetch = makeFetch(clk, plan.slice(), seen);
  let retryAt = null, done = null, out, err;
  const p = { id: 'p1', type: 'compra', confirm_token: 'tok-1', proveedor: 'X', lineas: [] };
  confirmRemote(p, null, { onRetry: () => { retryAt = clk.now - t0; } }).then((r) => { out = r; done = clk.now - t0; }, (e) => { err = e; done = clk.now - t0; });
  if (wakeAt != null) { await clk.advanceTo(t0 + wakeAt); win.dispatch('visibilitychange'); }
  for (let T = 0; T <= 120000 && done == null; T += 250) await clk.advanceTo(t0 + T);
  return { C, retryAt, done, out, err, seen, left: clk.pending().length, listeners: win.count() };
}

test('7a: cada intento arma su límite antes de fetch; el reintento sale a ~12,6 s y «Sin conexión» a ~24,6 s; nada queda armado al terminar', async () => {
  const r = await run7a();
  assert.equal(r.seen.length, 2); assert.ok(r.seen.every((s) => s.armed), 'límite armado antes de cada fetch');
  assert.ok(r.retryAt >= 12600 && r.retryAt <= 12700, '«Reconectando…» a ~12,6 s: ' + r.retryAt);
  assert.ok(r.seen[1].t - r.seen[0].t >= 12600 && r.seen[1].t - r.seen[0].t <= 12700, 'segundo pedido a ~12,6 s: ' + (r.seen[1].t - r.seen[0].t));
  assert.ok(r.err && r.err.timeout, 'termina en timeout'); assert.ok(r.done >= 24600 && r.done <= 24800, 'Sin conexión a ~24,6 s: ' + r.done);
  assert.equal(r.left, 0, 'sin temporizadores vivos'); assert.equal(r.listeners, 0, 'sin oyentes vivos');
});

test('7a con el temporizador largo demorado 47 s (pestaña en segundo plano): el reloj de pared corta igual a los ~12 s (39ccd25c: 59 s)', async () => {
  const r = await run7a({ throttle: 47000 });
  assert.ok(r.retryAt != null && r.retryAt <= 13700, 'reintento sin esperar al temporizador demorado: ' + r.retryAt);
  assert.ok(r.seen.length === 2 && r.seen[1].t - r.seen[0].t <= 13700, 'segundo pedido a tiempo: ' + (r.seen[1] && r.seen[1].t - r.seen[0].t));
  assert.ok(r.err && r.err.timeout && r.done <= 26800, 'Sin conexión a tiempo: ' + r.done); assert.equal(r.left, 0); assert.equal(r.listeners, 0);
});

test('temporizadores de 1 s o más demorados 60 s: al volver la pantalla (visibilitychange) el intento vencido se corta al toque', async () => {
  const r = await run7a({ throttle: 60000, throttleMin: 1000, plan: ['hang', 'ok'], wakeAt: 13000 });
  assert.equal(r.retryAt, 13600, 'reintento al volver la pantalla (+600 ms de pausa)'); assert.ok(r.out && r.out.ok === true, 'el segundo intento confirma');
});

test('carreras: fetch que falla justo antes del límite, cabeceras sin cuerpo, falla al toque, y 4xx real en el reintento', async () => {
  const a = await run7a({ plan: ['late', 'ok'] }); assert.ok(a.out && a.out.ok && a.retryAt >= 12599 && a.retryAt <= 12700, 'late: ' + a.retryAt);
  const b = await run7a({ plan: ['body', 'body'] }); assert.ok(b.err && b.err.timeout && b.retryAt >= 12600 && b.retryAt <= 12700 && b.done <= 24800, 'body: ' + b.retryAt + '/' + b.done);
  const c = await run7a({ plan: ['net', 'net'] }); assert.ok(c.err && !c.err.timeout && c.retryAt === 600 && c.done === 600, 'net: ' + c.retryAt + '/' + c.done);
  const d = await run7a({ plan: ['hang', 'bad_token'] }); assert.ok(d.out && d.out.error === 'bad_token' && d.retryAt >= 12600 && d.retryAt <= 12700, 'bad_token: ' + d.retryAt);
  for (const x of [a, b, c, d]) { assert.ok(x.seen.every((s) => s.armed)); assert.equal(x.left, 0); assert.equal(x.listeners, 0); }
});

test('40 corridas simuladas de 7a (señal débil, demoras distintas): siempre «Reconectando…» ≤ 13,7 s, segundo pedido ≤ 13,7 s y fin ≤ 26,8 s', async () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const log = [];
  for (let k = 0; k < 40; k++) {
    const throttle = k % 4 === 0 ? 0 : Math.round(rnd() * 60000), second = ['hang', 'body', 'ok', 'bad_token'][k % 4];
    const r = await run7a({ throttle, plan: [k % 3 ? 'hang' : 'body', second] });
    log.push({ k, throttle, retryAt: r.retryAt, second: r.seen[1] && r.seen[1].t - r.seen[0].t, done: r.done });
    assert.ok(r.seen.length === 2 && r.seen.every((s) => s.armed), 'k=' + k);
    assert.ok(r.retryAt >= 12600 && r.retryAt <= 13700, 'k=' + k + ' reintento ' + r.retryAt);
    assert.ok(r.seen[1].t - r.seen[0].t <= 13700, 'k=' + k + ' segundo pedido');
    if (second === 'hang' || second === 'body') assert.ok(r.err && r.err.timeout && r.done <= 26800, 'k=' + k + ' fin ' + r.done);
    else assert.ok(r.out && r.done <= 13700, 'k=' + k);
    assert.equal(r.left, 0); assert.equal(r.listeners, 0);
  }
  if (process.env.SIM7A_LOG) console.log(JSON.stringify(log));
});
