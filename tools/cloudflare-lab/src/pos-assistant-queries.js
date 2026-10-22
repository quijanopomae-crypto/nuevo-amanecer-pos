// Consultas del asistente (SOLO LECTURA). El Worker lee su base y arma un resumen chico:
// - a la pantalla del dueño va una tabla con números (top N filas);
// - a DeepSeek va un resumen aún más chico y SIN datos personales (clientes como «Cliente 1», sin DNI ni teléfono).
// Nunca se manda el inventario completo al modelo. Nada aquí escribe en la base.
import { canonicalRead } from './a6-canonical.js';

// Frases seguidas con un solo punto al final de cada una (Bot 4: nada de «unid..»).
const sentences = (arr) => arr.map((x) => (/[.!?]$/.test(x) ? x : x + '.')).join(' ');
export const QUERY_TYPES = Object.freeze(['stock_producto', 'bajo_stock', 'sin_costo', 'ventas_periodo', 'top_productos', 'deudas_clientes', 'compras_recientes', 'resumen_dia', 'resumen_mes',
  'ganancia', 'productos_sin_ventas', 'deuda_cliente', 'ventas_por_hora']);
// Ganancia: usa costos. Solo quien ve costos (purchases.costs.view = hoy solo el Admin); el permiso se revisa en pos-assistant.js.
export const COST_QUERY_TYPES = Object.freeze(['ganancia']);
// Resúmenes del día y del mes: SOLO el Admin (el empleado recibe 403 summary_admin_only en el chat).
export const SUMMARY_TYPES = Object.freeze(['resumen_dia', 'resumen_mes']);
export const PRODUCT_ID_CHUNK = 50; // ids por consulta IN (...): muy por debajo del tope de 100 parámetros de D1
export const QUERY_LIMITS = Object.freeze({ topRows: 10, modelRows: 8, maxPages: 20, pageSize: 250, maxDays: 92 });
const TITLES = { stock_producto: 'Stock del producto', bajo_stock: 'Productos por reponer', sin_costo: 'Productos sin costo', ventas_periodo: 'Ventas del período',
  top_productos: 'Productos más vendidos', deudas_clientes: 'Deudas de clientes', compras_recientes: 'Compras recientes',
  resumen_dia: 'Resumen del día', resumen_mes: 'Resumen del mes', ganancia: 'Ganancia', productos_sin_ventas: 'Productos sin ventas',
  deuda_cliente: 'Deuda del cliente', ventas_por_hora: 'Ventas por hora' };
// Topes de las consultas nuevas: filas que vuelven de SQL (agrupadas) y filas de la tabla «sin ventas».
export const NEW_QUERY_LIMITS = Object.freeze({ sqlRows: 5000, idleRows: 50, idleDays: 30 });

const cents = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)) / 100);
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
// ---------- Hora de Lima (America/Lima = UTC-5 todo el año; Perú no tiene horario de verano) ----------
// ÚNICO lugar con la cuenta: el resto del asistente (consultas, resúmenes, prompt, modo demostración, límites de uso) usa estas funciones.
export const LIMA_OFFSET_MS = 5 * 3600 * 1000;
export function limaToday(nowMs = Date.now()) { return new Date(nowMs - LIMA_OFFSET_MS).toISOString().slice(0, 10); }
export function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Día de Lima D = [D 05:00Z, D+1 05:00Z). fromIso/toIso: los límites que se comparan con created_at (ISO en UTC) o se enlazan en SQL.
export function limaBounds(desde, hasta) { return { desde, hasta, fromIso: desde + 'T05:00:00.000Z', toIso: addDays(hasta, 1) + 'T05:00:00.000Z' }; }
// Palabras de fecha que el servidor convierte en días de Lima (el modelo NO calcula fechas: manda la palabra en «periodo»).
// antier = hoy − 2; mismo_dia_semana_pasada = el MISMO día de la semana, 7 días atrás (jueves 22 -> jueves 15; no el lunes de esa semana).
export const DATE_WORDS = Object.freeze(['hoy', 'ayer', 'antier', 'mismo_dia_semana_pasada', 'esta_semana', 'semana_pasada', 'este_mes', 'mes_pasado']);
const WORD_ALIASES = { hoy: 'hoy', oy: 'hoy', ayer: 'ayer', 'esta semana': 'esta_semana', semana: 'esta_semana', 'la semana': 'esta_semana', 'semana actual': 'esta_semana',
  'semana pasada': 'semana_pasada', 'la semana pasada': 'semana_pasada', 'este mes': 'este_mes', mes: 'este_mes', 'el mes': 'este_mes', 'mes actual': 'este_mes',
  'mes pasado': 'mes_pasado', 'el mes pasado': 'mes_pasado',
  antier: 'antier', anteayer: 'antier', 'ante ayer': 'antier', 'antes de ayer': 'antier', 'antes ayer': 'antier', 'antesdeayer': 'antier', 'era antier': 'antier', 'era anteayer': 'antier',
  'mismo dia semana pasada': 'mismo_dia_semana_pasada', 'mismo dia de la semana pasada': 'mismo_dia_semana_pasada', 'el mismo dia de la semana pasada': 'mismo_dia_semana_pasada',
  'mismo dia de la otra semana': 'mismo_dia_semana_pasada', 'el mismo dia de la otra semana': 'mismo_dia_semana_pasada', 'hoy hace una semana': 'mismo_dia_semana_pasada',
  'hace una semana': 'mismo_dia_semana_pasada', 'hace 7 dias': 'mismo_dia_semana_pasada', 'hace siete dias': 'mismo_dia_semana_pasada' };
