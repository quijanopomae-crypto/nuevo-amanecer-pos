// pos-parse.mjs — parsers estructurales puros y deterministas sobre POS/index.html
//
// OBJECTIVE_ID: FASE6-OFFLINE-COMPAT
//
// v3 (GLM SECOND ENGINEER — FASE 6, contrato v3):
//  - FULL-DOCUMENT handler discovery: los atributos on* de handlers se
//    recolectan de TODO el documento FUERA de todos los rangos de script.
//    v2 solo miraba el HTML anterior al primer script inline (boundary) y
//    omitia 9 globals reales referenciados en HTML posterior a los scripts
//    (linea de credito manual F7 + disenador de emojis F12).
//  - Exclusion REAL de asignaciones JavaScript .on*=: el escaneo de
//    atributos exige frontera de atributo (caracter previo distinto de word
//    char, punto y guion) y valores EN COMILLAS; las 6 asignaciones
//    .onclick= del primer script inline NO se cuentan como atributos HTML.
//  - scanTags v3 robusto contra la matriz adversarial demostrada:
//      * > dentro de atributos entre comillas (lectura quote-aware del tag);
//      * literales regex validos en el escaneo de cierre;
//      * comentarios HTML fantasma en el documento;
//      * atributos sin comillas y multilinea;
//      * comentarios tipo HTML de Annex B dentro de JS (<!-- en cualquier
//        posicion; --> al inicio de linea) no cierran el bloque.
//  - Rangos con offsets exactos (startOffset/openEnd/closeOffset/endOffset)
//    para segmentar el HTML fuera de scripts byte-exactamente.
//  - Conciliacion derivada (criterio, NO fuente del calculo): staticNames
//    99, templateNames 90, requiredGlobals 177, atributos reales 366 (231
//    estaticos + 135 de templates; conteo legacy 372 = 366 + 6 .onclick=).
//
// Cada parser es puro: recibe texto/lineas y devuelve un objeto determinista,
// sin I/O, sin timestamps, sin aleatoriedad.

import { parseScriptBlocks, parseFunctionDefs } from '../../characterization/lib/static-parse.mjs';

// ---------------------------------------------------------------------------
// Constantes documentadas
// ---------------------------------------------------------------------------

// Atributos de handler inline considerados (whitelist explicita; incluye
// ondrop, gap conocido de characterization FASE 4: documentado, no reescrito).
export const HANDLER_ATTRS = [
  'onclick', 'onchange', 'oninput', 'onkeydown', 'onsubmit',
  'ondragstart', 'ondragend', 'ondragover', 'ondragleave', 'ondrop',
];
export const HANDLER_ATTR = HANDLER_ATTRS.join('|');

// Falsos positivos documentados del extractor de calles primarias:
//  - if: keyword JS (onkeydown="if(event.key===...)").
//  - getElementById: metodo DOM (onclick="document.getElementById(...)").
export const EXCLUDE_LIST = ['if', 'getElementById'];

const CALL_NAME_REGEX = /([A-Za-z_\x24][A-Za-z0-9_\x24]*)\s*\(/g;
const JS_ON_ASSIGN_REGEX = new RegExp('\\.\\s*(' + HANDLER_ATTR + ')\\s*=', 'gi');
const WS_CHARS = /[ \t\r\n]/;
const NOT_ATTR_BOUNDARY = /[A-Za-z0-9_\x24.\-]/;
const LINE_ONLY_WS = /^[ \t]*$/;

/**
 * Normaliza CRLF/CR a LF y parte en lineas (sin elemento vacio final).
 * @param {string} text
 * @returns {string[]}
 */
export function loadPosLines(text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  const parts = normalized.split('\n');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// ---------------------------------------------------------------------------
// Escaneo lexico JS: strings, templates, comentarios, regex y Annex B
// ---------------------------------------------------------------------------

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'yield', 'await', 'case', 'throw', 'else', 'do',
]);
const REGEX_PRECEDERS = '([{,;:=!&|?~+-*\x25<>^)';
const CHAR_BACKTICK = '\x60';
const CHAR_DOLLAR = '\x24';

function skipQuoted(text, j, quote) {
  const n = text.length;
  j += 1;
  while (j < n) {
    if (text[j] === '\\') { j += 2; continue; }
    if (text[j] === quote) return j + 1;
    if (text[j] === '\n') return j; // recovery: string sin cerrar en la linea
    j += 1;
  }
  return n;
}

