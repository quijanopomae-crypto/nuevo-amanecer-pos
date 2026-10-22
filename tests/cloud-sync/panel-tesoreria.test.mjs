import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// #164: panel de tesorería, solo turnos abiertos, solo lectura.
const history = readFileSync('POS/js/sync/canonical-cash-history.js', 'utf8');
const source = readFileSync('POS/js/modules/panel-tesoreria.js', 'utf8');
function load(extra = {}) {
  const ctx = vm.createContext({ module: { exports: {} }, ...extra });
  vm.runInContext(history, ctx);
  vm.runInContext(source, ctx);
  return ctx.NA_PANEL_TESORERIA;
}
const snapshot = {
  cashSessions: [
    { session_id: 'a', status: 'OPEN', opened_at: '2026-10-21T13:00:00Z', closed_at: null, opening_cents: 5000, expected_cents: 105000, opened_by_name: 'Ana' },
    { session_id: 'b', status: 'OPEN', opened_at: '2026-10-21T19:30:00Z', closed_at: null, opening_cents: 2000, expected_cents: 2000, opened_by_name: 'Luis' },
    { session_id: 'c', status: 'CLOSED', opened_at: '2026-10-20T13:00:00Z', closed_at: '2026-10-20T23:00:00Z', opening_cents: 5000, expected_cents: 9000, opened_by_name: 'Cerrada' },
  ],
  cashMovements: [
    { session_id: 'a', sale_id: 'v1', amount_cents: 150000, cash_cents: 100000, digital_cents: 50000, digital_method: 'yape', credit_cents: 0 },
    { session_id: 'b', sale_id: 'v2', amount_cents: 5050, cash_cents: 0, digital_cents: 2050, digital_method: 'plin', credit_cents: 3000 },
    { session_id: 'c', sale_id: 'v3', amount_cents: 4000, cash_cents: 0, digital_cents: 4000, digital_method: 'yape', credit_cents: 0 },
  ],
  financialEvents: [{ event_type: 'PAYMENT', session_id: 'a', payment_method: 'transferencia', credit_delta_cents: -700 }],
  expenses: [],
};

test('solo turnos abiertos: efectivo esperado, digital por acreditar y total, sin crédito', () => {
  const p = load().buildPanel(snapshot);
  assert.deepEqual(p.rows.map(r => r.sessionId), ['a', 'b']);
  const [a, b] = p.rows;
  assert.equal(a.efectivo, 105000); assert.equal(a.digital.yape, 50000); assert.equal(a.digital.transferencia, 700);
  assert.equal(a.pendiente, 50700); assert.equal(a.total, 155700); assert.equal(a.cajero, 'Ana'); assert.equal(a.apertura, '08:00');
  assert.equal(b.efectivo, 2000); assert.equal(b.digital.plin, 2050); assert.equal(b.pendiente, 2050); assert.equal(b.total, 4050);
  assert.equal(p.totals.count, 2); assert.equal(p.totals.efectivo, 107000); assert.equal(p.totals.pendiente, 52750); assert.equal(p.totals.total, 159750);
});
test('sin turnos abiertos o snapshot vacío', () => {
  const api = load();
  assert.equal(api.buildPanel({}).rows.length, 0);
  assert.equal(api.buildPanel({ ...snapshot, cashSessions: [snapshot.cashSessions[2]] }).totals.total, 0);
});
test('formato S/ con coma de miles', () => {
  const { money } = load();
  assert.equal(money(159750), 'S/ 1,597.50'); assert.equal(money(0), 'S/ 0.00');
});
test('candado dashboard-tesoreria: falla cerrado', () => {
  assert.equal(load().featureUnlocked(), false);
  assert.equal(load({ NA_PERMISSIONS: { featureLocked: () => true } }).featureUnlocked(), false);
  assert.equal(load({ NA_PERMISSIONS: { featureLocked: () => undefined } }).featureUnlocked(), false);
  assert.equal(load({ NA_PERMISSIONS: { featureLocked: () => { throw new Error('x'); } } }).featureUnlocked(), false);
  assert.equal(load({ NA_PERMISSIONS: { featureLocked: id => id !== 'dashboard-tesoreria' } }).featureUnlocked(), true);
});
test('el candado sigue cerrado en pos-permissions.js', () => {
  assert.match(readFileSync('POS/js/config/pos-permissions.js', 'utf8'), /'dashboard-tesoreria': true/);
});
test('el módulo no usa innerHTML ni escribe almacenamiento ni llama a la red', () => {
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|setItem|removeItem|fetch\(|NA_ROLES\.api|costo|cost_cents/);
});
