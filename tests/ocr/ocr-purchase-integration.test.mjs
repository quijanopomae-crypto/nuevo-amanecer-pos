// ocr-purchase-integration.test.mjs — pegamento end-to-end de compras OCR (WP-07).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const REL = 'POS/js/ocr/ocr-purchase-integration.js';
const SOURCE = readFileSync(path.join(ROOT, REL), 'utf8');
const INDEX = readFileSync(path.join(ROOT, 'POS/index.html'), 'utf8');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor() {
    this.listeners = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.textContent = '';
    this.disabled = false;
    this.files = [];
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  removeEventListener(type, listener) { if (this.listeners[type] === listener) delete this.listeners[type]; }
  dispatch(type) { return this.listeners[type] && this.listeners[type]({ target: this }); }
}

function image(name = 'purchase.png', bytes = [1, 2, 3], type = 'image/png') {
  return {
    name,
    type,
    size: bytes.length,
    lastModified: 100,
    async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
  };
}

function proposal(status = 'MATCHED_SAFE', index = 0) {
  return {
    sourceIndex: index,
    parsed: { raw: '775000000001 PRODUCTO 2 3.50', name: 'PRODUCTO', qty: 2, unitPrice: 3.5 },
    match: { status, product: status === 'MATCHED_SAFE' ? { id: 'P1' } : null, candidates: [], reasons: [status] },
    proposedProductId: status === 'MATCHED_SAFE' ? 'P1' : null,
    proposedQty: 2,
    proposedUnitCost: 3.5,
    status,
    reasons: [status],
  };
}

function sandbox(overrides = {}) {
  const elements = {
    file: new FakeElement(), start: new FakeElement(), status: new FakeElement(),
    modal: new FakeElement(), rawText: new FakeElement(), review: new FakeElement(),
    apply: new FakeElement(), close: new FakeElement(),
  };
  const products = [{ id: 'P1', name: 'PRODUCTO', stock: 10 }];
  const movements = [];
  const calls = { extract: 0, process: 0, review: 0, apply: 0, refresh: 0 };
  let reviewed = overrides.reviewed || [];
  let releaseApply;
  let releaseExtract;
  const applyGate = overrides.delayedApply ? new Promise((resolve) => { releaseApply = resolve; }) : null;
  const extractGate = overrides.delayExtractAt ? new Promise((resolve) => { releaseExtract = resolve; }) : null;
  const dependencies = {
    async extract(file) {
      calls.extract += 1;
      if (extractGate && calls.extract === overrides.delayExtractAt) await extractGate;
      if (overrides.extractResult) return overrides.extractResult;
      if (overrides.extractThrows) throw new Error('ocr crashed');
      return { ok: true, rawText: '775000000001 PRODUCTO 2 3.50', metadata: {}, error: null };
    },
    process(rawText, options) {
      calls.process += 1;
      assert.equal(options.products, products);
      return overrides.processResult || { ok: true, rawText, proposals: overrides.proposals || [proposal()] };
    },
    createReview(container, input) {
      calls.review += 1;
      assert.equal(container, elements.review);
      return {
        getReviewedPurchaseProposals() { return reviewed; },
        destroy() {},
      };
    },
    async apply(rows, options) {
      calls.apply += 1;
      if (applyGate) await applyGate;
      if (overrides.applyResult) return overrides.applyResult;
      return { ok: true, operationId: options.operationId, applied: rows.filter((row) => row.decision === 'CONFIRMED'), skipped: [], errors: [] };
    },
  };
  const context = vm.createContext({ console, Uint8Array, Math, Date });
  new vm.Script(SOURCE, { filename: REL }).runInContext(context);
  const create = vm.runInContext('createPurchaseOcrIntegration', context);
  const integration = create({
    elements,
    dependencies,
    getProducts: () => products,
    getMovements: () => movements,
    refreshInventory: () => { calls.refresh += 1; },
  });
  return {
    integration, elements, products, movements, calls,
    setReviewed(value) { reviewed = value; },
    releaseApply,
    releaseExtract,
  };
}

async function prepare(sb, file = image()) {
  assert.equal(sb.integration.selectImage(file), true);
  const result = await sb.integration.processSelectedImage();
  assert.equal(result.ok, true);
  return result;
}

function confirmed(index = 0, changes = {}) {
  return { sourceIndex: index, productId: 'P1', quantity: 2, unitCost: 3.5, decision: 'CONFIRMED', ...changes };
}

test('I01 foto valida recorre OCR, proceso, revisión y aplicación una vez', async () => {
  const sb = sandbox();
  await prepare(sb);
  assert.deepEqual(sb.calls, { extract: 1, process: 1, review: 1, apply: 0, refresh: 0 });
  sb.setReviewed([confirmed()]);
  const result = await sb.integration.applyReviewed();
  assert.equal(result.ok, true);
  assert.equal(sb.calls.apply, 1);
  assert.equal(sb.calls.refresh, 1);
});