function skipLineComment(text, j) {
  const n = text.length;
  j += 2;
  while (j < n && text[j] !== '\n') j += 1;
  return j;
}

function skipBlockComment(text, j) {
  const n = text.length;
  j += 2;
  while (j < n) {
    if (text[j] === '*' && text[j + 1] === '/') return j + 2;
    j += 1;
  }
  return n;
}

function skipRegexLiteral(text, j) {
  const n = text.length;
  j += 1;
  let inClass = false;
  while (j < n) {
    const ch = text[j];
    if (ch === '\\') { j += 2; continue; }
    if (ch === '[') { inClass = true; j += 1; continue; }
    if (ch === ']') { inClass = false; j += 1; continue; }
    if (ch === '/' && !inClass) return j + 1;
    if (ch === '\n') return j; // regex no cruza newline
    j += 1;
  }
  return n;
}

function isRegexPosition(prevWord, prevSig) {
  return (prevWord !== '' && REGEX_KEYWORDS.has(prevWord))
    || REGEX_PRECEDERS.indexOf(prevSig) !== -1;
}

function skipTemplateExpression(text, j) {
  // j justo despues del { que abre la expresion de un template. Escanea
  // hasta la } que cierra, saltando strings, templates anidados,
  // comentarios y literales regex.
  const n = text.length;
  let depth = 1;
  let prevSig = '';
  let prevWord = '';
  while (j < n) {
    const ch = text[j];
    if (ch === '\x27' || ch === '\x22') { j = skipQuoted(text, j, ch); prevSig = ch; prevWord = ''; continue; }
    if (ch === CHAR_BACKTICK) { j = skipTemplateLiteral(text, j); prevSig = CHAR_BACKTICK; prevWord = ''; continue; }
    if (ch === '/' && text[j + 1] === '/') { j = skipLineComment(text, j); continue; }
    if (ch === '/' && text[j + 1] === '*') { j = skipBlockComment(text, j); continue; }
    if (ch === '/') {
      if (isRegexPosition(prevWord, prevSig)) { j = skipRegexLiteral(text, j); prevSig = '/'; prevWord = ''; continue; }
      prevSig = '/'; prevWord = '';
      j += 1;
      continue;
    }
    if (ch === '{') { depth += 1; prevSig = ch; prevWord = ''; j += 1; continue; }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return j + 1;
      prevSig = ch; prevWord = '';
      j += 1;
      continue;
    }
    if (/[A-Za-z0-9_]/.test(ch)) { prevWord += ch; prevSig = ch; j += 1; continue; }
    if (/\s/.test(ch)) { j += 1; continue; }
    prevSig = ch; prevWord = '';
    j += 1;
  }
  return n;
}

function skipTemplateLiteral(text, j) {
  const n = text.length;
  j += 1;
  while (j < n) {
    const ch = text[j];
    if (ch === '\\') { j += 2; continue; }
    if (ch === CHAR_BACKTICK) return j + 1;
    if (ch === CHAR_DOLLAR && text[j + 1] === '{') { j = skipTemplateExpression(text, j + 2); continue; }
    j += 1;
  }
  return n;
}

/**
 * Escanea contenido JS desde start buscando el closer (</script),
 * ignorando strings, templates, comentarios y literales regex, y
 * respetando los comentarios tipo HTML de Annex B (<!-- en cualquier
 * posicion; --> al inicio de linea). Un closer dentro de esos contextos
 * NO cierra el bloque. Devuelve el offset del < del cierre, o -1.
 * @param {string} text
 * @param {number} start
 * @param {string} closer lowercase
 * @returns {number}
 */
