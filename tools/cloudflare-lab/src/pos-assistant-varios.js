// Auditoría 500 (ajustes y velocidad): avisos fijos del SERVIDOR para que nada se pierda en silencio.
// - VE-010: mensaje más largo que el tope -> se dice que se cortó, cuánto faltó y desde dónde (al modelo y a la persona).
// - AJ-043: varios movimientos de stock en un mensaje -> se dice cuáles quedaron sin tarjeta.
// - AJ-002: «todos los negativos a 10» -> cuántos productos están en negativo y que no existe un ajuste masivo.
// Cada aviso va en su PROPIA línea al final de la respuesta (no toca el texto de varias tarjetas ni la respuesta directa de consultas).
import { soundK } from './pos-assistant-queries.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// ---------- VE-010: mensaje cortado ----------
export const CUT_PREVIEW_CHARS = 60;
// full: texto ya limpio (antes del tope); max: tope de caracteres; rawLen: largo del texto que mandó el aparato.
export function cutInfo(full, max, rawLen) {
  if (full.length <= max) return null;
  const faltan = Math.max(full.length, rawLen || 0) - max;
  const desde = full.slice(max).replace(/\s+/g, ' ').trim().slice(0, CUT_PREVIEW_CHARS);
  return { leidos: max, faltan, desde };
}
export function cutModelMessage(cut) {
  return { role: 'system', content: 'MENSAJE CORTADO: el mensaje de la persona era más largo que ' + cut.leidos + ' caracteres; faltaron unos ' + cut.faltan +
    ' que NO te llegaron. Atiende solo lo que sí llegó, no adivines lo que faltó y pide que mande el resto en otro mensaje.' };
}
export function cutUserText(cut) {
  return 'Tu mensaje era muy largo: leí solo los primeros ' + cut.leidos + ' caracteres. Quedó fuera desde «' + cut.desde + (cut.faltan > CUT_PREVIEW_CHARS ? '…' : '') +
    '» (unos ' + cut.faltan + ' caracteres). Mándame esa parte en otro mensaje.';
}

// ---------- AJ-043: varios movimientos en un mensaje ----------
// Verbos de MOVIMIENTO de stock (no de precio). Con «precio», «costo» o «S/» en el mensaje no se mira (eso es otra cosa).
const MOVE_RE = /(?<![a-z])(?:entrada|salida|ingres\w*|agreg\w*|aument\w*|sum\w*|rest\w*|quit\w*|descont\w*|sobr\w*|romp\w*|rompi\w*|venc\w*|devol\w*|devuel\w*|merma\w*|conte|conto|contamos|ajust\w*|saca\w*|mete\w*)(?![a-z])/;
const NOT_MOVE_RE = /(?<![a-z])(?:precio\w*|costo\w*|cuesta\w*|vende\w*|soles)(?![a-z])|s\/\s*\d/;
const STOP = new Set(['entrada', 'salida', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'uno', 'unos', 'unas', 'al', 'a', 'en', 'y', 'e', 'o', 'por', 'favor', 'con', 'mas', 'menos',
  'unid', 'unidad', 'unidades', 'und', 'uds', 'paquete', 'paquetes', 'caja', 'cajas', 'bolsa', 'bolsas', 'kg', 'kilo', 'kilos', 'litro', 'litros', 'me', 'se', 'le', 'les', 'lo',
  'otra', 'otro', 'otras', 'otros', 'tambien', 'ademas', 'luego', 'despues', 'stock', 'inventario', 'que', 'hay', 'pon', 'ponle', 'dale', 'haz', 'hazme',
  // (INV-045) relleno de un conteo: «… pero el sistema dice 4, ponlo en 0» no nombra otro producto.
  'pero', 'sistema', 'dice', 'dijo', 'marca', 'sale', 'figura', 'tiene', 'esta', 'estan', 'queda', 'quede', 'todo', 'todos', 'toda', 'todas', 'mejor', 'ahora', 'nomas', 'solo',
  'mismo', 'misma', 'igual', 'ese', 'esa', 'eso', 'este', 'esto', 'cero', 'nada']);
