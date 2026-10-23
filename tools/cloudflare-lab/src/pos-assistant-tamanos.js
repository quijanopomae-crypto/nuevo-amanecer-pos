// Auditoría 500 (unidades y cajas): «caja», «display» y «paquete» NO son unidades. Reglas del SERVIDOR (no dependen del modelo):
// - UNI-033: un movimiento de stock dicho en cajas/displays/paquetes no sale como tarjeta con un tamaño SACADO DEL NOMBRE. Con el tamaño
//   confirmado en la ficha (products.units_per_box) se usa y se dice; sin él se pregunta «¿Cuántas unidades trae la caja de X?» y lo que
//   dice el nombre va marcado «provisional, según el nombre».
// - UNI-032: «guarda que todas las cajas traen 12» no es un dato de un producto: no hay «¿Confirmas?» genérico ni lección guardada; se
//   ofrece ir producto por producto.
// - UNI-018/019: «son 2 cajas», «eran 2 displays»: se vuelve a calcular con el tamaño conocido (confirmado, o provisional con su marca).
// - Tamaño confirmado al producto: tarjeta «Guardar tamaño de caja» (solo Admin, un toque «Aplicar», sin PIN) que escribe una revisión
//   product.update (units_per_box + box_price_cents, que van juntos) y queda en la bitácora del asistente.
// - UNI-007: un precio sacado de una lista de proveedor o de una factura es «precio del proveedor», nunca el precio de venta del POS.
import { updateCanonicalProduct } from './a6-products.js';

export const PROVISIONAL_LABEL = 'provisional, según el nombre';
export const PACK_CARD = 'tamano_caja';
export const PACK_TOOL = 'guardar_tamano_caja';
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const MAX_UNITS = 10000;
const ok = (n) => Number.isInteger(n) && n > 1 && n <= MAX_UNITS;

// ---------- Tamaño según el nombre (siempre provisional) ----------
const UN = '(?:un|und|unds|unid|unids|unidades?|uds?|u)';
const DIS = '(?:dis|disp|display|displays|displ)';
const PQT = '(?:pqt|pqts|paq|paqs|paquetes?|bol|bols|bolsas?|bolsitas?|tiras?)';
const SIMPLE = '(?:latas?|bot|bots|botellas?|un|und|unds|unid|unids|unidades?|uds|tab|tabs|tabletas?|sobres?|frascos?|rollos?|barras?|piezas?|pzas?)';
const RX = {
  disXun: new RegExp('(\\d{1,4})\\s*' + DIS + '\\.?\\s*x\\s*(\\d{1,4})\\s*' + UN + '(?![a-z])'),
  unXdis: new RegExp('x\\s*(\\d{1,4})\\s*' + UN + '(?![a-z])[^]*?x\\s*(\\d{1,4})\\s*' + DIS + '(?![a-z])'),
  pqtXun: new RegExp('(\\d{1,4})\\s*' + PQT + '\\.?\\s*x\\s*(\\d{1,4})\\s*' + UN + '(?![a-z])'),
  caja: /caja(?:\s+cerrada)?\s*(?:x|de)\s*(\d{1,4})(?![\d.,])/,
  simple: new RegExp('(?:^|[\\s(x])(\\d{1,4})\\s*' + SIMPLE + '(?![a-z])')
};
// Devuelve { unidades, display?, paquete? } (unidades = las de la caja) o null. Gramos, kilos y mililitros no cuentan.
export function nameSize(nombre) {
  const t = fold(nombre).replace(/(\d)[.,](\d)/g, '$1_$2');
  let m;
  if ((m = RX.disXun.exec(t)) && ok(+m[1] * +m[2])) return { unidades: +m[1] * +m[2], display: +m[2] };
  if ((m = RX.unXdis.exec(t)) && ok(+m[1] * +m[2])) return { unidades: +m[1] * +m[2], display: +m[1] };
  if ((m = RX.pqtXun.exec(t)) && ok(+m[1] * +m[2])) return { unidades: +m[1] * +m[2], paquete: +m[2] };
  if ((m = RX.caja.exec(t)) && ok(+m[1])) return { unidades: +m[1] };
  if ((m = RX.simple.exec(t)) && ok(+m[1])) return { unidades: +m[1] };
  return null;
}
// p: producto del lector ({ nombre, caja }). caja > 0 = units_per_box guardado en la ficha (confirmado).
export function packInfo(p) {
  const saved = Number(p && p.caja);
  if (Number.isFinite(saved) && saved > 0) return { unidades: saved, estado: 'confirmado' };
  const n = nameSize(p && p.nombre);
  return n ? { ...n, estado: 'provisional', nota: PROVISIONAL_LABEL } : null;
}

