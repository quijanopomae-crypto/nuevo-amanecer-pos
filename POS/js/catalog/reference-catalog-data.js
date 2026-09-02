/*
 * reference-catalog-data.js — DATASET del catalogo maestro de referencia.
 *
 * GENERADO, NO EDITAR A MANO.
 * Generador: tools/import-reference-catalog.mjs
 *
 * Este archivo es SOLO REFERENCIA. No es el inventario del POS. Cargarlo no
 * crea productos, no toca stock, costo, precio, SKU, barcode, ventas, caja,
 * creditos, inventoryMovements ni el snapshot V9.
 *
 * ESTADO ACTUAL: vacio. El XLSX real del catalogo normalizado no esta dentro
 * del worktree. Para poblarlo:
 *
 *   1. copiar el XLSX/CSV normalizado a  fixtures/reference-catalog/source/
 *   2. node tools/import-reference-catalog.mjs <ruta-al-archivo>
 *
 * NO se fabrican registros: mientras la fuente no exista, rows queda en [].
 *
 * Columnas esperadas de la fuente (nombres exactos):
 *   FILA_XLS, CODIGO_REFERENCIA, GRUPO, NOMBRE_ORIGINAL,
 *   NOMBRE_LIMPIO_SEGURO, MEDIDA, CODIGO_DUPLICADO, NOMBRE_DUPLICADO
 *
 * Classic script (sin ES modules, sin defer), compatible con file://.
 */
var _NA_REFERENCE_CATALOG_DATA = {
  schema: 'nuevo-amanecer.reference-catalog/1.0.0',
  generatedFrom: null,
  generatedRows: 0,
  sourceSha256: null,
  columns: [
    'FILA_XLS', 'CODIGO_REFERENCIA', 'GRUPO', 'NOMBRE_ORIGINAL',
    'NOMBRE_LIMPIO_SEGURO', 'MEDIDA', 'CODIGO_DUPLICADO', 'NOMBRE_DUPLICADO',
  ],
  rows: [],
};

if (typeof window !== 'undefined') {
  window._NA_REFERENCE_CATALOG_DATA = _NA_REFERENCE_CATALOG_DATA;
}
