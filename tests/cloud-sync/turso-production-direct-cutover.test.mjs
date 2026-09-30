import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/v1.3-turso-prod-direct-cutover.yml','utf8');
const trigger = JSON.parse(readFileSync('ops/v1.3-turso-prod-direct-trigger.json','utf8'));
const tursoConfig = JSON.parse(readFileSync('tools/cloudflare-prod/wrangler.turso-prod.jsonc','utf8'));
const d1Config = JSON.parse(readFileSync('tools/cloudflare-prod/wrangler.jsonc','utf8'));

test('direct cutover is explicitly owner-authorized with test-data loss accepted', () => {
  assert.equal(trigger.action, 'DIRECT_CUTOVER_CANON_TO_TURSO');
  assert.equal(trigger.owner_authorized, true);
  assert.equal(trigger.accept_test_data_loss, true);
  assert.equal(trigger.one_shot, true);
  assert.equal(trigger.no_live_sale, true);
  assert.equal(trigger.candidate_run_id, 36782779872);
});

test('direct cutover does not depend on D1 reads exports or production mutations', () => {
  assert.doesNotMatch(workflow, /cutover-prepare\.mjs preflight/);
  assert.doesNotMatch(workflow, /cutover-prepare\.mjs export/);
  assert.doesNotMatch(workflow, /wrangler d1 execute/);
  assert.doesNotMatch(workflow, /\/d1\/database\/.*\/export/);
  assert.doesNotMatch(workflow, /commands\/sale\.create/);
  assert.doesNotMatch(workflow, /first-live-sale/);
});

test('active Worker identity remains identical while provider becomes Turso', () => {
  assert.equal(d1Config.name, 'nuevo-amanecer-pos-prod');
  assert.equal(tursoConfig.name, 'nuevo-amanecer-pos-prod');
  assert.equal(tursoConfig.vars.RUNTIME_ENVIRONMENT, 'production');
  assert.equal(tursoConfig.vars.CANONICAL_RUNTIME_ENABLED, 'enabled');
  assert.equal(tursoConfig.vars.DB_PROVIDER, 'turso');
  assert.equal(Array.isArray(tursoConfig.d1_databases), false);
});

test('workflow validates Turso and candidate before switching active Worker', () => {
  const db = workflow.indexOf('Verify Turso production database directly');
  const candidate = workflow.indexOf('Re-probe isolated Turso candidate immediately before switch');
  const deploy = workflow.indexOf('Deploy active CANON Worker on Turso');
  assert.ok(db >= 0 && candidate > db && deploy > candidate);
  assert.match(workflow, /PRAGMA quick_check/);
  assert.match(workflow, /PRAGMA foreign_key_check/);
  assert.match(workflow, /TURSO_DIRECT_CUTOVER_CANDIDATE_REPROBE=PASS/);
});

test('active post-deploy smoke covers production boundary auth and canonical reads', () => {
  assert.match(workflow, /TURSO_DIRECT_ACTIVE_HEALTH=PASS/);
  assert.match(workflow, /\/lab\/workspace\/status/);
  assert.match(workflow, /\/auth\/activate/);
  assert.match(workflow, /\/auth\/session/);
  assert.match(workflow, /\/read\/canonical\/status/);
  assert.match(workflow, /\/read\/canonical\/products\?limit=5/);
  assert.match(workflow, /\/read\/canonical\/customers\?limit=5/);
  assert.match(workflow, /TURSO_DIRECT_CUTOVER=PASS/);
});

test('post-deploy failure restores the prior D1 Worker config without deleting Turso or D1', () => {
  assert.match(workflow, /failure\(\) && env\.TURSO_DIRECT_DEPLOYED == '1'/);
  assert.match(workflow, /wrangler deploy --config \.\.\/cloudflare-prod\/wrangler\.jsonc/);
  assert.doesNotMatch(workflow, /DELETE FROM products|DELETE FROM customers|DELETE FROM sales/);
});
