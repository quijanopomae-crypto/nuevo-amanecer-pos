// GET/POST /auth/assistant/levels: el Admin ve y cambia el nivel del asistente de cada persona (0..3, ver pos-assistant-levels.js).
// - SOLO Admin (mismo criterio que el chat: fila 'owner' + sesión Admin, o aparato sin fila con sesión Admin). Empleado o sin rol: 403.
// - SIN PIN y SIN aprobación extra (lo pidió el dueño): el toque en «Aplicar» de la pantalla (o de la tarjeta del chat) es el POST.
// - Sin migración: se guarda en la fila interna que ya existía (pos_settings 'internal:asst:lvl:<hash>'), la misma que lee el chat
//   en CADA pedido (sin caché): bajar o quitar un nivel aplica al instante.
// - Cada cambio queda en la bitácora del asistente que ya existe (pos-assistant-audit.js, cajón del Admin): quién (aparato del Admin),
//   a quién (aparato de la persona) y de qué nivel a qué nivel. Los intentos rechazados de un empleado van al cajón de rechazos.
// - Ni nombres, ni DNI, ni teléfonos: la respuesta trae el id del aparato y su etiqueta (la que el Admin le puso), nada va al modelo.
import { assistantAccess, levelKey } from './pos-assistant-access.js';
import { auditWrite } from './pos-assistant-audit.js';
import { ADMIN_LEVEL, EMPLOYEE_DEFAULT_LEVEL, LEVEL_CAPABILITIES, ADMIN_CAPABILITIES, LEVEL_NAMES, levelFromStored, levelMap, parseLevel, storedValue } from './pos-assistant-levels.js';

export const LEVELS_PATH = '/auth/assistant/levels';
export const LEVELS_MAX_BODY = 4000;

async function readLevel(db, deviceId) {
  try {
    const row = await db.prepare('SELECT value_json FROM pos_settings WHERE key=?1').bind(await levelKey(deviceId)).first();
    return row ? levelFromStored(JSON.parse(row.value_json)) : EMPLOYEE_DEFAULT_LEVEL;
  } catch { return EMPLOYEE_DEFAULT_LEVEL; }
}
const person = (r, nivel, admin) => ({ device_id: r.device_id, label: r.label || null, rol: admin ? 'admin' : 'empleado', nivel, nombre_nivel: admin ? 'admin' : LEVEL_NAMES[nivel],
  fijo: !!admin, capacidades: admin ? ADMIN_CAPABILITIES : LEVEL_CAPABILITIES[nivel] });

export async function levelsRoute(request, env, auth, json, deps = {}) {
  if (String(env?.ASSISTANT_ENABLED || '') !== '1') return json({ error: 'not_found' }, 404);
  const db = deps.db; if (!db) return json({ error: 'db_missing' }, 500);
  const audit = deps.audit || auditWrite;
  const role = deps.resolveRole ? await deps.resolveRole(auth) : await assistantAccess(db, auth);
  if (role !== 'owner') {
    if (request.method === 'POST') await audit(db, [{ device_id: auth?.principalId, role: String(role || 'sin_rol'), tool: 'asistente.nivel', type: 'nivel', outcome: 'rejected:admin_only', aggregate: true }]);
    return json({ error: 'admin_only', message: 'Solo el Admin cambia los niveles del asistente.' }, 403);
  }
  if (request.method === 'GET') {
    let rows = [];
    try { rows = (await db.prepare("SELECT device_id,pos_role,label FROM pos_device_roles WHERE pos_role IN ('owner','empleado') ORDER BY pos_role DESC, device_id").all()).results || []; } catch { rows = []; }
    const personas = [];
    for (const r of rows) personas.push(r.pos_role === 'owner' ? person(r, ADMIN_LEVEL, true) : person(r, await readLevel(db, r.device_id), false));
    // Aparato del Admin sin fila (regla del POS: sin fila + sesión Admin = Admin) también aparece, para que vea su propio nivel.
    if (!rows.some((r) => r.device_id === String(auth.principalId))) personas.unshift(person({ device_id: String(auth.principalId), label: null }, ADMIN_LEVEL, true));
    return json({ ok: true, personas, ...levelMap() });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body; try { body = JSON.parse((await request.text()).slice(0, LEVELS_MAX_BODY)); } catch { return json({ error: 'bad_request' }, 400); }
  const deviceId = typeof body?.device_id === 'string' ? body.device_id.trim().slice(0, 160) : '';
  const nivel = parseLevel(body?.nivel ?? body?.level);
  const opId = typeof body?.operation_id === 'string' ? body.operation_id.slice(0, 64) : null;
  if (!deviceId || nivel == null) return json({ error: 'bad_request', message: 'Falta el aparato o el nivel (0, 1, 2 o 3).' }, 400);
  let target = null;
  try { target = await db.prepare('SELECT pos_role FROM pos_device_roles WHERE device_id=?1').bind(deviceId).first(); } catch { target = null; }
  if (target?.pos_role === 'owner' || deviceId === String(auth.principalId)) return json({ error: 'admin_fixed_level', message: 'El Admin siempre tiene el nivel 3.', nivel: ADMIN_LEVEL }, 409);
  if (target?.pos_role !== 'empleado') return json({ error: 'not_employee_device', message: 'Ese aparato no está vinculado como empleado.' }, 409);
  const antes = await readLevel(db, deviceId), at = new Date().toISOString();
  if (antes !== nivel) {
    try {
      await db.prepare(`INSERT INTO pos_settings(key,value_json,revision,updated_at,updated_by) VALUES(?1,?2,1,?3,?4)
        ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,revision=pos_settings.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
        .bind(await levelKey(deviceId), JSON.stringify({ ...storedValue(nivel), updated_at: at }), at, String(auth.principalId).slice(0, 120)).run();
    } catch { return json({ error: 'save_failed' }, 503); }
  }
  // Bitácora: quién = device_id (Admin), a quién = card_id, qué = outcome «nivel:<antes>-><después>».
  const logged = await audit(db, [{ device_id: auth.principalId, role: 'owner', tool: 'asistente.nivel', type: 'nivel', outcome: 'nivel:' + antes + '->' + nivel + (antes === nivel ? ':igual' : ''),
    card_id: deviceId.slice(0, 64), operation_id: opId }]);
  return json({ ok: true, device_id: deviceId, antes, nivel, nombre_nivel: LEVEL_NAMES[nivel], capacidades: LEVEL_CAPABILITIES[nivel], logged: Number(logged) > 0 });
}
