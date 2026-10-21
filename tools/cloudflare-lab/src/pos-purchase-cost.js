// Fase 2 (a): una compra de EMPLEADO aprobada con el PIN del dueño (aprobación inventory.adjust) también actualiza
// el costo del producto en el servidor. Las compras del dueño NO pasan por aquí: su aparato lo hace con product.update
// (#858, NA_COSTO_COMPRA_FICHA.afterCanonPurchase), así nunca se actualiza dos veces.
// - Usa el costo de la ÚLTIMA línea con costo de cada producto (misma regla «última compra» de #858).
// - Escribe una revisión normal de product.update (sube metadata_revision) con operation_id '<compra>:costo:<línea>'.
//   Ese id es determinista: reintentar la misma compra devuelve la misma revisión y nunca crea otra (idempotente).
//   El sufijo ':costo:' marca el origen «compra» y la línea es la referencia; no hace falta migración.
// - Copia todos los demás campos de la revisión vigente (o de la fila base): solo cambia cost_cents.
// - Si otro aparato cambió el producto entre medio (stale_product) se relee y se reintenta una vez; si vuelve a fallar
//   se informa en cost_updates y la compra queda aplicada igual (el stock ya entró).
import { updateCanonicalProduct } from './a6-products.js';

const FIELDS = ['name','sku','barcode','category','brand','description','icon','price_cents','box_price_cents','units_per_box','stock_min_quantity','expiry_date'];

export function lastCostByProduct(lines, appliedLines) {
  const ok = new Set((appliedLines || []).map(Number));
  const out = new Map();
  [...(lines || [])].filter(l => ok.has(Number(l.line)) && l.unit_cost_cents != null)
    .sort((a, b) => a.line - b.line).forEach(l => out.set(String(l.product_id), { line: Number(l.line), cents: Number(l.unit_cost_cents) }));
  return out;
}

async function effective(db, promotionId, productId) {
  const rev = await db.prepare(`SELECT * FROM canonical_product_revisions WHERE promotion_id=?1 AND product_id=?2 ORDER BY revision DESC LIMIT 1`).bind(promotionId, productId).first();
  if (rev) return { row: rev, alternate: JSON.parse(rev.alternate_codes_json || '[]'), revision: Number(rev.revision) };
  let base = await db.prepare('SELECT * FROM products WHERE promotion_id=?1 AND product_id=?2').bind(promotionId, productId).first();
  if (!base) base = await db.prepare('SELECT * FROM canonical_live_products WHERE promotion_id=?1 AND product_id=?2').bind(promotionId, productId).first();
  if (!base) return null;
  let alternate = []; try { alternate = JSON.parse(base.alternate_codes_json || '[]'); } catch {}
  return { row: base, alternate: Array.isArray(alternate) ? alternate : [], revision: 0 };
}

// Los códigos alternos no pueden repetir sku/código de barras ni entre sí (product.update los rechaza).
function uniqueAlternates(list, sku, barcode) {
  const seen = new Set([sku, barcode].filter(v => typeof v === 'string' && v.trim()).map(v => v.trim().toLowerCase()));
  const out = [];
  for (const v of list || []) { if (typeof v !== 'string' || !v.trim()) continue; const k = v.trim().toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(v.trim()); }
  return out.slice(0, 10);
}

const sub = body => new Request('https://internal.invalid/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function applyPurchaseCosts(db, env, auth, b, appliedLines, json) {
  const updates = [];
  const tableReady = !!(await db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='canonical_product_revisions'").first());
  if (!tableReady) return [{ status: 'schema_not_ready' }];
  for (const [productId, last] of lastCostByProduct(b.lines, appliedLines)) {
    const opId = b.operation_id + ':costo:' + last.line;
    let entry = { product_id: productId, line: last.line, status: 'failed' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const prior = await db.prepare('SELECT result_json FROM canonical_product_revisions WHERE operation_id=?1').bind(opId).first();
      if (prior) { entry = { ...entry, status: 'updated', idempotent: true }; break; }
      const cur = await effective(db, b.promotion_id, productId);
      if (!cur) { entry.status = 'product_not_found'; break; }
      if (Number(cur.row.cost_cents) === last.cents) { entry.status = 'unchanged'; break; }
      const body = { operation_id: opId, product_id: productId, promotion_id: b.promotion_id, authority_epoch: b.authority_epoch,
        expected_control_revision: b.expected_control_revision, client_contract: b.client_contract, created_at: new Date().toISOString(),
        expected_metadata_revision: cur.revision, cost_cents: last.cents };
      for (const k of FIELDS) body[k] = cur.row[k] ?? null;
      body.alternate_codes = uniqueAlternates(cur.alternate, body.sku, body.barcode);
      if (body.stock_min_quantity == null) body.stock_min_quantity = 0;
      const res = await updateCanonicalProduct(sub(body), env, auth, json);
      let out = {}; try { out = await res.json(); } catch {}
      if (res.status === 200 || res.status === 201) { entry = { ...entry, status: 'updated', before_cents: Number(cur.row.cost_cents), after_cents: last.cents, metadata_revision: out.metadata_revision }; break; }
      entry.error = out.error || 'product_update_failed';
      if (out.error !== 'stale_product') break;
    }
    updates.push(entry);
  }
  return updates;
}

// El empleado no ve costos en claro: solo qué productos se actualizaron.
export function redactCostUpdates(updates, canSeeCosts) {
  return canSeeCosts ? updates : updates.map(({ before_cents, after_cents, ...rest }) => rest);
}
