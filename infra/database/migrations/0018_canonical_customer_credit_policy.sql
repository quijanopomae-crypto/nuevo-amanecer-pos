-- 0018 — Canonical customer credit policy
-- Durable MANUAL/AUTOMATIC customer credit-line policy with immutable audit journal and optimistic CAS.

CREATE TABLE IF NOT EXISTS canonical_customer_credit_policy_operations (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 160),
  command TEXT NOT NULL CHECK(command='customer.credit-policy.set'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  customer_id TEXT NOT NULL CHECK(length(customer_id) BETWEEN 1 AND 160),
  mode TEXT NOT NULL CHECK(mode IN ('MANUAL','AUTOMATIC')),
  manual_limit_cents INTEGER CHECK(
    (mode='MANUAL' AND manual_limit_cents IS NOT NULL AND manual_limit_cents BETWEEN 0 AND 100000000)
    OR (mode='AUTOMATIC' AND manual_limit_cents IS NULL)
  ),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500),
  administrator_id TEXT CHECK(administrator_id IS NULL OR length(administrator_id) BETWEEN 1 AND 160),
  administrator_name TEXT NOT NULL CHECK(length(trim(administrator_name)) BETWEEN 1 AND 160),
  expected_policy_revision INTEGER NOT NULL CHECK(expected_policy_revision>=0),
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=0),
  control_revision INTEGER NOT NULL CHECK(control_revision>=0),
  client_contract TEXT NOT NULL CHECK(length(client_contract) BETWEEN 1 AND 160),
  principal_id TEXT NOT NULL CHECK(length(principal_id) BETWEEN 1 AND 160),
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64),
  created_at TEXT NOT NULL,
  FOREIGN KEY(promotion_id,customer_id) REFERENCES canonical_customer_registry(promotion_id,customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_credit_policy_operations_customer
  ON canonical_customer_credit_policy_operations(promotion_id,customer_id,created_at);

CREATE TABLE IF NOT EXISTS canonical_customer_credit_policies (
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  customer_id TEXT NOT NULL CHECK(length(customer_id) BETWEEN 1 AND 160),
  mode TEXT NOT NULL CHECK(mode IN ('MANUAL','AUTOMATIC')),
  manual_limit_cents INTEGER CHECK(
    (mode='MANUAL' AND manual_limit_cents IS NOT NULL AND manual_limit_cents BETWEEN 0 AND 100000000)
    OR (mode='AUTOMATIC' AND manual_limit_cents IS NULL)
  ),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500),
  administrator_id TEXT CHECK(administrator_id IS NULL OR length(administrator_id) BETWEEN 1 AND 160),
  administrator_name TEXT NOT NULL CHECK(length(trim(administrator_name)) BETWEEN 1 AND 160),
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=1),
  operation_id TEXT NOT NULL UNIQUE REFERENCES canonical_customer_credit_policy_operations(operation_id),
  PRIMARY KEY(promotion_id,customer_id),
  FOREIGN KEY(promotion_id,customer_id) REFERENCES canonical_customer_registry(promotion_id,customer_id)
);

CREATE TRIGGER IF NOT EXISTS customer_credit_policy_operation_authorized_insert
BEFORE INSERT ON canonical_customer_credit_policy_operations
WHEN NOT EXISTS(
  SELECT 1
  FROM canonical_control c
  JOIN devices d ON d.device_id=NEW.principal_id
  JOIN canonical_customer_registry r
    ON r.promotion_id=NEW.promotion_id AND r.customer_id=NEW.customer_id
  WHERE c.id=1
    AND c.mode='ACTIVE'
    AND c.active_promotion_id=NEW.promotion_id
    AND c.authority_epoch=NEW.authority_epoch
    AND c.revision=NEW.control_revision
    AND c.minimum_client_contract=NEW.client_contract
    AND d.role='writer' AND d.status='active'
    AND d.credential_hash=NEW.credential_hash
)
BEGIN SELECT RAISE(ABORT,'stale_authority'); END;

