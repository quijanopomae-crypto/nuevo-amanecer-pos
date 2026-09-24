-- 0009: versioned activation guard. D1 applies this migration as one transaction.
CREATE TABLE IF NOT EXISTS canonical_activation_receipts (
  operation_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  promotion_id TEXT NOT NULL REFERENCES canonical_promotions(promotion_id),
  expected_control_revision INTEGER NOT NULL CHECK(expected_control_revision>=0),
  expected_authority_epoch INTEGER NOT NULL CHECK(expected_authority_epoch>=0),
  client_contract TEXT NOT NULL CHECK(client_contract='a6-gate-c-v1'),
  writer_device_id TEXT NOT NULL REFERENCES devices(device_id),
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64 AND credential_hash NOT GLOB '*[^0-9a-f]*'),
  expected_products INTEGER NOT NULL CHECK(expected_products>=0),
  expected_customers INTEGER NOT NULL CHECK(expected_customers>=0),
  expected_credits INTEGER NOT NULL CHECK(expected_credits>=0),
  expected_credit_payments INTEGER NOT NULL CHECK(expected_credit_payments>=0),
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS canonical_activation_receipts_no_update BEFORE UPDATE ON canonical_activation_receipts BEGIN SELECT RAISE(ABORT,'immutable_receipt'); END;
CREATE TRIGGER IF NOT EXISTS canonical_activation_receipts_no_delete BEFORE DELETE ON canonical_activation_receipts BEGIN SELECT RAISE(ABORT,'immutable_receipt'); END;

-- Preserve the 0008 sale and financial marker exceptions verbatim; add only
-- the pre-traffic CANONICAL_READ_ONLY -> ACTIVE branch below.
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
 OR (
  OLD.mode='CANONICAL_READ_ONLY' AND NEW.mode='ACTIVE'
  AND NEW.id IS OLD.id AND NEW.active_promotion_id IS OLD.active_promotion_id
  AND OLD.active_promotion_id IS NOT NULL AND OLD.first_live_operation_id IS NULL
  AND NEW.first_live_operation_id IS NULL
  AND NEW.revision=OLD.revision+1 AND NEW.authority_epoch=OLD.authority_epoch+1
  AND OLD.minimum_client_contract='a6-gate-p-v1' AND NEW.minimum_client_contract='a6-gate-c-v1'
  AND NEW.writer_device_id='prod-v2-pos-writer-01'
  AND (OLD.writer_device_id=NEW.writer_device_id OR EXISTS(
    SELECT 1 FROM devices old_writer WHERE old_writer.device_id=OLD.writer_device_id
    AND old_writer.role='writer' AND old_writer.status='revoked'))
  AND EXISTS(SELECT 1 FROM canonical_promotions p WHERE p.promotion_id=OLD.active_promotion_id AND p.status='COMMITTED')
  AND EXISTS(SELECT 1 FROM devices d WHERE d.device_id=NEW.writer_device_id AND d.role='writer' AND d.status='active')
  AND (SELECT COUNT(*) FROM devices WHERE role='writer' AND status='active')=1
  AND EXISTS(SELECT 1 FROM devices WHERE device_id='prod-v2-a5-temporary-writer' AND role='writer' AND status='revoked')
  AND EXISTS(SELECT 1 FROM canonical_activation_receipts r WHERE r.promotion_id=OLD.active_promotion_id
    AND r.expected_products=(SELECT COUNT(*) FROM products WHERE promotion_id=OLD.active_promotion_id)
    AND r.expected_customers=(SELECT COUNT(*) FROM customers WHERE promotion_id=OLD.active_promotion_id)
    AND r.expected_credits=(SELECT COUNT(*) FROM credits WHERE promotion_id=OLD.active_promotion_id)
    AND r.expected_credit_payments=(SELECT COUNT(*) FROM credit_payments WHERE promotion_id=OLD.active_promotion_id))
  AND NOT EXISTS(SELECT 1 FROM sales) AND NOT EXISTS(SELECT 1 FROM sale_items) AND NOT EXISTS(SELECT 1 FROM inventory_movements) AND NOT EXISTS(SELECT 1 FROM cash_movements) AND NOT EXISTS(SELECT 1 FROM sync_operations) AND NOT EXISTS(SELECT 1 FROM canonical_sale_context) AND NOT EXISTS(SELECT 1 FROM canonical_financial_operations) AND NOT EXISTS(SELECT 1 FROM canonical_financial_events) AND NOT EXISTS(SELECT 1 FROM canonical_cash_sessions) AND NOT EXISTS(SELECT 1 FROM canonical_cash_closures) AND NOT EXISTS(SELECT 1 FROM canonical_write_guards)
  AND EXISTS(SELECT 1 FROM canonical_activation_receipts r JOIN devices d ON d.device_id=r.writer_device_id WHERE r.promotion_id=OLD.active_promotion_id AND r.expected_control_revision=OLD.revision AND r.expected_authority_epoch=OLD.authority_epoch AND r.client_contract=NEW.minimum_client_contract AND r.writer_device_id=NEW.writer_device_id AND r.credential_hash=d.credential_hash AND d.status='active' AND d.role='writer')
 )
 )
BEGIN SELECT RAISE(ABORT,'gate_p_control'); END;
