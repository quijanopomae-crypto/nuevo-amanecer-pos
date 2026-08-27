// GATE 7 — CREDIT PAYMENT IDENTITY
//
// Demuestra el flujo ACTUAL de confirmarPago (abono de crédito):
//   - pagoId preservado dentro del flujo (payment.pagoId == cajMovs.pagoId);
//   - creditoId propagado (payment y movimiento de caja referencian el crédito);
//   - pagoId propagado a cajMovs (movimiento tipo 'cob' enlazado);
//   - crédito y movimiento de caja quedan enlazados (ambos con el mismo pagoId);
//   - el dedupe digital sigue funcionando (número de operación no reutilizable);
//   - alcance single-tab: V9 no promete coordinación cross-tab (ver gate 1).
//
// Winner: wrapper F10 (inline-07) sobre la base inline-02. No se modifica producto.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  localScriptOrder, scanDefinitions, fileMatchLines, sliceBetween,
} from './lib/product.mjs';
import { createPosSandbox, json } from './lib/sandbox.mjs';
import { writeEvidence } from './lib/evidence.mjs';

const facts = { checks: [], identity: {} };
function check(id, description, pass, detail = '') {
  facts.checks.push({ id, description, result: pass ? 'PASS' : 'FAIL', detail });
  assert.ok(pass, `${id}: ${description}${detail ? ` — ${detail}` : ''}`);
}

const INLINE_02 = 'js/legacy-inline/inline-02.js';
const INLINE_07 = 'js/legacy-inline/inline-07.js';

const CLIENTE = {
  id: 'C1', nombre: 'Cliente Prueba', dni: '99999999', color: 0, totalCompras: 0,
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
  sb.seedData('clientes', [{ ...CLIENTE }]);
  sb.seedData('creditos', [seed]);
  sb.run('cliRender()');
  return sb;
}

function pay(sb, monto, metodo, operacion) {
  sb.run(`pagoCredId=9001;`);
  sb.el('pagoMonto').value = String(monto);
  sb.el('pagoMetodo').value = metodo;
  sb.el('pagoOperacion').value = operacion;
  return sb.run('confirmarPago()');
}

test('G7.1 — Estático: winner de confirmarPago y propagación de identidad en la base', () => {
  const order = localScriptOrder();
  const idx = (rel) => order.indexOf(rel);
  check('G7.1a', 'orden de carga: inline-02 < inline-07', idx(INLINE_02) < idx(INLINE_07));
  check('G7.1b', 'inline-07 captura la base y reasigna el wrapper de autorización',
    fileMatchLines(INLINE_07, 'const _naF10BaseConfirmarPago\\s*=\\s*confirmarPago').length === 1);
  const later = order.slice(idx(INLINE_07) + 1).filter((rel) => /inline-\d+\.js$/.test(rel));
  const reassign = later.filter((rel) => scanDefinitions(rel, 'confirmarPago').length > 0);
  check('G7.1c', 'ningún archivo posterior redefine confirmarPago (winner = wrapper F10)',
    reassign.length === 0, reassign.join(','));
  const body = sliceBetween(INLINE_02, 'confirmarPago=async function(){', 'cliRender=function()') ?? '';
  check('G7.1d', 'el pago nace con pagoId y creditoId propios',
    body.includes('pagoId:paymentId,creditoId:cr.id'));
  check('G7.1e', 'el movimiento de caja recibe creditoId:cr.id y pagoId:paymentId',
    body.includes('creditoId:cr.id,pagoId:paymentId'));
  check('G7.1f', 'el dedupe de operación digital existe (_naCreditPaymentOperationUsed)',
    body.includes('_naCreditPaymentOperationUsed(operation)'));
});

