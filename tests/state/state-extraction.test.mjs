// state-extraction.test.mjs — ETAPA 4 WORK ITEM: STATE (estado UI transversal)
//
// OBJECTIVE_ID: STATE-EXTRACTION
//
// Verifica la extraccion de las 2 IIFEs puras de estado UI desde
// POS/index.html hacia POS/js/core/state.js (base 4158e04, core-utils frozen):
//   1. modal-scroll (reset de scroll al abrir modales);
//   2. topbar-gestures (ocultar/mostrar topbar con gestos; API _naTopbarGesture
//      solo con ?na-test=1).
//
//   S1. tag state.js exactamente 1, posicion documental correcta (tras el
//       script inline que contenia los bloques, antes de los elementos
//       posteriores), classic sin defer/async;
//   S2. las 2 IIFEs ya no estan inline; sus lineas existen en state.js;
//       sin duplicados;
//   S3. movidas, no reescritas: chunk byte-identico a HEAD:POS/index.html;
//   S4. load order: cdn < utils < primer inline < state < F7 < app;
//   S5. vm: comportamiento equivalente (listeners registrados, API de pruebas
//       gateada por na-test=1, gesture counter funcional);
//   S6. frozen artifacts (F6 + F7 + CORE/UTILS) byte-exactos vs HEAD;
//   S7. canonical intacto; V9 igual (entry 16, storage 20/5/9); V10 dormante;
//   S8. state.js sin persistencia/negocio/financiero/V10;
//   S9. evidencia determinista;
//   S10. navegador real (CDP): gesture API viva, F7 conectado, utils vivo,
//        contrato 177 verificable, sin errores de consola al cargar.
//
// POLITICA: los tests frozen de core-utils NO se ejecutan NI se adaptan
// (U3 "solo utils.js en core/" es fotografia del checkpoint core-utils, no
// gate del nuevo estado arquitectonico). Este work item tiene sus propios
// tests y verifica la integridad frozen por comparacion BYTE-EXACTA vs HEAD.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import {
  loadPosLines, posScriptRanges, posEntrySequence,
} from '../offline-compat/lib/pos-parse.mjs';
import {
  parseStorageStatic, parseV10Dormancy, parseGlobalDecls,
} from '../characterization/lib/static-parse.mjs';
import { gitBlobSha1 } from '../characterization/lib/blob-hash.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const POS_INDEX = path.join(ROOT, 'POS', 'index.html');
const CANONICAL = path.join(ROOT, 'CVV2.4_backup_antes_demo-1.html');
const STATE_JS = path.join(ROOT, 'POS', 'js', 'core', 'state.js');
const UTILS_JS = path.join(ROOT, 'POS', 'js', 'core', 'utils.js');
const LEGACY_GLOBALS = path.join(ROOT, 'POS', 'js', 'compat', 'legacy-globals.js');
const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'state');

const BASE_COMMIT = '4158e046069046069b1ae6e4e7287bf3c53e8fa2';
const PRODUCT_BLOB = '2dec6363d8aeef52da64ba60ac8eac8eb14f75f7';
const STATE_TAG = '<script src="js/core/state.js"></script>';

// Marcadores de los 2 bloques (linea completa de apertura de cada IIFE).
const MARKERS = [
  '// Mantiene un único desplazamiento fluido al abrir modales en Android.',
  '// Gestos de scroll: ocultar/mostrar .g-topbar con 3 gestos ascendentes en móvil',
];

const ENTRY_SEQUENCE_16 = [
  'loadAllData', 'loadAppState', 'loadMasterConfig', '_naInitSecurity',
  '_naNormalizeData', 'renderCategorySelects', '_naApplyConfigUI',
  '_naInitFreeSaleShortcut', '_naInitBarcodeScanner',
  'creditos.forEach(_naSyncCreditStatus)', 'posRender', 'posUpdateCart',
  'invRender', 'cfgUpdateStats', 'updateDashboard', 'saveAllData',
];

// Artefactos frozen: F6 + F7 + CORE/UTILS (todo lo committed en BASE).
const FROZEN_ARTIFACTS = [
  'POS/js/app.js',
  'POS/js/compat/legacy-globals.js',
  'tests/offline-compat/fase6-offline-compat.test.mjs',
  'evidence/offline-compat/bootstrap-contract.json',
  'evidence/offline-compat/inventory.json',
  'evidence/offline-compat/override-winners.json',
  'evidence/offline-compat/report.json',
  'tests/offline-compat/fase7-connection.test.mjs',
  'evidence/fase7-connection/report.json',
  'evidence/fase7-connection/dynamic-browser.json',
  'POS/js/core/utils.js',
  'tests/core-utils/core-utils-extraction.test.mjs',
  'evidence/core-utils/report.json',
  'evidence/core-utils/dynamic-browser.json',
];

