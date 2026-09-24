PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_write_guards (
  operation_id TEXT PRIMARY KEY NOT NULL,
  commit_token TEXT NOT NULL UNIQUE,
  promotion_id TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL,
  control_revision INTEGER NOT NULL,
  client_contract TEXT NOT NULL,
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id)
);

CREATE TABLE IF NOT EXISTS canonical_sale_context (
  sale_id TEXT PRIMARY KEY NOT NULL REFERENCES sales(sale_id),
  operation_id TEXT NOT NULL UNIQUE,
  promotion_id TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=0),
  control_revision INTEGER NOT NULL CHECK(control_revision>=0),
  customer_id TEXT,
  client_contract TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id),
  FOREIGN KEY(promotion_id,customer_id) REFERENCES customers(promotion_id,customer_id)
);

CREATE TABLE IF NOT EXISTS live_credits (
  promotion_id TEXT NOT NULL,
  credit_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(sale_id),
  customer_id TEXT NOT NULL,
  original_amount_cents INTEGER NOT NULL CHECK(original_amount_cents>0),
  current_balance_cents INTEGER NOT NULL CHECK(current_balance_cents=original_amount_cents),
  due_date TEXT NOT NULL CHECK(length(due_date)=10),
  status TEXT NOT NULL CHECK(status='LIVE'),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision=0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(promotion_id,credit_id),
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id),
  FOREIGN KEY(promotion_id,customer_id) REFERENCES customers(promotion_id,customer_id)
);

CREATE TABLE IF NOT EXISTS canonical_inventory_effects (
  movement_id TEXT PRIMARY KEY NOT NULL REFERENCES inventory_movements(movement_id),
  operation_id TEXT NOT NULL,
  promotion_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  stock_revision_before INTEGER NOT NULL CHECK(stock_revision_before>=0),
  stock_revision_after INTEGER NOT NULL CHECK(stock_revision_after=stock_revision_before+1),
  quantity REAL NOT NULL CHECK(quantity<0),
  FOREIGN KEY(promotion_id,product_id) REFERENCES products(promotion_id,product_id),
  UNIQUE(operation_id,product_id)
);

