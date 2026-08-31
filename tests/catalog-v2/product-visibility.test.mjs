// PRODUCT VISIBILITY — SIN REPOSICION computado + DESCONTINUADO manual reversible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPosSandbox, json, POS_DIR } from './lib/sandbox.mjs';

const NOW = '2026-08-31T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const DAY_MS = 86400000;
const INLINE_01 = readFileSync(path.join(POS_DIR, 'js/legacy-inline/inline-01.js'), 'utf8');
const INLINE_03 = readFileSync(path.join(POS_DIR, 'js/legacy-inline/inline-03.js'), 'utf8');
const INDEX_HTML = readFileSync(path.join(POS_DIR, 'index.html'), 'utf8');
const COMPONENTS_CSS = readFileSync(path.join(POS_DIR, 'css/components.css'), 'utf8');

const atDaysAgo = (days) => new Date(NOW_MS - days * DAY_MS).toISOString();
const makeProduct = (overrides = {}) => ({
  id: 'P1', name: 'PRODUCTO VISIBLE', descripcion: 'Descripción', sku: 'SKU-P1', barcode: '7750001',
  codigosAlternativos: ['ALT-P1'], codigoAlternativo: 'ALT-P1', cat: 'abarrotes', icon: '📦', imagen: null,
  costo: 5, precio: 10, precioCaja: 100, unidCaja: 12, stock: 20, stockMin: 4, venc: '2027-12-31',
  marca: 'Marca', unidad: 'unidad', unidadCompra: 'caja', factorCompra: 12, incluyeIGV: true,
  tipoImpuesto: 'gravado', impuestoComplementario: '', controlInventario: true,
  ...overrides,
});
const restock = (productId, days, overrides = {}) => ({
  id: `IM-${productId}-${days}`, productId, type: 'ENTRADA', before: 0, delta: 10, after: 10,
  reason: 'Entrada de inventario: +10', source: 'INVENTORY_MOVE', referenceId: String(productId),
  timestamp: atDaysAgo(days), fecha: atDaysAgo(days).slice(0, 10), sessionId: null,
  ...overrides,
});

function fresh() {
  const sb = createPosSandbox();
  sb.seed();
  sb.run(`Date.now=()=>${NOW_MS};`);
  return sb;
}

function setAltFields(sb, codes) {
  sb.run(`(()=>{const list=document.getElementById('pAltCodesList');list.replaceChildren();${JSON.stringify(codes)}.forEach(code=>{const input=document.createElement('input');input.classList.add('alt-code-input');input.value=code;list.appendChild(input);});})()`);
}

function fillProductForm(sb, product, active) {
  sb.run(`invEditId=${JSON.stringify(product?.id ?? null)};imagenProducto=${JSON.stringify(product?.imagen ?? null)};`);
  const values = {
    pNombre: product?.name ?? 'PRODUCTO NUEVO', pDescripcion: product?.descripcion ?? '',
    pCosto: String(product?.costo ?? 5), pPrecio: String(product?.precio ?? 10),
    pSku: product?.sku ?? 'SKU-NUEVO', pBarcode: product?.barcode ?? '', pMarca: product?.marca ?? 'Marca',
    pUnidad: product?.unidad ?? 'unidad', pUnidadCompra: product?.unidadCompra ?? 'unidad',
    pFactorCompra: String(product?.factorCompra ?? 1), pCat: product?.cat ?? 'abarrotes', pIcon: product?.icon ?? '📦',
    pPrecioCaja: product?.precioCaja == null ? '' : String(product.precioCaja),
    pUnidCaja: product?.unidCaja == null ? '' : String(product.unidCaja),
    pStock: String(product?.stock ?? 0), pStockMin: String(product?.stockMin ?? 5), pVenc: product?.venc ?? '',
    pTipoImpuesto: product?.tipoImpuesto ?? 'gravado', pImpuestoComplementario: product?.impuestoComplementario ?? '',
    pActivo: active === false ? 'false' : 'true',
  };
  for (const [id, value] of Object.entries(values)) sb.el(id).value = value;
  sb.el('pIncluyeIGV').checked = product?.incluyeIGV !== false;
  sb.el('pControlInventario').checked = product?.controlInventario !== false;
  setAltFields(sb, product?.codigosAlternativos ?? []);
}

