-- CANON product-image authorization ledger.
--
-- Product image changes are a narrow, audited exception to otherwise immutable
-- product metadata. Price, cost, stock, codes, category, name and provenance stay
-- sealed. Every image mutation must be preceded in the same atomic batch by one
-- append-only authorization event that matches the exact old/new image pair.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_product_image_events (
  operation_id TEXT PRIMARY KEY
    CHECK(length(operation_id) BETWEEN 1 AND 160),
  promotion_id TEXT NOT NULL,
  product_id TEXT NOT NULL
    CHECK(length(product_id) BETWEEN 1 AND 160),
  product_provenance TEXT NOT NULL
    CHECK(product_provenance IN ('IMPORT','LIVE')),
  revision INTEGER NOT NULL
    CHECK(revision >= 1),
  batch_id TEXT NOT NULL
    CHECK(length(batch_id) BETWEEN 1 AND 80),
  product_name TEXT NOT NULL
    CHECK(length(product_name) BETWEEN 1 AND 240),
  previous_image TEXT
    CHECK(previous_image IS NULL OR length(previous_image) <= 180000),
  image TEXT NOT NULL
    CHECK(length(image) BETWEEN 24 AND 180000)
    CHECK(
      image GLOB 'data:image/jpeg;base64,*' OR
      image GLOB 'data:image/png;base64,*' OR
      image GLOB 'data:image/webp;base64,*' OR
      image GLOB 'data:image/gif;base64,*'
    ),
  image_sha256 TEXT NOT NULL
    CHECK(length(image_sha256)=64 AND image_sha256 NOT GLOB '*[^0-9a-f]*'),
  source_page TEXT NOT NULL
    CHECK(length(source_page) BETWEEN 8 AND 2048),
  source_image_url TEXT NOT NULL
    CHECK(length(source_image_url) BETWEEN 8 AND 4096),
  created_at TEXT NOT NULL
    CHECK(length(created_at) BETWEEN 20 AND 40),
  UNIQUE(promotion_id, product_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_canonical_product_image_events_latest
  ON canonical_product_image_events(promotion_id, product_id, revision DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_product_image_events_batch
  ON canonical_product_image_events(promotion_id, batch_id, product_id);

DROP TRIGGER IF EXISTS canonical_product_image_events_guard_insert;
CREATE TRIGGER canonical_product_image_events_guard_insert
BEFORE INSERT ON canonical_product_image_events
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM canonical_control c
    WHERE c.id=1
      AND c.mode='ACTIVE'
      AND c.active_promotion_id=NEW.promotion_id
  ) THEN RAISE(ABORT,'canonical_product_image_requires_active_promotion') END;

  SELECT CASE WHEN NEW.revision <> COALESCE((
    SELECT MAX(e.revision)+1
    FROM canonical_product_image_events e
    WHERE e.promotion_id=NEW.promotion_id
      AND e.product_id=NEW.product_id
  ),1) THEN RAISE(ABORT,'canonical_product_image_revision_conflict') END;

  SELECT CASE WHEN NEW.product_provenance='IMPORT' AND NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.promotion_id=NEW.promotion_id
      AND p.product_id=NEW.product_id
      AND p.name=NEW.product_name
      AND p.image IS NEW.previous_image
  ) THEN RAISE(ABORT,'canonical_product_image_import_product_mismatch') END;

  SELECT CASE WHEN NEW.product_provenance='LIVE' AND NOT EXISTS (
    SELECT 1 FROM canonical_live_products p
    WHERE p.promotion_id=NEW.promotion_id
      AND p.product_id=NEW.product_id
      AND p.name=NEW.product_name
      AND p.image IS NEW.previous_image
  ) THEN RAISE(ABORT,'canonical_product_image_live_product_mismatch') END;
END;

DROP TRIGGER IF EXISTS canonical_product_image_events_no_update;
CREATE TRIGGER canonical_product_image_events_no_update
BEFORE UPDATE ON canonical_product_image_events
BEGIN SELECT RAISE(ABORT,'immutable_canonical_product_image_event'); END;

DROP TRIGGER IF EXISTS canonical_product_image_events_no_delete;
CREATE TRIGGER canonical_product_image_events_no_delete
BEFORE DELETE ON canonical_product_image_events
BEGIN SELECT RAISE(ABORT,'immutable_canonical_product_image_event'); END;

-- Imported product metadata/provenance stays sealed. The only newly permitted
-- metadata mutation is image-only and must match an append-only image event.
DROP TRIGGER IF EXISTS products_no_update;
CREATE TRIGGER products_no_update BEFORE UPDATE ON products
WHEN
  NEW.promotion_id<>OLD.promotion_id OR NEW.product_id<>OLD.product_id OR NEW.opening_stock_quantity IS NOT OLD.opening_stock_quantity OR
  NEW.name IS NOT OLD.name OR NEW.sku IS NOT OLD.sku OR NEW.barcode IS NOT OLD.barcode OR NEW.price_cents IS NOT OLD.price_cents OR
  NEW.alternate_codes_json IS NOT OLD.alternate_codes_json OR NEW.legacy_alternate_code IS NOT OLD.legacy_alternate_code OR
  NEW.category IS NOT OLD.category OR NEW.brand IS NOT OLD.brand OR NEW.description IS NOT OLD.description OR
  NEW.icon IS NOT OLD.icon OR NEW.unit IS NOT OLD.unit OR NEW.purchase_unit IS NOT OLD.purchase_unit OR
  NEW.purchase_factor IS NOT OLD.purchase_factor OR NEW.cost_cents IS NOT OLD.cost_cents OR NEW.box_price_cents IS NOT OLD.box_price_cents OR
  NEW.units_per_box IS NOT OLD.units_per_box OR NEW.stock_min_quantity IS NOT OLD.stock_min_quantity OR NEW.expiry_date IS NOT OLD.expiry_date OR
  NEW.includes_igv IS NOT OLD.includes_igv OR NEW.tax_type IS NOT OLD.tax_type OR NEW.complementary_tax IS NOT OLD.complementary_tax OR
  NEW.source_import_id<>OLD.source_import_id OR NEW.source_entity_type<>OLD.source_entity_type OR NEW.source_name<>OLD.source_name OR
  NEW.source_row<>OLD.source_row OR NEW.source_key<>OLD.source_key OR NEW.mapping_version<>OLD.mapping_version OR
  NEW.tracks_inventory IS NOT OLD.tracks_inventory OR NEW.source_payload_hash<>OLD.source_payload_hash OR NEW.source_payload_json<>OLD.source_payload_json OR
  (NEW.image IS NOT OLD.image AND NOT EXISTS(
    SELECT 1 FROM canonical_product_image_events e JOIN canonical_control c ON c.id=1
    WHERE e.promotion_id=OLD.promotion_id AND e.product_id=OLD.product_id AND e.product_provenance='IMPORT'
      AND e.product_name=OLD.name AND e.previous_image IS OLD.image AND e.image=NEW.image
      AND c.mode='ACTIVE' AND c.active_promotion_id=e.promotion_id
  )) OR
  NOT (
    (
      NEW.image IS NOT OLD.image AND NEW.current_stock_quantity IS OLD.current_stock_quantity AND NEW.stock_revision=OLD.stock_revision AND
      EXISTS(
        SELECT 1 FROM canonical_product_image_events e JOIN canonical_control c ON c.id=1
        WHERE e.promotion_id=OLD.promotion_id AND e.product_id=OLD.product_id AND e.product_provenance='IMPORT'
          AND e.product_name=OLD.name AND e.previous_image IS OLD.image AND e.image=NEW.image
          AND c.mode='ACTIVE' AND c.active_promotion_id=e.promotion_id
      )
    )
    OR
    (
      NEW.image IS OLD.image AND NEW.current_stock_quantity IS NOT NULL AND NEW.current_stock_quantity>=0 AND
      NEW.stock_revision=OLD.stock_revision+1 AND (
        EXISTS(
          SELECT 1 FROM canonical_write_guards g JOIN canonical_control c ON c.id=1
            JOIN canonical_sale_context x ON x.operation_id=g.operation_id
            JOIN sale_items i ON i.operation_id=g.operation_id AND i.sale_id=x.sale_id
          WHERE g.promotion_id=OLD.promotion_id AND c.mode='ACTIVE' AND c.active_promotion_id=g.promotion_id
            AND c.authority_epoch=g.authority_epoch AND c.revision=g.control_revision
            AND i.product_id=OLD.product_id AND NEW.current_stock_quantity=OLD.current_stock_quantity-i.quantity
            AND i.line_total_cents=round(i.quantity*i.unit_price_cents)
        )
        OR EXISTS(
          SELECT 1 FROM canonical_inventory_operations o JOIN canonical_control c ON c.id=1
          WHERE o.promotion_id=OLD.promotion_id AND o.product_id=OLD.product_id
            AND c.mode='ACTIVE' AND c.active_promotion_id=o.promotion_id
            AND c.authority_epoch=o.authority_epoch AND c.revision=o.control_revision
            AND o.expected_stock_revision=OLD.stock_revision
            AND NEW.current_stock_quantity=OLD.current_stock_quantity+o.delta
        )
      )
    )
  )
BEGIN SELECT RAISE(ABORT,'immutable_canonical_candidate'); END;

-- LIVE product metadata stays sealed with the same narrow image-only exception.
DROP TRIGGER IF EXISTS canonical_live_products_guarded_update;
CREATE TRIGGER canonical_live_products_guarded_update
BEFORE UPDATE ON canonical_live_products
WHEN
  NEW.promotion_id<>OLD.promotion_id OR NEW.product_id<>OLD.product_id OR NEW.operation_id<>OLD.operation_id OR
  NEW.opening_stock_quantity IS NOT OLD.opening_stock_quantity OR
  NEW.name IS NOT OLD.name OR NEW.sku IS NOT OLD.sku OR NEW.barcode IS NOT OLD.barcode OR
  NEW.alternate_codes_json IS NOT OLD.alternate_codes_json OR NEW.category IS NOT OLD.category OR
  NEW.brand IS NOT OLD.brand OR NEW.description IS NOT OLD.description OR NEW.icon IS NOT OLD.icon OR
  NEW.unit IS NOT OLD.unit OR NEW.purchase_unit IS NOT OLD.purchase_unit OR
  NEW.purchase_factor IS NOT OLD.purchase_factor OR NEW.cost_cents IS NOT OLD.cost_cents OR
  NEW.price_cents IS NOT OLD.price_cents OR NEW.box_price_cents IS NOT OLD.box_price_cents OR
  NEW.units_per_box IS NOT OLD.units_per_box OR NEW.stock_min_quantity IS NOT OLD.stock_min_quantity OR
  NEW.expiry_date IS NOT OLD.expiry_date OR NEW.includes_igv IS NOT OLD.includes_igv OR
  NEW.tax_type IS NOT OLD.tax_type OR NEW.complementary_tax IS NOT OLD.complementary_tax OR
  NEW.tracks_inventory IS NOT OLD.tracks_inventory OR NEW.created_at<>OLD.created_at OR
  (NEW.image IS NOT OLD.image AND NOT EXISTS(
    SELECT 1 FROM canonical_product_image_events e JOIN canonical_control c ON c.id=1
    WHERE e.promotion_id=OLD.promotion_id AND e.product_id=OLD.product_id AND e.product_provenance='LIVE'
      AND e.product_name=OLD.name AND e.previous_image IS OLD.image AND e.image=NEW.image
      AND c.mode='ACTIVE' AND c.active_promotion_id=e.promotion_id
  )) OR
  NOT (
    (
      NEW.image IS NOT OLD.image AND NEW.current_stock_quantity IS OLD.current_stock_quantity AND NEW.stock_revision=OLD.stock_revision AND
      EXISTS(
        SELECT 1 FROM canonical_product_image_events e JOIN canonical_control c ON c.id=1
        WHERE e.promotion_id=OLD.promotion_id AND e.product_id=OLD.product_id AND e.product_provenance='LIVE'
          AND e.product_name=OLD.name AND e.previous_image IS OLD.image AND e.image=NEW.image
          AND c.mode='ACTIVE' AND c.active_promotion_id=e.promotion_id
      )
    )
    OR
    (
      NEW.image IS OLD.image AND NEW.current_stock_quantity IS NOT NULL AND NEW.current_stock_quantity>=0 AND
      NEW.stock_revision=OLD.stock_revision+1 AND (
        EXISTS(
          SELECT 1 FROM canonical_write_guards g
            JOIN canonical_control c ON c.id=1
            JOIN canonical_sale_context x ON x.operation_id=g.operation_id
            JOIN sale_items i ON i.operation_id=g.operation_id AND i.sale_id=x.sale_id
          WHERE c.mode='ACTIVE' AND c.active_promotion_id=OLD.promotion_id
            AND g.promotion_id=OLD.promotion_id AND c.authority_epoch=g.authority_epoch
            AND c.revision=g.control_revision AND i.product_id=OLD.product_id
            AND NEW.current_stock_quantity=OLD.current_stock_quantity-i.quantity
            AND i.line_total_cents=round(i.quantity*i.unit_price_cents)
        )
        OR EXISTS(
          SELECT 1 FROM canonical_inventory_operations o JOIN canonical_control c ON c.id=1
          WHERE o.promotion_id=OLD.promotion_id AND o.product_id=OLD.product_id
            AND c.mode='ACTIVE' AND c.active_promotion_id=o.promotion_id
            AND c.authority_epoch=o.authority_epoch AND c.revision=o.control_revision
            AND o.expected_stock_revision=OLD.stock_revision
            AND NEW.current_stock_quantity=OLD.current_stock_quantity+o.delta
        )
      )
    )
  )
BEGIN SELECT RAISE(ABORT,'immutable_live_product'); END;
