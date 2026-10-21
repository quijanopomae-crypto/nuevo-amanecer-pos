import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PERMISSIONS } from '../../tools/cloudflare-lab/src/pos-permissions.js';

// Misión 6: sugerencia de compra. Datos sintéticos.
const read = p => readFileSync(p, 'utf8');
const source = read('POS/js/modules/sugerencia-compra.js');
function context(extra = {}) {
  const ctx = vm.createContext(extra);
  for (const f of ['POS/js/modules/rotacion-abc.js', 'POS/js/inventory/historial-compras.js']) vm.runInContext(read(f), ctx);
  vm.runInContext(source, ctx);
  return ctx;
}
const api = context().NA_SUGERENCIA_COMPRA;
const plain = v => JSON.parse(JSON.stringify(v));
const now = '2026-10-16T04:59:59Z'; // 15/10/2026 en Lima
const ago = n => new Date(Date.parse('2026-10-15T12:00:00-05:00') - n * 86400000).toISOString();
const products = [
  { id: 1, name: 'Arroz', stock: 2, stockMin: 5, costo: 3, proveedor: 'Distribuidora Sol' },
  { id: 2, name: 'Azúcar', stock: 20, stockMin: 5, costo: 2 },             // proveedor desde movimientos
  { id: 3, name: 'Aceite', stock: 1, stockMin: 0 },                        // sin proveedor, sin costo (ausente, #892)
  { id: 4, name: 'Sobrado', stock: 50, stockMin: 5 },                        // no se pide
  { id: 5, name: 'Inactivo', stock: 0, stockMin: 10, activo: false },
  { id: 6, name: 'Servicio', stock: 0, stockMin: 3, controlInventario: false }
];
const sales = [
  { fecha: ago(3), items: [{ id: 1, qty: 4, precio: 5 }, { id: 2, qty: 30, precio: 3 }, { id: 3, qty: 2.5, precio: 9 }] },
  { fecha: ago(40), items: [{ id: 1, qty: 100, precio: 5 }] },              // fuera de 30 días
  { fecha: ago(2), anulada: true, items: [{ id: 4, qty: 999, precio: 1 }] } // anulada
];
const movements = [{ movement_id: 'm1', type: 'ENTRADA', reason: 'Compra a proveedor', source: 'OCR_PURCHASE', operation_id: 'op1', product_id: '2', quantity: 10, supplier: 'Mayorista Norte', created_at: ago(20) }];

test('sugerido = ⌈mínimo + vendido 30 días − stock⌉, nunca negativo', () => {
  assert.equal(api.suggest(5, 4, 2), 7);
  assert.equal(api.suggest(0, 2.5, 1), 2);
  assert.equal(api.suggest(5, 0, 50), 0);
  assert.equal(api.suggest(5, 0, -3), 5, 'stock negativo cuenta como 0');
});

test('agrupa por proveedor (ficha o última compra), excluye inactivos, servicios, anuladas y ventas viejas', () => {
  const plan = api.buildSuggestion(sales, products, { now, movements });
  assert.deepEqual(plain(plan.range), { days: 30, from: '2026-09-16', to: '2026-10-15' });
  assert.deepEqual(plain(plan.groups.map(g => [g.supplier, g.rows.map(r => [r.name, r.sold30, r.suggested])])), [
    ['Distribuidora Sol', [['Arroz', 4, 7]]],
    ['Mayorista Norte', [['Azúcar', 30, 15]]],
    ['Sin proveedor registrado', [['Aceite', 2.5, 2]]]
  ]);
});