function scanJsForClose(text, start, closer) {
  const n = text.length;
  let j = start;
  let prevSig = '';
  let prevWord = '';
  let lineStart = start;
  while (j < n) {
    const ch = text[j];
    if (ch === '\n') { lineStart = j + 1; prevWord = ''; j += 1; continue; }
    if (ch === '-' && text[j + 1] === '-' && text[j + 2] === '>') {
      // Annex B: --> con solo espacios/tabs desde el inicio de linea.
      if (LINE_ONLY_WS.test(text.slice(lineStart, j))) { j = skipLineComment(text, j); continue; }
    }
    // Annex B: <!-- inicia comentario de una linea en cualquier posicion.
    if (ch === '<' && text[j + 1] === '!' && text[j + 2] === '-' && text[j + 3] === '-') {
      j = skipLineComment(text, j);
      continue;
    }
    if (ch === '\x27' || ch === '\x22') { j = skipQuoted(text, j, ch); prevSig = ch; prevWord = ''; continue; }
    if (ch === CHAR_BACKTICK) { j = skipTemplateLiteral(text, j); prevSig = CHAR_BACKTICK; prevWord = ''; continue; }
    if (ch === '/' && text[j + 1] === '/') { j = skipLineComment(text, j); continue; }
    if (ch === '/' && text[j + 1] === '*') { j = skipBlockComment(text, j); continue; }
    if (ch === '/') {
      if (isRegexPosition(prevWord, prevSig)) { j = skipRegexLiteral(text, j); prevSig = '/'; prevWord = ''; continue; }
      prevSig = '/'; prevWord = '';
      j += 1;
      continue;
    }
    if (ch === '<' && text.slice(j, j + closer.length).toLowerCase() === closer) return j;
    if (/[A-Za-z0-9_]/.test(ch)) { prevWord += ch; prevSig = ch; j += 1; continue; }
    if (/\s/.test(ch)) { j += 1; continue; } // whitespace conserva prevWord
    prevSig = ch; prevWord = '';
    j += 1;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Lectura de tag de apertura quote-aware (multilinea, atributos unquoted)
// ---------------------------------------------------------------------------

/**
 * Intenta leer una apertura <name ...> en text[offset], cruzando newlines,
 * respetando comillas (un > dentro de un valor entre comillas NO cierra el
 * tag) y aceptando atributos sin comillas. Devuelve {raw, openEnd} o null.
 * @param {string} text
 * @param {number} offset
 * @param {string} name
 * @returns {{raw:string, openEnd:number}|null}
 */
function readOpenTag(text, offset, name) {
  if (text[offset] !== '<') return null;
  if (text.slice(offset, offset + 1 + name.length).toLowerCase() !== '<' + name) return null;
  const after = text[offset + 1 + name.length];
  if (after !== undefined && /[A-Za-z0-9_]/.test(after)) return null;
  const n = text.length;
  let j = offset + 1 + name.length;
  let quote = null;
  while (j < n) {
    const ch = text[j];
    if (quote !== null) {
      if (ch === '\\') { j += 2; continue; }
      if (ch === quote) quote = null;
      j += 1;
      continue;
    }
    if (ch === '\x22' || ch === '\x27') { quote = ch; j += 1; continue; }
    if (ch === '>') return { raw: text.slice(offset, j + 1), openEnd: j + 1 };
    j += 1;
  }
  return null;
}

/**
 * Parsea los atributos del raw de un tag de apertura. Soporta valores entre
 * comillas (doble/single) y SIN comillas (hasta whitespace o >), y atributos
 * booleanos. Devuelve Map name(lowercase) -> value|null.
 * @param {string} raw
 * @returns {Map<string,string|null>}
 */
function parseTagAttrs(raw) {
  const attrs = new Map();
  const n = raw.length;
  let i = 0;
  while (i < n) {
    const ch = raw[i];
    if (ch === '>') break;
    if (WS_CHARS.test(ch) || ch === '/') { i += 1; continue; }
    let j = i;
    while (j < n && /[A-Za-z0-9_:.\-]/.test(raw[j])) j += 1;
    if (j === i) { i += 1; continue; }
    const name = raw.slice(i, j).toLowerCase();
    let k = j;
    while (k < n && WS_CHARS.test(raw[k])) k += 1;
    let value = null;
    if (raw[k] === '=') {
      k += 1;
      while (k < n && WS_CHARS.test(raw[k])) k += 1;
      const q = raw[k];
      if (q === '\x22' || q === '\x27') {
        const end = raw.indexOf(q, k + 1);
        if (end !== -1) { value = raw.slice(k + 1, end); k = end + 1; }
      } else if (k < n && raw[k] !== '>') {
        let e = k;
        while (e < n && !WS_CHARS.test(raw[e]) && raw[e] !== '>') e += 1;
        value = raw.slice(k, e);
        k = e;
      }
    }
    attrs.set(name, value);
    i = Math.max(k, j);
  }
  return attrs;
}

function attrValue(raw, name) {
  const v = parseTagAttrs(raw).get(name);
  return v === undefined ? null : v;
}

function hasAttr(raw, name) {
  return parseTagAttrs(raw).has(name);
}

/**
 * Numero de linea 1-based de un offset (contando saltos de linea previos).
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function lineOf(text, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') n += 1;
  }
  return n;
}

function makeScriptRange(text, openStart, open, closeOffset, endOffset, index) {
  return {
    index,
    startOffset: openStart,
    openEnd: open.openEnd,
    closeOffset,
    endOffset,
    startLine: lineOf(text, openStart),
    endLine: lineOf(text, closeOffset),
    id: attrValue(open.raw, 'id'),
    src: attrValue(open.raw, 'src'),
    defer: hasAttr(open.raw, 'defer'),
    async: hasAttr(open.raw, 'async'),
    typeModule: attrValue(open.raw, 'type') === 'module',
  };
}

function makeStyleRange(text, openStart, open, closeOffset, endOffset, index) {
  return {
    index,
    startOffset: openStart,
    openEnd: open.openEnd,
    closeOffset,
    endOffset,
    startLine: lineOf(text, openStart),
    endLine: lineOf(text, closeOffset),
    id: attrValue(open.raw, 'id'),
  };
}

function skipToGt(text, from) {
  let g = from;
  while (g < text.length && text[g] !== '>') g += 1;
  return g;
}

/**
 * Scanner estructural v3 sobre el TEXTO COMPLETO (no por linea).
 *  - Ignora comentarios HTML: un <script> fantasma dentro de un comentario
 *    NO es un bloque real.
 *  - Aperturas multilinea, con > dentro de valores entre comillas y
 *    atributos sin comillas.
 *  - El cierre de <script> se busca con scanJsForClose (JS-aware + Annex B);
 *    el de <style> con busqueda directa.
 *  - Cada rango expone offsets exactos ademas de las lineas 1-based.
 * @param {string} text
 * @returns {{scriptRangesRobust:object[], styleRangesRobust:object[]}}
 */
export function scanTags(text) {
  const n = text.length;
  const scriptRangesRobust = [];
  const styleRangesRobust = [];
  let i = 0;
  while (i < n) {
    if (text[i] !== '<') { i += 1; continue; }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    const scriptOpen = readOpenTag(text, i, 'script');
    if (scriptOpen) {
      const closeOffset = scanJsForClose(text, scriptOpen.openEnd, '</script');
      if (closeOffset === -1) break; // malformado: detener el escaneo
      const endOffset = skipToGt(text, closeOffset + 8) + 1;
      scriptRangesRobust.push(makeScriptRange(text, i, scriptOpen, closeOffset, endOffset, scriptRangesRobust.length));
      i = endOffset;
      continue;
    }
    const styleOpen = readOpenTag(text, i, 'style');
    if (styleOpen) {
      const closeOffset = text.toLowerCase().indexOf('</style', styleOpen.openEnd);
      if (closeOffset === -1) break;
      const endOffset = skipToGt(text, closeOffset + 7) + 1;
      styleRangesRobust.push(makeStyleRange(text, i, styleOpen, closeOffset, endOffset, styleRangesRobust.length));
      i = endOffset;
      continue;
    }
    i += 1;
  }
  return { scriptRangesRobust, styleRangesRobust };
}

/**
 * Rangos de script del POS (19: 1 CDN defer + 18 inline) via scanTags v3.
 * @param {string[]} lines
 * @returns {object[]}
 */
export function posScriptRanges(lines) {
  return scanTags(lines.join('\n')).scriptRangesRobust;
}

/**
 * Compara scanTags v3 contra parseScriptBlocks (por linea) de static-parse.
 * HOY deben coincidir (19 scripts, mismos rangos). Cualquier divergencia
 * futura = drift detectable.
 * @param {string[]} lines
 * @returns {{match:boolean, robustCount:number, staticCount:number, diffs:object[]}}
 */
export function crossCheckVsStaticParse(lines) {
  const text = lines.join('\n');
  const robust = scanTags(text).scriptRangesRobust;
  const statik = parseScriptBlocks(lines);
  const eq = (a, b) => a.index === b.index && a.startLine === b.startLine && a.endLine === b.endLine;
  const match = robust.length === statik.length && robust.every((r, idx) => eq(r, statik[idx]));
  const diffs = [];
  if (!match) {
    for (let idx = 0; idx < Math.max(robust.length, statik.length); idx += 1) {
      const r = robust[idx];
      const s = statik[idx];
      if (!r || !s || !eq(r, s)) diffs.push({ index: idx, robust: r || null, static: s || null });
    }
  }
  return { match, robustCount: robust.length, staticCount: statik.length, diffs };
}

/**
 * Boundary estructural: linea del PRIMER script SIN src. Se conserva como
 * referencia de caracterizacion (v3 ya NO limita el discovery a boundary).
 * @param {object[]} scripts
 * @returns {number|null} linea 1-based, o null si no hay inline scripts
 */
export function posStaticBoundary(scripts) {
  let boundary = null;
  for (const s of scripts) {
    if (s.src == null) {
      if (boundary === null || s.startLine < boundary) boundary = s.startLine;
    }
  }
  return boundary;
}

// ---------------------------------------------------------------------------
// FULL-DOCUMENT handler discovery (HTML fuera de TODOS los rangos script)
// ---------------------------------------------------------------------------

/**
 * Segmentos de texto HTML fuera de todos los rangos de script (por offset).
 * @param {string} text
 * @param {object[]} scripts rangos con startOffset/endOffset
 * @returns {{start:number, end:number}[]}
 */
export function posHtmlSegments(text, scripts) {
  const zones = scripts
    .map((s) => [s.startOffset, s.endOffset])
    .sort((a, b) => a[0] - b[0]);
  const segments = [];
  let cursor = 0;
  for (const z of zones) {
    if (z[0] > cursor) segments.push({ start: cursor, end: z[0] });
    cursor = Math.max(cursor, z[1]);
  }
  if (cursor < text.length) segments.push({ start: cursor, end: text.length });
  return segments;
}

/**
 * Nombres de funcion llamados en un valor de handler on* (calles
 * primarias), filtrando EXCLUDE_LIST. Reutilizable/acumulable.
 * @param {string} value
 * @param {Set<string>} [into]
 * @returns {Set<string>}
 */
export function collectCallNames(value, into) {
  const names = into || new Set();
  const re = new RegExp(CALL_NAME_REGEX.source, 'g');
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(value)) !== null) {
    if (EXCLUDE_LIST.indexOf(m[1]) === -1) names.add(m[1]);
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return names;
}

/**
 * Escanea un fragmento buscando atributos de handler on*= validos.
 * Exclusion REAL de asignaciones JavaScript .on*=:
 *  - el caracter previo al nombre NO puede ser word char, $, punto ni
 *    guion (x.onclick= y data-onclick= no cuentan);
 *  - solo cuentan valores EN COMILLAS (las asignaciones .on*= de JS no
 *    llevan comillas);
 *  - los valores unquoted (HTML valido) se cuentan aparte.
 * @param {string} segment
 * @returns {{names:Set<string>, counts:object, quoted:number, unquoted:number}}
 */
export function scanHandlerAttrs(segment) {
  const lower = segment.toLowerCase();
  const names = new Set();
  const counts = {};
  let quoted = 0;
  let unquoted = 0;
  for (const attr of HANDLER_ATTRS) {
    let idx = lower.indexOf(attr);
    while (idx !== -1) {
      const prev = idx === 0 ? ' ' : segment[idx - 1];
      if (!NOT_ATTR_BOUNDARY.test(prev)) {
        let p = idx + attr.length;
        while (p < segment.length && WS_CHARS.test(segment[p])) p += 1;
        if (segment[p] === '=') {
          p += 1;
          while (p < segment.length && WS_CHARS.test(segment[p])) p += 1;
          const q = segment[p];
          if (q === '\x22' || q === '\x27') {
            const end = segment.indexOf(q, p + 1);
            if (end !== -1) {
              quoted += 1;
              counts[attr] = (counts[attr] || 0) + 1;
              collectCallNames(segment.slice(p + 1, end), names);
            }
          } else if (p < segment.length && /[A-Za-z0-9_\x24]/.test(segment[p])) {
            let e = p;
            while (e < segment.length && !WS_CHARS.test(segment[e]) && segment[e] !== '>') e += 1;
            unquoted += 1;
            counts[attr] = (counts[attr] || 0) + 1;
            collectCallNames(segment.slice(p, e), names);
          }
        }
      }
      idx = lower.indexOf(attr, idx + 1);
    }
  }
  return { names, counts, quoted, unquoted };
}

/**
 * Handlers estaticos FULL-DOCUMENT: atributos on*= de TODO el HTML fuera
 * de todos los rangos de script (v2 solo miraba el HTML anterior al
 * boundary y omitia 9 globals reales).
 * @param {string[]} lines
 * @param {object[]} scripts rangos con startOffset/endOffset/src
 * @returns {{names:string[], counts:object, occurrences:number, unquoted:number}}
 */
export function posHtmlHandlerData(lines, scripts) {
  const text = lines.join('\n');
  const segments = posHtmlSegments(text, scripts);
  const names = new Set();
  const counts = {};
  let occurrences = 0;
  let unquoted = 0;
  for (const seg of segments) {
    const r = scanHandlerAttrs(text.slice(seg.start, seg.end));
    r.names.forEach((nm) => names.add(nm));
    for (const k in r.counts) counts[k] = (counts[k] || 0) + r.counts[k];
    occurrences += r.quoted;
    unquoted += r.unquoted;
  }
  return { names: Array.from(names).sort(), counts, occurrences, unquoted };
}
/**
 * Handlers de templates: atributos on*= EN COMILLAS dentro de los cuerpos
 * de los scripts inline. Cuenta ademas las asignaciones JavaScript .on*=
 * encontradas (excluidas del conteo de atributos reales).
 * @param {string[]} lines
 * @param {object[]} scripts
 * @returns {{names:string[], counts:object, occurrences:number, unquoted:number, jsOnAssignments:number}}
 */
export function posTemplateHandlerData(lines, scripts) {
  const text = lines.join('\n');
  const names = new Set();
  const counts = {};
  let occurrences = 0;
  let unquoted = 0;
  let jsOnAssignments = 0;
  for (const s of scripts) {
    if (s.src != null) continue;
    const body = text.slice(s.openEnd, s.closeOffset);
    const r = scanHandlerAttrs(body);
    r.names.forEach((nm) => names.add(nm));
    for (const k in r.counts) counts[k] = (counts[k] || 0) + r.counts[k];
    occurrences += r.quoted;
    unquoted += r.unquoted;
    const re = new RegExp(JS_ON_ASSIGN_REGEX.source, 'gi');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body)) !== null) {
      jsOnAssignments += 1;
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return { names: Array.from(names).sort(), counts, occurrences, unquoted, jsOnAssignments };
}

