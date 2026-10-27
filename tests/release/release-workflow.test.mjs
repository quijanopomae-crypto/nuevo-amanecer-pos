import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(p,'utf8');
test('one AUTO-DEV CI validates the exact CANON merge SHA',()=>{
  const text=read('.github/workflows/auto-dev-ci.yml');
  const push=text.split('  push:')[1]?.split(/\n(?:  [a-z_]+:|permissions:)/)[0];
  assert.match(push||'',/feature\/v1\.3-mobile-cloud/);
  assert.doesNotMatch(push,/paths:/);
  for(const job of ['validate:','critical-regression:','e2e-smoke:'])
    assert.ok(text.includes('  '+job),'missing required '+job);
});
test('deployment preserves Git ancestry and executes gate before deployment',()=>{
 const text=read('.github/workflows/v1.3-pos-web-deploy.yml');
 assert.match(text,/fetch-depth: 0/);assert.doesNotMatch(text,/--depth=1/);
 assert.ok(text.indexOf('web-release.mjs verify')<text.indexOf('- name: Deploy hosted POS'));
 assert.match(text,/Record current Cloudflare deployment for recovery/);
 assert.match(text,/actions: read/);
});
