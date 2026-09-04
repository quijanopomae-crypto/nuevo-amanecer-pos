// reference-catalog.test.mjs — suite permanente del CATALOGO MAESTRO DE
// REFERENCIA (V1.1, ciclo 1B).
//
// OBJECTIVE_ID: OCR-COMPRAS-V1.1 / CICLO 1B
//
// Carga POS/js/catalog/reference-catalog{,-data}.js REALES en node:vm SIN DOM.
// El contexto trae espias sobre todo lo que esta capa NO debe tocar: productos,
// stock, inventoryMovements, applyInventoryMovement, ventas, caja, creditos y
// la persistencia V9. La suite NO escribe evidencia y NO escribe archivos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA_REL = 'POS/js/catalog/reference-catalog-data.js';
const CATALOG_REL = 'POS/js/catalog/reference-catalog.js';
const FIXTURE = path.join(ROOT, 'fixtures', 'reference-catalog', 'sample.json');

const SAMPLE = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const DATA_SRC = readFileSync(path.join(ROOT, DATA_REL), 'utf8');
const CATALOG_SRC = readFileSync(path.join(ROOT, CATALOG_REL), 'utf8');

/**
 * Quita comentarios para que las aserciones estaticas se apliquen al CODIGO y
 * no a la documentacion: los comentarios SI deben poder nombrar aquello que la
 * capa tiene prohibido tocar.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  let inSingle = false, inDouble = false, inTemplate = false;
  while (i < source.length) {
    const ch = source[i], next = source[i + 1];
    if (inSingle || inDouble || inTemplate) {
      if (ch === '\\') { out += ch + (next === undefined ? '' : next); i += 2; continue; }
      if (inSingle && ch === "'") inSingle = false;
      else if (inDouble && ch === '"') inDouble = false;
      else if (inTemplate && ch === '`') inTemplate = false;
      out += ch; i += 1; continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === '`') inTemplate = true;
    out += ch; i += 1;
  }
  return out;
}

// Texto SIN comentarios: es sobre este que se verifican los invariantes.
const CATALOG_CODE = stripComments(CATALOG_SRC);

/** Semilla de estado del POS que la capa de referencia NO debe alterar. */
function seedPosState() {
  return {
    productos: [{ id: 1, name: 'COCA COLA 600ML', sku: 'SKU-1', barcode: '7750885000123', stock: 7, stockMin: 5, costo: 2.5, precio: 3.5 }],
    ventas: [{ id: 'V-1', total: 3.5 }],
    clientes: [{ id: 'C-1' }],
    creditos: [{ id: 'CR-1' }],
    gastos: [{ id: 'G-1' }],
    cajMovs: [{ id: 'M-1' }],
    cajEstado: { abierta: true, fondo: 100 },
    inventoryMovements: [{ id: 'IM-1', productId: 1, before: 5, delta: 2, after: 7 }],
  };
}

/**
 * Sandbox sin DOM (no hay document ni window) con espias sobre las
 * operaciones prohibidas para esta capa.
 */
function createCatalogSandbox() {
  const calls = { applyInventoryMovement: 0, saveAllData: 0, storageWrites: 0 };
  const seed = seedPosState();
  const store = {
    getItem: () => null,
    setItem() { calls.storageWrites += 1; },
    removeItem() { calls.storageWrites += 1; },
    clear() { calls.storageWrites += 1; },
  };
  const sandbox = {
    console,
    productos: seed.productos,
    ventas: seed.ventas,
    clientes: seed.clientes,
    creditos: seed.creditos,
    gastos: seed.gastos,
    cajMovs: seed.cajMovs,
    cajEstado: seed.cajEstado,
    inventoryMovements: seed.inventoryMovements,
    applyInventoryMovement() { calls.applyInventoryMovement += 1; return { ok: false }; },
    saveAllData() { calls.saveAllData += 1; return Promise.resolve({ ok: false }); },
    localStorage: store,
    sessionStorage: store,
  };
  const ctx = vm.createContext(sandbox);
  for (const rel of [DATA_REL, CATALOG_REL]) {
    new vm.Script(readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel }).runInContext(ctx);
  }
  return {
    ctx,
    calls,
    seed,
    sandbox,
    api: vm.runInContext('_NA_REFERENCE_CATALOG', ctx),
    data: vm.runInContext('_NA_REFERENCE_CATALOG_DATA', ctx),
    plain(value) { return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)); },
  };
}

