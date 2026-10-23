// Auditoría 500 (precios, 23-10): cuando la frase nombra un producto, la tabla de stock ya no «gana».
// Sin lecturas propias ni escrituras: solo mira el texto de la persona, las tarjetas que propuso el modelo y la lista de productos
// que el servidor ya tiene (contexto del aparato + catálogo leído). La tarjeta de precio sigue siendo proponer_cambio_precio.
// - Pedido de cambio de precio (pon/sube/baja/cambia, «X a 4.50»): la segunda llamada puede proponer la tarjeta (nunca la tabla).
// - Varios productos coinciden y la frase no dice cuál: se pregunta cuál (no se adivina una tarjeta).
// - Sin monto («súbele al arroz»): se pregunta a cuánto; precio 0: se explica y se pregunta qué quiere.
// - «11.90… no, mejor 11.50»: una sola tarjeta con el último precio.
// - Precio por caja/paquete: el asistente no lo cambia (su tarjeta es el precio por unidad): pasos en la ficha.
// - Ofertas, promociones y descuentos por cliente o producto no existen: se dice claro, sin tarjeta.
// - «costo + 1.20»: la tarjeta lleva costo real + 1.20 (nunca precio + 1.20); sin costo registrado, se dice y no hay tarjeta.
// - Ranking de margen: no existe el margen % por producto; la consulta es ganancia (en soles, de lo vendido) y se aclara.
// - «¿cuánto subió el costo desde la última compra?»: no se guarda el costo anterior; se dice (con el costo actual), sin tarjeta.
// - Precio por unidad y por caja juntos («a 2.5 la unidad y la caja de 12 a 27»): la cuenta de referencia, sin guardar nada.
import { matchProducts } from './pos-assistant-queries.js';

const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const soles = (v) => 'S/ ' + (Number(v) || 0).toFixed(2);

