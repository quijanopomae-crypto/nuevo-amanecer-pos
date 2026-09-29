PRAGMA foreign_keys = ON;

-- Customer command journal. Imported customer provenance remains sealed in customers.
CREATE TABLE IF NOT EXISTS canonical_customer_operations (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 160),
  command TEXT NOT NULL CHECK(command='customer.create'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  customer_id TEXT NOT NULL CHECK(length(customer_id) BETWEEN 1 AND 160),
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=0),
  control_revision INTEGER NOT NULL CHECK(control_revision>=0),
  client_contract TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES devices(device_id),
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64 AND credential_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL
);

-- Registry is the effective identity parent for operational rows. IMPORT entries
-- mirror immutable customers; LIVE entries are created only with customer.create.
CREATE TABLE IF NOT EXISTS canonical_customer_registry (
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  customer_id TEXT NOT NULL CHECK(length(customer_id) BETWEEN 1 AND 160),
  provenance TEXT NOT NULL CHECK(provenance IN ('IMPORT','LIVE')),
  operation_id TEXT,
  created_at TEXT,
  PRIMARY KEY(promotion_id,customer_id),
  UNIQUE(operation_id)
);

CREATE TABLE IF NOT EXISTS canonical_live_customers (
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  customer_id TEXT NOT NULL CHECK(length(customer_id) BETWEEN 1 AND 160),
  operation_id TEXT NOT NULL UNIQUE REFERENCES canonical_customer_operations(operation_id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 240),
  document TEXT,
  phone TEXT,
  address TEXT,
  color TEXT,
  total_purchases_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_purchases_cents=0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(promotion_id,customer_id),
  FOREIGN KEY(promotion_id,customer_id) REFERENCES canonical_customer_registry(promotion_id,customer_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_canonical_live_customers_document
  ON canonical_live_customers(promotion_id,lower(document))
  WHERE document IS NOT NULL AND trim(document)<>'';

INSERT OR IGNORE INTO canonical_customer_registry(promotion_id,customer_id,provenance,operation_id,created_at)
SELECT promotion_id,customer_id,'IMPORT',NULL,NULL FROM customers;

CREATE TRIGGER IF NOT EXISTS customer_registry_import_insert
AFTER INSERT ON customers
BEGIN
  INSERT INTO canonical_customer_registry(promotion_id,customer_id,provenance,operation_id,created_at)
  VALUES(NEW.promotion_id,NEW.customer_id,'IMPORT',NULL,NULL);
END;

CREATE TRIGGER IF NOT EXISTS canonical_customer_operations_authorized_insert
BEFORE INSERT ON canonical_customer_operations
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_control c JOIN devices d ON d.device_id=NEW.principal_id
  WHERE c.id=1 AND c.mode='ACTIVE' AND c.active_promotion_id=NEW.promotion_id
    AND c.authority_epoch=NEW.authority_epoch AND c.revision=NEW.control_revision
    AND c.minimum_client_contract=NEW.client_contract
    AND d.role='writer' AND d.status='active' AND d.credential_hash=NEW.credential_hash
)
BEGIN SELECT RAISE(ABORT,'stale_authority'); END;

CREATE TRIGGER IF NOT EXISTS canonical_customer_operations_namespace_insert
BEFORE INSERT ON canonical_customer_operations
WHEN
  EXISTS(SELECT 1 FROM sales WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_financial_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_expense_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_product_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_inventory_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_credit_accounts WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_credit_metadata WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS canonical_customer_operations_no_update
BEFORE UPDATE ON canonical_customer_operations
BEGIN SELECT RAISE(ABORT,'immutable_customer_operation'); END;
CREATE TRIGGER IF NOT EXISTS canonical_customer_operations_no_delete
BEFORE DELETE ON canonical_customer_operations
BEGIN SELECT RAISE(ABORT,'immutable_customer_operation'); END;
CREATE TRIGGER IF NOT EXISTS canonical_customer_operations_no_replace
BEFORE INSERT ON canonical_customer_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'customer_operation_replace_forbidden'); END;

CREATE TRIGGER IF NOT EXISTS canonical_customer_registry_import_guard
BEFORE INSERT ON canonical_customer_registry
WHEN NEW.provenance='IMPORT' AND NOT EXISTS(
  SELECT 1 FROM customers c
  WHERE c.promotion_id=NEW.promotion_id AND c.customer_id=NEW.customer_id
)
BEGIN SELECT RAISE(ABORT,'invalid_import_customer_registry'); END;

CREATE TRIGGER IF NOT EXISTS canonical_customer_registry_live_guard
BEFORE INSERT ON canonical_customer_registry
WHEN NEW.provenance='LIVE' AND (
  NEW.operation_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM canonical_customer_operations o
    WHERE o.operation_id=NEW.operation_id AND o.promotion_id=NEW.promotion_id
      AND o.customer_id=NEW.customer_id AND o.command='customer.create'
  )
)
BEGIN SELECT RAISE(ABORT,'invalid_live_customer_registry'); END;

