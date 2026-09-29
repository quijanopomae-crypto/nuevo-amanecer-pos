PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_generic_sale_lines (
  sale_id TEXT NOT NULL REFERENCES sales(sale_id),
  line_number INTEGER NOT NULL CHECK(line_number>=1),
  operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 160),
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  generic_product_id TEXT NOT NULL UNIQUE CHECK(length(generic_product_id) BETWEEN 9 AND 160 AND substr(generic_product_id,1,8)='GENERIC:'),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 240),
  code TEXT CHECK(code IS NULL OR length(trim(code)) BETWEEN 1 AND 160),
  quantity REAL NOT NULL CHECK(quantity=quantity AND quantity>0 AND quantity<=9999 AND quantity=CAST(quantity AS INTEGER)),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>0 AND unit_price_cents<=9007199254740991),
  line_total_cents INTEGER NOT NULL CHECK(line_total_cents>0 AND line_total_cents<=9007199254740991 AND line_total_cents=round(quantity*unit_price_cents)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(sale_id,line_number),
  UNIQUE(operation_id,line_number)
);

CREATE INDEX IF NOT EXISTS idx_canonical_generic_sale_operation
  ON canonical_generic_sale_lines(promotion_id,operation_id,line_number);

CREATE TRIGGER IF NOT EXISTS canonical_generic_sale_line_authorized_insert
BEFORE INSERT ON canonical_generic_sale_lines
WHEN NOT EXISTS(
  SELECT 1
  FROM canonical_write_guards g
    JOIN canonical_sale_context x ON x.operation_id=g.operation_id
    JOIN sales s ON s.operation_id=g.operation_id AND s.sale_id=x.sale_id
  WHERE g.operation_id=NEW.operation_id
    AND x.sale_id=NEW.sale_id
    AND g.promotion_id=NEW.promotion_id
    AND s.sale_id=NEW.sale_id
    AND NOT EXISTS(
      SELECT 1 FROM products p
      WHERE p.promotion_id=NEW.promotion_id AND p.product_id=NEW.generic_product_id
    )
    AND NOT EXISTS(
      SELECT 1 FROM canonical_live_products p
      WHERE p.promotion_id=NEW.promotion_id AND p.product_id=NEW.generic_product_id
    )
)
BEGIN SELECT RAISE(ABORT,'invalid_generic_sale_line'); END;

CREATE TRIGGER IF NOT EXISTS canonical_generic_sale_line_no_update
BEFORE UPDATE ON canonical_generic_sale_lines
BEGIN SELECT RAISE(ABORT,'immutable_generic_sale_line'); END;

CREATE TRIGGER IF NOT EXISTS canonical_generic_sale_line_no_delete
BEFORE DELETE ON canonical_generic_sale_lines
BEGIN SELECT RAISE(ABORT,'immutable_generic_sale_line'); END;

CREATE TRIGGER IF NOT EXISTS canonical_generic_sale_line_no_replace
BEFORE INSERT ON canonical_generic_sale_lines
WHEN EXISTS(
  SELECT 1 FROM canonical_generic_sale_lines
  WHERE rowid=NEW.rowid
    OR (sale_id=NEW.sale_id AND line_number=NEW.line_number)
    OR (operation_id=NEW.operation_id AND line_number=NEW.line_number)
    OR generic_product_id=NEW.generic_product_id
)
BEGIN SELECT RAISE(ABORT,'generic_sale_line_replace_forbidden'); END;

-- Keep the normal product fence and add one narrow alternative for a generic
-- line whose immutable metadata matches this exact sale line.
DROP TRIGGER IF EXISTS canonical_sale_item_authorized_insert;
CREATE TRIGGER canonical_sale_item_authorized_insert BEFORE INSERT ON sale_items
WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' AND NOT EXISTS(
  SELECT 1
  FROM canonical_write_guards g
    JOIN canonical_sale_context x ON x.operation_id=g.operation_id
  WHERE g.operation_id=NEW.operation_id
    AND x.sale_id=NEW.sale_id
    AND NEW.line_total_cents=round(NEW.quantity*NEW.unit_price_cents)
    AND (
      EXISTS(
        SELECT 1 FROM products p
        WHERE p.promotion_id=g.promotion_id AND p.product_id=NEW.product_id
      )
      OR EXISTS(
        SELECT 1 FROM canonical_live_products p
        WHERE p.promotion_id=g.promotion_id AND p.product_id=NEW.product_id
      )
      OR EXISTS(
        SELECT 1 FROM canonical_generic_sale_lines v
        WHERE v.sale_id=NEW.sale_id
          AND v.line_number=NEW.line_number
          AND v.operation_id=NEW.operation_id
          AND v.promotion_id=g.promotion_id
          AND v.generic_product_id=NEW.product_id
          AND v.quantity=NEW.quantity
          AND v.unit_price_cents=NEW.unit_price_cents
          AND v.line_total_cents=NEW.line_total_cents
      )
    )
)
BEGIN SELECT RAISE(ABORT,'invalid_sale_item'); END;