export function dateWord(v) { const k = norm(v).replace(/[_\s]+/g, ' ').replace(/[¿?¡!.,]/g, '').trim(); return WORD_ALIASES[k] || null; }
// Lunes = inicio de la semana (Lima). 0 = lunes … 6 = domingo.
const weekdayIdx = (d) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;
// { desde, hasta } en fechas de Lima para una palabra de fecha, o null si no es una. «esta semana» = lunes a hoy; «este mes» = día 1 a hoy.
export function dateWordRange(word, nowMs = Date.now()) {
  const w = DATE_WORDS.includes(word) ? word : dateWord(word); if (!w) return null;
  const today = limaToday(nowMs), mon = addDays(today, -weekdayIdx(today));
  if (w === 'hoy') return { desde: today, hasta: today };
  if (w === 'ayer') { const y = addDays(today, -1); return { desde: y, hasta: y }; }
  if (w === 'antier') { const y = addDays(today, -2); return { desde: y, hasta: y }; }
  if (w === 'mismo_dia_semana_pasada') { const y = addDays(today, -7); return { desde: y, hasta: y }; }
  if (w === 'esta_semana') return { desde: mon, hasta: today };
  if (w === 'semana_pasada') return { desde: addDays(mon, -7), hasta: addDays(mon, -1) };
  if (w === 'este_mes') return { desde: today.slice(0, 8) + '01', hasta: today };
  const last = addDays(today.slice(0, 8) + '01', -1); return { desde: last.slice(0, 8) + '01', hasta: last }; // mes_pasado
}
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
// Calendario de hoy en Lima para el mensaje del sistema (solo fechas, ningún dato del negocio).
export function limaCalendarLine(nowMs = Date.now()) {
  const r = (w) => dateWordRange(w, nowMs), t = limaToday(nowMs), s = r('esta_semana'), m = r('este_mes');
  const a = r('antier').desde, md = r('mismo_dia_semana_pasada').desde;
  return 'Hoy (Lima) es ' + DIAS[weekdayIdx(t)] + ' ' + t + '; ayer fue ' + r('ayer').desde + '; antier (anteayer) fue ' + DIAS[weekdayIdx(a)] + ' ' + a
    + '; el mismo día de la semana pasada («el mismo día de la otra semana») fue ' + DIAS[weekdayIdx(md)] + ' ' + md
    + '; esta semana (de lunes a hoy) va de ' + s.desde + ' a ' + s.hasta + '; este mes va de ' + m.desde + ' a ' + m.hasta + '.'
    + ' Para esas palabras (y semana o mes pasado) usa periodo en consultar (el sistema calcula las fechas); un día exacto: fecha AAAA-MM-DD.'
    + ' Si corrigen la fecha («era antier»), llama consultar de nuevo con el periodo NUEVO; no repitas el de antes.';
}
// Fecha de un campo: AAAA-MM-DD tal cual, o una palabra de fecha (lado: 'desde' o 'hasta' de su rango). Si no, null.
function dateArg(v, side, nowMs) { if (DATE.test(v || '')) return v; const r = dateWordRange(v, nowMs); return r ? r[side] : null; }
// Período en fechas de Lima. Por defecto: hoy. «periodo» (palabra de fecha) manda sobre desde/hasta. Máximo 92 días.
// «fecha» (AAAA-MM-DD): un solo día exacto de Lima; va después de «periodo» y antes de desde/hasta.
export function period(args, nowMs) {
  const today = limaToday(nowMs), f = DATE.test(args?.fecha || '') ? { desde: args.fecha, hasta: args.fecha } : null, w = dateWordRange(args?.periodo, nowMs) || f;
  let hasta = w ? w.hasta : dateArg(args?.hasta, 'hasta', nowMs) || today, desde = w ? w.desde : dateArg(args?.desde, 'desde', nowMs) || (dateWordRange(args?.hasta, nowMs)?.desde ?? hasta);
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  if (Date.parse(hasta) - Date.parse(desde) > QUERY_LIMITS.maxDays * 86400000) desde = addDays(hasta, -QUERY_LIMITS.maxDays);
  return limaBounds(desde, hasta);
}

