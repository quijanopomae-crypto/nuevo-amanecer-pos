# CANON Product Images Batch 001 — Implementation Plan

**Goal:** Promote the owner-approved LAB image batch 001 (10 products) into CANON without mutating canonical product metadata, stock, price, cost, codes, sales or credit state.

## Architecture

Use an append-only image overlay ledger. Imported `products` and `canonical_live_products` remain immutable. CANON reads resolve `image` as the newest overlay image for the same active promotion/product, falling back to the immutable product image when no overlay exists.

Production data application is owner-only through GitHub Actions + Cloudflare D1 administration. No general `product.update` browser command is introduced.

## Impact analysis

- **READS:** active CANON control; imported/live product names and IDs; existing image-overlay receipts; LAB batch-001 manifest; remote approved image bytes; canonical product read model.
- **WRITES:** new append-only `canonical_product_image_events` rows only; production Worker deployment containing read-model support; production backup object in private R2; owner trigger receipt.
- **DOM_AFFECTED:** none.
- **STATE_AFFECTED:** only effective visual `image` returned by canonical product reads.
- **STORAGE_AFFECTED:** one new D1 append-only table/indexes/triggers; up to exactly 10 image events in production D1; one fresh production backup in R2.
- **DOMAIN_INVARIANTS:** no UPDATE/DELETE of `products` or `canonical_live_products`; no stock/current_stock/stock_revision change; no price/cost/category/code/name change; no sales/cash/credit/inventory ledger writes; exact-name unique product matching; exactly 10 approved entries; raster data URLs only; idempotent operation IDs; replay mismatch fails closed.
- **CROSS_MODULE_IMPACT:** Inventario and Punto de Venta consume the same CANON product read model and will gain images. Sales, Caja, Créditos and inventory arithmetic remain unchanged.
- **Risk:** HIGH because production catalog reads change, but monetary/inventory writes are explicitly excluded.

## Files

1. `infra/database/migrations/0020_canonical_product_images.sql`
   - Append-only overlay ledger.
   - Guards active promotion/product existence/provenance.
   - Reject update/delete and unsafe image shape/size.

2. `tools/cloudflare-lab/src/a6-canonical.js`
   - Overlay latest image into IMPORT and LIVE product reads.
   - Include image-ledger count in `financial_revision` so stale cursors/cache refresh correctly.

3. `tests/cloud-sync/canonical-product-images.test.mjs`
   - Regression tests for import/live overlays, immutability, no commercial-field mutation, append-only behavior and read-model visibility.

4. `ops/product-images/batch-001.json`
   - Exactly 10 owner-approved names/presentations/source URLs copied from LAB batch 001.

5. `tools/cloudflare-prod/scripts/product-image-batch-apply.mjs`
   - Validate manifest.
   - Download approved raster images, enforce byte/data-URL limits, compute SHA-256.
   - Resolve each exact product name uniquely across IMPORT/LIVE.
   - Apply all 10 events atomically/idempotently via Cloudflare D1 batch.
   - Re-read and verify all 10 effective images.

6. `.github/workflows/v1.3-prod-product-images-batch.yml`
   - Exact-head guard, focused tests, Worker dry-run, ACTIVE preflight, fresh D1 backup, private R2 checksum verification, migration 0020, Worker deploy, health probe, batch apply and CANON read verification.

7. `ops/v1.3-prod-product-images-trigger.json`
   - Kept unarmed in the implementation PR; after merge/verification, owner authorization updates it to the exact merged head to trigger production.

## Verification sequence

1. Focused Node tests PASS.
2. CANON critical CI PASS on PR.
3. Diff shows no `POS/**` change and no product metadata write path.
4. Merge implementation to `feature/v1.3-mobile-cloud`.
5. Arm production trigger with the exact merged SHA (owner explicitly authorized in chat).
6. Production workflow exports/stores backup before migration/data writes.
7. Migration/Worker deploy/health PASS.
8. Exactly 10 image events applied or workflow fails atomically.
9. Canonical read model returns non-empty safe image for all 10 exact product names.
10. Verify commercial invariants before/after (price, cost, stock, stock revision, IDs, counts) unchanged.

## Rollback

- Data rollback: append-only compensating image event can restore prior image without deleting history.
- Code rollback: revert read-model commit only after preserving migration compatibility (overlay table may remain unused safely).
- Production backup is captured and checksum-verified before any production D1 migration/data write.