const CHANGE_VERB = /\b(?:pon|ponle|ponlo|ponla|ponlos|ponlas|cambia|cambiale|cambialo|cambiala|sube|subele|subelo|subela|baja|bajale|bajalo|bajala|aumenta|aumentale|rebaja|rebajale|modifica|dejalo|dejala)\b/;
const RAISE_VERB = /\b(?:sube|subele|subelo|subela|baja|bajale|bajalo|bajala|aumenta|aumentale|rebaja|rebajale)\b/;
const AT_PRICE = /\ba\s+(?:s\/\.?\s*)?\d+(?:[.,]\d+)?\b/;
const QUESTION = /\?|\bcuanto|\bque\s+precio|\bsi\s+lo\s+vend|\bdeberia|\bconviene|\bpuedo\b/;
const STOCK_WORDS = /\bstock\b|\binventario\b|\bconte\b|\bcontamos\b|\bexistencias?\b/;
const AMOUNT = /\d|\b(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|medio)\s+(?:sol|soles|centimos?|cents?)\b|\bgratis\b|\bcero\b/;
export const BOX_WORDS = /\b(?:caja|cajas|paquete|paquetes|saco|sacos|six\s*pack|sixpack|docena|fardo|fardos|pack|display|tira)\b/;
const UNIT_PRICE_GIVEN = /\bunidad(?:es)?\s+(?:a|en)\s+(?:s\/\.?\s*)?\d/;
const OFFER = /\boferta|\bpromo(?:cion)?|\bcombo\b|\b\d+\s*x\s*\d+\s*(?:soles|sol)\b|\b2\s*x\s*1\b/;
const DISCOUNT_DO = /\b(?:haz|hazle|hacele|dale|dele|aplica|aplicale|pon|ponle|ponlo)\b[^.]*\bdescuento|\bdescuento\s+(?:a|al|para)\s+(?:#|cliente|el\s+cliente|la\s+clienta)/;
const DISCOUNT_DATA = /\bcuanto\s+(?:de\s+)?descuentos?\s+(?:di|dimos|he\s+dado|hemos\s+dado|hice|hicimos|se\s+dio|se\s+hizo)\b|\bdescuentos?\s+(?:que\s+)?(?:di|dimos|he\s+dado|hice)\b/;
const DISCOUNT_ANY = /\bdescuento/;
const IGV = /\bigv\b|\bimpuesto/;
const ZERO = /\ba\s+(?:s\/\.?\s*)?0(?:[.,]0+)?(?![\d.,])|\ba\s+cero\b|\bgratis\b/;
const MARGIN_RANK = /\b(?:mas|menos|mayor|menor)\s+(?:margen|ganancia)\b|\b(?:margen|ganancia)\s+(?:mas\s+alt|mas\s+baj|mayor|menor)|\b(?:mas|menos)\s+me\s+deja/;
const COST_HISTORY = /\bcuanto\s+(?:(?:me|le|les|ha|han|se)\s+)?(?:subio|subieron|bajo|bajaron|aumento|aumentaron|cambio|subido|bajado|aumentado)\s+(?:el\s+|los\s+)?costos?\b|\bcostos?\s+(?:anterior|de\s+antes|pasado)|\bdesde\s+la\s+(?:ultima|anterior)\s+compra/;
const COST_PLUS = /\bcosto\s*(?:\+|mas)\s*(?:s\/\.?\s*)?(\d+(?:[.,]\d+)?)/;
const UNIT_AT = /\b(?:a|en)\s+(?:s\/\.?\s*)?(\d+(?:[.,]\d+)?)\s+(?:soles\s+)?(?:la|cada)\s+unidad|\bunidad\s+(?:a|en)\s+(?:s\/\.?\s*)?(\d+(?:[.,]\d+)?)/;
const BOX_AT = /\b(?:caja|paquete|fardo|six\s*pack|pack|display)\s+(?:de\s+)?(\d+)\s*(?:unidades|unid\.?|u)?\s+(?:a|en)\s+(?:s\/\.?\s*)?(\d+(?:[.,]\d+)?)/;
const CORRECTION = /\bmejor\b|\bperdon\b|\bdigo\b|\bcorrijo\b|\bno,?\s+a\b/;

// ¿Pide CAMBIAR el precio? (no preguntas «¿a cuánto lo vendo?», no stock, no ofertas)
export function priceChangeAsk(text) {
  const t = fold(text);
  if (!t || STOCK_WORDS.test(t) || OFFER.test(t) || DISCOUNT_ANY.test(t)) return false;
  if (RAISE_VERB.test(t)) return true;
  if (CHANGE_VERB.test(t) && (AMOUNT.test(t) || /\bprecio\b/.test(t))) return true;
  return AT_PRICE.test(t) && !QUESTION.test(t);
}
export const priceAmountMissing = (text) => !AMOUNT.test(fold(text));
export const priceZeroAsk = (text) => priceChangeAsk(text) && ZERO.test(fold(text));
export const boxPriceAsk = (text) => BOX_WORDS.test(fold(text));
// Cambio del precio de la CAJA/paquete sin precio nuevo por unidad: la tarjeta (precio por unidad) no lo expresa.
export const boxPriceChange = (text) => priceChangeAsk(text) && boxPriceAsk(text) && !UNIT_PRICE_GIVEN.test(fold(text));
export const offerAsk = (text) => { const t = fold(text); return OFFER.test(t) || DISCOUNT_DO.test(t); };
export const discountDataAsk = (text) => DISCOUNT_DATA.test(fold(text));
export const discountAsk = (text) => DISCOUNT_ANY.test(fold(text));
// Para directQueryReply: la tabla de stock no contesta preguntas de precio, caja, descuento, oferta o IGV.
export const marginRankAsk = (text) => MARGIN_RANK.test(fold(text));
export const costHistoryAsk = (text) => COST_HISTORY.test(fold(text));
export const costPlus = (text) => { const m = fold(text).match(COST_PLUS); return m ? Number(m[1].replace(',', '.')) : null; };
// «a 2.5 la unidad y la caja de 12 a 27»: { unit, n, box } o null.
export function unitBoxPair(text) {
  const t = fold(text), u = t.match(UNIT_AT), b = t.match(BOX_AT);
  if (!u || !b) return null;
  const unit = Number((u[1] || u[2]).replace(',', '.')), n = Number(b[1]), box = Number(b[2].replace(',', '.'));
  return unit > 0 && n > 1 && box > 0 ? { unit, n, box } : null;
}
export function unitBoxNote({ unit, n, box }) {
  const full = Math.round(unit * n * 100) / 100, per = Math.round((box / n) * 100) / 100, pct = Math.round((1 - box / full) * 1000) / 10;
  return 'La cuenta: ' + n + ' × ' + soles(unit) + ' = ' + soles(full) + '; la caja a ' + soles(box) + ' sale a ' + soles(per) + ' la unidad (' + (pct >= 0 ? pct + ' % menos' : Math.abs(pct) + ' % más') + ' que suelta). No guardé nada.';
}
// Retoque de la consulta que eligió el modelo (solo Admin): ranking de margen -> ganancia (la única con margen por producto vendido).
export function retargetPriceCall(c, text) {
  if (!c || c.name !== 'consultar' || !marginRankAsk(text)) return c;
  let a = c.arguments; if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return c; } }
  if (!a || a.tipo === 'ganancia') return c;
  return { ...c, arguments: JSON.stringify({ tipo: 'ganancia', periodo: a.periodo && a.periodo !== 'hoy' ? a.periodo : 'este_mes' }) };
}
export const MARGIN_RANK_NOTE = 'Ojo: no hay un ranking de margen % por producto en el sistema; esto es la ganancia en soles de lo vendido en el período (con el costo actual de cada producto).';
export const COST_HISTORY_TEXT = 'No guardo el costo anterior de cada producto: solo su costo actual (ficha del producto) y las compras con su total (Inventario > Compras > Historial). Así que no puedo decirte cuánto subió ni subir el precio «igual».';
const costLine = (hits) => hits.filter((p) => p.costo != null && Number(p.costo) > 0).slice(0, 4).map((p) => p.nombre + ' ' + soles(p.costo)).join(' · ');
export const costHistoryText = (hits) => { const l = costLine(hits); return COST_HISTORY_TEXT + (l ? ' Costo actual: ' + l + '.' : '') + ' Si me dices el costo nuevo, te propongo el precio que mantiene tu ganancia.'; };
export const noCostText = (names) => names.map((n) => '«' + n + '» no tiene costo registrado, así que no puedo calcular costo + monto; ponle su costo en la ficha.').join(' ');
// ¿La respuesta del modelo ya dice lo de la nota? (no se repite)
export function noteCovered(note, reply) {
  const r = String(reply || '');
  if (note === DISCOUNT_NOTE) return /no existen?/i.test(r);
  if (note === MARGIN_RANK_NOTE) return /margen\s*%|no hay (?:un )?ranking|no existe (?:el )?margen/i.test(r);
  if (note === BOX_PRICE_NOTE || note === BOX_READ_NOTE) return /precio por caja/i.test(r);
  const per = String(note || '').match(/sale a S\/ (\d+\.\d\d) la unidad/);
  if (per) return r.includes(per[1]) || r.includes(per[1].replace(/0$/, ''));
  return false;
}
export const PRICE_TALK = /precio|\bcuesta|\bvale\b|\bvend[oe]\b|\bvenderlo|a\s+cu[aá]nto|\bcaja|\bpaquete|\bsaco|six\s*pack|docena|descuento|oferta|promo|\bigv\b|impuesto|\bsub[eií]|\bbaj[aá]|\bpon(?:le|lo|la|er)?\b|cambi/i;

