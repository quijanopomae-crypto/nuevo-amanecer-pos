-- Registro append-only de operaciones recibidas desde el OUTBOX de cada dispositivo POS.
-- operation_id es la clave de idempotencia: una fila por operación, nunca se sobrescribe.
-- received_at es la hora del servidor; created_at viene del reloj del dispositivo y no
-- sirve como evidencia de recepción ni para ordenar entre dispositivos.
CREATE TABLE IF NOT EXISTS sync_operations (
  operation_id    TEXT PRIMARY KEY,
  device_id       TEXT NOT NULL,
  device_sequence INTEGER NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  payload         TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  received_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Permite al futuro pull por dispositivo preguntar "¿cuál fue la última secuencia recibida?"
CREATE INDEX IF NOT EXISTS idx_sync_operations_device_seq
  ON sync_operations (device_id, device_sequence);
