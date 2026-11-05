# CANON Product Images Batch 001 — Implementation Plan

**Goal:** Promote the owner-approved LAB image batch 001 (10 products) into CANON while preserving price, cost, stock, codes, category, name, provenance, sales, cash and credit state.

## Architecture

Keep the existing canonical product tables and read model. Do **not** introduce a general `product.update` command and do **not** copy LAB code into CANON.

Add an append-only authorization ledger, `canonical_product_image_events`. Each event records the exact product identity, prior image, replacement image, source and SHA-256. A companion trigger applies that image to the existing `image` column in the same SQLite transaction. The existing `products_no_update` and `canonical_live_products_guarded_update` triggers are recreated with one narrowly scoped exception: an image-only mutation is allowed only when it matches a just-inserted authorization event for the active promotion and the exact prior image. Stock updates retain the existing sale/inventory authorization paths unchanged.

Because canonical reads already return the product `image` field and the UI adapter already maps it to `imagen`, no `POS/**`, canonical-client, UI or Worker read-model source change is required.

Production application is owner-only through a separately armed GitHub Actions trigger. The implementation PR itself performs no production write.

## Impact analysis

- **READS:** active CANON control; imported/live product names, IDs and current images; existing image-event receipts; approved batch manifest; remote approved image bytes; production Worker product read model.
- **WRITES:** append-only `canonical_product_image_events`; the existing product `image` column only, applied by database trigger; production backup object in private R2; owner trigger receipt.
- **DOM_AFFECTED:** none.
- **STATE_AFFECTED:** only the visual `image` field of the ten exact products.
- **STORAGE_AFFECTED:** two additive D1 migrations; exactly ten idempotent image events on first successful run; exactly ten corresponding image-only product mutations; one fresh production backup in R2.
- **DOMAIN_INVARIANTS:** no price/cost/category/code/name/provenance mutation; no stock/current_stock/stock_revision mutation by the image path; no sales/cash/credit/inventory-ledger writes; exact-name unique matching; exactly 10 approved entries; raster data URLs only; maximum data URL length 180000; idempotent operation IDs; replay mismatch fails closed.
- **CROSS_MODULE_IMPACT:** Inventario and Punto de Venta gain the images through the existing canonical product projection. Sales, Caja, Créditos and stock arithmetic are expected to remain behaviorally unchanged.
- **Risk:** HIGH because this writes production catalog presentation data, but the database contract explicitly excludes commercial and inventory state.

## Files

1. `infra/database/migrations/0020_canonical_product_images.sql`
   - Creates the append-only image authorization ledger.
   - Guards ACTIVE promotion, sequential revision, exact product identity/provenance and exact previous image.
   - Rejects event update/delete.
   - Recreates imported/LIVE product update guards with the narrow audited image-only exception while preserving existing authorized stock-update paths.

2. `infra/database/migrations/0021_canonical_product_image_apply.sql`
   - Rejects no-op image events.
   - AFTER INSERT triggers apply the exact image to IMPORT or LIVE product in the same SQLite transaction.
   - Raises/rolls back the event if exactly one product is not updated.

3. `tests/cloud-sync/canonical-product-images.test.mjs`
   - Regression coverage for IMPORT/LIVE image application, append-only receipts, unaudited rejection, commercial invariants, canonical read visibility and coexistence with `inventory.adjust`.

4. `tests/cloud-sync/canonical-product-image-batch-script.test.mjs`
   - Validates exactly-ten manifest, owner approval, raster MIME filtering, hashing and size bounds.

5. `ops/product-images/batch-001.json`
   - Exactly 10 owner-approved product names/presentations/source URLs derived from the approved LAB batch.

6. `tools/cloudflare-prod/scripts/product-image-batch-apply.mjs`
   - `prepare`: downloads all ten approved raster images, validates MIME/size, produces bounded data URLs and SHA-256 receipts before any production write.
   - `apply`: resolves every exact product name uniquely, records/apply events idempotently, then re-reads every product and checks price/cost/stock/code fingerprints and protected ledger counts.

7. `tools/cloudflare-prod/scripts/product-image-batch-verify-worker.mjs`
   - Creates a temporary authorized production session.
   - Reads the real `/read/canonical/products` path and verifies all ten effective images exactly.
   - Revokes the temporary session/device afterward.

8. `.github/workflows/v1.3-prod-product-images-batch.yml`
   - Trigger-file-only production workflow.
   - Exact-parent and exact-diff authorization checks.
   - Focused regression tests, image preparation, ACTIVE/unique-name preflight, fresh D1 backup, private R2 checksum verification, migrations 0020/0021, apply, Worker verification and summary.

9. `ops/CANON-PRODUCT-IMAGES-B001.json`
   - Promotion contract documenting the approved behavior, files, invariants and rollback.

10. `ops/v1.3-prod-product-images-trigger.json`
   - Intentionally absent from the implementation PR. After merge + verification, the owner authorization in this chat permits a separate one-file commit that arms production against the exact implementation merge SHA.

## Verification sequence

1. Focused Node image tests PASS.
2. Existing inventory/live-product regressions PASS.
3. PR CI PASS and diff review confirms no `POS/**` edits.
4. Merge implementation to `feature/v1.3-mobile-cloud`.
5. Record the exact implementation merge SHA.
6. Arm production with one trigger-file-only commit whose parent must equal that SHA.
7. Workflow prepares all ten images **before** production writes; any network/MIME/size failure stops here.
8. Confirm CANON is ACTIVE and each exact name resolves to exactly one IMPORT/LIVE product.
9. Export a fresh production D1 backup, store it in private R2, download it back and verify SHA-256.
10. Apply and verify migrations 0020/0021.
11. Insert all ten idempotent image events; database triggers apply image-only mutations.
12. Re-read commercial fingerprints and protected ledger counts; any mismatch fails the workflow.
13. Verify all ten images through the real production Worker canonical product read path.
14. Only after all steps PASS declare CANON applied.

## Rollback

Normal rollback is append-only: issue a new audited image event per affected product whose new image is the event's recorded `previous_image`. This restores the prior visual value without deleting audit history or touching stock/commercial fields.

Emergency rollback is the fresh, checksum-verified production D1 backup captured before migrations/data writes. Migration tables may safely remain if code/data application is stopped because they are additive and have no effect until an authorized image event is inserted.
