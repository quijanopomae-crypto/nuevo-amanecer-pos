# Local-first POS V1.3 — implementation and promotion evidence

Base fetched from GitHub: `feature/v1.3-mobile-cloud` at `f865ae53a3330ed9cbf71fe9141f64a3fc0ac165`. Isolated implementation branch: `feat/v1.3-local-first-replication`. Owner specification and task/preflight precede POS edits. This change is for review: no merge, deploy, remote migration, production restore or commercial sale is authorized by the attached implementation specification.

## Root causes and resulting behavior

The legacy canonical client required online readiness, a single localStorage pending journal blocked unrelated commands, and sale capture waited for remote synchronization after durable intent capture. Cash bridges inherited the same refresh/command/refresh path. The cashier therefore depended on network latency even with IndexedDB available.

V10 now stores the operational canonical snapshot and a small durable FIFO atomically in the existing `NuevoAmanecerPOS` database. The reducer applies current commercial state once; the client publishes only after a verified local transaction. Background replication sends the existing immutable `/commands/*` envelopes. UUID retries and Worker CAS/receipts preserve existing idempotence. ACK compacts the FIFO into its baseline without reapplying stock/cash. No DAG, CRDT, second ledger, generic replication endpoint or multiwriter is introduced.

The base already fixed lexical global bindings and canonical product identity. Those fixes remain: UI adapter ID, cart ID, intent product_id and Turso product_id are the same exact ID. No product names, invented IDs or product creation are used to reconcile a sale. A sale number is reserved from the latest local projection inside the commit lock; that projection includes pending and acknowledged sales. Retrying the same intent returns the original receipt instead of reserving another sale number.

Both sale buttons share the same durable route. Modal/button/cart/history update after local durability; messages explicitly indicate local storage and pending synchronization. A storage failure leaves the cart intact. F5 serves the validated local snapshot first. Local cash open/close/payment/expense commits make zero remote calls; background proof reads remain separate.

The existing legacy IndexedDB open used version 1, conflicting with V10 version 2. It now opens the existing version and closes on versionchange. Existing data is preserved. Backend credit-account creation does not advance financial_revision; the local reducer now matches that rule. Compensation payment signs/method and customer TEXT color match Turso projections. These differences otherwise caused false cloud-recovery alerts.

## Boundaries and recovery

An additive migration 0019 defines one owner-approved writer grant under the current promotion/epoch. Existing write transactions enforce it; reader sessions can authenticate and read but cannot commit. The owner secret is never stored in commercial snapshots/backups. A changed session must revalidate online before using an old writer snapshot.

Activation holds the existing legacy outbox and writer locks while capturing its baseline/migrating. Known legacy pending UUIDs reconcile by their original payload and receipt. Unknown entries remain intact as NEEDS_REVIEW evidence and block only their resource footprint. Existing localStorage is not wiped. Migration is complete only after a durable marker.

Cloud loss, unexpected revision or mismatching business projection cannot overwrite valid local data. Background synchronization pauses; cloud loss permits continued local work. Authority changes close local commits. Slow scans reprogram newly queued work after completion; empty-FIFO authority changes are persisted.

Owner cloud→local recovery requires a verified downloaded backup, explicit destructive consent, owner authentication and a final sequence/digest check inside the V10 lock. Corrupt local state can be exported as raw recovery evidence before replacement. Cancellation does nothing. Historical UUIDs whose effects were removed by that recovery fail explicitly rather than returning a misleading local success. The UI blocks cloud→local replacement when the cloud is known to be behind.

**Remaining limitations:** local→cloud baseline reconstruction uses the existing owner backup/recovery process and is not automated here; writer handover to another principal is refused, not implemented. V10 retains its existing full checkpoints/operations; storage quota and long-term retention require physical-device measurement. A browser-cleared origin cannot recover unreplicated data without an exported backup. No physical Android acceptance or production activation has been performed. These are promotion blockers, not claims of distributed recovery support.

## Verification in this cloud environment

- Cloud-sync suite: 571 tests pass, including TursoD1Adapter Worker transactions and hosted deploy safety tests.
- Business/backup suites: 121 tests pass. Historical fix02 T17 passes locally; no test was weakened.
- CANON interface/motion parity: 30 tests pass; versioned visual promotion check passes for 23 assets.
- Real Chromium: 26 tests pass (22 local-first regressions plus 4 existing smoke tests). Covers offline/reload, real global let, both real UI sale buttons, exact identity, pending/confirmed numbering, local failure, lost ACK, exact stock/cash, batch, account, policy, customer/product/inventory/compensation, legacy migration, reader/session rejection, fabricated receipts, two tabs, cloud loss, owner recovery and slow-scan scheduling.
- Six consecutive offline commercial commits: 343.5 ms total in the final desktop run, zero network requests on the commit path. This is evidence, not an Internet-dependent CI threshold or Android guarantee.
- Production Worker configuration bundles successfully with `wrangler deploy --dry-run`; that command writes no deployed Worker or remote database. A displayed D1 binding is configuration metadata; fixtures deliberately reject D1 access and use Turso.