test('BOUNDARIES — 59/60 días visibles; 61 días SIN_REPOSICION; sin historial fiable visible', () => {
  const sb = fresh();
  const products = [59, 60, 61].map((days) => makeProduct({ id: `P${days}`, sku: `SKU-${days}`, barcode: `B-${days}`, codigosAlternativos: [], codigoAlternativo: '' }));
  const noHistory = makeProduct({ id: 'NO-HISTORY', sku: 'NO-HISTORY', barcode: 'NO-HISTORY', codigosAlternativos: [], codigoAlternativo: '' });
  sb.seedData('productos', [...products, noHistory]);
  sb.seedData('inventoryMovements', [restock('P59', 59), restock('P60', 60), restock('P61', 61), restock('NO-HISTORY', 100, { type: 'ALTA', source: 'PRODUCT_CREATE' })]);

  assert.deepEqual(json(sb, `_naProductVisibility(productos[0],${JSON.stringify(NOW)})`), { state: 'ACTIVO', hidden: false, daysWithoutRestock: 59 });
  assert.deepEqual(json(sb, `_naProductVisibility(productos[1],${JSON.stringify(NOW)})`), { state: 'ACTIVO', hidden: false, daysWithoutRestock: 60 });
  assert.deepEqual(json(sb, `_naProductVisibility(productos[2],${JSON.stringify(NOW)})`), { state: 'SIN_REPOSICION', hidden: true, daysWithoutRestock: 61 });
  assert.deepEqual(json(sb, `_naProductVisibility(productos[3],${JSON.stringify(NOW)})`), { state: 'ACTIVO', hidden: false, daysWithoutRestock: null });
  assert.equal(sb.run("_naLastProductRestockAt('NO-HISTORY')"), null, 'ALTA no se interpreta como reposición confiable');
});

test('RESTOCK SEMANTICS — solo ENTRADA + INVENTORY_MOVE + delta positivo + timestamp fiable califica', () => {
  const sb = fresh();
  sb.seedData('productos', [makeProduct()]);
  sb.seedData('inventoryMovements', [
    restock('P1', 10, { type: 'SALE_REVERSAL', source: 'SALE_REVERSAL' }),
    restock('P1', 9, { type: 'AJUSTE', source: 'PRODUCT_EDIT' }),
    restock('P1', 8, { type: 'IMPORT', source: 'PRODUCT_IMPORT' }),
    restock('P1', 7, { delta: -10, after: -10 }),
    restock('P1', 6, { timestamp: 'fecha-inválida' }),
    restock('P1', 5),
  ]);
  assert.equal(sb.run("_naLastProductRestockAt('P1')"), atDaysAgo(5));
  const before = sb.memoryState().inventoryMovements;
  sb.run("_naProductVisibility(productos[0],Date.now())");
  assert.deepEqual(sb.memoryState().inventoryMovements, before, 'clasificar visibilidad nunca escribe ledger');
});

test('SEARCH + SCANNER — ocultos no navegan en vacío, reaparecen por nombre/códigos y siguen vendibles', () => {
  const sb = fresh();
  const product = makeProduct({ name: 'CAFÉ OCULTO', sku: 'SKU-OCULTO', barcode: '7750999', codigosAlternativos: ['ALT-OCULTO'], codigoAlternativo: 'ALT-OCULTO' });
  sb.seedData('productos', [product]);
  sb.seedData('inventoryMovements', [restock('P1', 61)]);
  assert.equal(sb.run("_naProductMatchesVisibleSearch(productos[0],'',Date.now())"), false);
  for (const query of ['cafe', 'sku-oculto', '7750999', 'alt-oculto']) assert.equal(sb.run(`_naProductMatchesVisibleSearch(productos[0],${JSON.stringify(query)},Date.now())`), true, query);
  for (const code of ['SKU-OCULTO', '7750999', 'ALT-OCULTO']) assert.equal(sb.run(`_naProductByCode(${JSON.stringify(code)}).id`), 'P1');
  sb.run("posAddBySku('ALT-OCULTO')");
  assert.equal(json(sb, 'cart[0].id'), 'P1', 'el scanner directo no consulta visibilidad');
});

