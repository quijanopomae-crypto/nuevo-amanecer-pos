// ocr-purchase-engine.test.mjs — contrato del orquestador puro WP-04B.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FILES = [
  'POS/js/ocr/ocr-parse.js',
  'POS/js/ocr/ocr-reference-matcher.js',
  'POS/js/ocr/ocr-purchase-engine.js',
];

const PRODUCTS = [
  { id: 'P1', name: 'COCA COLA 600ML', sku: '', barcode: '775000000001', codigosAlternativos: [] },
  { id: 'P2', name: 'INKA KOLA 1L', sku: '', barcode: '775000000002', codigosAlternativos: [] },
  { id: 'P3', name: 'JABON PATITO 190G', sku: '', barcode: '775000000003', codigosAlternativos: [] },
];

function createSandbox() {
  const calls = { inventory: 0, persistence: 0, storage: 0 };
  const store = {
    getItem() { return null; },
    setItem() { calls.storage += 1; },
    removeItem() { calls.storage += 1; },
  };
  const ctx = vm.createContext({
    console,
    localStorage: store,
    sessionStorage: store,
    applyInventoryMovement() { calls.inventory += 1; },
    saveAllData() { calls.persistence += 1; },
  });
  new vm.Script(`
    function sinTildes(value) { return String(value).normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); }
    function _naNormCatalogName(value) { return String(value == null ? '' : value).trim().replace(/\\s+/g, ' ').toUpperCase(); }
    function _naProductAltCodes(product) { return Array.isArray(product && product.codigosAlternativos) ? product.codigosAlternativos.slice() : []; }
    function _naAllProductCodes(product) { return [product && product.sku, product && product.barcode].concat(_naProductAltCodes(product)).filter(Boolean); }
    var _NA_REFERENCE_CATALOG = {
      resolveReferenceCode: function () { return { status: 'NOT_FOUND', reference: null, candidates: [] }; },
      searchReferenceCatalog: function (name) {
        if (sinTildes(name).toUpperCase() !== 'OREO ORIGINAL 36 G') return [];
        return [{ reference: { referenceId: 'REF-OREO', referenceCode: '1003', name: 'OREO ORIGINAL 36 G', sourceRow: 1 }, score: 90, needsHumanReview: false }];
      },
      referenceNeedsHumanReview: function () { return false; }
    };
  `).runInContext(ctx);
  for (const rel of FILES) {
    new vm.Script(readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel }).runInContext(ctx);
  }
  return {
    ctx,
    calls,
    process: vm.runInContext('processPurchaseOcrText', ctx),
    parse: vm.runInContext('parsePurchaseText', ctx),
    match: vm.runInContext('matchOcrLineToPosProduct', ctx),
    plain(value) { return JSON.parse(JSON.stringify(value)); },
  };
}

function process(text, products = PRODUCTS) {
  const sb = createSandbox();
  return { sb, result: sb.plain(sb.process(text, { products })) };
}

function one(text, products = PRODUCTS) {
  const output = process(text, products);
  assert.equal(output.result.proposals.length, 1);
  return { ...output, proposal: output.result.proposals[0] };
}

test('B01 texto vacio', () => {
  const { result } = process('');
  assert.equal(result.ok, true);
  assert.deepEqual(result.proposals, []);
  assert.deepEqual(result.summary, { total: 0, safe: 0, review: 0, noSafeMatch: 0 });
});

test('B02 codigo POS unico produce SAFE', () => {
  const { proposal } = one('775000000001 COCA COLA 600ML 2 3.50');
  assert.equal(proposal.status, 'MATCHED_SAFE');
  assert.equal(proposal.match.status, 'MATCHED_SAFE');
  assert.equal(proposal.proposedProductId, 'P1');
});

test('B03 nombre exacto unico sin codigo produce REVIEW', () => {
  const { proposal } = one('JABON PATITO 190G 2 3.50');
  assert.equal(proposal.status, 'MATCHED_REVIEW');
  assert.equal(proposal.proposedProductId, null);
});

test('B04 codigo duplicado produce REVIEW', () => {
  const products = [
    { id: 'D1', name: 'PRODUCTO A', barcode: '775000000099', codigosAlternativos: [] },
    { id: 'D2', name: 'PRODUCTO B', barcode: '775000000099', codigosAlternativos: [] },
  ];
  const { proposal } = one('775000000099 2 3.50', products);
  assert.equal(proposal.status, 'MATCHED_REVIEW');
  assert.deepEqual(proposal.match.reasons, ['CODIGO_POS_AMBIGUO']);
});

test('B05 codigo y nombre discordantes producen REVIEW', () => {
  const { proposal } = one('775000000001 INKA KOLA 1L 2 3.50');
  assert.equal(proposal.status, 'MATCHED_REVIEW');
  assert.deepEqual(proposal.match.reasons, ['CODIGO_NOMBRE_POS_EN_CONFLICTO']);
});

test('B06 solo referencia produce NO_SAFE_MATCH', () => {
  const { proposal } = one('OREO ORIGINAL 36 G 2 3.50');
  assert.equal(proposal.match.referenceEvidence.status, 'MATCHED');
  assert.equal(proposal.status, 'NO_SAFE_MATCH');
  assert.equal(proposal.proposedProductId, null);
});

