// «Revisión del punto de venta» (solo Admin, rama feature/asistente-aislado, prototipo aislado). SIN migración y SIN guardar nada:
// - El aparato del Admin junta en su propio almacenamiento (localStorage, ver asistente-loader.js) los errores del POS (window error,
//   unhandledrejection, respuestas 4xx/5xx de la API vistas con PerformanceObserver) y contadores por pantalla/acción. Sin datos de
//   clientes, montos ni secretos: mensajes cortados y limpiados en el aparato, y otra vez aquí con el MISMO redactor del asistente.
// - Solo cuando el Admin lo pide, el aparato manda ese resumen a POST /auth/assistant/review. Aquí se agrupa, se arma un informe breve
//   en español (el modelo lo redacta si hay proveedor; si no, o si falla, sale el resumen fijo) y se responde. No se escribe en la base
//   salvo el contador de uso de siempre (cuenta como una pregunta: mismos topes por minuto, día y mes).
// - Empleado o aparato sin rol: 403 review_admin_only (sin cupo, sin modelo). No es un «acceso perdido»: el asistente del empleado sigue.
// - También llegan lentitud (API > 3 s, tareas largas, pantallas lentas), cuelgues (latido > 5 s) y lecturas de boletas (duración, fallas,
//   correcciones por lectura). Si un problema fue con un cliente, llega SOLO su código interno (el id que ya tiene en la lista de clientes)
//   y la acción (abono, venta a crédito, editar cliente). Nombre, DNI, teléfono, dirección y montos nunca llegan ni van al modelo:
//   el informe nombra al cliente como «cliente #código» y el aparato del Admin lo convierte en enlace con el nombre, solo en pantalla.
import { assistantAccess } from './pos-assistant-access.js';
import { levelCan } from './pos-assistant-levels.js';
import { redactText, redactOwnerText, reserveUsage, createSettingsUsageStore } from './pos-assistant.js';
import { resolveProvider, callModel } from './pos-assistant-providers.js';
import { readProviderChoice } from './pos-assistant-provider-route.js';

