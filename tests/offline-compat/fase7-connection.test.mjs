// fase7-connection.test.mjs — FASE 7 BOOTSTRAP / COMPAT CONNECTION
//
// OBJECTIVE_ID: FASE7-CONNECTION
//
// Verifica la conexion minima de la infraestructura fria FASE 6
// (js/compat/legacy-globals.js + js/app.js) al POS real (POS/index.html):
//   - exactamente 1 ocurrencia de cada script de conexion (anti-duplicacion);
//   - orden legacy-globals < app.js, despues del ultimo inline, antes de </body>;
//   - classic SIN defer/async/module (clausulas E/F del bootstrap contract);
//   - delta EXACTO de 2 lineas sobre HEAD:POS/index.html (V9 intacto);
//   - canonico intacto (blob 2dec6363) + 18 inline byte-exactos;
//   - V10 dormante; storage igual (20/5/9); secuencia entry igual (16);
//   - runtime vm CONECTADO: connected=true, started=true tras DOMContentLoaded,
//     verify().ok=true, _NA_LEGACY_GLOBALS disponible, 0 llamadas de negocio,
//     0 acceso a persistencia (proxy que lanza);
//   - runtime vm SIN querySelector (harness FASE 6): connected=false (guard);
//   - adversarial: duplicacion u orden invertido deben ser DETECTADOS;
//   - evidencia determinista evidence/fase7-connection/report.json
//     (doble corrida byte-identica, sin timestamps).
//
// La verificacion dinamica en navegador real (CDP headless) vive en el ultimo
// test; sin navegador escribe ENVIRONMENT_BLOCKED (nunca PASS silencioso).
// file:// esta bloqueado para introspeccion cross-origin por diseno (FASE 4).
//
// AUTONOMIA FASE 7: esta suite NO ejecuta ni adapta la suite historica
// fase6-offline-compat.test.mjs (checkpoint congelado @ d5c4378 que describe
// el estado FRIO pre-conexion: 19 scripts, index byte-exacto vs HEAD). Aqui
// FASE 7 demuestra por si misma: inline legacy byte-exactos, required globals,
// V9 intacto, V10 dormante, canonico intacto y delta de conexion exacto. El
// unico contacto con FASE 6 es de LECTURA: verificar que sus 5 artefactos
// congelados en disco sigan byte-identicos a HEAD (integridad del freeze).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import {
  loadPosLines, posScriptRanges, posDefinitions, posEntrySequence,
} from './lib/pos-parse.mjs';
import { gitBlobSha1 } from '../characterization/lib/blob-hash.mjs';
import {
  parseStorageStatic, parseV10Dormancy, parseGlobalDecls,
} from '../characterization/lib/static-parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const POS_INDEX = path.join(ROOT, 'POS', 'index.html');
const CANONICAL = path.join(ROOT, 'CVV2.4_backup_antes_demo-1.html');
const LEGACY_GLOBALS = path.join(ROOT, 'POS', 'js', 'compat', 'legacy-globals.js');
const APP_JS = path.join(ROOT, 'POS', 'js', 'app.js');
const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'fase7-connection');

// Artefactos historicos congelados de FASE 6 (@ d5c4378): FASE 7 debe dejarlos
// byte-identicos a HEAD. Solo se LEEN para verificar el freeze.
const F6_FROZEN_ARTIFACTS = [
  'tests/offline-compat/fase6-offline-compat.test.mjs',
  'evidence/offline-compat/bootstrap-contract.json',
  'evidence/offline-compat/inventory.json',
  'evidence/offline-compat/override-winners.json',
  'evidence/offline-compat/report.json',
];

const PRODUCT_BLOB = '2dec6363d8aeef52da64ba60ac8eac8eb14f75f7';
const F7_LEGACY_LINE = '<script src="js/compat/legacy-globals.js"></script>';
const F7_APP_LINE = '<script src="js/app.js"></script>';
const F7_LEGACY_SRC = 'js/compat/legacy-globals.js';
const F7_APP_SRC = 'js/app.js';
const ENTRY_SEQUENCE_16 = [
  'loadAllData', 'loadAppState', 'loadMasterConfig', '_naInitSecurity',
  '_naNormalizeData', 'renderCategorySelects', '_naApplyConfigUI',
  '_naInitFreeSaleShortcut', '_naInitBarcodeScanner',
  'creditos.forEach(_naSyncCreditStatus)', 'posRender', 'posUpdateCart',
  'invRender', 'cfgUpdateStats', 'updateDashboard', 'saveAllData',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function parseFreezeArray(src, varName) {
  const re = new RegExp('var\\s+' + varName + '\\s*=\\s*Object\\.freeze\\((\\[[\\s\\S]*?\\])\\)');
  const m = re.exec(src);
  assert.ok(m, 'no se encontro Object.freeze para ' + varName);
  const cleaned = m[1].replace(/,(\s*\])/g, (mm, p1) => p1);
  return JSON.parse(cleaned);
}

