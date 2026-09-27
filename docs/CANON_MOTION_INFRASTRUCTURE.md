# CANON Motion Infrastructure v1

Status: OWNER_APPROVED
Environment: CANON
Base: `c6e1f2c3cb566d558ae9412423ddcbb87f46380c`

## Objective

Create a reusable visual-motion infrastructure under `POS/` derived from the approved POS-LAB motion contract, without introducing any runtime dependency on `laboratorio/`.

The infrastructure must provide:

- a global `window.NA_MOTION` namespace;
- pure visual-state primitives;
- page-entry helpers;
- reusable scroll-linked visual controllers;
- reusable modal/swipe-dismiss helpers;
- reusable feedback and cart feedback helpers;
- reduced-motion support;
- a CANON motion architecture map;
- a real CANON consumer: Client Credit Accounts V2.

## Allowed files

- `POS/index.html`
- `POS/js/motion/**`
- `POS/css/motion/**`
- `POS/js/modules/client-credit-accounts-v2.js`
- `docs/CANON_MOTION_INFRASTRUCTURE.md`
- `docs/MOTION_MAP.yaml`
- `REPO_MAP.yaml`
- `tests/product-fixes/canon-motion-infrastructure.test.mjs`

## Forbidden scope

- `laboratorio/**`
- production D1/R2 data or migrations
- secrets
- business rules
- sales, inventory, cash or credit ledger mutation
- authentication/session behavior
- remote deploys

## Visual-only authority

Motion is never a source of truth for:

- sales;
- inventory;
- cash;
- credits;
- payments;
- persistence;
- authentication;
- synchronization.

A Motion failure must degrade to immediate/static UI and must never block a business operation.

## DOM / state

Generic state vocabulary:

- `idle`
- `opening`
- `open`
- `dragging`
- `settling`
- `closing`
- `closed`

Generic DOM contract:

- `data-na-motion-state`
- `--na-motion-progress`

## Client Credit Accounts V2 pilot

The existing CANON Clientes V2 animations remain behaviorally equivalent.

The module may consume these common primitives:

- `NA_MOTION.core.reducedMotion`
- `NA_MOTION.core.cssTimeMs`
- `NA_MOTION.core.setState`
- `NA_MOTION.core.getState`
- `NA_MOTION.core.setProgress`
- `NA_MOTION.core.whenTransitionEnds`

No financial logic may be moved into Motion.

## Tests

- JS syntax for all Motion files.
- `NA_MOTION` core API presence.
- No storage/network/business-authority calls in Motion files.
- Index loads Motion CSS/JS before the Clientes V2 module.
- Reduced-motion contract exists.
- Clientes V2 delegates compatible visual primitives to `NA_MOTION` while retaining safe fallbacks.
- Existing CANON critical/product tests remain green.

## Rollback

Revert the promotion commit/PR. No schema or data migration is involved.
