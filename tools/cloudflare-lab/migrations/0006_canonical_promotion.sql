PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_promotions (
  promotion_id TEXT PRIMARY KEY NOT NULL CHECK(length(promotion_id) BETWEEN 1 AND 160),
  operation_id TEXT NOT NULL UNIQUE CHECK(length(operation_id) BETWEEN 1 AND 160),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  import_id TEXT NOT NULL REFERENCES import_runs(import_id),
  source_hash TEXT NOT NULL CHECK(length(source_hash)=64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  transform_version TEXT NOT NULL, staging_revision INTEGER NOT NULL CHECK(staging_revision>=0),
  mapping_version TEXT NOT NULL, schema_version TEXT NOT NULL,
  policy_hash TEXT NOT NULL CHECK(length(policy_hash)=64 AND policy_hash NOT GLOB '*[^0-9a-f]*'),
  control_revision INTEGER NOT NULL CHECK(control_revision>=0),
  operational_manifest_json TEXT NOT NULL CHECK(json_valid(operational_manifest_json)),
  operational_manifest_hash TEXT NOT NULL CHECK(length(operational_manifest_hash)=64 AND operational_manifest_hash NOT GLOB '*[^0-9a-f]*'),
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  status TEXT NOT NULL CHECK(status IN ('PREPARED','COMMITTED','ABANDONED')),
  candidate_revision INTEGER NOT NULL DEFAULT 0 CHECK(candidate_revision>=0),
  sealed_revision INTEGER CHECK(sealed_revision IS NULL OR sealed_revision>=0),
  canonical_digest TEXT CHECK(canonical_digest IS NULL OR (length(canonical_digest)=64 AND canonical_digest NOT GLOB '*[^0-9a-f]*')),
  previous_promotion_id TEXT REFERENCES canonical_promotions(promotion_id),
  previous_mode TEXT CHECK(previous_mode IS NULL OR previous_mode IN ('FROZEN','CANONICAL_READ_ONLY')),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')), committed_at TEXT,
  UNIQUE(import_id, manifest_hash, transform_version, staging_revision, mapping_version, schema_version, policy_hash)
);

CREATE TABLE IF NOT EXISTS canonical_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  mode TEXT NOT NULL CHECK(mode IN ('LEGACY','FROZEN','CANONICAL_READ_ONLY','ACTIVE')),
  active_promotion_id TEXT REFERENCES canonical_promotions(promotion_id),
  revision INTEGER NOT NULL CHECK(revision>=0), authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=0),
  writer_device_id TEXT REFERENCES devices(device_id), minimum_client_contract TEXT NOT NULL,
  first_live_operation_id TEXT,
  CHECK(mode='FROZEN' OR (mode='LEGACY' AND active_promotion_id IS NULL) OR (mode IN ('CANONICAL_READ_ONLY','ACTIVE') AND active_promotion_id IS NOT NULL))
);
INSERT OR IGNORE INTO canonical_control(id,mode,active_promotion_id,revision,authority_epoch,writer_device_id,minimum_client_contract,first_live_operation_id)
VALUES(1,'LEGACY',NULL,0,0,NULL,'a6-gate-p-v1',NULL);

