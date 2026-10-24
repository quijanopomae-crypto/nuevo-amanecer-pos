import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync('POS/js/modules/cobro-qr-yape-plin.js', 'utf8');
const permissions = readFileSync('POS/js/config/pos-permissions.js', 'utf8');
const registry = readFileSync('POS/js/modules/proximamente-registry.js', 'utf8');
function ctx(locked) {
  const store = new Map();
  const c = vm.createContext({
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    NA_PERMISSIONS: { featureLocked: id => (id === 'cobro-qr-yape-plin' ? locked : true) },
    document: { readyState: 'complete', getElementById: () => null, querySelector: () => null, addEventListener() {}, removeEventListener() {} },
    addEventListener() {}, setTimeout,
  });
  c.globalThis = c;
  vm.runInContext(source, c);
  return { api: c.NA_COBRO_QR, store };
}

test('la tarjeta existe en Próximamente y su llave en FEATURE_LOCKS', () => {
  assert.match(registry, /id: 'cobro-qr-yape-plin'/);
  assert.match(permissions, /'cobro-qr-yape-plin': (true|false)/);
});
test('bloqueada o sin política: no se habilita (falla cerrada)', () => {
  assert.equal(ctx(true).api.enabled(), false);
  assert.equal(ctx(false).api.enabled(), true);
});
test('solo acepta imágenes data: PNG/JPEG/WEBP y billeteras yape/plin', () => {
  const { api, store } = ctx(false);
  assert.equal(api.validImage('data:image/png;base64,iVBORw0KGgo='), true);
  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://x/qr.png', 'data:image/png;base64,"><img>', null, 5]) assert.equal(api.validImage(bad), false);
  store.set(api.STORE_KEY, JSON.stringify({ yape: 'data:image/png;base64,QUJD', plin: 'javascript:alert(1)', transferencia: 'data:image/png;base64,QUJD' }));
  assert.equal(api.getQr('yape'), 'data:image/png;base64,QUJD');
  assert.equal(api.getQr('plin'), '');
  assert.equal(api.getQr('transferencia'), '');
  assert.equal(api.getQr('__proto__'), '');
  store.set(api.STORE_KEY, '{roto');
  assert.equal(api.getQr('yape'), '');
});
test('no usa innerHTML ni toca el cobro', () => {
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(source, /confirmarVenta|procesarVenta|posPayM\s*=|_naCobroMoney\s*=|mCobroTotal['"]\)\.textContent\s*=/);
});
