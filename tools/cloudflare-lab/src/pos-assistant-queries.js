// Consultas del asistente (SOLO LECTURA). El Worker lee su base y arma un resumen chico:
// - a la pantalla del dueño va una tabla con números (top N filas);
// - a DeepSeek va un resumen aún más chico y SIN datos personales (clientes como «Cliente 1», sin DNI ni teléfono).
// Nunca se manda el inventario completo al modelo. Nada aquí escribe en la base.
import { canonicalRead } from './a6-canonical.js';

// Frases seguidas con un solo punto al final de cada una (Bot 4: nada de «unid..»).
const sentences = (arr) => arr.map((x) => (/[.!?]$/.test(x) ? x : x + '.')).join(' ');
export const QUERY_TYPES = Object.freeze(['stock_producto', 'bajo_stock', 'sin_costo', 'ventas_periodo', 'top_productos', 'deudas_clientes', 'compras_recientes', 'resumen_dia', 'resumen_mes']);
// Resúmenes del día y del mes: SOLO el Admin (el empleado recibe 403 summary_admin_only en el chat).
export const SUMMARY_TYPES = Object.freeze(['resumen_dia', 'resumen_mes']);
export const PRODUCT_ID_CHUNK = 50; // ids por consulta IN (...): muy por debajo del tope de 100 parámetros de D1
export const QUERY_LIMITS = Object.freeze({ topRows: 10, modelRows: 8, maxPages: 20, pageSize: 250, maxDays: 92 });
const TITLES = { stock_producto: 'Stock del producto', bajo_stock: 'Productos por reponer', sin_costo: 'Productos sin costo', ventas_periodo: 'Ventas del período',
  top_productos: 'Productos más vendidos', deudas_clientes: 'Deudas de clientes', compras_recientes: 'Compras recientes',
  resumen_dia: 'Resumen del día', resumen_mes: 'Resumen del mes' };

