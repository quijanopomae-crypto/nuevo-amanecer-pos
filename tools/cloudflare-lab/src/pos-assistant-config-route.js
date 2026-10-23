// Datos del negocio y del ticket dentro de «configurar_app» (#972): misma herramienta y misma tarjeta «configuracion», con destino:'servidor'.
// - Lista CERRADA de claves (CONFIG_KEYS). Cada clave apunta a un campo de una fila de pos_settings que ya guarda el POS (config-g.js, SHARED).
//   Nunca crea una fila ni una clave nueva: si la fila no existe en el servidor, la tarjeta se descarta (config_sin_datos).
//   Clave desconocida o valor inválido: fuera. Borrar todo / reiniciar: no existe aquí (ninguna clave lo hace).
//   Las claves de #972 (stock mínimo, avisos de stock, impresión automática, apariencia, lector) NO están aquí: siguen solo del Admin y las
//   guarda el aparato (pos-assistant-settings.js).
// - Quién: el mismo permiso «cambios» de pos-assistant-levels.js (Admin, o nivel 3 + «costos y cambios»). Sin permiso nuevo ni migración.
// - La tarjeta es la de #972 (ajuste, nombre, alcance, antes, valor) más destino:'servidor'. Un toque en «Confirmar» (sin PIN) llega a
//   /auth/assistant/confirm, que valida el token firmado y el servidor guarda aquí (applyConfigCard): fusiona el campo en la fila existente con
//   revisión condicional (revision+1), así un aparato con una copia vieja recibe revision_conflict y toma la del servidor. El cambio queda en
//   la bitácora (pos-assistant-audit.js) con el aparato que aplicó (Admin o empleado), sin los valores.
import { auditWrite } from './pos-assistant-audit.js';

export const CONFIG_CARD = 'configuracion';
export const CONFIG_DEST = 'servidor';
export const CONFIG_ALCANCE = 'todos los aparatos';

