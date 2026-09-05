// ocr-purchase-apply.test.mjs — frontera segura de aplicación OCR (WP-06).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const REL = 'POS/js/ocr/ocr-purchase-apply.js';
const SOURCE = readFileSync(path.join(ROOT, REL), 'utf8');

function confirmed(overrides = {}) {
  return {
    sourceIndex: overrides.sourceIndex ?? 0,
    productId: Object.prototype.hasOwnProperty.call(overrides, 'productId') ? overrides.productId : 'P1',
    quantity: Object.prototype.hasOwnProperty.call(overrides, 'quantity') ? overrides.quantity : 2,
    unitCost: Object.prototype.hasOwnProperty.call(overrides, 'unitCost') ? overrides.unitCost : 3.5,
    decision: overrides.decision || 'CONFIRMED',
    originalProposal: overrides.originalProposal || { status: 'MATCHED_SAFE' },
    humanEdited: !!overrides.humanEdited,
    reasons: overrides.reasons || [],
  };
}

function sandbox(overrides = {}) {
  const products = overrides.products || [
    { id: 'P1', name: 'Producto 1', stock: 10, controlInventario: true, costo: 1 },
    { id: 'P2', name: 'Producto 2', stock: 5, controlInventario: true, costo: 2 },
  ];
  const movements = overrides.movements || [];
  const sales = [{ id: 'V1' }];
  const cash = [{ id: 'C1' }];
  const credits = [{ id: 'CR1' }];
  const calls = { movement: 0, persist: 0 };
  const context = vm.createContext({ console });
  new vm.Script(SOURCE, { filename: REL }).runInContext(context);
  const apply = vm.runInContext('applyApprovedPurchaseProposals', context);
  function applyInventoryMovement(options) {
    calls.movement += 1;
    if (overrides.failAt === calls.movement) {
      return { ok: false, error: 'CANONICAL_BLOCKED', message: 'Movimiento bloqueado' };
    }
    const product = products.find((item) => String(item.id) === String(options.productId));
    const before = product.stock;
    const movement = {
      id: `IM-${calls.movement}`,
      productId: product.id,
      type: options.type,
      before,
      delta: options.delta,
      after: before + options.delta,
      reason: options.reason,
      source: options.source,
      referenceId: options.referenceId,
    };
    movements.push(movement);
    product.stock = movement.after;
    return { ok: true, movement };
  }
  async function saveAllData() {
    calls.persist += 1;
    if (overrides.persistThrows === true || overrides.persistThrows === calls.persist) {
      throw new Error('storage caido');
    }
    if (Array.isArray(overrides.persistResults) && overrides.persistResults.length) {
      return overrides.persistResults.shift();
    }
    return overrides.persistResult || { durable: true, verified: true };
  }
  const options = {
    operationId: overrides.operationId || 'OCR-001',
    products,
    inventoryMovements: movements,
    applyInventoryMovement,
    saveAllData,
    wasPersisted: (result) => !!(result && result.durable && result.verified),
    tracksStock: (product) => product.controlInventario !== false,
  };
  return {
    apply,
    options,
    products,
    movements,
    sales,
    cash,
    credits,
    calls,
    plain(value) { return JSON.parse(JSON.stringify(value)); },
  };
}

async function run(proposals, overrides = {}) {
  const sb = sandbox(overrides);
  const result = sb.plain(await sb.apply(proposals, sb.options));
  return { sb, result };
}

test('A01 lista vacia', async () => {
  const { sb, result } = await run([]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.applied, []);
  assert.equal(sb.calls.movement, 0);
  assert.equal(sb.calls.persist, 0);
});

test('A02 propuesta no confirmada no se aplica', async () => {
  const { sb, result } = await run([confirmed({ decision: 'PENDING' })]);
  assert.equal(result.ok, true);
  assert.equal(result.skipped[0].reason, 'NOT_CONFIRMED');
  assert.equal(sb.calls.movement, 0);
});

test('A03 descartada no se aplica', async () => {
  const { sb, result } = await run([confirmed({ decision: 'DISCARDED' })]);
  assert.equal(result.skipped[0].reason, 'DISCARDED');
  assert.equal(sb.calls.movement, 0);
});

test('A04 confirmada valida se aplica una vez', async () => {
  const { sb, result } = await run([confirmed()]);
  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 1);
  assert.equal(sb.calls.movement, 1);
  assert.equal(sb.products[0].stock, 12);
});