// (INV-045) verbo con pronombre pegado («ponlo», «déjalo», «súbelo», «bájalo», «ajústalo», «cámbialo», «súmale»…): sigue hablando del MISMO producto.
const CLITIC_VERB_RE = /^(?:pon|pong|dej|sub|baj|ajust|cambi|llev|cuadr|corrig|correg|arregl|agreg|aument|sum|rest|quit|descont|sac|met|carg|anot|registr|actualiz|hac|haz|marc)(?:a|e|ie)?(?:lo|la|los|las|le|les)$/;
// Partes «verbo número producto» separadas por coma, punto y coma, salto de línea o « y » antes de otro verbo o número.
export function adjustRequests(text) {
  const t = norm(text);
  if (!MOVE_RE.test(t) || NOT_MOVE_RE.test(t)) return [];
  const raw = String(text || '');
  const parts = raw.split(/[,;\n]+|\s+y\s+(?=(?:entrada|salida|\d))/i).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const n = norm(part);
    if (!/\d/.test(n)) continue;
    const words = n.split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !/^\d/.test(w) && !STOP.has(w) && !MOVE_RE.test(w) && !CLITIC_VERB_RE.test(w));
    if (words.length) out.push({ texto: part.slice(0, 80), palabras: words });
  }
  return out.length >= 2 ? out : [];
}
const stem = (w) => (w.length >= 5 && w.endsWith('es') && !/[aeiou]es$/.test(w) ? w.slice(0, -2) : w.length >= 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const nameHas = (nombre, w) => { const n = soundK(norm(nombre)); return n.includes(soundK(stem(w))); };
// Partes sin tarjeta de ajuste (ni aviso propio, como «sin control de stock»). names: nombres de productos con tarjeta o con aviso.
export function unattendedRequests(reqs, names) {
  return reqs.filter((r) => !names.some((nm) => r.palabras.some((w) => nameHas(nm, w))));
}
export function unattendedText(list) {
  const q = list.map((r) => '«' + r.texto + '»');
  return 'Sin tarjeta todavía: ' + (q.length > 1 ? q.slice(0, -1).join(', ') + ' y ' + q[q.length - 1] : q[0]) + '. Dímelo de nuevo, uno por uno, o hazlo en Inventario > producto > Movimiento.';
}
export const MULTI_ADJUST_RULE = 'VARIOS MOVIMIENTOS EN UN MENSAJE: usa proponer_ajuste_stock una vez por CADA producto pedido, no solo el primero. Si alguno no lo puedes preparar, di cuál quedó sin tarjeta.';

// ---------- AJ-002: todos los negativos ----------
export const NEGATIVE_BULK_RE = /(?<![a-z])tod[oa]s?\s+(?:l[oa]s\s+)?(?:productos?\s+|articulos?\s+)?(?:que\s+(?:estan|tienen|quedan)\s+(?:en\s+)?)?(?:en\s+)?negativ\w*|(?<![a-z])l[oa]s\s+(?:productos?\s+)?negativ\w*\s+(?:a|en|todos)(?![a-z])/;
const SET_VERB_RE = /(?<![a-z])(?:pon\w*|dej\w*|ajust\w*|llev\w*|corrig\w*|correg\w*|arregl\w*|sub\w*|cuadr\w*|cambi\w*|iguala\w*|reset\w*|lleva\w*)(?![a-z])/;
export function asksNegativeBulk(text) { const t = norm(text); return NEGATIVE_BULK_RE.test(t) && SET_VERB_RE.test(t); }
export const NEGATIVE_BULK_RULE = 'TODOS LOS NEGATIVOS: no existe un ajuste masivo. Di cuántos productos están en negativo y prepara una tarjeta por producto (o indica Inventario); nunca saltes uno sin decirlo.';
const MAX_NAMES = 5;
// products: lectura del servidor (o null si falló). cardIds: product_id con tarjeta de ajuste.
export function negativeBulkText(products, cardIds) {
  const base = 'No existe un ajuste masivo: cada producto va con su propia tarjeta o se corrige en Inventario.';
  if (!Array.isArray(products)) return base;
  const neg = products.filter((p) => p && p.controla !== false && Number.isFinite(Number(p.stock)) && Number(p.stock) < 0);
  if (!neg.length) return 'No hay productos con stock negativo ahora. ' + base;
  const ids = new Set((cardIds || []).map(String)), sin = neg.filter((p) => !ids.has(String(p.id)));
  let t = 'Hay ' + neg.length + (neg.length === 1 ? ' producto con stock negativo. ' : ' productos con stock negativo. ') + base;
  if (sin.length) t += ' Sin tarjeta: ' + sin.slice(0, MAX_NAMES).map((p) => p.nombre).join(', ') + (sin.length > MAX_NAMES ? ' y ' + (sin.length - MAX_NAMES) + ' más' : '') + '.';
  return t;
}
