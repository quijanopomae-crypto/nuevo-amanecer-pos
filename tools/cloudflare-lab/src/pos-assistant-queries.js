// Consultas del asistente (SOLO LECTURA). El Worker lee su base y arma un resumen chico:
// - a la pantalla del dueño va una tabla con números (top N filas);
// - a DeepSeek va un resumen aún más chico y SIN datos personales (clientes como «Cliente 1», sin DNI ni teléfono).
// Nunca se manda el inventario completo al modelo. Nada aquí escribe en la base.
import { canonicalRead } from './a6-canonical.js';

// Frases seguidas con un solo punto al final de cada una (Bot 4: nada de «unid..»).
const sentences = (arr) => arr.map((x) => (/[.!?]$/.test(x) ? x : x + '.')).join(' ');
export const QUERY_TYPES = Object.freeze(['stock_producto', 'bajo_stock', 'sin_costo', 'ventas_periodo', 'top_productos', 'deudas_clientes', 'creditos_atrasados', 'compras_recientes']);
export const PRODUCT_ID_CHUNK = 50; // ids por consulta IN (...): muy por debajo del tope de 100 parámetros de D1
export const QUERY_LIMITS = Object.freeze({ topRows: 10, modelRows: 8, maxPages: 20, pageSize: 250, maxDays: 92 });
const TITLES = { stock_producto: 'Stock del producto', bajo_stock: 'Productos por reponer', sin_costo: 'Productos sin costo', ventas_periodo: 'Ventas del período',
  top_productos: 'Productos más vendidos', deudas_clientes: 'Deudas de clientes', creditos_atrasados: 'Créditos atrasados', compras_recientes: 'Compras recientes' };

const cents = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)) / 100);
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
      costo: cents(p.cost_cents), precio: cents(p.price_cents), controla: p.tracks_inventory === 1 || p.tracks_inventory === true })); list.truncated = rows.truncated; return list; },
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
    async credits() { const rows = await all('credits'); const list = rows.map((c) => ({ cliente: String(c.customer_id), saldo: cents(c.current_balance_cents) || 0,
      original: cents(c.opening_balance_cents ?? c.original_amount_cents), vence: c.due_date || c.due_value || termDue(c.issued_value, c.term_days), cuotas: parseCuotas(c.installments_json) }));
      list.truncated = rows.truncated; return list; },
    async customers() { const rows = await all('customers'); const list = rows.map((c) => ({ id: String(c.customer_id), nombre: c.name, dni: c.document == null ? null : String(c.document), tel: c.phone == null ? null : String(c.phone) }));
      list.truncated = rows.truncated; return list; },
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
    async credits() { const l = (data.credits || []).map((c) => ({ ...c })); l.truncated = !!data.creditsTruncated; return l; },
    async customers() { const l = (data.customers || []).map((c) => ({ ...c })); l.truncated = !!data.customersTruncated; return l; },
    async salesTotals(p) { const m = new Map(); for (const s of (data.sales || []).filter((x) => inRange(x, p))) { const k = dia(s.created_at) + '|' + s.metodo; const r = m.get(k) || { dia: dia(s.created_at), metodo: s.metodo, n: 0, c: 0 }; r.n++; r.c += s.total_cents; m.set(k, r); } return [...m.values()].sort((a, b) => a.dia.localeCompare(b.dia)); },
    async topItems(p, n) { const ids = new Set((data.sales || []).filter((x) => inRange(x, p)).map((s) => s.sale_id)); const m = new Map();
      for (const it of (data.saleItems || []).filter((x) => ids.has(x.sale_id))) { const r = m.get(it.product_id) || { product_id: it.product_id, q: 0, c: 0 }; r.q += it.quantity; r.c += it.line_total_cents; m.set(it.product_id, r); }
      return [...m.values()].sort((a, b) => b.c - a.c).slice(0, n); },
    async purchases(n) { return (data.purchases || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, n); }
  };
}

