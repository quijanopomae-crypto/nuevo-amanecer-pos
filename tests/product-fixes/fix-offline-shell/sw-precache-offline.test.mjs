// Recarga sin red: todo <script>/<link> que index.html carga al arrancar debe estar en la precarga del
// service worker (o en sus listas diferidas), y /runtime-config.js debe resolverse red-primero con copia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const index = readFileSync('POS/index.html', 'utf8');
const sw = readFileSync('POS/sw.js', 'utf8');

function list(name) {
  const start = sw.indexOf('const ' + name + ' = [');
  assert.ok(start >= 0, 'falta ' + name);
  const block = sw.slice(start, sw.indexOf('];', start));
  return [...block.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
}

function bootRefs(html) {
  const refs = [];
  const re = /<(script|link)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[2];
    const url = (attrs.match(/\b(?:src|href)=["']([^"']+)["']/i) || [])[1];
    if (!url) continue;
    if (/\btype=["']text\/x-na-lazy["']/i.test(attrs)) continue; // manifiesto de carga diferida (lazy-assets.js)
    if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith('data:')) continue; // externos (CDN/fuentes)
    if (m[1].toLowerCase() === 'link' && /\brel=["'](?:preconnect|dns-prefetch)["']/i.test(attrs)) continue;
    refs.push({ url, line: html.slice(0, m.index).split('\n').length });
  }
  return refs;
}

test('cada <script>/<link> local de index.html está precargado por sw.js (arranque sin red)', () => {
  const cached = new Set([...list('PRECACHE_URLS'), ...list('LAZY_URLS'), ...list('VENDOR_URLS')]);
  const refs = bootRefs(index);
  assert.ok(refs.length > 100, 'index.html leído');
  const missing = refs
    .filter((r) => r.url !== '/runtime-config.js')
    .filter((r) => !cached.has(r.url.replace(/^\.\//, '').split('?')[0]))
    .map((r) => 'index.html:' + r.line + ' ' + r.url);
  assert.deepEqual(missing, []);
});

test('runtime-config.js: lo carga index.html y el SW lo sirve red-primero, no desde PRECACHE_URLS', () => {
  assert.ok(bootRefs(index).some((r) => r.url === '/runtime-config.js'));
  assert.ok(!list('PRECACHE_URLS').some((u) => u.includes('runtime-config')), 'no va en la lista cache-first');
  assert.match(sw, /const RUNTIME_CONFIG_URL = new URL\('\/runtime-config\.js', self\.registration\.scope\)\.href;/);
  assert.match(sw, /\[\.\.\.PRECACHE_URLS_ABSOLUTE, RUNTIME_CONFIG_URL\]/);
  // La caché del shell se sigue versionando con el deploy.
  assert.match(sw, /const CACHE_NAME = `\$\{CACHE_PREFIX\}__BUILD_HASH__`;/);
});

// Ejecuta sw.js en un VM con caches/fetch simulados y prueba el manejador real.
function loadWorker({ scope = 'https://pos.example.test/app/' } = {}) {
  const stores = new Map();
  const listeners = {};
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    return {
      match: async (req) => { const r = map.get(typeof req === 'string' ? req : req.url); return r ? r.clone() : undefined; },
      put: async (req, res) => { map.set(typeof req === 'string' ? req : req.url, res); },
      keys: async () => [...map.keys()].map((u) => new Request(u)),
    };
  };
  const net = { mode: 'online', body: 'globalThis.NA_HOSTED_CONFIG={v:2};', status: 200, calls: 0 };
  const fetchImpl = async (req) => {
    net.calls += 1;
    if (net.mode === 'offline') throw new TypeError('Failed to fetch');
    if (net.mode === 'hang') return new Promise(() => {});
    return new Response(net.body, { status: net.status, headers: { 'content-type': 'text/javascript' } });
  };
  const self = {
    registration: { scope },
    location: new URL(scope),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {}, clients: { claim: () => {} },
  };
  const ctx = vm.createContext({ self, caches: { open: async (n) => cacheFor(n), keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n) },
    fetch: fetchImpl, Request, Response, Headers, URL, Set, Map, Promise, setTimeout, clearTimeout, TypeError, console });
  vm.runInContext(sw.replaceAll('__BUILD_HASH__', 'test-build'), ctx);
  const dispatchFetch = async (url, { mode = 'no-cors', headers = {} } = {}) => {
    const request = new Request(url, { headers });
    Object.defineProperty(request, 'mode', { value: mode });
    let responded = null; const waits = [];
    listeners.fetch({ request, respondWith: (p) => { responded = Promise.resolve(p); }, waitUntil: (p) => waits.push(p) });
    if (!responded) return null;
    const res = await responded; if (net.mode !== 'hang') await Promise.allSettled(waits); return res;
  };
  return { net, stores, dispatchFetch, cache: () => stores.get('nuevo-amanecer-pos-shell-test-build') };
}

test('runtime-config.js red-primero: con red usa y guarda la versión nueva; sin red, la última copia', async () => {
  const w = loadWorker();
  const url = 'https://pos.example.test/runtime-config.js';
  w.net.body = 'globalThis.NA_HOSTED_CONFIG={v:1};';
  assert.equal(await (await w.dispatchFetch(url)).text(), 'globalThis.NA_HOSTED_CONFIG={v:1};');
  w.net.body = 'globalThis.NA_HOSTED_CONFIG={v:2};';
  assert.equal(await (await w.dispatchFetch(url)).text(), 'globalThis.NA_HOSTED_CONFIG={v:2};', 'contenido nuevo de la red, no la copia vieja');
  w.net.mode = 'offline';
  assert.equal(await (await w.dispatchFetch(url)).text(), 'globalThis.NA_HOSTED_CONFIG={v:2};', 'sin red: última copia buena');
});

test('runtime-config.js: un 503 de la red se respeta (no se tapa con la copia) y no se guarda', async () => {
  const w = loadWorker();
  const url = 'https://pos.example.test/runtime-config.js';
  await w.dispatchFetch(url);
  w.net.status = 503; w.net.body = "throw new Error('NA_HOSTED_CONFIG_INVALID');";
  const res = await w.dispatchFetch(url);
  assert.equal(res.status, 503);
  w.net.mode = 'offline';
  assert.equal(await (await w.dispatchFetch(url)).text(), 'globalThis.NA_HOSTED_CONFIG={v:2};');
});

test('runtime-config.js: sin copia y sin red falla (no inventa config); red colgada usa la copia', async () => {
  const w = loadWorker();
  const url = 'https://pos.example.test/runtime-config.js';
  w.net.mode = 'offline';
  await assert.rejects(w.dispatchFetch(url));
  w.net.mode = 'online'; await w.dispatchFetch(url);
  w.net.mode = 'hang';
  const t = Date.now();
  const keepAlive = setTimeout(() => {}, 10000);
  assert.equal(await (await w.dispatchFetch(url)).text(), 'globalThis.NA_HOSTED_CONFIG={v:2};');
  clearTimeout(keepAlive);
  assert.ok(Date.now() - t < 6000, 'no espera más que el tiempo máximo');
});

test('navegar a /app/ (enlace del lanzador) sin red sirve el shell instalado', async () => {
  const w = loadWorker();
  const { stores } = w;
  stores.set('nuevo-amanecer-pos-shell-test-build', new Map([['https://pos.example.test/app/index.html', new Response('<!doctype html>shell')]]));
  w.net.mode = 'offline';
  for (const u of ['https://pos.example.test/app/', 'https://pos.example.test/app/index.html', 'https://pos.example.test/app/?shell_refresh=x']) {
    const res = await w.dispatchFetch(u, { mode: 'navigate' });
    assert.ok(res, 'el SW responde ' + u);
    assert.equal(await res.text(), '<!doctype html>shell');
  }
  assert.equal(await w.dispatchFetch('https://pos.example.test/otra.html', { mode: 'navigate' }), null, 'otras rutas siguen fuera');
  assert.equal(await w.dispatchFetch('https://pos.example.test/', { mode: 'navigate' }), null, 'el lanzador / sigue fuera del SW');
});

test('obligatorios: index.html y pos-permissions.js siempre; cache-identity-guard.js solo cuando está en PRECACHE_URLS (PR #884)', async () => {
  const critical = (src) => {
    const ctx = vm.createContext({ self: { registration: { scope: 'https://pos.example.test/app/' }, location: new URL('https://pos.example.test/app/'), addEventListener: () => {} }, URL, Set, Map, Promise, setTimeout, clearTimeout, Request, Response, Headers, caches: {}, fetch: () => {} });
    vm.runInContext(src + '\n;globalThis.__critical = [...CRITICAL_SHELL];', ctx);
    return Array.from(ctx.__critical, (u) => new URL(u).pathname).sort();
  };
  const hasGuard = list('PRECACHE_URLS').includes('js/sync/cache-identity-guard.js');
  assert.deepEqual(critical(sw), hasGuard ? ['/app/index.html', '/app/js/config/pos-permissions.js', '/app/js/sync/cache-identity-guard.js'] : ['/app/index.html', '/app/js/config/pos-permissions.js']);
  const integrated = hasGuard ? sw : sw.replace("  './js/sync/canonical-client.js',\n", "  './js/sync/canonical-client.js',\n  './js/sync/cache-identity-guard.js',\n");
  assert.ok(list('PRECACHE_URLS').includes('js/sync/canonical-client.js'), 'ancla para simular la integración con #884');
  assert.deepEqual(critical(integrated), ['/app/index.html', '/app/js/config/pos-permissions.js', '/app/js/sync/cache-identity-guard.js']);
  assert.ok(!critical(integrated).includes('/app/js/config/theme-state.js'), 'theme-state.js no es obligatorio (celulares viejos)');
  assert.match(sw, /if \(CRITICAL_SHELL\.has\(url\)\) throw error;/);
});
