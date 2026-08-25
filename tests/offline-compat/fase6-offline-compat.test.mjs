// fase6-offline-compat.test.mjs — FASE 6 OFFLINE BOOTSTRAP + COMPATIBILITY (v3)
//
// OBJECTIVE_ID: FASE6-OFFLINE-COMPAT
//
// v3 (GLM SECOND ENGINEER — contrato v3):
//  - Discovery FULL-DOCUMENT: handlers on* de TODO el HTML fuera de los
//    rangos de script (v2 solo miraba hasta el boundary y omitia 9 globals).
//  - Exclusion REAL de asignaciones JavaScript .on*= (6 en el POS real).
//  - ORACULO INDEPENDIENTE: estrategia distinta (emparejamiento regex de
//    tags + prev-char check), SIN reutilizar scripts/boundary/defNames/
//    regex/handler extraction de pos-parse. Acuerdo triple:
//    extractor v3 === oraculo independiente === legacy-globals.js.
//  - Los numeros 99/231/90/135/6/366/177 son CRITERIOS DE CONCILIACION
//    documentados, NO fuente del calculo: el valor emerge siempre de las
//    listas derivadas y del acuerdo triple.
//  - T18: matriz adversarial F1-F12 + caso Codex if (ok) /[]/.test(x);
//  - T19: ondrop/ticketZoneDrop + regresion .onclick= JS no es atributo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import {
  loadPosLines, scanTags, posScriptRanges, posStaticBoundary, posStaticHandlerNames,
  posTemplateHandlerNames, posRequiredGlobals, posDefinitions, posOverrideWinners,
  posEntrySequence, posSheetJsGuards, posStyleRealBlocks, crossCheckVsStaticParse,
  scanHandlerAttrs,
} from './lib/pos-parse.mjs';
import { gitBlobSha1 } from '../characterization/lib/blob-hash.mjs';
import {
  parseStorageStatic, parseV10Dormancy, parseGlobalDecls, parseScriptBlocks,
} from '../characterization/lib/static-parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const POS_INDEX = path.join(ROOT, 'POS', 'index.html');
const CANONICAL = path.join(ROOT, 'CVV2.4_backup_antes_demo-1.html');
const LEGACY_GLOBALS = path.join(ROOT, 'POS', 'js', 'compat', 'legacy-globals.js');
const APP_JS = path.join(ROOT, 'POS', 'js', 'app.js');
const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'offline-compat');
const POS_PARSE = path.join(__dirname, 'lib', 'pos-parse.mjs');
const THIS_FILE = path.join(__dirname, 'fase6-offline-compat.test.mjs');

const PRODUCT_BLOB = '2dec6363d8aeef52da64ba60ac8eac8eb14f75f7';
const SHEETJS_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';

// ---------------------------------------------------------------------------
// Criterios de conciliacion congelados (documentacion, NO fuente del calculo)
// ---------------------------------------------------------------------------

// Conciliacion v3 (contrato demostrado): los valores EMERGEN de la derivacion
// y del acuerdo triple; estos constantes solo documenta el congelado esperado.
const EXPECTED_STATIC_NAMES = 99;
const EXPECTED_STATIC_OCC = 231;
const EXPECTED_TEMPLATE_NAMES = 90;
const EXPECTED_TEMPLATE_OCC = 135;
const EXPECTED_JS_ON = 6;
const EXPECTED_REAL_TOTAL = 366;
const EXPECTED_REQUIRED = 177;

// 9 globals omitidos por v2 (HTML posterior a los scripts). Pines v3.
const PINS_V3_NEW = [
  'actualizarAdvertenciaLineaManual', 'guardarLineaCreditoManual',
  'restaurarLineaCreditoAutomatica', '_naF12RenderEmojiPicker',
  '_naF12ChooseAutoSuggestion', '_naF12DesignerReset',
  '_naF12DesignerAddText', '_naF12DesignerLoadImage',
  '_naF12SaveCustomIcon',
];

// Pines previos (clase de truncamiento v2) que deben conservarse.
const PINS_V2 = [
  'ticketZoneDrop', 'abrirEvaluacionCredito', 'securityUnlock',
  'abrirPago', 'posAdd',
];
const PINS_ALL = [...PINS_V2, ...PINS_V3_NEW];

// Handlers de template verificados (FASE 4/5) que deben seguir presentes.
const TEMPLATE_REQUIRED_8 = [
  'posAdd', 'importProducts', 'exportProductsExcel', 'downloadProductTemplate',
  'cargarCatalogoInicial', 'clearProductImportPreview', 'toggleDark', 'applyFontSize',
];

const FROZEN_28 = [
  { name: 'confirmarVenta', count: 2 },
  { name: 'guardarMovInv', count: 3 },
  { name: 'posRender', count: 2 },
  { name: 'cliRender', count: 2 },
  { name: 'cajRender', count: 2 },
  { name: 'abrirCred', count: 4 },
  { name: 'ventasRender', count: 3 },
  { name: 'gasRender', count: 2 },
  { name: 'guardarProd', count: 3 },
  { name: 'abrirModalProd', count: 3 },
  { name: 'previewImagen', count: 3 },
  { name: 'abrirCaja', count: 2 },
  { name: 'abrirCobro', count: 2 },
  { name: 'abrirDescuento', count: 2 },
  { name: 'abrirModalCli', count: 3 },
  { name: 'abrirModalGasto', count: 3 },
  { name: 'cerrarCaja', count: 2 },
  { name: 'confirmarPago', count: 2 },
  { name: 'guardarCli', count: 2 },
  { name: 'guardarConfig', count: 2 },
  { name: 'guardarCred', count: 3 },
  { name: 'guardarMovCaja', count: 2 },
  { name: 'imprimirTicketSistema', count: 2 },
  { name: 'invRender', count: 2 },
  { name: 'selPM', count: 2 },
  { name: 'switchCfgCategory', count: 2 },
  { name: 'ventasSetTab', count: 2 },
  { name: '_naF8ExportReport', count: 2 },
];

