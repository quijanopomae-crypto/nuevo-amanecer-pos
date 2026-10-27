import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(f,'utf8');

test('AUTO-DEV CI is the only release-required workflow on PR and CANON push', () => {
  const txt=read('.github/workflows/auto-dev-ci.yml');
  const trigger=txt.slice(txt.indexOf('on:'),txt.indexOf('permissions:'));
  assert.match(trigger,/pull_request:/);
  assert.match(trigger,/push:/);
  assert.doesNotMatch(trigger,/paths:/);
  assert.match(trigger,/feature\/v1\.3-mobile-cloud/);
  for (const key of ['validate','critical-regression','e2e-smoke']) assert.match(txt,new RegExp('  '+key+':'));
});

test('E2E is omitted for UI/WORK but full regression remains for critical risk', () => {
  const txt=read('.github/workflows/auto-dev-ci.yml');
  const e2e=txt.split('  e2e-smoke:')[1]?.split('  publish-web:')[0] || '';
  assert.match(e2e,/tools\/ci\/change-impact\.mjs/);
  assert.match(e2e,/No browser E2E for visual or isolated WORK changes/);
  assert.doesNotMatch(e2e,/Run targeted browser tests for ordinary changes/);
  assert.match(e2e,/name: Setup Node inside Playwright container\n        if: steps\.impact\.outputs\.level == 'critical'/);
  assert.match(e2e,/name: Install reproducible dependencies\n        if: steps\.impact\.outputs\.level == 'critical'\n        run: npm ci --no-audit --no-fund/);
  assert.match(e2e,/name: Run complete regression for critical commercial or pipeline changes\n        if: steps\.impact\.outputs\.level == 'critical'\n        run: npx playwright test --workers=2/);
  assert.match(e2e,/!cancelled\(\) && steps\.impact\.outputs\.level == 'critical'/);
  assert.match(txt,/needs: \[validate, critical-regression, e2e-smoke\]/);
  assert.doesNotMatch(e2e,/npx playwright install --with-deps chromium/);
});

test('full browser suite remains available independently without holding normal releases', () => {
  const txt=read('.github/workflows/e2e-full-regression.yml');
  assert.match(txt,/workflow_dispatch:/);
  assert.match(txt,/schedule:/);
  assert.match(txt,/npx playwright test --workers=2/);
  assert.doesNotMatch(txt,/pull_request:/);
});

test('DIRECT deploy is one AUTO-DEV push job gated by all 3 checks and exact SHA', () => {
  const txt=read('.github/workflows/auto-dev-ci.yml');
  assert.match(txt,/publish-web:/);
  assert.match(txt,/needs: \[validate, critical-regression, e2e-smoke\]/);
  assert.match(txt,/github.event_name == 'push'/);
  assert.match(txt,/git rev-parse origin\/feature\/v1\.3-mobile-cloud/);
  assert.match(txt,/web-release.mjs verify-direct/);
  assert.match(txt,/if: steps.release_gate.outputs.eligible == 'true'/);
  assert.match(txt,/Record current Cloudflare deployment for recovery/);
  assert.match(txt,/wrangler rollback --message/);
  assert.match(txt,/POS_TARGET_SHA/);
  assert.match(txt,/Verify public launcher and POS assets/);
});
test('legacy manifest path remains manual only and cannot compete with AUTO-DEV',()=>{
  const txt=read('.github/workflows/v1.3-pos-web-deploy.yml');
  const on=txt.slice(txt.indexOf('on:'),txt.indexOf('permissions:'));
  assert.match(on,/workflow_dispatch:/);
  assert.doesNotMatch(on,/workflow_run:/);
  assert.doesNotMatch(on,/push:/);
  assert.match(txt,/web-release.mjs verify/);
});

