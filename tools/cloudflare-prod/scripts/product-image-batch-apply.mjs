import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MANIFEST_PATH = process.env.PRODUCT_IMAGE_BATCH_PATH || 'ops/product-images/batch-001.json';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const PROD_DB = process.env.PROD_DATABASE_ID || 'cf2c83d3-f187-472e-967b-0ad24be969eb';
const MAX_DATA_URL_LENGTH = 180000;
const MAX_ITEMS = 10;
const ALLOWED_MIME = new Set(['image/jpeg','image/png','image/webp','image/gif']);
const MODE = process.argv[2] || 'apply';
const PREPARED_PATH = process.env.PRODUCT_IMAGE_PREPARED_PATH || '/tmp/product-image-batch-001-prepared.json';

function requireString(value, label, max = 4096) {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('invalid manifest');
  if (manifest.schema !== 'nuevo-amanecer.canon-product-image-batch/v1') throw new Error('invalid manifest schema');
  if (manifest.approved_by_owner !== true) throw new Error('owner approval missing');
  if (manifest.max_items !== MAX_ITEMS || !Array.isArray(manifest.entries) || manifest.entries.length !== MAX_ITEMS) {
    throw new Error('batch must contain exactly 10 entries');
  }
  requireString(manifest.batch_id, 'batch_id', 80);
  const ids = new Set();
  const names = new Set();
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid entry');
    const id = requireString(entry.id, 'entry id', 100);
    const name = requireString(entry.product_name, 'product_name', 240);
    requireString(entry.expected_presentation, 'expected_presentation', 80);
    if (ids.has(id)) throw new Error('duplicate entry id');
    if (names.has(name)) throw new Error('duplicate exact product name');
    ids.add(id); names.add(name);
    for (const key of ['source_page','image_url']) {
      const value = requireString(entry[key], key, key === 'image_url' ? 4096 : 2048);
      let url;
      try { url = new URL(value); } catch { throw new Error(`invalid ${key}`); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${key} must be clean HTTPS`);
    }
  }
  return manifest;
}

function safeDataUrl(mime, bytes) {
  if (!ALLOWED_MIME.has(mime)) throw new Error(`unsupported image MIME ${mime}`);
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  if (dataUrl.length < 24 || dataUrl.length > MAX_DATA_URL_LENGTH) throw new Error(`image exceeds safe data URL limit (${dataUrl.length})`);
  return dataUrl;
}

export async function prepareManifestImages(manifest, { fetchFn = fetch } = {}) {
  validateManifest(manifest);
  const prepared = [];
  for (const entry of manifest.entries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetchFn(entry.image_url, {
        method: 'GET', redirect: 'follow', cache: 'no-store', credentials: 'omit', signal: controller.signal,
        headers: { 'user-agent': 'NuevoAmanecerPOS-ProductImageBatch/1.0', accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' }
      });
      if (!response?.ok) throw new Error(`image download failed ${response?.status || 'unknown'} for ${entry.id}`);
      const mime = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_MIME.has(mime)) throw new Error(`unsupported image MIME ${mime || 'missing'} for ${entry.id}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`empty image for ${entry.id}`);
      const image = safeDataUrl(mime, bytes);
      const imageSha256 = createHash('sha256').update(bytes).digest('hex');
      prepared.push({
        id: entry.id,
        product_name: entry.product_name,
        expected_presentation: entry.expected_presentation,
        source_page: entry.source_page,
        source_image_url: entry.image_url,
        mime,
        bytes: bytes.length,
        image_sha256: imageSha256,
        image,
      });
    } finally {
      clearTimeout(timer);
    }
  }
  if (prepared.length !== MAX_ITEMS) throw new Error('prepared image count mismatch');
  return {
    schema: 'nuevo-amanecer.canon-product-image-prepared/v1',
    batch_id: manifest.batch_id,
    prepared_at: new Date().toISOString(),
    entries: prepared,
  };
}

function requireEnv() {
  if (!/^[a-f0-9]{32}$/.test(ACCOUNT)) throw new Error('invalid CLOUDFLARE_ACCOUNT_ID');
  if (!TOKEN) throw new Error('missing CLOUDFLARE_API_TOKEN');
  if (!/^[0-9a-f-]{36}$/i.test(PROD_DB)) throw new Error('invalid PROD_DATABASE_ID');
}