CREATE TABLE IF NOT EXISTS canonical_command_receipts (
  operation_id TEXT PRIMARY KEY NOT NULL, command TEXT NOT NULL CHECK(command IN ('freeze','rollback')),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS products (
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id), product_id TEXT NOT NULL,
  name TEXT NOT NULL, sku TEXT, barcode TEXT, alternate_codes_json TEXT CHECK(alternate_codes_json IS NULL OR json_valid(alternate_codes_json)),
  legacy_alternate_code TEXT, category TEXT, brand TEXT, description TEXT, icon TEXT, image TEXT, unit TEXT, purchase_unit TEXT,
  purchase_factor REAL CHECK(purchase_factor IS NULL OR (purchase_factor=purchase_factor AND abs(purchase_factor)<1.7976931348623157e308)),
  cost_cents INTEGER, price_cents INTEGER, box_price_cents INTEGER,
  units_per_box REAL CHECK(units_per_box IS NULL OR (units_per_box=units_per_box AND abs(units_per_box)<1.7976931348623157e308)),
  opening_stock_quantity REAL CHECK(opening_stock_quantity=opening_stock_quantity AND abs(opening_stock_quantity)<1.7976931348623157e308),
  current_stock_quantity REAL CHECK(current_stock_quantity=current_stock_quantity AND abs(current_stock_quantity)<1.7976931348623157e308),
  stock_min_quantity REAL CHECK(stock_min_quantity=stock_min_quantity AND abs(stock_min_quantity)<1.7976931348623157e308),
  stock_revision INTEGER NOT NULL DEFAULT 0 CHECK(stock_revision>=0), expiry_date TEXT,
  includes_igv INTEGER CHECK(includes_igv IS NULL OR includes_igv IN (0,1)), tax_type TEXT, complementary_tax TEXT,
  tracks_inventory INTEGER CHECK(tracks_inventory IS NULL OR tracks_inventory IN (0,1)),
  source_import_id TEXT NOT NULL, source_entity_type TEXT NOT NULL CHECK(source_entity_type='products'), source_name TEXT NOT NULL,
  source_row INTEGER NOT NULL CHECK(source_row>=1), source_key TEXT NOT NULL, source_payload_json TEXT NOT NULL CHECK(json_valid(source_payload_json)),
  source_payload_hash TEXT NOT NULL CHECK(length(source_payload_hash)=64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'), mapping_version TEXT NOT NULL,
  PRIMARY KEY(promotion_id,product_id), UNIQUE(promotion_id,source_import_id,source_entity_type,source_name,source_row,source_key),
  FOREIGN KEY(source_import_id,source_entity_type,source_name,source_row,source_key) REFERENCES import_staging(import_id,entity_type,source_name,source_row,source_key)
);

CREATE TABLE IF NOT EXISTS customers (
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id), customer_id TEXT NOT NULL, name TEXT NOT NULL,
  document TEXT, phone TEXT, address TEXT, color TEXT, total_purchases_cents INTEGER,
  source_image_balance_cents INTEGER, source_document_balance_cents INTEGER, source_difference_cents INTEGER,
  source_documents_total INTEGER, source_documents_pending INTEGER, source_documents_paid INTEGER, source_payment_count INTEGER,
  source_pending_original_cents INTEGER, source_pending_paid_cents INTEGER, source_pending_progress_ratio REAL,
  source_historical_credit_cents INTEGER, source_historical_paid_cents INTEGER, source_first_credit_value TEXT,
  source_last_payment_value TEXT, source_expected_full_payment_value TEXT, source_max_term_days INTEGER,
  source_days_until_due INTEGER, source_status TEXT, source_reconciliation TEXT,
  source_import_id TEXT NOT NULL, source_entity_type TEXT NOT NULL CHECK(source_entity_type='customers'), source_name TEXT NOT NULL,
  source_row INTEGER NOT NULL CHECK(source_row>=1), source_key TEXT NOT NULL, source_payload_json TEXT NOT NULL CHECK(json_valid(source_payload_json)),
  source_payload_hash TEXT NOT NULL CHECK(length(source_payload_hash)=64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'), mapping_version TEXT NOT NULL,
  PRIMARY KEY(promotion_id,customer_id), UNIQUE(promotion_id,source_import_id,source_entity_type,source_name,source_row,source_key),
  FOREIGN KEY(source_import_id,source_entity_type,source_name,source_row,source_key) REFERENCES import_staging(import_id,entity_type,source_name,source_row,source_key)
);

CREATE TABLE IF NOT EXISTS credits (
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id), credit_id TEXT NOT NULL, customer_id TEXT NOT NULL,
  sale_id TEXT REFERENCES sales(sale_id), store TEXT, document_number TEXT, reference TEXT, concept TEXT, seller TEXT,
  issued_value TEXT, due_value TEXT, term_days INTEGER,
  original_amount_cents INTEGER NOT NULL CHECK(original_amount_cents>=0), import_paid_cents INTEGER NOT NULL CHECK(import_paid_cents>=0),
  opening_balance_cents INTEGER NOT NULL CHECK(opening_balance_cents>=0), current_balance_cents INTEGER NOT NULL CHECK(current_balance_cents>=0),
  source_progress_ratio REAL, source_payment_count INTEGER, source_days_until_due INTEGER, source_status TEXT,
  source_customer_image_balance_cents INTEGER, source_customer_document_balance_cents INTEGER, source_customer_difference_cents INTEGER,
  source_import_id TEXT NOT NULL, source_entity_type TEXT NOT NULL CHECK(source_entity_type='credits'), source_name TEXT NOT NULL,
  source_row INTEGER NOT NULL CHECK(source_row>=1), source_key TEXT NOT NULL, source_payload_json TEXT NOT NULL CHECK(json_valid(source_payload_json)),
  source_payload_hash TEXT NOT NULL CHECK(length(source_payload_hash)=64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'), mapping_version TEXT NOT NULL,
  PRIMARY KEY(promotion_id,credit_id), UNIQUE(promotion_id,sale_id), UNIQUE(promotion_id,source_import_id,source_entity_type,source_name,source_row,source_key),
  FOREIGN KEY(promotion_id,customer_id) REFERENCES customers(promotion_id,customer_id),
  FOREIGN KEY(source_import_id,source_entity_type,source_name,source_row,source_key) REFERENCES import_staging(import_id,entity_type,source_name,source_row,source_key),
  CHECK(original_amount_cents-import_paid_cents=opening_balance_cents), CHECK(current_balance_cents=opening_balance_cents)
);

CREATE TABLE IF NOT EXISTS credit_payments (
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id), payment_id TEXT NOT NULL, credit_id TEXT NOT NULL,
  source_payment_id TEXT NOT NULL, source_sequence INTEGER, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  payment_date TEXT, payment_timestamp TEXT, payment_date_known INTEGER NOT NULL CHECK(payment_date_known IN (0,1)),
  date_precision TEXT NOT NULL CHECK(date_precision IN ('UNKNOWN','DATE','TIMESTAMP')), method TEXT, source_method TEXT, source_origin TEXT,
  source_document_type TEXT, source_operation_reference TEXT, seller TEXT, date_observation TEXT, source_customer_document TEXT,
  source_customer_name TEXT, source_cumulative_paid_cents INTEGER, source_balance_after_cents INTEGER, source_progress_ratio REAL,
  source_credit_original_cents INTEGER, source_current_document_balance_cents INTEGER,
  source_import_id TEXT NOT NULL, source_entity_type TEXT NOT NULL CHECK(source_entity_type='credit_payments'), source_name TEXT NOT NULL,
  source_row INTEGER NOT NULL CHECK(source_row>=1), source_key TEXT NOT NULL, source_payload_json TEXT NOT NULL CHECK(json_valid(source_payload_json)),
  source_payload_hash TEXT NOT NULL CHECK(length(source_payload_hash)=64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'), mapping_version TEXT NOT NULL,
  PRIMARY KEY(promotion_id,payment_id), UNIQUE(promotion_id,credit_id,source_payment_id),
  UNIQUE(promotion_id,source_import_id,source_entity_type,source_name,source_row,source_key),
  FOREIGN KEY(promotion_id,credit_id) REFERENCES credits(promotion_id,credit_id),
  FOREIGN KEY(source_import_id,source_entity_type,source_name,source_row,source_key) REFERENCES import_staging(import_id,entity_type,source_name,source_row,source_key),
  CHECK((payment_date_known=0 AND payment_date IS NULL AND payment_timestamp IS NULL AND date_precision='UNKNOWN') OR
        (payment_date_known=1 AND payment_date IS NOT NULL AND date_precision IN ('DATE','TIMESTAMP')))
);

CREATE INDEX IF NOT EXISTS idx_products_generation_key ON products(promotion_id,product_id);
CREATE INDEX IF NOT EXISTS idx_customers_generation_key ON customers(promotion_id,customer_id);
CREATE INDEX IF NOT EXISTS idx_credits_generation_key ON credits(promotion_id,credit_id);
CREATE INDEX IF NOT EXISTS idx_credit_payments_generation_key ON credit_payments(promotion_id,payment_id);

-- Candidate content and its opening values are append-only. Gate C must use separate,
-- explicitly authorized operational procedures rather than rewriting the import image.
CREATE TRIGGER IF NOT EXISTS products_no_update BEFORE UPDATE ON products BEGIN SELECT RAISE(ABORT,'immutable_canonical_candidate'); END;
CREATE TRIGGER IF NOT EXISTS products_no_delete BEFORE DELETE ON products BEGIN SELECT RAISE(ABORT,'immutable_canonical_candidate'); END;
CREATE TRIGGER IF NOT EXISTS customers_no_update BEFORE UPDATE ON customers BEGIN SELECT RAISE(ABORT,'immutable_canonical_candidate'); END;
CREATE TRIGGER IF NOT EXISTS customers_no_delete BEFORE DELETE ON customers BEGIN SELECT RAISE(ABORT,'immutable_canonical_candidate'); END;
CREATE TRIGGER IF NOT EXISTS credits_no_update BEFORE UPDATE ON credits BEGIN SELECT RAISE(ABORT,'immutable_canonical_candidate'); END;
CREATE TRIGGER IF NOT EXISTS credits_no_delete BEFORE DELETE ON credits BEGIN SELECT RAISE(ABORT,'immutable_canonical_candidate'); END;
CREATE TRIGGER IF NOT EXISTS credit_payments_no_update BEFORE UPDATE ON credit_payments BEGIN SELECT RAISE(ABORT,'immutable_canonical_candidate'); END;
CREATE TRIGGER IF NOT EXISTS credit_payments_no_delete BEFORE DELETE ON credit_payments BEGIN SELECT RAISE(ABORT,'immutable_canonical_candidate'); END;

CREATE TRIGGER IF NOT EXISTS canonical_promotion_identity_no_update BEFORE UPDATE ON canonical_promotions
WHEN NEW.promotion_id<>OLD.promotion_id OR NEW.operation_id<>OLD.operation_id OR NEW.request_hash<>OLD.request_hash OR NEW.import_id<>OLD.import_id OR
 NEW.source_hash<>OLD.source_hash OR NEW.manifest_hash<>OLD.manifest_hash OR NEW.transform_version<>OLD.transform_version OR
 NEW.staging_revision<>OLD.staging_revision OR NEW.mapping_version<>OLD.mapping_version OR NEW.schema_version<>OLD.schema_version OR
 NEW.policy_hash<>OLD.policy_hash OR NEW.control_revision<>OLD.control_revision OR NEW.operational_manifest_json<>OLD.operational_manifest_json OR
 NEW.operational_manifest_hash<>OLD.operational_manifest_hash OR NEW.device_id<>OLD.device_id OR NEW.previous_promotion_id IS NOT OLD.previous_promotion_id OR
 NEW.previous_mode IS NOT OLD.previous_mode OR NEW.created_at<>OLD.created_at OR NEW.candidate_revision<OLD.candidate_revision OR
 OLD.sealed_revision IS NOT NULL AND NEW.sealed_revision IS NOT OLD.sealed_revision OR OLD.canonical_digest IS NOT NULL AND NEW.canonical_digest IS NOT OLD.canonical_digest OR
 OLD.result_json IS NOT NULL AND NEW.result_json IS NOT OLD.result_json OR OLD.committed_at IS NOT NULL AND NEW.committed_at IS NOT OLD.committed_at OR
 (OLD.status='COMMITTED' AND NEW.status<>'ABANDONED') OR OLD.status='ABANDONED'
BEGIN SELECT RAISE(ABORT,'immutable_promotion'); END;
CREATE TRIGGER IF NOT EXISTS canonical_promotion_no_delete BEFORE DELETE ON canonical_promotions BEGIN SELECT RAISE(ABORT,'immutable_promotion'); END;
CREATE TRIGGER IF NOT EXISTS canonical_control_first_live_no_reset BEFORE UPDATE ON canonical_control
WHEN OLD.first_live_operation_id IS NOT NULL AND NEW.first_live_operation_id IS NOT OLD.first_live_operation_id
BEGIN SELECT RAISE(ABORT,'immutable_first_live'); END;
CREATE TRIGGER IF NOT EXISTS canonical_control_no_delete BEFORE DELETE ON canonical_control BEGIN SELECT RAISE(ABORT,'immutable_control'); END;
CREATE TRIGGER IF NOT EXISTS canonical_control_no_legacy BEFORE UPDATE ON canonical_control
WHEN NEW.mode='ACTIVE' OR (OLD.mode<>'LEGACY' AND NEW.mode='LEGACY') OR NEW.revision<>OLD.revision+1 OR NEW.authority_epoch<>OLD.authority_epoch+1 OR
 (NEW.mode='CANONICAL_READ_ONLY' AND NOT EXISTS(SELECT 1 FROM canonical_promotions p WHERE p.promotion_id=NEW.active_promotion_id AND p.status='COMMITTED'))
BEGIN SELECT RAISE(ABORT,'gate_p_control'); END;
CREATE TRIGGER IF NOT EXISTS canonical_receipts_no_update BEFORE UPDATE ON canonical_command_receipts BEGIN SELECT RAISE(ABORT,'immutable_receipt'); END;
CREATE TRIGGER IF NOT EXISTS canonical_receipts_no_delete BEFORE DELETE ON canonical_command_receipts BEGIN SELECT RAISE(ABORT,'immutable_receipt'); END;

-- A failing assertion aborts the whole D1 batch, including preceding statements.
CREATE TABLE IF NOT EXISTS canonical_assertions (assertion_id TEXT PRIMARY KEY NOT NULL, ok INTEGER NOT NULL CHECK(ok=1));

CREATE TRIGGER IF NOT EXISTS products_candidate_insert BEFORE INSERT ON products BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canonical_promotions p JOIN canonical_control c ON c.id=1
 WHERE p.promotion_id=NEW.promotion_id AND p.status='PREPARED' AND p.sealed_revision IS NULL AND c.mode='FROZEN'
 AND p.import_id=NEW.source_import_id AND p.mapping_version=NEW.mapping_version)
 THEN RAISE(ABORT,'candidate_sealed') END;
 SELECT CASE WHEN NEW.current_stock_quantity IS NOT NEW.opening_stock_quantity OR NEW.stock_revision<>0 OR length(NEW.product_id) NOT BETWEEN 1 AND 160 OR length(NEW.name)=0
 OR (NEW.alternate_codes_json IS NOT NULL AND json_type(NEW.alternate_codes_json)<>'array')
 OR EXISTS(SELECT 1 FROM json_each(json_array(NEW.cost_cents,NEW.price_cents,NEW.box_price_cents)) WHERE type<>'null' AND (type<>'integer' OR value<0 OR value>9007199254740991))
 THEN RAISE(ABORT,'invalid_product') END;
