# V1.3 remediation — Phase 7 security and infrastructure

Status: code-side remediation prepared on `remediation/phase7-security-infra`.

This phase is intentionally split between repository changes that can be verified in CI and owner-only operations that require real credentials or GitHub administration. No Cloudflare deployment, remote D1 migration, R2 write, or secret creation is performed by this phase.

## H13 — credential separation

The repository now assigns one responsibility to each credential:

- `R2_CANON_READ_TOKEN`: read-only download of the CANON backup from R2 in GitHub Actions/CLI. It is not a Worker secret.
- `LAB_IMPORT_HMAC_SECRET`: signs and verifies the LAB baseline import payload.
- `POS_ACTIVATION_SECRET`: validates the one-time activation step that issues a persistent browser session.

The LAB Worker import verifier does not accept `R2_CANON_READ_TOKEN`. Device provisioning has been retired; write authorization uses persistent sessions instead of hardware identities.

### OWNER_ONLY activation

Before the manual remote workflows are used, the repository owner must configure `LAB_IMPORT_HMAC_SECRET` and a private `POS_ACTIVATION_SECRET`. Neither value belongs in Git, issues, PRs, logs, chat, or documentation.

After those secrets exist, the owner may deliberately run the manual LAB deployment workflow. A new browser exchanges the activation secret once for a persistent random session token; no device-registration workflow is required.

## H17 — GitHub Pages boundary

POS-LAB currently uses `<base href="../../POS/">`, so it needs the canonical CSS/JS/assets tree at runtime. Removing `POS/**` from the Pages artifact would break the LAB.

The Pages workflow therefore keeps the support assets but applies two boundaries:

1. POS-only changes do not trigger an automatic Pages deployment.
2. `_site/POS/index.html` is replaced during the build by a non-production notice linking to POS-LAB. The canonical POS application entry point is not served by Pages.

This is a compatibility boundary, not a production deployment path. The actual CANON POS continues to use its controlled local/production origin.

## H18 — branch protection

Repository inspection on 2026-09-24 found no active ruleset and the default branch `feature/v1.3-mobile-cloud` is not protected.

This remains OWNER_ONLY because the connected GitHub application does not provide administration writes for branch protection/rulesets.

Recommended owner configuration:

- protect `feature/v1.3-mobile-cloud`;
- require pull requests before merge;
- disallow force pushes and branch deletion;
- require the applicable critical CI checks before merge;
- avoid making path-filtered checks unconditionally required unless GitHub is configured so skipped workflows cannot block unrelated PRs.

## H38 — immutable Actions

All `uses:` references under `.github/workflows/` are pinned to 40-character commit SHAs. Security tests fail if a mutable tag is reintroduced.

## Verification boundary

CI may verify source, tests, migrations against local D1, workflow policy, and secret separation. It cannot prove that the owner has created the real secrets, changed GitHub branch-protection administration, or completed a real production backup/recovery drill.

Those operational items must stay marked OWNER_ONLY until performed and recorded with evidence.
