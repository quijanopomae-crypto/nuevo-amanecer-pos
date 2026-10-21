// Misión 3 (#857): historial de precios en la nube (docs/propuestas/historial-precios-nube.md).
// - POST /auth/price-history/batch   (dueño y empleado) ≤100 entradas: inserted | duplicate | conflict | invalid.
// - GET  /auth/price-history          (dueño y empleado) por producto, paginado.
// - GET  /auth/price-history/changes  (dueño y empleado) cambios desde received_at, para la caché local.
// - GET  /auth/price-history/reviews  (solo dueño)  costos de empleado pendientes de revisión.
// - POST /auth/price-history/review   (solo dueño)  aprobar o rechazar una fila pendiente.
// Costo solo para el dueño: sin purchases.costs.view la consulta SQL excluye field='costo' (no viaja en claro).
// Filas pending/rejected nunca salen en el historial, ni para el dueño. Solo anexos: no cambia productos.
import { getDatabase } from './database-binding.js';
import { canDo } from './pos-permissions.js';

const FIELDS = new Set(['venta', 'mayorista', 'costo']);
const ORIGINS = new Set(['ficha', 'importacion', 'compra', 'backfill']);
const CHANGE_ID = /^ph1:[A-Za-z0-9._:-]{1,116}$/;
const KEYS = ['change_id','product_id','field','before_cents','after_cents','origin','ref','user_name','user_id','changed_at','legacy_id'];
const COLS = 'change_id,product_id,field,before_cents,after_cents,origin,ref,user_name,user_id,changed_at,received_at';
const FUTURE_MS = 5 * 60 * 1000;

export function cleanText(value, max) {
  if (value == null) return null;
  const t = String(value).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}
const cents = v => v === null || (Number.isSafeInteger(v) && v >= 0 && v <= 1e9);

export function normalizeEntry(e, now = Date.now()) {
  if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(k => !KEYS.includes(k))) return { error: 'unexpected_field' };
  if (typeof e.change_id !== 'string' || !CHANGE_ID.test(e.change_id)) return { error: 'invalid_change_id' };
  const product_id = typeof e.product_id === 'string' || typeof e.product_id === 'number' ? String(e.product_id) : '';
  if (!product_id || product_id.length > 160 || /[\x00-\x1f\x7f]/.test(product_id)) return { error: 'invalid_product' };
  if (!FIELDS.has(e.field) || !ORIGINS.has(e.origin)) return { error: 'invalid_field_or_origin' };
  const before = e.before_cents ?? null, after = e.after_cents ?? null;
  if (!cents(before) || !cents(after)) return { error: 'invalid_cents' };
  const ms = typeof e.changed_at === 'string' ? Date.parse(e.changed_at) : NaN;
  if (!Number.isFinite(ms) || ms > now + FUTURE_MS) return { error: 'invalid_changed_at' };
  const user_name = cleanText(e.user_name, 80);
  if (!user_name) return { error: 'invalid_user' };
  return { value: { change_id: e.change_id, product_id, field: e.field, before_cents: before, after_cents: after, origin: e.origin,
    ref: cleanText(e.ref, 200), user_name, user_id: cleanText(e.user_id, 80), changed_at: new Date(ms).toISOString(), legacy_id: cleanText(e.legacy_id, 300) } };
}

const same = (a, b) => a.product_id === b.product_id && a.field === b.field && (a.before_cents ?? null) === (b.before_cents ?? null)
  && (a.after_cents ?? null) === (b.after_cents ?? null) && a.origin === b.origin && (a.ref ?? null) === (b.ref ?? null);

// Costo de empleado: solo se acepta directo si viene de una compra aplicada cuya línea coincide (producto y costo).
async function validPurchaseRef(db, v) {
  if (v.origin !== 'compra' || !v.ref) return false;
  const m = /^(.+):(\d{1,5})$/.exec(v.ref);
  if (!m) return false;
  const ready = await db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='pos_purchase_lines'").first();
  if (!ready) return false;
  const line = await db.prepare('SELECT product_id,unit_cost_cents FROM pos_purchase_lines WHERE purchase_id=?1 AND line_number=?2').bind(m[1], Number(m[2])).first();
  if (!line || String(line.product_id) !== v.product_id || line.unit_cost_cents == null || Number(line.unit_cost_cents) !== v.after_cents) return false;
  return !!(await db.prepare('SELECT 1 ok FROM canonical_inventory_operations WHERE operation_id=?1').bind(m[1] + ':' + m[2]).first());
}

