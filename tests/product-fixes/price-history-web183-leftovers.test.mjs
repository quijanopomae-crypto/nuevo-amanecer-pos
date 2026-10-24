// Reversión de #871 (historial de precios en la nube): un aparato que tuvo web 183 conserva en
// localStorage lo que dejó price-history-sync.js (cid/synced/syncError/redacted en na_price_history_v1,
// na_price_history_cloud_v1 y na_price_history_backfill_v1). La web revertida debe ignorarlo sin errores,
// conservar el historial local y no llamar a /auth/price-history*. Solo fixtures locales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const url = path => new URL('../../' + path, import.meta.url);
const read = path => readFileSync(url(path), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function memory(seed) {
  const bag = new Map(Object.entries(seed || {}));
  return {
    getItem(key) { return bag.has(key) ? bag.get(key) : null; },
    setItem(key, value) { bag.set(key, String(value)); },
    removeItem(key) { bag.delete(key); },
    bag
  };
}

const LEFTOVER_LOCAL = {
  P1: [
    { id: 'P1:2026-10-21T15:00:00.000Z:venta:change:2', seq: 2, at: '2026-10-21T15:00:00.000Z', user: 'Ana', userId: 'dev-ana', type: 'venta', before: 2, after: 2.5, origin: 'ficha', cid: 'ph1:dev-ana:11111111-1111-4111-8111-111111111111', synced: true },
    { id: 'P1:2026-10-21T14:00:00.000Z:costo:change:1', seq: 1, at: '2026-10-21T14:00:00.000Z', user: 'Ana', userId: 'dev-ana', type: 'costo', before: 1, after: 1.4, origin: 'ficha', cid: 'ph1:legacy:' + 'a'.repeat(64) }
  ],
  P2: [
    { id: 'P2:2026-10-21T13:00:00.000Z:mayorista:change:1', seq: 1, at: '2026-10-21T13:00:00.000Z', user: 'Empleado', userId: 'dev-emp', type: 'mayorista', before: null, after: 20, origin: 'ficha', cid: 'ph1:dev-emp:22222222-2222-4222-8222-222222222222', syncError: 'invalid' },
    { id: 'P2:2026-10-21T12:00:00.000Z:costo:OP-1:1:1', seq: 1, at: '2026-10-21T12:00:00.000Z', user: 'Empleado', userId: 'dev-emp', type: 'costo', before: null, after: null, origin: 'compra', ref: 'OP-1:1:costo', cid: 'ph1:dev-emp:33333333-3333-4333-8333-333333333333', synced: true, redacted: true }
  ]
};
const LEFTOVER_CLOUD = { cursor: { since: '2026-10-21T15:00:00.000Z', since_id: 'x' }, rows: { P1: [{ change_id: 'ph1:otro:zzz', product_id: 'P1', field: 'venta', before_cents: 250, after_cents: 300, origin: 'ficha', user_name: 'Otro', changed_at: '2026-10-21T16:00:00.000Z' }] } };
const LEFTOVER_BACKFILL = { device_id: 'dev-ana', done_at: '2026-10-21T15:01:00.000Z' };

function loadWeb(owner = true) {
  const storage = memory({
    na_price_history_v1: JSON.stringify(LEFTOVER_LOCAL),
    na_price_history_cloud_v1: JSON.stringify(LEFTOVER_CLOUD),
    na_price_history_backfill_v1: JSON.stringify(LEFTOVER_BACKFILL)
  });
  const calls = [];
  const listeners = {};
  const ctx = vm.createContext({
    localStorage: storage,
    NA_PERMISSIONS: { featureLocked: id => id !== 'historial-precios-producto' }, // CM-162: candado abierto
    fetch: async (input) => { calls.push(String(input)); return { ok: true, status: 200, json: async () => ({}) }; },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent: event => { (listeners[event && event.type] || []).forEach(fn => fn(event)); return true; },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    NA_ROLES: { role: owner ? 'owner' : 'empleado', label: 'Ana', deviceId: 'dev-ana', confirmed: true, isOwner: () => owner,
      api: async path => { calls.push('api:' + path); return {}; } }
  });
  ctx.window = ctx;
  vm.runInContext(read('POS/js/products/price-history.js'), ctx);
  vm.runInContext(read('POS/js/products/price-history-ui.js'), ctx);
  return { ctx, storage, calls, listeners };
}

test('web revertida: las claves de web 183 no rompen el historial local y no hay llamadas a la nube', () => {
  const { ctx, storage, calls } = loadWeb(true);
  const api = ctx.NA_PRICE_HISTORY;
  assert.equal(ctx.NA_PRICE_HISTORY_SYNC, undefined, 'price-history-sync.js ya no existe');
  assert.equal(api.CLOUD_KEY, undefined, 'sin unión con la caché de la nube');
  const p1 = api.list('P1');
  assert.deepEqual(plain(p1.map(r => r.id)), LEFTOVER_LOCAL.P1.map(r => r.id), 'el historial local del dueño se conserva (sin filas de la nube)');
  assert.equal(api.list('P2').length, 2);
  // Una edición nueva se agrega sin perder lo anterior ni sus campos extra.
  const added = api.recordDiff({ productId: 'P1', origin: 'ficha', before: { venta: 2.5, mayorista: null, costo: 1.4 }, after: { venta: 3, mayorista: null, costo: 1.4 } });
  assert.equal(added.length, 1);
  assert.equal(added[0].cid, undefined, 'la web revertida no genera cid');
  const stored = JSON.parse(storage.getItem('na_price_history_v1'));
  assert.equal(stored.P1.length, 3);
  assert.equal(stored.P1[1].cid, LEFTOVER_LOCAL.P1[0].cid);
  assert.equal(stored.P1[1].synced, true);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.P2)), LEFTOVER_LOCAL.P2);
  // Claves de la nube: inertes, no se leen ni se reescriben.
  assert.deepEqual(JSON.parse(storage.getItem('na_price_history_cloud_v1')), LEFTOVER_CLOUD);
  assert.deepEqual(JSON.parse(storage.getItem('na_price_history_backfill_v1')), LEFTOVER_BACKFILL);
  // Eventos que antes disparaban la sincronización: ya no llaman a la red.
  ctx.dispatchEvent(new ctx.CustomEvent('na:role'));
  ctx.dispatchEvent(new ctx.CustomEvent('na:price-history'));
  assert.deepEqual(calls, []);
});

