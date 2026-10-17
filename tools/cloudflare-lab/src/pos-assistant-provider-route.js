// Configuración del proveedor del asistente (solo dueño). Rutas:
//   GET  /auth/assistant/provider           -> proveedores del catálogo con «Conectado» / «Falta clave» (nunca la clave ni la URL)
//   POST /auth/assistant/provider/test      {provider}                       -> prueba chica («Probar»)
//   POST /auth/assistant/provider/select    {provider, model, confirm:true}  -> cambia el proveedor (tarjeta Confirmar, sin PIN)
// Solo aparato dueño con sesión dueño verificada en el servidor (assistantAccess = 'owner'); cualquier otro: 403 admin_only.
// Del cuerpo solo se leen provider (id del catálogo), model (de la lista del servidor) y confirm: URL, clave u otros campos se ignoran.
// Se guarda {provider, model} en pos_settings con clave interna (la lista pública /auth/settings excluye internal:%): sin migración.
import { assistantAccess } from './pos-assistant-access.js';
import { createSettingsUsageStore } from './pos-assistant.js';
import { PROVIDERS, PROVIDER_CHOICE_KEY, configFor, modelsFor, providerOverview, testProvider } from './pos-assistant-providers.js';

export const PROVIDER_PATH = '/auth/assistant/provider';
const TEST_KEY = 'internal:asst:provtest';
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
  const id = typeof body?.provider === 'string' && Object.hasOwn(PROVIDERS, body.provider) ? body.provider : null;
  if (!id) return json({ error: 'unknown_provider' }, 400);
  const model = typeof body.model === 'string' ? body.model : null;
  if (model && !modelsFor(env, id).includes(model)) return json({ error: 'unknown_model' }, 400);
  const cfg = configFor(env, id, model);
  if (!cfg.ok) return json({ error: 'provider_not_ready', status: cfg.reason === 'missing_key' ? 'Falta clave' : 'Revisar configuración' }, 409);
  const now = (deps.now || Date.now)();
  if (sub === '/test') {
    // Tope chico de pruebas por minuto (cada prueba es una llamada pagada, aunque mínima).
    const minute = Math.floor(now / 60000);
    for (let i = 0; i < 4; i++) {
      const g = await store.get(TEST_KEY); const v = g.value?.m === minute ? { ...g.value } : { m: minute, c: 0 };
      if (v.c >= TESTS_PER_MINUTE) return json({ error: 'rate_limited', retry_after_s: 60 - Math.floor((now % 60000) / 1000) }, 429);
      v.c++; if (await store.put(TEST_KEY, v, g.revision)) break;
    }
    const r = await testProvider(cfg, deps.fetch || fetch, deps.testTimeoutMs || 10000);
    return json({ ok: r.ok, provider: id, model: cfg.model, status: r.ok ? 'Conectado' : 'No responde', message: r.message, ms: r.ms });
  }
  // Cambio: la tarjeta Confirmar del celular manda confirm:true. Sin PIN (sesión dueño verificada arriba).
  if (body.confirm !== true) return json({ error: 'confirm_required' }, 400);
  let saved = false;
  for (let i = 0; i < 4 && !saved; i++) { const g = await store.get(PROVIDER_CHOICE_KEY); saved = await store.put(PROVIDER_CHOICE_KEY, { provider: id, model: cfg.model, at: new Date(now).toISOString() }, g.revision); }
  if (!saved) return json({ error: 'busy' }, 503);
  return json({ ok: true, ...providerOverview(env, { provider: id, model: cfg.model }) });
}