async function ready(db) { return !!(await db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='price_history'").first()); }
function roleOf(auth) { return auth.posRole === 'empleado' ? 'empleado' : 'owner'; }
const visible = seeCost => " AND (review_status IS NULL OR review_status='approved')" + (seeCost ? '' : " AND field<>'costo'");
const limitOf = (v, def, max) => { const n = Number(v); return Number.isSafeInteger(n) && n >= 1 ? Math.min(n, max) : def; };

async function batch(request, db, auth, json) {
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const entries = body && Array.isArray(body.entries) ? body.entries : null;
  if (!entries || entries.length < 1 || entries.length > 100 || Object.keys(body).some(k => k !== 'entries')) return json({ error: 'invalid_batch' }, 400);
  const role = roleOf(auth), seeCost = canDo(role, 'purchases.costs.view');
  const results = [], receivedAt = new Date().toISOString();
  for (const raw of entries) {
    const n = normalizeEntry(raw);
    const id = raw && typeof raw.change_id === 'string' ? raw.change_id.slice(0, 120) : null;
    if (n.error) { results.push({ change_id: id, status: 'invalid', error: n.error }); continue; }
    const v = n.value;
    let review = null;
    if (v.field === 'costo' && !seeCost && !(await validPurchaseRef(db, v))) review = 'pending';
    const inserted = await db.prepare(`INSERT INTO price_history(change_id,product_id,field,before_cents,after_cents,origin,ref,user_name,user_id,changed_at,device_id,received_at,legacy_id,review_status)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14) ON CONFLICT DO NOTHING RETURNING change_id`)
      .bind(v.change_id, v.product_id, v.field, v.before_cents, v.after_cents, v.origin, v.ref, v.user_name, v.user_id, v.changed_at,
        String(auth.principalId || 'unknown'), receivedAt, v.legacy_id, review).first();
    if (inserted) { results.push({ change_id: v.change_id, status: 'inserted', ...(review ? { review: 'pending' } : {}) }); continue; }
    let existing = await db.prepare('SELECT * FROM price_history WHERE change_id=?1').bind(v.change_id).first();
    if (!existing && v.ref) existing = await db.prepare('SELECT * FROM price_history WHERE ref=?1 AND field=?2').bind(v.ref, v.field).first();
    results.push({ change_id: v.change_id, status: existing && same(existing, v) ? 'duplicate' : 'conflict' });
  }
  return json({ results });
}

async function list(url, db, auth, json) {
  const productId = url.searchParams.get('product_id');
  if (!productId || productId.length > 160) return json({ error: 'invalid_product' }, 400);
  const seeCost = canDo(roleOf(auth), 'purchases.costs.view');
  const limit = limitOf(url.searchParams.get('limit'), 50, 200);
  const before = url.searchParams.get('before'), beforeId = url.searchParams.get('before_id') || '';
  const args = [productId];
  let cursor = '';
  if (before) { args.push(before, beforeId); cursor = ' AND (changed_at<?2 OR (changed_at=?2 AND change_id<?3))'; }
  const rows = (await db.prepare(`SELECT ${COLS} FROM price_history WHERE product_id=?1${visible(seeCost)}${cursor} ORDER BY changed_at DESC, change_id DESC LIMIT ${limit + 1}`).bind(...args).all()).results || [];
  const more = rows.length > limit, page = more ? rows.slice(0, limit) : rows, last = page[page.length - 1];
  return json({ rows: page, next: more ? { before: last.changed_at, before_id: last.change_id } : null });
}

async function changes(url, db, auth, json) {
  const seeCost = canDo(roleOf(auth), 'purchases.costs.view');
  const limit = limitOf(url.searchParams.get('limit'), 200, 500);
  const since = url.searchParams.get('since') || '', sinceId = url.searchParams.get('since_id') || '';
  const rows = (await db.prepare(`SELECT ${COLS} FROM price_history WHERE (received_at>?1 OR (received_at=?1 AND change_id>?2))${visible(seeCost)} ORDER BY received_at, change_id LIMIT ${limit + 1}`).bind(since, sinceId).all()).results || [];
  const more = rows.length > limit, page = more ? rows.slice(0, limit) : rows, last = page[page.length - 1];
  return json({ rows: page, cursor: last ? { since: last.received_at, since_id: last.change_id } : { since, since_id: sinceId }, more });
}

export async function priceHistoryRoute(request, env, auth, json) {
  const db = getDatabase(env), url = new URL(request.url), path = url.pathname;
  if (!(await ready(db))) return json({ error: 'price_history_schema_not_ready' }, 503);
  const owner = roleOf(auth) === 'owner';
  if (path === '/auth/price-history/batch' && request.method === 'POST') return batch(request, db, auth, json);
  if (path === '/auth/price-history' && request.method === 'GET') return list(url, db, auth, json);
  if (path === '/auth/price-history/changes' && request.method === 'GET') return changes(url, db, auth, json);
  if (path === '/auth/price-history/reviews' && request.method === 'GET') {
    if (!owner || !canDo('owner', 'reviews.resolve')) return json({ error: 'owner_only' }, 403);
    const rows = (await db.prepare(`SELECT ${COLS},device_id,review_status FROM price_history WHERE review_status='pending' ORDER BY received_at DESC LIMIT 200`).all()).results || [];
    return json({ rows });
  }
  if (path === '/auth/price-history/review' && request.method === 'POST') {
    if (!owner) return json({ error: 'owner_only' }, 403);
    let b; try { b = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    if (!b || typeof b.change_id !== 'string' || !CHANGE_ID.test(b.change_id) || !['approved', 'rejected'].includes(b.decision)) return json({ error: 'invalid_review' }, 400);
    // Solo pending -> approved|rejected (una vez). Nunca cambia el costo del producto.
    const done = await db.prepare("UPDATE price_history SET review_status=?2 WHERE change_id=?1 AND review_status='pending' RETURNING change_id,review_status").bind(b.change_id, b.decision).first();
    if (done) return json({ change_id: done.change_id, review_status: done.review_status });
    const row = await db.prepare('SELECT review_status FROM price_history WHERE change_id=?1').bind(b.change_id).first();
    if (!row) return json({ error: 'not_found' }, 404);
    return row.review_status === b.decision ? json({ change_id: b.change_id, review_status: row.review_status, idempotent: true }) : json({ error: 'already_reviewed', review_status: row.review_status }, 409);
  }
  return json({ error: 'method_not_allowed' }, 405);
}
