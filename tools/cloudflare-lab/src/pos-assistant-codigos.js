// Códigos de cliente neutros hacia la IA.
// Un código de cliente puede llevar el nombre (p. ej. «SIN-DOC-MISAEL»). Justo antes de cada llamada al proveedor (OhMyAgent, Routeway o
// cualquier otro; con y sin partes; reintentos y respaldo incluidos) el cuerpo que sale se reescribe: cada código real pasa a uno neutro
// «C-0001», «C-0002»… (orden de aparición, estable durante toda la conversación del pedido). Lo que vuelve (texto y argumentos de
// herramientas) se traduce al código real antes de leer la base y antes de llegar al aparato. Un neutro desconocido = «no encontrado»:
// en un campo de cliente queda UNKNOWN_CUSTOMER (customerCode lo rechaza), nunca se adivina.
export const UNKNOWN_CUSTOMER = '#?';
const CUST_KEYS = ['cliente_id', 'cliente', 'codigo_cliente', 'cliente_codigo'];
const CODE = '[A-Za-z0-9_-]{1,40}';
// Textos de ejemplo del esquema y de las instrucciones («cliente #CODIGO»): no son clientes.
const PLACEHOLDERS = new Set(['CODIGO', 'codigo', 'Codigo', 'CODE', 'code', 'CODIGO_CLIENTE']);
const PREFIX = '([Cc][Ll][Ii][Ee][Nn][Tt][Ee]\\s*#\\s*)(' + CODE + ')(?![\\p{L}\\p{N}_-])';
const KEYED = '("(?:' + CUST_KEYS.join('|') + ')"\\s*:\\s*"#?\\s*)(' + CODE + ')(?=")';
const NEUTRAL_RE = /(?<![A-Za-z0-9_-])C-\d{4,6}(?![A-Za-z0-9_-])/gi;
const NEUTRAL_FIELD = /^((?:cliente\s*)?#?\s*)(C-\d{4,6})$/i;
const BARE_CODE = new RegExp('^#?\\s*(' + CODE + ')$');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Solo los códigos que parecen nombre se cambian también sueltos (fuera de «cliente #…»): un código corto o numérico suelto («C1», «41»)
// podría ser una cantidad o un producto.
const nameLike = (c) => c.length >= 5 && /[A-Za-z]{3,}/.test(c);
const isImageData = (o, k) => k === 'data' && o && (o.mime_type || o.mimeType || o.media_type);

export function createCodeMap() {
  const toN = new Map(), toR = new Map(); let next = 1;
  const pad = (n) => 'C-' + String(n).padStart(4, '0');
  const add = (real) => {
    if (!real || PLACEHOLDERS.has(real) || toN.has(real)) return;
    let n; do { n = pad(next++); } while (toN.has(n) || toR.has(n.toUpperCase())); // un código real con forma de neutro no se pisa
    toN.set(real, n); toR.set(n.toUpperCase(), real);
  };
  const collectStr = (s) => {
    for (const m of s.matchAll(new RegExp(PREFIX, 'gu'))) add(m[2]);
    for (const m of s.matchAll(new RegExp(KEYED, 'g'))) add(m[2]);
  };
  const walk = (v, fs, fkey, parent, key) => {
    if (typeof v === 'string') { if (isImageData(parent, key) || /^data:[^,]{0,80};base64,/.test(v)) return v; return CUST_KEYS.includes(key) ? fkey(v) : fs(v); }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, fs, fkey, v, i));
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x, fs, fkey, v, k); return o; }
    return v;
  };
  let reCache = null, reSize = -1;
  const replaceRe = () => {
    if (reSize === toN.size) return reCache;
    const bare = [...toN.keys()].filter(nameLike).sort((a, b) => b.length - a.length).map(esc);
    reCache = new RegExp(PREFIX + '|' + KEYED + (bare.length ? '|(?<![A-Za-z0-9_-])(' + bare.join('|') + ')(?![A-Za-z0-9_-])' : ''), 'gu');
    reSize = toN.size; return reCache;
  };
  // Una sola pasada por texto: un reemplazo nunca se vuelve a reemplazar.
  const outStr = (s) => (toN.size ? s.replace(replaceRe(), (m, p1, c1, p2, c2, b) => {
    if (c1 !== undefined) return toN.has(c1) ? p1 + toN.get(c1) : m;
    if (c2 !== undefined) return toN.has(c2) ? p2 + toN.get(c2) : m;
    return toN.get(b) || m;
  }) : s);
  const outKey = (s) => { const m = BARE_CODE.exec(s.trim()); if (m) { add(m[1]); if (toN.has(m[1])) return s.replace(m[1], toN.get(m[1])); } return outStr(s); };
  const collectKey = (s) => { const m = BARE_CODE.exec(s.trim()); if (m) add(m[1]); collectStr(s); return s; };
  const toReal = (t) => (typeof t === 'string' && toR.size ? t.replace(NEUTRAL_RE, (m) => toR.get(m.toUpperCase()) ?? m) : t);
  const inKey = (s) => { const m = NEUTRAL_FIELD.exec(s.trim()); if (m) { const r = toR.get(m[2].toUpperCase()); return r ? m[1] + r : toN.has(m[2]) ? s : UNKNOWN_CUSTOMER; } return toReal(s); };
  const self = {
    size: () => toN.size,
    neutral: (real) => toN.get(real) || null,
    real: (n) => toR.get(String(n || '').toUpperCase()) || null,
    // Todo el cuerpo de la llamada (JSON en texto): sistema, historial, resumen, memoria, resultados de herramientas, lecciones…
    outbound(body) {
      if (typeof body !== 'string') return body;
      let j; try { j = JSON.parse(body); } catch { collectStr(body); return outStr(body); }
      walk(j, (s) => { collectStr(s); return s; }, collectKey);
      return JSON.stringify(walk(j, outStr, outKey));
    },
    toReal,
    argsToReal(a) {
      if (a && typeof a === 'object') return walk(a, toReal, inKey);
      if (typeof a !== 'string') return a;
      let j; try { j = JSON.parse(a); } catch { return toReal(a); }
      return j && typeof j === 'object' ? JSON.stringify(walk(j, toReal, inKey)) : toReal(a);
    },
    callsToReal: (calls) => (Array.isArray(calls) ? calls.map((c) => (c && typeof c === 'object' ? { ...c, arguments: self.argsToReal(c.arguments) } : c)) : calls),
    fetch: (fetchImpl) => (url, init) => fetchImpl(url, init && typeof init.body === 'string' ? { ...init, body: self.outbound(init.body) } : init),
    // En partes: un neutro puede venir cortado («… C-00» + «01 …»). Se retiene la última palabra mientras pueda ser el comienzo de uno.
    streamer(onText) {
      let held = '';
      return {
        push(t) {
          const s = held + String(t || ''); const tail = /[A-Za-z0-9_-]*$/.exec(s)[0];
          const keep = /^C(?:-\d{0,6})?$/i.test(tail) ? tail : '';
          held = keep; const out = toReal(s.slice(0, s.length - keep.length)); if (out) onText(out);
        },
        flush() { const out = toReal(held); held = ''; if (out) onText(out); },
        drop() { held = ''; },
      };
    },
  };
  return self;
}