// ---------- Resúmenes del día y del mes (helpers) ----------
export const limaDay = (iso) => new Date(Date.parse(iso) - LIMA_OFFSET_MS).toISOString().slice(0, 10);
// Fecha de Lima de un registro para mostrar: con hora (cualquier zona que Date.parse entienda) -> día de Lima; solo fecha -> tal cual.
export function limaDateOf(v) { const t = String(v || ''); if (/T\d{2}:/.test(t) && Number.isFinite(Date.parse(t))) return limaDay(t); return DATE.test(t.slice(0, 10)) ? t.slice(0, 10) : ''; }
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
    const by = new Map(); for (const it of items) { if (!ids.has(it.sale_id)) continue; const x = by.get(it.product_id) || { product_id: it.product_id, q: 0, c: 0 }; x.q += it.quantity; x.c += it.line_total_cents; by.set(it.product_id, x); }
    r.items = [...by.values()];
    if (pays) { const ps = pays.filter((x) => x.dia && x.dia >= p.desde && x.dia <= p.hasta); r.pagos_n = ps.filter((x) => x.c > 0).length; r.pagos_c = ps.reduce((a, x) => a + x.c, 0); }
    return r;
  });
}
const pad2 = (n) => String(n).padStart(2, '0');
function monthEnd(ym) { const [y, m] = ym.split('-').map(Number); return ym + '-' + pad2(new Date(Date.UTC(y, m, 0)).getUTCDate()); }
function prevMonth(ym) { const [y, m] = ym.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + pad2(m - 1); }
const mkPeriod = limaBounds;
// Períodos del resumen (hora de Lima). Día: el pedido (por defecto hoy) contra el día anterior.
// Mes: el mes del día pedido; si es el mes en curso va hasta hoy y se compara con los MISMOS días del mes anterior (1 al N).
export function summaryPeriods(tipo, args, nowMs) {
  // «periodo» (o una palabra en hasta/desde): el día de referencia es el ÚLTIMO de su rango en Lima («ayer», «mes_pasado» -> su último día).
  const today = limaToday(nowMs), w = dateWordRange(args?.periodo, nowMs) || (DATE.test(args?.fecha || '') ? { desde: args.fecha, hasta: args.fecha } : null)
    || dateWordRange(args?.hasta, nowMs) || dateWordRange(args?.desde, nowMs);
  const raw = String(args?.hasta || args?.desde || '');
  let ref = w ? w.hasta : DATE.test(raw) ? raw : /^\d{4}-\d{2}$/.test(raw) ? raw + '-01' : today;
  if (ref > today) ref = today;
  if (tipo === 'resumen_dia') return { actual: mkPeriod(ref, ref), anterior: mkPeriod(addDays(ref, -1), addDays(ref, -1)), en_curso: ref === today };
  const ym = ref.slice(0, 7), end = monthEnd(ym), enCurso = today.slice(0, 7) === ym, hasta = enCurso ? today : end;
  const pym = prevMonth(ym), pEnd = monthEnd(pym), day = Number(hasta.slice(8, 10)), pHasta = enCurso ? (pym + '-' + pad2(Math.min(day, Number(pEnd.slice(8, 10))))) : pEnd;
  return { actual: mkPeriod(ym + '-01', hasta), anterior: mkPeriod(pym + '-01', pHasta), en_curso: enCurso };
}
// Productos ante el modelo: SOLO «producto #código» (un nombre puede llevar el de un cliente, p. ej. «Encargo Sra. …»). El nombre se pone
// únicamente en la tabla de la pantalla del Admin (mismo criterio que «Ventas bajo costo», PR #930). Código raro: sin código.
const CODE_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
export const productRef = (id) => 'producto #' + (CODE_RE.test(String(id)) ? String(id) : 'sin-código');
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
  // Ventas: la MISMA lectura canónica que usa la réplica del POS (/read/canonical/sales y sale-items) y la MISMA lista de
  // anulaciones que GET /auth/sale-annulments (pos-sale-annul.js). El asistente solo filtra por fecha y suma.
  async function annulled() {
    try { const rows = (await db.prepare('SELECT sale_id,operation_id,reason,status,cash_cents,digital_cents,created_at,completed_at FROM pos_sale_annulments ORDER BY created_at DESC LIMIT 2000').all()).results || [];
      return new Set(rows.filter((r) => r.status === 'anulada').map((r) => String(r.sale_id))); }
    catch (e) { if (/no such table/i.test(String(e?.message || e))) return new Set(); throw e; }
  }
  // Consultas nuevas (ganancia, sin ventas, por hora): la fecha se filtra EN SQL (created_at dentro de [fromIso, toIso) del período de
  // Lima) y la base devuelve filas YA agrupadas, con LIMIT. Misma autoridad que la lectura canónica de ventas: en ACTIVE solo las ventas
  // de la promoción activa (canonical_sale_context); antes de ACTIVE, la tabla sales tal cual (como canonicalRead). Anuladas fuera con la
  // misma tabla que GET /auth/sale-annulments (si aún no existe, no hay anuladas). Solo SELECT.
  async function salesSql(p, build, limit) {
    const ctl = await db.prepare('SELECT mode,active_promotion_id FROM canonical_control WHERE id=1').first();
    if (!ctl || !['CANONICAL_READ_ONLY', 'ACTIVE'].includes(ctl.mode) || !ctl.active_promotion_id) throw new Error('canonical_not_published');
    const active = ctl.mode === 'ACTIVE';
    const from = active ? 'canonical_sale_context x JOIN sales r ON r.sale_id=x.sale_id' : 'sales r';
    const scope = (active ? 'x.promotion_id=?1' : '?1 IS NOT NULL') + ' AND r.created_at>=?2 AND r.created_at<?3';
    const NOT_ANNULLED = " AND NOT EXISTS(SELECT 1 FROM pos_sale_annulments a WHERE a.sale_id=r.sale_id AND a.status='anulada')";
    const run = async (ann) => (await db.prepare(build(from, scope + ann) + ' LIMIT ?4').bind(ctl.active_promotion_id, p.fromIso, p.toIso, limit).all()).results || [];
    try { return await run(NOT_ANNULLED); }
    catch (e) { if (!/no such table: pos_sale_annulments/i.test(String(e?.message || e))) throw e; return run(''); }
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
    async credits() { const rows = await all('credits'); return rows.map((c) => ({ cliente: String(c.customer_id), saldo: cents(c.current_balance_cents) || 0, vence: c.due_date || c.due_value || null,
      fecha: limaDateOf(c.issued_value || c.created_at) || null })); },
    // Ventas por producto del período (agrupado en SQL): { product_id, q, c }. Tope NEW_QUERY_LIMITS.sqlRows (truncated si llega).
    async itemsByProduct(p) {
      const lim = NEW_QUERY_LIMITS.sqlRows;
      const rows = await salesSql(p, (from, where) => `SELECT i.product_id AS product_id,SUM(i.quantity) AS q,SUM(i.line_total_cents) AS c FROM ${from} JOIN sale_items i ON i.sale_id=r.sale_id WHERE ${where} GROUP BY i.product_id ORDER BY c DESC`, lim);
      const list = rows.map((x) => ({ product_id: String(x.product_id), q: Number(x.q) || 0, c: Number(x.c) || 0 })); list.truncated = rows.length >= lim; return list;
    },
    // Ventas por hora de Lima (agrupado en SQL, como mucho 24 filas + «sin hora»): { h, n, c }.
    async salesByHour(p) {
      const rows = await salesSql(p, (from, where) => `SELECT CAST(strftime('%H',r.created_at,'-5 hours') AS INTEGER) AS h,COUNT(*) AS n,SUM(r.total_cents) AS c FROM ${from} WHERE ${where} GROUP BY h ORDER BY h`, 25);
      return rows.map((x) => ({ h: x.h == null ? null : Number(x.h), n: Number(x.n) || 0, c: Number(x.c) || 0 }));
    },
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
  const inRange = (s, p) => s.created_at >= p.fromIso && s.created_at < p.toIso && !s.anulada;
  const dia = (iso) => new Date(Date.parse(iso) - 5 * 3600 * 1000).toISOString().slice(0, 10);
  return {
    async products() { return (data.products || []).map((p) => ({ ...p })); },
    async productsById(ids) { const want = new Set((ids || []).map(String)), out = new Map(); for (const p of (data.products || [])) if (want.has(String(p.id))) out.set(String(p.id), { ...p }); return out; },
    async credits() { return (data.credits || []).map((c) => ({ ...c })); },
    async itemsByProduct(p) { const ids = new Set((data.sales || []).filter((x) => inRange(x, p)).map((s) => s.sale_id)), m = new Map();
      for (const it of (data.saleItems || []).filter((x) => ids.has(x.sale_id))) { const k = String(it.product_id), r = m.get(k) || { product_id: k, q: 0, c: 0 }; r.q += Number(it.quantity) || 0; r.c += Number(it.line_total_cents) || 0; m.set(k, r); }
      return [...m.values()].sort((a, b) => b.c - a.c); },
    async salesByHour(p) { const m = new Map();
      for (const s of (data.sales || []).filter((x) => inRange(x, p))) { const h = new Date(Date.parse(s.created_at) - LIMA_OFFSET_MS).getUTCHours(), r = m.get(h) || { h, n: 0, c: 0 }; r.n++; r.c += Number(s.total_cents) || 0; m.set(h, r); }
      return [...m.values()].sort((a, b) => a.h - b.h); },
    async customers() { return (data.customers || []).map((c) => ({ ...c })); },
    async salesTotals(p) { const m = new Map(); for (const s of (data.sales || []).filter((x) => inRange(x, p))) { const k = dia(s.created_at) + '|' + s.metodo; const r = m.get(k) || { dia: dia(s.created_at), metodo: s.metodo, n: 0, c: 0 }; r.n++; r.c += s.total_cents; m.set(k, r); } return [...m.values()].sort((a, b) => a.dia.localeCompare(b.dia)); },
    async topItems(p, n) { const ids = new Set((data.sales || []).filter((x) => inRange(x, p)).map((s) => s.sale_id)); const m = new Map();
      for (const it of (data.saleItems || []).filter((x) => ids.has(x.sale_id))) { const r = m.get(it.product_id) || { product_id: it.product_id, q: 0, c: 0 }; r.q += it.quantity; r.c += it.line_total_cents; m.set(it.product_id, r); }
      return [...m.values()].sort((a, b) => b.c - a.c).slice(0, n); },
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
  if (SUMMARY_TYPES.includes(tipo)) return summaryQuery(reader, tipo, args, nowMs, base);
  if (tipo === 'ganancia') return profitQuery(reader, args, nowMs, base);
  if (tipo === 'productos_sin_ventas') return idleProductsQuery(reader, args, nowMs, base);
  if (tipo === 'deuda_cliente') return customerDebtQuery(reader, args, base);
  if (tipo === 'ventas_por_hora') return hourlySalesQuery(reader, args, nowMs, base);
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
  // Fecha de la compra en día de Lima (una compra de las 23:30 en Lima ya es el día siguiente en UTC).
  const filas = rows.map((r) => [limaDateOf(r.created_at), r.supplier || '-', r.document_ref || '-', cents(r.total_cost_cents), r.line_count]);
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
  const nm = (x) => names.get(String(x.product_id)) || 'Producto ' + x.product_id;
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
    refIds: [...new Set([...byAmount.slice(0, 5), ...byQty.slice(0, 5)].map((x) => String(x.product_id)))] };
}

