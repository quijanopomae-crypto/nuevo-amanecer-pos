// FIX04 — LEDGER TRAZABLE DE INVENTARIO
//
// T1  entrada +10: before 0 / delta +10 / after 10
// T2  salida -3: before 10 / delta -3 / after 7
// T3  salida que deja negativo: bloqueada, sin stock ni movement
// T4  ajuste manual: requiere motivo y crea ledger
// T5  venta: stock baja y crea movement enlazado a ventaId
// T6  fallo de persistencia en venta: rollback venta + stock + inventoryMovement
// T7  anulación: crea movimiento inverso sin borrar el original
// T8  doble anulación: no duplica reversal de inventario
// T9  edición directa no puede dejar stock negativo ni saltarse el ledger
// T10 snapshot antiguo sin inventoryMovements: carga []
// T11 reload: los movimientos persisten exactamente
// T12 import/export V9: el ledger se conserva (round-trip + respaldo plano)
// T13 múltiples movimientos: before/delta/after forman cadena coherente
// T14 fallo de persistencia de ajuste: rollback stock + ledger
// T15 identidad/referencia: cada movimiento queda enlazado a su operación origen
// T16 alta con stock 10 termina en 10 y ledger 0→10
// T17 edición/importación 10→15 termina en 15 y ledger delta +5
// T18 desactivar control no cambia stock sin movement
// T19 doble anulación concurrente crea un solo SALE_REVERSAL
// T20 cancelar/fallar anulación libera el lock
// T21 snapshot con inventoryMovements no-array se rechaza
// T22 snapshot inválido no altera memoria ni durable
// T23 IDs de movement duplicados invalidan todo el import
// T24 after distinto de before + delta invalida todo el import
// T25 cadena incoherente por producto invalida todo el import

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPosSandbox, json } from './lib/sandbox.mjs';

const PRODUCTO = { id: 'P1', name: 'Arroz', stock: 0, controlInventario: true, precio: 50, costo: 5, unidad: 'unidad' };

function freshTab(stock = 0) {
  const sb = createPosSandbox();
  sb.seed();
  sb.seedData('productos', [{ ...PRODUCTO, stock }]);
  return sb;
}

async function openCash(sb, fondo = 100) {
  sb.el('cajFondo').value = String(fondo);
  sb.el('cajCajero').value = 'CAJ-001';
  return sb.run('abrirCaja()');
}

async function stockMove(sb, tipo, cantidad) {
  sb.run(`invMovId='P1';invMovT=${JSON.stringify(tipo)};`);
  sb.el('mMovCant').value = String(cantidad);
  await sb.run('guardarMovInv()');
}

async function sellUnits(sb, qty, price = 25) {
  sb.run(`cart.push({id:'P1',precio:${price},qty:${qty},unitsPerQty:1,ventaModo:'unidad',costo:5,controlInventario:true,ventaLibre:false,ventaSinStock:false,unidad:'unidad'});`);
  sb.el('mMontoRec').value = String(price * qty);
  await sb.run('confirmarVenta()');
  // Si la venta se bloquea o hace rollback, ventas queda vacío → null.
  return json(sb, 'ventas.length?ventas[0].id:null');
}

const movs = (sb) => json(sb, 'inventoryMovements');
const movsByType = (sb, type) => json(sb, `inventoryMovements.filter(m=>m.type===${JSON.stringify(type)})`);

function fillProductForm(sb, { id = null, name = 'Arroz', sku = 'ARROZ-1', stock = 0, controlInventario = true } = {}) {
  sb.run(`invEditId=${JSON.stringify(id)};imagenProducto=null;`);
  const values = {
    pNombre: name, pDescripcion: '', pCosto: '5', pPrecio: '50', pSku: sku,
    pBarcode: '', pMarca: 'Marca', pUnidad: 'unidad', pUnidadCompra: 'unidad',
    pFactorCompra: '1', pCat: 'abarrotes', pIcon: '📦', pPrecioCaja: '',
    pUnidCaja: '', pStock: String(stock), pStockMin: '5', pVenc: '',
    pTipoImpuesto: 'gravado', pImpuestoComplementario: '',
  };
  for (const [field, value] of Object.entries(values)) sb.el(field).value = value;
  sb.el('pIncluyeIGV').checked = true;
  sb.el('pControlInventario').checked = controlInventario;
}

