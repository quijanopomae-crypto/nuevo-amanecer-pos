-- 0007_lab_workspace.sql
-- LAB ONLY: immutable CANON baselines + mutable/revisioned working snapshot.
-- This schema has no reference or write path to production resources.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lab_workspace_baselines (
  baseline_id TEXT PRIMARY KEY,
  source_ref TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  imported_by_device TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_workspace_baseline_source_hash
  ON lab_workspace_baselines(source_hash);

CREATE TABLE IF NOT EXISTS lab_workspace_revisions (
  workspace_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  operation_id TEXT NOT NULL,
  baseline_id TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  reason TEXT NOT NULL CHECK (reason IN ('REFRESH_FROM_CANON', 'LAB_SAVE', 'RESET_TO_BASELINE')),
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, revision),
  UNIQUE (workspace_id, operation_id),
  FOREIGN KEY (baseline_id) REFERENCES lab_workspace_baselines(baseline_id)
);

CREATE INDEX IF NOT EXISTS ix_lab_workspace_revisions_created
  ON lab_workspace_revisions(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lab_workspace_control (
  workspace_id TEXT PRIMARY KEY,
  active_revision INTEGER NOT NULL CHECK (active_revision > 0),
  active_baseline_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id, active_revision)
    REFERENCES lab_workspace_revisions(workspace_id, revision),
  FOREIGN KEY (active_baseline_id)
    REFERENCES lab_workspace_baselines(baseline_id)
);