Commands:

```sh
node --test tests/cloud-sync/*.test.mjs
node --test tests/product-fixes/fix*/*.test.mjs tests/backup-complete.test.mjs tests/backup-restore.test.mjs
node tools/pos-experience/promote-lab-visuals.mjs --check
npx playwright test --config /workspace/.cache/pos-onboarding/playwright.config.ts --workers 2 --timeout 20000
# tools/cloudflare-lab:
npx wrangler deploy --dry-run --config ../cloudflare-prod/wrangler.jsonc
```

The cloud override uses installed system Chromium; repository CI installs its pinned Playwright browser. Synthetic Worker fixtures run in a separate native Node process to avoid Playwright 1.47 transforming .mjs imports. Setup/install and startup instructions were saved to the cloud environment draft; no secrets or network-policy changes were introduced.

## Controlled promotion and rollback

## Technical closure — 2026-10-01 (America/Lima)

Reviewed base `f865ae53a3330ed9cbf71fe9141f64a3fc0ac165`, initial head `f78471312b4119c97eb5470cd579cb527c111c99`, and corrective code head `6f9f08b805ee2d72e2ee99d3ca1a557cd7602b36`. The original five commits remain intact; the sixth fixes a demonstrated P1. No unresolved P0/P1 was found in the reviewed diff. `/auth/local-writer` previously revalidated a granted principal after its role became read-only; background status also ignored explicit `write_authorized:false`. The route now checks role, and both empty/pending FIFO paths durably record AUTHORITY_CHANGED before further local commits. One server regression and two real-browser regressions reproduced failure before the fix and pass afterward.

READS: binding/session, canonical status/projections and existing V10 checkpoints. WRITES: one atomic V10 projection/FIFO/checkpoint commit and unchanged background command envelopes. DOM: existing sale/payment/cash bridges publish after durability. STATE/STORAGE: existing IndexedDB only; immutable UUID/payload, one writer, serialized tabs, exact product IDs, integer money and ACK without repeated stock/cash effects remain invariant. No owner secret is persisted in grants, commercial snapshots or exported evidence.

0019 audit: additive CREATE TABLE and eight CREATE TRIGGER statements only; no existing rows changed, no destructive SQL, dormant without a grant. Grant id=1 is bound to current promotion/epoch. Owner activation authentication is server-side; frontend PIN cannot grant backend writer authority. Reader GETs remain allowed, writes denied. Existing behavior without a grant remains covered. Rollback requires backup and resolving the FIFO before reverting; never delete IndexedDB/localStorage or drop schema to hide pending data. Synthetic fixtures only: no real D1/Turso migration, sale or restore.

PR #322 permanece separado y no fue integrado porque modifica rutas reemplazadas por la arquitectura local-first. Its sale-readiness/overlay and legacy outbox renumbering optimizations overlap the replaced foreground cloud-dependent path. No merge, cherry-pick, close or modification of #322 occurred.

Final local verification: cloud 572/572, business+backup 121/121, interface/motion 30/30, browser 28/28 (24 local-first + 4 smoke), visual promotion 23 assets PASS, production-config Wrangler dry-run PASS, git diff --check PASS. Six offline commits took 172 ms with zero foreground network requests; this is a desktop synthetic measurement, not an Android guarantee. Windows uses pinned Playwright 1.47.2 with system Chrome and an equivalent temporary config (same test directory, two workers, 20000 ms timeout); the Linux `/workspace/.cache` path is unavailable. LF checkout avoids CRLF-sensitive static regex artifacts. The browser fixture explicitly resets network emulation before bootstrap, preventing offline state leakage between tests.

An additional expanded static sweep found three existing expectations concerning header connection chrome and canonical expense projection. They are outside the required passing 30-test interface/motion set; automatic CI results will be recorded below, without weakening tests. Physical Android, real quota/retention, local→cloud recovery drill, writer handover and owner migration/promotion approval remain pending.

Draft PR and GitHub CI: pending creation/run inspection. Este PR no autoriza merge ni deploy. NO DEPLOY / NO PRODUCTION WRITES / NO REAL SALES.

Before promotion: PR gates, review of migration 0019, owner-approved Turso migration contract, physical writer/offline/reload/quota exercise, export and recovery drill, and explicit approval of merge/deploy. Use only the versioned release/Hosted POS workflows; preserve production D1. A second reader must read the synchronized sale. Stop before a real commercial sale until owner authorization.

Before reverting a build that has local pending work, export its backup and drain/resolve the FIFO. An old cloud-dependent build must not silently ignore unreplicated local state. Do not delete the V10 database or clear localStorage as rollback. Current public build remains unchanged. Verdict at implementation review: NOT_READY for a controlled real sale until these promotion blockers are closed.