function importedMovement(overrides = {}) {
  return {
    id: 'IM-IMPORT-1', productId: 'P1', type: 'AJUSTE', before: 0, delta: 5, after: 5,
    reason: 'Conteo de respaldo', source: 'MANUAL', referenceId: null, sessionId: null,
    ...overrides,
  };
}

test('T1 — entrada +10: before 0 / delta +10 / after 10', async () => {
  const sb = freshTab(0);
  await stockMove(sb, 'entrada', 10);
  assert.equal(json(sb, 'productos[0].stock'), 10);
  const entries = movsByType(sb, 'ENTRADA');
  assert.equal(entries.length, 1, 'exactamente un movement de entrada');
  const m = entries[0];
  assert.equal(m.before, 0);
  assert.equal(m.delta, 10);
  assert.equal(m.after, 10);
  assert.ok(m.reason && m.reason.length > 0, 'motivo estructurado presente');
  assert.equal(m.source, 'INVENTORY_MOVE');
  assert.ok(m.id && m.timestamp && m.fecha, 'id/timestamp/fecha presentes');
});

test('T2 — salida -3: before 10 / delta -3 / after 7', async () => {
  const sb = freshTab(10);
  await stockMove(sb, 'salida', 3);
  assert.equal(json(sb, 'productos[0].stock'), 7);
  const entries = movsByType(sb, 'SALIDA');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].before, 10);
  assert.equal(entries[0].delta, -3);
  assert.equal(entries[0].after, 7);
});

test('T3 — salida que deja negativo: bloqueada, sin stock ni movement', async () => {
  const sb = freshTab(10);
  await stockMove(sb, 'salida', 50);
  assert.match(sb.toastText(), /Stock insuficiente/i, 'la salida excesiva se bloquea');
  assert.equal(json(sb, 'productos[0].stock'), 10, 'stock intacto');
  assert.equal(movs(sb).length, 0, 'sin movement en el ledger');
  // El punto central también lo bloquea por contrato.
  const outcome = json(sb, 'applyInventoryMovement({productId:"P1",delta:-20,reason:"prueba"})');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, 'NEGATIVE_STOCK');
  assert.equal(json(sb, 'productos[0].stock'), 10);
  assert.equal(movs(sb).length, 0);
});

test('T4 — ajuste manual: requiere motivo y crea ledger', async () => {
  const sb = freshTab(5);
  const noReason = json(sb, 'applyInventoryMovement({productId:"P1",delta:2})');
  assert.equal(noReason.ok, false);
  assert.equal(noReason.error, 'REASON_REQUIRED');
  assert.equal(movs(sb).length, 0, 'sin motivo no hay movement');
  assert.equal(json(sb, 'productos[0].stock'), 5, 'stock sin tocar');
  const outcome = json(sb, `applyInventoryMovement({productId:"P1",delta:2,type:"AJUSTE",reason:"Conteo físico: sobrante",source:"MANUAL",referenceId:"P1"})`);
  assert.equal(outcome.ok, true);
  const entries = movsByType(sb, 'AJUSTE');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].before, 5);
  assert.equal(entries[0].delta, 2);
  assert.equal(entries[0].after, 7);
  assert.equal(entries[0].reason, 'Conteo físico: sobrante');
  assert.equal(json(sb, 'productos[0].stock'), 7);
  // Congelados: recalcular/normalizar no altera before/delta/after.
  await sb.run('saveAllData()');
  assert.equal(entries[0].before, 5);
  assert.equal(entries[0].delta, 2);
  assert.equal(entries[0].after, 7);
});

test('T5 — venta: stock baja y crea movement enlazado a ventaId', async () => {
  const sb = freshTab(10);
  assert.equal(await openCash(sb), true);
  const ventaId = await sellUnits(sb, 2);
  assert.equal(json(sb, 'productos[0].stock'), 8);
  const entries = movsByType(sb, 'SALE');
  assert.equal(entries.length, 1, 'un movement de venta');
  assert.equal(entries[0].before, 10);
  assert.equal(entries[0].delta, -2);
  assert.equal(entries[0].after, 8);
  assert.equal(entries[0].referenceId, ventaId, 'enlazado a la venta');
  assert.equal(entries[0].source, 'SALE');
});