const ENTRY_SEQUENCE_16 = [
  'loadAllData', 'loadAppState', 'loadMasterConfig', '_naInitSecurity',
  '_naNormalizeData', 'renderCategorySelects', '_naApplyConfigUI',
  '_naInitFreeSaleShortcut', '_naInitBarcodeScanner',
  'creditos.forEach(_naSyncCreditStatus)', 'posRender', 'posUpdateCart',
  'invRender', 'cfgUpdateStats', 'updateDashboard', 'saveAllData',
];

const SHEETJS_GUARDS_MIN = 6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function sha256Json(value) {
  return sha256Buffer(Buffer.from(JSON.stringify(value), 'utf8'));
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

function inlineScriptTexts(lines, scripts) {
  return scripts
    .filter((s) => s.src == null)
    .map((s) => lines.slice(s.startLine - 1, s.endLine).join('\n'));
}

function parseFreezeArray(src, varName) {
  const re = new RegExp('var\\s+' + varName + '\\s*=\\s*Object\\.freeze\\((\\[[\\s\\S]*?\\])\\)');
  const m = re.exec(src);
  assert.ok(m, 'no se encontro Object.freeze para ' + varName);
  const cleaned = m[1].replace(/,(\s*\])/g, (mm, p1) => p1);
  return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------
// ORACULO INDEPENDIENTE — estrategia DISTINTA a pos-parse.mjs
//
// No importa ni reutiliza nada de pos-parse: ni rangos, ni boundary, ni
// defNames, ni regex de handlers, ni extraction. En lugar de un scanner
// char-by-char, empareja aperturas/cierres con regex globales, verifica el
// prev-char de cada match manualmente y deriva definiciones top-level con
// patrones anclados a columna 0 (matchAll sobre el texto completo).
// ---------------------------------------------------------------------------

const ORA_OPEN_RE = /<script\b[^>]*>/gi;
const ORA_CLOSE_RE = /<\/script\s*>/gi;
const ORA_SRC_RE = /\ssrc\s*=/i;
const DQ = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const ORA_HANDLER_SRC = '\\bon(click|change|input|keydown|submit|dragstart|dragend|dragover|dragleave|drop)[ \\t]*=[ \\t]*(?:' + DQ + '([^' + DQ + ']*)' + DQ + '|' + SQ + '([^' + SQ + ']*)' + SQ + ')';
const ORA_HANDLER_RE = new RegExp(ORA_HANDLER_SRC, 'gi');
const ORA_JSON_RE = /\.[ \t]*on(click|change|input|keydown|submit|dragstart|dragend|dragover|dragleave|drop)[ \t]*=/gi;
const ORA_NOT_BOUNDARY = /[A-Za-z0-9_.\-]/;
const ORA_NAME_RE = /([A-Za-z_][A-Za-z0-9_]*)[ \t]*[(]/g;
const ORA_EXCLUDE = new Set(['if', 'getElementById']);
const ORA_IDENT = '[A-Za-z_][A-Za-z0-9_]*';
const ORA_DEF_RES = [
  new RegExp('(?:^|\\n)(?:async[ \\t]+)?function[ \\t]+(' + ORA_IDENT + ')[ \\t]*[(]', 'g'),
  new RegExp('(?:^|\\n)(?:const|let|var)[ \\t]+(' + ORA_IDENT + ')[ \\t]*=', 'g'),
  new RegExp('(?:^|\\n)(' + ORA_IDENT + ')[ \\t]*=[ \\t]*(?:async[ \\t]+)?function\\b', 'g'),
  new RegExp('(?:^|\\n)(' + ORA_IDENT + ')[ \\t]*=[ \\t]*(?:async[ \\t]+)?([^()\\n]{0,80})=>', 'g'),
  new RegExp('(?:^|\\n)(' + ORA_IDENT + ')[ \\t]*=[ \\t]*' + ORA_IDENT + '[ \\t]*;[ \\t]*(?=\\n)', 'g'),
];

function oraMatches(re, text) {
  const r = re.global ? re : new RegExp(re.source, re.flags + 'g');
  r.lastIndex = 0;
  return Array.from(text.matchAll(r));
}

function oraNames(value) {
  const out = new Set();
  for (const m of oraMatches(ORA_NAME_RE, value)) {
    if (!ORA_EXCLUDE.has(m[1])) out.add(m[1]);
  }
  return out;
}

function oraCollectHandlers(fragment, names, counts) {
  let occurrences = 0;
  for (const m of oraMatches(ORA_HANDLER_RE, fragment)) {
    const prev = m.index === 0 ? ' ' : fragment[m.index - 1];
    if (ORA_NOT_BOUNDARY.test(prev)) continue; // .onclick= / data-onclick=
    const value = m[2] !== undefined ? m[2] : m[3];
    occurrences += 1;
    const key = 'on' + m[1].toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
    for (const n of oraNames(value)) names.add(n);
  }
  return occurrences;
}

/**
 * Analisis independiente completo del documento.
 * @param {string} text documento LF-normalizado
 * @returns {object} derivacion oraculo completa
 */
function analyzeOracle(text) {
  // 1) Rangos de script por EMPAREJAMIENTO regex (los scripts no anidan).
  const opens = oraMatches(ORA_OPEN_RE, text);
  const closes = oraMatches(ORA_CLOSE_RE, text);
  assert.equal(opens.length, closes.length, 'oraculo: scripts abiertos sin cierre');
  const ranges = opens.map((o, i) => ({
    openStart: o.index,
    openEnd: o.index + o[0].length,
    closeStart: closes[i].index,
    closeEnd: closes[i].index + closes[i][0].length,
    hasSrc: ORA_SRC_RE.test(o[0]),
  }));
  for (const r of ranges) assert.ok(r.closeStart >= r.openEnd, 'oraculo: rango invalido');

  // 2) HTML real = texto fuera de TODOS los rangos de script.
  const htmlParts = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.openStart > cursor) htmlParts.push(text.slice(cursor, r.openStart));
    cursor = r.closeEnd;
  }
  if (cursor < text.length) htmlParts.push(text.slice(cursor));
  const htmlText = htmlParts.join('');

  // 3) Handlers estaticos (HTML) y de templates (cuerpos inline).
  const staticNames = new Set();
  const staticCounts = {};
  const staticOcc = oraCollectHandlers(htmlText, staticNames, staticCounts);
  const tplNames = new Set();
  const tplCounts = {};
  let tplOcc = 0;
  let jsOn = 0;
  for (const r of ranges) {
    if (r.hasSrc) continue;
    const body = text.slice(r.openEnd, r.closeStart);
    tplOcc += oraCollectHandlers(body, tplNames, tplCounts);
    jsOn += oraMatches(ORA_JSON_RE, body).length;
  }

  // 4) Definiciones top-level (columna 0) con patrones propios.
  const defined = new Set();
  for (const re of ORA_DEF_RES) {
    for (const m of oraMatches(re, text)) defined.add(m[1]);
  }

  // 5) REQUIRED = (estaticos U templates) con definicion top-level.
  const union = new Set([...staticNames, ...tplNames]);
  const required = Array.from(union).filter((n) => defined.has(n)).sort();

  return {
    scriptCount: ranges.length,
    inlineCount: ranges.filter((r) => !r.hasSrc).length,
    externalCount: ranges.filter((r) => r.hasSrc).length,
    staticNames: Array.from(staticNames).sort(),
    staticCounts,
    staticOcc,
    tplNames: Array.from(tplNames).sort(),
    tplCounts,
    tplOcc,
    jsOn,
    defined,
    required,
  };
}

