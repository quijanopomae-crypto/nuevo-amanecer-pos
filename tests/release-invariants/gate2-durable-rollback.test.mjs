// GATE 2 — DURABLE ROLLBACK
//
// Caracteriza los caminos: venta, pago crédito, caja (movimiento y gasto) y
// movimiento de inventario. Simula fallo de persistencia con el harness
// (localStorage saboteado; sessionStorage sano → resultado "temporary",
// durable=false) y demuestra que:
//
//   estado de memoria tras rollback  ==  snapshot durable previo
//
// y que el snapshot durable previo NO fue alterado. Además, control de camino
// exitoso por operación (persistencia verificada). No se exige ninguna garantía
// nueva al producto: solo se demuestra el comportamiento actual.
//
// PASS = la caracterización coincide con el comportamiento real del producto.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPosSandbox, json } from './lib/sandbox.mjs';
import { writeEvidence } from './lib/evidence.mjs';
import { sliceBetween } from './lib/product.mjs';

const facts = { checks: [], paths: {} };
function check(id, description, pass, detail = '') {
  facts.checks.push({ id, description, result: pass ? 'PASS' : 'FAIL', detail });
  assert.ok(pass, `${id}: ${description}${detail ? ` — ${detail}` : ''}`);
}

const PRODUCTO = { id: 'P1', name: 'Arroz', stock: 10, controlInventario: true, precio: 10, costo: 5, unidad: 'unidad' };
const CLIENTE = {
  id: 'C1', nombre: 'Cliente Prueba', dni: '99999999', color: 0, totalCompras: 0,
  lineaCreditoManualActiva: true, lineaCreditoManual: 500, lineaCreditoManualMotivo: 'Linea manual de pruebas establecida',
};
const CREDITO = {
  id: 9001, cliId: 'C1', clienteId: 'C1', clienteNombre: 'Cliente Prueba', tipo: 'venta_credito',
  desc: 'Venta C1', monto: 100, pagado: 0, saldo: 100, vence: '2026-12-31', status: 'vigente',
  fecha: null, anulado: false, pagos: [], items: [],
};

function freshTab() {
  const sb = createPosSandbox();
  sb.seed();
  const seed = { ...CREDITO, fecha: json(sb, 'obtenerHoy()') };
  sb.seedData('productos', [{ ...PRODUCTO }]);
  sb.seedData('clientes', [{ ...CLIENTE }]);
  sb.seedData('creditos', [seed]);
  // Normaliza créditos AHORA (mismo paso que hace cliRender tras cada operación)
  // para que el snapshot durable previo y la memoria post-rollback tengan la
  // misma forma canónica.
  sb.run('cliRender()');
  return sb;
}

/** Baseline: snapshot durable S0 con memoria == S0. */
async function durableBaseline(sb) {
  await sb.run('saveAllData()');
  const snap = sb.durableSnapshot();
  assert.ok(snap, 'el snapshot durable inicial debe existir');
  const mem = sb.memoryState();
  for (const k of ['productos', 'ventas', 'clientes', 'creditos', 'gastos', 'cajMovs', 'cajEstado']) {
    assert.deepEqual(mem[k], snap.data[k], `memoria vs durable (${k}) al inicio`);
  }
  return snap;
}

function assertMemoryEqualsDurable(sb, snap, label) {
  const mem = sb.memoryState();
  for (const k of ['productos', 'ventas', 'clientes', 'creditos', 'gastos', 'cajMovs', 'cajEstado']) {
    assert.deepEqual(mem[k], snap.data[k], `${label}: memoria(${k}) != snapshot durable previo`);
  }
  assert.deepEqual(sb.durableSnapshot(), snap, `${label}: el snapshot durable previo fue alterado`);
}

test('G2.0 — El patrón backup→persist→rollback existe en las cinco operaciones', () => {
  const op = (rel, from, to) => sliceBetween(rel, from, to) ?? '';
  const venta = op('js/legacy-inline/inline-02.js', 'confirmarVenta=async function(){', 'abrirModalProd=');
  const pago = op('js/legacy-inline/inline-02.js', 'confirmarPago=async function(){', 'cliRender=function()');
  const caja = op('js/legacy-inline/inline-02.js', 'guardarMovCaja=async function(){', 'cerrarCaja=');
  const gasto = op('js/legacy-inline/inline-03.js', 'guardarGasto=async function(){', null);
  const inv = op('js/legacy-inline/inline-16.js', 'guardarMovInv=async function(){', null);
  for (const [name, src, marker] of [
    ['venta', venta, "throw new Error('No se pudo confirmar el guardado permanente')"],
    ['pago crédito', pago, 'catch(error){creditos=backup.creditos;cajMovs=backup.cajMovs;'],
    ['caja (movimiento)', caja, 'cajMovs=backup;await saveAllData();'],
    ['caja (gasto)', gasto, 'gastos=backup.gastos;cajMovs=backup.cajMovs;'],
    ['inventario', inv, 'product.stock=beforeStock;await saveAllData();'],
  ]) {
    check(`G2.0:${name}`, 'rollback explícito cuando la persistencia no está verificada', src.includes(marker), marker);
  }
});

