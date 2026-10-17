import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const index = readFileSync('POS/index.html', 'utf8');
const css = readFileSync('POS/css/components.css', 'utf8');
const sw = readFileSync('POS/sw.js', 'utf8');

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, 'missing start: ' + startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, 'missing end: ' + endNeedle);
  return source.slice(start, end);
}

test('CANON renders a visible real update action', () => {
  assert.match(index, /id="pwaUpdatePrompt"/);
  assert.match(index, /id="pwaUpdateStatus"/);
  assert.match(index, /id="pwaUpdateAction"[^>]*>Actualizar ahora<\/button>/);
  assert.match(css, /\.pwa-update-prompt\{/);
  assert.match(css, /\.pwa-update-action\{/);
  assert.match(css, /@media\(max-width:430px\)/);
});

test('page updater checks, waits, activates and reloads once', () => {
  const block = between(index, '// CANON-PWA-UPDATE-001', '</script>');
  assert.match(block, /registration\.update\(\)/);
  assert.match(block, /registration\.waiting/);
  assert.match(block, /registration\.installing/);
  assert.match(block, /statechange/);
  assert.match(block, /NA_ACTIVATE_UPDATE/);
  assert.match(block, /controllerchange/);
  assert.match(block, /reloadingForWorkerUpdate/);
  assert.match(block, /Reintentar/);
  assert.doesNotThrow(() => new Function(block));
});

test('new versions always activate (never stuck waiting); the page reloads only when no sale is in progress', () => {
  const install = between(sw, "self.addEventListener('install'", "self.addEventListener('activate'");
  const message = between(sw, "self.addEventListener('message'", "self.addEventListener('fetch'");
  assert.match(install, /stageShell\(cache\)\)\s*\.then\(\(\) => self\.skipWaiting\(\)\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(index, /afterSaleFinishes\(function \(\) \{\s*\/\/[^\n]*\n\s*if \(quietNeeded\(\)/);
  assert.match(message, /NA_ENABLE_MANUAL_UPDATES/);
  assert.match(message, /caches\.open\(MANUAL_UPDATE_MARKER_CACHE\)/);
  assert.match(message, /NA_ACTIVATE_UPDATE/);
  assert.match(message, /self\.skipWaiting\(\)/);
  assert.match(index, /NA_ENABLE_MANUAL_UPDATES/);
  assert.doesNotThrow(() => new Function(sw));
});

test('heavy OCR vendor assets no longer block each shell update', () => {
  const precache = between(sw, 'const PRECACHE_URLS = [', 'const VENDOR_URLS = [');
  const vendor = between(sw, 'const VENDOR_URLS = [', 'const PRECACHE_URLS_ABSOLUTE');
  for (const asset of [
    'tesseract.min.js',
    'worker.min.js',
    'tesseract-core-simd-lstm.wasm.js',
    'spa.traineddata.gz'
  ]) {
    assert.doesNotMatch(precache, new RegExp(asset.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')));
    assert.match(vendor, new RegExp(asset.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')));
  }
  assert.match(sw, /VENDOR_CACHE_NAME/);
  assert.match(sw, /VENDOR_URLS_ABSOLUTE\.has\(request\.url\)/);
  assert.match(sw, /cache\.put\(request, response\.clone\(\)\)/);
});

test('updater stays outside LAB and business authority', () => {
  assert.doesNotMatch(index + css + sw, /laboratorio\//i);
  assert.doesNotMatch(sw, /\/commands\/|payment\.create|sale\.create|credit-account\.create/i);
});

function fakeTarget(properties = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) {
      for (const listener of [...(listeners.get(event.type) || [])]) listener(event);
    }
  }, properties);
}

async function flushPromises() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function updater(t, { existingInstalling = false, controller = true } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const elements = Object.fromEntries(['pwaUpdatePrompt', 'pwaUpdateStatus', 'pwaUpdateAction', 'pwaUpdateLater'].map(id => [id, fakeTarget({
    hidden: id === 'pwaUpdatePrompt', dataset: {}, textContent: '', disabled: false
  })]));
  let reloads = 0;
  let updateCalls = 0;
  let update = () => Promise.resolve(registration);
  const registration = fakeTarget({
    waiting: null, installing: null,
    update() { updateCalls++; return update(); }
  });
  const serviceWorker = fakeTarget({
    controller: controller ? { postMessage() {} } : null,
    register: () => Promise.resolve(registration)
  });
  const document = fakeTarget({
    visibilityState: 'visible',
    getElementById: id => elements[id] || null,
    querySelector: () => null
  });
  const window = fakeTarget({
    isSecureContext: true,
    setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
    setInterval: (...args) => setInterval(...args), clearInterval: id => clearInterval(id),
    location: { reload() { reloads++; } },
    NuevoAmanecerCanonical: { sourceState: () => ({ validation: 'current' }) }
  });
  const storageWrites = [];
  const context = {
    window, document, navigator: { serviceWorker }, cart: [],
    CustomEvent: class { constructor(type) { this.type = type; } },
    localStorage: { getItem: () => null, setItem: (...args) => storageWrites.push(args) },
    console: { warn() {} }
  };
  function installingWorker(announce = true) {
    const messages = [];
    const worker = fakeTarget({ state: 'installing', postMessage: message => messages.push(message) });
    worker.messages = messages;
    worker.changeState = state => {
      worker.state = state;
      if (state === 'installed') registration.waiting = worker;
      if (state === 'activated' || state === 'redundant') registration.installing = null;
      worker.dispatchEvent({ type: 'statechange' });
    };
    registration.installing = worker;
    if (announce) registration.dispatchEvent({ type: 'updatefound' });
    return worker;
  }
  if (existingInstalling) installingWorker(false);
  vm.runInNewContext(between(index, '// CANON-PWA-UPDATE-001', '</script>'), context);
  window.dispatchEvent({ type: 'load' });
  await flushPromises();
  return {
    prompt: elements.pwaUpdatePrompt, status: elements.pwaUpdateStatus, action: elements.pwaUpdateAction,
    window, document, serviceWorker, registration, context, storageWrites, installingWorker,
    setUpdate: fn => { update = fn; },
    click: async () => { elements.pwaUpdateAction.dispatchEvent({ type: 'click' }); await flushPromises(); },
    reloads: () => reloads, updateCalls: () => updateCalls
  };
}

function assertFailure(app) {
  assert.equal(app.prompt.hidden, false);
  assert.equal(app.prompt.dataset.state, 'error');
  assert.equal(app.status.textContent, 'No se pudo actualizar');
  assert.equal(app.action.textContent, 'Reintentar');
  assert.equal(app.action.disabled, false);
  assert.equal(app.reloads(), 0);
}

for (const failure of ['redundant', 'update rejection', 'install error', 'timeout']) {
  test(`${failure}: failure offers retry; a second failure hides the same banner without reload`, async t => {
    const app = await updater(t);
    const prompt = app.prompt;
    let worker = app.installingWorker();
    assert.equal(app.status.textContent, 'Descargando la versión nueva…');
    assert.equal(app.action.textContent, 'Descargando…');
    assert.equal(app.action.disabled, true);
    async function fail() {
      if (failure === 'redundant') worker.changeState('redundant');
      if (failure === 'install error') worker.dispatchEvent({ type: 'error' });
      if (failure === 'update rejection') {
        app.setUpdate(() => Promise.reject(new Error('offline')));
        app.window.dispatchEvent({ type: 'online' });
      }
      if (failure === 'timeout') {
        t.mock.timers.tick(119999);
        assert.equal(app.prompt.hidden, false);
        assert.notEqual(app.prompt.dataset.state, 'error');
        t.mock.timers.tick(1);
      }
      await flushPromises();
    }
    await fail();
    assertFailure(app);
    const calls = app.updateCalls();
    app.setUpdate(() => { worker = app.installingWorker(); return Promise.resolve(app.registration); });
    await app.click();
    assert.equal(app.updateCalls(), calls + 1);
    assert.equal(app.prompt, prompt);
    assert.equal(app.status.textContent, 'Descargando la versión nueva…');
    assert.equal(app.action.disabled, true);
    await fail();
    assert.equal(app.prompt.hidden, true);
    assert.equal(app.reloads(), 0);
    assert.deepEqual(app.storageWrites, []);
    // Background checks and a late statechange cannot reopen a dismissed failed attempt.
    app.window.dispatchEvent({ type: 'online' });
    worker.changeState('installed');
    t.mock.timers.tick(120000);
    await flushPromises();
    assert.equal(app.prompt.hidden, true);
    assert.equal(app.reloads(), 0);
  });
}

test('retry update() rejection closes the banner even if the original installing worker remains', async t => {
  const app = await updater(t);
  app.installingWorker().dispatchEvent({ type: 'error' });
  assertFailure(app);
  app.setUpdate(() => Promise.reject(new Error('offline')));
  const calls = app.updateCalls();
  await app.click();
  assert.equal(app.updateCalls(), calls + 1);
  assert.equal(app.prompt.hidden, true);
  assert.equal(app.reloads(), 0);
});

test('retry check that never settles times out and a late resolution does not reopen the banner', async t => {
  const app = await updater(t);
  app.installingWorker().changeState('redundant');
  let resolve;
  app.setUpdate(() => new Promise(done => { resolve = done; }));
  await app.click();
  t.mock.timers.tick(119999);
  assert.equal(app.prompt.hidden, false);
  assert.equal(app.prompt.dataset.state, 'working');
  t.mock.timers.tick(1);
  assert.equal(app.prompt.hidden, true);
  resolve(app.registration);
  await flushPromises();
  assert.equal(app.prompt.hidden, true);
  assert.equal(app.reloads(), 0);
});

test('an installing worker already present at registration is watched; registration errors offer retry', async t => {
  const app = await updater(t, { existingInstalling: true });
  assert.equal(app.status.textContent, 'Descargando la versión nueva…');
  app.registration.dispatchEvent({ type: 'error' });
  assertFailure(app);
});

test('installed success clears the deadline, preserves ready messages and manually activates with one reload', async t => {
  const app = await updater(t);
  const worker = app.installingWorker();
  worker.changeState('installed');
  assert.equal(app.status.textContent, 'Hay una versión nueva, recarga.');
  assert.equal(app.action.textContent, 'Recargar');
  t.mock.timers.tick(120000);
  assert.equal(app.prompt.dataset.state, 'ready');
  await app.click();
  assert.equal(app.status.textContent, 'Aplicando la versión nueva…');
  assert.equal(app.action.textContent, 'Actualizando…');
  assert.equal(worker.messages[0].type, 'NA_ACTIVATE_UPDATE');
  worker.changeState('activated');
  app.serviceWorker.dispatchEvent({ type: 'controllerchange' });
  app.serviceWorker.dispatchEvent({ type: 'controllerchange' });
  assert.equal(app.status.textContent, 'Actualización lista. Recargando…');
  t.mock.timers.tick(120000);
  assert.equal(app.reloads(), 1);
});

test('retry success resumes the installed, activation and single reload flow', async t => {
  const app = await updater(t);
  app.installingWorker().changeState('redundant');
  let worker;
  app.setUpdate(() => { worker = app.installingWorker(); return Promise.resolve(app.registration); });
  await app.click();
  worker.changeState('installed');
  assert.equal(app.status.textContent, 'Hay una versión nueva, recarga.');
  t.mock.timers.tick(120000);
  assert.equal(app.prompt.dataset.state, 'ready');
  await app.click();
  assert.equal(worker.messages[0].type, 'NA_ACTIVATE_UPDATE');
  app.serviceWorker.dispatchEvent({ type: 'controllerchange' });
  t.mock.timers.tick(120000);
  assert.equal(app.reloads(), 1);
});

test('activation clears the deadline and controllerchange still waits for an active sale before one reload', async t => {
  const app = await updater(t);
  const worker = app.installingWorker();
  worker.changeState('activated');
  t.mock.timers.tick(120000);
  assert.notEqual(app.prompt.dataset.state, 'error');
  app.context.cart.push({ id: 'test-product' });
  app.serviceWorker.dispatchEvent({ type: 'controllerchange' });
  app.serviceWorker.dispatchEvent({ type: 'controllerchange' });
  assert.equal(app.status.textContent, 'Actualización lista. Se aplicará al terminar la venta en curso.');
  assert.equal(app.action.textContent, 'Esperando la venta…');
  t.mock.timers.tick(120000);
  assert.equal(app.reloads(), 0);
  app.context.cart.length = 0;
  t.mock.timers.tick(1000);
  assert.equal(app.status.textContent, 'Actualización lista. Recargando…');
  t.mock.timers.tick(80);
  assert.equal(app.reloads(), 1);
});

test('first installation without a controller remains silent on failure', async t => {
  const app = await updater(t, { controller: false });
  app.installingWorker().changeState('redundant');
  assert.equal(app.prompt.hidden, true);
  assert.equal(app.reloads(), 0);
});

test('background update check rejection without a new installing worker stays silent', async t => {
  const app = await updater(t);
  app.setUpdate(() => Promise.reject(new Error('offline')));
  app.window.dispatchEvent({ type: 'online' });
  await flushPromises();
  assert.equal(app.prompt.hidden, true);
  assert.equal(app.reloads(), 0);
});

test('a late catch from the failed installation cannot dismiss the new retry', async t => {
  const app = await updater(t);
  const worker = app.installingWorker();
  await app.click();
  assert.equal(app.status.textContent, 'Descargando la actualización…');
  worker.changeState('redundant');
  assertFailure(app);
  let retryWorker;
  app.setUpdate(() => { retryWorker = app.installingWorker(); return Promise.resolve(app.registration); });
  await app.click();
  assert.equal(app.prompt.hidden, false);
  assert.equal(app.status.textContent, 'Descargando la versión nueva…');
  retryWorker.changeState('redundant');
  assert.equal(app.prompt.hidden, true);
  assert.equal(app.reloads(), 0);
});
