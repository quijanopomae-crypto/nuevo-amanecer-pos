// Memoria efímera de la boleta, sin foto ni escritura en BD. Solo el Admin y su sesión.
// La firma protege la procedencia del extracto; NO convierte el documento en instrucciones.
const TTL = 8 * 60 * 60 * 1000, MAX_TOKEN = 32000;
const enc = new TextEncoder();
// (lote en vivo 22-10) Lo que el Admin le ENSEÑA al asistente («la caja de gaseosa trae 12») viaja en este mismo token firmado,
// porque el celular solo manda los últimos 8 mensajes y lo enseñado antes se perdía («¿qué te enseñé hoy?» salía incompleto).
// Solo frases afirmativas con un dato; nunca preguntas. Sin BD: vive lo que vive el token (8 h, misma sesión del Admin).
export const MAX_TAUGHT = 20;
const TEACH_LEAD = /^(?:recuerda|recu[eé]rdalo|anota|apunta|aprende|ten\s+en\s+cuenta|te\s+enseño|para\s+que\s+sepas|ojo|no\s+olvides|te\s+equivocaste|est[aá]s\s+mal|no\s*,)/i;
const TEACH_FACT = /\b(?:trae|traen|viene|vienen|contiene|contienen|cuesta|cuestan|vale|valen|equivale|equivalen|son|es\s+de|tiene|tienen|lleva|llevan)\b/i;
// (lote 3, MEM-013) datos de proveedor sin número: «mi proveedor del arroz es distribuidora san juan», «el arroz se lo compro a …».
const SUPPLIER_FACT = /\bproveedor(?:a|es)?\b[^.;\n]{0,60}?\b(?:es|son|se\s+llama)\s+\S|\b(?:se\s+)?(?:lo|la|los|las|le)\s+compro\s+(?:a|en)\s+\S|\bme\s+(?:lo|la|los|las)\s+(?:trae|traen|vende|venden)\s+\S/i;
// (auditoría 500, M-007/P-015/P-016) preguntas sin «?»: palabra interrogativa al inicio (también tras «y», «pero», «oye»… o una preposición:
// «a cuánto», «de qué»), tras «y»/«si» («… trae 24 y cuando»), tras una coma («…, a cuanto me sale cada lata»), «a cuánto» en cualquier
// parte («si me cuesta 85 … a cuanto vendo») o con tilde en cualquier parte («quién», «cuánto», «dónde»…). Nunca se guardan como lección.
const Q_LEAD = /^(?:(?:y|o|pero|oye|oiga|entonces|bueno|ya|ok|ah)[,\s]+)?(?:(?:a|de|en|con|para|por|desde|hasta)\s+)?(?:(?:qui[eé]n(?:es)?|cu[aá]nt[oa]s?|c[oó]mo|qu[eé]|cu[aá]l(?:es)?|cu[aá]ndo|d[oó]nde|por\s*qu[eé])(?![a-záéíóúñ])|puedes|podr[ií]as|recu[eé]rdame|prepara|revisa|dime|dame|mu[eé]strame)/i;
const Q_INSIDE = /[¿?]|(?<![a-záéíóúñ])a\s+cu[aá]nt[oa]s?(?![a-záéíóúñ])|(?<![a-záéíóúñ])(?:y|si)\s+(?:a\s+)?(?:qui[eé]n(?:es)?|cu[aá]nt[oa]s?|cu[aá]l(?:es)?|cu[aá]ndo)(?![a-záéíóúñ])|[,;:]\s*(?:y\s+)?(?:a\s+)?(?:qui[eé]n(?:es)?|cu[aá]nt[oa]s?|cu[aá]l(?:es)?|cu[aá]ndo|d[oó]nde|c[oó]mo)(?![a-záéíóúñ])|(?<![a-záéíóúñ])(?:qui[é]n(?:es)?|cu[á]nt[oa]s?|cu[á]l(?:es)?|cu[á]ndo|d[ó]nde|c[ó]mo|qu[é]|por\s*qu[é])(?![a-záéíóúñ])/i;
export function isQuestion(text) { const t = String(text || '').replace(/\s+/g, ' ').trim(); return Q_LEAD.test(t) || Q_INSIDE.test(t); }
// (auditoría 500, M-035) «el pollo ahora me cuesta 9.20»: el Admin dice el COSTO NUEVO de un producto. No es una lección: va a la tarjeta
// «Actualizar costo» (pos-assistant.js, statedCostCard). Sin caja/paquete ni otro número (eso es una equivalencia o un cálculo), nunca una pregunta.
const COST_PACK = /(?<![a-z])(?:caja|cajas|paquete\w*|saco|sacos|fardo|fardos|docena\w*|six|pack|bolsa\w*|bolsit\w*|lata|latas|botella\w*|trae|traen|cada|unidad\w*|x)(?![a-z])/;
const COST_SAID = [
  /^(?:(?:oye|ojo|ya|bueno|anota|recuerda|apunta)[,:]?\s+)?(?:(?:el|la|los|las)\s+)?([a-z][a-z\s.'-]{1,50}?)\s+(?:(?:ahora|ya|desde\s+hoy|hoy|ahorita)\s+)?me\s+cuestan?\s+(?:a\s+)?(?:s\/\.?\s*)?(\d{1,5}(?:[.,]\d{1,2})?)(?![\d])/,
  /^(?:(?:oye|ojo|ya|bueno|anota|recuerda|apunta)[,:]?\s+)?(?:(?:ahora|ya|desde\s+hoy|hoy)\s+)?me\s+cuestan?\s+(?:a\s+)?(?:s\/\.?\s*)?(\d{1,5}(?:[.,]\d{1,2})?)(?![\d])\s+(?:(?:el|la|los|las)\s+)?([a-z][a-z\s.'-]{1,50}?)\s*(?:[,.;]|$)/,
  /^(?:(?:oye|ojo|ya|bueno|anota|recuerda|apunta)[,:]?\s+)?(?:(?:el|mi)\s+)?costo\s+(?:de\s+(?:la|los|las|el)\s+|del\s+|de\s+)([a-z][a-z\s.'-]{1,50}?)\s+(?:(?:ahora|ya|desde\s+hoy|hoy)\s+)?es\s+(?:de\s+)?(?:s\/\.?\s*)?(\d{1,5}(?:[.,]\d{1,2})?)(?![\d])/,
];
export function statedCost(text) {
  const t = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t || t.length > 200 || isQuestion(text) || COST_PACK.test(t) || (t.match(/\d+(?:[.,]\d+)?/g) || []).length !== 1) return null;
  for (const [i, re] of COST_SAID.entries()) {
    const m = t.match(re); if (!m) continue;
    const [nombre, n] = i === 1 ? [m[2], m[1]] : [m[1], m[2]], costo = Number(n.replace(',', '.'));
    const name = nombre.replace(/\b(?:ahora|ya|hoy|tambien)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (name.length >= 3 && costo > 0) return { nombre: name, costo };
  }
  return null;
}
// (A2, memoria de negocio) Tres cambios, TODOS detrás de opts.memory === true (el Worker lo pasa SOLO con ASSISTANT_MEMORY_V=1, vía memoryOn(env)):
//  1) Existencias («tienen 24 en stock», «quedan 3», «el stock de leche es de 12»): cambian con cada venta; guardadas como enseñanza se
//     vuelven viejas y contradicen al inventario. «stock mínimo/máximo» sí es una preferencia y se conserva.
//  2) Operaciones sobre un hecho ya guardado («Olvida la regla…», «Corrige tu recuerdo…», «Usa mi preferencia…»): no son una lección nueva.
//  3) Preferencias sin número («Recuerda que vendo por display»): guardan MÁS.
//  SIN el flag (apagado, por defecto) taughtFact devuelve EXACTAMENTE lo mismo que antes de este cambio (915a3bdc) para cualquier texto
//  (decisión de A1/A3/A5/PROGRAMADOR, ronda 3, opción b; lo vigila la prueba «apagado = main»).
const foldT = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const STOCK_LEVEL = /\b(?:stock|inventario|existencias?)\s+(?:minim\w*|maxim\w*|de\s+seguridad|critico|bajo)\b|\b(?:minim\w*|maxim\w*)\s+(?:de\s+)?(?:stock|inventario)\b/g;
const INVENTORY_RE = /\b(?:stock|inventario|existencias?|almacen|bodega|estante|anaquel|quedan?|quedaron|quedo|hay|disponibles?)\b|\b(?:tengo|tenemos|tenia|teniamos)\s+\d/;
export function isInventoryFact(text) { return INVENTORY_RE.test(foldT(text).replace(STOCK_LEVEL, ' ')); }
const OP_LEAD = /^(?:(?:por\s+favor|oye|ojo|ya|bueno|entonces|ahora)[,:]?\s+)*(olvida(?:te)?|borra|elimina|quita|corrige|corrijo|actualiza|cambia|modifica|reemplaza|usa|utiliza|aplica)\b\s*(?:que\s+)?/;
const MEMORY_WORD = /\b(?:regla|reglas|recuerdo|recuerdos|preferencia|preferencias|memoria|ensenanza|leccion|lo\s+que\s+te\s+ense\w*)\b/;
// {op:'olvidar'|'corregir'|'usar', objetivo, explicit} si la frase opera sobre un hecho ya enseñado (no es una enseñanza nueva); si no, null.
// explicit = nombra la memoria con una palabra clara (regla/recuerdo/preferencia/memoria/lo que te enseñé). SOLO una operación explícita se EJECUTA (M-3: «elimina el producto
// leche que trae 24 del inventario» no olvida nada); las no explícitas solo se excluyen de «enseñanza nueva» (guardan menos).
export function memoryOperation(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim(), t = foldT(raw), m = OP_LEAD.exec(t);
  if (!m || raw.length > 300 || isQuestion(raw)) return null;
  const verb = m[1], op = /^(?:olvida|borra|elimina|quita)/.test(verb) ? 'olvidar' : /^(?:corrige|corrijo|actualiza|cambia|modifica|reemplaza)/.test(verb) ? 'corregir' : 'usar';
  const memWord = MEMORY_WORD.test(t);
  if (op === 'olvidar' ? !(memWord || TEACH_FACT.test(t)) : !memWord) return null;
  return { op, objetivo: t.slice(m[0].length).trim(), explicit: memWord };
}
const PREF_CUE = /\b(?:vend[oe]|vendemos|prefiero|preferimos|uso|usamos|manejo|manejamos|trabajo\s+con|trabajamos\s+con|cobro|cobramos|redondeo|redondeamos)\s+\S/i;
export function taughtFact(text, opts = {}) {
  const t = String(text || '').replace(/\s+/g, ' ').trim(), mem = opts?.memory === true;
  if (!t || t.length > 300 || isQuestion(t) || statedCost(t)) return null;
  if (mem && (memoryOperation(t) || isInventoryFact(t))) return null;
  return (TEACH_LEAD.test(t) && (/\d|\b(?:solo|siempre|nunca|no\s+se)\b/i.test(t) || (mem && PREF_CUE.test(t)))) || (TEACH_FACT.test(t) && /\d/.test(t)) || SUPPLIER_FACT.test(t) ? t : null;
}
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sign(secret, value) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('invoice-memory:v1|' + value))));
}
async function scope(secret, auth) {
  return sign(secret, JSON.stringify([auth?.principalId || '', auth?.sessionId || auth?.credentialHash || '']));
}
export async function readInvoiceMemory(token, secret, auth, now) {
  if (!secret || typeof token !== 'string' || token.length > MAX_TOKEN) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra || sig !== await sign(secret, body)) return null;
  try {
    const raw = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    const m = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, c => c.charCodeAt(0))));
    if (!(m.v === 1 && m.scope === await scope(secret, auth) && m.exp > now && m.exp <= now + TTL && Array.isArray(m.invoices) && Array.isArray(m.clarifications))) return null;
    m.taught = Array.isArray(m.taught) ? m.taught.filter((x) => typeof x === 'string').slice(-MAX_TAUGHT) : [];
    return m;
  } catch { return null; }
}
export async function writeInvoiceMemory({previous, image, proposals, reply, text, secret, auth, now, clean, memory = false}) {
  if (!secret) return null;
  const purchases = proposals.filter(p => p.type === 'compra');
  const fresh = !!image || purchases.length > 0;
  const fact = !image ? taughtFact(text, { memory: memory === true }) : null, taughtBefore = previous?.taught || [];
  if (!fresh && !previous && !fact) return null;
  const oldDocs = new Set((previous?.invoices || []).map(p => p.documento).filter(Boolean));
  const newDocument = purchases.some(p => p.documento && oldDocs.size && !oldDocs.has(clean(p.documento).slice(0,80)));
  const keep = previous && !image && !newDocument;
  const m = fresh ? {v:1, scope:await scope(secret, auth), exp:keep ? previous.exp : now + TTL, invoices:purchases.slice(0,2).map(p => ({
    proveedor:clean(p.proveedor || '').slice(0,120), documento:clean(p.documento || '').slice(0,80), fecha:clean(p.fecha || '').slice(0,20),
    lineas:(p.lineas || []).slice(0,30).map(l => ({nombre:clean(l.nombre || '').slice(0,160), cantidad:l.cantidad, costo_unitario:l.costo_unitario}))
  })), lectura:clean(reply || '').slice(0,1500), clarifications:keep ? previous.clarifications : []}
    : previous ? {...previous} : {v:1, scope:await scope(secret, auth), exp:now + TTL, invoices:[], lectura:'', clarifications:[]};
  m.taught = taughtBefore.slice();
  if (fact) { const f = clean(fact).slice(0, 200); m.taught = [...m.taught.filter((x) => x !== f), f].slice(-MAX_TAUGHT); }
  // Las preguntas no deben expulsar equivalencias confirmadas. Una respuesta corta
  // conserva la pregunta previa para que «96» o «sí» no pierdan su significado.
  const question = isQuestion(text);
  if (keep && previous.invoices.length && text && !question) m.clarifications = [...m.clarifications, {usuario:clean(text).slice(0,500), pregunta_previa:previous.lastReply || ''}].slice(-8);
  m.lastReply = clean(reply || '').slice(0,600);
  const body = b64(enc.encode(JSON.stringify(m)));
  const token = body + '.' + await sign(secret, body);
  return token.length <= MAX_TOKEN ? token : null;
}
export function invoiceMemoryMessage(memory) {
  if (!memory || (!memory.invoices.length && !memory.clarifications.length && !memory.lectura)) return null;
  return {role:'user', content:'<boleta_recordada>\n' + JSON.stringify({facturas:memory.invoices, lectura:memory.lectura, aclaraciones_del_usuario:memory.clarifications}).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') + '\n</boleta_recordada>'};
}
// Lo enseñado por el Admin, aparte de la boleta: dato del usuario, no instrucciones.
// lessons: lo guardado HOY en el servidor (readLessons de pos-assistant.js); se une con lo del token sin repetir.
export function taughtMemoryMessage(memory, lessons = []) {
  const list = [...new Set([...(Array.isArray(lessons) ? lessons : []), ...(memory && Array.isArray(memory.taught) ? memory.taught : [])])].slice(-MAX_TAUGHT);
  if (!list.length) return null;
  return {role:'user', content:'<ensenado_por_usuario>\n' + JSON.stringify({dicho_por_el_usuario:list}).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') + '\n</ensenado_por_usuario>'};
}
