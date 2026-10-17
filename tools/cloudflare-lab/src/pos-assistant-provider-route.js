// Configuración del proveedor del asistente (solo dueño). Rutas:
//   GET  /auth/assistant/provider           -> proveedores del catálogo con «Conectado» / «Falta clave» (nunca la clave ni la URL)
//   POST /auth/assistant/provider/test      {provider}                       -> prueba chica («Probar»)
//   POST /auth/assistant/provider/select    {provider, model}                -> arma la tarjeta: operation_id del SERVIDOR, un solo uso, vence en 5 min
//   POST /auth/assistant/provider/select    {operation_id, confirm:true}     -> Confirmar (sin PIN): aplica lo guardado con ese operation_id.
//        Repetido -> 409 already_confirmed; vencido -> 410 confirm_expired; otro aparato o id inventado -> 409 bad_operation.
// Solo aparato dueño con sesión dueño verificada en el servidor (assistantAccess = 'owner'); cualquier otro: 403 admin_only.
// Del cuerpo solo se leen provider (id del catálogo), model (de la lista del servidor) y confirm: URL, clave u otros campos se ignoran.
// Se guarda {provider, model} en pos_settings con clave interna (la lista pública /auth/settings excluye internal:%): sin migración.
import { assistantAccess } from './pos-assistant-access.js';
import { createSettingsUsageStore, CONFIRM_TTL_MS } from './pos-assistant.js';
import { sha256Hex } from './a5-import-core.js';
import { PROVIDERS, PROVIDER_CHOICE_KEY, configFor, modelsFor, providerOverview, testProvider } from './pos-assistant-providers.js';

export const PROVIDER_PATH = '/auth/assistant/provider';
const TEST_PREFIX = 'internal:asst:provtest:'; // un contador por aparato dueño (no global)
const OP_PREFIX = 'internal:asst:provop:'; // tarjeta pendiente por aparato dueño
const devKey = async (prefix, auth) => prefix + (await sha256Hex(String(auth?.principalId || 'unknown'))).slice(0, 32);
const TESTS_PER_MINUTE = 6;

export async function readProviderChoice(store) {
  if (!store) return null;
  try { const { value } = await store.get(PROVIDER_CHOICE_KEY); return value && typeof value.provider === 'string' ? { provider: value.provider, model: typeof value.model === 'string' ? value.model : null } : null; }
  catch { return null; } // sin tabla o error: se usa la configuración del Worker
}

