import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('POS/js/modules/punto-equilibrio.js', 'utf8');
const permissionsSource = readFileSync('POS/js/config/pos-permissions.js', 'utf8');
function load(extra = {}) {
  const context = vm.createContext({ module: { exports: {} }, ...extra });
  vm.runInContext(source, context);
  return context.module.exports;
}
const PE = load();
const range = PE.monthRange('2026-10');
const products = [{ id: 1, name: 'A', costo: 6 }, { id: 2, name: 'B', costo: 0 }];
const sales = [
  { fecha: '2026-10-05', items: [{ id: 1, qty: 10, precio: 10, costo: 6 }] },
  { fecha: '2026-10-06', items: [{ id: 1, qty: 5, precio: 10 }] },                 // costo actual del producto
  { fecha: '2026-10-07', anulada: true, items: [{ id: 1, qty: 100, precio: 10 }] }, // anulada
  { fecha: '2026-09-30', items: [{ id: 1, qty: 100, precio: 10 }] },               // fuera del mes
  { timestamp: '2026-11-01T03:00:00Z', items: [{ id: 1, qty: 1, precio: 50, costo: 1 }] } // 31/10 22:00 en Lima
];
const expenses = [
  { fecha: '2026-10-01', monto: 30, cat: 'Servicios' },
  { fecha: '2026-10-02', monto: '10,50', cat: 'Personal' },
  { fecha: '2026-10-03', monto: 500, cat: 'Proveedor' },
  { fecha: '2026-10-04', monto: 99, cat: 'Otro', voided: true },
  { fecha: '2026-11-01', monto: 99, cat: 'Otro' }
];

test('monthRange: mes completo, por defecto el mes actual en hora de Lima', () => {
  assert.deepEqual({ ...range }, { month: '2026-10', from: '2026-10-01', to: '2026-10-31' });
  assert.equal(PE.monthRange('2024-02').to, '2024-02-29');
  assert.equal(PE.monthRange('', Date.parse('2026-11-01T03:00:00Z')).month, '2026-10');
  assert.equal(PE.monthRange('basura', Date.parse('2026-11-01T06:00:00Z')).month, '2026-11');
});

test('calcula ventas, costo, gastos, margen y venta mínima', () => {
  const r = PE.calculate(sales, expenses, products, { range });
  assert.equal(r.sales, 200);         // 100 + 50 + 50
  assert.equal(r.cost, 91);           // 60 + 30 + 1
  assert.equal(r.expenses, 40.5);     // sin Proveedor ni anulados
  assert.equal(r.excludedExpenses, 500);
  assert.equal(r.margin, 0.545);
  assert.equal(r.breakEven, 74.31);   // 40.5 / 0.545
  assert.equal(r.difference, 125.69);
  assert.equal(r.status, 'ok');
  assert.equal(r.saleCount, 3);
  assert.equal(r.linesWithoutCost, 0);
});

test('estados: sin ventas, margen 0 o negativo, líneas sin costo', () => {
  assert.equal(PE.calculate([], expenses, products, { range }).status, 'sin-ventas');
  assert.equal(PE.calculate(null, null, null, { range }).breakEven, null);
  const loss = PE.calculate([{ fecha: '2026-10-05', items: [{ id: 1, qty: 1, precio: 5, costo: 6 }] }], expenses, products, { range });
  assert.equal(loss.status, 'margen-negativo'); assert.equal(loss.breakEven, null);
  const zero = PE.calculate([{ fecha: '2026-10-05', items: [{ id: 1, qty: 1, precio: 6, costo: 6 }] }], [], products, { range });
  assert.equal(zero.status, 'margen-negativo');
  const noCost = PE.calculate([{ fecha: '2026-10-05', items: [{ id: 2, qty: 2, precio: 5 }] }], [], products, { range });
  assert.equal(noCost.linesWithoutCost, 1); assert.equal(noCost.status, 'ok'); assert.equal(noCost.breakEven, 0);
  const below = PE.calculate([{ fecha: '2026-10-05', items: [{ id: 1, qty: 1, precio: 10, unitsPerQty: 1 }] }], [{ fecha: '2026-10-05', monto: 8 }], products, { range });
  assert.equal(below.breakEven, 20); assert.equal(below.difference, -10);
});

test('unidades por paquete multiplican el costo, no el importe', () => {
  const r = PE.calculate([{ fecha: '2026-10-05', items: [{ id: 1, qty: 2, precio: 50, costo: 2, unitsPerQty: 12 }] }], [], [], { range });
  assert.equal(r.sales, 100); assert.equal(r.cost, 48);
});

test('dinero con el formato del comprobante (#872)', () => {
  assert.equal(PE.formatMoney(1234567.891), 'S/ 1,234,567.89');
  assert.equal(PE.formatMoney(-10), '-S/ 10.00');
  assert.equal(PE.formatPercent(0.545), '54.5%');
});

test('el cálculo no modifica los datos de entrada', () => {
  const before = JSON.stringify([sales, expenses, products]);
  PE.calculate(sales, expenses, products, { range });
  assert.equal(JSON.stringify([sales, expenses, products]), before);
});

test('rol: sin NA_ROLES, con error o no dueño no hay render; módulo sin innerHTML', () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(source, /roles\.isOwner\(\) === true\); } catch \(_\) \{ return false; \}/);
});

test('permisos: sigue bloqueada hasta que PROGRAMADOR la desbloquee; pantalla solo dueño; sin FEATURE_ROLES', () => {
  const c = vm.createContext({ module: { exports: {} } });
  vm.runInContext(permissionsSource, c);
  const P = c.NA_PERMISSIONS;
  assert.equal(P.FEATURE_LOCKS['punto-equilibrio'], true, 'se desbloquea al final, junto con las demás');
  assert.equal(P.FEATURE_ROLES['punto-equilibrio'], undefined, 'sin entrada: ausencia = solo dueño');
  // Al desbloquear (true -> false), la ruta pasa a solo dueño por ausencia en FEATURE_ROLES.
  vm.runInContext("NA_PERMISSIONS.FEATURE_LOCKS['punto-equilibrio'] = false", c);
  if (!P.featureLocked('punto-equilibrio')) assert.deepEqual(Array.from(P.routeRoles('/features/punto-equilibrio', 'GET')), ['owner']);
  assert.equal(P.canAccessScreen('owner', 'pagePuntoEquilibrio'), true);
  assert.equal(P.canAccessScreen('empleado', 'pagePuntoEquilibrio'), false);
  assert.equal(P.canAccessScreen('', 'pagePuntoEquilibrio'), false);
});

test('usa el total de la venta (con descuentos) cuando existe', () => {
  const sales = [
    { fecha: '2026-10-05', total: 90, items: [{ id: 1, qty: 10, precio: 10, costo: 6 }] },
    { fecha: '2026-10-06', items: [{ id: 1, qty: 1, precio: 10, costo: 6 }] }
  ];
  const r = PE.calculate(sales, [], products, { range });
  assert.equal(r.sales, 100);
});
