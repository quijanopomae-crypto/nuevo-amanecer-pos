// SPEC-891 (C1): la página / solo borra la sesión guardada ante un 401/403 real del servidor.
// Un fallo de red, un tiempo de espera, un 5xx o CANON aún no listo la conservan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync('tools/cloudflare-pos-web/public/activate.js', 'utf8');
const API = 'https://api.example.test';
const CRED = 'na_cloud_sync_credentials';

function run(fetchImpl) {
  const store = new Map([[CRED, JSON.stringify({ endpoint: API, token: 'tok-guardado' })], ['na_canonical_binding', '{"x":1}'], ['na_canonical_sale_outbox_v1', '{"intents":[1]}']]);
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const el = () => ({ hidden: false, disabled: false, value: '', textContent: '', dataset: {}, addEventListener() {}, focus() {} });
  const nodes = {};
  const document = { getElementById: id => (nodes[id] ||= el()) };
  const ctx = vm.createContext({
    NA_HOSTED_CONFIG: { apiOrigin: API, environment: 'staging', hostedHost: 'pos.example.test' },
    document, localStorage, fetch: fetchImpl, window: { location: { hostname: 'pos.example.test', search: '' } },
    URL, URLSearchParams, console: { warn() {} }, crypto: globalThis.crypto, TextEncoder, setTimeout, Date, JSON, Promise,
  });
  vm.runInContext(SRC, ctx);
  return { store, nodes };
}
const settle = () => new Promise(r => setTimeout(r, 20));
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

for (const [name, impl] of [
  ['fallo de red (fetch rechaza)', async () => { throw new TypeError('Failed to fetch'); }],
  ['tiempo de espera (AbortError)', async () => { const e = new Error('timeout'); e.name = 'AbortError'; throw e; }],
  ['5xx del servidor', async () => jsonResponse(503, { error: 'unavailable' })],
  ['CANON aún no ACTIVE', async () => jsonResponse(200, { authority: 'canonical', mode: 'SHADOW' })],
]) {
  test(`SPEC-891 / conserva la sesión guardada ante ${name}`, async () => {
    const { store, nodes } = run(impl);
    await settle();
    assert.equal(JSON.parse(store.get(CRED)).token, 'tok-guardado');
    assert.ok(store.has('na_canonical_binding'));
    assert.ok(store.has('na_canonical_sale_outbox_v1'));
    assert.doesNotMatch(nodes.status.textContent, /ya no es válida/);
    assert.match(nodes.status.textContent, /se conserva/);
    assert.equal(nodes.retryButton.hidden, false);
    assert.equal(nodes.activatePanel.hidden, true, 'no pide reactivar');
  });
}

for (const status of [401, 403]) {
  test(`SPEC-891 / un ${status} real borra la sesión (no las colas) y pide activar`, async () => {
    const { store, nodes } = run(async () => jsonResponse(status, { error: status === 401 ? 'unauthorized' : 'session_revoked' }));
    await settle();
    assert.equal(store.has(CRED), false, nodes.status.textContent);
    assert.equal(store.has('na_canonical_binding'), false);
    assert.ok(store.has('na_canonical_sale_outbox_v1'), 'las colas no se tocan');
    assert.match(nodes.status.textContent, /La sesión guardada ya no es válida/);
    assert.equal(nodes.activatePanel.hidden, false);
  });
}