// ---------- Consultas nuevas: ganancia, productos sin ventas, deuda de un cliente, ventas por hora ----------
// Mismo criterio que los resúmenes: los productos ante el modelo y en el texto SOLO como «producto #código» (el nombre solo en la tabla del
// Admin) y los clientes SOLO como «cliente #código». Nada aquí escribe en la base.
const rangeLabel = (p) => (p.desde === p.hasta ? p.desde : p.desde + ' a ' + p.hasta);
const soles = (c) => cents(c) ?? 0;
const money = (c) => 'S/ ' + soles(c).toFixed(2);

// Ganancia = ventas − costo de lo vendido (período de Lima; por defecto hoy). Costo = costo ACTUAL del producto × unidades (las líneas de
// venta no guardan el costo de ese día). Lo vendido de productos sin costo (o líneas genéricas sin producto) NO entra en la ganancia: se
// informa aparte para no inventar un costo. Solo quien ve costos (se revisa en pos-assistant.js antes de llegar aquí).
async function profitQuery(reader, args, nowMs, base) {
  const p = period(args, nowMs), rango = rangeLabel(p);
  const [items, list] = await Promise.all([reader.itemsByProduct(p), reader.products()]);
  const byId = new Map(list.map((x) => [String(x.id), x]));
  let ventas = 0, conCosto = 0, costo = 0, sinCosto = 0; const sinCostoIds = [], rows = [];
  for (const it of items) {
    const pr = byId.get(String(it.product_id)), c = Number(it.c) || 0, q = Number(it.q) || 0; ventas += c;
    const uc = pr && Number(pr.costo) > 0 ? Math.round(Number(pr.costo) * 100) : null;
    if (uc == null) { sinCosto += c; sinCostoIds.push(String(it.product_id)); continue; }
    const k = Math.round(uc * q); costo += k; conCosto += c; rows.push({ product_id: String(it.product_id), q, c, k, g: c - k });
  }
  const ganancia = conCosto - costo, margen = conCosto > 0 ? Math.round((ganancia / conCosto) * 1000) / 10 : null, truncado = !!items.truncated;
  const top = rows.slice().sort((a, b) => b.g - a.g).slice(0, 5), bajo = rows.filter((x) => x.g < 0).sort((a, b) => a.g - b.g).slice(0, 3);
  const nm = (id) => (byId.get(id)?.nombre || 'Producto') + ' (' + productRef(id) + ')';
  const filas = [
    ...(truncado ? [['Aviso: hay más productos vendidos de los que el asistente suma de una vez; revise Reportes.', '']] : []),
    ['Ventas S/', soles(ventas)],
    ['Costo de lo vendido S/ (costo actual)', soles(costo)],
    ['Ganancia S/', soles(ganancia)],
    ['Margen %', margen == null ? '—' : margen],
    ...(sinCosto ? [['Ventas sin costo registrado S/ (' + sinCostoIds.length + (sinCostoIds.length === 1 ? ' producto' : ' productos') + '; no entran en la ganancia)', soles(sinCosto)]] : []),
    ...top.map((x, i) => ['Top ' + (i + 1) + ' ganancia: ' + nm(x.product_id) + ', ' + r2(x.q) + ' unid.', soles(x.g)]),
    ...bajo.map((x) => ['Vendido bajo costo: ' + nm(x.product_id), soles(x.g)])
  ];
  const texto = ventas
    ? sentences(['Ganancia ' + rango + ': ' + money(ganancia) + ' (ventas ' + money(conCosto) + ' menos costo ' + money(costo) + (margen == null ? '' : ', margen ' + margen + ' %') + ')',
      ...(sinCosto ? [money(sinCosto) + ' vendidos de productos sin costo no se cuentan; complete sus costos'] : []),
      ...(top.length ? ['Lo que más ganancia dejó: ' + productRef(top[0].product_id) + ' (' + money(top[0].g) + ')'] : [])])
    : 'No hay ventas registradas ' + rango + '.';
  return { ...base, titulo: 'Ganancia ' + rango, columnas: ['Detalle', 'S/'], filas, desde: p.desde, hasta: p.hasta, texto,
    resumen: { desde: p.desde, hasta: p.hasta, truncado, base_costo: 'costo actual del producto', ventas_soles: soles(ventas), ventas_con_costo_soles: soles(conCosto),
      costo_soles: soles(costo), ganancia_soles: soles(ganancia), margen_pct: margen, ventas_sin_costo_soles: soles(sinCosto), productos_sin_costo: sinCostoIds.length,
      top_ganancia: top.map((x) => ({ producto: productRef(x.product_id), unidades: r2(x.q), ganancia_soles: soles(x.g) })),
      bajo_costo: bajo.map((x) => ({ producto: productRef(x.product_id), ganancia_soles: soles(x.g) })) },
    refIds: [...new Set([...top, ...bajo].map((x) => x.product_id))] };
}

