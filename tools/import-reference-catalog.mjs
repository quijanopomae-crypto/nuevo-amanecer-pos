#!/usr/bin/env node
// import-reference-catalog.mjs — IMPORTADOR del catalogo maestro de referencia.
//
// OBJECTIVE_ID: OCR-COMPRAS-V1.1 / CICLO 1B
//
// Herramienta MANUAL. Convierte el catalogo normalizado (CSV / JSON / XLSX si
// el paquete `xlsx` esta disponible) en el dataset versionado
// POS/js/catalog/reference-catalog-data.js.
//
// Uso:
//   node tools/import-reference-catalog.mjs <archivo> [--dry-run]
//
// El UNICO archivo que escribe es POS/js/catalog/reference-catalog-data.js.
// No toca productos, stock, ledger, ventas, caja, creditos ni el snapshot V9.
// Sin dependencias obligatorias: CSV y JSON se leen con Node puro.
//
// Columnas esperadas (nombres exactos del XLSX normalizado):
//   FILA_XLS, CODIGO_REFERENCIA, GRUPO, NOMBRE_ORIGINAL,
//   NOMBRE_LIMPIO_SEGURO, MEDIDA, CODIGO_DUPLICADO, NOMBRE_DUPLICADO

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'POS', 'js', 'catalog', 'reference-catalog-data.js');

export const COLUMNS = [
  'FILA_XLS', 'CODIGO_REFERENCIA', 'GRUPO', 'NOMBRE_ORIGINAL',
  'NOMBRE_LIMPIO_SEGURO', 'MEDIDA', 'CODIGO_DUPLICADO', 'NOMBRE_DUPLICADO',
];

/** Parser CSV/TSV RFC4180: comillas, delimitador embebido y saltos de linea. */
export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

/** Detecta el delimitador mas frecuente en la primera linea. */
export function detectDelimiter(text) {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/)[0] || '';
  const counts = [[',', 0], [';', 0], ['\t', 0], ['|', 0]];
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    const entry = counts.find((c) => c[0] === ch);
    if (entry) entry[1] += 1;
  }
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** Convierte una matriz con cabecera en objetos por nombre de columna. */
export function rowsToObjects(matrix) {
  if (!matrix.length) return [];
  const header = matrix[0].map((h) => String(h).trim());
  return matrix.slice(1).map((cells) => {
    const obj = {};
    for (let i = 0; i < header.length; i += 1) {
      if (!header[i]) continue;
      obj[header[i]] = cells[i] === undefined ? '' : cells[i];
    }
    return obj;
  });
}

/** Lee la fuente segun su extension. XLSX solo si el paquete esta instalado. */
export async function readSource(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : (parsed.rows || []);
  }
  if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
    const text = readFileSync(file, 'utf8');
    return rowsToObjects(parseDelimited(text, detectDelimiter(text)));
  }
  if (ext === '.xlsx' || ext === '.xls') {
    let XLSX = null;
    try { XLSX = await import('xlsx'); } catch { XLSX = null; }
    if (!XLSX) {
      throw new Error(
        'XLSX no se puede leer sin el paquete "xlsx", que este repositorio NO '
        + 'incluye como dependencia. Exporta la hoja a CSV UTF-8 y vuelve a '
        + 'ejecutar el importador con el .csv.'
      );
    }
    const book = XLSX.read(readFileSync(file), { type: 'buffer' });
    const sheet = book.Sheets[book.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  }
  throw new Error(`Extension no soportada: ${ext || '(sin extension)'}`);
}

/** Deja cada fila con las 8 columnas canonicas, en orden estable por FILA_XLS. */
export function canonicalizeRows(rawRows) {
  const rows = rawRows.map((raw) => {
    const out = {};
    for (const column of COLUMNS) {
      const value = raw[column];
      out[column] = value === null || value === undefined ? '' : String(value).trim();
    }
    return out;
  }).filter((row) => row.NOMBRE_ORIGINAL || row.NOMBRE_LIMPIO_SEGURO || row.CODIGO_REFERENCIA);
  rows.sort((a, b) => {
    const an = Number(a.FILA_XLS), bn = Number(b.FILA_XLS);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return String(a.FILA_XLS).localeCompare(String(b.FILA_XLS));
  });
  return rows;
}

/** Genera el contenido del dataset versionado (classic script). */
export function renderDataset(rows, meta) {
  const header = [
    '/*',
    ' * reference-catalog-data.js — DATASET del catalogo maestro de referencia.',
    ' *',
    ' * GENERADO, NO EDITAR A MANO.',
    ' * Generador: tools/import-reference-catalog.mjs',
    ' *',
    ' * Solo referencia: cargarlo no crea productos, no toca stock, costo,',
    ' * precio, SKU, barcode, ventas, caja, creditos, inventoryMovements ni el',
    ' * snapshot V9.',
    ' *',
    ' * Classic script (sin ES modules, sin defer), compatible con file://.',
    ' */',
  ].join('\n');
  const body = {
    schema: 'nuevo-amanecer.reference-catalog/1.0.0',
    generatedFrom: meta.generatedFrom,
    generatedRows: rows.length,
    sourceSha256: meta.sourceSha256,
    columns: COLUMNS,
    rows,
  };
  return `${header}\nvar _NA_REFERENCE_CATALOG_DATA = ${JSON.stringify(body, null, 2)};\n\n`
    + 'if (typeof window !== \'undefined\') {\n'
    + '  window._NA_REFERENCE_CATALOG_DATA = _NA_REFERENCE_CATALOG_DATA;\n'
    + '}\n';
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Uso: node tools/import-reference-catalog.mjs <archivo.csv|.json|.xlsx> [--dry-run]');
    process.exit(2);
  }
  const absolute = path.resolve(file);
  const rows = canonicalizeRows(await readSource(absolute));
  const sourceSha256 = createHash('sha256').update(readFileSync(absolute)).digest('hex');
  const content = renderDataset(rows, { generatedFrom: path.basename(absolute), sourceSha256 });
  const codes = new Map(), names = new Map();
  for (const row of rows) {
    if (row.CODIGO_REFERENCIA) codes.set(row.CODIGO_REFERENCIA, (codes.get(row.CODIGO_REFERENCIA) || 0) + 1);
    const key = (row.NOMBRE_LIMPIO_SEGURO || row.NOMBRE_ORIGINAL).toLowerCase();
    if (key) names.set(key, (names.get(key) || 0) + 1);
  }
  const dupCodes = [...codes.values()].filter((n) => n > 1).length;
  const dupNames = [...names.values()].filter((n) => n > 1).length;
  console.log(`referencias: ${rows.length}`);
  console.log(`codigos repetidos: ${dupCodes}`);
  console.log(`nombres repetidos: ${dupNames}`);
  console.log(`sha256 fuente: ${sourceSha256}`);
  if (dryRun) { console.log('--dry-run: no se escribio nada'); return; }
  writeFileSync(OUT, content, 'utf8');
  console.log(`escrito: ${path.relative(ROOT, OUT)}`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`
  || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(String(error.message || error)); process.exit(1); });
}
