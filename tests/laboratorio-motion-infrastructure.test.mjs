import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const bootstrap = readFileSync('laboratorio/pos-lab/js/motion/page-transitions.js', 'utf8');
const cart = readFileSync('laboratorio/pos-lab/js/motion/cart-motion.js', 'utf8');
const modal = readFileSync('laboratorio/pos-lab/js/motion/modal-motion.js', 'utf8');
const feedback = readFileSync('laboratorio/pos-lab/js/motion/feedback-motion.js', 'utf8');
const motionCss = readFileSync('laboratorio/pos-lab/animations/motion.css', 'utf8');
const modalCss = readFileSync('laboratorio/pos-lab/animations/modals.css', 'utf8');
const uiMap = readFileSync('laboratorio/pos-lab/UI_MAP.yaml', 'utf8');
const motionMap = readFileSync('laboratorio/pos-lab/MOTION_MAP.yaml', 'utf8');
const template = readFileSync('laboratorio/pos-lab/index.template.html', 'utf8');

test('all motion controllers are valid JavaScript', () => {
  for (const path of [
    'laboratorio/pos-lab/js/motion/page-transitions.js',
    'laboratorio/pos-lab/js/motion/cart-motion.js',
    'laboratorio/pos-lab/js/motion/modal-motion.js',
    'laboratorio/pos-lab/js/motion/feedback-motion.js'
  ]) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test('motion bootstrap loads before every existing controller', () => {
  const pageAt = template.indexOf('js/motion/page-transitions.js');
  const cartAt = template.indexOf('js/motion/cart-motion.js');
  const modalAt = template.indexOf('js/motion/modal-motion.js');
  const feedbackAt = template.indexOf('js/motion/feedback-motion.js');
  assert.ok(pageAt >= 0);
  assert.ok(pageAt < cartAt);
  assert.ok(cartAt < modalAt);
  assert.ok(modalAt < feedbackAt);
});

test('shared motion runtime exposes reusable visual-only helpers', () => {
  for (const helper of [
    'clamp',
    'reducedMotion',
    'parseTimeMs',
    'cssTimeMs',
    'restartClass',
    'setState',
    'getState',
    'setProgress',
    'inspect',
    'whenTransitionEnds'
  ]) {
    assert.match(bootstrap, new RegExp('\\b' + helper + '\\b'));
  }
  assert.match(bootstrap, /motion\.core = Object\.assign/);
  assert.match(bootstrap, /transitionend/);
  assert.match(bootstrap, /transitioncancel/);
});

test('core math and state contract are deterministic without a browser', () => {
  const styleValues = new Map();
  const fakeElement = {
    dataset: {},
    offsetWidth: 1,
    style: {
      setProperty(name, value) { styleValues.set(name, String(value)); },
      getPropertyValue(name) { return styleValues.get(name) || ''; }
    },
    classList: {
      add() {},
      remove() {}
    }
  };
  const window = {
    __NA_LAB__: true,
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout
  };
  const context = {
    window,
    document: { documentElement: fakeElement },
    getComputedStyle: () => ({
      getPropertyValue: name => name === '--duration-test' ? '0.56s' : ''
    })
  };
  vm.runInNewContext(bootstrap, context);
  const core = window.NA_LAB_MOTION.core;

  assert.equal(core.clamp(2, 0, 1), 1);
  assert.equal(core.clamp(-1, 0, 1), 0);
  assert.equal(core.parseTimeMs('0.56s', 0), 560);
  assert.equal(core.cssTimeMs(fakeElement, '--duration-test', 0), 560);
  assert.equal(core.setState(fakeElement, 'dragging'), 'dragging');
  assert.equal(core.setProgress(fakeElement, 1.5), 1);
  assert.equal(core.inspect(fakeElement).state, 'dragging');
  assert.equal(core.inspect(fakeElement).progress, 1);
});

test('CSS is the timing source and modal cleanup is transition-driven with fallback', () => {
  assert.match(motionCss, /--lab-motion-modal-settle-duration:\s*560ms/);
  assert.match(motionCss, /--lab-motion-ease-settle:/);
  assert.match(modalCss, /var\(--lab-motion-modal-settle-duration\)/);
  assert.match(modalCss, /var\(--lab-motion-ease-settle\)/);
  assert.match(modal, /core\.cssTimeMs\(overlay, '--lab-motion-modal-settle-duration'/);
  assert.match(modal, /core\.whenTransitionEnds\(panel/);
  assert.doesNotMatch(modal, /SETTLE_MS\s*=\s*560/);
});

test('existing controllers consume the shared runtime without a monolithic controller', () => {
  assert.match(cart, /motion\.core\.restartClass/);
  assert.match(feedback, /motion\.core\.restartClass/);
  assert.match(modal, /const core = motion\.core/);
  assert.match(modal, /motion\.workspace = Object\.assign/);
});

test('motion architecture is discoverable by AI and remains visual-only', () => {
  assert.match(uiMap, /architecture_map:\s*laboratorio\/pos-lab\/MOTION_MAP\.yaml/);
  assert.match(uiMap, /core_contract:\s*window\.NA_LAB_MOTION\.core/);
  assert.match(motionMap, /authority:\s*visual_only/);
  assert.match(motionMap, /business_authority:\s*false/);
  assert.match(motionMap, /progress_variable:\s*--lab-motion-progress/);
  assert.match(motionMap, /transitionend/);
  assert.match(motionMap, /do_not:/);

  const runtime = [bootstrap, cart, modal, feedback].join('\n');
  assert.doesNotMatch(runtime, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|\/lab\/workspace\//);
});
