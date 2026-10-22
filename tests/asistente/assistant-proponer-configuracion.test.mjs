// proponer_configuracion: cambia SOLO ajustes que ya existen en Configuración (lista cerrada de claves), tarjeta actual → nuevo,
// un toque en «Aplicar» sin PIN, el servidor guarda en pos_settings y anota la bitácora con el aparato que aplicó.
// Permiso: el mismo «cambios» de pos-assistant-levels.js (Admin y nivel 3 + «costos y cambios»). El resto: 403 sin leer la base.
// Datos inventados; el modelo siempre simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, assistantConfirmRoute, createMemoryUsageStore, toolsForRole, toProposal, employeeToolGuard, toolAllowed } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { CONFIG_TOOL, CONFIG_CARD, CONFIG_KEYS, CONFIG_KEY_NAMES, CONFIG_TOOL_DEF, configToolProposal } from '../../tools/cloudflare-lab/src/pos-assistant-config-route.js';
import { LEVEL_NAMES, COSTS_ROLE, LEVEL_CAPABILITIES, COSTS_CAPABILITIES, capabilitiesFor, levelCan } from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const SECRET = 'secreto-de-prueba-0123456789abcdef';
const NOW = Date.parse('2026-10-22T17:00:00.000Z');
const OWNER = { principalId: 'session:dev-owner', posRole: 'owner' };
const EMP = { principalId: 'session:emp-caja2', posRole: 'empleado' };
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' };
const NO_CHANGE_ROLES = [...LEVEL_NAMES.map((n) => 'empleado:' + n), 'sin_rol', 'empleado', 'otro'];

// Un valor válido y uno inválido por clave (cada clave de la lista cerrada tiene su par).
const SAMPLES = {
  negocio_nombre: ['Botica Sol Naciente', 'x'],
  negocio_ruc: ['20123456789', '123'],
  negocio_direccion: ['Jr. Inventado 123, Huánuco', '[dirección oculta]'],
  ticket_pie: ['Gracias | Vuelva pronto', ''],
  ticket_ancho: ['58mm', 'A4'],
  ticket_logo: [false, 'quizás'],
  ticket_igv: [true, 3],
  ticket_forma_pago: [false, 'tal vez'],
  imprimir_al_cobrar: [true, 'a veces'],
  avisos: [false, null],
  aviso_stock_bajo: [false, 'x'],
  stock_minimo: [10, -1]
};

// pos_settings en memoria: solo lo que usan la herramienta y el chat (SELECT por clave y UPDATE con revisión). Cuenta cada lectura.
function memDb(seed = {}) {
  const rows = new Map(Object.entries(seed).map(([k, v]) => [k, { value_json: JSON.stringify(v), revision: 3, updated_by: 'session:dev-owner' }]));
  const reads = [], writes = [];
  const db = { rows, reads, writes, prepare(sql) {
    return { bind: (...a) => ({
      first: async () => { reads.push(a[0]); if (!/^SELECT/i.test(sql)) return null; const r = rows.get(a[0]); return r ? { ...r } : null; },
      all: async () => { reads.push(sql); return { results: [] }; },
      run: async () => {
        if (/^UPDATE pos_settings SET value_json/i.test(sql)) {
          const r = rows.get(a[0]); if (!r || r.revision !== a[4]) return { meta: { changes: 0 } };
          rows.set(a[0], { value_json: a[1], revision: r.revision + 1, updated_by: a[3] }); writes.push(a[0]); return { meta: { changes: 1 } };
        }
        writes.push(sql); return { meta: { changes: 1 } };
      } }) };
  } };
  return db;
}
const SEED = () => ({
  'pos.business': { nombre: 'Multiservicios Nuevo Amanecer', ruc: '', direccion: 'Puerto Súngaro, Huánuco', telefono: '' },
  'pos.ticket': { ancho: '80mm', pie: '¡GRACIAS POR SU COMPRA!', showLogo: true, showIGV: false, showPayment: true, showNum: true },
  'pos.flags': { igvActive: true, margenActive: true, stockAlertActive: true, printAuto: false, mayoristaActive: true, alertsEnabled: true, stockMin: 5 }
});
const setting = (db, k) => JSON.parse(db.rows.get(k).value_json);

