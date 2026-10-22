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
const QUESTION = /[¿?]|^(?:cu[aá]nt|c[oó]mo|qu[eé]|cu[aá]l|d[oó]nde|puedes|podr[ií]as|recu[eé]rdame|prepara|revisa|dime|dame|mu[eé]strame|y\s+(?:cu[aá]nt|qu[eé]))/i;
export function taughtFact(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 300 || QUESTION.test(t)) return null;
  return (TEACH_LEAD.test(t) && /\d|\b(?:solo|siempre|nunca|no\s+se)\b/i.test(t)) || (TEACH_FACT.test(t) && /\d/.test(t)) || SUPPLIER_FACT.test(t) ? t : null;
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
export async function writeInvoiceMemory({previous, image, proposals, reply, text, secret, auth, now, clean}) {
  if (!secret) return null;
  const purchases = proposals.filter(p => p.type === 'compra');
  const fresh = !!image || purchases.length > 0;
  const fact = !image ? taughtFact(text) : null, taughtBefore = previous?.taught || [];
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
  const question = /[¿?]|^(?:cu[aá]nt|c[oó]mo|qu[eé]|puedes|recu[eé]rdame|prepara|revisa|y\s+(?:cu[aá]nt|qu[eé]))/i.test(String(text || '').trim());
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
