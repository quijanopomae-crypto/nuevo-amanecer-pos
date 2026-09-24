import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workerFixture } from './worker-fixture.mjs';

const prodConfig = readFileSync('tools/cloudflare-prod/wrangler.jsonc', 'utf8');
const setupHtml = readFileSync('tools/pos-local/setup.html', 'utf8');
const setupJs = readFileSync('tools/pos-local/setup.js', 'utf8');
const workerSource = readFileSync('tools/cloudflare-lab/src/worker.js', 'utf8');
const cutoverScript = readFileSync('tools/cloudflare-prod/scripts/cutover-prepare.mjs', 'utf8');
const cutoverWorkflow = readFileSync('.github/workflows/v1.3-prod-cutover.yml', 'utf8');

test('production worker config is isolated from LAB and points only to production D1', () => {
  const config = JSON.parse(prodConfig);
  assert.equal(config.name, 'nuevo-amanecer-pos-prod');
  assert.equal(config.vars.RUNTIME_ENVIRONMENT, 'production');
  assert.equal(config.vars.CANONICAL_RUNTIME_ENABLED, 'enabled');
  assert.equal(config.d1_databases.length, 1);
  assert.equal(config.d1_databases[0].database_name, 'nuevo-amanecer-prod-v2');
  assert.equal(config.d1_databases[0].database_id, 'cf2c83d3-f187-472e-967b-0ad24be969eb');
  assert.equal(config.d1_databases[0].binding, 'nuevo_amanecer_lab');
  assert.equal(prodConfig.includes('e734e6f1-41c4-4bfa-ab1f-5acbcdd2272e'), false);
});

test('local V1.3 setup activates against production and derives canonical binding from live authority', () => {
  assert.match(setupHtml, /clave de activación V1\.3/i);
  assert.match(setupHtml, /canonical-client\.js/);
  assert.match(setupJs, /nuevo-amanecer-pos-prod\.nuevo-amanecer-pos\.workers\.dev/);
  assert.match(setupJs, /\/auth\/activate/);
  assert.match(setupJs, /\/read\/canonical\/status/);
  assert.match(setupJs, /NuevoAmanecerCanonical\.configure/);
  assert.match(setupJs, /NuevoAmanecerCanonical\.refresh/);
  assert.doesNotMatch(setupJs, /x-sync-token|SYNC_TOKEN|nuevo-amanecer-sync-lab/);
});

test('production runtime explicitly hides LAB workspace routes', async t => {
  const f = workerFixture();
  t.after(() => f.close());
  f.env.RUNTIME_ENVIRONMENT = 'production';
  f.env.CANONICAL_RUNTIME_ENABLED = 'enabled';

  const response = await f.fetch('https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev/lab/workspace/status');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
});

test('production health identity is distinct from LAB', async t => {
  const f = workerFixture();
  t.after(() => f.close());
  f.env.RUNTIME_ENVIRONMENT = 'production';
  const response = await f.fetch('https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev/health');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'nuevo-amanecer-pos-prod');
});

test('source contains an explicit production boundary instead of relying only on config', () => {
  assert.match(workerSource, /env\.RUNTIME_ENVIRONMENT === 'production'/);
  assert.match(workerSource, /isLabWorkspace/);
});


test('cutover workflow requires backup and rehearsal before production migration', () => {
  const backup = cutoverWorkflow.indexOf('Export fresh production backup');
  const rehearsal = cutoverWorkflow.indexOf('Verify rehearsal after migrations');
  const recheck = cutoverWorkflow.indexOf('Recheck production before mutation');
  const productionMigration = cutoverWorkflow.indexOf('Apply 0010 and 0011 to production');
  const deploy = cutoverWorkflow.indexOf('Deploy isolated production Worker');
  const finalGate = cutoverWorkflow.indexOf('Final READY_FOR_FIRST_SALE verification');
  assert.ok(backup >= 0 && rehearsal > backup && recheck > rehearsal && productionMigration > recheck && deploy > productionMigration && finalGate > deploy);
  assert.match(cutoverWorkflow, /ops\/v1\.3-production-cutover-trigger\.json/);
  assert.match(cutoverWorkflow, /POS_ACTIVATION_SECRET: \$\{\{ secrets\.POS_ACTIVATION_SECRET \}\}/);
  assert.doesNotMatch(cutoverWorkflow, /commands\/sale\.create/);
});

test('cutover helper fails closed before first live sale and never embeds secrets', () => {
  assert.match(cutoverScript, /first live operation already exists/);
  assert.match(cutoverScript, /unexpected pre-cutover traffic/);
  assert.match(cutoverScript, /production authority changed during rehearsal/);
  assert.match(cutoverScript, /READY_FOR_FIRST_SALE/);
  assert.match(cutoverScript, /probe session delete/);
  assert.doesNotMatch(cutoverScript, /sk-[A-Za-z0-9_-]+|Bearer [A-Za-z0-9_-]{16,}/);
});
