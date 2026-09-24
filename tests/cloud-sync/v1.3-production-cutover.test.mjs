import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workerFixture } from './worker-fixture.mjs';

const prodConfig = readFileSync('tools/cloudflare-prod/wrangler.jsonc', 'utf8');
const setupHtml = readFileSync('tools/pos-local/setup.html', 'utf8');
const setupJs = readFileSync('tools/pos-local/setup.js', 'utf8');
const workerSource = readFileSync('tools/cloudflare-lab/src/worker.js', 'utf8');

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
  assert.match(setupHtml, /Clave de activación V1\.3/);
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