CREATE INDEX IF NOT EXISTS idx_live_credits_customer ON live_credits(promotion_id,customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_context_promotion ON canonical_sale_context(promotion_id,sale_id);

-- Financial facts are append-only in every authority mode. Corrections require a
-- separately authorized reversal/compensating command; direct mutation is never one.
DROP TRIGGER IF EXISTS fence_sales_update;
DROP TRIGGER IF EXISTS fence_sales_delete;
DROP TRIGGER IF EXISTS fence_sale_items_update;
DROP TRIGGER IF EXISTS fence_sale_items_delete;
DROP TRIGGER IF EXISTS fence_inventory_update;
DROP TRIGGER IF EXISTS fence_inventory_delete;
DROP TRIGGER IF EXISTS fence_cash_update;
DROP TRIGGER IF EXISTS fence_cash_delete;
CREATE TRIGGER fence_sales_update BEFORE UPDATE ON sales BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER fence_sales_delete BEFORE DELETE ON sales BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER fence_sale_items_update BEFORE UPDATE ON sale_items BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER fence_sale_items_delete BEFORE DELETE ON sale_items BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER fence_inventory_update BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER fence_inventory_delete BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER fence_cash_update BEFORE UPDATE ON cash_movements BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER fence_cash_delete BEFORE DELETE ON cash_movements BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;

-- A generated LIVE identity must never alias an imported credit/history.
CREATE TRIGGER IF NOT EXISTS live_credits_no_import_collision BEFORE INSERT ON live_credits
WHEN EXISTS(SELECT 1 FROM credits WHERE promotion_id=NEW.promotion_id AND credit_id=NEW.credit_id)
BEGIN SELECT RAISE(ABORT,'credit_id_conflict'); END;

-- Preserve Gate P transitions; only an in-flight ACTIVE sale may set the marker.
-- Later sales perform the same marker-only UPDATE without changing its value.
-- This does not provide an activation path or replace the no-reset trigger.
DROP TRIGGER IF EXISTS canonical_control_no_legacy;
CREATE TRIGGER canonical_control_no_legacy BEFORE UPDATE ON canonical_control
WHEN (NEW.mode='ACTIVE' OR (OLD.mode<>'LEGACY' AND NEW.mode='LEGACY') OR NEW.revision<>OLD.revision+1 OR NEW.authority_epoch<>OLD.authority_epoch+1 OR
  (NEW.mode='CANONICAL_READ_ONLY' AND NOT EXISTS(SELECT 1 FROM canonical_promotions p WHERE p.promotion_id=NEW.active_promotion_id AND p.status='COMMITTED')))
 AND NOT (
  OLD.mode='ACTIVE' AND NEW.mode IS OLD.mode AND NEW.id IS OLD.id
  AND NEW.active_promotion_id IS OLD.active_promotion_id AND NEW.revision IS OLD.revision
  AND NEW.authority_epoch IS OLD.authority_epoch AND NEW.writer_device_id IS OLD.writer_device_id
  AND NEW.minimum_client_contract IS OLD.minimum_client_contract
  AND NEW.first_live_operation_id IS NOT NULL
  AND (OLD.first_live_operation_id IS NULL OR NEW.first_live_operation_id IS OLD.first_live_operation_id)
  AND EXISTS (
    SELECT 1 FROM canonical_write_guards g
    JOIN sales s ON s.operation_id=g.operation_id AND s.commit_token=g.commit_token
    JOIN canonical_sale_context x ON x.sale_id=s.sale_id AND x.operation_id=g.operation_id
    WHERE g.promotion_id=OLD.active_promotion_id AND g.authority_epoch=OLD.authority_epoch
    AND g.control_revision=OLD.revision AND g.client_contract=OLD.minimum_client_contract
    AND s.device_id=OLD.writer_device_id
    AND x.promotion_id=g.promotion_id AND x.authority_epoch=g.authority_epoch
    AND x.control_revision=g.control_revision AND x.client_contract=g.client_contract
    AND (OLD.first_live_operation_id IS NOT NULL OR (NEW.first_live_operation_id=g.operation_id
      AND NOT EXISTS(SELECT 1 FROM canonical_sale_context prior WHERE prior.operation_id<>g.operation_id)))
    AND EXISTS(SELECT 1 FROM sale_items i WHERE i.sale_id=s.sale_id AND i.operation_id=g.operation_id)
    AND EXISTS(SELECT 1 FROM cash_movements m WHERE m.sale_id=s.sale_id AND m.operation_id=g.operation_id)
    AND (s.payment_method<>'credito' OR EXISTS(SELECT 1 FROM live_credits l
      WHERE l.sale_id=s.sale_id AND l.operation_id=g.operation_id AND l.promotion_id=g.promotion_id AND l.customer_id=x.customer_id))
  )
 )
BEGIN SELECT RAISE(ABORT,'gate_p_control'); END;

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
 NEW.current_stock_quantity IS NULL OR NEW.current_stock_quantity<0 OR NEW.current_stock_quantity>=OLD.current_stock_quantity OR
 NEW.stock_revision<>OLD.stock_revision+1 OR NOT EXISTS(SELECT 1 FROM canonical_write_guards g JOIN canonical_control c ON c.id=1
    JOIN canonical_sale_context x ON x.operation_id=g.operation_id
    JOIN sale_items i ON i.operation_id=g.operation_id AND i.sale_id=x.sale_id
    WHERE g.promotion_id=OLD.promotion_id AND c.mode='ACTIVE' AND c.active_promotion_id=g.promotion_id
    AND c.authority_epoch=g.authority_epoch AND c.revision=g.control_revision
    AND i.product_id=OLD.product_id AND NEW.current_stock_quantity=OLD.current_stock_quantity-i.quantity
    AND i.line_total_cents=round(i.quantity*i.unit_price_cents))
BEGIN SELECT RAISE(ABORT,'immutable_canonical_candidate'); END;

-- Legacy A3 writes stay fenced in every canonical mode. Only a transaction that
-- first installed its exact canonical guard may create the corresponding rows.
DROP TRIGGER IF EXISTS fence_sales_insert;
CREATE TRIGGER fence_sales_insert BEFORE INSERT ON sales WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' AND NOT EXISTS(
 SELECT 1 FROM canonical_write_guards g JOIN canonical_control c ON c.id=1 WHERE g.operation_id=NEW.operation_id AND g.commit_token=NEW.commit_token
 AND c.mode='ACTIVE' AND c.active_promotion_id=g.promotion_id AND c.authority_epoch=g.authority_epoch AND c.revision=g.control_revision)
BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
DROP TRIGGER IF EXISTS fence_sale_items_insert;
CREATE TRIGGER fence_sale_items_insert BEFORE INSERT ON sale_items WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' AND NOT EXISTS(
 SELECT 1 FROM canonical_write_guards g WHERE g.operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
DROP TRIGGER IF EXISTS fence_inventory_insert;
CREATE TRIGGER fence_inventory_insert BEFORE INSERT ON inventory_movements WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' AND NOT EXISTS(
 SELECT 1 FROM canonical_write_guards g WHERE g.operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
DROP TRIGGER IF EXISTS fence_cash_insert;
CREATE TRIGGER fence_cash_insert BEFORE INSERT ON cash_movements WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' AND NOT EXISTS(
 SELECT 1 FROM canonical_write_guards g JOIN sales s ON s.operation_id=g.operation_id AND s.commit_token=g.commit_token
 WHERE g.operation_id=NEW.operation_id AND s.sale_id=NEW.sale_id AND s.payment_method=NEW.payment_method
 AND s.total_cents=NEW.amount_cents AND s.payment_reference IS NEW.reference
 AND NEW.cash_cents+NEW.digital_cents+NEW.credit_cents=NEW.amount_cents)
BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;

CREATE TRIGGER IF NOT EXISTS canonical_write_guards_no_update BEFORE UPDATE ON canonical_write_guards BEGIN SELECT RAISE(ABORT,'immutable_write_guard'); END;
CREATE TRIGGER IF NOT EXISTS canonical_write_guards_authorized_insert BEFORE INSERT ON canonical_write_guards
WHEN NOT EXISTS(SELECT 1 FROM canonical_control c JOIN devices d ON d.device_id=c.writer_device_id
 WHERE c.id=1 AND c.mode='ACTIVE' AND c.active_promotion_id=NEW.promotion_id
 AND c.authority_epoch=NEW.authority_epoch AND c.revision=NEW.control_revision
 AND c.minimum_client_contract=NEW.client_contract AND d.role='writer' AND d.status='active')
BEGIN SELECT RAISE(ABORT,'stale_authority'); END;

CREATE TRIGGER IF NOT EXISTS canonical_sale_context_authorized_insert BEFORE INSERT ON canonical_sale_context
WHEN NOT EXISTS(SELECT 1 FROM canonical_write_guards g JOIN sales s ON s.operation_id=g.operation_id AND s.commit_token=g.commit_token
 WHERE g.operation_id=NEW.operation_id AND s.sale_id=NEW.sale_id AND g.promotion_id=NEW.promotion_id
 AND g.authority_epoch=NEW.authority_epoch AND g.control_revision=NEW.control_revision AND g.client_contract=NEW.client_contract)
BEGIN SELECT RAISE(ABORT,'invalid_sale_context'); END;

CREATE TRIGGER IF NOT EXISTS canonical_sale_item_authorized_insert BEFORE INSERT ON sale_items
WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' AND NOT EXISTS(
 SELECT 1 FROM canonical_write_guards g JOIN canonical_sale_context x ON x.operation_id=g.operation_id
 JOIN products p ON p.promotion_id=g.promotion_id AND p.product_id=NEW.product_id
 WHERE g.operation_id=NEW.operation_id AND x.sale_id=NEW.sale_id
 AND NEW.line_total_cents=round(NEW.quantity*NEW.unit_price_cents))
BEGIN SELECT RAISE(ABORT,'invalid_sale_item'); END;

CREATE TRIGGER IF NOT EXISTS canonical_inventory_movement_authorized_insert BEFORE INSERT ON inventory_movements
WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' AND NOT EXISTS(
 SELECT 1 FROM canonical_write_guards g JOIN sale_items i ON i.operation_id=g.operation_id
 WHERE g.operation_id=NEW.operation_id AND i.sale_id=NEW.sale_id AND i.line_number=NEW.line_number
 AND i.product_id=NEW.product_id AND NEW.quantity=-i.quantity)
BEGIN SELECT RAISE(ABORT,'invalid_inventory_movement'); END;

CREATE TRIGGER IF NOT EXISTS canonical_inventory_effect_authorized_insert BEFORE INSERT ON canonical_inventory_effects
WHEN NOT EXISTS(SELECT 1 FROM canonical_write_guards g JOIN inventory_movements m ON m.operation_id=g.operation_id
 WHERE g.operation_id=NEW.operation_id AND g.promotion_id=NEW.promotion_id AND m.movement_id=NEW.movement_id
 AND m.product_id=NEW.product_id AND m.quantity=NEW.quantity)
