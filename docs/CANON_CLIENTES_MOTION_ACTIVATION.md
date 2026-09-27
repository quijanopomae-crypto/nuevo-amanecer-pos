# CANON Clientes Motion Activation v1

Status: OWNER_APPROVED
Environment: CANON
Base: `d756f7b6ca42f98dd9fcf28142d77f4bd47673ca`

## Objective

Activate the already-merged `window.NA_MOTION` infrastructure for Client Credit Accounts V2 without duplicating the existing global mobile-scroll controller.

## Allowed files

- `POS/js/modules/client-credit-accounts-v2.js`
- `docs/CANON_CLIENTES_MOTION_ACTIVATION.md`
- `tests/product-fixes/canon-clientes-motion-activation.test.mjs`

## Required behavior

- Bind `pageClientes` to `NA_MOTION.page` for real page-entry feedback.
- Register Clientes V2 as an inspectable Motion consumer.
- Keep the existing CANON `module-mobile-scroll` controller as the only scroll authority.
- Synchronize internal Client V2 subview transitions using `transitionend` as primary completion and timeout only as visual fallback.
- Preserve current workspace swipe, cloud animation, loader, navigation, finance and data behavior.
- Respect `prefers-reduced-motion`.

## Forbidden

- No LAB runtime dependency.
- No D1/R2/network changes.
- No sales, inventory, cash, credit, payment or persistence changes.
- No second scroll controller.
- No production backend changes.

## Rollback

Revert the PR. No schema/data migration.
