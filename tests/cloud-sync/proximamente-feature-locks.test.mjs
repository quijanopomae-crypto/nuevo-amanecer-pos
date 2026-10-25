import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { activeCanon } from './canon-browser-harness.mjs';
import { PERMISSIONS } from '../../tools/cloudflare-lab/src/pos-permissions.js';

const addedIds = ['venta-exitosa-comprobante', 'clonar-venta', 'nota-credito-parcial-compras', 'clientes-dias-credito', 'credito-cuotas', 'reparto-abono-multiples-deudas', 'asistente-virtual', 'lotes-multiples-fefo', 'app-pedidos-marca-propia', 'cambiar-clave-usuarios', 'conversion-masiva-documentos', 'vendedor-en-venta', 'comentarios-venta', 'despacho-productos', 'vendedor-por-cliente', 'consulta-dni-ruc', 'marcas-productos', 'subcategorias-atributos', 'produccion-recetas', 'registro-sanitario', 'numero-serie-producto', 'tipos-movimiento-inventario', 'conciliacion-bancaria', 'historial-exportaciones', 'catalogo-reportes', 'importar-proveedores', 'periodo-contable-percepcion', 'desbloquear-usuario', 'detraccion-retencion', 'canales-venta', 'estado-recepcion-compras', 'adjuntos-proveedor', 'dashboard-compras', 'recargo-servicio', 'producto-activo-venta', 'precio-min-max', 'cajas-multiples', 'cierre-remoto-cajas', 'dashboard-tesoreria', 'producto-servicio', 'catalogo-desde-pos'];

test('real Worker authenticates then returns feature_locked for every locked registry id without writes', async t => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  f.addDevice('feature-owner', 'writer', 'active', 'feature-owner-token');
  f.addDevice('feature-employee', 'writer', 'active', 'feature-employee-token');
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('session:feature-employee','empleado','test','2026-10-15T00:00:00Z')");
  const context = vm.createContext({});
  vm.runInContext(readFileSync('POS/js/modules/proximamente-registry.js', 'utf8'), context);
  const ids = context.NA_PROXIMAMENTE_REGISTRY.map(f => f.id).filter(id => PERMISSIONS.featureLocked(id));
  for (const id of addedIds) assert.ok(ids.includes(id), id);
  const before = f.database.prepare('SELECT * FROM canonical_control').all();
  for (const id of [...ids, 'unknown-feature']) {
    for (const method of ['GET', 'POST']) {
      const response = await f.fetch('http://localhost/features/' + id, { method, headers: { authorization: 'Bearer feature-owner-token' } });
      assert.equal(response.status, 403, id);
      assert.equal((await response.json()).error, 'feature_locked', id);
    }
  }
  for (const id of ['asistencia-empleados', 'asistente-virtual', 'lotes-multiples-fefo', 'stock-negativo-configurable', 'app-pedidos-marca-propia', 'cambiar-clave-usuarios']) {
    for (const method of ['GET', 'POST']) {
      const denied = await f.fetch('http://localhost/features/' + id, { method, headers: { authorization: 'Bearer feature-employee-token' } });
      assert.equal(denied.status, 403, id);
      assert.equal((await denied.json()).error, 'forbidden_role', id);
    }
    assert.equal(PERMISSIONS.routeRoles('/features/' + id, 'GET').includes('empleado'), false, 'role restriction is independent of the lock');
  }
  const missing = await f.fetch('http://localhost/features/' + addedIds[0]);
  assert.equal(missing.status, 401);
  assert.deepEqual(f.database.prepare('SELECT * FROM canonical_control').all(), before);
});

for (const id of ['valorizacion-inventario', 'rotacion-abc', 'clientes-frecuencia', 'kardex', 'reporte-ventas-stock', 'reporte-arqueo', 'historial-compras-producto', 'cliente-historial-compras', 'historial-precios-producto', 'etiquetas-precios', 'reporte-productos-vencer', 'productos-sin-movimiento', 'sugerencia-compra', 'ajustes-inventario']) {
  test(`${id} is unlocked on client and server; owner-only feature route, no writes`, async t => {
    assert.equal(PERMISSIONS.FEATURE_LOCKS[id], false);
    assert.equal(PERMISSIONS.featureLocked(id), false);
    assert.deepEqual(Array.from(PERMISSIONS.FEATURE_ROLES[id] || []), ['owner'], 'explicit owner role, also if it is locked again');
    const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql'] });
    f.addDevice('unlock-owner', 'writer', 'active', 'unlock-owner-token');
    f.addDevice('unlock-employee', 'writer', 'active', 'unlock-employee-token');
    f.exec("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('session:unlock-employee','empleado','test','2026-10-15T00:00:00Z')");
    const before = f.database.prepare('SELECT * FROM canonical_control').all();
    for (const method of ['GET', 'POST']) {
      const owner = await f.fetch('http://localhost/features/' + id, { method, headers: { authorization: 'Bearer unlock-owner-token' } });
      assert.equal(owner.status, 404);
      assert.notEqual((await owner.json()).error, 'feature_locked');
      const employee = await f.fetch('http://localhost/features/' + id, { method, headers: { authorization: 'Bearer unlock-employee-token' } });
      assert.equal(employee.status, 403);
      assert.equal((await employee.json()).error, 'forbidden_role');
    }
    assert.deepEqual(f.database.prepare('SELECT * FROM canonical_control').all(), before);
  });
}

