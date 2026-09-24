import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

test('deploy validates the backup before any remote D1 or Worker change', () => {
  const workflow = read('.github/workflows/deploy-lab-cloud.yml');
  const preflight = workflow.indexOf('Preflight latest CANON backup before remote changes');
  const migrate = workflow.indexOf('Apply D1 LAB migrations');
  const deploy = workflow.indexOf('Deploy LAB Worker before secret binding');
  assert.ok(preflight >= 0 && migrate > preflight && deploy > preflight);
  assert.match(workflow, /canon-backup-manifest\.test\.mjs/);
  assert.match(workflow, /tests\/laboratorio-\*\.test\.mjs/);
});

test('manual remote workflows reject stale or non-active refs', () => {
  for (const rel of ['.github/workflows/deploy-lab-cloud.yml', '.github/workflows/lab-data-refresh.yml']) {
    const workflow = read(rel);
    assert.match(workflow, /Require current active branch head/);
    assert.match(workflow, /feature\/v1\.3-mobile-cloud/);
    assert.match(workflow, /git rev-parse origin\/feature\/v1\.3-mobile-cloud/);
  }
});
