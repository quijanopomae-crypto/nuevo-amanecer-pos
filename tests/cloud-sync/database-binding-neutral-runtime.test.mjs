import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modules = [
  'tools/cloudflare-lab/src/worker.js',
  'tools/cloudflare-lab/src/a6-commerce.js',
  'tools/cloudflare-lab/src/a6-financial.js',
  'tools/cloudflare-lab/src/a6-expenses.js',
  'tools/cloudflare-lab/src/lab-workspace.js',
];

test('runtime modules depend on getDatabase instead of the legacy binding name', () => {
  for (const path of modules) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /getDatabase\(env\)/, path + ' does not use neutral accessor');
    assert.doesNotMatch(source, /env\.nuevo_amanecer_lab/, path + ' reads legacy binding directly');
  }
});

test('legacy binding knowledge is isolated to the compatibility adapter', () => {
  const adapter = readFileSync('tools/cloudflare-lab/src/database-binding.js','utf8');
  assert.match(adapter, /env\?\.DB \?\? env\?\.nuevo_amanecer_lab/);
  assert.match(adapter, /return \{ \.\.\.env, DB: db \}/);
});
