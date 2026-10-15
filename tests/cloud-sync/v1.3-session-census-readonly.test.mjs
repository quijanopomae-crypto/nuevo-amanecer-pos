import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync('tools/cloudflare-prod/scripts/session-census-readonly.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/v1.3-session-census-readonly.yml', 'utf8');

test('census contains no business mutation commands or SQL writes', () => {
  assert.doesNotMatch(script, /\/commands\//);
  assert.doesNotMatch(script, /INSERT\s+INTO/i);
  assert.doesNotMatch(script, /UPDATE\s+[A-Za-z_]/i);
  assert.doesNotMatch(script, /DELETE\s+FROM/i);
});

test('census never activates or creates a session', () => {
  assert.doesNotMatch(script, /\/auth\/activate/);
  assert.doesNotMatch(script, /session_token/);
  assert.doesNotMatch(script, /x-activation-secret/);
  assert.doesNotMatch(script, /POS_ACTIVATION_SECRET/);
});

test('census only issues SELECT or PRAGMA statements', () => {
  const stmts = [...script.matchAll(/query\([^,]+,\s*\n?\s*['"]([A-Za-z]+)/g)].map(m => m[1].toUpperCase());
  assert.ok(stmts.length > 0, 'no query statements detected');
  for (const verb of stmts) {
    assert.ok(['SELECT', 'PRAGMA'].includes(verb), 'non-readonly verb: ' + verb);
  }
});

test('census reads the required tables', () => {
  assert.match(script, /FROM canonical_control WHERE id=1/);
  assert.match(script, /FROM auth_sessions/);
  assert.match(script, /FROM devices/);
  for (const table of ['sales', 'sale_items', 'cash_movements', 'inventory_movements', 'sync_operations', 'canonical_financial_operations']) {
    assert.ok(script.includes('FROM ' + table), 'missing traffic table ' + table);
  }
});

test('census classifies sessions by status and time bounds', () => {
  assert.match(script, /GROUP BY status/);
  assert.match(script, /MIN\(created_at\)/);
  assert.match(script, /MAX\(created_at\)/);
  assert.match(script, /PRAGMA table_info/);
});

test('census emits the sanitized pass contract', () => {
  assert.match(script, /SESSION_CENSUS_READONLY_PASS/);
  assert.match(script, /commercial_traffic_zero/);
  assert.match(script, /active_sessions_explained/);
});

test('workflow is read-only and secret-backed', () => {
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /POS_ACTIVATION_SECRET/);
  assert.match(workflow, /ops\/v1\.3-session-census-trigger\.json/);
});
