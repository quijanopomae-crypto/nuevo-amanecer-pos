import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync('tools/cloudflare-pos-web/wrangler.jsonc', 'utf8');
const launcher = readFileSync('tools/cloudflare-pos-web/public/index.html', 'utf8');
const activation = readFileSync('tools/cloudflare-pos-web/public/activate.js', 'utf8');
const workflow = readFileSync('.github/workflows/v1.3-pos-web-deploy.yml', 'utf8');
const router = readFileSync('tools/cloudflare-pos-web/src/worker.js', 'utf8');

test('hosted POS uses explicit Worker routing with a stable workers.dev name', () => {
  assert.match(config, /"name": "nuevo-amanecer-pos-web"/);
  assert.match(config, /"main": "\.\/src\/worker\.js"/);
  assert.match(config, /"directory": "\.\/_site"/);
  assert.match(config, /"binding": "ASSETS"/);
  assert.match(config, /"run_worker_first": \["\/", "\/app", "\/app\/"\]/);
  assert.match(config, /"html_handling": "none"/);
  assert.match(config, /"workers_dev": true/);
});

test('launcher requires browser activation and never embeds the activation secret', () => {
  assert.match(launcher, /Clave de activación/);
  assert.match(activation, /x-activation-secret/);
  assert.match(activation, /nuevo-amanecer-pos-prod\.nuevo-amanecer-pos\.workers\.dev/);
  assert.match(activation, /na_canonical_binding/);
  assert.match(activation, /na_cloud_sync_credentials/);
  assert.doesNotMatch(launcher + activation, /POS_ACTIVATION_SECRET|sk-[A-Za-z0-9_-]{20,}/);
});

test('launcher stores the current canonical authority only after authenticated probes', () => {
  const sessionProbe = activation.indexOf("'/auth/session'");
  const statusProbe = activation.indexOf("'/read/canonical/status'");
  const save = activation.indexOf('saveSession(');
  assert.ok(sessionProbe >= 0 && statusProbe > sessionProbe);
  assert.ok(save >= 0);
  assert.match(activation, /body\.mode !== 'ACTIVE'/);
  assert.match(activation, /body\.authority !== 'canonical'/);
});

test('deployment assembles canonical POS under app and verifies the public URL', () => {
  assert.match(workflow, /cp -a POS\/\. tools\/cloudflare-pos-web\/_site\/app\//);
  assert.match(workflow, /nuevo-amanecer-pos-web\.nuevo-amanecer-pos\.workers\.dev/);
  assert.match(workflow, /npx wrangler deploy --config \.\.\/cloudflare-pos-web\/wrangler\.jsonc/);
  assert.match(workflow, /HOSTED_POS_WEB_PASS/);
  assert.match(workflow, /Local server required: NO/);
});

test('deploy workflow does not expose the production activation secret', () => {
  assert.doesNotMatch(workflow, /POS_ACTIVATION_SECRET/);
  assert.doesNotMatch(workflow, /x-activation-secret/);
});

test('hosted POS router maps root and app entrypoints to exact HTML assets', () => {
  assert.match(router, /url\.pathname === '\/'/);
  assert.match(router, /assetUrl\.pathname = '\/index\.html'/);
  assert.match(router, /url\.pathname === '\/app'/);
  assert.match(router, /url\.pathname === '\/app\/'/);
  assert.match(router, /assetUrl\.pathname = '\/app\/index\.html'/);
  assert.match(router, /env\.ASSETS\.fetch/);
});
