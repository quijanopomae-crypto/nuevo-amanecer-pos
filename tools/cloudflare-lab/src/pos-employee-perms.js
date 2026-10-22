// Permisos por empleado (plan permisos-por-empleado). Fila pos_settings 'internal:emp:perm:v1'
// (las claves internal:% no salen por /settings, así que el empleado no la lee ni la escribe).
// Se lee en cada pedido, sin caché. Cualquier error, fila mala o id fuera de la lista: cerrado.
import '../../../POS/js/config/pos-employee-toggles.js';
import { PERMISSIONS } from './pos-permissions.js';
import { posRoleFor } from './pos-roles.js';

export const TOGGLES = globalThis.NA_EMPLOYEE_TOGGLES;
export const EMPLOYEE_TOGGLES = TOGGLES.IDS;
export const EMPLOYEE_PERMS_KEY = TOGGLES.KEY;
export const EMPLOYEE_PERMS_LOCK = TOGGLES.LOCK_ID;
export const EMPLOYEE_PERMS_PATH = '/auth/employee-permissions';
export const APPROVAL_ACTION = 'employee.permissions';

export async function readEmployeeAllow(db) {
  try {
    const row = await db.prepare('SELECT value_json FROM pos_settings WHERE key=?1').bind(EMPLOYEE_PERMS_KEY).first();
    if (!row) return {};
    return TOGGLES.normalize(JSON.parse(row.value_json));
  } catch { return {}; }
}

export async function employeeMay(db, id) {
  if (typeof id !== 'string' || !TOGGLES.has(id)) return false;
  const allow = await readEmployeeAllow(db);
  return allow[id] === true;
}

// Para authorizeSession: ¿la ruta /features/:id está abierta al empleado? El candado sigue cerrando.
export async function employeeFeatureGrant(db, path, { locked = PERMISSIONS.featureLocked } = {}) {
  const m = /^\/features\/([a-z0-9-]+)(\/|$)/.exec(String(path || ''));
  if (!m || locked(m[1])) return false;
  return employeeMay(db, m[1]);
}

// Decisión de /features/:id. El candado va primero y siempre gana.
export async function featureDecision(db, id, role, { locked = PERMISSIONS.featureLocked, roles = PERMISSIONS.FEATURE_ROLES } = {}) {
  if (locked(id)) return { status: 403, error: 'feature_locked' };
  const allowedRoles = Object.prototype.hasOwnProperty.call(roles, id) ? roles[id] : null;
  if (allowedRoles && !allowedRoles.includes(role)) {
    if (role === 'empleado' && allowedRoles.includes('owner') && await employeeMay(db, id)) return { status: 404, error: 'not_found', granted: true };
    return { status: 403, error: 'forbidden_role' };
  }
  return { status: 404, error: 'not_found' };
}

// Gasto estricto: una aprobación sirve una sola vez (changes === 1) y solo para esta operación.
async function spendApproval(db, deviceId, approvalId, operationId) {
  if (typeof approvalId !== 'string' || !approvalId || approvalId.length > 80) return false;
  try {
    const r = await db.prepare(`UPDATE pos_owner_approvals SET used_at=?5 WHERE approval_id=?1 AND device_id=?2 AND action=?3
      AND operation_id=?4 AND used_at IS NULL AND expires_at>?5`).bind(approvalId, deviceId, APPROVAL_ACTION, operationId, new Date().toISOString()).run();
    return Number(r?.meta?.changes ?? r?.changes ?? 0) === 1;
  } catch { return false; }
}

export async function handleEmployeePerms(request, env, { json, authorizeSession, getDatabase, locked = PERMISSIONS.featureLocked }) {
  const auth = await authorizeSession(request, env);
  if (auth instanceof Response) return auth;
  if (locked(EMPLOYEE_PERMS_LOCK)) return json({ error: 'feature_locked', feature: EMPLOYEE_PERMS_LOCK }, 403);
  const db = getDatabase(env);
  let role;
  try { role = auth.posRole || await posRoleFor(db, auth.principalId); } catch { role = 'unknown'; }
  if (role !== 'owner') return json({ error: 'owner_only' }, 403);
  if (request.method === 'GET') return json({ allow: await readEmployeeAllow(db), toggles: EMPLOYEE_TOGGLES });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST, OPTIONS' });
  let b;
  try { b = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const operationId = typeof b?.operation_id === 'string' ? b.operation_id : '';
  if (!operationId || operationId.length > 200) return json({ error: 'operation_id_required' }, 400);
  const raw = b?.allow;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return json({ error: 'invalid_allow' }, 400);
  if (Object.keys(raw).some(k => !TOGGLES.has(k) || typeof raw[k] !== 'boolean')) return json({ error: 'invalid_allow' }, 400);
  if (!await spendApproval(db, auth.principalId, String(request.headers.get('x-owner-approval') || ''), operationId)) {
    return json({ error: 'owner_approval_required', action: APPROVAL_ACTION }, 403);
  }
  const allow = TOGGLES.normalize({ allow: raw });
  const t = new Date().toISOString();
  try {
    await db.prepare(`INSERT INTO pos_settings(key,value_json,revision,updated_at,updated_by) VALUES(?1,?2,1,?3,?4)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,revision=pos_settings.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
      .bind(EMPLOYEE_PERMS_KEY, JSON.stringify({ allow }), t, auth.principalId).run();
  } catch { return json({ error: 'save_failed' }, 503); }
  return json({ status: 'saved', allow });
}