// ---------------------------------------------------------------------------
// Cache de analisis (extractor v3 + oraculo + contrato embebido)
// ---------------------------------------------------------------------------

let _cache = null;
function analyzed() {
  if (!_cache) {
    const raw = fs.readFileSync(POS_INDEX, 'utf8');
    const text = raw.replace(/\r\n?/g, '\n');
    const lines = loadPosLines(text);
    const scripts = posScriptRanges(lines);
    const boundary = posStaticBoundary(scripts);
    const staticH = posStaticHandlerNames(lines, scripts);
    const templateH = posTemplateHandlerNames(lines, scripts);
    const defs = posDefinitions(lines);
    const defNames = new Set(defs.map((d) => d.name));
    const required = posRequiredGlobals(staticH.names, templateH.names)
      .filter((n) => defNames.has(n));
    const winners = posOverrideWinners(defs);
    const entry = posEntrySequence(lines);
    const sheetjsGuards = posSheetJsGuards(lines);
    const styles = posStyleRealBlocks(lines, scripts);
    const crossCheck = crossCheckVsStaticParse(lines);
    const oracle = analyzeOracle(text);
    const legacySrc = fs.readFileSync(LEGACY_GLOBALS, 'utf8');
    const embeddedRequired = parseFreezeArray(legacySrc, 'REQUIRED_GLOBALS');
    const embeddedWinners = parseFreezeArray(legacySrc, 'OVERRIDE_WINNERS');
    _cache = {
      text, lines, scripts, boundary, staticH, templateH, defs, defNames,
      required, winners, entry, sheetjsGuards, styles, crossCheck, oracle,
      embeddedRequired, embeddedWinners,
    };
  }
  return _cache;
}

// ---------------------------------------------------------------------------
// T1 — T9
// ---------------------------------------------------------------------------

test('T1 blob canonico: disco LF-norm y git rev-parse === 2dec6363', () => {
  const rev = gitString(['rev-parse', 'HEAD:CVV2.4_backup_antes_demo-1.html']);
  assert.equal(rev, PRODUCT_BLOB);
  const disk = fs.readFileSync(CANONICAL);
  const lf = disk.toString('utf8').replace(/\r\n?/g, '\n');
  assert.equal(gitBlobSha1(Buffer.from(lf, 'utf8')), PRODUCT_BLOB);
});

test('T2 index untouched: sha256 disco === git show HEAD:POS/index.html', () => {
  const disk = fs.readFileSync(POS_INDEX);
  const git = gitBuffer('HEAD:POS/index.html');
  assert.equal(sha256Buffer(disk), sha256Buffer(git));
});

test('T3 scriptRanges 19 + typeModule 0 + boundary estructural + crossCheck', () => {
  const a = analyzed();
  assert.equal(a.scripts.length, 19);
  assert.equal(a.scripts.filter((s) => s.src == null).length, 18);
  assert.equal(a.scripts.filter((s) => s.src != null).length, 1);
  assert.equal(a.scripts.filter((s) => s.typeModule).length, 0);
  assert.equal(a.scripts[0].src, SHEETJS_CDN);
  assert.equal(a.scripts[0].defer, true);
  const derivedBoundary = a.scripts
    .filter((s) => s.src == null)
    .reduce((m, s) => (m === null || s.startLine < m ? s.startLine : m), null);
  assert.equal(a.boundary, derivedBoundary, 'boundary = min startLine sin src');
  assert.ok(a.boundary > 0);
  assert.equal(a.crossCheck.match, true, 'scanTags v3 === parser por linea (19)');
  assert.equal(a.crossCheck.robustCount, 19);
  assert.equal(a.crossCheck.staticCount, 19);
  assert.deepEqual(a.crossCheck.diffs, []);
  // El oraculo (regex-pairing independiente) ve los mismos 19/18/1.
  assert.equal(a.oracle.scriptCount, 19);
  assert.equal(a.oracle.inlineCount, 18);
  assert.equal(a.oracle.externalCount, 1);
});

test('T4 staticos FULL-DOCUMENT: extractor === oraculo + PINES v3 presentes', () => {
  const a = analyzed();
  // Acuerdo extractor v3 vs oraculo independiente (nombres y conteos).
  assert.deepEqual(a.staticH.names, a.oracle.staticNames, 'static names extractor !== oraculo');
  assert.deepEqual(a.staticH.counts, a.oracle.staticCounts, 'static counts extractor !== oraculo');
  assert.equal(a.staticH.occurrences, a.oracle.staticOcc, 'static occ extractor !== oraculo');
  assert.equal(a.staticH.unquoted, 0, 'POS real no usa valores unquoted');
  // Conciliacion documentada (criterio, no oraculo): los valores emergen arriba.
  assert.equal(a.staticH.names.length, EXPECTED_STATIC_NAMES);
  assert.equal(a.staticH.occurrences, EXPECTED_STATIC_OCC);
  // Los 9 omitidos por v2 estan en el HTML estatico (post-scripts).
  for (const pin of PINS_V3_NEW) {
    assert.ok(a.staticH.names.includes(pin), 'PIN v3 ausente en staticos: ' + pin);
  }
  // Full-document REAL: hay HTML estatico con handlers ENTRE scripts,
  // despues del primer script inline y fuera de todos los rangos script.
  const firstInlineIndex = a.scripts.findIndex((s) => s.src == null);
  const betweenNames = new Set();
  let betweenQuoted = 0;
  for (let i = firstInlineIndex; i < a.scripts.length - 1; i += 1) {
    const current = a.scripts[i];
    const next = a.scripts[i + 1];
    const betweenScan = scanHandlerAttrs(a.text.slice(current.endOffset, next.startOffset));
    betweenQuoted += betweenScan.quoted;
    betweenScan.names.forEach((name) => betweenNames.add(name));
  }
  assert.ok(betweenQuoted > 0, 'debe haber handlers estaticos entre scripts tras el primero');
  for (const pin of PINS_V3_NEW) {
    assert.ok(betweenNames.has(pin), 'PIN v3 debe estar en el HTML entre scripts: ' + pin);
  }
});