test('I02 MATCHED_REVIEW requiere selección y confirmación humana', async () => {
  const sb = sandbox({ proposals: [proposal('MATCHED_REVIEW')] });
  await prepare(sb);
  const pending = await sb.integration.applyReviewed();
  assert.equal(pending.errors[0].code, 'PENDING_HUMAN_REVIEW');
  sb.setReviewed([confirmed(0, { productId: 'P1', humanEdited: true })]);
  assert.equal((await sb.integration.applyReviewed()).ok, true);
});

test('I03 cantidad y costo corregidos llegan intactos a aplicación', async () => {
  let received;
  const sb = sandbox({ applyResult: null });
  sb.integration.destroy();
  const custom = sandbox();
  custom.setReviewed([confirmed(0, { quantity: 7, unitCost: 4.75, humanEdited: true })]);
  await prepare(custom);
  const originalApply = custom.integration.applyReviewed;
  const result = await originalApply();
  received = result.applied[0];
  assert.equal(received.quantity, 7);
  assert.equal(received.unitCost, 4.75);
});

test('I04 fila descartada se transporta sin movimiento aplicable', async () => {
  const sb = sandbox();
  await prepare(sb);
  sb.setReviewed([{ sourceIndex: 0, productId: null, quantity: null, unitCost: null, decision: 'DISCARDED' }]);
  const result = await sb.integration.applyReviewed();
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'NO_CONFIRMED_ROWS');
  assert.equal(sb.calls.apply, 0);
});

test('I05 NO_SAFE_MATCH no se aplica sin selección humana válida', async () => {
  const sb = sandbox({ proposals: [proposal('NO_SAFE_MATCH')] });
  await prepare(sb);
  assert.equal((await sb.integration.applyReviewed()).errors[0].code, 'PENDING_HUMAN_REVIEW');
  assert.equal(sb.calls.apply, 0);
});

test('I06 doble clic concurrente ejecuta apply una sola vez', async () => {
  const sb = sandbox({ delayedApply: true });
  await prepare(sb);
  sb.setReviewed([confirmed()]);
  const first = sb.integration.applyReviewed();
  const second = await sb.integration.applyReviewed();
  assert.equal(second.errors[0].code, 'APPLY_BUSY');
  assert.equal(sb.calls.apply, 1);
  sb.releaseApply();
  assert.equal((await first).ok, true);
});

test('una nueva lectura invalida el lote anterior y bloquea Apply', async () => {
  const sb = sandbox({ delayExtractAt: 2 });
  await prepare(sb);
  sb.setReviewed([confirmed()]);
  sb.integration.selectImage(image('second.png', [8, 8, 8]));
  const reading = sb.integration.processSelectedImage();
  const apply = await sb.integration.applyReviewed();
  assert.equal(apply.errors[0].code, 'OCR_BUSY');
  assert.equal(sb.calls.apply, 0);
  sb.releaseExtract();
  await reading;
});

test('I07 misma imagen produce operationId estable', async () => {
  const first = sandbox();
  const second = sandbox();
  const fileA = image('a.png', [9, 8, 7, 6]);
  const fileB = image('renamed.png', [9, 8, 7, 6]);
  const a = await prepare(first, fileA);
  const b = await prepare(second, fileB);
  assert.equal(a.operationId, b.operationId);
});

test('I08 fallo de persistencia delegado se muestra y no refresca UI', async () => {
  const sb = sandbox({ applyResult: { ok: false, applied: [], skipped: [], errors: [{ code: 'PERSISTENCE_NOT_VERIFIED', message: 'restaurado', stateRestored: true }] } });
  await prepare(sb);
  sb.setReviewed([confirmed()]);
  const result = await sb.integration.applyReviewed();
  assert.equal(result.errors[0].stateRestored, true);
  assert.equal(sb.calls.refresh, 0);
  assert.equal(sb.elements.status.dataset.state, 'error');
});

test('rollback durable no verificado queda visible', async () => {
  const sb = sandbox({ applyResult: {
    ok: false,
    applied: [],
    skipped: [],
    errors: [
      { code: 'PERSISTENCE_NOT_VERIFIED', message: 'fallo original', stateRestored: true },
      { code: 'ROLLBACK_PERSISTENCE_NOT_VERIFIED', message: 'rollback no durable' },
    ],
  } });
  await prepare(sb);
  sb.setReviewed([confirmed()]);
  await sb.integration.applyReviewed();
  assert.match(sb.elements.status.textContent, /no se pudo verificar la persistencia del rollback/i);
});

test('resultado idempotente se reporta como ya aplicado', async () => {
  const sb = sandbox({ applyResult: { ok: true, applied: [], skipped: [{ reason: 'ALREADY_APPLIED' }], errors: [] } });
  await prepare(sb);
  sb.setReviewed([confirmed()]);
  await sb.integration.applyReviewed();
  assert.match(sb.elements.status.textContent, /ya había sido aplicada/i);
});