const clean = (v, max) => (typeof v === 'string' ? v.normalize('NFC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim() : '');
// Texto tapado por el filtro de datos personales (o con asteriscos/marcas): no se guarda nunca.
const MASKED = /\*{2,}|[∗＊]{2,}|_{3,}|#{3,}|\[[^\]]{0,30}(?:ocult|omitid|dato|tel|dni|ruc|correo|direcci|redact)[^\]]{0,30}\]|\((?:ocult[oa]|omitid[oa])\)/i;
const text = (min, max) => (v) => { const s = clean(v); return s.length >= min && s.length <= max && !MASKED.test(s) ? s : undefined; };
const bool = (v) => (v === true || v === false ? v : typeof v === 'string' && /^(true|s[ií]|activar|encender|on)$/i.test(v.trim()) ? true
  : typeof v === 'string' && /^(false|no|desactivar|apagar|off)$/i.test(v.trim()) ? false : undefined);
const oneOf = (list) => (v) => { const s = clean(String(v ?? '')).toLowerCase().replace(/\s+/g, ''); return list.includes(s) ? s : undefined; };
const ruc = (v) => { const s = String(v ?? '').replace(/[\s.-]/g, ''); return /^(10|15|16|17|20)\d{9}$/.test(s) ? s : undefined; };

// clave -> { fila de pos_settings, campo, texto de la tarjeta, validador, valor de fábrica (_naDefaults, inline-02.js) }
export const CONFIG_KEYS = Object.freeze({
  negocio_nombre: { setting: 'pos.business', field: 'nombre', label: 'Nombre del negocio', parse: text(2, 60), def: '' },
  negocio_ruc: { setting: 'pos.business', field: 'ruc', label: 'RUC', parse: ruc, def: '' },
  negocio_direccion: { setting: 'pos.business', field: 'direccion', label: 'Dirección', parse: text(3, 120), def: '' },
  ticket_pie: { setting: 'pos.ticket', field: 'pie', label: 'Pie del ticket', parse: text(1, 200), def: '' },
  ticket_ancho: { setting: 'pos.ticket', field: 'ancho', label: 'Ancho del papel', parse: oneOf(['58mm', '80mm']), def: '80mm' },
  ticket_logo: { setting: 'pos.ticket', field: 'showLogo', label: 'Logo en el ticket', parse: bool, def: true },
  ticket_igv: { setting: 'pos.ticket', field: 'showIGV', label: 'IGV en el ticket', parse: bool, def: false },
  ticket_forma_pago: { setting: 'pos.ticket', field: 'showPayment', label: 'Forma de pago en el ticket', parse: bool, def: true },
  avisos: { setting: 'pos.flags', field: 'alertsEnabled', label: 'Avisos y confirmaciones', parse: bool, def: true }
});
export const CONFIG_KEY_NAMES = Object.freeze(Object.keys(CONFIG_KEYS));
export const isServerKey = (k) => typeof k === 'string' && Object.hasOwn(CONFIG_KEYS, k);
// (auditoría 500, SEG) «avisos» (Avisos y confirmaciones) apaga las confirmaciones de TODOS los aparatos: solo el Admin. El nivel 3 + «costos y
// cambios» sigue con negocio y ticket. Se rechaza antes de leer la base (chat y confirm) y aquí otra vez (applyConfigCard).
export const ADMIN_ONLY_SERVER_KEYS = Object.freeze(['avisos']);
export const CONFIG_ADMIN_ONLY_TEXT = 'Los avisos y confirmaciones los cambia solo el Admin.';
export const employeeServerKey = (k) => isServerKey(k) && !ADMIN_ONLY_SERVER_KEYS.includes(k);
export const EMPLOYEE_CONFIG_KEY_NAMES = Object.freeze(CONFIG_KEY_NAMES.filter(employeeServerKey));
// Catálogo para el modelo (solo en pedidos de configuración, igual que el de #972): clave, nombre y valores admitidos. NUNCA los valores
// actuales (nombre, RUC, dirección y pie no salen al modelo; el «antes» de la tarjeta se lee de la base en resolveConfigProposals).
const KIND = { negocio_ruc: 'RUC de 11 dígitos (o valor vacío: se escribe en el teléfono)', ticket_ancho: ['58mm', '80mm'] };
export function serverCatalog(admin = true) {
  return (admin ? CONFIG_KEY_NAMES : EMPLOYEE_CONFIG_KEY_NAMES).map((clave) => { const s = CONFIG_KEYS[clave], k = KIND[clave] || (s.parse === bool ? 'boolean' : 'texto');
    return { clave, nombre: s.label, ...(Array.isArray(k) ? { valores: k } : { tipo: k }) }; });
}

// RUC (decisión de alfa, 23-10): no se afloja el filtro de DNI/RUC. Si el RUC llega tapado o vacío, la tarjeta sale igual con valor vacío y
// «completar: ['valor']» (el mismo mecanismo de la tarjeta de compra): la persona lo escribe en el teléfono y va en body.manual del confirm,
// fuera de la propuesta firmada; el número nunca pasa por el modelo. Solo esta clave y solo el campo «valor» se pueden completar así.
export const CONFIG_FILL = Object.freeze({ negocio_ruc: 'valor' });
const RUC_MASK = /[*∗＊•●·⁎✱#_~…▪■◦□▫]|(?:^|[^\p{L}])x(?:[\s-]?x)+|\[[^\]]{0,30}\]|\((?:ocult[oa]|omitid[oa])\)|ocult|omitid|tapad|redact/iu;
const rucPending = (v) => v == null || (typeof v === 'string' && (clean(v) === '' || RUC_MASK.test(v)));
// Campos que esta tarjeta deja completar a mano (declarados y firmados en «completar»); [] para cualquier otra.
export function configFillNames(p) {
  const n = p && p.type === CONFIG_CARD && p.destino === CONFIG_DEST && Object.hasOwn(CONFIG_FILL, p.ajuste) ? CONFIG_FILL[p.ajuste] : null;
  return n && Array.isArray(p.completar) && p.completar.includes(n) ? [n] : [];
}
// Lo escrito a mano (ya normalizado por el confirm): validado con la MISMA regla de la clave (RUC Perú: 11 dígitos, 10/15/16/17/20).
export function configFillValue(ajuste, raw) { return Object.hasOwn(CONFIG_FILL, ajuste) ? CONFIG_KEYS[ajuste].parse(raw) : undefined; }

// Llamada configurar_app con una clave del servidor -> borrador (antes se completa con la base en resolveConfigProposals).
export function serverSettingProposal(args, id) {
  const k = args?.ajuste, v = isServerKey(k) ? CONFIG_KEYS[k].parse(args.valor) : undefined;
  if (v === undefined && Object.hasOwn(CONFIG_FILL, k) && rucPending(args.valor))
    return { id, type: CONFIG_CARD, needsConfirm: true, title: 'Cambiar configuración', ajuste: k, nombre: CONFIG_KEYS[k].label, alcance: CONFIG_ALCANCE, destino: CONFIG_DEST, completar: [CONFIG_FILL[k]], valor: '', _pending: true };
  if (v === undefined) return { dropped: 'bad_setting', tool: 'configurar_app' };
  return { id, type: CONFIG_CARD, needsConfirm: true, title: 'Cambiar configuración', ajuste: k, nombre: CONFIG_KEYS[k].label, alcance: CONFIG_ALCANCE, destino: CONFIG_DEST, valor: v, _pending: true };
}

async function readSetting(db, key) {
  const row = await db.prepare('SELECT value_json,revision FROM pos_settings WHERE key=?1').bind(key).first();
  if (!row) return null;
  const v = JSON.parse(row.value_json);
  return v && typeof v === 'object' && !Array.isArray(v) ? { value: v, revision: Number(row.revision || 0) } : null;
}
const current = (row, spec) => (row && Object.hasOwn(row.value, spec.field) && row.value[spec.field] != null ? row.value[spec.field] : spec.def);

// Completa cada tarjeta del servidor con lo que hay hoy en la base. Fila que no existe, lectura caída o nada que cambiar: fuera (sin escribir).
export async function resolveConfigProposals(db, proposals, dropped) {
  const rows = {};
  for (let k = 0; k < proposals.length; k++) {
    const p = proposals[k]; if (p.type !== CONFIG_CARD || p.destino !== CONFIG_DEST || !p._pending) continue;
    const spec = CONFIG_KEYS[p.ajuste]; let bad = null, antes;
    try {
      if (!(spec.setting in rows)) rows[spec.setting] = db ? await readSetting(db, spec.setting) : null;
      const row = rows[spec.setting];
      if (!row) bad = 'config_sin_datos'; else { antes = current(row, spec); if (antes === p.valor && !configFillNames(p).length) bad = 'config_sin_cambio'; }
    } catch { bad = 'config_read_failed'; }
    if (bad) { dropped.push({ dropped: bad, tool: 'configurar_app' }); proposals.splice(k, 1); k--; continue; }
    const { _pending, valor, ...rest } = p;
    for (const key of Object.keys(p)) delete p[key];
    Object.assign(p, { ...rest, antes, valor });
  }
  return proposals;
}

// «Confirmar» (confirm ya validado y firmado). Vuelve a validar la clave contra la lista cerrada, revisa que el valor actual siga siendo el
// «antes» de la tarjeta, fusiona el campo en la fila que YA existe (UPDATE condicional por revisión; nunca INSERT) y anota una fila de
// bitácora con el aparato que aplicó.
export async function applyConfigCard(db, auth, role, proposal, opId, audit = auditWrite) {
  const k = proposal?.ajuste, spec = isServerKey(k) ? CONFIG_KEYS[k] : null;
  if (role !== 'owner' && !employeeServerKey(k) && isServerKey(k)) return { status: 403, body: { error: 'config_forbidden', message: CONFIG_ADMIN_ONLY_TEXT } };
  const v = spec ? spec.parse(proposal.valor) : undefined;
  if (!spec || proposal.destino !== CONFIG_DEST || v === undefined || v !== proposal.valor || !db) return { status: 400, body: { error: 'config_invalid' } };
  const at = new Date().toISOString(), who = String(auth?.principalId || 'assistant').slice(0, 120);
  const conflict = { status: 409, body: { error: 'revision_conflict', message: 'La Configuración cambió en otro aparato. Pide la tarjeta de nuevo.' } };
  let rev;
  try {
    const row = await readSetting(db, spec.setting);
    if (!row) return { status: 409, body: { error: 'config_sin_datos', message: 'Ese ajuste todavía no está guardado en el servidor. Ábrelo una vez en Configuración.' } };
    if (current(row, spec) !== proposal.antes) return conflict; // otro aparato ya lo cambió desde que se armó la tarjeta
    const json = JSON.stringify({ ...row.value, [spec.field]: v }); if (json.length > 8000) return { status: 413, body: { error: 'value_too_large' } };
    const res = await db.prepare('UPDATE pos_settings SET value_json=?2,revision=revision+1,updated_at=?3,updated_by=?4 WHERE key=?1 AND revision=?5')
      .bind(spec.setting, json, at, who, row.revision).run();
    if (res?.meta && res.meta.changes === 0) return conflict; // otro aparato guardó en medio: no se pisa
    rev = row.revision + 1;
  } catch { return { status: 503, body: { error: 'save_failed' } }; }
  // Bitácora: una fila por cambio guardado (quién = aparato que aplicó, qué = «config:<clave>»; sin los valores).
  const logged = Number(await audit(db, [{ device_id: auth?.principalId, role, tool: 'asistente.config', type: CONFIG_CARD, outcome: ('config:' + k).slice(0, 40), card_id: proposal?.id || null, operation_id: opId || null }])) > 0;
  return { status: 200, body: { ok: true, aplicado: [k], revisiones: { [spec.setting]: rev }, logged } };
}
