import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration=readFileSync('infra/database/migrations/0019_canonical_debt_reconciliation.sql','utf8');
const canonical=readFileSync('tools/cloudflare-lab/src/a6-canonical.js','utf8');
const apply=readFileSync('tools/cloudflare-prod/scripts/debt-reconcile-apply.mjs','utf8');
const ownerValidation=readFileSync('tools/cloudflare-prod/scripts/owner-validation-readonly.mjs','utf8');

test('0019 keeps reconciliation additive and immutable',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS canonical_reconciliation_credits/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS canonical_credit_baseline_adjustments/);
  assert.match(migration,/reconciliation_credit_no_update/);
  assert.match(migration,/reconciliation_credit_no_delete/);
  assert.match(migration,/baseline_adjustment_no_update/);
  assert.match(migration,/baseline_adjustment_no_delete/);
  assert.match(migration,/delta_cents INTEGER NOT NULL CHECK\(typeof\(delta_cents\)='integer' AND delta_cents<0\)/);
  assert.doesNotMatch(migration,/UPDATE\s+(?:credits|live_credits)\b/i);
  assert.doesNotMatch(migration,/DELETE\s+FROM\s+(?:credits|live_credits|credit_payments|canonical_financial_events)\b/i);
});

test('effective credit balance preserves payment ledger and supports synthetic reconciliation credit',()=>{
  assert.match(migration,/base_opening_cents \+ b\.baseline_delta_cents AS opening_balance_cents/);
  assert.match(migration,/canonical_financial_events/);
  assert.match(migration,/FROM canonical_reconciliation_credits r/);
  assert.match(migration,/financial_event_credit_safe/);
  assert.match(canonical,/debtReconciliationSchemaAvailable/);
  assert.match(canonical,/canonical_reconciliation_credits/);
  assert.match(canonical,/Saldo conciliado CasaMarket/);
  assert.match(canonical,/debtReconciliationLedgerCount/);
  assert.match(canonical,/reconciliation_credits/);
});

test('production writer uses encrypted source and protects commercial ledgers',()=>{
  assert.match(apply,/openPayload\(trigger\)/);
  assert.match(apply,/target_count!==EXPECTED_COUNT/);
  assert.match(apply,/EXPECTED_TOTAL_CENTS = 2368495/);
  assert.match(apply,/\/commands\/customer\.create/);
  assert.match(apply,/canonical_reconciliation_credits/);
  assert.match(apply,/canonical_credit_baseline_adjustments/);
  assert.match(apply,/protected commercial ledgers changed during reconciliation/);
  for(const table of ['credit_payments','canonical_financial_events','cash_movements','canonical_expenses','sales','sale_items']){
    assert.ok(apply.includes(table),'missing protected ledger '+table);
  }
  for(const forbidden of ['ALCY STALIM','MISAEL','99999998','99999977']){
    assert.equal(apply.includes(forbidden),false,'PII must not be embedded in writer');
  }
});

test('readonly owner validation accepts reconciliation credits in authoritative read count',()=>{
  assert.match(ownerValidation,/reconciliationCreditCount/);
  assert.match(ownerValidation,/before\.import_credits \+ before\.live_credits \+ before\.reconciliation_credits/);
});
