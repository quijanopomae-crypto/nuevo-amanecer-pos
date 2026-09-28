import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../../tools/cloudflare-lab/src/worker.js';

function env(environment) {
  return {
    RUNTIME_ENVIRONMENT: environment,
    DB: {
      prepare(sql) {
        assert.match(sql, /SELECT 1 AS one/);
        return { async first() { return { one: 1 }; } };
      }
    }
  };
}

test('health exposes distinct LAB, STAGING and production identities', async () => {
  for (const [environment, service] of [
    ['lab','nuevo-amanecer-sync-lab'],
    ['staging','nuevo-amanecer-pos-staging'],
    ['production','nuevo-amanecer-pos-prod'],
  ]) {
    const response = await worker.fetch(new Request('https://example.test/health'), env(environment));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.environment, environment);
    assert.equal(body.service, service);
    assert.equal(body.d1, 'ok');
  }
});

test('unknown runtime environment fails health closed', async () => {
  const response = await worker.fetch(new Request('https://example.test/health'), env('mystery'));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'invalid_runtime_environment');
});

test('LAB workspace is hidden in STAGING and production', async () => {
  for (const environment of ['staging','production']) {
    const response = await worker.fetch(new Request('https://example.test/lab/workspace'), env(environment));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error:'not_found' });
  }
});

test('active Wrangler configs declare explicit environment identity', () => {
  const lab = JSON.parse(readFileSync('tools/cloudflare-lab/wrangler.jsonc','utf8'));
  const staging = JSON.parse(readFileSync('tools/cloudflare-staging/wrangler.backend.template.jsonc','utf8'));
  assert.equal(lab.vars.RUNTIME_ENVIRONMENT,'lab');
  assert.equal(staging.vars.RUNTIME_ENVIRONMENT,'staging');
  assert.equal(staging.vars.DATA_POLICY,'synthetic-only');
});
