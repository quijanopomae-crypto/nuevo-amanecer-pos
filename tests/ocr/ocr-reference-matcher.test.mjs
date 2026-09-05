// ocr-reference-matcher.test.mjs — contrato del matcher OCR -> catalogo
// maestro de referencia (V1.1, WP-03A).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CATALOG_REL = 'POS/js/catalog/reference-catalog.js';
const MATCHER_REL = 'POS/js/ocr/ocr-reference-matcher.js';
const FIXTURE = path.join(ROOT, 'fixtures', 'reference-catalog', 'sample.json');
const SAMPLE = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const MATCHER_SRC = readFileSync(path.join(ROOT, MATCHER_REL), 'utf8');

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

function createSandbox() {
  const calls = { applyInventoryMovement: 0, saveAllData: 0, storageWrites: 0 };
  const seed = {
    productos: [{ id: 1, stock: 7, costo: 2.5, precio: 3.5 }],
    inventoryMovements: [{ id: 'IM-1' }],
    ventas: [{ id: 'V-1' }],
    cajMovs: [{ id: 'M-1' }],
    creditos: [{ id: 'CR-1' }],
  };
  const store = {
    getItem: () => null,
    setItem() { calls.storageWrites += 1; },
    removeItem() { calls.storageWrites += 1; },
  };
  const ctx = vm.createContext({
    console,
    ...seed,
    applyInventoryMovement() { calls.applyInventoryMovement += 1; },
    saveAllData() { calls.saveAllData += 1; },
    localStorage: store,
    sessionStorage: store,
  });
  new vm.Script(`
    function _naClean(value) { return String(value == null ? '' : value).replace(/[<>]/g, '').trim(); }
    function sinTildes(value) { return String(value).normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); }
    function _naNormCatalogName(value) { return String(value == null ? '' : value).trim().replace(/\\s+/g, ' ').toUpperCase(); }
    function _naProductAltCodes(product) {
      var values = Array.isArray(product && product.codigosAlternativos)
        ? product.codigosAlternativos.slice() : [];
      if (product && product.codigoAlternativo) values.push(product.codigoAlternativo);
      var seen = Object.create(null);
      return values.map(_naClean).filter(function (code) {
        var key = code.toLowerCase();
        if (!code || seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }
    function _naAllProductCodes(product) {
      return [product && product.sku, product && product.barcode]
        .concat(_naProductAltCodes(product)).map(_naClean).filter(Boolean);
    }
  `, { filename: 'canonical-product-helpers.js' }).runInContext(ctx);
  for (const rel of [CATALOG_REL, MATCHER_REL]) {
    new vm.Script(readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel }).runInContext(ctx);
  }
  const catalog = vm.runInContext('_NA_REFERENCE_CATALOG', ctx);
  catalog.initReferenceCatalog(SAMPLE);
  return {
    ctx,
    calls,
    seed,
    catalog,
    api: vm.runInContext('_NA_OCR_REFERENCE_MATCHER', ctx),
    plain(value) { return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)); },
  };
}

function line(name, codes = []) {
  return { raw: name, lineNumber: 1, name, codes, confidence: 0.9, needsReview: false };
}

test('M01 nombre exacto unico produce MATCHED', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchLine(line('COCA COLA 600 ML')));
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.reference.referenceId, 'REF-2');
  assert.equal(result.needsReview, false);
  assert.equal(result.candidates[0].score, 90);
  assert.deepEqual(result.candidates[0].matchedBy, ['NAME_EXACT']);
});

test('M02 codigo unico produce MATCHED sin convertirlo a barcode', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchLine(line('', ['1003'])));
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.reference.referenceId, 'REF-4');
  assert.equal(result.reference.referenceCode, '1003');
  assert.ok(!('barcode' in result.reference));
});

