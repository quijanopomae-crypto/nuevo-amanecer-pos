# V1.3 Cycle 01 - PWA Gate Audit

## Identity

- Worktree: `C:\opus-worktrees\POS-WT-V13-MOBILE`
- Branch: `feature/v1.3-mobile-cloud`
- HEAD: `6749472e289ac1b4501bcad553029cfa0d680194`
- Manifest SHA-256: `2ef3ce7a417e21f59bafa847c7070228f7dc1591a70d24de2f52ef1b1a1c2fb1`
- Recorded at: `2026-09-18T13:31:38.908Z`

## Scope

Audit the existing uncommitted PWA candidate without changing product files. The
active manifest sets `shadow_write_policy.product_write: DENIED`, so this cycle
writes only its own evidence under `evidence/v1.3/cycle-01/`.

No durable V1.3 Feature Spec or ordered gate list was found in this checkout.
PWA is the candidate inferred from the existing diff, not an independently
confirmed next gate from an approved V1.3 plan. V1.2 remains closed.

## Facts

- The hosted build copies 52 allowlisted reader/PWA assets and replaces the
  service-worker build marker with a 16-character SHA-256-derived value.
- All 49 service-worker precache paths exist and are unique.
- The 192 and 512 icons are valid PNG files with the declared dimensions.
- The local release server serves `POS/index.html` but returns 404 for
  `manifest.webmanifest`, `sw.js`, `icon-192.png`, and `icon-512.png` because its
  allowlist still comes from the closed V1.2 production package manifest.
- The source `POS/sw.js` retains `__BUILD_HASH__`; unlike the hosted build, the
  local path has no substitution step.
- The service worker uses network-first navigation and cache-first precached
  scripts. During an update simulation this yielded `html-v2` with `js-v1`, so
  one page load can mix generations.
- `/health`, `/sync/*`, `/read/*`, cross-origin, non-GET, authorization, sync-token,
  and read-token requests bypass the service worker in the tested contract.
- Offline navigation and an offline precached script both resolve from cache in
  the Node VM contract test.
- No product, financial, inventory, cash, credit, V10, Worker, or credential data
  was written by this cycle.

## Commands And Results

- `node --check POS/sw.js`: PASS.
- `node --check tools/cloudflare-lab/scripts/build-reader.mjs`: PASS.
- `node tools/cloudflare-lab/scripts/build-reader.mjs`: PASS, 52 allowlisted assets.
- `node --test tests/release-local-server.test.mjs`: PASS, 1/1.
- `node --test tests/cloud-sync/read-only.test.mjs tests/cloud-sync/worker-cors.test.mjs tests/cloud-sync/outbox-sync.test.mjs`: PASS, 25/25.
- `node --test tests/release-invariants/*.test.mjs`: PASS, 48/48. The harness wrote
  its default historical evidence; those generated changes were removed from the
  content diff and are not part of this cycle.
- Local HTTP resource probe: `index.html` 200; four PWA resources 404.
- `node evidence/v1.3/cycle-01/pwa-audit.mjs`: expected non-zero gate result,
  13 PASS and 2 PRODUCT_FAIL. Full observations are in `pwa-audit.json`.
- `git diff --check`: PASS before evidence creation; repeated in final verification.

Final verification: `git diff --check` passed; the product content diff is still
the original 17 HTML additions and 82 additions/6 deletions in the build script.
The historical invariant evidence has no content diff, but `git status` still
marks its nine files modified due to line-ending changes from the test writer.
No index refresh, staging, commit, or deployment was performed.

## Environment Limits

- The canonical preflight script initially could not execute under the machine's
  PowerShell policy. With one-shot `-ExecutionPolicy Bypass` it returned `STOP`,
  but left project, branch, HEAD, model, variant, and agent empty and classified
  this checkout as `UNKNOWN`. Direct Git probes independently confirmed this
  worktree, branch, and HEAD. No product edit was performed after that result.
- Playwright is unavailable in this checkout, so no browser installability,
  service-worker lifecycle, Cache Storage, IndexedDB, or Chrome console claim is
  made.
- No physical-device test was performed.
- Two inline build-hash probes failed because their regex did not match the
  template-literal source (the second was also affected by PowerShell quoting).
  These were harness errors, not product defects; evaluating the actual cache
  name in `pwa-audit.mjs` passed. The failed probes are not counted as tests.
- An auxiliary read-only agent failed with provider saturation. Its work was not
  used as evidence. Attempts to inspect the external preflight implementation and
  temporary Playwright location were denied by tool permissions; no workaround
  was attempted for those denied file accesses.

## Verdict

`NOT_APPROVED`

This verification gate is complete, but the PWA candidate must not advance. There
is no observed P0/P1 in the tested financial invariants. The blocking findings are
functional release defects and an explicit product-write denial, not missing
credentials or a business-rule decision.

## Residual Risk

- Local V1.3 installation cannot acquire its manifest, service worker, or icons.
- A deployed update can combine new HTML with old cached scripts.
- Real browser lifecycle, refresh/update recovery, offline reload, mobile layout,
  and installation remain unverified.

## Next Action

See `NEXT_ACTION.md`.
