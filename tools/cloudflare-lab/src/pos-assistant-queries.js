// Consultas del asistente (SOLO LECTURA). El Worker lee su base y arma un resumen chico:
// - a la pantalla del dueño va una tabla con números (top N filas);
// - a DeepSeek va un resumen aún más chico y SIN datos personales (clientes como «Cliente 1», sin DNI ni teléfono).
// Nunca se manda el inventario completo al modelo. Nada aquí escribe en la base.
import { canonicalRead } from './a6-canonical.js';

// Frases seguidas con un solo punto al final de cada una (Bot 4: nada de «unid..»).
const sentences = (arr) => arr.map((x) => (/[.!?]$/.test(x) ? x : x + '.')).join(' ');
export const QUERY_TYPES = Object.freeze(['stock_producto', 'bajo_stock', 'sin_costo', 'ventas_periodo', 'top_productos', 'deudas_clientes', 'creditos_atrasados', 'compras_recientes', 'sugerencias_compra', 'resumen_dia', 'resumen_mes', 'caja_abierta']);
// Resúmenes del día y del mes: SOLO el Admin (el empleado recibe 403 summary_admin_only en el chat).
export const SUMMARY_TYPES = Object.freeze(['resumen_dia', 'resumen_mes']);
export const PRODUCT_ID_CHUNK = 50; // ids por consulta IN (...): muy por debajo del tope de 100 parámetros de D1
export const QUERY_LIMITS = Object.freeze({ topRows: 10, modelRows: 8, maxPages: 20, pageSize: 250, maxDays: 92 });
const TITLES = { stock_producto: 'Stock del producto', bajo_stock: 'Productos por reponer', sin_costo: 'Productos sin costo', ventas_periodo: 'Ventas del período',
  top_productos: 'Productos más vendidos', deudas_clientes: 'Deudas de clientes', creditos_atrasados: 'Créditos atrasados', compras_recientes: 'Compras recientes',
  sugerencias_compra: 'Sugerencias de compra',
  resumen_dia: 'Resumen del día', resumen_mes: 'Resumen del mes', caja_abierta: 'Caja abierta' };
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
// Precio vacío (null, '' o ausente) queda en null: Number(null) daría 0 y contaría como una venta a S/ 0.
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
// Mismas palabras que Inventario en la app: stock < 0 → «Faltan N» (N sin signo), 0 → «Sin stock». Nunca el número con signo menos.
export function stockLabel(stock) { const n = r2(stock); return n < 0 ? 'Faltan ' + r2(Math.abs(n)) : n === 0 ? 'Sin stock' : n + ' unid.'; }
// Al modelo: el número se queda y, si es 0 o menos, va también «estado» con la frase que muestra la app.
const stockForModel = (p) => { const o = { nombre: p.nombre, stock: r2(p.stock), minimo: r2(p.min) }; if (o.stock <= 0) o.estado = stockLabel(o.stock); return o; };
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
// ---------- Hora de Lima (America/Lima = UTC-5 todo el año; Perú no tiene horario de verano) ----------
// ÚNICO lugar con la cuenta: el resto del asistente (consultas, resúmenes, prompt, modo demostración, límites de uso) usa estas funciones.
export const LIMA_OFFSET_MS = 5 * 3600 * 1000;
export function limaToday(nowMs = Date.now()) { return new Date(nowMs - LIMA_OFFSET_MS).toISOString().slice(0, 10); }
export function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const normName = (s) => norm(s).replace(/\s+/g, ' ').trim();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Entero o prefijo seguido de algo que no es letra ni número; la «s» final es opcional (RECARGA / RECARGAS).
const GENERIC_RE = (names) => new RegExp('^(?:' + names.map((n) => escRe(normName(n)).replace(/s$/, 's?')).join('|') + ')(?![a-z0-9])');
export function isServiceProduct(p) { return SERVICE_CATEGORIES.includes(normName(p?.categoria)); }
const DEFAULT_GENERIC_RE = GENERIC_RE(GENERIC_PRODUCT_NAMES);
export function isGenericProduct(p, names = GENERIC_PRODUCT_NAMES) { return isServiceProduct(p) || (names.length > 0 && (names === GENERIC_PRODUCT_NAMES ? DEFAULT_GENERIC_RE : GENERIC_RE(names)).test(normName(p?.nombre))); }
// Día de Lima D = [D 05:00Z, D+1 05:00Z). fromIso/toIso: los límites que se comparan con created_at (ISO en UTC) o se enlazan en SQL.
export function limaBounds(desde, hasta) { return { desde, hasta, fromIso: desde + 'T05:00:00.000Z', toIso: addDays(hasta, 1) + 'T05:00:00.000Z' }; }
// Palabras de fecha que el servidor convierte en días de Lima (el modelo NO calcula fechas: manda la palabra en «periodo»).
export const DATE_WORDS = Object.freeze(['hoy', 'ayer', 'esta_semana', 'semana_pasada', 'este_mes', 'mes_pasado']);
const WORD_ALIASES = { hoy: 'hoy', oy: 'hoy', ayer: 'ayer', 'esta semana': 'esta_semana', semana: 'esta_semana', 'la semana': 'esta_semana', 'semana actual': 'esta_semana',
  'semana pasada': 'semana_pasada', 'la semana pasada': 'semana_pasada', 'este mes': 'este_mes', mes: 'este_mes', 'el mes': 'este_mes', 'mes actual': 'este_mes',
  'mes pasado': 'mes_pasado', 'el mes pasado': 'mes_pasado' };