// ---------- Palabras ----------
const NUM_WORD = '(?:\\d+(?:[.,]\\d+)?|una?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|media)';
const PACK_NOUN = '(?:cajas?|displays?|disp|paquetes?|pqts?|fardos?|bolsones?)';
export const PACK_COUNT_RE = new RegExp('(?<![a-z])' + NUM_WORD + '\\s+' + PACK_NOUN + '(?![a-z])');
// Para mostrar la herramienta de guardar el tamaño (solo Admin) sin sumar bytes al resto de pedidos.
export const PACK_TOPIC_RE = new RegExp('(?<![a-z])(?:' + PACK_NOUN + '|unidades\\s+(?:trae|tiene|viene))(?![a-z])');
export const asksPack = (text) => PACK_COUNT_RE.test(fold(text));
export const packTopic = (text) => PACK_TOPIC_RE.test(fold(text));
const packWord = (text) => { const t = fold(text); return /(?<![a-z])(?:displays?|disp)(?![a-z])/.test(t) ? 'display' : /(?<![a-z])(?:paquetes?|pqts?)(?![a-z])/.test(t) ? 'paquete' : 'caja'; };
// La persona dijo el tamaño en este mensaje («la caja trae 72», «cajas de 72», «72 unidades por caja») o contestó con un número a la
// pregunta del servidor «¿Cuántas unidades trae…?».
// (revisión #999) El verbo tiene que ir pegado a la caja o al producto: «la caja trae 12», «cajas de 12», «caja de wafer nik trae 72»,
// «viene de 24», «trae 12 unidades», «12 unidades por caja». Un «tiene 10» suelto («la vitrina tiene 10») NO es el tamaño de la caja.
const VERB = '(?:trae|traen|tiene|tienen|viene|vienen|lleva|llevan)';
const STOP = '(?:y|e|o|u|pero|que|mas|en|la|el|los|las|lo|mi|su|tengo|hay|con|para|por|son|es|esta|estan|aparte|ademas|vitrina|tienda|almacen|stock|sistema)';
const UNITS = '(?:unidades?|unid|unids|und|unds|uds|u)';
const STATED_RE = new RegExp([
  '(?<![a-z])' + PACK_NOUN + '\\s+(?:de|x|con|cerradas?\\s+de)\\s+\\d+(?![\\d.,]?\\d*\\s*(?:' + PACK_NOUN + '|kg|kilos?|gr?|ml|lt?|litros?)(?![a-z]))',
  '(?<![a-z])' + PACK_NOUN + '(?:\\s+de(?:\\s+(?!' + STOP + '(?![a-z]))[a-z0-9ñ]+){1,5})?(?:\\s*,)?(?:\\s+que)?\\s+' + VERB + '\\s+(?:de\\s+|x\\s+|con\\s+)?\\d+',
  '(?<![a-z])(?:viene|vienen)\\s+(?:de|x|con|en)\\s+\\d+',
  '(?<![a-z])(?:trae|traen|viene|vienen)\\s+\\d+\\s*' + UNITS + '(?![a-z])',
  '\\d+\\s*' + UNITS + '\\s+(?:por|cada|la|el|en\\s+cada)\\s+(?:' + PACK_NOUN + '|una|uno)(?![a-z])'
].join('|'));
// Respuesta a la pregunta del servidor: un número de UNIDADES («12», «trae 12», «12 unidades», «son 12»). «son 2 cajas» no cuenta.
const SIZE_ANSWER_RE = new RegExp('^(?:(?:la\\s+caja|el\\s+display|el\\s+paquete|cada\\s+una|cada\\s+caja)\\s+)?(?:son|trae|traen|tiene|tienen|viene|vienen|lleva|llevan)?\\s*(?:de\\s+|x\\s+)?\\d+\\s*(?:' + UNITS + ')?(?:\\s+(?:por|cada)\\s+(?:caja|display|paquete|una|uno))?\\s*[.!]*$');
const PACK_COUNTS_G = new RegExp(PACK_COUNT_RE.source, 'g');
export const ASK_SIZE_RE = /¿Cuántas unidades trae (?:la caja|el display|el paquete) de /;
export function statedSize(text, history) {
  const t = fold(text).trim();
  if (STATED_RE.test(t)) return true;
  const last = (history || []).filter((h) => h && h.role === 'assistant').slice(-1)[0];
  if (!(last && ASK_SIZE_RE.test(String(last.content || '')))) return false;
  if (SIZE_ANSWER_RE.test(t)) return true;
  // «son 2 cajas, 12 unidades»: sin las cuentas de cajas tiene que quedar un número con «unidades» (o «trae 12»).
  const rest = t.replace(PACK_COUNTS_G, ' ');
  return new RegExp('\\d+\\s*' + UNITS + '(?![a-z])|(?<![a-z])(?:trae|traen|viene|vienen)\\s+(?:de\\s+)?\\d+').test(rest);
}

