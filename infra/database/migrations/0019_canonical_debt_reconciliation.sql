-- 0019 — Canonical debt baseline reconciliation
-- Keeps imported/live payment history immutable while allowing an owner-authorized
-- source-balance reconciliation to add explicit synthetic debt or reduce the
-- baseline of an existing credit. Reconciliation facts are append-only.

CREATE TABLE IF NOT EXISTS canonical_reconciliation_credits (
  reconciliation_id TEXT PRIMARY KEY NOT NULL CHECK(length(reconciliation_id) BETWEEN 1 AND 160),
  promotion_id TEXT NOT NULL,
  credit_id TEXT NOT NULL CHECK(length(credit_id) BETWEEN 1 AND 160),
  customer_id TEXT NOT NULL CHECK(length(customer_id) BETWEEN 1 AND 160),
  original_amount_cents INTEGER NOT NULL CHECK(typeof(original_amount_cents)='integer' AND original_amount_cents>0),
  target_customer_balance_cents INTEGER NOT NULL CHECK(typeof(target_customer_balance_cents)='integer' AND target_customer_balance_cents>=0),
  source_index INTEGER NOT NULL CHECK(typeof(source_index)='integer' AND source_index>=1),
  source_label TEXT NOT NULL CHECK(length(trim(source_label)) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  UNIQUE(promotion_id,credit_id),
  UNIQUE(promotion_id,source_label,source_index),
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id),
  FOREIGN KEY(promotion_id,customer_id) REFERENCES canonical_customer_registry(promotion_id,customer_id)
);