test('G7.2 — RUNTIME: pago digital preserva pagoId y lo propaga al movimiento de caja', async () => {
  const sb = freshTab();
  await sb.run('saveAllData()');
  await pay(sb, 30, 'yape', 'OP-778899');
  const mem = sb.memoryState();
  assert.equal(mem.creditos[0].pagos.length, 1, 'un pago registrado');
  const pago = mem.creditos[0].pagos[0];
  const mov = mem.cajMovs[0];
  check('G7.2a', 'pagoId preservado dentro del pago', typeof pago.pagoId === 'string' && pago.pagoId.startsWith('P-'));
  check('G7.2b', 'creditoId propagado al pago', String(pago.creditoId) === '9001');
  check('G7.2c', 'pagoId propagado a cajMovs (movimiento cob)', mov.tipo === 'cob' && mov.pagoId === pago.pagoId);
  check('G7.2d', 'crédito y movimiento de caja quedan enlazados (mismo pagoId y creditoId)',
    String(mov.creditoId) === '9001' && mov.pagoId === pago.pagoId);
  check('G7.2e', 'saldos consistentes: pagado 30, saldo 70, saldos del pago 100→70',
    mem.creditos[0].pagado === 30 && mem.creditos[0].saldo === 70 &&
    pago.saldoAnterior === 100 && pago.saldoActual === 70);
  const durable = sb.durableSnapshot();
  check('G7.2f', 'la identidad persiste en el snapshot durable',
    durable?.data?.cajMovs?.[0]?.pagoId === pago.pagoId &&
    String(durable?.data?.cajMovs?.[0]?.creditoId) === '9001' &&
    durable?.data?.creditos?.[0]?.pagos?.[0]?.pagoId === pago.pagoId);
  facts.identity.pagoId = pago.pagoId;
  facts.identity.creditoId = '9001';
});

test('G7.3 — RUNTIME: dedupe digital — el número de operación no se puede reutilizar', async () => {
  const sb = freshTab();
  await pay(sb, 30, 'yape', 'OP-778899');
  const movsBefore = json(sb, 'cajMovs.length');
  const pagosBefore = json(sb, 'creditos[0].pagos.length');
  await pay(sb, 20, 'yape', 'OP-778899'); // misma operación → debe rechazarse
  const toast = sb.toastText();
  assert.equal(json(sb, 'cajMovs.length'), movsBefore, 'sin movimiento duplicado');
  assert.equal(json(sb, 'creditos[0].pagos.length'), pagosBefore, 'sin pago duplicado');
  check('G7.3', 'rechazo visible por operación duplicada', /ya fue registrado/i.test(toast), `toast: "${toast}"`);
});

test('G7.4 — RUNTIME: el abono no puede superar el saldo pendiente', async () => {
  const sb = freshTab();
  await pay(sb, 30, 'yape', 'OP-778899'); // saldo 70
  const movsBefore = json(sb, 'cajMovs.length');
  await pay(sb, 200, 'transferencia', 'OP-999111'); // 200 > 70 → rechazo
  const toast = sb.toastText();
  assert.equal(json(sb, 'cajMovs.length'), movsBefore, 'sin movimiento por sobrepago');
  check('G7.4', 'sobrepago rechazado', /supera el saldo/i.test(toast), `toast: "${toast}"`);
});

test('G7.5 — RUNTIME: pago en efectivo exige caja abierta (alcance actual)', async () => {
  const sb = freshTab();
  sb.run(`cajEstado={abierta:false,cerrada:true,sessionId:null};`);
  await pay(sb, 30, 'efectivo', '');
  const toast = sb.toastText();
  check('G7.5', 'cobro en efectivo sin caja abierta es rechazado', /caja/i.test(toast), `toast: "${toast}"`);
});

test('G7.6 — RUNTIME: rollback del pago mantiene identidad sin residuos', async () => {
  const sb = freshTab();
  await sb.run('saveAllData()');
  const durableBefore = sb.durableSnapshot();
  sb.breakPersistent();
  await pay(sb, 40, 'efectivo', '');
  sb.restorePersistent();
  const mem = sb.memoryState();
  check('G7.6', 'fallo de persistencia: sin pagos ni movimientos huérfanos; durable previo intacto',
    mem.creditos[0].pagos.length === 0 && mem.cajMovs.length === 0 && mem.creditos[0].pagado === 0 &&
    JSON.stringify(sb.durableSnapshot()) === JSON.stringify(durableBefore));
});

after(() => {
  writeEvidence('gate7-credit-payment-identity.json', {
    gate: 'GATE 7 — CREDIT PAYMENT IDENTITY',
    verdict: facts.checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL',
    scope: 'single-tab (V9 no promete coordinación cross-tab; ver gate1)',
    winner: 'inline-07 wrapper (autorización credits) sobre base inline-02',
    identity: facts.identity,
    ...facts,
  });
});
