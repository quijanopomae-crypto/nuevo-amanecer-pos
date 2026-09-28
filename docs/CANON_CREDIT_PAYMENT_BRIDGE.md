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

## Independent review of PR #194 (fix round)

### CANON Critical CI failure — root cause

`tests/cloud-sync/client-renderer-collision.test.mjs` forbids `/\bcliRender\s*=/` in every
script loaded after `inline-03.js` (invariant: nobody may replace the canonical fail-closed
`cliRender` wrapper). The first bridge version contained
`typeof root.cliRender === 'function'`; the regex matches the first `=` of `===`.
It was an **invariant collision (false positive)**: the bridge never reassigned `cliRender`.
The invariant and its test are kept unchanged. The bridge now resolves renderers through a
read-only name lookup (`root[name]`), which cannot look like an assignment.

### Functional defects found and fixed

1. **Lexical globals.** `toast` and `cerrarModal` are top-level `const` in `inline-01.js`,
   so they are NOT `window` properties. `root.toast(...)` was always `undefined`: the bridge
   showed no success and no error feedback in the real browser. The bridge now resolves the
   global lexical binding first (`typeof toast`), then falls back to `root.toast`.
2. **COMMAND COMMITTED BUT REFRESH FAILED.** `canonical-client.sendPending()` sets
   `ready=false` after a confirmed receipt, and the old bridge reported any post-commit
   refresh error as "No se pudo registrar el pago". The bridge now separates phases: once a
   receipt exists the modal closes and the user is told the payment is CONFIRMED and must
   not be repeated, even if the refresh fails.
3. **Lost ACK / PENDING journal.** When the POST outcome is unknown the canonical journal
   stays `PENDING`. The next tap now calls `retryPending()` with the SAME `operation_id`
   (Worker replays `already_processed`) instead of trying a new command. A rejected pending
   (`last_error`) or a foreign pending command is reported and blocks new payments.
4. **Digital reference dedupe.** Scope aligned with legacy `_naCreditPaymentOperationUsed`
   (credit payments + sales + cash movements). Payments reversed by a canonical
   `COMPENSATION` no longer count as used (false-positive fix).

### Verified (no change needed)

- `abrirPago()` sets `pagoCredId = cr.id`; in CANON `creditos` comes from the UI adapter
  where `id === credit_id`.
- `expected_credit_revision` is derived by `canonical-client` from the refreshed replica and
  validated by the Worker (`stale_credit`); the bridge must not supply it.
- Cash payments use `cashState.sessionId` from canonical `cash-sessions`; `canonical-client`
  re-checks it is the single OPEN session.
- Pre-command `refresh()` is required (fresh revision, fewer `stale_credit` rejections);
  post-command `refresh()` is required (`ready=false` after receipt and UI projection).

### Tests

- `tests/cloud-sync/canonical-credit-payment-e2e.test.mjs` runs the real bridge,
  `canonical-client`, UI adapter and Worker against SQLite with the D1 migrations: cash and
  digital payments, F5 (new runtime, same storage), second device, lost ACK replay,
  committed-but-refresh-failed, server rejection, double tap, reference dedupe.
- `tests/cloud-sync/canon-browser-harness.mjs` is the reusable test-only harness.

### Pre-existing risk (not changed here)

A `PENDING` record with `last_error` (definitive 4xx rejection) is never cleared by
`canonical-client`, so it blocks every later financial command on that device. Fixing it
changes shared journal semantics for sales/cash/expenses and needs its own task.
