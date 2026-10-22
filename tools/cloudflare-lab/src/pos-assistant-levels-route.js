// GET/POST /auth/assistant/levels y la herramienta del Admin «configurar_nivel»: ver y cambiar el nivel del asistente de cada persona
// (0..3) y el permiso aparte «costos y cambios» (solo cuenta en el nivel 3). Lo que permite cada cosa: pos-assistant-levels.js.
// - SOLO Admin (mismo criterio que el chat: fila 'owner' + sesión Admin, o aparato sin fila con sesión Admin). Empleado o sin rol: 403.
// - SIN PIN y SIN aprobación extra (lo pidió el dueño): el toque en «Aplicar» (pantalla o tarjeta del chat) es el cambio.
// - La persona se elige por el código del aparato (device_id) o por su etiqueta («Caja 2»). Nunca por nombre, DNI ni teléfono.
// - Sin migración: se guarda en la fila interna que ya existía (pos_settings 'internal:asst:lvl:<hash>'), con { level, nivel, costos }.
//   El chat la lee en CADA pedido (sin caché): bajar el nivel o quitar el permiso aplica al instante.
// - Cada cambio queda en la bitácora del asistente que ya existe (pos-assistant-audit.js, cajón del Admin): quién (aparato del Admin),
//   a quién (card_id = aparato de la persona) y qué («nivel:0->3», «costos:off->on»). Los rechazos de un empleado van al cajón de otros.
import { assistantAccess, levelKey } from './pos-assistant-access.js';
import { auditWrite } from './pos-assistant-audit.js';
import { ADMIN_LEVEL, EMPLOYEE_DEFAULT_LEVEL, ADMIN_CAPABILITIES, LEVEL_NAMES, levelFromStored, costsFromStored, levelMap, parseLevel, storedValue,
  roleForLevel, capabilitiesFor } from './pos-assistant-levels.js';

export const LEVELS_PATH = '/auth/assistant/levels';
export const LEVELS_MAX_BODY = 4000;
export const LEVEL_TOOL = 'configurar_nivel';
export const LEVEL_CARD = 'nivel';

async function readEntry(db, deviceId) {
  try {
    const row = await db.prepare('SELECT value_json FROM pos_settings WHERE key=?1').bind(await levelKey(deviceId)).first();
    const v = row ? JSON.parse(row.value_json) : null;
    return { nivel: v ? levelFromStored(v) : EMPLOYEE_DEFAULT_LEVEL, costos: costsFromStored(v) };
  } catch { return { nivel: EMPLOYEE_DEFAULT_LEVEL, costos: false }; }
}
const onOff = (b) => (b ? 'on' : 'off');
const person = (r, e, admin) => ({ device_id: r.device_id, label: r.label || null, rol: admin ? 'admin' : 'empleado', nivel: admin ? ADMIN_LEVEL : e.nivel,
  nombre_nivel: admin ? 'admin' : LEVEL_NAMES[e.nivel], costos: admin ? true : e.costos, costos_activo: admin ? true : e.nivel === 3 && e.costos, fijo: !!admin,
  capacidades: admin ? ADMIN_CAPABILITIES : capabilitiesFor(roleForLevel(e.nivel, e.costos)) });