test('M03 codigo y nombre convergentes conservan ambas evidencias', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchLine(line('INKA KOLA 1 L', ['1002'])));
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.reference.referenceId, 'REF-3');
  assert.deepEqual(result.candidates[0].matchedBy, ['CODE_EXACT', 'NAME_EXACT']);
});

test('M04 codigo duplicado requiere revision y no elige', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchLine(line('', ['2000'])));
  assert.equal(result.status, 'REVIEW');
  assert.equal(result.reference, null);
  assert.deepEqual(result.candidates.map((c) => c.reference.referenceId), ['REF-6', 'REF-7']);
  assert.ok(result.reasons.includes('CODIGO_AMBIGUO'));
});

test('M05 nombre duplicado requiere revision y no elige', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchLine(line('LECHE GLORIA 400 G')));
  assert.equal(result.status, 'REVIEW');
  assert.equal(result.reference, null);
  assert.deepEqual(result.candidates.map((c) => c.reference.referenceId), ['REF-8', 'REF-9']);
  assert.ok(result.reasons.includes('NOMBRE_AMBIGUO'));
});

test('M06 conflicto entre codigo y nombre nunca selecciona', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchLine(line('INKA KOLA 1 L', ['1001'])));
  assert.equal(result.status, 'REVIEW');
  assert.equal(result.reference, null);
  assert.ok(result.reasons.includes('CODIGO_NOMBRE_EN_CONFLICTO'));
  assert.deepEqual(result.candidates.map((c) => c.reference.referenceId), ['REF-2', 'REF-3']);
});

test('M07 codigos unicos discordantes requieren revision', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchLine(line('', ['1001', '1002'])));
  assert.equal(result.status, 'REVIEW');
  assert.equal(result.reference, null);
  assert.ok(result.reasons.includes('CODIGOS_EN_CONFLICTO'));
});

test('M08 coincidencia parcial es propuesta, no match automatico', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchLine(line('DETERGENTE')));
  assert.equal(result.status, 'REVIEW');
  assert.equal(result.reference, null);
  assert.ok(result.candidates.every((candidate) => candidate.score < 90));
  assert.ok(result.candidates.every((candidate) => candidate.matchedBy.includes('NAME_PARTIAL')));
  assert.ok(!('confidence' in result), 'el score de busqueda no es probabilidad');
});

test('M09 consulta valida sin candidatos devuelve NOT_FOUND', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchLine(line('PRODUCTO INEXISTENTE')));
  assert.equal(result.status, 'NOT_FOUND');
  assert.equal(result.reference, null);
  assert.deepEqual(result.candidates, []);
});

test('M10 entrada insuficiente o invalida requiere revision', () => {
  const sb = createSandbox();
  assert.deepEqual(sb.plain(sb.api.matchLine(null)).reasons, ['LINEA_INVALIDA']);
  assert.deepEqual(sb.plain(sb.api.matchLine({ name: ' ', codes: [] })).reasons, ['SIN_DATOS_DE_IDENTIDAD']);
  assert.deepEqual(sb.plain(sb.api.matchLines(null)), []);
});

test('M11 lote conserva orden y no agrega lineas', () => {
  const sb = createSandbox();
  const results = sb.plain(sb.api.matchLines([
    line('OREO ORIGINAL 36 G'),
    line('PRODUCTO INEXISTENTE'),
    line('ARROZ COSTEÑO 5 KG'),
  ]));
  assert.deepEqual(results.map((r) => r.status), ['MATCHED', 'NOT_FOUND', 'MATCHED']);
  assert.deepEqual(results.map((r) => r.reference && r.reference.referenceId), ['REF-10', null, 'REF-4']);
});

test('M12 es determinista y no muta lineas, fixture ni referencias', () => {
  const sb = createSandbox();
  const input = line('COCA COLA 600 ML', ['1001']);
  const beforeLine = JSON.stringify(input);
  const beforeFixture = JSON.stringify(SAMPLE);
  const reference = sb.catalog.getReferenceById('REF-2');
  const beforeReference = JSON.stringify(reference);
  const first = sb.plain(sb.api.matchLine(input));
  const second = sb.plain(sb.api.matchLine(input));
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(input), beforeLine);
  assert.equal(JSON.stringify(SAMPLE), beforeFixture);
  assert.equal(JSON.stringify(reference), beforeReference);
});

