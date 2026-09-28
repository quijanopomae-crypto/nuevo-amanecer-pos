import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync('tools/cloudflare-pos-web/src/worker.js','utf8');
const prod = JSON.parse(readFileSync('tools/cloudflare-pos-web/wrangler.jsonc','utf8'));
const staging = JSON.parse(readFileSync('tools/cloudflare-staging/wrangler.web.template.jsonc','utf8'));
const launcher = readFileSync('tools/cloudflare-pos-web/public/activate.js','utf8');
const guard = readFileSync('POS/js/sync/hosted-canonical-guard.js','utf8');
const client = readFileSync('POS/js/sync/canonical-client.js','utf8');
const app = readFileSync('POS/index.html','utf8');
const root = readFileSync('tools/cloudflare-pos-web/public/index.html','utf8');

const PROD_API = 'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev';
const STAGING_API = 'https://nuevo-amanecer-pos-staging.nuevo-amanecer-pos.workers.dev';

test('web environments expose separate non-secret runtime endpoints', () => {
  assert.equal(prod.vars.HOSTED_ENVIRONMENT,'production');
  assert.equal(prod.vars.CANON_API_ORIGIN,PROD_API);
  assert.equal(staging.vars.HOSTED_ENVIRONMENT,'staging');
  assert.equal(staging.vars.CANON_API_ORIGIN,STAGING_API);
  assert.notEqual(prod.vars.CANON_API_ORIGIN,staging.vars.CANON_API_ORIGIN);
});

test('shared POS and launcher assets contain no production API endpoint', () => {
  for (const [name,source] of [['activate',launcher],['guard',guard],['client',client]]) {
    assert.equal(source.includes(PROD_API),false,name+' hardcodes PROD API');
  }
});

test('runtime config is served fail-closed and no-store', () => {
  assert.match(worker,/url\.pathname === '\/runtime-config\.js'/);
  assert.match(worker,/HOSTED_ENVIRONMENT/);
  assert.match(worker,/CANON_API_ORIGIN/);
  assert.match(worker,/NA_HOSTED_CONFIG_INVALID/);
  assert.match(worker,/Cache-Control', 'no-store, max-age=0, must-revalidate'/);
  assert.match(worker,/globalThis\.NA_HOSTED_CONFIG=Object\.freeze/);
});

test('launcher and hosted POS load config before environment-dependent code', () => {
  assert.ok(root.indexOf('/runtime-config.js') < root.indexOf('/activate.js'));
  assert.ok(app.indexOf('/runtime-config.js') < app.indexOf('hosted-canonical-guard.js'));
});

test('hosted guard fails closed when config is absent or invalid', () => {
  assert.match(guard,/naHostedCanon = 'config-error'/);
  assert.match(guard,/location\.replace\(root\.location\.origin \+ '\/'\)/);
  assert.match(guard,/\['production', 'staging'\]/);
});

test('canonical client trusts hosted endpoint from config, not a production hostname constant', () => {
  assert.match(client,/HOSTED_API_ORIGIN/);
  assert.match(client,/url\.origin === HOSTED_API_ORIGIN/);
  assert.match(client,/nuevo-amanecer-sync-lab/);
  assert.equal(client.includes(PROD_API),false);
});
