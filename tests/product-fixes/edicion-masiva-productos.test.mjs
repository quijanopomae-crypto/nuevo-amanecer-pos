import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../POS/js/modules/edicion-masiva-productos.js', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(src, ctx);
const api = ctx.NA_EDICION_MASIVA_PRODUCTOS;
const plain = v => JSON.parse(JSON.stringify(v));
const products = [
  { id: 1, name: 'Arroz', cat: 'abarrotes', precio: 4, costo: 3.21, sku: 'ARR' },
  { id: 2, name: 'Gaseosa', cat: 'bebidas', precio: 2.5, costo: 1.11, barcode: '775' },
  { id: 3, name: 'Viejo', cat: 'bebidas', precio: 1, activo: false },
  { id: 4, name: 'Borrado', cat: 'bebidas', precio: 1, eliminado: true },
  { id: 5, name: 'VARIOS', precio: 1, ventaLibre: true }
];
test('filtro por categoría y búsqueda; excluye eliminados y venta libre', () => {
  assert.deepEqual(plain(api.filterProducts(products, {}).map(p => p.id)), [1, 2, 3]);
  assert.deepEqual(plain(api.filterProducts(products, { cat: 'bebidas' }).map(p => p.id)), [2, 3]);
  assert.deepEqual(plain(api.filterProducts(products, { q: '775' }).map(p => p.id)), [2]);
  assert.deepEqual(plain(api.filterProducts(products, { q: 'arr' }).map(p => p.id)), [1]);
});
test('vista previa: solo seleccionados que cambian de categoría o estado', () => {
  const rows = api.buildPreview(products, [1, 2, 3, 4], { cat: 'bebidas', activo: 'true' });
  assert.deepEqual(plain(rows.map(r => [r.id, r.changes.cat || null, r.changes.activo || null])), [[1, 'bebidas', null], [3, null, 'true']]);
  assert.deepEqual(plain(api.buildPreview(products, [1, 3], { activo: 'false' }).map(r => r.id)), [1]);
  assert.equal(api.buildPreview(products, [1, 2], {}).length, 0);
});
test('vista previa sin costo ni cambio de precio', () => {
  const rows = plain(api.buildPreview(products, [1, 2], { cat: 'limpieza' }));
  assert.ok(!JSON.stringify(rows).includes('3.21') && !JSON.stringify(rows).includes('1.11'));
  assert.ok(rows.every(r => !('costo' in r) && !('precio' in r.changes)));
});
test('dinero con coma de miles', () => { assert.equal(api.money(1234567.891), 'S/ 1,234,567.89'); });
test('no usa innerHTML', () => { assert.ok(!/innerHTML/.test(src)); });
