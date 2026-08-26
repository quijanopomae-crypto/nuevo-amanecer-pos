// core-utils-extraction.test.mjs — ETAPA 4 WORK ITEM: CORE / UTILS (transversales)
//
// OBJECTIVE_ID: CORE-UTILS-EXTRACTION
//
// Verifica la extraccion REAL de utilidades TRANSVERSALES desde POS/index.html
// hacia POS/js/core/utils.js (base 45c8c1e, FASE 7 frozen). Criterio estricto:
// solo helpers genericos con transversalidad DEMOSTRADA por uso multi-modulo o
// por pertenecer al bloque UTILS original del autor. Sin contracts.js (el
// unico contrato candidato, NA_MAX_ALT_BARCODES, es de dominio producto y
// permanece inline).
//
//   U1. movidas fuera del inline; exactamente 1 definicion en todo el documento
//       (index + utils); las de dominio volvieron exactamente 1 vez al index;
//   U2. lineas extraidas byte-identicas a HEAD (movido, no reescrito);
//   U3. orden: utils.js classic sin defer/async, antes del primer inline;
//       conexion F7 intacta al final;
//   U4. los 177 REQUIRED_GLOBALS (contrato F6) definidos en index ∪ utils;
//   U5. balance multiset exacto: disco + core + insert autorizado === HEAD;
//   U6. canonico intacto; V9 igual (entry 16, storage 20/5/9); V10 dormante;
//   U7. comportamiento identico en vm (quirks legados preservados);
//   U8. utils.js sin tokens de storage/persistencia/DOM/negocio/V10;
//   U9. evidencia determinista (doble corrida byte-identica, sin timestamps);
//   U10. dinamica navegador real (CDP): documento completo carga, F7 conectado,
//        utils vivo como global lexica, contrato 177 verificable.

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
const UTILS_JS = path.join(ROOT, 'POS', 'js', 'core', 'utils.js');
const CONTRACTS_JS = path.join(ROOT, 'POS', 'js', 'core', 'contracts.js');
const LEGACY_GLOBALS = path.join(ROOT, 'POS', 'js', 'compat', 'legacy-globals.js');
const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'core-utils');

const PRODUCT_BLOB = '2dec6363d8aeef52da64ba60ac8eac8eb14f75f7';

// Set final: SOLO transversales demostradas.
const UTILS_EXTRACTED = [
  'fmt', 'fmtS', 'nowT', 'obtenerHoy', 'HOY', 'diasHasta', 'sinTildes',
  'initials', 'COLORS', 'colorFor', '_naEsc', '_naClean', '_naNumber',
  '_naInt', '_naClone', '_naIsPlainObject', '_naRoundMoney',
];
// De dominio: debieron quedar exactamente 1 vez en el index (no en utils).
const DOMAIN_STAYED = [
  '_naTkMoney', '_naTicketChars', '_naTicketAscii', '_naTkWrap',
  '_naSecHash', '_naEsAndroid', '_naEsMovil', '_naParseTime24', '_naTime24',
  '_naParseCSV', '_naHeader', '_naStableSku', '_naImportBool', '_naImportUnit',
  '_naImportPurchaseUnit', '_naSplitImportCodes', '_naNormalizeAltCodes',
  '_naProductAltCodes', 'NA_MAX_ALT_BARCODES', '_naCategoryKey',
  '_naCategoryText', '_naCategoryTitle', '_naUnitsPerQty', '_naUnitsSold',
  '_naLineKey', '_naDatePlus', '_naCashierIdNumber', '_naCsvCell', '_naNewUuid',
];

const ENTRY_SEQUENCE_16 = [
  'loadAllData', 'loadAppState', 'loadMasterConfig', '_naInitSecurity',
  '_naNormalizeData', 'renderCategorySelects', '_naApplyConfigUI',
  '_naInitFreeSaleShortcut', '_naInitBarcodeScanner',
  'creditos.forEach(_naSyncCreditStatus)', 'posRender', 'posUpdateCart',
  'invRender', 'cfgUpdateStats', 'updateDashboard', 'saveAllData',
];