test('POS RUNTIME — vacío preserva orden de activos; búsqueda revela ocultos con indicador', () => {
  const sb = fresh();
  sb.seedData('productos', [
    makeProduct({ id: 'A', name: 'ACTIVO UNO', sku: 'A', barcode: 'A', codigosAlternativos: [], codigoAlternativo: '' }),
    makeProduct({ id: 'D', name: 'MANUAL OCULTO', sku: 'D', barcode: 'D', codigosAlternativos: [], codigoAlternativo: '', activo: false }),
    makeProduct({ id: 'B', name: 'ACTIVO DOS', sku: 'B', barcode: 'B', codigosAlternativos: [], codigoAlternativo: '' }),
    makeProduct({ id: 'R', name: 'AUTO OCULTO', sku: 'R', barcode: 'R', codigosAlternativos: [], codigoAlternativo: '' }),
  ]);
  sb.seedData('inventoryMovements', [restock('R', 61)]);
  sb.run("posCat='todo';_naInstallProductVisibility()");
  assert.equal(sb.run('posCat'), 'todo');
  assert.equal(sb.run('posRender._naProductVisibility'), true);
  assert.deepEqual(json(sb, 'productos.filter(product=>_naProductMatchesVisibleSearch(product,"",Date.now())).map(product=>product.id)'), ['A', 'B']);
  sb.el('posSearch').value = '';
  sb.run('posRender()');
  assert.deepEqual(json(sb, "document.getElementById('posArea').children.map(card=>card.className)"), ['product-card', 'product-card']);
  assert.deepEqual(json(sb, "document.getElementById('posArea').children.map(card=>card.children.find(child=>child.className==='p-name')?.textContent)"), ['ACTIVO UNO', 'ACTIVO DOS']);

  sb.el('posSearch').value = 'manual oculto';
  sb.run('posRender()');
  assert.deepEqual(json(sb, "document.getElementById('posArea').children[0].children.filter(child=>child.className.includes('product-visibility-badge')).map(child=>({className:child.className,text:child.textContent}))"), [{ className: 'product-visibility-badge discontinued', text: 'DESCONTINUADO' }]);

  sb.el('posSearch').value = 'auto oculto';
  sb.run('posRender()');
  assert.deepEqual(json(sb, "document.getElementById('posArea').children[0].children.filter(child=>child.className.includes('product-visibility-badge')).map(child=>child.textContent)"), ['SIN REPOSICION +60D']);
});

test('MANUAL OVERRIDE + REACTIVATION — reposición no reactiva manual; ancla evita re-hide inmediato', () => {
  const sb = fresh();
  sb.seedData('productos', [makeProduct({ activo: false })]);
  sb.seedData('inventoryMovements', [restock('P1', 100), restock('P1', 0, { id: 'IM-NEW' })]);
  assert.equal(sb.run("_naProductVisibility(productos[0],Date.now()).state"), 'DESCONTINUADO');
  const patch = json(sb, `_naProductManualVisibilityPatch(productos[0],true,${JSON.stringify(NOW)})`);
  assert.deepEqual(patch, { activo: true, reactivadoAt: NOW });
  sb.run(`Object.assign(productos[0],${JSON.stringify(patch)})`);
  assert.deepEqual(json(sb, '_naProductVisibility(productos[0],Date.now())'), { state: 'ACTIVO', hidden: false, daysWithoutRestock: 0 });
});

test('NEW RESTOCK — reactiva el estado automático, pero no el manual', () => {
  const sb = fresh();
  sb.seedData('productos', [makeProduct({ id: 'AUTO' }), makeProduct({ id: 'MANUAL', activo: false })]);
  sb.seedData('inventoryMovements', [restock('AUTO', 61), restock('MANUAL', 61)]);
  assert.equal(sb.run("_naProductVisibility(productos[0],Date.now()).state"), 'SIN_REPOSICION');
  sb.seedData('inventoryMovements', [restock('AUTO', 0, { id: 'IM-AUTO-NOW' }), restock('MANUAL', 0, { id: 'IM-MANUAL-NOW' })]);
  assert.equal(sb.run("_naProductVisibility(productos[0],Date.now()).state"), 'ACTIVO');
  assert.equal(sb.run("_naProductVisibility(productos[1],Date.now()).state"), 'DESCONTINUADO');
});

test('REAL SAVE — discontinuar/reactivar solo cambia visibilidad y persiste ancla determinista', async () => {
  const sb = fresh();
  const product = makeProduct();
  sb.seedData('productos', [product]);
  sb.seedData('ventas', [{ id: 'V1', fecha: '2026-08-01', total: 10, metodo: 'efectivo', items: [{ id: 'P1', productoId: 'P1', name: 'PRODUCTO VISIBLE', qty: 1, cantidad: 1, precio: 10, precioUnitario: 10, subtotal: 10 }] }]);
  sb.seedData('inventoryMovements', [restock('P1', 100)]);
  sb.run('_naNormalizeData()');
  const before = sb.memoryState();

  fillProductForm(sb, before.productos[0], false);
  await sb.run('guardarProd()');
  assert.equal(json(sb, 'productos[0].activo'), false);
  assert.deepEqual(json(sb, 'inventoryMovements'), before.inventoryMovements);
  assert.deepEqual(json(sb, 'ventas'), before.ventas);

  const discontinued = json(sb, 'productos[0]');
  fillProductForm(sb, discontinued, true);
  await sb.run('guardarProd()');
  const after = sb.memoryState();
  assert.equal(after.productos[0].activo, true);
  assert.equal(after.productos[0].reactivadoAt, NOW);
  for (const field of ['id','sku','barcode','codigosAlternativos','codigoAlternativo','stock','stockMin','precio','costo','precioCaja','unidad','unidadCompra','factorCompra','marca','cat','venc','incluyeIGV','tipoImpuesto','impuestoComplementario']) assert.deepEqual(after.productos[0][field], before.productos[0][field], field);
  assert.deepEqual(after.inventoryMovements, before.inventoryMovements);
  assert.deepEqual(after.ventas, before.ventas);
});