CREATE TRIGGER IF NOT EXISTS canonical_customer_registry_no_update
BEFORE UPDATE ON canonical_customer_registry
BEGIN SELECT RAISE(ABORT,'immutable_customer_registry'); END;
CREATE TRIGGER IF NOT EXISTS canonical_customer_registry_no_delete
BEFORE DELETE ON canonical_customer_registry
BEGIN SELECT RAISE(ABORT,'immutable_customer_registry'); END;

CREATE TRIGGER IF NOT EXISTS canonical_live_customers_authorized_insert
BEFORE INSERT ON canonical_live_customers
WHEN
  EXISTS(SELECT 1 FROM customers c WHERE c.promotion_id=NEW.promotion_id AND c.customer_id=NEW.customer_id)
  OR NOT EXISTS(
    SELECT 1 FROM canonical_customer_operations o
      JOIN canonical_customer_registry r
        ON r.promotion_id=o.promotion_id AND r.customer_id=o.customer_id
    WHERE o.operation_id=NEW.operation_id AND o.promotion_id=NEW.promotion_id
      AND o.customer_id=NEW.customer_id AND o.command='customer.create'
      AND r.provenance='LIVE' AND r.operation_id=o.operation_id
  )
  OR (
    NEW.document IS NOT NULL AND trim(NEW.document)<>'' AND (
      EXISTS(SELECT 1 FROM customers c
        WHERE c.promotion_id=NEW.promotion_id
          AND lower(trim(COALESCE(c.document,'')))=lower(trim(NEW.document)))
      OR EXISTS(SELECT 1 FROM canonical_live_customers c
        WHERE c.promotion_id=NEW.promotion_id
          AND lower(trim(COALESCE(c.document,'')))=lower(trim(NEW.document)))
    )
  )
BEGIN SELECT RAISE(ABORT,'invalid_live_customer'); END;

CREATE TRIGGER IF NOT EXISTS canonical_live_customers_no_update
BEFORE UPDATE ON canonical_live_customers
BEGIN SELECT RAISE(ABORT,'immutable_live_customer'); END;
CREATE TRIGGER IF NOT EXISTS canonical_live_customers_no_delete
BEFORE DELETE ON canonical_live_customers
BEGIN SELECT RAISE(ABORT,'immutable_live_customer'); END;
CREATE TRIGGER IF NOT EXISTS canonical_live_customers_no_replace
BEFORE INSERT ON canonical_live_customers
WHEN EXISTS(
  SELECT 1 FROM canonical_live_customers
  WHERE rowid=NEW.rowid OR operation_id=NEW.operation_id
    OR (promotion_id=NEW.promotion_id AND customer_id=NEW.customer_id)
)
BEGIN SELECT RAISE(ABORT,'live_customer_replace_forbidden'); END;

