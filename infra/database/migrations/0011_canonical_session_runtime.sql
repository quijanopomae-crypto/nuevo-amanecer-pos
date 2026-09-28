-- 0011: canonical runtime authorization follows persistent browser sessions, not a fixed device.
-- Existing historical column names remain for compatibility; session principals are stored as session:<uuid>.
PRAGMA foreign_keys = ON;

ALTER TABLE canonical_write_guards ADD COLUMN principal_id TEXT;
ALTER TABLE canonical_write_guards ADD COLUMN credential_hash TEXT CHECK(credential_hash IS NULL OR (length(credential_hash)=64 AND credential_hash NOT GLOB '*[^0-9a-f]*'));

DROP TRIGGER IF EXISTS canonical_write_guards_authorized_insert;
CREATE TRIGGER canonical_write_guards_authorized_insert BEFORE INSERT ON canonical_write_guards
WHEN NEW.principal_id IS NULL OR NEW.credential_hash IS NULL OR NOT EXISTS(
  SELECT 1 FROM canonical_control c JOIN devices d ON d.device_id=NEW.principal_id
  WHERE c.id=1 AND c.mode='ACTIVE' AND c.active_promotion_id=NEW.promotion_id
    AND c.authority_epoch=NEW.authority_epoch AND c.revision=NEW.control_revision
    AND c.minimum_client_contract=NEW.client_contract
    AND d.role='writer' AND d.status='active' AND d.credential_hash=NEW.credential_hash
)
BEGIN SELECT RAISE(ABORT,'stale_authority'); END;

DROP TRIGGER IF EXISTS financial_operation_authorized;
CREATE TRIGGER financial_operation_authorized BEFORE INSERT ON canonical_financial_operations
WHEN NOT EXISTS(
  SELECT 1 FROM canonical_control c JOIN devices d ON d.device_id=NEW.device_id
  WHERE c.id=1 AND c.mode='ACTIVE'
    AND c.active_promotion_id=NEW.promotion_id AND c.authority_epoch=NEW.authority_epoch
    AND c.revision=NEW.control_revision AND c.minimum_client_contract=NEW.client_contract
    AND d.role='writer' AND d.status='active' AND d.credential_hash=NEW.credential_hash
)
BEGIN SELECT RAISE(ABORT,'stale_authority'); END;

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
  ))
 )
BEGIN SELECT RAISE(ABORT,'gate_p_control'); END;
