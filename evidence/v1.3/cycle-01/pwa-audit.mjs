// Read-only product audit. All generated evidence stays in this cycle directory.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const root = new URL('../../../', import.meta.url);
const read = file => readFileSync(new URL(file, root));
const source = read('POS/sw.js').toString();
const built = read('tools/cloudflare-lab/.reader-assets/POS/sw.js').toString();
const checks = [];
const check = (name, expected, observed) => {
  const result = JSON.stringify(expected) === JSON.stringify(observed) ? 'PASS' : 'PRODUCT_FAIL';
  checks.push({ name, expected, observed, result });
};
const events = {};
let online = true;
const cacheRequests = [];
const context = vm.createContext({
  URL,
  self: {
    registration: { scope: 'https://pwa.example/POS/' },
    location: { origin: 'https://pwa.example' },
    addEventListener: (name, callback) => { events[name] = callback; }
  },
  caches: {
    match: async request => {
      cacheRequests.push(typeof request === 'string' ? request : request.url);
      return String(typeof request === 'string' ? request : request.url).includes('index.html') ? 'html-v1' : 'js-v1';
    }
  },
  fetch: async () => { if (!online) throw new Error('offline'); return 'html-v2'; }
});
vm.runInContext(built, context);
check('hosted_cache_version', true, /^nuevo-amanecer-pos-shell-[a-f0-9]{16}$/.test(vm.runInContext('CACHE_NAME', context)));
check('local_source_cache_version', false, source.includes('__BUILD_HASH__'));
const urls = vm.runInContext('PRECACHE_URLS', context);
check('precache_missing_files', [], urls.filter(file => !existsSync(new URL('POS/' + file.slice(2), root))));
check('precache_unique', urls.length, new Set(urls).size);

async function dispatch(path, { method = 'GET', mode = 'cors', headers = {} } = {}) {
  let response;
  events.fetch({
    request: { url: new URL(path, 'https://pwa.example').href, method, mode, headers: new Headers(headers) },
    respondWith: value => { response = value; }
  });
  return response === undefined ? 'NETWORK_BYPASS' : await response;
}
for (const path of ['/health', '/sync/operations', '/read/sales', 'https://external.example/data']) {
  check('exclude_' + path, 'NETWORK_BYPASS', await dispatch(path));
}
check('exclude_write', 'NETWORK_BYPASS', await dispatch('/POS/js/app.js', { method: 'POST' }));
for (const header of ['authorization', 'x-sync-token', 'x-read-token']) {
  check('exclude_' + header, 'NETWORK_BYPASS', await dispatch('/POS/js/app.js', { headers: { [header]: 'synthetic-test-only' } }));
}
online = false;
check('offline_navigation', 'html-v1', await dispatch('/POS/index.html', { mode: 'navigate' }));
check('offline_script', 'js-v1', await dispatch('/POS/js/app.js'));
online = true;
const html = await dispatch('/POS/index.html', { mode: 'navigate' });
const script = await dispatch('/POS/js/app.js');
check('update_keeps_same_generation', true, html.slice(-2) === script.slice(-2));

const files = ['MANIFEST.yaml', 'POS/index.html', 'POS/sw.js', 'POS/manifest.webmanifest',
  'POS/assets/icons/icon-192.png', 'POS/assets/icons/icon-512.png',
  'tools/cloudflare-lab/scripts/build-reader.mjs'];
const report = {
  at: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
  method: 'Node VM dispatch of actual built service worker with synthetic network/cache. NOT a browser, install, lifecycle or physical-device test.',
  sourceSha256: Object.fromEntries(files.map(file => [file, createHash('sha256').update(read(file)).digest('hex')])),
  checks,
  updateObserved: { html, script },
  cacheRequests,
  verdict: checks.some(c => c.result !== 'PASS') ? 'NOT_APPROVED' : 'PASS'
};
assert.equal(checks.length, 15);
writeFileSync(new URL('pwa-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.verdict !== 'PASS') process.exitCode = 1;
