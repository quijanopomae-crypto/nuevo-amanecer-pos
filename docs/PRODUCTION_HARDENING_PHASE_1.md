# Production hardening phase 1

## Scope

This phase is deliberately non-deploying. It serializes every existing workflow that can change production or its backup/recovery resources, adds regression guards, and records an isolated STAGING CANON contract without creating Cloudflare resources.

## Production lock

The shared GitHub Actions concurrency group is `nuevo-amanecer-production-change` with `cancel-in-progress: false`. It applies to hosted web deployment, production cutover, production Worker CORS hotfix, first-live-sale finalization, and the owner backup/recovery drill. Read-only preflight and owner validation remain outside the lock.

A queued run must never cancel an in-progress production mutation. Each workflow still performs its existing branch and safety checks when it acquires the lock.

## Staging boundary

The staging scaffold requires separate frontend Worker, backend Worker, D1 and R2 resources. It uses synthetic data only and the neutral `DB` binding. The templates are intentionally non-deployable because the D1 identifier remains unresolved.

No production resource, D1, R2 bucket, Worker, secret or commercial operation is changed by this phase.

## Follow-up authorization

A later owner-approved phase must provision isolated Cloudflare resources, implement build-once immutable artifacts, add Playwright clean-install and N-1 upgrade suites, and create an approval-gated production release workflow. Those actions are explicitly outside this phase.