test('T5 templates: extractor === oraculo + 8 verificados + ticketZoneDrop', () => {
  const a = analyzed();
  assert.deepEqual(a.templateH.names, a.oracle.tplNames, 'tpl names extractor !== oraculo');
  assert.deepEqual(a.templateH.counts, a.oracle.tplCounts, 'tpl counts extractor !== oraculo');
  assert.equal(a.templateH.occurrences, a.oracle.tplOcc, 'tpl occ extractor !== oraculo');
  assert.equal(a.templateH.jsOnAssignments, a.oracle.jsOn, 'jsOn extractor !== oraculo');
  assert.equal(a.templateH.names.length, EXPECTED_TEMPLATE_NAMES);
  assert.equal(a.templateH.occurrences, EXPECTED_TEMPLATE_OCC);
  for (const name of TEMPLATE_REQUIRED_8) {
    assert.ok(a.templateH.names.includes(name), 'template handler faltante: ' + name);
    assert.ok(a.defNames.has(name), 'template handler sin definicion: ' + name);
  }
  assert.ok(a.templateH.names.includes('ticketZoneDrop'));
});

test('T6 REQUIRED: triple acuerdo extractor===oraculo===embebido + sensibilidad', () => {
  const a = analyzed();
  const derivado = a.required.slice().sort();
  const oraculo = a.oracle.required.slice().sort();
  const embebido = a.embeddedRequired.slice().sort();

  // Acuerdo triple SIN numero magico: el conteo emerge de las listas.
  assert.deepEqual(oraculo, derivado, 'oraculo !== derivado');
  assert.deepEqual(embebido, derivado, 'embebido !== derivado');
  assert.equal(embebido.length, derivado.length);
  assert.equal(oraculo.length, derivado.length);

  // Todo required tiene definicion top-level segun extractor Y oraculo.
  const sinDef = derivado.filter((n) => !a.defNames.has(n));
  assert.deepEqual(sinDef, []);
  const sinDefOra = derivado.filter((n) => !a.oracle.defined.has(n));
  assert.deepEqual(sinDefOra, []);

  // PINES completos: los 5 de la clase de truncamiento v2 + los 9 v3.
  for (const pin of PINS_ALL) {
    assert.ok(derivado.includes(pin), 'PIN ausente en required: ' + pin);
    assert.ok(oraculo.includes(pin), 'PIN ausente en oraculo: ' + pin);
    assert.ok(embebido.includes(pin), 'PIN ausente en embebido: ' + pin);
  }

  // SENSIBILIDAD: al remover un global real (rename total en una copia),
  // el oraculo lo detecta: deja de estar y aparece el mutante. Sin circularidad.
  for (const pin of [...PINS_V3_NEW.slice(0, 3), 'securityUnlock']) {
    const mutated = a.text.split(pin).join('zzMutant' + pin.slice(0, 1));
    const om = analyzeOracle(mutated);
    assert.equal(om.required.includes(pin), false, 'mutante no detectado: ' + pin);
  }

  // Conciliacion documentada (criterio, no fuente).
  assert.equal(derivado.length, EXPECTED_REQUIRED);

  // overrideWinners embebidos === congelados F6 (28).
  assert.equal(a.embeddedWinners.length, 28);
  assert.deepEqual(a.embeddedWinners, FROZEN_28);
});

test('T7 los 28 congelados: defs===count y winner=ultima', () => {
  const a = analyzed();
  const byName = new Map(a.winners.map((w) => [w.name, w]));
  for (const frozen of FROZEN_28) {
    const w = byName.get(frozen.name);
    assert.ok(w, 'override winner faltante: ' + frozen.name);
    assert.equal(w.count, frozen.count, frozen.name + ' defs !== ' + frozen.count);
    assert.equal(w.winner, w.definedAt[w.definedAt.length - 1]);
  }
});

test('T8 script texts byte-exact: 18 inline disco === git HEAD:POS === canonico', () => {
  const a = analyzed();
  const diskTexts = inlineScriptTexts(a.lines, a.scripts);
  assert.equal(diskTexts.length, 18);
  const gitPosLines = loadPosLines(gitBuffer('HEAD:POS/index.html').toString('utf8'));
  const gitPosTexts = inlineScriptTexts(gitPosLines, posScriptRanges(gitPosLines));
  const canonLines = loadPosLines(gitBuffer('HEAD:CVV2.4_backup_antes_demo-1.html').toString('utf8'));
  const canonTexts = inlineScriptTexts(canonLines, posScriptRanges(canonLines));
  assert.equal(gitPosTexts.length, 18);
  assert.equal(canonTexts.length, 18);
  for (let i = 0; i < 18; i += 1) {
    assert.equal(diskTexts[i], gitPosTexts[i], 'inline ' + i + ': disco vs git');
    assert.equal(diskTexts[i], canonTexts[i], 'inline ' + i + ': disco vs canonico');
  }
});

test('T9 entrySequence: 16 tokens exactos', () => {
  const a = analyzed();
  assert.deepEqual(a.entry.sequence, ENTRY_SEQUENCE_16);
});

