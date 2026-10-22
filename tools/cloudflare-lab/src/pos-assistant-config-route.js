// Herramienta «proponer_configuracion»: cambia ajustes que YA existen en Configuración (datos del negocio, ticket, impresión y avisos).
// - Lista CERRADA de claves (CONFIG_KEYS). Cada clave apunta a un campo de una fila de pos_settings que ya guarda el POS (config-g.js, SHARED).
//   Nunca crea una fila ni una clave nueva: si la fila no existe en el servidor, la tarjeta se descarta (config_sin_datos).
//   Clave desconocida o valor inválido: fuera. Borrar todo / reiniciar: no existe aquí (ninguna clave lo hace).
// - Quién: el mismo permiso «cambios» de pos-assistant-levels.js (Admin, o nivel 3 + «costos y cambios»). Sin permiso nuevo ni migración.
// - La tarjeta muestra una fila por clave: actual → nuevo. Un toque en «Aplicar» (sin PIN) llega a /auth/assistant/confirm, que valida el
//   token firmado y el servidor guarda aquí (applyConfigCard): fusiona el campo en la fila existente con revisión condicional (revision+1),
//   así un aparato con una copia vieja recibe revision_conflict y toma la del servidor. Cada clave cambiada queda en la bitácora
//   (pos-assistant-audit.js) con el aparato que aplicó (Admin o empleado), sin los valores.
import { auditWrite } from './pos-assistant-audit.js';

export const CONFIG_TOOL = 'proponer_configuracion';
export const CONFIG_CARD = 'configuracion';
export const CONFIG_MAX_KEYS = 12;

const clean = (v, max) => (typeof v === 'string' ? v.normalize('NFC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim() : '');
// Texto tapado por el filtro de datos personales (o con asteriscos/marcas): no se guarda nunca.
const MASKED = /\*{2,}|[∗＊]{2,}|_{3,}|#{3,}|\[[^\]]{0,30}(?:ocult|omitid|dato|tel|dni|ruc|correo|direcci|redact)[^\]]{0,30}\]|\((?:ocult[oa]|omitid[oa])\)/i;
const text = (min, max) => (v) => { const s = clean(v); return s.length >= min && s.length <= max && !MASKED.test(s) ? s : undefined; };
const bool = (v) => (v === true || v === false ? v : typeof v === 'string' && /^(true|s[ií]|activar|encender|on)$/i.test(v.trim()) ? true
  : typeof v === 'string' && /^(false|no|desactivar|apagar|off)$/i.test(v.trim()) ? false : undefined);
const int = (lo, hi) => (v) => { const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN; return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined; };
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
  imprimir_al_cobrar: { setting: 'pos.flags', field: 'printAuto', label: 'Imprimir al cobrar', parse: bool, def: false },
  avisos: { setting: 'pos.flags', field: 'alertsEnabled', label: 'Avisos y confirmaciones', parse: bool, def: true },
  aviso_stock_bajo: { setting: 'pos.flags', field: 'stockAlertActive', label: 'Aviso de stock bajo', parse: bool, def: true },
  stock_minimo: { setting: 'pos.flags', field: 'stockMin', label: 'Stock mínimo por defecto', parse: int(0, 100000), def: 5 }
});
export const CONFIG_KEY_NAMES = Object.freeze(Object.keys(CONFIG_KEYS));

export const CONFIG_TOOL_DEF = Object.freeze({ name: CONFIG_TOOL,
  description: 'Cambia ajustes que ya existen en Configuración (negocio, ticket, impresión, avisos). Una fila por clave. No borra ni reinicia nada.',
  parameters: { type: 'object', properties: { cambios: { type: 'array', maxItems: CONFIG_MAX_KEYS, items: { type: 'object',
    properties: { clave: { type: 'string', enum: CONFIG_KEY_NAMES }, valor: { type: ['string', 'number', 'boolean'] } }, required: ['clave', 'valor'] } } }, required: ['cambios'] } });

// Llamada del modelo -> borrador (se completa con la base en resolveConfigProposals). Clave desconocida o valor inválido: fuera.
export function configToolProposal(args, id) {
  const list = Array.isArray(args?.cambios) ? args.cambios.slice(0, 30) : [];
  const want = [], seen = new Set(); let descartadas = 0;
  for (const c of list) {
    const k = typeof c?.clave === 'string' ? c.clave.trim() : '';
    const spec = Object.hasOwn(CONFIG_KEYS, k) ? CONFIG_KEYS[k] : null;
    const v = spec ? spec.parse(c.valor) : undefined;
    if (!spec || v === undefined || seen.has(k) || want.length >= CONFIG_MAX_KEYS) { descartadas++; continue; }
    seen.add(k); want.push({ clave: k, valor: v });
  }
  if (!want.length) return { dropped: 'config_invalid', tool: CONFIG_TOOL };
  return { id, type: CONFIG_CARD, needsConfirm: true, title: 'Cambiar Configuración', _want: want, _descartadas: descartadas };
}