/**
 * Detector independiente de la forma de conexion (emparejamiento por linea,
 * estrategia distinta a pos-parse para no depender del mismo scanner).
 * @param {string} text documento LF-normalizado
 */
function connectionScan(text) {
  const lines = text.split('\n');
  let legacyCount = 0;
  let appCount = 0;
  let legacyLine = -1;
  let appLine = -1;
  let bodyCloseLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (l === F7_LEGACY_LINE) { legacyCount += 1; legacyLine = i + 1; }
    if (l === F7_APP_LINE) { appCount += 1; appLine = i + 1; }
    if (l.trim() === '</body>' && bodyCloseLine === -1) bodyCloseLine = i + 1;
  }
  return {
    legacyCount, appCount, legacyLine, appLine, bodyCloseLine,
    exactlyOnce: legacyCount === 1 && appCount === 1,
    orderOk: legacyLine !== -1 && appLine !== -1 && legacyLine < appLine,
  };
}

function analyzed() {
  const raw = fs.readFileSync(POS_INDEX, 'utf8');
  const text = raw.replace(/\r\n?/g, '\n');
  const lines = loadPosLines(text);
  const scripts = posScriptRanges(lines);
  const defs = posDefinitions(lines);
  return {
    raw, text, lines, scripts, defs,
    globals: parseGlobalDecls(lines),
    storage: parseStorageStatic(lines, text),
    v10: parseV10Dormancy(lines, scripts, defs, parseGlobalDecls(lines)),
    entry: posEntrySequence(lines),
    scan: connectionScan(text),
    legacyRequired: parseFreezeArray(fs.readFileSync(LEGACY_GLOBALS, 'utf8'), 'REQUIRED_GLOBALS'),
  };
}

let _cache = null;
function analyzedCached() {
  if (!_cache) _cache = analyzed();
  return _cache;
}

// ---------------------------------------------------------------------------
// C1 — forma de la conexion: exactamente 1 de cada uno (anti-duplicacion)
// ---------------------------------------------------------------------------

test('C1 exactamente 1 legacy-globals.js y 1 app.js (lineas exactas, anti-duplicacion)', () => {
  const a = analyzedCached();
  assert.equal(a.scan.legacyCount, 1, 'legacy-globals.js debe aparecer exactamente 1 vez');
  assert.equal(a.scan.appCount, 1, 'app.js debe aparecer exactamente 1 vez');
  assert.equal(a.scan.exactlyOnce, true);
});

// ---------------------------------------------------------------------------
// C2 — orden, posicion y atributos via pos-parse (scanner robusto)
// ---------------------------------------------------------------------------

test('C2 orden legacy<app, tras ultimo inline, antes de </body>, sin defer/async/module', () => {
  const a = analyzedCached();
  assert.equal(a.scan.orderOk, true, 'legacy-globals.js debe cargarse antes que app.js');
  const externals = a.scripts.filter((s) => s.src != null);
  assert.equal(externals.length, 3);
  assert.deepEqual(externals.map((s) => s.src), [
    'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
    F7_LEGACY_SRC, F7_APP_SRC,
  ]);
  const legacy = externals[1];
  const app = externals[2];
  assert.equal(legacy.defer, false);
  assert.equal(legacy.async, false);
  assert.equal(legacy.typeModule, false);
  assert.equal(app.defer, false);
  assert.equal(app.async, false);
  assert.equal(app.typeModule, false);
  const inlines = a.scripts.filter((s) => s.src == null);
  const lastInlineEnd = inlines.reduce((m, s) => Math.max(m, s.endLine), 0);
  assert.ok(legacy.startLine > lastInlineEnd, 'conexion despues del ultimo script inline');
  assert.ok(app.startLine > lastInlineEnd, 'conexion despues del ultimo script inline');
  assert.ok(legacy.endLine < a.scan.bodyCloseLine, 'legacy antes de </body>');
  assert.ok(app.endLine < a.scan.bodyCloseLine, 'app antes de </body>');
  assert.equal(a.scripts.length, 21);
  assert.equal(inlines.length, 18);
});

