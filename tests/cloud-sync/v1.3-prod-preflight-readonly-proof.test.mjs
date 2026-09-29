import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/v1.3-prod-preflight.yml','utf8');

test('production read-only preflight proves migrations 0014 through 0017 and D1 integrity', () => {
  for (const migration of [
    '0014_canonical_live_products.sql',
    '0015_canonical_inventory_adjust.sql',
    '0016_canonical_generic_sale_lines.sql',
    '0017_canonical_live_customers.sql',
  ]) {
    assert.ok(workflow.includes(migration), 'missing migration proof for ' + migration);
  }

  assert.match(workflow, /d1_migrations/);
  assert.match(workflow, /PRAGMA quick_check/i);
  assert.match(workflow, /PRAGMA foreign_key_check/i);
  assert.match(workflow, /sqlite_master/);
  assert.match(workflow, /__v17/);

  for (const objectName of [
    'canonical_customer_operations',
    'canonical_customer_registry',
    'canonical_live_customers',
    'canonical_sale_context',
    'live_credits',
    'canonical_credit_accounts',
    'canonical_credit_metadata',
  ]) {
    assert.ok(workflow.includes(objectName), 'missing schema proof for ' + objectName);
  }

  assert.match(workflow, /migration_0017_readonly_proof/);
  assert.match(workflow, /read_only_preflight/);
});

test('production D1 preflight contains no SQL business or schema mutation', () => {
  assert.doesNotMatch(workflow, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(workflow, /\bUPDATE\s+[A-Za-z_]/i);
  assert.doesNotMatch(workflow, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(workflow, /\bDROP\s+(?:TABLE|VIEW|TRIGGER|INDEX)\b/i);
  assert.doesNotMatch(workflow, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(workflow, /\bCREATE\s+(?:TABLE|VIEW|TRIGGER|INDEX)\b/i);
  assert.doesNotMatch(workflow, /wrangler\s+d1\s+(?:execute|migrations\s+apply)/i);
});
