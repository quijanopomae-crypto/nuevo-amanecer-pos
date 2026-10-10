-- Append-only contact edits. Imported/live financial records remain unchanged.
CREATE TABLE IF NOT EXISTS canonical_customer_contacts (
  operation_id TEXT PRIMARY KEY NOT NULL,
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  customer_id TEXT NOT NULL,
  command TEXT NOT NULL CHECK(command='customer.contact.set'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 240),
  phone TEXT CHECK(phone IS NULL OR (length(phone) BETWEEN 10 AND 16 AND substr(phone,1,1)='+')),
  revision INTEGER NOT NULL CHECK(revision>=1),
  authority_epoch INTEGER NOT NULL,
  control_revision INTEGER NOT NULL,
  client_contract TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(promotion_id,customer_id,revision),
  FOREIGN KEY(promotion_id,customer_id) REFERENCES canonical_customer_registry(promotion_id,customer_id)
);
CREATE TRIGGER IF NOT EXISTS customer_contact_authorized_insert
BEFORE INSERT ON canonical_customer_contacts
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_control c JOIN devices d ON d.device_id=NEW.principal_id
  WHERE c.id=1 AND c.mode='ACTIVE' AND c.active_promotion_id=NEW.promotion_id
    AND c.authority_epoch=NEW.authority_epoch AND c.revision=NEW.control_revision
    AND c.minimum_client_contract=NEW.client_contract AND d.role='writer'
    AND d.status='active' AND d.credential_hash=NEW.credential_hash
)
BEGIN SELECT RAISE(ABORT,'stale_authority'); END;
CREATE TRIGGER IF NOT EXISTS customer_contact_revision_insert
BEFORE INSERT ON canonical_customer_contacts
WHEN NEW.revision <> COALESCE((SELECT MAX(revision) FROM canonical_customer_contacts
  WHERE promotion_id=NEW.promotion_id AND customer_id=NEW.customer_id),0)+1
BEGIN SELECT RAISE(ABORT,'stale_contact'); END;
CREATE TRIGGER IF NOT EXISTS customer_contact_no_update
BEFORE UPDATE ON canonical_customer_contacts
BEGIN SELECT RAISE(ABORT,'immutable_customer_contact'); END;
CREATE TRIGGER IF NOT EXISTS customer_contact_no_delete
BEFORE DELETE ON canonical_customer_contacts
BEGIN SELECT RAISE(ABORT,'immutable_customer_contact'); END;
CREATE TRIGGER IF NOT EXISTS customer_contact_no_replace
BEFORE INSERT ON canonical_customer_contacts
WHEN EXISTS(SELECT 1 FROM canonical_customer_contacts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS customer_contact_namespace_insert
BEFORE INSERT ON canonical_customer_contacts
WHEN EXISTS(SELECT 1 FROM sales WHERE operation_id=NEW.operation_id) OR
EXISTS(SELECT 1 FROM canonical_financial_operations WHERE operation_id=NEW.operation_id) OR
EXISTS(SELECT 1 FROM canonical_expense_operations WHERE operation_id=NEW.operation_id) OR
EXISTS(SELECT 1 FROM canonical_product_operations WHERE operation_id=NEW.operation_id) OR
EXISTS(SELECT 1 FROM canonical_inventory_operations WHERE operation_id=NEW.operation_id) OR
EXISTS(SELECT 1 FROM canonical_credit_accounts WHERE operation_id=NEW.operation_id) OR
EXISTS(SELECT 1 FROM canonical_credit_metadata WHERE operation_id=NEW.operation_id) OR
EXISTS(SELECT 1 FROM canonical_customer_operations WHERE operation_id=NEW.operation_id) OR
EXISTS(SELECT 1 FROM canonical_customer_credit_policy_operations WHERE operation_id=NEW.operation_id) OR
EXISTS(SELECT 1 FROM canonical_command_receipts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS sales_contact_collision
BEFORE INSERT ON sales
WHEN EXISTS(SELECT 1 FROM canonical_customer_contacts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS canonical_financial_operations_contact_collision
BEFORE INSERT ON canonical_financial_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_contacts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS canonical_expense_operations_contact_collision
BEFORE INSERT ON canonical_expense_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_contacts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS canonical_product_operations_contact_collision
BEFORE INSERT ON canonical_product_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_contacts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS canonical_inventory_operations_contact_collision
BEFORE INSERT ON canonical_inventory_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_contacts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS canonical_credit_accounts_contact_collision
BEFORE INSERT ON canonical_credit_accounts
WHEN EXISTS(SELECT 1 FROM canonical_customer_contacts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS canonical_credit_metadata_contact_collision
BEFORE INSERT ON canonical_credit_metadata
WHEN EXISTS(SELECT 1 FROM canonical_customer_contacts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS canonical_customer_operations_contact_collision
BEFORE INSERT ON canonical_customer_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_contacts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS canonical_customer_credit_policy_operations_contact_collision
BEFORE INSERT ON canonical_customer_credit_policy_operations
WHEN EXISTS(SELECT 1 FROM canonical_customer_contacts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS canonical_command_receipts_contact_collision
BEFORE INSERT ON canonical_command_receipts
WHEN EXISTS(SELECT 1 FROM canonical_customer_contacts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
