import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const productionWriters = [
  '.github/workflows/owner-backup-recovery-drill.yml',
  '.github/workflows/v1.3-first-live-sale.yml',
  '.github/workflows/v1.3-pos-web-deploy.yml',
  '.github/workflows/v1.3-prod-browser-cors-hotfix.yml',
  '.github/workflows/v1.3-prod-cutover.yml',
];

const readOnlyOrLabWorkflows = [
  '.github/workflows/canon-critical-ci.yml',
  '.github/workflows/deploy-lab-cloud.yml',
  '.github/workflows/lab-cloud-ci.yml',
  '.github/workflows/lab-data-refresh.yml',
  '.github/workflows/lab-pages.yml',
  '.github/workflows/lab-workspace-repair.yml',
  '.github/workflows/opencode-config-ci.yml',
  '.github/workflows/v1.3-owner-validation-readonly.yml',
  '.github/workflows/v1.3-prod-preflight.yml',
];

async function workflow(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('all production writers share one non-cancelling global lock', async () => {
  for (const path of productionWriters) {
    const source = await workflow(path);
    assert.match(source, /concurrency:\s*\n\s*group:\s*nuevo-amanecer-production-change\s*\n\s*cancel-in-progress:\s*false\b/, path);
  }
});

test('read-only and LAB workflows do not consume the production write lock', async () => {
  for (const path of readOnlyOrLabWorkflows) {
    const source = await workflow(path);
    assert.doesNotMatch(source, /group:\s*nuevo-amanecer-production-change\b/, path);
  }
});