/** Sandbox ya inicializado con el fixture de 10 referencias. */
function loaded() {
  const sb = createCatalogSandbox();
  sb.api.initReferenceCatalog(SAMPLE);
  return sb;
}

// ---------------------------------------------------------------------------
// 1-8 — carga y preservacion del modelo
// ---------------------------------------------------------------------------

test('C01 catalogo vacio', () => {
  const sb = createCatalogSandbox();
  const emptySource = { rows: [] };
  assert.deepEqual(sb.plain(sb.api.loadReferenceCatalog(emptySource)), []);
  assert.deepEqual(sb.plain(sb.api.initReferenceCatalog(emptySource).references), []);
  const stats = sb.plain(sb.api.referenceCatalogStats());
  assert.equal(stats.referenceCount, 0);
  assert.equal(stats.duplicateCodeCount, 0);
  assert.equal(stats.duplicateNameCount, 0);
  assert.deepEqual(sb.plain(sb.api.searchReferenceCatalog('coca')), []);
  assert.equal(sb.api.getReferenceById('REF-2'), null);
  assert.deepEqual(sb.plain(sb.api.findReferenceCodeCandidates('1001')), []);
});

test('C01B gates permanentes del dataset productivo real', () => {
  const sb = createCatalogSandbox();
  const data = sb.plain(sb.data);
  const references = sb.api.loadReferenceCatalog(sb.data);
  const indexes = sb.api.buildReferenceCatalogIndexes(references);

  assert.equal(data.generatedRows, 2535);
  assert.equal(data.rows.length, 2535);
  assert.equal(references.length, 2535);
  assert.equal(data.generatedFrom, 'CATALOGO_REFERENCIA_PRODUCTOS_NORMALIZADO.csv');
  assert.equal(data.sourceSha256, 'a1adbe633d0373826171b2df608dd277f8e462eab4e8bfee148b9ca10efb0be8');
  assert.equal(indexes.duplicateCodeCount, 128);
  assert.equal(indexes.duplicateNameCount, 1);

  const codes = new Map();
  const names = new Map();
  for (const row of data.rows) {
    if (row.CODIGO_REFERENCIA) {
      codes.set(row.CODIGO_REFERENCIA, (codes.get(row.CODIGO_REFERENCIA) || 0) + 1);
    }
    const nameKey = (row.NOMBRE_LIMPIO_SEGURO || row.NOMBRE_ORIGINAL).toLowerCase();
    if (nameKey) names.set(nameKey, (names.get(nameKey) || 0) + 1);
  }
  assert.equal([...codes.values()].filter((count) => count > 1).length, 127);
  assert.equal([...names.values()].filter((count) => count > 1).length, 1);
  assert.equal((DATA_SRC.match(/�/g) || []).length, 0);
  for (const sample of ['DISEÑOS', 'PIÑATON', 'CAÑA', 'CUSQUEÑA']) {
    assert.ok(data.rows.some((row) => row.NOMBRE_ORIGINAL.includes(sample)
      || row.NOMBRE_LIMPIO_SEGURO.includes(sample)), `falta muestra Unicode real: ${sample}`);
  }
});

test('C02 carga de referencias', () => {
  const sb = createCatalogSandbox();
  const refs = sb.plain(sb.api.loadReferenceCatalog(SAMPLE));
  assert.equal(refs.length, 10);
  assert.equal(sb.plain(sb.api.initReferenceCatalog(SAMPLE)).references.length, 10);
  assert.equal(sb.plain(sb.api.referenceCatalogStats()).referenceCount, 10);
  // Filas basura no se convierten en referencias inventadas.
  assert.deepEqual(sb.plain(sb.api.loadReferenceCatalog([{}, null, 7, { GRUPO: 'X' }])), []);
});

