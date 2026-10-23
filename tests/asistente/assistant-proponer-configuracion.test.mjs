// Datos del negocio y del ticket (#967) dentro de configurar_app (#972): misma herramienta, misma tarjeta «configuracion» con destino:'servidor',
// un ajuste por tarjeta, antes → valor, un toque en «Confirmar» sin PIN, el servidor guarda en pos_settings (revisión condicional, 409
// revision_conflict, nunca inserta) y anota la bitácora con el aparato que aplicó.
// Permiso: negocio/ticket = «cambios» de pos-assistant-levels.js (Admin y nivel 3 + «costos y cambios»); claves de #972 = solo Admin.
// El resto: 403 sin leer la base.
// Datos inventados; el modelo siempre simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeepSeekRequest, sanitizeContext, assistantChatRoute, assistantConfirmRoute, createMemoryUsageStore, toolsForRole, toProposal, employeeToolGuard, toolAllowed } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { CONFIG_CARD, CONFIG_DEST, CONFIG_KEYS, CONFIG_KEY_NAMES, serverSettingProposal } from '../../tools/cloudflare-lab/src/pos-assistant-config-route.js';
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
  avisos: [false, null]
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

const TOOL = 'configurar_app';
const ADMIN_ONLY = ['modo', 'tema', 'tamano', 'lector_sonido', 'stock_minimo', 'stock_avisos', 'impresion_automatica'];
const call = (args) => ({ id: 'call_1', type: 'function', function: { name: TOOL, arguments: JSON.stringify(args) } });
function harness({ role = 'owner', auth = OWNER, db = memDb(SEED()), store = createMemoryUsageStore(), args } = {}) {
  const cap = [], audit = [];
  const f = async (_u, init) => { cap.push(JSON.parse(String(init.body))); const n = cap.length;
    return json({ choices: [{ message: n === 1 ? { content: '', tool_calls: [call(args)] } : { content: 'Listo.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); };
  const deps = { store, db, resolveRole: async () => role, fetch: f, audit: async (_d, r) => { audit.push(...r); return r.length; }, readBusinessName: async () => 'Negocio', mockChunkMs: 0, now: () => NOW };
  const chat = async (text = 'Cambia la configuración del ticket') => { const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text }) }), ENV, auth, json, deps);
    const raw = await r.text(); let body = null; try { body = JSON.parse(raw); } catch { body = null; } return { status: r.status, body, raw }; };
  const confirm = async (p, a = auth, manual) => { const { confirm_token, ...proposal } = p;
    const r = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token: confirm_token, proposal, ...(manual !== undefined ? { manual } : {}) }) }), ENV, a, json, deps);
    return { status: r.status, body: await r.json() }; };
  return { chat, confirm, cap, audit, db, deps };
}
const cardOf = (r) => (r.body?.proposals || []).find((p) => p.type === CONFIG_CARD);

test('lista cerrada: 9 claves de negocio y ticket (más avisos) dentro de configurar_app; sin las de #972; nada de borrar ni reiniciar', () => {
  assert.deepEqual(CONFIG_KEY_NAMES, Object.keys(SAMPLES));
  for (const k of CONFIG_KEY_NAMES) assert.ok(['pos.business', 'pos.ticket', 'pos.flags'].includes(CONFIG_KEYS[k].setting), k);
  for (const k of ['imprimir_al_cobrar', 'aviso_stock_bajo', 'stock_minimo', ...ADMIN_ONLY]) assert.ok(!CONFIG_KEY_NAMES.includes(k), k);
  const owner = toolsForRole('owner').filter((t) => t.function.name === TOOL); assert.equal(owner.length, 1, 'una sola herramienta');
  const en = owner[0].function.parameters.properties.ajuste.enum; for (const k of [...CONFIG_KEY_NAMES, 'modo', 'stock_minimo']) assert.ok(en.includes(k), k);
  assert.ok(!toolsForRole('owner').some((t) => t.function.name === 'proponer_configuracion'));
  assert.ok(!CONFIG_KEY_NAMES.some((k) => /borra|reinic|reset|todo|elimin/i.test(k)));
});