test('G2.1 — VENTA: fallo de persistencia restaura venta, stock, caja y conserva el carrito', async () => {
  const sb = freshTab();
  const snap = await durableBaseline(sb);
  sb.run(`cart.push({id:'P1',precio:10,qty:2,unitsPerQty:1,ventaModo:'unidad',costo:5,controlInventario:true,ventaLibre:false,ventaSinStock:false,unidad:'unidad'});`);
  sb.el('mMontoRec').value = '20';
  sb.breakPersistent();
  await sb.run('confirmarVenta()');
  sb.restorePersistent();
  assert.equal(json(sb, 'ventas.length'), 0, 'la venta no debe quedar en memoria');
  assert.equal(json(sb, 'cajMovs.length'), 0, 'el movimiento de caja no debe quedar');
  assert.equal(sb.memoryState().productos[0].stock, 10, 'el stock debe volver a 10');
  assert.equal(sb.memoryState().cart.length, 1, 'el carrito se conserva (venta no registrada)');
  assertMemoryEqualsDurable(sb, snap, 'venta');
  facts.paths.venta = 'PASS (memoria == snapshot durable previo; carrito conservado)';
});

test('G2.2 — PAGO DE CRÉDITO: fallo de persistencia restaura crédito y caja', async () => {
  const sb = freshTab();
  const snap = await durableBaseline(sb);
  sb.run('pagoCredId=9001;');
  sb.el('pagoMonto').value = '40';
  sb.el('pagoMetodo').value = 'efectivo';
  sb.breakPersistent();
  await sb.run('confirmarPago()');
  sb.restorePersistent();
  const mem = sb.memoryState();
  assert.equal(mem.creditos[0].pagado, 0, 'cr.pagado restaurado');
  assert.equal(mem.creditos[0].pagos.length, 0, 'sin pago huérfano');
  assert.equal(mem.cajMovs.length, 0, 'sin movimiento de caja huérfano');
  assertMemoryEqualsDurable(sb, snap, 'pago crédito');
  facts.paths.pagoCredito = 'PASS (memoria == snapshot durable previo)';
});

test('G2.3 — CAJA (movimiento): fallo de persistencia restaura cajMovs', async () => {
  const sb = freshTab();
  const snap = await durableBaseline(sb);
  sb.run(`cajMovTipo='egr';`);
  sb.el('cajMovMonto').value = '50';
  sb.el('cajMovDesc').value = 'Retiro de prueba';
  sb.el('cajMovMetodo').value = 'efectivo';
  sb.el('cajMovCat').value = 'Otros';
  sb.breakPersistent();
  await sb.run('guardarMovCaja()');
  sb.restorePersistent();
  assert.equal(sb.memoryState().cajMovs.length, 0, 'sin movimiento huérfano');
  assertMemoryEqualsDurable(sb, snap, 'caja movimiento');
  facts.paths.cajaMovimiento = 'PASS (memoria == snapshot durable previo)';
});

test('G2.4 — CAJA (gasto): fallo de persistencia restaura gastos y cajMovs', async () => {
  const sb = freshTab();
  const snap = await durableBaseline(sb);
  sb.el('gasDesc').value = 'Luz';
  sb.el('gasMonto').value = '30';
  sb.el('gasMetodo').value = 'efectivo';
  sb.el('gasCat').value = 'Servicios';
  sb.el('gasFecha').value = json(sb, 'obtenerHoy()');
  sb.el('gasNota').value = '';
  sb.breakPersistent();
  await sb.run('guardarGasto()');
  sb.restorePersistent();
  const mem = sb.memoryState();
  assert.equal(mem.gastos.length, 0, 'sin gasto huérfano');
  assert.equal(mem.cajMovs.length, 0, 'sin movimiento de gasto huérfano');
  assertMemoryEqualsDurable(sb, snap, 'caja gasto');
  facts.paths.cajaGasto = 'PASS (memoria == snapshot durable previo)';
});

