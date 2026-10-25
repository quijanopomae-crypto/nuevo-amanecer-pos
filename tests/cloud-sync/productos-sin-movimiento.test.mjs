import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PERMISSIONS } from '../../tools/cloudflare-lab/src/pos-permissions.js';

// Misión 5: productos sin movimiento. Datos sintéticos.
const read = p => readFileSync(p, 'utf8');
const source = read('POS/js/modules/productos-sin-movimiento.js');
function context(extra = {}) {
  const ctx = vm.createContext(extra);
  vm.runInContext(read('POS/js/modules/rotacion-abc.js'), ctx);
  vm.runInContext(source, ctx);
  return ctx;
}
const api = context().NA_PRODUCTOS_SIN_MOVIMIENTO;
const plain = v => JSON.parse(JSON.stringify(v));
const now = '2026-10-16T04:59:59Z'; // 15/10/2026 en Lima
const products = [
  { id: 1, name: 'Vendido hace 10 días', stock: 5, costo: 2 },
  { id: 2, name: 'Vendido hace 45 días', stock: 8, costo: 1.5, sku: 'P-45' },
  { id: 3, name: 'Vendido hace 80 días', stock: 3, costo: 4 },
  { id: 4, name: 'Nunca vendido', stock: 10 }, // costo ausente (#892)
  { id: 5, name: 'Inactivo', stock: 9, costo: 1, activo: false },
  { id: 6, name: 'Solo venta anulada', stock: 2, costo: 3 }
];
const day = n => new Date(Date.parse('2026-10-15T12:00:00-05:00') - n * 86400000).toISOString();
const sales = [
  { fecha: day(10), items: [{ id: 1, qty: 1, precio: 3 }] },
  { fecha: day(45), items: [{ id: 2, qty: 1, precio: 3 }] },
  { fecha: day(80), items: [{ id: 3, qty: 1, precio: 3 }] },
  { fecha: day(1), anulada: true, items: [{ id: 6, qty: 1, precio: 3 }] }
];
const keys = r => plain(r.rows.map(x => x.key));

test('30, 60 y 90 días: solo activos sin ventas (anuladas no cuentan), mayor stock primero', () => {
  assert.deepEqual(keys(api.buildReport(sales, products, { days: 30, now })), ['id:4', 'id:2', 'id:3', 'id:6']);
  assert.deepEqual(keys(api.buildReport(sales, products, { days: 60, now })), ['id:4', 'id:3', 'id:6']);
  assert.deepEqual(keys(api.buildReport(sales, products, { days: '90', now })), ['id:4', 'id:6']);
  assert.equal(api.buildReport(sales, products, { days: 60, now }).range.days, 60);
  assert.equal(api.buildReport(sales, products, { days: 45, now }).range.days, 30);
});

test('última venta en día de Lima y stock actual', () => {
  const r = api.buildReport(sales, products, { days: 30, now });
  const p2 = r.rows.find(x => x.key === 'id:2');
  assert.equal(p2.lastSale, '2026-08-31'); assert.equal(p2.stock, 8); assert.equal(p2.code, 'P-45');
  assert.equal(r.rows.find(x => x.key === 'id:4').lastSale, '');
  assert.equal(r.units, 23);
});

test('el valor solo existe con withValue (dueño); costo ausente = «Sin costo»', () => {
  const emp = api.buildReport(sales, products, { days: 30, now });
  assert.equal(emp.value, undefined);
  assert.ok(emp.rows.every(x => !('value' in x) && !('cost' in x)));
  assert.doesNotMatch(api.toCsv(emp), /Valor|Costo/);
  const own = api.buildReport(sales, products, { days: 30, now, withValue: true });
  assert.equal(own.value, 8 * 1.5 + 3 * 4 + 2 * 3);
  assert.equal(own.noCost, 1);
  const csv = api.toCsv(own).slice(1).split('\r\n');
  assert.equal(csv[0], 'Sin ventas del 16/09/2026 al 15/10/2026 (30 días) · hora de Lima');
  assert.equal(csv[1], 'Producto,Código,Stock actual,Última venta,Costo unitario,Valor inventario');
  assert.equal(csv[2], 'Nunca vendido,,10,Nunca,Sin costo,Sin costo');
  assert.equal(csv[3], 'Vendido hace 45 días,P-45,8,31/08/2026,1.50,12.00');
});

test('CSV protegido contra fórmulas', () => {
  const r = api.buildReport([], [{ id: 9, name: '=HYPERLINK("x")', stock: 1 }], { now });
  assert.ok(api.toCsv(r).includes(`"'=HYPERLINK(""x"")"`));
});

test('dueño en try/catch: si NA_ROLES falla o no es dueño, no hay acceso ni valor', () => {
  const unlocked = PERMISSIONS;
  assert.deepEqual(Array.from(PERMISSIONS.SCREENS.pageProductosSinMovimiento), ['owner']);
  assert.deepEqual(Array.from(PERMISSIONS.FEATURE_ROLES['productos-sin-movimiento']), ['owner']);
  assert.equal(PERMISSIONS.featureLocked('productos-sin-movimiento'), false);
  for (const roles of [undefined, { isOwner: () => false }, { isOwner() { throw new Error('x'); } }]) {
    assert.equal(context({ NA_ROLES: roles, NA_PERMISSIONS: unlocked }).NA_PRODUCTOS_SIN_MOVIMIENTO.available(), false);
  }
  assert.equal(context({ NA_ROLES: { isOwner: () => true }, NA_PERMISSIONS: unlocked }).NA_PRODUCTOS_SIN_MOVIMIENTO.available(), true);
  assert.equal(context({ NA_ROLES: { isOwner: () => true }, NA_PERMISSIONS: { ...unlocked, featureLocked: () => true } }).NA_PRODUCTOS_SIN_MOVIMIENTO.available(), false);
});

