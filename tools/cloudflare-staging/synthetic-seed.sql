PRAGMA foreign_keys = ON;
INSERT INTO devices(device_id, role, status, credential_hash)
VALUES('staging-seed-device', 'read_only', 'active', '1111111111111111111111111111111111111111111111111111111111111111');

INSERT INTO import_runs(
  import_id, source_hash, manifest_hash, transform_version, device_id, status,
  source_files, sources_json, row_count, report_json, revision
) VALUES(
  'staging-synthetic-import-v1',
  '2222222222222222222222222222222222222222222222222222222222222222',
  '3333333333333333333333333333333333333333333333333333333333333333',
  'staging-synthetic-v1',
  'staging-seed-device',
  'PASS',
  1,
  '["synthetic-seed"]',
  2,
  '{"synthetic":true,"verdict":"PASS","issue_count":0}',
  0
);

UPDATE canonical_control
SET mode='FROZEN',
    revision=revision+1,
    authority_epoch=authority_epoch+1,
    writer_device_id=NULL
WHERE id=1 AND mode='LEGACY' AND active_promotion_id IS NULL;

INSERT INTO import_staging(
  import_id, entity_type, source_key, source_name, source_row,
  payload_json, payload_hash, validation_status
) VALUES(
  'staging-synthetic-import-v1',
  'products',
  'product-1',
  'staging-seed',
  1,
  '{"id":"SYN-PROD-001","nombre":"Producto Sintético","synthetic":true}',
  '4444444444444444444444444444444444444444444444444444444444444444',
  'VALID'
);

INSERT INTO import_staging(
  import_id, entity_type, source_key, source_name, source_row,
  payload_json, payload_hash, validation_status
) VALUES(
  'staging-synthetic-import-v1',
  'customers',
  'customer-1',
  'staging-seed',
  2,
  '{"id":"SYN-CUST-001","nombre":"Cliente Sintético","synthetic":true}',
  '5555555555555555555555555555555555555555555555555555555555555555',
  'VALID'
);

INSERT INTO canonical_promotions(
  promotion_id, operation_id, request_hash, import_id, source_hash, manifest_hash,
  transform_version, staging_revision, mapping_version, schema_version, policy_hash,
  control_revision, operational_manifest_json, operational_manifest_hash, device_id,
  status, candidate_revision
) VALUES(
  'staging-synthetic-promotion-v1',
  'staging-synthetic-promote-v1',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'staging-synthetic-import-v1',
  '2222222222222222222222222222222222222222222222222222222222222222',
  '3333333333333333333333333333333333333333333333333333333333333333',
  'staging-synthetic-v1',
  2,
  'staging-map-v1',
  'staging-schema-v1',
  '6666666666666666666666666666666666666666666666666666666666666666',
  1,
  '{"synthetic":true,"environment":"staging"}',
  '7777777777777777777777777777777777777777777777777777777777777777',
  'staging-seed-device',
  'PREPARED',
  0
);

INSERT INTO products(
  promotion_id, product_id, name, sku, barcode, category,
  cost_cents, price_cents, opening_stock_quantity, current_stock_quantity,
  stock_min_quantity, stock_revision, tracks_inventory,
  source_import_id, source_entity_type, source_name, source_row, source_key,
  source_payload_json, source_payload_hash, mapping_version
) VALUES(
  'staging-synthetic-promotion-v1',
  'SYN-PROD-001',
  'Producto Sintético',
  'SYN-001',
  '999000000001',
  'PRUEBAS',
  500,
  800,
  25,
  25,
  5,
  0,
  1,
  'staging-synthetic-import-v1',
  'products',
  'staging-seed',
  1,
  'product-1',
  '{"id":"SYN-PROD-001","nombre":"Producto Sintético","synthetic":true}',
  '4444444444444444444444444444444444444444444444444444444444444444',
  'staging-map-v1'
);

INSERT INTO customers(
  promotion_id, customer_id, name, document, phone, total_purchases_cents,
  source_import_id, source_entity_type, source_name, source_row, source_key,
  source_payload_json, source_payload_hash, mapping_version
) VALUES(
  'staging-synthetic-promotion-v1',
  'SYN-CUST-001',
  'Cliente Sintético',
  '00000001',
  '900000001',
  0,
  'staging-synthetic-import-v1',
  'customers',
  'staging-seed',
  2,
  'customer-1',
  '{"id":"SYN-CUST-001","nombre":"Cliente Sintético","synthetic":true}',
  '5555555555555555555555555555555555555555555555555555555555555555',
  'staging-map-v1'
);

UPDATE canonical_promotions
SET status='COMMITTED',
    sealed_revision=2,
    canonical_digest='8888888888888888888888888888888888888888888888888888888888888888',
    result_json='{"synthetic":true,"status":"COMMITTED"}',
    committed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE promotion_id='staging-synthetic-promotion-v1'
  AND status='PREPARED';

UPDATE canonical_control
SET mode='CANONICAL_READ_ONLY',
    active_promotion_id='staging-synthetic-promotion-v1',
    revision=revision+1,
    authority_epoch=authority_epoch+1,
    minimum_client_contract='a6-gate-p-v1'
WHERE id=1
  AND mode='FROZEN';
