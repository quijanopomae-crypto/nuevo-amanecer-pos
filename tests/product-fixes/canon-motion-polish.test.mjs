import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('feedback restart is deferred, does not measure layout and cancels older restarts', () => {
  const frames = [], classes = new Set();
  const window = { requestAnimationFrame: cb => frames.push(cb), setTimeout: cb => frames.push(cb),
    clearTimeout() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false }) };
  const element = { classList: { add: n => classes.add(n), remove: n => classes.delete(n) } };
  Object.defineProperty(element, 'offsetWidth', { get() { throw new Error('synchronous layout'); } });
  vm.runInNewContext(readFileSync('POS/js/motion/core.js', 'utf8'), { window, WeakMap, Object, Number, String, Math });
  assert.equal(window.NA_MOTION.core.restartClass(element, 'na-cart-pulse'), true);
  window.NA_MOTION.core.restartClass(element, 'na-cart-pulse');
  assert.equal(classes.size, 0);
  while (frames.length) frames.splice(0).forEach(cb => cb());
  assert.deepEqual([...classes], ['na-cart-pulse']);
});

test('polish assets are loaded after the LAB mirror, cached and support reduced motion', () => {
  const html = readFileSync('POS/index.html', 'utf8');
  const sw = readFileSync('POS/sw.js', 'utf8');
  const css = readFileSync('POS/css/motion/polish.css', 'utf8');
  assert.ok(html.indexOf('css/motion/polish.css') > html.indexOf('css/experience-v2/animations/notifications.css'));
  assert.ok(sw.includes('./css/motion/polish.css'));
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.modal-overlay\.open\s*>\s*\.modal/);
  assert.match(css, /\.na-enter-fade/);
});

test('modal gesture measures once and settles without a synchronous layout restart', () => {
  const frames = [], listeners = {}, properties = new Map();
  let measurements = 0;
  const classList = { add() {}, remove() {}, contains() { return false; } };
  const panel = { classList, scrollTop: 0, addEventListener: (name, fn) => { listeners[name] = fn; },
    removeEventListener() {}, getBoundingClientRect() { measurements++; return { height: 600 }; } };
  const overlay = { classList, firstElementChild: panel, dataset: {},
    style: { setProperty: (n, v) => properties.set(n, v), removeProperty: n => properties.delete(n) } };
  Object.defineProperty(overlay, 'offsetWidth', { get() { throw new Error('synchronous layout'); } });
  const window = { requestAnimationFrame: cb => frames.push(cb), setTimeout: cb => frames.push(cb), clearTimeout() {},
    dispatchEvent() {}, matchMedia: () => ({ matches: false }) };
  const context = vm.createContext({ window, WeakMap, WeakSet, Object, Number, String, Math, Date });
  vm.runInContext(readFileSync('POS/js/motion/core.js', 'utf8'), context);
  vm.runInContext(readFileSync('POS/js/motion/modal-motion.js', 'utf8'), context);
  assert.equal(window.NA_MOTION.modal.bindSwipeDismiss(overlay), true);
  listeners.touchstart({ touches: [{ clientX: 0, clientY: 0 }] });
  for (const y of [10, 20, 30]) listeners.touchmove({ touches: [{ clientX: 0, clientY: y }], preventDefault() {} });
  listeners.touchcancel({});
  assert.equal(measurements, 1);
});