test('C03 conserva originalName tal cual (solo recorte de espacios)', () => {
  const sb = loaded();
  assert.equal(sb.api.getReferenceById('REF-2').originalName, 'coca cola 600 ml');
  assert.equal(sb.api.getReferenceById('REF-9').originalName, 'leche gloria 400 g');
  assert.equal(sb.api.getReferenceById('REF-4').originalName, 'ARROZ COSTEÑO 5 KG');
});

test('C04 conserva safeName', () => {
  const sb = loaded();
  assert.equal(sb.api.getReferenceById('REF-2').safeName, 'COCA COLA 600 ML');
  assert.equal(sb.api.getReferenceById('REF-9').safeName, 'LECHE GLORIA 400 G');
  assert.equal(sb.api.getReferenceById('REF-5').safeName, 'JABÓN PATITO FLORAL 190 GR');
});

test('C05 conserva sourceRow', () => {
  const sb = loaded();
  const rows = sb.plain(sb.api.loadReferenceCatalog(SAMPLE)).map((r) => r.sourceRow);
  assert.deepEqual(rows, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(sb.api.getReferenceById('REF-7').sourceRow, 7);
});

test('C06 conserva referenceCode sin convertirlo en barcode del POS', () => {
  const sb = loaded();
  assert.equal(sb.api.getReferenceById('REF-2').referenceCode, '1001');
  assert.equal(sb.api.getReferenceById('REF-11').referenceCode, '');
  const ref = sb.plain(sb.api.getReferenceById('REF-2'));
  assert.ok(!('barcode' in ref), 'la referencia no debe exponer barcode');
  assert.ok(!('sku' in ref), 'la referencia no debe exponer sku');
  assert.ok(!('stock' in ref), 'la referencia no debe exponer stock');
  assert.ok(!('precio' in ref) && !('costo' in ref), 'la referencia no lleva precios');
});

test('C07 conserva group', () => {
  const sb = loaded();
  assert.equal(sb.api.getReferenceById('REF-2').group, 'GASEOSAS');
  assert.equal(sb.api.getReferenceById('REF-8').group, 'LACTEOS');
  assert.equal(sb.api.getReferenceById('REF-11').group, 'GOLOSINAS');
});

test('C08 conserva measure sin convertirlo en unidad comercial', () => {
  const sb = loaded();
  assert.equal(sb.api.getReferenceById('REF-2').measure, '600 ML');
  assert.equal(sb.api.getReferenceById('REF-4').measure, '5 KG');
  const ref = sb.plain(sb.api.getReferenceById('REF-2'));
  assert.ok(!('unidad' in ref), 'measure no se convierte en unidad del POS');
  assert.ok(!('unidadCompra' in ref) && !('factorCompra' in ref));
});

// ---------------------------------------------------------------------------
// 9-11 — identidad por codigo: nunca automatica
// ---------------------------------------------------------------------------

test('C09 codigo unico devuelve 1 candidato', () => {
  const sb = loaded();
  const hits = sb.plain(sb.api.findReferenceCodeCandidates('1001'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].referenceId, 'REF-2');
  const resolved = sb.plain(sb.api.resolveReferenceCode('1001'));
  assert.equal(resolved.status, 'UNIQUE');
  assert.equal(resolved.reference.referenceId, 'REF-2');
});

test('C10 codigo duplicado devuelve multiples candidatos', () => {
  const sb = loaded();
  const hits = sb.plain(sb.api.findReferenceCodeCandidates('2000'));
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.referenceId), ['REF-6', 'REF-7']);
  assert.deepEqual(hits.map((h) => h.safeName), [
    'DETERGENTE BOLIVAR 730 G', 'DETERGENTE OPAL ULTRA 730 G',
  ]);
});

