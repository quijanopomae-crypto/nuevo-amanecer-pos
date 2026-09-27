import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(path, 'utf8');
const canonical = read('POS/js/sync/canonical-client.js');
const productRenderer = read('POS/js/legacy-inline/inline-14.js');
const legacyToast = read('POS/js/legacy-inline/inline-01.js');
const legacyPos = read('POS/js/legacy-inline/inline-02.js');
const index = read('POS/index.html');
const clientCss = read('POS/css/client-credit-accounts-v2.css');
const notificationCss = read('POS/css/motion/notifications.css');
const motionPath = 'POS/js/motion/client-list-motion.js';
const clientMotion = existsSync(motionPath) ? read(motionPath) : '';

function createMotionHarness({ active = true, reducedMotion = false } = {}) {
  const classes = new Set();
  const timers = [];
  const frames = [];
  let nextTimerId = 0;
  let renderCount = 0;
  const page = {
    classList: {
      contains(name) { return name === 'active' ? active : classes.has(name); },
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); }
    }
  };
  const list = { id: 'cliList' };
  const window = {
    document: {
      getElementById(id) {
        if (id === 'pageClientes') return page;
        if (id === 'cliList') return list;
        return null;
      }
    },
    cliRender() { renderCount += 1; return renderCount; },
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    setTimeout(callback, delay) {
      const timer = { id: ++nextTimerId, callback, delay, cleared: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(id) {
      const timer = timers.find(item => item.id === id);
      if (timer) timer.cleared = true;
    },
    matchMedia() { return { matches: reducedMotion }; }
  };
  vm.runInNewContext(clientMotion, { window });
  return {
    window, classes, timers, frames,
    get renderCount() { return renderCount; },
    runFrame() { const callback = frames.shift(); assert.ok(callback, 'expected a queued animation frame'); callback(); },
    runTimer() {
      const timer = timers.find(item => !item.cleared);
      assert.ok(timer, 'expected a queued refresh timer');
      timer.cleared = true;
      timer.callback();
      return timer;
    }
  };
}

test('CANON maps the canonical category into the POS filter field', () => {
  assert.match(productRenderer, /product\.cat===posCat/);
  assert.match(canonical, /cat:\s*String\(p\.category\s*\|\|\s*''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(canonical, /categoria:\s*p\.category\s*\|\|\s*''/);
});

test('CANON loads Clientes list motion after the V2 render hook', () => {
  const v2Index = index.indexOf('js/modules/client-credit-accounts-v2.js');
  const motionIndex = index.indexOf('js/motion/client-list-motion.js');
  assert.ok(v2Index >= 0, 'Clientes V2 module must be loaded');
  assert.ok(motionIndex > v2Index, 'motion wrapper must load after the final Clientes render hook');
});

test('the first visible Clientes render is immediate and then eases into place', () => {
  const h = createMotionHarness();
  assert.equal(h.window.cliRender(), 1);
  assert.equal(h.renderCount, 1);
  assert.ok(h.classes.has('na-client-refresh-in'));
  h.runFrame();
  assert.ok(h.classes.has('na-client-refresh-in'));
  h.runFrame();
  assert.ok(!h.classes.has('na-client-refresh-in'));
});

test('later Clientes refreshes animate out, render after 850ms, and settle back', () => {
  const h = createMotionHarness();
  h.window.cliRender();
  h.runFrame();
  h.runFrame();

  h.window.cliRender();
  assert.equal(h.renderCount, 1, 'refresh should wait for the approved exit motion');
  assert.ok(h.classes.has('na-client-refresh-out'));
  const timer = h.runTimer();
  assert.equal(timer.delay, 850);
  assert.equal(h.renderCount, 2);
  assert.ok(h.classes.has('na-client-refresh-out'));
  h.runFrame();
  assert.ok(!h.classes.has('na-client-refresh-out'));
});

test('inactive Clientes and reduced-motion users render immediately without motion classes', () => {
  for (const options of [{ active: false }, { reducedMotion: true }]) {
    const h = createMotionHarness(options);
    assert.equal(h.window.cliRender(), 1);
    assert.equal(h.renderCount, 1);
    assert.equal(h.timers.filter(timer => !timer.cleared).length, 0);
    assert.ok(!h.classes.has('na-client-refresh-in'));
    assert.ok(!h.classes.has('na-client-refresh-out'));
  }
});

test('CANON uses the LAB-approved Clientes timing and disables it for reduced motion', () => {
  assert.match(clientCss, /\.na-client-refresh-out/);
  assert.match(clientCss, /opacity\s+1300ms/);
  assert.match(clientCss, /transform\s+1400ms/);
  assert.match(clientCss, /transition-duration:\s*900ms,\s*950ms/);
  assert.match(clientCss, /opacity:\s*\.82/);
  assert.match(clientCss, /translateY\(-6px\)/);
  assert.match(clientCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(clientCss, /\.na-client-refresh-in/);
});

test('cart and toast motion helpers are connected to their POS events', () => {
  assert.match(legacyPos, /NA_MOTION\.cart\.pulse\(badge\)/);
  assert.match(legacyToast, /NA_MOTION\.feedback\.enter\(t\)/);
  assert.match(notificationCss, /from\{\s*opacity:0;\s*translate:0 4px\}/);
  assert.match(notificationCss, /to\{\s*opacity:1;\s*translate:0 0\}/);
});
