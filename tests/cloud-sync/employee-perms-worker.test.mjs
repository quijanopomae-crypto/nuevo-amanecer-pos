// Permisos por empleado: decisión del Worker y ruta /auth/employee-permissions. Solo fixtures locales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { a6Fixture } from './a6-fixture.mjs';
import { featureDecision, employeeFeatureGrant, employeeMay, handleEmployeePerms, EMPLOYEE_TOGGLES, EMPLOYEE_PERMS_KEY } from '../../tools/cloudflare-lab/src/pos-employee-perms.js';
import { PERMISSIONS } from '../../tools/cloudflare-lab/src/pos-permissions.js';
import { getDatabase } from '../../tools/cloudflare-lab/src/database-binding.js';

const read = n => readFileSync(new URL('../../infra/database/migrations/' + n, import.meta.url), 'utf8');
async function setup(t) {
  const f = await a6Fixture(t);
  f.database.exec(read('0010_session_auth.sql').replace(/DROP INDEX[^;]*;/, ''));
  f.database.exec(read('0024_pos_roles_owner_pin.sql'));
  f.addDevice('owner-phone', 'writer', 'active', 'owner-token');
  return f;
}
const H = tk => ({ authorization: 'Bearer ' + tk, 'content-type': 'application/json' });
async function call(f, path, tk, body, extra = {}) {
  const r = await f.fetch('http://localhost' + path, { method: body ? 'POST' : 'GET', headers: { ...H(tk), ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}
async function employee(f) {
  const code = await call(f, '/auth/pairing-code', 'owner-token', { label: 'Caja 2' });
  const paired = await call(f, '/auth/pair', null, { code: code.body.code });
  assert.equal(paired.status, 201);
  return paired.body.session_token;
}
const setRow = (f, value) => f.exec(`INSERT INTO pos_settings(key,value_json,revision,updated_at,updated_by) VALUES(?,?,1,'2026-10-22T00:00:00Z','test')
  ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`, EMPLOYEE_PERMS_KEY, value);

test('la lista cerrada no incluye nada de costos, cierres, tesorería, ajustes ni proveedores', () => {
  for (const bad of ['purchases.costs.view', 'dashboard-compras', 'precio-por-margen', 'punto-equilibrio', 'valorizacion-inventario', 'cash.closes.view',
    'dashboard-tesoreria', 'settings.set', 'ajustes-inventario', 'importar-proveedores', 'adjuntos-proveedor', 'edicion-masiva-productos', 'kardex', 'asistente-virtual', 'reporte-arqueo', 'permisos-empleado', 'permisos-por-empleado', 'estado-cuenta-abonos', 'estado-cuenta-cliente'])
    assert.ok(!EMPLOYEE_TOGGLES.includes(bad), bad);
  assert.equal(EMPLOYEE_TOGGLES.length, 10);
  assert.ok(Object.isFrozen(EMPLOYEE_TOGGLES));
});

test('/features: sin fila es igual que hoy; la casilla abre solo su id; fuera de lista nunca; el candado gana; apagar aplica al siguiente pedido', async t => {
  const f = await setup(t); const emp = await employee(f);
  assert.equal((await call(f, '/features/etiquetas-precios', emp)).status, 403, 'sin fila: 403 como hoy');
  assert.equal((await call(f, '/features/etiquetas-precios', 'owner-token')).status, 404, 'dueño como hoy');
  setRow(f, JSON.stringify({ allow: { 'etiquetas-precios': true, kardex: true, 'catalogo-desde-pos': true } }));
  assert.equal((await call(f, '/features/etiquetas-precios', emp)).status, 404, 'casilla prendida: pasa el rol');
  assert.equal((await call(f, '/features/productos-sin-movimiento', emp)).status, 403, 'otra casilla apagada');
  assert.equal((await call(f, '/features/kardex', emp)).body.error, 'forbidden_role', 'fuera de la lista: nunca');
  assert.equal((await call(f, '/features/catalogo-desde-pos', emp)).status, 403, 'candado gana: sigue cerrado aunque la casilla esté prendida');
  assert.equal((await call(f, '/features/catalogo-desde-pos', 'owner-token')).body.error, 'feature_locked');
  setRow(f, JSON.stringify({ allow: { 'etiquetas-precios': false } }));
  assert.equal((await call(f, '/features/etiquetas-precios', emp)).status, 403, 'sin caché');
});

test('fila mal formada o tabla ausente: cerrado', async t => {
  const f = await setup(t); const db = getDatabase(f.env);
  for (const v of ['[]', '"x"', 'null', '{"allow":[true]}', '{"allow":{"etiquetas-precios":"true"}}', '{"allow":{"etiquetas-precios":1}}', '{}']) {
    setRow(f, v); assert.equal(await employeeMay(db, 'etiquetas-precios'), false, v);
  }
  const broken = { prepare() { throw new Error('no such table: pos_settings'); } };
  assert.equal(await employeeMay(broken, 'etiquetas-precios'), false);
  assert.equal(await employeeMay(db, '__proto__'), false);
  assert.equal(await employeeMay(db, 123), false);
});

test('employeeFeatureGrant: candado gana y solo rutas /features', async () => {
  const db = { prepare: () => ({ bind: () => ({ first: async () => ({ value_json: JSON.stringify({ allow: { 'ventas-espera': true } }) }) }) }) };
  assert.equal(await employeeFeatureGrant(db, '/features/ventas-espera', { locked: () => false }), true);
  assert.equal(await employeeFeatureGrant(db, '/features/ventas-espera', { locked: () => true }), false);
  assert.equal(await employeeFeatureGrant(db, '/features/ventas-espera'), false, 'hoy está con candado');
  assert.equal(await employeeFeatureGrant(db, '/settings', { locked: () => false }), false);
  assert.equal(await employeeFeatureGrant(db, '/auth/devices', { locked: () => false }), false);
});

test('featureDecision puro: orden candado → rol → casilla', async () => {
  const db = { prepare: () => ({ bind: () => ({ first: async () => ({ value_json: JSON.stringify({ allow: { 'ventas-espera': true, 'x-no': true } }) }) }) }) };
  const roles = { 'ventas-espera': ['owner'], 'x-no': ['owner'] };
  assert.deepEqual(await featureDecision(db, 'ventas-espera', 'empleado', { locked: () => true, roles }), { status: 403, error: 'feature_locked' });
  assert.equal((await featureDecision(db, 'ventas-espera', 'empleado', { locked: () => false, roles })).granted, true);
  assert.equal((await featureDecision(db, 'x-no', 'empleado', { locked: () => false, roles })).status, 403);
  assert.equal((await featureDecision(db, 'ventas-espera', 'unknown', { locked: () => false, roles })).status, 403);
  assert.equal((await featureDecision(db, 'ventas-espera', 'owner', { locked: () => false, roles })).status, 404);
});

test('/auth/employee-permissions con el candado abierto: el dueño lee todo apagado, el empleado recibe 403 y no se escribe nada', async t => {
  const f = await setup(t); const empToken = await employee(f);
  assert.equal(PERMISSIONS.featureLocked('permisos-por-empleado'), false);
  const r = await call(f, '/auth/employee-permissions', 'owner-token');
  assert.equal(r.status, 200); assert.deepEqual(r.body.allow, {});
  const e = await call(f, '/auth/employee-permissions', empToken);
  assert.equal(e.status, 403);
  assert.equal(f.sql('SELECT COUNT(*) n FROM pos_settings WHERE key=?', EMPLOYEE_PERMS_KEY).n, 0);
});

test('guardar (candado abierto en prueba): solo dueño, con aprobación PIN ligada a operation_id y de un solo uso', async t => {
  const f = await setup(t); const emp = await employee(f);
  assert.equal((await call(f, '/auth/owner-pin', 'owner-token', { new_pin: '4821' })).status, 200);
  const deps = { json: (b, s = 200, h = {}) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', ...h } }), getDatabase, locked: () => false,
    authorizeSession: async req => { const tk = (req.headers.get('authorization') || '').slice(7);
      const r = await f.fetch('http://localhost/auth/me', { headers: H(tk) }); const me = await r.json(); return r.ok ? { principalId: me.device_id, posRole: me.pos_role } : new Response('{}', { status: 401 }); } };
  const req = (tk, body, extra = {}) => handleEmployeePerms(new Request('http://localhost/auth/employee-permissions', { method: body ? 'POST' : 'GET', headers: { ...H(tk), ...extra }, body: body ? JSON.stringify(body) : undefined }), f.env, deps);
  const rd = async p => { const r = await p; return { status: r.status, body: await r.json() }; };
  assert.deepEqual((await rd(req('owner-token'))).body.allow, {}, 'arranca apagado');
  assert.equal((await rd(req(emp))).status, 403, 'empleado no lee');
  assert.equal((await rd(req(emp, { allow: { 'etiquetas-precios': true }, operation_id: 'op-e' }))).status, 403, 'empleado no escribe');
  assert.equal((await rd(req('owner-token', { allow: { 'etiquetas-precios': true }, operation_id: 'op-1' }))).body.error, 'owner_approval_required');
  assert.equal((await rd(req('owner-token', { allow: { kardex: true }, operation_id: 'op-1' }))).body.error, 'invalid_allow');
  const ap = await call(f, '/auth/owner-approval', 'owner-token', { pin: '4821', action: 'employee.permissions', operation_id: 'op-1' });
  assert.equal(ap.status, 201);
  const X = { 'x-owner-approval': ap.body.approval_id };
  assert.equal((await rd(req('owner-token', { allow: { 'etiquetas-precios': true }, operation_id: 'otra' }, X))).status, 403, 'otra operación');
  const ok = await rd(req('owner-token', { allow: { 'etiquetas-precios': true, 'ventas-espera': false }, operation_id: 'op-1' }, X));
  assert.deepEqual([ok.status, ok.body.allow], [200, { 'etiquetas-precios': true }]);
  assert.equal((await rd(req('owner-token', { allow: {}, operation_id: 'op-1' }, X))).status, 403, 'no se reusa');
  assert.equal((await call(f, '/features/etiquetas-precios', emp)).status, 404);
  const settings = await call(f, '/settings', emp);
  assert.ok(!JSON.stringify(settings.body).includes('emp:perm'), 'el empleado no ve la fila');
});

test('id fuera de la lista, sin candado y con true en la fila: el empleado sigue con 403', async t => {
  const f = await setup(t); const emp = await employee(f);
  for (const id of ['valorizacion-inventario', 'kardex', 'reporte-arqueo']) {
    assert.equal(PERMISSIONS.featureLocked(id), false, id + ' sin candado');
    assert.deepEqual(PERMISSIONS.FEATURE_ROLES[id], ['owner']);
    assert.ok(!EMPLOYEE_TOGGLES.includes(id));
  }
  setRow(f, JSON.stringify({ allow: { 'valorizacion-inventario': true, kardex: true, 'reporte-arqueo': true } }));
  for (const id of ['valorizacion-inventario', 'kardex', 'reporte-arqueo']) {
    const r = await call(f, '/features/' + id, emp);
    assert.deepEqual([r.status, r.body.error], [403, 'forbidden_role'], id);
    assert.equal((await call(f, '/features/' + id, 'owner-token')).status, 404, id + ' dueño como hoy');
  }
});

test('/auth/me: employee_allow solo para el empleado, normalizado, sin caché y {} ante fila mala', async t => {
  const f = await setup(t); const emp = await employee(f);
  let me = await call(f, '/auth/me', emp);
  assert.deepEqual([me.body.pos_role, me.body.employee_allow], ['empleado', {}], 'sin fila: {}');
  setRow(f, JSON.stringify({ allow: { 'etiquetas-precios': true, 'ventas-espera': true, kardex: true, 'valorizacion-inventario': true, 'permisos-por-empleado': true, 'clonar-venta': 'true', 'atajos-teclado': false } }));
  me = await call(f, '/auth/me', emp);
  assert.deepEqual(me.body.employee_allow, { 'ventas-espera': true, 'etiquetas-precios': true }, 'solo ids de la lista con true; candado no agrega ids');
  const owner = await call(f, '/auth/me', 'owner-token');
  assert.equal(owner.body.pos_role, 'owner');
  assert.ok(!('employee_allow' in owner.body), 'dueño sin el campo');
  for (const v of ['[]', '"x"', 'null', '{"allow":[true]}', '{"allow":{"etiquetas-precios":1}}']) {
    setRow(f, v); assert.deepEqual((await call(f, '/auth/me', emp)).body.employee_allow, {}, v);
  }
  setRow(f, JSON.stringify({ allow: { 'productos-sin-movimiento': true } }));
  assert.deepEqual((await call(f, '/auth/me', emp)).body.employee_allow, { 'productos-sin-movimiento': true }, 'sin caché');
});

test('/auth/me: rol desconocido u otro no recibe employee_allow; error de lectura -> {}', async t => {
  const { handleRoles } = await import('../../tools/cloudflare-lab/src/pos-roles.js');
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const rowDb = value => ({ prepare: sql => ({ bind: () => ({ first: async () => /pos_settings/.test(sql) ? (value instanceof Error ? (() => { throw value; })() : { value_json: value }) : (/label/.test(sql) ? { label: null } : { id: 1 }) }) , first: async () => ({ id: 1 }) }) });
  const run = async (posRole, db) => (await handleRoles(new Request('http://localhost/auth/me'), new URL('http://localhost/auth/me'), {}, { json, authorizeSession: async () => ({ principalId: 'session:x', posRole }), getDatabase: () => db })).json();
  const good = JSON.stringify({ allow: { 'ventas-espera': true } });
  for (const r of ['unknown', 'read_only', 'admin']) assert.ok(!('employee_allow' in await run(r, rowDb(good))), r);
  assert.deepEqual((await run('empleado', rowDb(good))).employee_allow, { 'ventas-espera': true });
  assert.deepEqual((await run('empleado', rowDb(new Error('boom')))).employee_allow, {});
  assert.deepEqual((await run('empleado', rowDb('{bad json'))).employee_allow, {});
});