test('T6 — fallo de persistencia en venta: rollback venta + stock + inventoryMovement', async () => {
  const sb = freshTab(10);
  assert.equal(await openCash(sb), true);
  await sb.run('saveAllData()');
  const memoryBefore = sb.memoryState();
  sb.breakPersistent();
  await sellUnits(sb, 2);
  sb.restorePersistent();
  const memoryAfter = sb.memoryState();
  assert.equal(memoryAfter.ventas.length, 0, 'sin venta parcial');
  assert.equal(memoryAfter.productos[0].stock, 10, 'stock restaurado');
  assert.deepEqual(memoryAfter.inventoryMovements, memoryBefore.inventoryMovements, 'ledger sin residuos');
  assert.equal(memoryAfter.cart.length, 1, 'el carrito se conserva para reintentar');
  assert.equal(memoryAfter.cajMovs.length, memoryBefore.cajMovs.length, 'caja sin residuos');
  assert.match(sb.toastText(), /No se registró la venta/i);
  // Con persistencia sana la venta procede y el ledger queda aplicado una sola vez.
  sb.run('cart=[];');
  const ventaId = await sellUnits(sb, 2);
  assert.equal(json(sb, 'productos[0].stock'), 8);
  const entries = movsByType(sb, 'SALE');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].referenceId, ventaId);
});

test('T7 — anulación: crea movimiento inverso sin borrar el original', async () => {
  const sb = freshTab(10);
  assert.equal(await openCash(sb), true);
  const ventaId = await sellUnits(sb, 2);
  const saleEntry = movsByType(sb, 'SALE')[0];
  await sb.run(`anularV(${JSON.stringify(ventaId)})`);
  assert.equal(json(sb, 'productos[0].stock'), 10, 'stock repuesto');
  const reversals = movsByType(sb, 'SALE_REVERSAL');
  assert.equal(reversals.length, 1);
  assert.equal(reversals[0].before, 8);
  assert.equal(reversals[0].delta, 2);
  assert.equal(reversals[0].after, 10);
  assert.equal(reversals[0].referenceId, ventaId, 'reversal enlazado a la misma venta');
  const saleAfter = movsByType(sb, 'SALE')[0];
  assert.deepEqual(saleAfter, saleEntry, 'el movimiento SALE original permanece intacto');
});

test('T8 — doble anulación: no duplica reversal de inventario', async () => {
  const sb = freshTab(10);
  assert.equal(await openCash(sb), true);
  const ventaId = await sellUnits(sb, 2);
  await sb.run(`anularV(${JSON.stringify(ventaId)})`);
  const snapshotMovs = movs(sb);
  await sb.run(`anularV(${JSON.stringify(ventaId)})`);
  assert.match(sb.toastText(), /ya fue anulada/i, 'la segunda anulación se bloquea');
  assert.deepEqual(movs(sb), snapshotMovs, 'el ledger no cambia');
  assert.equal(movsByType(sb, 'SALE_REVERSAL').length, 1, 'un solo reversal');
  assert.equal(json(sb, 'productos[0].stock'), 10);
});

test('T9 — edición directa no puede dejar stock negativo ni saltarse el ledger', async () => {
  const sb = freshTab(10);
  async function editProduct(stockValue) {
    sb.run(`invEditId='P1';`);
    sb.el('pNombre').value = 'Arroz';
    sb.el('pPrecio').value = '50';
    sb.el('pCosto').value = '5';
    sb.el('pUnidad').value = 'unidad';
    sb.el('pUnidadCompra').value = 'unidad';
    sb.el('pFactorCompra').value = '1';
    sb.el('pStock').value = String(stockValue);
    sb.el('pStockMin').value = '5';
    sb.el('pControlInventario').checked = true;
    await sb.run('guardarProd()');
  }
  await editProduct(-5);
  assert.match(sb.toastText(), /Stock insuficiente|stock/i, 'el stock negativo se bloquea');
  assert.equal(json(sb, 'productos[0].stock'), 10, 'stock sin cambio');
  assert.equal(movs(sb).length, 0, 'sin movement para la edición bloqueada');
  const movsBefore = movs(sb);
  await editProduct(15);
  assert.equal(json(sb, 'productos[0].stock'), 15, 'stock fijado por edición');
  const ajustes = movsByType(sb, 'AJUSTE');
  assert.equal(ajustes.length, 1, 'la edición quedó registrada en el ledger');
  assert.equal(ajustes[0].before, 10);
  assert.equal(ajustes[0].delta, 5);
  assert.equal(ajustes[0].after, 15);
  assert.equal(ajustes[0].source, 'PRODUCT_EDIT');
  assert.deepEqual(movsByType(sb, 'AJUSTE').slice(0, 0), movsBefore.slice(0, 0));
  // Edición sin cambio de stock: no genera movement nuevo.
  await editProduct(15);
  assert.equal(movsByType(sb, 'AJUSTE').length, 1);
});

