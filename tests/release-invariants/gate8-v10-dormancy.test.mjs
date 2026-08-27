// GATE 8 — V10 DORMANCY
//
// Demuestra que el núcleo transaccional V10 permanece DORMANTE en el release:
//   - ningún camino activo de producto invoca _naV10* (scan completo);
//   - no existe inicialización automática V10 (cero listeners en inline-17/18);
//   - el startup no abre la DB V10 (proof runtime: indexedDB trampa que registra
//     cualquier intento de open durante la carga real de los scripts);
//   - inline-17/18 están cargados pero dormantes (las funciones existen, la DB
//     nunca se abre sola);
//   - V10 NO es requisito del release actual (los winners de los gates 2-7 viven
//     en archivos sin símbolos V10; ver nota en la evidencia).
//
// PASS = la caracterización refleja el comportamiento actual.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  POS_DIR, localScriptOrder, allProductJsFiles, readProductText, scanDefinitions,
} from './lib/product.mjs';
import { writeEvidence } from './lib/evidence.mjs';

const facts = { checks: [], runtime: {} };
function check(id, description, pass, detail = '') {
  facts.checks.push({ id, description, result: pass ? 'PASS' : 'FAIL', detail });
  assert.ok(pass, `${id}: ${description}${detail ? ` — ${detail}` : ''}`);
}

const V10_FILES = ['js/legacy-inline/inline-17.js', 'js/legacy-inline/inline-18.js'];
const NON_V10_FILES = allProductJsFiles().filter((f) => !V10_FILES.includes(f));
const WINNERS = ['guardarCred', 'guardarMovInv', 'confirmarVenta', 'confirmarPago', 'anularV', 'guardarMovCaja', 'guardarGasto', '_naPaymentState'];

test('G8.1 — Estático: ningún archivo fuera de inline-17/18 referencia símbolos _naV10*', () => {
  for (const rel of NON_V10_FILES) {
    check(`G8.1:${rel}`, 'sin referencias _naV10*', !/_naV10/.test(readProductText(rel)));
  }
  check('G8.1:index.html', 'index.html sin referencias _naV10*', !/_naV10/.test(readProductText('index.html')));
});

test('G8.2 — Estático: inline-17/18 cargados, sin listeners ni inicialización automática', () => {
  const order = localScriptOrder();
  const idx = (rel) => order.indexOf(rel);
  check('G8.2a', 'inline-17 e inline-18 están incluidos en el orden de carga',
    idx(V10_FILES[0]) > -1 && idx(V10_FILES[1]) > -1);
  check('G8.2b', 'carga ANTES de legacy-globals/app (registro compat posterior; sin auto-conexión)',
    idx(V10_FILES[1]) < idx('js/compat/legacy-globals.js') && idx('js/compat/legacy-globals.js') < idx('js/app.js'));
  for (const rel of V10_FILES) {
    const src = readProductText(rel);
    check(`G8.2:${rel}:listeners`, 'cero addEventListener (nada invoca V10 automáticamente)',
      !/addEventListener/.test(src));
    check(`G8.2:${rel}:domready`, 'cero DOMContentLoaded / handlers de carga',
      !/DOMContentLoaded/.test(src));
    check(`G8.2:${rel}:open`, 'sin llamada _naV10OpenDB a nivel de módulo (solo dentro de cuerpos de función)',
      !src.split(/\r?\n/).some((line) => /^\s*_naV10OpenDB\(/.test(line)));
  }
});

test('G8.3 — RUNTIME: cargar inline-17/18 reales NO abre la DB V10 (indexedDB trampa)', () => {
  const dbAttempts = [];
  const sandbox = {
    console,
    setTimeout, clearTimeout, queueMicrotask,
    structuredClone, TextEncoder, TextDecoder,
    performance: globalThis.performance,
    crypto: globalThis.crypto,
    navigator: { userAgent: 'POS-Release-Invariants-Harness/1.0' },
    location: { href: 'file:///POS/index.html', protocol: 'file:' },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    prompt: () => null, confirm: () => true, alert() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);

  // Constante que inline-17 hereda del script inline-02 en el navegador;
  // se replica EXACTA desde la fuente del producto (verificada abajo).
  const dbName = /const _NA_DB_NAME='([^']+)'/.exec(readProductText('js/legacy-inline/inline-02.js'))?.[1];
  check('G8.3:pre', 'valor de _NA_DB_NAME replicado byte-exacto desde inline-02', dbName === 'NuevoAmanecerPOS');
  vm.runInContext(`var _NA_DB_NAME=${JSON.stringify(dbName)};`, ctx);

  // TRAMPA: cualquier indexedDB.open durante la carga queda registrado y explota.
  vm.runInContext(`
    globalThis.__dbAttempts = [];
    globalThis.indexedDB = { open(name, version) { globalThis.__dbAttempts.push({ name, version }); throw new Error('V10_DB_OPEN_ATTEMPT_DURING_LOAD'); } };
  `, ctx);

  // utils.js precede a inline-17 en index.html; los módulos V10 lo consumen.
  for (const rel of ['js/core/utils.js', ...V10_FILES]) {
    const code = readFileSync(path.join(POS_DIR, rel), 'utf8');
    new vm.Script(code, { filename: `POS/${rel}` }).runInContext(ctx);
  }

  const attempts = vm.runInContext('globalThis.__dbAttempts', ctx);
  facts.runtime.dbOpenAttemptsDuringLoad = attempts.length;
  check('G8.3a', 'la carga real de inline-17/18 NO abre IndexedDB', attempts.length === 0);
  check('G8.3b', 'el estado V10 queda sin promesa de DB (_naV10DbPromise === null)',
    vm.runInContext('_naV10DbPromise', ctx) === null);
  check('G8.3c', 'las funciones V10 existen cargadas pero dormantes (disponibles, nunca invocadas)',
    vm.runInContext("typeof _naV10ConfirmSaleIntent", ctx) === 'function' &&
    vm.runInContext("typeof _naV10OpenDB", ctx) === 'function');
  check('G8.3d', 'no hay ningún commit/broadcast V10 en curso (_naV10LastBroadcast === null)',
    vm.runInContext('_naV10LastBroadcast', ctx) === null);
});

test('G8.4 — V10 no es requisito del release: los caminos activos no lo referencian', () => {
  const dirty = NON_V10_FILES.filter((rel) => /_naV10/.test(readProductText(rel)));
  check('G8.4a', 'todos los archivos del release activo (salvo 17/18) carecen de símbolos V10',
    dirty.length === 0, dirty.join(','));
  check('G8.4b', 'el núcleo de persistencia V9 (inline-02) opera sin V10',
    !/_naV10/.test(readProductText('js/legacy-inline/inline-02.js')));
  check('G8.4c', 'ningún winner de operación del release está definido dentro de inline-17/18',
    WINNERS.every((w) => V10_FILES.every((rel) => scanDefinitions(rel, w).length === 0)));
  facts.runtime.releaseFilesWithoutV10 = NON_V10_FILES.length;
});

after(() => {
  writeEvidence('gate8-v10-dormancy.json', {
    gate: 'GATE 8 — V10 DORMANCY',
    verdict: facts.checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL',
    conclusion: 'V10 cargado pero dormante; sin inicialización automática; sin apertura de DB; NO es requisito del release',
    ...facts,
  });
});
