import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const d1 = JSON.parse(readFileSync('tools/cloudflare-prod/wrangler.jsonc','utf8'));
const turso = JSON.parse(readFileSync('tools/cloudflare-prod/wrangler.turso-prod.jsonc','utf8'));
const workflow = readFileSync('.github/workflows/v1.3-turso-prod-cutover.yml','utf8');
const trigger = JSON.parse(readFileSync('ops/v1.3-turso-prod-cutover-trigger.json','utf8'));

test('Turso cutover keeps the same public production Worker identity', () => {
  assert.equal(d1.name, 'nuevo-amanecer-pos-prod');
  assert.equal(turso.name, 'nuevo-amanecer-pos-prod');
  assert.equal(turso.vars.RUNTIME_ENVIRONMENT, 'production');
  assert.equal(turso.vars.CANONICAL_RUNTIME_ENABLED, 'enabled');
  assert.equal(turso.vars.DB_PROVIDER, 'turso');
  assert.equal(Array.isArray(turso.d1_databases), false);
});

test('D1 config remains available as rollback source before repository finalization', () => {
  assert.equal(d1.d1_databases.length, 1);
  assert.equal(d1.d1_databases[0].database_name, 'nuevo-amanecer-prod-v2');
  assert.equal(d1.d1_databases[0].database_id, 'cf2c83d3-f187-472e-967b-0ad24be969eb');
});

test('cutover is one-shot owner authorized and tied to the validated candidate run', () => {
  assert.equal(trigger.action, 'CUTOVER_CANON_D1_TO_TURSO');
  assert.equal(trigger.owner_authorized, true);
  assert.equal(trigger.one_shot, true);
  assert.equal(trigger.candidate_run_id, 36782779872);
  assert.equal(trigger.no_live_sale, true);
  assert.match(workflow, /candidate_run_id!==36782779872/);
});

test('cutover requires zero D1 traffic, fresh backup and exact Turso parity before deploy', () => {
  const preflight=workflow.indexOf('D1 preflight must be zero-traffic and session-free');
  const backup=workflow.indexOf('Export fresh D1 production backup');
  const parity=workflow.indexOf('Prove fresh D1 equals Turso production candidate');
  const final=workflow.indexOf('Final D1 recheck immediately before provider switch');
  const deploy=workflow.indexOf('Switch active CANON Worker from D1 to Turso');
  assert.ok(preflight>=0 && backup>preflight && parity>backup && final>parity && deploy>final);
  assert.match(workflow, /--verify-existing/);
  assert.match(workflow, /CUTOVER_ACTIVE_SESSIONS:-/);
  assert.match(workflow, /v1\.3-turso-cutover/);
});

test('cutover never performs a business command or first live sale', () => {
  assert.doesNotMatch(workflow, /commands\/sale\.create/);
  assert.doesNotMatch(workflow, /first-live-sale\.mjs/);
  assert.doesNotMatch(workflow, /ops\/v1\.3-first-live-sale-trigger\.json/);
  assert.match(workflow, /TURSO_PROD_ACTIVE_ZERO_TRAFFIC=PASS/);
});

test('post-deploy verification covers production boundary auth and canonical reads', () => {
  assert.match(workflow, /TURSO_PROD_ACTIVE_HEALTH=PASS/);
  assert.match(workflow, /\/lab\/workspace\/status/);
  assert.match(workflow, /\/auth\/activate/);
  assert.match(workflow, /\/auth\/session/);
  assert.match(workflow, /\/read\/canonical\/status/);
  assert.match(workflow, /\/read\/canonical\/products\?limit=5/);
  assert.match(workflow, /\/read\/canonical\/customers\?limit=5/);
});

test('any failure after Turso deployment has an automatic D1 rollback path', () => {
  const deploy=workflow.indexOf('Switch active CANON Worker from D1 to Turso');
  const rollback=workflow.indexOf('Roll back active Worker to D1 on post-deploy failure');
  assert.ok(deploy>=0 && rollback>deploy);
  assert.match(workflow, /failure\(\) && env\.TURSO_CUTOVER_DEPLOYED == '1'/);
  assert.match(workflow, /wrangler deploy --config \.\.\/cloudflare-prod\/wrangler\.jsonc/);
  assert.match(workflow, /cutover-prepare\.mjs probe-worker/);
});
