// Consultas del asistente (SOLO LECTURA). El Worker lee su base y arma un resumen chico:
// - a la pantalla del dueño va una tabla con números (top N filas);
// - a DeepSeek va un resumen aún más chico y SIN datos personales (clientes como «Cliente 1», sin DNI ni teléfono).
// Nunca se manda el inventario completo al modelo. Nada aquí escribe en la base.
import { canonicalRead } from './a6-canonical.js';

// Frases seguidas con un solo punto al final de cada una (Bot 4: nada de «unid..»).
const sentences = (arr) => arr.map((x) => (/[.!?]$/.test(x) ? x : x + '.')).join(' ');
export const QUERY_TYPES = Object.freeze(['stock_producto', 'bajo_stock', 'sin_costo', 'ventas_periodo', 'top_productos', 'deudas_clientes', 'creditos_atrasados', 'compras_recientes', 'sugerencias_compra', 'resumen_dia', 'resumen_mes', 'caja_abierta',
  'ganancia', 'productos_sin_ventas', 'deuda_cliente', 'ventas_por_hora']);
// Ganancia: usa costos. Solo quien ve costos (purchases.costs.view = hoy solo el Admin); el permiso se revisa en pos-assistant.js.
export const COST_QUERY_TYPES = Object.freeze(['ganancia']);
// Resúmenes del día y del mes: SOLO el Admin (el empleado recibe 403 summary_admin_only en el chat).
// (lote en vivo 22-10, a) sin compras: se dice claro y dónde se registran (el modelo no pregunta de vuelta).
export const NO_PURCHASES_TEXT = 'No tengo ese dato registrado: no hay compras guardadas. Se registran en Inventario > Compras > Nueva compra y se ven en Compras > Historial.';
export const SUMMARY_TYPES = Object.freeze(['resumen_dia', 'resumen_mes']);
export const PRODUCT_ID_CHUNK = 50; // ids por consulta IN (...): muy por debajo del tope de 100 parámetros de D1
export const QUERY_LIMITS = Object.freeze({ topRows: 10, modelRows: 8, maxPages: 20, pageSize: 250, maxDays: 92 });
const TITLES = { stock_producto: 'Stock del producto', bajo_stock: 'Productos por reponer', sin_costo: 'Productos sin costo', ventas_periodo: 'Ventas del período',
  top_productos: 'Productos más vendidos', deudas_clientes: 'Deudas de clientes', creditos_atrasados: 'Créditos atrasados', compras_recientes: 'Compras recientes',
  sugerencias_compra: 'Sugerencias de compra',
  resumen_dia: 'Resumen del día', resumen_mes: 'Resumen del mes', caja_abierta: 'Caja abierta', ganancia: 'Ganancia', productos_sin_ventas: 'Productos sin ventas',
  deuda_cliente: 'Deuda del cliente', ventas_por_hora: 'Ventas por hora' };
// Topes de las consultas nuevas: filas que vuelven de SQL (agrupadas) y filas de la tabla «sin ventas».
export const NEW_QUERY_LIMITS = Object.freeze({ sqlRows: 5000, idleRows: 50, idleDays: 30 });
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
export const SALE_LINES_MAX = 5000, SALES_READ_MAX = 5000;
// Sugerencias de compra: como mucho tantos productos distintos vendidos en el período (agrupado en SQL).
export const SOLD_QTY_MAX = 5000;
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
// Lista con .total (cuántos hay en total) NO enumerable: las filas y su forma no cambian.
const withTotal = (list, total) => Object.defineProperty(list, 'total', { value: Number.isInteger(total) ? total : null, enumerable: false });
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
// antier = hoy − 2; mismo_dia_semana_pasada = el MISMO día de la semana, 7 días atrás (jueves 22 -> jueves 15; no el lunes de esa semana).
export const DATE_WORDS = Object.freeze(['hoy', 'ayer', 'antier', 'mismo_dia_semana_pasada', 'esta_semana', 'semana_pasada', 'este_mes', 'mes_pasado']);
const WORD_ALIASES = { hoy: 'hoy', oy: 'hoy', ayer: 'ayer', 'esta semana': 'esta_semana', semana: 'esta_semana', 'la semana': 'esta_semana', 'semana actual': 'esta_semana',
  'semana pasada': 'semana_pasada', 'la semana pasada': 'semana_pasada', 'este mes': 'este_mes', mes: 'este_mes', 'el mes': 'este_mes', 'mes actual': 'este_mes',
  'mes pasado': 'mes_pasado', 'el mes pasado': 'mes_pasado',
  antier: 'antier', anteayer: 'antier', 'ante ayer': 'antier', 'antes de ayer': 'antier', 'antes ayer': 'antier', 'antesdeayer': 'antier', 'era antier': 'antier', 'era anteayer': 'antier',
  'mismo dia semana pasada': 'mismo_dia_semana_pasada', 'mismo dia de la semana pasada': 'mismo_dia_semana_pasada', 'el mismo dia de la semana pasada': 'mismo_dia_semana_pasada',
  'mismo dia de la otra semana': 'mismo_dia_semana_pasada', 'el mismo dia de la otra semana': 'mismo_dia_semana_pasada', 'hoy hace una semana': 'mismo_dia_semana_pasada',
  'hace una semana': 'mismo_dia_semana_pasada', 'hace 7 dias': 'mismo_dia_semana_pasada', 'hace siete dias': 'mismo_dia_semana_pasada',
  // (auditoría VEN-028) «mañana» ya no se pierde (antes: null → hoy en silencio). NO está en DATE_WORDS (el esquema del modelo no cambia):
  // la consulta ve que es una fecha futura y lo avisa.
  manana: 'manana', 'pasado manana': 'pasado_manana' };
