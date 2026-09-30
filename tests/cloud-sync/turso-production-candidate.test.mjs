import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const activeProd = JSON.parse(readFileSync('tools/cloudflare-prod/wrangler.jsonc','utf8'));
const candidate = JSON.parse(readFileSync('tools/cloudflare-prod/wrangler.turso-candidate.jsonc','utf8'));
const workflow = readFileSync('.github/workflows/v1.3-turso-prod-candidate.yml','utf8');
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

test('candidate workflow is explicitly gated for manual or one-shot authorized trigger', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /branches:[\s\S]*feature\/v1\.3-mobile-cloud/);
  assert.match(workflow, /paths:[\s\S]*ops\/v1\.3-turso-prod-candidate-trigger\.json/);
  assert.match(workflow, /PREPARE_TURSO_PRODUCTION_CANDIDATE/);
  assert.match(workflow, /owner_authorized/);
  assert.match(workflow, /one_shot/);
  assert.match(workflow, /grep -Fq/);
  assert.match(workflow, /TURSO_PROD_DATABASE_URL: \$\{\{ secrets\.TURSO_PROD_DATABASE_URL \}\}/);
  assert.match(workflow, /TURSO_PROD_AUTH_TOKEN: \$\{\{ secrets\.TURSO_PROD_AUTH_TOKEN \}\}/);
  assert.match(workflow, /test "\$TURSO_PROD_DATABASE_URL" != "\$TURSO_LAB_DATABASE_URL"/);
});

test('candidate workflow reads D1 export but deploys only the isolated Turso candidate', () => {
  assert.match(workflow, /cutover-prepare\.mjs export/);
  assert.match(workflow, /wrangler\.turso-candidate\.jsonc/);
  assert.match(workflow, /nuevo-amanecer-pos-prod-turso-candidate/);
  assert.doesNotMatch(workflow, /wrangler deploy --config \.\.\/cloudflare-prod\/wrangler\.jsonc/);
  assert.doesNotMatch(workflow, /wrangler d1 execute/);
  assert.doesNotMatch(workflow, /wrangler deploy --config \.\.\/cloudflare-pos-web\/wrangler\.jsonc/);
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
  assert.match(seeder, /format\(value, "\.15g"\)/);
});

test('candidate workflow keeps active production endpoints unchanged', () => {
  assert.match(workflow, /ACTIVE_PRODUCTION_UNCHANGED=PASS/);
  assert.match(workflow, /"name": "nuevo-amanecer-pos-prod"/);
  assert.match(workflow, /"database_name": "nuevo-amanecer-prod-v2"/);
  assert.match(workflow, /nuevo-amanecer-pos-prod\.nuevo-amanecer-pos\.workers\.dev/);
});


test('checkout must precede one-shot trigger validation on push runs', () => {
  const checkout = workflow.indexOf('Checkout exact active branch head');
  const confirm = workflow.indexOf('Require explicit candidate confirmation');
  assert.ok(checkout >= 0 && confirm >= 0 && checkout < confirm);
});


test('workflow can verify a populated candidate without reseeding', () => {
  assert.match(workflow, /verify_existing_candidate/);
  assert.match(workflow, /--verify-existing/);
});


test('candidate parity keeps strict digest and permits only sub-ULP float-to-float fallback', () => {
  assert.match(seeder, /semantic_table_equal/);
  assert.match(seeder, /isinstance\(local_value, float\) and isinstance\(remote_value, float\)/);
  assert.match(seeder, /rel_tol=2e-16/);
  assert.match(seeder, /abs_tol=0\.0/);
});