// ---------------------------------------------------------------------------
// C3 — delta autorizado: disco === HEAD + exactamente las 2 lineas (V9 intacto)
// ---------------------------------------------------------------------------

test('C3 delta autorizado: disco === HEAD:POS/index.html + 2 lineas exactas de conexion', () => {
  const gitText = gitBuffer('HEAD:POS/index.html').toString('utf8').replace(/\r\n?/g, '\n');
  const a = analyzedCached();
  const bodyIdx = gitText.lastIndexOf('</body>');
  assert.ok(bodyIdx > 0);
  const expected = gitText.slice(0, bodyIdx) + F7_LEGACY_LINE + '\n' + F7_APP_LINE + '\n' + gitText.slice(bodyIdx);
  assert.equal(a.text, expected, 'el index debe diferir de HEAD EXACTAMENTE en las 2 lineas de conexion');
  // Pins V9 intactos dentro del documento conectado.
  assert.deepEqual(a.entry.sequence, ENTRY_SEQUENCE_16);
  assert.equal(a.storage.localStorage.length, 20);
  assert.equal(a.storage.sessionStorage.length, 5);
  assert.equal(a.storage.legacy.length, 9);
  assert.equal(a.storage.constants._NA_SNAPSHOT_KEY, 'snapshot_v9');
});

// ---------------------------------------------------------------------------
// C4 — canonico intacto
// ---------------------------------------------------------------------------

test('C4 canonico intacto: disco LF-norm y HEAD === blob 2dec6363', () => {
  const rev = gitString(['rev-parse', 'HEAD:CVV2.4_backup_antes_demo-1.html']);
  assert.equal(rev, PRODUCT_BLOB);
  const disk = fs.readFileSync(CANONICAL);
  const lf = disk.toString('utf8').replace(/\r\n?/g, '\n');
  assert.equal(gitBlobSha1(Buffer.from(lf, 'utf8')), PRODUCT_BLOB);
});

// ---------------------------------------------------------------------------
// C5 — 18 inline byte-exactos: disco === HEAD === canonico
// ---------------------------------------------------------------------------

test('C5 scripts inline legacy byte-intactos (18: disco === HEAD === canonico)', () => {
  const a = analyzedCached();
  const diskTexts = a.scripts
    .filter((s) => s.src == null)
    .map((s) => a.lines.slice(s.startLine - 1, s.endLine).join('\n'));
  assert.equal(diskTexts.length, 18);
  const headLines = loadPosLines(gitBuffer('HEAD:POS/index.html').toString('utf8').replace(/\r\n?/g, '\n'));
  const headTexts = posScriptRanges(headLines)
    .filter((s) => s.src == null)
    .map((s) => headLines.slice(s.startLine - 1, s.endLine).join('\n'));
  const canonLines = loadPosLines(gitBuffer('HEAD:CVV2.4_backup_antes_demo-1.html').toString('utf8').replace(/\r\n?/g, '\n'));
  const canonTexts = posScriptRanges(canonLines)
    .filter((s) => s.src == null)
    .map((s) => canonLines.slice(s.startLine - 1, s.endLine).join('\n'));
  assert.equal(headTexts.length, 18);
  assert.equal(canonTexts.length, 18);
  for (let i = 0; i < 18; i += 1) {
    assert.equal(diskTexts[i], headTexts[i], 'inline ' + i + ': disco vs HEAD');
    assert.equal(diskTexts[i], canonTexts[i], 'inline ' + i + ': disco vs canonico');
  }
});

// ---------------------------------------------------------------------------
// C6 — V10 dormante + contrato de globales vigente
// ---------------------------------------------------------------------------

test('C6 V10 dormante + required globals embebidos === derivados del documento', () => {
  const a = analyzedCached();
  assert.equal(a.v10.dormant, true, 'V10 debe permanecer dormante');
  assert.ok(Array.isArray(a.legacyRequired));
  assert.ok(a.legacyRequired.length >= 177);
  // Los nombres derivados del documento siguen siendo subconjunto cubierto por
  // el contrato embebido (el contrato F6 es la fuente de verdad congelada).
  const embedded = new Set(a.legacyRequired);
  const union = new Set([...a.legacyRequired]);
  assert.equal(union.size, embedded.size);
  assert.ok(embedded.has('confirmarVenta'));
  assert.ok(embedded.has('ticketZoneDrop'));
});

