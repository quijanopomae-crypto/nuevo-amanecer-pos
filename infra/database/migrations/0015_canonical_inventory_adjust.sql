PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_inventory_operations (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 160),
  command TEXT NOT NULL CHECK(command='inventory.adjust'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  product_id TEXT NOT NULL CHECK(length(product_id) BETWEEN 1 AND 160),
  movement_type TEXT NOT NULL CHECK(movement_type IN ('ENTRADA','SALIDA')),
  quantity REAL NOT NULL CHECK(quantity=quantity AND quantity>0),
  delta REAL NOT NULL CHECK(delta=delta AND delta<>0),
  expected_stock_revision INTEGER NOT NULL CHECK(expected_stock_revision>=0),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=0),
  control_revision INTEGER NOT NULL CHECK(control_revision>=0),
  client_contract TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES devices(device_id),
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64 AND credential_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_manual_inventory_movements (
  movement_id TEXT PRIMARY KEY NOT NULL CHECK(length(movement_id) BETWEEN 1 AND 160),
  operation_id TEXT NOT NULL UNIQUE REFERENCES canonical_inventory_operations(operation_id),
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  product_id TEXT NOT NULL CHECK(length(product_id) BETWEEN 1 AND 160),
  product_provenance TEXT NOT NULL CHECK(product_provenance IN ('IMPORT','LIVE')),
  movement_type TEXT NOT NULL CHECK(movement_type IN ('ENTRADA','SALIDA')),
  quantity REAL NOT NULL CHECK(quantity=quantity AND quantity>0),
  delta REAL NOT NULL CHECK(delta=delta AND delta<>0),
  stock_before REAL NOT NULL CHECK(stock_before=stock_before AND stock_before>=0),
  stock_after REAL NOT NULL CHECK(stock_after=stock_after AND stock_after>=0 AND stock_after=stock_before+delta),
  stock_revision_before INTEGER NOT NULL CHECK(stock_revision_before>=0),
  stock_revision_after INTEGER NOT NULL CHECK(stock_revision_after=stock_revision_before+1),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_manual_inventory_product
  ON canonical_manual_inventory_movements(promotion_id,product_id,created_at,movement_id);

CREATE TRIGGER IF NOT EXISTS canonical_inventory_operations_authorized_insert
BEFORE INSERT ON canonical_inventory_operations
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_control c JOIN devices d ON d.device_id=NEW.principal_id
  WHERE c.id=1 AND c.mode='ACTIVE' AND c.active_promotion_id=NEW.promotion_id
    AND c.authority_epoch=NEW.authority_epoch AND c.revision=NEW.control_revision
    AND c.minimum_client_contract=NEW.client_contract
    AND d.role='writer' AND d.status='active' AND d.credential_hash=NEW.credential_hash
)
BEGIN SELECT RAISE(ABORT,'stale_authority'); END;

CREATE TRIGGER IF NOT EXISTS canonical_inventory_operations_no_update
BEFORE UPDATE ON canonical_inventory_operations
BEGIN SELECT RAISE(ABORT,'immutable_inventory_operation'); END;
CREATE TRIGGER IF NOT EXISTS canonical_inventory_operations_no_delete
BEFORE DELETE ON canonical_inventory_operations
BEGIN SELECT RAISE(ABORT,'immutable_inventory_operation'); END;
CREATE TRIGGER IF NOT EXISTS canonical_inventory_operations_no_replace
BEFORE INSERT ON canonical_inventory_operations
WHEN EXISTS(SELECT 1 FROM canonical_inventory_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'inventory_operation_replace_forbidden'); END;

CREATE TRIGGER IF NOT EXISTS canonical_manual_inventory_authorized_insert
BEFORE INSERT ON canonical_manual_inventory_movements
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_inventory_operations o
  WHERE o.operation_id=NEW.operation_id AND o.promotion_id=NEW.promotion_id
    AND o.product_id=NEW.product_id AND o.movement_type=NEW.movement_type
    AND o.quantity=NEW.quantity AND o.delta=NEW.delta
    AND o.expected_stock_revision=NEW.stock_revision_before
    AND NEW.stock_revision_after=NEW.stock_revision_before+1
    AND o.reason=NEW.reason AND o.created_at=NEW.created_at
)
BEGIN SELECT RAISE(ABORT,'invalid_manual_inventory_movement'); END;

CREATE TRIGGER IF NOT EXISTS canonical_manual_inventory_no_update
BEFORE UPDATE ON canonical_manual_inventory_movements
BEGIN SELECT RAISE(ABORT,'immutable_manual_inventory_movement'); END;
CREATE TRIGGER IF NOT EXISTS canonical_manual_inventory_no_delete
BEFORE DELETE ON canonical_manual_inventory_movements
BEGIN SELECT RAISE(ABORT,'immutable_manual_inventory_movement'); END;

