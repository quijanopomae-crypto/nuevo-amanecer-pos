CREATE TABLE IF NOT EXISTS devices (
  device_id       TEXT PRIMARY KEY NOT NULL CHECK (length(device_id) BETWEEN 1 AND 160),
  role            TEXT NOT NULL CHECK (role IN ('writer', 'read_only')),
  status          TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  credential_hash TEXT NOT NULL UNIQUE CHECK (length(credential_hash) = 64 AND credential_hash NOT GLOB '*[^0-9a-f]*'),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at    TEXT
);

-- SQLite serializes writes; this partial unique index makes writer promotion atomic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_single_active_writer
  ON devices ((1))
  WHERE role = 'writer' AND status = 'active';