export function dateWord(v) { const k = norm(v).replace(/[_\s]+/g, ' ').trim(); return WORD_ALIASES[k] || null; }
// Lunes = inicio de la semana (Lima). 0 = lunes … 6 = domingo.
const weekdayIdx = (d) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;
// { desde, hasta } en fechas de Lima para una palabra de fecha, o null si no es una. «esta semana» = lunes a hoy; «este mes» = día 1 a hoy.
export function dateWordRange(word, nowMs = Date.now()) {
  const w = DATE_WORDS.includes(word) ? word : dateWord(word); if (!w) return null;
  const today = limaToday(nowMs), mon = addDays(today, -weekdayIdx(today));
  if (w === 'hoy') return { desde: today, hasta: today };
  if (w === 'ayer') { const y = addDays(today, -1); return { desde: y, hasta: y }; }
  if (w === 'esta_semana') return { desde: mon, hasta: today };
  if (w === 'semana_pasada') return { desde: addDays(mon, -7), hasta: addDays(mon, -1) };
  if (w === 'este_mes') return { desde: today.slice(0, 8) + '01', hasta: today };
  const last = addDays(today.slice(0, 8) + '01', -1); return { desde: last.slice(0, 8) + '01', hasta: last }; // mes_pasado
}
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
// Calendario de hoy en Lima para el mensaje del sistema (solo fechas, ningún dato del negocio).
export function limaCalendarLine(nowMs = Date.now()) {
  const r = (w) => dateWordRange(w, nowMs), t = limaToday(nowMs), s = r('esta_semana'), m = r('este_mes');
  return 'Hoy (Lima) es ' + DIAS[weekdayIdx(t)] + ' ' + t + '; ayer fue ' + r('ayer').desde + '; esta semana (de lunes a hoy) va de ' + s.desde + ' a ' + s.hasta
    + '; este mes va de ' + m.desde + ' a ' + m.hasta + '. Para hoy, ayer, esta semana, la semana pasada, este mes o el mes pasado usa periodo en consultar (el sistema calcula las fechas).';
}
// Fecha de un campo: AAAA-MM-DD tal cual, o una palabra de fecha (lado: 'desde' o 'hasta' de su rango). Si no, null.
function dateArg(v, side, nowMs) { if (DATE.test(v || '')) return v; const r = dateWordRange(v, nowMs); return r ? r[side] : null; }
// Período en fechas de Lima. Por defecto: hoy. «periodo» (palabra de fecha) manda sobre desde/hasta. Máximo 92 días.
export function period(args, nowMs) {
  const today = limaToday(nowMs), w = dateWordRange(args?.periodo, nowMs);
  let hasta = w ? w.hasta : dateArg(args?.hasta, 'hasta', nowMs) || today, desde = w ? w.desde : dateArg(args?.desde, 'desde', nowMs) || (dateWordRange(args?.hasta, nowMs)?.desde ?? hasta);
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  if (Date.parse(hasta) - Date.parse(desde) > QUERY_LIMITS.maxDays * 86400000) desde = addDays(hasta, -QUERY_LIMITS.maxDays);
  return limaBounds(desde, hasta);
}

