-- Renumbered from checkpoint 0008; activation remains intentionally excluded.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_financial_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  command TEXT NOT NULL CHECK(command IN ('payment.create','cash.open','cash.close','adjustment.create','compensation.create')),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  result_json TEXT NOT NULL,
  promotion_id TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=0),
  control_revision INTEGER NOT NULL CHECK(control_revision>=0),
  client_contract TEXT NOT NULL CHECK(client_contract='a6-gate-c-v1'),
  device_id TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id)
);

CREATE TABLE IF NOT EXISTS canonical_cash_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  promotion_id TEXT NOT NULL,
  open_operation_id TEXT NOT NULL UNIQUE REFERENCES canonical_financial_operations(operation_id),
  opening_cents INTEGER NOT NULL CHECK(typeof(opening_cents)='integer' AND opening_cents BETWEEN 0 AND 9007199254740991),
  cash_movement_watermark INTEGER NOT NULL CHECK(cash_movement_watermark>=0),
  opened_at TEXT NOT NULL,
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id)
);

CREATE TABLE IF NOT EXISTS canonical_cash_closures (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES canonical_cash_sessions(session_id),
  close_operation_id TEXT NOT NULL UNIQUE REFERENCES canonical_financial_operations(operation_id),
  expected_cents INTEGER NOT NULL CHECK(typeof(expected_cents)='integer' AND expected_cents BETWEEN 0 AND 9007199254740991),
  counted_cents INTEGER NOT NULL CHECK(typeof(counted_cents)='integer' AND counted_cents BETWEEN 0 AND 9007199254740991),
  difference_cents INTEGER NOT NULL CHECK(typeof(difference_cents)='integer' AND difference_cents=counted_cents-expected_cents),
  cash_movement_watermark INTEGER NOT NULL CHECK(cash_movement_watermark>=0),
  closed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_financial_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL UNIQUE REFERENCES canonical_financial_operations(operation_id),
  promotion_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('PAYMENT','ADJUSTMENT','COMPENSATION')),
  session_id TEXT REFERENCES canonical_cash_sessions(session_id),
  credit_id TEXT,
  credit_provenance TEXT CHECK(credit_provenance IN ('IMPORT','LIVE') OR credit_provenance IS NULL),
  credit_delta_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(credit_delta_cents)='integer' AND credit_delta_cents BETWEEN -9007199254740991 AND 9007199254740991),
  cash_delta_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(cash_delta_cents)='integer' AND cash_delta_cents BETWEEN -9007199254740991 AND 9007199254740991),
  payment_method TEXT CHECK(payment_method IN ('efectivo','yape','plin','transferencia') OR payment_method IS NULL),
  reference TEXT,
  reason TEXT CHECK(reason IS NULL OR (length(trim(reason)) BETWEEN 1 AND 500)),
  compensates_operation_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  CHECK(event_type='PAYMENT' AND credit_id IS NOT NULL AND credit_delta_cents<0 AND reason IS NULL AND compensates_operation_id IS NULL
    OR event_type='ADJUSTMENT' AND credit_id IS NULL AND credit_delta_cents=0 AND cash_delta_cents<>0 AND reason IS NOT NULL AND compensates_operation_id IS NULL
    OR event_type='COMPENSATION' AND reason IS NOT NULL AND compensates_operation_id IS NOT NULL),
  CHECK(cash_delta_cents=0 OR session_id IS NOT NULL),
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_events_credit ON canonical_financial_events(promotion_id,credit_provenance,credit_id,event_id);
CREATE INDEX IF NOT EXISTS idx_financial_events_session ON canonical_financial_events(session_id,event_id);

CREATE VIEW IF NOT EXISTS canonical_credit_balances AS
SELECT b.*, b.opening_balance_cents+COALESCE((SELECT SUM(e.credit_delta_cents) FROM canonical_financial_events e
 WHERE e.promotion_id=b.promotion_id AND e.credit_id=b.credit_id AND e.credit_provenance=b.provenance),0) AS current_balance_cents,
 (SELECT COUNT(*) FROM canonical_financial_events e WHERE e.promotion_id=b.promotion_id AND e.credit_id=b.credit_id
 AND e.credit_provenance=b.provenance) AS revision