const call = (args) => ({ id: 'call_1', type: 'function', function: { name: CONFIG_TOOL, arguments: JSON.stringify(args) } });
function harness({ role = 'owner', auth = OWNER, db = memDb(SEED()), store = createMemoryUsageStore(), args } = {}) {
  const cap = [], audit = [];
  const f = async (_u, init) => { cap.push(JSON.parse(String(init.body))); const n = cap.length;
    return json({ choices: [{ message: n === 1 ? { content: '', tool_calls: [call(args)] } : { content: 'Listo.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); };
  const deps = { store, db, resolveRole: async () => role, fetch: f, audit: async (_d, r) => { audit.push(...r); return r.length; }, readBusinessName: async () => 'Negocio', mockChunkMs: 0, now: () => NOW };
  const chat = async (text = 'Cambia la configuración') => { const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text }) }), ENV, auth, json, deps);
    const raw = await r.text(); let body = null; try { body = JSON.parse(raw); } catch { body = null; } return { status: r.status, body, raw }; };
  const confirm = async (p, a = auth) => { const { confirm_token, ...proposal } = p;
    const r = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token: confirm_token, proposal }) }), ENV, a, json, deps);
    return { status: r.status, body: await r.json() }; };
  return { chat, confirm, cap, audit, db, deps };
}

test('lista cerrada: 12 claves, todas sobre filas que ya guarda Configuración; nada de borrar ni reiniciar', () => {
  assert.deepEqual(CONFIG_KEY_NAMES, Object.keys(SAMPLES));
  for (const k of CONFIG_KEY_NAMES) assert.ok(['pos.business', 'pos.ticket', 'pos.flags'].includes(CONFIG_KEYS[k].setting), k);
  assert.deepEqual(CONFIG_TOOL_DEF.parameters.properties.cambios.items.properties.clave.enum, CONFIG_KEY_NAMES);
  assert.ok(!CONFIG_KEY_NAMES.some((k) => /borra|reinic|reset|todo|elimin/i.test(k)));
  assert.ok(!/borrar todo|reiniciar|reset/i.test(JSON.stringify(CONFIG_TOOL_DEF).replace('No borra ni reinicia nada', '')));
});

for (const [clave, [ok, bad]] of Object.entries(SAMPLES)) {
  test('clave ' + clave + ': valor válido -> tarjeta actual → nuevo; valor inválido -> rechazado', async () => {
    const h = harness({ args: { cambios: [{ clave, valor: ok }] } });
    const r = await h.chat(); assert.equal(r.status, 200, r.raw);
    const card = r.body.proposals.find((p) => p.type === CONFIG_CARD); assert.ok(card && card.confirm_token, r.raw);
    const spec = CONFIG_KEYS[clave], antes = setting(h.db, spec.setting)[spec.field] ?? spec.def;
    assert.deepEqual(card.ajustes, [{ clave, etiqueta: spec.label, antes, despues: ok }]);
    assert.equal(card.needsConfirm, true); assert.ok(!card.requiresRole, 'la puede aplicar quien tenga el permiso «cambios»');
    assert.equal(h.db.writes.length, 0, 'proponer no escribe nada');
    // inválido: fuera, sin tarjeta
    const p = configToolProposal({ cambios: [{ clave, valor: bad }] }, 'x'); assert.equal(p.dropped, 'config_invalid', clave + ' ' + JSON.stringify(bad));
    const h2 = harness({ args: { cambios: [{ clave, valor: bad }] } }); const r2 = await h2.chat();
    assert.equal(r2.status, 200); assert.equal(r2.body.proposals.length, 0); assert.match(r2.body.reply, /No puedo hacer eso/);
  });
}

