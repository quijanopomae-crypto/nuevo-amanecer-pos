import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('feedback restart defers class re-add without forcing synchronous layout', () => {
  const frames = [], classes = new Set();
  const window = {
    requestAnimationFrame: cb => frames.push(cb),
    setTimeout: cb => frames.push(cb),
    clearTimeout() {},
    dispatchEvent() {},
    matchMedia: () => ({ matches: false })
  };
  const element = { classList: { add: n => classes.add(n), remove: n => classes.delete(n) } };
  Object.defineProperty(element, 'offsetWidth', { get() { throw new Error('synchronous layout'); } });
  vm.runInNewContext(readFileSync('POS/js/motion/core.js', 'utf8'), { window, WeakMap, Object, Number, String, Math });
  assert.equal(window.NA_MOTION.core.restartClass(element, 'na-cart-pulse'), true);
  window.NA_MOTION.core.restartClass(element, 'na-cart-pulse');
  assert.equal(classes.size, 0);
  while (frames.length) frames.splice(0).forEach(cb => cb());
  assert.deepEqual([...classes], ['na-cart-pulse']);
});

test('mission C runtime stays visual-only', () => {
  const files = [
    'POS/js/motion/core.js',
    'POS/js/motion/lab-parity-bridge.js',
    'POS/js/motion/modal-motion.js',
    'POS/js/motion/page-transitions.js',
    'POS/js/motion/scroll-motion.js'
  ].map(path => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(files, /saveAllData|saveAppState|localStorage|sessionStorage|createSale|createPayment|openCash|closeCash|fetch\s*\(/);
});
