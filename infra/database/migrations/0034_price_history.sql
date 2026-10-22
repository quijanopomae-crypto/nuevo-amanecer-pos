-- Misión 3 (#857): historial de precios en la nube. Aditiva: una tabla nueva y sus índices.
-- Solo anexos (append-only): nunca cambia productos, ventas, cajas ni créditos.
-- Montos en céntimos enteros; changed_at/received_at en UTC (la web muestra hora de Lima).
CREATE TABLE IF NOT EXISTS price_history (
  change_id     TEXT PRIMARY KEY NOT NULL CHECK (length(change_id) BETWEEN 5 AND 120 AND substr(change_id,1,4)='ph1:'),
  product_id    TEXT NOT NULL CHECK (length(product_id) BETWEEN 1 AND 160),
  field         TEXT NOT NULL CHECK (field IN ('venta','mayorista','costo')),
  before_cents  INTEGER CHECK (before_cents IS NULL OR (before_cents BETWEEN 0 AND 1000000000)),
  after_cents   INTEGER CHECK (after_cents IS NULL OR (after_cents BETWEEN 0 AND 1000000000)),
  origin        TEXT NOT NULL CHECK (origin IN ('ficha','importacion','compra','backfill')),
  ref           TEXT CHECK (ref IS NULL OR length(ref) BETWEEN 1 AND 200),
  user_name     TEXT NOT NULL CHECK (length(user_name) BETWEEN 1 AND 80),
  user_id       TEXT CHECK (user_id IS NULL OR length(user_id) BETWEEN 1 AND 80),
  changed_at    TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  received_at   TEXT NOT NULL,
  legacy_id     TEXT CHECK (legacy_id IS NULL OR length(legacy_id) <= 300),
  review_status TEXT CHECK (review_status IS NULL OR review_status IN ('pending','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS price_history_product ON price_history(product_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS price_history_received ON price_history(received_at, change_id);
-- Una fila pendiente (o rechazada) de un empleado no ocupa la (ref, field): el registro real del dueño entra igual.
CREATE UNIQUE INDEX IF NOT EXISTS price_history_ref ON price_history(ref, field) WHERE ref IS NOT NULL AND (review_status IS NULL OR review_status = 'approved');