test('claves desconocidas se rechazan; las válidas de la misma llamada siguen', async () => {
  for (const clave of ['negocio_telefono', 'metodo_pago_yape', 'pos.business', 'clave_nueva', 'igvActive', '__proto__', 'constructor']) {
    const p = configToolProposal({ cambios: [{ clave, valor: true }] }, 'x'); assert.equal(p.dropped, 'config_invalid', clave);
  }
  const p = configToolProposal({ cambios: [{ clave: 'clave_nueva', valor: 'x' }, { clave: 'avisos', valor: false }, { clave: 'avisos', valor: true }] }, 'x');
  assert.deepEqual(p._want, [{ clave: 'avisos', valor: false }]); assert.equal(p._descartadas, 2);
  const h = harness({ args: { cambios: [{ clave: 'clave_nueva', valor: 'x' }, { clave: 'avisos', valor: false }] } });
  const r = await h.chat(); const card = r.body.proposals[0];
  assert.deepEqual(card.ajustes.map((a) => a.clave), ['avisos']); assert.equal(card.descartadas, 1);
  assert.ok(!JSON.stringify(card).includes('clave_nueva'));
});

test('nunca crea filas nuevas: sin la fila en el servidor la tarjeta se descarta; un valor igual al actual no hace tarjeta', async () => {
  const h = harness({ db: memDb({}), args: { cambios: [{ clave: 'ticket_pie', valor: 'Hola' }] } });
  const r = await h.chat(); assert.equal(r.body.proposals.length, 0); assert.equal(h.db.rows.size, 0); assert.equal(h.db.writes.length, 0);
  assert.ok(h.audit.some((a) => a.outcome === 'dropped:config_sin_datos'));
  const h2 = harness({ args: { cambios: [{ clave: 'ticket_ancho', valor: '80mm' }] } });
  assert.equal((await h2.chat()).body.proposals.length, 0);
});

test('Admin: un solo «Aplicar» sin PIN guarda en pos_settings (revisión +1, resto intacto) y anota la bitácora', async () => {
  const h = harness({ args: { cambios: [{ clave: 'negocio_ruc', valor: '20123456789' }, { clave: 'ticket_pie', valor: 'Gracias | Vuelva pronto' }, { clave: 'imprimir_al_cobrar', valor: true }] } });
  const r = await h.chat(); const card = r.body.proposals[0];
  assert.deepEqual(card.ajustes.map((a) => [a.clave, a.antes, a.despues]), [['negocio_ruc', '', '20123456789'], ['ticket_pie', '¡GRACIAS POR SU COMPRA!', 'Gracias | Vuelva pronto'], ['imprimir_al_cobrar', false, true]]);
  const ok = await h.confirm(card); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.type, CONFIG_CARD); assert.deepEqual(ok.body.proposal.resultado.aplicado, ['negocio_ruc', 'ticket_pie', 'imprimir_al_cobrar']);
  assert.equal(setting(h.db, 'pos.business').ruc, '20123456789'); assert.equal(setting(h.db, 'pos.business').direccion, 'Puerto Súngaro, Huánuco');
  assert.equal(setting(h.db, 'pos.ticket').pie, 'Gracias | Vuelva pronto'); assert.equal(setting(h.db, 'pos.ticket').showNum, true);
  assert.equal(setting(h.db, 'pos.flags').printAuto, true); assert.equal(setting(h.db, 'pos.flags').stockMin, 5);
  for (const k of ['pos.business', 'pos.ticket', 'pos.flags']) { assert.equal(h.db.rows.get(k).revision, 4, k); assert.equal(h.db.rows.get(k).updated_by, OWNER.principalId); }
  const logged = h.audit.filter((a) => a.tool === 'asistente.config');
  assert.deepEqual(logged.map((a) => a.outcome), ['config:negocio_ruc', 'config:ticket_pie', 'config:imprimir_al_cobrar']);
  assert.ok(logged.every((a) => a.device_id === OWNER.principalId && a.role === 'owner' && a.operation_id === ok.body.operation_id));
  assert.ok(!JSON.stringify(h.audit).includes('20123456789'), 'la bitácora no guarda valores');
  assert.ok(h.audit.some((a) => a.outcome === 'confirmed' && a.tool === CONFIG_TOOL));
  // doble toque: no repite nada
  const again = await h.confirm(card); assert.equal(again.status, 200); assert.equal(h.db.rows.get('pos.flags').revision, 4);
  assert.equal(h.audit.filter((a) => a.tool === 'asistente.config').length, 3);
});

