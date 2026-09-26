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


test('financial revision zero is valid before first live operation',()=>{
  assert.ok(script.includes('Number(status.financial_revision) < 0'));
  assert.ok(!script.includes('Number(status.financial_revision) <= 0'));
});


test('ACTIVE canonical reads follow authority read_only semantics',()=>{
  assert.ok(script.includes("typeof page.read_only !== 'boolean'"));
  assert.ok(script.includes("page.read_only !== (page.mode !== 'ACTIVE')"));
  assert.ok(!script.includes("page.read_only !== true"));
});


test('public credit identity uses provenance plus credit_id',()=>{
  assert.ok(script.includes("String(row.provenance || 'IMPORT') + ':' + String(row.credit_id || '')"));
  assert.ok(script.includes("duplicate credit identities"));
  assert.ok(!script.includes("duplicate credit read keys"));
});