const FUTURE_WORDS = Object.freeze(['manana', 'pasado_manana']);
export function dateWord(v) { const k = norm(v).replace(/[_\s]+/g, ' ').replace(/[¿?¡!.,]/g, '').trim(); return WORD_ALIASES[k] || null; }
// Lunes = inicio de la semana (Lima). 0 = lunes … 6 = domingo.
const weekdayIdx = (d) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;
// { desde, hasta } en fechas de Lima para una palabra de fecha, o null si no es una. «esta semana» = lunes a hoy; «este mes» = día 1 a hoy.
// future: «mañana» / «pasado mañana» SOLO cuentan si se pide (consultas de ventas y resúmenes, que avisan que es futura). Sin future
// (sugerencias de compra, ventas bajo costo, period()) no son palabra de fecha: queda la ventana de siempre (seguimiento PR #984).
export function dateWordRange(word, nowMs = Date.now(), { future = false } = {}) {
  const w = DATE_WORDS.includes(word) ? word : dateWord(word); if (!w || (!future && FUTURE_WORDS.includes(w))) return null;
  const today = limaToday(nowMs), mon = addDays(today, -weekdayIdx(today));
  if (w === 'hoy') return { desde: today, hasta: today };
  if (w === 'ayer') { const y = addDays(today, -1); return { desde: y, hasta: y }; }
  if (w === 'antier') { const y = addDays(today, -2); return { desde: y, hasta: y }; }
  if (w === 'mismo_dia_semana_pasada') { const y = addDays(today, -7); return { desde: y, hasta: y }; }
  if (w === 'esta_semana') return { desde: mon, hasta: today };
  if (w === 'semana_pasada') return { desde: addDays(mon, -7), hasta: addDays(mon, -1) };
  if (w === 'este_mes') return { desde: today.slice(0, 8) + '01', hasta: today };
  if (w === 'manana' || w === 'pasado_manana') { const y = addDays(today, w === 'manana' ? 1 : 2); return { desde: y, hasta: y }; }
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
function dateArg(v, side, nowMs, future = false) { if (DATE.test(v || '')) return v; const r = dateWordRange(v, nowMs, { future }); return r ? r[side] : null; }
// Período en fechas de Lima. Por defecto: hoy. «periodo» (palabra de fecha) manda sobre desde/hasta. Máximo 92 días.
// «fecha» (AAAA-MM-DD): un solo día exacto de Lima; va después de «periodo» y antes de desde/hasta.
// rawRange: el rango pedido ANTES del tope de 92 días (periodCheck lo usa para avisar del recorte y de fechas futuras).
function rawRange(args, nowMs, future = false) {
  const o = { future }, today = limaToday(nowMs), f = DATE.test(args?.fecha || '') ? { desde: args.fecha, hasta: args.fecha } : null, w = dateWordRange(args?.periodo, nowMs, o) || f;
  let hasta = w ? w.hasta : dateArg(args?.hasta, 'hasta', nowMs, future) || today, desde = w ? w.desde : dateArg(args?.desde, 'desde', nowMs, future) || (dateWordRange(args?.hasta, nowMs, o)?.desde ?? hasta);
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  return { desde, hasta };
}
const capDesde = (desde, hasta) => (Date.parse(hasta) - Date.parse(desde) > QUERY_LIMITS.maxDays * 86400000 ? addDays(hasta, -QUERY_LIMITS.maxDays) : desde);
export function period(args, nowMs) {
  const { desde, hasta } = rawRange(args, nowMs);
  return limaBounds(capDesde(desde, hasta), hasta);
}
// ---------- Avisos de fecha (auditoría de ventas 23-10: VEN-027, VEN-028, VEN-046) ----------
// Fecha AAAA-MM-DD que existe en el calendario (2026-09-31 y 2026-02-29 no existen).
export function isRealDate(d) { if (!DATE.test(d || '')) return false; const t = Date.parse(d + 'T00:00:00Z'); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d; }
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// «24 de octubre de 2026» (sin el año si se pide sin año).
export function fechaLarga(d, conAnio = true) { const [y, m, dd] = d.split('-').map(Number); return dd + ' de ' + MESES[m - 1] + (conAnio ? ' de ' + y : ''); }
const futureNote = (cual, today) => cual + ' (hoy es ' + fechaLarga(today) + ' en Lima): todavía no hay ventas.';
function badDateText(d) {
  const [y, m, dd] = d.split('-').map(Number);
  if (m < 1 || m > 12 || dd < 1) return 'La fecha ' + d + ' no existe en el calendario. Dime otra fecha.';
  const largo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return 'El ' + dd + ' de ' + MESES[m - 1] + ' de ' + y + ' no existe (' + MESES[m - 1] + ' tiene ' + largo + ' días). Dime otra fecha.';
}
// ---------- Avisos que también ve el empleado (revisión de alfa, PR #984) ----------
// resumen.aviso puede venir de cualquier consulta y traer montos: al empleado NO se le copia. Los avisos de fechas y conteos (fecha que no
// existe, fecha o mes futuro, período que termina en el futuro, período recortado, lista cortada) van además ESTRUCTURADOS bajo la clave
// símbolo NOTICES del resumen: [{ tipo, ...solo fechas AAAA-MM-DD y enteros }]. El símbolo no sale en JSON (ni al modelo ni a la pantalla),
// solo lo puede poner quien importe NOTICES, y employeeNoticeText vuelve a revisar cada campo y rearma el texto desde ahí con noticeText.
export const NOTICES = Symbol('avisos_fechas_conteos');
const isDay = (v) => typeof v === 'string' && DATE.test(v), isCount = (v) => Number.isInteger(v) && v >= 0;
const NOTICE_FIELDS = Object.freeze({
  fecha_invalida: { fecha: isDay }, fecha_futura: { desde: isDay, hasta: isDay, hoy: isDay },
  mes_futuro: { mes: (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v), hoy: isDay }, hasta_futuro: { hasta: isDay, hoy: isDay },
  periodo_recortado: { pedido_desde: isDay, pedido_hasta: isDay, desde: isDay, hasta: isDay, max_dias: isCount }, lista_cortada: { mostrados: isCount, total: isCount },
  marca_no_encontrada: {} }); // sin campos: el aviso nunca repite la palabra escrita (decisión de alfa, revisión de #1001)
export const EMPLOYEE_NOTICE_KINDS = Object.freeze(Object.keys(NOTICE_FIELDS));
// Copia limpia (solo los campos del tipo, cada uno validado) o null.
export function cleanNotice(n) {
  const spec = n && typeof n === 'object' && Object.hasOwn(NOTICE_FIELDS, n.tipo) ? NOTICE_FIELDS[n.tipo] : null; if (!spec) return null;
  const out = { tipo: n.tipo }; for (const [k, ok] of Object.entries(spec)) { if (!ok(n[k])) return null; out[k] = n[k]; } return out;
}
export function noticeText(n) {
  const c = cleanNotice(n); if (!c) return null;
  switch (c.tipo) {
    case 'fecha_invalida': return badDateText(c.fecha);
    case 'fecha_futura': return futureNote(c.desde === c.hasta ? 'El ' + fechaLarga(c.desde) + ' es una fecha futura' : 'El período del ' + fechaLarga(c.desde) + ' al ' + fechaLarga(c.hasta) + ' es futuro', c.hoy);
    case 'mes_futuro': return futureNote(MESES[Number(c.mes.slice(5, 7)) - 1].replace(/^./, (x) => x.toUpperCase()) + ' de ' + c.mes.slice(0, 4) + ' es un mes futuro', c.hoy);
    case 'hasta_futuro': return 'El período pedido termina en una fecha futura (' + c.hasta + '): conté hasta hoy (' + c.hoy + ').';
    case 'periodo_recortado': return 'El período pedido (' + c.pedido_desde + ' a ' + c.pedido_hasta + ') pasa de ' + c.max_dias + ' días: conté solo del ' + c.desde + ' al ' + c.hasta + '.';
    case 'lista_cortada': return 'Mostrando ' + c.mostrados + ' de ' + c.total + ' productos vendidos.';
    case 'marca_no_encontrada': return BRAND_NOTICE;
  }
  return null;
}
// El aviso que puede ver el empleado: solo los avisos estructurados de NOTICES, rearmados. Nada del texto de resumen.aviso. Sin ninguno: undefined.
export function employeeNoticeText(resumen) {
  const list = resumen && Array.isArray(resumen[NOTICES]) ? resumen[NOTICES] : [];
  return list.map(noticeText).filter(Boolean).join(' ') || undefined;
}
// Revisa las fechas de una consulta de ventas ANTES de leer la base:
// - fecha que no existe → { aviso, fecha_invalida: true } (no se lee nada; antes salía «No hay ventas registradas 2026-09-31»)
// - período entero en el futuro («mañana», 2026-10-24) → { aviso, fecha_futura: true } (antes «mañana» se volvía hoy en silencio)
// - si no: { p, avisos, pedido } con p ya recortado: termina en el futuro → hasta hoy; más de 92 días → los 92 más recientes (con aviso).
export function periodCheck(args, nowMs) {
  const today = limaToday(nowMs), word = dateWordRange(args?.periodo, nowMs, { future: true });
  const used = word ? [] : DATE.test(args?.fecha || '') ? [args.fecha] : [args?.desde, args?.hasta].filter((v) => DATE.test(v || ''));
  const bad = used.find((v) => !isRealDate(v));
  if (bad) { const notice = { tipo: 'fecha_invalida', fecha: bad }; return { fecha_invalida: true, aviso: noticeText(notice), notice }; }
  const raw = rawRange(args, nowMs, true), notices = [];
  if (raw.desde > today) {
    const notice = { tipo: 'fecha_futura', desde: raw.desde, hasta: raw.hasta, hoy: today };
    return { fecha_futura: true, desde: raw.desde, hasta: raw.hasta, aviso: noticeText(notice), notice };
  }
  let hasta = raw.hasta;
  if (hasta > today) { notices.push({ tipo: 'hasta_futuro', hasta: raw.hasta, hoy: today }); hasta = today; }
  const desde = capDesde(raw.desde, hasta);
  if (desde !== raw.desde) notices.push({ tipo: 'periodo_recortado', pedido_desde: raw.desde, pedido_hasta: raw.hasta, desde, hasta, max_dias: QUERY_LIMITS.maxDays });
  return { p: limaBounds(desde, hasta), avisos: notices.map(noticeText), notices, pedido: desde !== raw.desde ? { desde: raw.desde, hasta: raw.hasta } : null };
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
const mkPeriod = limaBounds;
// Períodos del resumen (hora de Lima). Día: el pedido (por defecto hoy) contra el día anterior.
// Mes: el mes del día pedido; si es el mes en curso va hasta hoy y se compara con los MISMOS días del mes anterior (1 al N).
export function summaryPeriods(tipo, args, nowMs) {
  // «periodo» (o una palabra en hasta/desde): el día de referencia es el ÚLTIMO de su rango en Lima («ayer», «mes_pasado» -> su último día).
  const o = { future: true }, today = limaToday(nowMs), w = dateWordRange(args?.periodo, nowMs, o) || (DATE.test(args?.fecha || '') ? { desde: args.fecha, hasta: args.fecha } : null)
    || dateWordRange(args?.hasta, nowMs, o) || dateWordRange(args?.desde, nowMs, o);
  const raw = String(args?.hasta || args?.desde || '');
  let ref = w ? w.hasta : DATE.test(raw) ? raw : /^\d{4}-\d{2}$/.test(raw) ? raw + '-01' : today;
  // (seguimiento PR #984) fecha futura: el período sigue quedando en hoy (forma de siempre), pero va «futuro» con el aviso y summaryQuery
  // contesta con él en vez del resumen de hoy. Día: después de hoy. Mes: un mes después del actual (un día futuro del mes en curso = este mes).
  const fNotice = (tipo === 'resumen_dia' ? ref > today : ref.slice(0, 7) > today.slice(0, 7)) && isRealDate(ref)
    ? (tipo === 'resumen_dia' ? { tipo: 'fecha_futura', desde: ref, hasta: ref, hoy: today } : { tipo: 'mes_futuro', mes: ref.slice(0, 7), hoy: today }) : null;
  const futuro = fNotice ? { desde: ref, aviso: noticeText(fNotice), notice: fNotice } : null;
  if (ref > today) ref = today;
  if (tipo === 'resumen_dia') return { actual: mkPeriod(ref, ref), anterior: mkPeriod(addDays(ref, -1), addDays(ref, -1)), en_curso: ref === today, futuro };
  const ym = ref.slice(0, 7), end = monthEnd(ym), enCurso = today.slice(0, 7) === ym, hasta = enCurso ? today : end;
  const pym = prevMonth(ym), pEnd = monthEnd(pym), day = Number(hasta.slice(8, 10)), pHasta = enCurso ? (pym + '-' + pad2(Math.min(day, Number(pEnd.slice(8, 10))))) : pEnd;
  return { actual: mkPeriod(ym + '-01', hasta), anterior: mkPeriod(pym + '-01', pHasta), en_curso: enCurso, futuro };
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
  // Consultas nuevas del #958 (ganancia, sin ventas, por hora): la base devuelve filas YA agrupadas, con LIMIT. Mismo filtro de fecha por
  // momento (julianday) y de anuladas que salesQuery, para que todas las consultas de ventas cuenten igual.
  const salesSqlLimit = (p, build, limit) => salesQuery(p, (from, where) => build(from, where) + ' LIMIT ?4', [limit]);
  return {
    async products() { const rows = await all('products'); const list = rows.map((p) => ({ id: String(p.product_id), nombre: p.name, stock: Number(p.current_stock_quantity), min: Number(p.stock_min_quantity || 0),
      costo: cents(p.cost_cents), precio: cents(p.price_cents), categoria: p.category ?? null, controla: p.tracks_inventory === 1 || p.tracks_inventory === true, unidad: p.unit ?? null,
      // Tamaño de caja CONFIRMADO (ficha: units_per_box + box_price_cents, siempre juntos). Sin él, lo que diga el nombre es provisional.
      caja: Number(p.units_per_box) > 0 ? Number(p.units_per_box) : null, precio_caja: p.box_price_cents == null ? null : cents(p.box_price_cents) })); list.truncated = rows.truncated; return list; },
    // Tamaño de caja de los ids pedidos (tarjeta «Guardar tamaño de caja»): ficha efectiva = base o en vivo + última revisión. Lanza si falla.
    async packSizes(ids) {
      const want = [...new Set((ids || []).map(String))].slice(0, PRODUCT_ID_CHUNK); const out = new Map(); if (!want.length) return out;
      const c = await ctl(), marks = want.map((_, k) => '?' + (k + 2)).join(',');
      const q = async (sql) => { try { return (await db.prepare(sql).bind(c.active_promotion_id, ...want).all()).results || []; } catch (e) { if (/no such table/i.test(String(e?.message || e))) return []; throw e; } };
      const cols = 'product_id,units_per_box,box_price_cents';
      for (const r of [...await q(`SELECT ${cols} FROM products WHERE promotion_id=?1 AND product_id IN (${marks})`), ...await q(`SELECT ${cols} FROM canonical_live_products WHERE promotion_id=?1 AND product_id IN (${marks})`),
        ...await q(`SELECT ${cols} FROM canonical_product_revisions WHERE promotion_id=?1 AND product_id IN (${marks}) ORDER BY revision`)])
        out.set(String(r.product_id), { caja: Number(r.units_per_box) > 0 ? Number(r.units_per_box) : null, precio_caja: r.box_price_cents == null ? null : cents(r.box_price_cents) });
      return out;
    },
    // Solo los ids pedidos (control de inventario de una tarjeta): una consulta por tramo de <= 50 ids con parámetros enlazados, sin
    // leer el catálogo. Misma autoridad que la lectura canónica: promoción activa (importados + creados en vivo). Si la consulta
    // falla, lanza (quien llama falla CERRADO). Un id que no vuelve es un producto que no existe.
    async productsById(ids) {
      const want = [...new Set((ids || []).map(String))]; const out = new Map(); if (!want.length) return out;
      const c = await ctl();
      for (let i = 0; i < want.length; i += PRODUCT_ID_CHUNK) {
        const part = want.slice(i, i + PRODUCT_ID_CHUNK), marks = part.map((_, k) => '?' + (k + 2)).join(',');
        const base = `SELECT product_id,name,tracks_inventory,unit FROM products WHERE promotion_id=?1 AND product_id IN (${marks})`;
        const live = `SELECT product_id,name,tracks_inventory,unit FROM canonical_live_products WHERE promotion_id=?1 AND product_id IN (${marks})`;
        let rows;
        if (c.mode === 'ACTIVE') {
          try { rows = (await db.prepare(base + ' UNION ALL ' + live).bind(c.active_promotion_id, ...part).all()).results || []; }
          catch (e) { if (!/no such table: canonical_live_products/i.test(String(e?.message || e))) throw e; rows = null; }
        }
        if (!rows) rows = (await db.prepare(base).bind(c.active_promotion_id, ...part).all()).results || [];
        for (const r of rows) out.set(String(r.product_id), { id: String(r.product_id), nombre: r.name, controla: r.tracks_inventory === 1 || r.tracks_inventory === true, unidad: r.unit ?? null });
      }
      return out;
    },
    async credits() { const rows = await all('credits'); const list = rows.map((c) => ({ cliente: String(c.customer_id), saldo: cents(c.current_balance_cents) || 0,
      original: cents(c.opening_balance_cents ?? c.original_amount_cents), vence: c.due_date || c.due_value || termDue(c.issued_value, c.term_days), cuotas: parseCuotas(c.installments_json) }));
      list.truncated = rows.truncated; return list; },
    async customers() { const rows = await all('customers'); const list = rows.map((c) => ({ id: String(c.customer_id), nombre: c.name, dni: c.document == null ? null : String(c.document), tel: c.phone == null ? null : String(c.phone) }));
      list.truncated = rows.truncated; return list; },
    // Ventas por producto del período (agrupado en SQL): { product_id, q, c }. Tope NEW_QUERY_LIMITS.sqlRows (truncated si llega).
    async itemsByProduct(p) {
      const lim = NEW_QUERY_LIMITS.sqlRows;
      const rows = await salesSqlLimit(p, (from, where) => `SELECT i.product_id AS product_id,SUM(i.quantity) AS q,SUM(i.line_total_cents) AS c FROM ${from} JOIN sale_items i ON i.sale_id=r.sale_id WHERE ${where} GROUP BY i.product_id ORDER BY c DESC`, lim);
      const list = rows.map((x) => ({ product_id: String(x.product_id), q: Number(x.q) || 0, c: Number(x.c) || 0 })); list.truncated = rows.length >= lim; return list;
    },
    // Ventas por hora de Lima (agrupado en SQL, como mucho 24 filas + «sin hora»): { h, n, c }.
    async salesByHour(p) {
      const rows = await salesSqlLimit(p, (from, where) => `SELECT CAST(strftime('%H',r.created_at,'-5 hours') AS INTEGER) AS h,COUNT(*) AS n,SUM(r.total_cents) AS c FROM ${from} WHERE ${where} GROUP BY h ORDER BY h`, 25);
      return rows.map((x) => ({ h: x.h == null ? null : Number(x.h), n: Number(x.n) || 0, c: Number(x.c) || 0 }));
    },
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
        + `${withNames ? `MIN(CASE WHEN ${gen} THEN TRIM(g.name) END)` : 'NULL'} AS generic_name,SUM(i.quantity) AS q,SUM(i.line_total_cents) AS c,COUNT(*) OVER () AS n_total`,
        { join: 'JOIN sale_items i ON i.sale_id=r.sale_id' + (withNames ? ' LEFT JOIN canonical_generic_sale_lines g ON g.generic_product_id=i.product_id' : ''), rest: 'GROUP BY 1,2 ORDER BY c DESC,1,2 LIMIT ?4' }, lim);
      let rows; try { rows = await q(true); } catch (e) { if (!/no such table: canonical_generic_sale_lines/i.test(String(e?.message || e))) throw e; rows = await q(false); }
      // (VEN-040) .total: cuántos productos distintos se vendieron en el período (COUNT(*) OVER () sobre los grupos, antes del LIMIT); no enumerable.
      return withTotal(rows.map((r) => (r.product_id == null ? { product_id: null, generic: true, generic_name: r.generic_name || null, q: Number(r.q) || 0, c: Number(r.c) || 0 } : { product_id: r.product_id, q: Number(r.q) || 0, c: Number(r.c) || 0 })), rows.length ? Number(rows[0].n_total) : 0);
    },
    // Unidades vendidas por producto en el período (sugerencias de compra, #929), agrupado EN SQL con la misma lectura de ventas que
    // topItems (fecha por momento de Lima, anuladas fuera): ya no lee todas las ventas ni las líneas. Tope SOLD_QTY_MAX filas: si se
    // llega, .truncated y la consulta lo avisa (pantalla, texto y modelo).
    async soldQty(p) {
      const rows = await salesSql(p, 'i.product_id AS product_id,SUM(i.quantity) AS q', { join: 'JOIN sale_items i ON i.sale_id=r.sale_id', rest: 'GROUP BY i.product_id ORDER BY i.product_id LIMIT ?4' }, [SOLD_QTY_MAX + 1]);
      const m = new Map(); for (const r of rows.slice(0, SOLD_QTY_MAX)) m.set(String(r.product_id), Number(r.q) || 0);
      m.truncated = rows.length > SOLD_QTY_MAX; return m;
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
  const inRange = (s, p) => { const t = Date.parse(s.created_at); return t >= Date.parse(p.fromIso) && t < Date.parse(p.toIso) && !s.anulada; }; // por el momento (acepta -05:00)
  const dia = limaDay; // el día de Lima de una venta: la misma función que el resto (sin otra cuenta de -5 h aquí)
  return {
    async products() { return (data.products || []).map((p) => ({ ...p })); },
    async productsById(ids) { const want = new Set((ids || []).map(String)), out = new Map(); for (const p of (data.products || [])) if (want.has(String(p.id))) out.set(String(p.id), { ...p }); return out; },
    async credits() { const l = (data.credits || []).map((c) => ({ ...c })); l.truncated = !!data.creditsTruncated; return l; },
    async customers() { const l = (data.customers || []).map((c) => ({ ...c })); l.truncated = !!data.customersTruncated; return l; },
    async itemsByProduct(p) { const ids = new Set((data.sales || []).filter((x) => inRange(x, p)).map((s) => s.sale_id)), m = new Map();
      for (const it of (data.saleItems || []).filter((x) => ids.has(x.sale_id))) { const k = String(it.product_id), r = m.get(k) || { product_id: k, q: 0, c: 0 }; r.q += Number(it.quantity) || 0; r.c += Number(it.line_total_cents) || 0; m.set(k, r); }
      return [...m.values()].sort((a, b) => b.c - a.c); },
    async salesByHour(p) { const m = new Map();
      for (const s of (data.sales || []).filter((x) => inRange(x, p))) { const h = new Date(Date.parse(s.created_at) - LIMA_OFFSET_MS).getUTCHours(), r = m.get(h) || { h, n: 0, c: 0 }; r.n++; r.c += Number(s.total_cents) || 0; m.set(h, r); }
      return [...m.values()].sort((a, b) => a.h - b.h); },
    async salesTotals(p) { const m = new Map(); for (const s of (data.sales || []).filter((x) => inRange(x, p))) { const k = dia(s.created_at) + '|' + s.metodo; const r = m.get(k) || { dia: dia(s.created_at), metodo: s.metodo, n: 0, c: 0 }; r.n++; r.c += s.total_cents; m.set(k, r); } return [...m.values()].sort((a, b) => a.dia.localeCompare(b.dia)); },
    async topItems(p, n) { const ids = new Set((data.sales || []).filter((x) => inRange(x, p)).map((s) => s.sale_id)); const m = new Map();
      for (const it of (data.saleItems || []).filter((x) => ids.has(x.sale_id))) { const g = isGenericId(it.product_id), nm = g ? String(it.generic_name || '').trim() : '', k = g ? 'G|' + nm.toUpperCase() : 'P|' + it.product_id;
        const r = m.get(k) || (g ? { product_id: null, generic: true, generic_name: nm || null, q: 0, c: 0 } : { product_id: it.product_id, q: 0, c: 0 }); r.q += it.quantity; r.c += it.line_total_cents; m.set(k, r); }
      return withTotal([...m.values()].sort((a, b) => b.c - a.c).slice(0, n), m.size); },
    async productNamesById(ids) { const want = new Set((ids || []).map(String)), out = new Map(); for (const p of (data.products || [])) if (want.has(String(p.id))) out.set(String(p.id), p.nombre); return out; },
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
const isGenericId = (id) => String(id ?? '').startsWith('GENERIC:');
export const GENERIC_LABEL = 'Producto genérico';
const METODO = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia', credito: 'Crédito', mixto: 'Mixto' };
// (lote en vivo 22-10) «aceites», «cervezas»: el plural también encuentra el producto en singular. Palabras de relleno fuera.
const FILLER = new Set(['del', 'las', 'los', 'una', 'uno', 'que', 'con', 'para', 'por', 'caja', 'cajas']);
const stem = (w) => (w.length >= 5 && w.endsWith('es') && !/[aeiou]es$/.test(w) ? w.slice(0, -2) : w.length >= 4 && w.endsWith('s') ? w.slice(0, -1) : w);
// (AJ-026) «inka» = «Inca Kola»: c/k/qu suenan igual. Solo «c» antes de a, o, u o consonante (no «ch») y «qu» antes de e, i pasan a «k».
// Se usa SOLO si la búsqueda exacta no encontró nada, así no cambia ningún resultado que ya salía.
export const soundK = (s) => String(s || '').replace(/qu(?=[ei])/g, 'k').replace(/c(?![eih])/g, 'k');
export function matchProducts(list, text) {
  const words = norm(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !FILLER.has(w)).map(stem);
  if (!words.length) return [];
  // (revisión de #1001) marca mal escrita: «lavagi» = «Lavaggi», «glora» = «Gloria». Solo palabras de 5+ letras que no están tal cual en
  // ningún nombre (así nada de lo que ya se encontraba cambia) y nunca palabras de pregunta o de relleno. «sal» no encuentra «sol».
  const names = list.map((p) => norm(p.nombre));
  const fuzzy = new Set(words.filter((w) => w.length >= NEAR_MIN && !BRAND_SKIP.has(w) && !names.some((n) => n.includes(w))));
  const toks = fuzzy.size ? names.map(nameTokens) : null;
  const rank = (f) => list.map((p, i) => { const n = f(names[i]); return { p, s: words.filter((w) => n.includes(f(w)) || (fuzzy.has(w) && toks[i].some((t) => nearWord(w, t)))).length }; }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.p);
  const exact = rank((x) => x);
  return exact.length ? exact : rank(soundK);
}
// Tolerancia de una letra (distinta, de más o de menos) y letras dobles («lavvaggi», «lavagi»), con loose (b/v, c/s/z, ll/y…). Solo si las
// DOS palabras tienen 5+ letras: en palabras cortas una letra cambia el producto («sal»/«sol», «pan»/«pin»).
const NEAR_MIN = 5;
const nameTokens = (n) => n.split(/[^a-z0-9]+/).filter((t) => t.length >= NEAR_MIN && !/\d/.test(t));
const single = (w) => loose(w).replace(/(.)\1+/g, '$1');
function nearWord(a, b) {
  if (a.length < NEAR_MIN || b.length < NEAR_MIN) return false;
  const x = single(a), y = single(b); if (x === y) return true;
  if (Math.abs(x.length - y.length) > 1) return false;
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  if (x.length === y.length) return x.slice(i + 1) === y.slice(i + 1);
  return x.length > y.length ? x.slice(i + 1) === y.slice(i) : x.slice(i) === y.slice(i + 1);
}
export const PRODUCT_MATCH_ROWS = 8;
// (seguimiento de #1001, revisiones de #1005, decisión de alfa) El aviso «No tengo esa marca» sale SOLO si la marca no está en ningún nombre
// del catálogo (missingBrand, igual que la base); si está, aunque sea con otro tipo, la lista es la de la base, completa y sin aviso: nunca
// se dice que algo no está cuando sí está. El tipo dicho solo acota «lo más parecido» cuando hay aviso: «fideo pastalindo» sugiere fideos.
// Tipo = la PRIMERA palabra con contenido de lo pedido. Un producto es de ese tipo si CUALQUIER palabra de su nombre es la palabra (o su
// plural) o una abreviatura de 3+ letras que es su comienzo, con o sin punto («FID.», «DET», «JAB.BOLIVAR», «GLORIA LECHE CONDENSADA»).
// SAL y PAN no valen como abreviatura (son productos: «salsa», «paneton»), y la ñ no se vuelve n («pañal» no es «pan»).
const NOT_ABBR = new Set(['sal', 'pan']);
const normT = (s) => String(s || '').toLowerCase().replace(/ñ/g, '\u0001').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0001/g, 'ñ');
const typeWords = (s) => normT(s).split(/[^a-z0-9ñ]+/).filter(Boolean);
const isTypeWord = (t, w) => t === w || stem(t) === w || (t.length >= 3 && t.length < w.length && !NOT_ABBR.has(t) && !/\d/.test(t) && w.startsWith(t));
export function productTypeOf(list, text) {
  const all = Array.isArray(list) ? list : [];
  const first = typeWords(text).find((w) => w.length >= 3 && !/\d/.test(w) && !FILLER.has(w) && !BRAND_SKIP.has(w) && !HONORIFIC.has(w));
  if (!first) return null;
  const w = stem(first), sub = all.filter((p) => typeWords(p.nombre).some((t) => isTypeWord(t, w)));
  return sub.length ? { word: w, list: sub } : null;
}
export function productMatches(list, text) {
  const all = Array.isArray(list) ? list : [];
  const hits = matchProducts(all, text), marca = missingBrand(all, text);
  if (!marca) return { hits, marca };
  const tipo = productTypeOf(all, text);
  if (!tipo) return { hits, marca };
  const near = matchProducts(tipo.list, text), seen = new Set(near), sub = [...near, ...tipo.list.filter((p) => !seen.has(p))];
  if (all.truncated) sub.truncated = true;
  return { hits: sub, marca };
}
// (auditoría 500, INV-047 / INV-008) Marca que la tienda NO tiene: «fideo lavaggi», «cerveza pilsen». matchProducts encuentra los fideos o
// las cervezas por la palabra genérica y antes se listaban en silencio, como si fueran la marca pedida. missingBrand dice (true/false) si
// alguna palabra distintiva («Lavaggi») no aparece en NINGÚN nombre del catálogo (ni exacta, ni sonando igual, ni con una letra de
// diferencia en palabras de 5+ letras). La palabra nunca se devuelve: el aviso es fijo (BRAND_NOTICE). No cuentan: palabras
// genéricas que sí coinciden (fideo, arroz), tamaños y números («5kg», «500»), palabras de pregunta o de relleno, ni nombres de persona
// (la palabra que sigue a «don», «doña», «señora»… nunca se toma como marca). Solo se usa cuando HAY parecidos (si no, «No encontré…»).
const BRAND_SKIP = new Set(('cuanto cuanta cuantos cuantas tanto tanta tantos tantas queda quedan quedo quedaba tengo tiene tienes tienen tenemos tenia tendras tendra hay habia '
  + 'stock sale salen salio sali esta estan estaba estoy porque precio precios cuesta cuestan vale valen marca marcas producto productos unidad unidades unid '
  + 'kilo kilos litro litros gramo gramos paquete paquetes bolsa bolsas botella botellas lata latas sixpack pack docena docenas sobre sobres saco sacos frasco '
  + 'frascos tarro tarros grande grandes chico chica chicos chicas mediano mediana pequeno pequena familiar personal negativo negativos negativa cero '
  + 'entera entero evaporada descremada light integral blanco blanca rubia rubio extra superior especial normal natural original clasico clasica sabor sabores '
  + 'rojo roja azul verde negra negro amarillo amarilla dorada dorado fresca fresco nuevo nueva todo toda todos todas otro otra otros otras mismo misma ahora '
  + 'ayer dime dame muestra muestrame mira revisa busca buscame consulta cual cuales donde como cuando aqui tienda almacen inventario mucho mucha muchos muchas '
  + 'poco poca pocos pocas solo sola algo alguna alguno algunos ningun ninguna tambien bien favor porfa porfavor explica explicame sabes saber quiero queria '
  + 'necesito vender vendo vendi compre comprar compra llego llegaron falta faltan negativo menos mas hola buenas buenos dias tardes noches gracias '
  + 'nombre oculto oculta cliente clientes codigo '
  // (seguimiento de #1001) palabras que describen el producto, no la marca: «pan de molde», «leche deslactosada», «pan tajado».
  + 'molde tajado tajada semidescremada semidescremado deslactosada deslactosado descremado regular simple doble triple dulce salado salada '
  + 'picante suave mini jumbo economico economica granel').split(' '));
// Más suelto que soundK (solo para decidir si FALTA la marca: suelto = menos avisos falsos): «cerbesa» = «cerveza», «yuca» = «lluca».
const loose = (s) => soundK(String(s || '').replace(/c(?=[ei])/g, 's').replace(/z/g, 's').replace(/v/g, 'b').replace(/ll/g, 'y').replace(/h/g, ''));
const HONORIFIC = new Set(['don', 'dona', 'senor', 'senora', 'senorita', 'sr', 'sra', 'srta', 'srita', 'sres']);
// Palabras que podrían ser marca (mismas reglas de siempre: ni nombres de persona tras «don», «doña»…, ni tamaños, ni palabras de pregunta).
function brandWordsOf(text) {
  const out = []; let afterHonorific = 0;
  for (const tok of String(text || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const w = norm(tok);
    if (HONORIFIC.has(w)) { afterHonorific = 3; continue; }
    if (afterHonorific > 0) { afterHonorific--; continue; }
    if (w.length < 4 || /\d/.test(w) || FILLER.has(w) || BRAND_SKIP.has(w) || BRAND_SKIP.has(stem(w))) continue;
    out.push(stem(w));
  }
  return out;
}
// ¿La palabra (ya en raíz) está en algún nombre? Tal cual, sonando igual o con una letra de diferencia (5+ letras).
function hasWord(names, st) {
  const k = loose(st);
  return names.some((n) => n.includes(st) || loose(n).includes(k)) || names.some((n) => nameTokens(n).some((t) => nearWord(st, t)));
}
export function missingBrand(list, text) {
  const names = (Array.isArray(list) ? list : []).map((p) => norm(p.nombre));
  return brandWordsOf(text).some((st) => !hasWord(names, st));
}
// (decisión de alfa, revisión de #1001) el aviso NUNCA repite la palabra escrita: podía ser un nombre de persona («arroz rosa», «fideo de
// pedro», «arroz que fió juan quispe»). Texto fijo, sin nada de la persona: no llega al resumen, al aviso, al empleado ni al modelo.
export const BRAND_NOTICE = 'No tengo esa marca; lo más parecido es lo de la lista.';
export const BRAND_NOTICE_LEAD = 'No tengo esa marca; lo más parecido es: ';
// ¿La respuesta ya dice «No tengo …»? (sin tildes ni mayúsculas)
export const saysNoBrand = (reply) => /\bno tengo\b/.test(norm(reply));
// ¿La consulta trae el aviso estructurado de marca que no está? (Admin y empleado)
export function brandNoticeOf(resumen) {
  const list = resumen && Array.isArray(resumen[NOTICES]) ? resumen[NOTICES] : [];
  return list.map(cleanNotice).some((x) => x && x.tipo === 'marca_no_encontrada');
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
  // (seguimiento PR #984) dateWordRange sin future: «para mañana» no es fecha aquí, queda la ventana de 30 días de siempre.
  if (dateWordRange(args?.periodo, nowMs) || DATE.test(args?.desde || '') || DATE.test(args?.hasta || '') || dateWordRange(args?.desde, nowMs) || dateWordRange(args?.hasta, nowMs)) return period(args, nowMs); // fecha o palabra de fecha: la de period()
  const hasta = limaToday(nowMs); return period({ desde: addDays(hasta, -(SUGGEST_RULES.diasVentas - 1)), hasta }, nowMs);
}
// Devuelve { tipo, titulo, columnas, filas, texto, resumen } o { error }.
// filas/columnas: para la pantalla del dueño. resumen: lo único que ve el modelo (chico, sin datos personales).
// (auditoría de ventas 23-10) Consultas de ventas por período: las fechas se revisan ANTES de leer (periodCheck). Fecha que no existe o
// período entero en el futuro: se contesta con el aviso, sin leer la base. Período recortado (más de 92 días o hasta una fecha futura):
// se consulta el recortado y el aviso va al final del texto (respuesta directa) y en resumen.aviso (lo que lee el modelo).
const DATE_CHECK_TYPES = Object.freeze(['ventas_periodo', 'top_productos', 'ganancia', 'ventas_por_hora', 'productos_sin_ventas']);
export async function runAssistantQuery(reader, args, nowMs = Date.now()) {
  const tipo = QUERY_TYPES.includes(args?.tipo) ? args.tipo : null;
  if (!tipo || !DATE_CHECK_TYPES.includes(tipo)) return runQuery(reader, args, nowMs, null);
  const chk = periodCheck(args, nowMs);
  if (chk.aviso) return { tipo, titulo: TITLES[tipo], columnas: [], filas: [], texto: chk.aviso,
    resumen: { ...(chk.fecha_futura ? { desde: chk.desde, hasta: chk.hasta, fecha_futura: true } : { fecha_invalida: true }), aviso: chk.aviso, [NOTICES]: [chk.notice] } };
  // Recortado: las demás consultas reciben las fechas ya recortadas (mismo período que dice el aviso).
  const a = chk.avisos.length ? { ...args, periodo: undefined, fecha: undefined, desde: chk.p.desde, hasta: chk.p.hasta } : args;
  const r = await runQuery(reader, a, nowMs, chk.p);
  if (r && !r.error && chk.avisos.length) {
    const aviso = chk.avisos.join(' ');
    r.texto = (typeof r.texto === 'string' && r.texto ? r.texto + ' ' : '') + aviso;
    r.resumen = { ...(r.resumen || {}), aviso: [r.resumen?.aviso, aviso].filter(Boolean).join(' '), ...(chk.pedido ? { periodo_pedido: chk.pedido } : {}),
      [NOTICES]: [...(Array.isArray(r.resumen?.[NOTICES]) ? r.resumen[NOTICES] : []), ...chk.notices] };
  }
  return r;
}
async function runQuery(reader, args, nowMs, checked) {
  const tipo = QUERY_TYPES.includes(args?.tipo) ? args.tipo : null;
  if (!tipo) return { error: 'bad_query' };
  const N = QUERY_LIMITS.topRows, M = QUERY_LIMITS.modelRows, base = { tipo, titulo: TITLES[tipo] };
  // truncado: la lectura se cortó (lista larga). Lo usa el chat para NO contestar directo con texto (va la segunda llamada al modelo).
  if (tipo === 'caja_abierta') return cajaAbierta(reader, base);
  if (['stock_producto', 'bajo_stock', 'sin_costo'].includes(tipo)) {
    const list = await reader.products(), note = list.truncated ? ' (lista larga: se revisaron los primeros ' + list.length + ')' : '';
    if (list.truncated) base.truncado = true;
    if (tipo === 'stock_producto') {
      // (lote en vivo 22-10) nombre a medias («leche Gloria», «aceite»): se listan TODOS los parecidos (hasta 8) con precio y costo,
      // para que el asistente muestre opciones en vez de preguntar «¿cuál?». El costo solo queda para el Admin: employeeQueryResult lo quita.
      // «fideo marcos»: si la marca no está, lo más parecido es del tipo dicho (seguimiento de #1001 y revisión de #1005)
      const { hits: all, marca } = productMatches(list, args.producto || ''), hits = all.slice(0, PRODUCT_MATCH_ROWS);
      if (!hits.length) return { ...base, columnas: [], filas: [], texto: 'No encontré ese producto.', resumen: { encontrados: 0 } };
      const filas = hits.map((p) => [p.nombre, p.controla ? r2(p.stock) : 'sin control', r2(p.min), p.precio, p.costo]);
      // marca: INV-047 / INV-008, «No tengo esa marca; lo más parecido es: …» (sin repetir la palabra)
      return { ...base, columnas: ['Producto', 'Stock', 'Mínimo', 'Precio S/', 'Costo S/'], filas, total: all.length,
        texto: (marca ? BRAND_NOTICE_LEAD : '') + sentences(hits.map((p) => p.nombre + (p.precio != null ? ' (S/ ' + Number(p.precio).toFixed(2) + ')' : '') + ': ' + (p.controla ? stockLabel(p.stock) : 'sin control de stock'))),
        resumen: { encontrados: all.length, productos: hits.map((p) => ({ ...(p.controla ? stockForModel(p) : { nombre: p.nombre, stock: null, minimo: r2(p.min) }), precio: p.precio, costo: p.costo })),
          ...(marca ? { marca_no_encontrada: true, aviso: BRAND_NOTICE, [NOTICES]: [{ tipo: 'marca_no_encontrada' }] } : {}) } };
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
    const p = checked || period(args, nowMs), rango = p.desde === p.hasta ? p.desde : p.desde + ' a ' + p.hasta;
    if (tipo === 'ventas_periodo') {
      const rows = await reader.salesTotals(p); let total = 0, n = 0; const byDay = new Map(), byM = new Map();
      for (const r of rows) { total += Number(r.c); n += Number(r.n); byDay.set(r.dia, (byDay.get(r.dia) || 0) + Number(r.c)); byM.set(r.metodo, (byM.get(r.metodo) || 0) + Number(r.c)); }
      const metodos = [...byM.entries()].sort((a, b) => b[1] - a[1]).map(([m, c]) => [METODO[m] || m, cents(c)]);
      const dias = [...byDay.entries()].map(([d, c]) => [d, cents(c)]);
      const filas = [...metodos.map((m) => ['Método: ' + m[0], m[1]]), ...(dias.length > 1 ? dias.slice(-31).map((d) => ['Día ' + d[0], d[1]]) : [])];
      const best = dias.slice().sort((a, b) => b[1] - a[1])[0];
      // (VEN-048) peor día: solo en rangos de varios días, contando los días SIN ventas (S/ 0) de Lima; si hay empate, el primero.
      // Hoy (aún abierto) no entra si el rango llega a hoy. Sin ventas en todo el rango: null (no hay «peor» que decir).
      let worst = null, sinVentas = 0;
      if (p.desde !== p.hasta && n) {
        const today = limaToday(nowMs), last = p.hasta >= today ? addDays(today, -1) : p.hasta;
        for (let d = p.desde; d <= last; d = addDays(d, 1)) { const c = byDay.get(d) || 0; if (!c) sinVentas++; if (!worst || c < worst.c) worst = { d, c }; }
      }
      return { ...base, titulo: 'Ventas ' + rango, columnas: ['Detalle', 'S/'], filas, total: cents(total), ventas: n, desde: p.desde, hasta: p.hasta,
        texto: n ? 'Ventas ' + rango + ': S/ ' + cents(total).toFixed(2) + ' en ' + n + (n === 1 ? ' venta' : ' ventas') + '. Ticket promedio S/ ' + (cents(total) / n).toFixed(2) + '.' : 'No hay ventas registradas ' + rango + '.',
        resumen: { desde: p.desde, hasta: p.hasta, total_soles: cents(total), ventas: n, por_metodo: Object.fromEntries(metodos), mejor_dia: best ? { dia: best[0], soles: best[1] } : null, dias: dias.length,
          peor_dia: worst ? { dia: worst.d, soles: cents(worst.c) } : null, ...(worst ? { dias_sin_ventas: sinVentas } : {}) } };
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
    // (VEN-040) cuántos productos se vendieron en total (lo cuenta el lector). Antes la lista se cortaba en N sin decirlo.
    // Sin cuenta del lector: si vino menos de N, la lista está completa; si no, no se sabe (null).
    const total = Number.isInteger(raw.total) ? Math.max(raw.total, filas.length) : raw.length < N ? filas.length : null, cut = total != null && total > filas.length;
    const corteN = cut ? { tipo: 'lista_cortada', mostrados: filas.length, total } : null, corte = corteN ? noticeText(corteN) : null;
    return { ...base, titulo: 'Más vendidos ' + rango, columnas: ['Producto', 'Unid.', 'S/'], filas, desde: p.desde, hasta: p.hasta, total,
      texto: (filas.length ? 'Más vendido ' + rango + ': ' + filas[0][0] + ' (' + filas[0][1] + ' unid., S/ ' + Number(filas[0][2]).toFixed(2) + ').' : 'No hay ventas ' + rango + '.') + (corte ? ' ' + corte : ''),
      // filas_en_pantalla: la tarjeta puede tener más filas que «top» (al modelo van M): así no cuenta «otros siete» si hay 9.
      resumen: { desde: p.desde, hasta: p.hasta, filas_en_pantalla: filas.length, productos_vendidos: total, lista_cortada: cut, ...(corte ? { aviso: corte, [NOTICES]: [corteN] } : {}),
        top: filas.slice(0, M).map((f) => ({ nombre: f[0], unidades: f[1], soles: f[2] })) } };
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
    texto: rows.length ? (rows.length === 1 ? 'Última compra' : 'Últimas ' + rows.length + ' compras') + '. La más reciente: ' + filas[0][0] + ', ' + filas[0][1] + ', S/ ' + Number(filas[0][3] || 0).toFixed(2) + '.' : NO_PURCHASES_TEXT,
    resumen: { ...(rows.length ? {} : { sin_dato: NO_PURCHASES_TEXT }), compras: rows.length, total_soles: r2(filas.reduce((s, f) => s + (f[3] || 0), 0)), recientes: filas.slice(0, M).map((f) => ({ fecha: f[0], proveedor: f[1], soles: f[3] })) } };
}

// ---------- Caja abierta (solo Admin) ----------
// Hora de Lima: los helpers de arriba (limaDateTime / limaDay), los mismos de todo el asistente.
const dmy = (iso) => { const c = limaDateTime(iso); return c ? c.slice(8, 10) + '/' + c.slice(5, 7) + '/' + c.slice(0, 4) : null; };
// (unión con #958: ahí «soles» devuelve el número; aquí el texto «S/ 0.00» de la caja)
const cajaSoles = (c) => 'S/ ' + cents(c).toFixed(2);
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
    texto: 'La caja todavía está abierta (desde ' + desde + '). Fondo ' + cajaSoles(o.opening_cents) + ', ventas ' + cajaSoles(ventasC) + ' en ' + ventasN + (ventasN === 1 ? ' venta' : ' ventas') +
      '. Efectivo esperado ahora: ' + cajaSoles(esperado) + '. Aún no hay cierre ni conteo.',
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
  if (per.futuro) return { ...base, columnas: [], filas: [], texto: per.futuro.aviso, resumen: { desde: per.futuro.desde, fecha_futura: true, aviso: per.futuro.aviso, [NOTICES]: [per.futuro.notice] } };
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
// y cuál vence primero. Usa la misma lectura canónica de créditos que deudas_clientes (reader.credits, sin SQL aparte). Nunca nombre, DNI ni teléfono (el aparato del Admin pone el nombre de SU lista con el código).
async function customerDebtQuery(reader, args, base) {
  const { customerCode } = await import('./pos-assistant.js');
  const code = customerCode(args?.cliente_id) ?? customerCode(args?.cliente);
  if (!code) return { ...base, columnas: [], filas: [], texto: 'Dime el código del cliente (aparece como «cliente #código» en Clientes).', resumen: { falta: 'cliente_id' } };
  const ref = 'cliente #' + code, credits = await reader.credits();
  let mine = credits.filter((c) => String(c.cliente) === code);
  if (!mine.length) mine = credits.filter((c) => String(c.cliente).toLowerCase() === code.toLowerCase());
  const open = mine.filter((c) => Number(c.saldo) > 0).sort((a, b) => String(a.vence || '9999').localeCompare(String(b.vence || '9999')));
  const total = r2(open.reduce((s, c) => s + Number(c.saldo), 0)), first = open.find((c) => c.vence)?.vence || null;
  let known = mine.length > 0;
  if (!known && typeof reader.customers === 'function') { const cs = await reader.customers(); known = cs.some((c) => String(c.id) === code || String(c.id).toLowerCase() === code.toLowerCase()); }
  const texto = open.length
    ? ref + ' debe S/ ' + total.toFixed(2) + ' en ' + open.length + (open.length === 1 ? ' crédito abierto' : ' créditos abiertos') + (first ? '; el primero vence el ' + first : '') + '.'
    : known ? ref + ' no tiene deudas pendientes.' : 'No encontré deudas de ' + ref + '. Revise el código en Clientes.';
  return { ...base, titulo: 'Deuda de ' + ref, columnas: ['Vence', 'Saldo S/'], filas: open.slice(0, QUERY_LIMITS.topRows).map((c) => [c.vence || '-', r2(c.saldo)]),
    ...(open.length > QUERY_LIMITS.topRows ? { total: open.length } : {}), texto,
    resumen: { cliente: ref, saldo_soles: total, creditos_abiertos: open.length, vence_primero: first } };
}

// Ventas por hora de Lima (período por defecto hoy): número y total por hora. Sin clientes ni productos.
async function hourlySalesQuery(reader, args, nowMs, base) {
  // «¿A qué hora vendo más?» sin fecha: esta semana (lunes a hoy, Lima), sin volver a preguntar el período.
  const noDate = !args?.periodo && !args?.fecha && !args?.desde && !args?.hasta;
  const p = period(noDate ? { ...args, periodo: 'esta_semana' } : args, nowMs), rango = rangeLabel(p), rows = (await reader.salesByHour(p)).filter((x) => x.n > 0);
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