const norm = (v) => String(v ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

// Persona por código (device_id exacto) o etiqueta (sin mayúsculas ni espacios de más). Varias con la misma etiqueta: ambiguous.
export async function resolvePerson(db, ref) {
  const want = norm(ref).slice(0, 160); if (!want) return { error: 'person_required' };
  let rows = [];
  try { rows = (await db.prepare("SELECT device_id,pos_role,label FROM pos_device_roles WHERE pos_role IN ('owner','empleado')").all()).results || []; } catch { return { error: 'person_not_found' }; }
  const byId = rows.filter((r) => norm(r.device_id) === want), byLabel = rows.filter((r) => norm(r.label) === want);
  const hit = byId.length ? byId : byLabel;
  if (!hit.length) return { error: 'person_not_found' };
  if (hit.length > 1) return { error: 'person_ambiguous' };
  return { row: hit[0] };
}

// Cambio común (POST y tarjeta «Aplicar»). nivel y/o costos; lo que no viene se queda como está. Admin: fijo en 3.
export async function applyLevelChange(db, auth, { deviceId, nivel = null, costos = null }, opId, audit = auditWrite) {
  let target = null;
  try { target = await db.prepare('SELECT pos_role FROM pos_device_roles WHERE device_id=?1').bind(deviceId).first(); } catch { target = null; }
  if (target?.pos_role === 'owner' || deviceId === String(auth.principalId)) return { status: 409, body: { error: 'admin_fixed_level', message: 'El Admin siempre tiene el nivel 3 con todo.', nivel: ADMIN_LEVEL } };
  if (target?.pos_role !== 'empleado') return { status: 409, body: { error: 'not_employee_device', message: 'Ese aparato no está vinculado como empleado.' } };
  const antes = await readEntry(db, deviceId), at = new Date().toISOString();
  const despues = { nivel: nivel ?? antes.nivel, costos: costos ?? antes.costos };
  if (despues.nivel !== antes.nivel || despues.costos !== antes.costos) {
    try {
      await db.prepare(`INSERT INTO pos_settings(key,value_json,revision,updated_at,updated_by) VALUES(?1,?2,1,?3,?4)
        ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,revision=pos_settings.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
        .bind(await levelKey(deviceId), JSON.stringify({ ...storedValue(despues.nivel, despues.costos), updated_at: at }), at, String(auth.principalId).slice(0, 120)).run();
    } catch { return { status: 503, body: { error: 'save_failed' } }; }
  }
  // Bitácora: una fila por lo que se pidió cambiar (quién = device_id, a quién = card_id, qué = outcome).
  const row = (outcome) => ({ device_id: auth.principalId, role: 'owner', tool: 'asistente.nivel', type: 'nivel', outcome, card_id: deviceId.slice(0, 64), operation_id: opId || null });
  const rows = [];
  if (nivel != null) rows.push(row('nivel:' + antes.nivel + '->' + despues.nivel + (antes.nivel === despues.nivel ? ':igual' : '')));
  if (costos != null) rows.push(row('costos:' + onOff(antes.costos) + '->' + onOff(despues.costos) + (antes.costos === despues.costos ? ':igual' : '')));
  const logged = Number(await audit(db, rows)) > 0;
  return { status: 200, body: { ok: true, device_id: deviceId, antes: antes.nivel, nivel: despues.nivel, nombre_nivel: LEVEL_NAMES[despues.nivel],
    costos_antes: antes.costos, costos: despues.costos, costos_activo: despues.nivel === 3 && despues.costos,
    ...(despues.costos && despues.nivel !== 3 ? { aviso: 'El permiso de costos y cambios solo cuenta en el nivel 3.' } : {}),
    capacidades: capabilitiesFor(roleForLevel(despues.nivel, despues.costos)), logged } };
}

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
    for (const r of rows) personas.push(r.pos_role === 'owner' ? person(r, null, true) : person(r, await readEntry(db, r.device_id), false));
    // Aparato del Admin sin fila (regla del POS: sin fila + sesión Admin = Admin) también aparece, para que vea su propio nivel.
    if (!rows.some((r) => r.device_id === String(auth.principalId))) personas.unshift(person({ device_id: String(auth.principalId), label: null }, null, true));
    return json({ ok: true, personas, ...levelMap() });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body; try { body = JSON.parse((await request.text()).slice(0, LEVELS_MAX_BODY)); } catch { return json({ error: 'bad_request' }, 400); }
  const nivelIn = body?.nivel ?? body?.level, nivel = nivelIn == null ? null : parseLevel(nivelIn);
  const costos = body?.costos == null ? null : body.costos;
  if ((nivelIn != null && nivel == null) || (costos != null && typeof costos !== 'boolean') || (nivel == null && costos == null))
    return json({ error: 'bad_request', message: 'Manda el nivel (0, 1, 2 o 3) y/o costos (true o false).' }, 400);
  let deviceId = typeof body?.device_id === 'string' ? body.device_id.trim().slice(0, 160) : '';
  if (!deviceId && typeof body?.persona === 'string') { const r = await resolvePerson(db, body.persona); if (r.error) return json({ error: r.error }, r.error === 'person_required' ? 400 : 409); deviceId = r.row.device_id; }
  if (!deviceId) return json({ error: 'bad_request', message: 'Falta el aparato (device_id) o su etiqueta (persona).' }, 400);
  const opId = typeof body?.operation_id === 'string' ? body.operation_id.slice(0, 64) : null;
  const r = await applyLevelChange(db, auth, { deviceId, nivel, costos }, opId, audit);
  return json(r.body, r.status);
}

// ---------- Herramienta del Admin en el chat ----------
export const LEVEL_TOOL_DEF = Object.freeze({ name: LEVEL_TOOL,
  description: 'Solo Admin. Nivel del asistente de una persona (0 sin permiso, 1, 2 o 3) y/o permiso de costos y cambios (solo en nivel 3). Persona: etiqueta de su aparato («Caja 2») o código; nunca nombre, DNI ni teléfono.',
  parameters: { type: 'object', properties: { persona: { type: 'string' }, nivel: { type: 'integer', enum: [0, 1, 2, 3] }, costos: { type: 'boolean' } }, required: ['persona'] } });

// Llamada del modelo -> borrador de tarjeta (se completa con la base en resolveLevelProposals). Sin persona o sin cambio: se descarta.
export function levelToolProposal(args, id) {
  const ref = typeof args?.persona === 'string' ? norm(args.persona).slice(0, 60) : '';
  const nivel = args?.nivel == null ? null : parseLevel(args.nivel), costos = typeof args?.costos === 'boolean' ? args.costos : null;
  if (!ref || (args?.nivel != null && nivel == null) || (nivel == null && costos == null)) return { dropped: 'bad_level', tool: LEVEL_TOOL };
  return { id, type: LEVEL_CARD, needsConfirm: true, requiresRole: 'owner', title: 'Permisos del asistente', _ref: ref, _nivel: nivel, _costos: costos };
}
// Completa cada tarjeta con la persona de la base y el antes/después. No encontrada o Admin: se descarta (sin escribir nada).
export async function resolveLevelProposals(db, proposals, dropped) {
  for (let k = 0; k < proposals.length; k++) {
    const p = proposals[k]; if (p.type !== LEVEL_CARD) continue;
    const r = db ? await resolvePerson(db, p._ref) : { error: 'person_not_found' };
    const bad = r.error || (r.row.pos_role !== 'empleado' ? 'admin_fixed_level' : null);
    if (bad) { dropped.push({ dropped: bad, tool: LEVEL_TOOL }); proposals.splice(k, 1); k--; continue; }
    const e = await readEntry(db, r.row.device_id), nivel = p._nivel ?? e.nivel, costos = p._costos ?? e.costos;
    const clean = { id: p.id, type: LEVEL_CARD, needsConfirm: true, requiresRole: 'owner', title: p.title, device_id: r.row.device_id, label: r.row.label || null,
      nivel_antes: e.nivel, nivel_despues: nivel, costos_antes: e.costos, costos_despues: costos,
      cambia: { nivel: p._nivel != null, costos: p._costos != null }, ...(costos && nivel !== 3 ? { aviso: 'El permiso de costos y cambios solo cuenta en el nivel 3.' } : {}) };
    if (p._call) clean._call = p._call;
    for (const key of Object.keys(p)) delete p[key];
    Object.assign(p, clean);
  }
  return proposals;
}
// «Aplicar» de la tarjeta (confirm, ya validada y firmada): el servidor guarda el cambio y lo anota con el aparato del Admin.
export async function applyLevelCard(db, auth, proposal, opId, audit = auditWrite) {
  const c = proposal?.cambia || {};
  return applyLevelChange(db, auth, { deviceId: String(proposal?.device_id || ''), nivel: c.nivel ? parseLevel(proposal.nivel_despues) : null,
    costos: c.costos ? proposal.costos_despues === true : null }, opId, audit);
}
