// CATALOG V2A — BARCODE CORE (base c296856).
// Contrato del owner: 1 principal + 6 alternativos = 7 códigos en escritura nueva;
// histórico nunca se pierde (A→B, A→B→C, A→B→C→A); un código jamás pertenece a dos
// productos; legacy 8-10 sigue legible/restaurable/buscable; id/stock/precio/costo/
// ledger/historial/impuestos intactos. Tests de COMPORTAMIENTO sobre los winners reales
// (guardarProd, _naBuildProductImportPlan/confirmProductImport, posAddBySku, backup).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPosSandbox, json } from './lib/sandbox.mjs';

function fresh() {
  const sb = createPosSandbox();
  sb.seed();
  return sb;
}

function fillProductForm(sb, { id = null, name = 'ARROZ SUPERIOR', sku = 'ARROZ-1', barcode = '', stock = 0, costo = '5', precio = '50', controlInventario = true } = {}) {
  sb.run(`invEditId=${JSON.stringify(id)};imagenProducto=null;`);
  const values = {
    pNombre: name, pDescripcion: '', pCosto: costo, pPrecio: precio, pSku: sku,
    pBarcode: barcode, pMarca: 'Marca', pUnidad: 'unidad', pUnidadCompra: 'unidad',
    pFactorCompra: '1', pCat: 'abarrotes', pIcon: '📦', pPrecioCaja: '',
    pUnidCaja: '', pStock: String(stock), pStockMin: '5', pVenc: '',
    pTipoImpuesto: 'gravado', pImpuestoComplementario: '',
  };
  for (const [field, value] of Object.entries(values)) sb.el(field).value = value;
  sb.el('pIncluyeIGV').checked = true;
  sb.el('pControlInventario').checked = controlInventario;
}

// Escribe los inputs reales de códigos alternativos que lee readAltBarcodes().
function setAltFields(sb, codes) {
  sb.run(`(()=>{
    const list=document.getElementById('pAltCodesList');
    list.replaceChildren();
    ${JSON.stringify(codes)}.forEach(c=>{const input=document.createElement('input');input.classList.add('alt-code-input');input.value=c;list.appendChild(input);});
  })()`);
}

const seedProduct = (overrides = {}) => ({
  id: 'P1', name: 'ARROZ SUPERIOR', descripcion: '', sku: 'ARROZ-1', barcode: 'A',
  codigosAlternativos: [], codigoAlternativo: '', cat: 'abarrotes', icon: '📦', imagen: null,
  costo: 5, precio: 50, stock: 10, stockMin: 5, venc: null, marca: 'Marca', unidad: 'unidad',
  unidadCompra: 'unidad', factorCompra: 1, incluyeIGV: true, tipoImpuesto: 'gravado',
  impuestoComplementario: '', controlInventario: true, precioCaja: null, unidCaja: null,
  ...overrides,
});

// Headers de importación (alias reales de _NA_IMPORT_ALIASES tras _naHeader).
function importRows(rows) {
  const headers = ['nombre', 'sku', 'codigo de barras', 'codigos alternativos', 'precio', 'costo', 'stock', 'marca'];
  return [headers, ...rows.map(r => r.map(v => v ?? ''))];
}

async function runImport(sb, rows) {
  sb.run(`_naPendingProductImport={rows:${JSON.stringify(rows)},fileName:'test.csv',analyzedAt:Date.now()};`);
  await sb.run('confirmProductImport()');
}

const codesOf = (sb, idExpr) => json(sb, `(${idExpr}?[${idExpr}.barcode,..._naProductAltCodes(${idExpr})]:[])`);
const stripCodes = (p) => { const { barcode, codigosAlternativos, codigoAlternativo, ...rest } = p; return rest; };

// Snapshot v9 crudo para el sanitizador de respaldo (JSON round-trip DENTRO del vm para
// que los objetos queden en el mismo realm que _naIsPlainObject).
function buildRawSnapshot(sb) {
  sb.run(`_naV2Raw=JSON.parse(JSON.stringify({version:9,updatedAt:new Date().toISOString(),appConfig,ui:{currentPage:'pageMenu',isDark:false,currentCfgCategory:'negocio'},locks:_naGetLocks(),security:_naSecurity,data:{productos,ventas:[],clientes:[],creditos:[],gastos:[],cajMovs:[],cajEstado:{abierta:false,cerrada:true},cashClosures:[],inventoryMovements:[]},cart:[],draft:null}));`);
}