-- Every trigger owned by a table being rebuilt is removed first. Some
-- of those triggers reference another target table (for example
-- live_credits_authorized_insert -> canonical_sale_context), so relying on
-- DROP TABLE to remove them is too late for SQLite schema reparsing.
DROP TRIGGER IF EXISTS live_credits_no_import_collision;
DROP TRIGGER IF EXISTS canonical_sale_context_authorized_insert;
DROP TRIGGER IF EXISTS live_credits_authorized_insert;
DROP TRIGGER IF EXISTS canonical_sale_context_no_update;
DROP TRIGGER IF EXISTS canonical_sale_context_no_delete;
DROP TRIGGER IF EXISTS live_credits_no_update;
DROP TRIGGER IF EXISTS live_credits_no_delete;
DROP TRIGGER IF EXISTS live_credits_no_replace;
DROP TRIGGER IF EXISTS sale_context_no_replace;
DROP TRIGGER IF EXISTS credit_accounts_authorized_insert;
DROP TRIGGER IF EXISTS credit_metadata_live_guard;
DROP TRIGGER IF EXISTS credit_metadata_import_guard;
DROP TRIGGER IF EXISTS credit_accounts_no_update;
DROP TRIGGER IF EXISTS credit_accounts_no_delete;
DROP TRIGGER IF EXISTS credit_metadata_no_update;
DROP TRIGGER IF EXISTS credit_metadata_no_delete;
DROP TRIGGER IF EXISTS credit_accounts_no_replace;
DROP TRIGGER IF EXISTS credit_metadata_no_replace;
DROP TRIGGER IF EXISTS credit_account_expense_operation_collision;
DROP TRIGGER IF EXISTS credit_metadata_expense_operation_collision;

-- External triggers are temporarily removed because SQLite reparses trigger SQL
-- after each DROP TABLE. They are restored from the effective pre-0017 schema
-- only after all four operational tables exist again.
DROP TRIGGER IF EXISTS canonical_control_no_legacy;
DROP TRIGGER IF EXISTS products_no_update;
DROP TRIGGER IF EXISTS canonical_sale_item_authorized_insert;
DROP TRIGGER IF EXISTS sale_cash_requires_open_session;
DROP TRIGGER IF EXISTS credit_installments_live_guard;
DROP TRIGGER IF EXISTS credit_installments_import_guard;
DROP TRIGGER IF EXISTS expense_operation_namespace;
DROP TRIGGER IF EXISTS canonical_live_products_guarded_update;
DROP TRIGGER IF EXISTS canonical_generic_sale_line_authorized_insert;
DROP TRIGGER IF EXISTS canonical_customer_operations_namespace_insert;

-- Rebuild the four operational customer-reference tables. Their business
-- constraints are preserved; only the customer FK parent changes to the
-- effective IMPORT+LIVE registry.

CREATE TABLE canonical_sale_context__v17 (
  sale_id TEXT PRIMARY KEY NOT NULL REFERENCES sales(sale_id),
  operation_id TEXT NOT NULL UNIQUE,
  promotion_id TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=0),
  control_revision INTEGER NOT NULL CHECK(control_revision>=0),
  customer_id TEXT,
  client_contract TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id),
  FOREIGN KEY(promotion_id,customer_id) REFERENCES canonical_customer_registry(promotion_id,customer_id)
);
INSERT INTO canonical_sale_context__v17
  (sale_id,operation_id,promotion_id,authority_epoch,control_revision,customer_id,client_contract,created_at)
SELECT sale_id,operation_id,promotion_id,authority_epoch,control_revision,customer_id,client_contract,created_at
FROM canonical_sale_context;
DROP TABLE canonical_sale_context;
ALTER TABLE canonical_sale_context__v17 RENAME TO canonical_sale_context;

CREATE TABLE live_credits__v17 (
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
  FOREIGN KEY(promotion_id,customer_id) REFERENCES canonical_customer_registry(promotion_id,customer_id)
);
INSERT INTO live_credits__v17
  (promotion_id,credit_id,operation_id,sale_id,customer_id,original_amount_cents,current_balance_cents,due_date,status,revision,created_at)
SELECT promotion_id,credit_id,operation_id,sale_id,customer_id,original_amount_cents,current_balance_cents,due_date,status,revision,created_at
FROM live_credits;
DROP TABLE live_credits;
ALTER TABLE live_credits__v17 RENAME TO live_credits;