BEGIN SELECT RAISE(ABORT,'invalid_inventory_effect'); END;

CREATE TRIGGER IF NOT EXISTS live_credits_authorized_insert BEFORE INSERT ON live_credits
WHEN NOT EXISTS(SELECT 1 FROM canonical_write_guards g JOIN sales s ON s.operation_id=g.operation_id AND s.commit_token=g.commit_token
 JOIN canonical_sale_context x ON x.operation_id=g.operation_id AND x.sale_id=s.sale_id
 WHERE g.operation_id=NEW.operation_id AND g.promotion_id=NEW.promotion_id AND s.sale_id=NEW.sale_id
 AND s.payment_method='credito' AND s.total_cents=NEW.original_amount_cents
 AND NEW.current_balance_cents=NEW.original_amount_cents AND x.customer_id=NEW.customer_id)
BEGIN SELECT RAISE(ABORT,'invalid_live_credit'); END;

CREATE TRIGGER IF NOT EXISTS canonical_sale_context_no_update BEFORE UPDATE ON canonical_sale_context BEGIN SELECT RAISE(ABORT,'immutable_live_sale'); END;
CREATE TRIGGER IF NOT EXISTS canonical_sale_context_no_delete BEFORE DELETE ON canonical_sale_context BEGIN SELECT RAISE(ABORT,'immutable_live_sale'); END;
CREATE TRIGGER IF NOT EXISTS live_credits_no_update BEFORE UPDATE ON live_credits BEGIN SELECT RAISE(ABORT,'unsupported_credit_mutation'); END;
CREATE TRIGGER IF NOT EXISTS live_credits_no_delete BEFORE DELETE ON live_credits BEGIN SELECT RAISE(ABORT,'unsupported_credit_mutation'); END;
CREATE TRIGGER IF NOT EXISTS inventory_effects_no_update BEFORE UPDATE ON canonical_inventory_effects BEGIN SELECT RAISE(ABORT,'immutable_inventory_effect'); END;
CREATE TRIGGER IF NOT EXISTS inventory_effects_no_delete BEFORE DELETE ON canonical_inventory_effects BEGIN SELECT RAISE(ABORT,'immutable_inventory_effect'); END;

-- REPLACE may implicitly delete rows without firing DELETE triggers when
-- recursive_triggers is off. Reject every conflicting identity before insertion.
CREATE TRIGGER IF NOT EXISTS sales_no_replace BEFORE INSERT ON sales
WHEN EXISTS(SELECT 1 FROM sales WHERE rowid=NEW.rowid OR sale_id=NEW.sale_id OR operation_id=NEW.operation_id OR payment_reference=NEW.payment_reference)
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS sale_items_no_replace BEFORE INSERT ON sale_items
WHEN EXISTS(SELECT 1 FROM sale_items WHERE rowid=NEW.rowid OR (sale_id=NEW.sale_id AND line_number=NEW.line_number) OR (operation_id=NEW.operation_id AND line_number=NEW.line_number))
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS cash_no_replace BEFORE INSERT ON cash_movements
WHEN EXISTS(SELECT 1 FROM cash_movements WHERE rowid=NEW.rowid OR movement_id=NEW.movement_id OR operation_id=NEW.operation_id OR sale_id=NEW.sale_id)
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS inventory_no_replace BEFORE INSERT ON inventory_movements
WHEN EXISTS(SELECT 1 FROM inventory_movements WHERE rowid=NEW.rowid OR movement_id=NEW.movement_id OR (operation_id=NEW.operation_id AND line_number=NEW.line_number))
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS live_credits_no_replace BEFORE INSERT ON live_credits
WHEN EXISTS(SELECT 1 FROM live_credits WHERE rowid=NEW.rowid OR (promotion_id=NEW.promotion_id AND credit_id=NEW.credit_id) OR operation_id=NEW.operation_id OR sale_id=NEW.sale_id)
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS sale_context_no_replace BEFORE INSERT ON canonical_sale_context
WHEN EXISTS(SELECT 1 FROM canonical_sale_context WHERE rowid=NEW.rowid OR sale_id=NEW.sale_id OR operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS inventory_effect_no_replace BEFORE INSERT ON canonical_inventory_effects
WHEN EXISTS(SELECT 1 FROM canonical_inventory_effects WHERE rowid=NEW.rowid OR movement_id=NEW.movement_id OR (operation_id=NEW.operation_id AND product_id=NEW.product_id))
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;
