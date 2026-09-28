# CANON LIVE Products — product.create

## Objective

Migrate **Nuevo producto** from legacy local persistence to the authoritative CANON path:

POS form -> canonical client -> Worker -> D1 -> canonical read -> adapter -> Inventario/POS.

New products must survive reload, appear on a second device and be sellable through the existing canonical sale flow.

## Architectural decision

Imported `products` remain the sealed promotion image and are not repurposed for operational creation.

Operational products created after cutover live in `canonical_live_products`.

Canonical reads expose one logical product catalog:

- IMPORT rows from `products`
- LIVE rows from `canonical_live_products`

The sale command resolves both sources. Imported inventory keeps using `canonical_inventory_effects`; LIVE inventory uses `canonical_live_inventory_effects`.

This avoids:
- fabricating import provenance;
- appending fake rows to `import_staging`;
- weakening `products_candidate_insert`;
- unlocking legacy `saveAllData()`;
- breaking the existing imported product foreign-key chain.

## READS

- `infra/database/migrations/0006_canonical_promotion.sql`
- `infra/database/migrations/0008_canonical_commerce.sql`
- `infra/database/migrations/0011_canonical_session_runtime.sql`
- `tools/cloudflare-lab/src/a6-commerce.js`
- `tools/cloudflare-lab/src/a6-canonical.js`
- `tools/cloudflare-lab/src/worker.js`
- `POS/js/sync/canonical-client.js`
- `POS/js/adapters/canonical-ui-adapter.js`
- `POS/js/legacy-inline/inline-02.js`
- `POS/js/legacy-inline/inline-07.js`
- `POS/index.html`
- `POS/sw.js`

## WRITES

- `infra/database/migrations/0014_canonical_live_products.sql`
- `tools/cloudflare-lab/src/a6-products.js`
- `tools/cloudflare-lab/src/a6-commerce.js`
- `tools/cloudflare-lab/src/a6-canonical.js`
- `tools/cloudflare-lab/src/worker.js`
- `POS/js/sync/canonical-client.js`
- `POS/js/sync/canonical-product-bridge.js`
- `POS/js/legacy-inline/inline-07.js`
- `POS/index.html`
- `POS/sw.js`
- focused tests

## DOM_AFFECTED

Only the existing product modal:
- `#mProd`
- its existing input fields
- existing Save button

No redesign is authorized in this task.

## STATE_AFFECTED

- canonical product catalog after refresh
- POS product list
- Inventario product list
- stock revisions for LIVE products sold by `sale.create`

Legacy/non-CANON behavior remains unchanged.

## STORAGE_AFFECTED

Authoritative:
- Worker
- D1 `canonical_live_products`
- D1 `canonical_product_operations`
- D1 `canonical_live_inventory_effects`

Not authoritative:
- legacy arrays
- localStorage
- IndexedDB legacy snapshot

## DOMAIN_INVARIANTS

1. Imported `products` and their provenance remain unchanged.
2. `product.create` requires ACTIVE CANON authority and the authenticated writer principal.
3. `operation_id` is idempotent; same payload replays, different payload conflicts.
4. Product id, SKU, barcode and alternate codes cannot collide across IMPORT or LIVE catalog.
5. Price/cost cents and stock quantities are validated before SQL.
6. Initial stock is atomic with product creation; partial creation is impossible.
7. LIVE products can be sold by the same `sale.create` endpoint.
8. Sale stock mutation is CAS-protected by `stock_revision`.
9. No client can write D1 directly.
10. No `saveAllData()` call is added to the canonical path.

## CROSS_MODULE_IMPACT

Risk: **CRITICAL**.

Product creation crosses:
- inventory
- POS sales
- canonical reads
- PWA shell
- D1 authority
- idempotency

Therefore this PR must pass CANON Critical CI plus focused Worker/SQLite and browser bridge tests before merge.

## Out of scope for this PR

- product metadata editing (`product.update`)
- manual inventory entry/exit (`inventory.adjust`)
- generic VARIOS sale

Those are subsequent isolated migrations after this catalog write path is green.
