import { createHash } from 'node:crypto';

export const FIRST_SALE_OPERATION_ID = '76959d8e-8846-44d1-8852-ccd22e0c3cc0';
export const FIRST_SALE_ID = 'V-001';
export const FIRST_SALE_WRITER = 'prod-v2-pos-writer-01';
export const FIRST_SALE_CLIENT_CONTRACT = 'a6-gate-c-v1';

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function payloadHash(payload) {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function requireAuthority(authority) {
  if (!authority || authority.stale === true || authority.mode !== 'ACTIVE' || authority.writer_device_id !== FIRST_SALE_WRITER) throw new Error('STALE_OR_INVALID_AUTHORITY');
  for (const key of ['promotion_id', 'client_contract', 'authority_epoch', 'expected_control_revision']) {
    if (!Object.hasOwn(authority, key) || authority[key] === null || authority[key] === undefined || authority[key] === '') throw new Error(`MISSING_AUTHORITY_${key.toUpperCase()}`);
  }
  if (authority.client_contract !== FIRST_SALE_CLIENT_CONTRACT || !Number.isSafeInteger(authority.authority_epoch) || authority.authority_epoch < 0 ||
      !Number.isSafeInteger(authority.expected_control_revision) || authority.expected_control_revision < 0) throw new Error('INVALID_AUTHORITY_FIELDS');
  return authority;
}

function sourceIntent(snapshot) {
  const rows = snapshot?.cloudSync?.outbox;
  if (snapshot?.cloudSync?.version !== 2 || !Array.isArray(rows)) throw new Error('INVALID_OUTBOX_SNAPSHOT');
  const matches = rows.filter(row => row.operation_id === FIRST_SALE_OPERATION_ID);
  if (matches.length !== 1) throw new Error('OPERATION_NOT_UNIQUE');
  const operation = matches[0];
  if (operation.status !== 'PENDING' || operation.attempts !== 0 || operation.last_error !== null || operation.command !== 'sale.create' ||
      operation.sale_id !== FIRST_SALE_ID || typeof operation.payload !== 'string') throw new Error('INVALID_LEGACY_OPERATION');
  let intent;
  try { intent = JSON.parse(operation.payload); } catch { throw new Error('INVALID_LEGACY_PAYLOAD'); }
  if (intent.operation_id !== FIRST_SALE_OPERATION_ID || intent.sale_id !== FIRST_SALE_ID || intent.created_at !== '2026-09-22T23:18:41.020Z' ||
      intent.payment_method !== 'efectivo' || intent.total_cents !== 100 || !Array.isArray(intent.items) || intent.items.length !== 1) throw new Error('INVALID_FINANCIAL_INTENT');
  const item = intent.items[0];
  if (String(item.product_id) !== '1' || item.quantity !== 1 || item.unit_price_cents !== 100 || item.line_total_cents !== 100) throw new Error('INVALID_FINANCIAL_INTENT');
  return { operation, item };
}

// Translates immutable legacy financial intent; canonical metadata must come
// exclusively from a current ACTIVE authority read. No device id is rebound.
export function buildCanonicalRecovery(snapshot, authority, { remoteOperationExists = false } = {}) {
  if (remoteOperationExists) throw new Error('REMOTE_OPERATION_EXISTS');
  const { item } = sourceIntent(snapshot);
  const current = requireAuthority(authority);
  const revisions = current.stock_revisions;
  if (!revisions || !Object.hasOwn(revisions, String(item.product_id))) throw new Error('MISSING_STOCK_REVISION');
  const stockRevision = revisions[String(item.product_id)];
  if (!Number.isSafeInteger(stockRevision) || stockRevision < 0) throw new Error('INVALID_STOCK_REVISION');
  const payload = {
    operation_id: FIRST_SALE_OPERATION_ID,
    sale_id: FIRST_SALE_ID,
    promotion_id: current.promotion_id,
    client_contract: current.client_contract,
    authority_epoch: current.authority_epoch,
    expected_control_revision: current.expected_control_revision,
    created_at: '2026-09-22T23:18:41.020Z',
    payment_method: 'efectivo',
    total_cents: 100,
    payment: { cash_cents: 100, digital_cents: 0, credit_cents: 0, digital_method: null, reference: null },
    items: [{ product_id: String(item.product_id), quantity: 1, unit_price_cents: 100, line_total_cents: 100, expected_stock_revision: stockRevision }],
  };
  return Object.freeze({ payload: Object.freeze(payload), payload_bytes: stableStringify(payload), payload_hash: payloadHash(payload) });
}

// Run against fresh canonical reads immediately before a future send.
export function assertRecoveryPreflight(prepared, { authority, stock_revisions, remoteOperationExists = false } = {}) {
  if (remoteOperationExists) throw new Error('REMOTE_OPERATION_EXISTS');
  const current = requireAuthority(authority);
  const payload = prepared?.payload;
  if (!payload || current.promotion_id !== payload.promotion_id || current.client_contract !== payload.client_contract ||
      current.authority_epoch !== payload.authority_epoch || current.expected_control_revision !== payload.expected_control_revision) throw new Error('STALE_AUTHORITY');
  if (!stock_revisions || !Object.hasOwn(stock_revisions, '1')) throw new Error('MISSING_STOCK_REVISION');
  if (stock_revisions['1'] !== payload.items[0].expected_stock_revision) throw new Error('STALE_STOCK_REVISION');
  return true;
}

export function assertRecoveryResponse(response, body, operation) {
  const accepted = (response.status === 201 && body?.status === 'created' && body?.idempotent === false) ||
    (response.status === 200 && body?.status === 'already_processed' && body?.idempotent === true);
  if (accepted && body.operation_id === operation.operation_id && body.sale_id === operation.sale_id) return body;
  if (response.status === 409) throw new Error('CONFLICT_409');
  if (response.status === 401 || response.status === 403) throw new Error(`AUTH_${response.status}`);
  throw new Error(`RECOVERY_HTTP_${response.status}`);
}
