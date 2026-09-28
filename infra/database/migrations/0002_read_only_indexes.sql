CREATE INDEX IF NOT EXISTS idx_sync_operations_type_received
  ON sync_operations (entity_type, received_at DESC, operation_id DESC);