test('C11 codigo duplicado NO produce match automatico', () => {
  const sb = loaded();
  const resolved = sb.plain(sb.api.resolveReferenceCode('2000'));
  assert.equal(resolved.status, 'AMBIGUOUS');
  assert.equal(resolved.reference, null, 'AMBIGUOUS nunca elige una referencia');
  assert.equal(resolved.candidates.length, 2);
  // Ambas referencias quedan marcadas para revision humana.
  for (const candidate of resolved.candidates) {
    assert.equal(sb.api.referenceNeedsHumanReview(sb.api.getReferenceById(candidate.referenceId)), true);
  }
  // Codigo inexistente tampoco inventa nada.
  const missing = sb.plain(sb.api.resolveReferenceCode('999999'));
  assert.equal(missing.status, 'NOT_FOUND');
  assert.equal(missing.reference, null);
  assert.deepEqual(missing.candidates, []);
});

// ---------------------------------------------------------------------------
// 12-17 — busqueda
// ---------------------------------------------------------------------------

test('C12 busqueda por nombre', () => {
  const sb = loaded();
  const hits = sb.plain(sb.api.searchReferenceCatalog('DETERGENTE'));
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.reference.referenceId), ['REF-6', 'REF-7']);
  const exact = sb.plain(sb.api.searchReferenceCatalog('COCA COLA 600 ML'));
  assert.equal(exact[0].reference.referenceId, 'REF-2');
  assert.equal(exact[0].score, 90, 'nombre exacto puntua mas que parcial');
});

test('C13 busqueda sin tildes', () => {
  const sb = loaded();
  const withAccent = sb.plain(sb.api.searchReferenceCatalog('ARROZ COSTEÑO'));
  const without = sb.plain(sb.api.searchReferenceCatalog('ARROZ COSTENO'));
  assert.equal(withAccent.length, 1);
  assert.deepEqual(without.map((h) => h.reference.referenceId), withAccent.map((h) => h.reference.referenceId));
  assert.equal(sb.plain(sb.api.searchReferenceCatalog('jabon'))[0].reference.referenceId, 'REF-5');
});

test('C14 busqueda case-insensitive', () => {
  const sb = loaded();
  const upper = sb.plain(sb.api.searchReferenceCatalog('INKA KOLA'));
  const lower = sb.plain(sb.api.searchReferenceCatalog('inka kola'));
  const mixed = sb.plain(sb.api.searchReferenceCatalog('Inka   KoLa'));
  assert.equal(upper.length, 1);
  assert.deepEqual(lower, upper);
  assert.deepEqual(mixed, upper);
});

test('C15 busqueda por codigo', () => {
  const sb = loaded();
  const hits = sb.plain(sb.api.searchReferenceCatalog('1003'));
  assert.equal(hits[0].reference.referenceId, 'REF-4');
  assert.equal(hits[0].score, 100, 'coincidencia exacta de codigo es la senal mas fuerte');
  // Un codigo duplicado devuelve las dos referencias, ambas para revision.
  const dup = sb.plain(sb.api.searchReferenceCatalog('2000'));
  assert.equal(dup.length, 2);
  assert.ok(dup.every((h) => h.needsHumanReview === true));
});

test('C16 busqueda por grupo', () => {
  const sb = loaded();
  const hits = sb.plain(sb.api.searchReferenceCatalog('LACTEOS'));
  assert.deepEqual(hits.map((h) => h.reference.referenceId), ['REF-8', 'REF-9']);
  const limpieza = sb.plain(sb.api.searchReferenceCatalog('limpieza'));
  assert.deepEqual(limpieza.map((h) => h.reference.referenceId), ['REF-5', 'REF-6', 'REF-7']);
});

test('C17 nombre repetido marcado para revision', () => {
  const sb = loaded();
  const stats = sb.plain(sb.api.referenceCatalogStats());
  assert.equal(stats.duplicateNameCount, 1);
  assert.equal(stats.duplicateCodeCount, 1);
  const hits = sb.plain(sb.api.searchReferenceCatalog('LECHE GLORIA 400 G'));
  assert.equal(hits.length, 2);
  assert.ok(hits.every((h) => h.needsHumanReview === true));
  // Nombres repetidos con codigos distintos: no hay resolucion automatica.
  assert.deepEqual(hits.map((h) => h.reference.referenceCode), ['3001', '3002']);
  // Una referencia sin duplicados NO se marca.
  assert.equal(sb.api.referenceNeedsHumanReview(sb.api.getReferenceById('REF-3')), false);
  assert.equal(sb.plain(sb.api.searchReferenceCatalog('INKA KOLA'))[0].needsHumanReview, false);
});

