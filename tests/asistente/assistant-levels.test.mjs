// Niveles 1, 2 y 3 del asistente POR PERSONA (cada persona = su aparato vinculado). Lado servidor: mapa único, GET/POST del Admin
// SIN PIN, bitácora existente, valores por defecto y privacidad. Base real del laboratorio (activeCanon, node:sqlite), sin migraciones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCanon } from '../cloud-sync/canon-browser-harness.mjs';
import { LEVEL_CAPABILITIES, ADMIN_CAPABILITIES, LEVEL_NAMES, ADMIN_LEVEL, EMPLOYEE_DEFAULT_LEVEL, parseLevel, levelFromStored, levelOfRole, levelCan, capabilitiesFor, roleForLevel }
  from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';
import { LEVELS_PATH, levelsRoute } from '../../tools/cloudflare-lab/src/pos-assistant-levels-route.js';
import { toolsForRole, toolAllowed, buildDeepSeekRequest, sanitizeContext, parseChatBody, EMPLOYEE_TOOLS, EMPLOYEE_QUERY_TYPES, EMPLOYEE_DOC_TYPES, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { assistantReviewRoute, REVIEW_PATH } from '../../tools/cloudflare-lab/src/pos-assistant-review.js';
import { accessOn, accessLevel } from '../../tools/cloudflare-lab/src/pos-assistant-access.js';
import { readFileSync } from 'node:fs';

const MIG = ['0024_pos_roles_owner_pin.sql', '0025_pos_reviews_pin_failures.sql'];
async function setup(t) {
  const f = await activeCanon(t, { migrations: MIG });
  Object.assign(f.env, { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef', ASSISTANT_DEMO: '1' });
  f.addDevice('dueno', 'writer', 'active', 'tok-dueno');
  f.addDevice('emp', 'writer', 'active', 'tok-emp');
  f.addDevice('emp2', 'writer', 'active', 'tok-emp2');
  const at = new Date().toISOString();
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,label,created_by,created_at) VALUES('session:dueno','owner','Dueño','test',?)", at);
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,label,created_by,created_at) VALUES('session:emp','empleado','Caja 2','session:dueno',?)", at);
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,label,created_by,created_at) VALUES('session:emp2','empleado','Caja 3','session:dueno',?)", at);
  const call = async (tok, path, body, method = 'POST', extra = {}) => {
    const r = await f.fetch('http://localhost' + path, { method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json', ...extra }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const raw = await r.text(); let b = null; try { b = JSON.parse(raw); } catch { b = raw; }
    return { status: r.status, body: b, raw };
  };
  const setLevel = (device, nivel, tok = 'tok-dueno', extra = {}) => call(tok, LEVELS_PATH, { device_id: device, nivel, ...extra });
  const list = (tok = 'tok-dueno') => call(tok, LEVELS_PATH, null, 'GET');
  const chat = (tok, text, extra = {}) => call(tok, '/auth/assistant/chat', { text, context: { products: [{ id: '00003', nombre: 'Synthetic 00003', precio: 12.34, costo: 0.29, stock: 1 }] }, ...extra });
  const audit = async () => (await call('tok-dueno', '/auth/assistant/audit?limit=500', null, 'GET')).body;
  return { f, call, setLevel, list, chat, audit };
}

test('mapa único: cada nivel incluye al anterior; ningún nivel de empleado cambia datos, ve costos, manda fotos ni configura', () => {
  assert.deepEqual([...LEVEL_NAMES], ['off', 'consultas', 'consultas_documentos', 'completo']);
  assert.equal(EMPLOYEE_DEFAULT_LEVEL, 0); assert.equal(ADMIN_LEVEL, 3);
  assert.equal(LEVEL_CAPABILITIES[0].asistente, false); assert.deepEqual([...LEVEL_CAPABILITIES[0].herramientas], []);
  for (let n = 2; n <= 3; n++) for (const k of ['herramientas', 'consultas', 'documentos']) for (const x of LEVEL_CAPABILITIES[n - 1][k]) assert.ok(LEVEL_CAPABILITIES[n][k].includes(x), n + ' ' + k + ' ' + x);
  assert.ok(!LEVEL_CAPABILITIES[1].herramientas.includes('preparar_documento') && LEVEL_CAPABILITIES[2].herramientas.includes('preparar_documento'));
  assert.deepEqual([LEVEL_CAPABILITIES[1].revision, LEVEL_CAPABILITIES[2].revision, LEVEL_CAPABILITIES[3].revision], [false, false, true]);
  for (const c of LEVEL_CAPABILITIES) { assert.equal(c.cambios, false); assert.equal(c.costos, false); assert.equal(c.fotos, false); assert.equal(c.configurar, false); assert.ok(Object.isFrozen(c) && Object.isFrozen(c.herramientas)); }
  for (const k of ['asistente', 'revision', 'cambios', 'costos', 'fotos', 'configurar']) assert.equal(ADMIN_CAPABILITIES[k], true, k);
  // pos-assistant.js toma sus listas de aquí (un solo lugar).
  assert.equal(EMPLOYEE_TOOLS.completo, LEVEL_CAPABILITIES[3].herramientas); assert.equal(EMPLOYEE_TOOLS.consultas, LEVEL_CAPABILITIES[1].herramientas);
  assert.deepEqual([...EMPLOYEE_QUERY_TYPES], ['stock_producto', 'bajo_stock', 'deuda_cliente']); assert.deepEqual([...EMPLOYEE_DOC_TYPES], ['lista_precios', 'lista_pedido']);
});

test('roles y nombres: niveles viejos se leen igual; filas malas o desconocidas = sin permiso', () => {
  assert.deepEqual([0, 1, 2, 3, '2', 'completo', 'consultas'].map(parseLevel), [0, 1, 2, 3, 2, 3, 1]);
  for (const bad of [4, -1, 1.5, 'admin', 'owner', '', null, undefined, {}]) assert.equal(parseLevel(bad), null, String(bad));
  assert.equal(levelFromStored({ level: 'consultas' }), 1); assert.equal(levelFromStored({ level: 'consultas_documentos' }), 2);
  assert.equal(levelFromStored({ level: 'completo', nivel: 3 }), 3); assert.equal(levelFromStored({ level: 'off', nivel: 3 }), 0, 'nombre y número distintos: gana el nombre');
  assert.equal(levelFromStored({ level: 'dueno' }), 0); assert.equal(levelFromStored(null), 0);
  assert.deepEqual(['owner', 'empleado:off', 'empleado:consultas', 'empleado:consultas_documentos', 'empleado:completo', 'sin_rol', 'empleado', 'empleado:x'].map(levelOfRole), [3, 0, 1, 2, 3, 0, 0, 0]);
  assert.deepEqual(['sin_rol', 'empleado:off', 'empleado:consultas', 'empleado:completo', 'owner'].map(accessOn), [false, false, true, true, true]);
  assert.equal(roleForLevel(3), 'empleado:completo'); assert.equal(capabilitiesFor('owner'), ADMIN_CAPABILITIES);
  assert.equal(levelCan('empleado:completo', 'revision'), true); assert.equal(levelCan('empleado:consultas_documentos', 'revision'), false);
  assert.equal(accessLevel('empleado:completo'), 'consultas_documentos', 'ping compatible con la pantalla actual'); assert.equal(accessLevel('owner'), 'dueno');
});

test('herramientas por nivel: 3 igual que 2 en el chat, nunca herramientas que cambian algo', () => {
  assert.deepEqual(toolsForRole('empleado:off'), []);
  const names = (r) => toolsForRole(r).map((t) => t.function.name).sort();
  assert.deepEqual(names('empleado:consultas'), ['consultar', 'explicar_pasos']);
  assert.deepEqual(names('empleado:completo'), names('empleado:consultas_documentos'));
  for (const tool of ['proponer_cambio_precio', 'preparar_compra', 'leer_factura_compra', 'proponer_ajuste_stock', 'proponer_producto_nuevo'])
    for (const r of ['empleado:consultas', 'empleado:consultas_documentos', 'empleado:completo']) assert.equal(toolAllowed(r, tool), false, r + ' ' + tool);
  assert.ok(toolAllowed('owner', 'proponer_cambio_precio'), 'el Admin sigue con todo');
});

test('privacidad: al modelo de un empleado nivel 3 no le llegan costos, nombres de clientes, DNI ni teléfonos', () => {
  const ctx = sanitizeContext({ products: [{ id: '00003', nombre: 'Arroz', precio: 4.5, costo: 2.1, stock: 3 }], customers: [{ id: 'c1', nombre: 'Rosa Quispe', dni: '45678912', telefono: '987654321' }] }, 'empleado:completo');
  const parsed = parseChatBody({ text: 'mi DNI es 45678912 y mi celular 987654321', history: [{ role: 'user', content: 'Rosa 45678912' }] }, 'empleado:completo');
  const req = buildDeepSeekRequest({ role: 'empleado:completo', ctx, history: parsed.history, text: parsed.text });
  const s = JSON.stringify(req.messages);
  assert.ok(!s.includes('2.1') && !/costo"\s*:/.test(s), 'sin costos'); assert.ok(!s.includes('Rosa Quispe'), 'sin clientes');
  assert.ok(!s.includes('45678912') && !s.includes('987654321'), 'sin DNI ni teléfono');
});

test('por defecto: empleado sin fila = nivel 0 (apagado, como hoy); Admin = nivel 3 fijo; fila vieja «consultas» = nivel 1', async (t) => {
  const { f, list, chat, call } = await setup(t);
  const r = await list(); assert.equal(r.status, 200, r.raw);
  const by = Object.fromEntries(r.body.personas.map((p) => [p.device_id, p]));
  assert.deepEqual([by['session:dueno'].nivel, by['session:dueno'].fijo, by['session:dueno'].rol], [3, true, 'admin']);
  assert.deepEqual([by['session:emp'].nivel, by['session:emp2'].nivel], [0, 0]);
  assert.deepEqual(r.body.por_defecto, { empleado: 0, admin: 3, costos: false }); assert.equal(r.body.niveles.length, 4);
  assert.ok(!/pin|token|approval|dni|telefono/i.test(r.raw), 'nada sensible en la lista');
  assert.equal((await chat('tok-emp', 'qué falta reponer')).body.error, 'assistant_off');
  // Fila guardada por la ruta vieja (con PIN): se respeta sin migrar nada.
  const { levelKey } = await import('../../tools/cloudflare-lab/src/pos-assistant-access.js');
  f.exec('INSERT INTO pos_settings(key,value_json,revision,updated_at,updated_by) VALUES(?,?,1,?,?)', await levelKey('session:emp2'), JSON.stringify({ level: 'consultas' }), new Date().toISOString(), 'test');
  assert.equal((await list()).body.personas.find((p) => p.device_id === 'session:emp2').nivel, 1);
  assert.equal((await call('tok-emp2', '/auth/assistant/chat', { ping: true })).body.level, 'consultas');
});

test('Admin cambia el nivel con UN toque, SIN PIN ni aprobación; aplica al instante en el chat', async (t) => {
  const { setLevel, chat, call } = await setup(t);
  const a = await setLevel('session:emp', 1); assert.equal(a.status, 200, a.raw);
  assert.deepEqual([a.body.antes, a.body.nivel, a.body.nombre_nivel, a.body.logged], [0, 1, 'consultas', true]);
  const low = await chat('tok-emp', '¿Qué me falta reponer?'); assert.equal(low.status, 200, low.raw); assert.equal(low.body.proposals[0]?.type, 'consulta');
  assert.equal((await chat('tok-emp', 'imprime la lista de precios')).body.error, 'forbidden_document', 'nivel 1 sin documentos');
  assert.equal((await setLevel('session:emp', '2')).status, 200);
  const doc = await chat('tok-emp', 'imprime la lista de precios'); assert.equal(doc.status, 200); assert.ok(doc.body.proposals.some((p) => p.type === 'documento'));
  assert.equal((await setLevel('session:emp', 'completo')).body.nivel, 3);
  const ping = await call('tok-emp', '/auth/assistant/chat', { ping: true }); assert.equal(ping.status, 200); assert.equal(ping.body.level, 'consultas_documentos');
  const m = await chat('tok-emp', 'merma de 1 Synthetic 00003'); assert.ok(!m.body.proposals.some((p) => p.needsConfirm || p.confirm_token), 'nivel 3 tampoco cambia datos');
  assert.ok(!m.raw.includes('0.29'), 'sin costos');
  assert.equal((await setLevel('session:emp', 0)).status, 200);
  assert.equal((await chat('tok-emp', 'qué falta reponer')).body.error, 'assistant_off', 'quitar el permiso aplica al instante');
});

test('solo el Admin: un empleado (de cualquier nivel) recibe 403 en GET y POST, y su nivel no cambia', async (t) => {
  const { setLevel, list } = await setup(t);
  assert.equal((await setLevel('session:emp', 3)).status, 200);
  for (const [dev, n] of [['session:emp', 3], ['session:emp2', 3], ['session:dueno', 0]]) for (const tok of ['tok-emp', 'tok-emp2']) {
    const r = await setLevel(dev, n, tok); assert.equal(r.status, 403, r.raw); assert.ok(['forbidden_role', 'admin_only'].includes(r.body.error), r.raw); // la puerta del Worker corta primero
  }
  assert.equal((await list('tok-emp')).status, 403); assert.equal((await list('tok-emp2')).status, 403);
  const by = Object.fromEntries((await list()).body.personas.map((p) => [p.device_id, p.nivel]));
  assert.deepEqual([by['session:emp'], by['session:emp2']], [3, 0]);
});

test('la ruta misma (detrás de la puerta del Worker) también corta: 403 admin_only y el rechazo va a la bitácora de otros aparatos', async () => {
  const rows = [], writes = [];
  const db = { prepare: (sql) => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => { writes.push(sql); return {}; } }) }) };
  const run = (role, method = 'POST') => levelsRoute(new Request('https://w.test' + LEVELS_PATH, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ device_id: 'session:emp', nivel: 3 }) } : {}) }),
    { ASSISTANT_ENABLED: '1' }, { principalId: 'session:emp', posRole: 'empleado' }, (d, s = 200) => new Response(JSON.stringify(d), { status: s }),
    { db, resolveRole: async () => role, audit: async (_db, r) => { rows.push(...r); return r.length; } });
  for (const role of ['empleado:off', 'empleado:consultas', 'empleado:consultas_documentos', 'empleado:completo', 'sin_rol']) {
    const r = await run(role); assert.equal(r.status, 403, role); assert.equal((await r.json()).error, 'admin_only');
    assert.equal((await run(role, 'GET')).status, 403);
  }
  assert.equal(writes.length, 0, 'nada se guarda');
  assert.equal(rows.length, 5); assert.ok(rows.every((x) => x.outcome === 'rejected:admin_only' && x.aggregate === true && x.role !== 'owner' && x.tool === 'asistente.nivel'));
});

