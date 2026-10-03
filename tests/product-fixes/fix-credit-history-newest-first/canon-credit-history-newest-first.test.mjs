import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../POS/js/modules/client-credit-accounts-v2.js', import.meta.url), 'utf8');

function context() {
  const listeners = new Map();
  const document = {
    body: { appendChild() {} },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() {
      return {
        className: '', hidden: true, dataset: {}, style: {}, innerHTML: '',
        setAttribute() {}, appendChild() {}, append() {}, querySelector() { return null; },
        querySelectorAll() { return []; },
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
      };
    }
  };
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    Date, Number, String, Object, Array, Set, Map, Math, JSON, RegExp, Error, Promise, crypto,
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 1; },
    clearTimeout() {},
    requestAnimationFrame(fn) { if (typeof fn === 'function') fn(); return 1; },
    MutationObserver: undefined,
    document,
    clientes: [],
    creditos: [],
    cart: [],
    posPayM: 'credito',
    diasHasta() { return 10; },
    _naSyncCreditStatus(cr) { return cr.status || cr.estado || 'vigente'; },
    _naCreditOutstanding(cr) { return Math.max(0, Number(cr.monto || 0) - Number(cr.pagado || 0)); },
    _naEvaluateClientCredit() {
      return {
        exists: true, enabled: true, eligible: true, assignedLine: 1000, automaticLine: 1000,
        available: 1000, manualActive: false,
        history: { punctual: 0, late: 0, completed: 0, partial: 0, overdueActive: 0, behavior: 'sin_historial' }
      };
    },
    _naEsc(value) { return String(value); },
    fmt(value) { return 'S/ ' + Number(value).toFixed(2); },
    addEventListener(name, fn) {
      const rows = listeners.get(name) || [];
      rows.push(fn);
      listeners.set(name, rows);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach(fn => fn(event));
      return true;
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    matchMedia() { return { matches: false }; }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'client-credit-accounts-v2.js' });
  return ctx;
}

function credit(id, fecha, timestamp) {
  return {
    id,
    cliId: 'A',
    clienteId: 'A',
    monto: 10,
    pagado: 0,
    saldo: 10,
    status: 'vigente',
    vence: '2026-12-31',
    fecha,
    timestamp,
    ventaId: 'V-' + id,
    tipo: 'venta_credito',
    desc: 'Crédito ' + id,
    pagos: [],
    items: [{ nombre: 'Producto', cantidad: 1, precioUnitario: 10, subtotal: 10 }]
  };
}

test('CANON ordena Créditos pequeños de más reciente a más antiguo sin mutar creditos', () => {
  const ctx = context();
  const api = ctx.NA_CLIENT_CREDIT_ACCOUNTS_V2;
  const client = { id: 'A', nombre: 'DALILA @' };

  ctx.creditos = [
    credit('aug19', '2026-08-19', '2026-08-19T09:00:00-05:00'),
    credit('aug23-early', '2026-08-23', '2026-08-23T08:00:00-05:00'),
    credit('jul08', '2026-07-08', '2026-07-08T12:00:00-05:00'),
    credit('aug23-late', '2026-08-23', '2026-08-23T18:00:00-05:00'),
    credit('sep05', '2026-09-05', '2026-09-05T10:00:00-05:00'),
    credit('aug24', '2026-08-24', '2026-08-24T11:00:00-05:00'),
    credit('oct03', '2026-10-03', '2026-10-03T10:00:00-05:00'),
    credit('oct01', '2026-10-01', '2026-10-01T10:00:00-05:00')
  ];

  const before = ctx.creditos.map(row => row.id);
  const category = api.categoriesForClient(client)[0];
  const summary = api.categorySummary(client, category);

  assert.deepEqual(
    Array.from(summary.active, row => row.id),
    ['oct03', 'oct01', 'sep05', 'aug24', 'aug23-late', 'aug23-early', 'aug19', 'jul08']
  );
  assert.deepEqual(ctx.creditos.map(row => row.id), before, 'el orden visual no debe mutar el ledger creditos');
});