test('tarjeta cambiada en el celular o clave/valor metidos a mano: no se aplica', async () => {
  const h = harness({ args: { cambios: [{ clave: 'avisos', valor: false }] } });
  const card = (await h.chat()).body.proposals[0];
  const forged = { ...card, ajustes: [{ ...card.ajustes[0], clave: 'clave_nueva' }] };
  assert.equal((await h.confirm(forged)).status, 409);
  assert.equal(setting(h.db, 'pos.flags').alertsEnabled, true); assert.equal(h.db.writes.length, 0);
});

test('otro aparato guardó en medio: revision_conflict, sin pisar lo del otro', async () => {
  const h = harness({ args: { cambios: [{ clave: 'stock_minimo', valor: 8 }] } });
  const card = (await h.chat()).body.proposals[0];
  h.db.rows.get('pos.flags').revision = 9; // otro aparato guardó
  const conflict = { ...h.db };
  const orig = h.db.prepare.bind(h.db); let first = true;
  h.deps.db = { ...conflict, prepare: (sql) => { const st = orig(sql); if (/^SELECT value_json,revision/.test(sql) && first) { first = false; return { bind: (...a) => ({ ...st.bind(...a), first: async () => ({ ...h.db.rows.get(a[0]), revision: 3 }) }) }; } return st; } };
  const r = await h.confirm(card); assert.equal(r.status, 409); assert.equal(r.body.error, 'revision_conflict');
  assert.equal(setting(h.db, 'pos.flags').stockMin, 5);
});

test('permiso: mismo «cambios» de pos-assistant-levels.js (Admin y nivel 3 + costos y cambios); nadie más', () => {
  assert.equal(toolAllowed('owner', CONFIG_TOOL), true);
  assert.equal(toolAllowed(COSTS_ROLE, CONFIG_TOOL), true); assert.ok(COSTS_CAPABILITIES.herramientas.includes(CONFIG_TOOL)); assert.equal(levelCan(COSTS_ROLE, 'cambios'), true);
  for (const caps of LEVEL_CAPABILITIES) assert.ok(!caps.herramientas.includes(CONFIG_TOOL));
  for (const role of NO_CHANGE_ROLES) {
    assert.equal(levelCan(role, 'cambios'), false, role); assert.equal(toolAllowed(role, CONFIG_TOOL), false, role);
    assert.ok(!toolsForRole(role).some((t) => t.function.name === CONFIG_TOOL), role);
    assert.equal(toProposal({ name: CONFIG_TOOL, arguments: JSON.stringify({ cambios: [{ clave: 'avisos', valor: false }] }) }, role, {}, 1).dropped, 'config_forbidden', role);
    assert.equal(employeeToolGuard(role)?.({ name: CONFIG_TOOL, arguments: '{}' }), 'config_forbidden', role);
  }
  assert.ok(toolsForRole(COSTS_ROLE).some((t) => t.function.name === CONFIG_TOOL));
  assert.equal(capabilitiesFor(COSTS_ROLE).configurar, false, 'configurar niveles de otras personas sigue solo del Admin');
  assert.equal(toolAllowed(COSTS_ROLE, 'configurar_nivel'), false);
});

test('niveles 0, 1, 2, 3 sin permiso y roles desconocidos: 403 en chat y en confirm, sin leer la base ni segunda llamada', async () => {
  const owner = harness({ args: { cambios: [{ clave: 'avisos', valor: false }] } });
  const card = (await owner.chat()).body.proposals[0];
  for (const role of NO_CHANGE_ROLES) {
    const db = memDb(SEED());
    const h = harness({ role, auth: EMP, db, args: { cambios: [{ clave: 'avisos', valor: false }] } });
    const r = await h.chat(); assert.equal(r.status, 403, role + ' ' + r.raw);
    assert.ok(h.cap.length <= 1, role + ': sin segunda llamada'); assert.equal(db.reads.length, 0, role + ': sin leer la base');
    // confirm con una tarjeta firmada (del Admin o propia de antes): 403 antes de leer el cuerpo o la base
    const c = await h.confirm(card); assert.equal(c.status, 403, role); assert.equal(db.reads.length, 0, role); assert.equal(db.writes.length, 0, role);
    assert.equal(setting(db, 'pos.flags').alertsEnabled, true);
  }
});

