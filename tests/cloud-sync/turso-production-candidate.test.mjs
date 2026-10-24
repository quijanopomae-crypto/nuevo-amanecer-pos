import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const activeProd = JSON.parse(readFileSync('tools/cloudflare-prod/wrangler.jsonc','utf8'));
const candidate = JSON.parse(readFileSync('tools/cloudflare-prod/wrangler.turso-candidate.jsonc','utf8'));
const seeder = readFileSync('tools/cloudflare-prod/scripts/turso-seed-from-sqlite.py','utf8');

test('Turso production candidate is a separate Worker and does not replace active production config', () => {
  assert.equal(activeProd.name, 'nuevo-amanecer-pos-prod');
  assert.equal(candidate.name, 'nuevo-amanecer-pos-prod-turso-candidate');
  assert.notEqual(candidate.name, activeProd.name);
  assert.equal(candidate.vars.RUNTIME_ENVIRONMENT, 'production');
  assert.equal(candidate.vars.CANONICAL_RUNTIME_ENABLED, 'enabled');
  assert.equal(candidate.vars.DB_PROVIDER, 'turso');
  assert.equal(Array.isArray(candidate.d1_databases), false);
});

test('candidate seeder fails closed on non-empty target and verifies full table content', () => {
  assert.match(seeder, /ensure_remote_empty/);
  assert.match(seeder, /Turso candidate is not empty; refusing import/);
  assert.match(seeder, /PRAGMA quick_check/);
  assert.match(seeder, /PRAGMA foreign_key_check/);
  assert.match(seeder, /rows_digest/);
  assert.match(seeder, /compare_all_tables/);
  assert.match(seeder, /CONTENT_PARITY=PASS/);
  assert.match(seeder, /SCHEMA_PARITY=PASS/);
  assert.match(seeder, /--verify-existing/);
  assert.match(seeder, /format\(value, "\.17g"\)/);
});

test('candidate parity keeps strict digest and permits only sub-ULP float-to-float fallback', () => {
  assert.match(seeder, /semantic_table_equal/);
  assert.match(seeder, /isinstance\(local_value, float\) and isinstance\(remote_value, float\)/);
  assert.match(seeder, /rel_tol=2e-16/);
  assert.match(seeder, /abs_tol=0\.0/);
});
