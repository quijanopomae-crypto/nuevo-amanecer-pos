// sandbox.mjs — harness focalizado de UI POLISH (worktree product/pos-improvements @ eb459bf).
// Carga los scripts REALES del producto (byte a byte, orden de index.html parcial) en node:vm.
// Extiende los stubs del patrón fix02/03/04: captura listeners de document/window, querySelector
// mínimo por clase (para .g-topbar y la detección de la X .btn-close-m/.pay-close) y stub de
// MutationObserver. Permite disparar touch/wheel/scroll/click sintéticos sobre los winners reales.
//
// Orden de carga: utils, inline-01..03, core/state.js (misma posición relativa que index.html).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const POS_DIR = path.resolve(HERE, '..', '..', '..', 'POS');

const LOAD_ORDER = [
  'js/core/utils.js',
  'js/legacy-inline/inline-01.js',
  'js/legacy-inline/inline-02.js',
  'js/legacy-inline/inline-03.js',
  'js/core/state.js',
];

export function makeStore() {
  const map = new Map();
  let broken = false;
  return {
    map,
    break_() { broken = true; },
    restore() { broken = false; },
    get broken() { return broken; },
    getItem(k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    setItem(k, v) {
      if (broken) throw new Error('SIMULATED_PERSISTENT_STORAGE_FAILURE');
      map.set(String(k), String(v));
    },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    get length() { return map.size; },
  };
}

function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    toggle: (c, force) => {
      const on = force === undefined ? !set.has(c) : !!force;
      if (on) set.add(c); else set.delete(c);
      return on;
    },
    contains: (c) => set.has(c),
  };
}

function matchesSelector(element, selector) {
  return selector.split(',').some((part) => {
    const clean = part.trim();
    if (clean.startsWith('.')) return element.classList.contains(clean.slice(1));
    if (clean.startsWith('#')) return element.id === clean.slice(1);
    return false;
  });
}

function collectMatches(element, selector, out) {
  (element.children || []).forEach((child) => {
    if (matchesSelector(child, selector)) out.push(child);
    collectMatches(child, selector, out);
  });
  return out;
}

function makeElement(id = '') {
  return {
    id, tagName: 'DIV', value: '', checked: false, textContent: '', innerHTML: '',
    className: '', title: '', hidden: false, disabled: false, open: false,
    type: '', max: '', placeholder: '', files: [], dataset: {}, style: {},
    options: [], selectedOptions: [], selectedIndex: -1,
    scrollTop: 0, scrollY: undefined,
    children: [], parentNode: null, parentElement: null,
    classList: makeClassList(),
    appendChild(child) {
      if (!child) return child;
      if (child.parentNode && typeof child.parentNode.removeChild === 'function') child.parentNode.removeChild(child);
      this.children.push(child);
      child.parentNode = child.parentElement = this;
      return child;
    },
    insertBefore(child) {
      if (!child) return child;
      this.children.unshift(child);
      child.parentNode = child.parentElement = this;
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = child.parentElement = null;
      return child;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    replaceChildren() { this.children.length = 0; },
    querySelector(selector) { return collectMatches(this, selector, [])[0] || null; },
    querySelectorAll(selector) { return collectMatches(this, selector, []); },
    closest(selector) {
      let node = this;
      while (node) {
        if (matchesSelector(node, selector)) return node;
        node = node.parentElement;
      }
      return null;
    },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    focus() {}, blur() {}, click() {}, select() {}, scrollTo() {},
    addEventListener() {}, removeEventListener() {},
    contains: () => false,
  };
}

export function createPosSandbox(opts = {}) {
  const localStorage = opts.stores?.localStorage ?? makeStore();
  const sessionStorage = opts.stores?.sessionStorage ?? makeStore();
  const elements = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();

  const documentElement = makeElement('html');
  const bodyElement = makeElement('body');

  const documentStub = {
    readyState: 'complete',
    hidden: false,
    activeElement: null,
    body: bodyElement,
    documentElement,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelector(selector) {
      if (selector === '.g-topbar') {
        if (!elements.has('gTopbar')) {
          const topbar = makeElement('gTopbar');
          topbar.classList.add('g-topbar');
          elements.set('gTopbar', topbar);
        }
        return elements.get('gTopbar');
      }
      return null;
    },
    querySelectorAll: () => [],
    createElement: () => makeElement(''),
    createTextNode: (text) => ({ textContent: String(text), children: [], parentNode: null, appendChild() {}, removeChild() {} }),
    addEventListener(type, fn) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(fn);
    },
    removeEventListener() {},
    dispatchEvent: () => true,
  };

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    structuredClone, URL, Blob, TextEncoder, TextDecoder,
    performance: globalThis.performance,
    crypto: globalThis.crypto,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    localStorage, sessionStorage, document: documentStub,
    navigator: { userAgent: 'POS-UI-Harness/1.0' },
    location: { href: 'file:///POS/index.html?na-test=1', protocol: 'file:', search: '?na-test=1' },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    prompt: () => null, confirm: () => true, alert() {},
    innerWidth: 390, innerHeight: 800,
    scrollY: 0,
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    removeEventListener() {},
    dispatchEvent: () => true,
    Event: class { constructor(t) { this.type = t; } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;
  sandbox.frames = sandbox;

  const ctx = vm.createContext(sandbox);

  for (const rel of LOAD_ORDER) {
    const code = readFileSync(path.join(POS_DIR, rel), 'utf8');
    new vm.Script(code, { filename: `POS/${rel}` }).runInContext(ctx);
  }

  return {
    ctx,
    stores: { localStorage, sessionStorage },
    run(code) {
      return vm.runInContext(code, ctx, { filename: 'ui-harness.js' });
    },
    el(id) {
      return this.run(`document.getElementById(${JSON.stringify(id)})`);
    },
    topbar() {
      return this.run(`document.querySelector('.g-topbar')`);
    },
    headerHidden() {
      return this.run(`!!(document.querySelector('.g-topbar')&&document.querySelector('.g-topbar').classList.contains('g-topbar-hidden'))`);
    },
    fireDocument(type, event) {
      for (const handler of documentListeners.get(type) || []) handler(event);
    },
    fireWindow(type, event) {
      for (const handler of windowListeners.get(type) || []) handler(event);
    },
    toastText() { return String(this.run("document.getElementById('gToast').textContent") ?? ''); },
    seed() {
      this.run(`
        productos=[];ventas=[];clientes=[];creditos=[];gastos=[];cajMovs=[];cashClosures=[];inventoryMovements=[];cart=[];
        posPayM='efectivo'; posProc=false; pagoProc=false; pagoRevProc=false; gastoProc=false;
        cajMovProc=false; cajCloseProc=false; _naInventoryMoveBusy=false;
        _naQuickPaymentProc=false; _naSaleAnnulmentProc=false;
        document.body.classList.add('module-mobile-scroll');
      `);
    },
  };
}

export function json(sb, expr) {
  return JSON.parse(sb.run(`JSON.stringify(${expr})`));
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 8));
