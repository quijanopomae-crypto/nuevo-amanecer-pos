import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('POS/js/navigation/menu-navigation.js', 'utf8');
const index = readFileSync('POS/index.html', 'utf8');
const sw = readFileSync('POS/sw.js', 'utf8');

function makeCard(pageId) {
  const attrs = new Map([['onclick', `goPage('${pageId}')`]]);
  const menuMarker = {};
  return {
    attrs,
    label: { textContent: pageId },
    getAttribute(name) { return attrs.get(name) ?? null; },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    hasAttribute(name) { return attrs.has(name); },
    querySelector(selector) { return selector === '.module-label' ? this.label : null; },
    closest(selector) {
      if (selector === '.module-card') return this;
      if (selector === '#pageMenu') return menuMarker;
      return null;
    }
  };
}

function harness() {
  const cards = [
    makeCard('pagePOS'),
    makeCard('pageInventario'),
    makeCard('pageVentas'),
    makeCard('pageClientes'),
    makeCard('pageCaja'),
    makeCard('pageGastos'),
    makeCard('pageConfig')
  ];
  const listeners = new Map();
  const menuAttrs = new Map();
  const menu = {
    getAttribute(name) { return menuAttrs.get(name) ?? null; },
    setAttribute(name, value) { menuAttrs.set(name, String(value)); },
    querySelectorAll(selector) { return selector === '.module-card' ? cards : []; },
    addEventListener(type, fn) { listeners.set(type, fn); }
  };
  const calls = [];
  let clock = 100;
  const context = {
    window: null,
    document: {
      readyState: 'complete',
      getElementById(id) { return id === 'pageMenu' ? menu : null; },
      addEventListener() {}
    },
    performance: { now: () => clock },
    Date,
    Object,
    Array,
    Map,
    Set,
    console,
    goPage(id) { calls.push(id); }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'menu-navigation.js' });
  return {
    cards,
    listeners,
    calls,
    setClock(value) { clock = value; }
  };
}

function evt(target, extra = {}) {
  return Object.assign({
    target,
    pointerType: 'touch',
    pointerId: 7,
    clientX: 100,
    clientY: 200,
    key: '',
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  }, extra);
}

test('CANON menu navigation allowlists and prepares exactly the seven module cards', () => {
  const h = harness();
  assert.equal(h.cards.length, 7);
  for (const card of h.cards) {
    assert.equal(card.getAttribute('role'), 'button');
    assert.equal(card.getAttribute('tabindex'), '0');
    assert.ok(card.getAttribute('data-page'));
    assert.match(card.getAttribute('aria-label'), /^Abrir /);
  }
});

test('tapping any descendant of a module card opens it once and suppresses the synthetic click', () => {
  const h = harness();
  const card = h.cards[3];
  const child = { closest(selector) { return selector === '.module-card' ? card : null; } };
  h.listeners.get('pointerdown')(evt(child));
  h.listeners.get('pointerup')(evt(child, { clientX: 104, clientY: 205 }));
  assert.deepEqual(h.calls, ['pageClientes']);

  const click = evt(child, { pointerType: 'mouse' });
  h.listeners.get('click')(click);
  assert.deepEqual(h.calls, ['pageClientes']);
  assert.equal(click.prevented, true);
  assert.equal(click.stopped, true);
});

test('vertical finger movement is treated as scroll and never opens a module', () => {
  const h = harness();
  const card = h.cards[1];
  h.listeners.get('pointerdown')(evt(card));
  h.listeners.get('pointerup')(evt(card, { clientY: 245 }));
  assert.deepEqual(h.calls, []);
  h.listeners.get('click')(evt(card, { pointerType: 'mouse' }));
  assert.deepEqual(h.calls, []);
});

test('mouse click and keyboard Enter/Space use the existing goPage navigation', () => {
  const h = harness();
  h.setClock(5000);
  h.listeners.get('click')(evt(h.cards[0], { pointerType: 'mouse' }));
  h.listeners.get('keydown')(evt(h.cards[5], { key: 'Enter' }));
  h.listeners.get('keydown')(evt(h.cards[6], { key: ' ' }));
  assert.deepEqual(h.calls, ['pagePOS', 'pageGastos', 'pageConfig']);
});

test('navigation layer is visual/input only and never owns business, storage or network', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sale\.create|payment\.create|cash\.open|cash\.close|credit-account\.create|payment\.create/i);
  assert.match(source, /root\.goPage\(pageId\)/);
});

test('CANON shell loads and precaches the menu navigation layer', () => {
  const nav = index.indexOf('js/navigation/menu-navigation.js');
  const motion = index.indexOf('js/motion/core.js');
  assert.ok(nav >= 0, 'missing menu navigation script');
  assert.ok(motion > nav, 'menu navigation must load before Motion');
  assert.match(sw, /'\.\/js\/navigation\/menu-navigation\.js'/);
});