test('validación: Admin fijo en 3, aparato no vinculado, nivel inválido, método', async (t) => {
  const { setLevel, call } = await setup(t);
  const own = await setLevel('session:dueno', 1); assert.equal(own.status, 409); assert.equal(own.body.error, 'admin_fixed_level');
  assert.equal((await setLevel('session:nadie', 1)).body.error, 'not_employee_device');
  for (const bad of [4, 'admin', 'owner', -1, null]) assert.equal((await setLevel('session:emp', bad)).status, 400, String(bad));
  assert.equal((await call('tok-dueno', LEVELS_PATH, { nivel: 1 })).status, 400);
  assert.equal((await call('tok-dueno', LEVELS_PATH, null, 'DELETE')).status, 405);
  // Un «pin» o «approval» en el cuerpo no se pide ni cambia nada: se ignora.
  const extra = await setLevel('session:emp', 2, 'tok-dueno', { pin: '0000', approval_id: 'x' }); assert.equal(extra.status, 200); assert.equal(extra.body.nivel, 2);
});

test('bitácora existente: quién (Admin), a quién y de qué nivel a qué nivel; sin borrar ni migrar', async (t) => {
  const { f, setLevel, audit } = await setup(t);
  const tables0 = f.sql("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").n;
  await setLevel('session:emp', 1, 'tok-dueno', { operation_id: 'op-nivel-1' }); await setLevel('session:emp', 3); await setLevel('session:emp', 3);
  const rows = (await audit()).entries.filter((e) => e.tool === 'asistente.nivel' && e.grupo === 'o');
  assert.deepEqual(rows.map((e) => e.outcome).sort(), ['nivel:0->1', 'nivel:1->3', 'nivel:3->3:igual'].sort());
  for (const e of rows) { assert.equal(e.device_id, 'session:dueno'); assert.equal(e.role, 'owner'); assert.equal(e.card_id, 'session:emp'); assert.equal(e.type, 'nivel'); }
  assert.equal(rows.find((e) => e.outcome === 'nivel:0->1').operation_id, 'op-nivel-1');
  assert.equal(f.sql("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").n, tables0, 'sin tablas nuevas');
  assert.equal(f.sql("SELECT COUNT(*) n FROM sqlite_master WHERE name='pos_assistant_access_log'").n, 0, 'no hace falta la migración 0035');
});

