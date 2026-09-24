import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync('tools/cloudflare-prod/scripts/first-live-sale.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/v1.3-first-live-sale.yml', 'utf8');

test('first-live finalizer is fail-closed and only auto-selects non-inventory products', () => {
  assert.match(script, /tracks_inventory=0/);
  assert.match(script, /MAX_CANARY_CENTS = 10000/);
  assert.match(script, /no_safe_non_inventory_candidate/);
  assert.doesNotMatch(script, /INSERT INTO products|DELETE FROM products/);
  assert.match(script, /price_cents>0/);
});

test('technical canary uses actual candidate price and does not create inventory movements', () => {
  assert.match(script, /unit_price_cents: total/);
  assert.match(script, /line_total_cents: total/);
  assert.match(script, /Number\(candidate\.price_cents\)/);
  assert.match(script, /V13-TECH-CANARY-/);
  assert.match(script, /inventory_movements !== 0/);
  assert.match(script, /technical canary changed inventory/);
});

test('first-live finalizer validates idempotency and canonical first-live marker', () => {
  assert.match(script, /first live marker mismatch/);
  assert.match(script, /status !== 'already_processed'/);
  assert.match(script, /idempotent !== true/);
  assert.match(script, /canonical_write_guards/);
  assert.match(script, /sale context mismatch/);
});

test('first-live finalizer revokes the temporary writer session', () => {
  assert.match(script, /UPDATE auth_sessions SET status='revoked'/);
  assert.match(script, /UPDATE devices SET status='revoked'/);
  assert.match(script, /active_sessions !== 0/);
});

test('release workflow tags only after the first-live validation and stores private evidence', () => {
  const validate = workflow.indexOf('Execute or validate first live CANON sale');
  const manifest = workflow.indexOf('Store final validation manifest in private R2');
  const tag = workflow.indexOf('Create immutable V1.3 production tag');
  assert.ok(validate >= 0 && manifest > validate && tag > manifest);
  assert.match(workflow, /v1\.3-production/);
  assert.match(workflow, /v1\.2-production/);
  assert.match(workflow, /ops\/v1\.3-first-live-sale-trigger\.json/);
  assert.doesNotMatch(workflow, /force|--force/);
});