// ---------- UNI-032: regla general para todas las cajas ----------
export const GENERAL_PACK_RE = new RegExp('(?<![a-z])(?:tod[oa]s\\s+(?:l[oa]s\\s+)?|cada\\s+)' + PACK_NOUN + '\\s+(?:siempre\\s+)?(?:traen?|tienen?|vienen?|son|llevan?)\\s+(?:de\\s+)?\\d+');
export const asksGeneralPack = (text) => GENERAL_PACK_RE.test(fold(text));
export const GENERAL_PACK_TEXT = 'No puedo guardar una regla para todas las cajas: cada producto trae una cantidad distinta. Dime de qué producto es y guardo su tamaño de caja uno por uno, con su tarjeta.';
export const GENERAL_PACK_EMPLOYEE_TEXT = 'No puedo guardar una regla para todas las cajas: cada producto trae una cantidad distinta. El tamaño de caja de cada producto lo guarda el Admin.';

// ---------- Reglas para el modelo (solo cuando el mensaje habla de cajas) ----------
export const PACK_RULE = 'CAJAS, DISPLAYS Y PAQUETES: no son unidades. Usa <tamanos_caja>: «confirmado» = guardado en la ficha, úsalo y dilo («la caja guardada trae N»); «provisional» = sacado del nombre: puedes calcular con él pero di «N por caja (provisional, según el nombre)» y no armes tarjetas de stock con ese número: pregunta «¿Cuántas unidades trae la caja de X?». Si corrigen cuántas cajas son («son 2 cajas», «eran 2 displays»), vuelve a calcular con el mismo tamaño; no lo vuelvas a preguntar. Para una regla de «todas las cajas» di que no se puede y ofrece ir producto por producto.';
export const PACK_TOOL_RULE = 'GUARDAR TAMAÑO DE CAJA: solo con el número dicho por el Admin para UN producto, usa guardar_tamano_caja (la ficha guarda unidades y precio de la caja juntos; si el producto no tiene precio de caja, pregunta a cuánto vende la caja).';
export const PACK_TOOL_DEF = { name: PACK_TOOL, description: 'Guarda en la ficha de UN producto cuántas unidades trae su caja (y el precio de venta de la caja si lo dicen). Solo con el número que dijo el Admin, nunca el del nombre. El Admin aplica con un toque.',
  parameters: { type: 'object', properties: { product_id: { type: 'string' }, unidades: { type: 'integer' }, precio_caja: { type: 'number' } }, required: ['product_id', 'unidades'] } };

