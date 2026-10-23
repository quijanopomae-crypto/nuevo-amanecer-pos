// Auditoría 500 (caja y clientes, 23-10): respuestas que contestan LO QUE SE PREGUNTÓ cuando el dato ya está en la consulta.
// Sin lecturas propias ni escrituras: solo mira el texto de la persona, la consulta que eligió el modelo y el resultado ya leído.
// - «ayer» con la caja (cierre de ayer, comparar la caja de hoy con ayer): resumen_dia del día anterior en Lima, nunca la caja abierta de HOY.
// - gastos / devoluciones / cobros / métodos de pago (caja abierta o resumen del día) / quién debe más: una frase con ESE monto.
//   Alcance: solo caja_abierta, resumen_dia y deudas_clientes; precios, márgenes, stock y fechas de ventas_periodo no se tocan.
// - límite de crédito: no existe todavía; se dice claro (no se responde con la deuda como si fuera el límite).

const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const soles = (v) => 'S/ ' + (Number(v) || 0).toFixed(2);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// ---------- «ayer» ----------
const AYER_RE = /\bayer\b/;
const ANTIER_RE = /\b(?:antier|anteayer|antes\s+de\s*ayer)\b/;
const HOY_RE = /\bhoy\b/;
// ¿Pregunta por ayer (o anteayer)? 'ayer' | 'antier' | 'hoy' (= comparar hoy con ayer) | null
export function yesterdayAsk(text) {
  const t = fold(text);
  if (ANTIER_RE.test(t)) return 'antier';
  if (!AYER_RE.test(t)) return null;
  return HOY_RE.test(t) ? 'hoy' : 'ayer'; // «hoy con/vs ayer»: el resumen de hoy ya trae el día anterior al lado
}
const COBROS_RE = /\bcobr|\babon|pagaron\s+(?:lo\s+)?(?:fiad|deud|credit)|\bpagos?\s+de\s+(?:fiad|credit|deud)/;
// Gastos, devoluciones, ingresos/egresos de la caja: solo caja_abierta los trae.
const CAJA_ONLY_RE = /\bgast|devol|anulaci|\bingres(?:o|aron)|\begres|retir(?:e|o|aron)\s+de\s+(?:la\s+)?caja|sacaron\s+de\s+(?:la\s+)?caja/;
// La consulta que el modelo eligió, corregida por la pregunta (solo Admin). null = se queda como vino.
export function retargetCajaQuery(query, text) {
  if (!query || typeof query !== 'object') return null;
  const tipo = query.tipo, per = String(query.periodo || '').toLowerCase(), y = yesterdayAsk(text);
  // La caja abierta es SOLO la de hoy: «ayer» / «compara con ayer» -> resumen del día (el de hoy ya trae el día anterior al lado).
  if (y && tipo === 'caja_abierta') return { tipo: 'resumen_dia', periodo: y };
  // (alcance) ventas_periodo con fechas no se toca aquí: eso es de la rama de ventas.
  // Gastos / devoluciones / ingresos / egresos de HOY pedidos con ventas o resumen: la caja abierta (ahí están).
  const ft = fold(text), cajaAsk = CAJA_ONLY_RE.test(ft) || (tipo === 'ventas_periodo' && COBROS_RE.test(ft)); // el resumen del día sí trae cobros
  if (!y && cajaAsk && (tipo === 'ventas_periodo' || tipo === 'resumen_dia') && (!per || per === 'hoy') && !query.fecha && !query.desde) return { tipo: 'caja_abierta' };
  return null;
}
// La llamada a consultar del modelo con la consulta corregida (los mismos argumentos van a la segunda llamada); otra herramienta: igual.
export function retargetCall(c, text) {
  if (!c || c.name !== 'consultar') return c;
  let a = c.arguments; if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return c; } }
  const q = retargetCajaQuery(a, text);
  return q ? { ...c, arguments: JSON.stringify(q) } : c;
}
// Instrucción breve SOLO cuando la pregunta la necesita (el primer envío del Admin tiene tope de tamaño).
export const AYER_RULE = 'CAJA O CIERRE DE AYER: consultar resumen_dia periodo «ayer»; comparar la caja de hoy con ayer -> resumen_dia periodo «hoy» (trae el día anterior). caja_abierta es solo la caja de hoy.';
export const CAJA_DETALLE_RULE = 'GASTOS, DEVOLUCIONES, COBROS, INGRESOS O EGRESOS DE HOY: consultar caja_abierta (los trae); responde ese monto, y si es 0 di que no hubo.';
const CAJA_DETALLE_ASK = /\bgast|devol|anulaci|\bcobr|\bingres(?:o|aron)|\begres/;
export function cajaPromptLines(text) {
  const t = fold(text), out = [];
  if (yesterdayAsk(text) && /caja|cierre|cerr/.test(t)) out.push(AYER_RULE);
  else if (CAJA_DETALLE_ASK.test(t)) out.push(CAJA_DETALLE_RULE);
  return out;
}

// ---------- texto enfocado ----------
const METHODS = [['efectivo', /\befectivo\b|\bcash\b/, 'Efectivo'], ['yape', /\byape\b/, 'Yape'], ['plin', /\bplin\b/, 'Plin'],
  ['transferencia', /transferencia/, 'Transferencia'], ['credito', /\bcredito\b|\bfiad[oa]s?\b|\bfiar\b|\bfie\b/, 'Crédito']];
const DEBE_MAS_RE = /quien(?:es)?\s+(?:me\s+)?debe|debe\s+mas|mas\s+(?:me\s+)?debe|mayor\s+deud|deuda\s+mas\s+(?:alta|grande)/;