// Productos del catálogo actual (promoción activa + creados en vivo) sin ninguna venta en el período (por defecto los últimos 30 días de Lima,
// hoy incluido). Los de más stock primero (más plata parada). Tabla: hasta 50 con su stock.
async function idleProductsQuery(reader, args, nowMs, base) {
  const today = limaToday(nowMs), dflt = !(args?.periodo || args?.fecha || args?.desde || args?.hasta);
  const p = dflt ? limaBounds(addDays(today, -(NEW_QUERY_LIMITS.idleDays - 1)), today) : period(args, nowMs), rango = rangeLabel(p);
  const [items, list] = await Promise.all([reader.itemsByProduct(p), reader.products()]);
  const sold = new Set(items.map((x) => String(x.product_id)));
  const stockOf = (x) => (x.controla && Number.isFinite(Number(x.stock)) ? Number(x.stock) : null);
  const idle = list.filter((x) => x.id != null && !sold.has(String(x.id))).sort((a, b) => (stockOf(b) ?? -1) - (stockOf(a) ?? -1) || String(a.id).localeCompare(String(b.id)));
  const truncado = !!(items.truncated || list.truncated), M = QUERY_LIMITS.modelRows, first = idle.slice(0, M);
  const filas = [...(truncado ? [['Aviso: lista larga; pueden faltar o sobrar productos. Revise Reportes.', '']] : []),
    ...idle.slice(0, NEW_QUERY_LIMITS.idleRows).map((x) => [(x.nombre || 'Producto') + ' (' + productRef(x.id) + ')', stockOf(x) == null ? 'sin control' : r2(stockOf(x))])];
  const texto = idle.length
    ? sentences([(idle.length === 1 ? '1 producto no tuvo ventas ' : idle.length + ' productos no tuvieron ventas ') + rango + ' (de ' + list.length + ' revisados)',
      'Con más stock: ' + idle.slice(0, 3).map((x) => productRef(x.id) + (stockOf(x) == null ? '' : ' (' + r2(stockOf(x)) + ')')).join(', ')])
    : 'Todos los productos tuvieron ventas ' + rango + '.';
  return { ...base, titulo: 'Sin ventas ' + rango, columnas: ['Producto', 'Stock'], filas, total: idle.length, desde: p.desde, hasta: p.hasta, texto,
    resumen: { desde: p.desde, hasta: p.hasta, sin_ventas: idle.length, revisados: list.length, truncado,
      primeros: first.map((x) => ({ producto: productRef(x.id), stock: stockOf(x) == null ? null : r2(stockOf(x)) })) },
    refIds: idle.slice(0, Math.max(M, 3)).map((x) => String(x.id)) };
}

