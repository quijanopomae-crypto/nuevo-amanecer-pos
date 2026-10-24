import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const history = readFileSync('POS/js/sync/canonical-cash-history.js', 'utf8');
const source = readFileSync('POS/js/modules/reporte-medio-pago.js', 'utf8');
function load(extra = {}) {
  const ctx = vm.createContext({ module: { exports: {} }, ...extra });
  vm.runInContext(history, ctx);
  vm.runInContext(source, ctx);
  return ctx.NA_REPORTE_MEDIO_PAGO;
}
const session = (id, opened, closed, extra = {}) => ({ session_id: id, status: 'CLOSED', opened_at: opened, closed_at: closed,
  opening_cents: 5000, expected_cents: 0, opened_by_name: 'Ana', closed_by_name: 'Ana', ...extra });
const snapshot = {
  cashSessions: [
    session('s1', '2026-10-10T13:00:00Z', '2026-10-10T23:00:00Z'),
    session('s2', '2026-10-16T13:00:00Z', '2026-10-17T04:30:00Z', { opened_by_name: 'Luis', closed_by_name: 'Luis' }), // 23:30 Lima del 16
    session('s3', '2026-10-17T13:00:00Z', '2026-10-17T05:00:00Z', { opened_by_name: 'Fuera' }),
    session('open', '2026-10-15T13:00:00Z', null, { status: 'OPEN' }),
  ],
  cashMovements: [
    { session_id: 's1', sale_id: 'v1', amount_cents: 150000, cash_cents: 100000, digital_cents: 50000, digital_method: 'yape', credit_cents: 0 },
    { session_id: 's1', sale_id: 'v2', amount_cents: 2050, cash_cents: 0, digital_cents: 2050, digital_method: 'plin', credit_cents: 0 },
    { session_id: 's2', sale_id: 'v3', amount_cents: 3000, cash_cents: 0, digital_cents: 1000, digital_method: 'raro', credit_cents: 2000 },
    { session_id: 'open', sale_id: 'v4', amount_cents: 999, cash_cents: 999 },
  ],
  financialEvents: [
    { event_type: 'PAYMENT', session_id: 's1', payment_method: 'transferencia', credit_delta_cents: -700 },
    { event_type: 'PAYMENT', created_at: '2026-10-16T20:00:00Z', payment_method: 'efectivo', credit_delta_cents: -300 },
  ],
  expenses: [{ session_id: 's1', amount_cents: 1234 }],
};
const range = { desde: '2026-10-01', hasta: '2026-10-16' };

test('totales por medio de pago por turno, fechas de Lima inclusivas, OPEN fuera', () => {
  const r = load().buildReport(snapshot, range);
  assert.deepEqual(r.rows.map(x => x.sessionId), ['s2', 's1']);
  const s1 = r.rows[1];
  assert.deepEqual({ ...s1.metodos }, { efectivo: 100000, yape: 50000, plin: 2050, transferencia: 700, credito: 0 });
  assert.equal(s1.total, 152750); assert.equal(s1.gastos, 1234);
  const s2 = r.rows[0];
  assert.equal(s2.fecha, '2026-10-16'); assert.equal(s2.cierre, '23:30');
  assert.deepEqual({ ...s2.metodos }, { efectivo: 300, yape: 0, plin: 0, transferencia: 1000, credito: 2000 });
  assert.equal(r.totals.count, 2); assert.equal(r.totals.total, 152750 + 3300);
  assert.equal(r.totals.metodos.efectivo, 100300);
  assert.equal(s1.cobrado, 152750); assert.equal(s2.cobrado, 1300); // cobrado no incluye el crédito
  assert.equal(r.totals.cobrado, 152750 + 1300);
});
test('filtro por cajero y lista de cajeros del rango', () => {
  const api = load();
  const r = api.buildReport(snapshot, { ...range, cajero: 'Luis' });
  assert.deepEqual(r.rows.map(x => x.sessionId), ['s2']);
  assert.deepEqual([...r.cajeros], ['Ana', 'Luis']);
  assert.equal(api.buildReport(snapshot, { ...range, cajero: 'Nadie' }).rows.length, 0);
});
test('formato S/ con miles por coma y dos decimales', () => {
  const { money } = load();
  assert.equal(money(123450), 'S/ 1,234.50');
  assert.equal(money(123456789), 'S/ 1,234,567.89');
  assert.equal(money(-5), '-S/ 0.05');
  assert.equal(money(0), 'S/ 0.00');
});
test('rangos inválidos', () => {
  const api = load();
  assert.throws(() => api.buildReport(snapshot, { desde: '2026-10-17', hasta: '2026-10-01' }), { name: "RangeError" });
  assert.throws(() => api.buildReport(snapshot, { desde: '2026-02-30', hasta: '2026-03-01' }), { name: "RangeError" });
  assert.throws(() => api.buildReport(snapshot, { desde: '2024-01-01', hasta: '2026-01-01' }), { name: "RangeError" });
});
test('CSV con guarda de fórmulas e importes numéricos; sin costos', () => {
  const api = load();
  const snap = { ...snapshot, cashSessions: snapshot.cashSessions.map(s => s.session_id === 's1' ? { ...s, opened_by_name: '=HYPERLINK(1)' } : s) };
  const csv = api.toCsv(api.buildReport(snap, range));
  assert.ok(csv.startsWith('\uFEFFFecha cierre,Apertura,Cierre,Cajero,Efectivo,Yape,Plin,Transferencia,Al crédito,Total vendido,Cobrado,Gastos,Ajustes'));
  assert.match(csv, /'=HYPERLINK\(1\)/);
  assert.match(csv, /1000\.00,500\.00,20\.50,7\.00,0\.00,1527\.50,1527\.50,12\.34,0\.00/);
  assert.match(csv, /Total,2 turnos/);
  assert.doesNotMatch(csv, /costo/i);
});
test('candado propio reporte-medio-pago: falla cerrado', () => {
  assert.equal(load().featureUnlocked(), false);
  assert.equal(load({ NA_PERMISSIONS: { featureLocked: () => true } }).featureUnlocked(), false);
  assert.equal(load({ NA_PERMISSIONS: { featureLocked: () => undefined } }).featureUnlocked(), false);
  assert.equal(load({ NA_PERMISSIONS: { featureLocked: () => { throw new Error('x'); } } }).featureUnlocked(), false);
  assert.equal(load({ NA_PERMISSIONS: { featureLocked: id => id !== 'reporte-medio-pago' } }).featureUnlocked(), true);
});
test('el módulo no usa innerHTML ni escribe almacenamiento ni llama a la red', () => {
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|setItem|removeItem|fetch\(|NA_ROLES\.api|costo|cost_cents/);
});
