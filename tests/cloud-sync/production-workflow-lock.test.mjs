import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const PRODUCTION_LOCK = 'nuevo-amanecer-production-change';

const productionWriters = [
  '.github/workflows/owner-backup-recovery-drill.yml',
  '.github/workflows/v1.3-first-live-sale.yml',
  '.github/workflows/v1.3-pos-web-deploy.yml',
  '.github/workflows/v1.3-prod-browser-cors-hotfix.yml',
  '.github/workflows/v1.3-prod-cutover.yml',
];

const readOnlyWorkflows = [
  '.github/workflows/canon-critical-ci.yml',
  '.github/workflows/opencode-config-ci.yml',
  '.github/workflows/v1.3-owner-validation-readonly.yml',
  '.github/workflows/v1.3-prod-preflight.yml',
];

const retiredLabWorkflows = [
  '.github/workflows/deploy-lab-cloud.yml',
  '.github/workflows/lab-cloud-ci.yml',
  '.github/workflows/lab-data-refresh.yml',
  '.github/workflows/lab-pages.yml',
  '.github/workflows/lab-workspace-repair.yml',
];

for (const workflow of productionWriters) {
  test(`${workflow} shares the global production lock without cancellation`, async () => {
    const source = await readFile(workflow, 'utf8');
    assert.match(source, new RegExp(`concurrency:\\s*\\n\\s*group:\\s*${PRODUCTION_LOCK}`));
    assert.match(source, /cancel-in-progress:\s*false/);
  });
}

test('read-only workflows stay outside the production write lock', async () => {
  for (const workflow of readOnlyWorkflows) {
    const source = await readFile(workflow, 'utf8');
    assert.equal(source.includes(PRODUCTION_LOCK), false, workflow);
  }
});

test('retired POS-LAB workflows remain absent', () => {
  for (const workflow of retiredLabWorkflows) {
    assert.equal(existsSync(workflow), false, workflow);
  }
});