test('G2.5 — INVENTARIO: fallo de persistencia restaura el stock anterior', async () => {
  const sb = freshTab();
  const snap = await durableBaseline(sb);
  sb.run(`invMovId='P1';invMovT='salida';`);
  sb.el('mMovCant').value = '4';
  sb.breakPersistent();
  await sb.run('guardarMovInv()');
  sb.restorePersistent();
  assert.equal(sb.memoryState().productos[0].stock, 10, 'stock restaurado a 10');
  assert.equal(json(sb, '_naInventoryMoveBusy'), false, 'flag de doble ejecución liberado');
  assertMemoryEqualsDurable(sb, snap, 'inventario');
  facts.paths.inventario = 'PASS (memoria == snapshot durable previo)';
});

test('G2.6 — Control: con persistencia sana cada camino SÍ persiste (guarda anti-falso-PASS)', async () => {
  // venta
  let sb = freshTab();
  await durableBaseline(sb);
  sb.run(`cart.push({id:'P1',precio:10,qty:1,unitsPerQty:1,ventaModo:'unidad',costo:5,controlInventario:true,ventaLibre:false,ventaSinStock:false,unidad:'unidad'});`);
  sb.el('mMontoRec').value = '10';
  await sb.run('confirmarVenta()');
  assert.equal(json(sb, 'ventas.length'), 1, 'venta registrada en memoria');
  await sb.run('saveAllData()');
  assert.deepEqual(sb.memoryState().ventas, sb.durableSnapshot().data.ventas, 'venta durable == memoria');
  assert.deepEqual(sb.memoryState().productos, sb.durableSnapshot().data.productos, 'stock durable == memoria');

  // pago crédito
  sb = freshTab();
  await durableBaseline(sb);
  sb.run('pagoCredId=9001;');
  sb.el('pagoMonto').value = '40';
  sb.el('pagoMetodo').value = 'efectivo';
  await sb.run('confirmarPago()');
  assert.equal(sb.memoryState().creditos[0].pagado, 40, 'pago aplicado en memoria');
  await sb.run('saveAllData()');
  assert.deepEqual(sb.memoryState().creditos, sb.durableSnapshot().data.creditos, 'crédito durable == memoria');
  assert.deepEqual(sb.memoryState().cajMovs, sb.durableSnapshot().data.cajMovs, 'caja durable == memoria');

  // caja movimiento
  sb = freshTab();
  await durableBaseline(sb);
  sb.run(`cajMovTipo='egr';`);
  sb.el('cajMovMonto').value = '50';
  sb.el('cajMovDesc').value = 'Retiro';
  sb.el('cajMovMetodo').value = 'efectivo';
  sb.el('cajMovCat').value = 'Otros';
  await sb.run('guardarMovCaja()');
  assert.equal(json(sb, 'cajMovs.length'), 1, 'movimiento registrado');
  await sb.run('saveAllData()');
  assert.deepEqual(sb.memoryState().cajMovs, sb.durableSnapshot().data.cajMovs, 'movimiento durable == memoria');

  // gasto
  sb = freshTab();
  await durableBaseline(sb);
  sb.el('gasDesc').value = 'Luz';
  sb.el('gasMonto').value = '30';
  sb.el('gasMetodo').value = 'efectivo';
  sb.el('gasCat').value = 'Servicios';
  sb.el('gasFecha').value = json(sb, 'obtenerHoy()');
  await sb.run('guardarGasto()');
  assert.equal(json(sb, 'gastos.length'), 1, 'gasto registrado');
  await sb.run('saveAllData()');
  assert.deepEqual(sb.memoryState().gastos, sb.durableSnapshot().data.gastos, 'gasto durable == memoria');
  assert.deepEqual(sb.memoryState().cajMovs, sb.durableSnapshot().data.cajMovs, 'gasto en caja durable == memoria');

  // inventario
  sb = freshTab();
  await durableBaseline(sb);
  sb.run(`invMovId='P1';invMovT='entrada';`);
  sb.el('mMovCant').value = '3';
  await sb.run('guardarMovInv()');
  assert.equal(sb.memoryState().productos[0].stock, 13, 'stock aplicado en memoria');
  await sb.run('saveAllData()');
  assert.deepEqual(sb.memoryState().productos, sb.durableSnapshot().data.productos, 'stock durable == memoria');

  facts.paths.controlPersistenciaSana = 'PASS (venta/pago/caja/gasto/inventario persisten verificado)';
});

after(() => {
  writeEvidence('gate2-durable-rollback.json', {
    gate: 'GATE 2 — DURABLE ROLLBACK',
    verdict: facts.checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL',
    method: 'harness: localStorage saboteado (durable=false), sessionStorage sano (temporary)',
    invariant: 'estado memoria tras rollback == snapshot durable previo (sin alterar el durable previo)',
    ...facts,
  });
});
