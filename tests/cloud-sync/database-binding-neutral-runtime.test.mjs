import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const runtimeRoot = 'tools/cloudflare-lab/src';
const databaseConsumers = [
  'worker.js',
  'a6-canonical.js',
  'a6-commerce.js',
  'a6-financial.js',
  'a6-expenses.js',
  'lab-workspace.js',
].map(name => join(runtimeRoot, name));

function runtimeSources(dir = runtimeRoot) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...runtimeSources(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
  }
  return files.sort();
}

test('all database-consuming runtime modules use the neutral accessor', () => {
  for (const path of databaseConsumers) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /getDatabase\(env\)/, path + ' does not use neutral accessor');
  }
});

test('legacy D1 binding knowledge is absent from every runtime source except the compatibility adapter', () => {
  for (const path of runtimeSources()) {
    if (path.endsWith('database-binding.js')) continue;
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /env\??\.nuevo_amanecer_lab/, path + ' reads legacy binding directly');
  }
});

test('legacy binding knowledge is isolated to the compatibility adapter', () => {
  const adapter = readFileSync('tools/cloudflare-lab/src/database-binding.js','utf8');
  assert.match(adapter, /env\?\.DB \?\? env\?\.nuevo_amanecer_lab/);
  assert.match(adapter, /return \{ \.\.\.env, DB: db \}/);
});
