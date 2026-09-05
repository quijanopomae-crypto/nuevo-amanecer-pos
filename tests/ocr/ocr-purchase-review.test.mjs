// ocr-purchase-review.test.mjs — contrato de revisión humana OCR (WP-05).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SOURCE = readFileSync(path.join(ROOT, 'POS/js/ocr/ocr-purchase-review.js'), 'utf8');

class FakeElement {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.listeners = {};
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  removeEventListener(type, listener) {
    if (this.listeners[type] === listener) delete this.listeners[type];
  }
}

class FakeDocument {
  createElement(tag) { return new FakeElement(tag, this); }
}

const PRODUCTS = [
  { id: 'P1', name: 'COCA COLA 600ML' },
  { id: 'P2', name: 'INKA KOLA 1L' },
  { id: 'P3', name: 'JABON PATITO 190G' },
];

function proposal(status, overrides = {}) {
  const safe = status === 'MATCHED_SAFE';
  const candidateProducts = overrides.candidates || (status === 'NO_SAFE_MATCH' ? [] : [PRODUCTS[safe ? 0 : 1]]);
  return {
    sourceIndex: overrides.sourceIndex ?? 0,
    parsed: {
      raw: overrides.raw || 'COCA COLA 600ML 2 3.50',
      name: overrides.name || 'COCA COLA 600ML',
      qty: overrides.quantity ?? 2,
      unitPrice: overrides.unitCost ?? 3.5,
      reasons: overrides.parsedReasons || [],
    },
    match: {
      status,
      product: safe ? (overrides.product || PRODUCTS[0]) : null,
      candidates: candidateProducts.map((product) => ({ product, matchedBy: ['POS_NAME_EXACT'] })),
      reasons: overrides.matchReasons || (safe ? ['CODIGO_POS_UNICO'] : ['REVISION_REQUERIDA']),
    },
    proposedProductId: safe ? String((overrides.product || PRODUCTS[0]).id) : null,
    proposedQty: overrides.quantity ?? 2,
    proposedUnitCost: overrides.unitCost ?? 3.5,
    status,
    needsReview: !safe,
    reasons: overrides.reasons || (safe ? ['CODIGO_POS_UNICO'] : ['REVISION_REQUERIDA']),
  };
}

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)];
}

function byClass(container, className) {
  return descendants(container).filter((node) => node.className === className);
}

function visibleText(container) {
  return descendants(container).map((node) => node.textContent).filter(Boolean).join(' ');
}

function createReview(proposals, products = PRODUCTS) {
  const calls = { inventory: 0, persistence: 0, storage: 0 };
  const context = vm.createContext({
    console,
    applyInventoryMovement() { calls.inventory += 1; },
    saveAllData() { calls.persistence += 1; },
    localStorage: { setItem() { calls.storage += 1; } },
    sessionStorage: { setItem() { calls.storage += 1; } },
  });
  new vm.Script(SOURCE, { filename: 'POS/js/ocr/ocr-purchase-review.js' }).runInContext(context);
  const doc = new FakeDocument();
  const container = doc.createElement('div');
  const create = vm.runInContext('createPurchaseReview', context);
  const controller = create(container, { proposals }, { products });
  return { calls, context, container, controller, plain: (value) => JSON.parse(JSON.stringify(value)) };
}

test('U01 render propuesta SAFE', () => {
  const { container } = createReview([proposal('MATCHED_SAFE')]);
  assert.equal(byClass(container, 'ocr-review-row').length, 1);
  assert.match(visibleText(container), /COCA COLA 600ML/);
  assert.match(visibleText(container), /MATCHED_SAFE/);
});

test('U02 render REVIEW', () => {
  const { container } = createReview([proposal('MATCHED_REVIEW')]);
  assert.match(visibleText(container), /MATCHED_REVIEW/);
});

test('U03 render NO_SAFE_MATCH', () => {
  const { container } = createReview([proposal('NO_SAFE_MATCH')]);
  assert.match(visibleText(container), /NO_SAFE_MATCH/);
});

test('U04 reasons visibles', () => {
  const { container } = createReview([proposal('MATCHED_REVIEW', { reasons: ['CODIGO_AMBIGUO', 'REVISAR'] })]);
  assert.match(visibleText(container), /CODIGO_AMBIGUO/);
  assert.match(visibleText(container), /REVISAR/);
});

test('U05 candidatos visibles', () => {
  const { container } = createReview([proposal('MATCHED_REVIEW', { candidates: [PRODUCTS[1], PRODUCTS[2]] })]);
  const text = visibleText(container);
  assert.match(text, /INKA KOLA 1L/);
  assert.match(text, /JABON PATITO 190G/);
});

test('U06 SAFE no queda confirmado automaticamente', () => {
  const { controller } = createReview([proposal('MATCHED_SAFE')]);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getReviewedPurchaseProposals())), []);
});

test('U07 confirmar SAFE manualmente', () => {
  const input = proposal('MATCHED_SAFE');
  const { controller } = createReview([input]);
  assert.equal(controller.confirm(0).ok, true);
  const reviewed = controller.getReviewedPurchaseProposals();
  assert.equal(reviewed[0].decision, 'CONFIRMED');
  assert.equal(reviewed[0].productId, 'P1');
});

