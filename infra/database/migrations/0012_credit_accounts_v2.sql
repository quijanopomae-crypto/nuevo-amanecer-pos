-- 0012: additive sidecars for Client Credit Accounts V2.
-- Financial ledgers remain authoritative; these tables only organize presentation
-- and persist installment schedules. No existing row is rewritten or deleted.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_credit_accounts (
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
  FOREIGN KEY(promotion_id,customer_id) REFERENCES customers(promotion_id,customer_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_accounts_name
  ON canonical_credit_accounts(promotion_id,customer_id,lower(name));

CREATE TABLE IF NOT EXISTS canonical_credit_metadata (
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
  FOREIGN KEY(promotion_id,customer_id) REFERENCES customers(promotion_id,customer_id)
);

CREATE TABLE IF NOT EXISTS canonical_credit_installments (
  promotion_id TEXT NOT NULL,
  credit_id TEXT NOT NULL,
  credit_provenance TEXT NOT NULL CHECK(credit_provenance IN ('IMPORT','LIVE')),
  installment_number INTEGER NOT NULL CHECK(installment_number BETWEEN 1 AND 60),
  due_date TEXT NOT NULL CHECK(length(due_date)=10),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0 AND amount_cents<=9007199254740991),
  operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(promotion_id,credit_provenance,credit_id,installment_number),
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_metadata_customer
  ON canonical_credit_metadata(promotion_id,customer_id,account_id);
CREATE INDEX IF NOT EXISTS idx_credit_installments_credit
  ON canonical_credit_installments(promotion_id,credit_provenance,credit_id,installment_number);

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

CREATE TRIGGER IF NOT EXISTS credit_accounts_no_update BEFORE UPDATE ON canonical_credit_accounts
BEGIN SELECT RAISE(ABORT,'immutable_credit_account'); END;
CREATE TRIGGER IF NOT EXISTS credit_accounts_no_delete BEFORE DELETE ON canonical_credit_accounts
BEGIN SELECT RAISE(ABORT,'immutable_credit_account'); END;
CREATE TRIGGER IF NOT EXISTS credit_metadata_no_update BEFORE UPDATE ON canonical_credit_metadata
BEGIN SELECT RAISE(ABORT,'immutable_credit_metadata'); END;
CREATE TRIGGER IF NOT EXISTS credit_metadata_no_delete BEFORE DELETE ON canonical_credit_metadata
BEGIN SELECT RAISE(ABORT,'immutable_credit_metadata'); END;
CREATE TRIGGER IF NOT EXISTS credit_installments_no_update BEFORE UPDATE ON canonical_credit_installments
BEGIN SELECT RAISE(ABORT,'immutable_credit_installment'); END;
CREATE TRIGGER IF NOT EXISTS credit_installments_no_delete BEFORE DELETE ON canonical_credit_installments
BEGIN SELECT RAISE(ABORT,'immutable_credit_installment'); END;

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

CREATE TRIGGER IF NOT EXISTS credit_installments_no_replace BEFORE INSERT ON canonical_credit_installments
WHEN EXISTS(
  SELECT 1 FROM canonical_credit_installments
  WHERE rowid=NEW.rowid OR
    (promotion_id=NEW.promotion_id AND credit_provenance=NEW.credit_provenance AND credit_id=NEW.credit_id AND installment_number=NEW.installment_number)
)
BEGIN SELECT RAISE(ABORT,'credit_installment_replace_forbidden'); END;
