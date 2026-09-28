-- 0010_session_auth.sql
-- Replaces per-device provisioning with persistent browser/session authorization.
-- Legacy "devices" rows remain only as compatibility principals for existing FKs
-- and canonical guard columns; they are no longer hardware registrations.

PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS idx_devices_single_active_writer;

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id  TEXT PRIMARY KEY NOT NULL CHECK (length(session_id) BETWEEN 1 AND 160),
  token_hash  TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_status
  ON auth_sessions(status, last_seen_at);

-- Existing manually provisioned hardware identities are disabled as authorities.
UPDATE devices
   SET status = 'revoked'
 WHERE device_id NOT LIKE 'session:%'
   AND status = 'active';