export const REVIEW_PATH = '/auth/assistant/review';
export const REVIEW_LIMITS = Object.freeze({ maxBodyBytes: 98304, maxErrors: 200, maxUsageKeys: 300, maxSlow: 200, msgChars: 160, srcChars: 80, modelMs: 20000 });
export const REVIEW_DENIED = Object.freeze({ error: 'review_admin_only', message: 'La revisión del punto de venta es solo para el Admin.' });
const KINDS = new Set(['error', 'promesa', 'api']);
const SLOW_KINDS = new Set(['api', 'tarea', 'pantalla', 'cuelgue']);
export const CUSTOMER_ACTIONS = Object.freeze(['abono', 'venta a crédito', 'editar cliente', 'ver cliente']);
// Código de cliente: el id que ya existe en la lista de clientes (p. ej. 1729550000000 o un id del canon). Solo letras, números, _ y -.
export const CUSTOMER_CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;
const cliOf = (e) => (typeof e?.cli === 'string' || typeof e?.cli === 'number') && CUSTOMER_CODE_RE.test(String(e.cli)) ? String(e.cli) : null;
const accionOf = (e, cli) => (cli ? (CUSTOMER_ACTIONS.includes(e?.accion) ? e.accion : 'cliente') : null);
export const customerRef = (code) => 'cliente #' + code;
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
// Errores de pantalla y promesas: SOLO el tipo («TypeError», «Error»), nunca el mensaje (puede traer nombres o datos del cliente).
// Origen: SOLO archivo y línea («js/a.js:9»). Las llamadas a la API guardan su ruta (sin consulta) como antes.
export function errorType(v) {
  const t = String(v == null ? '' : v).trim();
  if (/^[A-Za-z]{1,40}$/.test(t)) return t;
  const m = /^(?:Uncaught\s+)?(?:\(in promise\)\s*)?([A-Z][A-Za-z]{0,39}(?:Error|Exception))\b/.exec(t);
  return m ? m[1] : 'Error';
}
export function fileLine(v) {
  const m = /^[A-Za-z0-9_./-]{1,80}(?::\d{1,7}){0,2}/.exec(cleanReviewText(v, REVIEW_LIMITS.srcChars).replace(/^https?:\/\/[^/\s]+\//i, ''));
  return m ? m[0] : '';
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
    const msg = kind === 'api' ? cleanReviewText(e.msg, REVIEW_LIMITS.msgChars) : errorType(e.msg), src = fileLine(e.src);
    if (!msg && !src) continue;
    const cli = cliOf(e), accion = accionOf(e, cli);
    const k = kind + '|' + status + '|' + msg + '|' + src + '|' + (cli || ''), n = int(e.count, 1e6) || 1, g = by.get(k);
    if (g) { g.count += n; if ((iso(e.last) || '') > (g.last || '')) g.last = iso(e.last); }
    else by.set(k, { kind, status: status || null, msg, src, count: n, first: iso(e.first), last: iso(e.last), ...(cli ? { cli, accion } : {}) });
  }
  const groups = [...by.values()].sort((a, b) => b.count - a.count || String(b.last).localeCompare(String(a.last)));
  const usage = [];
  const u = body?.usage && typeof body.usage === 'object' && !Array.isArray(body.usage) ? body.usage : {};
  for (const [k, v] of Object.entries(u).slice(0, REVIEW_LIMITS.maxUsageKeys)) { const n = int(v, 1e7); if (n && KEY_RE.test(k)) usage.push({ key: k, label: usageLabel(k), count: n }); }
  usage.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const sb = new Map();
  for (const x of (Array.isArray(body?.slow) ? body.slow : []).slice(0, REVIEW_LIMITS.maxSlow)) {
    if (!x || typeof x !== 'object' || !SLOW_KINDS.has(x.kind)) continue;
    const name = cleanReviewText(x.name, REVIEW_LIMITS.srcChars); if (!name) continue;
    const cli = cliOf(x), accion = accionOf(x, cli), n = int(x.count, 1e6) || 1, avg = int(x.ms_avg, 36e5), mx = int(x.ms_max, 36e5);
    const k = x.kind + '|' + name + '|' + (cli || ''), g = sb.get(k);
    if (g) { g.ms_avg = Math.round((g.ms_avg * g.count + avg * n) / (g.count + n)); g.count += n; g.ms_max = Math.max(g.ms_max, mx); }
    else sb.set(k, { kind: x.kind, name, label: x.kind === 'pantalla' || x.kind === 'tarea' || x.kind === 'cuelgue' ? (SCREENS[name] || name) : name, count: n, ms_avg: avg, ms_max: mx, ...(cli ? { cli, accion } : {}) });
  }
  const slow = [...sb.values()].sort((a, b) => (b.kind === 'cuelgue') - (a.kind === 'cuelgue') || b.count * b.ms_avg - a.count * a.ms_avg);
  const o = body?.ocr && typeof body.ocr === 'object' ? body.ocr : null;
  const ocr = o ? { reads: int(o.reads, 1e6), fails: int(o.fails, 1e6), timeouts: int(o.timeouts, 1e6), ms_avg: int(o.reads, 1e6) ? Math.round(int(o.ms_sum, 1e10) / int(o.reads, 1e6)) : 0,
    ms_max: int(o.ms_max, 36e5), confirmed: int(o.confirmed, 1e6), corrections: int(o.corrections, 1e7) } : null;
  return { groups, usage, slow, ocr: ocr && (ocr.reads || ocr.confirmed) ? ocr : null };
}
export function usageLabel(key) {
  const [scr, act, arg] = String(key).split(':'); const s = SCREENS[scr] || scr;
  if (!act) return s;
  const a = act === 'goPage' && SCREENS[arg] ? 'ir a ' + SCREENS[arg] : act + (arg ? ' ' + arg : '');
  return s + ' · ' + a;
}
const kindLabel = (g) => (g.kind === 'api' ? 'Respuesta ' + (g.status || '?') + ' de la API' : g.kind === 'promesa' ? 'Promesa sin atender' : 'Error de pantalla');
const secs = (ms) => (ms >= 10000 ? Math.round(ms / 1000) : Math.round(ms / 100) / 10).toString().replace('.', ',') + ' s';
const cliTxt = (g) => (g.cli ? ' [' + customerRef(g.cli) + ', ' + g.accion + ']' : '');
const slowLabel = (x) => (x.kind === 'api' ? 'Llamada lenta a ' + x.name : x.kind === 'pantalla' ? 'Pantalla lenta al abrir ' + x.label : x.kind === 'cuelgue' ? 'Se colgó en ' + x.label : 'Tarea larga en ' + x.label);

// Informe fijo (siempre disponible; el modelo solo lo redacta mejor). Sin «**» ni markdown: viñetas «•».
export function buildReviewSummary({ groups, usage, slow = [], ocr = null }) {
  const total = groups.reduce((t, g) => t + g.count, 0), L = ['Revisión del punto de venta'];
  if (!groups.length) L.push('Errores: ninguno guardado en este aparato.');
  else { L.push('Errores: ' + groups.length + (groups.length === 1 ? ' tipo, ' : ' tipos, ') + total + (total === 1 ? ' vez.' : ' veces en total.'));
    for (const g of groups.slice(0, 8)) L.push('• ' + g.count + (g.count === 1 ? ' vez: ' : ' veces: ') + kindLabel(g) + (g.msg ? ', ' + g.msg : '') + (g.src ? ' (' + g.src + ')' : '') + cliTxt(g)); }
  const hangs = slow.filter((x) => x.kind === 'cuelgue'), lag = slow.filter((x) => x.kind !== 'cuelgue');
  L.push(hangs.length ? 'Cuelgues: ' + hangs.reduce((t, x) => t + x.count, 0) + ' (pantalla congelada más de 5 s).' : 'Cuelgues: ninguno.');
  for (const x of hangs.slice(0, 4)) L.push('• ' + x.count + (x.count === 1 ? ' vez: ' : ' veces: ') + slowLabel(x) + ', hasta ' + secs(x.ms_max) + cliTxt(x));
  L.push(lag.length ? 'Lentitud: ' + lag.length + (lag.length === 1 ? ' punto lento.' : ' puntos lentos.') : 'Lentitud: nada lento guardado.');
  for (const x of lag.slice(0, 5)) L.push('• ' + x.count + (x.count === 1 ? ' vez: ' : ' veces: ') + slowLabel(x) + ', promedio ' + secs(x.ms_avg) + ', máximo ' + secs(x.ms_max) + cliTxt(x));
  if (ocr) {
    const fr = ocr.reads ? Math.round(ocr.fails / ocr.reads * 100) : 0, cpr = ocr.confirmed ? Math.round(ocr.corrections / ocr.confirmed * 10) / 10 : null;
    L.push('Lectura de boletas: ' + ocr.reads + (ocr.reads === 1 ? ' lectura' : ' lecturas') + (ocr.reads ? ', ' + fr + '% fallidas' + (ocr.timeouts ? ' (' + ocr.timeouts + ' por tiempo)' : '') + ', promedio ' + secs(ocr.ms_avg) : '')
      + (cpr != null ? ', ' + String(cpr).replace('.', ',') + ' correcciones por boleta confirmada.' : '.'));
  }
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
  if (hangs.length) tips.push('Revisar ' + hangs[0].label + ': la pantalla se congeló ' + hangs[0].count + (hangs[0].count === 1 ? ' vez' : ' veces') + '. Conviene partir ese trabajo en pasos más cortos.');
  const slowApi = lag.filter((x) => x.kind === 'api');
  if (slowApi.length) tips.push('Acelerar ' + slowApi[0].name + ': tarda ' + secs(slowApi[0].ms_avg) + ' en promedio.');
  const custs = [...new Set([...groups, ...slow].filter((g) => g.cli).map((g) => g.cli))];
  if (custs.length) tips.push('Revisar ' + custs.slice(0, 3).map(customerRef).join(', ') + ': los problemas pasaron al trabajar con ' + (custs.length === 1 ? 'ese cliente.' : 'esos clientes.'));
  if (ocr && ocr.reads >= 3 && ocr.fails / ocr.reads >= 0.3) tips.push('Muchas boletas no se leen: tomar la foto con buena luz, de frente y sin mover.');
  else if (ocr && ocr.confirmed && ocr.corrections / ocr.confirmed >= 3) tips.push('Las boletas necesitan muchas correcciones: revisar las correcciones guardadas y la nitidez de las fotos.');
  if (usage.length > 5) tips.push('«' + usage[usage.length - 1].label + '» casi no se usa: ver si se puede simplificar o mover a un lugar más visible.');
  if (!tips.length) tips.push('Todo en orden por ahora. Vuelva a pedir la revisión en unos días.');
  L.push('Sugerencias:'); for (const t of tips.slice(0, 5)) L.push('• ' + t);
  return L.join('\n');
}

function reviewPrompt(summary) {
  return [{ role: 'system', content: 'Eres Burbuja, ayudante del Admin de una bodega. Con SOLO los datos de abajo, escribe en español, tratando de usted, un informe breve (máximo 20 líneas) con estas partes: «Errores» (agrupados, con cuántas veces), «Lentitud y cuelgues», «Lectura de boletas» (si hay datos), «Uso» (lo más y lo menos usado) y «Sugerencias de mejora» (2 a 5, concretas). Los clientes aparecen SOLO como «cliente #código»: escríbelos exactamente así, sin inventar nombres. No inventes datos, no uses markdown ni asteriscos; usa «•» para las listas. No escribas guiones largos.' },
    { role: 'user', content: summary }];
}

export async function assistantReviewRoute(request, env, auth, json, deps = {}) {
  if (String(env?.ASSISTANT_ENABLED || '') !== '1') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const role = deps.resolveRole ? await deps.resolveRole(auth) : await assistantAccess(deps.db, auth);
  // Admin (sesión Admin) o persona con nivel 3 (capacidad «revision», pos-assistant-levels.js). Nivel 0, 1 y 2: 403 como antes.
  if (role === 'owner' ? auth?.posRole !== 'owner' : !levelCan(role, 'revision')) return json(REVIEW_DENIED, 403);
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
  // Los códigos de cliente (p. ej. 1729550000000) parecen números largos para el redactor: se protegen solo los que vinieron del aparato.
  const codes = [...new Set([...data.groups, ...data.slow].filter((g) => g.cli).map((g) => g.cli))];
  let safe = report; codes.forEach((c, i) => { safe = safe.split(customerRef(c)).join('cliente #\u0001' + i + '\u0001'); });
  safe = redactOwnerText(safe).replace(/cliente #\u0001(\d+)\u0001/g, (m, i) => customerRef(codes[+i])).replace(/\u0001/g, '');
  return json({ ok: true, report: safe, source, groups: data.groups.slice(0, 20), top: data.usage.slice(0, 5), bottom: data.usage.length > 5 ? data.usage.slice(-5).reverse() : [],
    slow: data.slow.slice(0, 20), ocr: data.ocr, customers: codes.slice(0, 50),
    errors_total: data.groups.reduce((t, g) => t + g.count, 0), hangs_total: data.slow.filter((x) => x.kind === 'cuelgue').reduce((t, x) => t + x.count, 0), server_now: now });
}
