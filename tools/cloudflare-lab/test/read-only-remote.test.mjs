// Read-only smoke test: never inserts, updates or deletes cloud records.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const endpoint = 'https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev';
const readToken = process.env.READ_TOKEN;
if (!readToken) throw new Error('READ_TOKEN environment variable required');
const results = [];
async function check(name, path, options, status, validate) {
  const response = await fetch(endpoint + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  assert.equal(text.includes(readToken), false, name + ': secret exposure');
  assert.equal(response.status, status, name + ': HTTP status');
  if (path.startsWith('/read/')) {
    assert.equal(response.headers.get('access-control-allow-origin'), '*', name);
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS', name);
    assert.equal(response.headers.get('access-control-allow-headers'), 'x-read-token', name);
    if (options?.method !== 'OPTIONS') assert.equal(response.headers.get('cache-control'), 'no-store', name);
  }
  const body = text ? JSON.parse(text) : null;
  if (validate) validate(body);
  results.push({ name, status: 'PASS', http: response.status });
  console.log('PASS ' + name);
  return body;
}
const headers = { 'x-read-token': readToken };
await check('health', '/health', {}, 200, b => assert.equal(b.d1, 'ok'));
await check('missing_read_token', '/read/status', {}, 401);
await check('incorrect_read_token', '/read/status', { headers: { 'x-read-token': 'invalid-smoke-credential' } }, 401);
await check('read_status', '/read/status', { headers }, 200, b => assert.equal(b.status, 'ok'));
const sales = await check('read_sales', '/read/sales', { headers }, 200, b => { assert.ok(Array.isArray(b.items)); assert.equal(b.limit, 25); });
const saleId = sales.items[0]?.entity_id || '__v12_smoke_no_sale__';
await check('read_sale_items', '/read/sales/' + encodeURIComponent(saleId) + '/items', { headers }, 200, b => assert.ok(Array.isArray(b.items)));
await check('read_inventory_movements', '/read/inventory-movements', { headers }, 200, b => assert.ok(Array.isArray(b.items)));
await check('read_token_cannot_write', '/sync/operations', { method: 'POST', headers: { 'x-sync-token': readToken, 'content-type': 'application/json' }, body: '{}' }, 401);
await check('read_header_cannot_write', '/sync/operations', { method: 'POST', headers, body: '{}' }, 401);
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  await check('deny_read_' + method, '/read/sales', { method, headers }, 405);
}
await check('read_preflight', '/read/sales', { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-read-token' } }, 204);
await check('invalid_limit', '/read/sales?limit=101', { headers }, 400);
await check('unknown_read_route', '/read/not-found', { headers }, 404);
const directory = fileURLToPath(new URL('../../../evidence/v1.2/', import.meta.url));
mkdirSync(directory, { recursive: true });
writeFileSync(directory + '/remote-read.json', JSON.stringify({ at: new Date().toISOString(), endpoint, results, saleItemsUsedExistingSale: sales.items.length > 0, writesAttemptedWithWriteCredential: false }, null, 2) + '\n');
console.log('REMOTE_READ ' + results.length + ' PASS / 0 FAIL');