test('T1 — alta con solo código principal funciona; integridad base', async () => {
  const sb = fresh();
  fillProductForm(sb, { barcode: '775000000001', stock: 10 });
  setAltFields(sb, []);
  await sb.run('guardarProd()');
  const p = json(sb, 'productos[0]');
  assert.equal(p.barcode, '775000000001');
  assert.deepEqual(p.codigosAlternativos, []);
  assert.equal(p.codigoAlternativo, '');
  assert.equal(p.stock, 10, 'stock intacto');
  assert.equal(p.precio, 50); assert.equal(p.costo, 5);
  assert.ok(p.id);
});

test('T2 — 1 principal + 6 alternativos = 7 códigos en alta', async () => {
  const sb = fresh();
  fillProductForm(sb, { barcode: '775000000001', sku: 'ARROZ-1' });
  setAltFields(sb, ['775000000002', '775000000003', '775000000004', '775000000005', '775000000006', '775000000007']);
  await sb.run('guardarProd()');
  const p = json(sb, 'productos[0]');
  assert.equal(p.barcode, '775000000001');
  assert.equal(p.codigosAlternativos.length, 6);
  assert.equal(p.codigoAlternativo, '775000000002', 'espejo legacy = primer alternativo');
  assert.equal(codesOf(sb, 'productos[0]').length, 7);
});

test('T3 — código 8 bloqueado en escritura nueva (helper + import)', async () => {
  const sb = fresh();
  sb.seedData('productos', [seedProduct({ barcode: 'A', codigosAlternativos: ['A2', 'A3', 'A4', 'A5', 'A6', 'A7'], codigoAlternativo: 'A2' })]);
  const res = json(sb, "_naAddProductCode(productos[0],'A8')");
  assert.equal(res.ok, false); assert.equal(res.reason, 'CAP_7', '7 códigos ya ocupados');
  // import de producto NUEVO con 7 alternativos → solo 6 + advertencia
  const plan = json(sb, `_naBuildProductImportPlan(${JSON.stringify(importRows([['NUEVO', 'N-1', 'N1', 'N2 | N3 | N4 | N5 | N6 | N7 | N8', '10', '', '', '']]))})`);
  assert.equal(plan.actions[0].product.codigosAlternativos.length, 6, 'nuevo se limita a 6 alternativos');
  assert.ok(plan.warnings.some(w => /6 códigos alternativos/.test(w)), 'advertencia de tope en producto nuevo');
});

test('T4 — un código no puede pertenecer a dos productos', async () => {
  const sb = fresh();
  sb.seedData('productos', [seedProduct({ barcode: 'A', sku: 'ARROZ-1' })]);
  // alta con barcode ajeno → bloqueada
  fillProductForm(sb, { name: 'OTRO', sku: 'OTRO-1', barcode: 'A' });
  setAltFields(sb, []);
  await sb.run('guardarProd()');
  assert.equal(json(sb, 'productos.length'), 1, 'no se creó el duplicado');
  assert.match(sb.toastText(), /ya pertenece a/);
  // helper
  sb.seedData('productos', [seedProduct({ id: 'P2', name: 'SEGUNDO', sku: 'S-1', barcode: '' })]);
  const res = json(sb, "_naAddProductCode(productos[1],'a')");
  assert.equal(res.ok, false); assert.equal(res.reason, 'FOREIGN_OWNER', 'case-insensitive');
  // import con código ajeno → no crea un segundo dueño: la fila actualiza al dueño real.
  const plan = json(sb, `_naBuildProductImportPlan(${JSON.stringify(importRows([['TERCERO', 'T-1', 'A', '', '10', '', '', '']]))})`);
  assert.equal(plan.added, 0);
  assert.equal(plan.updated, 1, 'la fila que trae un código existente actualiza a su dueño');
  assert.equal(plan.skipped, 0);
  assert.equal(plan.actions[0].id, 'P1', 'se actualiza P1 (único dueño del código A)');
});

test('T5 — duplicado dentro del mismo producto bloqueado/dedupe', async () => {
  const sb = fresh();
  fillProductForm(sb, { barcode: 'A', sku: 'ARROZ-1' });
  setAltFields(sb, ['A', 'A']); // repetido en el formulario
  await sb.run('guardarProd()');
  assert.equal(json(sb, 'productos.length'), 0, 'guardarProd aborta con códigos repetidos');
  assert.match(sb.toastText(), /repetido/i);
  sb.seedData('productos', [seedProduct()]);
  const res = json(sb, "_naAddProductCode(productos[0],'a')");
  assert.equal(res.ok, false); assert.equal(res.reason, 'DUPLICATE_SAME_PRODUCT');
});