test('T10 — snapshot antiguo sin inventoryMovements: carga []', async () => {
  const sb = freshTab(10);
  await stockMove(sb, 'entrada', 5);
  await sb.run('saveAllData()');
  const legacy = sb.durableSnapshot();
  delete legacy.data.inventoryMovements;
  assert.equal(sb.run(`_naApplySnapshot(${JSON.stringify(legacy)})`), true, 'el snapshot legacy carga');
  assert.deepEqual(json(sb, 'inventoryMovements'), [], 'inventoryMovements se inicializa como []');
  assert.equal(json(sb, 'productos[0].stock'), 15, 'el stock legacy se carga igual');
});

test('T11 — reload: los movimientos persisten exactamente', async () => {
  const sb = freshTab(10);
  await stockMove(sb, 'salida', 3);
  await sellUnits(sb, 2).catch(() => {}); // sin caja abierta no vende; el ledger de salida basta
  await sb.run('saveAllData()');
  const before = movs(sb);
  assert.ok(before.length >= 1);
  assert.equal(sb.run('_naApplySnapshot(_naParseStoredSnapshot(storage.readPersistent(_NA_LOCAL_KEY)))'), true);
  assert.equal(JSON.stringify(movs(sb)), JSON.stringify(before), 'ledger idéntico tras reload');
  assert.equal(json(sb, 'productos[0].stock'), 7);
});

test('T12 — import/export V9: el ledger se conserva', async () => {
  const sb = freshTab(10);
  await stockMove(sb, 'entrada', 5);
  await sb.run('saveAllData()');
  const durable = sb.durableSnapshot();
  assert.equal(Array.isArray(durable.data.inventoryMovements), true, 'el snapshot V9 incluye el ledger');
  const prepared = sb.run(`_naPrepareBackupSnapshot(${JSON.stringify(durable)})`);
  assert.equal(prepared.counts.inventoryMovements, durable.data.inventoryMovements.length, 'el respaldo conserva el ledger');
  assert.equal(JSON.stringify(prepared.snapshot.data.inventoryMovements), JSON.stringify(durable.data.inventoryMovements));
  assert.equal(sb.run(`_naApplySnapshot(${JSON.stringify(prepared.snapshot)})`), true, 'el respaldo con ledger recarga');
  assert.equal(JSON.stringify(movs(sb)), JSON.stringify(durable.data.inventoryMovements));
  // Respaldo plano v8 sin ledger → canónico con [].
  const flat = sb.run('_naPrepareBackupSnapshot({version:8,productos:[],ventas:[],appConfig:{}})');
  assert.deepEqual(json(sb, `(${JSON.stringify(flat.snapshot.data.inventoryMovements)})`), [], 'respaldo plano → ledger vacío');
});

test('T13 — múltiples movimientos: before/delta/after forman cadena coherente', async () => {
  const sb = freshTab(0);
  await stockMove(sb, 'entrada', 10);
  await stockMove(sb, 'salida', 3);
  const outcome = json(sb, `applyInventoryMovement({productId:"P1",delta:-2,type:"AJUSTE",reason:"Merma confirmada",source:"MANUAL"})`);
  assert.equal(outcome.ok, true);
  const ledger = movs(sb);
  assert.equal(ledger.length, 3);
  assert.equal(json(sb, 'productos[0].stock'), 5);
  assert.equal(ledger[0].before, 0);
  assert.equal(ledger[0].after, 10);
  assert.equal(ledger[1].before, 10, 'cada before retoma el after anterior');
  assert.equal(ledger[1].after, 7);
  assert.equal(ledger[2].before, 7);
  assert.equal(ledger[2].after, 5);
  for (let i = 1; i < ledger.length; i++) assert.equal(ledger[i].before, ledger[i - 1].after, `cadena coherente en ${i}`);
  for (const m of ledger) assert.equal(m.after, m.before + m.delta);
});