test('editable: la cantidad editada manda en totales y CSV; 0 no se exporta', () => {
  const plan = api.buildSuggestion(sales, products, { now, movements });
  plan.groups[0].rows[0].qty = 10;
  plan.groups[2].rows[0].qty = 0;
  assert.deepEqual(plain(api.totals(plan.groups)), { lines: 2, units: 25, cost: 60, noCost: 0 });
  const lines = api.toCsv(plan).slice(1).trim().split('\r\n');
  assert.equal(lines[0], 'Ventas del 16/09/2026 al 15/10/2026 (30 días) · hora de Lima');
  assert.equal(lines[1], 'Proveedor,Producto,Código,Stock,Stock mínimo,Vendido 30 días,Sugerido,Cantidad a pedir,Costo unitario,Costo estimado');
  assert.equal(lines[2], 'Distribuidora Sol,Arroz,,2,5,4,7,10,3.00,30.00');
  assert.equal(lines[3], 'Mayorista Norte,Azúcar,,20,5,30,15,15,2.00,30.00');
  assert.equal(lines.length, 4);
  assert.equal(api.clampQty('-4'), 0); assert.equal(api.clampQty('7.9'), 7); assert.equal(api.clampQty('x'), 0);
});

test('CSV protegido contra fórmulas', () => {
  const plan = api.buildSuggestion([], [{ id: 9, name: '=CMD()', stock: 0, stockMin: 1, proveedor: '+Prov' }], { now });
  const csv = api.toCsv(plan);
  assert.ok(csv.includes("'+Prov,'=CMD()"));
});

test('solo dueño con isOwner en try/catch; bloqueo y política fallan cerrados', () => {
  assert.deepEqual(Array.from(PERMISSIONS.SCREENS.pageSugerenciaCompra), ['owner']);
  assert.deepEqual(Array.from(PERMISSIONS.FEATURE_ROLES['sugerencia-compra']), ['owner']);
  assert.equal(PERMISSIONS.featureLocked('sugerencia-compra'), false);
  for (const roles of [undefined, { isOwner: () => false }, { isOwner() { throw new Error('x'); } }]) assert.equal(context({ NA_ROLES: roles, NA_PERMISSIONS: PERMISSIONS }).NA_SUGERENCIA_COMPRA.available(), false);
  assert.equal(context({ NA_ROLES: { isOwner: () => true }, NA_PERMISSIONS: PERMISSIONS }).NA_SUGERENCIA_COMPRA.available(), true);
  assert.equal(context({ NA_ROLES: { isOwner: () => true }, NA_PERMISSIONS: { ...PERMISSIONS, featureLocked: () => true } }).NA_SUGERENCIA_COMPRA.available(), false);
});

test('solo lectura y assets: sin red, almacenamiento ni innerHTML', () => {
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon|Storage|indexedDB|\.innerHTML\s*=|\b(?:POST|PUT|PATCH|DELETE)\b/);
  const html = read('POS/index.html'), sw = read('POS/sw.js');
  assert.match(html, /id="pageSugerenciaCompra"/);
  for (const a of ['css/sugerencia-compra.css', 'js/modules/sugerencia-compra.js']) { assert.ok(html.includes(a)); assert.ok(sw.includes("'./" + a + "'")); }
});

// Ventas con el formato real del POS (inline-02: saleItems de procesarVenta).
const posItem = (product, qty, extra = {}) => ({ id: product.id, productoId: product.id, sku: product.sku || '', name: product.name, nombre: product.name, qty, cantidad: qty, precio: 5, precioUnitario: 5, subtotal: 5 * qty, unitsPerQty: 1, ventaModo: 'unidad', modo: 'minorista', ...extra });
test('formato real del POS: venta por caja multiplica por unitsPerQty; id = productoId; anuladas fuera', () => {
  const caja = { id: 1700000000001, name: 'Galleta caja', stock: 10, stockMin: 6, costo: 1, proveedor: 'Prov A' };
  const realSales = [
    { id: 'V-1', fecha: ago(5), timestamp: ago(5), items: [posItem(caja, 2, { unitsPerQty: 12, ventaModo: 'caja', modo: 'mayorista', precio: 50 }), posItem(caja, 3)] },
    { id: 'V-2', fecha: ago(4), anulada: true, items: [posItem(caja, 100)] }
  ];
  const row = api.buildSuggestion(realSales, [caja], { now }).groups[0].rows[0];
  assert.equal(row.sold30, 27, '2 cajas × 12 + 3 unidades');
  assert.equal(row.suggested, 6 + 27 - 10);
  // Línea con id distinto del productoId (defensivo): manda productoId.
  const odd = [{ fecha: ago(1), items: [{ id: 'LINEA-9', productoId: caja.id, qty: 4 }] }];
  assert.equal(api.buildSuggestion(odd, [{ ...caja, stock: 0 }], { now }).groups[0].rows[0].sold30, 4);
});