// Productos del mensaje y de los 2 últimos mensajes de la persona (pueden decir «son 2 cajas» sin repetir el nombre).
export function packFactsMessage(products, match, text, history) {
  const list = Array.isArray(products) ? products : [];
  if (!list.length) return null;
  const users = (history || []).filter((h) => h && h.role === 'user').slice(-2).map((h) => String(h.content || ''));
  const seen = new Set(), rows = [];
  for (const t of [text, ...users.reverse()]) for (const p of match(list, t).slice(0, 4)) {
    if (seen.has(String(p.id)) || rows.length >= 6) continue; seen.add(String(p.id));
    const i = packInfo(p); if (!i) continue;
    rows.push({ nombre: String(p.nombre || '').slice(0, 120), unidades_por_caja: i.unidades, ...(i.display ? { por_display: i.display } : {}), ...(i.paquete ? { por_paquete: i.paquete } : {}), estado: i.estado === 'confirmado' ? 'confirmado' : PROVISIONAL_LABEL });
  }
  if (!rows.length) return null;
  return { role: 'user', content: '<tamanos_caja>' + JSON.stringify({ productos: rows }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') + '</tamanos_caja>' };
}

// ---------- UNI-033: tarjetas de stock dichas en cajas sin tamaño confirmado ----------
// sizes: Map product_id -> unidades guardadas (> 0). Sin lectura fiable (sizes null) se trata como sin confirmar (falla cerrado).
export function holdPackCards(proposals, dropped, { text, history, sizes }) {
  const out = { held: [], used: [] };
  if (!asksPack(text) || statedSize(text, history)) return out;
  for (const p of proposals.slice()) {
    if (p.type !== 'ajuste') continue;
    const saved = sizes ? Number(sizes.get(String(p.product_id))) : 0;
    if (saved > 0) { out.used.push({ nombre: p.nombre, unidades: saved }); continue; }
    proposals.splice(proposals.indexOf(p), 1);
    dropped.push({ dropped: 'tamano_sin_confirmar', tool: 'proponer_ajuste_stock', nombre: p.nombre });
    out.held.push({ nombre: p.nombre, prov: nameSize(p.nombre) });
  }
  return out;
}
export function holdText(held, text) {
  const w = packWord(text), art = w === 'caja' ? 'la' : 'el';
  return held.map(({ nombre, prov }) => {
    const n = prov ? (w === 'display' ? prov.display : w === 'paquete' ? prov.paquete : prov.unidades) : null;
    return '¿Cuántas unidades trae ' + art + ' ' + w + ' de ' + nombre + '?' + (n ? ' Según el nombre serían ' + n + ' (' + PROVISIONAL_LABEL + '); no lo uso para el stock hasta que me lo confirmes.' : '');
  }).join(' ');
}
export function usedText(used) {
  return [...new Map(used.map((u) => [u.nombre, u])).values()].map((u) => 'Usé la caja guardada en la ficha de ' + u.nombre + ': ' + u.unidades + ' unidades.').join(' ');
}

// ---------- Tarjeta «Guardar tamaño de caja» ----------
const cents = (v) => (v == null ? null : Math.round(Number(v) * 100));
// Del lado del chat: product_id verificado en <datos_pos>; antes y después se completan con la base en resolvePackProposals.
export function packToolProposal(args, p, id) {
  const u = Number(args.unidades);
  if (!p || !Number.isInteger(u) || u < 1 || u > MAX_UNITS) return { dropped: 'bad_pack', tool: PACK_TOOL };
  const precio = args.precio_caja == null ? null : Number(args.precio_caja);
  if (precio != null && !(Number.isFinite(precio) && precio > 0 && precio < 1e6)) return { dropped: 'bad_pack', tool: PACK_TOOL };
  return { id, type: PACK_CARD, needsConfirm: true, requiresRole: 'owner', title: 'Guardar tamaño de caja', boton: 'Aplicar', product_id: p.id, nombre: p.nombre,
    unidades: u, precio_caja: precio == null ? null : Math.round(precio * 100) / 100 };
}
// Pareja de la ficha: units_per_box y box_price_cents van juntos. Precio de caja = el dicho; si no, el que ya tiene la ficha; si no hay
// ninguno, la tarjeta NO sale (no se inventa un precio de venta de caja) y se pregunta.
export async function resolvePackProposals(reader, proposals, dropped) {
  const cards = proposals.filter((p) => p.type === PACK_CARD); if (!cards.length) return [];
  let map = null;
  try {
    if (reader && typeof reader.packSizes === 'function') map = await reader.packSizes(cards.map((p) => p.product_id));
    else if (reader && typeof reader.products === 'function') { const list = await reader.products(); map = Array.isArray(list) ? new Map(list.map((p) => [String(p.id), { caja: Number(p.caja) > 0 ? Number(p.caja) : null, precio_caja: p.precio_caja ?? null }])) : null; }
  } catch { map = null; }
  const asks = [];
  for (const p of cards) {
    const cur = map && map.get(String(p.product_id));
    if (!cur) { proposals.splice(proposals.indexOf(p), 1); dropped.push({ dropped: map ? 'pack_product_missing' : 'pack_read_failed', tool: PACK_TOOL, nombre: p.nombre }); continue; }
    p.unidades_antes = cur.caja > 0 ? cur.caja : null; p.precio_caja_antes = cur.precio_caja != null ? cur.precio_caja : null;
    if (p.precio_caja == null) { p.precio_caja = p.precio_caja_antes; p.precio_de_ficha = true; }
    if (p.precio_caja == null) { proposals.splice(proposals.indexOf(p), 1); dropped.push({ dropped: 'pack_price_missing', tool: PACK_TOOL, nombre: p.nombre }); asks.push(p.nombre); continue; }
    p.origen = 'Lo dijo el Admin en el chat';
  }
  return asks;
}
export const packPriceAskText = (names) => names.map((n) => 'Para guardar la caja de ' + n + ' necesito también a cuánto vendes la caja (la ficha guarda los dos juntos). ¿A cuánto la vendes?').join(' ');

// Lectura de la ficha efectiva (base + última revisión) de UN producto, para armar product.update sin cambiar nada más.
const EDIT_FIELDS = ['name', 'sku', 'barcode', 'alternate_codes_json', 'category', 'brand', 'description', 'icon', 'cost_cents', 'price_cents', 'box_price_cents', 'units_per_box', 'stock_min_quantity', 'expiry_date'];
async function effectiveProduct(db, promotionId, productId) {
  let base = null;
  for (const t of ['products', 'canonical_live_products']) {
    try { base = await db.prepare(`SELECT * FROM ${t} WHERE promotion_id=?1 AND product_id=?2`).bind(promotionId, productId).first(); }
    catch (e) { if (!/no such table/i.test(String(e?.message || e))) throw e; base = null; }
    if (base) break;
  }
  if (!base) return null;
  const rev = await db.prepare('SELECT * FROM canonical_product_revisions WHERE promotion_id=?1 AND product_id=?2 ORDER BY revision DESC LIMIT 1').bind(promotionId, productId).first();
  const eff = { ...base, metadata_revision: rev ? Number(rev.revision) : 0 };
  if (rev) { for (const k of EDIT_FIELDS) eff[k] = rev[k]; eff.legacy_alternate_code = null; }
  return eff;
}
const nowIso = (ms) => new Date(ms).toISOString(); // AAAA-MM-DDTHH:MM:SS.mmmZ (lo que pide product.update)

// Confirmación (solo Admin, ya revisado en /auth/assistant/confirm). Escribe UNA revisión product.update con operation_id = el del token
// (un reenvío del mismo toque no escribe dos veces) y deja dos filas en la bitácora: lo aplicado (antes -> después) y quién.
// (revisión #999) La tarjeta firma lo que había en la ficha al armarla (unidades_antes, precio_caja_antes). Si otro aparato cambió la
// caja desde entonces, NO se pisa a ciegas: 409 stock_changed (mismo formato que el #983) con una tarjeta NUEVA firmada (reissue) con
// lo de ahora; la vieja no escribe nada. El precio que dijo el Admin se mantiene; el que salió de la ficha se toma de nuevo.
const soles = (c) => (c == null ? null : Number(c) / 100);
async function stalePackCard(card, eff, reissue) {
  if (!Object.hasOwn(card || {}, 'unidades_antes') && !Object.hasOwn(card || {}, 'precio_caja_antes')) return null;
  const uNow = Number(eff.units_per_box) > 0 ? Number(eff.units_per_box) : null, cNow = eff.box_price_cents == null ? null : Number(eff.box_price_cents);
  const uWas = Number(card.unidades_antes) > 0 ? Number(card.unidades_antes) : null, cWas = card.precio_caja_antes == null ? null : cents(card.precio_caja_antes);
  if (uNow === uWas && cNow === cWas) return null;
  const precio = card.precio_de_ficha ? soles(cNow) : card.precio_caja;
  const fmt = (u, c) => (u == null ? 'sin tamaño' : u + ' unidades') + ' a ' + (c == null ? 'sin precio de caja' : 'S/ ' + (c / 100).toFixed(2));
  const base = { error: 'stock_changed', nombre: card.nombre, unidades_antes: uWas, unidades_ahora: uNow, precio_caja_antes: soles(cWas), precio_caja_ahora: soles(cNow) };
  const cambio = 'La caja de ' + card.nombre + ' cambió de ' + fmt(uWas, cWas) + ' a ' + fmt(uNow, cNow) + ' desde que preparé la tarjeta.';
  if (uNow === Number(card.unidades) && precio != null && cNow === cents(precio)) return { ...base, proposal: null, message: cambio + ' Ya está guardada como pedías. No hace falta aplicar.' };
  if (precio == null || typeof reissue !== 'function') return { ...base, proposal: null, message: cambio + ' Pide la tarjeta de nuevo.' };
  const { confirm_token, resultado, ...rest } = card;
  const fresh = { ...rest, id: String(card.id || PACK_CARD) + '-r', unidades_antes: uNow, precio_caja_antes: soles(cNow), precio_caja: precio };
  fresh.confirm_token = await reissue(fresh);
  return { ...base, proposal: fresh, message: cambio + ' Revisa la tarjeta nueva: guarda ' + card.unidades + ' unidades a S/ ' + Number(precio).toFixed(2) + ' la caja.' };
}
export async function applyPackCard(db, auth, card, opId, audit, now = Date.now(), reissue = null) {
  const fail = (status, error, message) => ({ status, body: { error, message } });
  if (!db) return fail(503, 'save_failed', 'No se pudo guardar. Intenta de nuevo.');
  const u = Number(card?.unidades), price = cents(card?.precio_caja);
  if (!Number.isInteger(u) || u < 1 || u > MAX_UNITS || !Number.isSafeInteger(price) || price <= 0) return fail(409, 'pack_invalid', 'Ese tamaño de caja no es válido.');
  let ctl, eff;
  try {
    ctl = await db.prepare('SELECT mode,active_promotion_id,authority_epoch,revision,minimum_client_contract FROM canonical_control WHERE id=1').first();
    if (!ctl || ctl.mode !== 'ACTIVE') return fail(409, 'pack_not_available', 'La ficha no se puede cambiar ahora. Hazlo desde Inventario.');
    const done = await db.prepare('SELECT result_json FROM canonical_product_revisions WHERE operation_id=?1').bind(String(opId)).first();
    if (done) return { status: 200, body: { ok: true, product_id: String(card.product_id), unidades: u, precio_caja: price / 100, repetido: true } };
    eff = await effectiveProduct(db, ctl.active_promotion_id, String(card.product_id));
  } catch { return fail(503, 'save_failed', 'No se pudo guardar. Intenta de nuevo.'); }
  if (!eff) return fail(409, 'product_not_found', 'Ese producto ya no está en el inventario.');
  const stale = await stalePackCard(card, eff, reissue);
  if (stale) return { status: 409, body: stale };
  const antes = Number(eff.units_per_box) > 0 ? Number(eff.units_per_box) : null;
  let alt = []; try { alt = JSON.parse(eff.alternate_codes_json || '[]'); } catch { alt = []; }
  alt = [...new Set([...(Array.isArray(alt) ? alt : []), ...(eff.legacy_alternate_code ? [eff.legacy_alternate_code] : [])].map((c) => String(c).trim()).filter(Boolean))].filter((c) => c !== eff.sku && c !== eff.barcode);
  const tracks = Number(eff.tracks_inventory) === 1 || eff.tracks_inventory === true;
  const body = { operation_id: String(opId), product_id: String(card.product_id), promotion_id: ctl.active_promotion_id, authority_epoch: Number(ctl.authority_epoch),
    expected_control_revision: Number(ctl.revision), client_contract: ctl.minimum_client_contract, created_at: nowIso(now), expected_metadata_revision: eff.metadata_revision,
    name: eff.name, sku: eff.sku ?? null, barcode: eff.barcode ?? null, alternate_codes: alt, category: eff.category ?? null, brand: eff.brand ?? null, description: eff.description ?? null,
    icon: eff.icon ?? null, cost_cents: Number(eff.cost_cents) || 0, price_cents: Number(eff.price_cents), box_price_cents: price, units_per_box: u,
    stock_min_quantity: tracks ? Number(eff.stock_min_quantity) || 0 : 0, expiry_date: eff.expiry_date || null };
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  let res, out;
  try { res = await updateCanonicalProduct(new Request('https://asistente/product.update', { method: 'POST', body: JSON.stringify(body) }), { DB: db }, auth, json); out = await res.json(); }
  catch { return fail(503, 'save_failed', 'No se pudo guardar. Intenta de nuevo.'); }
  if (res.status !== 201 && res.status !== 200) {
    const msg = out && out.error === 'stale_product' ? 'La ficha cambió mientras tanto. Pide la tarjeta de nuevo.' : out && out.error === 'stale_authority' ? 'Este aparato no puede cambiar fichas ahora. Hazlo desde Inventario.' : 'No se pudo guardar. Hazlo desde la ficha del producto.';
    return fail(res.status >= 500 ? 503 : 409, 'pack_' + String(out && out.error || 'failed').slice(0, 30), msg);
  }
  await audit(db, [{ device_id: auth.principalId, role: 'owner', tool: 'asistente.caja', type: PACK_CARD, outcome: ('caja:' + (antes ?? '-') + '->' + u).slice(0, 40), card_id: String(card.id || ''), operation_id: String(opId) }]);
  return { status: 200, body: { ok: true, product_id: String(card.product_id), unidades_antes: antes, unidades: u, precio_caja: price / 100, revision: out.metadata_revision } };
}

// ---------- UNI-007: precio de lista o de factura ----------
// (revisión #999) «lista» sola NO es del proveedor: el POS tiene su propia «lista de precios» («a cuánto está el arroz en mi lista de
// precios», «pásame el precio para la lista» = precio de venta). La lista cuenta como del proveedor solo con «proveedor», «distribuidor»,
// «mayorista» o el nombre de un proveedor conocido (de las compras). Factura, boleta y catálogo siguen siendo del proveedor.
const SUPPLIER_SRC_RE = /(?<![a-z])(?:proveedor(?:es)?|factura|facturas|boletas?|distribuidor\w*|mayoristas?|catalogo)(?![a-z])/;
const LIST_RE = /(?<![a-z])listas?(?![a-z])/;
const NAME_NOISE = new Set(['distribuidora', 'distribuidor', 'comercial', 'comercializadora', 'corporacion', 'inversiones', 'negociaciones', 'importaciones', 'grupo', 'empresa', 'sac', 'saa', 'eirl', 'srl', 'del', 'los', 'las', 'peru']);
// Palabras de los nombres de proveedor (de 4 letras o más, sin «distribuidora», «S.A.C.», etc.) para reconocer «la lista de alicorp».
export function supplierNameWords(names) {
  const out = new Set();
  for (const n of names || []) for (const w of fold(n).replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/)) if (w.length >= 4 && !NAME_NOISE.has(w) && !/^\d+$/.test(w)) out.add(w);
  return [...out].slice(0, 200);
}
export const mentionsList = (text) => LIST_RE.test(fold(text));
export function supplierSource(text, supplierWords = []) {
  const t = fold(text);
  if (SUPPLIER_SRC_RE.test(t)) return true;
  if (!LIST_RE.test(t)) return false;
  const words = new Set(t.replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/));
  return (supplierWords || []).some((w) => words.has(w));
}
export const asksSupplierPrice = (text, priceAsk, supplierWords = []) => priceAsk.test(String(text || '')) && supplierSource(text, supplierWords);
export const SUPPLIER_PRICE_RULE = 'PRECIO DE LISTA O FACTURA: un precio que sale de una lista de proveedor, factura o boleta es «precio del proveedor» (lo que cobra el proveedor): dilo con esas palabras y nunca lo presentes como tu precio de venta. El precio de venta es solo el de <precios_del_sistema>.';
const AMOUNT_RE = /s\/\s*\d|\d+[.,]\d{2}(?!\d)/i;
// sale: { nombre, precio } si el producto se reconoce sin dudas (un solo candidato); si no, null.
export function supplierPriceFix(reply, sale) {
  const r = String(reply || '');
  if (!AMOUNT_RE.test(r) || /precio\s+del\s+proveedor/i.test(r)) return r;
  const tail = sale && Number.isFinite(Number(sale.precio)) && sale.precio != null ? ' Tu precio de venta en el sistema para ' + sale.nombre + ' es S/ ' + Number(sale.precio).toFixed(2) + '.' : '';
  return r + '\nOjo: ese monto es precio del proveedor (lo que te cobra), no tu precio de venta.' + tail;
}
