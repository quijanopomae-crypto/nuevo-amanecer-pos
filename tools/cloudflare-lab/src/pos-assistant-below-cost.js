// «Ventas bajo costo» (solo Admin). SOLO LECTURA, sin migración y sin guardar nada.
// - Catálogo: productos con costo cuyo precio de venta actual es MENOR que el costo.
// - Ventas del período (por defecto los últimos 30 días, máximo 92; sin anuladas): líneas cobradas a un precio unitario menor que el
//   costo ACTUAL del producto. El costo de cada venta no se guarda aparte, así que se compara con el costo de hoy (se avisa en el informe).
// - Productos sin costo no se pueden revisar: se cuentan aparte (ya existe la consulta «Productos sin costo»).
// - Al modelo (si hay proveedor) van SOLO «producto #código», cantidades y totales; nunca nombres de clientes ni de productos.
//   El aparato del Admin recibe los nombres de SUS productos para la tabla; el informe se muestra con el nombre puesto aquí.
// - Admin, o empleado de nivel 3 con el permiso «costos y cambios» (#939, seesOwnerData): pasan. El empleado con permiso ve lo mismo
//   que el Admin en esta ruta (nombres de SUS productos en pantalla); al modelo siguen yendo solo «producto #código» y totales.
// - Empleado sin ese permiso (cualquier nivel), aparato sin rol o sin fila: 403 below_cost_admin_only (sin cupo, sin modelo, sin leer nada).
import { assistantAccess } from './pos-assistant-access.js';
import { seesOwnerData } from './pos-assistant-levels.js';
import { redactText, redactOwnerText, reserveUsage, createSettingsUsageStore, BELOW_COST_DENIED } from './pos-assistant.js';
import { resolveProvider, callModel } from './pos-assistant-providers.js';
import { readProviderChoice } from './pos-assistant-provider-route.js';
import { canonicalReader, period, dateWordRange } from './pos-assistant-queries.js';

