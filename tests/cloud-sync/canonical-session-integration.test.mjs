import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto, randomUUID } from 'node:crypto';

const clientSource = readFileSync('POS/js/sync/canonical-client.js', 'utf8');
const html = readFileSync('POS/index.html', 'utf8');
const sw = readFileSync('POS/sw.js', 'utf8');
const legacyOutbox = readFileSync('POS/js/sync/outbox.js', 'utf8');
const inline02 = readFileSync('POS/js/legacy-inline/inline-02.js', 'utf8');
const inline03 = readFileSync('POS/js/legacy-inline/inline-03.js', 'utf8');
const inline12 = readFileSync('POS/js/legacy-inline/inline-12.js', 'utf8');

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}

function loadClient(localStorage = storage()) {
  const context = vm.createContext({
    URL, console, crypto: { ...webcrypto, randomUUID }, localStorage, sessionStorage: storage(),
    location: { hostname: 'localhost', origin: 'http://127.0.0.1:8787', protocol: 'http:' },
    navigator: { onLine: true, locks: { request(_name, _options, callback) { return Promise.resolve(callback({ name: 'canonical-lock' })); } } },
    fetch: async () => { throw new Error('unexpected fetch'); },
    addEventListener() {}, dispatchEvent() {}, CustomEvent: class CustomEvent {},
    TextEncoder, TextDecoder, setTimeout, clearTimeout,
  });
  context.globalThis = context;
  vm.runInContext(clientSource, context, { filename: 'canonical-client.js' });
  return { api: context.NuevoAmanecerCanonical, localStorage };
}

test('canonical client uses persistent session auth and contains no device-bound writer contract', () => {
  assert.doesNotMatch(clientSource, /deviceId|device_id|x-device-id|x-sync-token|na_canonical_session/);
  assert.match(clientSource, /na_cloud_sync_credentials/);
  assert.match(clientSource, /authorization:\s*'Bearer '\s*\+/);
  assert.match(clientSource, /SESSION_NOT_AVAILABLE/);
});

test('canonical runtime is dormant by default and binding never stores the session token', async () => {
  const { api, localStorage } = loadClient();
  assert.equal(api.enabled(), false);
  const binding = await api.configure({
    endpoint: 'http://127.0.0.1:8787', promotion_id: 'promotion-1', authority_epoch: 2, revision: 7, token: 'persistent-session-token',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(binding)), { endpoint: 'http://127.0.0.1:8787', promotion_id: 'promotion-1', authority_epoch: 2, revision: 7 });
  const storedBinding = JSON.parse(localStorage.getItem('na_canonical_binding'));
  assert.equal(storedBinding.deviceId, undefined);
  assert.equal(storedBinding.token, undefined);
  assert.equal(JSON.parse(localStorage.getItem('na_cloud_sync_credentials')).token, 'persistent-session-token');
  assert.equal(api.enabled(), true);
});

test('canonical binding refuses arbitrary remote hosts to protect the session token', async () => {
  const { api } = loadClient();
  await assert.rejects(api.configure({ endpoint: 'https://attacker.example', promotion_id: 'promotion-1', authority_epoch: 2, revision: 7, token: 'persistent-session-token' }), /INVALID_AUTHORITY_BINDING/);
});

test('CANON shell loads all recovered layers and fences the legacy write path', () => {
  for (const asset of [
    'js/sync/canonical-client.js', 'js/sync/canonical-sale-intent.js', 'js/sync/canonical-sale-outbox.js',
    'js/sync/canonical-sale-projection.js', 'js/sync/canonical-sale-integration.js', 'js/sync/canonical-sale-view.js',
  ]) {
    assert.equal(html.includes(asset), true, asset + ' missing from HTML');
    assert.equal(sw.includes(asset), true, asset + ' missing from service worker');
  }
  assert.match(legacyOutbox, /CANONICAL_LEGACY_OUTBOX_BLOCKED/);
  assert.match(legacyOutbox, /blocked:\s*'canonical_authority'/);
  assert.match(inline02, /CANONICAL_LEGACY_PERSISTENCE_BLOCKED/);
  assert.match(inline03, /NuevoAmanecerCanonical\.startPOS/);
  assert.match(inline12, /_baseCliRender=function/);
  assert.doesNotMatch(inline12, /cliRender=function\(\)\{/);
});
