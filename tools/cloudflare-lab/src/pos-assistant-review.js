// «Revisión del punto de venta» (solo Admin, rama feature/asistente-aislado, prototipo aislado). SIN migración y SIN guardar nada:
// - El aparato del Admin junta en su propio almacenamiento (localStorage, ver asistente-loader.js) los errores del POS (window error,
//   unhandledrejection, respuestas 4xx/5xx de la API vistas con PerformanceObserver) y contadores por pantalla/acción. Sin datos de
//   clientes, montos ni secretos: mensajes cortados y limpiados en el aparato, y otra vez aquí con el MISMO redactor del asistente.
// - Solo cuando el Admin lo pide, el aparato manda ese resumen a POST /auth/assistant/review. Aquí se agrupa, se arma un informe breve
//   en español (el modelo lo redacta si hay proveedor; si no, o si falla, sale el resumen fijo) y se responde. No se escribe en la base
//   salvo el contador de uso de siempre (cuenta como una pregunta: mismos topes por minuto, día y mes).
// - Empleado o aparato sin rol: 403 review_admin_only (sin cupo, sin modelo). No es un «acceso perdido»: el asistente del empleado sigue.
import { assistantAccess } from './pos-assistant-access.js';
import { redactText, redactOwnerText, reserveUsage, createSettingsUsageStore } from './pos-assistant.js';
import { resolveProvider, callModel } from './pos-assistant-providers.js';
import { readProviderChoice } from './pos-assistant-provider-route.js';

export const REVIEW_PATH = '/auth/assistant/review';
export const REVIEW_LIMITS = Object.freeze({ maxBodyBytes: 65536, maxErrors: 200, maxUsageKeys: 300, msgChars: 160, srcChars: 80, modelMs: 20000 });
export const REVIEW_DENIED = Object.freeze({ error: 'review_admin_only', message: 'La revisión del punto de venta es solo para el Admin.' });
const KINDS = new Set(['error', 'promesa', 'api']);
const SCREENS = Object.freeze({ pageMenu: 'Inicio', pagePOS: 'Vender', pageInventario: 'Inventario', pageClientes: 'Clientes', pageCaja: 'Caja', pageVentas: 'Ventas',
  pageProximamente: 'Próximamente', pageHistorialCompras: 'Compras', pageValorizacion: 'Valorización', pageVentasStock: 'Ventas y stock', pageReporteArqueo: 'Arqueo',
  pageKardex: 'Kardex', pageRotacionAbc: 'Rotación ABC', pageReporteDeuda: 'Deudas', pageCodigosDuplicados: 'Códigos duplicados', pageGastos: 'Gastos', pageConfig: 'Configuración' });