test('solo lectura: sin red, almacenamiento ni innerHTML; precache y página presentes', () => {
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon|Storage|indexedDB|\.innerHTML\s*=|\b(?:POST|PUT|PATCH|DELETE)\b/);
  const html = read('POS/index.html'), sw = read('POS/sw.js');
  assert.match(html, /id="pageProductosSinMovimiento"/);
  for (const a of ['css/productos-sin-movimiento.css', 'js/modules/productos-sin-movimiento.js']) { assert.ok(html.includes(a)); assert.ok(sw.includes("'./" + a + "'")); }
});

// Formato real del POS (saleItems de procesarVenta): id = productoId = id del producto; caja con unitsPerQty.
test('formato real del POS: una venta por caja cuenta como movimiento; anulada no', () => {
  const item = (id, extra = {}) => ({ id, productoId: id, sku: '', name: 'X', nombre: 'X', qty: 1, cantidad: 1, precio: 50, precioUnitario: 50, subtotal: 50, unitsPerQty: 1, ventaModo: 'unidad', modo: 'minorista', ...extra });
  const prods = [{ id: 1700000000001, name: 'Caja vendida', stock: 5 }, { id: 1700000000002, name: 'Solo anulada', stock: 5 }];
  const real = [
    { id: 'V-1', fecha: day(3), timestamp: day(3), items: [item(1700000000001, { qty: 2, unitsPerQty: 12, ventaModo: 'caja', modo: 'mayorista' })] },
    { id: 'V-2', fecha: day(2), anulada: true, items: [item(1700000000002)] }
  ];
  assert.deepEqual(keys(api.buildReport(real, prods, { days: 30, now })), ['id:1700000000002']);
  assert.equal(api.buildReport(real, prods, { days: 30, now }).rows[0].lastSale, '', 'la venta anulada no cuenta como última venta');
});

test('ajustes de inventario (merma/corrección, Misión 7) no cuentan como venta ni movimiento de venta', () => {
  const adj = t => 'ajuste:v1:' + JSON.stringify({ t, u: { n: 'Ana · "C" | 1', i: 'C-1' }, n: 'x' });
  const movements = [
    { id: 'a1', productId: 4, type: 'SALIDA', delta: -3, reason: adj('merma'), source: 'ADJUSTMENT', timestamp: day(1) },
    { id: 'a2', productId: 4, type: 'ENTRADA', delta: 2, reason: adj('correccion'), source: 'ADJUSTMENT', timestamp: day(1) }
  ];
  const ctx = context({ inventoryMovements: movements });
  assert.deepEqual(keys(ctx.NA_PRODUCTOS_SIN_MOVIMIENTO.buildReport(sales, products, { days: 30, now, movements })), ['id:4', 'id:2', 'id:3', 'id:6']);
  assert.doesNotMatch(source, /inventoryMovements/, 'solo lee ventas');
});

test('#854: stock inmovilizado = solo stock > 0 por defecto; «Incluir sin stock» muestra stock ≤ 0', () => {
  const prods = [
    { id: 11, name: 'Con stock', stock: 3, costo: 2 },
    { id: 12, name: 'Stock cero', stock: 0, costo: 2 },
    { id: 13, name: 'Stock negativo', stock: -4, costo: 2 },
    { id: 14, name: 'Stock vacío', stock: '', costo: 2 },
    { id: 15, name: 'Stock decimal', stock: '0,5', costo: 2 }
  ];
  const def = api.buildReport([], prods, { now, withValue: true });
  assert.deepEqual(plain(def.rows.map(r => [r.name, r.stock])), [['Con stock', 3], ['Stock decimal', 0.5]]);
  assert.equal(def.units, 3.5); assert.equal(def.value, 7);
  const all = api.buildReport([], prods, { now, withValue: true, includeNoStock: true });
  assert.deepEqual(plain(all.rows.map(r => r.name)), ['Con stock', 'Stock decimal', 'Stock cero', 'Stock vacío', 'Stock negativo']);
  assert.equal(all.units, 3.5, 'el stock negativo no resta unidades');
  assert.equal(all.value, 7, 'el stock ≤ 0 no suma valor');
  assert.equal(api.toCsv(def).includes('Stock cero'), false);
});

test('O4 (#892): un costo 0 real se muestra 0.00 y suma 0; ausente/null/vacío = «Sin costo»', () => {
  const rows = [{ id: 10, name: 'Cero', stock: 4, costo: 0 }, { id: 11, name: 'Cero texto', stock: 1, costo: '0' },
    { id: 12, name: 'Nulo', stock: 2, costo: null }, { id: 13, name: 'Vacio', stock: 2, costo: '' }, { id: 14, name: 'Normal', stock: 2, costo: 1.25 }];
  const r = api.buildReport([], rows, { days: 30, now, withValue: true });
  const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
  assert.equal(by.Cero.cost, 0); assert.equal(by.Cero.value, 0);
  assert.equal(by['Cero texto'].cost, 0);
  assert.equal(by.Nulo.cost, null); assert.equal(by.Vacio.cost, null);
  assert.equal(r.noCost, 2);
  assert.equal(r.value, 2.5);
  const csv = api.toCsv(r);
  assert.match(csv, /Cero,,4,Nunca,0\.00,0\.00/);
  assert.match(csv, /Nulo,,2,Nunca,Sin costo,Sin costo/);
});