END;
CREATE TRIGGER IF NOT EXISTS customers_candidate_insert BEFORE INSERT ON customers BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canonical_promotions p JOIN canonical_control c ON c.id=1
 WHERE p.promotion_id=NEW.promotion_id AND p.status='PREPARED' AND p.sealed_revision IS NULL AND c.mode='FROZEN'
 AND p.import_id=NEW.source_import_id AND p.mapping_version=NEW.mapping_version)
 THEN RAISE(ABORT,'candidate_sealed') END;
 SELECT CASE WHEN length(NEW.customer_id) NOT BETWEEN 1 AND 160 OR length(NEW.name)=0
 OR EXISTS(SELECT 1 FROM json_each(json_array(NEW.total_purchases_cents,NEW.source_image_balance_cents,NEW.source_document_balance_cents,NEW.source_difference_cents,
 NEW.source_documents_total,NEW.source_documents_pending,NEW.source_documents_paid,NEW.source_payment_count,NEW.source_pending_original_cents,NEW.source_pending_paid_cents,
 NEW.source_historical_credit_cents,NEW.source_historical_paid_cents,NEW.source_max_term_days,NEW.source_days_until_due)) WHERE type<>'null' AND (type<>'integer' OR abs(value)>9007199254740991))
 OR (NEW.source_pending_progress_ratio IS NOT NULL AND (NEW.source_pending_progress_ratio<0 OR NEW.source_pending_progress_ratio>1))
 THEN RAISE(ABORT,'invalid_customer') END;