function methodMap(query, r) {
  const res = r && r.resumen ? r.resumen : {};
  const pm = query.tipo === 'resumen_dia' || query.tipo === 'resumen_mes' ? (res.actual && res.actual.por_metodo) : res.por_metodo;
  return pm && typeof pm === 'object' ? pm : null;
}
function cajaFocus(t, res) {
  if (!res || res.caja_abierta !== true) return null;
  const out = [];
  if (COBROS_RE.test(t)) {
    const ef = num(res.cobros_efectivo_soles) || 0, dig = num(res.cobros_digitales_soles) || 0;
    out.push(ef || dig ? 'Cobros de crédito en esta caja: ' + soles(ef) + ' en efectivo (eso sí entra a la caja)' + (dig ? ' y ' + soles(dig) + ' por Yape, Plin o transferencia (no entran como efectivo)' : '') + '.'
      : 'No hubo cobros de crédito desde que se abrió la caja.');
  }
  if (/\bgast/.test(t)) {
    const ef = num(res.gastos_efectivo_soles) || 0, tot = num(res.gastos_total_soles) || 0, n = num(res.gastos) || 0;
    out.push(n || ef || tot ? 'Gastos de hoy en la caja: ' + soles(ef) + ' en efectivo' + (tot && tot !== ef ? ' (' + soles(tot) + ' en total con otros medios)' : '') + (n ? ', ' + n + (n === 1 ? ' gasto' : ' gastos') : '') + '.'
      : 'No hubo gastos desde que se abrió la caja.');
  }
  if (/devol|anulaci/.test(t)) {
    const d = num(res.devoluciones_anulacion_soles) || 0;
    out.push(d ? 'Devoluciones por anulación: ' + soles(d) + ' salieron de la caja.' : 'No hubo devoluciones por anulación desde que se abrió la caja (S/ 0.00).');
  }
  if (/\bingres(?:o|aron)/.test(t)) out.push('Ingresos de caja: ' + soles(res.ingresos_soles) + '.');
  if (/\begres|retir|sacaron/.test(t)) out.push('Egresos de caja: ' + soles(res.egresos_soles) + '.');
  return out;
}
function methodsFocus(t, query, r) {
  const asked = METHODS.filter(([, re]) => re.test(t));
  // «efectivo» solo, en la caja abierta, suele ser «cuánto efectivo hay»: eso ya lo dice el texto (efectivo esperado).
  if (!asked.length || (query.tipo === 'caja_abierta' && asked.length === 1 && asked[0][0] === 'efectivo' && !/vend|venta/.test(t))) return null;
  const pm = methodMap(query, r); if (!pm) return null;
  const parts = asked.map(([, , lab]) => lab + ' ' + soles(pm[lab] || 0));
  const cuando = query.tipo === 'caja_abierta' ? ' en la caja abierta' : '';
  let s = 'Ventas por método' + cuando + ': ' + parts.join(' · ') + '.';
  if (asked.some(([k]) => k === 'credito')) s += ' Lo vendido al crédito no entra como efectivo a la caja.';
  return s;
}
// Frase enfocada para el Admin (o null = el texto de siempre). r: el resultado completo de runAssistantQuery (con resumen).
export function focusedText(query, r, text) {
  if (!query || !r || r.error) return null;
  const t = fold(text), out = [];
  if (query.tipo === 'caja_abierta') { const c = cajaFocus(t, r.resumen); if (c) out.push(...c); }
  if (query.tipo === 'resumen_dia' && COBROS_RE.test(t) && r.resumen && r.resumen.actual && r.resumen.actual.cobros_soles != null) out.push('Cobros de créditos: ' + soles(r.resumen.actual.cobros_soles) + '.');
  // (alcance) métodos de pago solo sobre la caja abierta o el resumen del día; ventas_periodo queda con su texto de siempre.
  if (!COBROS_RE.test(t) && (query.tipo === 'caja_abierta' || query.tipo === 'resumen_dia')) { const m = methodsFocus(t, query, r); if (m) out.push(m); }
  if (query.tipo === 'deudas_clientes' && DEBE_MAS_RE.test(t) && Array.isArray(r.filas) && r.filas.length) out.push('Quien más debe es ' + r.filas[0][0] + ': ' + soles(r.filas[0][1]) + '.');
  if (query.tipo === 'resumen_dia' && query.periodo !== 'hoy' && yesterdayAsk(text) && /caja|cierre|cerr/.test(t)) out.push('El conteo y la diferencia del cierre de caja no los tengo aquí; se ven en la pantalla Caja.');
  return out.length ? out.join(' ') + ' ' + r.texto : null;
}

// ---------- límite de crédito ----------
const LIMIT_RE = /(?:limite|maximo|tope|cupo|linea)\s+(?:de\s+)?(?:credito|fiad|fiar|deuda)|(?:credito|fiad[oa]|fiar|deuda)\s+(?:\S+\s+){0,3}(?:limite|maximo|tope|cupo)|(?:cuanto|hasta\s+cuanto|lo\s+maximo\s+que)\s+(?:\S+\s+){0,3}(?:puedo|podria|se\s+puede|debo)\s+(?:fiar|dar\s+(?:a\s+)?(?:credito|fiado))/;
export function creditLimitAsk(text) { return LIMIT_RE.test(fold(text)); }
export const CREDIT_LIMIT_TEXT = 'Los límites de crédito todavía no existen en el asistente ni en el sistema: no hay un máximo registrado para fiar a ningún cliente. Lo que debe cada cliente se ve en Clientes (ficha del cliente) y en el reporte de deudas.';