test('T6 — A→B conserva A (edición real guardarProd)', async () => {
  const sb = fresh();
  sb.seedData('productos', [seedProduct({ barcode: 'A', codigosAlternativos: ['X'], codigoAlternativo: 'X' })]);
  fillProductForm(sb, { id: 'P1', barcode: 'B', stock: 10 });
  setAltFields(sb, ['X']);
  await sb.run('guardarProd()');
  assert.deepEqual(codesOf(sb, 'productos[0]').sort(), ['A', 'B', 'X'], 'A queda como histórico');
  assert.equal(json(sb, 'productos[0].barcode'), 'B');
});

test('T7 — A→B→C conserva A y B', async () => {
  const sb = fresh();
  sb.seedData('productos', [seedProduct({ barcode: 'A' })]);
  for (const [from, to] of [['A', 'B'], ['B', 'C']]) {
    const current = codesOf(sb, 'productos[0]');
    fillProductForm(sb, { id: 'P1', barcode: to, stock: 10 });
    setAltFields(sb, current.filter(c => c !== to && c !== from));
    await sb.run('guardarProd()');
  }
  assert.equal(json(sb, 'productos[0].barcode'), 'C');
  assert.deepEqual(codesOf(sb, 'productos[0]').sort(), ['A', 'B', 'C']);
});

test('T8 — A→B→C→A sin pérdida ni duplicados (guardarProd y _naSetPrincipalCode)', async () => {
  const sb = fresh();
  sb.seedData('productos', [seedProduct({ barcode: 'A' })]);
  const seq = [['A', 'B'], ['B', 'C'], ['C', 'A']];
  for (const [from, to] of seq) {
    const current = codesOf(sb, 'productos[0]');
    fillProductForm(sb, { id: 'P1', barcode: to, stock: 10 });
    setAltFields(sb, current.filter(c => c !== from && c !== to));
    await sb.run('guardarProd()');
  }
  const finalCodes = codesOf(sb, 'productos[0]');
  assert.equal(json(sb, 'productos[0].barcode'), 'A', 'A vuelve a ser principal');
  assert.deepEqual(finalCodes.sort(), ['A', 'B', 'C'], 'sin duplicados, sin pérdida');
  // misma secuencia con el helper (sandbox limpio: un código jamás es de dos productos)
  const sb2 = fresh();
  sb2.seedData('productos', [seedProduct({ id: 'P9', sku: 'H-1', barcode: 'HA' })]);
  for (const c of ['HB', 'HC', 'HA']) {
    const step = json(sb2, `_naSetPrincipalCode(productos.find(p=>p.id==='P9'),'${c}')`);
    assert.equal(step.ok, true, `setPrincipal ${c}: ${JSON.stringify(step)}`);
  }
  assert.equal(json(sb2, "productos.find(p=>p.id==='P9').barcode"), 'HA');
  assert.deepEqual(json(sb2, "[...productos.find(p=>p.id==='P9').codigosAlternativos].sort()"), ['HB', 'HC']);
});

test('T9/T10 — búsqueda y posAddBySku resuelven los 7 códigos al mismo id', async () => {
  const sb = fresh();
  const alts = ['775000000002', '775000000003', '775000000004', '775000000005', '775000000006', '775000000007'];
  sb.seedData('productos', [seedProduct({ barcode: '775000000001', codigosAlternativos: alts, codigoAlternativo: alts[0] })]);
  for (const code of ['775000000001', ...alts]) {
    const owner = sb.run(`_naProductByCode('${code}').id`);
    assert.equal(owner, 'P1', `${code} → P1`);
  }
  assert.equal(sb.run("_naProductByCode('INEXISTENTE')"), null);
  sb.run("posAddBySku('775000000004')");
  assert.equal(json(sb, 'cart[0].id'), 'P1', 'posAddBySku por alternativo añade el producto dueño');
});

test('T11 — editar sin tocar códigos conserva todos exactamente', async () => {
  const sb = fresh();
  sb.seedData('productos', [seedProduct({ barcode: 'A', codigosAlternativos: ['X', 'Y'], codigoAlternativo: 'X' })]);
  fillProductForm(sb, { id: 'P1', name: 'ARROZ SUPERIOR EDITADO', barcode: 'A', stock: 10, precio: '60' });
  setAltFields(sb, ['X', 'Y']);
  await sb.run('guardarProd()');
  const p = json(sb, 'productos[0]');
  assert.equal(p.barcode, 'A');
  assert.deepEqual(p.codigosAlternativos, ['X', 'Y']);
  assert.equal(p.codigoAlternativo, 'X');
  assert.equal(p.precio, 60, 'el resto de la edición sí aplica');
});