// Limpieza fuerte (además del redactor del asistente): montos, correos, números largos, claves/tokens y la parte ?… de una URL.
export function cleanReviewText(v, n) {
  let s = String(v == null ? '' : v).normalize('NFC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, 600);
  s = s.replace(/(https?:\/\/[^\s?#]*)[?#][^\s]*/gi, '$1')
    .replace(/\b(?:bearer|basic)\s+[^\s]+/gi, '[clave]')
    .replace(/\b(?:token|clave|password|contraseña|pin|secret|api[_-]?key|authorization)\b\s*[:=]\s*[^\s,;]+/gi, '[clave]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[correo]')
    .replace(/(?:S\/\.?|US\$|PEN|\$)\s?-?\d[\d.,]*/gi, '[monto]')
    .replace(/\b\d+[.,]\d{1,2}\b/g, '[monto]')
    .replace(/[A-Za-z0-9_+/=-]{24,}/g, '[clave]')
    .replace(/\d{6,}/g, '[num]');
  s = redactText(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
const int = (v, max) => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x > 0 ? Math.min(x, max) : 0; };
const iso = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? v : null);
const KEY_RE = /^[A-Za-z][A-Za-z0-9_#-]{0,30}(?::[A-Za-z0-9_#-]{1,40}){0,2}$/;

// Lo que llega del aparato -> grupos limpios (se juntan los iguales tras limpiar) y contadores con nombres válidos.
export function sanitizeReview(body) {
  const errs = Array.isArray(body?.errors) ? body.errors.slice(0, REVIEW_LIMITS.maxErrors) : [];
  const by = new Map();
  for (const e of errs) {
    if (!e || typeof e !== 'object') continue;
    const kind = KINDS.has(e.kind) ? e.kind : 'error';
    const status = kind === 'api' ? int(e.status, 599) : 0;
    const msg = cleanReviewText(e.msg, REVIEW_LIMITS.msgChars), src = cleanReviewText(e.src, REVIEW_LIMITS.srcChars);
    if (!msg && !src) continue;
    const k = kind + '|' + status + '|' + msg + '|' + src, n = int(e.count, 1e6) || 1, g = by.get(k);
    if (g) { g.count += n; if ((iso(e.last) || '') > (g.last || '')) g.last = iso(e.last); }
    else by.set(k, { kind, status: status || null, msg, src, count: n, first: iso(e.first), last: iso(e.last) });
  }
  const groups = [...by.values()].sort((a, b) => b.count - a.count || String(b.last).localeCompare(String(a.last)));
  const usage = [];
  const u = body?.usage && typeof body.usage === 'object' && !Array.isArray(body.usage) ? body.usage : {};
  for (const [k, v] of Object.entries(u).slice(0, REVIEW_LIMITS.maxUsageKeys)) { const n = int(v, 1e7); if (n && KEY_RE.test(k)) usage.push({ key: k, label: usageLabel(k), count: n }); }
  usage.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return { groups, usage };
}
export function usageLabel(key) {
  const [scr, act, arg] = String(key).split(':'); const s = SCREENS[scr] || scr;
  if (!act) return s;
  const a = act === 'goPage' && SCREENS[arg] ? 'ir a ' + SCREENS[arg] : act + (arg ? ' ' + arg : '');
  return s + ' · ' + a;
}
const kindLabel = (g) => (g.kind === 'api' ? 'Respuesta ' + (g.status || '?') + ' de la API' : g.kind === 'promesa' ? 'Promesa sin atender' : 'Error de pantalla');

// Informe fijo (siempre disponible; el modelo solo lo redacta mejor). Sin «**» ni markdown: viñetas «•».
export function buildReviewSummary({ groups, usage }) {
  const total = groups.reduce((t, g) => t + g.count, 0), L = ['Revisión del punto de venta'];
  if (!groups.length) L.push('Errores: ninguno guardado en este aparato.');
  else { L.push('Errores: ' + groups.length + (groups.length === 1 ? ' tipo, ' : ' tipos, ') + total + (total === 1 ? ' vez.' : ' veces en total.'));
    for (const g of groups.slice(0, 8)) L.push('• ' + g.count + (g.count === 1 ? ' vez: ' : ' veces: ') + kindLabel(g) + (g.msg ? ', ' + g.msg : '') + (g.src ? ' (' + g.src + ')' : '')); }
  if (usage.length) {
    L.push('Lo más usado: ' + usage.slice(0, 5).map((x) => x.label + ' (' + x.count + ')').join(', ') + '.');
    if (usage.length > 5) L.push('Lo menos usado: ' + usage.slice(-5).reverse().map((x) => x.label + ' (' + x.count + ')').join(', ') + '.');
  } else L.push('Uso: todavía no hay contadores en este aparato.');
  const tips = [];
  const api5 = groups.filter((g) => g.kind === 'api' && g.status >= 500), api4 = groups.filter((g) => g.kind === 'api' && g.status >= 400 && g.status < 500);
  if (api5.length) tips.push('Revisar el servidor en ' + api5.slice(0, 2).map((g) => g.src || g.msg).join(' y ') + ': respondió con error ' + api5.reduce((t, g) => t + g.count, 0) + ' veces.');
  if (api4.some((g) => g.status === 401 || g.status === 403)) tips.push('Hubo respuestas 401/403: revisar si la sesión vence o si falta un permiso.');
  else if (api4.length) tips.push('Hubo pedidos rechazados (4xx): revisar los datos que manda esa pantalla.');
  const js = groups.filter((g) => g.kind !== 'api');
  if (js.length) tips.push('Corregir primero el error de pantalla más repetido: ' + (js[0].msg || js[0].src) + '.');
  if (usage.length > 5) tips.push('«' + usage[usage.length - 1].label + '» casi no se usa: ver si se puede simplificar o mover a un lugar más visible.');
  if (!tips.length) tips.push('Todo en orden por ahora. Vuelva a pedir la revisión en unos días.');
  L.push('Sugerencias:'); for (const t of tips.slice(0, 4)) L.push('• ' + t);
  return L.join('\n');
}

function reviewPrompt(summary) {
  return [{ role: 'system', content: 'Eres Burbuja, ayudante del Admin de una bodega. Con SOLO los datos de abajo, escribe en español, tratando de usted, un informe breve (máximo 14 líneas) con tres partes: «Errores» (agrupados, con cuántas veces), «Uso» (lo más y lo menos usado) y «Sugerencias de mejora» (2 a 4, concretas). No inventes datos, no uses markdown ni asteriscos; usa «•» para las listas. No escribas guiones largos.' },
    { role: 'user', content: summary }];
}

export async function assistantReviewRoute(request, env, auth, json, deps = {}) {
  if (String(env?.ASSISTANT_ENABLED || '') !== '1') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const role = deps.resolveRole ? await deps.resolveRole(auth) : await assistantAccess(deps.db, auth);
  if (role !== 'owner' || auth?.posRole !== 'owner') return json(REVIEW_DENIED, 403);
  if (Number(request.headers.get('content-length') || 0) > REVIEW_LIMITS.maxBodyBytes) return json({ error: 'payload_too_large' }, 413);
  let raw; try { raw = await request.text(); } catch { return json({ error: 'bad_request' }, 400); }
  if (raw.length > REVIEW_LIMITS.maxBodyBytes) return json({ error: 'payload_too_large' }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad_request' }, 400); }
  const data = sanitizeReview(body), summary = buildReviewSummary(data);
  const store = deps.store || (deps.db ? createSettingsUsageStore(deps.db) : null);
  if (!store) return json({ error: 'usage_store_missing' }, 500);
  const now = (deps.now || Date.now)();
  const cfg = resolveProvider(env, await readProviderChoice(store));
  let report = summary, source = 'resumen';
  if (cfg.ok) {
    const quota = await reserveUsage(store, { ...auth, posRole: role }, env, now, false);
    if (!quota.ok) return json({ error: quota.reason, retry_after_s: quota.retryAfter || null }, quota.reason === 'busy' ? 503 : 429);
    const r = await callModel(cfg, { messages: reviewPrompt(summary), max_tokens: 600, temperature: 0.2 }, deps.fetch || fetch, REVIEW_LIMITS.modelMs);
    const t = !r.error && typeof r.content === 'string' ? r.content.replace(/\*\*|__/g, '').replace(/\u2014/g, ',').trim() : '';
    if (t) { report = t.slice(0, 2000); source = 'modelo'; }
  }
  return json({ ok: true, report: redactOwnerText(report), source, groups: data.groups.slice(0, 20), top: data.usage.slice(0, 5), bottom: data.usage.length > 5 ? data.usage.slice(-5).reverse() : [],
    errors_total: data.groups.reduce((t, g) => t + g.count, 0), server_now: now });
}