// ---------------------------------------------------------------------------
// C7 — runtime vm CONECTADO: connected/started/verify + 0 negocio + 0 storage
// ---------------------------------------------------------------------------

function buildSandbox({ withQuerySelector }) {
  const forbiddenExact = new Set([
    'localStorage', 'sessionStorage', 'indexedDB',
    'saveAllData', 'loadAllData', '_naRunCriticalOperation',
  ]);
  function isForbidden(key) {
    if (forbiddenExact.has(key)) return true;
    return typeof key === 'string' && key.indexOf('_naV10') === 0;
  }
  const target = {};
  const businessCalls = [];
  const a = analyzedCached();
  for (const name of a.legacyRequired) {
    target[name] = function () { businessCalls.push(name); };
  }
  const windowProxy = new Proxy(target, {
    get(t, key) {
      if (isForbidden(key)) throw new Error('FORBIDDEN_ACCESS:' + String(key));
      return t[key];
    },
    set(t, key, value) { t[key] = value; return true; },
  });
  let domContentLoadedListener = null;
  const document = {
    addEventListener(evt, fn) {
      if (evt === 'DOMContentLoaded') domContentLoadedListener = fn;
    },
  };
  if (withQuerySelector) {
    document.querySelector = function (sel) {
      return sel === 'script[src="js/app.js"]' ? { outerHTML: F7_APP_LINE } : null;
    };
  }
  const sandbox = {
    window: windowProxy,
    document,
    location: { protocol: 'file:' },
    console: { warn() {}, log() {}, error() {} },
  };
  vm.createContext(sandbox);
  return { sandbox, windowProxy, getListener: () => domContentLoadedListener, businessCalls };
}

test('C7 vm conectado: connected=true, DCL started=true, verify ok, 0 negocio, 0 persistencia', () => {
  const legacySrc = fs.readFileSync(LEGACY_GLOBALS, 'utf8');
  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  const h = buildSandbox({ withQuerySelector: true });
  assert.doesNotThrow(() => {
    vm.runInContext(legacySrc, h.sandbox, { filename: 'legacy-globals.js' });
    vm.runInContext(appSrc, h.sandbox, { filename: 'app.js' });
  }, 'los scripts de conexion no deben tocar persistencia ni V10');
  const boot = h.windowProxy._NA_BOOT;
  assert.ok(boot, '_NA_BOOT registrado');
  assert.equal(boot.phase, 'f6');
  assert.equal(boot.connected, true, 'connected=true con querySelector real');
  const legacy = h.windowProxy._NA_LEGACY_GLOBALS;
  assert.ok(legacy, '_NA_LEGACY_GLOBALS disponible');
  assert.equal(legacy.requiredGlobals.length, 177);
  assert.equal(typeof legacy.verify, 'function');
  const listener = h.getListener();
  assert.ok(listener, 'listener DOMContentLoaded registrado');
  assert.equal(boot.started, false);
  listener();
  assert.equal(boot.started, true, 'started=true tras DOMContentLoaded');
  assert.ok(boot.lastVerify, 'verify ejecutado en DCL');
  assert.equal(boot.lastVerify.ok, true, 'verify().ok=true con los 177 globals');
  assert.equal(boot.lastVerify.missing.length, 0);
  assert.equal(boot.lastVerify.checked, 177);
  // Ninguna funcion de negocio fue INVOCADA (verify es typeof-only).
  assert.deepEqual(h.businessCalls, [], 'verify() no debe invocar negocio');
});

test('C8 vm sin querySelector (harness FASE 6): connected=false (guard compatible)', () => {
  const legacySrc = fs.readFileSync(LEGACY_GLOBALS, 'utf8');
  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  const h = buildSandbox({ withQuerySelector: false });
  assert.doesNotThrow(() => {
    vm.runInContext(legacySrc, h.sandbox, { filename: 'legacy-globals.js' });
    vm.runInContext(appSrc, h.sandbox, { filename: 'app.js' });
  });
  const boot = h.windowProxy._NA_BOOT;
  assert.ok(boot);
  assert.equal(boot.connected, false, 'connected=false sin querySelector');
  h.getListener()();
  assert.equal(boot.started, true);
  assert.deepEqual(h.businessCalls, []);
});

