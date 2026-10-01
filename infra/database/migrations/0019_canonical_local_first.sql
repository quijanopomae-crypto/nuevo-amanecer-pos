-- Additive, dormant until explicit owner grant. No existing rows are changed.
-- Scoped to the existing CANON promotion/authority epoch, not a second epoch.
CREATE TABLE IF NOT EXISTS canonical_local_writer (
 id INTEGER PRIMARY KEY CHECK(id=1),
 principal_id TEXT NOT NULL REFERENCES devices(device_id),
 promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
 authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=0),
 grant_id TEXT NOT NULL UNIQUE,
 granted_at TEXT NOT NULL,
 released_at TEXT
);

CREATE TRIGGER IF NOT EXISTS local_writer_canonical_write_guards BEFORE INSERT ON canonical_write_guards
WHEN EXISTS(SELECT 1 FROM canonical_local_writer w JOIN canonical_control c ON c.id=1
 WHERE w.id=1 AND w.promotion_id=c.active_promotion_id AND w.authority_epoch=c.authority_epoch
 AND (w.released_at IS NOT NULL OR w.principal_id<>NEW.principal_id))
BEGIN SELECT RAISE(ABORT,'read_only_session'); END;

CREATE TRIGGER IF NOT EXISTS local_writer_canonical_financial_operations BEFORE INSERT ON canonical_financial_operations
WHEN EXISTS(SELECT 1 FROM canonical_local_writer w JOIN canonical_control c ON c.id=1
 WHERE w.id=1 AND w.promotion_id=c.active_promotion_id AND w.authority_epoch=c.authority_epoch
 AND (w.released_at IS NOT NULL OR w.principal_id<>NEW.device_id))
BEGIN SELECT RAISE(ABORT,'read_only_session'); END;

CREATE TRIGGER IF NOT EXISTS local_writer_canonical_expense_operations BEFORE INSERT ON canonical_expense_operations
WHEN EXISTS(SELECT 1 FROM canonical_local_writer w JOIN canonical_control c ON c.id=1
 WHERE w.id=1 AND w.promotion_id=c.active_promotion_id AND w.authority_epoch=c.authority_epoch
 AND (w.released_at IS NOT NULL OR w.principal_id<>NEW.device_id))
BEGIN SELECT RAISE(ABORT,'read_only_session'); END;

CREATE TRIGGER IF NOT EXISTS local_writer_canonical_product_operations BEFORE INSERT ON canonical_product_operations
WHEN EXISTS(SELECT 1 FROM canonical_local_writer w JOIN canonical_control c ON c.id=1
 WHERE w.id=1 AND w.promotion_id=c.active_promotion_id AND w.authority_epoch=c.authority_epoch
 AND (w.released_at IS NOT NULL OR w.principal_id<>NEW.principal_id))
BEGIN SELECT RAISE(ABORT,'read_only_session'); END;

CREATE TRIGGER IF NOT EXISTS local_writer_canonical_inventory_operations BEFORE INSERT ON canonical_inventory_operations
WHEN EXISTS(SELECT 1 FROM canonical_local_writer w JOIN canonical_control c ON c.id=1
 WHERE w.id=1 AND w.promotion_id=c.active_promotion_id AND w.authority_epoch=c.authority_epoch
 AND (w.released_at IS NOT NULL OR w.principal_id<>NEW.principal_id))
BEGIN SELECT RAISE(ABORT,'read_only_session'); END;

CREATE TRIGGER IF NOT EXISTS local_writer_canonical_customer_operations BEFORE INSERT ON canonical_customer_operations
WHEN EXISTS(SELECT 1 FROM canonical_local_writer w JOIN canonical_control c ON c.id=1
 WHERE w.id=1 AND w.promotion_id=c.active_promotion_id AND w.authority_epoch=c.authority_epoch
 AND (w.released_at IS NOT NULL OR w.principal_id<>NEW.principal_id))
BEGIN SELECT RAISE(ABORT,'read_only_session'); END;

CREATE TRIGGER IF NOT EXISTS local_writer_canonical_customer_credit_policy_operations BEFORE INSERT ON canonical_customer_credit_policy_operations
WHEN EXISTS(SELECT 1 FROM canonical_local_writer w JOIN canonical_control c ON c.id=1
 WHERE w.id=1 AND w.promotion_id=c.active_promotion_id AND w.authority_epoch=c.authority_epoch
 AND (w.released_at IS NOT NULL OR w.principal_id<>NEW.principal_id))
BEGIN SELECT RAISE(ABORT,'read_only_session'); END;

CREATE TRIGGER IF NOT EXISTS local_writer_canonical_credit_accounts BEFORE INSERT ON canonical_credit_accounts
WHEN EXISTS(SELECT 1 FROM canonical_local_writer w JOIN canonical_control c ON c.id=1
 WHERE w.id=1 AND w.promotion_id=c.active_promotion_id AND w.authority_epoch=c.authority_epoch
 AND (w.released_at IS NOT NULL OR w.principal_id<>NEW.principal_id))
BEGIN SELECT RAISE(ABORT,'read_only_session'); END;
