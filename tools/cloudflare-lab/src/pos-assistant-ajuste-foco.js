// Auditoría 500 (ajustes de stock, 23-10): «me sobraron 5», «se rompieron 3», «un cliente me devolvió 1», «conté 15» ya no reciben
// solo la tabla de stock: la segunda llamada puede proponer la tarjeta de siempre (proponer_ajuste_stock, entrada/salida) o se pregunta cuál.
// Sin lecturas propias ni escrituras: mira el texto, las tarjetas que propuso el modelo y la lista de productos que el servidor ya tiene.
// - Varios productos coinciden y la frase no dice cuál: «¿cuál?» con su stock (no se adivina).
// - Conteo («conté 15», «pon el stock en 20»): la tarjeta lleva la DIFERENCIA con el stock actual, nunca 15 como entrada.
// - Salida que deja el stock negativo: se avisa en el texto (la tarjeta ya lo marca).
// Alcance: solo la tarjeta del chat. La confirmación (y su 409 «el stock cambió») no se toca aquí.
import { tiedProducts, rivalsOf } from './pos-assistant-precio-foco.js';

const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const qtyTxt = (v) => String(Math.round(Number(v) * 1000) / 1000);

const PURCHASE = /\bcompr|\bme\s+llego|\bllegaron|\bllego\b|\brecibi|\bpedido\b|\bproveedor|\bfactura/;
const QTY = /\d|\b(?:un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|docena)\b/;
const IN_WORDS = /\bsobr(?:aron|o|an|a|e)\b|\bdevolv(?:io|ieron|i|ieron)\b|\bme\s+devolv|\bencontr(?:e|amos|aron)\b/;
const OUT_WORDS = /\brompi(?:o|eron)\b|\bse\s+(?:me\s+|nos\s+)?rompi|\brot[oa]s?\b|\bquebr(?:o|aron|ados?|adas?)\b|\bmalogr|\bdanad|\bvenci(?:o|eron|dos?|das?)\b|\bvencid|\bregal(?:e|o|amos|aron)\b|\bconsumo\s+(?:propio|interno|de\s+la\s+casa)|\b(?:me|nos)\s+(?:comi|comimos|tome|tomamos)\b|\bperd(?:i|io|imos|ieron)\b|\brobaron\b|\bsalida\s+de\s+\d/;
const COUNT_WORDS = /\bconte\b|\bcontamos\b|\bconteo\b|\bpon(?:er|le)?\s+el\s+stock\b|\bstock\s+(?:de\s+[a-z0-9 ]+?\s+)?(?:en|a)\s+\d|\bdeja(?:lo|la)?\s+(?:el\s+stock\s+)?en\s+\d+\s+unidades|\bentrada\s+de\s+\d/;
// ¿Pide mover el stock de un producto? (no compras: eso es preparar_compra)
export function stockChangeAsk(text) {
  const t = fold(text);
  if (!t || PURCHASE.test(t) || !QTY.test(t)) return false;
  return IN_WORDS.test(t) || OUT_WORDS.test(t) || COUNT_WORDS.test(t);
}
// Conteo: el número contado («conté y tengo 15», «pon el stock en 20»). null = no es conteo.
export function countedTarget(text) {
  const t = fold(text);
  let m = t.match(/\bstock\b[^.]*?\b(?:en|a)\s+(\d+(?:[.,]\d+)?)/) || t.match(/\b(?:conte|contamos)\b[^.\d]*?(\d+(?:[.,]\d+)?)/) || t.match(/\btengo\s+(\d+(?:[.,]\d+)?)\b[^.]*\bsistema/);
  if (!m || !/\bconte\b|\bcontamos\b|\bconteo\b|\bstock\b|\bsistema\b/.test(t)) return null;
  return Number(m[1].replace(',', '.'));
}
export const AJUSTE_RULE = 'AJUSTE DE STOCK pedido (sobró, se rompió o venció, devolución de cliente, regalo, consumo propio, conteo): usa proponer_ajuste_stock con su product_id; no respondas solo con la consulta de stock. Sobró / devolvieron / encontré = entrada; se rompió / venció / regalé / consumo propio = salida (motivo Devolución, Merma / daño, Producto vencido o Ajuste de inventario). Conteo o «pon el stock en N»: la diferencia N − stock actual (entrada si sube, salida si baja), nunca N como entrada. Si coinciden varios productos, pregunta cuál con su stock.';
export const ajustePromptLines = (text) => (stockChangeAsk(text) ? [AJUSTE_RULE] : []);

const listHits = (hits) => hits.slice(0, 6).map((p) => p.nombre + (p.stock != null ? ' (stock ' + qtyTxt(p.stock) + ')' : '')).join(' · ');
export const whichStockText = (hits) => '¿Cuál de estos? ' + listHits(hits) + '. Dime cuál y preparo el movimiento.';
export const sameCountText = (p, n) => p.nombre + ' ya tiene ' + qtyTxt(n) + ' en el sistema: no hay nada que ajustar.';
export const negativeNote = (p) => 'Ojo: con esta salida el stock de ' + p.nombre + ' quedaría en ' + qtyTxt(p.stock_despues) + '. Revisa la cantidad antes de confirmar.';

// Después de todas las tarjetas: { reply|null, note|null, rebuilds: [{ product_id, tipo, cantidad, motivo }] }.
export function settleAdjustCards({ proposals, dropped, text, products, lastAssistant }) {
  const out = { reply: null, note: null, rebuilds: [] };
  if (!stockChangeAsk(text)) return out;
  const cards = () => proposals.filter((p) => p.type === 'ajuste');
  const drop = (pred, why) => { for (let k = proposals.length - 1; k >= 0; k--) if (proposals[k].type === 'ajuste' && pred(proposals[k])) { proposals.splice(k, 1); dropped.push({ dropped: why, tool: 'proponer_ajuste_stock' }); } };
  const hits = tiedProducts(products, text), answered = /\bcual\b/.test(fold(lastAssistant)), one = cards();
  const rivals = one.length === 1 ? rivalsOf(hits, text, one[0].product_id) : [];
  if (!answered && rivals.length > 1) { drop(() => true, 'ambiguous_product'); out.reply = whichStockText(hits.filter((h) => rivals.includes(h))); return out; }
  if (!one.length) { if (hits.length > 1 && !answered) out.reply = whichStockText(hits); return out; }
  const n = countedTarget(text);
  if (n != null && one.length === 1 && one[0].stock_actual != null) {
    const c = one[0], diff = Math.round((n - c.stock_actual) * 1000) / 1000;
    if (diff === 0) { drop(() => true, 'nothing_to_adjust'); out.reply = sameCountText(c, n); return out; }
    const tipo = diff > 0 ? 'entrada' : 'salida', cantidad = Math.abs(diff);
    if (c.tipo !== tipo || Math.abs(c.cantidad - cantidad) >= 0.0005) out.rebuilds.push({ product_id: c.product_id, tipo, cantidad, motivo: 'Ajuste de inventario' });
    return out;
  }
  const neg = one.find((p) => p.quedaNegativo); if (neg) out.note = negativeNote(neg);
  return out;
}
