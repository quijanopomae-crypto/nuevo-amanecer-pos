import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { a6Fixture, response } from './a6-fixture.mjs';

const commerce = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0008_canonical_commerce.sql', import.meta.url), 'utf8');
const financial = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0009_canonical_financial.sql', import.meta.url), 'utf8');
const sessions = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0011_canonical_session_runtime.sql', import.meta.url), 'utf8');

async function active(t) {
  const f = await a6Fixture(t);
  await response(await f.freeze(), 201);
  await response(await f.promote(), 201);

  // Test-only transition: production activation remains separately gated.
  f.database.exec('DROP TRIGGER canonical_control_no_legacy');
  f.exec("UPDATE canonical_control SET mode='ACTIVE',revision=revision+1,authority_epoch=authority_epoch+1,minimum_client_contract='a6-gate-c-v1' WHERE id=1");
  f.database.exec(commerce);
  f.database.exec(financial);
  f.database.exec(sessions);

  f.addDevice('second-browser', 'writer', 'active', 'second-session-token');
  return f;
}

function sale(f) {
  const c = f.control();
  return {
    operation_id: 'multi-session-sale',
    sale_id: 'multi-session-sale-id',
    promotion_id: c.active_promotion_id,
    client_contract: 'a6-gate-c-v1',
    authority_epoch: c.authority_epoch,
    expected_control_revision: c.revision,
    created_at: '2026-09-24T19:30:00.000Z',
    payment_method: 'transferencia',
    total_cents: 1234,
    payment: { cash_cents: 0, digital_cents: 1234, credit_cents: 0, digital_method: 'transferencia', reference: 'SESSION-TEST' },
    items: [{ product_id: '00003', quantity: 1, unit_price_cents: 1234, line_total_cents: 1234, expected_stock_revision: 0 }],
  };
}

const auth = token => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json' });

test('canonical sale accepts a second active browser session without changing the historical control writer', async t => {
  const f = await active(t);
  const before = f.control();
  const body = sale(f);

  const result = await response(await f.fetch('http://localhost/commands/sale.create', {
    method: 'POST',
    headers: auth('second-session-token'),
    body: JSON.stringify(body),
  }), 201);

  assert.equal(result.status, 'created');
  assert.equal(f.control().writer_device_id, before.writer_device_id);
  assert.equal(f.control().first_live_operation_id, body.operation_id);
  const stored = f.sql('SELECT device_id FROM sales WHERE operation_id=?', body.operation_id);
  assert.equal(stored.device_id, 'session:second-browser');
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_write_guards').n, 0);
  assert.equal(f.sql('SELECT current_stock_quantity FROM products WHERE product_id=?', '00003').current_stock_quantity, 0.125);
});

test('canonical reads accept the persistent session token and remote runtime is off until explicitly enabled', async t => {
  const f = await active(t);

  const local = await f.fetch('http://localhost/read/canonical/status', { headers: { authorization: 'Bearer second-session-token' } });
  assert.equal(local.status, 200);
  assert.equal((await local.json()).mode, 'ACTIVE');

  const remoteUrl = 'https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev/read/canonical/status';
  const off = await f.fetch(remoteUrl, { headers: { authorization: 'Bearer second-session-token' } });
  assert.equal(off.status, 404);

  f.env.CANONICAL_RUNTIME_ENABLED = 'enabled';
  const on = await f.fetch(remoteUrl, { headers: { authorization: 'Bearer second-session-token' } });
  assert.equal(on.status, 200);
  assert.equal((await on.json()).mode, 'ACTIVE');
});

test('canonical runtime rejects a revoked second session', async t => {
  const f = await active(t);
  f.exec("UPDATE auth_sessions SET status='revoked' WHERE session_id='second-browser'");
  f.exec("UPDATE devices SET status='revoked' WHERE device_id='session:second-browser'");

  const denied = await f.fetch('http://localhost/commands/sale.create', {
    method: 'POST',
    headers: auth('second-session-token'),
    body: JSON.stringify(sale(f)),
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, 'session_revoked');
  assert.equal(f.sql('SELECT COUNT(*) n FROM sales').n, 0);
});

test('session runtime migration removes fixed-writer authorization predicates', () => {
  const commerceSource = readFileSync(new URL('../../tools/cloudflare-lab/src/a6-commerce.js', import.meta.url), 'utf8');
  const financialSource = readFileSync(new URL('../../tools/cloudflare-lab/src/a6-financial.js', import.meta.url), 'utf8');
  assert.doesNotMatch(commerceSource, /writer_device_id\s*!==\s*principalId/);
  assert.doesNotMatch(financialSource, /writer_device_id\s*!==\s*auth\.principalId/);
  assert.doesNotMatch(sessions, /c\.writer_device_id=NEW\.device_id/);
  assert.match(sessions, /NEW\.principal_id/);
  assert.match(sessions, /sale_writer\.device_id=g\.principal_id/);
});
