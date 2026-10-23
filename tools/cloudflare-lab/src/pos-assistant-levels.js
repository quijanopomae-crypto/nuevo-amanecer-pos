// Niveles del asistente POR PERSONA (cada persona = su aparato vinculado en pos_device_roles, el mismo id que ya usa el POS).
// ÚNICO lugar que dice qué puede hacer cada nivel. Sin migración y sin imports: lo usan pos-assistant-access.js (guardar/leer),
// pos-assistant.js (herramientas), pos-assistant-review.js (revisión) y pos-assistant-levels-route.js (GET/POST del Admin).
//
//   Nivel 0  «Sin permiso»  (por defecto del empleado, igual que hoy: el asistente está apagado en su aparato).
//   Nivel 1  «Con permiso»  el Admin da el permiso UNA vez en Configuración. Explica pasos y consulta stock, productos por reponer
//                           y cuánto debe UN cliente (deuda_cliente con su código; decisión del Admin 23-10).
//   Nivel 2  «Completo en sus funciones, el resto solo lectura»: lo del 1 + listas imprimibles (precios y pedido). No propone cambios.
//   Nivel 3  «Sin restricción»: lo del 2 + revisión de la app de punta a punta (errores, fallas, lentitud, pantallas, menús
//            y cómo se ve en cada aparato, con /auth/assistant/review).
//   Permiso aparte «costos y cambios» (costos: true), APAGADO por defecto, solo lo da o quita el Admin. SOLO cuenta en el nivel 3:
//            en el nivel 0, 1 o 2 se guarda pero no hace nada. Con nivel 3 + permiso: ve costos y ganancias, consultas y documentos del
//            negocio (sin las deudas de toda la tienda ni caja) y recibe tarjetas de cambio que él mismo aplica con UN toque en «Aplicar» (la
//            bitácora anota SU aparato). Sin el permiso, el nivel 3 sigue igual que antes (sin costos ni cambios).
//   Admin    siempre nivel 3 y además todo lo de hoy: cambios con UN toque en «Aplicar», costos, compras, fotos y configurar niveles.
//            Sin PIN y sin otra autenticación (pedido del dueño). No se puede bajar.
//
// Guardado: el nombre del nivel va en la MISMA fila interna que ya existía (pos_settings 'internal:asst:lvl:<hash del aparato>'),
// con { level: 'off'|'consultas'|'consultas_documentos'|'completo', nivel: 0..3, costos: true|false }. Las filas viejas ({ level: 'consultas' }) se leen
// igual: 'consultas' = 1 y 'consultas_documentos' = 2. Así no cambia nada para quien ya tenía permiso.
// Al modelo nunca le llegan nombres, DNI ni teléfonos: para un empleado de cualquier nivel siguen los mismos filtros de siempre.

export const LEVEL_NAMES = Object.freeze(['off', 'consultas', 'consultas_documentos', 'completo']); // índice = nivel
export const ADMIN_LEVEL = 3;
export const EMPLOYEE_DEFAULT_LEVEL = 0;
export const LEVEL_LABELS = Object.freeze(['Sin permiso', 'Nivel 1: con permiso', 'Nivel 2: sus funciones, el resto solo lectura', 'Nivel 3: sin restricción']);