test('U08 REVIEW exige seleccion humana', () => {
  const { controller } = createReview([proposal('MATCHED_REVIEW')]);
  const result = controller.confirm(0);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('PRODUCTO_REQUERIDO'));
  assert.ok(result.errors.includes('SELECCION_HUMANA_REQUERIDA'));
});

test('U09 NO_SAFE_MATCH exige seleccion valida', () => {
  const { controller } = createReview([proposal('NO_SAFE_MATCH')]);
  assert.equal(controller.confirm(0).ok, false);
  controller.correct(0, { productId: 'NO_EXISTE' });
  assert.equal(controller.confirm(0).ok, false);
  controller.correct(0, { productId: 'P2' });
  assert.equal(controller.confirm(0).ok, true);
});

test('U10 corregir producto', () => {
  const { controller } = createReview([proposal('MATCHED_REVIEW')]);
  controller.correct(0, { productId: 'P2' });
  controller.confirm(0);
  const reviewed = controller.getReviewedPurchaseProposals()[0];
  assert.equal(reviewed.productId, 'P2');
  assert.equal(reviewed.humanEdited, true);
});

test('U11 corregir cantidad', () => {
  const { controller } = createReview([proposal('MATCHED_SAFE')]);
  controller.correct(0, { quantity: '5' });
  controller.confirm(0);
  assert.equal(controller.getReviewedPurchaseProposals()[0].quantity, 5);
});

test('U12 corregir costo', () => {
  const { controller } = createReview([proposal('MATCHED_SAFE')]);
  controller.correct(0, { unitCost: '4.75' });
  controller.confirm(0);
  assert.equal(controller.getReviewedPurchaseProposals()[0].unitCost, 4.75);
});

test('U13 cantidad invalida bloquea confirmacion', () => {
  for (const value of ['', 0, -1, 'abc']) {
    const { controller } = createReview([proposal('MATCHED_SAFE')]);
    controller.correct(0, { quantity: value });
    const result = controller.confirm(0);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('CANTIDAD_INVALIDA'));
  }
});

test('U14 costo invalido bloquea confirmacion', () => {
  for (const value of ['', 0, -1, 'abc']) {
    const { controller } = createReview([proposal('MATCHED_SAFE')]);
    controller.correct(0, { unitCost: value });
    const result = controller.confirm(0);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('COSTO_INVALIDO'));
  }
});

test('U15 descartar fila', () => {
  const { controller } = createReview([proposal('NO_SAFE_MATCH')]);
  assert.equal(controller.discard(0).ok, true);
  const reviewed = controller.getReviewedPurchaseProposals()[0];
  assert.deepEqual({ decision: reviewed.decision, productId: reviewed.productId }, { decision: 'DISCARDED', productId: null });
});

test('U16 mezcla confirmar corregir y descartar', () => {
  const proposals = [proposal('MATCHED_SAFE'), proposal('MATCHED_REVIEW', { sourceIndex: 1 }), proposal('NO_SAFE_MATCH', { sourceIndex: 2 })];
  const { controller } = createReview(proposals);
  controller.confirm(0);
  controller.correct(1, { productId: 'P2', quantity: 4, unitCost: 5 });
  controller.confirm(1);
  controller.discard(2);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getReviewedPurchaseProposals().map((row) => row.decision))), ['CONFIRMED', 'CONFIRMED', 'DISCARDED']);
});

test('U17 orden conservado', () => {
  const proposals = [proposal('MATCHED_SAFE', { sourceIndex: 9 }), proposal('MATCHED_SAFE', { sourceIndex: 3 })];
  const { controller } = createReview(proposals);
  controller.confirm(0);
  controller.confirm(1);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getReviewedPurchaseProposals().map((row) => row.sourceIndex))), [9, 3]);
});

test('U18 originalProposal preservado', () => {
  const original = proposal('MATCHED_SAFE');
  const { controller } = createReview([original]);
  controller.confirm(0);
  assert.equal(controller.getReviewedPurchaseProposals()[0].originalProposal, original);
});

test('U19 no muta propuestas de entrada', () => {
  const proposals = [proposal('MATCHED_SAFE'), proposal('MATCHED_REVIEW', { sourceIndex: 1 })];
  const before = JSON.stringify(proposals);
  const { controller } = createReview(proposals);
  controller.correct(0, { quantity: 8, unitCost: 9 });
  controller.confirm(0);
  controller.correct(1, { productId: 'P2' });
  controller.discard(1);
  assert.equal(JSON.stringify(proposals), before);
});

test('U20 no inventario ni persistencia', () => {
  const { controller, calls } = createReview([proposal('MATCHED_SAFE')]);
  controller.correct(0, { quantity: 3 });
  controller.confirm(0);
  controller.discard(0);
  controller.getReviewedPurchaseProposals();
  assert.deepEqual(calls, { inventory: 0, persistence: 0, storage: 0 });
});