END;
CREATE TRIGGER IF NOT EXISTS credits_candidate_insert BEFORE INSERT ON credits BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canonical_promotions p JOIN canonical_control c ON c.id=1
 WHERE p.promotion_id=NEW.promotion_id AND p.status='PREPARED' AND p.sealed_revision IS NULL AND c.mode='FROZEN'
 AND p.import_id=NEW.source_import_id AND p.mapping_version=NEW.mapping_version)
 THEN RAISE(ABORT,'candidate_sealed') END;
 SELECT CASE WHEN length(NEW.credit_id) NOT BETWEEN 1 AND 160 OR NEW.sale_id IS NOT NULL
 OR EXISTS(SELECT 1 FROM json_each(json_array(NEW.original_amount_cents,NEW.import_paid_cents,NEW.opening_balance_cents,NEW.current_balance_cents,NEW.term_days,
 NEW.source_payment_count,NEW.source_days_until_due,NEW.source_customer_image_balance_cents,NEW.source_customer_document_balance_cents,NEW.source_customer_difference_cents))
 WHERE type<>'null' AND (type<>'integer' OR abs(value)>9007199254740991))
 OR (NEW.source_progress_ratio IS NOT NULL AND (NEW.source_progress_ratio<0 OR NEW.source_progress_ratio>1))
 THEN RAISE(ABORT,'invalid_credit') END;
