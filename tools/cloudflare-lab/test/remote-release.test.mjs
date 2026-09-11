// Authenticated release checks on existing RC operations. Never creates new IDs.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sync = process.env.SYNC_TOKEN, read = process.env.READ_TOKEN;
if (!sync || !read || sync === read) throw new Error('Distinct runtime credentials required');
const endpoint = 'https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev';
const evidence = new URL('../../../evidence/v1.2/', import.meta.url);
const rc = JSON.parse(readFileSync(new URL('rc-remote.json', evidence), 'utf8'));
const expected = rc.checks.find(c => c.name === 'real_worker_d1_synced').expectedOperations;
const results = [];
async function request(name, path, options, status) {
  const response = await fetch(endpoint + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  assert.equal(text.includes(sync) || text.includes(read), false, name + ': secret exposure');
  assert.equal(response.status, status, name);
  results.push({ name, status: 'PASS', http: response.status });
  console.log('PASS ' + name);
  return JSON.parse(text);
}
const opId = expected.find(o => o.entityType === 'sales').operationId;
const original = (await request('write_credential_lookup', '/sync/operations/' + opId, { headers: { 'x-sync-token': sync } }, 200)).operation;
await request('sync_value_cannot_read', '/read/status', { headers: { 'x-read-token': sync } }, 401);
await request('read_value_cannot_write', '/sync/operations', { method: 'POST', headers: { 'x-sync-token': read }, body: '{}' }, 401);
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-token': sync }, body: JSON.stringify(body) });
const retry = await request('same_operation_is_idempotent', '/sync/operations', post(original), 200);
assert.equal(retry.status, 'already_processed');
const altered = JSON.stringify({ rc: 'conflict-probe', operation_id: opId });
const conflict = await request('changed_payload_conflicts', '/sync/operations', post({ ...original, payload: altered, payload_hash: createHash('sha256').update(altered).digest('hex') }), 409);
assert.equal(conflict.status, 'conflict');
const after = (await request('original_survives_conflict', '/sync/operations/' + opId, { headers: { 'x-sync-token': sync } }, 200)).operation;
assert.equal(after.payload, original.payload); assert.equal(after.payload_hash, original.payload_hash);
for (const entry of expected) {
  const found = (await request('lookup_' + entry.entityType + '_' + entry.entityId, '/sync/operations/' + entry.operationId, { headers: { 'x-sync-token': sync } }, 200)).operation;
  assert.equal(found.operation_id, entry.operationId); assert.equal(found.entity_id, entry.entityId);
}
const readHeaders = { 'x-read-token': read };
const sales = await request('read_expected_sales', '/read/sales?limit=100', { headers: readHeaders }, 200);
for (const entry of expected.filter(o => o.entityType === 'sales')) assert.equal(sales.items.filter(o => o.operation_id === entry.operationId).length, 1);
for (const entry of expected.filter(o => o.entityType === 'sale_items')) {
  const saleId = entry.entityId.slice(0, entry.entityId.lastIndexOf(':'));
  const lines = await request('read_expected_lines_' + saleId, '/read/sales/' + encodeURIComponent(saleId) + '/items', { headers: readHeaders }, 200);
  assert.equal(lines.items.filter(o => o.operation_id === entry.operationId).length, 1);
}
const movements = await request('read_expected_inventory', '/read/inventory-movements?limit=100', { headers: readHeaders }, 200);
for (const entry of expected.filter(o => o.entityType === 'inventory_movements')) assert.equal(movements.items.filter(o => o.operation_id === entry.operationId).length, 1);
await request('read_sync_status', '/read/status', { headers: readHeaders }, 200);
writeFileSync(new URL('remote-release.json', evidence), JSON.stringify({ at: new Date().toISOString(), endpoint, results, newOperationsCreated: 0, existingOperationUnchangedAfterConflict: true }, null, 2) + '\n');
console.log('REMOTE_RELEASE ' + results.length + ' PASS / 0 FAIL');