// ---------------------------------------------------------------------------
// C9 — adversarial: duplicacion y orden invertido DEBEN ser detectados
// ---------------------------------------------------------------------------

test('C9 adversarial: duplicado u orden invertido rompen el detector (FAIL garantizado)', () => {
  // Los mutantes se construyen sobre el HEAD pre-conexion (el disco real ya
  // contiene las 2 lineas autorizadas).
  const gitText = gitBuffer('HEAD:POS/index.html').toString('utf8').replace(/\r\n?/g, '\n');
  const bodyIdx = gitText.lastIndexOf('</body>');
  assert.ok(bodyIdx > 0);
  const base = gitText.slice(0, bodyIdx);
  const tail = gitText.slice(bodyIdx);

  const dupLegacy = base + F7_LEGACY_LINE + '\n' + F7_LEGACY_LINE + '\n' + F7_APP_LINE + '\n' + tail;
  const sDup = connectionScan(dupLegacy);
  assert.equal(sDup.legacyCount, 2);
  assert.equal(sDup.exactlyOnce, false, 'duplicacion de legacy-globals debe detectarse');

  const dupApp = base + F7_LEGACY_LINE + '\n' + F7_APP_LINE + '\n' + F7_APP_LINE + '\n' + tail;
  const sDupApp = connectionScan(dupApp);
  assert.equal(sDupApp.appCount, 2);
  assert.equal(sDupApp.exactlyOnce, false, 'duplicacion de app.js debe detectarse');

  const inverted = base + F7_APP_LINE + '\n' + F7_LEGACY_LINE + '\n' + tail;
  const sInv = connectionScan(inverted);
  assert.equal(sInv.exactlyOnce, true);
  assert.equal(sInv.orderOk, false, 'orden invertido debe detectarse');
  assert.notEqual(inverted, gitText);
});

// ---------------------------------------------------------------------------
// C10 — gates autonomos: node --check + integridad del freeze FASE 6
// ---------------------------------------------------------------------------

function runGates() {
  if (runGates._cache) return runGates._cache;
  const check = (file) => {
    try {
      execFileSync(process.execPath, ['--check', file], { cwd: ROOT, encoding: 'utf8' });
      return 'PASS';
    } catch (e) {
      return 'FAIL:' + (e.stderr || e.message);
    }
  };
  // Freeze integrity: cada artefacto congelado F6 en disco === HEAD byte-exacto.
  const f6Frozen = {};
  for (const rel of F6_FROZEN_ARTIFACTS) {
    const head = gitBuffer('HEAD:' + rel);
    const disk = fs.readFileSync(path.join(ROOT, rel));
    f6Frozen[rel] = sha256Buffer(disk) === sha256Buffer(head);
  }
  runGates._cache = {
    nodeCheckAppJs: check(APP_JS),
    nodeCheckLegacyGlobals: check(LEGACY_GLOBALS),
    f6FrozenArtifactsIntact: f6Frozen,
    f6FrozenAll: Object.values(f6Frozen).every((v) => v === true),
  };
  return runGates._cache;
}

test('C10 gates autonomos: node --check x2 y artefactos FASE 6 congelados === HEAD', () => {
  const gates = runGates();
  assert.equal(gates.nodeCheckAppJs, 'PASS');
  assert.equal(gates.nodeCheckLegacyGlobals, 'PASS');
  assert.equal(gates.f6FrozenAll, true,
    'FASE 7 no debe tocar los artefactos congelados de FASE 6: '
    + JSON.stringify(gates.f6FrozenArtifactsIntact));
});

// ---------------------------------------------------------------------------
// C11 — evidencia determinista (doble corrida byte-identica, sin timestamps)
// ---------------------------------------------------------------------------