CREATE TABLE canonical_credit_accounts__v17 (
  promotion_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
  mode TEXT NOT NULL CHECK(mode IN ('accumulated','separate')),
  operation_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  principal_id TEXT NOT NULL,
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64 AND credential_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  PRIMARY KEY(promotion_id,customer_id,account_id),
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id),
  FOREIGN KEY(promotion_id,customer_id) REFERENCES canonical_customer_registry(promotion_id,customer_id)
);
INSERT INTO canonical_credit_accounts__v17
  (promotion_id,customer_id,account_id,name,mode,operation_id,request_hash,principal_id,credential_hash,created_at)
SELECT promotion_id,customer_id,account_id,name,mode,operation_id,request_hash,principal_id,credential_hash,created_at
FROM canonical_credit_accounts;
DROP TABLE canonical_credit_accounts;
ALTER TABLE canonical_credit_accounts__v17 RENAME TO canonical_credit_accounts;

CREATE TABLE canonical_credit_metadata__v17 (
  promotion_id TEXT NOT NULL,
  credit_id TEXT NOT NULL,
  credit_provenance TEXT NOT NULL CHECK(credit_provenance IN ('IMPORT','LIVE')),
  customer_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL CHECK(length(trim(account_name)) BETWEEN 1 AND 60),
  account_mode TEXT NOT NULL CHECK(account_mode IN ('accumulated','separate')),
  operation_id TEXT NOT NULL UNIQUE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY(promotion_id,credit_provenance,credit_id),
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id),
  FOREIGN KEY(promotion_id,customer_id) REFERENCES canonical_customer_registry(promotion_id,customer_id)
);
INSERT INTO canonical_credit_metadata__v17
  (promotion_id,credit_id,credit_provenance,customer_id,account_id,account_name,account_mode,operation_id,assigned_at)
SELECT promotion_id,credit_id,credit_provenance,customer_id,account_id,account_name,account_mode,operation_id,assigned_at
FROM canonical_credit_metadata;
DROP TABLE canonical_credit_metadata;
ALTER TABLE canonical_credit_metadata__v17 RENAME TO canonical_credit_metadata;

