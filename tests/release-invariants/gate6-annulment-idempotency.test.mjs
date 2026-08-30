// GATE 6 — ANNULMENT IDEMPOTENCY
//
// Demuestra el comportamiento ACTUAL de anularV (venta):
//   - primera anulación: crea UN reversal en caja (reversal:true, reversalOf:id);
//   - segunda anulación: NO crea otro reversal (guard v.anulada);
//   - reversalOf es ÚNICO (no hay duplicados para la misma venta).
//
// Winner: wrapper de seguridad inline-03 (_naAuthorize 'anularVenta') sobre la
// base inline-02. No se modifica producto.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  localScriptOrder, scanDefinitions, fileMatchLines, sliceBetween,
} from './lib/product.mjs';
import { createPosSandbox, json } from './lib/sandbox.mjs';
import { writeEvidence } from './lib/evidence.mjs';

const facts = { checks: [] };
function check(id, description, pass, detail = '') {
  facts.checks.push({ id, description, result: pass ? 'PASS' : 'FAIL', detail });
  assert.ok(pass, `${id}: ${description}${detail ? ` — ${detail}` : ''}`);
}

const INLINE_02 = 'js/legacy-inline/inline-02.js';
const INLINE_03 = 'js/legacy-inline/inline-03.js';

function freshTab() {
  const sb = createPosSandbox();
  sb.seed();
  sb.seedData('productos', [
    { id: 'P1', name: 'Arroz', stock: 0, controlInventario: true, precio: 10, costo: 5, unidad: 'unidad' },
  ]);
  sb.seedData('ventas', [{
    id: 'V-001', operation: '00000001', fecha: json(sb, 'obtenerHoy()'), hora: '09:00:00', hora24: '09:00:00',
    timestamp: new Date().toISOString(), cajero: 'Cajero 1', cajeroNombre: 'Cajero 1', cajeroId: 'CAJ-001',
    total: 20, subtotal: 20, descuentoTotal: 0, metodo: 'efectivo', metodoPago: 'efectivo', estado: 'completada',
    tipoVenta: 'minorista', cantidadLineas: 1, unidadesFisicas: 2, paymentRef: '', paymentBreakdown: null,
    recibido: 20, vuelto: 0, anulada: false, clienteId: null, clienteNombre: null, clienteDni: null, creditId: null,
    items: [{ id: 'P1', productoId: 'P1', name: 'Arroz', nombre: 'Arroz', qty: 2, cantidad: 2, precio: 10,
      precioUnitario: 10, subtotal: 20, costo: 5, unitsPerQty: 1, ventaModo: 'unidad', modo: 'minorista' }],
  }]);
  sb.seedData('cajMovs', [{
    id: 1, tipo: 'ing', monto: 20, efectivo: 20, digital: 0, desc: 'Venta POS V-001', cat: 'Venta retail',
    metodo: 'efectivo', referencia: '', hora: '09:00:00', hora24: '09:00:00', timestamp: new Date().toISOString(),
    cajero: 'Cajero 1', cajeroNombre: 'Cajero 1', cajeroId: 'CAJ-001', fecha: json(sb, 'obtenerHoy()'),
    sessionId: 1700000000000, ventaId: 'V-001',
  }]);
  return sb;
}

function reversals(sb) {
  return json(sb, "cajMovs.filter(m=>m.reversal===true)");
}