for (const [clave, [ok, bad]] of Object.entries(SAMPLES)) {
  test('clave ' + clave + ': valor válido -> tarjeta configuracion destino servidor antes → valor; inválido -> sin tarjeta', async () => {
    const h = harness({ args: { ajuste: clave, valor: ok } });
    const r = await h.chat(); assert.equal(r.status, 200, r.raw);
    const card = cardOf(r); assert.ok(card && card.confirm_token, r.raw);
    const spec = CONFIG_KEYS[clave], antes = setting(h.db, spec.setting)[spec.field] ?? spec.def;
    assert.equal(card.ajuste, clave); assert.equal(card.destino, CONFIG_DEST); assert.equal(card.alcance, 'todos los aparatos');
    assert.deepEqual(card.antes, antes); assert.deepEqual(card.valor, ok); assert.equal(card.nombre, spec.label);
    assert.equal(card.needsConfirm, true); assert.ok(!card.requiresRole, 'la puede aplicar quien tenga el permiso «cambios»');
    assert.ok(!('_pending' in card));
    assert.equal(h.db.writes.length, 0, 'proponer no escribe nada');
    const ap = await h.confirm(card); assert.equal(ap.status, 200, JSON.stringify(ap.body));
    assert.deepEqual(setting(h.db, spec.setting)[spec.field], ok); assert.equal(h.db.rows.get(spec.setting).revision, 4);
    assert.deepEqual(h.audit.filter((a) => a.tool === 'asistente.config').map((a) => a.outcome), ['config:' + clave]);
    assert.equal(serverSettingProposal({ ajuste: clave, valor: bad }, 'x').dropped, 'bad_setting', clave + ' ' + JSON.stringify(bad));
    const h2 = harness({ args: { ajuste: clave, valor: bad } }); const r2 = await h2.chat();
    assert.equal(r2.status, 200); assert.equal(r2.body.proposals.length, 0); assert.equal(h2.db.writes.length, 0);
  });
}

test('claves desconocidas se rechazan', () => {
  for (const clave of ['negocio_telefono', 'metodo_pago_yape', 'pos.business', 'clave_nueva', 'igvActive', '__proto__', 'constructor', 'imprimir_al_cobrar', 'aviso_stock_bajo'])
    assert.ok(toProposal({ name: TOOL, arguments: JSON.stringify({ ajuste: clave, valor: true }) }, 'owner', { products: [] }, 1).dropped, clave);
});

test('nunca crea filas nuevas: sin la fila la tarjeta se descarta; un valor igual al actual no hace tarjeta', async () => {
  const h = harness({ db: memDb({}), args: { ajuste: 'ticket_pie', valor: 'Hola' } });
  const r = await h.chat(); assert.equal(r.body.proposals.length, 0); assert.equal(h.db.rows.size, 0); assert.equal(h.db.writes.length, 0);
  assert.ok(h.audit.some((a) => a.outcome === 'dropped:config_sin_datos'));
  const h2 = harness({ args: { ajuste: 'ticket_ancho', valor: '80mm' } });
  assert.equal((await h2.chat()).body.proposals.length, 0);
});

test('Admin: «Confirmar» sin PIN guarda solo ese campo (revisión +1, resto intacto), bitácora sin valores; doble toque no repite', async () => {
  const h = harness({ args: { ajuste: 'negocio_ruc', valor: '20123456789' } });
  const card = cardOf(await h.chat());
  const ok = await h.confirm(card); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.type, CONFIG_CARD); assert.deepEqual(ok.body.proposal.resultado.aplicado, ['negocio_ruc']);
  assert.equal(setting(h.db, 'pos.business').ruc, '20123456789'); assert.equal(setting(h.db, 'pos.business').direccion, 'Puerto Súngaro, Huánuco');
  assert.equal(h.db.rows.get('pos.business').revision, 4); assert.equal(h.db.rows.get('pos.business').updated_by, OWNER.principalId);
  assert.equal(h.db.rows.get('pos.ticket').revision, 3);
  const logged = h.audit.filter((a) => a.tool === 'asistente.config');
  assert.equal(logged.length, 1); assert.ok(logged[0].device_id === OWNER.principalId && logged[0].role === 'owner' && logged[0].operation_id === ok.body.operation_id);
  assert.ok(!JSON.stringify(h.audit).includes('20123456789'), 'la bitácora no guarda valores');
  const again = await h.confirm(card); assert.equal(again.status, 200); assert.equal(h.db.rows.get('pos.business').revision, 4);
  assert.equal(h.audit.filter((a) => a.tool === 'asistente.config').length, 1);
});

