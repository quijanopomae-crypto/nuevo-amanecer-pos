CREATE TABLE IF NOT EXISTS sales (
  sale_id         TEXT PRIMARY KEY NOT NULL CHECK (length(sale_id) BETWEEN 1 AND 160),
  operation_id    TEXT NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 1 AND 160),
  payload_hash    TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  commit_token    TEXT NOT NULL,
  device_id       TEXT NOT NULL REFERENCES devices(device_id),
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('efectivo', 'yape', 'plin', 'transferencia', 'credito', 'mixto')),
  total_cents     INTEGER NOT NULL CHECK (total_cents > 0),
  payment_reference TEXT UNIQUE,
  created_at      TEXT NOT NULL,
  received_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  sale_id          TEXT NOT NULL REFERENCES sales(sale_id),
  line_number      INTEGER NOT NULL CHECK (line_number >= 1),
  operation_id     TEXT NOT NULL,
  product_id       TEXT NOT NULL CHECK (length(product_id) BETWEEN 1 AND 160),
  quantity         REAL NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  created_at       TEXT NOT NULL,
  PRIMARY KEY (sale_id, line_number),
  UNIQUE (operation_id, line_number)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  movement_id  TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL,
  sale_id      TEXT NOT NULL REFERENCES sales(sale_id),
  line_number  INTEGER NOT NULL,
  product_id   TEXT NOT NULL,
  quantity     REAL NOT NULL CHECK (quantity < 0),
  created_at   TEXT NOT NULL,
  UNIQUE (operation_id, line_number),
  FOREIGN KEY (sale_id, line_number) REFERENCES sale_items(sale_id, line_number)
);

CREATE TABLE IF NOT EXISTS cash_movements (
  movement_id    TEXT PRIMARY KEY NOT NULL,
  operation_id   TEXT NOT NULL UNIQUE,
  sale_id        TEXT NOT NULL UNIQUE REFERENCES sales(sale_id),
  payment_method TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  cash_cents     INTEGER NOT NULL CHECK (cash_cents >= 0),
  digital_cents  INTEGER NOT NULL CHECK (digital_cents >= 0),
  credit_cents   INTEGER NOT NULL CHECK (credit_cents >= 0),
  digital_method TEXT CHECK (digital_method IS NULL OR digital_method IN ('yape', 'plin', 'transferencia')),
  reference      TEXT,
  created_at     TEXT NOT NULL,
  CHECK (cash_cents + digital_cents + credit_cents = amount_cents)
);

CREATE INDEX IF NOT EXISTS idx_sale_items_operation ON sale_items(operation_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_operation ON inventory_movements(operation_id);
