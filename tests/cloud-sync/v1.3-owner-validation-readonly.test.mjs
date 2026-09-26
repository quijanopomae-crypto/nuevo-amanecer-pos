import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync('tools/cloudflare-prod/scripts/owner-validation-readonly.mjs','utf8');
const workflow = readFileSync('.github/workflows/v1.3-owner-validation-readonly.yml','utf8');

test('owner validation reads every CANON dataset required by Client Credit V2',()=>{
  assert.match(script,/\/read\/canonical\/status/);
  for (const route of ['products','customers','credits','credit-payments','credit-accounts']) {
    assert.ok(script.includes("readAll('" + route + "'"), 'missing route ' + route);
  }
  assert.match(script,/production products are empty/);
  assert.match(script,/production customers are empty/);
  assert.match(script,/production credits are empty/);
  assert.match(script,/credit read count differs from D1/);
  assert.match(script,/business state changed during readonly validation/);
});

test('validation does not contain business mutation commands or SQL writes',()=>{
  assert.doesNotMatch(script,/\/commands\//);
  assert.doesNotMatch(script,/INSERT\s+INTO/i);
  assert.doesNotMatch(script,/UPDATE\s+[A-Za-z_]/i);
  const deletes=[...script.matchAll(/DELETE\s+FROM\s+([A-Za-z_]+)/gi)].map(match=>match[1]).sort();
  assert.deepEqual(deletes,['auth_sessions','devices']);
});

test('temporary session is always cleaned and workflow is secret-backed',()=>{
  assert.match(script,/finally\s*\{/);
  assert.match(script,/DELETE FROM auth_sessions WHERE session_id=\?1/);
  assert.match(script,/DELETE FROM devices WHERE device_id=\?1/);
  assert.match(workflow,/POS_ACTIVATION_SECRET: \$\{\{ secrets\.POS_ACTIVATION_SECRET \}\}/);
  assert.match(workflow,/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(workflow,/ops\/v1\.3-owner-validation-trigger\.json/);
});
