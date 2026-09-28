CREATE TABLE IF NOT EXISTS import_runs (
  import_id        TEXT PRIMARY KEY NOT NULL CHECK (length(import_id) BETWEEN 1 AND 160),
  source_hash      TEXT NOT NULL CHECK (length(source_hash) = 64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  manifest_hash    TEXT NOT NULL CHECK (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  transform_version TEXT NOT NULL,
  device_id        TEXT NOT NULL REFERENCES devices(device_id),
  status           TEXT NOT NULL CHECK (status IN ('STAGING', 'PASS', 'FAIL')),
  source_files     INTEGER NOT NULL CHECK (source_files BETWEEN 1 AND 2),
  sources_json     TEXT NOT NULL,
  row_count        INTEGER NOT NULL CHECK (row_count >= 0),
  report_json      TEXT NOT NULL,
  revision         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source_hash, transform_version)
);

CREATE TABLE IF NOT EXISTS import_staging (
  import_id        TEXT NOT NULL REFERENCES import_runs(import_id),
  entity_type      TEXT NOT NULL CHECK (entity_type IN ('products', 'sales', 'customers', 'credits', 'credit_payments', 'expenses', 'cash_movements', 'cash_closures', 'inventory_movements')),
  source_key       TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 240),
  source_name      TEXT NOT NULL,
  source_row       INTEGER NOT NULL CHECK (source_row >= 1),
  payload_json     TEXT NOT NULL,
  payload_hash     TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('VALID', 'REVIEW')),
  PRIMARY KEY (import_id, entity_type, source_name, source_row, source_key)
);

CREATE TABLE IF NOT EXISTS import_issues (
  import_id        TEXT NOT NULL REFERENCES import_runs(import_id),
  issue_number     INTEGER NOT NULL CHECK (issue_number >= 1),
  severity         TEXT NOT NULL CHECK (severity IN ('ERROR', 'DIFFERENCE')),
  code             TEXT NOT NULL,
  entity_type      TEXT,
  source_key       TEXT,
  details_json     TEXT NOT NULL,
  PRIMARY KEY (import_id, issue_number)
);

CREATE INDEX IF NOT EXISTS idx_import_staging_run_status
  ON import_staging(import_id, validation_status, entity_type);
CREATE INDEX IF NOT EXISTS idx_import_issues_run_code
  ON import_issues(import_id, code);

-- Append-only staging: concurrent uploads invalidate the finalization CAS.
CREATE TRIGGER IF NOT EXISTS import_staging_insert_revision
AFTER INSERT ON import_staging BEGIN
  UPDATE import_runs SET revision = revision + 1 WHERE import_id = NEW.import_id;
END;
CREATE TRIGGER IF NOT EXISTS import_issues_insert_revision
AFTER INSERT ON import_issues BEGIN
  UPDATE import_runs SET revision = revision + 1 WHERE import_id = NEW.import_id;
END;
CREATE TRIGGER IF NOT EXISTS import_staging_no_update
BEFORE UPDATE ON import_staging BEGIN SELECT RAISE(ABORT, 'immutable_staging'); END;
CREATE TRIGGER IF NOT EXISTS import_staging_no_delete
BEFORE DELETE ON import_staging BEGIN SELECT RAISE(ABORT, 'immutable_staging'); END;
CREATE TRIGGER IF NOT EXISTS import_issues_no_update
BEFORE UPDATE ON import_issues BEGIN SELECT RAISE(ABORT, 'immutable_issues'); END;
CREATE TRIGGER IF NOT EXISTS import_issues_no_delete
BEFORE DELETE ON import_issues BEGIN SELECT RAISE(ABORT, 'immutable_issues'); END;