END;
CREATE TRIGGER IF NOT EXISTS payments_candidate_insert BEFORE INSERT ON credit_payments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM canonical_promotions p JOIN canonical_control c ON c.id=1
 WHERE p.promotion_id=NEW.promotion_id AND p.status='PREPARED' AND p.sealed_revision IS NULL AND c.mode='FROZEN'
 AND p.import_id=NEW.source_import_id AND p.mapping_version=NEW.mapping_version)
 THEN RAISE(ABORT,'candidate_sealed') END;
 SELECT CASE WHEN length(NEW.payment_id)<>64 OR length(NEW.source_payment_id) NOT BETWEEN 1 AND 160 OR NEW.source_payment_id='-'
 OR EXISTS(SELECT 1 FROM json_each(json_array(NEW.amount_cents,NEW.source_sequence,NEW.source_cumulative_paid_cents,NEW.source_balance_after_cents,
 NEW.source_credit_original_cents,NEW.source_current_document_balance_cents)) WHERE type<>'null' AND (type<>'integer' OR value<0 OR value>9007199254740991))
 OR (NEW.source_progress_ratio IS NOT NULL AND (NEW.source_progress_ratio<0 OR NEW.source_progress_ratio>1))
 OR (NEW.date_precision='DATE' AND NEW.payment_timestamp IS NOT NULL) OR (NEW.date_precision='TIMESTAMP' AND NEW.payment_timestamp IS NULL)
 THEN RAISE(ABORT,'invalid_payment') END;