CREATE TRIGGER IF NOT EXISTS customer_credit_policy_operation_namespace_insert
BEFORE INSERT ON canonical_customer_credit_policy_operations
WHEN
  EXISTS(SELECT 1 FROM sales WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_financial_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_expense_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_product_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_inventory_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_credit_accounts WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_credit_metadata WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_customer_operations WHERE operation_id=NEW.operation_id) OR
  EXISTS(SELECT 1 FROM canonical_command_receipts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS customer_credit_policy_operations_no_update
BEFORE UPDATE ON canonical_customer_credit_policy_operations
BEGIN SELECT RAISE(ABORT,'immutable_customer_credit_policy_operation'); END;

CREATE TRIGGER IF NOT EXISTS customer_credit_policy_operations_no_delete
BEFORE DELETE ON canonical_customer_credit_policy_operations
BEGIN SELECT RAISE(ABORT,'immutable_customer_credit_policy_operation'); END;

CREATE TRIGGER IF NOT EXISTS customer_credit_policy_operations_no_replace
BEFORE INSERT ON canonical_customer_credit_policy_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_credit_policy_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'customer_credit_policy_operation_replace_forbidden'); END;

CREATE TRIGGER IF NOT EXISTS customer_credit_policy_insert_guard
BEFORE INSERT ON canonical_customer_credit_policies
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_customer_credit_policy_operations o
  WHERE o.operation_id=NEW.operation_id
    AND o.promotion_id=NEW.promotion_id
    AND o.customer_id=NEW.customer_id
    AND o.mode=NEW.mode
    AND o.manual_limit_cents IS NEW.manual_limit_cents
    AND o.reason=NEW.reason
    AND o.administrator_id IS NEW.administrator_id
    AND o.administrator_name=NEW.administrator_name
    AND o.expected_policy_revision=0
    AND NEW.revision=1
)
BEGIN SELECT RAISE(ABORT,'invalid_customer_credit_policy_insert'); END;

CREATE TRIGGER IF NOT EXISTS customer_credit_policy_update_guard
BEFORE UPDATE ON canonical_customer_credit_policies
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_customer_credit_policy_operations o
  WHERE o.operation_id=NEW.operation_id
    AND o.promotion_id=NEW.promotion_id
    AND o.customer_id=NEW.customer_id
    AND o.mode=NEW.mode
    AND o.manual_limit_cents IS NEW.manual_limit_cents
    AND o.reason=NEW.reason
    AND o.administrator_id IS NEW.administrator_id
    AND o.administrator_name=NEW.administrator_name
    AND o.expected_policy_revision=OLD.revision
    AND NEW.revision=OLD.revision+1
)
BEGIN SELECT RAISE(ABORT,'invalid_customer_credit_policy_update'); END;

CREATE TRIGGER IF NOT EXISTS customer_credit_policy_no_delete
BEFORE DELETE ON canonical_customer_credit_policies
BEGIN SELECT RAISE(ABORT,'immutable_customer_credit_policy_delete'); END;

CREATE TRIGGER IF NOT EXISTS customer_credit_policy_no_replace
BEFORE INSERT ON canonical_customer_credit_policies
WHEN EXISTS(
  SELECT 1 FROM canonical_customer_credit_policies
  WHERE promotion_id=NEW.promotion_id AND customer_id=NEW.customer_id
)
BEGIN SELECT RAISE(ABORT,'customer_credit_policy_replace_forbidden'); END;

CREATE TRIGGER IF NOT EXISTS canonical_customer_operations_policy_collision
BEFORE INSERT ON canonical_customer_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_credit_policy_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS canonical_product_operations_policy_collision
BEFORE INSERT ON canonical_product_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_credit_policy_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS canonical_inventory_operations_policy_collision
BEFORE INSERT ON canonical_inventory_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_credit_policy_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS canonical_expense_operations_policy_collision
BEFORE INSERT ON canonical_expense_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_credit_policy_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS canonical_financial_operations_policy_collision
BEFORE INSERT ON canonical_financial_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_credit_policy_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS sales_policy_operation_collision
BEFORE INSERT ON sales
WHEN EXISTS(SELECT 1 FROM canonical_customer_credit_policy_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS canonical_credit_accounts_policy_collision
BEFORE INSERT ON canonical_credit_accounts
WHEN EXISTS(SELECT 1 FROM canonical_customer_credit_policy_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS canonical_credit_metadata_policy_collision
BEFORE INSERT ON canonical_credit_metadata
WHEN EXISTS(SELECT 1 FROM canonical_customer_credit_policy_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS canonical_command_receipts_policy_collision
BEFORE INSERT ON canonical_command_receipts
WHEN EXISTS(SELECT 1 FROM canonical_customer_credit_policy_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