test('T10 V10 dormant + storage 20/5/9 + _NA_SNAPSHOT_KEY', () => {
  const a = analyzed();
  const globals = parseGlobalDecls(a.lines);
  const storage = parseStorageStatic(a.lines, a.text);
  const v10 = parseV10Dormancy(a.lines, a.scripts, a.defs, globals);
  assert.equal(v10.dormant, true);
  assert.equal(storage.localStorage.length, 20);
  assert.equal(storage.sessionStorage.length, 5);
  assert.equal(storage.legacy.length, 9);
  assert.equal(storage.constants._NA_SNAPSHOT_KEY, 'snapshot_v9');
});

test('T11 vm sandbox no-financiero: legacy-globals.js + app.js sin tocar storage', () => {
  const a = analyzed();
  const legacySrc = fs.readFileSync(LEGACY_GLOBALS, 'utf8');
  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  const forbiddenExact = new Set(['localStorage', 'sessionStorage', 'indexedDB', 'saveAllData', 'loadAllData', '_naRunCriticalOperation']);
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
    set(t, key, value) {
      t[key] = value;
      return true;
    },
  });
  let domContentLoadedListener = null;
  const document = {
    addEventListener(evt, fn) {
      if (evt === 'DOMContentLoaded') domContentLoadedListener = fn;
    },
  };
  const location = { protocol: 'file:' };
  const sandbox = {
    window: windowProxy,
    document,
    location,
    console: { warn() {}, log() {}, error() {} },
  };
  vm.createContext(sandbox);
  assert.doesNotThrow(() => {
    vm.runInContext(legacySrc, sandbox, { filename: 'legacy-globals.js' });
    vm.runInContext(appSrc, sandbox, { filename: 'app.js' });
  });
  const boot = windowProxy._NA_BOOT;
  assert.ok(boot);
  assert.equal(boot.phase, 'f6');
  assert.equal(boot.connected, false);
  assert.equal(boot.fileProtocol, true);
  const legacy = windowProxy._NA_LEGACY_GLOBALS;
  assert.ok(legacy);
  const fakeWinTodos = {};
  for (const name of a.required) fakeWinTodos[name] = function () {};
  const r1 = legacy.verify(fakeWinTodos);
  assert.equal(r1.ok, true);
  assert.equal(r1.missing.length, 0);
  const removed = a.required[0];
  const fake2 = Object.assign({}, fakeWinTodos);
  delete fake2[removed];
  const r2 = legacy.verify(fake2);
  assert.equal(r2.ok, false);
  assert.equal(r2.missing.length, 1);
  assert.equal(r2.missing[0], removed);
  const lexicalName = a.required[0];
  const fakeWinSinProp = Object.assign({}, fakeWinTodos);
  delete fakeWinSinProp[lexicalName];
  const probe = (name) => name === lexicalName;
  const r3 = legacy.verify(fakeWinSinProp, probe);
  assert.equal(r3.ok, true);
  assert.deepEqual(Array.from(r3.lexical), [lexicalName]);
  assert.equal(boot.started, false);
  assert.ok(domContentLoadedListener);
  domContentLoadedListener();
  assert.equal(boot.started, true);
});

test('T12 file:// strategy: app.js detecta protocol; POS/js sin ES modules', () => {
  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  assert.ok(appSrc.includes('location.protocol === ' + String.fromCharCode(39) + 'file:' + String.fromCharCode(39)));
  for (const [label, src] of [
    ['app.js', appSrc],
    ['legacy-globals.js', fs.readFileSync(LEGACY_GLOBALS, 'utf8')],
  ]) {
    assert.equal(/\bimport\s/.test(src), false, label + ' sin import');
    assert.equal(/\bexport\s/.test(src), false, label + ' sin export');
  }
});

test('T13 sin boundary obsoleto en fuentes de tests/offline-compat', () => {
  const obsolete = '22' + '71';
  for (const f of [POS_PARSE, THIS_FILE]) {
    const src = fs.readFileSync(f, 'utf8');
    assert.equal(src.includes(obsolete), false, path.basename(f) + ' no debe contener el boundary obsoleto');
  }
});

test('T14 0 bloques style reales + >=2 style en scripts', () => {
  const a = analyzed();
  assert.equal(a.styles.realBlocks.length, 0);
  assert.ok(a.styles.styleInScripts >= 2);
});

