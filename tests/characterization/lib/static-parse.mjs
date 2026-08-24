// static-parse.mjs — deterministic, pure static parsers over the baseline fixture
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE
//
// Every parser here is pure: it takes the fixture text (or its line array) and
// returns a deterministic, order-stable object. No timestamps, no randomness,
// no I/O. The fixture is read once by the caller and split into lines once.

import { countLines, splitLines } from './extract-baseline.mjs';

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scan `lines` for a global regex, returning matches with 1-based line numbers.
 * @param {string[]} lines
 * @param {RegExp} regex (must be global)
 * @returns {{line:number, col:number, raw:string, groups:string[]}[]}
 */
export function scanLines(lines, regex) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      out.push({ line: i + 1, col: m.index, raw: m[0], groups: m.slice(1) });
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return out;
}

function findLineIndex(lines, needle) {
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(needle)) return i + 1; // 1-based
  }
  return -1;
}

function attr(raw, name) {
  const re = new RegExp(`${escapeRegExp(name)}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = re.exec(raw);
  return m ? m[1] : null;
}

function hasAttr(raw, name) {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(raw);
}

/**
 * Pair open/close tags in document order (tags never nest for scripts/styles).
 */
function pairTags(opens, closes) {
  const events = [
    ...opens.map((o) => ({ ...o, type: 'open' })),
    ...closes.map((c) => ({ ...c, type: 'close' })),
  ].sort((a, b) => a.line - b.line || a.col - b.col);

  const blocks = [];
  const stack = [];
  for (const ev of events) {
    if (ev.type === 'open') stack.push(ev);
    else {
      const open = stack.pop();
      if (open) blocks.push({ open, close: ev });
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// 1. Script blocks
// ---------------------------------------------------------------------------

export function parseScriptBlocks(lines) {
  const opens = scanLines(lines, /<script\b[^>]*>/gi);
  const closes = scanLines(lines, /<\/script>/gi);
  const blocks = pairTags(opens, closes);
  return blocks.map((b, index) => ({
    index,
    startLine: b.open.line,
    endLine: b.close.line,
    id: attr(b.open.raw, 'id'),
    src: attr(b.open.raw, 'src'),
    defer: hasAttr(b.open.raw, 'defer'),
    async: hasAttr(b.open.raw, 'async'),
    typeModule: /\btype\s*=\s*["']module["']/i.test(b.open.raw),
  }));
}

// ---------------------------------------------------------------------------
// 2. Style blocks (real DOM styles only — exclude those inside JS strings)
// ---------------------------------------------------------------------------

export function parseStyleBlocks(lines, scripts) {
  const opens = scanLines(lines, /<style\b[^>]*>/gi);
  const closes = scanLines(lines, /<\/style>/gi);
  const blocks = pairTags(opens, closes);
  const scriptRanges = scripts
    .filter((s) => s.src == null)
    .map((s) => [s.startLine, s.endLine]);

  const real = blocks.filter((b) => {
    const insideScript = scriptRanges.some(([s, e]) => b.open.line >= s && b.open.line <= e);
    return !insideScript;
  });

  return real.map((b, index) => ({
    index,
    startLine: b.open.line,
    endLine: b.close.line,
    id: attr(b.open.raw, 'id'),
  }));
}

// ---------------------------------------------------------------------------
// 3. DOM ids (static HTML vs JS templates)
// ---------------------------------------------------------------------------

const STATIC_HTML_BOUNDARY = 2271; // first <script> line — everything before is static markup

export function parseDomIds(lines) {
  const idRegex = /\bid\s*=\s*["']([^"']+)["']/g;
  const staticIds = new Set();
  let dynamicCount = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const re = new RegExp(idRegex.source, 'g');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      if (i + 1 < STATIC_HTML_BOUNDARY) staticIds.add(m[1]);
      else dynamicCount += 1;
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  const sorted = Array.from(staticIds).sort();
  return { staticIds: sorted, staticCount: sorted.length, dynamicTemplateIdCount: dynamicCount };
}

// ---------------------------------------------------------------------------
// 4. Buttons
// ---------------------------------------------------------------------------

export function parseButtons(lines) {
  const regex = /<button\b/gi;
  let staticCount = 0;
  let templateCount = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const re = new RegExp(regex.source, 'gi');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      if (i + 1 < STATIC_HTML_BOUNDARY) staticCount += 1;
      else templateCount += 1;
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return { staticCount, templateCount, totalCount: staticCount + templateCount };
}

// ---------------------------------------------------------------------------
// 5. Inline handlers
// ---------------------------------------------------------------------------

const HANDLER_ATTR = 'onclick|onchange|oninput|onkeydown|onsubmit|ondrag\\w*';

export function parseInlineHandlers(lines) {
  const counts = {};
  const attrRegex = new RegExp(`\\b(${HANDLER_ATTR})\\s*=`, 'gi');
  for (const line of lines) {
    const re = new RegExp(attrRegex.source, 'gi');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const name = m[1].toLowerCase();
      counts[name] = (counts[name] || 0) + 1;
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  // Function names referenced by handlers in STATIC HTML (lines < boundary).
  const staticNames = new Set();
  const handlerValueRegex = new RegExp(`\\b(?:${HANDLER_ATTR})\\s*=\\s*["']([^"']*)["']`, 'gi');
  const callRegex = /([A-Za-z_$][\w$]*)\s*\(/g;
  for (let i = 0; i < STATIC_HTML_BOUNDARY - 1 && i < lines.length; i += 1) {
    const line = lines[i];
    const re = new RegExp(handlerValueRegex.source, 'gi');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const value = m[1];
      const cr = new RegExp(callRegex.source, 'g');
      cr.lastIndex = 0;
      let cm;
      while ((cm = cr.exec(value)) !== null) {
        staticNames.add(cm[1]);
        if (cm.index === cr.lastIndex) cr.lastIndex += 1;
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  return { counts, totalOccurrences: Object.values(counts).reduce((a, b) => a + b, 0), staticHandlerFunctionNames: Array.from(staticNames).sort() };
}

// ---------------------------------------------------------------------------
// 6. innerHTML assignments
// ---------------------------------------------------------------------------

export function parseInnerHtml(lines) {
  const result = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/\.innerHTML\s*(\+=|=)/.test(lines[i])) result.push(i + 1);
  }
  return { count: result.length, lines: result };
}

// ---------------------------------------------------------------------------
// 7. External dependencies
// ---------------------------------------------------------------------------

export function parseExternalDeps(lines) {
  const links = [];
  const scripts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const linkRe = /<link\b[^>]*>/gi;
    let lm;
    while ((lm = linkRe.exec(line)) !== null) {
      const href = attr(lm[0], 'href');
      if (href && /^https?:\/\//i.test(href)) {
        links.push({ line: i + 1, href, rel: attr(lm[0], 'rel') });
      }
    }
    const scriptRe = /<script\b[^>]*>/gi;
    let sm;
    while ((sm = scriptRe.exec(line)) !== null) {
      const src = attr(sm[0], 'src');
      if (src && /^https?:\/\//i.test(src)) {
        scripts.push({ line: i + 1, src, defer: hasAttr(sm[0], 'defer'), async: hasAttr(sm[0], 'async') });
      }
    }
  }
  const external = [...links.map((l) => ({ tag: 'link', url: l.href, line: l.line })), ...scripts.map((s) => ({ tag: 'script', url: s.src, line: s.line }))];
  return { links, scripts, external };
}

// ---------------------------------------------------------------------------
// 8. Global declarations (top-level let/const/var at column 0)
// ---------------------------------------------------------------------------

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let inStr = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      cur += ch;
      if (ch === inStr && text[i - 1] !== '\\') inStr = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      cur += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      cur += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

export function parseGlobalDecls(lines) {
  const decls = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = /^(let|const|var)\s+/.exec(line);
    if (!m) continue;
    const kind = m[1];
    const rest = line.slice(m[0].length);
    const segments = splitTopLevel(rest);
    for (const seg of segments) {
      const nm = /^([A-Za-z_$][\w$]*)\s*(=.*)?$/.exec(seg.trim());
      if (!nm) continue;
      const init = nm[2] ? nm[2].slice(1).trim().slice(0, 160) : null;
      decls.push({ name: nm[1], kind, initSnippet: init, line: i + 1 });
    }
  }
  return decls;
}

// ---------------------------------------------------------------------------
// 9. Function definitions + override map
// ---------------------------------------------------------------------------

function matchFunctionDef(line, lineNo) {
  let m;
  if ((m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line))) {
    return { name: m[1], kind: 'function-decl', line: lineNo };
  }
  if ((m = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.exec(line))) {
    return { name: m[1], kind: 'arrow', line: lineNo };
  }
  if ((m = /^([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/.exec(line))) {
    return { name: m[1], kind: 'assign-function', line: lineNo };
  }
  if ((m = /^([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.exec(line))) {
    return { name: m[1], kind: 'arrow-assign', line: lineNo };
  }
  if ((m = /^([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$/.exec(line))) {
    return { name: m[1], kind: 'alias', line: lineNo };
  }
  return null;
}

export function parseFunctionDefs(lines) {
  const defs = [];
  for (let i = 0; i < lines.length; i += 1) {
    const d = matchFunctionDef(lines[i], i + 1);
    if (d) defs.push(d);
  }
  return defs;
}

function scriptBlockForLine(scripts, line) {
  for (const s of scripts) {
    if (s.src == null && line >= s.startLine && line <= s.endLine) return s;
  }
  return null;
}

function classifyDomain(name, blockId) {
  if (/^_naV10/.test(name)) return 'v10';
  const f = /^_naF(\d+)/.exec(name);
  if (f) return `fase${f[1]}`;
  if (blockId && blockId.startsWith('na-security')) return 'security-render';
  if (/^_naSec/.test(name)) return 'security-render';
  const kw = [
    [/caj|apertura|cierre/i, 'caja'],
    [/cli|cred|pago/i, 'clientes/creditos'],
    [/pos|venta|cobro|cart/i, 'venta'],
    [/inv|prod|stock|catalogo|imagen/i, 'inventario'],
    [/gas|gasto/i, 'gastos'],
    [/tk|print|ticket/i, 'ticket'],
    [/cfg|config/i, 'config'],
  ];
  for (const [re, domain] of kw) if (re.test(name)) return domain;
  return 'base';
}

export function buildOverrideMap(functions, scripts, lines, text) {
  const byName = new Map();
  for (const def of functions) {
    if (!byName.has(def.name)) byName.set(def.name, []);
    byName.get(def.name).push(def);
  }
  const map = {};
  for (const [name, defs] of byName) {
    if (defs.length < 2) continue;
    const sorted = [...defs].sort((a, b) => a.line - b.line);
    const finalImpl = sorted[sorted.length - 1];
    const finalBlock = scriptBlockForLine(scripts, finalImpl.line);
    const token = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
    const references = (text.match(token) || []).length;

    // handler attributes referencing this name in static HTML
    const attrNames = new Set();
    const handlerValueRegex = new RegExp(`\\b(?:${HANDLER_ATTR})\\s*=\\s*["']([^"']*)["']`, 'gi');
    for (let i = 0; i < STATIC_HTML_BOUNDARY - 1 && i < lines.length; i += 1) {
      const re = new RegExp(handlerValueRegex.source, 'gi');
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        if (new RegExp(`\\b${escapeRegExp(name)}\\b`).test(m[1])) attrNames.add(m[0].match(/\b(on\w+)\s*=/i)[1].toLowerCase());
        if (m.index === re.lastIndex) re.lastIndex += 1;
      }
    }

    // function defs whose definition line references this name (excluding self)
    const callerFunctions = new Set();
    for (const def of functions) {
      if (def.name === name) continue;
      if (lines[def.line - 1] && new RegExp(`\\b${escapeRegExp(name)}\\b`).test(lines[def.line - 1])) {
        callerFunctions.add(def.name);
      }
    }

    map[name] = {
      function: name,
      definedAt: sorted.map((d) => d.line),
      kinds: sorted.map((d) => d.kind),
      finalImplementation: finalImpl.line,
      finalKind: finalImpl.kind,
      finalBlock: finalBlock ? { index: finalBlock.index, id: finalBlock.id || null, startLine: finalBlock.startLine } : null,
      domain: classifyDomain(name, finalBlock ? finalBlock.id : null),
      references,
      callersStatic: {
        attributes: Array.from(attrNames).sort(),
        functions: Array.from(callerFunctions).sort(),
      },
    };
  }
  return map;
}

// ---------------------------------------------------------------------------
// 10. Startup (listeners + main entry sequence)
// ---------------------------------------------------------------------------

const CALL_NAME_REGEX = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?)\s*\(/g;

function extractCallNames(line) {
  const re = new RegExp(CALL_NAME_REGEX.source, 'g');
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(line)) !== null) {
    out.push(m[1].replace(/\s+/g, ''));
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

export function parseStartup(lines) {
  const listeners = [];
  const listenerRe = /addEventListener\s*\(\s*["'](DOMContentLoaded|load|beforeunload)["']/gi;
  for (let i = 0; i < lines.length; i += 1) {
    const re = new RegExp(listenerRe.source, 'gi');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      listeners.push({ event: m[1], line: i + 1 });
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  const mainEntryLine = findLineIndex(lines, "addEventListener('DOMContentLoaded',async");
  if (mainEntryLine === -1) {
    return { listeners, mainEntryLine: null, entrySequence: [], saveAllDataLine: null };
  }
  const chainLine = mainEntryLine + 2; // the single-line async body with the call chain
  const saveLine = mainEntryLine + 4; // `await saveAllData();`
  const entrySequence = extractCallNames(lines[chainLine - 1] || '');
  const saveSeq = extractCallNames(lines[saveLine - 1] || '');
  const hasSave = saveSeq.includes('saveAllData');
  if (hasSave) entrySequence.push('saveAllData');

  return { listeners, mainEntryLine, chainLine, saveAllDataLine: hasSave ? saveLine : null, entrySequence };
}

// ---------------------------------------------------------------------------
// 11. V10 dormancy
// ---------------------------------------------------------------------------

export function parseV10Dormancy(lines, scripts, functions, globals) {
  const commentLine = findLineIndex(lines, 'Nucleo V10 inactivo');
  let v10Start = 6120;
  if (commentLine !== -1) {
    const block = scriptBlockForLine(scripts, commentLine);
    if (block) v10Start = block.startLine;
  }

  const namePatterns = [/_naV10\w*/g, /\b_naRunCriticalOperation\b/g, /\b_naNewOperationId\b/g];
  // reference line numbers
  const refLines = new Set();
  const defSet = new Set();
  for (const def of functions) {
    if (/^_naV10/.test(def.name) || def.name === '_naRunCriticalOperation' || def.name === '_naNewOperationId') {
      defSet.add(def.name);
    }
  }
  for (const g of globals) {
    if (/^_naV10/.test(g.name)) defSet.add(g.name);
  }

  const text = lines.join('\n');
  for (const p of namePatterns) {
    const re = new RegExp(p.source, 'g');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const upto = text.slice(0, m.index);
      const line = countLines(upto) + 1;
      refLines.add(line);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  const externalRefs = Array.from(refLines).filter((l) => l < v10Start).sort((a, b) => a - b);

  const definitions = [];
  for (const name of Array.from(defSet).sort()) {
    const found = functions.filter((d) => d.name === name);
    if (found.length) definitions.push(...found.map((d) => ({ name, kind: d.kind, line: d.line })));
    else {
      const g = globals.find((x) => x.name === name);
      if (g) definitions.push({ name, kind: g.kind, line: g.line });
    }
  }
  definitions.sort((a, b) => a.line - b.line);

  return {
    dormant: externalRefs.length === 0,
    v10Start,
    commentLine,
    definitions,
    externalRefs,
    totalReferences: refLines.size,
  };
}

// ---------------------------------------------------------------------------
// 12. Storage inventory
// ---------------------------------------------------------------------------

const LOCAL_KEYS = [
  'na_snapshot_v9', 'na_snapshot_v10', 'na_snapshot_v10_signal', 'na_security_v26',
  'na_master_lock', 'na_readonly',
  'na_lock_productos', 'na_lock_ventas', 'na_lock_caja', 'na_lock_clientes',
  'na_lock_gastos', 'na_lock_importacion', 'na_lock_configuracion',
  'na_app_initialized_v1', 'na_seed_catalog_version', 'na_seed_catalog_suppressed',
  'na_cfg_category', 'na_cart_draft', 'na_pre_restore_snapshot_v1',
];
const SESSION_KEYS = [
  'na_snapshot_v9_session', 'na_pre_restore_snapshot_v1_session', 'na_security_locked',
  'na_v10_outbox', 'na_cart_draft',
];
const LEGACY_KEYS = [
  'na_productos', 'na_ventas', 'na_clientes', 'na_creditos', 'na_gastos',
  'na_cajMovs', 'na_cajEstado', 'na_app_state', 'na_cart',
];
const DYNAMIC_CONFLICT_KEY = 'na_snapshot_v10_conflict_<commitId>';

const LOCAL_SET = new Set(LOCAL_KEYS);
const SESSION_SET = new Set(SESSION_KEYS);
const LEGACY_SET = new Set(LEGACY_KEYS);

export function parseStorageStatic(lines, text) {
  const literals = new Map(); // key -> first line
  const literalRe = /['"](na_[A-Za-z0-9_]+)['"]/g;
  for (let i = 0; i < lines.length; i += 1) {
    const re = new RegExp(literalRe.source, 'g');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      if (!literals.has(m[1])) literals.set(m[1], i + 1);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  const hasDynamicConflict = /_conflict_\$\{/.test(text) || /localMirrorKey\}_conflict_/.test(text);

  const localStorageKeys = [];
  const sessionStorageKeys = [];
  const legacyKeys = [];
  const other = [];
  for (const key of literals.keys()) {
    // A key may legitimately belong to more than one medium (e.g. na_cart_draft
    // is written to both localStorage and sessionStorage).
    let classified = false;
    if (LOCAL_SET.has(key)) { localStorageKeys.push(key); classified = true; }
    if (SESSION_SET.has(key)) { sessionStorageKeys.push(key); classified = true; }
    if (LEGACY_SET.has(key)) { legacyKeys.push(key); classified = true; }
    if (!classified) other.push(key);
  }
  if (hasDynamicConflict) localStorageKeys.push(DYNAMIC_CONFLICT_KEY);

  localStorageKeys.sort();
  sessionStorageKeys.sort();
  legacyKeys.sort();
  other.sort();

  const constants = {};
  const constPatterns = {
    _NA_DB_NAME: /_NA_DB_NAME\s*=\s*['"]([^'"]+)['"]/,
    _NA_DB_STORE: /_NA_DB_STORE\s*=\s*['"]([^'"]+)['"]/,
    _NA_SNAPSHOT_KEY: /_NA_SNAPSHOT_KEY\s*=\s*['"]([^'"]+)['"]/,
    _NA_LOCAL_KEY: /_NA_LOCAL_KEY\s*=\s*['"]([^'"]+)['"]/,
    _NA_SESSION_KEY: /_NA_SESSION_KEY\s*=\s*['"]([^'"]+)['"]/,
    _NA_V10_DB_VERSION: /_NA_V10_DB_VERSION\s*=\s*(\d+)/,
    _NA_V10_STATE_STORE: /_NA_V10_STATE_STORE\s*=\s*['"]([^'"]+)['"]/,
    _NA_V10_OPERATIONS_STORE: /_NA_V10_OPERATIONS_STORE\s*=\s*['"]([^'"]+)['"]/,
    _NA_V10_CHECKPOINTS_STORE: /_NA_V10_CHECKPOINTS_STORE\s*=\s*['"]([^'"]+)['"]/,
  };
  for (const [key, re] of Object.entries(constPatterns)) {
    const m = re.exec(text);
    constants[key] = m ? m[1] : null;
  }

  // Resolve a store-name expression (literal or known constant identifier).
  const constByIdentifier = {
    _NA_DB_STORE: constants._NA_DB_STORE,
    _NA_V10_STATE_STORE: constants._NA_V10_STATE_STORE,
    _NA_V10_OPERATIONS_STORE: constants._NA_V10_OPERATIONS_STORE,
    _NA_V10_CHECKPOINTS_STORE: constants._NA_V10_CHECKPOINTS_STORE,
  };
  function resolveStoreName(arg) {
    const trimmed = arg.trim();
    const lit = /^['"]([^'"]+)['"]/.exec(trimmed);
    if (lit) return lit[1];
    if (constByIdentifier[trimmed]) return constByIdentifier[trimmed];
    return null;
  }

  const dbOpens = [];
  const openMatches = scanLines(lines, /indexedDB\.open\s*\(/gi);
  for (const om of openMatches) {
    const snippet = lines[om.line - 1].slice(om.col);
    const m = /indexedDB\.open\s*\(\s*([^,)]+)\s*,\s*([^)]*)\)/.exec(snippet);
    dbOpens.push({
      line: om.line,
      nameExpr: m ? m[1].trim() : null,
      versionExpr: m ? m[2].trim() : null,
    });
  }

  const objectStores = [];
  const storeMatches = scanLines(lines, /createObjectStore\s*\(/gi);
  for (const sm of storeMatches) {
    const snippet = lines[sm.line - 1].slice(sm.col);
    const m = /createObjectStore\s*\(([^)]*)\)/.exec(snippet);
    let name = null;
    let nameExpr = null;
    let keyPath = null;
    if (m) {
      const args = m[1];
      const nameM = /^([^,]+)/.exec(args.trim());
      if (nameM) {
        nameExpr = nameM[1].trim();
        name = resolveStoreName(nameExpr);
      }
      const kpM = /keyPath\s*:\s*['"]([^'"]+)['"]/.exec(args);
      keyPath = kpM ? kpM[1] : null;
    }
    objectStores.push({ line: sm.line, nameExpr, name, keyPath });
  }

  return {
    localStorage: localStorageKeys,
    sessionStorage: sessionStorageKeys,
    legacy: legacyKeys,
    other,
    dynamicConflictKey: hasDynamicConflict ? DYNAMIC_CONFLICT_KEY : null,
    constants,
    dbOpens,
    objectStores,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function analyzeAll(source) {
  const lines = splitLines(source);
  const text = lines.join('\n');
  const scripts = parseScriptBlocks(lines);
  const styles = parseStyleBlocks(lines, scripts);
  const domIds = parseDomIds(lines);
  const buttons = parseButtons(lines);
  const handlers = parseInlineHandlers(lines);
  const innerHtml = parseInnerHtml(lines);
  const deps = parseExternalDeps(lines);
  const globals = parseGlobalDecls(lines);
  const functions = parseFunctionDefs(lines);
  const overrideMap = buildOverrideMap(functions, scripts, lines, text);
  const startup = parseStartup(lines);
  const v10 = parseV10Dormancy(lines, scripts, functions, globals);
  const storage = parseStorageStatic(lines, text);

  const formsCount = (text.match(/<form\b/gi) || []).length;
  const typeModuleCount = scripts.filter((s) => s.typeModule).length;

  return {
    lineCount: lines.length,
    scripts,
    styles,
    domIds,
    buttons,
    handlers,
    innerHtml,
    deps,
    globals,
    functions,
    overrideMap,
    startup,
    v10,
    storage,
    formsCount,
    typeModuleCount,
  };
}

export default {
  scanLines,
  parseScriptBlocks,
  parseStyleBlocks,
  parseDomIds,
  parseButtons,
  parseInlineHandlers,
  parseInnerHtml,
  parseExternalDeps,
  parseGlobalDecls,
  parseFunctionDefs,
  buildOverrideMap,
  parseStartup,
  parseV10Dormancy,
  parseStorageStatic,
  analyzeAll,
};
