import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDatabase, normalizeDatabaseBinding } from '../../tools/cloudflare-lab/src/database-binding.js';

const ROOT = resolve(import.meta.dirname, '../..');

test('DB is the preferred database binding', () => {
  const neutral = { name: 'neutral' };
  const legacy = { name: 'legacy' };
  const env = { DB: neutral, nuevo_amanecer_lab: legacy };
  assert.equal(getDatabase(env), neutral);
  assert.equal(normalizeDatabaseBinding(env), env);
});

test('legacy-only environments are normalized to DB during transition', () => {
  const legacy = { name: 'legacy' };
  const env = { nuevo_amanecer_lab: legacy };
  const normalized = normalizeDatabaseBinding(env);
  assert.notEqual(normalized, env);
  assert.equal(normalized.DB, legacy);
  assert.equal(normalized.nuevo_amanecer_lab, legacy);
  assert.equal(getDatabase(normalized), legacy);
  assert.equal(getDatabase({}), undefined);
});

test('all active Wrangler environments use DB and enter through the adapter', async () => {
  const entry = await readFile(resolve(ROOT, 'tools/cloudflare-lab/src/worker-entry.js'), 'utf8');
  assert.match(entry, /worker\.fetch\(request, normalizeDatabaseBinding\(env\), context\)/);
  for (const config of [
    'tools/cloudflare-lab/wrangler.jsonc',
    'tools/cloudflare-prod/wrangler.jsonc',
    'tools/cloudflare-staging/wrangler.backend.template.jsonc',
  ]) {
    const source = await readFile(resolve(ROOT, config), 'utf8');
    assert.match(source, /"binding": "DB"/, config + ' does not use DB');
    assert.doesNotMatch(source, /"binding": "nuevo_amanecer_lab"/, config + ' still declares legacy binding');
    assert.match(source, /worker-entry\.js/, config + ' bypasses the binding adapter');
  }
});