test('B07 sin candidato produce NO_SAFE_MATCH', () => {
  const { proposal } = one('PRODUCTO INEXISTENTE 2 3.50');
  assert.equal(proposal.status, 'NO_SAFE_MATCH');
  assert.deepEqual(proposal.match.reasons, ['SIN_PRODUCTO_POS_CANDIDATO']);
});

test('B08 multiples lineas mixtas resumen correctamente', () => {
  const { result } = process([
    '775000000001 COCA COLA 600ML 2 3.50',
    'JABON PATITO 190G 1 2.50',
    'PRODUCTO INEXISTENTE 3 4.00',
  ].join('\n'));
  assert.deepEqual(result.proposals.map((item) => item.status), ['MATCHED_SAFE', 'MATCHED_REVIEW', 'NO_SAFE_MATCH']);
  assert.deepEqual(result.summary, { total: 3, safe: 1, review: 1, noSafeMatch: 1 });
});

test('B09 orden de propuestas conservado', () => {
  const { result } = process('INKA KOLA 1L 1 4.20\nCOCA COLA 600ML 2 3.50');
  assert.deepEqual(result.proposals.map((item) => item.sourceIndex), [0, 1]);
  assert.deepEqual(result.proposals.map((item) => item.parsed.name), ['INKA KOLA 1L', 'COCA COLA 600ML']);
});

test('B10 cantidad preservada', () => {
  const { proposal } = one('775000000001 COCA COLA 600ML 7 3.50');
  assert.equal(proposal.proposedQty, 7);
  assert.equal(proposal.parsed.qty, 7);
});

test('B11 precio preservado como costo propuesto', () => {
  const { proposal } = one('775000000001 COCA COLA 600ML 2 3.75');
  assert.equal(proposal.proposedUnitCost, 3.75);
  assert.equal(proposal.parsed.unitPrice, 3.75);
});

test('B12 total preservado dentro del resultado del parser', () => {
  const { proposal } = one('775000000001 COCA COLA 600ML 2 3.50 7.00');
  assert.equal(proposal.parsed.total, 7);
  assert.equal(proposal.parsed.totalMatches, true);
});

test('B13 reasons del parser y matcher se preservan', () => {
  const { proposal } = one('JABON PATITO 190G 2 3,50');
  assert.ok(proposal.parsed.reasons.includes('DECIMAL_CON_COMA'));
  assert.ok(proposal.match.reasons.includes('SOLO_NOMBRE_POS_EXACTO'));
  assert.ok(proposal.reasons.includes('DECIMAL_CON_COMA'));
  assert.ok(proposal.reasons.includes('SOLO_NOMBRE_POS_EXACTO'));
});

test('B14 productId solo aparece en match seguro', () => {
  const { result } = process([
    '775000000001 COCA COLA 600ML 2 3.50',
    'JABON PATITO 190G 2 3.50',
    'PRODUCTO INEXISTENTE 2 3.50',
  ].join('\n'));
  assert.deepEqual(result.proposals.map((item) => item.proposedProductId), ['P1', null, null]);
});

test('B15 linea problematica no rompe el lote', () => {
  const sb = createSandbox();
  const parsed = sb.plain(sb.parse('COCA COLA 600ML 1 3.50\nINKA KOLA 1L 2 4.20'));
  let calls = 0;
  const matcher = (line, products) => {
    calls += 1;
    if (calls === 1) throw new Error('linea aislada');
    return sb.match(line, products);
  };
  const result = sb.plain(sb.process('ignored', {
    products: PRODUCTS,
    parsePurchaseText: () => parsed,
    matchOcrLineToPosProduct: matcher,
  }));
  assert.equal(result.proposals.length, 2);
  assert.equal(result.proposals[0].status, 'NO_SAFE_MATCH');
  assert.equal(result.proposals[1].status, 'MATCHED_REVIEW');
  assert.equal(result.errors[0].code, 'MATCHER_FAILED');
});

test('B16 salida determinista', () => {
  const sb = createSandbox();
  const text = '775000000001 COCA COLA 600ML 2 3.50';
  assert.deepEqual(sb.plain(sb.process(text, { products: PRODUCTS })), sb.plain(sb.process(text, { products: PRODUCTS })));
});

test('B17 products no mutados', () => {
  const products = structuredClone(PRODUCTS);
  const before = JSON.stringify(products);
  process('775000000001 COCA COLA 600ML 2 3.50', products);
  assert.equal(JSON.stringify(products), before);
});

test('B18 resultados del parser no mutados', () => {
  const sb = createSandbox();
  const rows = sb.plain(sb.parse('775000000001 COCA COLA 600ML 2 3.50'));
  const before = JSON.stringify(rows);
  sb.process('ignored', { products: PRODUCTS, parsePurchaseText: () => rows });
  assert.equal(JSON.stringify(rows), before);
});

test('B19 sin inventario ni persistencia', () => {
  const { sb } = process('775000000001 COCA COLA 600ML 2 3.50');
  assert.deepEqual(sb.calls, { inventory: 0, persistence: 0, storage: 0 });
});

test('B20 funciona sin DOM', () => {
  const { sb, result } = process('775000000001 COCA COLA 600ML 2 3.50');
  assert.equal(vm.runInContext('typeof document', sb.ctx), 'undefined');
  assert.equal(vm.runInContext('typeof window', sb.ctx), 'undefined');
  assert.equal(result.proposals[0].status, 'MATCHED_SAFE');
});
