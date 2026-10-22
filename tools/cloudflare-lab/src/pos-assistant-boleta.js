// «Leer boleta con IA» (solo Admin, rama feature/asistente-aislado, prototipo aislado). SIN migración y SIN guardar nada.
// - El aparato del Admin manda UNA foto ya achicada (máx. 4 MB, data:image/jpeg|png|webp;base64) a POST /auth/assistant/boleta.
// - Aquí se pasa al modelo con visión configurado (OhMyAgent gpt-6.1-sol por defecto; la clave es secreto del Worker
//   ASSISTANT_AI_API_KEY_4 u OHMYAGENT_API_KEY). Si el respaldo no lee fotos (Routeway Gemma), NO se usa para fotos.
// - El modelo responde SOLO JSON {numero, fecha, items[{cant, um, cod, descripcion, precio_unit, importe}], total, rotacion}; aquí se
//   normaliza (null para lo ilegible) y se revisa (suma de importes contra total, demasiados null). Nada se guarda ni toca stock:
//   el Admin revisa y confirma en el aparato, y eso solo PRELLENA la «Nueva compra» de siempre.
// - Empleado o aparato sin rol: 403 boleta_admin_only. Nunca se registra la foto ni la clave; los registros llevan solo códigos.
import { assistantAccess } from './pos-assistant-access.js';
import { reserveUsage, createSettingsUsageStore, readBounded, IMAGE_UNSUPPORTED, redactText } from './pos-assistant.js';
import { resolveProvider, callModel, stripThink } from './pos-assistant-providers.js';
import { readProviderChoice } from './pos-assistant-provider-route.js';
import { boletaNote } from './pos-assistant-memoria.js';

export const BOLETA_PATH = '/auth/assistant/boleta';
export const BOLETA_LIMITS = Object.freeze({ imageBytes: 4 * 1024 * 1024, bodyBytes: Math.ceil(4 * 1024 * 1024 * 4 / 3) + 16384, modelMs: 90000, maxItems: 80, maxHints: 20 });
export const BOLETA_DENIED = Object.freeze({ error: 'boleta_admin_only', message: 'Leer boletas con IA es solo para el Admin.' });
export const BOLETA_PROMPT = 'Lee esta boleta o factura de un proveedor (Perú). Responde SOLO con un objeto JSON, sin texto antes ni después, sin markdown, con esta forma exacta: '
  + '{"numero": string|null, "fecha": "AAAA-MM-DD"|null, "items": [{"cant": number|null, "um": string|null, "cod": string|null, "descripcion": string|null, "precio_unit": number|null, "importe": number|null}], "total": number|null, "rotacion": 0|90|180|270}. '
  + 'Usa null para todo lo que no se lea con seguridad; no inventes. Montos en soles como número con punto decimal, sin «S/». Una fila por producto. '
  + '"rotacion" = grados que hay que girar la foto en el sentido del reloj para que el texto quede derecho (0 si ya está derecho).';
const IMG_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const str = (v, n) => { if (v == null) return null; const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, n) : null; };

export function parseAmount(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v < 1e7 ? Math.round(v * 100) / 100 : null;
  let s = String(v).replace(/S\/\.?|PEN|soles?/gi, '').replace(/\s/g, '');
  if (!/\d/.test(s)) return null;
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = Number(s); return Number.isFinite(n) && n >= 0 && n < 1e7 ? Math.round(n * 100) / 100 : null;
}
export function parseFecha(v) {
  const s = str(v, 20); if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s), y, mo, d;
  if (m) [, y, mo, d] = m; else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) { [, d, mo, y] = m; if (y.length === 2) y = '20' + y; } else return null;
  y = +y; mo = +mo; d = +d; const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 2000 || y > 2100 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