// Deuda de UN cliente por su código («cliente #código»). Al modelo y a la tabla: solo el código, el saldo total, cuántos créditos abiertos
// y la fecha del más antiguo. Nunca nombre, DNI ni teléfono (el aparato del Admin pone el nombre de SU lista con el código).
async function customerDebtQuery(reader, args, base) {
  const { customerCode } = await import('./pos-assistant.js');
  const code = customerCode(args?.cliente_id) ?? customerCode(args?.cliente);
  if (!code) return { ...base, columnas: [], filas: [], texto: 'Dime el código del cliente (aparece como «cliente #código» en Clientes).', resumen: { falta: 'cliente_id' } };
  const ref = 'cliente #' + code, credits = await reader.credits();
  let mine = credits.filter((c) => String(c.cliente) === code);
  if (!mine.length) mine = credits.filter((c) => String(c.cliente).toLowerCase() === code.toLowerCase());
  const open = mine.filter((c) => Number(c.saldo) > 0).sort((a, b) => String(a.fecha || '9999').localeCompare(String(b.fecha || '9999')));
  const total = r2(open.reduce((s, c) => s + Number(c.saldo), 0)), oldest = open.find((c) => c.fecha)?.fecha || null;
  let known = mine.length > 0;
  if (!known && typeof reader.customers === 'function') { const cs = await reader.customers(); known = cs.some((c) => String(c.id) === code || String(c.id).toLowerCase() === code.toLowerCase()); }
  const texto = open.length
    ? ref + ' debe S/ ' + total.toFixed(2) + ' en ' + open.length + (open.length === 1 ? ' crédito abierto' : ' créditos abiertos') + (oldest ? '; el más antiguo es del ' + oldest : '') + '.'
    : known ? ref + ' no tiene deudas pendientes.' : 'No encontré deudas de ' + ref + '. Revise el código en Clientes.';
  return { ...base, titulo: 'Deuda de ' + ref, columnas: ['Fecha', 'Vence', 'Saldo S/'], filas: open.slice(0, QUERY_LIMITS.topRows).map((c) => [c.fecha || 'sin fecha', c.vence || '-', r2(c.saldo)]),
    ...(open.length > QUERY_LIMITS.topRows ? { total: open.length } : {}), texto,
    resumen: { cliente: ref, saldo_soles: total, creditos_abiertos: open.length, mas_antiguo: oldest } };
}

