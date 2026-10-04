-- CANON product image overlay ledger.
--
-- Imported products remain protected by products_no_update/products_no_delete.
-- LIVE product metadata remains protected by canonical_live_products_guarded_update.
-- This migration adds only an append-only visual overlay; commercial metadata and
-- inventory state are never updated by this feature.

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
  ) THEN RAISE(ABORT,'canonical_product_image_import_product_mismatch') END;

  SELECT CASE WHEN NEW.product_provenance='LIVE' AND NOT EXISTS (
    SELECT 1 FROM canonical_live_products p
    WHERE p.promotion_id=NEW.promotion_id
      AND p.product_id=NEW.product_id
      AND p.name=NEW.product_name
  ) THEN RAISE(ABORT,'canonical_product_image_live_product_mismatch') END;
END;

DROP TRIGGER IF EXISTS canonical_product_image_events_no_update;
CREATE TRIGGER canonical_product_image_events_no_update
BEFORE UPDATE ON canonical_product_image_events
BEGIN
  SELECT RAISE(ABORT,'immutable_canonical_product_image_event');
END;

DROP TRIGGER IF EXISTS canonical_product_image_events_no_delete;
CREATE TRIGGER canonical_product_image_events_no_delete
BEFORE DELETE ON canonical_product_image_events
BEGIN
  SELECT RAISE(ABORT,'immutable_canonical_product_image_event');
END;
