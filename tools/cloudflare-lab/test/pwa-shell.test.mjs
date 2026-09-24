import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import vm from 'node:vm';

const root = new URL('../../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root));
const source = read('POS/sw.js').toString();
const origin = 'https://pwa.test';
const scope = `${origin}/POS/`;

function worker(generation = 'v1') {
  const events = {};
  const entries = new Map();
  const network = [];
  const deleted = [];
  let installed = [];
  const cache = {
    match: async (request) => entries.get(typeof request === 'string' ? request : request.url),
    addAll: async (requests) => { installed = requests; }
  };
  const context = vm.createContext({
    URL, Request, Response,
    self: { registration: { scope }, location: { origin }, addEventListener: (name, fn) => { events[name] = fn; } },
    caches: {
      open: async (name) => { assert.equal(name, `nuevo-amanecer-pos-shell-${generation}`); return cache; },
      // A foreign generation must never satisfy a missing entry.
      match: async (request) => new Response(String(request.url || request).includes('index.html') ? 'html-v1' : 'js-v1'),
      keys: async () => ['unrelated-cache', 'nuevo-amanecer-pos-shell-old', `nuevo-amanecer-pos-shell-${generation}`],
      delete: async (name) => { deleted.push(name); return true; }
    },
    fetch: async (request) => { network.push(request); return new Response('html-v2'); }
  });
  vm.runInContext(source.replace('__BUILD_HASH__', generation), context);
  const urls = Array.from(vm.runInContext('PRECACHE_URLS', context));
  for (const url of urls) entries.set(new URL(url, scope).href, new Response(url.endsWith('index.html') ? `html-${generation}` : `js-${generation}`));
  return {
    urls, entries, network, deleted,
    installed: () => installed,
    async lifecycle(name) { let pending; events[name]({ waitUntil: (value) => { pending = value; } }); await pending; },
    async fetch(path, options = {}) {
      let pending;
      events.fetch({
        request: { url: new URL(path, origin).href, method: 'GET', mode: 'cors', headers: new Headers(), ...options },
        respondWith: (value) => { pending = value; }
      });
      return pending === undefined ? undefined : await pending;
    }
  };
}

test('an active worker serves HTML and scripts from the same generation while the network has v2', async () => {
  const sw = worker();
  assert.equal(await (await sw.fetch('/POS/index.html', { mode: 'navigate' })).text(), 'html-v1');
  assert.equal(await (await sw.fetch('/POS/js/app.js')).text(), 'js-v1');
  assert.equal(sw.network.length, 0);
});

test('navigation query strings cannot bypass the generation-pinned HTML', async () => {
  const sw = worker();
  assert.equal(await (await sw.fetch('/POS/index.html?launch=1', { mode: 'navigate' })).text(), 'html-v1');
  assert.equal(sw.network.length, 0);
});

test('missing shell entries fail closed rather than mixing network or foreign caches', async () => {
  const sw = worker('v2');
  sw.entries.clear();
  for (const [path, mode] of [['/POS/index.html', 'navigate'], ['/POS/js/app.js', 'cors']]) {
    assert.equal((await sw.fetch(path, { mode })).status, 503);
  }
  assert.equal(sw.network.length, 0);
});

test('precache bypasses stale HTTP cache; activation deletes only older shell caches', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  assert.equal(sw.installed().length, sw.urls.length);
  assert.equal(new Set(sw.urls).size, sw.urls.length);
  for (const request of sw.installed()) {
    assert.equal(request.cache, 'reload');
    assert.ok(request.url.startsWith(scope));
  }
  await sw.lifecycle('activate');
  assert.deepEqual(sw.deleted, ['nuevo-amanecer-pos-shell-old']);
  assert.doesNotMatch(source, /skipWaiting\s*\(|clients\.claim\s*\(/);
});

test('API, credentials, writes and external requests stay outside shell caching', async () => {
  const sw = worker();
  for (const path of ['/health', '/sync/operations', '/read/sales', '/POS/not-allowlisted.js', 'https://external.test/a.js']) {
    assert.equal(await sw.fetch(path), undefined, path);
  }
  assert.equal(await sw.fetch('/POS/js/app.js', { method: 'POST' }), undefined);
  for (const name of ['authorization', 'x-sync-token', 'x-read-token']) {
    assert.equal(await sw.fetch('/POS/js/app.js', { headers: new Headers({ [name]: 'test-only' }) }), undefined);
  }
});

test('built reader assets match the exact PWA allowlist and source bytes', () => {
  const sw = worker();
  const expected = ['read-only.html', 'js/sync/read-only.js', 'POS/sw.js', ...sw.urls.map((url) => `POS/${url.slice(2)}`)].sort();
  const output = new URL('tools/cloudflare-lab/.reader-assets/', root);
  function list(directory, prefix = '') {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      assert.equal(entry.isSymbolicLink(), false);
      return entry.isDirectory() ? list(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`];
    });
  }
  assert.equal(expected.length, 58);
  assert.deepEqual(list(output).sort(), expected);
  for (const file of expected.filter((file) => file !== 'POS/sw.js')) {
    assert.deepEqual(readFileSync(new URL(file, output)), read(file.startsWith('POS/') ? file : `POS/${file}`), file);
  }
  const built = readFileSync(new URL('POS/sw.js', output), 'utf8');
  assert.doesNotMatch(built, /__BUILD_HASH__/);
  assert.match(built, /CACHE_PREFIX}\w{16}/);
  const manifest = JSON.parse(read('POS/manifest.webmanifest'));
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './index.html');
  for (const size of [192, 512]) {
    const png = read(`POS/assets/icons/icon-${size}.png`);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

test('local server serves allowlisted PWA resources with correct MIME and a concrete build hash', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ['tools/pos-local/server.mjs', '--port=0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const info = await new Promise((resolve, reject) => {
      let text = '';
      child.stdout.on('data', (data) => {
        text += data;
        if (text.includes('\n')) {
          try { resolve(JSON.parse(text.split('\n')[0])); } catch (error) { reject(error); }
        }
      });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Local server exited: ${code}`)));
    });
    const base = new URL(info.url).origin;
    for (const [file, type] of [
      ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
      ['sw.js', 'text/javascript; charset=utf-8'],
      ['assets/icons/icon-192.png', 'image/png'],
      ['assets/icons/icon-512.png', 'image/png']
    ]) {
      const response = await fetch(`${base}/POS/${file}`);
      assert.equal(response.status, 200, file);
      assert.equal(response.headers.get('content-type'), type);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (file === 'sw.js') {
        assert.doesNotMatch(bytes.toString(), /__BUILD_HASH__/);
        assert.match(bytes.toString(), /CACHE_PREFIX}\w{16}/);
      } else assert.deepEqual(bytes, read(`POS/${file}`));
      const head = await fetch(`${base}/POS/${file}`, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-type'), type);
      assert.equal(Number(head.headers.get('content-length')), bytes.length);
      assert.equal(await head.text(), '');
    }
    assert.equal((await fetch(`${base}/POS/assets/icons/not-allowed.png`)).status, 404);
  } finally {
    if (child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
  }
});
