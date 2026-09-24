import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { a6Fixture, response, WRITER, trafficIsZero, intercept } from './a6-fixture.mjs';

const requireLab = createRequire(new URL('../../tools/cloudflare-lab/package.json', import.meta.url));
const { Miniflare } = requireLab('miniflare');
const { unstable_splitSqlQuery: splitSQL } = requireLab('wrangler');

const FINAL = 'prod-v2-pos-writer-01';
const TEMP = 'prod-v2-a5-temporary-writer';
const HEADERS = { 'x-device-id': FINAL, 'x-sync-token': 'final-secret' };

async function ready(t) {
  const f = await a6Fixture(t);
  await response(await f.freeze(), 201);
  await response(await f.promote(), 201);
  f.exec("UPDATE devices SET status='revoked' WHERE device_id=?", WRITER['x-device-id']);
  f.addDevice(FINAL, 'writer', 'active', HEADERS['x-sync-token']);
  f.addDevice(TEMP, 'writer', 'revoked', 'temporary-secret');
  // Mirror PROD: freeze/promote left control pointing at the revoked temporary writer.
  const controlTrigger = f.sql("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='canonical_control_no_legacy'").sql;
  f.exec('DROP TRIGGER canonical_control_no_legacy');
  f.exec('UPDATE canonical_control SET writer_device_id=? WHERE id=1', TEMP);
  f.database.exec(controlTrigger);
  f.env.A6_ACTIVATION_DATABASE_ID = 'a6-synthetic-memory-database';
  f.env.A6_ACTIVATION_EXPECTED_COUNTS = JSON.stringify(f.counts());
  return f;
}

function intent(f, changes = {}) {
  const c = f.control();
  return { operation_id: 'activate-1', promotion_id: c.active_promotion_id,
    expected_control_revision: c.revision, expected_authority_epoch: c.authority_epoch,
    client_contract: 'a6-gate-c-v1', ...changes };
}

const send = (f, body, headers = HEADERS) => f.post('/commands/canonical.activate', body, headers);
const receipts = f => f.sql('SELECT COUNT(*) n FROM canonical_activation_receipts').n;
const snapshot = f => ({ ...f.control() });

test('activation commits one durable receipt, exact replay and lost ACK return same result', async t => {
  const f = await ready(t), body = intent(f);
  const before = f.control();
  let lost = false;
  const restore = intercept(f, async ({ when, method, entries }) => {
    if (!lost && when === 'after' && method === 'batch' && entries.some(e => e.sql.includes('INSERT INTO canonical_activation_receipts'))) {
      lost = true;
      throw new Error('ack_discarded_after_commit');
    }
  });
  const first = await response(await send(f, body), 200);
  restore();
  assert.equal(lost, true);
  assert.equal(first.mode, 'ACTIVE');
  assert.equal(first.revision, before.revision + 1);
  assert.equal(first.authority_epoch, before.authority_epoch + 1);
  assert.equal(f.control().writer_device_id, FINAL);
  assert.equal(f.control().minimum_client_contract, 'a6-gate-c-v1');
  assert.equal(f.control().first_live_operation_id, null);
  assert.equal(receipts(f), 1);
  assert.equal(f.sql("SELECT COUNT(*) n FROM devices WHERE role='writer' AND status='active'").n, 1);
  assert.equal(f.sql('SELECT status FROM devices WHERE device_id=?', TEMP).status, 'revoked');
  const saved = snapshot(f);
  assert.deepEqual(await response(await send(f, body), 200), first);
  assert.deepEqual(snapshot(f), saved);
  assert.equal(receipts(f), 1);
  assert.equal((await response(await send(f, { ...body, client_contract: 'other' }), 409)).error, 'operation_id_conflict');
  trafficIsZero(f);
});

