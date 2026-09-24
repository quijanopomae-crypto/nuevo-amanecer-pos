import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const activeAuthFiles = [
  'tools/cloudflare-lab/src/worker.js',
  'tools/cloudflare-lab/src/lab-workspace.js',
  'tools/cloudflare-lab/src/a6-canonical.js',
  'tools/cloudflare-lab/src/a6-commerce.js',
  'tools/cloudflare-lab/src/a6-financial.js',
  'POS/js/sync/outbox.js',
  'laboratorio/pos-lab/js/lab-workspace.js',
  '.github/workflows/deploy-lab-cloud.yml',
  'tools/owner-finalize-v1.3.ps1',
  'tools/cloudflare-lab/.dev.vars.example',
];

test('active authentication surface has no per-device lock/provisioning contract', () => {
  const forbidden = [
    'DEVICE_CREDENTIAL_PEPPER',
    'LAB_DEVICE_SYNC_TOKEN',
    'lab-phone-main',
    'x-device-id',
    'x-sync-token',
    'provision-lab-device.yml',
  ];
  for (const path of activeAuthFiles) {
    const source = readFileSync(path, 'utf8');
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, path + ' must not contain ' + token);
    }
  }
  assert.equal(existsSync('.github/workflows/provision-lab-device.yml'), false);
  assert.equal(existsSync('tools/cloudflare-lab/scripts/device-auth-sql.mjs'), false);
});

test('worker exchanges one activation secret for persistent sessions', () => {
  const worker = readFileSync('tools/cloudflare-lab/src/worker.js', 'utf8');
  const migration = readFileSync('tools/cloudflare-lab/migrations/0010_session_auth.sql', 'utf8');
  assert.match(worker, /\/auth\/activate/);
  assert.match(worker, /POS_ACTIVATION_SECRET/);
  assert.match(worker, /auth_sessions/);
  assert.match(worker, /Authorization|authorization/);
  assert.match(migration, /DROP INDEX IF EXISTS idx_devices_single_active_writer/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_sessions/);
});

test('browser clients persist session token and never persist activation secret', () => {
  const outbox = readFileSync('POS/js/sync/outbox.js', 'utf8');
  const lab = readFileSync('laboratorio/pos-lab/js/lab-workspace.js', 'utf8');
  assert.match(outbox, /\/auth\/activate/);
  assert.match(outbox, /remember: true/);
  assert.match(outbox, /authorization.*Bearer/i);
  assert.match(lab, /naLabActivationSecret/);
  assert.match(lab, /sessionToken/);
  assert.match(lab, /authorization.*Bearer/i);
  assert.doesNotMatch(lab, /localStorage\.setItem\([^\n]*activation/i);
  assert.doesNotMatch(outbox, /localStorage\.setItem\([^\n]*activation/i);
});

test('deployment binds activation secret and does not provision a device', () => {
  const deploy = readFileSync('.github/workflows/deploy-lab-cloud.yml', 'utf8');
  const finalizer = readFileSync('tools/owner-finalize-v1.3.ps1', 'utf8');
  assert.match(deploy, /POS_ACTIVATION_SECRET/);
  assert.match(deploy, /wrangler secret put POS_ACTIVATION_SECRET/);
  assert.match(finalizer, /gh secret set POS_ACTIVATION_SECRET/);
  assert.doesNotMatch(finalizer, /provision-lab-device/);
});