test('web revertida: el empleado no ve costos (ni los redactados por web 183)', () => {
  const { ctx } = loadWeb(false);
  const rows = ctx.NA_PRICE_HISTORY.list('P2');
  assert.deepEqual(plain(rows.map(r => r.type)), ['mayorista']);
  assert.equal(ctx.NA_PRICE_HISTORY.list('P1').some(r => r.type === 'costo'), false);
});

test('POS/ no carga price-history-sync.js ni llama a /auth/price-history', () => {
  const offenders = [];
  const walk = dir => readdirSync(url(dir)).forEach(name => {
    const path = dir + '/' + name;
    if (statSync(url(path)).isDirectory()) return walk(path);
    if (!/\.(js|html|json|webmanifest)$/.test(name)) return;
    const src = read(path);
    if (/price-history-sync|\/auth\/price-history|na:price-history-cloud/.test(src)) offenders.push(path);
  });
  walk('POS');
  assert.deepEqual(offenders, []);
  assert.equal(existsSync(url('POS/js/products/price-history-sync.js')), false);
});

test('sw.js: cada entrada de PRECACHE_URLS existe en POS/ y no hay duplicados', () => {
  const sw = read('POS/sw.js');
  const block = sw.slice(sw.indexOf('const PRECACHE_URLS = ['), sw.indexOf('];', sw.indexOf('const PRECACHE_URLS = [')));
  const entries = [...block.matchAll(/'(\.\/[^']+)'/g)].map(m => m[1]);
  assert.ok(entries.length > 20, 'lista de precarga leída');
  const missing = entries.filter(entry => !existsSync(url('POS/' + entry.slice(2).split('?')[0])));
  assert.deepEqual(missing, []);
  assert.equal(new Set(entries).size, entries.length, 'sin entradas repetidas');
  // La caché del shell se versiona con el build (__BUILD_HASH__ -> SHA del deploy) y activate borra las anteriores.
  assert.match(sw, /const CACHE_NAME = `\$\{CACHE_PREFIX\}__BUILD_HASH__`;/);
  assert.match(sw, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);
});