// ---------- Créditos atrasados (solo Admin) ----------
// Fecha de vencimiento del crédito -> 'AAAA-MM-DD' (acepta AAAA-MM-DD[...] y DD/MM/AAAA). Sin fecha válida: null (no se cuenta como atrasado).
export function dueDay(v) {
  const s = String(v == null ? '' : v).trim(); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) { const d = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\D.*)?$/.exec(s); if (d) m = [null, d[3], d[2].padStart(2, '0'), d[1].padStart(2, '0')]; }
  if (!m) return null; const iso = m[1] + '-' + m[2] + '-' + m[3], t = Date.parse(iso + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : null;
}
// Créditos sin vencimiento propio (p. ej. importados de CasaMarket): emisión + plazo en días, si los dos existen.
export function termDue(issued, term) {
  if (term == null || term === '') return null; const d = dueDay(issued), n = Number(term); if (!d || !Number.isInteger(n) || n < 0 || n > 3650) return null;
  return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
// Cuotas (installments_json de canonical_credit_installments) -> [{ vence: 'AAAA-MM-DD', soles }] ordenadas. JSON roto o vacío: [].
export function parseCuotas(v) {
  let a = v; if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return []; } }
  if (!Array.isArray(a)) return [];
  return a.map((q) => ({ n: Number(q?.number) || 0, vence: dueDay(q?.due_date ?? q?.vence), soles: q?.amount_cents != null ? (Number(q.amount_cents) || 0) / 100 : Number(q?.soles) || 0 }))
    .filter((q) => q.vence && q.soles > 0).sort((a, b) => a.vence.localeCompare(b.vence) || a.n - b.n).map(({ vence, soles }) => ({ vence, soles }));
}
// Lo vencido de un crédito a la fecha «today». Con cuotas: lo pagado (original - saldo) cubre primero las cuotas más antiguas y
// solo cuenta lo pendiente de las cuotas ya vencidas. Sin cuotas: todo el saldo desde su vencimiento. -> { soles, desde } o null.
export function overduePart(c, today) {
  const saldo = Number(c.saldo) || 0; if (!(saldo > 0)) return null;
  const cuotas = Array.isArray(c.cuotas) ? c.cuotas : [];
  if (cuotas.length) {
    // Lo pagado sale de las propias cuotas (suma de cuotas - saldo), no del saldo inicial, que puede no coincidir.
    const sum = cuotas.reduce((s, q) => s + q.soles, 0);
    let pagado = Math.max(0, sum - saldo), soles = 0, desde = null;
    for (const q of cuotas) { const pend = Math.max(0, q.soles - pagado); pagado = Math.max(0, pagado - q.soles);
      if (pend > 0 && q.vence < today) { soles += pend; if (!desde) desde = q.vence; } }
    // Saldo que no cubre ninguna cuota (cuotas que suman menos que el saldo): cuenta desde el vencimiento del crédito, si ya pasó.
    const fuera = r2(saldo - sum), due = dueDay(c.vence);
    if (fuera > 0 && due && due < today) { soles += fuera; if (!desde || due < desde) desde = due; }
    soles = Math.min(saldo, r2(soles)); return soles > 0 ? { soles, desde } : null;
  }
  const due = dueDay(c.vence); if (!due) return undefined; // sin fecha
  return due < today ? { soles: saldo, desde: due } : null;
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
// Código que puede ver la IA: el id interno del cliente, solo si es corto, alfanumérico y NO es su DNI ni su teléfono. Si no, null.
export function safeClientCode(id, customer) {
  const code = String(id == null ? '' : id);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) return null;
  const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
  if (customer && [customer.dni, customer.tel, customer.telefono].some((v) => v != null && digits(v).length >= 6 && digits(v) === digits(code))) return null;
  return code;
}
export const OVERDUE_BUCKETS = Object.freeze([['1-7 días', 1, 7], ['8-30 días', 8, 30], ['31-90 días', 31, 90], ['más de 90 días', 91, Infinity]]);
// Borrador de recordatorio de cobro: SOLO para la pantalla del Admin, que lo copia y lo envía él mismo. Nunca va al modelo.
export function reminderDraft(nombre, soles, desde) {
  const quien = String(nombre || '').trim(), saludo = quien ? 'Hola ' + quien + ', ' : 'Hola, ';
  return saludo + 'le saludamos de Nuevo Amanecer. Le recordamos que tiene un saldo pendiente de S/ ' + r2(soles).toFixed(2) + ' vencido desde el ' + desde.split('-').reverse().join('/') +
    '. Cuando pueda, acérquese a la tienda para ponerse al día. ¡Gracias!';
}
async function overdueCredits(reader, nowMs) {
  const today = limaToday(nowMs), [credits, customers] = await Promise.all([reader.credits(), reader.customers()]);
  const byId = new Map(customers.map((c) => [String(c.id), c])), by = new Map(); let sinFecha = 0;
  for (const c of credits) {
    const o = overduePart(c, today); if (o === undefined) { sinFecha++; continue; } if (!o) continue;
    const dias = daysBetween(o.desde, today); if (dias < 1) continue;
    const k = String(c.cliente), g = by.get(k) || { id: k, soles: 0, creditos: 0, dias: 0, desde: o.desde };
    g.soles += o.soles; g.creditos++; if (dias > g.dias) { g.dias = dias; g.desde = o.desde; } by.set(k, g);
  }
  const list = [...by.values()].map((g) => ({ ...g, soles: r2(g.soles), cust: byId.get(g.id) || null })).sort((a, b) => b.dias - a.dias || b.soles - a.soles);
  return { list, sinFecha, total: r2(list.reduce((s, g) => s + g.soles, 0)), truncado: !!(credits.truncated || customers.truncated), clientesCortados: !!customers.truncated };
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
  if (tipo === 'creditos_atrasados') {
    const { list, sinFecha, total, truncado, clientesCortados } = await overdueCredits(reader, nowMs);
    const rangos = Object.fromEntries(OVERDUE_BUCKETS.map(([n, lo, hi]) => [n, list.filter((g) => g.dias >= lo && g.dias <= hi).length]));
    const nota = sinFecha ? ' Hay ' + sinFecha + (sinFecha === 1 ? ' crédito con saldo y sin fecha de vencimiento: no se cuenta.' : ' créditos con saldo y sin fecha de vencimiento: no se cuentan.') : '';
    const corte = truncado ? ' La lista de créditos o clientes es muy larga y se cortó: puede faltar alguno.' : '';
    // «total» = número de filas (la tabla muestra «Mostrando N de total»); los soles van en total_soles.
    return { ...base, columnas: ['Cliente', 'Código', 'Vencido S/', 'Días de atraso', 'Recordatorio (borrador)'], total: list.length, total_soles: total, clientes: list.length, truncado,
      // Pantalla del Admin: nombre y borrador del recordatorio (él lo copia y lo envía). Nada se envía solo.
      filas: list.slice(0, N).map((g) => [g.cust?.nombre || 'Cliente ' + g.id, g.id, g.soles, g.dias, reminderDraft(g.cust?.nombre, g.soles, g.desde)]),
      texto: (list.length ? (list.length === 1 ? '1 cliente tiene' : list.length + ' clientes tienen') + ' créditos atrasados por S/ ' + total.toFixed(2) + '. El más atrasado lleva ' + list[0].dias + (list[0].dias === 1 ? ' día' : ' días') + '. En la tabla está el borrador de cada recordatorio para que usted lo envíe.' : 'Ningún cliente tiene créditos atrasados.') + nota + corte,
      // Al modelo: solo totales, rangos y el código del cliente (nunca nombre, DNI ni teléfono).
      resumen: { clientes_atrasados: list.length, total_vencido_soles: total, sin_fecha: sinFecha, por_rango: rangos, truncado,
        // Sin la ficha del cliente (lista cortada) no se puede descartar que el id sea su DNI o teléfono: «Cliente N».
        mas_atrasados: list.slice(0, M).map((g, i) => ({ cliente: g.cust && !clientesCortados && safeClientCode(g.id, g.cust) ? 'cliente #' + g.id : 'Cliente ' + (i + 1), soles: g.soles, dias: g.dias })) } };
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