test('PERSISTENCE + BACKUP — estado manual y reactivadoAt sobreviven loadAllData y sanitizer', async () => {
  const sb = fresh();
  sb.seedData('productos', [makeProduct({ activo: true, reactivadoAt: NOW })]);
  sb.seedData('inventoryMovements', [restock('P1', 100)]);
  sb.run('_naNormalizeData()');
  const persisted = json(sb, '_naBuildSnapshot()');
  sb.stores.localStorage.setItem('na_snapshot_v9', JSON.stringify(persisted));
  sb.seed();
  await sb.run('loadAllData()');
  assert.equal(json(sb, 'productos[0].reactivadoAt'), NOW);
  assert.equal(sb.run("_naProductVisibility(productos[0],Date.now()).state"), 'ACTIVO');

  sb.run('_naPreparedVisibilityBackup=_naPrepareBackupSnapshot(JSON.parse(JSON.stringify(_naBuildSnapshot())))');
  const restored = json(sb, '_naPreparedVisibilityBackup.snapshot.data.productos[0]');
  assert.equal(restored.activo, true);
  assert.equal(restored.reactivadoAt, NOW);
  sb.run('productos=[];_naApplySnapshot(_naPreparedVisibilityBackup.snapshot);_naNormalizeData()');
  assert.equal(json(sb, 'productos[0].reactivadoAt'), NOW);
});

test('IMPORT PRESERVATION — update no borra ni altera activo/reactivadoAt', async () => {
  const sb = fresh();
  sb.seedData('productos', [makeProduct({ activo: false, reactivadoAt: atDaysAgo(20) })]);
  const rows = [['nombre','sku','precio'],['PRODUCTO IMPORTADO','SKU-P1','11']];
  const plan = json(sb, `_naBuildProductImportPlan(${JSON.stringify(rows)})`);
  assert.equal(Object.hasOwn(plan.actions[0].data, 'activo'), false);
  assert.equal(Object.hasOwn(plan.actions[0].data, 'reactivadoAt'), false);
  sb.run(`_naPendingProductImport={rows:${JSON.stringify(rows)},fileName:'visibility.csv',analyzedAt:Date.now()}`);
  await sb.run('confirmProductImport()');
  assert.equal(json(sb, 'productos[0].activo'), false);
  assert.equal(json(sb, 'productos[0].reactivadoAt'), atDaysAgo(20));
});

test('NEW PRODUCT + 408 BASELINE — alta inicia ACTIVO y catálogo sin historial no se oculta', async () => {
  const baseline = createPosSandbox();
  baseline.run(`Date.now=()=>${NOW_MS};`);
  assert.equal(json(baseline, 'productos.length'), 408);
  const before = json(baseline, 'productos');
  assert.equal(json(baseline, 'productos.filter(product=>_naProductVisibility(product,Date.now()).hidden).length'), 0);
  assert.deepEqual(json(baseline, 'productos'), before, 'clasificar los 408 no muta el catálogo');

  const sb = fresh();
  sb.run('_naInstallProductVisibility();abrirModalProd()');
  assert.equal(sb.el('pActivo').value, 'true');
  fillProductForm(sb, null, true);
  await sb.run('guardarProd()');
  assert.equal(json(sb, 'productos[0].activo'), true);
  assert.equal(sb.run("_naProductVisibility(productos[0],Date.now()).state"), 'ACTIVO');
});

test('UI + BACKUP CONTRACT — selector, badges e integración autorizada están presentes', () => {
  assert.match(INDEX_HTML, /id="pActivo"[\s\S]*?ACTIVO[\s\S]*?DESCONTINUADO/);
  assert.match(COMPONENTS_CSS, /\.product-visibility-badge/);
  assert.match(COMPONENTS_CSS, /\.inventory-visibility-badge/);
  assert.match(INLINE_01, /document\.addEventListener\('DOMContentLoaded',_naInstallProductVisibility\)/);
  assert.match(INLINE_01, /querySelectorAll\('#invBody tr'\)/);
  assert.match(INLINE_03, /'reactivadoAt'/);
  assert.match(INLINE_03, /\['createdAt','updatedAt','reactivadoAt'\]/);
});