// ---------- Resúmenes del día y del mes (helpers) ----------
export const limaDay = (iso) => new Date(Date.parse(iso) - LIMA_OFFSET_MS).toISOString().slice(0, 10);
// Fecha y hora de Lima «AAAA-MM-DD HH:MM» (para mostrar, p. ej. la apertura de caja). Sin hora válida: null.
export const limaDateTime = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t - LIMA_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') : null; };
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
  const today = limaToday(nowMs), w = dateWordRange(args?.periodo, nowMs) || dateWordRange(args?.hasta, nowMs) || dateWordRange(args?.desde, nowMs);
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
    // Unidades vendidas por producto en el período (ventas anuladas fuera), con la misma lectura canónica que topItems.
    // La lectura canónica pagina por sale_id (no por fecha) y tiene tope de páginas: si ventas O líneas se cortan, pueden faltar
    // ventas recientes. No hay filtro por fecha en /read/canonical sin tocar a6-canonical.js, así que se marca truncated y la
    // consulta lo avisa (pantalla, texto y modelo) en vez de callarlo.
    async soldQty(p) {
      const [sales, items] = await Promise.all([salesIn(p), all('sale-items')]), ids = new Set(sales.map((s) => String(s.sale_id))), m = new Map();
      for (const it of items) { if (!ids.has(String(it.sale_id))) continue; const k = String(it.product_id); m.set(k, (m.get(k) || 0) + (Number(it.quantity) || 0)); }
      m.truncated = !!(sales.truncated || items.truncated); return m;
    },
    // Líneas vendidas en el período (sin anuladas), con su precio unitario cobrado. Solo lectura; la usa «Ventas bajo costo».
    async saleLines(p) {
      const [sales, items] = await Promise.all([salesIn(p), all('sale-items')]), ids = new Set(sales.map((s) => String(s.sale_id))), out = [];
      for (const it of items) { if (!ids.has(String(it.sale_id))) continue;
        out.push({ sale_id: String(it.sale_id), product_id: String(it.product_id), quantity: Number(it.quantity) || 0, unit_cents: numOrNull(it.unit_price_cents), line_cents: numOrNull(it.line_total_cents), created_at: it.created_at || null }); }
      out.truncated = !!(sales.truncated || items.truncated); return out; // las lecturas van por id, no por fecha: si se cortan, faltan ventas
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
    },
    // Caja abierta (SOLO LECTURA, 2 consultas): la vista canonical_cash_state es la que pinta «Efectivo esperado» en la pantalla Caja
    // (canonical-ui-adapter uiCashState) y con la que el servidor acepta el cierre (cash_close_reconciles exige ESTE expected_cents).
    async cashOpen() { return cashOpenSql(db); }
  };
}

