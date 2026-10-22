import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Sin document: el módulo solo publica la API, no monta UI.
const context = vm.createContext({});
vm.runInContext(readFileSync('POS/js/modules/cliente-estado-cuenta.js', 'utf8'), context);
const M = context.NA_CLIENTE_ESTADO_CUENTA;
const plain = v => JSON.parse(JSON.stringify(v));

// API falsa: devuelve en .all los créditos ya filtrados (sin anulados), como summarizeClient(client, true).
const apiFor = credits => ({ calls: [], summarizeClient(client, flag) { this.calls.push([client, flag]); return { all: credits }; } });
const client = { id: 7, nombre: 'Ana' };

test('saldo acumulado: cargos suman, abonos restan, en orden cronológico', () => {
  const api = apiFor([
    { timestamp: '2026-03-05T15:00:00Z', monto: 50, desc: 'Venta 2', pagos: [] },
    { timestamp: '2026-03-01T15:00:00Z', monto: 100, desc: 'Venta 1', pagos: [
      { timestamp: '2026-03-02T15:00:00Z', monto: 30, metodo: 'Efectivo' },
      { timestamp: '2026-03-06T15:00:00Z', montoPagado: 40 }
    ] }
  ]);
  const s = plain(M.buildStatement(client, api));
  assert.deepEqual(plain(s.rows).map(r => [r.type, r.amount, r.balance]), [
    ['cargo', 100, 100], ['abono', 30, 70], ['cargo', 50, 120], ['abono', 40, 80]
  ]);
  assert.equal(s.charged, 150); assert.equal(s.paid, 70); assert.equal(s.balance, 80);
  assert.equal(s.rows[1].detail, 'Abono · Efectivo');
  assert.equal(s.rows[3].detail, 'Abono');
  assert.equal(s.rows[0].detail, 'Venta 1');
  assert.deepEqual(plain(api.calls[0]), [client, true]);
});

test('céntimos sin error de coma flotante', () => {
  const s = M.buildStatement(client, apiFor([
    { fecha: '2026-01-01', monto: 0.1, pagos: [] }, { fecha: '2026-01-02', monto: 0.2, pagos: [{ fecha: '2026-01-03', monto: 0.3 }] }
  ]));
  assert.equal(s.charged, 0.3); assert.equal(s.paid, 0.3); assert.equal(s.balance, 0);
});

test('abonos revertidos (status REVERTED o reversalId) y nulos no cuentan', () => {
  const s = M.buildStatement(client, apiFor([{ timestamp: '2026-03-01T15:00:00Z', monto: 100, pagos: [
    { timestamp: '2026-03-02T15:00:00Z', monto: 10, status: 'reverted' },
    { timestamp: '2026-03-02T16:00:00Z', monto: 20, reversalId: 'r1' },
    null,
    { timestamp: '2026-03-02T17:00:00Z', monto: 25, status: 'OK' }
  ] }]));
  assert.equal(s.rows.length, 2); assert.equal(s.paid, 25); assert.equal(s.balance, 75);
});

test('solo usa los créditos que entrega summarizeClient (anulados ya excluidos)', () => {
  const s = M.buildStatement(client, apiFor([]));
  assert.deepEqual(plain(s), { rows: [], charged: 0, paid: 0, balance: 0 });
  const s2 = M.buildStatement(client, { summarizeClient: () => ({}) });
  assert.equal(s2.rows.length, 0);
});

test('fechas en hora de Lima (UTC-5): cruce de medianoche, offset y sin zona', () => {
  const s = M.buildStatement(client, apiFor([{ timestamp: '2026-03-02T03:30:00Z', monto: 10, pagos: [
    { timestamp: '2026-03-02T10:15:00+05:00', monto: 1 },
    { timestamp: '2026-03-02T20:00:00', monto: 1 },
    { fecha: '2026-03-03', monto: 1 }
  ] }]));
  assert.deepEqual(plain(s.rows).map(r => [r.day, r.time]), [
    ['2026-03-01', '22:30'], ['2026-03-02', '00:15'], ['2026-03-02', '20:00'], ['2026-03-03', '']
  ]);
  assert.equal(plain(M.limaMoment('basura')).key, '');
  assert.equal(M.limaMoment('2026-03-02T05:00:00.000Z').day, '2026-03-02');
  assert.equal(M.limaMoment('2026-03-02T04:59:00.000Z').day, '2026-03-01');
});

test('mismo instante: el cargo va antes que su abono', () => {
  const t = '2026-03-01T15:00:00Z';
  const s = M.buildStatement(client, apiFor([{ timestamp: t, monto: 20, pagos: [{ timestamp: t, monto: 20 }] }]));
  assert.deepEqual(plain(s.rows).map(r => [r.type, r.balance]), [['cargo', 20], ['abono', 0]]);
});

test('entrada inválida lanza error', () => {
  assert.throws(() => M.buildStatement(null, apiFor([])), /no disponibles/);
  assert.throws(() => M.buildStatement(client, null), /no disponibles/);
  assert.throws(() => M.buildStatement(client, {}), /no disponibles/);
});

test('money: miles con coma, dos decimales y signo', () => {
  assert.equal(M.money(0), 'S/ 0.00');
  assert.equal(M.money(999.999), 'S/ 1,000.00');
  assert.equal(M.money(1234567.5), 'S/ 1,234,567.50');
  assert.equal(M.money(-1234.5), '-S/ 1,234.50');
  assert.equal(M.money('abc'), 'S/ 0.00');
});

test('abono con fecha pero sin hora va después de los cargos con hora del mismo día; el saldo nunca queda negativo', () => {
  const s = plain(M.buildStatement(client, apiFor([
    { timestamp: '2026-04-10T23:30:00Z', monto: 80, desc: 'Venta tarde', pagos: [{ fecha: '2026-04-10', monto: 80 }] },
    { timestamp: '2026-04-10T14:00:00Z', monto: 20, desc: 'Venta mañana', pagos: [{ fecha: '2026-04-10', monto: 20 }] }
  ])));
  assert.deepEqual(s.rows.map(r => [r.type, r.time, r.amount, r.balance]), [
    ['cargo', '09:00', 20, 20], ['cargo', '18:30', 80, 100], ['abono', '', 80, 20], ['abono', '', 20, 0]
  ]);
  assert.ok(s.rows.every(r => r.balance >= 0));
  // La fecha mostrada no cambia: mismo día, sin hora, clave original.
  assert.equal(s.rows[2].day, '2026-04-10'); assert.equal(s.rows[2].key, '2026-04-10T00:00');
  assert.equal(s.balance, 0);
});

test('abono sin hora va antes de los movimientos del día siguiente', () => {
  const s = plain(M.buildStatement(client, apiFor([
    { timestamp: '2026-04-10T15:00:00Z', monto: 50, pagos: [{ fecha: '2026-04-10', monto: 30 }] },
    { timestamp: '2026-04-11T05:30:00Z', monto: 10, pagos: [] }
  ])));
  assert.deepEqual(s.rows.map(r => [r.type, r.day, r.balance]), [
    ['cargo', '2026-04-10', 50], ['abono', '2026-04-10', 20], ['cargo', '2026-04-11', 30]
  ]);
});

test('cargo y abono ambos sin hora el mismo día: se mantiene primero el cargo', () => {
  const s = plain(M.buildStatement(client, apiFor([
    { fecha: '2026-04-12', monto: 40, pagos: [{ fecha: '2026-04-12', monto: 40 }] }
  ])));
  assert.deepEqual(s.rows.map(r => [r.type, r.balance]), [['cargo', 40], ['abono', 0]]);
});