async function api(body) {
  requireEnv();
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${PROD_DB}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok || parsed?.success !== true) throw new Error(`Cloudflare D1 query failed ${response.status}`);
  const results = Array.isArray(parsed.result) ? parsed.result : [parsed.result];
  if (!results.length || results.some((result) => !result || result.success === false)) throw new Error('Cloudflare D1 query returned failure');
  return results;
}

async function query(sql, params = []) {
  const results = await api({ sql, params });
  return Array.isArray(results[0]?.results) ? results[0].results : [];
}

async function batch(statements) {
  if (!Array.isArray(statements) || !statements.length) return [];
  return api({ batch: statements.map(({ sql, params = [] }) => ({ sql, params })) });
}

async function currentControl() {
  const row = (await query("SELECT mode,active_promotion_id FROM canonical_control WHERE id=1"))[0];
  if (!row || row.mode !== 'ACTIVE' || !row.active_promotion_id) throw new Error('production CANON is not ACTIVE');
  return row;
}

async function requireSchema() {
  const row = (await query("SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='canonical_product_image_events') table_n,(SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='canonical_product_image_events_apply_import') import_trigger,(SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='canonical_product_image_events_apply_live') live_trigger"))[0];
  if (Number(row?.table_n) !== 1 || Number(row?.import_trigger) !== 1 || Number(row?.live_trigger) !== 1) throw new Error('product image schema not ready');
}

async function findExactProduct(promotionId, name) {
  const rows = await query(`SELECT 'IMPORT' AS provenance,product_id,name,image,price_cents,cost_cents,current_stock_quantity,stock_revision,sku,barcode,category,tracks_inventory
      FROM products WHERE promotion_id=?1 AND name=?2
    UNION ALL
    SELECT 'LIVE' AS provenance,product_id,name,image,price_cents,cost_cents,current_stock_quantity,stock_revision,sku,barcode,category,tracks_inventory
      FROM canonical_live_products WHERE promotion_id=?1 AND name=?2`, [promotionId, name]);
  if (rows.length !== 1) throw new Error(`exact product match count ${rows.length} for ${name}`);
  return rows[0];
}

function commercialFingerprint(row) {
  return JSON.stringify({
    provenance: row.provenance,
    product_id: row.product_id,
    name: row.name,
    price_cents: Number(row.price_cents),
    cost_cents: row.cost_cents == null ? null : Number(row.cost_cents),
    current_stock_quantity: Number(row.current_stock_quantity),
    stock_revision: Number(row.stock_revision),
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    category: row.category ?? null,
    tracks_inventory: Number(row.tracks_inventory),
  });
}

async function protectedCounts() {
  const row = (await query(`SELECT
    (SELECT COUNT(*) FROM sales) sales,
    (SELECT COUNT(*) FROM sale_items) sale_items,
    (SELECT COUNT(*) FROM inventory_movements) inventory_movements,
    (SELECT COUNT(*) FROM cash_movements) cash_movements,
    (SELECT COUNT(*) FROM credit_payments) credit_payments,
    (SELECT COUNT(*) FROM canonical_financial_events) financial_events,
    (SELECT COUNT(*) FROM canonical_expenses) expenses`))[0];
  return Object.fromEntries(Object.entries(row || {}).map(([key,value]) => [key, Number(value)]));
}

function validatePrepared(prepared, manifest) {
  if (!prepared || prepared.schema !== 'nuevo-amanecer.canon-product-image-prepared/v1' || prepared.batch_id !== manifest.batch_id || !Array.isArray(prepared.entries) || prepared.entries.length !== MAX_ITEMS) {
    throw new Error('invalid prepared image payload');
  }
  const byId = new Map(prepared.entries.map((entry) => [entry.id, entry]));
  for (const source of manifest.entries) {
    const entry = byId.get(source.id);
    if (!entry || entry.product_name !== source.product_name || entry.source_page !== source.source_page || entry.source_image_url !== source.image_url) throw new Error(`prepared manifest mismatch for ${source.id}`);
    if (!/^[0-9a-f]{64}$/.test(entry.image_sha256) || typeof entry.image !== 'string' || entry.image.length > MAX_DATA_URL_LENGTH || !/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(entry.image)) throw new Error(`prepared image invalid for ${source.id}`);
  }
  return prepared;
}