/**
 * Wrapper estable: nombres estaticos full-document (firma v3: scripts en
 * lugar del boundary obsoleto de v2).
 * @param {string[]} lines
 * @param {object[]} scripts
 * @returns {{names:string[], counts:object, occurrences:number, unquoted:number}}
 */
export function posStaticHandlerNames(lines, scripts) {
  const data = posHtmlHandlerData(lines, scripts);
  return {
    names: data.names,
    counts: data.counts,
    occurrences: data.occurrences,
    unquoted: data.unquoted,
  };
}

/**
 * Wrapper estable: nombres de templates + conteos + asignaciones JS .on*=.
 * @param {string[]} lines
 * @param {object[]} scripts
 * @returns {{names:string[], counts:object, occurrences:number, jsOnAssignments:number}}
 */
export function posTemplateHandlerNames(lines, scripts) {
  const data = posTemplateHandlerData(lines, scripts);
  return {
    names: data.names,
    counts: data.counts,
    occurrences: data.occurrences,
    jsOnAssignments: data.jsOnAssignments,
  };
}

/**
 * Globales requeridos: union ordenada de estaticos + templates.
 * @param {string[]} staticNames
 * @param {string[]} templateNames
 * @returns {string[]}
 */
export function posRequiredGlobals(staticNames, templateNames) {
  const set = new Set([...staticNames, ...templateNames]);
  return Array.from(set).sort();
}