test('tarjeta cambiada en el celular (clave, valor o destino): no se aplica', async () => {
  const h = harness({ args: { ajuste: 'avisos', valor: false } });
  const card = cardOf(await h.chat());
  for (const forged of [{ ...card, ajuste: 'negocio_nombre' }, { ...card, valor: true }, { ...card, destino: undefined }]) assert.equal((await h.confirm(forged)).status, 409);
  assert.equal(setting(h.db, 'pos.flags').alertsEnabled, true); assert.equal(h.db.writes.length, 0);
});

test('otro aparato guardó en medio: revision_conflict, sin pisar lo del otro (también si cambió el valor)', async () => {
  const h = harness({ args: { ajuste: 'ticket_pie', valor: 'Vuelva pronto' } });
  const card = cardOf(await h.chat());
  h.db.rows.get('pos.ticket').revision = 9; // otro aparato guardó (mismo valor, revisión nueva)
  const orig = h.db.prepare.bind(h.db); let first = true;
  h.deps.db = { ...h.db, prepare: (sql) => { const st = orig(sql); if (/^SELECT value_json,revision/.test(sql) && first) { first = false; return { bind: (...a) => ({ ...st.bind(...a), first: async () => ({ ...h.db.rows.get(a[0]), revision: 3 }) }) }; } return st; } };
  const r = await h.confirm(card); assert.equal(r.status, 409); assert.equal(r.body.error, 'revision_conflict');
  assert.equal(setting(h.db, 'pos.ticket').pie, '¡GRACIAS POR SU COMPRA!');
  const h2 = harness({ args: { ajuste: 'ticket_pie', valor: 'Vuelva pronto' } });
  const c2 = cardOf(await h2.chat());
  h2.db.rows.set('pos.ticket', { ...h2.db.rows.get('pos.ticket'), value_json: JSON.stringify({ ...setting(h2.db, 'pos.ticket'), pie: 'Otro pie' }), revision: 4 });
  const r2 = await h2.confirm(c2); assert.equal(r2.status, 409); assert.equal(r2.body.error, 'revision_conflict'); assert.equal(setting(h2.db, 'pos.ticket').pie, 'Otro pie');
});

test('permiso: Admin todo; nivel 3 + «cambios» solo negocio y ticket; nadie más', () => {
  assert.equal(toolAllowed('owner', TOOL), true);
  assert.equal(toolAllowed(COSTS_ROLE, TOOL), true); assert.ok(COSTS_CAPABILITIES.herramientas.includes(TOOL)); assert.equal(levelCan(COSTS_ROLE, 'cambios'), true);
  assert.ok(!COSTS_CAPABILITIES.herramientas.includes('proponer_configuracion'));
  const l3c = toolsForRole(COSTS_ROLE).find((t) => t.function.name === TOOL); assert.deepEqual([...l3c.function.parameters.properties.ajuste.enum], CONFIG_KEY_NAMES.filter((k) => k !== 'avisos'), 'avisos: solo el Admin (auditoría 500)');
  assert.equal(toProposal({ name: TOOL, arguments: JSON.stringify({ ajuste: 'avisos', valor: false }) }, COSTS_ROLE, { products: [] }, 1).dropped, 'config_admin_only');
  for (const k of ADMIN_ONLY) assert.equal(toProposal({ name: TOOL, arguments: JSON.stringify({ ajuste: k, valor: 1 }) }, COSTS_ROLE, { products: [] }, 1).dropped, 'forbidden_role', k);
  assert.equal(employeeToolGuard(COSTS_ROLE)?.({ name: TOOL, arguments: JSON.stringify({ ajuste: 'modo', valor: 'noche' }) }), 'forbidden_role');
  assert.ok(!employeeToolGuard(COSTS_ROLE)?.({ name: TOOL, arguments: JSON.stringify({ ajuste: 'ticket_pie', valor: 'x' }) }));
  for (const caps of LEVEL_CAPABILITIES) assert.ok(!caps.herramientas.includes(TOOL));
  for (const role of NO_CHANGE_ROLES) {
    assert.equal(levelCan(role, 'cambios'), false, role); assert.equal(toolAllowed(role, TOOL), false, role);
    assert.ok(!toolsForRole(role).some((t) => t.function.name === TOOL), role);
    assert.equal(toProposal({ name: TOOL, arguments: JSON.stringify({ ajuste: 'ticket_pie', valor: 'x' }) }, role, { products: [] }, 1).dropped, 'config_forbidden', role);
    assert.equal(employeeToolGuard(role)?.({ name: TOOL, arguments: JSON.stringify({ ajuste: 'avisos', valor: false }) }), 'config_forbidden', role);
  }
  assert.equal(capabilitiesFor(COSTS_ROLE).configurar, false, 'configurar niveles de otras personas sigue solo del Admin');
});

