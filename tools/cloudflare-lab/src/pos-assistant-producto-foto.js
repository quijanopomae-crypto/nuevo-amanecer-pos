// «Foto de producto» (solo Admin). SIN migración y SIN guardar nada.
// - El aparato del Admin manda UNA foto de la etiqueta o el empaque (data:image/jpeg|png|webp;base64, máx. 4 MB) a
//   POST /auth/assistant/producto-foto. Se pasa al mismo modelo con visión que «Leer boleta con IA».
// - El modelo responde SOLO JSON {nombre, marca, presentacion, contenido, unidad, codigo_barras, precio_etiqueta, categoria, rotacion}.
//   Aquí se normaliza (null para lo ilegible) y se revisa: el código de barras EAN-13/EAN-8/UPC-A debe pasar su dígito de control.
// - Nada se guarda: el aparato muestra la revisión y, si el Admin confirma, solo PRELLENA el formulario «Nuevo producto» de siempre
//   (el producto se crea cuando él pulsa Guardar). El precio de venta lo pone el Admin; el de la etiqueta es solo una sugerencia.
// - Empleado o aparato sin rol: 403 producto_foto_admin_only, sin leer la foto ni gastar cupo. Nunca se registra la foto ni la clave.
import { assistantAccess } from './pos-assistant-access.js';
import { reserveUsage, createSettingsUsageStore, readBounded, IMAGE_UNSUPPORTED } from './pos-assistant.js';
import { resolveProvider, callModel } from './pos-assistant-providers.js';
import { readProviderChoice } from './pos-assistant-provider-route.js';
import { BOLETA_LIMITS, extractJson, parseAmount } from './pos-assistant-boleta.js';

export const PRODUCTO_FOTO_PATH = '/auth/assistant/producto-foto';
export const PRODUCTO_FOTO_LIMITS = Object.freeze({ imageBytes: BOLETA_LIMITS.imageBytes, bodyBytes: BOLETA_LIMITS.bodyBytes, modelMs: 60000 });
export const PRODUCTO_FOTO_DENIED = Object.freeze({ error: 'producto_foto_admin_only', message: 'La foto de producto es solo para el Admin.' });
export const PRODUCTO_FOTO_PROMPT = 'Lee la etiqueta o el empaque de este producto de una bodega o botica (Perú). Responde SOLO con un objeto JSON, sin texto antes ni después, sin markdown, con esta forma exacta: '
  + '{"nombre": string|null, "marca": string|null, "presentacion": string|null, "contenido": string|null, "unidad": string|null, "codigo_barras": string|null, "precio_etiqueta": number|null, "categoria": string|null, "rotacion": 0|90|180|270}. '
  + '"nombre" = nombre comercial del producto (sin la marca si ya va aparte). "presentacion" = forma (tableta, jarabe, caja, botella, sobre…). "contenido" = cantidad y medida (500 mg, 120 ml, 1 kg, x 100 tabletas). '
  + '"codigo_barras" = SOLO los dígitos impresos bajo el código de barras. "precio_etiqueta" = precio impreso en soles, si hay. '
  + 'Usa null para todo lo que no se lea con seguridad; no inventes. No transcribas lote, registro sanitario, RUC, teléfonos ni direcciones. '
  + '"rotacion" = grados que hay que girar la foto en el sentido del reloj para que el texto quede derecho (0 si ya está derecho).';
const IMG_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const str = (v, n) => { if (v == null) return null; const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, n) : null; };
// Lo que no debe colarse en un nombre de producto (RUC, teléfonos, correos, enlaces).
const clean = (v, n) => { const s = str(v, n * 2); if (!s) return null; const t = s.replace(/https?:\/\/\S+/gi, '').replace(/\b(?:tel[eé]fono|telf?|cel(?:ular)?|whatsapp|wsp|ruc)\b\.?:?/gi, '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '').replace(/\b\d{9,11}\b/g, '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, n) : null; };