// ---------------------------------------------------------------------------
// 18-23 — aislamiento: la capa de referencia no toca el POS
// ---------------------------------------------------------------------------

/** Ejercita TODA la API publica sobre el sandbox. */
function exerciseFullApi(sb) {
  sb.api.initReferenceCatalog(SAMPLE);
  sb.api.loadReferenceCatalog(SAMPLE);
  sb.api.buildReferenceCatalogIndexes(sb.api.loadReferenceCatalog(SAMPLE));
  sb.api.searchReferenceCatalog('coca cola');
  sb.api.searchReferenceCatalog('2000');
  sb.api.searchReferenceCatalog('LACTEOS');
  sb.api.getReferenceById('REF-2');
  sb.api.findReferenceCodeCandidates('2000');
  sb.api.resolveReferenceCode('1001');
  sb.api.resolveReferenceCode('2000');
  sb.api.referenceNeedsHumanReview(sb.api.getReferenceById('REF-6'));
  sb.api.referenceCatalogStats();
}

test('C18 no toca productos[]', () => {
  const sb = createCatalogSandbox();
  const before = JSON.stringify(sb.seed.productos);
  exerciseFullApi(sb);
  assert.equal(JSON.stringify(vm.runInContext('productos', sb.ctx)), before);
  assert.equal(vm.runInContext('productos.length', sb.ctx), 1);
  assert.ok(!/\bproductos\b/.test(CATALOG_CODE), 'la fuente no debe nombrar productos');
});

test('C19 no toca stock', () => {
  const sb = createCatalogSandbox();
  exerciseFullApi(sb);
  assert.equal(vm.runInContext('productos[0].stock', sb.ctx), 7);
  assert.equal(vm.runInContext('productos[0].stockMin', sb.ctx), 5);
  assert.equal(vm.runInContext('productos[0].costo', sb.ctx), 2.5);
  assert.equal(vm.runInContext('productos[0].precio', sb.ctx), 3.5);
  assert.equal(vm.runInContext('productos[0].sku', sb.ctx), 'SKU-1');
  assert.equal(vm.runInContext('productos[0].barcode', sb.ctx), '7750885000123');
  for (const forbidden of ['stock', 'stockMin', 'costo', 'precio']) {
    assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(CATALOG_CODE), `la fuente no debe nombrar ${forbidden}`);
  }
});

test('C20 no toca inventoryMovements', () => {
  const sb = createCatalogSandbox();
  const before = JSON.stringify(sb.seed.inventoryMovements);
  exerciseFullApi(sb);
  assert.equal(JSON.stringify(vm.runInContext('inventoryMovements', sb.ctx)), before);
  assert.equal(vm.runInContext('inventoryMovements.length', sb.ctx), 1);
  assert.ok(!/inventoryMovements/.test(CATALOG_CODE), 'la fuente no debe nombrar inventoryMovements');
});

test('C21 no llama applyInventoryMovement', () => {
  const sb = createCatalogSandbox();
  exerciseFullApi(sb);
  assert.equal(sb.calls.applyInventoryMovement, 0);
  assert.ok(!/applyInventoryMovement/.test(CATALOG_CODE), 'la fuente no debe nombrar applyInventoryMovement');
});