test('niveles 1, 2, 3 sin permiso y roles desconocidos: 403 en chat y en confirm, sin leer la base ni segunda llamada', async () => {
  const owner = harness({ args: { ajuste: 'avisos', valor: false } });
  const card = cardOf(await owner.chat());
  for (const role of NO_CHANGE_ROLES) {
    const db = memDb(SEED());
    const h = harness({ role, auth: EMP, db, args: { ajuste: 'avisos', valor: false } });
    const r = await h.chat(); assert.equal(r.status, 403, role + ' ' + r.raw);
    assert.ok(h.cap.length <= 1, role + ': sin segunda llamada'); assert.equal(db.reads.length, 0, role + ': sin leer la base');
    const c = await h.confirm(card); assert.equal(c.status, 403, role); assert.equal(db.reads.length, 0, role); assert.equal(db.writes.length, 0, role);
    assert.equal(setting(db, 'pos.flags').alertsEnabled, true);
  }
});

test('nivel 3 + «costos y cambios»: aplica negocio/ticket con un toque y la bitácora anota SU aparato; ajustes de #972 rechazados', async () => {
  const h = harness({ role: COSTS_ROLE, auth: EMP, args: { ajuste: 'ticket_ancho', valor: '58mm' } });
  const r = await h.chat(); assert.equal(r.status, 200, r.raw);
  const card = cardOf(r); assert.ok(card?.confirm_token, r.raw); assert.equal(card.destino, CONFIG_DEST);
  const ok = await h.confirm(card); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.role, COSTS_ROLE);
  assert.equal(setting(h.db, 'pos.ticket').ancho, '58mm'); assert.equal(h.db.rows.get('pos.ticket').updated_by, EMP.principalId);
  const logged = h.audit.filter((a) => a.tool === 'asistente.config');
  assert.equal(logged.length, 1); assert.ok(logged[0].device_id === EMP.principalId && logged[0].role === COSTS_ROLE);
  // la tarjeta del empleado no la aplica otro aparato
  const h2 = harness({ role: COSTS_ROLE, auth: EMP, args: { ajuste: 'ticket_pie', valor: 'Pie nuevo' } });
  const c2 = cardOf(await h2.chat('Cambia el pie del ticket'));
  const other = await h2.confirm(c2, OWNER); assert.equal(other.status, 403); assert.equal(other.body.error, 'other_device');
  // claves de #972 (solo Admin): sin tarjeta y sin leer la base
  for (const [ajuste, valor] of [['modo', 'noche'], ['stock_minimo', 8], ['stock_avisos', false], ['impresion_automatica', true]]) {
    const db = memDb(SEED()); const h3 = harness({ role: COSTS_ROLE, auth: EMP, db, args: { ajuste, valor } });
    const r3 = await h3.chat('Cambia la configuración'); assert.ok(!cardOf(r3), ajuste + ' ' + r3.raw); assert.equal(db.writes.length, 0);
  }
  // una tarjeta del aparato (#972, firmada para el Admin) no la confirma el nivel 3
  const ho = harness({ args: { ajuste: 'modo', valor: 'noche' } });
  const ro = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: 'modo noche', context: { settings: { modo: 'claro' } } }) }), ENV, OWNER, json, ho.deps);
  const dev = (JSON.parse(await ro.text()).proposals || []).find((p) => p.type === CONFIG_CARD);
  assert.ok(dev && !dev.destino, 'tarjeta del aparato'); ho.deps.resolveRole = async () => COSTS_ROLE; const x = await ho.confirm(dev, OWNER); assert.equal(x.status, 403);
});

test('empleado que pierde el permiso antes de «Confirmar»: 403, nada se guarda', async () => {
  const h = harness({ role: COSTS_ROLE, auth: EMP, args: { ajuste: 'ticket_pie', valor: 'Pie nuevo' } });
  const card = cardOf(await h.chat('Cambia el pie del ticket')); assert.ok(card?.confirm_token);
  h.deps.resolveRole = async () => 'empleado:completo'; h.db.reads.length = 0;
  const r = await h.confirm(card); assert.equal(r.status, 403); assert.equal(r.body.error, 'forbidden_role');
  assert.equal(h.db.reads.length, 0); assert.notEqual(setting(h.db, 'pos.ticket').pie, 'Pie nuevo');
});