/**
 * Definiciones de funcion (reutiliza el parser de caracterizacion).
 * @param {string[]} lines
 * @returns {object[]}
 */
export function posDefinitions(lines) {
  return parseFunctionDefs(lines);
}

/**
 * Override winners: nombres con mas de una definicion; winner = ultima.
 * @param {object[]} defs
 * @returns {{name:string, count:number, winner:number, definedAt:number[]}[]}
 */
export function posOverrideWinners(defs) {
  const byName = new Map();
  for (const d of defs) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d.line);
  }
  const out = [];
  for (const entry of byName) {
    const name = entry[0];
    const defLines = entry[1];
    if (defLines.length < 2) continue;
    const sorted = defLines.slice().sort((a, b) => a - b);
    out.push({ name, count: sorted.length, winner: sorted[sorted.length - 1], definedAt: sorted });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/**
 * Secuencia del main entry (DOMContentLoaded async con loadAllData).
 * @param {string[]} lines
 * @returns {{mainEntryLine:number|null, chainLine:number|null, saveAllDataLine:number|null, sequence:string[]}}
 */
export function posEntrySequence(lines) {
  let mainEntryLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes('addEventListener(\x27DOMContentLoaded\x27,async')) {
      mainEntryLine = i + 1;
      break;
    }
  }
  if (mainEntryLine === -1) {
    return { mainEntryLine: null, chainLine: null, saveAllDataLine: null, sequence: [] };
  }

  let chainLine = -1;
  let saveAllDataLine = -1;
  const windowEnd = Math.min(lines.length, mainEntryLine - 1 + 10);
  for (let i = mainEntryLine - 1; i < windowEnd; i += 1) {
    if (chainLine === -1 && lines[i].includes('loadAllData')) chainLine = i + 1;
    if (lines[i].includes('saveAllData')) saveAllDataLine = i + 1;
  }

  const sequence = [];
  if (chainLine !== -1) {
    const chainText = lines[chainLine - 1];
    const re = /(?:await\s+)?([A-Za-z_\x24][\w\x24]*(?:\s*\.\s*[A-Za-z_\x24][\w\x24]*)?)\s*\(([^()]*)\)/g;
    let m;
    while ((m = re.exec(chainText)) !== null) {
      const callee = m[1].replace(/\s+/g, '');
      const args = m[2].trim();
      sequence.push(args ? callee + '(' + args + ')' : callee);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  if (saveAllDataLine !== -1) sequence.push('saveAllData');

  return { mainEntryLine, chainLine, saveAllDataLine, sequence };
}

/**
 * Guardas SheetJS derivadas ESTRUCTURALMENTE (escaneo typeof XLSX).
 * @param {string[]} lines
 * @returns {{line:number, fn:string|null}[]}
 */
export function posSheetJsGuards(lines) {
  const guards = [];
  const xlsxRe = /typeof\s+XLSX/;
  const fnRe = /(?:async\s+)?function\s+([A-Za-z_\x24][\w\x24]*)\s*\(/;
  for (let i = 0; i < lines.length; i += 1) {
    if (!xlsxRe.test(lines[i])) continue;
    let fn = null;
    const m = fnRe.exec(lines[i]);
    if (m) {
      fn = m[1];
    } else {
      for (let j = i - 1; j >= 0 && j >= i - 100; j -= 1) {
        const back = fnRe.exec(lines[j]);
        if (back) { fn = back[1]; break; }
      }
    }
    guards.push({ line: i + 1, fn });
  }
  return guards;
}

/**
 * Bloques <style> reales del documento via scanTags v3 (0 esperados) +
 * conteo de <style dentro de los scripts (>=2, templates fantasma).
 * @param {string[]} lines
 * @param {object[]} scripts
 * @returns {{realBlocks:object[], styleInScripts:number}}
 */
export function posStyleRealBlocks(lines, scripts) {
  const text = lines.join('\n');
  const realBlocks = scanTags(text).styleRangesRobust.map((r) => ({
    index: r.index,
    startLine: r.startLine,
    endLine: r.endLine,
    id: r.id,
  }));
  let styleInScripts = 0;
  for (const s of scripts) {
    if (s.src != null) continue;
    const body = lines.slice(s.startLine - 1, s.endLine).join('\n');
    styleInScripts += (body.match(/<style\b/gi) || []).length;
  }
  return { realBlocks, styleInScripts };
}

export default {
  loadPosLines,
  scanTags,
  posScriptRanges,
  crossCheckVsStaticParse,
  posStaticBoundary,
  posHtmlSegments,
  posHtmlHandlerData,
  posTemplateHandlerData,
  posStaticHandlerNames,
  posTemplateHandlerNames,
  posRequiredGlobals,
  posDefinitions,
  posOverrideWinners,
  posEntrySequence,
  posSheetJsGuards,
  posStyleRealBlocks,
  collectCallNames,
  scanHandlerAttrs,
  EXCLUDE_LIST,
  HANDLER_ATTRS,
  HANDLER_ATTR,
};
