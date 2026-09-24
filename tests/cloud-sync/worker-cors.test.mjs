import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerFixture } from './worker-fixture.mjs';

test('Worker permite preflight mínimo del POS sin autenticar OPTIONS', async (t) => {
  const fixture = workerFixture();
  t.after(() => fixture.close());
  const response = await fixture.fetch('https://worker.test/sync/operations', {
    method: 'OPTIONS',
    headers: {
      origin: 'null',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type,x-activation-secret',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  assert.match(response.headers.get('access-control-allow-headers'), /authorization/);
  assert.match(response.headers.get('access-control-allow-headers'), /x-activation-secret/);
});

test('respuestas health, 401 y operación válida incluyen CORS', async (t) => {
  const fixture = workerFixture();
  t.after(() => fixture.close());
  const health = await fixture.fetch('https://worker.test/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), '*');

  const unauthorized = await fixture.fetch('https://worker.test/sync/operations', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('access-control-allow-origin'), '*');

  const payload = JSON.stringify({ sale_id: 'V-CORS' });
  const operation = {
    operation_id: crypto.randomUUID(), device_id: crypto.randomUUID(), device_sequence: 1,
    entity_type: 'sales', entity_id: 'V-CORS', payload,
    payload_hash: await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)).then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')),
    created_at: new Date().toISOString(),
  };
  fixture.addDevice('cors-session', 'writer', 'active', 'fixture-token');
  const inserted = await fixture.fetch('https://worker.test/sync/operations', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-token' }, body: JSON.stringify(operation),
  });
  assert.equal(inserted.status, 201);
  assert.equal(inserted.headers.get('access-control-allow-origin'), '*');
});
