// sandbox.mjs — harness focalizado que carga el PRODUCTO REAL (sin modificarlo)
// dentro de un contexto node:vm con stubs de navegador, y expone helpers para
// ejercitar los winners reales (guardarCred, guardarMovInv, confirmarVenta,
// confirmarPago, anularV, guardarMovCaja, guardarGasto) y su persistencia V9.
//
// Reglas del harness:
//  - Los archivos del producto se ejecutan byte a byte, en el orden de index.html.
//  - El conjunto de carga omite únicamente archivos que NO redefinen ninguna
//    operación bajo prueba (los gates estáticos lo demuestran por scan):
//      * ticket legacy/overrides, inline-05/06/08..15 → wrappers solo de RENDER/UI.
//      * inline-17/18 → núcleo V10 DORMANTE (se prueba aparte en gate8).
//      * legacy-globals.js / app.js → registro compat + bootstrap UI.
//  - No se parchea ninguna operación de negocio; las únicas sustituciones son
//    saveAllData (para congelar una promesa en el test de doble ejecución) y
//    siempre se restauran dentro del mismo test.
//
// OBJECTIVE_ID: RELEASE-INVARIANTS-PACK (ETAPA 5)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { POS_DIR } from './product.mjs';

// Orden de carga real del producto (subset seguro; ver comentario de cabecera).
export const SANDBOX_LOAD_ORDER = [
  'js/core/utils.js',
  'js/legacy-inline/inline-01.js',
  'js/legacy-inline/inline-02.js',
  'js/legacy-inline/inline-03.js',
  'js/legacy-inline/inline-04.js',
  'js/legacy-inline/inline-05.js',
  'js/legacy-inline/inline-06.js',
  'js/legacy-inline/inline-07.js',
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
    max: '', placeholder: '', files: [], style: {}, dataset: {},
    // Selects: iterables vacíos (renderCategorySelects itera prodSel.options).
    options: [], selectedOptions: [], selectedIndex: -1,
    classList: makeClassList(),
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    insertAdjacentHTML() {}, appendChild() {}, removeChild() {}, remove() {},
    add() {}, insertBefore() {},
    focus() {}, blur() {}, click() {}, select() {}, scrollTo() {},
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, contains: () => false,
  };
}

/**
 * Crea un "tab" del POS: contexto vm con el producto real cargado.
 * @param {{stores?:{localStorage?:object,sessionStorage?:object}}=} opts
 *        stores permite compartir almacenamiento entre dos sandboxes (multi-tab).
 */
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
    navigator: { userAgent: 'POS-Release-Invariants-Harness/1.0' },
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

  for (const rel of SANDBOX_LOAD_ORDER) {
    const code = readFileSync(path.join(POS_DIR, rel), 'utf8');
    new vm.Script(code, { filename: `POS/${rel}` }).runInContext(ctx);
  }

  // Ajustes post-carga SOLO del lado del harness (paths soportados por el producto):
  //  - alertsEnabled=false → _naConfirmAction resuelve true sin UI (path real del producto).
  //  - printAuto=false → la venta no entra al flujo de ticket.
  vm.runInContext(`
    appConfig.alertsEnabled = false;
    appConfig.printAuto = false;
    _naSecurity.pinEnabled = false;
    _naSecurity.logs = [];
    _naEnsureCashierConfig();
    appConfig.activeCashierId = 'CAJ-001';
    appConfig.creditPolicy = Object.assign({}, _naCreditPolicy(), { enabled: true });
  `, ctx, { filename: 'release-invariants-bootstrap.js' });

  const sb = {
    ctx,
    stores: { localStorage, sessionStorage },

    /** Ejecuta código en el contexto del producto (mismo ámbito léxico global). */
    run(code) {
      return vm.runInContext(code, ctx, { filename: 'release-invariants-harness.js' });
    },

    /** Elemento stub por id (el mismo objeto que devuelve document.getElementById). */
    el(id) {
      return this.run(`document.getElementById(${JSON.stringify(id)})`);
    },

    /** Estado de memoria completo (serializado dentro del contexto). */
    memoryState() {
      return JSON.parse(this.run(
        'JSON.stringify({productos,ventas,clientes,creditos,gastos,cajMovs,cajEstado,cart})'
      ));
    },

    /** JSON crudo del snapshot durable (localStorage V9) o null. */
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

    /**
     * Siembra estado base determinista: caja abierta (CAJ-001 admin), arrays vacíos,
     * flags de proceso en false. Los tests agregan sus entidades con sb.seedData().
     */
    seed() {
      this.run(`
        productos=[];ventas=[];clientes=[];creditos=[];gastos=[];cajMovs=[];cart=[];
        posPayM='efectivo'; posProc=false; pagoProc=false; gastoProc=false;
        cajMovProc=false; cajCloseProc=false;
        invMovId=null; invMovT='entrada'; cliCredId=null; pagoCredId=null; imagenProducto=null;
        cajMovTipo='egr';
        cajEstado={abierta:true,cerrada:false,fondo:100,cajero:'Cajero 1',cajeroNombre:'Cajero 1',
          cajeroId:'CAJ-001',fechaApertura:obtenerHoy(),timestampApertura:new Date().toISOString(),
          sessionId:1700000000000,hora:nowT(),hora24:_naTime24(new Date()),horaCierre:null,
          contado:null,esperado:null,diferencia:null};
      `);
    },

    /** Inserta datos: sb.seedData('clientes', [obj,...]) usa JSON dentro del contexto. */
    seedData(arrayExpr, values) {
      this.run(`${arrayExpr}.push(...${JSON.stringify(values)})`);
    },
  };

  return sb;
}

/** Convierte un valor del contexto a JSON plano (para asserts desde Node). */
export function json(sb, expr) {
  return JSON.parse(sb.run(`JSON.stringify(${expr})`));
}