const UTILS_TAG = '<script src="js/core/utils.js"></script>';

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

const IDENT = '[A-Za-z_$][A-Za-z0-9_$]*';
const DEF_RES = [
  '(?:^|\\n)[ \\t]*(?:async[ \\t]+)?function[ \\t]+NAME[ \\t]*[(]',
  '(?:^|\\n)[ \\t]*(?:const|let|var)[ \\t]+NAME[ \\t]*=',
  '(?:^|\\n)[ \\t]*NAME[ \\t]*=[ \\t]*(?:async[ \\t]+)?function\\b',
];
function defCount(src, name) {
  let count = 0;
  for (const proto of DEF_RES) {
    const re = new RegExp(proto.replace(/NAME/g, name.replace(/[$]/g, '\\$&')), 'g');
    count += (src.match(re) || []).length;
  }
  return count;
}

function coreBodyLines(src) {
  return src.split('\n').filter((l) => l.trim() && !l.startsWith('/*') && !l.startsWith(' *') && !l.startsWith(' */'));
}

function analyzed() {
  const raw = fs.readFileSync(POS_INDEX, 'utf8');
  const text = raw.replace(/\r\n?/g, '\n');
  const lines = loadPosLines(text);
  const scripts = posScriptRanges(lines);
  return {
    raw, text, lines, scripts,
    utilsSrc: fs.readFileSync(UTILS_JS, 'utf8'),
  };
}
let _cache = null;
function analyzedCached() {
  if (!_cache) _cache = analyzed();
  return _cache;
}

// ---------------------------------------------------------------------------
// U1 — extraccion real, sin duplicados, dominio devuelto
// ---------------------------------------------------------------------------

test('U1 17 transversales fuera del inline, exactamente 1 en core; dominio quedo inline', () => {
  const a = analyzedCached();
  assert.equal(fs.existsSync(CONTRACTS_JS), false, 'contracts.js no debe existir (unico contrato era de dominio producto)');
  for (const name of UTILS_EXTRACTED) {
    assert.equal(defCount(a.text, name), 0, name + ' no debe definirse en index');
    assert.equal(defCount(a.utilsSrc, name), 1, name + ' exactamente 1 en utils.js');
  }
  for (const name of DOMAIN_STAYED) {
    assert.equal(defCount(a.utilsSrc, name), 0, name + ' NO debe estar en utils.js (dominio)');
    assert.equal(defCount(a.text, name), 1, name + ' debe volver exactamente 1 vez al index');
  }
});

// ---------------------------------------------------------------------------
// U2 — byte-exacto vs HEAD
// ---------------------------------------------------------------------------

test('U2 las lineas extraidas son byte-identicas a HEAD:POS/index.html', () => {
  const headText = gitBuffer('HEAD:POS/index.html').toString('utf8').replace(/\r\n?/g, '\n');
  const headLines = new Set(headText.split('\n'));
  const a = analyzedCached();
  for (const line of coreBodyLines(a.utilsSrc)) {
    assert.ok(headLines.has(line), 'utils.js linea no byte-exacta vs HEAD: ' + line.slice(0, 80));
  }
});

// ---------------------------------------------------------------------------
// U3 — orden de carga
// ---------------------------------------------------------------------------