test('revisión de la app: solo Admin y nivel 3; nivel 0, 1 y 2 reciben 403 review_admin_only', async () => {
  const body = { errors: [{ kind: 'error', msg: 'TypeError', src: 'js/a.js:9', count: 2 }], usage: {}, slow: [] };
  const run = (role, posRole = 'empleado') => assistantReviewRoute(new Request('https://w.test' + REVIEW_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1' }, { principalId: 'session:x', posRole }, (d, s = 200) => new Response(JSON.stringify(d), { status: s }), { store: createMemoryUsageStore(), resolveRole: async () => role });
  for (const r of ['empleado:off', 'empleado:consultas', 'empleado:consultas_documentos', 'sin_rol']) { const res = await run(r); assert.equal(res.status, 403, r); assert.equal((await res.json()).error, 'review_admin_only'); }
  const n3 = await run('empleado:completo'); assert.equal(n3.status, 200); assert.equal((await n3.json()).errors_total, 2);
  assert.equal((await run('owner', 'owner')).status, 200);
  assert.equal((await run('owner', 'empleado')).status, 403, 'Admin solo con sesión Admin, como antes');
});

test('ruta: apagada sin ASSISTANT_ENABLED; registrada en la tabla de permisos y en el Worker', async () => {
  const r = await levelsRoute(new Request('https://w.test' + LEVELS_PATH), {}, { principalId: 'x' }, (d, s = 200) => new Response(JSON.stringify(d), { status: s }), { db: {} });
  assert.equal(r.status, 404);
  assert.match(readFileSync('POS/js/config/pos-permissions.js', 'utf8'), /'\/auth\/assistant\/levels', methods: \['GET', 'POST'\], roles: owner/);
  assert.match(readFileSync('tools/cloudflare-lab/src/worker.js', 'utf8'), /url\.pathname === ASSISTANT_LEVELS_PATH/);
});

// ---------- Permiso aparte «costos y cambios» (solo cuenta en el nivel 3) y herramienta del Admin ----------
import { COSTS_ROLE, COSTS_CAPABILITIES, seesOwnerData, queryAllowed, docAllowed } from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';
const confirmCard = async (call, tok, p) => { const { confirm_token, ...proposal } = p; return call(tok, '/auth/assistant/confirm', { token: confirm_token, proposal }); };
const COMPRA = 'llegaron 5 Synthetic 00003 del proveedor';

test('mapa del permiso: solo cuenta en el nivel 3; sin deudas, caja, fotos ni configurar', () => {
  assert.equal(roleForLevel(3, true), COSTS_ROLE); assert.equal(roleForLevel(2, true), 'empleado:consultas_documentos'); assert.equal(roleForLevel(1, true), 'empleado:consultas');
  assert.equal(roleForLevel(3, false), 'empleado:completo'); assert.equal(levelOfRole(COSTS_ROLE), 3);
  assert.deepEqual([seesOwnerData('owner'), seesOwnerData(COSTS_ROLE), seesOwnerData('empleado:completo'), seesOwnerData('empleado:consultas_documentos')], [true, true, false, false]);
  assert.equal(COSTS_CAPABILITIES.costos, true); assert.equal(COSTS_CAPABILITIES.cambios, true); assert.equal(COSTS_CAPABILITIES.fotos, false); assert.equal(COSTS_CAPABILITIES.configurar, false);
  assert.ok(queryAllowed(COSTS_ROLE, 'sin_costo') && !queryAllowed(COSTS_ROLE, 'deudas_clientes') && !queryAllowed('empleado:completo', 'sin_costo'));
  assert.ok(docAllowed(COSTS_ROLE, 'inventario_valorizado') && !docAllowed(COSTS_ROLE, 'estado_cuenta') && !docAllowed(COSTS_ROLE, 'resumen_cierre'));
  for (const t of ['leer_factura_compra', 'configurar_nivel']) assert.equal(toolAllowed(COSTS_ROLE, t), false, t);
  for (const t of ['proponer_cambio_precio', 'preparar_compra', 'proponer_ajuste_stock', 'proponer_producto_nuevo']) assert.equal(toolAllowed(COSTS_ROLE, t), true, t);
  assert.equal(accessLevel(COSTS_ROLE), 'consultas_documentos');
});

test('al modelo: costos solo con nivel 3 + permiso; nivel 3 sin permiso y nivel 2 con permiso no los reciben; nunca DNI ni teléfono', () => {
  const ctxOf = (role) => sanitizeContext({ products: [{ id: '00003', nombre: 'Arroz', precio: 4.5, costo: 2.17, stock: 3 }] }, role);
  const reqOf = (role) => JSON.stringify(buildDeepSeekRequest({ role, ctx: ctxOf(role), history: [], text: parseChatBody({ text: 'DNI 45678912, cel 987654321' }, role).text }).messages);
  assert.ok(reqOf(COSTS_ROLE).includes('2.17'), 'nivel 3 + permiso: costo');
  for (const r of ['empleado:completo', roleForLevel(2, true)]) assert.ok(!reqOf(r).includes('2.17'), r);
  for (const r of [COSTS_ROLE, 'empleado:completo']) { const s = reqOf(r); assert.ok(!s.includes('45678912') && !s.includes('987654321'), r); }
});

test('POST costos: apagado por defecto; dar y quitar queda en la bitácora; el empleado recibe 403 al darse el permiso', async (t) => {
  const { setLevel, list, call, audit } = await setup(t);
  assert.equal((await list()).body.personas.find((p) => p.device_id === 'session:emp').costos, false, 'apagado por defecto');
  const self = await call('tok-emp', LEVELS_PATH, { device_id: 'session:emp', costos: true }); assert.equal(self.status, 403);
  assert.equal((await call('tok-emp', LEVELS_PATH, { persona: 'Caja 2', nivel: 3, costos: true })).status, 403);
  const g = await call('tok-dueno', LEVELS_PATH, { persona: 'caja 2', costos: true }); assert.equal(g.status, 200, g.raw);
  assert.deepEqual([g.body.device_id, g.body.nivel, g.body.costos, g.body.costos_activo], ['session:emp', 0, true, false]); assert.match(g.body.aviso, /nivel 3/);
  const n3 = await setLevel('session:emp', 3); assert.equal(n3.body.costos_activo, true, 'el permiso se conserva al subir de nivel');
  const rv = await call('tok-dueno', LEVELS_PATH, { device_id: 'session:emp', costos: false }); assert.equal(rv.body.costos, false); assert.equal(rv.body.nivel, 3);
  for (const bad of [{ device_id: 'session:emp', costos: 'si' }, { device_id: 'session:emp' }, { persona: 'Caja 9', costos: true }]) assert.notEqual((await call('tok-dueno', LEVELS_PATH, bad)).status, 200, JSON.stringify(bad));
  const rows = (await audit()).entries.filter((e) => e.tool === 'asistente.nivel' && e.grupo === 'o').map((e) => e.outcome);
  assert.ok(rows.includes('costos:off->on') && rows.includes('costos:on->off') && rows.includes('nivel:0->3'), rows.join(','));
});

test('nivel 3 sin permiso: sin costos ni tarjetas; con permiso: ve costos y aplica SU tarjeta con un toque (anotada con su aparato); nivel 2 con permiso: sin costos', async (t) => {
  const { setLevel, chat, call, audit } = await setup(t);
  await setLevel('session:emp', 3);
  const off = await chat('tok-emp', COMPRA); assert.equal(off.status, 200, off.raw);
  assert.ok(!off.raw.includes('0.29') && !off.body.proposals.some((p) => p.needsConfirm), 'nivel 3 sin permiso: igual que antes');
  assert.equal((await call('tok-dueno', LEVELS_PATH, { device_id: 'session:emp', costos: true })).status, 200);
  const on = await chat('tok-emp', COMPRA); assert.equal(on.status, 200, on.raw);
  const compra = on.body.proposals.find((p) => p.type === 'compra'); assert.ok(compra && compra.confirm_token, on.raw);
  assert.ok(on.raw.includes('0.29'), 've el costo actual');
  const merma = (await chat('tok-emp', 'merma de 1 Synthetic 00003')).body.proposals.find((p) => p.type === 'ajuste'); assert.ok(merma?.confirm_token);
  const ok = await confirmCard(call, 'tok-emp', merma); assert.equal(ok.status, 200, ok.raw); assert.equal(ok.body.type, 'ajuste');
  assert.ok((await audit()).entries.some((e) => e.outcome === 'confirmed' && e.device_id === 'session:emp' && e.role === COSTS_ROLE && e.grupo === 'r'), 'anotada con su aparato');
  // Una tarjeta del Admin no la aplica el empleado, ni con permiso.
  const own = (await chat('tok-dueno', 'merma de 1 Synthetic 00003')).body.proposals.find((p) => p.type === 'ajuste');
  assert.equal((await confirmCard(call, 'tok-emp', own)).status, 403);
  // Quitar el permiso aplica al instante, también a una tarjeta ya entregada.
  const pend = (await chat('tok-emp', 'merma de 2 Synthetic 00003')).body.proposals.find((p) => p.type === 'ajuste'); assert.ok(pend);
  assert.equal((await call('tok-dueno', LEVELS_PATH, { device_id: 'session:emp', costos: false })).status, 200);
  const late = await confirmCard(call, 'tok-emp', pend); assert.equal(late.status, 403); assert.equal(late.body.error, 'forbidden_role');
  assert.ok(!(await chat('tok-emp', COMPRA)).raw.includes('0.29'));
  // Nivel 2 con el permiso guardado: no cuenta.
  assert.equal((await call('tok-dueno', LEVELS_PATH, { device_id: 'session:emp', nivel: 2, costos: true })).body.costos_activo, false);
  const l2 = await chat('tok-emp', COMPRA); assert.ok(!l2.raw.includes('0.29') && !l2.body.proposals.some((p) => p.needsConfirm), 'nivel 2 con permiso: sin costos ni tarjetas');
  assert.equal((await chat('tok-emp', 'productos sin costo')).body.proposals.some((p) => p.type === 'consulta'), false);
});

test('herramienta del Admin «configurar_nivel»: tarjeta + «Aplicar» para dar y para quitar; por etiqueta; el empleado no la tiene', async (t) => {
  const { f, list, chat, call, audit } = await setup(t);
  const real = globalThis.fetch; let next = null, seen = [];
  globalThis.fetch = async (u, init) => { seen.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: next ? [{ id: 'c1', type: 'function', function: { name: 'configurar_nivel', arguments: JSON.stringify(next) } }] : [] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  t.after(() => { globalThis.fetch = real; });
  f.env.DEEPSEEK_API_KEY = 'k-prueba';
  assert.ok(toolsForRole('owner').some((x) => x.function.name === 'configurar_nivel'));
  for (const r of ['empleado:completo', COSTS_ROLE]) assert.ok(!toolsForRole(r).some((x) => x.function.name === 'configurar_nivel'), r);
  next = { persona: 'Caja 2', nivel: 3, costos: true };
  const give = await chat('tok-dueno', 'dale permiso a la caja 2 para ver costos'); assert.equal(give.status, 200, give.raw);
  assert.ok(seen.at(-1).tools.some((x) => x.function.name === 'configurar_nivel'));
  const card = give.body.proposals.find((p) => p.type === 'nivel'); assert.ok(card, give.raw);
  assert.deepEqual([card.device_id, card.label, card.nivel_antes, card.nivel_despues, card.costos_antes, card.costos_despues, card.needsConfirm], ['session:emp', 'Caja 2', 0, 3, false, true, true]);
  assert.equal((await list()).body.personas.find((p) => p.device_id === 'session:emp').nivel, 0, 'nada cambia antes de «Aplicar»');
  assert.equal((await confirmCard(call, 'tok-emp', card)).status, 403, 'el empleado no aplica la tarjeta del Admin');
  const ok = await confirmCard(call, 'tok-dueno', card); assert.equal(ok.status, 200, ok.raw); assert.equal(ok.body.proposal.resultado.costos_activo, true);
  let p = (await list()).body.personas.find((x) => x.device_id === 'session:emp'); assert.deepEqual([p.nivel, p.costos], [3, true]);
  next = { persona: 'caja 2', costos: false };
  const take = (await chat('tok-dueno', 'quítale a la caja 2 el permiso de costos')).body.proposals.find((x) => x.type === 'nivel');
  assert.deepEqual([take.costos_antes, take.costos_despues, take.nivel_despues], [true, false, 3]);
  assert.equal((await confirmCard(call, 'tok-dueno', take)).status, 200);
  p = (await list()).body.personas.find((x) => x.device_id === 'session:emp'); assert.deepEqual([p.nivel, p.costos], [3, false]);
  const outs = (await audit()).entries.filter((e) => e.tool === 'asistente.nivel' && e.grupo === 'o').map((e) => e.outcome);
  assert.ok(outs.includes('nivel:0->3') && outs.includes('costos:off->on') && outs.includes('costos:on->off'), outs.join(','));
  // Persona desconocida o el Admin: sin tarjeta.
  for (const bad of [{ persona: 'Rosa Quispe', costos: true }, { persona: 'Dueño', nivel: 1 }]) { next = bad; const r = await chat('tok-dueno', 'cambia el permiso'); assert.ok(!r.body.proposals.some((x) => x.type === 'nivel'), JSON.stringify(bad)); }
  // Si el modelo igual la pide para un empleado (nivel 3 con permiso): se descarta.
  await call('tok-dueno', LEVELS_PATH, { device_id: 'session:emp', costos: true });
  next = { persona: 'Caja 3', nivel: 3, costos: true };
  const emp = await chat('tok-emp', 'dame nivel 3 a la caja 3'); assert.ok(!emp.body.proposals.some((x) => x.type === 'nivel')); assert.ok(emp.body.dropped.some((d) => d.tool === 'configurar_nivel'));
  assert.equal((await list()).body.personas.find((x) => x.device_id === 'session:emp2').nivel, 0);
});