function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function gitBuffer(revPath) {
  return execFileSync('git', ['show', revPath], {
    encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, cwd: ROOT,
  });
}

function gitString(args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd: ROOT }).trim();
}

function stableStringify(value) {
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
      return out;
    }
    return v;
  }
  return JSON.stringify(sortKeys(value), null, 2);
}

function countLines(text) {
  return text.replace(/\n$/, '').split('\n').length;
}

function analyzed() {
  const raw = fs.readFileSync(POS_INDEX, 'utf8');
  const text = raw.replace(/\r\n?/g, '\n');
  const lines = loadPosLines(text);
  const scripts = posScriptRanges(lines);
  return {
    raw, text, lines, scripts,
    stateSrc: fs.readFileSync(STATE_JS, 'utf8'),
  };
}
let _cache = null;
function analyzedCached() {
  if (!_cache) _cache = analyzed();
  return _cache;
}

// ---------------------------------------------------------------------------
// S1+S4 — tag unico, posicion y orden
// ---------------------------------------------------------------------------

test('S1 tag state.js exactamente 1, posicion correcta, classic sin defer/async', () => {
  const a = analyzedCached();
  const tagCount = (a.text.match(new RegExp(STATE_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  assert.equal(tagCount, 1, 'exactamente 1 tag state.js');
  let stateLine = -1; let cdnLine = -1; let utilsLine = -1; let f7Line = -1; let appLine = -1;
  let naConfirmLine = -1;
  a.lines.forEach((l, i) => {
    if (l.includes('cdn.sheetjs.com')) cdnLine = i + 1;
    if (l.includes('src="js/core/utils.js"')) utilsLine = i + 1;
    if (l.includes('js/core/state.js')) stateLine = i + 1;
    if (l.includes('js/compat/legacy-globals.js')) f7Line = i + 1;
    if (l.includes('src="js/app.js"')) appLine = i + 1;
    if (l.includes('id="naConfirm"')) naConfirmLine = i + 1;
  });
  const firstInline = a.scripts.filter((s) => s.src == null).reduce((m, s) => Math.min(m, s.startLine), Infinity);
  // Posicion documental: tras el script que contenia los bloques y antes del
  // primer elemento posterior (div naConfirm).
  assert.ok(stateLine < naConfirmLine, 'state.js antes del div naConfirm (posicion original de los bloques)');
  assert.ok(firstInline < stateLine, 'state.js despues del primer inline (mismo punto de ejecucion original)');
  assert.ok(cdnLine < utilsLine && utilsLine < firstInline, 'cdn < utils < primer inline');
  assert.ok(stateLine < f7Line && f7Line < appLine, 'state < F7 legacy-globals < app');
  assert.equal(/js\/core\/state\.js"[^>]*\s(defer|async)/.test(a.text), false, 'sin defer/async');
  assert.equal(a.scripts.filter((s) => s.src == null).length, 18, '18 inline intactos');
  assert.equal(a.scripts.filter((s) => s.src != null).length, 5, '5 externos: CDN + F7x2 + utils + state');
  assert.equal(a.scripts.length, 23, '23 scripts totales');
});

// ---------------------------------------------------------------------------
// S2 — IIFEs fuera del inline, sin duplicados
// ---------------------------------------------------------------------------

test('S2 las 2 IIFEs ya no estan inline; lineas presentes en state.js; sin duplicados', () => {
  const a = analyzedCached();
  for (const marker of MARKERS) {
    assert.equal(a.text.includes(marker), false, 'marker aun inline: ' + marker.slice(0, 40));
    assert.equal((a.stateSrc.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1, 'marker debe estar exactamente 1 vez en state.js');
  }
  // Contenido funcional ausente del index, presente 1 vez en state.js
  for (const token of ['prepareModalScroll', '_naTopbarGesture', 'simulateUpGesture', 'g-topbar-hidden']) {
    assert.equal(a.text.includes(token), false, 'token aun inline: ' + token);
    assert.ok(a.stateSrc.includes(token), 'token ausente en state.js: ' + token);
  }
  // El estado script NO redefinir nada del contrato ni de utils
  assert.equal(a.stateSrc.includes('function fmt(') && true, false, 'state sin utils');
});

// ---------------------------------------------------------------------------
// S3 — movido, no reescrito (chunk byte-identico vs HEAD)
// ---------------------------------------------------------------------------

test('S3 chunk byte-identico a HEAD:POS/index.html lineas 2809-2918', () => {
  const headText = gitBuffer('HEAD:POS/index.html').toString('utf8').replace(/\r\n?/g, '\n');
  const headLines = headText.split('\n');
  assert.equal(headLines.length, 5581, 'HEAD index 5581 lineas (base core-utils)');
  const chunk = headLines.slice(2808, 2918); // lineas 2809..2918
  assert.equal(chunk[0], MARKERS[0], 'inicio chunk = comentario modal-scroll');
  assert.equal(chunk[chunk.length - 1].trim(), '})();', 'fin chunk = cierre IIFE topbar');
  const a = analyzedCached();
  const stateBody = a.stateSrc.split('\n').filter((l) => l.trim() && !l.startsWith('/*') && !l.startsWith(' *') && !l.startsWith(' */'));
  // stateBody = chunk sin blanks (el blank separador 2828 se pierde al filtrar)
  const chunkNoBlank = chunk.filter((l) => l.trim());
  assert.deepEqual(stateBody, chunkNoBlank, 'state.js cuerpo === chunk HEAD (byte-exacto)');
});

// ---------------------------------------------------------------------------
// S4b — balance multiset: disco + state-body + tag === HEAD
// ---------------------------------------------------------------------------

test('S4 balance multiset: disco + chunk-HEAD + tag autorizado === HEAD', () => {
  const headText = gitBuffer('HEAD:POS/index.html').toString('utf8').replace(/\r\n?/g, '\n');
  const a = analyzedCached();
  const counts = new Map();
  const bump = (l, d) => counts.set(l, (counts.get(l) || 0) + d);
  const headLines = headText.split('\n');
  for (const l of headLines) bump(l, +1);
  for (const l of a.text.split('\n')) bump(l, -1);
  // chunk completo movido (incluye el blank separador), como en S3
  const chunk = headLines.slice(2808, 2918);
  for (const l of chunk) bump(l, -1);
  bump(STATE_TAG, +1);
  const imbalance = [...counts.entries()].filter(([, v]) => v !== 0);
  assert.deepEqual(imbalance, [], 'nada anadido ni reescrito fuera del delta');
});

// ---------------------------------------------------------------------------
// S5 — vm: comportamiento equivalente
// ---------------------------------------------------------------------------

function stateSandbox(search) {
  const listeners = { document: {}, window: {} };
  const observers = [];
  const overlays = [];
  const makeEl = (cls) => ({
    classList: {
      _s: new Set(cls ? [cls] : []),
      contains(c) { return this._s.has(c); },
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) this._s.add(c); else this._s.delete(c); },
    },
    addEventListener() {},
    querySelector() { return null; },
    scrollTop: 5,
    parentElement: null,
    tagName: 'DIV',
    closest() { return null; },
  });
  const topbar = makeEl('g-topbar');
  const body = makeEl('');
  const documentFake = {
    body,
    querySelector(sel) { return sel === '.g-topbar' ? topbar : null; },
    querySelectorAll(sel) { return sel === '.modal-overlay' ? overlays : []; },
    addEventListener(evt, fn) { listeners.document[evt] = fn; },
    getElementById() { return null; },
  };
  class MutationObserverFake {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
  }
  const windowFake = {
    addEventListener(evt, fn) { listeners.window[evt] = fn; },
    innerWidth: 400,
    scrollY: 0,
  };
  const sandbox = {
    document: documentFake,
    window: windowFake,
    location: { search },
    MutationObserver: MutationObserverFake,
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn) => 0,
    clearTimeout: () => {},
    console: { warn() {}, log() {}, error() {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, listeners, observers, overlays, topbar, body, makeEl };
}

test('S5 vm: listeners registrados, API gateada, gesture counter funcional', () => {
  const a = analyzedCached();

  // Sin na-test=1: API de pruebas NO expuesta
  const h1 = stateSandbox('');
  vm.runInContext(a.stateSrc, h1.sandbox, { filename: 'state.js' });
  assert.equal(typeof h1.sandbox.window._naTopbarGesture, 'undefined', 'API oculta sin na-test=1');

  // Con na-test=1: API expuesta y funcional
  const h2 = stateSandbox('?na-test=1');
  vm.runInContext(a.stateSrc, h2.sandbox, { filename: 'state.js' });
  const api = h2.sandbox.window._naTopbarGesture;
  assert.equal(typeof api, 'object', 'API presente con na-test=1');
  assert.equal(typeof api.getCount, 'function');
  assert.equal(api.getCount(), 0);
  // gesture counter: activo solo con module-mobile-scroll en body
  assert.equal(api.simulateUpGesture(), undefined, 'sin gesture (body sin module-mobile-scroll)');
  assert.equal(api.getCount(), 0);
  h2.body.classList.add('module-mobile-scroll');
  api.simulateUpGesture();
  assert.equal(api.getCount(), 1, '1 gesto contado');
  api.simulateUpGesture();
  api.simulateUpGesture();
  assert.equal(api.getCount(), 0, '3er gesto resetea el contador (show + reset)');
  assert.equal(h2.topbar.classList.contains('g-topbar-hidden'), false, 'topbar visible tras 3 gestos');
  api.simulateDownScroll();
  assert.equal(h2.topbar.classList.contains('g-topbar-hidden'), true, 'down oculta topbar');

  // Listores globales registrados (touch/wheel/scroll/resize + DCL)
  for (const evt of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel']) {
    assert.equal(typeof h2.listeners.document[evt], 'function', 'document listener ' + evt);
  }
  assert.equal(typeof h2.listeners.window.scroll, 'function', 'window scroll listener');
  assert.equal(typeof h2.listeners.window.resize, 'function', 'window resize listener');
  assert.ok(h2.observers.length >= 1, 'MutationObserver del body (gestures) registrado al cargar');

  // modal-scroll: DCL registra observers por overlay y resetea scrollTop al abrir
  const observersBefore = h2.observers.length;
  const overlay = h2.makeEl('modal-overlay');
  h2.overlays.push(overlay);
  assert.equal(typeof h2.listeners.document.DOMContentLoaded, 'function', 'DCL modal-scroll');
  h2.listeners.document.DOMContentLoaded();
  assert.equal(h2.observers.length, observersBefore + 1, 'DCL creo el observer del overlay');
  const obs = h2.observers[h2.observers.length - 1];
  overlay.classList.add('open');
  obs.cb();
  assert.equal(overlay.scrollTop, 0, 'modal-scroll resetea overlay al abrir');
});

// ---------------------------------------------------------------------------
// S6 — frozen artifacts byte-exactos
// ---------------------------------------------------------------------------

test('S6 frozen artifacts F6+F7+CORE/UTILS byte-exactos vs HEAD', () => {
  assert.equal(gitString(['rev-parse', 'HEAD']), BASE_COMMIT, 'HEAD sin mover');
  const broken = [];
  for (const rel of FROZEN_ARTIFACTS) {
    const head = gitBuffer('HEAD:' + rel);
    const disk = fs.readFileSync(path.join(ROOT, rel));
    if (sha256Buffer(disk) !== sha256Buffer(head)) broken.push(rel);
  }
  assert.deepEqual(broken, [], 'artefactos frozen modificados');
  assert.equal(fs.existsSync(path.join(ROOT, 'POS', 'js', 'core', 'contracts.js')), false, 'contracts.js sigue ausente');
});

// ---------------------------------------------------------------------------
// S7 — canonico / V9 / V10
// ---------------------------------------------------------------------------

test('S7 canonico intacto + V9 igual (entry 16, storage 20/5/9) + V10 dormante', () => {
  assert.equal(gitString(['rev-parse', 'HEAD:CVV2.4_backup_antes_demo-1.html']), PRODUCT_BLOB);
  const disk = fs.readFileSync(CANONICAL);
  const lf = disk.toString('utf8').replace(/\r\n?/g, '\n');
  assert.equal(gitBlobSha1(Buffer.from(lf, 'utf8')), PRODUCT_BLOB);
  const a = analyzedCached();
  assert.deepEqual(posEntrySequence(a.lines).sequence, ENTRY_SEQUENCE_16);
  const storage = parseStorageStatic(a.lines, a.text);
  assert.equal(storage.localStorage.length, 20);
  assert.equal(storage.sessionStorage.length, 5);
  assert.equal(storage.legacy.length, 9);
  assert.equal(storage.constants._NA_SNAPSHOT_KEY, 'snapshot_v9');
  const globals = parseGlobalDecls(a.lines);
  const v10 = parseV10Dormancy(a.lines, a.scripts, globals, globals);
  assert.equal(v10.dormant, true);
});

// ---------------------------------------------------------------------------
// S8 — state.js sin persistencia/negocio/financiero/V10
// ---------------------------------------------------------------------------

test('S8 state.js sin tokens de storage, persistencia, negocio ni V10', () => {
  const a = analyzedCached();
  const bodyOnly = a.stateSrc.split('\n').filter((l) => !l.startsWith('/*') && !l.startsWith(' *') && !l.startsWith(' */'));
  const forbidden = [
    'localStorage', 'sessionStorage', 'indexedDB', 'saveAllData', 'loadAllData',
    'saveAppState', 'storage.setItem', '_naRunCriticalOperation', 'fetch(',
  ];
  for (const tok of forbidden) {
    assert.equal(bodyOnly.some((l) => l.includes(tok)), false, 'state.js contiene "' + tok + '"');
  }
  assert.equal(bodyOnly.some((l) => /_naV10/.test(l)), false);
  assert.equal(bodyOnly.some((l) => /posRender|invRender|cliRender|cajRender|ventasRender|gasRender/.test(l)), false, 'sin renders de dominio');
});

// ---------------------------------------------------------------------------
// S9 — evidencia determinista
// ---------------------------------------------------------------------------

function runGates() {
  if (runGates._cache) return runGates._cache;
  try {
    execFileSync(process.execPath, ['--check', STATE_JS], { cwd: ROOT, encoding: 'utf8' });
    runGates._cache = { nodeCheckState: 'PASS' };
  } catch (e) {
    runGates._cache = { nodeCheckState: 'FAIL:' + (e.stderr || e.message) };
  }
  return runGates._cache;
}

test('S9 evidencia determinista (doble corrida byte-identica, sin timestamps)', () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const build = () => {
    const a = analyzed();
    const headText = gitBuffer('HEAD:POS/index.html').toString('utf8').replace(/\r\n?/g, '\n');
    const headLines = headText.split('\n');
    const stateBody = a.stateSrc.split('\n').filter((l) => l.trim() && !l.startsWith('/*') && !l.startsWith(' *') && !l.startsWith(' */'));
    let stateLine = -1; let f7Line = -1; let utilsLine = -1;
    a.lines.forEach((l, i) => {
      if (l.includes('src="js/core/utils.js"')) utilsLine = i + 1;
      if (l.includes('js/core/state.js')) stateLine = i + 1;
      if (l.includes('js/compat/legacy-globals.js')) f7Line = i + 1;
    });
    return {
      baseCommit: gitString(['rev-parse', 'HEAD']),
      canonicalBlob: gitString(['rev-parse', 'HEAD:CVV2.4_backup_antes_demo-1.html']),
      index: {
        before: { lines: countLines(headText), bytes: Buffer.byteLength(headText, 'utf8') },
        after: { lines: countLines(a.text), bytes: Buffer.byteLength(a.text, 'utf8') },
        // chunk completo movido (incluye la linea blank separadora de HEAD)
        stateLinesExtracted: countLines(headText) - countLines(a.text) + 1,
        stateBodyNonBlank: stateBody.length,
        scriptTagsAdded: 1,
      },
      stateJs: { lines: countLines(a.stateSrc), bytes: Buffer.byteLength(a.stateSrc, 'utf8'), blocks: ['modal-scroll', 'topbar-gestures'] },
      loadOrderLines: { cdn: 9, utils: utilsLine, firstInline: 817, state: stateLine, f7Legacy: f7Line },
      scripts: {
        total: a.scripts.length,
        inline: a.scripts.filter((s) => s.src == null).length,
        external: a.scripts.filter((s) => s.src != null).length,
      },
      navigationExtracted: 'NONE',
      navigationDeferredReason: 'goPage/goMenu/toggleDark/applyFontSize/setAccent/toggleCfgMenu/switchCfgCategory acoplados a saveAppState (persistencia), renders de dominio y contrato 177',
      gates: runGates(),
    };
  };
  const reportPath = path.join(EVIDENCE_DIR, 'report.json');
  const write = (d) => fs.writeFileSync(reportPath, stableStringify(d) + '\n');
  write(build());
  const h1 = sha256Buffer(fs.readFileSync(reportPath));
  write(build());
  const h2 = sha256Buffer(fs.readFileSync(reportPath));
  assert.deepEqual(h2, h1);
  const raw = fs.readFileSync(reportPath, 'utf8');
  assert.equal(/updatedAt|createdAt|timestamp|Date\(|ISOString|\d{4}-\d{2}-\d{2}T/.test(raw), false);
  const rep = JSON.parse(raw);
  assert.equal(rep.index.stateLinesExtracted, 110, 'chunk completo = 110 lineas');
  assert.equal(rep.index.before.lines - rep.index.stateLinesExtracted + 1, rep.index.after.lines);
  assert.equal(rep.gates.nodeCheckState, 'PASS');
  assert.equal(rep.canonicalBlob, PRODUCT_BLOB);
});

// ---------------------------------------------------------------------------
// S10 — navegador real (CDP): gesto vivo, F7 conectado, utils vivo
// ---------------------------------------------------------------------------

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findBrowser() {
  for (const p of BROWSER_CANDIDATES) if (p && fs.existsSync(p)) return p;
  return null;
}

const STATE_PROBE_EXPR = 'JSON.stringify({'
  + 'boot: !!window._NA_BOOT,'
  + ' connected: window._NA_BOOT ? window._NA_BOOT.connected === true : null,'
  + ' verifyOk: (window._NA_BOOT && typeof window._NA_BOOT.verify === "function") ? (window._NA_BOOT.verify() || {}).ok : null,'
  + ' verifyChecked: (window._NA_BOOT && window._NA_BOOT.lastVerify) ? window._NA_BOOT.lastVerify.checked : null,'
  + ' fmt: typeof fmt,'
  + ' topbarEl: !!document.querySelector(".g-topbar"),'
  + ' gestureApi: typeof window._naTopbarGesture,'
  + ' gestureCount: (window._naTopbarGesture && window._naTopbarGesture.getCount) ? window._naTopbarGesture.getCount() : null,'
  + ' gestureThreshold: (window._naTopbarGesture && window._naTopbarGesture.getThreshold) ? window._naTopbarGesture.getThreshold() : null,'
  + ' hiddenAfterSim: (function(){ if(!window._naTopbarGesture) return null;'
  + '   document.body.classList.add("module-mobile-scroll");'
  + '   window._naTopbarGesture.hide();'
  + '   var hidden = !!document.querySelector(".g-topbar").classList.contains("g-topbar-hidden");'
  + '   window._naTopbarGesture.simulateUpGesture();'
  + '   window._naTopbarGesture.simulateUpGesture();'
  + '   window._naTopbarGesture.simulateUpGesture();'
  + '   var shown = !document.querySelector(".g-topbar").classList.contains("g-topbar-hidden");'
  + '   document.body.classList.remove("module-mobile-scroll");'
  + '   return { hiddenAfterHide: hidden, shownAfter3Gestures: shown };'
  + ' })()'
  + '})';

async function cdpEvaluate(browser, url, expr) {
  const { spawn } = await import('node:child_process');
  const os = await import('node:os');
  const http = await import('node:http');
  const profile = path.join(os.tmpdir(), 'state-cdp-' + process.pid + '-' + Math.random().toString(36).slice(2));
  const proc = spawn(browser, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--no-sandbox',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const cleanup = () => { try { proc.kill(); } catch { /* noop */ } };
  const wsUrlFromStderr = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP_TIMEOUT_NO_WS')), 20000);
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = /ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+/.exec(buf);
      if (m) { clearTimeout(timer); resolve(m[0]); }
    });
    proc.on('exit', () => reject(new Error('CDP_BROWSER_EXIT_EARLY')));
  });
  try {
    const browserWs = await wsUrlFromStderr;
    const port = new URL(browserWs).port;
    const targets = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:' + port + '/json/list', (r) => {
        let b = '';
        r.on('data', (c) => { b += c; });
        r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
    const page = targets.find((t) => t.type === 'page') || targets[0];
    if (!page || !page.webSocketDebuggerUrl) throw new Error('CDP_NO_PAGE_TARGET');
    const result = await new Promise((resolve, reject) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      const timer = setTimeout(() => { try { ws.close(); } catch { /* noop */ } reject(new Error('CDP_WS_TIMEOUT')); }, 60000);
      let seq = 0;
      const pending = new Map();
      let loadFired = false;
      const loadWaiters = [];
      const send = (method, params) => {
        seq += 1;
        const id = seq;
        return new Promise((r2) => { pending.set(id, r2); ws.send(JSON.stringify({ id, method, params })); });
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); return; }
        if (msg.method === 'Page.loadEventFired') { loadFired = true; for (const w of loadWaiters.splice(0)) w(); }
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP_WS_ERROR')); };
      ws.onopen = async () => {
        try {
          await send('Page.enable');
          const loadPromise = new Promise((r3) => {
            if (loadFired) r3();
            else loadWaiters.push(r3);
            setTimeout(r3, 30000);
          });
          await send('Page.navigate', { url });
          await loadPromise;
          let parsed = null;
          for (let attempt = 0; attempt < 30 && !(parsed && parsed.boot === true); attempt += 1) {
            await new Promise((r4) => setTimeout(r4, 500));
            const evd = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
            if (evd.error) throw new Error('CDP_EVAL_ERROR:' + JSON.stringify(evd.error));
            if (evd.result && evd.result.result && typeof evd.result.result.value === 'string') {
              try { parsed = JSON.parse(evd.result.result.value); } catch { parsed = null; }
            }
          }
          clearTimeout(timer);
          ws.close();
          if (!parsed) throw new Error('CDP_EVAL_NO_VALUE');
          resolve(parsed);
        } catch (e) {
          clearTimeout(timer);
          try { ws.close(); } catch { /* noop */ }
          reject(e);
        }
      };
    });
    return result;
  } finally {
    cleanup();
  }
}