test('U3 utils.js classic sin defer/async, antes del primer inline; F7 intacta al final', () => {
  const a = analyzedCached();
  let utilsLine = -1;
  a.lines.forEach((l, i) => { if (l.includes('src="js/core/utils.js"')) utilsLine = i + 1; });
  const firstInline = a.scripts.filter((s) => s.src == null).reduce((m, s) => Math.min(m, s.startLine), Infinity);
  let f7Line = -1;
  a.lines.forEach((l, i) => { if (l.includes('js/compat/legacy-globals.js')) f7Line = i + 1; });
  assert.ok(utilsLine > 0, 'tag core presente');
  assert.ok(utilsLine < firstInline, 'utils.js antes del primer script inline');
  assert.ok(firstInline < f7Line, 'conexion F7 al final (intacta)');
  assert.equal((a.text.match(new RegExp(UTILS_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1, 'exactamente 1 tag utils classic');
  assert.equal(/js\/core\/\w+\.js"[^>]*\s(defer|async)/.test(a.text), false, 'sin defer/async');
  assert.equal(fs.readdirSync(path.join(ROOT, 'POS', 'js', 'core')).length, 1, 'solo utils.js en core/');
  assert.equal(a.scripts.filter((s) => s.src == null).length, 18, '18 inline intactos');
  assert.equal(a.scripts.filter((s) => s.src != null).length, 4, '4 externos: CDN + F7x2 + utils');
  assert.equal(a.scripts.length, 22, '22 scripts totales');
});

// ---------------------------------------------------------------------------
// U4 — contrato de globals F6
// ---------------------------------------------------------------------------

test('U4 contrato F6: los 177 requeridos definidos en index ∪ utils', () => {
  const a = analyzedCached();
  const legacySrc = fs.readFileSync(LEGACY_GLOBALS, 'utf8');
  const m = legacySrc.match(/REQUIRED_GLOBALS = Object\.freeze\(([\s\S]*?)\]\);/);
  const required = Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
  assert.equal(required.length, 177);
  const docText = a.text + '\n' + a.utilsSrc;
  const missing = required.filter((n) => defCount(docText, n) < 1);
  assert.deepEqual(missing, []);
  const moved = UTILS_EXTRACTED.filter((n) => required.includes(n));
  assert.deepEqual(moved, ['_naEsc'], 'unico requerido movido: _naEsc (global lexica)');
});

// ---------------------------------------------------------------------------
// U5 — balance multiset exacto
// ---------------------------------------------------------------------------

test('U5 balance multiset: disco + utils-body + tag autorizado === HEAD', () => {
  const headText = gitBuffer('HEAD:POS/index.html').toString('utf8').replace(/\r\n?/g, '\n');
  const a = analyzedCached();
  const counts = new Map();
  const bump = (l, d) => counts.set(l, (counts.get(l) || 0) + d);
  for (const l of headText.split('\n')) bump(l, +1);
  for (const l of a.text.split('\n')) bump(l, -1);
  for (const l of coreBodyLines(a.utilsSrc)) bump(l, -1);
  bump(UTILS_TAG, +1); // unico insert autorizado
  const imbalance = [...counts.entries()].filter(([, v]) => v !== 0);
  assert.deepEqual(imbalance, [], 'nada anadido ni reescrito fuera del delta autorizado');
  const headLines = headText.split('\n').length;
  const body = coreBodyLines(a.utilsSrc).length;
  assert.equal(headLines - body + 1, a.text.split('\n').length, 'balance de lineas');
});

// ---------------------------------------------------------------------------
// U6 — canonico / V9 / V10
// ---------------------------------------------------------------------------

test('U6 canonico intacto + V9 igual (entry 16, storage 20/5/9) + V10 dormante', () => {
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
// U7 — comportamiento identico en vm
// ---------------------------------------------------------------------------

function coreSandbox() {
  const forbiddenExact = new Set([
    'localStorage', 'sessionStorage', 'indexedDB',
    'saveAllData', 'loadAllData', '_naRunCriticalOperation',
  ]);
  function isForbidden(key) {
    if (forbiddenExact.has(key)) return true;
    return typeof key === 'string' && key.indexOf('_naV10') === 0;
  }
  const target = {};
  const windowProxy = new Proxy(target, {
    get(t, key) {
      if (isForbidden(key)) throw new Error('FORBIDDEN_ACCESS:' + String(key));
      return t[key];
    },
    set(t, key, value) { t[key] = value; return true; },
  });
  const sandbox = { window: windowProxy, console: { warn() {}, log() {}, error() {} } };
  vm.createContext(sandbox);
  return { sandbox, windowProxy };
}

test('U7 vm: comportamiento identico, 0 persistencia, 0 negocio', () => {
  const a = analyzedCached();
  const h = coreSandbox();
  assert.doesNotThrow(() => {
    vm.runInContext(a.utilsSrc, h.sandbox, { filename: 'utils.js' });
  }, 'utils no debe tocar persistencia/V10');
  const probe = (expr) => vm.runInContext(expr, h.sandbox);

  assert.equal(probe('fmt(3)'), 'S/ 3.00');
  assert.equal(probe('fmtS(3.4)'), 'S/3');
  assert.match(probe('nowT()'), /\d{1,2}:\d{2}:\d{2}/, 'nowT: HH:MM:SS (sufijo am/pm depende del ICU del entorno; en Chrome real no aparece)');
  assert.match(probe('obtenerHoy()'), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(probe('HOY === obtenerHoy'), true);
  assert.equal(probe('diasHasta(obtenerHoy())'), 0);
  assert.equal(probe('diasHasta("no-fecha")'), null);
  assert.equal(probe('sinTildes("ÁÉÍÓÚñ")'), 'AEIOUn');
  assert.equal(probe('initials("Juan Perez")'), 'JP');
  assert.equal(probe('COLORS.length'), 8);
  assert.equal(probe('colorFor(3) === COLORS[3]'), true);
  assert.equal(probe('colorFor(11) === COLORS[3]'), true, 'colorFor modulo 8');
  assert.equal(probe('_naEsc("<a&\\"b\\">")'), '&lt;a&amp;&quot;b&quot;&gt;');
  assert.equal(probe('_naClean(" <x>y> ")'), 'xy');
  assert.equal(probe('_naNumber("1,5")'), 1.5);
  assert.equal(probe('_naNumber("1.234,5")'), 1234.5);
  assert.equal(probe('_naNumber("x",7)'), 0, 'quirk legado: "x" se vacia y Number("")===0');
  assert.equal(probe('_naInt("2.9")'), 2);
  assert.equal(probe('_naInt("x",5)'), 0, 'quirk legado: fallback via _naNumber');
  const cloned = probe('(function(){const o={a:[1,{b:2}]};const c=_naClone(o);o.a[1].b=9;return c.a[1].b;})()');
  assert.equal(cloned, 2, '_naClone es deep clone');
  assert.equal(probe('_naIsPlainObject({})'), true);
  assert.equal(probe('_naIsPlainObject(null)'), false);
  assert.equal(probe('_naIsPlainObject([])'), false);
  assert.equal(probe('_naIsPlainObject(Object.create(null))'), true);
  assert.equal(probe('_naRoundMoney("3.145")'), 3.15);
  assert.equal(probe('_naRoundMoney(-1)'), 0, 'quirk legado: max(0,...)');
});

// ---------------------------------------------------------------------------
// U8 — utils sin storage/DOM/negocio/V10
// ---------------------------------------------------------------------------

test('U8 utils.js sin tokens de storage, persistencia, DOM ni negocio', () => {
  const a = analyzedCached();
  const forbidden = [
    'localStorage', 'sessionStorage', 'indexedDB', 'document.', 'window.',
    'saveAllData', 'loadAllData', '_naRunCriticalOperation', 'fetch(',
  ];
  const body = a.utilsSrc.split('\n').filter((l) => !l.startsWith(' *') && !l.startsWith('/*') && !l.startsWith(' */'));
  for (const tok of forbidden) {
    const hits = body.filter((l) => l.includes(tok));
    assert.deepEqual(hits, [], 'utils.js contiene token prohibido "' + tok + '"');
  }
  assert.equal(/_naV10/.test(a.utilsSrc), false, 'sin V10 (salvo mencion en comentario de exclusion: se filtra arriba)');
});

// ---------------------------------------------------------------------------
// U9 — evidencia determinista
// ---------------------------------------------------------------------------

function runGates() {
  if (runGates._cache) return runGates._cache;
  try {
    execFileSync(process.execPath, ['--check', UTILS_JS], { cwd: ROOT, encoding: 'utf8' });
    runGates._cache = { nodeCheckUtils: 'PASS' };
  } catch (e) {
    runGates._cache = { nodeCheckUtils: 'FAIL:' + (e.stderr || e.message) };
  }
  return runGates._cache;
}

function countLines(text) {
  return text.replace(/\n$/, '').split('\n').length;
}

test('U9 evidencia determinista: metricas del work item (doble corrida byte-identica)', () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const build = () => {
    const a = analyzed();
    const headText = gitBuffer('HEAD:POS/index.html').toString('utf8').replace(/\r\n?/g, '\n');
    const body = coreBodyLines(a.utilsSrc);
    return {
      baseCommit: gitString(['rev-parse', 'HEAD']),
      canonicalBlob: gitString(['rev-parse', 'HEAD:CVV2.4_backup_antes_demo-1.html']),
      index: {
        before: { lines: countLines(headText), bytes: Buffer.byteLength(headText, 'utf8') },
        after: { lines: countLines(a.text), bytes: Buffer.byteLength(a.text, 'utf8') },
        jsLinesRemoved: body.length,
        scriptTagsAdded: 1,
      },
      core: {
        utilsJs: {
          lines: countLines(a.utilsSrc), bytes: Buffer.byteLength(a.utilsSrc, 'utf8'),
          definitions: UTILS_EXTRACTED.length, functions: UTILS_EXTRACTED.filter((n) => n !== 'COLORS').length,
          constants: ['COLORS'],
        },
        contractsJs: null,
      },
      loadOrder: [
        'head:CDN(defer,preexistente)',
        'js/core/utils.js',
        '18 inline (V9+features)',
        'js/compat/legacy-globals.js',
        'js/app.js',
      ],
      scripts: {
        total: a.scripts.length,
        inline: a.scripts.filter((s) => s.src == null).length,
        external: a.scripts.filter((s) => s.src != null).length,
      },
      gates: runGates(),
    };
  };
  const reportPath = path.join(EVIDENCE_DIR, 'report.json');
  const write = (d) => fs.writeFileSync(reportPath, stableStringify(d) + '\n');
  write(build());
  const h1 = sha256Buffer(fs.readFileSync(reportPath));
  write(build());
  const h2 = sha256Buffer(fs.readFileSync(reportPath));
  assert.deepEqual(h2, h1, 'evidence byte-identica entre corridas');
  const raw = fs.readFileSync(reportPath, 'utf8');
  assert.equal(/updatedAt|createdAt|timestamp|Date\(|ISOString|\d{4}-\d{2}-\d{2}T/.test(raw), false, 'sin timestamps');
  const rep = JSON.parse(raw);
  assert.equal(rep.index.before.lines - rep.index.jsLinesRemoved + 1, rep.index.after.lines);
  assert.equal(rep.canonicalBlob, PRODUCT_BLOB);
  assert.equal(rep.gates.nodeCheckUtils, 'PASS');
  assert.equal(rep.core.contractsJs, null);
});

// ---------------------------------------------------------------------------
// U10 — dinamica navegador real (CDP)
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

const CORE_PROBE_EXPR = 'JSON.stringify({'
  + 'boot: !!window._NA_BOOT,'
  + ' connected: window._NA_BOOT ? window._NA_BOOT.connected === true : null,'
  + ' legacy: !!window._NA_LEGACY_GLOBALS,'
  + ' fmt: typeof fmt,'
  + ' clone: typeof _naClone,'
  + ' escFn: (typeof _naEsc === "function") ? _naEsc("<b>") : null,'
  + ' roundMoney: (typeof _naRoundMoney === "function") ? _naRoundMoney("3.145") : null,'
  + ' altBarcodes: (typeof NA_MAX_ALT_BARCODES !== "undefined") ? NA_MAX_ALT_BARCODES : null,'
  + ' tkMoney: typeof _naTkMoney,'
  + ' secHash: typeof _naSecHash,'
  + ' verify: (window._NA_BOOT && typeof window._NA_BOOT.verify === "function") ? (window._NA_BOOT.verify() || {}).ok : null,'
  + ' verifyMissing: (window._NA_BOOT && window._NA_BOOT.lastVerify) ? window._NA_BOOT.lastVerify.missing.length : null,'
  + ' verifyChecked: (window._NA_BOOT && window._NA_BOOT.lastVerify) ? window._NA_BOOT.lastVerify.checked : null'
  + '})';

async function cdpEvaluate(browser, url, expr) {
  const { spawn } = await import('node:child_process');
  const os = await import('node:os');
  const http = await import('node:http');
  const profile = path.join(os.tmpdir(), 'core-cdp-' + process.pid + '-' + Math.random().toString(36).slice(2));
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

test('U10 dinamica navegador (CDP): utils transversales vivas; dominio inline intacto; F7 conectado', { timeout: 180000 }, async (t) => {
  const browser = findBrowser();
  const writeBlocked = (reason, detail) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-ENVIRONMENT_BLOCKED.json'), stableStringify({
      status: 'ENVIRONMENT_BLOCKED', reason, detail: detail || null,
      browser: browser ? path.basename(browser) : null,
      note: 'nunca PASS silencioso; la verificacion principal es U1-U9 (Node determinista)',
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
  let fileResults = null; let fileError = null; let httpResults = null; let httpError = null;
  try { fileResults = await cdpEvaluate(browser, fileUrl, CORE_PROBE_EXPR); } catch (e) { fileError = String(e && e.message || e); }
  try { httpResults = await cdpEvaluate(browser, httpUrl, CORE_PROBE_EXPR); } catch (e) { httpError = String(e && e.message || e); }
  server.close();
  if (!fileResults && !httpResults) {
    writeBlocked('CDP sin resultados', { fileError, httpError });
    t.skip('ENVIRONMENT_BLOCKED: ' + (fileError || httpError));
    return;
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-browser.json'), stableStringify({
    status: 'OK', browser: path.basename(browser),
    fileProtocol: { status: fileResults ? 'OK' : 'ENVIRONMENT_BLOCKED', error: fileError, results: fileResults },
    httpProtocol: { status: httpResults ? 'OK' : 'ENVIRONMENT_BLOCKED', error: httpError, results: httpResults },
  }) + '\n');
  for (const [label, r] of [['file://', fileResults], ['http://', httpResults]]) {
    if (!r) continue;
    assert.equal(r.boot, true, label + ' _NA_BOOT (F7 intacto)');
    assert.equal(r.connected, true, label + ' F7 connected');
    assert.equal(r.legacy, true, label + ' _NA_LEGACY_GLOBALS');
    assert.equal(r.fmt, 'function', label + ' fmt global lexica desde utils.js');
    assert.equal(r.clone, 'function', label + ' _naClone desde utils.js');
    assert.equal(r.escFn, '&lt;b&gt;', label + ' _naEsc comportamiento');
    assert.equal(r.roundMoney, 3.15, label + ' _naRoundMoney comportamiento');
    assert.equal(r.altBarcodes, 10, label + ' NA_MAX_ALT_BARCODES sigue definido (inline, dominio)');
    assert.equal(r.tkMoney, 'function', label + ' _naTkMoney sigue inline (dominio ticket)');
    assert.equal(r.secHash, 'function', label + ' _naSecHash sigue inline (dominio seguridad)');
    assert.equal(r.verify, true, label + ' verify().ok (177 incl. _naEsc lexico)');
    assert.equal(r.verifyMissing, 0, label + ' 0 faltantes');
    assert.equal(r.verifyChecked, 177, label + ' 177 verificados');
  }
});
