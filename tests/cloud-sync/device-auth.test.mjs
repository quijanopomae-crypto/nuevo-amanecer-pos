import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerFixture } from './worker-fixture.mjs';
import worker from '../../tools/cloudflare-lab/src/worker.js';
import { deviceAuthSql } from '../../tools/cloudflare-lab/scripts/device-auth-sql.mjs';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

async function operation(deviceId) {
  const payload = JSON.stringify({ probe: 'A2' });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return {
    operation_id: crypto.randomUUID(), device_id: deviceId, device_sequence: 1,
    entity_type: 'a2_probe', entity_id: crypto.randomUUID(), payload,
    payload_hash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
    created_at: new Date().toISOString(),
  };
}

function post(fixture, body, credential, deviceId) {
  return fixture.fetch('https://worker.test/sync/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sync-token': credential, ...(deviceId ? { 'x-device-id': deviceId } : {}) },
    body: JSON.stringify(body),
  });
}

test('health permanece público', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  assert.equal((await fixture.fetch('https://worker.test/health')).status, 200);
});

test('writer activo con credencial válida escribe y actualiza last_seen_at sin exponer secretos', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  const credential = 'a2-valid-writer-secret';
  fixture.addDevice('writer-1', 'writer', 'active', credential);
  const response = await post(fixture, await operation('writer-1'), credential, 'writer-1');
  const text = await response.text();
  assert.equal(response.status, 201);
  assert.equal(text.includes(credential), false);
  assert.ok(fixture.device('writer-1').last_seen_at);
  assert.notEqual(fixture.device('writer-1').credential_hash, credential);
});

test('credencial inválida, dispositivo revocado y read_only no pueden escribir', async (t) => {
  for (const scenario of [
    { id: 'writer-invalid', role: 'writer', status: 'active', stored: 'correct', sent: 'incorrect', expected: 401 },
    { id: 'writer-revoked', role: 'writer', status: 'revoked', stored: 'revoked-secret', sent: 'revoked-secret', expected: 403 },
    { id: 'reader-active', role: 'read_only', status: 'active', stored: 'reader-secret', sent: 'reader-secret', expected: 403 },
  ]) {
    const fixture = workerFixture(); t.after(() => fixture.close());
    fixture.addDevice(scenario.id, scenario.role, scenario.status, scenario.stored);
    const response = await post(fixture, await operation(scenario.id), scenario.sent, scenario.id);
    assert.equal(response.status, scenario.expected, scenario.id);
    assert.equal(fixture.count(), 0, scenario.id);
  }
});

test('identidad autenticada debe coincidir con device_id de la operación', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-bound', 'writer', 'active', 'bound-secret');
  const response = await post(fixture, await operation('other-device'), 'bound-secret', 'writer-bound');
  assert.equal(response.status, 403);
  assert.equal(fixture.count(), 0);
});

test('D1 rechaza un segundo writer activo y acepta dispositivos no escritores', (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-one');
  assert.throws(() => fixture.addDevice('writer-2', 'writer', 'active', 'writer-two'), /UNIQUE constraint failed/);
  assert.doesNotThrow(() => fixture.addDevice('reader-1', 'read_only', 'active', 'reader-one'));
  assert.doesNotThrow(() => fixture.addDevice('writer-revoked', 'writer', 'revoked', 'writer-old'));
  assert.throws(() => fixture.database.exec("UPDATE devices SET role = 'writer' WHERE device_id = 'reader-1'"), /UNIQUE constraint failed/);
  assert.throws(() => fixture.database.exec("UPDATE devices SET status = 'active' WHERE device_id = 'writer-revoked'"), /UNIQUE constraint failed/);
  assert.throws(() => fixture.addDevice('reader-copy', 'read_only', 'active', 'writer-one'), /UNIQUE constraint failed/);
  fixture.database.exec(deviceAuthSql('revoke', { DEVICE_ID: 'writer-1' }));
  assert.doesNotThrow(() => fixture.database.exec("UPDATE devices SET status = 'active' WHERE device_id = 'writer-revoked'"));
});

test('revocación que gana la carrera de autorización impide el INSERT', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-race', 'writer', 'active', 'race-secret');
  const originalPrepare = fixture.binding.prepare;
  fixture.binding.prepare = (sql) => {
    const prepared = originalPrepare(sql);
    if (!sql.includes('INSERT INTO sync_operations')) return prepared;
    const originalRun = prepared.run;
    prepared.run = async () => {
      fixture.database.prepare("UPDATE devices SET status = 'revoked' WHERE device_id = ?").run('writer-race');
      return originalRun.call(prepared);
    };
    return prepared;
  };
  const response = await post(fixture, await operation('writer-race'), 'race-secret', 'writer-race');
  assert.equal(response.status, 403);
  assert.equal(fixture.count(), 0);
});

