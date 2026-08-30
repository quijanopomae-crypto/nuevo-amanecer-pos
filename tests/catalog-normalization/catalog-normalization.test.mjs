// CATALOG NORMALIZATION V1 — nombres en MAYÚSCULAS + trim + espacios internos simples.
// Base 976bc93. Contrato:
//   NAMES_NORMALIZED        _naNormCatalogName: MAYÚSCULAS, trim, un solo espacio interno,
//                           acentos/ñ preservados (formato, NO sinTildes), idempotente.
//   NEW/EDIT/IMPORT         misma regla en alta (guardarProd), edición (guardarProd con
//                           invEditId) e importación (winner _naNormalizeData, llamado por
//                           loadAllData, cargarCatalogoInicial y confirmProductImport).
//   INTEGRIDAD              id/stock/precio/costo/ledger/historial/impuestos intactos;
//                           solo cambia name. Cero duplicados introducidos.
// Instalación real: DOMContentLoaded de inline-01 (parsea primero ⇒ corre antes que el
// arranque de inline-03) envolviendo a los winners vigentes. Aquí se invoca directo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPosSandbox, json, POS_DIR } from './lib/sandbox.mjs';

const INLINE_01 = readFileSync(path.join(POS_DIR, 'js/legacy-inline/inline-01.js'), 'utf8');
const INLINE_02 = readFileSync(path.join(POS_DIR, 'js/legacy-inline/inline-02.js'), 'utf8');
const INLINE_03 = readFileSync(path.join(POS_DIR, 'js/legacy-inline/inline-03.js'), 'utf8');
const INDEX_HTML = readFileSync(path.join(POS_DIR, 'index.html'), 'utf8');

function fresh() {
  const sb = createPosSandbox();
  sb.seed();
  return sb;
}

function fillProductForm(sb, { id = null, name = 'Arroz', sku = 'ARROZ-1', stock = 0, controlInventario = true, costo = '5', precio = '50' } = {}) {
  sb.run(`invEditId=${JSON.stringify(id)};imagenProducto=null;`);
  const values = {
    pNombre: name, pDescripcion: '', pCosto: costo, pPrecio: precio, pSku: sku,
    pBarcode: '', pMarca: 'Marca', pUnidad: 'unidad', pUnidadCompra: 'unidad',
    pFactorCompra: '1', pCat: 'abarrotes', pIcon: '📦', pPrecioCaja: '',
    pUnidCaja: '', pStock: String(stock), pStockMin: '5', pVenc: '',
    pTipoImpuesto: 'gravado', pImpuestoComplementario: '',
  };
  for (const [field, value] of Object.entries(values)) sb.el(field).value = value;
  sb.el('pIncluyeIGV').checked = true;
  sb.el('pControlInventario').checked = controlInventario;
}

const RICH_PRODUCTS = [
  { id: 'P1', name: '  arroz   superior ', descripcion: 'grado 1', sku: 'ARROZ-1', barcode: '775001', codigosAlternativos: ['775009'], codigoAlternativo: '775009', cat: 'abarrotes', icon: '📦', imagen: null, costo: 4.5, precio: 6.5, precioCaja: 130, unidCaja: 24, stock: 48, stockMin: 5, venc: '2027-12-31', marca: 'Costeño', unidad: 'unidad', unidadCompra: 'caja', factorCompra: 24, incluyeIGV: true, tipoImpuesto: 'gravado', impuestoComplementario: '', controlInventario: true },
  { id: 'P2', name: 'atún\tfresco\nde  mar', descripcion: '', sku: 'ATUN-2', barcode: '', codigosAlternativos: [], codigoAlternativo: '', cat: 'abarrotes', icon: '🐟', imagen: null, costo: 10, precio: 15, precioCaja: null, unidCaja: null, stock: 0, stockMin: 2, venc: null, marca: 'Sin marca', unidad: 'unidad', unidadCompra: 'unidad', factorCompra: 1, incluyeIGV: false, tipoImpuesto: 'exonerado', impuestoComplementario: '', controlInventario: false },
  { id: 'P3', name: 'LECHE EVAPORADA IDEAL 400G', descripcion: 'lata', sku: 'LEC-3', barcode: '775003', codigosAlternativos: [], codigoAlternativo: '', cat: 'abarrotes', icon: '🥛', imagen: null, costo: 3.2, precio: 5, precioCaja: null, unidCaja: null, stock: 12, stockMin: 3, venc: null, marca: 'Ideal', unidad: 'unidad', unidadCompra: 'unidad', factorCompra: 1, incluyeIGV: true, tipoImpuesto: 'gravado', impuestoComplementario: '', controlInventario: true },
];

