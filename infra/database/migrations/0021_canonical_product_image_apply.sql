-- Make one append-only image event the atomic authorization + mutation unit.
-- The BEFORE guard from 0020 validates product identity and exact previous image.
-- The AFTER trigger performs the image-only update while products_no_update /
-- canonical_live_products_guarded_update re-check the matching event.

PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS canonical_product_image_events_noop_guard
BEFORE INSERT ON canonical_product_image_events
WHEN NEW.image IS NEW.previous_image
BEGIN SELECT RAISE(ABORT,'canonical_product_image_noop'); END;

CREATE TRIGGER IF NOT EXISTS canonical_product_image_events_apply_import
AFTER INSERT ON canonical_product_image_events
WHEN NEW.product_provenance='IMPORT'
BEGIN
  UPDATE products
     SET image=NEW.image
   WHERE promotion_id=NEW.promotion_id
     AND product_id=NEW.product_id
     AND name=NEW.product_name
     AND image IS NEW.previous_image;
  SELECT CASE WHEN changes()<>1
    THEN RAISE(ABORT,'canonical_product_image_import_apply_failed') END;
END;

CREATE TRIGGER IF NOT EXISTS canonical_product_image_events_apply_live
AFTER INSERT ON canonical_product_image_events
WHEN NEW.product_provenance='LIVE'
BEGIN
  UPDATE canonical_live_products
     SET image=NEW.image
   WHERE promotion_id=NEW.promotion_id
     AND product_id=NEW.product_id
     AND name=NEW.product_name
     AND image IS NEW.previous_image;
  SELECT CASE WHEN changes()<>1
    THEN RAISE(ABORT,'canonical_product_image_live_apply_failed') END;
END;