// Ventas por hora de Lima (período por defecto hoy): número y total por hora. Sin clientes ni productos.
async function hourlySalesQuery(reader, args, nowMs, base) {
  const p = period(args, nowMs), rango = rangeLabel(p), rows = (await reader.salesByHour(p)).filter((x) => x.n > 0);
  const hh = (h) => (h == null ? 'sin hora' : String(h).padStart(2, '0') + ':00');
  const slot = (h) => (h == null ? 'Sin hora' : hh(h) + '–' + String(h).padStart(2, '0') + ':59');
  const n = rows.reduce((s, x) => s + x.n, 0), c = rows.reduce((s, x) => s + x.c, 0);
  const best = rows.filter((x) => x.h != null).sort((a, b) => b.c - a.c || b.n - a.n)[0], most = rows.filter((x) => x.h != null).sort((a, b) => b.n - a.n || b.c - a.c)[0];
  const texto = n
    ? sentences(['Ventas por hora ' + rango + ': ' + n + (n === 1 ? ' venta' : ' ventas') + ', ' + money(c),
      ...(best ? ['Donde más vende es de ' + slot(best.h) + ' (' + money(best.c) + ' en ' + best.n + (best.n === 1 ? ' venta' : ' ventas') + ')'] : []),
      ...(most && best && most.h !== best.h ? ['Con más ventas: ' + slot(most.h) + ' (' + most.n + ')'] : [])])
    : 'No hay ventas registradas ' + rango + '.';
  return { ...base, titulo: 'Ventas por hora ' + rango, columnas: ['Hora (Lima)', 'Ventas', 'S/'], filas: rows.map((x) => [slot(x.h), x.n, soles(x.c)]), desde: p.desde, hasta: p.hasta, texto,
    resumen: { desde: p.desde, hasta: p.hasta, ventas: n, total_soles: soles(c), mejor_hora: best ? { hora: hh(best.h), ventas: best.n, soles: soles(best.c) } : null,
      por_hora: rows.map((x) => ({ hora: hh(x.h), ventas: x.n, soles: soles(x.c) })) } };
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