export async function providerRoute(request, env, auth, json, deps = {}) {
  if (String(env?.ASSISTANT_ENABLED || '') !== '1') return json({ error: 'not_found' }, 404);
  const role = deps.resolveRole ? await deps.resolveRole(auth) : await assistantAccess(deps.db, auth);
  if (role !== 'owner') return json({ error: 'admin_only' }, 403); // empleado, sin rol o sin sesión: ni ve el bloque
  const store = deps.store || (deps.db ? createSettingsUsageStore(deps.db) : null);
  if (!store) return json({ error: 'settings_store_missing' }, 500);
  const sub = new URL(request.url).pathname.slice(PROVIDER_PATH.length);
  if (request.method === 'GET' && sub === '') return json(providerOverview(env, await readProviderChoice(store)));
  if (request.method !== 'POST' || (sub !== '/test' && sub !== '/select')) return json({ error: sub === '' || sub === '/test' || sub === '/select' ? 'method_not_allowed' : 'not_found' }, sub === '' || sub === '/test' || sub === '/select' ? 405 : 404);
  let body; try { body = JSON.parse((await request.text()).slice(0, 2000)); } catch { return json({ error: 'bad_request' }, 400); }
  const now = (deps.now || Date.now)();
  // Confirmar: solo con el operation_id que dio el servidor a ESTE aparato, una vez y antes de que venza. Proveedor y modelo salen de lo guardado.
  if (sub === '/select' && body?.confirm === true) {
    const op = typeof body.operation_id === 'string' ? body.operation_id.slice(0, 80) : '';
    if (!op) return json({ error: 'operation_id_required' }, 400);
    const key = await devKey(OP_PREFIX, auth); const g = await store.get(key); const pend = g.value || {};
    if (pend.op !== op || (typeof body.provider === 'string' && body.provider !== pend.provider)) return json({ error: 'bad_operation' }, 409);
    if (pend.used) return json({ error: 'already_confirmed', operation_id: op }, 409);
    if (!(pend.exp > now)) return json({ error: 'confirm_expired' }, 410);
    const cfg = configFor(env, pend.provider, pend.model);
    if (!cfg.ok) return json({ error: 'provider_not_ready', status: cfg.reason === 'missing_key' ? 'Falta clave' : 'Revisar configuración' }, 409);
    // Se gasta primero (CAS): dos toques a la vez = un solo cambio.
    if (!(await store.put(key, { ...pend, used: now }, g.revision))) return json({ error: 'already_confirmed', operation_id: op }, 409);
    let saved = false;
    for (let i = 0; i < 4 && !saved; i++) { const c = await store.get(PROVIDER_CHOICE_KEY); saved = await store.put(PROVIDER_CHOICE_KEY, { provider: cfg.id, model: cfg.model, at: new Date(now).toISOString() }, c.revision); }
    if (!saved) return json({ error: 'busy' }, 503);
    return json({ ok: true, operation_id: op, ...providerOverview(env, { provider: cfg.id, model: cfg.model }) });
  }
  const id = typeof body?.provider === 'string' && Object.hasOwn(PROVIDERS, body.provider) ? body.provider : null;
  if (!id) return json({ error: 'unknown_provider' }, 400);
  const model = typeof body.model === 'string' ? body.model : null;
  if (model && !modelsFor(env, id).includes(model)) return json({ error: 'unknown_model' }, 400);
  const cfg = configFor(env, id, model);
  if (!cfg.ok) return json({ error: 'provider_not_ready', status: cfg.reason === 'missing_key' ? 'Falta clave' : 'Revisar configuración' }, 409);
  if (sub === '/test') {
    // Tope chico de pruebas por minuto y por aparato dueño (cada prueba es una llamada pagada, aunque mínima). Si no se puede contar: no se prueba.
    const minute = Math.floor(now / 60000), key = await devKey(TEST_PREFIX, auth); let counted = false;
    for (let i = 0; i < 4 && !counted; i++) {
      const g = await store.get(key); const v = g.value?.m === minute ? { ...g.value } : { m: minute, c: 0 };
      if (v.c >= TESTS_PER_MINUTE) return json({ error: 'rate_limited', retry_after_s: 60 - Math.floor((now % 60000) / 1000) }, 429);
      v.c++; counted = await store.put(key, v, g.revision);
    }
    if (!counted) return json({ error: 'busy' }, 503);
    const r = await testProvider(cfg, deps.fetch || fetch, deps.testTimeoutMs || 10000);
    return json({ ok: r.ok, provider: id, model: cfg.model, status: r.ok ? 'Conectado' : 'No responde', message: r.message, ms: r.ms });
  }
  // «Usar»: el servidor arma la tarjeta Confirmar con su operation_id (una por aparato; una nueva reemplaza a la anterior).
  const op = 'PRV-' + crypto.randomUUID(), key = await devKey(OP_PREFIX, auth);
  let stored = false;
  for (let i = 0; i < 4 && !stored; i++) { const g = await store.get(key); stored = await store.put(key, { op, provider: id, model: cfg.model, exp: now + CONFIRM_TTL_MS, used: null }, g.revision); }
  if (!stored) return json({ error: 'busy' }, 503);
  return json({ ok: true, confirm_required: true, operation_id: op, expires_in_s: Math.round(CONFIRM_TTL_MS / 1000), provider: id, label: cfg.label, model: cfg.model });
}