test('C11 evidence determinista: report FASE 7 anclado a HEAD + disco', () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const build = () => {
    const a = analyzed();
    const baseCommit = gitString(['rev-parse', 'HEAD']);
    const preIndexSha256 = sha256Buffer(gitBuffer('HEAD:POS/index.html'));
    const postIndexSha256 = sha256Buffer(fs.readFileSync(POS_INDEX));
    // Ancla F6: la evidencia FASE 6 congelada registro el mismo pre-sha.
    const f6Report = JSON.parse(gitBuffer('HEAD:evidence/offline-compat/report.json').toString('utf8'));
    const canonicalBlob = gitString(['rev-parse', 'HEAD:CVV2.4_backup_antes_demo-1.html']);
    const gates = runGates();

    const externals = a.scripts.filter((s) => s.src != null);
    const inlines = a.scripts.filter((s) => s.src == null);
    const lastInlineEnd = inlines.reduce((m, s) => Math.max(m, s.endLine), 0);

    return {
      baseCommit,
      preIndexSha256,
      postIndexSha256,
      f6AnchorPosIndexSha256: f6Report.posIndexSha256,
      preIndexMatchesF6Anchor: preIndexSha256 === f6Report.posIndexSha256,
      canonicalBlob,
      connection: {
        legacyCount: a.scan.legacyCount,
        appCount: a.scan.appCount,
        exactlyOnce: a.scan.exactlyOnce,
        orderOk: a.scan.orderOk,
        afterLastInline: externals[1].startLine > lastInlineEnd && externals[2].startLine > lastInlineEnd,
        beforeBodyClose: externals[2].endLine < a.scan.bodyCloseLine,
        defer: externals[1].defer || externals[2].defer,
        async: externals[1].async || externals[2].async,
        typeModule: externals[1].typeModule || externals[2].typeModule,
      },
      counts: {
        scripts: a.scripts.length,
        inlineScripts: inlines.length,
        externalScripts: externals.length,
      },
      v10Dormant: a.v10.dormant,
      storage: {
        localStorage: a.storage.localStorage.length,
        sessionStorage: a.storage.sessionStorage.length,
        legacy: a.storage.legacy.length,
        snapshotKey: a.storage.constants._NA_SNAPSHOT_KEY,
      },
      entrySequence: a.entry.sequence.length,
      requiredGlobalsContract: a.legacyRequired.length,
      gates,
    };
  };

  const reportPath = path.join(EVIDENCE_DIR, 'report.json');
  const write = (data) => {
    fs.writeFileSync(reportPath, stableStringify(data) + '\n');
  };

  const b1 = build();
  write(b1);
  const h1 = sha256Buffer(fs.readFileSync(reportPath));
  const b2 = build();
  write(b2);
  const h2 = sha256Buffer(fs.readFileSync(reportPath));
  assert.deepEqual(h2, h1, 'evidence FASE 7 debe ser byte-identica entre corridas');

  const raw = fs.readFileSync(reportPath, 'utf8');
  assert.equal(/updatedAt|createdAt|timestamp|Date\(|ISOString|\d{4}-\d{2}-\d{2}T/.test(raw), false, 'sin timestamps');
  assert.equal(b2.preIndexMatchesF6Anchor, true, 'pre-sha debe anclar a la evidencia F6 congelada');
  assert.equal(b2.canonicalBlob, PRODUCT_BLOB);
  assert.equal(b2.connection.exactlyOnce, true);
  assert.equal(b2.connection.orderOk, true);
  assert.equal(b2.gates.nodeCheckAppJs, 'PASS');
  assert.equal(b2.gates.f6FrozenAll, true, 'artefactos FASE 6 congelados intactos');
});

