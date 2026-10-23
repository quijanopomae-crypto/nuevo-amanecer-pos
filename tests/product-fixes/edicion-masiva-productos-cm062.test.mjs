// CM-062: marca y unidad en lote, sin empaque; reintento idempotente; deshacer controlado.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../POS/js/modules/edicion-masiva-productos.js', import.meta.url), 'utf8');
const ctx = vm.createContext({}); vm.runInContext(src, ctx);
const api = ctx.NA_EDICION_MASIVA_PRODUCTOS;
const plain = v => JSON.parse(JSON.stringify(v));
const P = () => [
  { id: 1, name: 'Arroz', cat: 'abarrotes', precio: 4, costo: 3, stock: 10, marca: 'Costeño', unidad: 'unidad', unidadCompra: 'caja', factorCompra: 12, unidCaja: 12, precioCaja: 40 },
  { id: 2, name: 'Gaseosa', cat: 'bebidas', precio: 2.5, costo: 1, stock: 8, unidad: 'botella' },
  { id: 3, name: 'Jabón', cat: 'limpieza', precio: 1, costo: 0.5, stock: 3, marca: 'Bolívar', unidad: 'unidad' }];

test('marca y unidad: solo seleccionados que cambian; guarda valores previos', () => {
  const rows = plain(api.buildPreview(P(), [1, 2], { marca: 'Bolívar', unidad: 'unidad' }));
  assert.deepEqual(rows.map(r => [r.id, r.changes]), [[1, { marca: 'Bolívar' }], [2, { marca: 'Bolívar', unidad: 'unidad' }]]);
  assert.deepEqual(rows[1].prev, { cat: 'bebidas', activo: 'true', marca: 'Sin marca', unidad: 'botella' });
});
test('unidad no válida se ignora', () => {
  assert.equal(api.buildPreview(P(), [1], { unidad: '<img>' }).length, 0);
});
test('nunca edita empaque, precio, costo ni stock (CM-066 fuera de alcance)', () => {
  const rows = plain(api.buildPreview(P(), [1, 2, 3], { cat: 'x', activo: 'false', marca: 'M', unidad: 'caja',
    unidadCompra: 'unidad', factorCompra: 1, unidCaja: 1, precioCaja: 1, precio: 9, costo: 9, stock: 0 }));
  const keys = new Set(rows.flatMap(r => Object.keys(r.changes)));
  assert.deepEqual([...keys].sort(), ['activo', 'cat', 'marca', 'unidad']);
  for (const k of ['unidadCompra', 'factorCompra', 'unidCaja', 'precioCaja']) assert.ok(!src.includes(`'p${k[0].toUpperCase()}${k.slice(1)}'`), k);
  assert.ok(!/setField\('p(Precio|Costo|Stock|PrecioCaja|UnidCaja|UnidadCompra|FactorCompra)'/.test(src));
});
test('reintento con el mismo id no repite los ya guardados', () => {
  const rows = api.buildPreview(P(), [1, 2, 3], { marca: 'Z' });
  const log = [{ opId: 'op1', kind: 'cambio', done: ['1', '2'], rows: [] }];
  assert.deepEqual(plain(api.pendingRows(rows, log, 'op1').map(r => r.id)), [3]);
  assert.equal(api.pendingRows(rows, log, 'op2').length, 3);
});
test('deshacer: devuelve valores previos solo donde sigue el valor aplicado', () => {
  const after = P(); after[0].marca = 'Z'; after[1].marca = 'Otra'; after[1].cat = 'abarrotes';
  const log = [{ opId: 'op1', kind: 'cambio', done: ['1', '2'], rows: [
    { id: '1', name: 'Arroz', changes: { marca: 'Z' }, prev: { cat: 'abarrotes', activo: 'true', marca: 'Costeño', unidad: 'unidad' } },
    { id: '2', name: 'Gaseosa', changes: { marca: 'Z', cat: 'abarrotes' }, prev: { cat: 'bebidas', activo: 'true', marca: 'Sin marca', unidad: 'botella' } }] }];
  const u = plain(api.undoPlan(log, after));
  assert.deepEqual(u.rows.map(r => [r.id, r.changes]), [['1', { marca: 'Costeño' }], ['2', { cat: 'bebidas' }]]);
  log[0].reverted = true;
  assert.equal(api.undoPlan(log, after), null);
});
test('no usa innerHTML', () => { assert.ok(!/innerHTML/.test(src)); });

test('unidad decimal → entera con stock decimal: fila marcada y omitida', () => {
  const ps = [
    { id: 1, name: 'Queso', cat: 'a', precio: 30, stock: 2.5, unidad: 'kilogramo' },
    { id: 2, name: 'Aceite', cat: 'a', precio: 9, stock: 4, unidad: 'litro' },
    { id: 3, name: 'Harina', cat: 'a', precio: 3, stock: 1.25, unidad: 'gramo' },
    { id: 4, name: 'Leche', cat: 'a', precio: 4, stock: 0.5, unidad: 'mililitro' },
    { id: 5, name: 'Pan', cat: 'a', precio: 1, stock: 3.5, unidad: 'unidad' }];
  const rows = plain(api.buildPreview(ps, [1, 2, 3, 4, 5], { unidad: 'unidad' }));
  assert.deepEqual(rows.map(r => [r.id, !!r.blocked]), [[1, true], [2, false], [3, true], [4, true]]);
  assert.equal(rows[0].blocked, 'Stock con decimales (2.5): no se puede pasar a UNIDAD. Se omite.');
  assert.deepEqual(plain(api.chosenOf(rows).map(r => r.id)), [2]);
  // decimal → decimal sí se permite
  assert.equal(api.buildPreview(ps, [1], { unidad: 'gramo' })[0].blocked, undefined);
  assert.deepEqual(plain(api.DECIMAL_UNITS), ['kilogramo', 'kg', 'gramo', 'litro', 'mililitro']);
});

test('cambio a unidad entera con stock decimal se bloquea aunque la unidad actual sea UND (legado)', () => {
  const ps = [{ id: 1, name: 'Pan', cat: 'a', precio: 1, stock: 3.5, unidad: 'unidad' }, { id: 2, name: 'Bolsa', cat: 'a', precio: 1, stock: 2.25, unidad: 'bolsa' }, { id: 3, name: 'Lata', cat: 'a', precio: 1, stock: 2, unidad: 'unidad' }];
  const rows = plain(api.buildPreview(ps, [1, 2, 3], { unidad: 'paquete' }));
  assert.deepEqual(rows.map(r => [r.id, r.blocked || null]), [[1, 'Stock con decimales (3.5): no se puede pasar a PAQUETE. Se omite.'], [2, 'Stock con decimales (2.25): no se puede pasar a PAQUETE. Se omite.'], [3, null]]);
  // a unidad decimal sí se permite aunque el stock tenga decimales
  assert.equal(api.buildPreview(ps, [1], { unidad: 'kilogramo' })[0].blocked, undefined);
});
test('deshacer UND→kg tras vender 1.5 kg: se omite (no redondea) y se cuenta', () => {
  const now = [{ id: 1, name: 'Queso', cat: 'a', precio: 30, stock: 8.5, unidad: 'kilogramo' }, { id: 2, name: 'Arroz', cat: 'a', precio: 4, stock: 10, unidad: 'kilogramo' }];
  const prev = u => ({ cat: 'a', activo: 'true', marca: 'Sin marca', unidad: u });
  const log = [{ opId: 'op1', kind: 'cambio', done: ['1', '2'], rows: [
    { id: '1', name: 'Queso', changes: { unidad: 'kilogramo' }, prev: prev('unidad') },
    { id: '2', name: 'Arroz', changes: { unidad: 'kilogramo' }, prev: prev('unidad') }] }];
  const u = plain(api.undoPlan(log, now));
  assert.deepEqual(u.rows.map(r => [r.id, r.changes]), [['2', { unidad: 'unidad' }]]);
  assert.deepEqual(u.blocked, [{ id: '1', name: 'Queso', reason: 'Stock con decimales (8.5): no se puede pasar a UNIDAD. Se omite.' }]);
  assert.equal(now[0].stock, 8.5);
  // deshacer kg→gramo (decimal a decimal) no se bloquea
  log[0].rows[0].prev = prev('gramo');
  assert.equal(plain(api.undoPlan(log, now)).blocked.length, 0);
});