const freezeAll = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? Object.freeze(v) : v])));
const NONE = freezeAll({ asistente: false, herramientas: [], consultas: [], documentos: [], revision: false, cambios: false, cambios_masivos: false, costos: false, fotos: false, configurar: false });
const L1 = freezeAll({ ...NONE, asistente: true, herramientas: ['explicar_pasos', 'consultar'], consultas: ['stock_producto', 'bajo_stock', 'deuda_cliente'] });
const L2 = freezeAll({ ...L1, herramientas: [...L1.herramientas, 'preparar_documento'], documentos: ['lista_precios', 'lista_pedido'] });
const L3 = freezeAll({ ...L2, revision: true });
// Nivel 3 + permiso «costos y cambios». Fuera siempre: deudas de toda la tienda y estado de cuenta de clientes, caja, fotos, configurar niveles y
// cambios masivos (cambios_masivos: false, heredado de NONE): una tarjeta por producto, nunca una tarjeta que cambia muchos a la vez.
// configurar_app: SOLO los datos del negocio y del ticket (destino servidor, pos-assistant-config-route.js); las claves de #972 siguen del Admin.
const L3C = freezeAll({ ...L3, costos: true, cambios: true,
  herramientas: [...L3.herramientas, 'proponer_cambio_precio', 'preparar_compra', 'proponer_ajuste_stock', 'proponer_producto_nuevo', 'configurar_app'],
  consultas: [...L3.consultas, 'sin_costo', 'ventas_periodo', 'top_productos', 'compras_recientes', 'ganancia', 'productos_sin_ventas', 'ventas_por_hora'],
  documentos: [...L3.documentos, 'inventario_valorizado', 'reporte_ventas'] });
export const COSTS_CAPABILITIES = L3C;
export const COSTS_SUFFIX = '+costos';
export const COSTS_ROLE = 'empleado:completo' + COSTS_SUFFIX;
// Capacidades de un EMPLEADO por nivel. «cambios», «costos», «fotos» y «configurar» quedan para el Admin (ver ADMIN_CAPABILITIES).
export const LEVEL_CAPABILITIES = Object.freeze([NONE, L1, L2, L3]);
// Admin: 'todas' = las herramientas y consultas de la tabla única de permisos (POS/js/config/pos-permissions.js), sin cambios respecto de hoy.
export const ADMIN_CAPABILITIES = Object.freeze({ asistente: true, herramientas: 'todas', consultas: 'todas', documentos: 'todos', revision: true, cambios: true, cambios_masivos: true, costos: true, fotos: true, configurar: true });

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
export function costsFromStored(v) { return v?.costos === true; }
export function storedValue(nivel, costos = false) { return { level: LEVEL_NAMES[nivel], nivel, costos: costos === true }; }

// Rol del servidor ('owner' | 'empleado:<nombre>' | 'sin_rol' | ...) -> nivel 0..3.
export function levelOfRole(role) {
  if (role === 'owner') return ADMIN_LEVEL;
  const s = String(role || '');
  if (!s.startsWith('empleado:')) return 0;
  const n = s.slice(9), i = LEVEL_NAMES.indexOf(n === COSTS_ROLE.slice(9) ? 'completo' : n); return i > 0 ? i : 0;
}
// El permiso solo se suma al rol en el nivel 3: 'empleado:completo+costos'. En otro nivel el rol es el de siempre.
export function roleForLevel(nivel, costos = false) { return nivel === 3 && costos === true ? COSTS_ROLE : 'empleado:' + (LEVEL_NAMES[nivel] || 'off'); }
export function hasCosts(role) { return role === COSTS_ROLE; }
// ¿Recibe datos del dueño (costos, ganancias) como el Admin? Admin, o empleado nivel 3 con permiso. Nadie más.
export function seesOwnerData(role) { return role === 'owner' || hasCosts(role); }
export function capabilitiesFor(role) { return role === 'owner' ? ADMIN_CAPABILITIES : hasCosts(role) ? L3C : LEVEL_CAPABILITIES[levelOfRole(role)]; }
export function queryAllowed(role, tipo) { const c = capabilitiesFor(role).consultas; return c === 'todas' || (Array.isArray(c) && c.includes(tipo)); }
export function docAllowed(role, tipo) { const c = capabilitiesFor(role).documentos; return c === 'todos' || (Array.isArray(c) && c.includes(tipo)); }
export function levelCan(role, cap) { const c = capabilitiesFor(role)[cap]; return Array.isArray(c) ? c.length > 0 : !!c; }
// Herramientas del EMPLEADO por nombre de nivel (lo que antes era EMPLOYEE_TOOLS en pos-assistant.js).
export const EMPLOYEE_TOOLS_BY_NAME = Object.freeze({ ...Object.fromEntries(LEVEL_NAMES.slice(1).map((n, i) => [n, LEVEL_CAPABILITIES[i + 1].herramientas])), [COSTS_ROLE.slice(9)]: L3C.herramientas });
// Lo que un empleado puede pedir con «consultar» y «preparar_documento» (unión de los niveles; cada herramienta ya la filtra su nivel).
export const EMPLOYEE_QUERY_TYPES_ALL = Object.freeze([...new Set(LEVEL_CAPABILITIES.flatMap((c) => c.consultas))]);
export const EMPLOYEE_DOC_TYPES_ALL = Object.freeze([...new Set(LEVEL_CAPABILITIES.flatMap((c) => c.documentos))]);
export function levelOn(role) { return role === 'owner' || levelOfRole(role) > 0; }
// Lo que ve el Admin en Configuración (sin datos de personas).
export function levelMap() {
  return { niveles: LEVEL_CAPABILITIES.map((c, n) => ({ nivel: n, nombre: LEVEL_NAMES[n], titulo: LEVEL_LABELS[n], capacidades: c })),
    permiso_costos: { solo_nivel: 3, por_defecto: false, capacidades: L3C },
    admin: { nivel: ADMIN_LEVEL, capacidades: ADMIN_CAPABILITIES }, por_defecto: { empleado: EMPLOYEE_DEFAULT_LEVEL, admin: ADMIN_LEVEL, costos: false } };
}