test('fallo de render después del commit no convierte éxito durable en fallo', async () => {
  const sb = sandbox();
  sb.integration.destroy();
  const elements = sb.elements;
  const context = vm.createContext({ console, Uint8Array, Math, Date });
  new vm.Script(SOURCE, { filename: REL }).runInContext(context);
  const create = vm.runInContext('createPurchaseOcrIntegration', context);
  let reviewed = [confirmed()];
  const integration = create({
    elements,
    dependencies: {
      extract: async () => ({ ok: true, rawText: 'PRODUCTO 2 3.50' }),
      process: () => ({ ok: true, proposals: [proposal()] }),
      createReview: () => ({ getReviewedPurchaseProposals: () => reviewed, destroy() {} }),
      apply: async () => ({ ok: true, applied: [confirmed()], skipped: [], errors: [] }),
    },
    getProducts: () => sb.products,
    getMovements: () => sb.movements,
    refreshInventory: () => { throw new Error('render roto'); },
  });
  integration.selectImage(image());
  await integration.processSelectedImage();
  const result = await integration.applyReviewed();
  assert.equal(result.ok, true);
  assert.match(elements.status.textContent, /compra guardada/i);
});

test('I09 lote incompleto no llega a WP-06', async () => {
  const sb = sandbox({ proposals: [proposal('MATCHED_SAFE', 0), proposal('MATCHED_SAFE', 1)] });
  await prepare(sb);
  sb.setReviewed([confirmed(0)]);
  assert.equal((await sb.integration.applyReviewed()).errors[0].code, 'PENDING_HUMAN_REVIEW');
  assert.equal(sb.calls.apply, 0);
});

test('I10 imagen inválida produce error visible controlado', () => {
  const sb = sandbox();
  assert.equal(sb.integration.selectImage(image('x.pdf', [1], 'application/pdf')), false);
  assert.equal(sb.elements.status.dataset.state, 'error');
  assert.match(sb.elements.status.textContent, /no es una imagen/i);
});

test('I11 fallo OCR no ejecuta proceso y deja integración reutilizable', async () => {
  const sb = sandbox({ extractThrows: true });
  sb.integration.selectImage(image());
  const result = await sb.integration.processSelectedImage();
  assert.equal(result.ok, false);
  assert.equal(sb.calls.process, 0);
  assert.equal(sb.elements.start.disabled, false);
});

test('I12 huella estable permite idempotencia después de recrear integración', async () => {
  const file = image('purchase.png', [4, 3, 2, 1]);
  const first = sandbox();
  const second = sandbox();
  assert.equal((await prepare(first, file)).operationId, (await prepare(second, file)).operationId);
});

test('I13 flujo normal de inventario no es interceptado', () => {
  const sb = sandbox();
  assert.equal(sb.calls.apply, 0);
  assert.equal(sb.products[0].stock, 10);
});

test('I14 flujo normal de ventas no es referenciado por integración', () => {
  for (const forbidden of ['ventas', 'cajMovs', 'creditos', 'confirmarVenta']) assert.ok(!SOURCE.includes(forbidden));
});

test('I15 file protocol conserva indisponibilidad controlada', async () => {
  const sb = sandbox({ extractResult: { ok: false, rawText: '', error: { code: 'OCR_UNAVAILABLE_PROTOCOL', message: 'OCR no disponible bajo file://' } } });
  sb.integration.selectImage(image());
  const result = await sb.integration.processSelectedImage();
  assert.equal(result.error.code, 'OCR_UNAVAILABLE_PROTOCOL');
  assert.equal(sb.elements.status.dataset.state, 'error');
  assert.equal(sb.calls.process, 0);
});

test('entrada OCR vive en Inventario y acepta cámara móvil', () => {
  assert.match(INDEX, /id="pageInventario"[\s\S]*id="ocrPurchaseFile"[^>]*accept="image\/\*"[^>]*capture="environment"/);
  assert.match(INDEX, /id="mOcrPurchaseReview"/);
});

test('scripts OCR clásicos respetan el orden real de dependencias', () => {
  const scripts = [
    'js/ocr/vendor/tesseract-6.0.1/tesseract.min.js',
    'js/catalog/reference-catalog-data.js',
    'js/catalog/reference-catalog.js',
    'js/ocr/ocr-extract.js',
    'js/ocr/ocr-parse.js',
    'js/ocr/ocr-reference-matcher.js',
    'js/ocr/ocr-purchase-engine.js',
    'js/ocr/ocr-purchase-review.js',
    'js/ocr/ocr-purchase-apply.js',
    'js/ocr/ocr-purchase-integration.js',
  ];
  const positions = scripts.map((script) => INDEX.indexOf(`src="${script}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, positions.slice().sort((a, b) => a - b));
  assert.ok(INDEX.indexOf('js/legacy-inline/inline-16.js') < positions[0]);
  assert.ok(!INDEX.includes('type="module"'));
});