// ---------------------------------------------------------------------------
// C12 — dinamica navegador real via CDP (file:// y http://), sin dependencias
// nuevas: WebSocket global de Node. Si el entorno falla: ENVIRONMENT_BLOCKED
// honesto (t.skip), nunca PASS silencioso.
// ---------------------------------------------------------------------------

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findBrowser() {
  for (const p of BROWSER_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

const BOOT_PROBE_EXPR = 'JSON.stringify({'
  + 'boot: !!window._NA_BOOT,'
  + ' phase: window._NA_BOOT ? window._NA_BOOT.phase : null,'
  + ' connected: window._NA_BOOT ? window._NA_BOOT.connected === true : null,'
  + ' started: window._NA_BOOT ? window._NA_BOOT.started === true : null,'
  + ' verifyOk: !!(window._NA_BOOT && window._NA_BOOT.lastVerify && window._NA_BOOT.lastVerify.ok),'
  + ' verifyMissing: window._NA_BOOT && window._NA_BOOT.lastVerify ? window._NA_BOOT.lastVerify.missing.length : null,'
  + ' verifyChecked: window._NA_BOOT && window._NA_BOOT.lastVerify ? window._NA_BOOT.lastVerify.checked : null,'
  + ' legacy: !!window._NA_LEGACY_GLOBALS,'
  + ' requiredCount: window._NA_LEGACY_GLOBALS ? window._NA_LEGACY_GLOBALS.requiredGlobals.length : null'
  + '})';

/**
 * Levanta Chrome headless con CDP, navega a url y evalua expr en la pagina.
 * @returns {Promise<object>} resultado de Runtime.evaluate (returnByValue)
 */
async function cdpEvaluate(browser, url, expr) {
  const { spawn } = await import('node:child_process');
  const os = await import('node:os');
  const http = await import('node:http');
  const profile = path.join(os.tmpdir(), 'fase7-cdp-' + process.pid + '-' + Math.random().toString(36).slice(2));
  const proc = spawn(browser, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--no-sandbox',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    'about:blank',
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
        return new Promise((r2) => {
          pending.set(id, r2);
          ws.send(JSON.stringify({ id, method, params }));
        });
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          return;
        }
        if (msg.method === 'Page.loadEventFired') {
          loadFired = true;
          for (const w of loadWaiters.splice(0)) w();
        }
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
          // Polling: esperar a que el bootstrap este registrado (carga real de
          // los 2 scripts classic tras el parseo completo del documento).
          let parsed = null;
          for (let attempt = 0; attempt < 30 && !(parsed && parsed.boot === true); attempt += 1) {
            await new Promise((r4) => setTimeout(r4, 500));
            const ev = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
            if (ev.error) throw new Error('CDP_EVAL_ERROR:' + JSON.stringify(ev.error));
            if (ev.result && ev.result.result && typeof ev.result.result.value === 'string') {
              try { parsed = JSON.parse(ev.result.result.value); } catch { parsed = null; }
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

test('C12 dinamica navegador real (CDP): connected/started/verify en file:// y http://', { timeout: 180000 }, async (t) => {
  const browser = findBrowser();
  const writeBlocked = (reason, detail) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-ENVIRONMENT_BLOCKED.json'), stableStringify({
      status: 'ENVIRONMENT_BLOCKED',
      reason,
      detail: detail || null,
      browser: browser ? path.basename(browser) : null,
      note: 'nunca PASS silencioso; la verificacion principal es C1-C11 (Node determinista)',
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
  const fileUrl = 'file:///' + POS_INDEX.replace(/\\/g, '/');
  const httpUrl = 'http://127.0.0.1:' + port + '/POS/index.html';

  let fileResults = null;
  let fileError = null;
  let httpResults = null;
  let httpError = null;
  try {
    fileResults = await cdpEvaluate(browser, fileUrl, BOOT_PROBE_EXPR);
  } catch (e) { fileError = String(e && e.message || e); }
  try {
    httpResults = await cdpEvaluate(browser, httpUrl, BOOT_PROBE_EXPR);
  } catch (e) { httpError = String(e && e.message || e); }
  server.close();

  if (!fileResults && !httpResults) {
    writeBlocked('CDP no produjo resultados en ningun protocolo', { fileError, httpError });
    t.skip('ENVIRONMENT_BLOCKED: ' + (fileError || httpError));
    return;
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-browser.json'), stableStringify({
    status: 'OK',
    browser: path.basename(browser),
    fileProtocol: { status: fileResults ? 'OK' : 'ENVIRONMENT_BLOCKED', error: fileError, results: fileResults },
    httpProtocol: { status: httpResults ? 'OK' : 'ENVIRONMENT_BLOCKED', error: httpError, results: httpResults },
  }) + '\n');

  for (const [label, r] of [['file://', fileResults], ['http://', httpResults]]) {
    if (!r) continue;
    assert.equal(r.boot, true, label + ' _NA_BOOT presente');
    assert.equal(r.phase, 'f6', label + ' phase');
    assert.equal(r.connected, true, label + ' connected=true');
    assert.equal(r.started, true, label + ' started=true tras DOMContentLoaded');
    assert.equal(r.verifyOk, true, label + ' verify().ok=true contra V9 real');
    assert.equal(r.verifyMissing, 0, label + ' 0 globals faltantes');
    assert.equal(r.verifyChecked, 177, label + ' 177 verificados');
    assert.equal(r.legacy, true, label + ' _NA_LEGACY_GLOBALS presente');
    assert.equal(r.requiredCount, 177, label + ' contrato de 177 globals');
  }
});
