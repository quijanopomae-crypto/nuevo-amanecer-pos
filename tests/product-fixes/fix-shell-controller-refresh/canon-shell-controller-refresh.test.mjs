import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('POS/index.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const source = blocks.find(block => block.includes("navigator.serviceWorker.register('sw.js'"));
assert.ok(source, 'service worker bootstrap script must exist');

async function harness(controller) {
  let onLoad = null;
  let onControllerChange = null;
  let reloads = 0;
  let registrations = 0;
  let updates = 0;

  const serviceWorker = {
    controller,
    addEventListener(type, callback) {
      if (type === 'controllerchange') onControllerChange = callback;
    },
    register(url, options) {
      registrations += 1;
      assert.equal(url, 'sw.js');
      assert.deepEqual(options, { scope: './', updateViaCache: 'none' });
      return Promise.resolve({
        update() {
          updates += 1;
          return Promise.resolve();
        }
      });
    }
  };

  const window = {
    isSecureContext: true,
    addEventListener(type, callback) {
      if (type === 'load') onLoad = callback;
    },
    location: {
      reload() {
        reloads += 1;
      }
    }
  };

  vm.runInNewContext(source, {
    window,
    navigator: { serviceWorker },
    console
  });

  assert.equal(typeof onLoad, 'function', 'bootstrap must register load listener');
  onLoad();
  await Promise.resolve();
  await Promise.resolve();

  return {
    fireControllerChange() {
      if (onControllerChange) onControllerChange();
    },
    get reloads() { return reloads; },
    get registrations() { return registrations; },
    get updates() { return updates; }
  };
}

test('existing controlled POS reloads exactly once when a new service worker takes control', async () => {
  const h = await harness({ scriptURL: 'https://example.test/app/sw.js' });
  assert.equal(h.registrations, 1);
  assert.equal(h.updates, 1);

  h.fireControllerChange();
  h.fireControllerChange();

  assert.equal(h.reloads, 1, 'controller replacement must refresh the loaded shell once');
});

test('first service worker install does not force an unnecessary reload', async () => {
  const h = await harness(null);
  h.fireControllerChange();
  assert.equal(h.reloads, 0);
});