CREATE TABLE IF NOT EXISTS canonical_credit_baseline_adjustments (
  adjustment_id TEXT PRIMARY KEY NOT NULL CHECK(length(adjustment_id) BETWEEN 1 AND 160),
  promotion_id TEXT NOT NULL,
  credit_id TEXT NOT NULL CHECK(length(credit_id) BETWEEN 1 AND 160),
  credit_provenance TEXT NOT NULL CHECK(credit_provenance IN ('IMPORT','LIVE')),
  customer_id TEXT NOT NULL CHECK(length(customer_id) BETWEEN 1 AND 160),
  delta_cents INTEGER NOT NULL CHECK(typeof(delta_cents)='integer' AND delta_cents<0),
  target_customer_balance_cents INTEGER NOT NULL CHECK(typeof(target_customer_balance_cents)='integer' AND target_customer_balance_cents>=0),
  source_index INTEGER NOT NULL CHECK(typeof(source_index)='integer' AND source_index>=1),
  source_label TEXT NOT NULL CHECK(length(trim(source_label)) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  UNIQUE(promotion_id,source_label,source_index,credit_id),
  FOREIGN KEY(promotion_id) REFERENCES canonical_promotions(promotion_id),
  FOREIGN KEY(promotion_id,customer_id) REFERENCES canonical_customer_registry(promotion_id,customer_id)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_credits_customer
  ON canonical_reconciliation_credits(promotion_id,customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_baseline_adjustments_credit
  ON canonical_credit_baseline_adjustments(promotion_id,credit_provenance,credit_id);
CREATE INDEX IF NOT EXISTS idx_credit_baseline_adjustments_customer
  ON canonical_credit_baseline_adjustments(promotion_id,customer_id);

CREATE TRIGGER IF NOT EXISTS reconciliation_credit_guard
BEFORE INSERT ON canonical_reconciliation_credits
WHEN
  NOT EXISTS(
    SELECT 1 FROM canonical_control c
    WHERE c.id=1 AND c.mode='ACTIVE' AND c.active_promotion_id=NEW.promotion_id
  )
  OR NOT EXISTS(
    SELECT 1 FROM canonical_customer_registry r
    WHERE r.promotion_id=NEW.promotion_id AND r.customer_id=NEW.customer_id
  )
  OR EXISTS(
    SELECT 1 FROM credits c
    WHERE c.promotion_id=NEW.promotion_id AND c.credit_id=NEW.credit_id
  )
  OR EXISTS(
    SELECT 1 FROM live_credits l
    WHERE l.promotion_id=NEW.promotion_id AND l.credit_id=NEW.credit_id
  )
BEGIN SELECT RAISE(ABORT,'invalid_reconciliation_credit'); END;

CREATE TRIGGER IF NOT EXISTS reconciliation_credit_no_update
BEFORE UPDATE ON canonical_reconciliation_credits
BEGIN SELECT RAISE(ABORT,'immutable_reconciliation_credit'); END;

CREATE TRIGGER IF NOT EXISTS reconciliation_credit_no_delete
BEFORE DELETE ON canonical_reconciliation_credits
BEGIN SELECT RAISE(ABORT,'immutable_reconciliation_credit'); END;

CREATE TRIGGER IF NOT EXISTS baseline_adjustment_guard
BEFORE INSERT ON canonical_credit_baseline_adjustments
WHEN NOT EXISTS(
  SELECT 1
  FROM (
    SELECT promotion_id,credit_id,customer_id,'IMPORT' AS provenance,opening_balance_cents AS base_opening
    FROM credits
    UNION ALL
    SELECT promotion_id,credit_id,customer_id,'LIVE' AS provenance,original_amount_cents AS base_opening
    FROM live_credits
  ) x
  WHERE x.promotion_id=NEW.promotion_id
    AND x.credit_id=NEW.credit_id
    AND x.provenance=NEW.credit_provenance
    AND x.customer_id=NEW.customer_id
    AND x.base_opening
      + COALESCE((SELECT SUM(a.delta_cents) FROM canonical_credit_baseline_adjustments a
          WHERE a.promotion_id=NEW.promotion_id AND a.credit_id=NEW.credit_id
            AND a.credit_provenance=NEW.credit_provenance),0)
      + NEW.delta_cents >= 0
    AND x.base_opening
      + COALESCE((SELECT SUM(a.delta_cents) FROM canonical_credit_baseline_adjustments a
          WHERE a.promotion_id=NEW.promotion_id AND a.credit_id=NEW.credit_id
            AND a.credit_provenance=NEW.credit_provenance),0)
      + NEW.delta_cents
      + COALESCE((SELECT SUM(e.credit_delta_cents) FROM canonical_financial_events e
          WHERE e.promotion_id=NEW.promotion_id AND e.credit_id=NEW.credit_id
            AND e.credit_provenance=NEW.credit_provenance),0) >= 0
)
BEGIN SELECT RAISE(ABORT,'invalid_baseline_adjustment'); END;

CREATE TRIGGER IF NOT EXISTS baseline_adjustment_no_update
BEFORE UPDATE ON canonical_credit_baseline_adjustments
BEGIN SELECT RAISE(ABORT,'immutable_baseline_adjustment'); END;

CREATE TRIGGER IF NOT EXISTS baseline_adjustment_no_delete
BEFORE DELETE ON canonical_credit_baseline_adjustments
BEGIN SELECT RAISE(ABORT,'immutable_baseline_adjustment'); END;

-- This trigger depends on canonical_credit_balances, so rebuild it around the view.
DROP TRIGGER IF EXISTS financial_event_credit_safe;
DROP VIEW IF EXISTS canonical_credit_balances;

CREATE VIEW canonical_credit_balances AS
SELECT
  b.promotion_id,
  b.credit_id,
  b.provenance,
  b.base_opening_cents + b.baseline_delta_cents AS opening_balance_cents,
  b.base_opening_cents + b.baseline_delta_cents
    + COALESCE((SELECT SUM(e.credit_delta_cents) FROM canonical_financial_events e
        WHERE e.promotion_id=b.promotion_id AND e.credit_id=b.credit_id
          AND e.credit_provenance=b.provenance),0) AS current_balance_cents,
  (SELECT COUNT(*) FROM canonical_financial_events e
      WHERE e.promotion_id=b.promotion_id AND e.credit_id=b.credit_id
        AND e.credit_provenance=b.provenance)
    + b.baseline_adjustment_count AS revision,
  b.baseline_delta_cents
FROM (
  SELECT
    c.promotion_id,
    c.credit_id,
    'IMPORT' AS provenance,
    c.opening_balance_cents AS base_opening_cents,
    COALESCE((SELECT SUM(a.delta_cents) FROM canonical_credit_baseline_adjustments a
      WHERE a.promotion_id=c.promotion_id AND a.credit_id=c.credit_id
        AND a.credit_provenance='IMPORT'),0) AS baseline_delta_cents,
    (SELECT COUNT(*) FROM canonical_credit_baseline_adjustments a
      WHERE a.promotion_id=c.promotion_id AND a.credit_id=c.credit_id
        AND a.credit_provenance='IMPORT') AS baseline_adjustment_count
  FROM credits c
  UNION ALL
  SELECT
    l.promotion_id,
    l.credit_id,
    'LIVE',
    l.original_amount_cents,
    COALESCE((SELECT SUM(a.delta_cents) FROM canonical_credit_baseline_adjustments a
      WHERE a.promotion_id=l.promotion_id AND a.credit_id=l.credit_id
        AND a.credit_provenance='LIVE'),0),
    (SELECT COUNT(*) FROM canonical_credit_baseline_adjustments a
      WHERE a.promotion_id=l.promotion_id AND a.credit_id=l.credit_id
        AND a.credit_provenance='LIVE')
  FROM live_credits l
  UNION ALL
  SELECT
    r.promotion_id,
    r.credit_id,
    'IMPORT',
    r.original_amount_cents,
    0,
    0
  FROM canonical_reconciliation_credits r
) b;

CREATE TRIGGER IF NOT EXISTS financial_event_credit_safe BEFORE INSERT ON canonical_financial_events
WHEN NEW.credit_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM canonical_credit_balances b
  WHERE b.promotion_id=NEW.promotion_id
    AND b.credit_id=NEW.credit_id
    AND b.provenance=NEW.credit_provenance
    AND b.current_balance_cents+NEW.credit_delta_cents BETWEEN 0 AND b.opening_balance_cents
    AND b.current_balance_cents+NEW.credit_delta_cents<=9007199254740991
)
BEGIN SELECT RAISE(ABORT,'credit_balance_conflict'); END;
