// Niveles del asistente POR PERSONA (cada persona = su aparato vinculado en pos_device_roles, el mismo id que ya usa el POS).
// ÚNICO lugar que dice qué puede hacer cada nivel. Sin migración y sin imports: lo usan pos-assistant-access.js (guardar/leer),
// pos-assistant.js (herramientas), pos-assistant-review.js (revisión) y pos-assistant-levels-route.js (GET/POST del Admin).
//
//   Nivel 0  «Sin permiso»  (por defecto del empleado, igual que hoy: el asistente está apagado en su aparato).
//   Nivel 1  «Con permiso»  el Admin da el permiso UNA vez en Configuración. Explica pasos y consulta stock y productos por reponer.
//   Nivel 2  «Completo en sus funciones, el resto solo lectura»: lo del 1 + listas imprimibles (precios y pedido). No propone cambios.
//   Nivel 3  «Sin restricción»: lo del 2 + revisión de la app de punta a punta (errores, fallas, lentitud, pantallas, menús
//            y cómo se ve en cada aparato, con /auth/assistant/review).
//   Admin    siempre nivel 3 y además todo lo de hoy: cambios con UN toque en «Aplicar», costos, compras, fotos y configurar niveles.
//            Sin PIN y sin otra autenticación (pedido del dueño). No se puede bajar.
//
// Guardado: el nombre del nivel va en la MISMA fila interna que ya existía (pos_settings 'internal:asst:lvl:<hash del aparato>'),
// con { level: 'off'|'consultas'|'consultas_documentos'|'completo', nivel: 0..3 }. Las filas viejas ({ level: 'consultas' }) se leen
// igual: 'consultas' = 1 y 'consultas_documentos' = 2. Así no cambia nada para quien ya tenía permiso.
// Al modelo nunca le llegan nombres, DNI ni teléfonos: para un empleado de cualquier nivel siguen los mismos filtros de siempre.

export const LEVEL_NAMES = Object.freeze(['off', 'consultas', 'consultas_documentos', 'completo']); // índice = nivel
export const ADMIN_LEVEL = 3;
export const EMPLOYEE_DEFAULT_LEVEL = 0;
export const LEVEL_LABELS = Object.freeze(['Sin permiso', 'Nivel 1: con permiso', 'Nivel 2: sus funciones, el resto solo lectura', 'Nivel 3: sin restricción']);

const freezeAll = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? Object.freeze(v) : v])));
const NONE = freezeAll({ asistente: false, herramientas: [], consultas: [], documentos: [], revision: false, cambios: false, costos: false, fotos: false, configurar: false });
const L1 = freezeAll({ ...NONE, asistente: true, herramientas: ['explicar_pasos', 'consultar'], consultas: ['stock_producto', 'bajo_stock'] });
const L2 = freezeAll({ ...L1, herramientas: [...L1.herramientas, 'preparar_documento'], documentos: ['lista_precios', 'lista_pedido'] });
const L3 = freezeAll({ ...L2, revision: true });
// Capacidades de un EMPLEADO por nivel. «cambios», «costos», «fotos» y «configurar» quedan para el Admin (ver ADMIN_CAPABILITIES).
export const LEVEL_CAPABILITIES = Object.freeze([NONE, L1, L2, L3]);
// Admin: 'todas' = las herramientas y consultas de la tabla única de permisos (POS/js/config/pos-permissions.js), sin cambios respecto de hoy.
export const ADMIN_CAPABILITIES = Object.freeze({ asistente: true, herramientas: 'todas', consultas: 'todas', documentos: 'todos', revision: true, cambios: true, costos: true, fotos: true, configurar: true });

// Acepta 0..3 (número o texto) o el nombre guardado. Cualquier otra cosa: null.
export function parseLevel(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3) return v;
  if (typeof v === 'string' && /^[0-3]$/.test(v.trim())) return Number(v.trim());
  if (typeof v === 'string' && LEVEL_NAMES.includes(v)) return LEVEL_NAMES.indexOf(v);
  return null;
}
// Nivel de lo guardado en la fila interna (nuevo o viejo). Fila mala: nivel por defecto (cerrado).
export function levelFromStored(v) {
  const n = parseLevel(v?.nivel); if (n != null && LEVEL_NAMES[n] === (v?.level ?? LEVEL_NAMES[n])) return n;
  const m = parseLevel(v?.level); return m != null && typeof v?.level === 'string' ? m : EMPLOYEE_DEFAULT_LEVEL;
}
export function storedValue(nivel) { return { level: LEVEL_NAMES[nivel], nivel }; }

// Rol del servidor ('owner' | 'empleado:<nombre>' | 'sin_rol' | ...) -> nivel 0..3.
export function levelOfRole(role) {
  if (role === 'owner') return ADMIN_LEVEL;
  const s = String(role || '');
  if (!s.startsWith('empleado:')) return 0;
  const i = LEVEL_NAMES.indexOf(s.slice(9)); return i > 0 ? i : 0;
}
export function roleForLevel(nivel) { return 'empleado:' + (LEVEL_NAMES[nivel] || 'off'); }
export function capabilitiesFor(role) { return role === 'owner' ? ADMIN_CAPABILITIES : LEVEL_CAPABILITIES[levelOfRole(role)]; }
export function levelCan(role, cap) { const c = capabilitiesFor(role)[cap]; return Array.isArray(c) ? c.length > 0 : !!c; }
// Herramientas del EMPLEADO por nombre de nivel (lo que antes era EMPLOYEE_TOOLS en pos-assistant.js).
export const EMPLOYEE_TOOLS_BY_NAME = Object.freeze(Object.fromEntries(LEVEL_NAMES.slice(1).map((n, i) => [n, LEVEL_CAPABILITIES[i + 1].herramientas])));
// Lo que un empleado puede pedir con «consultar» y «preparar_documento» (unión de los niveles; cada herramienta ya la filtra su nivel).
export const EMPLOYEE_QUERY_TYPES_ALL = Object.freeze([...new Set(LEVEL_CAPABILITIES.flatMap((c) => c.consultas))]);
export const EMPLOYEE_DOC_TYPES_ALL = Object.freeze([...new Set(LEVEL_CAPABILITIES.flatMap((c) => c.documentos))]);
export function levelOn(role) { return role === 'owner' || levelOfRole(role) > 0; }
// Lo que ve el Admin en Configuración (sin datos de personas).
export function levelMap() {
  return { niveles: LEVEL_CAPABILITIES.map((c, n) => ({ nivel: n, nombre: LEVEL_NAMES[n], titulo: LEVEL_LABELS[n], capacidades: c })),
    admin: { nivel: ADMIN_LEVEL, capacidades: ADMIN_CAPABILITIES }, por_defecto: { empleado: EMPLOYEE_DEFAULT_LEVEL, admin: ADMIN_LEVEL } };
}