test('NAMES_NORMALIZED — MAYÚSCULAS + trim + espacio simple, idempotente, sin tocar contenido', () => {
  const sb = fresh();
  const norm = (v) => sb.run(`_naNormCatalogName(${JSON.stringify(v)})`);
  assert.equal(norm('  arroz   del campo '), 'ARROZ DEL CAMPO', 'trim + espacios internos simples + MAYÚSCULAS');
  assert.equal(norm('atún  fresco'), 'ATÚN FRESCO', 'acentos preservados');
  assert.equal(norm('caña'), 'CAÑA', 'ñ preservada');
  assert.equal(norm('LECHE\tEVAPORADA\nIDEAL'), 'LECHE EVAPORADA IDEAL', 'tabs/saltos colapsan a un espacio');
  assert.equal(norm('Coca-Cola 1.5L x12un'), 'COCA-COLA 1.5L X12UN', 'números y símbolos intactos');
  assert.equal(norm('ya EN mayúsculas'), 'YA EN MAYÚSCULAS');
  assert.equal(norm(''), '', 'vacío permanece vacío (la validación existente lo rechaza)');
  assert.equal(norm(null), '');
  // Idempotencia: norm(norm(x)) === norm(x)
  for (const sample of ['  arroz   del campo ', 'ATÚN\tfresco', 'LECHE IDEAL', 'x  y']) {
    assert.equal(norm(norm(sample)), norm(sample), `idempotente: ${JSON.stringify(sample)}`);
  }
});

test('WINNER — instalación envuelve a los winners reales y es idempotente', () => {
  const sb = fresh();
  assert.equal(sb.run('typeof _naNormCatalogName'), 'function');
  sb.run('_naInstallCatalogNameNorm()');
  assert.equal(sb.run('_naNormalizeData._naNameNorm'), true, '_naNormalizeData (winner inline-06→02) envuelto');
  assert.equal(sb.run('guardarProd._naNameNorm'), true, 'guardarProd (winner inline-07→02 en este harness) envuelto');
  const before = { normalize: sb.run('_naNormalizeData._naNameNorm'), guardar: sb.run('guardarProd._naNameNorm') };
  sb.run('_naInstallCatalogNameNorm()');
  assert.deepEqual({ normalize: sb.run('_naNormalizeData._naNameNorm'), guardar: sb.run('guardarProd._naNameNorm') }, before, 're-instalar no envuelve dos veces');
});

test('NEW_PRODUCT_NORMALIZATION — alta guarda el nombre normalizado', async () => {
  const sb = fresh();
  sb.run('_naInstallCatalogNameNorm()');
  fillProductForm(sb, { name: '  aceite   de  oliva\textra ', sku: 'ACE-9', stock: 10 });
  await sb.run('guardarProd()');
  const created = json(sb, 'productos[productos.length-1]');
  assert.equal(created.name, 'ACEITE DE OLIVA EXTRA');
  assert.equal(created.sku, 'ACE-9', 'sku tal como se escribió');
  assert.equal(created.precio, 50, 'precio intacto');
  assert.equal(created.costo, 5, 'costo intacto');
  assert.equal(created.stock, 10, 'stock respetado (ledger existente gestiona el alta)');
  assert.ok(created.id, 'id generado por el winner');
});

test('EDIT_NORMALIZATION — edición normaliza y conserva id/stock/ledger', async () => {
  const sb = fresh();
  sb.seedData('productos', [{ id: 'P1', name: 'Arroz Costeño', stock: 7, controlInventario: true, precio: 50, costo: 5, unidad: 'unidad', sku: 'ARROZ-1', barcode: '', codigosAlternativos: [], marca: 'Costeño' }]);
  sb.run('_naInstallCatalogNameNorm()');
  fillProductForm(sb, { id: 'P1', name: '  arroz   costeño ', sku: 'ARROZ-1', stock: 7, costo: '5', precio: '50' });
  await sb.run('guardarProd()');
  const edited = json(sb, 'productos[0]');
  assert.equal(edited.name, 'ARROZ COSTEÑO', 'nombre editado normalizado');
  assert.equal(edited.id, 'P1', 'id intacto');
  assert.equal(edited.stock, 7, 'stock intacto (delta 0)');
  assert.equal(json(sb, 'inventoryMovements.length'), 0, 'ledger intacto: sin stock delta no hay movimiento');
});

test('IMPORT_NORMALIZATION — winner _naNormalizeData cubre importación y arranque', () => {
  const sb = fresh();
  sb.seedData('productos', RICH_PRODUCTS);
  // La importación real (confirmProductImport) y el arranque llaman a _naNormalizeData
  // antes de persistir; el wrapper del winner aplica la misma regla ahí.
  sb.run('_naInstallCatalogNameNorm()');
  sb.run('_naNormalizeData()');
  assert.deepEqual(
    json(sb, 'productos.map(p=>p.name)'),
    ['ARROZ SUPERIOR', 'ATÚN FRESCO DE MAR', 'LECHE EVAPORADA IDEAL 400G'],
    'importación/arranque: nombres normalizados'
  );
  // Estaticidad del contrato de integración:
  assert.match(INLINE_03, /confirmProductImport[\s\S]*?_naNormalizeData\(\);const persistResult=await saveAllData\(\)/, 'confirmProductImport normaliza antes de persistir');
  assert.match(INLINE_01, /cargarCatalogoInicial[\s\S]*?_naNormalizeData\(\);invRender\(\)/, 'catálogo inicial normaliza tras aplicar');
  assert.match(INLINE_01, /document\.addEventListener\('DOMContentLoaded',_naInstallCatalogNameNorm\)/, 'instalación en DOMContentLoaded');
  // El orden de scripts garantiza que el handler de inline-01 corre antes que el de inline-03.
  assert.ok(INDEX_HTML.indexOf('inline-01.js') < INDEX_HTML.indexOf('inline-03.js'), 'inline-01 parsea antes que inline-03');
});