export const BELOW_COST_PATH = '/auth/assistant/below-cost';
export const BELOW_COST_LIMITS = Object.freeze({ maxRows: 50, modelRows: 10, modelMs: 20000, defaultDays: 30, maxBodyBytes: 2048 });
export { BELOW_COST_DENIED }; // el chat usa la misma respuesta para el empleado sin permiso de costos
const CODE_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
export const productRef = (id) => 'producto #' + id;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const money = (n) => 'S/ ' + r2(n).toFixed(2);
const limaToday = (nowMs) => new Date(nowMs - 5 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const TRUNC_NOTE = 'Ojo: hay muchos registros y no se pudo leer todo; puede haber más ventas bajo costo que no aparecen aquí.';
// Período pedido. El aparato manda «periodo» (hoy, ayer, semana, mes, mes_pasado) o «dias» (1 a 92) según lo que escribió el Admin;
// las fechas se calculan aquí con la hora de Lima (no con el reloj del aparato). Con desde/hasta explícitos se usan esos.
// Sin nada: los últimos 30 días hasta hoy.
export function belowCostPeriod(body, nowMs) {
  const today = limaToday(nowMs), per = String(body?.periodo || ''), dias = Number.parseInt(body?.dias, 10);
  const w = per ? dateWordRange(per, nowMs) : null; // la misma hora de Lima que el resto del asistente (#947)
  if (w) return period(w, nowMs);
  if (Number.isFinite(dias) && dias >= 1) return period({ desde: addDays(today, -(Math.min(dias, 92) - 1)), hasta: today }, nowMs);
  const hasta = DATE.test(body?.hasta || '') ? body.hasta : today;
  const desde = DATE.test(body?.desde || '') ? body.desde : addDays(hasta, -(BELOW_COST_LIMITS.defaultDays - 1));
  return period({ desde, hasta }, nowMs);
}

// productos: [{ id, nombre, costo, precio }] (soles); lineas: [{ product_id, quantity, unit_cents, line_cents }].
export function findBelowCost(productos, lineas) {
  const byId = new Map(), sinCosto = new Set(), raros = new Set(); let sinPrecio = 0;
  // Códigos que no pueden ir al modelo como «producto #código» (espacios, muy largos…): no se revisan, pero se cuentan.
  for (const p of productos || []) { if (!p) continue; if (CODE_RE.test(String(p.id))) byId.set(String(p.id), p); else raros.add(String(p.id)); }
  const catalogo = [];
  for (const p of byId.values()) {
    const costo = Number(p.costo), precio = Number(p.precio);
    if (!(costo > 0)) continue;
    if (Number.isFinite(precio) && precio > 0 && precio < costo) catalogo.push({ id: String(p.id), nombre: String(p.nombre || ''), costo: r2(costo), precio: r2(precio), diferencia: r2(costo - precio) });
  }
  catalogo.sort((a, b) => b.diferencia - a.diferencia || a.id.localeCompare(b.id));
  const by = new Map(); let lineasRevisadas = 0;
  for (const l of lineas || []) {
    const id = String(l?.product_id ?? ''), p = byId.get(id), q = Number(l?.quantity);
    if (!(q > 0)) continue;
    if (!p) { if (!CODE_RE.test(id)) raros.add(id); continue; }
    const costo = Number(p.costo); if (!(costo > 0)) { sinCosto.add(id); continue; }
    lineasRevisadas++;
    const u = l.unit_cents == null || l.unit_cents === '' ? NaN : Number(l.unit_cents), t = l.line_cents == null || l.line_cents === '' ? NaN : Number(l.line_cents);
    const unit = Number.isFinite(u) && u >= 0 ? u / 100 : Number.isFinite(t) && t >= 0 ? t / 100 / q : NaN;
    if (!Number.isFinite(unit)) { sinPrecio++; continue; } // precio vacío: no es una venta a S/ 0
    if (unit >= costo - 0.005) continue;
    const g = by.get(id) || { id, nombre: String(p.nombre || ''), costo: r2(costo), ventas: 0, unidades: 0, perdida: 0, precio_min: Infinity };
    g.ventas++; g.unidades = r2(g.unidades + q); g.perdida = r2(g.perdida + (costo - unit) * q); g.precio_min = Math.min(g.precio_min, r2(unit));
    by.set(id, g);
  }
  const ventas = [...by.values()].sort((a, b) => b.perdida - a.perdida || a.id.localeCompare(b.id));
  return { catalogo, ventas, perdida_total: r2(ventas.reduce((t, g) => t + g.perdida, 0)), lineas_revisadas: lineasRevisadas, sin_costo: sinCosto.size, sin_precio: sinPrecio, codigos_raros: raros.size };
}

// Informe fijo con códigos de producto (lo único que puede ir al modelo). Sin markdown: viñetas «•».
export function buildBelowCostReport(s, p, truncado = false) {
  const rango = p.desde === p.hasta ? 'el ' + p.desde : 'del ' + p.desde + ' al ' + p.hasta, M = BELOW_COST_LIMITS.modelRows, L = ['Ventas bajo costo ' + rango];
  if (!s.ventas.length) L.push('Ninguna venta del período se cobró por debajo del costo actual (' + s.lineas_revisadas + (s.lineas_revisadas === 1 ? ' línea revisada).' : ' líneas revisadas).'));
  else {
    L.push((s.ventas.length === 1 ? '1 producto se vendió' : s.ventas.length + ' productos se vendieron') + ' por debajo del costo. Pérdida estimada: ' + money(s.perdida_total) + '.');
    for (const g of s.ventas.slice(0, M)) L.push('• ' + productRef(g.id) + ': ' + g.ventas + (g.ventas === 1 ? ' venta, ' : ' ventas, ') + g.unidades + ' unid., precio más bajo ' + money(g.precio_min) + ' con costo ' + money(g.costo) + ', pérdida ' + money(g.perdida) + '.');
    if (s.ventas.length > M) L.push('• Y ' + (s.ventas.length - M) + ' productos más en la tabla.');
  }
  if (s.catalogo.length) { L.push('Precio actual menor que el costo: ' + s.catalogo.length + (s.catalogo.length === 1 ? ' producto.' : ' productos.'));
    for (const c of s.catalogo.slice(0, M)) L.push('• ' + productRef(c.id) + ': precio ' + money(c.precio) + ', costo ' + money(c.costo) + '.'); }
  else L.push('Ningún producto tiene hoy un precio menor que su costo.');
  if (s.sin_costo) L.push('Sin costo registrado: ' + s.sin_costo + (s.sin_costo === 1 ? ' producto vendido no se pudo revisar.' : ' productos vendidos no se pudieron revisar.'));
  if (s.sin_precio) L.push('Sin precio guardado: ' + s.sin_precio + (s.sin_precio === 1 ? ' línea de venta no se pudo revisar.' : ' líneas de venta no se pudieron revisar.'));
  if (s.codigos_raros) L.push('Con código no válido: ' + s.codigos_raros + (s.codigos_raros === 1 ? ' producto no se revisó.' : ' productos no se revisaron.'));
  if (truncado) L.push(TRUNC_NOTE);
  L.push('Se compara con el costo de hoy; si el costo subió después de la venta, revíselo.');
  return L.join('\n');
}
// Lo que va al modelo pasa por redactText (como todo lo demás), con los «producto #código» protegidos para que no se tapen como DNI.
function toModel(report, s) {
  const ids = [...new Set([...s.ventas, ...s.catalogo].map((g) => g.id))].sort((a, b) => b.length - a.length);
  let out = report; ids.forEach((id, i) => { out = out.split(productRef(id)).join('\u0001' + i + '\u0001'); });
  return redactText(out).replace(/\u0001(\d+)\u0001/g, (m, i) => productRef(ids[+i])).replace(/\u0001/g, '');
}
function belowCostPrompt(report) {
  return [{ role: 'system', content: 'Eres Burbuja, ayudante del Admin de una bodega. Con SOLO los datos de abajo (si dicen que no se pudo leer todo, avíselo), escribe en español, tratando de usted, un informe breve (máximo 12 líneas) de ventas por debajo del costo: cuánto se perdió, qué productos pesan más y 2 o 3 sugerencias concretas (por ejemplo, corregir el precio o revisar el costo registrado). Los productos aparecen SOLO como «producto #código»: escríbelos exactamente así, sin inventar nombres. No inventes datos ni montos, no uses markdown ni asteriscos; usa «•» para las listas. No escribas guiones largos.' },
    { role: 'user', content: report }];
}

export async function belowCostRoute(request, env, auth, json, deps = {}) {
  if (String(env?.ASSISTANT_ENABLED || '') !== '1') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const role = deps.resolveRole ? await deps.resolveRole(auth) : await assistantAccess(deps.db, auth);
  // Misma regla que el chat (#939): seesOwnerData = Admin o 'empleado:completo+costos'. El Admin además con sesión Admin (como antes).
  if (!seesOwnerData(role) || (role === 'owner' && auth?.posRole !== 'owner')) return json(BELOW_COST_DENIED, 403);
  let raw; try { raw = await request.text(); } catch { return json({ error: 'bad_request' }, 400); }
  if (raw.length > BELOW_COST_LIMITS.maxBodyBytes) return json({ error: 'payload_too_large' }, 413);
  let body = {}; if (raw.trim()) { try { body = JSON.parse(raw); } catch { return json({ error: 'bad_request' }, 400); } }
  const reader = deps.reader || (deps.db ? canonicalReader(deps.db) : null);
  if (!reader) return json({ error: 'reader_missing' }, 500);
  const now = (deps.now || Date.now)(), p = belowCostPeriod(body, now);
  let productos, lineas; try { [productos, lineas] = await Promise.all([reader.products(), reader.saleLines(p)]); } catch { return json({ error: 'read_failed' }, 502); }
  const truncado = !!(lineas?.truncated || productos?.truncated);
  const s = findBelowCost(productos, lineas), fixed = buildBelowCostReport(s, p, truncado);
  let report = fixed, source = 'resumen';
  if (s.ventas.length || s.catalogo.length) {
    const store = deps.store || (deps.db ? createSettingsUsageStore(deps.db) : null);
    const cfg = store ? resolveProvider(env, await readProviderChoice(store)) : { ok: false };
    if (cfg.ok) {
      const quota = await reserveUsage(store, { ...auth, posRole: role }, env, now, false);
      if (quota.ok) {
        const r = await callModel(cfg, { messages: belowCostPrompt(toModel(fixed, s)), max_tokens: 500, temperature: 0.2 }, deps.fetch || fetch, BELOW_COST_LIMITS.modelMs);
        const t = !r.error && typeof r.content === 'string' ? r.content.replace(/\*\*|__/g, '').replace(/\u2014/g, ',').trim() : '';
        if (t) { report = t.slice(0, 2000); source = 'modelo'; }
      }
    }
  }
  // Los códigos se protegen del redactor (parecen números largos) y, ya en la respuesta al Admin, se cambian por el nombre de SU producto.
  const names = new Map([...s.ventas, ...s.catalogo].map((g) => [g.id, g.nombre])), ids = [...names.keys()].sort((a, b) => b.length - a.length); // «#123» antes que «#12»
  let safe = report; ids.forEach((id, i) => { safe = safe.split(productRef(id)).join('\u0001' + i + '\u0001'); });
  safe = redactOwnerText(safe).replace(/\u0001(\d+)\u0001/g, (m, i) => names.get(ids[+i]) || productRef(ids[+i])).replace(/\u0001/g, '');
  if (truncado && !safe.includes(TRUNC_NOTE)) safe += '\n\n' + TRUNC_NOTE; // por si el modelo no lo repitió
  return json({ ok: true, report: safe, source, desde: p.desde, hasta: p.hasta, perdida_total: s.perdida_total, lineas_revisadas: s.lineas_revisadas, sin_costo: s.sin_costo, sin_precio: s.sin_precio, codigos_raros: s.codigos_raros,
    truncado,
    ventas: s.ventas.slice(0, BELOW_COST_LIMITS.maxRows), catalogo: s.catalogo.slice(0, BELOW_COST_LIMITS.maxRows), server_now: now });
}
