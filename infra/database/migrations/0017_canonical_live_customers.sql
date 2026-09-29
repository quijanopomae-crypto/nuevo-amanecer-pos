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