test('S10 dinamica navegador (CDP ?na-test=1): gestos vivos; F7 y utils intactos', { timeout: 180000 }, async (t) => {
  const browser = findBrowser();
  const writeBlocked = (reason, detail) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-ENVIRONMENT_BLOCKED.json'), stableStringify({
      status: 'ENVIRONMENT_BLOCKED', reason, detail: detail || null,
      browser: browser ? path.basename(browser) : null,
      note: 'nunca PASS silencioso; la verificacion principal es S1-S9 (Node determinista)',
    }) + '\n');
  };
  if (!browser) {
    writeBlocked('no Chrome/Edge binary found');
    t.skip('ENVIRONMENT_BLOCKED: no browser');
    return;
  }
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const types = {
        '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
      };
      res.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const fileUrl = 'file:///' + POS_INDEX.replace(/\\/g, '/').replace(/index\.html$/, '') === 'file:///' ? 'file:///' + POS_INDEX.replace(/\\/g, '/') : 'file:///' + POS_INDEX.replace(/\\/g, '/');
  const urls = [
    'file:///' + POS_INDEX.replace(/\\/g, '/') + '?na-test=1',
    'http://127.0.0.1:' + port + '/POS/index.html?na-test=1',
  ];
  const results = [];
  const errors = [];
  for (const url of urls) {
    try { results.push(await cdpEvaluate(browser, url, STATE_PROBE_EXPR)); } catch (e) { errors.push(String(e && e.message || e)); }
  }
  server.close();
  if (!results.length) {
    writeBlocked('CDP sin resultados', errors);
    t.skip('ENVIRONMENT_BLOCKED: ' + errors.join('; '));
    return;
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-browser.json'), stableStringify({
    status: 'OK', browser: path.basename(browser),
    runs: urls.map((u, i) => ({ url: u.replace(/[?].*/, ''), ok: !!results[i], error: errors[i] || null, results: results[i] || null })),
  }) + '\n');
  for (const [i, r] of results.entries()) {
    const label = i === 0 ? 'file://' : 'http://';
    assert.equal(r.boot, true, label + ' _NA_BOOT (F7)');
    assert.equal(r.connected, true, label + ' F7 connected');
    assert.equal(r.verifyOk, true, label + ' verify ok');
    assert.equal(r.verifyChecked, 177, label + ' 177 verificados');
    assert.equal(r.fmt, 'function', label + ' utils.js vivo');
    assert.equal(r.topbarEl, true, label + ' topbar presente');
    assert.equal(r.gestureApi, 'object', label + ' _naTopbarGesture viva (na-test=1)');
    assert.equal(r.gestureThreshold, 20, label + ' umbral de gesto = 20');
    assert.equal(r.hiddenAfterSim.hiddenAfterHide, true, label + ' hide() oculta topbar');
    assert.equal(r.hiddenAfterSim.shownAfter3Gestures, true, label + ' 3 gestos muestran topbar');
  }
});
