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

test('smoke has selected tests, commercial full path and reproducible dependencies', () => {
  const txt=read('.github/workflows/auto-dev-ci.yml');
  assert.match(txt,/tools\/ci\/change-impact\.mjs/);
  assert.match(txt,/level == 'critical'/);
  assert.match(txt,/npx playwright test --workers=2/);
  assert.match(txt,/tests\/e2e\/stock-negativo.spec.ts/);
  assert.match(txt,/npm ci --no-audit --no-fund/);
  assert.doesNotMatch(txt,/npx playwright install --with-deps chromium/);
});

test('full browser suite remains available independently without holding normal releases', () => {
  const txt=read('.github/workflows/e2e-full-regression.yml');
  assert.match(txt,/workflow_dispatch:/);
  assert.match(txt,/schedule:/);
  assert.match(txt,/npx playwright test --workers=2/);
  assert.doesNotMatch(txt,/pull_request:/);
});

test('deploy triggers on green trusted canonical push, rejects outdated HEAD and retains legacy manifest', () => {
  const txt=read('.github/workflows/v1.3-pos-web-deploy.yml');
  assert.match(txt,/workflow_run:/);
  assert.match(txt,/github.event.workflow_run.event == 'push'/);
  assert.match(txt,/head_repository.full_name == github.repository/);
  assert.match(txt,/git rev-parse origin\/feature\/v1\.3-mobile-cloud/);
  assert.match(txt,/web-release.mjs verify-auto/);
  assert.match(txt,/POS_TARGET_SHA=\$\(git rev-parse HEAD\)/);
  assert.match(txt,/\$POS_TARGET_SHA/);
  assert.match(txt,/web-release.mjs verify/);
  assert.match(txt,/Record current Cloudflare deployment for recovery/);
  assert.match(txt,/ops\/v1\.3-pos-web-deploy-trigger.json/);
  assert.match(txt,/if: steps.release_gate.outputs.eligible == 'true'/);
});
