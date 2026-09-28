# STAGING CANON scaffold

This directory defines the non-deployable contract for a future isolated CANON staging environment.

Safety properties:

- separate frontend Worker, backend Worker, D1 and R2 names;
- `DB` as the neutral runtime binding;
- synthetic data only;
- no production IDs, names, URLs, buckets or secrets;
- immutable build artifacts must be promoted from staging to production;
- templates retain unresolved placeholders and must not be deployed directly.

Phase 1 intentionally creates no Cloudflare resources and contains no remote deployment workflow. Resource provisioning, secret creation, immutable artifact packaging and Playwright deployment gates require separate owner authorization.
