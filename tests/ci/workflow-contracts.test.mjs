import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(f,'utf8');

test('all three exact-SHA release checks run on every pull request and on CANON push', () => {
  for (const path of ['e2e-smoke-ci.yml','canon-critical-ci.yml','opencode-config-ci.yml']) {
    const txt=read('.github/workflows/'+path);
    const trigger=txt.slice(txt.indexOf('on:'),txt.indexOf('permissions:'));
    assert.match(trigger,/pull_request:/,path);
    assert.match(trigger,/push:/,path);
    assert.doesNotMatch(trigger,/paths:/,path);
    assert.match(trigger,/feature\/v1\.3-mobile-cloud/,path);
  }
});

test('smoke has selected tests, commercial full path and reproducible dependencies', () => {
  const txt=read('.github/workflows/e2e-smoke-ci.yml');
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
  assert.match(txt,/web-release.mjs verify/);
  assert.match(txt,/Record current Cloudflare deployment for recovery/);
  assert.match(txt,/ops\/v1\.3-pos-web-deploy-trigger.json/);
  assert.match(txt,/if: steps.release_gate.outputs.eligible == 'true'/);
});
