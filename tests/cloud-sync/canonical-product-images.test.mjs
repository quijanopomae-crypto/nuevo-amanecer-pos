import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';

const migration = readFileSync('infra/database/migrations/0020_canonical_product_images.sql', 'utf8');
const applyMigration = readFileSync('infra/database/migrations/0021_canonical_product_image_apply.sql', 'utf8');
const SAFE_A = 'data:image/jpeg;base64,QUFBQQ==';
const SAFE_B = 'data:image/webp;base64,QkJCQg==';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

async function fixture(t) {
  return activeCanon(t, { migrations: [
    '0014_canonical_live_products.sql',
    '0015_canonical_inventory_adjust.sql',
    '0020_canonical_product_images.sql',
    '0021_canonical_product_image_apply.sql'
  ] });
}

function control(f) {
  return f.sql('SELECT mode,active_promotion_id FROM canonical_control WHERE id=1');
}

function insertImageEvent(f, {
  operationId,
  productId,
  provenance,
  productName,
  previousImage = null,
  image = SAFE_A,
  hash = HASH_A,
  revision = 1,
  batchId = '001',
}) {
  const c = control(f);
  return f.exec(`INSERT INTO canonical_product_image_events(
    operation_id,promotion_id,product_id,product_provenance,revision,batch_id,product_name,
    previous_image,image,image_sha256,source_page,source_image_url,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  operationId,c.active_promotion_id,productId,provenance,revision,batchId,productName,
  previousImage,image,hash,'https://example.test/source','https://example.test/image.jpg','2026-10-04T11:00:00.000Z');
}

function applyImage(f, row, provenance, image, operationId, revision = 1) {
  return insertImageEvent(f, {
    operationId,
    productId: row.product_id,
    provenance,
    productName: row.name,
    previousImage: row.image ?? null,
    image,
    hash: image === SAFE_B ? HASH_B : HASH_A,
    revision,
  });
}

test('audited IMPORT image event changes only image and stays append-only', async (t) => {
  const f = await fixture(t);
  const before = f.sql(`SELECT product_id,name,image,price_cents,cost_cents,current_stock_quantity,stock_revision,
    sku,barcode,category,tracks_inventory FROM products LIMIT 1`);
  applyImage(f, before, 'IMPORT', SAFE_A, 'img-import-1');

  const after = f.sql(`SELECT product_id,name,image,price_cents,cost_cents,current_stock_quantity,stock_revision,
    sku,barcode,category,tracks_inventory FROM products WHERE product_id=?`, before.product_id);
  assert.equal(after.image, SAFE_A);
  for (const field of ['product_id','name','price_cents','cost_cents','current_stock_quantity','stock_revision','sku','barcode','category','tracks_inventory']) {
    assert.equal(after[field], before[field], `${field} must remain unchanged`);
  }
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_product_image_events').n, 1);
  assert.throws(() => f.exec("UPDATE canonical_product_image_events SET image=? WHERE operation_id='img-import-1'", SAFE_B), /immutable/i);
  assert.throws(() => f.exec("DELETE FROM canonical_product_image_events WHERE operation_id='img-import-1'"), /immutable/i);
});

test('unaudited image change and mixed metadata/image change are rejected', async (t) => {
  const f = await fixture(t);
  const row = f.sql('SELECT product_id,name,image FROM products LIMIT 1');
  assert.throws(() => f.exec('UPDATE products SET image=? WHERE product_id=?', SAFE_A, row.product_id), /immutable_canonical_candidate/);

  assert.throws(() => f.exec('UPDATE products SET image=?,price_cents=price_cents+1 WHERE product_id=?', SAFE_A, row.product_id), /immutable_canonical_candidate/);
});

test('CANON read returns the new IMPORT image after refresh', async (t) => {
  const f = await fixture(t);
  const row = f.sql('SELECT product_id,name,image FROM products LIMIT 1');
  const tab = await device(f, { deviceId: 'img-reader-import', token: 'img-reader-import-token' });
  applyImage(f, row, 'IMPORT', SAFE_A, 'img-import-read');
  await tab.api.refresh();
  const seen = tab.api.snapshot().products.find((p) => p.product_id === row.product_id);
  assert.ok(seen);
  assert.equal(seen.image, SAFE_A);
});

test('audited LIVE image event works and preserves price/stock', async (t) => {
  const f = await fixture(t);
  const tab = await device(f, { deviceId: 'img-live-writer', token: 'img-live-writer-token' });
  const created = await tab.api.createProduct({
    product_id:'LIVE-IMAGE-1',name:'LIVE IMAGE PRODUCT',sku:'LIVE-IMAGE-SKU',barcode:'775009999991',
    alternate_codes:[],category:'abarrotes',brand:'Test',description:null,icon:'📦',image:null,
    unit:'unidad',purchase_unit:'unidad',purchase_factor:1,cost_cents:100,price_cents:200,
    box_price_cents:null,units_per_box:null,initial_stock_quantity:5,stock_min_quantity:1,
    expiry_date:null,includes_igv:true,tax_type:'gravado',complementary_tax:'',tracks_inventory:true
  });
  assert.equal(created.status, 'created');
  const before = f.sql("SELECT product_id,name,image,price_cents,cost_cents,current_stock_quantity,stock_revision FROM canonical_live_products WHERE product_id='LIVE-IMAGE-1'");
  applyImage(f, before, 'LIVE', SAFE_B, 'img-live-1');
  const after = f.sql("SELECT product_id,name,image,price_cents,cost_cents,current_stock_quantity,stock_revision FROM canonical_live_products WHERE product_id='LIVE-IMAGE-1'");
  assert.equal(after.image, SAFE_B);
  assert.equal(after.price_cents, before.price_cents);
  assert.equal(after.cost_cents, before.cost_cents);
  assert.equal(after.current_stock_quantity, before.current_stock_quantity);
  assert.equal(after.stock_revision, before.stock_revision);
  await tab.api.refresh();
  assert.equal(tab.api.snapshot().products.find((p) => p.product_id === 'LIVE-IMAGE-1').image, SAFE_B);
});

test('image authorization rejects wrong name/provenance/state, no-op and unsafe data URLs', async (t) => {
  const f = await fixture(t);
  const row = f.sql('SELECT product_id,name,image FROM products LIMIT 1');
  const base = { productId: row.product_id, previousImage: row.image ?? null, productName: row.name };

  assert.throws(() => insertImageEvent(f, { ...base, operationId:'wrong-name', provenance:'IMPORT', productName:row.name+' X' }), /mismatch/);
  assert.throws(() => insertImageEvent(f, { ...base, operationId:'wrong-prov', provenance:'LIVE' }), /mismatch/);
  assert.throws(() => insertImageEvent(f, { ...base, operationId:'svg', provenance:'IMPORT', image:'data:image/svg+xml;base64,PHN2Zz4=' }), /CHECK constraint|constraint/i);
  assert.throws(() => insertImageEvent(f, { ...base, operationId:'huge', provenance:'IMPORT', image:'data:image/jpeg;base64,'+'A'.repeat(180001) }), /CHECK constraint|constraint/i);
  if (row.image) assert.throws(() => insertImageEvent(f, { ...base, operationId:'noop', provenance:'IMPORT', image:row.image }), /noop/);

  f.exec("UPDATE canonical_control SET mode='CANONICAL_READ_ONLY' WHERE id=1");
  assert.throws(() => insertImageEvent(f, { ...base, operationId:'inactive', provenance:'IMPORT' }), /requires_active/);
});

test('inventory.adjust still works after image migrations and preserves image', async (t) => {
  const f = await fixture(t);
  const row = f.sql('SELECT product_id,name,image,current_stock_quantity,stock_revision FROM products WHERE tracks_inventory=1 ORDER BY product_id LIMIT 1');
  applyImage(f, row, 'IMPORT', SAFE_A, 'img-before-stock');
  const tab = await device(f, { deviceId:'img-stock-writer', token:'img-stock-writer-token' });
  const receipt = await tab.api.adjustInventory({
    product_id:row.product_id,movement_type:'ENTRADA',quantity:1,reason:'Verify image migration stock invariant'
  });
  assert.equal(receipt.status, 'created');
  const after = f.sql('SELECT image,current_stock_quantity,stock_revision FROM products WHERE product_id=?', row.product_id);
  assert.equal(after.image, SAFE_A);
  assert.equal(after.current_stock_quantity, row.current_stock_quantity + 1);
  assert.equal(after.stock_revision, row.stock_revision + 1);
});

test('migrations narrow the exception to audited image-only writes', () => {
  assert.match(migration, /canonical_product_image_events/);
  assert.match(migration, /previous_image IS OLD\.image/);
  assert.match(migration, /NEW\.image IS NOT OLD\.image/);
  assert.match(migration, /immutable_canonical_candidate/);
  assert.match(migration, /immutable_live_product/);
  assert.match(migration, /canonical_inventory_operations/);
  assert.match(applyMigration, /canonical_product_image_events_apply_import/);
  assert.match(applyMigration, /canonical_product_image_events_apply_live/);
  assert.match(applyMigration, /SET image=NEW\.image/);
});