test('T15 evidence determinista y ANCLADA: digests 3-vias + doble corrida', () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const LEGACY_ALL_LINES_RE = /\bon(click|change|input|keydown|submit|dragstart|dragend|dragover|dragleave|drop)[ \t]*=/gi;

  const build = () => {
    const a = analyzed();
    const baseCommit = gitString(['rev-parse', 'HEAD']);
    const sourceBlob = gitString(['rev-parse', 'HEAD:POS/index.html']);
    const posIndexSha256 = sha256Buffer(fs.readFileSync(POS_INDEX));
    const legacyAll = Array.from(a.text.match(new RegExp(LEGACY_ALL_LINES_RE.source, 'gi'))).length;
    const realTotal = a.staticH.occurrences + a.templateH.occurrences;

    const digests = {
      extractor: sha256Json(a.required),
      oracle: sha256Json(a.oracle.required),
      finalGlobals: sha256Json(a.embeddedRequired),
    };

    const inventory = {
      productBlob: PRODUCT_BLOB,
      sourceBlob,
      posIndexSha256,
      baseCommit,
      source: 'POS/index.html',
      derivation: 'F6-ARC-0 v3 full-document (scanTags v3; HTML fuera de TODOS los scripts; .on*= JS excluidas)',
      boundary: a.boundary,
      static: {
        count: a.staticH.names.length,
        names: a.staticH.names,
        counts: a.staticH.counts,
        occurrences: a.staticH.occurrences,
        unquoted: a.staticH.unquoted,
      },
      template: {
        count: a.templateH.names.length,
        names: a.templateH.names,
        counts: a.templateH.counts,
        occurrences: a.templateH.occurrences,
        jsOnAssignments: a.templateH.jsOnAssignments,
      },
      required: { count: a.required.length, names: a.required },
      delta: {
        before: { staticNames: 90, templateNames: 90, requiredGlobals: 168, legacyAllLines: 372 },
        after: {
          staticNames: a.staticH.names.length,
          templateNames: a.templateH.names.length,
          requiredGlobals: a.required.length,
          legacyAllLines: legacyAll,
          realHandlerTotal: realTotal,
          jsOnAssignmentsExcluded: a.templateH.jsOnAssignments,
        },
        requiredAdded: PINS_V3_NEW,
        note: 'v3: discovery full-document anade los 9 globals omitidos por v2 (HTML posterior a los scripts); las 6 asignaciones JS .onclick= dejan de contarse como atributos HTML; identidad legacy = reales + jsOn.',
      },
    };

    const overrideWinners = {
      productBlob: PRODUCT_BLOB,
      baseCommit,
      fullCount: a.winners.length,
      full: a.winners.map((w) => ({ name: w.name, count: w.count, winner: w.winner })),
      frozen28Count: FROZEN_28.length,
      frozen28: FROZEN_28,
      note: 'frozen28 = referencia semantica congelada F6-ARC-0',
    };

    const xlsxScopeBlocked = {
      archivo: 'CVV2.4_backup_antes_demo-1.html / POS/index.html',
      caller: '_naReadProductImportFile',
      funcionInexistente: '_naParseXlsxBasic',
      causa: 'funcion jamas definida en el blob 2dec6363; defecto LEGACY PREEXISTENTE',
      impacto: 'import .xlsx sin CDN -> ReferenceError capturado por importProducts -> toast; sin corrupcion de datos; export degrada a CSV real',
      solucionPropuesta: 'definir _naParseXlsxBasic o fallback explicito; requiere modificar el canonico: decision del propietario',
      blocked: true,
    };

    const bootstrapContract = {
      productBlob: PRODUCT_BLOB,
      baseCommit,
      clauses: {
        A: '18 inline scripts ya ejecutados por el index.html actual (byte-exact, sin cambios)',
        B: 'app.js solo registra _NA_BOOT y ejecuta verify() typeof-only; no invoca negocio',
        C: 'los ' + a.required.length + ' REQUIRED_GLOBALS estan presentes en legacy-globals.js',
        D: 'NO ejecuta negocio / V10 / persistencia / storage',
        E: '18 inline documental + 2 scripts classic SIN defer al final del body (conexion FASE 7)',
        F: 'file:// OK con classic scripts; ES modules NO por origin null (FASE 4)',
        G: 'HTTP: classic + modules ambos funcionan',
        H: 'SheetJS export -> fallback CSV REAL; import .xlsx -> _naParseXlsxBasic INEXISTENTE (LEGACY_SCOPE_BLOCKED, ver xlsxScopeBlocked)',
      },
      sheetjsGuards: a.sheetjsGuards.map((g) => ({ line: g.line, fn: g.fn, derived: true })),
      xlsxScopeBlocked,
    };

    const report = {
      productBlob: PRODUCT_BLOB,
      sourceBlob,
      posIndexSha256,
      baseCommit,
      requiredGlobalsBefore: 168,
      requiredGlobalsAfter: a.embeddedRequired.length,
      digests,
      counts: {
        scripts: a.scripts.length,
        inlineScripts: a.scripts.filter((s) => s.src == null).length,
        externalScripts: a.scripts.filter((s) => s.src != null).length,
        typeModule: a.scripts.filter((s) => s.typeModule).length,
        boundary: a.boundary,
        staticNames: a.staticH.names.length,
        staticOccurrences: a.staticH.occurrences,
        templateNames: a.templateH.names.length,
        templateOccurrences: a.templateH.occurrences,
        jsOnAssignmentsExcluded: a.templateH.jsOnAssignments,
        realHandlerTotal: realTotal,
        legacyAllLines: legacyAll,
        requiredGlobals: a.required.length,
        overrideWinnersFull: a.winners.length,
        overrideWinnersFrozen: FROZEN_28.length,
        entrySequence: a.entry.sequence.length,
        styleRealBlocks: a.styles.realBlocks.length,
        styleInScripts: a.styles.styleInScripts,
      },
      MISSING_GLOBALS: [],
      CLASSIC_SCRIPT_REQUIRED: 'YES',
      ES_MODULE_RUNTIME_NOW: 'NO',
    };

    return { inventory, overrideWinners, bootstrapContract, report };
  };

  const files = ['inventory.json', 'override-winners.json', 'bootstrap-contract.json', 'report.json'];
  const writeAll = (b) => {
    for (const [name, data] of [
      ['inventory.json', b.inventory],
      ['override-winners.json', b.overrideWinners],
      ['bootstrap-contract.json', b.bootstrapContract],
      ['report.json', b.report],
    ]) {
      fs.writeFileSync(path.join(EVIDENCE_DIR, name), stableStringify(data) + '\n');
    }
  };

  const b1 = build();
  writeAll(b1);
  const h1 = files.map((f) => sha256Buffer(fs.readFileSync(path.join(EVIDENCE_DIR, f))));
  const b2 = build();
  writeAll(b2);
  const h2 = files.map((f) => sha256Buffer(fs.readFileSync(path.join(EVIDENCE_DIR, f))));
  assert.deepEqual(h2, h1, 'evidence debe ser byte-identica entre corridas');

  for (const f of files) {
    const json = fs.readFileSync(path.join(EVIDENCE_DIR, f), 'utf8');
    assert.equal(/updatedAt|createdAt|timestamp|Date\(|ISOString|\d{4}-\d{2}-\d{2}T/.test(json), false, f + ' sin timestamps');
    JSON.parse(json);
  }

  const rep = b2.report;
  // El valor after EMERGE de las listas derivadas (no se fija como oraculo).
  assert.equal(rep.requiredGlobalsAfter, b2.inventory.required.count);
  assert.equal(rep.requiredGlobalsAfter, a0().embeddedRequired.length);
  // Anclaje: digests de las tres fuentes deben coincidir.
  assert.equal(rep.digests.extractor, rep.digests.oracle, 'digest extractor !== oracle');
  assert.equal(rep.digests.extractor, rep.digests.finalGlobals, 'digest extractor !== finalGlobals');
  // Identidad estructural: reales + jsOn === conteo legacy directo.
  assert.equal(rep.counts.realHandlerTotal + rep.counts.jsOnAssignmentsExcluded, rep.counts.legacyAllLines);
  // Anclaje de fuente.
  assert.equal(rep.sourceBlob, gitString(['rev-parse', 'HEAD:POS/index.html']));
  assert.deepEqual(rep.MISSING_GLOBALS, []);
  assert.equal(rep.CLASSIC_SCRIPT_REQUIRED, 'YES');
  assert.equal(rep.ES_MODULE_RUNTIME_NOW, 'NO');

  const blocked = b2.bootstrapContract.xlsxScopeBlocked;
  assert.equal(blocked.funcionInexistente, '_naParseXlsxBasic');
  assert.equal(blocked.caller, '_naReadProductImportFile');
  assert.equal(blocked.blocked, true);
  for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    assert.equal(typeof b2.bootstrapContract.clauses[letter], 'string', 'clause ' + letter);
  }
});