END;
CREATE TRIGGER IF NOT EXISTS products_candidate_revision AFTER INSERT ON products BEGIN UPDATE canonical_promotions SET candidate_revision=candidate_revision+1 WHERE promotion_id=NEW.promotion_id; END;
CREATE TRIGGER IF NOT EXISTS customers_candidate_revision AFTER INSERT ON customers BEGIN UPDATE canonical_promotions SET candidate_revision=candidate_revision+1 WHERE promotion_id=NEW.promotion_id; END;
CREATE TRIGGER IF NOT EXISTS credits_candidate_revision AFTER INSERT ON credits BEGIN UPDATE canonical_promotions SET candidate_revision=candidate_revision+1 WHERE promotion_id=NEW.promotion_id; END;
CREATE TRIGGER IF NOT EXISTS payments_candidate_revision AFTER INSERT ON credit_payments BEGIN UPDATE canonical_promotions SET candidate_revision=candidate_revision+1 WHERE promotion_id=NEW.promotion_id; END;

-- SQL-level authority fence. Device last_seen_at deliberately remains writable.
CREATE TRIGGER IF NOT EXISTS fence_sales_insert BEFORE INSERT ON sales WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_sales_update BEFORE UPDATE ON sales WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_sales_delete BEFORE DELETE ON sales WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_sale_items_insert BEFORE INSERT ON sale_items WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_sale_items_update BEFORE UPDATE ON sale_items WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_sale_items_delete BEFORE DELETE ON sale_items WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_inventory_insert BEFORE INSERT ON inventory_movements WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_inventory_update BEFORE UPDATE ON inventory_movements WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_inventory_delete BEFORE DELETE ON inventory_movements WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_cash_insert BEFORE INSERT ON cash_movements WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_cash_update BEFORE UPDATE ON cash_movements WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_cash_delete BEFORE DELETE ON cash_movements WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_sync_insert BEFORE INSERT ON sync_operations WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_sync_update BEFORE UPDATE ON sync_operations WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_sync_delete BEFORE DELETE ON sync_operations WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_import_runs_insert BEFORE INSERT ON import_runs WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_import_runs_update BEFORE UPDATE ON import_runs WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_import_runs_delete BEFORE DELETE ON import_runs WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_import_staging_insert BEFORE INSERT ON import_staging WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_import_staging_update BEFORE UPDATE ON import_staging WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_import_staging_delete BEFORE DELETE ON import_staging WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_import_issues_insert BEFORE INSERT ON import_issues WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_import_issues_update BEFORE UPDATE ON import_issues WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
CREATE TRIGGER IF NOT EXISTS fence_import_issues_delete BEFORE DELETE ON import_issues WHEN (SELECT mode FROM canonical_control WHERE id=1)<>'LEGACY' BEGIN SELECT RAISE(ABORT,'authority_frozen'); END;