CREATE INDEX IF NOT EXISTS idx_live_credits_customer ON live_credits(promotion_id,customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_context_promotion ON canonical_sale_context(promotion_id,sale_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_accounts_name
  ON canonical_credit_accounts(promotion_id,customer_id,lower(name));
CREATE INDEX IF NOT EXISTS idx_credit_metadata_customer
  ON canonical_credit_metadata(promotion_id,customer_id,account_id);

CREATE TRIGGER IF NOT EXISTS live_credits_no_import_collision BEFORE INSERT ON live_credits
WHEN EXISTS(SELECT 1 FROM credits WHERE promotion_id=NEW.promotion_id AND credit_id=NEW.credit_id)
BEGIN SELECT RAISE(ABORT,'credit_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS canonical_sale_context_authorized_insert BEFORE INSERT ON canonical_sale_context
WHEN NOT EXISTS(SELECT 1 FROM canonical_write_guards g JOIN sales s ON s.operation_id=g.operation_id AND s.commit_token=g.commit_token
 WHERE g.operation_id=NEW.operation_id AND s.sale_id=NEW.sale_id AND g.promotion_id=NEW.promotion_id
 AND g.authority_epoch=NEW.authority_epoch AND g.control_revision=NEW.control_revision AND g.client_contract=NEW.client_contract)
BEGIN SELECT RAISE(ABORT,'invalid_sale_context'); END;

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
CREATE TRIGGER IF NOT EXISTS live_credits_no_replace BEFORE INSERT ON live_credits
WHEN EXISTS(SELECT 1 FROM live_credits WHERE rowid=NEW.rowid OR (promotion_id=NEW.promotion_id AND credit_id=NEW.credit_id) OR operation_id=NEW.operation_id OR sale_id=NEW.sale_id)
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS sale_context_no_replace BEFORE INSERT ON canonical_sale_context
WHEN EXISTS(SELECT 1 FROM canonical_sale_context WHERE rowid=NEW.rowid OR sale_id=NEW.sale_id OR operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;

CREATE TRIGGER IF NOT EXISTS credit_accounts_authorized_insert BEFORE INSERT ON canonical_credit_accounts
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_control c JOIN devices d ON d.device_id=NEW.principal_id
  WHERE c.id=1 AND c.mode='ACTIVE' AND c.active_promotion_id=NEW.promotion_id
    AND d.role='writer' AND d.status='active' AND d.credential_hash=NEW.credential_hash
)
BEGIN SELECT RAISE(ABORT,'stale_authority'); END;

CREATE TRIGGER IF NOT EXISTS credit_metadata_live_guard BEFORE INSERT ON canonical_credit_metadata
WHEN NEW.credit_provenance='LIVE' AND NOT EXISTS(
  SELECT 1 FROM live_credits l
  WHERE l.promotion_id=NEW.promotion_id AND l.credit_id=NEW.credit_id
    AND l.customer_id=NEW.customer_id AND l.operation_id=NEW.operation_id
)
BEGIN SELECT RAISE(ABORT,'invalid_credit_metadata'); END;

CREATE TRIGGER IF NOT EXISTS credit_metadata_import_guard BEFORE INSERT ON canonical_credit_metadata
WHEN NEW.credit_provenance='IMPORT' AND NOT EXISTS(
  SELECT 1 FROM credits c
  WHERE c.promotion_id=NEW.promotion_id AND c.credit_id=NEW.credit_id
    AND c.customer_id=NEW.customer_id
)
BEGIN SELECT RAISE(ABORT,'invalid_credit_metadata'); END;

CREATE TRIGGER IF NOT EXISTS credit_accounts_no_update BEFORE UPDATE ON canonical_credit_accounts
BEGIN SELECT RAISE(ABORT,'immutable_credit_account'); END;
CREATE TRIGGER IF NOT EXISTS credit_accounts_no_delete BEFORE DELETE ON canonical_credit_accounts
BEGIN SELECT RAISE(ABORT,'immutable_credit_account'); END;
CREATE TRIGGER IF NOT EXISTS credit_metadata_no_update BEFORE UPDATE ON canonical_credit_metadata
BEGIN SELECT RAISE(ABORT,'immutable_credit_metadata'); END;
CREATE TRIGGER IF NOT EXISTS credit_metadata_no_delete BEFORE DELETE ON canonical_credit_metadata
BEGIN SELECT RAISE(ABORT,'immutable_credit_metadata'); END;

CREATE TRIGGER IF NOT EXISTS credit_accounts_no_replace BEFORE INSERT ON canonical_credit_accounts
WHEN EXISTS(
  SELECT 1 FROM canonical_credit_accounts
  WHERE rowid=NEW.rowid OR operation_id=NEW.operation_id OR
    (promotion_id=NEW.promotion_id AND customer_id=NEW.customer_id AND account_id=NEW.account_id)
)
BEGIN SELECT RAISE(ABORT,'credit_account_replace_forbidden'); END;

CREATE TRIGGER IF NOT EXISTS credit_metadata_no_replace BEFORE INSERT ON canonical_credit_metadata
WHEN EXISTS(
  SELECT 1 FROM canonical_credit_metadata
  WHERE rowid=NEW.rowid OR operation_id=NEW.operation_id OR
    (promotion_id=NEW.promotion_id AND credit_provenance=NEW.credit_provenance AND credit_id=NEW.credit_id)
)
BEGIN SELECT RAISE(ABORT,'credit_metadata_replace_forbidden'); END;

CREATE TRIGGER IF NOT EXISTS credit_account_expense_operation_collision BEFORE INSERT ON canonical_credit_accounts
WHEN EXISTS(SELECT 1 FROM canonical_expense_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS credit_metadata_expense_operation_collision BEFORE INSERT ON canonical_credit_metadata
WHEN EXISTS(SELECT 1 FROM canonical_expense_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

-- Customer operation namespace must also be visible to all other authoritative writers.
CREATE TRIGGER IF NOT EXISTS sales_customer_operation_collision BEFORE INSERT ON sales
WHEN EXISTS(SELECT 1 FROM canonical_customer_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS financial_customer_operation_collision BEFORE INSERT ON canonical_financial_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS expense_customer_operation_collision BEFORE INSERT ON canonical_expense_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS product_customer_operation_collision BEFORE INSERT ON canonical_product_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS inventory_customer_operation_collision BEFORE INSERT ON canonical_inventory_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS credit_account_customer_operation_collision BEFORE INSERT ON canonical_credit_accounts
WHEN EXISTS(SELECT 1 FROM canonical_customer_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS credit_metadata_customer_operation_collision BEFORE INSERT ON canonical_credit_metadata
WHEN EXISTS(SELECT 1 FROM canonical_customer_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

-- Restore every external invariant that references a rebuilt table.
CREATE TRIGGER IF NOT EXISTS expenses_no_replace BEFORE INSERT ON canonical_expenses
WHEN EXISTS(SELECT 1 FROM canonical_expenses WHERE rowid=NEW.rowid OR expense_id=NEW.expense_id OR operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'expense_replace_forbidden'); END;

-- Expenses participate in expected cash only when explicitly attached to a session.
-- Digital methods remain operational expenses but have zero cash impact.
DROP VIEW IF EXISTS canonical_cash_state;
CREATE VIEW canonical_cash_state AS
SELECT s.*, CASE WHEN c.session_id IS NULL THEN 'OPEN' ELSE 'CLOSED' END AS status,
 c.close_operation_id,c.counted_cents,c.difference_cents,c.closed_at,
 COALESCE(c.cash_movement_watermark,(SELECT COALESCE(MAX(rowid),0) FROM cash_movements)) AS closing_watermark,
 s.opening_cents
 + COALESCE((SELECT SUM(e.cash_delta_cents) FROM canonical_financial_events e WHERE e.session_id=s.session_id),0)
 + COALESCE((SELECT SUM(x.cash_delta_cents) FROM canonical_expenses x WHERE x.session_id=s.session_id),0)
 + COALESCE((SELECT SUM(m.cash_cents) FROM cash_movements m JOIN canonical_sale_context x ON x.sale_id=m.sale_id
 WHERE x.promotion_id=s.promotion_id AND m.rowid>s.cash_movement_watermark
 AND m.rowid<=COALESCE(c.cash_movement_watermark,(SELECT COALESCE(MAX(rowid),0) FROM cash_movements))),0) AS expected_cents,
 (SELECT COUNT(*) FROM canonical_financial_events e WHERE e.session_id=s.session_id)
 + (SELECT COUNT(*) FROM canonical_expenses x WHERE x.session_id=s.session_id)
 + (SELECT COUNT(*) FROM cash_movements m JOIN canonical_sale_context x ON x.sale_id=m.sale_id
 WHERE x.promotion_id=s.promotion_id AND m.cash_cents>0 AND m.rowid>s.cash_movement_watermark
 AND m.rowid<=COALESCE(c.cash_movement_watermark,(SELECT COALESCE(MAX(rowid),0) FROM cash_movements)))
 + CASE WHEN c.session_id IS NULL THEN 0 ELSE 1 END AS revision
FROM canonical_cash_sessions s LEFT JOIN canonical_cash_closures c ON c.session_id=s.session_id;

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
  AND (EXISTS (
    SELECT 1 FROM canonical_write_guards g
    JOIN sales s ON s.operation_id=g.operation_id AND s.commit_token=g.commit_token
    JOIN canonical_sale_context x ON x.sale_id=s.sale_id AND x.operation_id=g.operation_id
    WHERE g.promotion_id=OLD.active_promotion_id AND g.authority_epoch=OLD.authority_epoch
    AND g.control_revision=OLD.revision AND g.client_contract=OLD.minimum_client_contract
    AND s.device_id=g.principal_id AND g.credential_hash IS NOT NULL
    AND EXISTS(SELECT 1 FROM devices sale_writer WHERE sale_writer.device_id=g.principal_id
      AND sale_writer.role='writer' AND sale_writer.status='active' AND sale_writer.credential_hash=g.credential_hash)
    AND x.promotion_id=g.promotion_id AND x.authority_epoch=g.authority_epoch
    AND x.control_revision=g.control_revision AND x.client_contract=g.client_contract
    AND (OLD.first_live_operation_id IS NOT NULL OR (NEW.first_live_operation_id=g.operation_id
      AND NOT EXISTS(SELECT 1 FROM canonical_sale_context prior WHERE prior.operation_id<>g.operation_id)))
    AND EXISTS(SELECT 1 FROM sale_items i WHERE i.sale_id=s.sale_id AND i.operation_id=g.operation_id)
    AND EXISTS(SELECT 1 FROM cash_movements m WHERE m.sale_id=s.sale_id AND m.operation_id=g.operation_id)
    AND (s.payment_method<>'credito' OR EXISTS(SELECT 1 FROM live_credits l
      WHERE l.sale_id=s.sale_id AND l.operation_id=g.operation_id AND l.promotion_id=g.promotion_id AND l.customer_id=x.customer_id))
  ) OR EXISTS (
    SELECT 1 FROM canonical_write_guards g
    JOIN canonical_financial_operations o ON o.operation_id=g.operation_id
    JOIN devices d ON d.device_id=o.device_id
    WHERE g.promotion_id=OLD.active_promotion_id AND g.authority_epoch=OLD.authority_epoch
    AND g.control_revision=OLD.revision AND g.client_contract=OLD.minimum_client_contract
    AND o.promotion_id=g.promotion_id AND o.authority_epoch=g.authority_epoch
    AND o.control_revision=g.control_revision AND o.client_contract=g.client_contract
    AND o.device_id=g.principal_id AND g.credential_hash=o.credential_hash
    AND d.role='writer' AND d.status='active' AND d.credential_hash=o.credential_hash
    AND (OLD.first_live_operation_id IS NOT NULL OR (NEW.first_live_operation_id=o.operation_id
      AND NOT EXISTS(SELECT 1 FROM canonical_financial_operations prior WHERE prior.operation_id<>o.operation_id)
      AND NOT EXISTS(SELECT 1 FROM canonical_sale_context)))
    AND (
      (o.command='cash.open' AND EXISTS(SELECT 1 FROM canonical_cash_sessions s
        WHERE s.open_operation_id=o.operation_id AND s.promotion_id=o.promotion_id
        AND s.session_id=json_extract(o.result_json,'$.session_id') AND s.opening_cents=json_extract(o.result_json,'$.expected_cents')))
      OR (o.command='cash.close' AND EXISTS(SELECT 1 FROM canonical_cash_closures c JOIN canonical_cash_sessions s ON s.session_id=c.session_id
        WHERE c.close_operation_id=o.operation_id AND s.promotion_id=o.promotion_id
        AND c.session_id=json_extract(o.result_json,'$.session_id') AND c.expected_cents=json_extract(o.result_json,'$.expected_cents')
        AND c.counted_cents=json_extract(o.result_json,'$.counted_cents') AND c.difference_cents=json_extract(o.result_json,'$.difference_cents')))
      OR (o.command IN ('payment.create','adjustment.create','compensation.create') AND EXISTS(SELECT 1 FROM canonical_financial_events e
        WHERE e.operation_id=o.operation_id AND e.promotion_id=o.promotion_id
        AND e.event_type=CASE o.command WHEN 'payment.create' THEN 'PAYMENT' WHEN 'adjustment.create' THEN 'ADJUSTMENT' ELSE 'COMPENSATION' END
        AND e.event_id=json_extract(o.result_json,'$.event_id')
        AND e.credit_delta_cents=json_extract(o.result_json,'$.credit_delta_cents') AND e.cash_delta_cents=json_extract(o.result_json,'$.cash_delta_cents')
        AND e.credit_id IS json_extract(o.result_json,'$.credit_id') AND e.session_id IS json_extract(o.result_json,'$.session_id')))
    )
  ) OR EXISTS (
    SELECT 1 FROM canonical_write_guards g
    JOIN canonical_expense_operations o ON o.operation_id=g.operation_id
    JOIN canonical_expenses e ON e.operation_id=o.operation_id AND e.promotion_id=o.promotion_id
    JOIN devices d ON d.device_id=o.device_id
    WHERE g.promotion_id=OLD.active_promotion_id AND g.authority_epoch=OLD.authority_epoch
    AND g.control_revision=OLD.revision AND g.client_contract=OLD.minimum_client_contract
    AND o.promotion_id=g.promotion_id AND o.authority_epoch=g.authority_epoch
    AND o.control_revision=g.control_revision AND o.client_contract=g.client_contract
    AND o.device_id=g.principal_id AND g.credential_hash=o.credential_hash
    AND d.role='writer' AND d.status='active' AND d.credential_hash=o.credential_hash
    AND (OLD.first_live_operation_id IS NOT NULL OR (NEW.first_live_operation_id=o.operation_id
      AND NOT EXISTS(SELECT 1 FROM canonical_sale_context)
      AND NOT EXISTS(SELECT 1 FROM canonical_financial_operations)
      AND NOT EXISTS(SELECT 1 FROM canonical_expense_operations prior WHERE prior.operation_id<>o.operation_id)))
    AND e.expense_id=json_extract(o.result_json,'$.expense_id')
    AND e.session_id IS json_extract(o.result_json,'$.session_id')
    AND e.cash_delta_cents=json_extract(o.result_json,'$.cash_delta_cents')
  ))
 )
BEGIN SELECT RAISE(ABORT,'gate_p_control'); END;

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

CREATE TRIGGER IF NOT EXISTS sale_cash_requires_open_session BEFORE INSERT ON cash_movements
WHEN NEW.cash_cents>0 AND EXISTS(SELECT 1 FROM canonical_cash_sessions s JOIN canonical_sale_context x
 ON x.promotion_id=s.promotion_id WHERE x.sale_id=NEW.sale_id)
 AND NOT EXISTS(SELECT 1 FROM canonical_cash_state s JOIN canonical_sale_context x ON x.promotion_id=s.promotion_id
 WHERE x.sale_id=NEW.sale_id AND s.status='OPEN' AND s.expected_cents+NEW.cash_cents<=9007199254740991)
BEGIN SELECT RAISE(ABORT,'cash_session_required'); END;

CREATE TRIGGER IF NOT EXISTS credit_installments_live_guard BEFORE INSERT ON canonical_credit_installments
WHEN NEW.credit_provenance='LIVE' AND NOT EXISTS(
  SELECT 1 FROM canonical_credit_metadata m
  WHERE m.promotion_id=NEW.promotion_id AND m.credit_id=NEW.credit_id
    AND m.credit_provenance='LIVE' AND m.operation_id=NEW.operation_id
)
BEGIN SELECT RAISE(ABORT,'invalid_credit_installment'); END;

CREATE TRIGGER IF NOT EXISTS credit_installments_import_guard BEFORE INSERT ON canonical_credit_installments
WHEN NEW.credit_provenance='IMPORT' AND NOT EXISTS(
  SELECT 1 FROM canonical_credit_metadata m
  WHERE m.promotion_id=NEW.promotion_id AND m.credit_id=NEW.credit_id
    AND m.credit_provenance='IMPORT'
)
BEGIN SELECT RAISE(ABORT,'invalid_credit_installment'); END;

CREATE TRIGGER IF NOT EXISTS expense_operation_namespace BEFORE INSERT ON canonical_expense_operations
WHEN EXISTS(SELECT 1 FROM sales WHERE operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM canonical_financial_operations WHERE operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM canonical_credit_accounts WHERE operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM canonical_credit_metadata WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

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

CREATE TRIGGER IF NOT EXISTS canonical_customer_operations_namespace_insert
BEFORE INSERT ON canonical_customer_operations
WHEN
  EXISTS(SELECT 1 FROM sales WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_financial_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_expense_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_product_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_inventory_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_credit_accounts WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_credit_metadata WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