// ---------- Cambios masivos: solo el Admin (decisión de la sala, 2026-10-22) ----------
// Una tarjeta que cambia MÁS DE UN producto con un solo «Aplicar» (p. ej. «Cambiar precio de 408 productos a S/ 1.00») es solo del Admin
// (capacidad cambios_masivos). Un empleado, aunque sea nivel 3 con «costos y cambios», recibe una tarjeta por producto.
// La compra (factura de un proveedor, varias filas) NO es un cambio masivo: es un solo documento y ya la tiene el nivel 3 con permiso.
export const BULK_EXEMPT_TYPES = Object.freeze(['compra', 'documento', 'consulta', 'pasos']);
export const BULK_ADMIN_ONLY_TEXT = 'Los cambios de varios productos a la vez los hace el Admin. Yo te preparo una tarjeta por producto.';
const idOf = (x) => (x && typeof x === 'object' ? x.product_id ?? x.id ?? null : x);
// Productos distintos que toca UNA tarjeta. Mira product_id y cualquier lista de productos (product_ids, productos, items, cambios,
// ejemplos no cuenta: el total lo dice cantidad_productos/total_productos). Genérico: sirve para la tarjeta resumen que se arme después.
export function proposalProductCount(p) {
  if (!p || typeof p !== 'object' || BULK_EXEMPT_TYPES.includes(p.type)) return 0;
  const ids = new Set();
  if (p.product_id != null && p.product_id !== '') ids.add(String(p.product_id));
  for (const k of ['product_ids', 'productos', 'items', 'cambios']) if (Array.isArray(p[k])) for (const x of p[k]) { const id = idOf(x); if (id != null && id !== '') ids.add(String(id)); }
  const declared = Math.max(0, ...['cantidad_productos', 'total_productos'].map((k) => (Number.isFinite(Number(p[k])) ? Number(p[k]) : 0)));
  return Math.max(ids.size, declared, p.masivo === true ? 2 : 0);
}
export function isBulkProposal(p) { return proposalProductCount(p) > 1; }
export function bulkAllowed(role) { return levelCan(role, 'cambios_masivos'); }
// Saca las tarjetas masivas de quien no es Admin (las anota en dropped como bulk_admin_only). Devuelve cuántas sacó.
export function dropBulkProposals(role, proposals, dropped) {
  if (bulkAllowed(role)) return 0;
  let n = 0;
  for (let k = proposals.length - 1; k >= 0; k--) {
    if (!isBulkProposal(proposals[k])) continue;
    dropped.push({ dropped: 'bulk_admin_only', tool: proposals[k]._call?.name || proposals[k].type }); proposals.splice(k, 1); n++;
  }
  return n;
}