test('T14 — fallo de persistencia de ajuste: rollback stock + ledger', async () => {
  const sb = freshTab(10);
  await sb.run('saveAllData()');
  const memoryBefore = sb.memoryState();
  sb.breakPersistent();
  await stockMove(sb, 'entrada', 5);
  sb.restorePersistent();
  const memoryAfter = sb.memoryState();
  assert.equal(memoryAfter.productos[0].stock, 10, 'stock restaurado');
  assert.deepEqual(memoryAfter.inventoryMovements, memoryBefore.inventoryMovements, 'ledger sin residuos');
  assert.match(sb.toastText(), /No se guardó el movimiento/i);
  await stockMove(sb, 'entrada', 5);
  assert.equal(json(sb, 'productos[0].stock'), 15);
  assert.equal(movsByType(sb, 'ENTRADA').length, 1, 'tras reintento sano existe exactamente una entrada');
});

test('T15 — identidad/referencia: cada movimiento queda enlazado a su operación origen', async () => {
  const sb = freshTab(10);
  assert.equal(await openCash(sb), true);
  await stockMove(sb, 'entrada', 5);
  const ventaId = await sellUnits(sb, 2);
  await sb.run(`anularV(${JSON.stringify(ventaId)})`);
  const entrada = movsByType(sb, 'ENTRADA')[0];
  const sale = movsByType(sb, 'SALE')[0];
  const reversal = movsByType(sb, 'SALE_REVERSAL')[0];
  assert.equal(entrada.referenceId, 'P1', 'la entrada referencia al producto');
  assert.equal(entrada.type, 'ENTRADA');
  assert.equal(sale.referenceId, ventaId, 'la venta referencia a su ventaId');
  assert.equal(sale.type, 'SALE');
  assert.equal(sale.source, 'SALE');
  assert.equal(reversal.referenceId, ventaId, 'la reversión referencia a la misma venta');
  assert.equal(reversal.type, 'SALE_REVERSAL');
  assert.equal(reversal.source, 'SALE_REVERSAL');
  assert.notEqual(sale.referenceId, entrada.referenceId, 'orígenes distintos no se mezclan');
  // El productId de todos los movimientos apunta al producto real.
  for (const m of movs(sb)) assert.equal(String(m.productId), 'P1');
});

test('T16 — alta stock 10 termina en 10 y ledger 0→10', async () => {
  const sb = createPosSandbox();
  sb.seed();
  fillProductForm(sb, { name: 'Leche', sku: 'LECHE-1', stock: 10 });
  await sb.run('guardarProd()');
  assert.equal(json(sb, 'productos.length'), 1);
  assert.equal(json(sb, 'productos[0].stock'), 10, 'el alta no duplica el stock objetivo');
  const entries = movsByType(sb, 'ALTA');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].before, 0);
  assert.equal(entries[0].delta, 10);
  assert.equal(entries[0].after, 10);
  assert.equal(entries[0].source, 'PRODUCT_CREATE');

  const imported = createPosSandbox();
  imported.seed();
  imported.run(`_naPendingProductImport={rows:[['Nombre','Precio','SKU','Stock'],['Leche',50,'LECHE-IMPORT',10]],fileName:'alta.csv'};`);
  await imported.run('confirmProductImport()');
  assert.equal(json(imported, 'productos[0].stock'), 10, 'el alta importada tampoco duplica el objetivo');
  const importedEntries = movsByType(imported, 'ALTA');
  assert.equal(importedEntries.length, 1);
  assert.equal(importedEntries[0].before, 0);
  assert.equal(importedEntries[0].delta, 10);
  assert.equal(importedEntries[0].after, 10);
  assert.equal(importedEntries[0].source, 'PRODUCT_IMPORT');
});

