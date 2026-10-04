import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';

const migration = readFileSync('infra/database/migrations/0020_canonical_product_images.sql', 'utf8');
const canonicalSource = readFileSync('tools/cloudflare-lab/src/a6-canonical.js', 'utf8');
const SAFE_A = 'data:image/jpeg;base64,QUFBQQ==';
const SAFE_B = 'data:image/webp;base64,QkJCQg==';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

async function fixture(t) {
  return activeCanon(t, { migrations: ['0014_canonical_live_products.sql', '0020_canonical_product_images.sql'] });
}

function control(f) {
  return f.sql('SELECT mode,active_promotion_id FROM canonical_control WHERE id=1');
}

function insertImage(f, {
  operationId,
  productId,
  provenance,
  productName,
  image = SAFE_A,
  hash = HASH_A,
  revision = 1,
  batchId = '001',
}) {
  const c = control(f);
  return f.exec(`INSERT INTO canonical_product_image_events(
    operation_id,promotion_id,product_id,product_provenance,revision,batch_id,product_name,
    image,image_sha256,source_page,source_image_url,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  operationId,c.active_promotion_id,productId,provenance,revision,batchId,productName,
  image,hash,'https://example.test/source','https://example.test/image.jpg','2026-10-04T11:00:00.000Z');
}

test('migration creates an append-only image overlay without weakening product immutability', async (t) => {
  const f = await fixture(t);
  assert.equal(f.sql("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='canonical_product_image_events'").n, 1);
  assert.match(migration, /CREATE TRIGGER canonical_product_image_events_no_update/);
  assert.match(migration, /CREATE TRIGGER canonical_product_image_events_no_delete/);
  assert.match(migration, /products_no_update/);

  const imported = f.sql('SELECT product_id,name,price_cents,cost_cents,current_stock_quantity,stock_revision,image FROM products LIMIT 1');
  const before = { ...imported };
  insertImage(f, { operationId: 'img-import-1', productId: imported.product_id, provenance: 'IMPORT', productName: imported.name });

  const after = f.sql('SELECT product_id,name,price_cents,cost_cents,current_stock_quantity,stock_revision,image FROM products WHERE product_id=?', imported.product_id);
  assert.deepEqual(after, before, 'overlay insertion must not mutate the immutable product row');
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_product_image_events').n, 1);
  assert.throws(() => f.exec("UPDATE canonical_product_image_events SET image=? WHERE operation_id='img-import-1'", SAFE_B), /immutable|constraint/i);
  assert.throws(() => f.exec("DELETE FROM canonical_product_image_events WHERE operation_id='img-import-1'"), /immutable|constraint/i);
});

test('canonical product read overlays latest image for IMPORT and preserves all commercial fields', async (t) => {
  const f = await fixture(t);
  const imported = f.sql('SELECT product_id,name,price_cents,cost_cents,current_stock_quantity,stock_revision FROM products LIMIT 1');
  const tab = await device(f, { deviceId: 'img-reader-import', token: 'img-reader-import-token' });
  const before = tab.api.snapshot().products.find((p) => p.product_id === imported.product_id);
  assert.ok(before);

  insertImage(f, { operationId: 'img-import-a', productId: imported.product_id, provenance: 'IMPORT', productName: imported.name, image: SAFE_A, hash: HASH_A, revision: 1 });
  insertImage(f, { operationId: 'img-import-b', productId: imported.product_id, provenance: 'IMPORT', productName: imported.name, image: SAFE_B, hash: HASH_B, revision: 2 });
  await tab.api.refresh();

  const after = tab.api.snapshot().products.find((p) => p.product_id === imported.product_id);
  assert.equal(after.image, SAFE_B);
  for (const field of ['product_id','name','price_cents','cost_cents','current_stock_quantity','stock_revision']) {
    assert.equal(after[field], before[field], `${field} must not change when image changes`);
  }
});

test('canonical product read overlays image for LIVE product too', async (t) => {
  const f = await fixture(t);
  const c = control(f);
  f.exec(`INSERT INTO canonical_product_operations(operation_id,promotion_id,device_id,request_hash,product_id,result_json)
    VALUES('live-create-op',?,'session:a6-writer',?,'live-image-product','{}')`, c.active_promotion_id, 'c'.repeat(64));
  f.exec(`INSERT INTO canonical_live_products(
    promotion_id,product_id,operation_id,name,sku,alternate_codes_json,category,icon,unit,purchase_unit,purchase_factor,
    cost_cents,price_cents,opening_stock_quantity,current_stock_quantity,stock_revision,stock_min_quantity,includes_igv,tax_type,tracks_inventory
  ) VALUES(?,?,?,?,?,'[]','abarrotes','📦','unidad','unidad',1,100,200,5,5,0,0,1,'gravado',1)`,
  c.active_promotion_id,'live-image-product','live-create-op','LIVE IMAGE PRODUCT','LIVE-IMAGE-1');

  insertImage(f, { operationId: 'img-live-1', productId: 'live-image-product', provenance: 'LIVE', productName: 'LIVE IMAGE PRODUCT', image: SAFE_A, hash: HASH_A });
  const tab = await device(f, { deviceId: 'img-reader-live', token: 'img-reader-live-token' });
  const product = tab.api.snapshot().products.find((p) => p.product_id === 'live-image-product');
  assert.ok(product);
  assert.equal(product.image, SAFE_A);
  assert.equal(product.current_stock_quantity, 5);
  assert.equal(product.price_cents, 200);
});

test('overlay rejects wrong provenance/name, inactive promotions and non-raster/oversized images', async (t) => {
  const f = await fixture(t);
  const imported = f.sql('SELECT product_id,name FROM products LIMIT 1');

  assert.throws(() => insertImage(f, { operationId: 'img-wrong-name', productId: imported.product_id, provenance: 'IMPORT', productName: imported.name + ' X' }), /product|match|constraint/i);
  assert.throws(() => insertImage(f, { operationId: 'img-wrong-prov', productId: imported.product_id, provenance: 'LIVE', productName: imported.name }), /product|match|constraint/i);
  assert.throws(() => insertImage(f, { operationId: 'img-svg', productId: imported.product_id, provenance: 'IMPORT', productName: imported.name, image: 'data:image/svg+xml;base64,PHN2Zz4=' }), /image|constraint/i);
  assert.throws(() => insertImage(f, { operationId: 'img-huge', productId: imported.product_id, provenance: 'IMPORT', productName: imported.name, image: 'data:image/jpeg;base64,' + 'A'.repeat(180001) }), /image|constraint/i);

  f.exec("UPDATE canonical_control SET mode='CANONICAL_READ_ONLY' WHERE id=1");
  assert.throws(() => insertImage(f, { operationId: 'img-not-active', productId: imported.product_id, provenance: 'IMPORT', productName: imported.name }), /active|constraint/i);
});

test('image events participate in canonical read revision and source exposes overlay path only', async (t) => {
  const f = await fixture(t);
  const imported = f.sql('SELECT product_id,name FROM products LIMIT 1');
  const tab = await device(f, { deviceId: 'img-revision-reader', token: 'img-revision-reader-token' });
  const before = tab.api.snapshot().financial_revision;

  insertImage(f, { operationId: 'img-revision-1', productId: imported.product_id, provenance: 'IMPORT', productName: imported.name });
  await tab.api.refresh();
  const after = tab.api.snapshot().financial_revision;
  assert.equal(after, before + 1);

  assert.match(canonicalSource, /canonical_product_image_events/);
  assert.match(canonicalSource, /productImageLedgerCount/);
  assert.doesNotMatch(canonicalSource, /UPDATE\s+products\s+SET\s+image/i);
  assert.doesNotMatch(canonicalSource, /UPDATE\s+canonical_live_products\s+SET\s+image/i);
});
