// GATE 4 — CREDIT LINE SALE (venta a crédito)
//
// Characterization del comportamiento ACTUAL de la venta a crédito:
//   - valida elegibilidad (política F7 habilitada + cliente elegible);
//   - valida línea disponible (total ≤ disponible);
//   - si excede la línea NO crea crédito (ni venta, ni movimiento de caja);
//   - si procede, venta y crédito quedan ENLAZADOS (venta.creditId == credito.id
//     y credito.ventaId == venta.id).
//
// No se inventan reglas nuevas: solo se demuestra el comportamiento real.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  localScriptOrder, scanDefinitions, fileMatchLines, sliceBetween,
} from './lib/product.mjs';
import { createPosSandbox, json } from './lib/sandbox.mjs';
import { writeEvidence } from './lib/evidence.mjs';

const facts = { checks: [], cases: {} };
function check(id, description, pass, detail = '') {
  facts.checks.push({ id, description, result: pass ? 'PASS' : 'FAIL', detail });
  assert.ok(pass, `${id}: ${description}${detail ? ` — ${detail}` : ''}`);
}

const INLINE_02 = 'js/legacy-inline/inline-02.js';
const INLINE_04 = 'js/legacy-inline/inline-04.js';

const PRODUCTO = { id: 'P1', name: 'Arroz', stock: 10, controlInventario: true, precio: 80, costo: 40, unidad: 'unidad' };
const CLIENTE_ELEGIBLE = {
  id: 'C1', nombre: 'Cliente Prueba', dni: '99999999', color: 0, totalCompras: 0,
  lineaCreditoManualActiva: true, lineaCreditoManual: 100, lineaCreditoManualMotivo: 'Linea manual de pruebas establecida',
};

function freshTab() {
  const sb = createPosSandbox();
  sb.seed();
  sb.seedData('productos', [{ ...PRODUCTO }]);
  sb.seedData('clientes', [{ ...CLIENTE_ELEGIBLE }]);
  return sb;
}

function seedCreditSale(sb, precio) {
  sb.run(`
    posPayM='credito';
    cart.push({id:'P1',precio:${precio},qty:1,unitsPerQty:1,ventaModo:'unidad',costo:40,controlInventario:true,ventaLibre:false,ventaSinStock:false,unidad:'unidad'});
    document.getElementById('mCreditoCliente').value='C1';
    document.getElementById('mCreditoVence').value='2026-12-31';
  `);
}

test('G4.1 — Estático: _naPaymentState winner es el override F7 con validación de línea', () => {
  const order = localScriptOrder();
  const idx = (rel) => order.indexOf(rel);
  check('G4.1a', 'orden de carga: inline-02 < inline-04', idx(INLINE_02) < idx(INLINE_04));
  check('G4.1b', 'inline-04 captura la base y reasigna _naPaymentState',
    fileMatchLines(INLINE_04, 'const _naF7BasePaymentState\\s*=\\s*_naPaymentState').length === 1);
  const later = order.slice(idx(INLINE_04) + 1).filter((rel) => /inline-\d+\.js$/.test(rel));
  const reassign = later.filter((rel) => scanDefinitions(rel, '_naPaymentState').length > 0);
  check('G4.1c', 'ningún archivo posterior redefine _naPaymentState (winner = override F7)',
    reassign.length === 0, reassign.join(','));
  const body = sliceBetween(INLINE_04, '_naPaymentState=function(){', null) ?? '';
  check('G4.1d', 'el override F7 valida: política habilitada, cliente, vencimiento, elegibilidad y línea disponible',
    body.includes("_naCreditPolicy()") &&
    body.includes('!e.eligible') &&
    body.includes('total>e.available+.001') &&
    body.includes('insuficiente'));
  facts.cases.winner = 'inline-04 override de _naPaymentState (F7) → usado por confirmarVenta';
});

test('G4.2 — RUNTIME: sin elegibilidad NO se crea crédito', async () => {
  const sb = freshTab();
  // Cliente SIN línea manual y sin compras → no elegible con la política F7.
  sb.run(`clientes[0].lineaCreditoManualActiva=false; delete clientes[0].lineaCreditoManual;`);
  seedCreditSale(sb, 80);
  const state = json(sb, "_naPaymentState()");
  check('G4.2a', '_naPaymentState rechaza cliente no elegible', state.valid === false, state.message);
  await sb.run('saveAllData()');
  await sb.run('confirmarVenta()');
  assert.equal(json(sb, 'ventas.length'), 0);
  assert.equal(json(sb, 'creditos.length'), 0);
  assert.equal(json(sb, 'cajMovs.length'), 0);
  check('G4.2b', 'confirmarVenta no creó venta, crédito ni movimiento de caja', true);
  facts.cases.noElegible = state.message;
});