test('activation rejects stale revision, stale epoch, wrong writer, second writer and wrong contract', async t => {
  for (const change of ['revision', 'epoch', 'wrong-writer', 'second-writer', 'contract']) await t.test(change, async t => {
    const f = await ready(t), body = intent(f), before = snapshot(f);
    if (change === 'revision') body.expected_control_revision--;
    if (change === 'epoch') body.expected_authority_epoch--;
    if (change === 'contract') body.client_contract = 'a6-gate-p-v1';
    if (change === 'wrong-writer') {
      await response(await send(f, body, WRITER), 403);
      await response(await send(f, body, { ...HEADERS, 'x-sync-token': 'bad-secret' }), 401);
    }
    else {
      if (change === 'second-writer') {
        assert.throws(() => f.exec("UPDATE devices SET status='active' WHERE device_id=?", TEMP), /UNIQUE constraint failed/);
        f.exec('DROP INDEX idx_devices_single_active_writer');
        f.exec("UPDATE devices SET status='active' WHERE device_id=?", TEMP);
      }
      await response(await send(f, body), 409);
    }
    assert.deepEqual(snapshot(f), before);
    assert.equal(receipts(f), 0);
  });
});

test('activation rejects live traffic and set first-live marker without effects', async t => {
  for (const change of ['traffic', 'first-live']) await t.test(change, async t => {
    const f = await ready(t), body = intent(f);
    const trigger = f.sql("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='canonical_control_no_legacy'").sql;
    if (change === 'traffic') {
      const guard = f.sql("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='canonical_write_guards_authorized_insert'");
      f.exec('DROP TRIGGER canonical_write_guards_authorized_insert');
      f.exec("INSERT INTO canonical_write_guards(operation_id,commit_token,promotion_id,authority_epoch,control_revision,client_contract) VALUES('probe','token',?,?,?,'a6-gate-p-v1')", body.promotion_id, body.expected_authority_epoch, body.expected_control_revision);
      f.database.exec(guard.sql);
    }
    if (change === 'first-live') {
      f.exec('DROP TRIGGER canonical_control_no_legacy');
      f.exec("UPDATE canonical_control SET first_live_operation_id='prior' WHERE id=1");
      f.database.exec(trigger);
    }
    const before = snapshot(f);
    await response(await send(f, body), 409);
    assert.deepEqual(snapshot(f), before);
    assert.equal(receipts(f), 0);
  });
});

test('activation SQL failure rolls back receipt and control; concurrent attempts commit once', async t => {
  const f = await ready(t), body = intent(f), before = snapshot(f);
  for (let index = 0; index < 5; index++) {
    f.failBatchAt(index);
    await response(await send(f, body), 409);
    assert.deepEqual(snapshot(f), before, `statement ${index}`);
    assert.equal(receipts(f), 0, `statement ${index}`);
  }
  f.failBatchAt(null);
  const [a,b] = await Promise.all([send(f, body), send(f, { ...body, operation_id: 'activate-2' })]);
  assert.deepEqual([a.status,b.status].sort(), [201,409]);
  assert.equal(receipts(f), 1);
  trafficIsZero(f);
});

test('activation rejects wrong baseline counts, revoked writer state and SQL bypass', async t => {
  const f = await ready(t), body = intent(f);
  f.env.A6_ACTIVATION_EXPECTED_COUNTS = JSON.stringify({ ...f.counts(), products: f.counts().products + 1 });
  await response(await send(f, body), 409);
  assert.equal(receipts(f), 0);
  f.env.A6_ACTIVATION_EXPECTED_COUNTS = JSON.stringify(f.counts());
  f.exec("UPDATE devices SET role='read_only' WHERE device_id=?", TEMP);
  await response(await send(f, body), 409);
  assert.equal(receipts(f), 0);
  f.exec("UPDATE devices SET role='writer' WHERE device_id=?", TEMP);
  assert.throws(() => f.exec("UPDATE canonical_control SET mode='ACTIVE',revision=revision+1,authority_epoch=authority_epoch+1,writer_device_id=?,minimum_client_contract='a6-gate-c-v1' WHERE id=1", FINAL), /gate_p_control/);
  assert.equal(f.control().mode, 'CANONICAL_READ_ONLY');
});

test('handover accepts the revoked control writer and the definitive writer already in control', async t => {
  for (const priorWriter of [TEMP, FINAL]) await t.test(priorWriter, async t => {
    const f = await ready(t), body = intent(f);
    if (priorWriter === FINAL) {
      const trigger = f.sql("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='canonical_control_no_legacy'").sql;
      f.exec('DROP TRIGGER canonical_control_no_legacy');
      f.exec('UPDATE canonical_control SET writer_device_id=? WHERE id=1', FINAL);
      f.database.exec(trigger);
    }
    assert.equal(f.control().writer_device_id, priorWriter);
    const before = snapshot(f);
    await response(await send(f, body), 201);
    assert.equal(f.control().writer_device_id, FINAL);
    assert.equal(f.control().mode, 'ACTIVE');
    assert.equal(f.control().revision, before.revision + 1);
    assert.equal(f.control().authority_epoch, before.authority_epoch + 1);
    assert.equal(receipts(f), 1);
  });
});