test('T12 — import update sin columna de alternativos NO vacía los existentes', async () => {
  const sb = fresh();
  sb.seedData('productos', [seedProduct({ barcode: 'A', codigosAlternativos: ['X', 'Y'], codigoAlternativo: 'X' })]);
  await runImport(sb, importRows([['ARROZ SUPERIOR', 'ARROZ-1', 'A', '', '51', '', '', '']]));
  const p = json(sb, 'productos[0]');
  assert.deepEqual(p.codigosAlternativos, ['X', 'Y'], 'histórico preservado');
  assert.equal(p.precio, 51, 'precio sí actualizado');
});

test('T13 — import update con alternativos FUSIONA (no reemplaza)', async () => {
  const sb = fresh();
  sb.seedData('productos', [seedProduct({ barcode: 'A', codigosAlternativos: ['X', 'Y'], codigoAlternativo: 'X' })]);
  await runImport(sb, importRows([['ARROZ SUPERIOR', 'ARROZ-1', 'A', 'Z', '50', '', '', '']]));
  assert.deepEqual(json(sb, 'productos[0].codigosAlternativos'), ['X', 'Y', 'Z'], 'merge histórico + importado');
});

test('T14 — import que cambia el principal conserva el anterior', async () => {
  const sb = fresh();
  sb.seedData('productos', [seedProduct({ barcode: 'A', codigosAlternativos: ['X'], codigoAlternativo: 'X' })]);
  await runImport(sb, importRows([['ARROZ SUPERIOR', 'ARROZ-1', 'B', 'Z', '50', '', '', '']]));
  const p = json(sb, 'productos[0]');
  assert.equal(p.barcode, 'B');
  assert.deepEqual(p.codigosAlternativos, ['X', 'A', 'Z'], 'A conservado tras cambio de principal por import');
});

test('T15 — export/import roundtrip conserva códigos', async () => {
  const sb = fresh();
  const alts = ['775000000002', '775000000003', '775000000004', '775000000005', '775000000006', '775000000007'];
  sb.seedData('productos', [seedProduct({ barcode: '775000000001', codigosAlternativos: alts, codigoAlternativo: alts[0] })]);
  const exported = json(sb, '_naProductsExportRows()');
  assert.equal(exported[0]['Códigos alternativos'], alts.join(' | '), 'export serializa los 6');
  const rows = [Object.keys(exported[0]), ...exported.map(r => Object.values(r))];
  await runImport(sb, rows);
  const p = json(sb, 'productos[0]');
  assert.equal(p.barcode, '775000000001');
  assert.deepEqual(p.codigosAlternativos, alts, 'roundtrip completo sin pérdida');
});