function a0() {
  return analyzed();
}

test('T16 completitud full-document: 14 PINES + isValidName + rechazo inyeccion', () => {
  const a = analyzed();
  const legacySrc = fs.readFileSync(LEGACY_GLOBALS, 'utf8');
  const target = {};
  const sandbox = {
    window: target,
    document: { addEventListener() {} },
    location: { protocol: 'file:' },
    console: { warn() {}, log() {}, error() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(legacySrc, sandbox, { filename: 'legacy-globals.js' });
  const legacy = target._NA_LEGACY_GLOBALS;
  assert.ok(legacy);
  assert.equal(typeof legacy.isValidName, 'function');
  for (const pin of PINS_ALL) {
    assert.ok(a.required.includes(pin), 'PIN ausente: ' + pin);
    assert.ok(a.oracle.required.includes(pin), 'PIN ausente oraculo: ' + pin);
    assert.ok(a.embeddedRequired.includes(pin), 'PIN ausente embebido: ' + pin);
  }
  assert.ok(a.required.includes('cerrarModal'));
  assert.ok(a.required.includes('_naEsc'));
  assert.equal(a.required.length, a.oracle.required.length);
  assert.equal(a.required.length, a.embeddedRequired.length);
  assert.equal(legacy.isValidName('cerrarModal'), true);
  assert.equal(legacy.isValidName('_naEsc'), true);
  for (const name of a.embeddedRequired) {
    assert.equal(legacy.isValidName(name), true, 'nombre invalido: ' + name);
  }
  assert.equal(legacy.isValidName('if;alert(1)'), false);
  assert.equal(legacy.isValidName(''), false);
});

test('T17 fallbacks: _naParseXlsxBasic sigue LEGACY_SCOPE_BLOCKED (exacto)', () => {
  const a = analyzed();
  assert.ok(a.sheetjsGuards.length >= SHEETJS_GUARDS_MIN,
    'sheetjsGuards=' + a.sheetjsGuards.length + ' < ' + SHEETJS_GUARDS_MIN);
  for (const g of a.sheetjsGuards) {
    assert.equal(typeof g.line, 'number');
    assert.ok(g.line > 0);
    assert.equal(typeof g.fn, 'string');
    assert.match(g.fn, /^[A-Za-z_][A-Za-z0-9_]*$/);
    assert.match(a.lines[g.line - 1], /typeof\s+XLSX/);
  }
  const fullText = a.lines.join('\n');
  const called = new Set();
  const callRe = /\b(_na[A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = callRe.exec(fullText)) !== null) called.add(m[1]);
  const definedSet = new Set();
  let dm;
  const declRe = /\bfunction\s+(_na[A-Za-z0-9_]*)\b/g;
  while ((dm = declRe.exec(fullText)) !== null) definedSet.add(dm[1]);
  const cdRe = /\b(?:const|let|var)\s+(_na[A-Za-z0-9_]*)\b/g;
  while ((dm = cdRe.exec(fullText)) !== null) definedSet.add(dm[1]);
  const asRe = /(?:^|[;\n])\s*(_na[A-Za-z0-9_]*)\s*=(?!=|>)/gm;
  while ((dm = asRe.exec(fullText)) !== null) definedSet.add(dm[1]);
  const undefinedFallbacks = Array.from(called).filter((n) => !definedSet.has(n)).sort();
  assert.deepEqual(undefinedFallbacks, ['_naParseXlsxBasic'],
    'unico _na* invocado-y-no-definido permitido: el defecto legado');
  // XLSX_SCOPE_BLOCKED permanece documentado en la evidencia (T15 lo escribe).
  const contract = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, 'bootstrap-contract.json'), 'utf8'));
  assert.equal(contract.xlsxScopeBlocked.blocked, true);
  assert.equal(contract.clauses.H.includes('LEGACY_SCOPE_BLOCKED'), true);
});