test('errores internos no reflejan credenciales ni detalles de D1', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-error', 'writer', 'active', 'error-secret');
  fixture.binding.prepare = () => { throw new Error('D1 failed with error-secret'); };
  const response = await worker.fetch(new Request('https://worker.test/sync/operations', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-token': 'error-secret' },
    body: JSON.stringify(await operation('writer-error')),
  }), fixture.env);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'internal_error' });
});

test('provisión genera solo hash y revocación no necesita credencial', () => {
  const credential = 'a'.repeat(64);
  const pepper = 'b'.repeat(64);
  const sql = deviceAuthSql('register', {
    DEVICE_ID: "writer'o", DEVICE_ROLE: 'writer', DEVICE_CREDENTIAL: credential,
    DEVICE_CREDENTIAL_PEPPER: pepper, READ_TOKEN: 'c'.repeat(64),
  });
  assert.match(sql, /writer''o/);
  assert.doesNotMatch(sql, new RegExp(credential));
  assert.doesNotMatch(sql, new RegExp(pepper));
  assert.match(sql, /[a-f0-9]{64}/);
  assert.equal(deviceAuthSql('revoke', { DEVICE_ID: 'writer-1' }), "UPDATE devices SET status = 'revoked' WHERE device_id = 'writer-1';");
});

test('identidad desconocida y secreto global heredado no habilitan escrituras', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  const body = await operation('unregistered');
  const request = () => new Request('https://worker.test/sync/operations', {
    method: 'POST', headers: { 'x-sync-token': 'legacy-secret' }, body: JSON.stringify(body),
  });
  const response = await worker.fetch(request(), { ...fixture.env, SYNC_TOKEN: 'legacy-secret' });
  assert.equal(response.status, 401);
  const unconfigured = await worker.fetch(request(), { ...fixture.env, DEVICE_CREDENTIAL_PEPPER: undefined });
  assert.equal(unconfigured.status, 503);
  assert.equal(fixture.count(), 0);
});

test('lookup exige identidad válida y rechaza revocación incluso después de un éxito', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-lookup', 'writer', 'active', 'lookup-secret');
  const body = await operation('writer-lookup');
  assert.equal((await post(fixture, body, 'lookup-secret')).status, 201);
  const url = 'https://worker.test/sync/operations/' + body.operation_id;
  assert.equal((await fixture.fetch(url, { headers: { 'x-sync-token': 'lookup-secret' } })).status, 401);
  const headers = { 'x-sync-token': 'lookup-secret', 'x-device-id': 'writer-lookup' };
  const response = await fixture.fetch(url, { headers });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes('lookup-secret'), false);
  assert.equal(text.includes(fixture.device('writer-lookup').credential_hash), false);
  fixture.database.exec(deviceAuthSql('revoke', { DEVICE_ID: 'writer-lookup' }));
  assert.equal((await fixture.fetch(url, { headers })).status, 403);
  assert.equal((await post(fixture, body, 'lookup-secret')).status, 403);
  assert.equal(fixture.count(), 1);
});

test('migración A2 conserva operaciones anteriores y puede reaplicarse sin borrar identidad', (t) => {
  const database = new DatabaseSync(':memory:'); t.after(() => database.close());
  const migration = name => readFileSync(new URL('../../tools/cloudflare-lab/migrations/' + name, import.meta.url), 'utf8');
  database.exec(migration('0001_sync_operations.sql'));
  database.exec(migration('0002_read_only_indexes.sql'));
  database.exec("INSERT INTO sync_operations VALUES ('old-op', 'old-device', 1, 'sales', 'old-sale', '{}', 'hash', 'before', 'before')");
  const before = database.prepare('SELECT * FROM sync_operations').all();
  database.exec(migration('0003_device_auth.sql'));
  database.exec(deviceAuthSql('register', {
    DEVICE_ID: 'new-device', DEVICE_ROLE: 'writer', DEVICE_CREDENTIAL: 'a'.repeat(64), DEVICE_CREDENTIAL_PEPPER: 'b'.repeat(64),
  }));
  database.exec(migration('0003_device_auth.sql'));
  assert.deepEqual(database.prepare('SELECT * FROM sync_operations').all(), before);
  const registered = database.prepare('SELECT * FROM devices').get();
  assert.equal(registered.device_id, 'new-device');
  assert.ok(Number.isFinite(Date.parse(registered.created_at)));
  assert.equal(registered.last_seen_at, null);
});
