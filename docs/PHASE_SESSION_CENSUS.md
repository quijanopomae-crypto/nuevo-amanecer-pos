# V1.3 Session Census — Read-Only Production Audit

## Purpose

The `V1.3 First Live Sale Finalization` run `36454922447` stopped
`FAIL_CLOSED_BEFORE_SALE` with reason `active_sessions=26`. No `sale.create`,
no canary operation, no final R2 manifest and no `v1.3-production` tag were
produced.

The gate in `tools/cloudflare-prod/scripts/first-live-sale.mjs`
(`createTechnicalFirstSale`) requires **all** of the following to be zero
before the first sale, including `active_sessions`:

```
sales, sale_items, cash_movements, inventory_movements,
sync_operations, financial_operations,
active_sessions = COUNT(*) FROM auth_sessions WHERE status='active'
```

This document specifies a **strictly read-only** census whose only goal is to
explain where those 26 active sessions come from and to prove whether any
commercial traffic exists, WITHOUT mutating production.

## Non-goals

- It does NOT delete, revoke, update or insert anything.
- It does NOT run `/auth/activate` and does NOT create a temporary session.
- It does NOT change the first-live gate.
- It does NOT retry the first live sale.

## Scope of reads

`canonical_control`: `mode`, `revision`, `authority_epoch`,
`first_live_operation_id`.

`auth_sessions`: total count, count grouped by `status`, `MIN(created_at)`,
`MAX(created_at)`, expired vs non-expired by `expires_at` (when present),
and a recent-activity bucket when a `last_seen_at`/`updated_at` column exists.

`devices`: aggregate counts only, grouped by `status` and by
`session:` principal prefix, to classify origin. No identifiers are printed.

Commercial correlation: `sales`, `sale_items`, `cash_movements`,
`inventory_movements`, `sync_operations`, `canonical_financial_operations`.

## Safety contract

- Workflow `permissions: contents: read`.
- Script contains only `SELECT`/`PRAGMA` statements; a static test asserts the
  absence of `INSERT`/`UPDATE`/`DELETE`/`/commands/` and of `/auth/activate`.
- No tokens, secrets, credentials or full private identifiers are printed.

## Expected sanitized output

```
SESSION_CENSUS_READONLY_PASS
canonical_mode / first_live_operation_id
sessions_total / active / expired / revoked / other
oldest_session / newest_session
sales / sale_items / cash_movements / inventory_movements /
  sync_operations / financial_operations
COMMERCIAL_TRAFFIC_ZERO=true|false
ACTIVE_SESSIONS_EXPLAINED=true|false
```

## Follow-up (not part of this task)

If `first_live_operation_id IS NULL` and all six commercial counters are 0,
document formally that `active_sessions != commercial_traffic`. Any change to
`first-live-sale.mjs` is deferred until Phases 6-deep, 7, 8 and 9 are complete.
