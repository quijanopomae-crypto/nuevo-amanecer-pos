import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { a6Fixture, response } from './a6-fixture.mjs';

const migrations = [
  '0008_canonical_commerce.sql',
  '0009_canonical_financial.sql',
  '0011_canonical_session_runtime.sql',
  '0012_credit_accounts_v2.sql',
  '0013_canonical_expenses.sql',
];

test('ACTIVE canonical reads work with DB-only environment like STAGING', async t => {
  const f = await a6Fixture(t);
  await response(await f.freeze(), 201);
  await response(await f.promote(), 201);

  for (const name of migrations) {
    f.database.exec(readFileSync('infra/database/migrations/' + name, 'utf8'));
  }
  f.database.exec('DROP TRIGGER canonical_control_no_legacy');
  f.exec("UPDATE canonical_control SET mode='ACTIVE',revision=revision+1,authority_epoch=authority_epoch+1,minimum_client_contract='a6-gate-c-v1' WHERE id=1");
  f.database.exec(readFileSync('infra/database/migrations/0013_canonical_expenses.sql', 'utf8'));

  f.addDevice('staging-browser', 'writer', 'active', 'staging-session-token');
  f.env.CANONICAL_RUNTIME_ENABLED = 'enabled';
  f.env.RUNTIME_ENVIRONMENT = 'staging';
  f.env.DB = f.binding;
  delete f.env.nuevo_amanecer_lab;

  const auth = { authorization:'Bearer staging-session-token' };
  const status = await f.fetch('https://staging.example/read/canonical/status', { headers:auth });
  assert.equal(status.status, 200, await status.clone().text());
  const statusBody = await status.json();
  assert.equal(statusBody.mode, 'ACTIVE');
  assert.equal(statusBody.authority, 'canonical');
  assert.ok(Number(statusBody.counts.products) > 0);
  assert.ok(Number(statusBody.counts.customers) > 0);

  for (const route of ['products','customers']) {
    const res = await f.fetch('https://staging.example/read/canonical/' + route + '?limit=5', { headers:auth });
    assert.equal(res.status, 200, route + ': ' + await res.clone().text());
    const body = await res.json();
    assert.ok(Array.isArray(body.items), route + ' response is not paginated items');
    assert.ok(body.items.length > 0, route + ' should expose synthetic canonical rows');
  }
});