test('M13 funciona sin DOM y no toca estado ni persistencia del POS', () => {
  const sb = createSandbox();
  const before = JSON.stringify(sb.seed);
  sb.api.matchLine(line('COCA COLA 600 ML', ['1001']));
  sb.api.matchLines([line('DETERGENTE', ['2000'])]);
  assert.equal(vm.runInContext('typeof document', sb.ctx), 'undefined');
  assert.equal(JSON.stringify(sb.seed), before);
  assert.deepEqual(sb.calls, { applyInventoryMovement: 0, saveAllData: 0, storageWrites: 0 });

  const code = stripComments(MATCHER_SRC);
  for (const forbidden of [
    'stock', 'precio', 'costo', 'inventoryMovements',
    'applyInventoryMovement', 'saveAllData', 'localStorage', 'sessionStorage',
    'indexedDB', 'document.', 'addEventListener',
  ]) {
    assert.ok(!code.includes(forbidden), `el matcher no debe usar ${forbidden}`);
  }
  assert.ok(!/^\s*(import|export)\s/m.test(code));
});

const POS_PRODUCTS = [
  { id: 'P1', name: 'COCA COLA 600 ML', sku: 'COCA-600', barcode: '775000000001', codigosAlternativos: ['775000000009'] },
  { id: 'P2', name: 'INKA KOLA 1 L', sku: 'INKA-1L', barcode: '775000000002', codigosAlternativos: [] },
  { id: 'P3', name: 'JABÓN PATITO 190 G', sku: 'PATITO-190', barcode: '775000000003', codigosAlternativos: [] },
];

test('M14 codigo OCR busca sku, barcode y alternativos del producto POS', () => {
  const sb = createSandbox();
  for (const code of ['COCA-600', '775000000001', '775000000009']) {
    const result = sb.plain(sb.api.matchPosProduct(line('', [code]), POS_PRODUCTS));
    assert.equal(result.status, 'MATCHED_SAFE');
    assert.equal(result.product.id, 'P1');
    assert.ok(result.candidates[0].matchedBy.includes('POS_CODE_EXACT'));
  }
});

test('M15 nombre POS exacto unico sin codigo requiere revision', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchPosProduct(line('  jabon   patito 190 g '), POS_PRODUCTS));
  assert.equal(result.status, 'MATCHED_REVIEW');
  assert.equal(result.product, null);
  assert.equal(result.candidates[0].product.id, 'P3');
  assert.ok(result.candidates[0].matchedBy.includes('POS_NAME_EXACT'));
});

test('M16 referencia unica sin producto POS nunca es segura', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchPosProduct(line('OREO ORIGINAL 36 G'), POS_PRODUCTS));
  assert.equal(result.referenceEvidence.status, 'MATCHED');
  assert.equal(result.status, 'NO_SAFE_MATCH');
  assert.equal(result.product, null);
  assert.deepEqual(result.reasons, ['SOLO_REFERENCIA_SIN_PRODUCTO_POS']);
});

test('M17 referenceCode no se usa como codigo de producto POS', () => {
  const sb = createSandbox();
  const products = [{ id: 'P1003', name: 'OTRO PRODUCTO', sku: '', barcode: '1003', codigosAlternativos: [] }];
  const result = sb.plain(sb.api.matchPosProduct(line('ARROZ COSTEÑO 5 KG'), products));
  assert.equal(result.referenceEvidence.reference.referenceCode, '1003');
  assert.equal(result.status, 'NO_SAFE_MATCH');
  assert.equal(result.product, null);
});

