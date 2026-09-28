# CANON Credit Payment Bridge

## Objective

Connect the existing **Registrar pago** flow in the CANON Clients/Credits UI to the already-authoritative `payment.create` command so credit payments persist in Worker/D1 instead of attempting legacy `saveAllData()`.

This task does not change commercial rules. It preserves the current payment modal, credit selection, payment methods, digital-operation validation, cash-session requirement and canonical financial idempotency.

## Root cause

The visible CANON UI reaches the legacy `confirmarPago()` winner. That legacy path mutates `creditos[]` and `cajMovs[]` and persists with `saveAllData()`. CANON intentionally blocks legacy persistence, and `isModuleLocked()` also fails closed for legacy client writes.

The canonical backend/client already supports `payment.create`, including credit revision checks, cash-session checks, operation journaling and idempotent receipts. The missing piece is a UI bridge.

## Impact analysis

### READS

- `POS/js/legacy-inline/inline-02.js`: current payment validation/UI contract.
- `POS/js/legacy-inline/inline-07.js`: final authorization wrapper for `confirmarPago`.
- `POS/js/sync/canonical-client.js`: `createPayment`, `refresh`, canonical journal/idempotency.
- `POS/js/adapters/canonical-ui-adapter.js`: canonical credit/payment/cash projection.
- `POS/js/sync/canonical-cash-bridge.js` and `canonical-expense-bridge.js`: approved bridge pattern.
- `POS/index.html` and `POS/sw.js`: runtime/precache registration.

### WRITES

- `POS/js/sync/canonical-credit-payment-bridge.js`
- `POS/js/legacy-inline/inline-07.js`
- `POS/index.html`
- `POS/sw.js`
- `tests/cloud-sync/canonical-credit-payment-bridge.test.mjs`
- this document

### DOM_AFFECTED

- `#mPagoCred`
- `#pagoMonto`
- `#pagoMetodo`
- `#pagoOperacion`
- `#pagoConfirmBtn`

No visual redesign is authorized.

### STATE_AFFECTED

CANON mode only:
- canonical credit balance/payment history after `payment.create`;
- canonical cash expected balance for cash payments;
- refreshed legacy UI projection after the confirmed canonical receipt.

Legacy/non-CANON behavior remains delegated to the existing winner.

### STORAGE_AFFECTED

Authoritative writes are only through `NuevoAmanecerCanonical.createPayment()` -> Worker -> D1.

The bridge must not call `saveAllData()`, mutate `creditos[]`, mutate `cajMovs[]`, or manufacture a second local source of truth.

## Domain invariants

1. A payment amount must be positive and not exceed the current canonical outstanding balance.
2. Cash payments require an OPEN canonical cash session.
3. Digital payments require the existing operation/reference UX validation.
4. Double tap/click cannot create two payments.
5. Canonical client's durable PENDING/CONFIRMED journal and operation idempotency remain authoritative.
6. A successful command is followed by `refresh()`; the existing `na:canonical-updated` projection repopulates Clients/Credits/Cash views.
7. Legacy payment behavior remains unchanged when CANON is disabled.
8. No remote deploy, D1 migration, production mutation or secret change is part of this task.

## Cross-module impact

Risk is HIGH/CRITICAL because Credits and Cash are coupled for cash collections. The implementation therefore reuses the existing canonical financial command instead of duplicating financial calculations in the UI.

Affected consumers: Clients V2, credit history, client balances, daily collection summary and Cash. Sales and inventory are not modified.

## Rollback

Revert the bridge registration, the `inline-07` routing clause and the bridge file. The existing legacy path remains intact and continues to serve non-CANON mode.

## Validation

Focused tests must prove:

- CANON cash payment sends exactly one `createPayment` with the canonical credit id, integer cents and open canonical cash session id.
- CANON digital payment sends a reference and no cash session id.
- overpayment and cash-without-session are rejected before command creation.
- double submission is blocked.
- the bridge contains no `saveAllData()`, `creditos.push` or `cajMovs.push`.
- `inline-07` preserves permission authorization and legacy fallback.
- the bridge is loaded by `POS/index.html` and precached by `POS/sw.js`.