test('T17 — edición/importación 10→15 termina en 15 y ledger delta +5', async () => {
  const edited = freshTab(10);
  fillProductForm(edited, { id: 'P1', stock: 15 });
  await edited.run('guardarProd()');
  assert.equal(json(edited, 'productos[0].stock'), 15);
  const editEntries = movsByType(edited, 'AJUSTE');
  assert.equal(editEntries.length, 1);
  assert.equal(editEntries[0].before, 10);
  assert.equal(editEntries[0].delta, 5);
  assert.equal(editEntries[0].after, 15);

  const imported = freshTab(10);
  imported.run(`productos[0].sku='ARROZ-1';_naPendingProductImport={rows:[['Nombre','Precio','SKU','Stock'],['Arroz',50,'ARROZ-1',15]],fileName:'edicion.csv'};`);
  await imported.run('confirmProductImport()');
  assert.equal(json(imported, 'productos[0].stock'), 15, 'la importación no suma el delta sobre el target');
  const importEntries = movsByType(imported, 'IMPORT');
  assert.equal(importEntries.length, 1);
  assert.equal(importEntries[0].before, 10);
  assert.equal(importEntries[0].delta, 5);
  assert.equal(importEntries[0].after, 15);
});

test('T18 — desactivar control no cambia stock sin movement', async () => {
  const sb = freshTab(10);
  fillProductForm(sb, { id: 'P1', stock: 10, controlInventario: false });
  await sb.run('guardarProd()');
  assert.equal(json(sb, 'productos[0].controlInventario'), false);
  assert.equal(json(sb, 'productos[0].stock'), 0, 'se conserva la política actual de stock 0');
  const entries = movsByType(sb, 'AJUSTE');
  assert.equal(entries.length, 1, 'el cambio real de stock tiene ledger');
  assert.equal(entries[0].before, 10);
  assert.equal(entries[0].delta, -10);
  assert.equal(entries[0].after, 0);
  assert.equal(entries[0].source, 'PRODUCT_EDIT');
});

test('T19 — doble anulación concurrente crea un solo SALE_REVERSAL', async () => {
  const sb = freshTab(10);
  assert.equal(await openCash(sb), true);
  const ventaId = await sellUnits(sb, 2);
  sb.run(`
    globalThis.__fix04ConfirmCalls=0;
    globalThis.__fix04ResolveConfirm=null;
    _naConfirmAction=()=>{
      globalThis.__fix04ConfirmCalls++;
      return new Promise(resolve=>{globalThis.__fix04ResolveConfirm=resolve;});
    };
  `);
  const first = sb.run(`anularV(${JSON.stringify(ventaId)})`);
  assert.equal(sb.run('__fix04ConfirmCalls'), 1);
  assert.equal(sb.run('_naSaleAnnulmentProc'), true, 'el lock se adquiere antes del await');
  const second = sb.run(`anularV(${JSON.stringify(ventaId)})`);
  assert.equal(sb.run('__fix04ConfirmCalls'), 1, 'la segunda invocación no cruza el lock');
  sb.run('__fix04ResolveConfirm(true)');
  await Promise.all([first, second]);
  assert.equal(json(sb, 'productos[0].stock'), 10, 'el stock se repone una sola vez');
  assert.equal(movsByType(sb, 'SALE_REVERSAL').length, 1);
  assert.equal(json(sb, `inventoryMovements.filter(m=>m.type==='SALE_REVERSAL'&&m.referenceId===${JSON.stringify(ventaId)}).length`), 1);
  assert.equal(sb.durableSnapshot().data.inventoryMovements.filter((m) => m.type === 'SALE_REVERSAL').length, 1);
  assert.equal(sb.run('_naSaleAnnulmentProc'), false);
});

