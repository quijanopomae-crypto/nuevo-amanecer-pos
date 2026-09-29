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

test('failed production preflight prints enough read-only evidence to identify exact D1 drift', () => {
  for (const marker of [
    'observed_migrations',
    'missing_migrations',
    'missing_schema_objects',
    'missing_customer_registry_fks',
    'v17_residue_objects',
  ]) {
    assert.ok(workflow.includes(marker), 'missing diagnostic marker ' + marker);
  }
  assert.match(workflow, /console\.log\(JSON\.stringify\(result\)\)/);
});

test('production preflight identifies the effective schema status of migrations 0014 through 0017', () => {
  for (const marker of [
    'migration_schema_status',
    'canonical_product_operations',
    'canonical_live_products',
    'canonical_inventory_operations',
    'canonical_manual_inventory_movements',
    'canonical_generic_sale_lines',
    'canonical_customer_operations',
    'canonical_customer_registry',
    'canonical_live_customers',
  ]) {
    assert.ok(workflow.includes(marker), 'missing effective migration schema marker ' + marker);
  }
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


test('production read-only preflight proves customer credit policy 0018 without mutating D1', () => {
  assert.ok(workflow.includes('0018_canonical_customer_credit_policy.sql'));
  for (const marker of [
    'canonical_customer_credit_policy_operations',
    'canonical_customer_credit_policies',
    'customer_credit_policy_operation_authorized_insert',
    'customer_credit_policy_operations_no_update',
    'customer_credit_policy_operations_no_delete',
    'customer_credit_policy_insert_guard',
    'customer_credit_policy_update_guard',
    'customer_credit_policy_no_delete',
    'missing_customer_credit_policy_fks',
    'migration_0018_readonly_proof',
  ]) assert.ok(workflow.includes(marker), 'missing 0018 read-only proof marker ' + marker);
});
