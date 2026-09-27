-- 0013: immutable CANON expenses ledger.
-- Preserves legacy semantics without overloading generic cash adjustments.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_expense_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL,
  promotion_id TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=0),
  control_revision INTEGER NOT NULL CHECK(control_revision>=0),
  client_contract TEXT NOT NULL CHECK(client_contract='a6-gate-c-v1'),
  device_id TEXT NOT NULL,
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64 AND credential_hash NOT GLOB '*[^0-9a-f]*'),
  expected_session_revision INTEGER CHECK(expected_session_revision IS NULL OR expected_session_revision>=0),
  created_at TEXT NOT NULL,
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id)
);

CREATE TABLE IF NOT EXISTS canonical_expenses (
  expense_id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL UNIQUE REFERENCES canonical_expense_operations(operation_id),
  promotion_id TEXT NOT NULL,
  session_id TEXT REFERENCES canonical_cash_sessions(session_id),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0 AND amount_cents<=9007199254740991),
  cash_delta_cents INTEGER NOT NULL CHECK(typeof(cash_delta_cents)='integer' AND cash_delta_cents BETWEEN -9007199254740991 AND 0),
  concept TEXT NOT NULL CHECK(length(trim(concept)) BETWEEN 1 AND 500),
  category TEXT NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 120),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('efectivo','yape','plin','transferencia')),
  expense_date TEXT NOT NULL CHECK(length(expense_date)=10),
  note TEXT CHECK(note IS NULL OR length(note)<=500),
  created_at TEXT NOT NULL,
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id),
  CHECK(
    session_id IS NULL AND cash_delta_cents=0
    OR session_id IS NOT NULL AND payment_method='efectivo' AND cash_delta_cents=-amount_cents
    OR session_id IS NOT NULL AND payment_method<>'efectivo' AND cash_delta_cents=0
  )
);

CREATE INDEX IF NOT EXISTS idx_canonical_expenses_promotion
  ON canonical_expenses(promotion_id,expense_id);
CREATE INDEX IF NOT EXISTS idx_canonical_expenses_session
  ON canonical_expenses(session_id,expense_id);

CREATE TRIGGER IF NOT EXISTS expense_operation_authorized BEFORE INSERT ON canonical_expense_operations
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_control c JOIN devices d ON d.device_id=NEW.device_id
  WHERE c.id=1 AND c.mode='ACTIVE' AND c.active_promotion_id=NEW.promotion_id
    AND c.authority_epoch=NEW.authority_epoch AND c.revision=NEW.control_revision
    AND c.minimum_client_contract=NEW.client_contract AND c.writer_device_id=NEW.device_id
    AND d.role='writer' AND d.status='active' AND d.credential_hash=NEW.credential_hash
)
BEGIN SELECT RAISE(ABORT,'stale_authority'); END;

CREATE TRIGGER IF NOT EXISTS expense_effect_authorized BEFORE INSERT ON canonical_expenses
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_expense_operations o
  WHERE o.operation_id=NEW.operation_id AND o.promotion_id=NEW.promotion_id
    AND (
      NEW.session_id IS NULL AND o.expected_session_revision IS NULL AND NEW.cash_delta_cents=0
      OR NEW.session_id IS NOT NULL AND o.expected_session_revision IS NOT NULL
        AND EXISTS(
          SELECT 1 FROM canonical_cash_state s
          WHERE s.promotion_id=NEW.promotion_id AND s.session_id=NEW.session_id
            AND s.status='OPEN' AND s.revision=o.expected_session_revision
            AND s.expected_cents+NEW.cash_delta_cents BETWEEN 0 AND 9007199254740991
        )
    )
)
BEGIN SELECT RAISE(ABORT,'expense_session_conflict'); END;

CREATE TRIGGER IF NOT EXISTS expense_operation_namespace BEFORE INSERT ON canonical_expense_operations
WHEN EXISTS(SELECT 1 FROM sales WHERE operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM canonical_financial_operations WHERE operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM canonical_credit_accounts WHERE operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM canonical_credit_metadata WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS sale_expense_operation_collision BEFORE INSERT ON sales
WHEN EXISTS(SELECT 1 FROM canonical_expense_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS financial_expense_operation_collision BEFORE INSERT ON canonical_financial_operations
WHEN EXISTS(SELECT 1 FROM canonical_expense_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS credit_account_expense_operation_collision BEFORE INSERT ON canonical_credit_accounts
WHEN EXISTS(SELECT 1 FROM canonical_expense_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS credit_metadata_expense_operation_collision BEFORE INSERT ON canonical_credit_metadata
WHEN EXISTS(SELECT 1 FROM canonical_expense_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

CREATE TRIGGER IF NOT EXISTS expense_operations_no_update BEFORE UPDATE ON canonical_expense_operations
BEGIN SELECT RAISE(ABORT,'immutable_expense_history'); END;
CREATE TRIGGER IF NOT EXISTS expense_operations_no_delete BEFORE DELETE ON canonical_expense_operations
BEGIN SELECT RAISE(ABORT,'immutable_expense_history'); END;
CREATE TRIGGER IF NOT EXISTS expenses_no_update BEFORE UPDATE ON canonical_expenses
BEGIN SELECT RAISE(ABORT,'immutable_expense_history'); END;
CREATE TRIGGER IF NOT EXISTS expenses_no_delete BEFORE DELETE ON canonical_expenses
BEGIN SELECT RAISE(ABORT,'immutable_expense_history'); END;
CREATE TRIGGER IF NOT EXISTS expense_operations_no_replace BEFORE INSERT ON canonical_expense_operations
WHEN EXISTS(SELECT 1 FROM canonical_expense_operations WHERE rowid=NEW.rowid OR operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'expense_replace_forbidden'); END;
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
    AND s.device_id=OLD.writer_device_id
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
    AND o.device_id=OLD.writer_device_id AND d.role='writer' AND d.status='active' AND d.credential_hash=o.credential_hash
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
    AND o.device_id=OLD.writer_device_id AND d.role='writer' AND d.status='active'
    AND d.credential_hash=o.credential_hash
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