test('empleado nivel 3 con «costos y cambios»: recibe la tarjeta y la aplica con un toque; la bitácora anota SU aparato', async () => {
  const h = harness({ role: COSTS_ROLE, auth: EMP, args: { cambios: [{ clave: 'aviso_stock_bajo', valor: false }, { clave: 'ticket_ancho', valor: '58mm' }] } });
  const r = await h.chat(); assert.equal(r.status, 200, r.raw);
  const card = r.body.proposals.find((p) => p.type === CONFIG_CARD); assert.ok(card?.confirm_token, r.raw);
  const ok = await h.confirm(card); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.role, COSTS_ROLE);
  assert.equal(setting(h.db, 'pos.flags').stockAlertActive, false); assert.equal(setting(h.db, 'pos.ticket').ancho, '58mm');
  assert.equal(h.db.rows.get('pos.ticket').updated_by, EMP.principalId);
  const logged = h.audit.filter((a) => a.tool === 'asistente.config');
  assert.equal(logged.length, 2); assert.ok(logged.every((a) => a.device_id === EMP.principalId && a.role === COSTS_ROLE));
  // la tarjeta del empleado no la aplica otro aparato (ni el Admin desde su teléfono)
  const h2 = harness({ role: COSTS_ROLE, auth: EMP, args: { cambios: [{ clave: 'avisos', valor: false }] } });
  const c2 = (await h2.chat()).body.proposals[0];
  const other = await h2.confirm(c2, OWNER); assert.equal(other.status, 403); assert.equal(other.body.error, 'other_device');
});

test('empleado que pierde el permiso antes de tocar «Aplicar»: 403, nada se guarda', async () => {
  const h = harness({ role: COSTS_ROLE, auth: EMP, args: { cambios: [{ clave: 'avisos', valor: false }] } });
  const card = (await h.chat()).body.proposals[0];
  h.deps.resolveRole = async () => 'empleado:completo'; h.db.reads.length = 0;
  const r = await h.confirm(card); assert.equal(r.status, 403); assert.equal(r.body.error, 'forbidden_role');
  assert.equal(h.db.reads.length, 0); assert.equal(setting(h.db, 'pos.flags').alertsEnabled, true);
});

test('borrar todo / reiniciar: esta herramienta no lo hace', async () => {
  for (const args of [{ cambios: [{ clave: 'borrar_todo', valor: true }] }, { cambios: [{ clave: 'reiniciar', valor: 'todo' }] }, { cambios: [{ clave: 'reset', valor: true }] },
    { accion: 'borrar_todo' }, { cambios: [] }, { cambios: 'borrar todo' }]) {
    assert.equal(configToolProposal(args, 'x').dropped, 'config_invalid', JSON.stringify(args));
    const h = harness({ args }); const r = await h.chat('Borra todo y reinicia el sistema');
    assert.equal(r.status, 200); assert.equal(r.body.proposals.length, 0); assert.equal(h.db.writes.length, 0);
  }
  // un valor de texto no puede «vaciar» la configuración: el pie vacío o un valor tapado no pasan
  assert.equal(configToolProposal({ cambios: [{ clave: 'ticket_pie', valor: '' }] }, 'x').dropped, 'config_invalid');
  assert.equal(configToolProposal({ cambios: [{ clave: 'negocio_nombre', valor: 'Tel. ****5678' }] }, 'x').dropped, 'config_invalid');
});

test('Admin: payload_bytes de la primera llamada con la herramienta nueva sigue bajo 16000', async () => {
  const h = harness({ args: { cambios: [{ clave: 'avisos', valor: false }] } });
  const r = await h.chat(); const [b1] = r.body.payload_bytes; assert.ok(b1 > 0 && b1 < 16000, 'bytes ' + b1);
  assert.ok(h.cap[0].tools.some((t) => t.function.name === CONFIG_TOOL));
});