export const OFFER_TEXT = 'Las ofertas, promociones y descuentos por cliente o por producto todavía no existen en el sistema, así que no los puedo programar ni guardar. Lo que sí puedes hacer: en Punto de Venta, con la venta armada, menú del carrito > «Aplicar descuento» (solo para esa venta); o cambiar el precio a mano en la ficha del producto y volver a dejarlo como estaba al terminar.';
export const DISCOUNT_DATA_TEXT = 'No tengo ese dato: el sistema todavía no guarda un registro de descuentos que yo pueda sumar. Los descuentos hechos con «Aplicar descuento» quedan dentro del total de cada venta, en su detalle.';
export const DISCOUNT_NOTE = 'Los descuentos por producto todavía no existen en el sistema (solo «Aplicar descuento» en cada venta, a mano).';
export const BOX_PRICE_TEXT = 'El precio por caja o paquete no lo cambio desde aquí: mi tarjeta solo cambia el precio por unidad, así que el de la unidad queda igual. Para la caja: Inventario > el producto > Editar, campo «Precio por caja (S/)», pon el nuevo precio y Guardar.';
export const BOX_PRICE_NOTE = 'El precio por caja o paquete no lo cambio desde aquí: va en la ficha del producto, campo «Precio por caja (S/)».';
export const BOX_READ_NOTE = 'El precio por caja o paquete no lo veo desde aquí: está en la ficha del producto, campo «Precio por caja (S/)», y en el documento Lista de precios.';
export const ZERO_PRICE_TEXT = 'No puedo poner el precio en 0: un producto con precio 0 se vendería gratis en cada venta. ¿Qué prefieres: dejar de venderlo (quitarlo de la venta) o regalarlo esta vez (eso se hace en la venta, con «Aplicar descuento»)?';

