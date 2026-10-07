import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/staging-deploy.yml','utf8');
const seed = readFileSync('tools/cloudflare-staging/synthetic-seed.sql','utf8');
const contract = JSON.parse(readFileSync('tools/cloudflare-staging/environment-contract.json','utf8'));
const render = readFileSync('tools/cloudflare-staging/scripts/render-backend-config.mjs','utf8');

test('staging deployment is owner-triggered and serialized outside production', () => {
  assert.match(workflow,/ops\/staging-deploy-trigger\.json/);
  assert.match(workflow,/authorized_by !== "owner"/);
  assert.match(workflow,/requested_action !== "deploy-staging"/);
  assert.match(workflow,/STAGING_TARGET_HEAD="\$\(node <<'NODE'/);
  assert.match(workflow,/process\.stdout\.write\(t\.target_head\)/);
  assert.match(workflow,/echo "STAGING_TARGET_HEAD=\$STAGING_TARGET_HEAD" >> "\$GITHUB_ENV"/);
  assert.match(workflow,/git merge-base --is-ancestor "\$STAGING_TARGET_HEAD" "\$GITHUB_SHA"/);
  assert.match(workflow,/group: nuevo-amanecer-staging-change/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.doesNotMatch(workflow,/workflow_dispatch:/);
  assert.equal(contract.deploy_requires_authorized_trigger,true);
});

test('staging workflow names only isolated remote resources', () => {
  for (const expected of [
    'nuevo-amanecer-staging',
    'nuevo-amanecer-staging-artifacts',
    'nuevo-amanecer-pos-staging.nuevo-amanecer-pos.workers.dev',
    'nuevo-amanecer-pos-web-staging.nuevo-amanecer-pos.workers.dev'
  ]) assert.match(workflow,new RegExp(expected.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')));

  for (const forbidden of [
    'cf2c83d3-f187-472e-967b-0ad24be969eb',
    'e734e6f1-41c4-4bfa-ab1f-5acbcdd2272e',
    'nuevo-amanecer-prod-v2',
    'nuevo-amanecer-prod-v2-backups',
    'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev',
    'https://nuevo-amanecer-pos-web.nuevo-amanecer-pos.workers.dev'
  ]) assert.equal(workflow.includes(forbidden),false,'workflow references forbidden resource '+forbidden);
});

test('staging provisioning is idempotent and renders an exact isolated D1 config', () => {
  assert.match(workflow,/\/d1\/database\?per_page=100/);
  assert.match(workflow,/\/r2\/buckets\?per_page=100/);
  assert.match(workflow,/render-backend-config\.mjs/);
  assert.match(render,/STAGING_D1_DATABASE_ID/);
  assert.match(render,/nuevo-amanecer-pos-staging/);
  assert.match(render,/nuevo-amanecer-staging/);
  assert.match(render,/DATA_POLICY/);
});

test('staging canonical bootstrap is synthetic-only and restores production-grade guard', () => {
  assert.doesNotMatch(seed,/\bBEGIN(?:\s+IMMEDIATE|\s+TRANSACTION)?\b/i);
  assert.doesNotMatch(seed,/\bCOMMIT\b/i);
  assert.match(seed,/staging-synthetic-promotion-v1/);
  assert.match(seed,/Producto Sintético/);
  assert.match(seed,/Cliente Sintético/);
  assert.doesNotMatch(seed,/MERY|MISAEL|JOSY|70000001/i);
  assert.match(workflow,/trap restore_guard EXIT/);
  assert.match(workflow,/0013_canonical_expenses\.sql/);
  assert.match(workflow,/guard_restored/);
  assert.match(workflow,/mode='ACTIVE'/);
});

test('staging activation secret is generated, masked, and never sourced from production secret', () => {
  assert.match(workflow,/openssl rand -hex 32/);
  assert.match(workflow,/::add-mask::\$SECRET/);
  assert.match(workflow,/wrangler secret put POS_ACTIVATION_SECRET/);
  assert.doesNotMatch(workflow,/secrets\.POS_ACTIVATION_SECRET/);
});

test('staging smoke tolerates bounded activation-secret edge propagation and still fails closed', () => {
  assert.match(workflow,/for activate_attempt in \$\(seq 1 20\); do/);
  assert.match(workflow,/STAGING_ACTIVATION_READY attempt=\$activate_attempt/);
  assert.match(workflow,/STAGING activation secret propagation failed status=\$ACTIVATE_CODE/);
  assert.match(workflow,/test "\$ACTIVATE_CODE" = "200"/);
  assert.match(workflow,/typeof x\.session_token!=="string"/);
});

test('staging smoke proves canonical reads, LAB-route isolation, runtime config and R2', () => {
  assert.match(workflow,/read\/canonical\/status/);
  assert.match(workflow,/read\/canonical\/products/);
  assert.match(workflow,/read\/canonical\/customers/);
  assert.match(workflow,/LAB_CODE/);
  assert.match(workflow,/runtime-config\.js/);
  assert.match(workflow,/environment.*staging/);
  assert.match(workflow,/staging-runtime-config\.js/);
  assert.match(workflow,/for web_attempt in \$\(seq 1 20\)/);
  assert.match(workflow,/STAGING web propagation\/smoke failed/);
  assert.match(workflow,/\$STAGING_WEB_URL\/health/);
  assert.match(workflow,/for proxy_attempt in \$\(seq 1 20\)/);
  assert.match(workflow,/STAGING_WEB_PROXY_READY/);
  assert.match(workflow,/STAGING same-origin proxy propagation failed/);
  assert.match(workflow,/\$STAGING_WEB_URL\/auth\/session/);
  assert.match(workflow,/\$STAGING_WEB_URL\/read\/canonical\/status/);
  assert.match(workflow,/ROOT_CODE=.*staging-root\.html.*http_code.*STAGING_WEB_URL/);
  assert.match(workflow,/APP_CODE=.*staging-app\.html.*http_code.*STAGING_WEB_URL/);
  assert.ok(workflow.includes('test "$ROOT_CODE" = "200"'));
  assert.ok(workflow.includes('test "$APP_CODE" = "200"'));
  assert.match(workflow,/grep -Fq "Nuevo Amanecer POS" \/tmp\/staging-root\.html/);
  assert.match(workflow,/grep -Fq "Nuevo Amanecer — ERP &amp; POS" \/tmp\/staging-app\.html/);
  assert.doesNotMatch(workflow,/\$STAGING_WEB_URL\/.*\| grep -Fq/);
  assert.match(workflow,/r2 object put/);
});
