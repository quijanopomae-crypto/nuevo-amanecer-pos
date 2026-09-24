import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRecoveryPreflight, buildCanonicalRecovery, FIRST_SALE_OPERATION_ID, FIRST_SALE_WRITER, payloadHash, stableStringify } from '../../tools/cloudflare-lab/src/first-sale-recovery.mjs';
import { validateCanonicalSale } from '../../tools/cloudflare-lab/src/a6-commerce.js';

const OP = FIRST_SALE_OPERATION_ID;
const OLD = 'a0a31c8f-e5a8-4c68-bbf6-7045c2869881';
const legacyIntent = { operation_id: OP, device_id: OLD, sale_id: 'V-001', created_at: '2026-09-22T23:18:41.020Z', payment_method: 'efectivo', total_cents: 100,
  payment: { cash_cents: 100, digital_cents: 0, credit_cents: 0, digital_method: null, reference: null },
  items: [{ product_id: '1', quantity: 1, unit_price_cents: 100, line_total_cents: 100, expected_stock_revision: 0 }] };
const snapshot = { version: 9, data: { ventas: [{ id: 'V-001' }] }, cloudSync: { version: 2, device_id: OLD, initialized: true,
  captured: { 'sale:V-001:2026-09-22T23:18:41.020Z': true }, outbox: [{ operation_id: OP, device_id: OLD, command: 'sale.create', sale_id: 'V-001', payload: JSON.stringify(legacyIntent),
    payload_hash: payloadHash(legacyIntent), created_at: legacyIntent.created_at, status: 'PENDING', attempts: 0, last_error: null }] } };
const authority = { mode: 'ACTIVE', stale: false, writer_device_id: FIRST_SALE_WRITER, promotion_id: 'approved-promotion', client_contract: 'a6-gate-c-v1', authority_epoch: 7, expected_control_revision: 12, stock_revisions: { '1': 4 } };

test('builds exact canonical financial payload deterministically without mutating legacy snapshot', () => {
  const before = stableStringify(snapshot);
  const first = buildCanonicalRecovery(snapshot, authority);
  const again = buildCanonicalRecovery(snapshot, authority);
  assert.equal(first.payload.operation_id, OP);
  assert.equal(first.payload.sale_id, 'V-001');
  assert.equal(first.payload.created_at, '2026-09-22T23:18:41.020Z');
  assert.equal(first.payload.payment_method, 'efectivo');
  assert.equal(first.payload.total_cents, 100);
  assert.deepEqual(first.payload.items, [{ product_id: '1', quantity: 1, unit_price_cents: 100, line_total_cents: 100, expected_stock_revision: 4 }]);
  assert.deepEqual(first.payload.payment, { cash_cents: 100, digital_cents: 0, credit_cents: 0, digital_method: null, reference: null });
  assert.deepEqual(first.payload, { operation_id: OP, sale_id: 'V-001', promotion_id: 'approved-promotion', client_contract: 'a6-gate-c-v1', authority_epoch: 7,
    expected_control_revision: 12, created_at: '2026-09-22T23:18:41.020Z', payment_method: 'efectivo', total_cents: 100,
    payment: { cash_cents: 100, digital_cents: 0, credit_cents: 0, digital_method: null, reference: null },
    items: [{ product_id: '1', quantity: 1, unit_price_cents: 100, line_total_cents: 100, expected_stock_revision: 4 }] });
  assert.equal(first.payload_bytes, again.payload_bytes);
  assert.equal(first.payload_hash, again.payload_hash);
  assert.equal(first.payload_hash, payloadHash(first.payload));
  assert.equal(stableStringify(snapshot), before);
  assert.equal(snapshot.cloudSync.outbox[0].payload, JSON.stringify(legacyIntent));
  assert.equal(snapshot.cloudSync.outbox[0].device_id, OLD);
  assert.equal(validateCanonicalSale(first.payload).error, undefined);
  assertRecoveryPreflight(first, { authority, stock_revisions: { '1': 4 } });
});

test('fails closed for each missing authority field and stock revision', () => {
  for (const field of ['promotion_id', 'client_contract', 'authority_epoch', 'expected_control_revision']) {
    const incomplete = { ...authority }; delete incomplete[field];
    assert.throws(() => buildCanonicalRecovery(snapshot, incomplete), /MISSING_AUTHORITY/);
  }
  const missingStock = { ...authority, stock_revisions: {} };
  assert.throws(() => buildCanonicalRecovery(snapshot, missingStock), /MISSING_STOCK_REVISION/);
  assert.throws(() => assertRecoveryPreflight(buildCanonicalRecovery(snapshot, authority), { authority, stock_revisions: {} }), /MISSING_STOCK_REVISION/);
});

test('fails closed for existing remote operation, stale authority, and stale stock revision', () => {
  assert.throws(() => buildCanonicalRecovery(snapshot, authority, { remoteOperationExists: true }), /REMOTE_OPERATION_EXISTS/);
  assert.throws(() => assertRecoveryPreflight(buildCanonicalRecovery(snapshot, authority), { authority, stock_revisions: { '1': 4 }, remoteOperationExists: true }), /REMOTE_OPERATION_EXISTS/);
  assert.throws(() => buildCanonicalRecovery(snapshot, { ...authority, stale: true }), /STALE_OR_INVALID_AUTHORITY/);
  assert.throws(() => assertRecoveryPreflight(buildCanonicalRecovery(snapshot, authority), { authority: { ...authority, expected_control_revision: 13 }, stock_revisions: { '1': 4 } }), /STALE_AUTHORITY/);
  assert.throws(() => assertRecoveryPreflight(buildCanonicalRecovery(snapshot, authority), { authority, stock_revisions: { '1': 5 } }), /STALE_STOCK_REVISION/);
});

test('uses no second operation id and accepts only matching canonical response', () => {
  const built = buildCanonicalRecovery(snapshot, authority);
  assert.equal(built.payload.operation_id, OP);
  assert.equal(Object.keys(built.payload).filter(key => key === 'operation_id').length, 1);
  assert.equal(JSON.parse(built.payload_bytes).operation_id, OP);
});