test('handover rejects missing or non-writer control device without partial transfer', async t => {
  for (const state of ['missing', 'read_only']) await t.test(state, async t => {
    const f = await ready(t), body = intent(f);
    if (state === 'missing') {
      const trigger = f.sql("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='canonical_control_no_legacy'").sql;
      f.exec('PRAGMA foreign_keys=OFF');
      f.exec('DROP TRIGGER canonical_control_no_legacy');
      f.exec("UPDATE canonical_control SET writer_device_id='absent-writer' WHERE id=1");
      f.database.exec(trigger);
      f.exec('PRAGMA foreign_keys=ON');
    } else f.exec("UPDATE devices SET role='read_only' WHERE device_id=?", TEMP);
    const before = snapshot(f);
    await response(await send(f, body), 409);
    assert.deepEqual(snapshot(f), before);
    assert.equal(receipts(f), 0);
  });
});

test('ACTIVE production host exposes canonical reads and authenticated command validation', async t => {
  const f = await ready(t), body = intent(f);
  await response(await send(f, body), 201);
  f.env.A6_ACTIVATION_DATABASE_ID = 'cf2c83d3-f187-472e-967b-0ad24be969eb';
  delete f.env.A6_LOCAL_GATE;
  delete f.env.A6_OPERATIONAL_MANIFEST;
  const origin = 'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev';
  const read = await f.fetch(`${origin}/read/canonical/status`, { headers: { 'x-read-token': f.env.READ_TOKEN } });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).mode, 'ACTIVE');
  await response(await f.fetch(`${origin}/commands/sale.create`, { method: 'POST', headers: HEADERS, body: '{}' }), 400);
  await response(await f.fetch(`${origin}/commands/cash.open`, { method: 'POST', headers: HEADERS, body: '{}' }), 400);
});

test('0009 applies atomically on real local workerd D1 with FK and retained 0008 trigger branches', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pos-activation-d1-'));
  const id = randomUUID();
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
    resourcePersistencePath: root, isolatedResourcePersistencePath: root, resourceTmpPath: join(root, 'tmp'),
    unsafeDevRegistryPath: join(root, 'registry'), workers: [{ config: { name: 'activation-migration-test', type: 'worker', compatibilityDate: '2026-09-01',
      manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' } } },
      env: { nuevo_amanecer_lab: { type: 'd1', id, dev: { remote: false } } } }, dev: { rootPath: root, unsafeRegisterWorker: false } }] });
  try {
    const db = await mf.getD1Database('nuevo_amanecer_lab');
    const names = ['0001_sync_operations','0002_read_only_indexes','0003_device_auth','0004_sale_create','0005_import_staging',
      '0006_canonical_promotion','0007_canonical_commerce','0008_canonical_financial','0009_canonical_activation'];
    for (const name of names) {
      const sql = await readFile(new URL(`../../tools/cloudflare-lab/migrations/${name}.sql`, import.meta.url), 'utf8');
      await db.batch(splitSQL(sql).filter(Boolean).map(statement => db.prepare(statement)));
    }
    const trigger = await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='canonical_control_no_legacy'").first();
    assert.match(trigger.sql, /canonical_financial_operations/);
    assert.match(trigger.sql, /canonical_activation_receipts/);
    assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM canonical_activation_receipts').first()).n, 0);
    const migration = await readFile(new URL('../../tools/cloudflare-lab/migrations/0009_canonical_activation.sql', import.meta.url), 'utf8');
    await db.batch(splitSQL(migration).filter(Boolean).map(statement => db.prepare(statement)));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM canonical_activation_receipts').first()).n, 0);
  } finally {
    await mf.dispose();
    assert.ok(root.startsWith(join(tmpdir(), 'pos-activation-d1-')));
    await rm(root, { recursive: true, force: true });
  }
});
