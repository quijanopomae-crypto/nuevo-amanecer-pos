// Consultas del asistente (SOLO LECTURA). El Worker lee su base y arma un resumen chico:
// - a la pantalla del dueño va una tabla con números (top N filas);
// - a DeepSeek va un resumen aún más chico y SIN datos personales (clientes como «Cliente 1», sin DNI ni teléfono).
// Nunca se manda el inventario completo al modelo. Nada aquí escribe en la base.
import { canonicalRead } from './a6-canonical.js';

// Frases seguidas con un solo punto al final de cada una (Bot 4: nada de «unid..»).
const sentences = (arr) => arr.map((x) => (/[.!?]$/.test(x) ? x : x + '.')).join(' ');
export const QUERY_TYPES = Object.freeze(['stock_producto', 'bajo_stock', 'sin_costo', 'ventas_periodo', 'top_productos', 'deudas_clientes', 'compras_recientes']);
export const PRODUCT_ID_CHUNK = 50; // ids por consulta IN (...): muy por debajo del tope de 100 parámetros de D1
export const QUERY_LIMITS = Object.freeze({ topRows: 10, modelRows: 8, maxPages: 20, pageSize: 250, maxDays: 92 });
const TITLES = { stock_producto: 'Stock del producto', bajo_stock: 'Productos por reponer', sin_costo: 'Productos sin costo', ventas_periodo: 'Ventas del período',
  top_productos: 'Productos más vendidos', deudas_clientes: 'Deudas de clientes', compras_recientes: 'Compras recientes' };

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
    async topItems(p, n) {
      const rows = await salesSql(p, 'i.product_id AS product_id,SUM(i.quantity) AS q,SUM(i.line_total_cents) AS c', { join: 'JOIN sale_items i ON i.sale_id=r.sale_id', rest: 'GROUP BY i.product_id ORDER BY c DESC,i.product_id LIMIT ?4' }, [Math.max(1, Math.min(100, Number(n) || 10))]);
      return rows.map((r) => ({ product_id: r.product_id, q: Number(r.q) || 0, c: Number(r.c) || 0 }));
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
      for (const it of (data.saleItems || []).filter((x) => ids.has(x.sale_id))) { const r = m.get(it.product_id) || { product_id: it.product_id, q: 0, c: 0 }; r.q += it.quantity; r.c += it.line_total_cents; m.set(it.product_id, r); }
      return [...m.values()].sort((a, b) => b.c - a.c).slice(0, n); },
    async productNamesById(ids) { const want = new Set((ids || []).map(String)), out = new Map(); for (const p of (data.products || [])) if (want.has(String(p.id))) out.set(String(p.id), p.nombre); return out; },
    async saleLines(p) { const ids = new Set((data.sales || []).filter((x) => inRange(x, p)).map((s) => s.sale_id));
      return (data.saleItems || []).filter((x) => ids.has(x.sale_id)).map((it) => ({ sale_id: String(it.sale_id), product_id: String(it.product_id), quantity: Number(it.quantity) || 0, unit_cents: numOrNull(it.unit_price_cents), line_cents: numOrNull(it.line_total_cents), created_at: it.created_at || null })); },
    async purchases(n) { return (data.purchases || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, n); }
  };
}

// ---------- Consultas ----------
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
    const items = await reader.topItems(p, N);
    // Nombres vigentes SOLO de los N más vendidos (por id, con renombres); un lector sin esa búsqueda lee el catálogo como antes.
    const names = typeof reader.productNamesById === 'function' ? await reader.productNamesById(items.map((r) => String(r.product_id))) : new Map((await reader.products()).map((x) => [x.id, x.nombre]));
    const filas = items.map((r) => [names.get(String(r.product_id)) || String(r.product_id), r2(r.q), cents(r.c)]);
    return { ...base, titulo: 'Más vendidos ' + rango, columnas: ['Producto', 'Unid.', 'S/'], filas, desde: p.desde, hasta: p.hasta,
      texto: filas.length ? 'Más vendido ' + rango + ': ' + filas[0][0] + ' (' + filas[0][1] + ' unid., S/ ' + Number(filas[0][2]).toFixed(2) + ').' : 'No hay ventas ' + rango + '.',
      resumen: { desde: p.desde, hasta: p.hasta, top: filas.slice(0, M).map((f) => ({ nombre: f[0], unidades: f[1], soles: f[2] })) } };
  }
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