test('T16 — backup/restore con 7 códigos funciona', () => {
  const sb = fresh();
  const alts = ['A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
  sb.seedData('productos', [seedProduct({ barcode: 'A', codigosAlternativos: alts, codigoAlternativo: 'A2' })]);
  buildRawSnapshot(sb);
  const prepared = json(sb, '_naPrepareBackupSnapshot(_naV2Raw)');
  const restored = prepared.snapshot.data.productos[0];
  assert.equal(restored.barcode, 'A');
  assert.deepEqual(restored.codigosAlternativos, alts, 'sanitizer conserva los 7 códigos');
  sb.run(`productos=[];_naApplySnapshot(${JSON.stringify(prepared.snapshot)});_naNormalizeData();`);
  assert.equal(sb.run("_naProductByCode('A7').id"), 'P1', 'tras restore, el 7º código sigue buscando');
});

test('T17 — legacy con 10 alternativos: legible, buscable, restaurable y editable', async () => {
  const sb = fresh();
  const legacy = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'];
  sb.seedData('productos', [seedProduct({ barcode: 'A', codigosAlternativos: legacy, codigoAlternativo: 'L1' })]);
  assert.equal(sb.run("_naProductByCode('L10').id"), 'P1', '10º alternativo buscable');
  assert.equal(json(sb, '_naNormalizeAltCodes(productos[0].codigosAlternativos).length'), 10, 'lectura tolerante a 10');
  // backup con 10 alternativos NO se rechaza
  buildRawSnapshot(sb);
  const prepared = json(sb, '_naPrepareBackupSnapshot(_naV2Raw)');
  assert.equal(prepared.snapshot.data.productos[0].codigosAlternativos.length, 10, 'restore tolerante');
  // editar sin cambiar códigos conserva los 10
  fillProductForm(sb, { id: 'P1', barcode: 'A', stock: 10 });
  setAltFields(sb, legacy);
  await sb.run('guardarProd()');
  assert.equal(json(sb, 'productos[0].codigosAlternativos.length'), 10, 'edición legacy preserva 10');
  // cambiar el principal con 10 alternativos se BLOQUEA pidiendo liberar un código
  fillProductForm(sb, { id: 'P1', barcode: 'B', stock: 10 });
  setAltFields(sb, legacy);
  await sb.run('guardarProd()');
  assert.equal(json(sb, 'productos[0].barcode'), 'A', 'edición bloqueada');
  assert.match(sb.toastText(), /conservar el código principal anterior/);
  const res = json(sb, "_naSetPrincipalCode(productos[0],'B')");
  assert.equal(res.ok, false); assert.equal(res.reason, 'CAP_ABSOLUTE', 'helper tampoco rompe el tope absoluto');
});

test('T18/T19 — eliminación explícita solo de alternativos; principal no removible', () => {
  const sb = fresh();
  sb.seedData('productos', [seedProduct({ barcode: 'A', codigosAlternativos: ['X', 'Y'], codigoAlternativo: 'X' })]);
  assert.equal(json(sb, "_naRemoveProductCode(productos[0],'X')").ok, true);
  assert.deepEqual(json(sb, 'productos[0].codigosAlternativos'), ['Y']);
  assert.equal(json(sb, 'productos[0].barcode'), 'A', 'principal intacto');
  assert.equal(json(sb, 'productos[0].codigoAlternativo'), 'Y', 'espejo resincronizado');
  const res = json(sb, "_naRemoveProductCode(productos[0],'A')");
  assert.equal(res.ok, false); assert.equal(res.reason, 'PRIMARY', 'principal no se remueve directamente');
  assert.equal(json(sb, "_naRemoveProductCode(productos[0],'ZZ')").reason, 'NOT_FOUND');
});

test('T20-T25 — integridad: id/stock/precio/costo/ledger/historial/impuestos intactos', async () => {
  const sb = fresh();
  sb.seedData('productos', [seedProduct({ barcode: 'A', codigosAlternativos: ['X'], codigoAlternativo: 'X' })]);
  sb.seedData('ventas', [{ id: 'V-1', fecha: '2026-01-01', total: 100, metodo: 'efectivo', items: [{ id: 'P1', productoId: 'P1', name: 'ARROZ SUPERIOR', qty: 2, cantidad: 2, precio: 50, precioUnitario: 50, subtotal: 100, sku: 'ARROZ-1', barcode: 'A' }] }]);
  sb.seedData('inventoryMovements', [{ id: 'IM-1', productId: 'P1', type: 'ENTRADA', before: 0, delta: 10, after: 10, reason: 'inicial', source: 'INVENTORY_MOVE', referenceId: null, timestamp: '2026-01-01T10:00:00.000Z', fecha: '2026-01-01' }]);
  sb.run('_naNormalizeData()'); // asentar normalizaciones preexistentes antes del snapshot base
  const before = sb.memoryState();
  // edición que cambia principal (A→B) sin tocar stock
  fillProductForm(sb, { id: 'P1', barcode: 'B', stock: 10 });
  setAltFields(sb, ['X']);
  await sb.run('guardarProd()');
  // import que fusiona códigos (columna marca incluida para no pelear con semántica existente)
  await runImport(sb, importRows([['ARROZ SUPERIOR', 'ARROZ-1', 'B', 'Z', '50', '5', '', 'Marca']]));
  const after = sb.memoryState();
  const pBefore = before.productos[0], pAfter = after.productos[0];
  assert.equal(pAfter.id, pBefore.id, 'id intacto');
  assert.equal(pAfter.stock, pBefore.stock, 'stock intacto');
  assert.equal(pAfter.precio, pBefore.precio, 'precio intacto');
  assert.equal(pAfter.costo, pBefore.costo, 'costo intacto');
  assert.equal(pAfter.tipoImpuesto, pBefore.tipoImpuesto, 'impuestos intactos');
  assert.equal(pAfter.incluyeIGV, pBefore.incluyeIGV, 'IGV intacto');
  assert.deepEqual(stripCodes(pAfter), stripCodes(pBefore), 'todo lo no-código deep-equal');
  assert.deepEqual(after.ventas, before.ventas, 'historial de ventas intacto');
  assert.deepEqual(after.inventoryMovements, before.inventoryMovements, 'ledger intacto');
  // los códigos sí evolucionaron (A y X preservados, B principal, Z fusionado)
  assert.deepEqual(codesOf(sb, 'productos[0]').sort(), ['A', 'B', 'X', 'Z']);
});