-- Imported product metadata/provenance stays sealed. Stock may change only
-- through an authorized sale or an authorized inventory.adjust operation.
DROP TRIGGER IF EXISTS products_no_update;
CREATE TRIGGER products_no_update BEFORE UPDATE ON products
WHEN NEW.promotion_id<>OLD.promotion_id OR NEW.product_id<>OLD.product_id OR NEW.opening_stock_quantity IS NOT OLD.opening_stock_quantity OR
 NEW.name IS NOT OLD.name OR NEW.sku IS NOT OLD.sku OR NEW.barcode IS NOT OLD.barcode OR NEW.price_cents IS NOT OLD.price_cents OR
 NEW.alternate_codes_json IS NOT OLD.alternate_codes_json OR NEW.legacy_alternate_code IS NOT OLD.legacy_alternate_code OR
 NEW.category IS NOT OLD.category OR NEW.brand IS NOT OLD.brand OR NEW.description IS NOT OLD.description OR
 NEW.icon IS NOT OLD.icon OR NEW.image IS NOT OLD.image OR NEW.unit IS NOT OLD.unit OR NEW.purchase_unit IS NOT OLD.purchase_unit OR
 NEW.purchase_factor IS NOT OLD.purchase_factor OR NEW.cost_cents IS NOT OLD.cost_cents OR NEW.box_price_cents IS NOT OLD.box_price_cents OR
 NEW.units_per_box IS NOT OLD.units_per_box OR NEW.stock_min_quantity IS NOT OLD.stock_min_quantity OR NEW.expiry_date IS NOT OLD.expiry_date OR
 NEW.includes_igv IS NOT OLD.includes_igv OR NEW.tax_type IS NOT OLD.tax_type OR NEW.complementary_tax IS NOT OLD.complementary_tax OR
 NEW.source_import_id<>OLD.source_import_id OR NEW.source_entity_type<>OLD.source_entity_type OR NEW.source_name<>OLD.source_name OR
 NEW.source_row<>OLD.source_row OR NEW.source_key<>OLD.source_key OR NEW.mapping_version<>OLD.mapping_version OR
 NEW.tracks_inventory IS NOT OLD.tracks_inventory OR NEW.source_payload_hash<>OLD.source_payload_hash OR NEW.source_payload_json<>OLD.source_payload_json OR
 NEW.current_stock_quantity IS NULL OR NEW.current_stock_quantity<0 OR NEW.stock_revision<>OLD.stock_revision+1 OR NOT (
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
BEGIN SELECT RAISE(ABORT,'immutable_canonical_candidate'); END;

-- LIVE metadata stays immutable. Stock may change only through an authorized
-- sale or an authorized inventory.adjust operation.
DROP TRIGGER IF EXISTS canonical_live_products_guarded_update;
CREATE TRIGGER canonical_live_products_guarded_update
BEFORE UPDATE ON canonical_live_products
WHEN NEW.promotion_id<>OLD.promotion_id OR NEW.product_id<>OLD.product_id OR NEW.operation_id<>OLD.operation_id
  OR NEW.opening_stock_quantity IS NOT OLD.opening_stock_quantity
  OR NEW.name IS NOT OLD.name OR NEW.sku IS NOT OLD.sku OR NEW.barcode IS NOT OLD.barcode
  OR NEW.alternate_codes_json IS NOT OLD.alternate_codes_json OR NEW.category IS NOT OLD.category
  OR NEW.brand IS NOT OLD.brand OR NEW.description IS NOT OLD.description OR NEW.icon IS NOT OLD.icon
  OR NEW.image IS NOT OLD.image OR NEW.unit IS NOT OLD.unit OR NEW.purchase_unit IS NOT OLD.purchase_unit
  OR NEW.purchase_factor IS NOT OLD.purchase_factor OR NEW.cost_cents IS NOT OLD.cost_cents
  OR NEW.price_cents IS NOT OLD.price_cents OR NEW.box_price_cents IS NOT OLD.box_price_cents
  OR NEW.units_per_box IS NOT OLD.units_per_box OR NEW.stock_min_quantity IS NOT OLD.stock_min_quantity
  OR NEW.expiry_date IS NOT OLD.expiry_date OR NEW.includes_igv IS NOT OLD.includes_igv
  OR NEW.tax_type IS NOT OLD.tax_type OR NEW.complementary_tax IS NOT OLD.complementary_tax
  OR NEW.tracks_inventory IS NOT OLD.tracks_inventory OR NEW.created_at<>OLD.created_at
  OR NEW.current_stock_quantity IS NULL OR NEW.current_stock_quantity<0
  OR NEW.stock_revision<>OLD.stock_revision+1 OR NOT (
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
BEGIN SELECT RAISE(ABORT,'immutable_live_product'); END;