async function readSetting(db, key) {
  const row = await db.prepare('SELECT value_json,revision FROM pos_settings WHERE key=?1').bind(key).first();
  if (!row) return null;
  const v = JSON.parse(row.value_json);
  return v && typeof v === 'object' && !Array.isArray(v) ? { value: v, revision: Number(row.revision || 0) } : null;
}
const current = (row, spec) => (row && Object.hasOwn(row.value, spec.field) && row.value[spec.field] != null ? row.value[spec.field] : spec.def);

// Completa cada tarjeta con lo que hay hoy en la base. Fila que no existe, lectura caída o nada que cambiar: fuera (sin escribir nada).
export async function resolveConfigProposals(db, proposals, dropped) {
  for (let k = 0; k < proposals.length; k++) {
    const p = proposals[k]; if (p.type !== CONFIG_CARD) continue;
    const rows = {}, ajustes = []; let bad = null;
    try {
      for (const w of p._want) {
        const spec = CONFIG_KEYS[w.clave];
        if (!(spec.setting in rows)) rows[spec.setting] = db ? await readSetting(db, spec.setting) : null;
        const row = rows[spec.setting];
        if (!row) { bad = bad || 'config_sin_datos'; continue; }
        const antes = current(row, spec);
        if (antes === w.valor) continue; // ya está así
        ajustes.push({ clave: w.clave, etiqueta: spec.label, antes, despues: w.valor });
      }
    } catch { bad = 'config_read_failed'; ajustes.length = 0; }
    if (!ajustes.length) { dropped.push({ dropped: bad || 'config_sin_cambio', tool: CONFIG_TOOL }); proposals.splice(k, 1); k--; continue; }
    const clean = { id: p.id, type: CONFIG_CARD, needsConfirm: true, title: p.title, ajustes, ...(p._descartadas ? { descartadas: p._descartadas } : {}) };
    if (p._call) clean._call = p._call;
    for (const key of Object.keys(p)) delete p[key];
    Object.assign(p, clean);
  }
  return proposals;
}

// «Aplicar» (confirm ya validado y firmado). Vuelve a validar cada clave contra la lista cerrada, fusiona el campo en la fila que YA existe
// (UPDATE condicional por revisión; nunca INSERT) y anota una fila de bitácora por clave con el aparato que aplicó.
export async function applyConfigCard(db, auth, role, proposal, opId, audit = auditWrite) {
  const list = Array.isArray(proposal?.ajustes) ? proposal.ajustes : [];
  const by = {};
  for (const a of list) {
    const spec = Object.hasOwn(CONFIG_KEYS, a?.clave) ? CONFIG_KEYS[a.clave] : null;
    const v = spec ? spec.parse(a.despues) : undefined;
    if (!spec || v === undefined || v !== a.despues) return { status: 400, body: { error: 'config_invalid' } };
    (by[spec.setting] = by[spec.setting] || []).push({ clave: a.clave, field: spec.field, valor: v });
  }
  if (!list.length || !db) return { status: 400, body: { error: 'config_invalid' } };
  const at = new Date().toISOString(), who = String(auth?.principalId || 'assistant').slice(0, 120), revisiones = {}, hechas = [];
  // Bitácora: una fila por clave guardada (quién = aparato que aplicó, qué = «config:<clave>»; sin los valores).
  const log = () => audit(db, hechas.map((k) => ({ device_id: auth?.principalId, role, tool: 'asistente.config', type: CONFIG_CARD, outcome: ('config:' + k).slice(0, 40), card_id: proposal?.id || null, operation_id: opId || null })));
  try {
    const plan = [];
    for (const [key, items] of Object.entries(by)) {
      const row = await readSetting(db, key);
      if (!row) return { status: 409, body: { error: 'config_sin_datos', message: 'Ese ajuste todavía no está guardado en el servidor. Ábrelo una vez en Configuración.' } };
      const value = { ...row.value }; for (const it of items) value[it.field] = it.valor;
      const json = JSON.stringify(value); if (json.length > 8000) return { status: 413, body: { error: 'value_too_large' } };
      plan.push({ key, json, rev: row.revision });
    }
    for (const s of plan) {
      const res = await db.prepare('UPDATE pos_settings SET value_json=?2,revision=revision+1,updated_at=?3,updated_by=?4 WHERE key=?1 AND revision=?5')
        .bind(s.key, s.json, at, who, s.rev).run();
      if (res?.meta && res.meta.changes === 0) {
        // Otro aparato guardó en medio: lo ya guardado queda anotado; repetir la tarjeta es seguro (pone los mismos valores).
        if (hechas.length) await log();
        return { status: 409, body: { error: 'revision_conflict', message: 'La Configuración cambió en otro aparato. Pide la tarjeta de nuevo.', aplicado: hechas } };
      }
      revisiones[s.key] = s.rev + 1; hechas.push(...by[s.key].map((it) => it.clave));
    }
  } catch { if (hechas.length) await log(); return { status: 503, body: { error: 'save_failed', aplicado: hechas } }; }
  const logged = Number(await log()) > 0;
  return { status: 200, body: { ok: true, aplicado: hechas, revisiones, logged } };
}
