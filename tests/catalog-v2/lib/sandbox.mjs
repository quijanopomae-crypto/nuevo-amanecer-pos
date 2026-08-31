// sandbox.mjs — harness de CATALOG V2A (base c296856).
// Patrón fix02/03/04 + catalog-normalization: scripts REALES del producto en node:vm,
// orden de index.html relevante para guardarProd/importación/búsqueda de códigos
// (utils, inline-01..07, winners seguros de inventario/POS inline-09/14,
// inline-10..14 relevantes e inline-16).
// El stub de elementos soporta árboles con hijos (patrón ui-polish) para poder ejercer
// los campos reales de códigos alternativos (#pAltCodesList .alt-code-input) que usa
// readAltBarcodes/_naCurrentAltFieldValues dentro de guardarProd.

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
  'js/legacy-inline/inline-04.js',
  'js/legacy-inline/inline-05.js',
  'js/legacy-inline/inline-06.js',
  'js/legacy-inline/inline-07.js',
  'js/legacy-inline/inline-09.js',
  'js/legacy-inline/inline-10.js',
  'js/legacy-inline/inline-11.js',
  'js/legacy-inline/inline-12.js',
  'js/legacy-inline/inline-13.js',
  'js/legacy-inline/inline-14.js',
  'js/legacy-inline/inline-16.js',
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
    id, value: '', checked: false, textContent: '', innerHTML: '',
    className: '', title: '', hidden: false, disabled: false, open: false,
    type: '', max: '', placeholder: '', files: [], dataset: {}, style: {},
    options: [], selectedOptions: [], selectedIndex: -1,
    children: [], parentNode: null,
    classList: makeClassList(),
    appendChild(child) {
      if (!child) return child;
      if (child.parentNode && typeof child.parentNode.removeChild === 'function') child.parentNode.removeChild(child);
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    insertBefore(child) {
      if (!child) return child;
      this.children.unshift(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    replaceChildren() { this.children.length = 0; },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    focus() {}, blur() {}, click() {}, select() {}, scrollTo() {},
    addEventListener() {}, removeEventListener() {},
    querySelector(selector) { return collectMatches(this, selector, [])[0] || null; },
    querySelectorAll(selector) { return collectMatches(this, selector, []); },
    closest: () => null, contains: () => false,
  };
}

export function createPosSandbox(opts = {}) {
  const localStorage = opts.stores?.localStorage ?? makeStore();
  const sessionStorage = opts.stores?.sessionStorage ?? makeStore();
  const elements = new Map();

  const documentStub = {
    readyState: 'complete',
    hidden: false,
    activeElement: null,
    body: { classList: makeClassList(), style: {}, dataset: {}, appendChild() {}, insertAdjacentHTML() {} },
    documentElement: { classList: makeClassList(), style: {}, dataset: {} },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelector: () => null,
    querySelectorAll(selector) {
      // Soporta "#contenedor .clase" para los campos reales de códigos alternativos.
      const scoped = selector.match(/^#([A-Za-z0-9_-]+)\s+(.+)$/);
      if (scoped) {
        const root = elements.get(scoped[1]);
        return root ? collectMatches(root, scoped[2], []) : [];
      }
      return [];
    },
    createElement: () => makeElement(''),
    createTextNode: (text) => ({ textContent: String(text), children: [], parentNode: null, appendChild() {}, removeChild() {} }),
    addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => true,
  };

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    structuredClone, URL, Blob, TextEncoder, TextDecoder,
    performance: globalThis.performance,
    crypto: globalThis.crypto,
    localStorage, sessionStorage, document: documentStub,
    navigator: { userAgent: 'POS-CATALOG-V2-Harness/1.0' },
    location: { href: 'file:///POS/index.html', protocol: 'file:' },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    prompt: () => null, confirm: () => true, alert() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
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

  vm.runInContext(`
    appConfig.alertsEnabled = false;
    appConfig.printAuto = false;
    _naSecurity.pinEnabled = false;
    _naSecurity.logs = [];
    _naEnsureCashierConfig();
    appConfig.activeCashierId = 'CAJ-001';
  `, ctx, { filename: 'catalog-v2-bootstrap.js' });

  return {
    ctx,
    stores: { localStorage, sessionStorage },
    run(code) {
      return vm.runInContext(code, ctx, { filename: 'catalog-v2-harness.js' });
    },
    el(id) {
      return this.run(`document.getElementById(${JSON.stringify(id)})`);
    },
    memoryState() {
      return JSON.parse(this.run(
        'JSON.stringify({productos,ventas,clientes,creditos,gastos,cajMovs,cajEstado,cashClosures,inventoryMovements,cart})'
      ));
    },
    toastText() { return String(this.run("document.getElementById('gToast').textContent") ?? ''); },
    seed() {
      this.run(`
        productos=[];ventas=[];clientes=[];creditos=[];gastos=[];cajMovs=[];cashClosures=[];inventoryMovements=[];cart=[];
        posPayM='efectivo'; posProc=false; pagoProc=false; pagoRevProc=false; gastoProc=false;
        cajMovProc=false; cajCloseProc=false; _naInventoryMoveBusy=false; _naSaleAnnulmentProc=false;
        invMovId=null; invMovT='entrada'; cliCredId=null; pagoCredId=null; imagenProducto=null; invEditId=null;
        cajMovTipo='egr';
        cajEstado={abierta:false,fondo:0,cajero:'',cajeroNombre:'',cajeroId:null,hora:'',hora24:'',fechaApertura:obtenerHoy(),cerrada:true,horaCierre:null,horaCierre24:null,sessionId:null,contado:null,esperado:null,diferencia:null};
      `);
    },
    seedData(arrayExpr, values) {
      this.run(`${arrayExpr}.push(...${JSON.stringify(values)})`);
    },
  };
}

export function json(sb, expr) {
  return JSON.parse(sb.run(`JSON.stringify(${expr})`));
}