// Primer objeto JSON del texto (tolera ```json …``` y <think>…</think>). null si no hay uno válido.
export function extractJson(text) {
  const t = stripThink(String(text ?? '')).replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'); if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < t.length; i++) { const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { try { const o = JSON.parse(t.slice(a, i + 1)); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; } } }
  return null;
}
export function normalizeBoleta(o) {
  const items = (Array.isArray(o?.items) ? o.items : []).slice(0, BOLETA_LIMITS.maxItems).filter((x) => x && typeof x === 'object').map((x) => {
    const cant = parseAmount(x.cant);
    return { cant, um: str(x.um, 20), cod: str(x.cod, 40), descripcion: str(x.descripcion, 120), precio_unit: parseAmount(x.precio_unit), importe: parseAmount(x.importe) }; });
  const rot = Number(o?.rotacion);
  return { numero: str(o?.numero, 40), fecha: parseFecha(o?.fecha), items, total: parseAmount(o?.total), rotacion: [0, 90, 180, 270].includes(rot) ? rot : 0 };
}
// Avisos para la pantalla de revisión: nulls, suma de importes ≠ total, foto dudosa (muchos null o rotada).
export function boletaChecks(b) {
  const fields = ['cant', 'um', 'cod', 'descripcion', 'precio_unit', 'importe'];
  let cells = 0, nulls = 0; for (const it of b.items) for (const f of fields) { cells++; if (it[f] == null) nulls++; }
  const head = [b.numero, b.fecha, b.total]; cells += 3; nulls += head.filter((x) => x == null).length;
  const sum = Math.round(b.items.reduce((t, it) => t + (it.importe || 0), 0) * 100) / 100;
  const mismatch = b.total != null && b.items.some((it) => it.importe != null) ? Math.abs(sum - b.total) > Math.max(0.05, b.total * 0.005) : false;
  const nullRatio = cells ? nulls / cells : 1;
  return { nulls, cells, null_ratio: Math.round(nullRatio * 100) / 100, sum, total_mismatch: mismatch, mostly_null: !b.items.length || nullRatio >= 0.5, rotated: b.rotacion !== 0 };
}
// Pistas de correcciones anteriores (las manda el aparato; solo productos/unidades, nunca clientes). Cortas y limpias.
export function cleanHints(h) {
  // (auditoría de privacidad 2026-10-22) además pasan por el MISMO redactor del asistente: si el redactor tapa algo (DNI, teléfono, correo,
  // RUC de persona, clave…), esa pista no se manda.
  const safe = (v) => { const t = str(v, 60); return t && redactText(t) === t ? t : null; };
  return (Array.isArray(h) ? h : []).slice(0, BOLETA_LIMITS.maxHints).map((x) => ({ campo: ['cod', 'descripcion', 'um'].includes(x?.campo) ? x.campo : null, de: safe(x?.de), a: safe(x?.a) }))
    .filter((x) => x.campo && x.de && x.a && !/\d{8,}|@/.test(x.de + x.a));
}
export function boletaRequest(image, hints = []) {
  const h = cleanHints(hints);
  const extra = h.length ? ' Correcciones que el Admin hizo antes en boletas parecidas (úsalas si ves lo mismo): ' + h.map((x) => x.campo + ' «' + x.de + '» -> «' + x.a + '»').join('; ') + '.' : '';
  return { messages: [{ role: 'system', content: 'Lees boletas de proveedores para una bodega. Respondes solo JSON válido.' },
    { role: 'user', content: [{ type: 'text', text: BOLETA_PROMPT + extra }, { type: 'image_url', image_url: { url: image, detail: 'high' } }] }],
  temperature: 0, max_tokens: 2500 };
}

export async function assistantBoletaRoute(request, env, auth, json, deps = {}) {
  if (String(env?.ASSISTANT_ENABLED || '') !== '1') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const role = deps.resolveRole ? await deps.resolveRole(auth) : await assistantAccess(deps.db, auth);
  if (role !== 'owner' || auth?.posRole !== 'owner') return json(BOLETA_DENIED, 403);
  if (Number(request.headers.get('content-length') || 0) > BOLETA_LIMITS.bodyBytes) return json({ error: 'payload_too_large' }, 413);
  const raw = await readBounded(request, BOLETA_LIMITS.bodyBytes);
  if (raw === null) return json({ error: 'payload_too_large' }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad_request' }, 400); }
  const image = typeof body?.image === 'string' ? body.image : '';
  if (!IMG_RE.test(image)) return json({ error: 'bad_image' }, 400);
  if (Math.floor((image.length - image.indexOf(',') - 1) * 3 / 4) > BOLETA_LIMITS.imageBytes) return json({ error: 'payload_too_large' }, 413);
  const store = deps.store || (deps.db ? createSettingsUsageStore(deps.db) : null);
  if (!store) return json({ error: 'usage_store_missing' }, 500);
  const cfg = resolveProvider(env, await readProviderChoice(store));
  if (!cfg.ok || !cfg.vision) return json(IMAGE_UNSUPPORTED, 503);
  const now = (deps.now || Date.now)();
  const quota = await reserveUsage(store, { ...auth, posRole: role }, env, now, true);
  if (!quota.ok) return json({ error: quota.reason, retry_after_s: quota.retryAfter || null }, quota.reason === 'busy' ? 503 : 429);
  const t0 = (deps.clock || Date.now)();
  const r = await callModel(cfg, boletaRequest(image, body?.hints), deps.fetch || fetch, deps.timeoutMs || BOLETA_LIMITS.modelMs);
  const ms = Math.max(0, (deps.clock || Date.now)() - t0);
  if (r.error) {
    const timeout = r.error === 'upstream_timeout';
    return json({ error: timeout ? 'boleta_timeout' : 'upstream_error', ms }, timeout ? 504 : 502); // sin cuerpo del proveedor ni clave
  }
  const o = extractJson(r.content);
  if (!o) return json({ error: 'boleta_unreadable', ms }, 422);
  const boleta = normalizeBoleta(o);
  // nota: memoria corta de lo leído (solo números, fecha y serie; nunca nombres) para que el asistente no vuelva a pedir la foto.
  return json({ ok: true, boleta, checks: boletaChecks(boleta), nota: boletaNote(boleta), ms, model: r.model || cfg.model });
}