test('A05 usa funcion canonica de inventario', async () => {
  const { sb, result } = await run([confirmed()]);
  assert.equal(sb.calls.movement, 1);
  assert.equal(result.applied[0].movement.source, 'OCR_PURCHASE');
  assert.equal(result.applied[0].movement.type, 'ENTRADA');
});

test('A06 solo restaura stock directamente en el rollback canonico', async () => {
  const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  const writes = stripped.match(/\.stock\s*(?:=|\+=|-=|\+\+|--)/g) || [];
  assert.deepEqual(writes, ['.stock =']);
  const sb = sandbox({ failAt: 1 });
  const before = sb.products[0].stock;
  await sb.apply([confirmed()], sb.options);
  assert.equal(sb.products[0].stock, before);
});

test('A07 cantidad invalida bloquea', async () => {
  for (const quantity of [0, -1, 'abc', null]) {
    const { sb, result } = await run([confirmed({ quantity })]);
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].reasons.includes('INVALID_QUANTITY'));
    assert.equal(sb.calls.movement, 0);
  }
});

test('A08 producto inexistente bloquea', async () => {
  const { sb, result } = await run([confirmed({ productId: 'NOPE' })]);
  assert.equal(result.ok, false);
  assert.ok(result.errors[0].reasons.includes('PRODUCT_NOT_FOUND'));
  assert.equal(sb.calls.movement, 0);
});

test('A09 costo invalido bloquea', async () => {
  for (const unitCost of [0, -1, 'abc', null]) {
    const { sb, result } = await run([confirmed({ unitCost })]);
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].reasons.includes('INVALID_UNIT_COST'));
    assert.equal(sb.calls.movement, 0);
  }
});

test('A10 lote mixto se valida antes de mutar', async () => {
  const { sb, result } = await run([confirmed(), confirmed({ sourceIndex: 1, productId: 'NOPE' })]);
  assert.equal(result.ok, false);
  assert.equal(sb.calls.movement, 0);
  assert.deepEqual(sb.products.map((product) => product.stock), [10, 5]);
});

test('A11 misma operacion repetida no duplica', async () => {
  const sb = sandbox();
  const first = sb.plain(await sb.apply([confirmed()], sb.options));
  const second = sb.plain(await sb.apply([confirmed()], sb.options));
  assert.equal(first.applied.length, 1);
  assert.equal(second.applied.length, 0);
  assert.equal(second.skipped[0].reason, 'ALREADY_APPLIED');
  assert.equal(sb.calls.movement, 1);
  assert.equal(sb.products[0].stock, 12);
});

test('referencias duplicadas dentro del lote bloquean antes de mutar', async () => {
  const { sb, result } = await run([confirmed(), confirmed({ productId: 'P2' })]);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'DUPLICATE_OPERATION_REFERENCE');
  assert.equal(sb.calls.movement, 0);
  assert.deepEqual(sb.products.map((product) => product.stock), [10, 5]);
});

test('A12 operationId distinto si puede aplicar', async () => {
  const sb = sandbox();
  await sb.apply([confirmed()], sb.options);
  await sb.apply([confirmed()], { ...sb.options, operationId: 'OCR-002' });
  assert.equal(sb.calls.movement, 2);
  assert.equal(sb.products[0].stock, 14);
});

test('A13 conserva sourceIndex', async () => {
  const { result } = await run([confirmed({ sourceIndex: 17 })]);
  assert.equal(result.applied[0].sourceIndex, 17);
  assert.equal(result.applied[0].referenceId, 'OCR-001:17');
});

test('A14 conserva productId', async () => {
  const { result } = await run([confirmed({ productId: 'P2' })]);
  assert.equal(result.applied[0].productId, 'P2');
  assert.equal(result.applied[0].movement.productId, 'P2');
});