test('T20 — cancelar o fallar anulación libera el lock', async () => {
  const sb = freshTab(10);
  assert.equal(await openCash(sb), true);
  const ventaId = await sellUnits(sb, 2);
  const before = sb.memoryState();

  sb.run('_naConfirmAction=async()=>false');
  await sb.run(`anularV(${JSON.stringify(ventaId)})`);
  assert.equal(sb.run('_naSaleAnnulmentProc'), false, 'cancelar libera el lock');
  assert.deepEqual(sb.memoryState().productos, before.productos);
  assert.equal(movsByType(sb, 'SALE_REVERSAL').length, 0);

  sb.run(`_naConfirmAction=async()=>{throw new Error('SIMULATED_CONFIRM_FAILURE')}`);
  await sb.run(`anularV(${JSON.stringify(ventaId)})`);
  assert.equal(sb.run('_naSaleAnnulmentProc'), false, 'fallar libera el lock');
  assert.deepEqual(sb.memoryState().productos, before.productos);
  assert.equal(movsByType(sb, 'SALE_REVERSAL').length, 0);

  sb.run('_naConfirmAction=async()=>true');
  await sb.run(`anularV(${JSON.stringify(ventaId)})`);
  assert.equal(movsByType(sb, 'SALE_REVERSAL').length, 1, 'un intento posterior puede completar');
  assert.equal(sb.run('_naSaleAnnulmentProc'), false);
});

test('T21 — snapshot con inventoryMovements presente no-array se rechaza', async () => {
  const sb = freshTab(10);
  await sb.run('saveAllData()');
  const invalid = sb.durableSnapshot();
  invalid.data.inventoryMovements = { corrupto: true };
  assert.equal(sb.run(`_naApplySnapshot(${JSON.stringify(invalid)})`), false);
});

test('T22 — snapshot inválido no altera memoria ni durable', async () => {
  const sb = freshTab(10);
  await stockMove(sb, 'entrada', 5);
  await sb.run('saveAllData()');
  const memoryBefore = sb.memoryState();
  const durableBefore = sb.durableRaw();
  const invalid = sb.durableSnapshot();
  invalid.data.productos[0].stock = 999;
  invalid.data.inventoryMovements = 'historial-corrupto';
  assert.equal(sb.run(`_naApplySnapshot(${JSON.stringify(invalid)})`), false);
  assert.deepEqual(sb.memoryState(), memoryBefore, 'el rechazo ocurre antes de mutar memoria');
  assert.equal(sb.durableRaw(), durableBefore, 'el durable vigente queda byte-fiel');
  assert.throws(() => sb.run(`_naPrepareBackupSnapshot(${JSON.stringify(invalid)})`), /inventoryMovements.*lista/i);
  assert.deepEqual(sb.memoryState(), memoryBefore, 'preparar el import inválido tampoco muta memoria');
  assert.equal(sb.durableRaw(), durableBefore);
});

test('T23 — IDs duplicados invalidan todo el import', async () => {
  const sb = freshTab(10);
  await sb.run('saveAllData()');
  const backup = sb.durableSnapshot();
  backup.data.inventoryMovements = [
    importedMovement({ id: 'IM-DUP', before: 0, delta: 5, after: 5 }),
    importedMovement({ id: 'IM-DUP', before: 5, delta: 1, after: 6 }),
  ];
  assert.throws(() => sb.run(`_naPrepareBackupSnapshot(${JSON.stringify(backup)})`), /identificador duplicado/i);
  assert.equal(movs(sb).length, 0, 'el ledger actual no recibe filas parciales');
});

test('T24 — after distinto de before + delta invalida todo el import', async () => {
  const sb = freshTab(10);
  await sb.run('saveAllData()');
  const backup = sb.durableSnapshot();
  backup.data.inventoryMovements = [importedMovement({ before: 10, delta: 1, after: 999 })];
  assert.throws(() => sb.run(`_naPrepareBackupSnapshot(${JSON.stringify(backup)})`), /after no coincide/i);
  assert.equal(movs(sb).length, 0);
});

test('T25 — cadena incoherente por producto invalida todo el import', async () => {
  const sb = freshTab(10);
  await sb.run('saveAllData()');
  const backup = sb.durableSnapshot();
  backup.data.inventoryMovements = [
    importedMovement({ id: 'IM-CHAIN-1', before: 0, delta: 5, after: 5 }),
    importedMovement({ id: 'IM-CHAIN-2', before: 9, delta: 1, after: 10 }),
  ];
  assert.throws(() => sb.run(`_naPrepareBackupSnapshot(${JSON.stringify(backup)})`), /cadena incoherente/i);
  assert.equal(movs(sb).length, 0);
});