const cents = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)) / 100);
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
export const SALE_LINES_MAX = 5000, SALES_READ_MAX = 5000;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function limaToday(nowMs) { return new Date(nowMs - 5 * 3600 * 1000).toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Período en fechas de Lima. Por defecto: hoy. Máximo 92 días.
export function period(args, nowMs) {
  const today = limaToday(nowMs);
  let hasta = DATE.test(args?.hasta || '') ? args.hasta : today, desde = DATE.test(args?.desde || '') ? args.desde : hasta;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  if (Date.parse(hasta) - Date.parse(desde) > QUERY_LIMITS.maxDays * 86400000) desde = addDays(hasta, -QUERY_LIMITS.maxDays);
  // Lima = UTC-5: el día local D va de D 05:00Z a D+1 05:00Z.
  return { desde, hasta, fromIso: desde + 'T05:00:00.000Z', toIso: addDays(hasta, 1) + 'T05:00:00.000Z' };
}

// ---------- Resúmenes del día y del mes (helpers) ----------
const limaDay = (iso) => new Date(Date.parse(iso) - 5 * 3600 * 1000).toISOString().slice(0, 10);
// Día de Lima de un cobro: hora exacta si la hay; si no, la fecha conocida (AAAA-MM-DD). Sin fecha conocida: no cuenta en ningún período.
export function paymentDay(x) {
  const ts = x?.payment_timestamp || x?.created_at;
  if (ts && /T\d{2}:/.test(String(ts)) && Number.isFinite(Date.parse(ts))) return limaDay(ts);
  const d = String(x?.payment_date || x?.fecha || '');
  if (DATE.test(d) && x?.payment_date_known !== 0 && x?.payment_date_known !== false) return d;
  return null;
}
// Suma por período: ventas, número, por método, contado/crédito (la parte crédito de una venta mixta sale de cash-movements),
// cobros de créditos y productos. moves/pays = null: esa lectura no estuvo disponible.
export function aggregatePeriods(periods, sales, items, moves, pays, truncated) {
  const credit = new Map(); for (const m of moves || []) credit.set(m.sale_id, (credit.get(m.sale_id) || 0) + m.credit_cents);
  return periods.map((p) => {
    const inP = sales.filter((s) => s.created_at >= p.fromIso && s.created_at < p.toIso), ids = new Set(inP.map((s) => s.sale_id));
    const r = { desde: p.desde, hasta: p.hasta, n: inP.length, c: 0, credito_c: 0, metodos: {}, pagos_n: null, pagos_c: null, items: [], truncado: !!truncated };
    // Sin cash-movements no se sabe qué parte de una venta mixta fue a crédito: contado/crédito quedan «no disponible» (null).
    const splitUnknown = moves == null && inP.some((s) => s.metodo === 'mixto');
    for (const s of inP) {
      r.c += s.total_cents; const m = r.metodos[s.metodo] || (r.metodos[s.metodo] = { n: 0, c: 0 }); m.n++; m.c += s.total_cents;
      // credit_cents > 0: esa parte fue a crédito. 0 o sin movimiento: según el método (una venta «credito» con 0 no pasa a contado).
      const cc = credit.get(s.sale_id) || 0;
      r.credito_c += cc > 0 ? Math.min(cc, s.total_cents) : s.metodo === 'credito' ? s.total_cents : 0;
    }
    if (splitUnknown) r.credito_c = null;
    // líneas genéricas («GENERIC:<uuid>», una por línea): juntas en una sola fila «Producto genérico», nunca el id crudo
    const by = new Map(); for (const it of items) { if (!ids.has(it.sale_id)) continue; const pid = isGenericId(it.product_id) ? 'GENERIC:' : it.product_id; const x = by.get(pid) || { product_id: pid, q: 0, c: 0 }; x.q += it.quantity; x.c += it.line_total_cents; by.set(pid, x); }
    r.items = [...by.values()];
    if (pays) { const ps = pays.filter((x) => x.dia && x.dia >= p.desde && x.dia <= p.hasta); r.pagos_n = ps.filter((x) => x.c > 0).length; r.pagos_c = ps.reduce((a, x) => a + x.c, 0); }
    return r;
  });
}
const pad2 = (n) => String(n).padStart(2, '0');
function monthEnd(ym) { const [y, m] = ym.split('-').map(Number); return ym + '-' + pad2(new Date(Date.UTC(y, m, 0)).getUTCDate()); }
function prevMonth(ym) { const [y, m] = ym.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + pad2(m - 1); }
const mkPeriod = (desde, hasta) => ({ desde, hasta, fromIso: desde + 'T05:00:00.000Z', toIso: addDays(hasta, 1) + 'T05:00:00.000Z' });
// Períodos del resumen (hora de Lima). Día: el pedido (por defecto hoy) contra el día anterior.
// Mes: el mes del día pedido; si es el mes en curso va hasta hoy y se compara con los MISMOS días del mes anterior (1 al N).
export function summaryPeriods(tipo, args, nowMs) {
  const today = limaToday(nowMs), raw = String(args?.hasta || args?.desde || '');
  let ref = DATE.test(raw) ? raw : /^\d{4}-\d{2}$/.test(raw) ? raw + '-01' : today;
  if (ref > today) ref = today;
  if (tipo === 'resumen_dia') return { actual: mkPeriod(ref, ref), anterior: mkPeriod(addDays(ref, -1), addDays(ref, -1)), en_curso: ref === today };
  const ym = ref.slice(0, 7), end = monthEnd(ym), enCurso = today.slice(0, 7) === ym, hasta = enCurso ? today : end;
  const pym = prevMonth(ym), pEnd = monthEnd(pym), day = Number(hasta.slice(8, 10)), pHasta = enCurso ? (pym + '-' + pad2(Math.min(day, Number(pEnd.slice(8, 10))))) : pEnd;
  return { actual: mkPeriod(ym + '-01', hasta), anterior: mkPeriod(pym + '-01', pHasta), en_curso: enCurso };
}
// Productos ante el modelo: SOLO «producto #código» (un nombre puede llevar el de un cliente, p. ej. «Encargo Sra. …»). El nombre se pone
// únicamente en la tabla de la pantalla del Admin (mismo criterio que «Ventas bajo costo», PR #930). Código raro: sin código.
const CODE_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
export const productRef = (id) => isGenericId(id) ? 'producto genérico' : 'producto #' + (CODE_RE.test(String(id)) ? String(id) : 'sin-código');
// Protege «producto #código» del redactor (un código numérico largo parece DNI o teléfono) y lo devuelve igual después.
export function protectProductRefs(text, ids, fn) {
  const refs = [...new Set([...(ids || [])].map(productRef))].sort((a, b) => b.length - a.length); // «#123» antes que «#12»
  let t = String(text ?? ''); refs.forEach((r, i) => { t = t.split(r).join('\uE000' + String.fromCharCode(0xE100 + i) + '\uE001'); });
  return fn(t).replace(/\uE000([\uE100-\uE8FF])\uE001/g, (_m, c) => refs[c.charCodeAt(0) - 0xE100] || '').replace(/[\uE000\uE001]/g, '');
}
const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

// ---------- Lectores ----------
// Lector sobre la base real: usa la lectura canónica existente (/read/canonical/*) para productos, créditos (saldo calculado
// por el servidor), clientes y ventas; las compras salen de la misma consulta que GET /auth/purchases (últimas, con LIMIT).
export function canonicalReader(db) {
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  async function all(type) {
    const out = []; let cursor = null, truncated = false;
    for (let i = 0; i < QUERY_LIMITS.maxPages; i++) {
      const u = new URL('http://asistente/read/canonical/' + type); u.searchParams.set('limit', String(QUERY_LIMITS.pageSize)); if (cursor) u.searchParams.set('cursor', cursor);
      const res = await canonicalRead(u, db, json); if (res.status !== 200) throw new Error('read_' + type + '_' + res.status);
      const d = await res.json(); out.push(...(d.items || [])); cursor = d.next_cursor; if (!cursor) break; if (i === QUERY_LIMITS.maxPages - 1) truncated = true;
    }
    out.truncated = truncated; return out;
  }
  // Ventas (lentitud 22-10): antes se leían TODAS las ventas por páginas (hasta 20 × 250 = 5000, ordenadas por sale_id, NO por fecha) y se
  // filtraba por fecha en el Worker: con más de 5000 ventas «¿cuánto vendí hoy?» podía decir que no hubo ventas, y cada página eran 4 viajes
  // a la base. Ahora: UNA consulta con el rango de fechas de Lima (period) en SQL, SUM/COUNT/GROUP BY y LIMIT. Mismo origen que la lectura
  // canónica: modo ACTIVE = canonical_sale_context (promoción activa) JOIN sales; CANONICAL_READ_ONLY = tabla sales (como canonicalRead).
  // Anuladas: las MISMAS que GET /auth/sale-annulments (pos_sale_annulments con status 'anulada'); sin esa tabla, ninguna.
  let ctlMemo = null; // una lectura de canonical_control por pedido (el lector se arma por pedido)
  async function ctl() {
    if (!ctlMemo) ctlMemo = db.prepare('SELECT mode,active_promotion_id FROM canonical_control WHERE id=1').first().then((c) => {
      if (!c || !['CANONICAL_READ_ONLY', 'ACTIVE'].includes(c.mode) || !c.active_promotion_id) throw new Error('canonical_not_published');
      return c; }).catch((e) => { ctlMemo = null; throw e; });
    return ctlMemo;
  }
  const MS = (x) => 'CAST(ROUND(julianday(' + x + ')*86400000) AS INTEGER)';
  const NOT_ANNULLED = " AND NOT EXISTS(SELECT 1 FROM pos_sale_annulments a WHERE a.sale_id=r.sale_id AND a.status='anulada')";
  // FROM/WHERE comunes: ?1 promoción (solo ACTIVE), ?2 desde (incl.), ?3 hasta (excl.): p.fromIso/p.toIso de period(), la ÚNICA función de
  // hora de Lima (aquí no se calcula ninguna hora de Lima: el día de cada venta sale de su distancia a p.fromIso, en días enteros).
  // build(from, where) arma la sentencia completa; se prueba con anulaciones y, si la tabla no existe, sin ellas.
  // Anulaciones (la MISMA lista que GET /auth/sale-annulments): las usa el resumen de período (periodSummary, #931), que lee por la vía canónica.
  async function annulled() {
    try { const rows = (await db.prepare('SELECT sale_id,operation_id,reason,status,cash_cents,digital_cents,created_at,completed_at FROM pos_sale_annulments ORDER BY created_at DESC LIMIT 2000').all()).results || [];
      return new Set(rows.filter((r) => r.status === 'anulada').map((r) => String(r.sale_id))); }
    catch (e) { if (/no such table/i.test(String(e?.message || e))) return new Set(); throw e; }
  }
  async function salesQuery(p, build, extra = []) {
    const c = await ctl(), active = c.mode === 'ACTIVE';
    const from = active ? 'canonical_sale_context x JOIN sales r ON r.sale_id=x.sale_id' : 'sales r';
    // Por el MOMENTO (milisegundo exacto: SQLite guarda julianday en ms enteros, ROUND lo recupera sin error de coma), no como texto: una venta puede traer created_at con desfase (-05:00) en vez de «Z». No hay índice por
    // created_at en sales (no se pierde ninguno); el filtro va junto a canonical_sale_context(promotion_id), que sí lo tiene.
    const where = (active ? 'x.promotion_id=?1' : '?1 IS NOT NULL') + ' AND ' + MS('r.created_at') + '>=' + MS('?2') + ' AND ' + MS('r.created_at') + '<' + MS('?3');
    const run = (ann) => db.prepare(build(from, where + (ann ? NOT_ANNULLED : ''))).bind(c.active_promotion_id, p.fromIso, p.toIso, ...extra).all();
    try { return (await run(true)).results || []; }
    catch (e) { if (!/no such table: pos_sale_annulments/i.test(String(e?.message || e))) throw e; return (await run(false)).results || []; }
  }
  const salesSql = (p, select, tail, extra = []) => salesQuery(p, (from, where) => 'SELECT ' + select + ' FROM ' + from + ' ' + (tail.join || '') + ' WHERE ' + where + ' ' + tail.rest, extra);
  return {
    async products() { const rows = await all('products'); const list = rows.map((p) => ({ id: String(p.product_id), nombre: p.name, stock: Number(p.current_stock_quantity), min: Number(p.stock_min_quantity || 0),
      costo: cents(p.cost_cents), precio: cents(p.price_cents), controla: p.tracks_inventory === 1 || p.tracks_inventory === true })); list.truncated = rows.truncated; return list; },
    // Solo los ids pedidos (control de inventario de una tarjeta): una consulta por tramo de <= 50 ids con parámetros enlazados, sin
    // leer el catálogo. Misma autoridad que la lectura canónica: promoción activa (importados + creados en vivo). Si la consulta
    // falla, lanza (quien llama falla CERRADO). Un id que no vuelve es un producto que no existe.
    async productsById(ids) {
      const want = [...new Set((ids || []).map(String))]; const out = new Map(); if (!want.length) return out;
      const c = await ctl();
      for (let i = 0; i < want.length; i += PRODUCT_ID_CHUNK) {
        const part = want.slice(i, i + PRODUCT_ID_CHUNK), marks = part.map((_, k) => '?' + (k + 2)).join(',');
        const base = `SELECT product_id,name,tracks_inventory FROM products WHERE promotion_id=?1 AND product_id IN (${marks})`;
        const live = `SELECT product_id,name,tracks_inventory FROM canonical_live_products WHERE promotion_id=?1 AND product_id IN (${marks})`;
        let rows;
        if (c.mode === 'ACTIVE') {
          try { rows = (await db.prepare(base + ' UNION ALL ' + live).bind(c.active_promotion_id, ...part).all()).results || []; }
          catch (e) { if (!/no such table: canonical_live_products/i.test(String(e?.message || e))) throw e; rows = null; }
        }
        if (!rows) rows = (await db.prepare(base).bind(c.active_promotion_id, ...part).all()).results || [];
        for (const r of rows) out.set(String(r.product_id), { id: String(r.product_id), nombre: r.name, controla: r.tracks_inventory === 1 || r.tracks_inventory === true });
      }
      return out;
    },
    async credits() { const rows = await all('credits'); return rows.map((c) => ({ cliente: String(c.customer_id), saldo: cents(c.current_balance_cents) || 0, vence: c.due_date || c.due_value || null })); },
    async customers() { const rows = await all('customers'); return rows.map((c) => ({ id: String(c.customer_id), nombre: c.name })); },
    async salesTotals(p) {
      // k = días enteros desde el comienzo del período (medianoche de Lima según period()); dia = p.desde + k.
      const rows = await salesSql(p, '((' + MS('r.created_at') + '-' + MS('?2') + ')/86400000) AS k,r.payment_method AS metodo,COUNT(*) AS n,SUM(r.total_cents) AS c', { rest: 'GROUP BY k,metodo ORDER BY k LIMIT 1000' });
      return rows.map((r) => ({ dia: addDays(p.desde, Number(r.k) || 0), metodo: r.metodo, n: Number(r.n) || 0, c: Number(r.c) || 0 }));
    },
    // (22-10, prueba en vivo) una línea GENÉRICA (VARIOS, VERDURAS…) lleva product_id «GENERIC:<uuid>», uno distinto por línea: se agrupa por el
    // nombre guardado en canonical_generic_sale_lines (sin mayúsculas/espacios de más) y sale con ese nombre, nunca con el id. Sin esa tabla
    // (base vieja): todas las genéricas juntas, sin nombre (la consulta les pone una etiqueta legible).
    async topItems(p, n) {
      const lim = [Math.max(1, Math.min(100, Number(n) || 10))], gen = "substr(i.product_id,1,8)='GENERIC:'";
      const q = (withNames) => salesSql(p, `CASE WHEN ${gen} THEN NULL ELSE i.product_id END AS product_id,CASE WHEN ${gen} THEN ${withNames ? "COALESCE(UPPER(TRIM(g.name)),'')" : "''"} END AS gkey,`
        + `${withNames ? `MIN(CASE WHEN ${gen} THEN TRIM(g.name) END)` : 'NULL'} AS generic_name,SUM(i.quantity) AS q,SUM(i.line_total_cents) AS c`,
        { join: 'JOIN sale_items i ON i.sale_id=r.sale_id' + (withNames ? ' LEFT JOIN canonical_generic_sale_lines g ON g.generic_product_id=i.product_id' : ''), rest: 'GROUP BY 1,2 ORDER BY c DESC,1,2 LIMIT ?4' }, lim);
      let rows; try { rows = await q(true); } catch (e) { if (!/no such table: canonical_generic_sale_lines/i.test(String(e?.message || e))) throw e; rows = await q(false); }
      return rows.map((r) => (r.product_id == null ? { product_id: null, generic: true, generic_name: r.generic_name || null, q: Number(r.q) || 0, c: Number(r.c) || 0 } : { product_id: r.product_id, q: Number(r.q) || 0, c: Number(r.c) || 0 }));
    },
    // Líneas vendidas en el período (sin anuladas), con su precio unitario cobrado. MISMO contrato que «Ventas bajo costo» (#930):
    // { sale_id, product_id, quantity, unit_cents, line_cents, created_at }; unit_cents/line_cents en null si vienen vacíos (= «sin precio»,
    // nunca 0 = pérdida). .truncated si se cortó la lectura de ventas (más de SALES_READ_MAX en el período: quedan las más nuevas) O la de
    // líneas (más de SALE_LINES_MAX). Una sola sentencia: ventas del período (más nuevas primero, con tope) y sus líneas.
    async saleLines(p) {
      const rows = await salesQuery(p, (from, where) => `WITH s1 AS (SELECT r.sale_id AS sid,${MS('r.created_at')} AS sat FROM ${from} WHERE ${where} ORDER BY ${MS('r.created_at')} DESC,r.sale_id LIMIT ?4),
        s AS (SELECT sid,sat FROM s1 ORDER BY sat DESC,sid LIMIT ?5)
        SELECT (SELECT COUNT(*) FROM s1) AS n_sales,i.sale_id AS sale_id,i.product_id AS product_id,i.quantity AS quantity,i.unit_price_cents AS unit_price_cents,
          i.line_total_cents AS line_total_cents,i.created_at AS created_at FROM s JOIN sale_items i ON i.sale_id=s.sid ORDER BY s.sat DESC,i.sale_id,i.line_number LIMIT ?6`,
        [SALES_READ_MAX + 1, SALES_READ_MAX, SALE_LINES_MAX + 1]);
      const salesCut = rows.length > 0 && Number(rows[0].n_sales) > SALES_READ_MAX, linesCut = rows.length > SALE_LINES_MAX;
      const out = rows.slice(0, SALE_LINES_MAX).map((it) => ({ sale_id: String(it.sale_id), product_id: String(it.product_id), quantity: Number(it.quantity) || 0, unit_cents: numOrNull(it.unit_price_cents), line_cents: numOrNull(it.line_total_cents), created_at: it.created_at || null }));
      out.truncated = !!(salesCut || linesCut); return out;
    },
    // Nombres VIGENTES de unos pocos productos por id (más vendidos): importados + creados en vivo, con el último cambio de ficha
    // (canonical_product_revisions, product.update) por encima, igual que la lectura canónica de productos. Sin leer el catálogo.
    async productNamesById(ids) {
      const want = [...new Set((ids || []).map(String))]; const out = new Map(); if (!want.length) return out;
      const c = await ctl();
      for (let i = 0; i < want.length; i += PRODUCT_ID_CHUNK) {
        const part = want.slice(i, i + PRODUCT_ID_CHUNK), marks = part.map((_, k) => '?' + (k + 2)).join(',');
        const base = `SELECT product_id,name FROM products WHERE promotion_id=?1 AND product_id IN (${marks})`;
        const live = `SELECT product_id,name FROM canonical_live_products WHERE promotion_id=?1 AND product_id IN (${marks})`;
        const rev = (src) => `SELECT b.product_id,COALESCE((SELECT r.name FROM canonical_product_revisions r WHERE r.promotion_id=?1 AND r.product_id=b.product_id ORDER BY r.revision DESC LIMIT 1),b.name) AS name FROM (${src}) b`;
        const tries = c.mode === 'ACTIVE' ? [rev(base + ' UNION ALL ' + live), rev(base), base + ' UNION ALL ' + live, base] : [base]; // sin tabla nueva: la versión sin ella
        let rows = null;
        for (const sql of tries) {
          try { rows = (await db.prepare(sql).bind(c.active_promotion_id, ...part).all()).results || []; break; }
          catch (e) { if (!/no such table: (canonical_product_revisions|canonical_live_products)/i.test(String(e?.message || e))) throw e; }
        }
        for (const r of rows || []) out.set(String(r.product_id), r.name);
      }
      return out;
    },
    // Resúmenes: UNA lectura de cada colección para todos los períodos pedidos (actual y anterior), sin escribir nada.
    // Cobros de créditos: la lectura canónica de credit-payments (importados + abonos en vivo). Solo se suman montos y fechas:
    // ni el cliente ni el nombre que trae el pago salen de aquí. Si una lectura secundaria falla, ese dato queda «no disponible».
    async periodSummary(periods) {
      const [sales, out, items] = await Promise.all([all('sales'), annulled(), all('sale-items')]);
      // Tope de páginas: la lectura canónica va en orden de sale_id / movement_id (no por fecha), así que si alguna colección llega
      // al tope pueden faltar ventas RECIENTES. Se marca truncado y el resumen lo avisa en la tabla y al modelo.
      let moves = null, pays = null, cut = !!(sales.truncated || items.truncated);
      try { const m = await all('cash-movements'); cut = cut || !!m.truncated; moves = m.map((x) => ({ sale_id: String(x.sale_id), credit_cents: Number(x.credit_cents) || 0 })); } catch { moves = null; }
      try { const y = await all('credit-payments'); cut = cut || !!y.truncated; pays = y.map((x) => ({ dia: paymentDay(x), c: Number(x.amount_cents) || 0 })); } catch { pays = null; }
      const list = sales.filter((s) => !out.has(String(s.sale_id))).map((s) => ({ sale_id: String(s.sale_id), created_at: s.created_at, metodo: s.payment_method, total_cents: Number(s.total_cents) || 0 }));
      return aggregatePeriods(periods, list, items.map((it) => ({ sale_id: String(it.sale_id), product_id: String(it.product_id), quantity: Number(it.quantity) || 0, line_total_cents: Number(it.line_total_cents) || 0 })),
        moves, pays, cut);
    },
    async purchases(n) {
      try { return (await db.prepare('SELECT supplier,document_ref,total_cost_cents,line_count,status,created_at FROM pos_purchases ORDER BY created_at DESC LIMIT ?1').bind(n).all()).results || []; }
      catch (e) { if (/no such table/i.test(String(e?.message || e))) return []; throw e; }
    }
  };
}

// Lector en memoria con la MISMA forma (prototipo local y pruebas; datos inventados).
export function memoryReader(data) {
  const inRange = (s, p) => { const t = Date.parse(s.created_at); return t >= Date.parse(p.fromIso) && t < Date.parse(p.toIso) && !s.anulada; }; // por el momento (acepta -05:00)
  const dia = (iso) => new Date(Date.parse(iso) - 5 * 3600 * 1000).toISOString().slice(0, 10);
  return {
    async products() { return (data.products || []).map((p) => ({ ...p })); },
    async productsById(ids) { const want = new Set((ids || []).map(String)), out = new Map(); for (const p of (data.products || [])) if (want.has(String(p.id))) out.set(String(p.id), { ...p }); return out; },
    async credits() { return (data.credits || []).map((c) => ({ ...c })); },
    async customers() { return (data.customers || []).map((c) => ({ ...c })); },
    async salesTotals(p) { const m = new Map(); for (const s of (data.sales || []).filter((x) => inRange(x, p))) { const k = dia(s.created_at) + '|' + s.metodo; const r = m.get(k) || { dia: dia(s.created_at), metodo: s.metodo, n: 0, c: 0 }; r.n++; r.c += s.total_cents; m.set(k, r); } return [...m.values()].sort((a, b) => a.dia.localeCompare(b.dia)); },
    async topItems(p, n) { const ids = new Set((data.sales || []).filter((x) => inRange(x, p)).map((s) => s.sale_id)); const m = new Map();
      for (const it of (data.saleItems || []).filter((x) => ids.has(x.sale_id))) { const g = isGenericId(it.product_id), nm = g ? String(it.generic_name || '').trim() : '', k = g ? 'G|' + nm.toUpperCase() : 'P|' + it.product_id;
        const r = m.get(k) || (g ? { product_id: null, generic: true, generic_name: nm || null, q: 0, c: 0 } : { product_id: it.product_id, q: 0, c: 0 }); r.q += it.quantity; r.c += it.line_total_cents; m.set(k, r); }
      return [...m.values()].sort((a, b) => b.c - a.c).slice(0, n); },
    async productNamesById(ids) { const want = new Set((ids || []).map(String)), out = new Map(); for (const p of (data.products || [])) if (want.has(String(p.id))) out.set(String(p.id), p.nombre); return out; },
    async saleLines(p) { const ids = new Set((data.sales || []).filter((x) => inRange(x, p)).map((s) => s.sale_id));
      return (data.saleItems || []).filter((x) => ids.has(x.sale_id)).map((it) => ({ sale_id: String(it.sale_id), product_id: String(it.product_id), quantity: Number(it.quantity) || 0, unit_cents: numOrNull(it.unit_price_cents), line_cents: numOrNull(it.line_total_cents), created_at: it.created_at || null })); },
    async periodSummary(periods) {
      const list = (data.sales || []).filter((s) => !s.anulada).map((s) => ({ sale_id: String(s.sale_id), created_at: s.created_at, metodo: s.metodo, total_cents: Number(s.total_cents) || 0 }));
      const items = (data.saleItems || []).map((it) => ({ ...it, sale_id: String(it.sale_id), product_id: String(it.product_id) }));
      // Igual que el lector real: sin cash-movements / cobros -> null («no disponible»). data.truncated simula el tope de páginas.
      return aggregatePeriods(periods, list, items, data.cashMovements ? data.cashMovements.map((m) => ({ sale_id: String(m.sale_id), credit_cents: Number(m.credit_cents) || 0 })) : null,
        data.payments ? data.payments.map((x) => ({ dia: paymentDay(x), c: Number(x.amount_cents) || 0 })) : null, !!data.truncated);
    },
    async purchases(n) { return (data.purchases || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, n); }
  };
}

// ---------- Consultas ----------
const isGenericId = (id) => String(id ?? '').startsWith('GENERIC:');
export const GENERIC_LABEL = 'Producto genérico';
const METODO = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia', credito: 'Crédito', mixto: 'Mixto' };
function matchProducts(list, text) {
  const words = norm(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (!words.length) return [];
  return list.map((p) => ({ p, s: words.filter((w) => norm(p.nombre).includes(w)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.p);
}
// Devuelve { tipo, titulo, columnas, filas, texto, resumen } o { error }.
// filas/columnas: para la pantalla del dueño. resumen: lo único que ve el modelo (chico, sin datos personales).
export async function runAssistantQuery(reader, args, nowMs = Date.now()) {
  const tipo = QUERY_TYPES.includes(args?.tipo) ? args.tipo : null;
  if (!tipo) return { error: 'bad_query' };
  const N = QUERY_LIMITS.topRows, M = QUERY_LIMITS.modelRows, base = { tipo, titulo: TITLES[tipo] };
  // truncado: la lectura se cortó (lista larga). Lo usa el chat para NO contestar directo con texto (va la segunda llamada al modelo).
  if (['stock_producto', 'bajo_stock', 'sin_costo'].includes(tipo)) {
    const list = await reader.products(), note = list.truncated ? ' (lista larga: se revisaron los primeros ' + list.length + ')' : '';
    if (list.truncated) base.truncado = true;
    if (tipo === 'stock_producto') {
      const hits = matchProducts(list, args.producto || '').slice(0, 5);
      if (!hits.length) return { ...base, columnas: [], filas: [], texto: 'No encontré ese producto.', resumen: { encontrados: 0 } };
      const filas = hits.map((p) => [p.nombre, p.controla ? r2(p.stock) : 'sin control', r2(p.min), p.precio]);
      return { ...base, columnas: ['Producto', 'Stock', 'Mínimo', 'Precio S/'], filas, texto: sentences(hits.map((p) => p.nombre + ': ' + (p.controla ? r2(p.stock) + ' unid.' : 'sin control de stock'))),
        resumen: { encontrados: hits.length, productos: hits.map((p) => ({ nombre: p.nombre, stock: p.controla ? r2(p.stock) : null, minimo: r2(p.min) })) } };
    }
    if (tipo === 'bajo_stock') {
      const low = list.filter((p) => p.controla && Number.isFinite(p.stock) && (p.stock <= 0 || p.stock <= p.min)).sort((a, b) => (a.stock - a.min) - (b.stock - b.min));
      const filas = low.slice(0, N).map((p) => [p.nombre, r2(p.stock), r2(p.min), Math.max(1, Math.ceil(p.min * 2 - p.stock))]);
      return { ...base, columnas: ['Producto', 'Stock', 'Mínimo', 'Pedir'], filas, total: low.length,
        texto: low.length ? (low.length === 1 ? 'Hay 1 producto en o bajo el mínimo' : 'Hay ' + low.length + ' productos en o bajo el mínimo') + note + '. Los más urgentes: ' + low.slice(0, 3).map((p) => p.nombre + ' (' + r2(p.stock) + ')').join(', ') + '.' : 'Ningún producto está bajo el mínimo' + note + '.',
        resumen: { total: low.length, revisados: list.length, primeros: low.slice(0, M).map((p) => ({ nombre: p.nombre, stock: r2(p.stock), minimo: r2(p.min) })) } };
    }
    const sin = list.filter((p) => !(p.costo > 0));
    return { ...base, columnas: ['Producto', 'Precio S/'], filas: sin.slice(0, N).map((p) => [p.nombre, p.precio]), total: sin.length,
      texto: sin.length ? (sin.length === 1 ? '1 producto no tiene costo' : sin.length + ' productos no tienen costo') + note + '. Sin costo no se calcula bien la ganancia.' : 'Todos los productos tienen costo' + note + '.',
      resumen: { total: sin.length, revisados: list.length, primeros: sin.slice(0, M).map((p) => p.nombre) } };
  }
  if (tipo === 'ventas_periodo' || tipo === 'top_productos') {
    const p = period(args, nowMs), rango = p.desde === p.hasta ? p.desde : p.desde + ' a ' + p.hasta;
    if (tipo === 'ventas_periodo') {
      const rows = await reader.salesTotals(p); let total = 0, n = 0; const byDay = new Map(), byM = new Map();
      for (const r of rows) { total += Number(r.c); n += Number(r.n); byDay.set(r.dia, (byDay.get(r.dia) || 0) + Number(r.c)); byM.set(r.metodo, (byM.get(r.metodo) || 0) + Number(r.c)); }
      const metodos = [...byM.entries()].sort((a, b) => b[1] - a[1]).map(([m, c]) => [METODO[m] || m, cents(c)]);
      const dias = [...byDay.entries()].map(([d, c]) => [d, cents(c)]);
      const filas = [...metodos.map((m) => ['Método: ' + m[0], m[1]]), ...(dias.length > 1 ? dias.slice(-31).map((d) => ['Día ' + d[0], d[1]]) : [])];
      const best = dias.slice().sort((a, b) => b[1] - a[1])[0];
      return { ...base, titulo: 'Ventas ' + rango, columnas: ['Detalle', 'S/'], filas, total: cents(total), ventas: n, desde: p.desde, hasta: p.hasta,
        texto: n ? 'Ventas ' + rango + ': S/ ' + cents(total).toFixed(2) + ' en ' + n + (n === 1 ? ' venta' : ' ventas') + '. Ticket promedio S/ ' + (cents(total) / n).toFixed(2) + '.' : 'No hay ventas registradas ' + rango + '.',
        resumen: { desde: p.desde, hasta: p.hasta, total_soles: cents(total), ventas: n, por_metodo: Object.fromEntries(metodos), mejor_dia: best ? { dia: best[0], soles: best[1] } : null, dias: dias.length } };
    }
    const raw = await reader.topItems(p, N), gen = (r) => !!r.generic || isGenericId(r.product_id);
    // Nombres vigentes SOLO de los N más vendidos (por id, con renombres); un lector sin esa búsqueda lee el catálogo como antes.
    const ids = raw.filter((r) => !gen(r)).map((r) => String(r.product_id));
    const names = typeof reader.productNamesById === 'function' ? await reader.productNamesById(ids) : new Map((await reader.products()).map((x) => [x.id, x.nombre]));
    // Genéricas (VARIOS, VERDURAS…): su propio nombre guardado o «Producto genérico»; NUNCA el id «GENERIC:<uuid>». Las del mismo nombre van juntas.
    const merged = new Map();
    for (const r of raw) { const label = gen(r) ? (String(r.generic_name || '').trim().replace(/\s+/g, ' ') || GENERIC_LABEL) : (names.get(String(r.product_id)) || String(r.product_id));
      const k = (gen(r) ? 'G|' + label.toUpperCase() : 'P|' + r.product_id), o = merged.get(k) || { label, q: 0, c: 0 }; o.q += Number(r.q) || 0; o.c += Number(r.c) || 0; merged.set(k, o); }
    const items = [...merged.values()].sort((a, b) => b.c - a.c).slice(0, N);
    const filas = items.map((r) => [r.label, r2(r.q), cents(r.c)]);
    return { ...base, titulo: 'Más vendidos ' + rango, columnas: ['Producto', 'Unid.', 'S/'], filas, desde: p.desde, hasta: p.hasta,
      texto: filas.length ? 'Más vendido ' + rango + ': ' + filas[0][0] + ' (' + filas[0][1] + ' unid., S/ ' + Number(filas[0][2]).toFixed(2) + ').' : 'No hay ventas ' + rango + '.',
      resumen: { desde: p.desde, hasta: p.hasta, top: filas.slice(0, M).map((f) => ({ nombre: f[0], unidades: f[1], soles: f[2] })) } };
  }
  if (SUMMARY_TYPES.includes(tipo)) return summaryQuery(reader, tipo, args, nowMs, base);
  if (tipo === 'deudas_clientes') {
    const [credits, customers] = await Promise.all([reader.credits(), reader.customers()]);
    const names = new Map(customers.map((c) => [c.id, c.nombre])), by = new Map();
    for (const c of credits) if (c.saldo > 0) by.set(c.cliente, (by.get(c.cliente) || 0) + c.saldo);
    const top = [...by.entries()].sort((a, b) => b[1] - a[1]), total = r2(top.reduce((s, x) => s + x[1], 0));
    // (22-10, prueba en vivo) la tabla tampoco lleva nombres: «cliente #código» (el aparato del Admin le pone el nombre de SU lista, como en el
    // texto del chat). El modelo recibe los mismos códigos, así el texto y la tabla dicen lo mismo.
    // el mismo código que acepta el servidor para «cliente #…» (customerCode: nada que el filtro tape como DNI, RUC o teléfono); si no, «Cliente N»
    const { customerCode } = await import('./pos-assistant.js');
    const cli = (id, i) => customerCode(id) === String(id) ? 'cliente #' + id : 'Cliente ' + (i + 1);
    return { ...base, columnas: ['Cliente', 'Saldo S/'], filas: top.slice(0, N).map(([id, s], i) => [cli(id, i), r2(s)]), total, clientes: top.length,
      texto: top.length ? (top.length === 1 ? '1 cliente debe' : top.length + ' clientes deben') + ' en total S/ ' + total.toFixed(2) + '.' : 'Ningún cliente tiene deuda.',
      // Al modelo: sin nombres ni documentos.
      resumen: { clientes_con_deuda: top.length, total_soles: total, mayores_saldos: top.slice(0, M).map(([id, s], i) => ({ cliente: cli(id, i), soles: r2(s) })) } };
  }
  const rows = await reader.purchases(N);
  const filas = rows.map((r) => [String(r.created_at || '').slice(0, 10), r.supplier || '-', r.document_ref || '-', cents(r.total_cost_cents), r.line_count]);
  return { ...base, columnas: ['Fecha', 'Proveedor', 'Documento', 'Total S/', 'Líneas'], filas,
    texto: rows.length ? (rows.length === 1 ? 'Última compra' : 'Últimas ' + rows.length + ' compras') + '. La más reciente: ' + filas[0][0] + ', ' + filas[0][1] + ', S/ ' + Number(filas[0][3] || 0).toFixed(2) + '.' : 'No hay compras registradas.',
    resumen: { compras: rows.length, total_soles: r2(filas.reduce((s, f) => s + (f[3] || 0), 0)), recientes: filas.slice(0, M).map((f) => ({ fecha: f[0], proveedor: f[1], soles: f[3] })) } };
}

// Resumen del día o del mes. Pantalla del Admin: tabla actual vs. anterior y productos top (con nombre). Modelo y texto de la respuesta:
// SOLO totales, conteos y «producto #código» (sin nombres de producto ni datos de clientes). Nada aquí escribe en la base.
async function summaryQuery(reader, tipo, args, nowMs, base) {
  const per = summaryPeriods(tipo, args, nowMs);
  if (typeof reader.periodSummary !== 'function') return { error: 'no_summary' };
  const [cur, prev] = await reader.periodSummary([per.actual, per.anterior]);
  const names = new Map((await reader.products()).map((x) => [String(x.id), x.nombre]));
  const S = (c) => cents(c) ?? 0, money = (c) => 'S/ ' + S(c).toFixed(2);
  const dia = tipo === 'resumen_dia', lab = (p) => (p.desde === p.hasta ? p.desde : p.desde + ' a ' + p.hasta);
  const curL = dia ? (per.en_curso ? 'Hoy' : per.actual.desde) : (per.en_curso ? 'Este mes' : per.actual.desde.slice(0, 7)), prevL = dia ? 'Día anterior' : 'Mes anterior';
  const byAmount = cur.items.slice().sort((a, b) => b.c - a.c || b.q - a.q), byQty = cur.items.slice().sort((a, b) => b.q - a.q || b.c - a.c);
  const nm = (x) => (isGenericId(x.product_id) ? GENERIC_LABEL : names.get(String(x.product_id)) || 'Producto ' + x.product_id);
  const fmtPct = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + v + ' %');
  const metodos = [...new Set([...Object.keys(cur.metodos), ...Object.keys(prev.metodos)])].sort((a, b) => (cur.metodos[b]?.c || 0) - (cur.metodos[a]?.c || 0));
  const cobro = (r) => (r.pagos_c == null ? 'no disponible' : S(r.pagos_c));
  const ND = 'no disponible', contado = (r) => (r.credito_c == null ? null : r.c - r.credito_c), sv = (c) => (c == null ? ND : S(c));
  const pctN = (a, b) => (a == null || b == null ? null : pct(a, b)), truncado = !!(cur.truncado || prev.truncado);
  const AVISO = 'Aviso: datos incompletos. Hay más registros de los que el asistente lee de una vez y pueden faltar ventas recientes; revise Reportes.';
  const filas = [
    ...(truncado ? [[AVISO, '', '', '']] : []),
    ['Ventas S/', S(cur.c), S(prev.c), fmtPct(pct(cur.c, prev.c))],
    ['N.º de ventas', cur.n, prev.n, fmtPct(pct(cur.n, prev.n))],
    ['Ticket promedio S/', cur.n ? r2(S(cur.c) / cur.n) : 0, prev.n ? r2(S(prev.c) / prev.n) : 0, '—'],
    ['Al contado S/', sv(contado(cur)), sv(contado(prev)), fmtPct(pctN(contado(cur), contado(prev)))],
    ['Al crédito S/', sv(cur.credito_c), sv(prev.credito_c), fmtPct(pctN(cur.credito_c, prev.credito_c))],
    ['Cobros de créditos S/', cobro(cur), cobro(prev), cur.pagos_c == null ? '—' : fmtPct(pct(cur.pagos_c, prev.pagos_c))],
    ...metodos.map((m) => ['Método: ' + (METODO[m] || m), S(cur.metodos[m]?.c || 0), S(prev.metodos[m]?.c || 0), fmtPct(pct(cur.metodos[m]?.c || 0, prev.metodos[m]?.c || 0))]),
    ...byAmount.slice(0, 5).map((x, i) => ['Top ' + (i + 1) + ' por monto: ' + nm(x) + ' (' + productRef(x.product_id) + ', ' + r2(x.q) + ' unid.)', S(x.c), '', '']),
    ...byQty.slice(0, 5).map((x, i) => ['Top ' + (i + 1) + ' por unidades: ' + nm(x) + ' (' + productRef(x.product_id) + ')', r2(x.q), '', ''])
  ];
  const cambio = pct(cur.c, prev.c), nota = truncado ? ' (datos incompletos: pueden faltar ventas recientes)' : '';
  const texto = cur.n
    ? sentences([(dia ? 'Resumen de ' + lab(per.actual) : 'Resumen del mes ' + lab(per.actual)) + ': ' + money(cur.c) + ' en ' + cur.n + (cur.n === 1 ? ' venta' : ' ventas') + nota,
      prevL + ': ' + money(prev.c) + (cambio == null ? '' : ' (' + fmtPct(cambio) + ')'),
      ...(cur.credito_c == null ? [] : ['Al contado ' + money(contado(cur)) + ' y al crédito ' + money(cur.credito_c)]),
      ...(cur.pagos_c == null ? [] : ['Cobros de créditos: ' + money(cur.pagos_c)]),
      ...(byAmount.length ? ['Lo que más vendió: ' + productRef(byAmount[0].product_id) + ' (' + money(byAmount[0].c) + ')'] : [])])
    : sentences(['No hay ventas registradas ' + (dia ? 'el ' : 'en ') + lab(per.actual) + nota, prevL + ': ' + money(prev.c),
      ...(cur.pagos_c ? ['Cobros de créditos: ' + money(cur.pagos_c)] : [])]);
  const tot = (r) => ({ desde: r.desde, hasta: r.hasta, truncado: !!r.truncado, total_soles: S(r.c), ventas: r.n, ticket_promedio: r.n ? r2(S(r.c) / r.n) : 0,
    contado_soles: r.credito_c == null ? null : S(contado(r)), credito_soles: r.credito_c == null ? null : S(r.credito_c), cobros_soles: r.pagos_c == null ? null : S(r.pagos_c), cobros: r.pagos_n,
    por_metodo: Object.fromEntries(Object.entries(r.metodos).map(([m, v]) => [METODO[m] || m, S(v.c)])) });
  const M = 5;
  return { ...base, titulo: (dia ? 'Resumen del día ' : 'Resumen del mes ') + lab(per.actual), columnas: ['Detalle', curL, prevL, 'Cambio'], filas,
    // Sin «total» arriba: la tarjeta lo leería como «Mostrando N de total» (filas truncadas). El total va en la tabla y en total_soles.
    total_soles: S(cur.c), ventas: cur.n, desde: per.actual.desde, hasta: per.actual.hasta, texto,
    resumen: { periodo: dia ? 'dia' : 'mes', en_curso: per.en_curso, truncado, actual: tot(cur), anterior: tot(prev),
      cambio_pct: { total: cambio, ventas: pct(cur.n, prev.n) },
      top_por_monto: byAmount.slice(0, M).map((x) => ({ producto: productRef(x.product_id), unidades: r2(x.q), soles: S(x.c) })),
      top_por_unidades: byQty.slice(0, M).map((x) => ({ producto: productRef(x.product_id), unidades: r2(x.q) })) },
    // Solo para el servidor (no va al aparato ni al modelo): códigos a proteger del redactor en el mensaje al modelo y en la respuesta.
    refIds: [...new Set([...byAmount.slice(0, 5), ...byQty.slice(0, 5)].filter((x) => !isGenericId(x.product_id)).map((x) => String(x.product_id)))] };
}

// ---------- Documentos para aparatos de empleado ----------
// Las filas las arma el SERVIDOR con columnas fijas y SIN costos ni totales de inversión (pedido de Bot 2):
// el aparato del empleado solo da formato. El dueño arma sus documentos con los cálculos del POS (pueden traer costos).
export const EMPLOYEE_DOC_COLUMNS = Object.freeze({ lista_precios: Object.freeze(['Producto', 'Precio S/']), lista_pedido: Object.freeze(['Producto', 'Stock', 'Cantidad sugerida']) });
export async function employeeDocumentRows(reader, tipo) {
  if (!EMPLOYEE_DOC_COLUMNS[tipo]) return { error: 'forbidden_document' };
  const list = await reader.products();
  if (tipo === 'lista_precios') {
    const filas = list.filter((p) => p.nombre).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')).map((p) => [String(p.nombre), Number(p.precio) || 0]);
    return { columnas: [...EMPLOYEE_DOC_COLUMNS.lista_precios], filas, truncado: !!list.truncated };
  }
  // Mismo criterio que «¿Qué falta reponer?»: controla stock y está en o bajo el mínimo. Cantidad sugerida = hasta el doble del mínimo.
  const low = list.filter((p) => p.controla && Number.isFinite(p.stock) && (p.stock <= 0 || p.stock <= p.min)).sort((a, b) => (a.stock - a.min) - (b.stock - b.min));
  return { columnas: [...EMPLOYEE_DOC_COLUMNS.lista_pedido], filas: low.map((p) => [String(p.nombre), r2(p.stock), Math.max(1, Math.ceil(p.min * 2 - p.stock))]), truncado: !!list.truncated };
}
