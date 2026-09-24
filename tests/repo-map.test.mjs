import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const map = readFileSync('REPO_MAP.yaml', 'utf8');

test('REPO_MAP identifies current authority and release boundary', () => {
  assert.match(map, /active_branch: feature\/v1\.3-mobile-cloud/);
  assert.match(map, /production_baseline: v1\.2-production/);
  assert.match(map, /v1_3: remediation_integration/);
  assert.match(map, /production_cutover: not_authorized/);
  assert.match(map, /runtime_activation: dormant/);
  assert.match(map, /activation_migration_present: false/);
});

test('REPO_MAP canonical navigation paths exist', () => {
  const required = [
    'POS',
    'laboratorio/pos-lab',
    'tools/cloudflare-lab/src/worker.js',
    'tools/cloudflare-lab/src/lab-workspace.js',
    'tools/cloudflare-lab/migrations',
    'tools/cloudflare-backup',
    '.opencode/ROLE_MAP.md',
    '.opencode/agents/pos-canon-implementer.md',
    '.opencode/agents/pos-lab-implementer.md',
    '.agents/skills/canon-promotion',
    'docs/V1.3_STATUS.md',
    'docs/LABORATORIO_A_CANON.md',
    'docs/LAB_CANON_MIRROR.md',
    'tests/cloud-sync',
    'tests/product-fixes',
  ];
  for (const path of required) {
    assert.equal(existsSync(path), true, 'missing mapped path: ' + path);
  }
});

test('REPO_MAP preserves historical artifacts instead of declaring blind deletion', () => {
  for (const path of [
    'CVV1.1.html',
    'CVV2.4_backup_antes_demo-1.html',
    'nuevo-amanecer-pos-engineer.zip',
    'POS/js/legacy-inline',
    'POS/js/compat/legacy-globals.js',
    'evidence',
  ]) {
    assert.equal(existsSync(path), true, 'historical candidate disappeared before Phase 9 proof: ' + path);
  }
});
