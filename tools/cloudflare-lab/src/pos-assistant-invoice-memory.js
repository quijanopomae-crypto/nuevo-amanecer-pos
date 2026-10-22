// Memoria efímera de la boleta, sin foto ni escritura en BD. Solo el Admin y su sesión.
// La firma protege la procedencia del extracto; NO convierte el documento en instrucciones.
const TTL = 8 * 60 * 60 * 1000, MAX_TOKEN = 32000;
const enc = new TextEncoder();
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
    return m.v === 1 && m.scope === await scope(secret, auth) && m.exp > now && m.exp <= now + TTL && Array.isArray(m.invoices) && Array.isArray(m.clarifications) ? m : null;
  } catch { return null; }
}
export async function writeInvoiceMemory({previous, image, proposals, reply, text, secret, auth, now, clean}) {
  if (!secret) return null;
  const purchases = proposals.filter(p => p.type === 'compra');
  const fresh = !!image || purchases.length > 0;
  if (!fresh && !previous) return null;
  const oldDocs = new Set((previous?.invoices || []).map(p => p.documento).filter(Boolean));
  const newDocument = purchases.some(p => p.documento && oldDocs.size && !oldDocs.has(clean(p.documento).slice(0,80)));
  const keep = previous && !image && !newDocument;
  const m = fresh ? {v:1, scope:await scope(secret, auth), exp:keep ? previous.exp : now + TTL, invoices:purchases.slice(0,2).map(p => ({
    proveedor:clean(p.proveedor || '').slice(0,120), documento:clean(p.documento || '').slice(0,80), fecha:clean(p.fecha || '').slice(0,20),
    lineas:(p.lineas || []).slice(0,30).map(l => ({nombre:clean(l.nombre || '').slice(0,160), cantidad:l.cantidad, costo_unitario:l.costo_unitario}))
  })), lectura:clean(reply || '').slice(0,1500), clarifications:keep ? previous.clarifications : []} : {...previous};
  // Las preguntas no deben expulsar equivalencias confirmadas. Una respuesta corta
  // conserva la pregunta previa para que «96» o «sí» no pierdan su significado.
  const question = /[¿?]|^(?:cu[aá]nt|c[oó]mo|qu[eé]|puedes|recu[eé]rdame|prepara|revisa|y\s+(?:cu[aá]nt|qu[eé]))/i.test(String(text || '').trim());
  if (keep && text && !question) m.clarifications = [...m.clarifications, {usuario:clean(text).slice(0,500), pregunta_previa:previous.lastReply || ''}].slice(-8);
  m.lastReply = clean(reply || '').slice(0,600);
  const body = b64(enc.encode(JSON.stringify(m)));
  const token = body + '.' + await sign(secret, body);
  return token.length <= MAX_TOKEN ? token : null;
}
export function invoiceMemoryMessage(memory) {
  if (!memory) return null;
  return {role:'user', content:'<boleta_recordada>\n' + JSON.stringify({facturas:memory.invoices, lectura:memory.lectura, aclaraciones_del_usuario:memory.clarifications}).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') + '\n</boleta_recordada>'};
}