const listHits = (hits) => hits.slice(0, 6).map((p) => p.nombre + (p.precio != null ? ' (' + soles(p.precio) + ')' : '')).join(' · ');
export const whichProductText = (hits) => '¿Cuál de estos? ' + listHits(hits) + '. Dime cuál y a qué precio.';
export const amountAskText = (hits) => '¿A qué precio lo pongo?' + (hits.length > 1 ? ' Dime también cuál: ' + listHits(hits) + '.' : hits.length === 1 ? ' Ahora ' + hits[0].nombre + ' está en ' + soles(hits[0].precio) + '.' : '');

// «… y la pilsen igual»: la frase nombra otro producto (no «y la unidad», «y la caja»).
const NOT_PRODUCT = /^(?:unidad|unidades|caja|cajas|paquete|paquetes|saco|sacos|docena|otra|otro|otros|otras|misma|mismo|demas|resto)$/;
export function namesAnother(text) { const m = [...fold(text).matchAll(/\b(?:y|e)\s+(?:el|la|los|las|al|a\s+la)\s+([a-z0-9]+)/g)]; return m.some((x) => !NOT_PRODUCT.test(x[1])); }
// Productos que la frase nombra por igual (empate en el puntaje más alto de matchProducts).
export function tiedProducts(products, text) {
  // misma raíz que matchProducts («caramelos» -> «caramelo»)
  const stem = (w) => (w.length >= 5 && w.endsWith('es') && !/[aeiou]es$/.test(w) ? w.slice(0, -2) : w.length >= 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  const words = fold(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map(stem);
  const ranked = matchProducts(products || [], text);
  if (!ranked.length) return [];
  const score = (p) => words.filter((w) => w.length >= 3 && fold(p.nombre).includes(w)).length;
  const top = score(ranked[0]);
  return ranked.filter((p) => score(p) === top);
}
// De los empatados, los que comparten con el producto de la tarjeta una palabra de la frase (dos «arroz»). Productos distintos con su propia
// palabra («el arroz … y saca 2 de azúcar») no son «¿cuál?»: cada uno tiene la suya.
export function rivalsOf(hits, text, id) {
  const stem = (w) => (w.length >= 5 && w.endsWith('es') && !/[aeiou]es$/.test(w) ? w.slice(0, -2) : w.length >= 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  const words = fold(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map(stem);
  const own = (hits || []).find((h) => String(h.id) === String(id)); if (!own) return [];
  const mine = words.filter((w) => fold(own.nombre).includes(w));
  const rivals = hits.filter((h) => h !== own && mine.some((w) => fold(h.nombre).includes(w)));
  return rivals.length ? [own, ...rivals] : [];
}
// «sube los tres», «a todos», «esos»: se refiere a lo ya hablado (los montos vinieron antes); las tarjetas del modelo no se tiran por «sin monto».
const REFERS_BACK = /\b(?:los|las)\s+(?:dos|tres|cuatro|cinco|seis)\b|\b(?:todos|todas|ambos|ambas|esos|esas|estos|estas)\b/;
const lastAmount = (text) => { const m = fold(text).match(/\d+(?:[.,]\d+)?/g); return m ? Number(m[m.length - 1].replace(',', '.')) : null; };

// Antes de dedupeActions: «11.90… no, mejor 11.50» con dos tarjetas del mismo producto -> queda la del último precio.
export function keepCorrectedPrice(proposals, text) {
  if (!CORRECTION.test(fold(text))) return proposals;
  const last = lastAmount(text); if (last == null) return proposals;
  const winners = new Set(proposals.filter((p) => p.type === 'precio' && Math.abs(p.precio_nuevo - last) < 0.005).map((p) => p.product_id));
  for (let k = proposals.length - 1; k >= 0; k--) { const p = proposals[k]; if (p.type === 'precio' && winners.has(p.product_id) && Math.abs(p.precio_nuevo - last) >= 0.005) proposals.splice(k, 1); }
  return proposals;
}

// Después de todas las tarjetas: decide si las tarjetas de precio quedan y qué texto fijo va. Devuelve { reply|null, note|null, rebuild|null }.
// rebuild = { product_id, precio_nuevo } cuando la única tarjeta quedó con el precio que la persona corrigió.
export function settlePriceCards({ proposals, dropped, text, products, lastAssistant }) {
  const out = { reply: null, note: null, rebuild: null, rebuilds: [] };
  const t = fold(text);
  const cards = () => proposals.filter((p) => p.type === 'precio');
  const drop = (pred, why) => { for (let k = proposals.length - 1; k >= 0; k--) if (proposals[k].type === 'precio' && pred(proposals[k])) { proposals.splice(k, 1); dropped.push({ dropped: why, tool: 'proponer_cambio_precio' }); } };
  if (offerAsk(text)) { drop(() => true, 'offer_not_available'); out.reply = OFFER_TEXT; return out; }
  if (discountDataAsk(text)) { out.reply = DISCOUNT_DATA_TEXT; return out; }
  if (costHistoryAsk(text)) { drop(() => true, 'cost_history_missing'); out.reply = costHistoryText(tiedProducts(products, text)); return out; }
  if (marginRankAsk(text) && !cards().length) { out.note = MARGIN_RANK_NOTE; return out; }
  const pair = unitBoxPair(text);
  if (pair && !priceChangeAsk(text)) { out.note = unitBoxNote(pair); return out; }
  if (!priceChangeAsk(text)) { if (discountAsk(text)) out.note = DISCOUNT_NOTE; else if (boxPriceAsk(text) && /precio|cuanto|vend|sale/.test(t) && !/\d/.test(t) && !cards().length) out.note = BOX_READ_NOTE; return out; }
  // (mezcla con #997, UNI-037) «compre 1 saco de jairito a 156.80» es una COMPRA (hay tarjeta de compra y ninguna de precio), no un
  // cambio de precio: sin verbo de cambio («pon», «sube», «cambia»…) la respuesta de la compra queda como está.
  if (!cards().length && proposals.some((p) => p.type === 'compra') && !CHANGE_VERB.test(t)) return out;
  if (priceZeroAsk(text)) { drop(() => true, 'bad_price'); out.reply = ZERO_PRICE_TEXT; return out; }
  if (boxPriceChange(text)) {
    drop((p) => !BOX_WORDS.test(fold(p.nombre)), 'box_price_not_available');
    if (!cards().length) { out.reply = BOX_PRICE_TEXT; return out; }
  } else if (boxPriceAsk(text)) out.note = BOX_PRICE_NOTE;
  const hits = tiedProducts(products, text);
  if (priceAmountMissing(text) && !(cards().length && REFERS_BACK.test(t))) { drop(() => true, 'price_amount_missing'); out.reply = amountAskText(hits); out.note = null; return out; }
  const answered = /\bcual\b/.test(fold(lastAssistant)); // ya se preguntó «¿cuál?» y esto es la respuesta
  const one = cards();
  const rivals = one.length === 1 ? rivalsOf(hits, text, one[0].product_id) : [];
  if (!answered && rivals.length > 1) {
    drop(() => true, 'ambiguous_product'); out.reply = whichProductText(hits.filter((h) => rivals.includes(h))); out.note = null; return out;
  }
  if (!one.length && hits.length > 1 && !answered) { out.reply = whichProductText(hits); out.note = null; return out; }
  const plus = costPlus(text);
  if (plus != null) { // «costo + 1.20»: costo real de cada producto + monto
    const byId = new Map((products || []).map((p) => [String(p.id), p])), sin = [];
    for (const c of cards()) { const pr = byId.get(String(c.product_id)), k = pr && Number(pr.costo) > 0 ? Number(pr.costo) : null;
      if (k == null) { sin.push(c.nombre); continue; }
      const want = Math.round((k + plus) * 100) / 100; if (Math.abs(c.precio_nuevo - want) >= 0.005) out.rebuilds.push({ product_id: c.product_id, precio_nuevo: want, motivo: c.motivo }); }
    if (sin.length) { drop((c) => sin.includes(c.nombre), 'sin_costo'); out.note = noCostText(sin); }
    return out;
  }
  if (one.length === 1 && CORRECTION.test(t)) { const last = lastAmount(text); if (last != null && last > 0 && Math.abs(one[0].precio_nuevo - last) >= 0.005) out.rebuild = { product_id: one[0].product_id, precio_nuevo: last, motivo: one[0].motivo }; }
  return out;
}

// Líneas del prompt solo cuando la frase las necesita (el primer envío de siempre no crece).
export function precioPromptLines(text) {
  const t = fold(text), out = [];
  if (priceChangeAsk(text)) out.push('CAMBIO DE PRECIO pedido: si coincide UN producto, usa proponer_cambio_precio con su product_id (no consultes stock); si coinciden varios, pregunta cuál listándolos con su precio; sin monto, pregunta a qué precio. Precio por caja o paquete: no lo cambias (la tarjeta es por unidad).');
  if (BOX_WORDS.test(t)) out.push('PRECIO POR CAJA/PAQUETE/SACO: no lo ves (solo el precio por unidad). Dilo: está en la ficha del producto, «Precio por caja (S/)», y en el documento Lista de precios. Si dan el tamaño o el precio de la caja, calcula (unidades × precio, o precio ÷ unidades) solo como referencia.');
  if (DISCOUNT_ANY.test(t) || OFFER.test(t)) out.push('DESCUENTOS Y OFERTAS: no existen en el sistema (ni por producto, ni por cliente, ni promociones); solo «Aplicar descuento» a mano en cada venta. Dilo. Descuento máximo sin perder = precio − costo (en S/ y en % del precio).');
  if (COST_PLUS.test(t)) out.push('«COSTO + MONTO»: precio_nuevo = costo de cada producto (de la consulta) + ese monto, nunca precio + monto; una tarjeta por producto («y la otra igual» = otra tarjeta).');
  if (MARGIN_RANK.test(t)) out.push('RANKING DE MARGEN: no existe margen % por producto; usa consultar ganancia (top por ganancia en soles de lo vendido y lo vendido bajo costo) y aclara que es ganancia en soles, no margen %.');
  if (COST_HISTORY.test(t)) out.push('COSTO ANTERIOR: no se guarda el historial de costos por producto (solo el costo actual). Dilo y no inventes cuánto subió.');
  if (IGV.test(t)) out.push('IGV: si el precio lo incluye depende de Configuración > Ticket (IGV); como referencia, sin IGV = precio ÷ 1.18. No afirmes el régimen tributario del negocio.');
  return out;
}
