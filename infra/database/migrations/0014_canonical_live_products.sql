PRAGMA foreign_keys = ON;

-- Operational products created after cutover are intentionally separated from
-- the sealed import image in products.
CREATE TABLE IF NOT EXISTS canonical_product_operations (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 160),
  command TEXT NOT NULL CHECK(command='product.create'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  product_id TEXT NOT NULL CHECK(length(product_id) BETWEEN 1 AND 160),
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=0),
  control_revision INTEGER NOT NULL CHECK(control_revision>=0),
  client_contract TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES devices(device_id),
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64 AND credential_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_live_products (
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  product_id TEXT NOT NULL CHECK(length(product_id) BETWEEN 1 AND 160),
  operation_id TEXT NOT NULL UNIQUE REFERENCES canonical_product_operations(operation_id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 240),
  sku TEXT,
  barcode TEXT,
  alternate_codes_json TEXT CHECK(alternate_codes_json IS NULL OR json_valid(alternate_codes_json)),
  legacy_alternate_code TEXT,
  category TEXT,
  brand TEXT,
  description TEXT,
  icon TEXT,
  image TEXT,
  unit TEXT,
  purchase_unit TEXT,
  purchase_factor REAL CHECK(purchase_factor IS NULL OR (purchase_factor=purchase_factor AND purchase_factor>0 AND abs(purchase_factor)<1.7976931348623157e308)),
  cost_cents INTEGER CHECK(cost_cents IS NULL OR (cost_cents>=0 AND cost_cents<=9007199254740991)),
  price_cents INTEGER NOT NULL CHECK(price_cents>0 AND price_cents<=9007199254740991),
  box_price_cents INTEGER CHECK(box_price_cents IS NULL OR (box_price_cents>0 AND box_price_cents<=9007199254740991)),
  units_per_box REAL CHECK(units_per_box IS NULL OR (units_per_box=units_per_box AND units_per_box>0 AND abs(units_per_box)<1.7976931348623157e308)),
  opening_stock_quantity REAL NOT NULL CHECK(opening_stock_quantity=opening_stock_quantity AND opening_stock_quantity>=0),
  current_stock_quantity REAL NOT NULL CHECK(current_stock_quantity=current_stock_quantity AND current_stock_quantity>=0),
  stock_revision INTEGER NOT NULL DEFAULT 0 CHECK(stock_revision>=0),
  stock_min_quantity REAL NOT NULL DEFAULT 0 CHECK(stock_min_quantity=stock_min_quantity AND stock_min_quantity>=0),
  expiry_date TEXT,
  includes_igv INTEGER NOT NULL CHECK(includes_igv IN (0,1)),
  tax_type TEXT,
  complementary_tax TEXT,
  tracks_inventory INTEGER NOT NULL CHECK(tracks_inventory IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(promotion_id,product_id)
);

CREATE TABLE IF NOT EXISTS canonical_live_inventory_effects (
  movement_id TEXT PRIMARY KEY NOT NULL REFERENCES inventory_movements(movement_id),
  operation_id TEXT NOT NULL,
  promotion_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  stock_revision_before INTEGER NOT NULL CHECK(stock_revision_before>=0),
  stock_revision_after INTEGER NOT NULL CHECK(stock_revision_after=stock_revision_before+1),
  quantity REAL NOT NULL CHECK(quantity<0),
  FOREIGN KEY(promotion_id,product_id) REFERENCES canonical_live_products(promotion_id,product_id),
  UNIQUE(operation_id,product_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_live_products_name
  ON canonical_live_products(promotion_id,name,product_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_canonical_live_products_sku
  ON canonical_live_products(promotion_id,lower(sku))
  WHERE sku IS NOT NULL AND trim(sku)<>'';
CREATE UNIQUE INDEX IF NOT EXISTS ux_canonical_live_products_barcode
  ON canonical_live_products(promotion_id,lower(barcode))
  WHERE barcode IS NOT NULL AND trim(barcode)<>'';

DROP VIEW IF EXISTS canonical_product_codes;
CREATE VIEW canonical_product_codes AS
  SELECT promotion_id,product_id,lower(trim(sku)) AS code,'sku' AS code_type
    FROM products WHERE sku IS NOT NULL AND trim(sku)<>''
  UNION ALL
  SELECT promotion_id,product_id,lower(trim(barcode)),'barcode'
    FROM products WHERE barcode IS NOT NULL AND trim(barcode)<>''
  UNION ALL
  SELECT promotion_id,product_id,lower(trim(legacy_alternate_code)),'alternate'
    FROM products WHERE legacy_alternate_code IS NOT NULL AND trim(legacy_alternate_code)<>''
  UNION ALL
  SELECT p.promotion_id,p.product_id,lower(trim(CAST(j.value AS TEXT))),'alternate'
    FROM products p,json_each(p.alternate_codes_json) j
    WHERE j.type='text' AND trim(CAST(j.value AS TEXT))<>''
  UNION ALL
  SELECT promotion_id,product_id,lower(trim(sku)),'sku'
    FROM canonical_live_products WHERE sku IS NOT NULL AND trim(sku)<>''
  UNION ALL
  SELECT promotion_id,product_id,lower(trim(barcode)),'barcode'
    FROM canonical_live_products WHERE barcode IS NOT NULL AND trim(barcode)<>''
  UNION ALL
  SELECT p.promotion_id,p.product_id,lower(trim(CAST(j.value AS TEXT))),'alternate'
    FROM canonical_live_products p,json_each(p.alternate_codes_json) j
    WHERE j.type='text' AND trim(CAST(j.value AS TEXT))<>'';

CREATE TRIGGER IF NOT EXISTS canonical_product_operations_authorized_insert
BEFORE INSERT ON canonical_product_operations
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_control c JOIN devices d ON d.device_id=NEW.principal_id
  WHERE c.id=1 AND c.mode='ACTIVE' AND c.active_promotion_id=NEW.promotion_id
    AND c.authority_epoch=NEW.authority_epoch AND c.revision=NEW.control_revision
    AND c.minimum_client_contract=NEW.client_contract
    AND d.role='writer' AND d.status='active' AND d.credential_hash=NEW.credential_hash
)
BEGIN SELECT RAISE(ABORT,'stale_authority'); END;

CREATE TRIGGER IF NOT EXISTS canonical_product_operations_no_update
BEFORE UPDATE ON canonical_product_operations
BEGIN SELECT RAISE(ABORT,'immutable_product_operation'); END;
CREATE TRIGGER IF NOT EXISTS canonical_product_operations_no_delete
BEFORE DELETE ON canonical_product_operations
BEGIN SELECT RAISE(ABORT,'immutable_product_operation'); END;
CREATE TRIGGER IF NOT EXISTS canonical_product_operations_no_replace
BEFORE INSERT ON canonical_product_operations
WHEN EXISTS(SELECT 1 FROM canonical_product_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'product_operation_replace_forbidden'); END;

CREATE TRIGGER IF NOT EXISTS canonical_live_products_authorized_insert
BEFORE INSERT ON canonical_live_products
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_product_operations o
  WHERE o.operation_id=NEW.operation_id AND o.command='product.create'
    AND o.promotion_id=NEW.promotion_id AND o.product_id=NEW.product_id
)
BEGIN SELECT RAISE(ABORT,'invalid_product_create'); END;

CREATE TRIGGER IF NOT EXISTS canonical_live_products_validate_insert
BEFORE INSERT ON canonical_live_products
WHEN
  NEW.current_stock_quantity<>NEW.opening_stock_quantity OR NEW.stock_revision<>0
  OR (NEW.tracks_inventory=0 AND (NEW.opening_stock_quantity<>0 OR NEW.stock_min_quantity<>0))
  OR (NEW.alternate_codes_json IS NOT NULL AND (json_type(NEW.alternate_codes_json)<>'array' OR json_array_length(NEW.alternate_codes_json)>10))
  OR EXISTS(SELECT 1 FROM json_each(NEW.alternate_codes_json) WHERE type<>'text' OR trim(CAST(value AS TEXT))='')
  OR EXISTS(SELECT 1 FROM products p WHERE p.promotion_id=NEW.promotion_id AND p.product_id=NEW.product_id)
  OR EXISTS(SELECT 1 FROM canonical_product_codes c
      WHERE c.promotion_id=NEW.promotion_id AND c.code IN (
        SELECT lower(trim(NEW.sku)) WHERE NEW.sku IS NOT NULL AND trim(NEW.sku)<>''
        UNION ALL SELECT lower(trim(NEW.barcode)) WHERE NEW.barcode IS NOT NULL AND trim(NEW.barcode)<>''
        UNION ALL SELECT lower(trim(CAST(value AS TEXT))) FROM json_each(NEW.alternate_codes_json) WHERE type='text' AND trim(CAST(value AS TEXT))<>''
      ))
  OR (
    SELECT COUNT(*) FROM (
      SELECT lower(trim(NEW.sku)) AS code WHERE NEW.sku IS NOT NULL AND trim(NEW.sku)<>''
      UNION ALL SELECT lower(trim(NEW.barcode)) WHERE NEW.barcode IS NOT NULL AND trim(NEW.barcode)<>''
      UNION ALL SELECT lower(trim(CAST(value AS TEXT))) FROM json_each(NEW.alternate_codes_json) WHERE type='text' AND trim(CAST(value AS TEXT))<>''
    )
  ) <> (
    SELECT COUNT(DISTINCT code) FROM (
      SELECT lower(trim(NEW.sku)) AS code WHERE NEW.sku IS NOT NULL AND trim(NEW.sku)<>''
      UNION ALL SELECT lower(trim(NEW.barcode)) WHERE NEW.barcode IS NOT NULL AND trim(NEW.barcode)<>''
      UNION ALL SELECT lower(trim(CAST(value AS TEXT))) FROM json_each(NEW.alternate_codes_json) WHERE type='text' AND trim(CAST(value AS TEXT))<>''
    )
  )
BEGIN SELECT RAISE(ABORT,'invalid_live_product'); END;

CREATE TRIGGER IF NOT EXISTS canonical_live_products_no_replace
BEFORE INSERT ON canonical_live_products
WHEN EXISTS(SELECT 1 FROM canonical_live_products WHERE promotion_id=NEW.promotion_id AND product_id=NEW.product_id)
BEGIN SELECT RAISE(ABORT,'live_product_replace_forbidden'); END;

-- Metadata is immutable in product.create v1. Stock can only decrease through a
-- sale guarded by the existing canonical sale CAS.
CREATE TRIGGER IF NOT EXISTS canonical_live_products_guarded_update
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
  OR NEW.current_stock_quantity>=OLD.current_stock_quantity
  OR NEW.stock_revision<>OLD.stock_revision+1
  OR NOT EXISTS(
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
BEGIN SELECT RAISE(ABORT,'immutable_live_product'); END;

CREATE TRIGGER IF NOT EXISTS canonical_live_products_no_delete
BEFORE DELETE ON canonical_live_products
BEGIN SELECT RAISE(ABORT,'immutable_live_product'); END;

CREATE TRIGGER IF NOT EXISTS canonical_live_inventory_effect_authorized_insert
BEFORE INSERT ON canonical_live_inventory_effects
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_write_guards g
    JOIN inventory_movements m ON m.operation_id=g.operation_id
  WHERE g.operation_id=NEW.operation_id AND g.promotion_id=NEW.promotion_id
    AND m.movement_id=NEW.movement_id AND m.product_id=NEW.product_id
    AND m.quantity=NEW.quantity
)
BEGIN SELECT RAISE(ABORT,'invalid_live_inventory_effect'); END;
CREATE TRIGGER IF NOT EXISTS canonical_live_inventory_effects_no_update
BEFORE UPDATE ON canonical_live_inventory_effects
BEGIN SELECT RAISE(ABORT,'immutable_live_inventory_effect'); END;
CREATE TRIGGER IF NOT EXISTS canonical_live_inventory_effects_no_delete
BEFORE DELETE ON canonical_live_inventory_effects
BEGIN SELECT RAISE(ABORT,'immutable_live_inventory_effect'); END;


-- Sale item authorization must accept the unified IMPORT + LIVE catalog.
DROP TRIGGER IF EXISTS canonical_sale_item_authorized_insert;
CREATE TRIGGER canonical_sale_item_authorized_insert BEFORE INSERT ON sale_items
WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' AND NOT EXISTS(
  SELECT 1 FROM canonical_write_guards g
    JOIN canonical_sale_context x ON x.operation_id=g.operation_id
  WHERE g.operation_id=NEW.operation_id AND x.sale_id=NEW.sale_id
    AND NEW.line_total_cents=round(NEW.quantity*NEW.unit_price_cents)
    AND (
      EXISTS(SELECT 1 FROM products p WHERE p.promotion_id=g.promotion_id AND p.product_id=NEW.product_id)
      OR EXISTS(SELECT 1 FROM canonical_live_products p WHERE p.promotion_id=g.promotion_id AND p.product_id=NEW.product_id)
    )
)
BEGIN SELECT RAISE(ABORT,'invalid_sale_item'); END;
