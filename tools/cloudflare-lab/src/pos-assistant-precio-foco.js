// Auditoría 500 (precios, 23-10): cuando la frase nombra un producto, la tabla de stock ya no «gana».
// Sin lecturas propias ni escrituras: solo mira el texto de la persona, las tarjetas que propuso el modelo y la lista de productos
// que el servidor ya tiene (contexto del aparato + catálogo leído). La tarjeta de precio sigue siendo proponer_cambio_precio.
// - Pedido de cambio de precio (pon/sube/baja/cambia, «X a 4.50»): la segunda llamada puede proponer la tarjeta (nunca la tabla).
// - Varios productos coinciden y la frase no dice cuál: se pregunta cuál (no se adivina una tarjeta).
// - Sin monto («súbele al arroz»): se pregunta a cuánto; precio 0: se explica y se pregunta qué quiere.
// - «11.90… no, mejor 11.50»: una sola tarjeta con el último precio.
// - Precio por caja/paquete: el asistente no lo cambia (su tarjeta es el precio por unidad): pasos en la ficha.
// - Ofertas, promociones y descuentos por cliente o producto no existen: se dice claro, sin tarjeta.
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

// Productos que la frase nombra por igual (empate en el puntaje más alto de matchProducts).
export function tiedProducts(products, text) {
  const words = fold(text).split(/[^a-z0-9]+/);
  const ranked = matchProducts(products || [], text);
  if (!ranked.length) return [];
  const score = (p) => words.filter((w) => w.length >= 3 && fold(p.nombre).includes(w)).length;
  const top = score(ranked[0]);
  return ranked.filter((p) => score(p) === top);
}
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
  const out = { reply: null, note: null, rebuild: null };
  const t = fold(text);
  const cards = () => proposals.filter((p) => p.type === 'precio');
  const drop = (pred, why) => { for (let k = proposals.length - 1; k >= 0; k--) if (proposals[k].type === 'precio' && pred(proposals[k])) { proposals.splice(k, 1); dropped.push({ dropped: why, tool: 'proponer_cambio_precio' }); } };
  if (offerAsk(text)) { drop(() => true, 'offer_not_available'); out.reply = OFFER_TEXT; return out; }
  if (discountDataAsk(text)) { out.reply = DISCOUNT_DATA_TEXT; return out; }
  if (!priceChangeAsk(text)) { if (discountAsk(text)) out.note = DISCOUNT_NOTE; else if (boxPriceAsk(text) && /precio|cuanto|vend|sale/.test(t) && !/\d/.test(t) && !cards().length) out.note = BOX_READ_NOTE; return out; }
  if (priceZeroAsk(text)) { drop(() => true, 'bad_price'); out.reply = ZERO_PRICE_TEXT; return out; }
  if (boxPriceChange(text)) {
    drop((p) => !BOX_WORDS.test(fold(p.nombre)), 'box_price_not_available');
    if (!cards().length) { out.reply = BOX_PRICE_TEXT; return out; }
  } else if (boxPriceAsk(text)) out.note = BOX_PRICE_NOTE;
  const hits = tiedProducts(products, text);
  if (priceAmountMissing(text)) { drop(() => true, 'price_amount_missing'); out.reply = amountAskText(hits); out.note = null; return out; }
  const answered = /\bcual\b/.test(fold(lastAssistant)); // ya se preguntó «¿cuál?» y esto es la respuesta
  const one = cards();
  if (!answered && one.length === 1 && hits.length > 1 && hits.some((h) => String(h.id) === String(one[0].product_id))) {
    drop(() => true, 'ambiguous_product'); out.reply = whichProductText(hits); out.note = null; return out;
  }
  if (!one.length && hits.length > 1 && !answered) { out.reply = whichProductText(hits); out.note = null; return out; }
  if (one.length === 1 && CORRECTION.test(t)) { const last = lastAmount(text); if (last != null && last > 0 && Math.abs(one[0].precio_nuevo - last) >= 0.005) out.rebuild = { product_id: one[0].product_id, precio_nuevo: last, motivo: one[0].motivo }; }
  return out;
}

// Líneas del prompt solo cuando la frase las necesita (el primer envío de siempre no crece).
export function precioPromptLines(text) {
  const t = fold(text), out = [];
  if (priceChangeAsk(text)) out.push('CAMBIO DE PRECIO pedido: si coincide UN producto, usa proponer_cambio_precio con su product_id (no consultes stock); si coinciden varios, pregunta cuál listándolos con su precio; sin monto, pregunta a qué precio. Precio por caja o paquete: no lo cambias (la tarjeta es por unidad).');
  if (BOX_WORDS.test(t)) out.push('PRECIO POR CAJA/PAQUETE/SACO: no lo ves (solo el precio por unidad). Dilo: está en la ficha del producto, «Precio por caja (S/)», y en el documento Lista de precios. Si dan el tamaño o el precio de la caja, calcula (unidades × precio, o precio ÷ unidades) solo como referencia.');
  if (DISCOUNT_ANY.test(t) || OFFER.test(t)) out.push('DESCUENTOS Y OFERTAS: no existen en el sistema (ni por producto, ni por cliente, ni promociones); solo «Aplicar descuento» a mano en cada venta. Dilo. Descuento máximo sin perder = precio − costo (en S/ y en % del precio).');
  if (IGV.test(t)) out.push('IGV: si el precio lo incluye depende de Configuración > Ticket (IGV); como referencia, sin IGV = precio ÷ 1.18. No afirmes el régimen tributario del negocio.');
  return out;
}
