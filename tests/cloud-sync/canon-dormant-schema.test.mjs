import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const worker = readFileSync(new URL('../../tools/cloudflare-lab/src/worker.js', import.meta.url), 'utf8');
const commerce = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0008_canonical_commerce.sql', import.meta.url), 'utf8');
const financial = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0009_canonical_financial.sql', import.meta.url), 'utf8');

test('CANON commerce/financial schema remains dormant in runtime', () => {
  assert.doesNotMatch(worker, /from ['"]\.\/a6-commerce\.js['"]/);
  assert.doesNotMatch(worker, /from ['"]\.\/a6-financial\.js['"]/);
  assert.doesNotMatch(worker, /\/commands\/canonical\.activate/);
  assert.doesNotMatch(worker, /createCanonicalFinancial|FINANCIAL_COMMANDS/);
});

test('renumbered migrations follow LAB workspace and exclude activation migration', () => {
  const names = readdirSync(new URL('../../tools/cloudflare-lab/migrations/', import.meta.url))
    .filter(name => /^\d{4}_.*\.sql$/.test(name))
    .sort();
  assert.ok(names.includes('0007_lab_workspace.sql'));
  assert.ok(names.includes('0008_canonical_commerce.sql'));
  assert.ok(names.includes('0009_canonical_financial.sql'));
  assert.equal(names.some(name => name.includes('canonical_activation')), false);
});

test('dormant migrations add schema only and never switch authority to ACTIVE', () => {
  for (const [name, sql] of [['commerce', commerce], ['financial', financial]]) {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS/);
    assert.doesNotMatch(sql, /UPDATE\s+canonical_control\s+SET\s+mode\s*=\s*['"]ACTIVE['"]/i, name);
    assert.doesNotMatch(sql, /INSERT\s+INTO\s+canonical_activation_receipts/i, name);
  }
});