test('M18 codigo POS duplicado es ambiguo y requiere revision', () => {
  const sb = createSandbox();
  const products = [
    { id: 'D1', name: 'PRODUCTO A', sku: 'DUP-1', barcode: '', codigosAlternativos: [] },
    { id: 'D2', name: 'PRODUCTO B', sku: '', barcode: 'DUP-1', codigosAlternativos: [] },
  ];
  const result = sb.plain(sb.api.matchPosProduct(line('', ['DUP-1']), products));
  assert.equal(result.status, 'MATCHED_REVIEW');
  assert.equal(result.product, null);
  assert.deepEqual(result.candidates.map((candidate) => candidate.product.id), ['D1', 'D2']);
});

test('M19 nombre POS duplicado es ambiguo y requiere revision', () => {
  const sb = createSandbox();
  const products = [
    { id: 'N1', name: 'LECHE GLORIA 400 G', sku: 'N1', barcode: '', codigosAlternativos: [] },
    { id: 'N2', name: 'LECHE GLORIA 400 G', sku: 'N2', barcode: '', codigosAlternativos: [] },
  ];
  const result = sb.plain(sb.api.matchPosProduct(line('LECHE GLORIA 400 G'), products));
  assert.equal(result.status, 'MATCHED_REVIEW');
  assert.equal(result.product, null);
});

test('M20 codigo y nombre POS discordantes requieren revision', () => {
  const sb = createSandbox();
  const exact = sb.plain(sb.api.matchPosProduct(line('INKA KOLA 1 L', ['775000000001']), POS_PRODUCTS));
  assert.equal(exact.status, 'MATCHED_REVIEW');
  assert.equal(exact.product, null);
  assert.deepEqual(exact.candidates.map((candidate) => candidate.product.id), ['P1', 'P2']);

  const partial = sb.plain(sb.api.matchPosProduct(line('INKA KOLA', ['775000000001']), POS_PRODUCTS));
  assert.equal(partial.status, 'MATCHED_REVIEW');
  assert.equal(partial.product, null);
  assert.deepEqual(partial.candidates.map((candidate) => candidate.product.id), ['P1', 'P2']);
});

test('M21 coincidencia parcial POS nunca es segura', () => {
  const sb = createSandbox();
  const result = sb.plain(sb.api.matchPosProduct(line('COCA COLA'), POS_PRODUCTS));
  assert.equal(result.status, 'MATCHED_REVIEW');
  assert.equal(result.product, null);
  assert.ok(result.candidates[0].matchedBy.includes('POS_NAME_PARTIAL'));
});

test('M22 sin productos o helpers no puede devolver producto seguro', () => {
  const sb = createSandbox();
  assert.equal(sb.plain(sb.api.matchPosProduct(line('COCA COLA 600 ML'), null)).status, 'NO_SAFE_MATCH');
  vm.runInContext('_naAllProductCodes = null', sb.ctx);
  assert.equal(sb.plain(sb.api.matchPosProduct(line('COCA COLA 600 ML'), POS_PRODUCTS)).status, 'NO_SAFE_MATCH');
});

test('M23 lote POS conserva orden, identidad y no muta entradas', () => {
  const sb = createSandbox();
  const lines = [line('COCA COLA 600 ML', ['775000000001']), line('OREO ORIGINAL 36 G')];
  const beforeLines = JSON.stringify(lines);
  const beforeProducts = JSON.stringify(POS_PRODUCTS);
  const results = sb.plain(sb.api.matchPosProducts(lines, POS_PRODUCTS));
  assert.deepEqual(results.map((result) => result.status), ['MATCHED_SAFE', 'NO_SAFE_MATCH']);
  assert.equal(results[0].product.id, 'P1');
  assert.equal(JSON.stringify(lines), beforeLines);
  assert.equal(JSON.stringify(POS_PRODUCTS), beforeProducts);
  assert.deepEqual(sb.calls, { applyInventoryMovement: 0, saveAllData: 0, storageWrites: 0 });
});
