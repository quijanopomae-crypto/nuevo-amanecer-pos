// product.mjs — acceso READ-ONLY a las fuentes del producto para el Release Invariants Pack.
//
// Este módulo NUNCA escribe. Solo localiza el repositorio, lee POS/index.html,
// deduce el orden de carga de los scripts locales y expone utilidades de scan
// estático (definiciones de funciones por archivo y línea).
//
// OBJECTIVE_ID: RELEASE-INVARIANTS-PACK (ETAPA 5)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');
export const POS_DIR = path.join(ROOT, 'POS');

export const RELEASE_BASE = '1faf1062b9e30c96b1cdb71bf717ec03c8441e3e';
export const RELEASE_BRANCH = 'hardening/critical-write-gates';

/** Lee un archivo del producto (relativo a POS/) como texto. READ-ONLY. */
export function readProductText(rel) {
  return readFileSync(path.join(POS_DIR, rel), 'utf8');
}

/**
 * Lista de <script src="..."> LOCALES en orden documental (index.html).
 * Los scripts CDN externos (http/https) se excluyen.
 */
export function localScriptOrder() {
  const html = readProductText('index.html');
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (/^(https?:)?\/\//i.test(src)) continue;
    out.push(src.replace(/^\.\//, ''));
  }
  return out;
}

/** Índice (0-based) de un script local en el orden de carga; -1 si no está. */
export function scriptIndex(rel) {
  return localScriptOrder().indexOf(rel);
}

function escapeRe(s) {
  return s.replace(/[.*+?${}()|[\]\\]/g, '\\$&');
}

/**
 * Devuelve las líneas (1-based) de `rel` donde `name` es definido:
 *  - function NAME(
 *  - NAME = (async) function
 *  - const/let/var NAME =
 */
export function scanDefinitions(rel, name) {
  const lines = readProductText(rel).split(/\r?\n/);
  const hits = [];
  const re = new RegExp(
    `(?:\\bfunction\\s+${escapeRe(name)}\\s*\\()` +
    `|(?:\\b${escapeRe(name)}\\s*=\\s*(?:async\\s+)?function\\b)` +
    `|(?:\\b(?:const|let|var)\\s+${escapeRe(name)}\\b)`,
    'i'
  );
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) hits.push(i + 1);
  }
  return hits;
}

/** true si el archivo contiene el patrón dado. */
export function fileMatches(rel, pattern) {
  return new RegExp(pattern, 'i').test(readProductText(rel));
}

/** Líneas (1-based) que contienen el patrón dado. */
export function fileMatchLines(rel, pattern) {
  const lines = readProductText(rel).split(/\r?\n/);
  const re = new RegExp(pattern, 'i');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) out.push(i + 1);
  }
  return out;
}

/** Todos los .js del producto (ruta relativa a POS/), orden estable. */
export function allProductJsFiles() {
  const files = [
    'js/app.js',
    'js/compat/legacy-globals.js',
    'js/core/state.js',
    'js/core/utils.js',
  ];
  for (let i = 1; i <= 18; i += 1) {
    files.push(`js/legacy-inline/inline-${String(i).padStart(2, '0')}.js`);
  }
  files.push('js/modules/ticket/legacy.js');
  files.push('js/modules/ticket/overrides.js');
  files.push('js/modules/ticket/secure-print.js');
  files.push('js/modules/ticket/zones.js');
  return files;
}

/** Fragmento de fuente entre dos marcadores (incluido el primero, excluido el segundo). */
export function sliceBetween(rel, startMarker, endMarker) {
  const src = readProductText(rel);
  const a = src.indexOf(startMarker);
  if (a === -1) return null;
  const b = endMarker ? src.indexOf(endMarker, a) : -1;
  return b === -1 ? src.slice(a) : src.slice(a, b);
}