FROM (SELECT promotion_id,credit_id,'IMPORT' AS provenance,opening_balance_cents FROM credits
 UNION ALL SELECT promotion_id,credit_id,'LIVE',original_amount_cents FROM live_credits) b;

-- Watermarks use SQLite insertion order, never client clocks. Pre-session sales
-- remain external history. Cash sales in [open,close] participate exactly once.
CREATE VIEW IF NOT EXISTS canonical_cash_state AS
SELECT s.*, CASE WHEN c.session_id IS NULL THEN 'OPEN' ELSE 'CLOSED' END AS status,
 c.close_operation_id,c.counted_cents,c.difference_cents,c.closed_at,
 COALESCE(c.cash_movement_watermark,(SELECT COALESCE(MAX(rowid),0) FROM cash_movements)) AS closing_watermark,
 s.opening_cents + COALESCE((SELECT SUM(e.cash_delta_cents) FROM canonical_financial_events e WHERE e.session_id=s.session_id),0)
 + COALESCE((SELECT SUM(m.cash_cents) FROM cash_movements m JOIN canonical_sale_context x ON x.sale_id=m.sale_id
 WHERE x.promotion_id=s.promotion_id AND m.rowid>s.cash_movement_watermark
 AND m.rowid<=COALESCE(c.cash_movement_watermark,(SELECT COALESCE(MAX(rowid),0) FROM cash_movements))),0) AS expected_cents,
 (SELECT COUNT(*) FROM canonical_financial_events e WHERE e.session_id=s.session_id)
 + (SELECT COUNT(*) FROM cash_movements m JOIN canonical_sale_context x ON x.sale_id=m.sale_id
 WHERE x.promotion_id=s.promotion_id AND m.cash_cents>0 AND m.rowid>s.cash_movement_watermark
 AND m.rowid<=COALESCE(c.cash_movement_watermark,(SELECT COALESCE(MAX(rowid),0) FROM cash_movements)))
 + CASE WHEN c.session_id IS NULL THEN 0 ELSE 1 END AS revision
FROM canonical_cash_sessions s LEFT JOIN canonical_cash_closures c ON c.session_id=s.session_id;

CREATE TRIGGER IF NOT EXISTS cash_session_unique_open BEFORE INSERT ON canonical_cash_sessions
WHEN EXISTS(SELECT 1 FROM canonical_cash_state WHERE promotion_id=NEW.promotion_id AND status='OPEN')
 OR NEW.cash_movement_watermark<>(SELECT COALESCE(MAX(rowid),0) FROM cash_movements)
BEGIN SELECT RAISE(ABORT,'cash_session_conflict'); END;
CREATE TRIGGER IF NOT EXISTS cash_close_reconciles BEFORE INSERT ON canonical_cash_closures
WHEN NOT EXISTS(SELECT 1 FROM canonical_cash_state s WHERE s.session_id=NEW.session_id AND s.status='OPEN'
 AND s.expected_cents=NEW.expected_cents AND NEW.cash_movement_watermark=(SELECT COALESCE(MAX(rowid),0) FROM cash_movements))
BEGIN SELECT RAISE(ABORT,'cash_close_conflict'); END;
CREATE TRIGGER IF NOT EXISTS financial_event_cash_open BEFORE INSERT ON canonical_financial_events
WHEN NEW.session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM canonical_cash_state WHERE session_id=NEW.session_id
 AND promotion_id=NEW.promotion_id AND status='OPEN'
 AND expected_cents+NEW.cash_delta_cents BETWEEN 0 AND 9007199254740991)
BEGIN SELECT RAISE(ABORT,'cash_session_conflict'); END;
CREATE TRIGGER IF NOT EXISTS financial_event_credit_safe BEFORE INSERT ON canonical_financial_events
WHEN NEW.credit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM canonical_credit_balances b
 WHERE b.promotion_id=NEW.promotion_id AND b.credit_id=NEW.credit_id AND b.provenance=NEW.credit_provenance
 AND b.current_balance_cents+NEW.credit_delta_cents BETWEEN 0 AND b.opening_balance_cents
 AND b.current_balance_cents+NEW.credit_delta_cents<=9007199254740991)
