// sandbox.mjs — harness focalizado de FIX04 (worktree product/pos-improvements @ f5fbee1).
// Carga los scripts REALES del producto (byte a byte, orden de index.html) en node:vm.
// Basado en el patrón de fix02/fix03, independiente: añade inline-16 (winner real de
// guardarMovInv) y expone inventoryMovements en memoryState/seed para el ledger FIX04.
//
// Orden de carga: utils, inline-01..07, inline-10..12, inline-16. Los archivos omitidos
// (ticket modules 08/09/13/14/15, inline-17/18 V10 dormante, legacy-globals, app.js) no
// redefinen ninguna operación bajo prueba (confirmarVenta/anularV/guardarMovInv/guardarProd).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const POS_DIR = path.resolve(HERE, '..', '..', '..', '..', 'POS');

const LOAD_ORDER = [
  'js/core/utils.js',
  'js/legacy-inline/inline-01.js',
  'js/legacy-inline/inline-02.js',
  'js/legacy-inline/inline-03.js',
  'js/legacy-inline/inline-04.js',
  'js/legacy-inline/inline-05.js',
  'js/legacy-inline/inline-06.js',
  'js/legacy-inline/inline-07.js',
  'js/legacy-inline/inline-10.js',
  'js/legacy-inline/inline-11.js',
  'js/legacy-inline/inline-12.js',
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
    querySelector: () => null, querySelectorAll: () => [],
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
    querySelectorAll: () => [],
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
    navigator: { userAgent: 'POS-FIX04-Harness/1.0' },
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
  `, ctx, { filename: 'fix04-bootstrap.js' });

  return {
    ctx,
    stores: { localStorage, sessionStorage },
    run(code) {
      return vm.runInContext(code, ctx, { filename: 'fix04-harness.js' });
    },
    el(id) {
      return this.run(`document.getElementById(${JSON.stringify(id)})`);
    },
    memoryState() {
      return JSON.parse(this.run(
        'JSON.stringify({productos,ventas,clientes,creditos,gastos,cajMovs,cajEstado,cashClosures,inventoryMovements,cart})'
      ));
    },
    durableRaw() {
      return this.run('storage.readPersistent(_NA_LOCAL_KEY)');
    },
    durableSnapshot() {
      const raw = this.durableRaw();
      return raw ? JSON.parse(raw) : null;
    },
    breakPersistent() { localStorage.break_(); },
    restorePersistent() { localStorage.restore(); },
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