// UPC-E (8 dígitos, sistema 0 o 1) -> UPC-A de 12, para revisar su dígito de control. Si no es UPC-E: null.
export function upcEToA(code) {
  const s = String(code || ''); if (!/^[01]\d{7}$/.test(s)) return null;
  const d = s.slice(1, 7), c = s[7], last = Number(d[5]);
  const body = last <= 2 ? d.slice(0, 2) + d[5] + '0000' + d.slice(2, 5) : last === 3 ? d.slice(0, 3) + '00000' + d.slice(3, 5) : last === 4 ? d.slice(0, 4) + '00000' + d[4] : d.slice(0, 5) + '0000' + d[5];
  return s[0] + body + c;
}
const gs1 = (s) => { let sum = 0; for (let i = s.length - 2, k = 0; i >= 0; i--, k++) sum += Number(s[i]) * (k % 2 === 0 ? 3 : 1); return (10 - (sum % 10)) % 10 === Number(s[s.length - 1]); };
// Dígito de control GS1 (EAN-8, UPC-E, UPC-A de 12, EAN-13, GTIN-14).
export function barcodeValid(code) {
  const s = String(code || ''); if (!/^(?:\d{8}|\d{12,14})$/.test(s)) return false;
  if (gs1(s)) return true;
  const a = s.length === 8 ? upcEToA(s) : null; return !!a && gs1(a);
}
export function normalizeProductoFoto(o) {
  const digits = o?.codigo_barras == null ? '' : String(o.codigo_barras).replace(/[\s-]/g, '');
  const leido = /^\d{6,14}$/.test(digits) ? digits : null, valido = !!leido && barcodeValid(leido);
  const rot = Number(o?.rotacion), precio = parseAmount(o?.precio_etiqueta);
  const p = { nombre: clean(o?.nombre, 80), marca: clean(o?.marca, 40), presentacion: clean(o?.presentacion, 40), contenido: clean(o?.contenido, 40), unidad: clean(o?.unidad, 20),
    codigo_barras: valido ? leido : null, codigo_leido: leido, precio_etiqueta: precio != null && precio > 0 && precio < 100000 ? precio : null,
    categoria: clean(o?.categoria, 40), rotacion: [0, 90, 180, 270].includes(rot) ? rot : 0 };
  // Nombre sugerido para «Nuevo producto»: nombre + marca + contenido, sin repetir lo que ya dice el nombre.
  const parts = [p.nombre]; for (const x of [p.marca, p.contenido]) if (x && !(p.nombre || '').toLowerCase().includes(x.toLowerCase())) parts.push(x);
  p.nombre_sugerido = parts.filter(Boolean).join(' ').slice(0, 80) || null;
  return p;
}
export function productoFotoChecks(p) {
  const fields = ['nombre', 'marca', 'presentacion', 'contenido', 'codigo_leido'], nulls = fields.filter((f) => p[f] == null).length;
  return { nulls, sin_nombre: !p.nombre_sugerido, barcode_invalid: !!p.codigo_leido && !p.codigo_barras, mostly_null: !p.nombre_sugerido || nulls >= 4, rotated: p.rotacion !== 0 };
}
export function productoFotoRequest(image) {
  return { messages: [{ role: 'system', content: 'Lees etiquetas de productos para el catálogo de una bodega. Respondes solo JSON válido.' },
    { role: 'user', content: [{ type: 'text', text: PRODUCTO_FOTO_PROMPT }, { type: 'image_url', image_url: { url: image, detail: 'high' } }] }],
  temperature: 0, max_tokens: 600 };
}

export async function assistantProductoFotoRoute(request, env, auth, json, deps = {}) {
  if (String(env?.ASSISTANT_ENABLED || '') !== '1') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const role = deps.resolveRole ? await deps.resolveRole(auth) : await assistantAccess(deps.db, auth);
  if (role !== 'owner' || auth?.posRole !== 'owner') return json(PRODUCTO_FOTO_DENIED, 403); // antes de leer el cuerpo: sin cupo ni modelo
  if (Number(request.headers.get('content-length') || 0) > PRODUCTO_FOTO_LIMITS.bodyBytes) return json({ error: 'payload_too_large' }, 413);
  const raw = await readBounded(request, PRODUCTO_FOTO_LIMITS.bodyBytes);
  if (raw === null) return json({ error: 'payload_too_large' }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad_request' }, 400); }
  const image = typeof body?.image === 'string' ? body.image : '';
  if (!IMG_RE.test(image)) return json({ error: 'bad_image' }, 400);
  if (Math.floor((image.length - image.indexOf(',') - 1) * 3 / 4) > PRODUCTO_FOTO_LIMITS.imageBytes) return json({ error: 'payload_too_large' }, 413);
  const store = deps.store || (deps.db ? createSettingsUsageStore(deps.db) : null);
  if (!store) return json({ error: 'usage_store_missing' }, 500);
  const cfg = resolveProvider(env, await readProviderChoice(store));
  if (!cfg.ok || !cfg.vision) return json(IMAGE_UNSUPPORTED, 503);
  const now = (deps.now || Date.now)();
  const quota = await reserveUsage(store, { ...auth, posRole: role }, env, now, true);
  if (!quota.ok) return json({ error: quota.reason, retry_after_s: quota.retryAfter || null }, quota.reason === 'busy' ? 503 : 429);
  const t0 = (deps.clock || Date.now)();
  const r = await callModel(cfg, productoFotoRequest(image), deps.fetch || fetch, deps.timeoutMs || PRODUCTO_FOTO_LIMITS.modelMs);
  const ms = Math.max(0, (deps.clock || Date.now)() - t0);
  if (r.error) { const timeout = r.error === 'upstream_timeout'; return json({ error: timeout ? 'producto_foto_timeout' : 'upstream_error', ms }, timeout ? 504 : 502); }
  const o = extractJson(r.content);
  if (!o) return json({ error: 'producto_foto_unreadable', ms }, 422);
  const producto = normalizeProductoFoto(o);
  return json({ ok: true, producto, checks: productoFotoChecks(producto), ms, model: r.model || cfg.model });
}