test('borrar todo / reiniciar: configurar_app no lo hace', async () => {
  for (const args of [{ ajuste: 'borrar_todo', valor: true }, { ajuste: 'reiniciar', valor: 'todo' }, { ajuste: 'reset', valor: true }, { accion: 'borrar_todo' }, {}]) {
    const h = harness({ args }); const r = await h.chat('Borra todo y reinicia el sistema');
    assert.equal(r.status, 200); assert.equal(r.body.proposals.length, 0); assert.equal(h.db.writes.length, 0);
  }
  assert.equal(serverSettingProposal({ ajuste: 'ticket_pie', valor: '' }, 'x').dropped, 'bad_setting');
  assert.equal(serverSettingProposal({ ajuste: 'negocio_nombre', valor: 'Tel. ****5678' }, 'x').dropped, 'bad_setting');
});

test('contexto: el catálogo de negocio/ticket va solo en pedidos de configuración y nunca con los valores actuales', () => {
  for (const role of ['owner', COSTS_ROLE]) {
    const ctx = sanitizeContext({ products: [] }, role);
    for (const text of ['¿Cuánto vendí hoy?', 'Stock de arroz', 'Hola']) {
      const r = buildDeepSeekRequest({ role, ctx, history: [], text }); const p = JSON.stringify(r.messages);
      assert.doesNotMatch(p, /negocio_ruc|ticket_pie|configuracion_app/, role + ' ' + text);
      assert.ok(!r.tools.some((t) => t.function.name === TOOL), role + ' ' + text);
    }
    const r = buildDeepSeekRequest({ role, ctx, history: [], text: 'Cambia el pie del ticket' }); const p = JSON.stringify(r.messages);
    assert.match(p, /ticket_pie/); assert.ok(r.tools.some((t) => t.function.name === TOOL));
    assert.doesNotMatch(p, /GRACIAS POR SU COMPRA|Puerto Súngaro/);
    if (role !== 'owner') assert.doesNotMatch(p, /"clave":"(?:modo|tema|stock_minimo)"|"modo":\{/, 'el nivel 3 no ve el catálogo del Admin');
  }
  for (const role of NO_CHANGE_ROLES) {
    const r = buildDeepSeekRequest({ role, ctx: sanitizeContext({ products: [] }, role), history: [], text: 'Cambia el pie del ticket' });
    assert.doesNotMatch(JSON.stringify(r.messages), /ticket_pie|configuracion_app/, role); assert.ok(!(r.tools || []).some((t) => t.function.name === TOOL), role);
  }
});

test('Admin: payload_bytes de la primera llamada bajo 17000 sin el catálogo; el catálogo de negocio/ticket solo suma en pedidos de configuración', async () => {
  const h = harness({ args: { ajuste: 'avisos', valor: false } });
  const r = await h.chat('¿Cuánto vendí hoy?'); const [b1] = r.body.payload_bytes; assert.ok(b1 > 0 && b1 < 17000, 'bytes ' + b1);
  assert.ok(!h.cap[0].tools.some((t) => t.function.name === TOOL)); assert.doesNotMatch(JSON.stringify(h.cap[0].messages), /ticket_pie/);
  // pedido de configuración: el catálogo de #972 ya pasaba de 17000 en la base; negocio y ticket suman ~1,2 KB, sin valores.
  const h2 = harness({ args: { ajuste: 'avisos', valor: false } });
  const r2 = await h2.chat(); const [b2] = r2.body.payload_bytes; assert.ok(b2 > b1 && b2 < 21000, 'bytes ' + b2);
  assert.ok(h2.cap[0].tools.some((t) => t.function.name === TOOL));
});

// RUC (decisión de alfa): el filtro de DNI/RUC no se afloja. RUC tapado o vacío → tarjeta con valor vacío y completar:['valor'] (mismo
// mecanismo que la compra); el celular manda manual:{valor} fuera de la propuesta firmada y el servidor lo valida (RUC Perú).
const RUC = '10456789012';
const MASKED_RUC = ['10*******12', '', '[RUC oculto]', 'XXXXXXXXXXX', '10•••••••12'];

test('RUC tapado o vacío: tarjeta configuracion con destino servidor, valor vacío y completar:[\'valor\'] (Admin y nivel 3 + cambios)', async () => {
  for (const valor of MASKED_RUC) {
    const p = serverSettingProposal({ ajuste: 'negocio_ruc', valor }, 'p1');
    assert.equal(p.type, CONFIG_CARD, valor); assert.equal(p.destino, CONFIG_DEST); assert.equal(p.valor, ''); assert.deepEqual(p.completar, ['valor']);
  }
  assert.equal(serverSettingProposal({ ajuste: 'negocio_ruc', valor: '123' }, 'p1').dropped, 'bad_setting', 'un RUC mal escrito (no tapado) se sigue descartando');
  assert.equal(serverSettingProposal({ ajuste: 'negocio_nombre', valor: '' }, 'p1').dropped, 'bad_setting', 'solo el RUC se completa a mano');
  for (const [role, auth] of [['owner', OWNER], [COSTS_ROLE, EMP]]) {
    const h = harness({ role, auth, args: { ajuste: 'negocio_ruc', valor: '10*******12' } });
    const r = await h.chat('Pon el RUC del negocio ' + RUC); assert.equal(r.status, 200, r.raw);
    const card = cardOf(r); assert.ok(card?.confirm_token, r.raw);
    assert.equal(card.ajuste, 'negocio_ruc'); assert.equal(card.destino, CONFIG_DEST); assert.equal(card.valor, ''); assert.equal(card.antes, '');
    assert.deepEqual(card.completar, ['valor']); assert.ok(!r.raw.includes(RUC) && !r.raw.includes('45678901'), 'el RUC no vuelve en la tarjeta');
    assert.equal(h.db.writes.length, 0);
  }
});

test('RUC: confirm con manual:{valor} válido aplica (normaliza espacios), revisión +1, una fila de bitácora sin el número; doble toque no repite', async () => {
  for (const [role, auth] of [['owner', OWNER], [COSTS_ROLE, EMP]]) {
    const h = harness({ role, auth, args: { ajuste: 'negocio_ruc', valor: '' } });
    const card = cardOf(await h.chat('Cambia el RUC'));
    const need = await h.confirm(card, auth); assert.equal(need.status, 422); assert.equal(need.body.error, 'fields_required'); assert.deepEqual(need.body.fields, ['valor']);
    const tapado = await h.confirm(card, auth, { valor: '10****9012' }); assert.equal(tapado.status, 422); assert.deepEqual(tapado.body.fields, ['valor']);
    assert.equal(h.db.writes.length, 0);
    const ok = await h.confirm(card, auth, { valor: '10 4567 8901-2' }); assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(setting(h.db, 'pos.business').ruc, RUC); assert.equal(h.db.rows.get('pos.business').revision, 4);
    assert.equal(h.db.rows.get('pos.business').updated_by, auth.principalId); assert.equal(setting(h.db, 'pos.business').nombre, 'Multiservicios Nuevo Amanecer');
    assert.equal(ok.body.proposal.valor, RUC); assert.deepEqual(ok.body.proposal.resultado.aplicado, ['negocio_ruc']);
    const logged = h.audit.filter((a) => a.tool === 'asistente.config'); assert.equal(logged.length, 1); assert.equal(logged[0].role, role);
    assert.ok(!JSON.stringify(h.audit).includes(RUC), 'la bitácora no guarda el RUC');
    assert.ok(!JSON.stringify(h.cap).includes(RUC), 'nada del RUC llega al modelo');
    const again = await h.confirm(card, auth, { valor: '10 4567 8901-2' }); assert.equal(again.status, 200, JSON.stringify(again.body)); assert.equal(again.body.replay, true); assert.equal(h.db.rows.get('pos.business').revision, 4);
    assert.equal(h.audit.filter((a) => a.tool === 'asistente.config').length, 1);
  }
});

test('RUC inválido: 400 «El RUC debe tener 11 dígitos.» (o prefijo fuera de 10/15/16/17/20) sin escribir; la tarjeta sigue sirviendo', async () => {
  const h = harness({ args: { ajuste: 'negocio_ruc', valor: '' } });
  const card = cardOf(await h.chat('Cambia el RUC'));
  for (const valor of ['123', '30123456789', '201234567890', '2012345678a', 'veinte']) {
    const r = await h.confirm(card, OWNER, { valor }); assert.equal(r.status, 400, valor + ' ' + JSON.stringify(r.body)); assert.equal(r.body.error, 'config_invalid');
    assert.deepEqual(r.body.fields, ['valor']);
    assert.equal(r.body.message, valor === '30123456789' ? 'El RUC debe empezar con 10, 15, 16, 17 o 20.' : 'El RUC debe tener 11 dígitos.', valor);
    assert.ok(!JSON.stringify(r.body).includes(valor), 'la respuesta no repite lo escrito');
  }
  for (const valor of [12345678901, null, ['20123456789']]) { const r = await h.confirm(card, OWNER, { valor }); assert.equal(r.status, 422, String(valor)); }
  assert.equal(h.db.writes.length, 0); assert.equal(h.db.rows.get('pos.business').revision, 3); assert.equal(h.audit.filter((a) => a.tool === 'asistente.config').length, 0);
  // otro aparato cambió el RUC desde la tarjeta: 409 revision_conflict, sin pisar
  h.db.rows.set('pos.business', { value_json: JSON.stringify({ ...SEED()['pos.business'], ruc: '20111111111' }), revision: 4, updated_by: 'otro' });
  const c = await h.confirm(card, OWNER, { valor: '20123456789' }); assert.equal(c.status, 409); assert.equal(c.body.error, 'revision_conflict');
  assert.equal(setting(h.db, 'pos.business').ruc, '20111111111');
});

test('RUC: manual solo para el campo declarado en ESA tarjeta; la firma no cambia (completar y valor firmados)', async () => {
  const h = harness({ args: { ajuste: 'negocio_ruc', valor: '' } });
  const card = cardOf(await h.chat('Cambia el RUC'));
  for (const manual of [{ valor: RUC, antes: '' }, { ajuste: 'negocio_nombre' }, { ruc: RUC }, { proveedor: 'X' }, [RUC], 'x']) {
    const r = await h.confirm(card, OWNER, manual); assert.equal(r.status, 400, JSON.stringify(manual)); assert.equal(r.body.error, 'manual_not_allowed');
  }
  // sin «completar» firmado (quitado o cambiado en el celular): la firma ya no cuadra
  const { completar, ...sin } = card; assert.equal((await h.confirm(sin, OWNER, { valor: RUC })).status, 409);
  assert.equal((await h.confirm({ ...card, completar: ['valor', 'antes'] }, OWNER, { valor: RUC })).status, 409);
  assert.equal((await h.confirm({ ...card, valor: RUC }, OWNER)).status, 409);
  // otra tarjeta de Configuración (sin completar): manual rechazado
  const h2 = harness({ args: { ajuste: 'ticket_ancho', valor: '58mm' } });
  const c2 = cardOf(await h2.chat()); const r2 = await h2.confirm(c2, OWNER, { valor: '80mm' });
  assert.equal(r2.status, 400); assert.equal(r2.body.error, 'manual_not_allowed'); assert.equal(h2.db.writes.length, 0);
  assert.equal(h.db.writes.length, 0);
});

test('RUC: sin permiso → 403 sin leer la base, también con manual', async () => {
  const h = harness({ role: COSTS_ROLE, auth: EMP, args: { ajuste: 'negocio_ruc', valor: '' } });
  const card = cardOf(await h.chat('Cambia el RUC')); const before = h.db.reads.length;
  h.deps.resolveRole = async () => 'empleado:' + LEVEL_NAMES[2];
  const r = await h.confirm(card, EMP, { valor: RUC }); assert.equal(r.status, 403); assert.equal(h.db.reads.length, before); assert.equal(h.db.writes.length, 0);
});

test('RUC: nada del número llega al modelo (texto del dueño y del nivel 3, ni en la segunda llamada)', async () => {
  for (const [role, auth] of [['owner', OWNER], [COSTS_ROLE, EMP]]) {
    const h = harness({ role, auth, args: { ajuste: 'negocio_ruc', valor: '10*******12' } });
    const r = await h.chat('Mi RUC es ' + RUC + ', cámbialo en el ticket'); assert.equal(r.status, 200, r.raw);
    assert.ok(h.cap.length >= 1); const sent = JSON.stringify(h.cap);
    assert.ok(!sent.includes(RUC) && !sent.includes('45678901'), role + ': el RUC no va al modelo');
    await h.confirm(cardOf(r), auth, { valor: RUC });
    assert.ok(!JSON.stringify(h.cap).includes(RUC), 'el confirm no llama al modelo');
  }
});