test('G6.1 — Estático: winner de anularV y guards de idempotencia', () => {
  const order = localScriptOrder();
  const idx = (rel) => order.indexOf(rel);
  check('G6.1a', 'orden de carga: inline-02 < inline-03', idx(INLINE_02) < idx(INLINE_03));
  check('G6.1b', 'inline-03 captura la base y reasigna el wrapper con autorización',
    fileMatchLines(INLINE_03, 'const _naSecOriginalAnularV\\s*=\\s*anularV').length === 1);
  const later = order.slice(idx(INLINE_03) + 1).filter((rel) => /inline-\d+\.js$/.test(rel));
  const reassign = later.filter((rel) => scanDefinitions(rel, 'anularV').length > 0);
  check('G6.1c', 'ningún archivo posterior redefine anularV (winner = wrapper inline-03)',
    reassign.length === 0, reassign.join(','));

  const base = sliceBetween(INLINE_02, 'anularV=async function(id){', null) ?? '';
  check('G6.1d', 'base tiene guard v.anulada (segunda anulación sin efecto)',
    base.includes('if(v.anulada){toast('));
  check('G6.1e', 'base tiene guard _naSaleHasReversal antes de crear un reversal económico para cualquier método',
    base.includes('if(!_naSaleHasReversal(v.id))'));
  check('G6.1f', 'el reversal se crea con reversal:true y reversalOf:v.id',
    base.includes('reversal:true,reversalOf:v.id'));
  const guardFn = sliceBetween(INLINE_02, 'function _naSaleHasReversal(saleId){', 'anularV=async function') ?? '';
  check('G6.1g', '_naSaleHasReversal exige un movimiento de reversión de venta enlazado',
    guardFn.includes('_naIsSaleReversalMove(move)&&String(move.reversalOf)===String(saleId)'));
});

test('G6.2 — RUNTIME: primera anulación crea exactamente UN reversal enlazado', async () => {
  const sb = freshTab();
  await sb.run('saveAllData()');
  await sb.run('anularV("V-001")');
  const mem = sb.memoryState();
  const rev = reversals(sb);
  assert.equal(rev.length, 1, 'un solo reversal');
  check('G6.2a', 'reversal enlazado a V-001 (reversalOf)', String(rev[0].reversalOf) === 'V-001');
  check('G6.2b', 'reversal es un egreso por el total de la venta', rev[0].tipo === 'egr' && rev[0].monto === 20);
  check('G6.2c', 'venta marcada anulada y stock repuesto (+2)', mem.ventas[0].anulada === true && mem.productos[0].stock === 2);
  check('G6.2d', 'auditoría de anulación autorizada registrada por el wrapper',
    json(sb, '_naSecurity.logs.some(l=>/Anulación/.test(l.action))') === true);
});

test('G6.3 — RUNTIME: segunda anulación NO crea otro reversal', async () => {
  const sb = freshTab();
  await sb.run('anularV("V-001")');
  const revAfterFirst = reversals(sb);
  const stockAfterFirst = sb.memoryState().productos[0].stock;
  await sb.run('anularV("V-001")');
  const revAfterSecond = reversals(sb);
  assert.equal(revAfterSecond.length, revAfterFirst.length, 'no se duplicó el reversal');
  assert.equal(sb.memoryState().productos[0].stock, stockAfterFirst, 'stock no se duplicó');
  check('G6.3', 'segunda anulación es no-op (idempotente)', revAfterSecond.length === 1);
});

test('G6.4 — RUNTIME: reversalOf es único', async () => {
  const sb = freshTab();
  await sb.run('anularV("V-001")');
  await sb.run('anularV("V-001")');
  await sb.run('anularV("V-001")'); // tercer intento
  const rev = reversals(sb);
  const unique = new Set(rev.map((r) => String(r.reversalOf)));
  check('G6.4', 'para V-001 existe exactamente un reversalOf único tras múltiples intentos',
    rev.length === 1 && unique.size === 1 && unique.has('V-001'));
});

test('G6.5 — RUNTIME: el rollback de la anulación también es durable', async () => {
  const sb = freshTab();
  await sb.run('saveAllData()');
  const durableBefore = sb.durableSnapshot();
  sb.breakPersistent();
  await sb.run('anularV("V-001")');
  sb.restorePersistent();
  const mem = sb.memoryState();
  check('G6.5', 'fallo de persistencia: venta no anulada, stock y reversales restaurados, durable previo intacto',
    mem.ventas[0].anulada === false && mem.productos[0].stock === 0 &&
    reversals(sb).length === 0 &&
    JSON.stringify(sb.durableSnapshot()) === JSON.stringify(durableBefore));
});

after(() => {
  writeEvidence('gate6-annulment-idempotency.json', {
    gate: 'GATE 6 — ANNULMENT IDEMPOTENCY',
    verdict: facts.checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL',
    winner: 'inline-03 wrapper (_naAuthorize anularVenta) sobre base inline-02',
    ...facts,
  });
});
