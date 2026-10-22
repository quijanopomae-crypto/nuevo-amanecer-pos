// Consultas del asistente (SOLO LECTURA). El Worker lee su base y arma un resumen chico:
// - a la pantalla del dueño va una tabla con números (top N filas);
// - a DeepSeek va un resumen aún más chico y SIN datos personales (clientes como «Cliente 1», sin DNI ni teléfono).
// Nunca se manda el inventario completo al modelo. Nada aquí escribe en la base.
import { canonicalRead } from './a6-canonical.js';

// Frases seguidas con un solo punto al final de cada una (Bot 4: nada de «unid..»).
const sentences = (arr) => arr.map((x) => (/[.!?]$/.test(x) ? x : x + '.')).join(' ');
export const QUERY_TYPES = Object.freeze(['stock_producto', 'bajo_stock', 'sin_costo', 'ventas_periodo', 'top_productos', 'deudas_clientes', 'compras_recientes', 'sugerencias_compra']);
export const PRODUCT_ID_CHUNK = 50; // ids por consulta IN (...): muy por debajo del tope de 100 parámetros de D1
export const QUERY_LIMITS = Object.freeze({ topRows: 10, modelRows: 8, maxPages: 20, pageSize: 250, maxDays: 92 });
const TITLES = { stock_producto: 'Stock del producto', bajo_stock: 'Productos por reponer', sin_costo: 'Productos sin costo', ventas_periodo: 'Ventas del período',
  top_productos: 'Productos más vendidos', deudas_clientes: 'Deudas de clientes', compras_recientes: 'Compras recientes',
  sugerencias_compra: 'Sugerencias de compra' };
// Sugerencias de compra (solo Admin, solo lectura): con el stock, el mínimo y lo vendido en los últimos días (todo dato que ya existe).
// Nunca crea una compra ni cambia stock: es una lista para que el dueño la revise y registre él mismo en «Registrar compra».
export const SUGGEST_RULES = Object.freeze({ diasVentas: 30, diasCobertura: 14, alertaDias: 7, filas: 30, listaMax: 20, revisarBajo: -50 });
// Productos «genéricos» (se venden por monto, sin contar stock): nunca entran en las sugerencias de compra. Se compara el nombre
// sin tildes ni mayúsculas, entero o como prefijo claro («VERDURAS», «Verduras - kg», «RECARGA CLARO»; no «VARIOSITO»).
// Para sumar otro (p. ej. 'DULCES Y CARAMELOS'), agrégalo aquí.
export const GENERIC_PRODUCT_NAMES = Object.freeze(['VARIOS', 'VERDURAS', 'RECARGAS', 'PRÉSTAMOS']);
// Categorías de servicios (préstamos, recargas): no llevan stock. La pantalla de Inventario guarda «servicios»; se acepta también «servicio».
export const SERVICE_CATEGORIES = Object.freeze(['servicios', 'servicio']);

