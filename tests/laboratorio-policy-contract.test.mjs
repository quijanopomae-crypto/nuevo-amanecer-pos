import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

test('LAB policy distinguishes isolated D1 copy from versioned production data', () => {
  const policy = JSON.parse(read('laboratorio/LAB_POLICY.json'));
  assert.equal(policy.production_data_allowed, false);
  assert.equal(policy.isolated_canon_copy_in_d1_lab_allowed, true);
  assert.equal(policy.real_commercial_data_versioning_allowed, false);
  assert.equal(policy.production_writes_allowed, false);
  assert.equal(policy.encrypted_ci_secrets_allowed, true);
  assert.equal(policy.credentials_versioned_or_client_exposed_allowed, false);
});

test('OpenCode loads root mode policy before functional policy', () => {
  const config = JSON.parse(read('opencode.json'));
  assert.deepEqual(config.instructions.slice(0, 2), [
    'AGENTS.md',
    'AGENTS_Nuevo_Amanecer.md'
  ]);
});

test('UI map declares D1 LAB copy without granting production authority', () => {
  const map = read('laboratorio/pos-lab/UI_MAP.yaml');
  assert.match(map, /production_data_authority:\s*false/);
  assert.match(map, /isolated_canon_copy_in_d1_lab:\s*true/);
  assert.match(map, /real_commercial_data_versioned:\s*false/);
});


test('LAB isolation guard allows only the one-time activation write outside workspace routes', () => {
  const guard = read('laboratorio/pos-lab/lab-guard.js');
  assert.match(guard, /url\.pathname === '\/auth\/activate'/);
  assert.match(guard, /method === 'POST'/);
  assert.match(guard, /blockedHosts\.has\(url\.hostname\)/);
  assert.match(guard, /!allowedLabWorkspaceWrite && !allowedActivationWrite/);
  assert.doesNotMatch(guard, /url\.pathname\.startsWith\('\/auth\/'\)/);
});
