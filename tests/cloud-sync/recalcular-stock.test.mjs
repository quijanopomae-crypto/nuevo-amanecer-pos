import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('POS/js/modules/recalcular-stock.js', 'utf8');
const permissionsSource = readFileSync('POS/js/config/pos-permissions.js', 'utf8');
const ajustesOk = { available: () => true };
function load(extra = {}) {
  const context = vm.createContext({ ...extra });
  vm.runInContext(source, context);
  return context.NA_RECALCULAR_STOCK;
}
function realPermissions() {
  const c = vm.createContext({ module: { exports: {} } });
  vm.runInContext(permissionsSource, c);
  return c.NA_PERMISSIONS;
}

test('candado recalcular-stock falla cerrado', () => {
  assert.equal(load({ NA_AJUSTES_INVENTARIO: ajustesOk }).allowed(), false);
  assert.equal(load({ NA_AJUSTES_INVENTARIO: ajustesOk, NA_PERMISSIONS: {} }).allowed(), false);
  assert.equal(load({ NA_AJUSTES_INVENTARIO: ajustesOk, NA_PERMISSIONS: { featureLocked() { throw new Error('x'); } } }).allowed(), false);
  assert.equal(load({ NA_AJUSTES_INVENTARIO: ajustesOk, NA_PERMISSIONS: { featureLocked: () => 0 } }).allowed(), false);
  assert.equal(load({ NA_AJUSTES_INVENTARIO: ajustesOk, NA_PERMISSIONS: { featureLocked: () => undefined } }).allowed(), false);
});

test('candado real (ausente o true en pos-permissions.js): nadie lo ve', () => {
  const P = realPermissions();
  assert.equal(P.featureLocked('recalcular-stock'), true);
  assert.equal(load({ NA_AJUSTES_INVENTARIO: ajustesOk, NA_PERMISSIONS: P }).allowed(), false);
});

test('candado abierto solo deja pasar si Ajustes también lo permite', () => {
  const open = { featureLocked: id => id !== 'recalcular-stock' };
  assert.equal(load({ NA_AJUSTES_INVENTARIO: ajustesOk, NA_PERMISSIONS: open }).allowed(), true);
  assert.equal(load({ NA_AJUSTES_INVENTARIO: { available: () => false }, NA_PERMISSIONS: open }).allowed(), false);
  assert.equal(load({ NA_PERMISSIONS: open }).allowed(), false);
});