test('G4.3 — RUNTIME: si el total excede la línea disponible NO se crea crédito', async () => {
  const sb = freshTab();
  seedCreditSale(sb, 150); // disponible 100 → 150 excede la línea
  const state = json(sb, "_naPaymentState()");
  check('G4.3a', '_naPaymentState rechaza por línea insuficiente', state.valid === false, state.message);
  await sb.run('saveAllData()');
  await sb.run('confirmarVenta()');
  const mem = sb.memoryState();
  assert.equal(mem.ventas.length, 0, 'sin venta');
  assert.equal(mem.creditos.length, 0, 'sin crédito (clave del gate)');
  assert.equal(mem.cajMovs.length, 0, 'sin movimiento de caja');
  assert.equal(mem.productos[0].stock, 10, 'stock intacto');
  check('G4.3b', 'exceder la línea no crea crédito ni deja rastro en memoria', true);
  facts.cases.excedeLinea = state.message;
});

test('G4.4 — RUNTIME: política deshabilitada bloquea la venta a crédito', async () => {
  const sb = freshTab();
  sb.run(`appConfig.creditPolicy.enabled=false;`);
  seedCreditSale(sb, 80);
  const state = json(sb, "_naPaymentState()");
  check('G4.4', 'política deshabilitada → inválida ("desactivadas")',
    state.valid === false && /desactivada/i.test(state.message), state.message);
  facts.cases.politicaOff = state.message;
});

test('G4.5 — RUNTIME: si procede, venta y crédito quedan enlazados (y persisten enlazados)', async () => {
  const sb = freshTab();
  seedCreditSale(sb, 80); // 80 ≤ 100 disponibles
  const state = json(sb, "_naPaymentState()");
  check('G4.5a', 'estado válido con mensaje de crédito autorizado', state.valid === true, state.message);
  await sb.run('confirmarVenta()');
  const mem = sb.memoryState();
  assert.equal(mem.ventas.length, 1);
  assert.equal(mem.creditos.length, 1);
  const venta = mem.ventas[0];
  const credito = mem.creditos[0];
  check('G4.5b', 'enlace venta→crédito: venta.creditId === credito.id',
    venta.creditId != null && String(venta.creditId) === String(credito.id));
  check('G4.5c', 'enlace crédito→venta: credito.ventaId === venta.id',
    String(credito.ventaId) === String(venta.id));
  check('G4.5d', 'el crédito nace con monto total de la venta, saldo pendiente y sin pagos',
    credito.monto === 80 && credito.saldo === 80 && credito.pagado === 0 && credito.pagos.length === 0);
  check('G4.5e', 'la venta queda con estado crédito y caja registra el movimiento enlazado',
    venta.estado === 'credito' &&
    mem.cajMovs.length === 1 && String(mem.cajMovs[0].ventaId) === String(venta.id));
  await sb.run('saveAllData()');
  const durable = sb.durableSnapshot();
  check('G4.5f', 'el enlace persiste en el snapshot durable',
    String(durable?.data?.ventas?.[0]?.creditId) === String(durable?.data?.creditos?.[0]?.id) &&
    String(durable?.data?.creditos?.[0]?.ventaId) === String(durable?.data?.ventas?.[0]?.id));
  facts.cases.enlace = { ventaId: venta.id, creditoId: credito.id, monto: credito.monto };
});

test('G4.6 — RUNTIME: la venta a crédito exige caja abierta (comportamiento actual)', async () => {
  const sb = freshTab();
  seedCreditSale(sb, 80);
  sb.run(`cajEstado={abierta:false,cerrada:true,sessionId:null};`); // caja cerrada
  await sb.run('confirmarVenta()');
  assert.equal(json(sb, 'ventas.length'), 0, 'sin caja abierta no hay venta');
  const toast = sb.toastText();
  check('G4.6', 'bloqueo por caja cerrada informado', /caja/i.test(toast), `toast: "${toast}"`);
});

after(() => {
  writeEvidence('gate4-credit-line-sale.json', {
    gate: 'GATE 4 — CREDIT LINE SALE',
    verdict: facts.checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL',
    ...facts,
  });
});