BEGIN SELECT RAISE(ABORT,'credit_balance_conflict'); END;
CREATE TRIGGER IF NOT EXISTS financial_payment_exact BEFORE INSERT ON canonical_financial_events
WHEN NEW.event_type='PAYMENT' AND (NEW.payment_method IS NULL OR
 NEW.cash_delta_cents<>CASE WHEN NEW.payment_method='efectivo' THEN -NEW.credit_delta_cents ELSE 0 END
 OR (NEW.payment_method<>'efectivo' AND NEW.session_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'invalid_payment_effect'); END;
CREATE TRIGGER IF NOT EXISTS financial_compensation_exact BEFORE INSERT ON canonical_financial_events
WHEN NEW.event_type='COMPENSATION' AND NOT EXISTS(SELECT 1 FROM canonical_financial_events e
 WHERE e.operation_id=NEW.compensates_operation_id AND e.promotion_id=NEW.promotion_id AND e.event_type IN ('PAYMENT','ADJUSTMENT')
 AND e.credit_id IS NEW.credit_id AND e.credit_provenance IS NEW.credit_provenance
 AND e.credit_delta_cents=-NEW.credit_delta_cents AND e.cash_delta_cents=-NEW.cash_delta_cents
 AND e.payment_method IS NEW.payment_method)
BEGIN SELECT RAISE(ABORT,'invalid_compensation'); END;

-- Compatibility: cash sales before the first opening remain external. Once a
-- generation operates cash sessions, a closed till cannot accept cash sales.
CREATE TRIGGER IF NOT EXISTS sale_cash_requires_open_session BEFORE INSERT ON cash_movements
WHEN NEW.cash_cents>0 AND EXISTS(SELECT 1 FROM canonical_cash_sessions s JOIN canonical_sale_context x
 ON x.promotion_id=s.promotion_id WHERE x.sale_id=NEW.sale_id)
 AND NOT EXISTS(SELECT 1 FROM canonical_cash_state s JOIN canonical_sale_context x ON x.promotion_id=s.promotion_id
 WHERE x.sale_id=NEW.sale_id AND s.status='OPEN' AND s.expected_cents+NEW.cash_cents<=9007199254740991)
BEGIN SELECT RAISE(ABORT,'cash_session_required'); END;

-- A financial operation id and a sale operation id share one namespace.
CREATE TRIGGER IF NOT EXISTS financial_operation_sale_collision BEFORE INSERT ON canonical_financial_operations
WHEN EXISTS(SELECT 1 FROM sales WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;
CREATE TRIGGER IF NOT EXISTS sale_financial_operation_collision BEFORE INSERT ON sales
WHEN EXISTS(SELECT 1 FROM canonical_financial_operations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'operation_id_conflict'); END;

-- SQL-level authority fence. The Worker also compares the supplied credential hash;
-- this trigger makes every child impossible without the exact durable operation row.
DROP TRIGGER IF EXISTS financial_operation_authorized;
CREATE TRIGGER financial_operation_authorized BEFORE INSERT ON canonical_financial_operations
WHEN NOT EXISTS(SELECT 1 FROM canonical_control c JOIN devices d ON d.device_id=NEW.device_id
 WHERE c.id=1 AND c.mode='ACTIVE'
 AND c.active_promotion_id=NEW.promotion_id AND c.authority_epoch=NEW.authority_epoch
 AND c.revision=NEW.control_revision AND c.minimum_client_contract=NEW.client_contract
 AND c.writer_device_id=NEW.device_id AND d.role='writer' AND d.status='active'
 AND d.credential_hash=NEW.credential_hash)
BEGIN SELECT RAISE(ABORT,'stale_authority'); END;

CREATE TRIGGER IF NOT EXISTS cash_session_authorized BEFORE INSERT ON canonical_cash_sessions
WHEN NOT EXISTS(SELECT 1 FROM canonical_financial_operations o WHERE o.operation_id=NEW.open_operation_id
 AND o.command='cash.open' AND o.promotion_id=NEW.promotion_id)
BEGIN SELECT RAISE(ABORT,'invalid_financial_operation'); END;
CREATE TRIGGER IF NOT EXISTS cash_closure_authorized BEFORE INSERT ON canonical_cash_closures
WHEN NOT EXISTS(SELECT 1 FROM canonical_financial_operations o JOIN canonical_cash_sessions s ON s.session_id=NEW.session_id
 WHERE o.operation_id=NEW.close_operation_id AND o.command='cash.close' AND o.promotion_id=s.promotion_id)
BEGIN SELECT RAISE(ABORT,'invalid_financial_operation'); END;
CREATE TRIGGER IF NOT EXISTS financial_event_authorized BEFORE INSERT ON canonical_financial_events
WHEN NOT EXISTS(SELECT 1 FROM canonical_financial_operations o WHERE o.operation_id=NEW.operation_id
 AND o.promotion_id=NEW.promotion_id AND
 ((o.command='payment.create' AND NEW.event_type='PAYMENT') OR (o.command='adjustment.create' AND NEW.event_type='ADJUSTMENT')
 OR (o.command='compensation.create' AND NEW.event_type='COMPENSATION')))
BEGIN SELECT RAISE(ABORT,'invalid_financial_operation'); END;

-- All financial facts are immutable. INSERT OR REPLACE is rejected explicitly,
-- including when recursive_triggers is disabled and SQLite would hide its DELETE.
CREATE TRIGGER IF NOT EXISTS financial_operations_no_update BEFORE UPDATE ON canonical_financial_operations BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER IF NOT EXISTS financial_operations_no_delete BEFORE DELETE ON canonical_financial_operations BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER IF NOT EXISTS cash_sessions_no_update BEFORE UPDATE ON canonical_cash_sessions BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER IF NOT EXISTS cash_sessions_no_delete BEFORE DELETE ON canonical_cash_sessions BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER IF NOT EXISTS cash_closures_no_update BEFORE UPDATE ON canonical_cash_closures BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER IF NOT EXISTS cash_closures_no_delete BEFORE DELETE ON canonical_cash_closures BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER IF NOT EXISTS financial_events_no_update BEFORE UPDATE ON canonical_financial_events BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;
CREATE TRIGGER IF NOT EXISTS financial_events_no_delete BEFORE DELETE ON canonical_financial_events BEGIN SELECT RAISE(ABORT,'immutable_financial_history'); END;

CREATE TRIGGER IF NOT EXISTS financial_operations_no_replace BEFORE INSERT ON canonical_financial_operations
WHEN EXISTS(SELECT 1 FROM canonical_financial_operations WHERE rowid=NEW.rowid OR operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;

-- Preserve 0007's complete sale exception and all Gate P transition predicates.
-- The additional branch only permits a marker-only UPDATE while an exact
-- financial guard, authorized receipt and complete effect coexist in the batch.
-- No transition INTO ACTIVE and no reset/overwrite of the first marker is allowed.
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
  ))
 )
BEGIN SELECT RAISE(ABORT,'gate_p_control'); END;
CREATE TRIGGER IF NOT EXISTS cash_sessions_no_replace BEFORE INSERT ON canonical_cash_sessions
WHEN EXISTS(SELECT 1 FROM canonical_cash_sessions WHERE rowid=NEW.rowid OR session_id=NEW.session_id OR open_operation_id=NEW.open_operation_id)
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS cash_closures_no_replace BEFORE INSERT ON canonical_cash_closures
WHEN EXISTS(SELECT 1 FROM canonical_cash_closures WHERE rowid=NEW.rowid OR session_id=NEW.session_id OR close_operation_id=NEW.close_operation_id)
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;
CREATE TRIGGER IF NOT EXISTS financial_events_no_replace BEFORE INSERT ON canonical_financial_events
WHEN EXISTS(SELECT 1 FROM canonical_financial_events WHERE rowid=NEW.rowid OR event_id=NEW.event_id OR operation_id=NEW.operation_id OR compensates_operation_id=NEW.compensates_operation_id)
BEGIN SELECT RAISE(ABORT,'financial_replace_forbidden'); END;