const cents = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)) / 100);
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function limaToday(nowMs) { return new Date(nowMs - 5 * 3600 * 1000).toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const normName = (s) => norm(s).replace(/\s+/g, ' ').trim();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Entero o prefijo seguido de algo que no es letra ni número; la «s» final es opcional (RECARGA / RECARGAS).
const GENERIC_RE = (names) => new RegExp('^(?:' + names.map((n) => escRe(normName(n)).replace(/s$/, 's?')).join('|') + ')(?![a-z0-9])');
export function isServiceProduct(p) { return SERVICE_CATEGORIES.includes(normName(p?.categoria)); }
const DEFAULT_GENERIC_RE = GENERIC_RE(GENERIC_PRODUCT_NAMES);
export function isGenericProduct(p, names = GENERIC_PRODUCT_NAMES) { return isServiceProduct(p) || (names.length > 0 && (names === GENERIC_PRODUCT_NAMES ? DEFAULT_GENERIC_RE : GENERIC_RE(names)).test(normName(p?.nombre))); }
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
  // Ventas: la MISMA lectura canónica que usa la réplica del POS (/read/canonical/sales y sale-items) y la MISMA lista de
  // anulaciones que GET /auth/sale-annulments (pos-sale-annul.js). El asistente solo filtra por fecha y suma.
  async function annulled() {
    try { const rows = (await db.prepare('SELECT sale_id,operation_id,reason,status,cash_cents,digital_cents,created_at,completed_at FROM pos_sale_annulments ORDER BY created_at DESC LIMIT 2000').all()).results || [];
      return new Set(rows.filter((r) => r.status === 'anulada').map((r) => String(r.sale_id))); }
    catch (e) { if (/no such table/i.test(String(e?.message || e))) return new Set(); throw e; }
  }
  async function salesIn(p) { const [sales, out] = await Promise.all([all('sales'), annulled()]); const list = sales.filter((s) => s.created_at >= p.fromIso && s.created_at < p.toIso && !out.has(String(s.sale_id))); list.truncated = sales.truncated; return list; }
  return {
    async products() { const rows = await all('products'); const list = rows.map((p) => ({ id: String(p.product_id), nombre: p.name, stock: Number(p.current_stock_quantity), min: Number(p.stock_min_quantity || 0),
      costo: cents(p.cost_cents), precio: cents(p.price_cents), categoria: p.category ?? null, controla: p.tracks_inventory === 1 || p.tracks_inventory === true })); list.truncated = rows.truncated; return list; },
    // Solo los ids pedidos (control de inventario de una tarjeta): una consulta por tramo de <= 50 ids con parámetros enlazados, sin
    // leer el catálogo. Misma autoridad que la lectura canónica: promoción activa (importados + creados en vivo). Si la consulta
    // falla, lanza (quien llama falla CERRADO). Un id que no vuelve es un producto que no existe.
    async productsById(ids) {
      const want = [...new Set((ids || []).map(String))]; const out = new Map(); if (!want.length) return out;
      const ctl = await db.prepare('SELECT mode,active_promotion_id FROM canonical_control WHERE id=1').first();
      if (!ctl || !['CANONICAL_READ_ONLY', 'ACTIVE'].includes(ctl.mode) || !ctl.active_promotion_id) throw new Error('canonical_not_published');
      for (let i = 0; i < want.length; i += PRODUCT_ID_CHUNK) {
        const part = want.slice(i, i + PRODUCT_ID_CHUNK), marks = part.map((_, k) => '?' + (k + 2)).join(',');
        const base = `SELECT product_id,name,tracks_inventory FROM products WHERE promotion_id=?1 AND product_id IN (${marks})`;
        const live = `SELECT product_id,name,tracks_inventory FROM canonical_live_products WHERE promotion_id=?1 AND product_id IN (${marks})`;
        let rows;
        if (ctl.mode === 'ACTIVE') {
          try { rows = (await db.prepare(base + ' UNION ALL ' + live).bind(ctl.active_promotion_id, ...part).all()).results || []; }
          catch (e) { if (!/no such table: canonical_live_products/i.test(String(e?.message || e))) throw e; rows = null; }
        }
        if (!rows) rows = (await db.prepare(base).bind(ctl.active_promotion_id, ...part).all()).results || [];
        for (const r of rows) out.set(String(r.product_id), { id: String(r.product_id), nombre: r.name, controla: r.tracks_inventory === 1 || r.tracks_inventory === true });
      }
      return out;
    },
    async credits() { const rows = await all('credits'); return rows.map((c) => ({ cliente: String(c.customer_id), saldo: cents(c.current_balance_cents) || 0, vence: c.due_date || c.due_value || null })); },
    async customers() { const rows = await all('customers'); return rows.map((c) => ({ id: String(c.customer_id), nombre: c.name })); },
    async salesTotals(p) {
      const m = new Map(); for (const s of await salesIn(p)) { const dia = new Date(Date.parse(s.created_at) - 5 * 3600 * 1000).toISOString().slice(0, 10), k = dia + '|' + s.payment_method;
        const r = m.get(k) || { dia, metodo: s.payment_method, n: 0, c: 0 }; r.n++; r.c += Number(s.total_cents) || 0; m.set(k, r); }
      return [...m.values()].sort((a, b) => a.dia.localeCompare(b.dia));
    },
    async topItems(p, n) {
      const ids = new Set((await salesIn(p)).map((s) => String(s.sale_id))), m = new Map();
      for (const it of await all('sale-items')) { if (!ids.has(String(it.sale_id))) continue; const r = m.get(it.product_id) || { product_id: it.product_id, q: 0, c: 0 }; r.q += Number(it.quantity) || 0; r.c += Number(it.line_total_cents) || 0; m.set(it.product_id, r); }
      return [...m.values()].sort((a, b) => b.c - a.c).slice(0, n);
    },
    // Unidades vendidas por producto en el período (ventas anuladas fuera), con la misma lectura canónica que topItems.
    // La lectura canónica pagina por sale_id (no por fecha) y tiene tope de páginas: si ventas O líneas se cortan, pueden faltar
    // ventas recientes. No hay filtro por fecha en /read/canonical sin tocar a6-canonical.js, así que se marca truncated y la
    // consulta lo avisa (pantalla, texto y modelo) en vez de callarlo.
    async soldQty(p) {
      const [sales, items] = await Promise.all([salesIn(p), all('sale-items')]), ids = new Set(sales.map((s) => String(s.sale_id))), m = new Map();
      for (const it of items) { if (!ids.has(String(it.sale_id))) continue; const k = String(it.product_id); m.set(k, (m.get(k) || 0) + (Number(it.quantity) || 0)); }
      m.truncated = !!(sales.truncated || items.truncated); return m;
    },
    async purchases(n) {
      try { return (await db.prepare('SELECT supplier,document_ref,total_cost_cents,line_count,status,created_at FROM pos_purchases ORDER BY created_at DESC LIMIT ?1').bind(n).all()).results || []; }
      catch (e) { if (/no such table/i.test(String(e?.message || e))) return []; throw e; }
    }
  };
}

