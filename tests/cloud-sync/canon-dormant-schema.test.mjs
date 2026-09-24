import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const worker = readFileSync(new URL('../../tools/cloudflare-lab/src/worker.js', import.meta.url), 'utf8');
const commerce = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0008_canonical_commerce.sql', import.meta.url), 'utf8');
const financial = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0009_canonical_financial.sql', import.meta.url), 'utf8');
const sessionRuntime = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0011_canonical_session_runtime.sql', import.meta.url), 'utf8');
const a6 = readFileSync(new URL('../../tools/cloudflare-lab/src/a6-canonical.js', import.meta.url), 'utf8');

test('CANON runtime is wired but remote activation remains fail-closed', () => {
  assert.match(worker, /from ['"]\.\/a6-commerce\.js['"]/);
  assert.match(worker, /from ['"]\.\/a6-financial\.js['"]/);
  assert.match(worker, /createCanonicalFinancial|FINANCIAL_COMMANDS/);
  assert.match(a6, /CANONICAL_RUNTIME_ENABLED === 'enabled'/);
  assert.match(a6, /return json\(\{ error:'not_found' \},404\)/);
  assert.doesNotMatch(worker, /\/commands\/canonical\.activate/);
});

test('renumbered migrations follow LAB workspace and exclude activation migration', () => {
  const names = readdirSync(new URL('../../tools/cloudflare-lab/migrations/', import.meta.url))
    .filter(name => /^\d{4}_.*\.sql$/.test(name))
    .sort();
  assert.ok(names.includes('0007_lab_workspace.sql'));
  assert.ok(names.includes('0008_canonical_commerce.sql'));
  assert.ok(names.includes('0009_canonical_financial.sql'));
  assert.ok(names.includes('0010_session_auth.sql'));
  assert.ok(names.includes('0011_canonical_session_runtime.sql'));
  assert.equal(names.some(name => name.includes('canonical_activation')), false);
});

test('dormant migrations add schema only and never switch authority to ACTIVE', () => {
  for (const [name, sql] of [['commerce', commerce], ['financial', financial], ['session-runtime', sessionRuntime]]) {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS/);
    assert.doesNotMatch(sql, /UPDATE\s+canonical_control\s+SET\s+mode\s*=\s*['"]ACTIVE['"]/i, name);
    assert.doesNotMatch(sql, /INSERT\s+INTO\s+canonical_activation_receipts/i, name);
  }
});