test('A15 error canonico se propaga y restaura', async () => {
  const { sb, result } = await run([confirmed()], { failAt: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'CANONICAL_BLOCKED');
  assert.equal(result.errors[0].stateRestored, true);
  assert.equal(result.errors[0].rollbackPersisted, true);
  assert.equal(sb.calls.persist, 1);
  assert.equal(sb.products[0].stock, 10);
  assert.equal(sb.movements.length, 0);
});

test('A16 no crea segundo ledger', async () => {
  const { sb } = await run([confirmed(), confirmed({ sourceIndex: 1, productId: 'P2' })]);
  assert.equal(sb.movements.length, sb.calls.movement);
  assert.equal(sb.movements.length, 2);
  const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  assert.doesNotMatch(stripped, /inventoryMovements\s*\.\s*push|movements\s*\.\s*push/);
});

test('A17 no toca ventas', async () => {
  const sb = sandbox();
  const before = JSON.stringify(sb.sales);
  await sb.apply([confirmed()], sb.options);
  assert.equal(JSON.stringify(sb.sales), before);
});

test('A18 no toca caja', async () => {
  const sb = sandbox();
  const before = JSON.stringify(sb.cash);
  await sb.apply([confirmed()], sb.options);
  assert.equal(JSON.stringify(sb.cash), before);
});

test('A19 no toca creditos', async () => {
  const sb = sandbox();
  const before = JSON.stringify(sb.credits);
  await sb.apply([confirmed()], sb.options);
  assert.equal(JSON.stringify(sb.credits), before);
});

test('A20 entrada no mutada', async () => {
  const proposals = [confirmed(), confirmed({ sourceIndex: 1, decision: 'DISCARDED' })];
  const before = JSON.stringify(proposals);
  await run(proposals);
  assert.equal(JSON.stringify(proposals), before);
});

test('persistencia canonica se ejecuta una vez y debe quedar verificada', async () => {
  const success = await run([confirmed(), confirmed({ sourceIndex: 1, productId: 'P2' })]);
  assert.equal(success.sb.calls.persist, 1);
  assert.equal(success.result.ok, true);
  const failure = await run([confirmed()], {
    persistResults: [{ durable: false, verified: false }, { durable: true, verified: true }],
  });
  assert.equal(failure.result.ok, false);
  assert.equal(failure.result.errors[0].code, 'PERSISTENCE_NOT_VERIFIED');
  assert.equal(failure.result.errors[0].stateRestored, true);
  assert.equal(failure.result.errors[0].rollbackPersisted, true);
  assert.equal(failure.sb.products[0].stock, 10);
  assert.equal(failure.sb.movements.length, 0);
  assert.equal(failure.sb.calls.persist, 2);
});

test('fallo en movimiento posterior restaura lote y permite retry limpio', async () => {
  const sb = sandbox({ failAt: 2 });
  const proposals = [confirmed(), confirmed({ sourceIndex: 1, productId: 'P2' })];
  const failed = sb.plain(await sb.apply(proposals, sb.options));
  assert.equal(failed.ok, false);
  assert.equal(failed.applied.length, 0);
  assert.equal(failed.errors[0].stateRestored, true);
  assert.deepEqual(sb.products.map((product) => product.stock), [10, 5]);
  assert.equal(sb.movements.length, 0);
  assert.equal(sb.calls.persist, 1);

  sb.calls.movement = 0;
  delete sb.options.failAt;
  const retried = sb.plain(await sb.apply(proposals, {
    ...sb.options,
    applyInventoryMovement(options) {
      sb.calls.movement += 1;
      const product = sb.products.find((item) => String(item.id) === String(options.productId));
      const movement = {
        id: `RETRY-${sb.calls.movement}`,
        productId: product.id,
        type: options.type,
        before: product.stock,
        delta: options.delta,
        after: product.stock + options.delta,
        reason: options.reason,
        source: options.source,
        referenceId: options.referenceId,
      };
      sb.movements.push(movement);
      product.stock = movement.after;
      return { ok: true, movement };
    },
  }));
  assert.equal(retried.ok, true);
  assert.equal(retried.applied.length, 2);
  assert.deepEqual(sb.products.map((product) => product.stock), [12, 7]);
  assert.equal(sb.movements.length, 2);
});

test('fallo de persistencia restaura y retry no duplica stock ni ledger', async () => {
  const sb = sandbox({
    persistResults: [
      { durable: false, verified: false },
      { durable: true, verified: true },
      { durable: true, verified: true },
    ],
  });
  const failed = sb.plain(await sb.apply([confirmed()], sb.options));
  assert.equal(failed.ok, false);
  assert.equal(sb.products[0].stock, 10);
  assert.equal(sb.movements.length, 0);
  const retried = sb.plain(await sb.apply([confirmed()], sb.options));
  assert.equal(retried.ok, true);
  assert.equal(sb.products[0].stock, 12);
  assert.equal(sb.movements.length, 1);
});