async function applyPrepared(manifest, prepared) {
  validateManifest(manifest);
  validatePrepared(prepared, manifest);
  await requireSchema();
  const control = await currentControl();
  const countsBefore = await protectedCounts();
  const targets = [];
  const statements = [];

  for (const imageEntry of prepared.entries) {
    const row = await findExactProduct(control.active_promotion_id, imageEntry.product_name);
    const operationId = `product-image-b${manifest.batch_id}-${imageEntry.id}`;
    const existing = (await query('SELECT operation_id,promotion_id,product_id,product_provenance,batch_id,product_name,image,image_sha256 FROM canonical_product_image_events WHERE operation_id=?1', [operationId]))[0];
    if (existing) {
      if (existing.promotion_id !== control.active_promotion_id || existing.product_id !== row.product_id || existing.product_provenance !== row.provenance || existing.batch_id !== manifest.batch_id || existing.product_name !== imageEntry.product_name || existing.image_sha256 !== imageEntry.image_sha256 || existing.image !== imageEntry.image || row.image !== imageEntry.image) {
        throw new Error(`idempotency mismatch for ${imageEntry.id}`);
      }
      targets.push({ imageEntry, row, operationId, beforeFingerprint: commercialFingerprint(row), already: true });
      continue;
    }
    if (row.image === imageEntry.image) throw new Error(`image already present without audit event for ${imageEntry.id}`);
    const revisionRow = (await query('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM canonical_product_image_events WHERE promotion_id=?1 AND product_id=?2', [control.active_promotion_id, row.product_id]))[0];
    const revision = Number(revisionRow?.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error(`invalid next image revision for ${imageEntry.id}`);
    targets.push({ imageEntry, row, operationId, beforeFingerprint: commercialFingerprint(row), already: false });
    statements.push({
      sql: `INSERT INTO canonical_product_image_events(operation_id,promotion_id,product_id,product_provenance,revision,batch_id,product_name,previous_image,image,image_sha256,source_page,source_image_url,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      params: [operationId,control.active_promotion_id,row.product_id,row.provenance,revision,manifest.batch_id,imageEntry.product_name,row.image ?? null,imageEntry.image,imageEntry.image_sha256,imageEntry.source_page,imageEntry.source_image_url,prepared.prepared_at]
    });
  }

  if (statements.length) await batch(statements);

  for (const target of targets) {
    const after = await findExactProduct(control.active_promotion_id, target.imageEntry.product_name);
    if (after.product_id !== target.row.product_id || after.provenance !== target.row.provenance) throw new Error(`product identity changed for ${target.imageEntry.id}`);
    if (after.image !== target.imageEntry.image) throw new Error(`image persistence mismatch for ${target.imageEntry.id}`);
    if (commercialFingerprint(after) !== target.beforeFingerprint) throw new Error(`commercial invariant changed for ${target.imageEntry.id}`);
    const receipt = (await query('SELECT image_sha256 FROM canonical_product_image_events WHERE operation_id=?1', [target.operationId]))[0];
    if (receipt?.image_sha256 !== target.imageEntry.image_sha256) throw new Error(`audit receipt mismatch for ${target.imageEntry.id}`);
  }
  const countsAfter = await protectedCounts();
  if (JSON.stringify(countsAfter) !== JSON.stringify(countsBefore)) throw new Error('protected ledger counts changed');

  return {
    state: 'CANON_PRODUCT_IMAGES_APPLIED_AND_VERIFIED',
    batch_id: manifest.batch_id,
    total: targets.length,
    inserted: targets.filter((item) => !item.already).length,
    already_processed: targets.filter((item) => item.already).length,
    protected_counts: countsAfter,
    products: targets.map((item) => ({ id:item.imageEntry.id, name:item.imageEntry.product_name, product_id:item.row.product_id, provenance:item.row.provenance, image_sha256:item.imageEntry.image_sha256 })),
  };
}

function readManifest() {
  return validateManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));
}

async function main() {
  const manifest = readManifest();
  if (MODE === 'prepare') {
    const prepared = await prepareManifestImages(manifest);
    writeFileSync(PREPARED_PATH, JSON.stringify(prepared));
    console.log(JSON.stringify({ state:'CANON_PRODUCT_IMAGES_PREPARED', batch_id:prepared.batch_id, count:prepared.entries.length, bytes:prepared.entries.reduce((sum,item)=>sum+item.bytes,0), path:PREPARED_PATH }));
    return;
  }
  if (MODE !== 'apply') throw new Error('mode must be prepare or apply');
  const prepared = validatePrepared(JSON.parse(readFileSync(PREPARED_PATH, 'utf8')), manifest);
  const result = await applyPrepared(manifest, prepared);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error?.stack || error?.message || error); process.exit(1); });
}

export { applyPrepared, safeDataUrl, commercialFingerprint };
