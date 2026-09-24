import test from 'node:test';
import assert from 'node:assert/strict';
import { workerFixture } from './worker-fixture.mjs';

test('activation secret is required and is exchanged for a session token', async (t) => {
  const fixture = workerFixture('correct-horse-battery-staple');
  t.after(() => fixture.close());

  const denied = await fixture.fetch('https://worker.test/auth/activate', {
    method: 'POST',
    headers: { 'x-activation-secret': 'wrong-secret' },
  });
  assert.equal(denied.status, 401);

  const activated = await fixture.activate('correct-horse-battery-staple');
  assert.equal(activated.response.status, 200);
  assert.match(activated.token, /^[0-9a-f]{64}$/);

  const body = await activated.response.json();
  assert.equal(body.status, 'activated');
  assert.equal(Object.values(body).includes('correct-horse-battery-staple'), false);
});

test('persistent session authorizes without any device id header', async (t) => {
  const fixture = workerFixture('activation-secret');
  t.after(() => fixture.close());

  const activated = await fixture.activate('activation-secret');
  const response = await fixture.fetch('https://worker.test/auth/session', {
    headers: { authorization: 'Bearer ' + activated.token },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.session_id, 'string');
  assert.ok(body.session_id.length > 0);
});

test('multiple browsers can hold independent writer sessions simultaneously', async (t) => {
  const fixture = workerFixture('activation-secret');
  t.after(() => fixture.close());

  const first = await fixture.activate('activation-secret');
  const second = await fixture.activate('activation-secret');
  assert.notEqual(first.token, second.token);

  for (const token of [first.token, second.token]) {
    const response = await fixture.fetch('https://worker.test/auth/session', {
      headers: { authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 200);
  }

  const active = fixture.database.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE status='active'").get().n;
  assert.equal(active, 2);
});

test('session can be revoked without binding authorization to hardware', async (t) => {
  const fixture = workerFixture('activation-secret');
  t.after(() => fixture.close());

  const activated = await fixture.activate('activation-secret');
  const row = fixture.database.prepare('SELECT session_id FROM auth_sessions LIMIT 1').get();
  fixture.database.prepare("UPDATE auth_sessions SET status='revoked' WHERE session_id=?").run(row.session_id);

  const response = await fixture.fetch('https://worker.test/auth/session', {
    headers: { authorization: 'Bearer ' + activated.token },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'session_revoked');
});

test('legacy single-active-writer index is removed by session migration', (t) => {
  const fixture = workerFixture();
  t.after(() => fixture.close());

  const indexes = fixture.database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_devices_single_active_writer'").all();
  assert.equal(indexes.length, 0);
});