test('clientes-filtro-deuda is unlocked on client and server (no feature_locked, no writes)', async t => {
  assert.equal(PERMISSIONS.FEATURE_LOCKS['clientes-filtro-deuda'], false);
  assert.equal(PERMISSIONS.featureLocked('clientes-filtro-deuda'), false);
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  f.addDevice('filter-owner', 'writer', 'active', 'filter-owner-token');
  const before = f.database.prepare('SELECT * FROM canonical_control').all();
  for (const method of ['GET', 'POST']) {
    const response = await f.fetch('http://localhost/features/clientes-filtro-deuda', { method, headers: { authorization: 'Bearer filter-owner-token' } });
    const body = await response.json();
    assert.notEqual(body.error, 'feature_locked');
    assert.equal(response.status, 404);
  }
  assert.deepEqual(f.database.prepare('SELECT * FROM canonical_control').all(), before);
});

test('clientes-deudores-caja is unlocked on client and server (no feature_locked, no writes)', async t => {
  assert.equal(PERMISSIONS.FEATURE_LOCKS['clientes-deudores-caja'], false);
  assert.equal(PERMISSIONS.featureLocked('clientes-deudores-caja'), false);
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  f.addDevice('debtors-owner', 'writer', 'active', 'debtors-owner-token');
  const before = f.database.prepare('SELECT * FROM canonical_control').all();
  for (const method of ['GET', 'POST']) {
    const response = await f.fetch('http://localhost/features/clientes-deudores-caja', { method, headers: { authorization: 'Bearer debtors-owner-token' } });
    const body = await response.json();
    assert.notEqual(body.error, 'feature_locked');
    assert.equal(response.status, 404);
  }
  assert.deepEqual(f.database.prepare('SELECT * FROM canonical_control').all(), before);
});

test('edicion-masiva-precios: abierto (OK dueño 2026-10-23), owner-only screen and feature route; product.update stays owner-approved', async t => {
  assert.equal(PERMISSIONS.featureLocked('edicion-masiva-precios'), false);
  assert.equal(PERMISSIONS.featureLocked('precio-por-margen'), false);
  assert.equal(PERMISSIONS.canAccessScreen('owner', 'pageEdicionPrecios'), true);
  assert.equal(PERMISSIONS.canAccessScreen('empleado', 'pageEdicionPrecios'), false);
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  f.addDevice('pm-owner', 'writer', 'active', 'pm-owner-token');
  f.addDevice('pm-employee', 'writer', 'active', 'pm-employee-token');
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('session:pm-employee','empleado','test','2026-10-21T00:00:00Z')");
  const before = f.database.prepare('SELECT * FROM canonical_control').all();
  const owner = await f.fetch('http://localhost/features/edicion-masiva-precios', { headers: { authorization: 'Bearer pm-owner-token' } });
  assert.notEqual((await owner.json()).error, 'feature_locked'); // candado abierto
  for (const id of ['edicion-masiva-precios', 'precio-por-margen']) {
    const employee = await f.fetch('http://localhost/features/' + id, { headers: { authorization: 'Bearer pm-employee-token' } });
    assert.equal(employee.status, 403, id);
  }
  assert.deepEqual(f.database.prepare('SELECT * FROM canonical_control').all(), before);
});

test('aviso-factura-duplicada stays locked for now (feature_locked, no writes)', async t => {
  assert.equal(PERMISSIONS.featureLocked('aviso-factura-duplicada'), true) // candado cerrado hasta abrirlos todos juntos;
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  f.addDevice('dup-owner', 'writer', 'active', 'dup-owner-token');
  f.addDevice('dup-employee', 'writer', 'active', 'dup-employee-token');
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('session:dup-employee','empleado','test','2026-10-21T00:00:00Z')");
  const before = f.database.prepare('SELECT * FROM canonical_control').all();
  for (const token of ['dup-owner-token', 'dup-employee-token']) for (const method of ['GET', 'POST']) {
    const response = await f.fetch('http://localhost/features/aviso-factura-duplicada', { method, headers: { authorization: 'Bearer ' + token } });
    const body = await response.json();
    assert.equal(body.error, 'feature_locked'); // candado cerrado
  }
  assert.deepEqual(f.database.prepare('SELECT * FROM canonical_control').all(), before);
});