test('T18 matriz adversarial F1-F12 + caso Codex: scanTags v3 estructural', () => {
  const BT = String.fromCharCode(96);   // backtick
  const LB = String.fromCharCode(123);  // {
  const RB = String.fromCharCode(125);  // }
  const DOL = String.fromCharCode(36);  // $

  // F1: <script> multilinea. El robusto ve 1 bloque; el por-linea 0.
  const F1 = '<script\n  src="lib.js"\n  defer>\n</script>';
  const f1 = scanTags(F1).scriptRangesRobust;
  assert.equal(f1.length, 1);
  assert.equal(f1[0].startLine, 1);
  assert.equal(f1[0].endLine, 4);
  assert.equal(f1[0].src, 'lib.js');
  assert.equal(f1[0].defer, true);
  assert.equal(parseScriptBlocks(loadPosLines(F1)).length, 0, 'F1 por-linea falla (0)');

  // F2: strings JS con <script> y </script> dentro.
  const F2 = ['<script>', 'var a = ' + String.fromCharCode(39) + '<script>fake</script>' + String.fromCharCode(39) + ';', 'var b = 1;', '</script>'].join('\n');
  const f2 = scanTags(F2).scriptRangesRobust;
  assert.equal(f2.length, 1);
  assert.equal(f2[0].endLine, 4);
  assert.equal(parseScriptBlocks(loadPosLines(F2)).length, 2, 'F2 por-linea falla (2)');

  // F3: <style> dentro de template literal.
  const F3 = '<script>var t = ' + BT + '<style>.x{color:red}</style>' + BT + '; ok();</script>';
  const f3 = scanTags(F3);
  assert.equal(f3.scriptRangesRobust.length, 1);
  assert.equal(f3.styleRangesRobust.length, 0);

  // F4: </script> dentro de template literal.
  const F4 = ['<script>', 'var t = ' + BT + 'text </script> more' + BT + ';', 'after();', '</script>'].join('\n');
  const f4 = scanTags(F4).scriptRangesRobust;
  assert.equal(f4.length, 1);
  assert.equal(f4[0].endLine, 4);
  const f4s = parseScriptBlocks(loadPosLines(F4));
  assert.equal(f4s[0].endLine, 2, 'F4 por-linea cierra prematuro (linea 2)');

  // F5: > dentro de atributo quoted (no cierra el tag de apertura).
  const F5 = '<script id="s>a" >var y=1;</script>';
  const f5 = scanTags(F5).scriptRangesRobust;
  assert.equal(f5.length, 1);
  assert.equal(f5[0].id, 's>a');
  // F5b: en valores de handler, > quoted no rompe la extraccion.
  const f5b = scanHandlerAttrs('<div oninput="if(a>b)go()"></div>');
  assert.equal(f5b.quoted, 1);
  assert.ok(f5b.names.has('go'));

  // F6: comentario HTML con <script> fantasma.
  const F6 = '<!-- <script>ghost()</script> -->\n<script>real();</script>';
  const f6 = scanTags(F6).scriptRangesRobust;
  assert.equal(f6.length, 1, 'el script fantasma del comentario NO es bloque');
  assert.equal(f6[0].startLine, 2);

  // F7: style citado en string JS (no template) tampoco es bloque real.
  const F7 = '<script>var s = "<style>x</style>";ok();</script>';
  const f7 = scanTags(F7);
  assert.equal(f7.scriptRangesRobust.length, 1);
  assert.equal(f7.styleRangesRobust.length, 0);

  // F8: uppercase SCRIPT/STYLE.
  const F8 = '<SCRIPT>var z=1;</SCRIPT>';
  assert.equal(scanTags(F8).scriptRangesRobust.length, 1, 'SCRIPT uppercase');
  const F8b = '<STYLE>p{color:red}</STYLE>';
  assert.equal(scanTags(F8b).styleRangesRobust.length, 1, 'STYLE uppercase');

  // F9: Annex B. <!-- comentara hasta EOL (incluido un </script> interno);
  // --> al inicio de linea tambien comentara esa linea. El bloque NO se cierra.
  const F9 = ['<script>', 'var a=1;', '<!-- hidden </script> inside', 'var b=2;', '-->', 'var c=3;', '</script>'].join('\n');
  const f9 = scanTags(F9).scriptRangesRobust;
  assert.equal(f9.length, 1, 'F9 Annex B no debe cerrar en comentario');
  assert.equal(f9[0].endLine, 7, 'F9 cierre en el </script> real (linea 7)');

  // F10: atributo unquoted en tag de apertura y handler unquoted contado aparte.
  const F10 = '<script src=lib.js>x();</script>';
  const f10 = scanTags(F10).scriptRangesRobust;
  assert.equal(f10.length, 1);
  assert.equal(f10[0].src, 'lib.js');
  const f10b = scanHandlerAttrs('<button onclick=go()>A</button>');
  assert.equal(f10b.quoted, 0);
  assert.equal(f10b.unquoted, 1);
  assert.ok(f10b.names.has('go'));

  // F11: atributos multilinea (varios atributos en lineas distintas).
  const F11 = '<script\n  data-a="1"\n  data-b="2">\nx();\n</script>';
  const f11 = scanTags(F11).scriptRangesRobust;
  assert.equal(f11.length, 1);
  assert.equal(f11[0].startLine, 1);
  assert.equal(f11[0].endLine, 5, 'F11: cierre en linea 5');

  // F12: asignacion JS .onclick= NO es atributo HTML.
  const F12 = 'ok.onclick=function(){}; overlay.onclick=e=>{}; cancel.onclick=null;';
  const f12 = scanHandlerAttrs(F12);
  assert.equal(f12.quoted, 0, 'F12: ninguna asignacion .onclick= cuenta');
  assert.equal(f12.unquoted, 0);
  assert.equal(f12.names.size, 0);

  // Caso Codex: regex literal con backtick en clase tras if (ok).
  const FC = '<script>\nif (ok) /[' + BT + ']/.test(x);\nvar keep=1;\n</script>';
  const fc = scanTags(FC).scriptRangesRobust;
  assert.equal(fc.length, 1, 'caso Codex: el script debe detectarse');
  assert.equal(fc[0].endLine, 4, 'caso Codex: cierre en linea 4 (regex intacta)');
});

test('T19 ondrop/ticketZoneDrop + regresion .onclick= JS no es atributo', () => {
  const a = analyzed();
  // ondrop vive en los templates del POS real (v3 lo cuenta alli).
  assert.equal(a.staticH.counts.ondrop || 0, 0);
  assert.equal(a.templateH.counts.ondrop || 0, 1);
  for (const k of ['ondragstart', 'ondragend', 'ondragover', 'ondragleave', 'ondrop']) {
    assert.equal(a.templateH.counts[k] || 0, 1, k + ' debe contarse 1 vez en templates');
  }
  assert.ok(a.required.includes('ticketZoneDrop'));
  assert.ok(a.defNames.has('ticketZoneDrop'));

  // Regresion explicita: element.onclick= y request.onclick= NO son atributos.
  const doc = '<div onclick="a()"></div><script>el.onclick=b; el.onclick=c;</script>';
  const st = scanTags(doc);
  const html = scanHandlerAttrs(doc.slice(0, st.scriptRangesRobust[0].startOffset));
  assert.equal(html.quoted, 1, 'solo el atributo real del HTML cuenta');
  assert.ok(html.names.has('a'));
  const body = doc.slice(st.scriptRangesRobust[0].openEnd, st.scriptRangesRobust[0].closeOffset);
  const bodyH = scanHandlerAttrs(body);
  assert.equal(bodyH.quoted, 0, 'las .onclick= del cuerpo NO cuentan');
  assert.equal(bodyH.unquoted, 0);
  // En el POS real: 6 asignaciones .onclick= excluidas del total.
  assert.equal(a.templateH.jsOnAssignments, 6);
  assert.equal(a.staticH.occurrences + a.templateH.occurrences, EXPECTED_REAL_TOTAL);
});