// Lector en memoria con la MISMA forma (prototipo local y pruebas; datos inventados).
export function memoryReader(data) {
  const inRange = (s, p) => s.created_at >= p.fromIso && s.created_at < p.toIso && !s.anulada;
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
    async soldQty(p) { const ids = new Set((data.sales || []).filter((x) => inRange(x, p)).map((s) => s.sale_id)), m = new Map();
      for (const it of (data.saleItems || []).filter((x) => ids.has(x.sale_id))) { const k = String(it.product_id); m.set(k, (m.get(k) || 0) + (Number(it.quantity) || 0)); } return m; },
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
// Cálculo puro de las sugerencias (se prueba aparte). products: forma del lector; sold: Map product_id -> unidades vendidas en `dias` días.
// Entra un producto con control de stock si está agotado, en o bajo el mínimo, o si a su ritmo de venta le alcanza para menos de
// alertaDias días. Objetivo: mínimo + lo que se vende en diasCobertura días (sin ventas: el doble del mínimo, como «¿Qué falta reponer?»).
// Agotado (stock <= 0, también negativo) SIEMPRE entra: al menos 1, o lo que falte para volver a 0 y llegar al objetivo; sin mínimo ni
// ventas queda marcado sinDatos (la cantidad es solo un piso, el dueño decide).
// Orden: agotados primero, luego los que se acaban antes (días que alcanza), luego los sin ventas más lejos del mínimo; empate: más unidades.
// Fuera de la lista (no son compras): genéricos y servicios (GENERIC_PRODUCT_NAMES / SERVICE_CATEGORIES); stock bajo revisarBajo
// (−50) -> revisarDatos (el número está mal, no hay que comprar 7660 verduras); en 0 o negativo, sin mínimo y sin ventas en el
// período -> sinContar (stock que nadie contó, p. ej. vendido con «Faltan N» y nunca repuesto).
export function purchasePlan(products, sold, dias, rules = SUGGEST_RULES) {
  const out = [], sinContar = [], revisarDatos = []; let genericos = 0;
  const revisarBajo = Number.isFinite(Number(rules.revisarBajo)) ? Number(rules.revisarBajo) : SUGGEST_RULES.revisarBajo;
  for (const p of products || []) {
    if (!p || !p.controla || !Number.isFinite(Number(p.stock))) continue;
    if (isGenericProduct(p)) { genericos++; continue; }
    const stock = Number(p.stock), min = Math.max(0, Number(p.min) || 0), vendidos = Math.max(0, Number(sold?.get(String(p.id))) || 0);
    if (stock < revisarBajo) { revisarDatos.push({ id: String(p.id), nombre: p.nombre, stock: r2(stock), min: r2(min), vendidos: r2(vendidos) }); continue; }
    if (stock <= 0 && min === 0 && vendidos === 0) { sinContar.push({ id: String(p.id), nombre: p.nombre, stock: r2(stock) }); continue; }
    const ritmo = dias > 0 ? vendidos / dias : 0, alcanza = ritmo > 0 ? Math.max(0, stock) / ritmo : null;
    if (!(stock <= 0 || stock <= min || (alcanza != null && alcanza < rules.alertaDias))) continue;
    const objetivo = ritmo > 0 ? min + ritmo * rules.diasCobertura : min * 2, calc = Math.ceil(objetivo - stock - 1e-9);
    const sugerido = stock <= 0 ? Math.max(1, calc) : calc, sinDatos = stock <= 0 && ritmo === 0 && min === 0;
    if (!(sugerido > 0)) continue;
    const costo = Number(p.costo) > 0 ? Number(p.costo) : null;
    out.push({ id: String(p.id), nombre: p.nombre, stock: r2(stock), min: r2(min), vendidos: r2(vendidos), alcanza: alcanza == null ? null : Math.floor(alcanza * 10) / 10,
      sugerido, sinDatos, costo, costoEst: costo == null ? null : r2(costo * sugerido) });
  }
  const rank = (x) => (x.stock <= 0 ? 0 : x.alcanza != null ? 1 : 2), byId = (a, b) => a.id.localeCompare(b.id);
  revisarDatos.sort((a, b) => a.stock - b.stock || byId(a, b)); sinContar.sort((a, b) => a.stock - b.stock || byId(a, b));
  const sugerencias = out.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? a.alcanza - b.alcanza : rank(a) === 2 ? (a.stock - a.min) - (b.stock - b.min) : 0) || b.sugerido - a.sugerido || a.id.localeCompare(b.id));
  return { sugerencias, sinContar, revisarDatos, genericos };
}
// Compatibilidad: solo la lista de compras.
export function purchaseSuggestions(products, sold, dias, rules = SUGGEST_RULES) { return purchasePlan(products, sold, dias, rules).sugerencias; }
function suggestPeriod(args, nowMs) {
  if (DATE.test(args?.desde || '') || DATE.test(args?.hasta || '')) return period(args, nowMs);
  const hasta = limaToday(nowMs); return period({ desde: addDays(hasta, -(SUGGEST_RULES.diasVentas - 1)), hasta }, nowMs);
}
// Devuelve { tipo, titulo, columnas, filas, texto, resumen } o { error }.
// filas/columnas: para la pantalla del dueño. resumen: lo único que ve el modelo (chico, sin datos personales).
export async function runAssistantQuery(reader, args, nowMs = Date.now()) {
  const tipo = QUERY_TYPES.includes(args?.tipo) ? args.tipo : null;
  if (!tipo) return { error: 'bad_query' };
  const N = QUERY_LIMITS.topRows, M = QUERY_LIMITS.modelRows, base = { tipo, titulo: TITLES[tipo] };
  if (['stock_producto', 'bajo_stock', 'sin_costo'].includes(tipo)) {
    const list = await reader.products(), note = list.truncated ? ' (lista larga: se revisaron los primeros ' + list.length + ')' : '';
    if (tipo === 'stock_producto') {
      const hits = matchProducts(list, args.producto || '').slice(0, 5);
      if (!hits.length) return { ...base, columnas: [], filas: [], texto: 'No encontré ese producto.', resumen: { encontrados: 0 } };
      const filas = hits.map((p) => [p.nombre, p.controla ? r2(p.stock) : 'sin control', r2(p.min), p.precio]);
      return { ...base, columnas: ['Producto', 'Stock', 'Mínimo', 'Precio S/'], filas, texto: sentences(hits.map((p) => p.nombre + ': ' + (p.controla ? r2(p.stock) + ' unid.' : 'sin control de stock'))),
        resumen: { encontrados: hits.length, productos: hits.map((p) => ({ nombre: p.nombre, stock: p.controla ? r2(p.stock) : null, minimo: r2(p.min) })) } };
    }
    if (tipo === 'bajo_stock') {
      // Servicios fuera (no llevan stock), igual que la pestaña «Crítico» de Inventario.
      const low = list.filter((p) => p.controla && !isServiceProduct(p) && Number.isFinite(p.stock) && (p.stock <= 0 || p.stock <= p.min)).sort((a, b) => (a.stock - a.min) - (b.stock - b.min));
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
    const items = await reader.topItems(p, N), names = new Map((await reader.products()).map((x) => [x.id, x.nombre]));
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
  if (tipo === 'sugerencias_compra') {
    const p = suggestPeriod(args, nowMs), dias = Math.round((Date.parse(p.hasta) - Date.parse(p.desde)) / 86400000) + 1;
    const [list, sold] = await Promise.all([reader.products(), typeof reader.soldQty === 'function' ? reader.soldQty(p) : new Map()]);
    const plan = purchasePlan(list, sold, dias), sug = plan.sugerencias, F = SUGGEST_RULES.filas, L = SUGGEST_RULES.listaMax;
    const nSC = plan.sinContar.length, nRD = plan.revisarDatos.length;
    const sin_contar = { total: nSC, lista: plan.sinContar.slice(0, L).map((x) => ({ codigo: x.id, nombre: x.nombre, stock: x.stock })) };
    const revisar_datos = { total: nRD, lista: plan.revisarDatos.slice(0, L).map((x) => ({ codigo: x.id, nombre: x.nombre, stock: x.stock, vendidos: x.vendidos })) };
    const aparte = [...(nRD ? [(nRD === 1 ? '1 producto tiene' : nRD + ' productos tienen') + ' el stock muy en negativo (menos de ' + SUGGEST_RULES.revisarBajo + '): revisa sus datos antes de comprar'] : []),
      ...(nSC ? [(nSC === 1 ? '1 producto está' : nSC + ' productos están') + ' en 0 o en negativo, sin mínimo y sin ventas en ' + dias + ' días: es stock sin contar, no los sugiero'] : [])];
    const unidades = sug.reduce((s, x) => s + x.sugerido, 0), conCosto = sug.filter((x) => x.costoEst != null), sinCosto = sug.length - conCosto.length;
    const costo = r2(conCosto.reduce((s, x) => s + x.costoEst, 0));
    const truncado = !!(list.truncated || sold.truncated), note = truncado ? ' (lista larga: se revisó una parte)' : '';
    // Pantalla del dueño: con nombres. Al modelo: solo número de fila, código del producto y cantidades (nunca nombres ni datos de clientes).
    const filas = sug.slice(0, F).map((x, i) => [i + 1, x.nombre || 'Producto ' + x.id, x.stock, x.min, x.vendidos, x.sinDatos ? 'sin datos' : x.alcanza == null ? '-' : x.alcanza, x.sugerido, x.costoEst == null ? '-' : x.costoEst]);
    return { ...base, titulo: 'Sugerencias de compra (ventas ' + p.desde + ' a ' + p.hasta + ')', columnas: ['N°', 'Producto', 'Stock', 'Mínimo', 'Vendidos ' + dias + ' d', 'Días que alcanza', 'Sugerido', 'Costo est. S/'], filas,
      total: sug.length, desde: p.desde, hasta: p.hasta, truncado, sin_contar, revisar_datos, genericos_excluidos: plan.genericos,
      texto: sug.length ? sentences([(sug.length === 1 ? 'Sugiero reponer 1 producto' : 'Sugiero reponer ' + sug.length + ' productos') + ': ' + r2(unidades) + ' unidades' + (conCosto.length ? ', unos S/ ' + costo.toFixed(2) + ' según el costo registrado' + (sinCosto ? ' (' + sinCosto + ' sin costo)' : '') : '') + note,
        ...(truncado ? ['Ojo: hay muchos datos y solo se leyó una parte; las ventas recientes pueden faltar y las cantidades quedar cortas'] : []), ...aparte,
        'Es solo una sugerencia: revisa la tabla y registra la compra tú mismo en Inventario > Registrar compra']) : 'Según las ventas de los últimos ' + dias + ' días no hace falta reponer nada' + note + '.' + (truncado ? ' Ojo: solo se leyó una parte de los datos.' : '') + (aparte.length ? ' ' + sentences(aparte) : ''),
      resumen: { dias_analizados: dias, revisados: list.length, truncado, productos_sugeridos: sug.length, unidades_total: r2(unidades), costo_estimado_soles: costo, sin_costo: sinCosto,
        primeros: sug.slice(0, M).map((x, i) => ({ fila: i + 1, codigo: x.id, stock: x.stock, minimo: x.min, vendidos: x.vendidos, dias_alcanza: x.alcanza, sugerido: x.sugerido, ...(x.sinDatos ? { sin_datos: true } : {}) })),
        // Aparte (no son compras): solo totales y códigos.
        sin_contar: { total: nSC, codigos: sin_contar.lista.map((x) => x.codigo) }, revisar_datos: { total: nRD, codigos: revisar_datos.lista.map((x) => x.codigo) }, genericos_excluidos: plan.genericos,
        nota: 'Solo sugerencia. Los productos van por número de fila de la tabla que ve el dueño. No se creó ninguna compra.' } };
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