test('C22 no toca ventas / caja / creditos', () => {
  const sb = createCatalogSandbox();
  const before = {
    ventas: JSON.stringify(sb.seed.ventas),
    clientes: JSON.stringify(sb.seed.clientes),
    creditos: JSON.stringify(sb.seed.creditos),
    gastos: JSON.stringify(sb.seed.gastos),
    cajMovs: JSON.stringify(sb.seed.cajMovs),
    cajEstado: JSON.stringify(sb.seed.cajEstado),
  };
  exerciseFullApi(sb);
  for (const key of Object.keys(before)) {
    assert.equal(JSON.stringify(vm.runInContext(key, sb.ctx)), before[key], `${key} fue alterado`);
    assert.ok(!new RegExp(`\\b${key}\\b`).test(CATALOG_CODE), `la fuente no debe nombrar ${key}`);
  }
});

test('C23 no modifica la persistencia V9', () => {
  const sb = createCatalogSandbox();
  exerciseFullApi(sb);
  assert.equal(sb.calls.saveAllData, 0, 'no debe invocar saveAllData');
  assert.equal(sb.calls.storageWrites, 0, 'no debe escribir en storage');
  for (const forbidden of [
    'saveAllData', '_naQueuePersist', '_naBuildSnapshot', '_naCommitSnapshot',
    'localStorage', 'sessionStorage', 'na_snapshot_v9', '_NA_LOCAL_KEY',
    'indexedDB', 'IDBDatabase', 'navigator.locks', 'BroadcastChannel',
  ]) {
    assert.ok(!CATALOG_CODE.includes(forbidden), `la fuente no debe nombrar ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 24-25 — determinismo y ausencia de DOM
// ---------------------------------------------------------------------------

test('C24 mismo dataset -> mismos indices', () => {
  const sb = createCatalogSandbox();
  const project = (indexes) => ({
    count: indexes.count,
    ids: [...indexes.byId.keys()],
    codes: [...indexes.byCode.keys()].map((k) => [k, indexes.byCode.get(k).map((r) => r.referenceId)]),
    names: [...indexes.byNameKey.keys()],
    groups: [...indexes.byGroup.keys()],
    duplicateCodeKeys: indexes.duplicateCodeKeys,
    duplicateNameKeys: indexes.duplicateNameKeys,
  });
  const a = project(sb.api.buildReferenceCatalogIndexes(sb.api.loadReferenceCatalog(SAMPLE)));
  const b = project(sb.api.buildReferenceCatalogIndexes(sb.api.loadReferenceCatalog(SAMPLE)));
  assert.deepEqual(sb.plain(b), sb.plain(a));
  assert.deepEqual(sb.plain(a.duplicateCodeKeys), ['2000']);
  assert.deepEqual(sb.plain(a.duplicateNameKeys), ['leche gloria 400 g']);
  // Las referencias son inmutables: buildIndexes no modifica los datos fuente.
  const refs = sb.api.loadReferenceCatalog(SAMPLE);
  assert.equal(vm.runInContext('Object.isFrozen', sb.ctx)(refs[0]), true);
  const originalName = refs[0].originalName;
  try { refs[0].originalName = 'HACKEADO'; } catch { /* strict mode del vm */ }
  assert.equal(refs[0].originalName, originalName);
  // Y el fixture en disco no fue mutado por la carga.
  assert.deepEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')), SAMPLE);
});

test('C25 funciona sin DOM', () => {
  const sb = loaded();
  assert.equal(vm.runInContext('typeof document', sb.ctx), 'undefined');
  assert.equal(vm.runInContext('typeof window', sb.ctx), 'undefined');
  assert.equal(vm.runInContext('typeof _NA_REFERENCE_CATALOG', sb.ctx), 'object');
  assert.equal(sb.plain(sb.api.referenceCatalogStats()).referenceCount, 10);
  assert.equal(sb.plain(sb.api.searchReferenceCatalog('oreo'))[0].reference.referenceId, 'REF-10');
  assert.ok(!/document\./.test(CATALOG_CODE), 'la fuente no debe usar document');
  assert.ok(!/\baddEventListener\b/.test(CATALOG_CODE), 'la fuente no debe registrar listeners');
  // Classic script: sin ES modules (compatible con file://).
  assert.ok(!/^\s*(import|export)\s/m.test(CATALOG_CODE), 'no debe usar import/export');
});
