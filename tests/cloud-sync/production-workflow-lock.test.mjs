import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LOCK = 'nuevo-amanecer-production-change';
const serialized = [
  '.github/workflows/v1.3-pos-web-deploy.yml',
  '.github/workflows/v1.3-prod-cutover.yml',
  '.github/workflows/v1.3-prod-browser-cors-hotfix.yml',
  '.github/workflows/v1.3-first-live-sale.yml',
  '.github/workflows/owner-backup-recovery-drill.yml',
];
const readonly = [
  '.github/workflows/v1.3-prod-preflight.yml',
  '.github/workflows/v1.3-owner-validation-readonly.yml',
];

test('all workflows that can mutate production share one non-cancelling lock', () => {
  for (const file of serialized) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, new RegExp(`concurrency:\\s+group: ${LOCK}\\s+cancel-in-progress: false`), file);
  }
});

test('production read-only validation stays outside the write lock', () => {
  for (const file of readonly) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, new RegExp(`group: ${LOCK}`), file);
    assert.doesNotMatch(source, /wrangler deploy(?! --dry-run)|wrangler secret put|wrangler d1 execute|r2 object put/, file);
  }
});