test('ajustes (Misión 7): una merma no suma a vendidos 30 d ni sube la sugerencia; tampoco es compra/proveedor', () => {
  const adj = t => 'ajuste:v1:' + JSON.stringify({ t, u: { n: 'Compra «Sol» · "X" | 1', i: 'C-1' }, n: 'compra' });
  const base = [{ id: 7, name: 'Leche', stock: 3, stockMin: 2, costo: 3 }];
  const ventas = [{ fecha: ago(2), items: [{ id: 7, productoId: 7, qty: 4, precio: 5 }] }];
  const mermas = [
    { movement_id: 'm1', product_id: '7', productId: 7, type: 'SALIDA', delta: -5, quantity: -5, reason: adj('merma'), source: 'ADJUSTMENT', created_at: ago(1), timestamp: ago(1) },
    { movement_id: 'm2', product_id: '7', productId: 7, type: 'ENTRADA', delta: 1, quantity: 1, reason: adj('correccion'), source: 'ADJUSTMENT', created_at: ago(1), timestamp: ago(1), supplier: 'No es proveedor' }
  ];
  const sin = api.buildSuggestion(ventas, base, { now, movements: [] }).groups[0].rows[0];
  const con = api.buildSuggestion(ventas, base, { now, movements: mermas }).groups;
  assert.equal(sin.sold30, 4);
  assert.equal(con[0].rows[0].sold30, 4);
  assert.equal(con[0].rows[0].suggested, sin.suggested, 'misma sugerencia con el mismo stock');
  assert.equal(con[0].supplier, api.NO_SUPPLIER);
});

test('#855: las cantidades editadas (por producto) se reaplican al recalcular; sugerido no cambia', () => {
  const edits = new Map([['id:1', 12], ['id:3', 0], ['id:99', 5]]);
  const plan = api.buildSuggestion(sales, products, { now, movements, edits });
  assert.deepEqual(plain(plan.groups.map(g => g.rows.map(r => [r.key, r.suggested, r.qty]))), [
    [['id:1', 7, 12]], [['id:2', 15, 15]], [['id:3', 2, 0]]
  ]);
  assert.deepEqual(plain(api.totals(plan.groups)), { lines: 2, units: 27, cost: 66, noCost: 0 });
  // También acepta un objeto y acota la cantidad editada.
  const obj = api.buildSuggestion(sales, products, { now, movements, edits: { 'id:1': '7.9', 'id:2': -3 } });
  assert.deepEqual(plain(obj.groups.map(g => g.rows[0].qty)), [7, 0, 2]);
  // Sin ediciones queda la sugerencia.
  assert.deepEqual(plain(api.buildSuggestion(sales, products, { now, movements }).groups.map(g => g.rows[0].qty)), [7, 15, 2]);
  assert.equal(typeof api.resetQuantities, 'function');
});

test('O4 (#892): costo 0 real = 0.00 (conocido); ausente, null o vacío = «Sin costo»', () => {
  const rows = [{ id: 21, name: 'Cero', stock: 0, stockMin: 2, costo: 0 }, { id: 22, name: 'Nulo', stock: 0, stockMin: 2, costo: null },
    { id: 23, name: 'Vacio', stock: 0, stockMin: 2, costo: '' }, { id: 24, name: 'Ausente', stock: 0, stockMin: 2 }];
  const plan = api.buildSuggestion([], rows, { now });
  const by = Object.fromEntries(plan.groups.flatMap((g) => g.rows).map((r) => [r.name, r.cost]));
  assert.deepEqual(plain(by), { Cero: 0, Nulo: null, Vacio: null, Ausente: null });
  assert.deepEqual(plain(api.totals(plan.groups)), { lines: 4, units: 8, cost: 0, noCost: 3 });
  const csv = api.toCsv(plan);
  assert.match(csv, /,Cero,,0,2,0,2,2,0\.00,0\.00/);
  assert.match(csv, /,Ausente,,0,2,0,2,2,Sin costo,Sin costo/);
});
