import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('POS/js/modules/dashboard-compras.js', 'utf8');
const permissionsSource = readFileSync('POS/js/config/pos-permissions.js', 'utf8');
function load(extra = {}) {
  const context = vm.createContext({ module: { exports: {} }, ...extra });
  vm.runInContext(source, context);
  return context.module.exports;
}
const DC = load();
const months = { current: '2026-10', previous: '2026-09' };
const products = [{ id: 'a', name: 'Arroz', cat: 'Abarrotes' }, { id: 'b', name: 'Leche', cat: 'Lácteos' }, { id: 'c', name: 'Pan' }];
const purchases = [
  { purchase_id: 'p1', status: 'aplicada', supplier: 'Alicorp', created_at: '2026-10-02T10:00:00Z', lines: [{ line_number: 0, product_id: 'a', quantity: 10, unit_cost_cents: 350 }, { line_number: 1, product_id: 'b', quantity: 2, unit_cost_cents: 425 }] },
  { purchase_id: 'p2', status: 'aplicada', supplier: 'Gloria', created_at: '2026-09-15 09:00:00', lines: [{ line_number: 0, product_id: 'b', quantity: 4, unit_cost_cents: 400 }] },
  // 1 de octubre 03:00 UTC = 30 de septiembre 22:00 en Lima
  { purchase_id: 'p3', status: 'aplicada', supplier: 'alicorp', created_at: '2026-10-01T03:00:00Z', lines: [{ line_number: 0, product_id: 'a', quantity: 5, unit_cost_cents: 300 }] },
  { purchase_id: 'p4', status: 'en_curso', supplier: 'X', created_at: '2026-10-03T12:00:00Z', lines: [{ line_number: 0, product_id: 'a', quantity: 99, unit_cost_cents: 100 }, { line_number: 1, product_id: 'c', quantity: 1, unit_cost_cents: 1000 }] },
  { purchase_id: 'p5', status: 'aplicada', supplier: 'Viejo', created_at: '2026-08-20T12:00:00Z', lines: [{ line_number: 0, product_id: 'a', quantity: 1, unit_cost_cents: 99999 }] },
  { purchase_id: 'p6', status: 'aplicada', supplier: '', created_at: '2026-10-04T12:00:00Z', lines: [{ line_number: 0, product_id: 'c', quantity: 3, unit_cost_cents: null }] }
];
// p4 línea 1 confirmada por movimiento; movimiento local adicional sin compra de servidor.
const movements = [
  { movement_type: 'ENTRADA', source: 'OCR_PURCHASE', operation_id: 'p4:1', product_id: 'c', quantity: 1 },
  { movement_type: 'ENTRADA', reason: 'Compra local', id: 'm9', product_id: 'c', quantity: 2, unit_cost_cents: 150, fecha: '2026-10-10', supplier: 'Bodega' },
  { movement_type: 'SALIDA', reason: 'Venta', id: 'm10', product_id: 'a', quantity: 2, unit_cost_cents: 100, fecha: '2026-10-10' }
];

test('meses en hora de Lima, cruce de año', () => {
  assert.deepEqual({ ...DC.months(Date.parse('2026-11-01T03:00:00Z')) }, { current: '2026-10', previous: '2026-09' });
  assert.deepEqual({ ...DC.months(Date.parse('2027-01-01T06:00:00Z')) }, { current: '2027-01', previous: '2026-12' });
  assert.equal(DC.limaMonth('2026-10-01T03:00:00Z'), '2026-09');
  assert.equal(DC.limaMonth('2026-10-01 00:30:00'), '2026-10');
});

test('totales, número de compras y % de cambio', () => {
  const r = DC.calculate(purchases, movements, products, { months });
  // Octubre: p1 3500+850, p4 línea confirmada 1000, p6 sin costo, m9 300
  assert.equal(r.current.totalCents, 5650);
  assert.equal(r.current.count, 4);          // p1, p4, p6, m9
  assert.equal(r.current.linesWithoutCost, 1);
  // Septiembre: p2 1600 + p3 1500
  assert.equal(r.previous.totalCents, 3100);
  assert.equal(r.previous.count, 2);
  assert.equal(r.excludedLines, 1);
  assert.equal(Math.round(r.totalChange * 1000) / 1000, 0.823);
  assert.equal(r.countChange, 1);
});

test('agrupa por producto, categoría y proveedor (sin mayúsculas ni tildes)', () => {
  const r = DC.calculate(purchases, movements, products, { months });
  assert.deepEqual(JSON.parse(JSON.stringify(r.products.map(p => [p.label, p.current, p.previous]))), [['Arroz', 3500, 1500], ['Pan', 1300, 0], ['Leche', 850, 1600]]);
  assert.equal(r.products[1].change, null);
  assert.deepEqual(Array.from(r.categories, c => c.label), ['Abarrotes', 'Sin categoría', 'Lácteos']);
  const sup = Object.fromEntries(r.suppliers.map(s => [s.label, [s.current, s.previous]]));
  assert.deepEqual([...sup.Alicorp], [4350, 1500]);
  assert.deepEqual([...sup.Gloria], [0, 1600]);
  assert.deepEqual([...sup.Bodega], [300, 0]);
  assert.equal(sup.Viejo, undefined);
});

test('formato #872 y % de cambio', () => {
  assert.equal(DC.formatMoney(123450), 'S/ 1,234.50');
  assert.equal(DC.formatMoney(123456789), 'S/ 1,234,567.89');
  assert.equal(DC.formatChange(0.5), '+50.0%');
  assert.equal(DC.formatChange(-0.25), '-25.0%');
  assert.equal(DC.formatChange(0), '0.0%');
  assert.equal(DC.formatChange(null), 'Nuevo');
});

test('datos vacíos o basura no fallan y no se modifican', () => {
  const r = DC.calculate(null, undefined, 'x', { months });
  assert.equal(r.current.totalCents, 0); assert.equal(r.totalChange, 0); assert.equal(r.products.length, 0);
  const before = JSON.stringify([purchases, movements, products]);
  DC.calculate(purchases, movements, products, { months });
  assert.equal(JSON.stringify([purchases, movements, products]), before);
});

test('isOwner falla cerrado', () => {
  assert.equal(load().isOwner(), false);
  assert.equal(load({ NA_ROLES: {} }).isOwner(), false);
  assert.equal(load({ NA_ROLES: { isOwner: true } }).isOwner(), false);
  assert.equal(load({ NA_ROLES: { isOwner() { throw new Error('x'); } } }).isOwner(), false);
  assert.equal(load({ NA_ROLES: { isOwner: () => 'true' } }).isOwner(), false);
  assert.equal(load({ NA_ROLES: { isOwner: () => false } }).isOwner(), false);
  assert.equal(load({ NA_ROLES: { isOwner: () => true } }).isOwner(), true);
});

test('módulo sin innerHTML y sin escrituras', () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(source, /setItem|removeItem|'POST'|"POST"|indexedDB/);
});

test('permisos: candado sigue cerrado y la pantalla es solo dueño', () => {
  const c = vm.createContext({ module: { exports: {} } });
  vm.runInContext(permissionsSource, c);
  const P = c.NA_PERMISSIONS;
  assert.equal(P.FEATURE_LOCKS['dashboard-compras'], true);
  assert.equal(P.canAccessScreen('owner', 'pageDashboardCompras'), true);
  assert.equal(P.canAccessScreen('empleado', 'pageDashboardCompras'), false);
  assert.equal(P.canAccessScreen('', 'pageDashboardCompras'), false);
});
