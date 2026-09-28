import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeDatabaseBinding } from '../../tools/cloudflare-lab/src/database-binding.js';

const ROOT = resolve(import.meta.dirname, '../..');

test('DB is preferred and exposed through the legacy runtime contract', () => {
  const neutral = { name: 'neutral' };
  const legacy = { name: 'legacy' };
  const normalized = normalizeDatabaseBinding({ DB: neutral, nuevo_amanecer_lab: legacy });
  assert.equal(normalized.DB, neutral);
  assert.equal(normalized.nuevo_amanecer_lab, neutral);
});

test('legacy-only environments remain unchanged during transition', () => {
  const legacy = { name: 'legacy' };
  const env = { nuevo_amanecer_lab: legacy };
  assert.equal(normalizeDatabaseBinding(env), env);
  assert.equal(normalizeDatabaseBinding({}).nuevo_amanecer_lab, undefined);
});

test('all Wrangler environments enter through the binding adapter', async () => {
  const entry = await readFile(resolve(ROOT, 'tools/cloudflare-lab/src/worker-entry.js'), 'utf8');
  assert.match(entry, /worker\.fetch\(request, normalizeDatabaseBinding\(env\), context\)/);
  for (const config of [
    'tools/cloudflare-lab/wrangler.jsonc',
    'tools/cloudflare-prod/wrangler.jsonc',
    'tools/cloudflare-staging/wrangler.backend.template.jsonc',
  ]) {
    const content = await readFile(resolve(ROOT, config), 'utf8');
    assert.match(content, /worker-entry\.js/, `${config} bypasses the binding adapter`);
  }
});