test('INTEGRIDAD — solo cambia name: id/stock/precio/costo/ledger/historial/impuestos intactos', () => {
  const sb = fresh();
  sb.seedData('productos', RICH_PRODUCTS);
  sb.seedData('ventas', [{ id: 'V-1', fecha: '2026-01-01', total: 13, metodo: 'efectivo', items: [{ id: 'P1', productoId: 'P1', name: 'arroz superior', nombre: 'arroz superior', qty: 2, cantidad: 2, precio: 6.5, precioUnitario: 6.5, subtotal: 13 }] }]);
  sb.seedData('inventoryMovements', [{ id: 'IM-1', productId: 'P1', type: 'ENTRADA', before: 0, delta: 48, after: 48, reason: 'inicial', source: 'INVENTORY_MOVE', referenceId: null, timestamp: '2026-01-01T10:00:00.000Z', fecha: '2026-01-01' }]);
  // Asentar el base primero: el delta exacto que introduce MI wrapper es name y nada más.
  sb.run('_naNormalizeData()');
  const before = sb.memoryState();
  sb.run('_naInstallCatalogNameNorm()');
  sb.run('_naNormalizeData()');
  const after = sb.memoryState();
  // 1) productos: deep-equal salvo name.
  assert.equal(after.productos.length, before.productos.length, 'sin duplicados introducidos');
  for (let i = 0; i < before.productos.length; i++) {
    const expectedName = before.productos[i].name.trim().replace(/\s+/g, ' ').toUpperCase();
    assert.deepEqual({ ...after.productos[i], name: null }, { ...before.productos[i], name: null }, `producto ${before.productos[i].id}: todo intacto salvo name`);
    assert.equal(after.productos[i].name, expectedName);
    assert.equal(after.productos[i].id, before.productos[i].id, 'id intacto');
    assert.equal(after.productos[i].stock, before.productos[i].stock, 'stock intacto');
    assert.equal(after.productos[i].precio, before.productos[i].precio, 'precio intacto');
    assert.equal(after.productos[i].costo, before.productos[i].costo, 'costo intacto');
    assert.equal(after.productos[i].tipoImpuesto, before.productos[i].tipoImpuesto, 'impuestos intactos');
    assert.equal(after.productos[i].incluyeIGV, before.productos[i].incluyeIGV, 'IGV intacto');
  }
  // 2) Idempotencia en runtime: segunda pasada no cambia nada.
  sb.run('_naNormalizeData()');
  assert.deepEqual(sb.memoryState(), after, 'segunda pasada idempotente');
  // 3) Historial y ledger literalmente intactos.
  assert.deepEqual(after.ventas, before.ventas, 'historial de ventas intacto (items.name originales)');
  assert.equal(after.ventas[0].items[0].name, 'arroz superior');
  assert.deepEqual(after.inventoryMovements, before.inventoryMovements, 'ledger intacto');
});

test('ZERO_DUPLICATES — nombres que colisionan tras normalizar NO se fusionan ni duplican', () => {
  const sb = fresh();
  sb.seedData('productos', [
    { id: 'P1', name: 'arroz', sku: 'A-1', barcode: '111', stock: 1, precio: 5, costo: 2, unidad: 'unidad' },
    { id: 'P2', name: 'ARROZ  ', sku: 'A-2', barcode: '222', stock: 2, precio: 6, costo: 3, unidad: 'unidad' },
  ]);
  sb.run('_naInstallCatalogNameNorm()');
  sb.run('_naNormalizeData()');
  const names = json(sb, 'productos.map(p=>p.name)');
  const ids = json(sb, 'productos.map(p=>p.id)');
  const skus = json(sb, 'productos.map(p=>p.sku)');
  assert.deepEqual(names, ['ARROZ', 'ARROZ'], 'ambos normalizan al mismo nombre visible');
  assert.deepEqual(ids, ['P1', 'P2'], 'identidad (id) conservada: cero duplicados introducidos');
  assert.deepEqual(skus, ['A-1', 'A-2'], 'skus distintos conservados');
  // La identidad del winner sigue siendo por código, no por nombre:
  assert.match(INLINE_02, /_naFindCodeOwner\(code,invEditId\)/, 'el winner valida códigos, no nombres');
});
