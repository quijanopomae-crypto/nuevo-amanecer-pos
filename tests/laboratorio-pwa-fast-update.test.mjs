import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('laboratorio/pos-lab/lab-overrides.js', 'utf8');
const css = readFileSync('laboratorio/pos-lab/lab-overrides.css', 'utf8');
const start = source.indexOf('// ===== LAB-PWA-FAST-UPDATE-001');
const end = source.indexOf("console.info('[NA-LAB] Punto de extensión listo", start);
assert.ok(start >= 0 && end > start, 'bloque PWA LAB no encontrado');
const block = source.slice(start, end);

function element(tag='div') {
  const children = new Map();
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    hidden: false,
    dataset: {},
    disabled: false,
    textContent: '',
    innerHTML: '',
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    addEventListener(type, fn) { listeners.set(type, fn); },
    querySelector(selector) { return children.get(selector) || null; },
    _listeners: listeners,
    _children: children
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html || ''; },
    set(value) {
      this._html = String(value);
      if (this.id === 'labPwaUpdatePrompt' || String(value).includes('labPwaUpdateAction')) {
        const status = element('span');
        status.id = 'labPwaUpdateStatus';
        const button = element('button');
        button.id = 'labPwaUpdateAction';
        button.textContent = 'Actualizar ahora';
        children.set('#labPwaUpdateStatus', status);
        children.set('#labPwaUpdateAction', button);
      }
    }
  });
  return el;
}

function harness() {
  const byId = new Map();
  const body = { appendChild(node) {
    byId.set(node.id, node);
    const status = node.querySelector('#labPwaUpdateStatus');
    const button = node.querySelector('#labPwaUpdateAction');
    if (status) byId.set('labPwaUpdateStatus', status);
    if (button) byId.set('labPwaUpdateAction', button);
  }};
  const document = {
    body,
    getElementById(id) { return byId.get(id) || null; },
    createElement(tag) {
      const node = element(tag);
      Object.defineProperty(node, 'id', {
        get() { return this._id || ''; },
        set(value) { this._id = String(value); }
      });
      return node;
    }
  };

  const windowListeners = new Map();
  const swListeners = new Map();
  const timers = [];
  let reloads = 0;
  let updateCalls = 0;
  const messages = [];
  const waiting = { state:'installed', postMessage(msg) { messages.push(msg); } };
  const registration = {
    waiting,
    installing: null,
    async update() { updateCalls += 1; }
  };
  const navigator = {
    serviceWorker: {
      controller: { id:'old' },
      async getRegistration() { return registration; },
      addEventListener(type, fn) { swListeners.set(type, fn); }
    }
  };
  const window = {
    addEventListener(type, fn) { windowListeners.set(type, fn); },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    location: { reload() { reloads += 1; } }
  };
  const context = vm.createContext({ window, document, navigator, console, Promise, setTimeout:window.setTimeout, clearTimeout:window.clearTimeout });
  vm.runInContext(block, context);
  return {
    window, document, navigator, registration, waiting, windowListeners, swListeners, timers, messages,
    updateCalls: () => updateCalls,
    reloads: () => reloads
  };
}

test('muestra una ventana accionable solo cuando llega el evento de versión pendiente', () => {
  const h = harness();
  assert.equal(h.document.getElementById('labPwaUpdatePrompt'), null);
  h.windowListeners.get('na:version-update-pending')();
  const prompt = h.document.getElementById('labPwaUpdatePrompt');
  assert.ok(prompt);
  assert.equal(prompt.hidden, false);
  assert.equal(prompt.querySelector('#labPwaUpdateAction').textContent, 'Actualizar ahora');
});

test('Actualizar ahora ejecuta registration.update y ordena activar el worker preparado', async () => {
  const h = harness();
  h.windowListeners.get('na:version-update-pending')();
  const button = h.document.getElementById('labPwaUpdatePrompt').querySelector('#labPwaUpdateAction');
  await button._listeners.get('click')();
  assert.equal(h.updateCalls(), 1);
  assert.equal(h.messages.length, 1);\n  assert.equal(h.messages[0].type, 'NA_ACTIVATE_UPDATE');
  assert.equal(button.disabled, true);
});

test('controllerchange recarga una sola vez', async () => {
  const h = harness();
  h.windowListeners.get('na:version-update-pending')();
  await h.window.NA_LAB_PWA_UPDATE.apply();
  h.swListeners.get('controllerchange')();
  h.swListeners.get('controllerchange')();
  assert.ok(h.timers.length >= 1);
  h.timers[0]();
  assert.equal(h.reloads(), 1);
});

test('el estilo mantiene la acción visible y adaptada a móvil', () => {
  assert.match(css, /\.lab-pwa-update-prompt\s*\{/);
  assert.match(css, /\.lab-pwa-update-action\s*\{/);
  assert.match(css, /@media \(max-width: 430px\)/);
});