// 1) la sesión abierta (o, si no hay, solo la fecha del último cierre) en UNA lectura; 2) el desglose ya sumado en SQL (GROUP BY), filtrado
// a esa sesión: ventas por las mismas marcas de agua de la vista (rowid de cash_movements), cobros/ingresos/egresos por session_id (y los
// cobros digitales sin caja desde la hora de apertura, como el desglose del cierre en canonical-cash-history.js) y gastos por session_id.
// Nunca se leen nombres (ni de cajero ni de clientes). Sin esquema de caja: { ready: false }, sin cifras.
export async function cashOpenSql(db) {
  let s;
  try {
    s = await db.prepare(`SELECT c.active_promotion_id AS promotion_id,s.session_id,s.opened_at,s.opening_cents,s.expected_cents,s.cash_movement_watermark,s.closing_watermark,
      (SELECT MAX(z.closed_at) FROM canonical_cash_state z WHERE z.promotion_id=c.active_promotion_id AND z.status='CLOSED') AS last_closed_at
      FROM canonical_control c LEFT JOIN canonical_cash_state s ON s.promotion_id=c.active_promotion_id AND s.status='OPEN'
      WHERE c.id=1 ORDER BY s.opened_at DESC LIMIT 1`).first();
  } catch (e) { if (/no such (table|column)/i.test(String(e?.message || e))) return { ready: false }; throw e; }
  if (!s || !s.promotion_id) return { ready: false };
  if (!s.session_id) return { ready: true, open: null, lastClosedAt: s.last_closed_at || null };
  const rows = (await db.prepare(`SELECT 'venta' AS k,COALESCE(m.digital_method,'') AS metodo,'' AS signo,COUNT(*) AS n,
      COALESCE(SUM(m.cash_cents),0) AS a,COALESCE(SUM(m.digital_cents),0) AS b,COALESCE(SUM(m.credit_cents),0) AS c
      FROM cash_movements m JOIN canonical_sale_context x ON x.sale_id=m.sale_id
      WHERE x.promotion_id=?1 AND m.rowid>?2 AND m.rowid<=?3 GROUP BY m.digital_method
    UNION ALL SELECT CASE WHEN e.event_type='ADJUSTMENT' AND e.reason LIKE 'Anulación de venta %' THEN 'devolucion' ELSE lower(e.event_type) END,
      COALESCE(e.payment_method,''),CASE WHEN e.cash_delta_cents<0 THEN '-' ELSE '+' END,COUNT(*),COALESCE(SUM(e.cash_delta_cents),0),COALESCE(SUM(e.credit_delta_cents),0),0
      FROM canonical_financial_events e
      WHERE e.promotion_id=?1 AND (e.session_id=?4 OR (e.session_id IS NULL AND e.event_type='PAYMENT' AND julianday(e.created_at)>=julianday(?5)))
      GROUP BY 1,2,3
    UNION ALL SELECT 'gasto',g.payment_method,'',COUNT(*),COALESCE(SUM(g.cash_delta_cents),0),COALESCE(SUM(g.amount_cents),0),0
      FROM canonical_expenses g WHERE g.session_id=?4 GROUP BY g.payment_method`)
    .bind(s.promotion_id, Number(s.cash_movement_watermark), Number(s.closing_watermark), s.session_id, s.opened_at).all()).results || [];
  return { ready: true, open: { opened_at: s.opened_at, opening_cents: Number(s.opening_cents), expected_cents: Number(s.expected_cents) }, rows, lastClosedAt: s.last_closed_at || null };
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
    async soldQty(p) { const ids = new Set((data.sales || []).filter((x) => inRange(x, p)).map((s) => s.sale_id)), m = new Map();
      for (const it of (data.saleItems || []).filter((x) => ids.has(x.sale_id))) { const k = String(it.product_id); m.set(k, (m.get(k) || 0) + (Number(it.quantity) || 0)); } return m; },
    async saleLines(p) { const ids = new Set((data.sales || []).filter((x) => inRange(x, p)).map((s) => s.sale_id));
      return (data.saleItems || []).filter((x) => ids.has(x.sale_id)).map((it) => ({ sale_id: String(it.sale_id), product_id: String(it.product_id), quantity: Number(it.quantity) || 0, unit_cents: numOrNull(it.unit_price_cents), line_cents: numOrNull(it.line_total_cents), created_at: it.created_at || null })); },
    async periodSummary(periods) {
      const list = (data.sales || []).filter((s) => !s.anulada).map((s) => ({ sale_id: String(s.sale_id), created_at: s.created_at, metodo: s.metodo, total_cents: Number(s.total_cents) || 0 }));
      const items = (data.saleItems || []).map((it) => ({ ...it, sale_id: String(it.sale_id), product_id: String(it.product_id) }));
      // Igual que el lector real: sin cash-movements / cobros -> null («no disponible»). data.truncated simula el tope de páginas.
      return aggregatePeriods(periods, list, items, data.cashMovements ? data.cashMovements.map((m) => ({ sale_id: String(m.sale_id), credit_cents: Number(m.credit_cents) || 0 })) : null,
        data.payments ? data.payments.map((x) => ({ dia: paymentDay(x), c: Number(x.amount_cents) || 0 })) : null, !!data.truncated);
    },
    async purchases(n) { return (data.purchases || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, n); },
    async cashOpen() { return data.cash ? JSON.parse(JSON.stringify(data.cash)) : { ready: false }; }
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
  if (dateWordRange(args?.periodo, nowMs) || DATE.test(args?.desde || '') || DATE.test(args?.hasta || '') || dateWord(args?.desde) || dateWord(args?.hasta)) return period(args, nowMs); // fecha o palabra de fecha: la de period()
  const hasta = limaToday(nowMs); return period({ desde: addDays(hasta, -(SUGGEST_RULES.diasVentas - 1)), hasta }, nowMs);
}
// Devuelve { tipo, titulo, columnas, filas, texto, resumen } o { error }.
// filas/columnas: para la pantalla del dueño. resumen: lo único que ve el modelo (chico, sin datos personales).
export async function runAssistantQuery(reader, args, nowMs = Date.now()) {
  const tipo = QUERY_TYPES.includes(args?.tipo) ? args.tipo : null;
  if (!tipo) return { error: 'bad_query' };
  const N = QUERY_LIMITS.topRows, M = QUERY_LIMITS.modelRows, base = { tipo, titulo: TITLES[tipo] };
  if (tipo === 'caja_abierta') return cajaAbierta(reader, base);
  if (['stock_producto', 'bajo_stock', 'sin_costo'].includes(tipo)) {
    const list = await reader.products(), note = list.truncated ? ' (lista larga: se revisaron los primeros ' + list.length + ')' : '';
    if (tipo === 'stock_producto') {
      const hits = matchProducts(list, args.producto || '').slice(0, 5);
      if (!hits.length) return { ...base, columnas: [], filas: [], texto: 'No encontré ese producto.', resumen: { encontrados: 0 } };
      const filas = hits.map((p) => [p.nombre, p.controla ? r2(p.stock) : 'sin control', r2(p.min), p.precio]);
      return { ...base, columnas: ['Producto', 'Stock', 'Mínimo', 'Precio S/'], filas, texto: sentences(hits.map((p) => p.nombre + ': ' + (p.controla ? stockLabel(p.stock) : 'sin control de stock'))),
        resumen: { encontrados: hits.length, productos: hits.map((p) => (p.controla ? stockForModel(p) : { nombre: p.nombre, stock: null, minimo: r2(p.min) })) } };
    }
    if (tipo === 'bajo_stock') {
      // Servicios fuera (no llevan stock), igual que la pestaña «Crítico» de Inventario.
      const low = list.filter((p) => p.controla && !isServiceProduct(p) && Number.isFinite(p.stock) && (p.stock <= 0 || p.stock <= p.min)).sort((a, b) => (a.stock - a.min) - (b.stock - b.min));
      const filas = low.slice(0, N).map((p) => [p.nombre, r2(p.stock), r2(p.min), Math.max(1, Math.ceil(p.min * 2 - p.stock))]);
      return { ...base, columnas: ['Producto', 'Stock', 'Mínimo', 'Pedir'], filas, total: low.length,
        texto: low.length ? (low.length === 1 ? 'Hay 1 producto en o bajo el mínimo' : 'Hay ' + low.length + ' productos en o bajo el mínimo') + note + '. Los más urgentes: ' + low.slice(0, 3).map((p) => p.nombre + ' (' + (p.stock <= 0 ? stockLabel(p.stock) : r2(p.stock)) + ')').join(', ') + '.' : 'Ningún producto está bajo el mínimo' + note + '.',
        resumen: { total: low.length, revisados: list.length, primeros: low.slice(0, M).map(stockForModel) } };
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
  // Fecha de la compra en día de Lima (una compra de las 23:30 en Lima ya es el día siguiente en UTC).
  const filas = rows.map((r) => [limaDateOf(r.created_at), r.supplier || '-', r.document_ref || '-', cents(r.total_cost_cents), r.line_count]);
  return { ...base, columnas: ['Fecha', 'Proveedor', 'Documento', 'Total S/', 'Líneas'], filas,
    texto: rows.length ? (rows.length === 1 ? 'Última compra' : 'Últimas ' + rows.length + ' compras') + '. La más reciente: ' + filas[0][0] + ', ' + filas[0][1] + ', S/ ' + Number(filas[0][3] || 0).toFixed(2) + '.' : 'No hay compras registradas.',
    resumen: { compras: rows.length, total_soles: r2(filas.reduce((s, f) => s + (f[3] || 0), 0)), recientes: filas.slice(0, M).map((f) => ({ fecha: f[0], proveedor: f[1], soles: f[3] })) } };
}

// ---------- Caja abierta (solo Admin) ----------
// Hora de Lima: los helpers de arriba (limaDateTime / limaDay), los mismos de todo el asistente.
const dmy = (iso) => { const c = limaDateTime(iso); return c ? c.slice(8, 10) + '/' + c.slice(5, 7) + '/' + c.slice(0, 4) : null; };
const soles = (c) => 'S/ ' + cents(c).toFixed(2);
// Esperado = el expected_cents de la vista (no se recalcula aquí). El desglose se arma con la MISMA suma que la vista:
// fondo + efectivo de ventas + cash_delta de cobros/ingresos/egresos/devoluciones + cash_delta de gastos (negativo).
async function cajaAbierta(reader, base) {
  const d = reader.cashOpen ? await reader.cashOpen() : { ready: false };
  if (!d || !d.ready) return { ...base, columnas: [], filas: [], texto: 'No pude leer la caja ahora. Revisa la pantalla Caja.', resumen: { caja_abierta: null, sin_datos: true } };
  if (!d.open) {
    const f = d.lastClosedAt ? dmy(d.lastClosedAt) : null;
    return { ...base, titulo: 'Caja', columnas: [], filas: [], texto: 'No hay caja abierta.' + (f ? ' La última caja se cerró el ' + f + '.' : ' Todavía no hay cierres registrados.'),
      resumen: { caja_abierta: false, ultimo_cierre: d.lastClosedAt ? limaDateOf(d.lastClosedAt) || null : null } };
  }
  const o = d.open, met = { efectivo: 0, yape: 0, plin: 0, transferencia: 0, credito: 0 };
  let ventasN = 0, ventasC = 0, cobroEf = 0, cobroDig = 0, cobrosN = 0, ingresos = 0, egresos = 0, devol = 0, gastosEf = 0, gastosN = 0, gastosTot = 0;
  for (const r of d.rows || []) {
    const n = Number(r.n) || 0, a = Number(r.a) || 0, b = Number(r.b) || 0, c = Number(r.c) || 0;
    if (r.k === 'venta') { ventasN += n; ventasC += a + b + c; met.efectivo += a; met.credito += c; if (b) met[['yape', 'plin'].includes(r.metodo) ? r.metodo : 'transferencia'] += b; }
    else if (r.k === 'payment') { cobrosN += n; if (r.metodo === 'efectivo') cobroEf += a; else cobroDig += -b; } // cobro digital: no mueve efectivo
    else if (r.k === 'devolucion') devol += -a;
    else if (r.k === 'adjustment' || r.k === 'compensation') { if (a >= 0) ingresos += a; else egresos += -a; }
    else if (r.k === 'gasto') { gastosN += n; gastosEf += -a; gastosTot += b; }
  }
  const esperado = o.expected_cents, suma = o.opening_cents + met.efectivo + cobroEf + ingresos - egresos - devol - gastosEf;
  const metodos = Object.entries(met).filter(([, c]) => c).map(([k, c]) => [METODO[k] || k, cents(c)]);
  const desde = limaDateTime(o.opened_at);
  const filas = [['Abierta desde', desde], ['Fondo inicial', cents(o.opening_cents)], ...metodos.map(([m, c]) => ['Ventas ' + m, c]),
    ['Cobros de crédito en efectivo', cents(cobroEf)], ...(cobroDig ? [['Cobros de crédito digitales', cents(cobroDig)]] : []), ['Ingresos de caja', cents(ingresos)], ['Egresos de caja', cents(egresos)],
    ...(devol ? [['Devoluciones por anulación', cents(devol)]] : []), ['Gastos en efectivo', cents(gastosEf)], ['Efectivo esperado ahora', cents(esperado)]];
  return { ...base, titulo: 'Caja abierta', columnas: ['Detalle', 'S/'], filas, total: cents(esperado), ventas: ventasN,
    texto: 'La caja todavía está abierta (desde ' + desde + '). Fondo ' + soles(o.opening_cents) + ', ventas ' + soles(ventasC) + ' en ' + ventasN + (ventasN === 1 ? ' venta' : ' ventas') +
      '. Efectivo esperado ahora: ' + soles(esperado) + '. Aún no hay cierre ni conteo.',
    // Al modelo: solo totales (sin nombres de cajero ni de clientes, sin ids).
    resumen: { caja_abierta: true, abierta_desde: desde, fondo_inicial_soles: cents(o.opening_cents), ventas: ventasN, ventas_soles: cents(ventasC), por_metodo: Object.fromEntries(metodos),
      cobros_credito: cobrosN, cobros_efectivo_soles: cents(cobroEf), cobros_digitales_soles: cents(cobroDig), ingresos_soles: cents(ingresos), egresos_soles: cents(egresos),
      devoluciones_anulacion_soles: cents(devol), gastos: gastosN, gastos_efectivo_soles: cents(gastosEf), gastos_total_soles: cents(gastosTot),
      efectivo_esperado_soles: cents(esperado), desglose_cuadra: suma === esperado, cierre: 'todavía no: no hay contado ni diferencia' } };
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
