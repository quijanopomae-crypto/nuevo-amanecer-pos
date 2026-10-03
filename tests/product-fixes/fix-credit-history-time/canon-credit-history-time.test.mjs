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

  const instrumented = source.replace(/\n\}\)\(window\);\s*$/, `
  root.__NA_CREDIT_TIME_TEST__ = {
    creditMoment: typeof labCreditDisplayMoment === 'function' ? labCreditDisplayMoment : null,
    purchaseRow: labPurchaseRow,
    purchaseHtml: labPurchaseHtml
  };
})(window);`);

  vm.runInContext(instrumented, ctx, { filename: 'client-credit-accounts-v2.js' });
  return ctx;
}

function credit(overrides = {}) {
  return {
    id: 'credit-time-1',
    cliId: 'A',
    clienteId: 'A',
    monto: 10,
    pagado: 0,
    saldo: 10,
    status: 'vigente',
    vence: '2026-12-31',
    fecha: '2026-10-03',
    timestamp: null,
    ventaId: 'V-credit-time-1',
    tipo: 'venta_credito',
    desc: 'Crédito histórico',
    pagos: [],
    items: [{ nombre: 'Producto', cantidad: 1, precioUnitario: 10, subtotal: 10 }],
    ...overrides
  };
}

test('CANON muestra fecha con HH:MM en la fila y en el detalle VENTA', () => {
  const ctx = context();
  const hooks = ctx.__NA_CREDIT_TIME_TEST__;
  assert.equal(typeof hooks.creditMoment, 'function', 'debe existir un formatter visual de fecha y hora');

  const cr = credit({ hora24: '10:47:33', hora: '10:47:33 a. m.', timestamp: '2026-10-03T15:47:33.000Z' });
  const row = hooks.purchaseRow(cr);
  const detail = hooks.purchaseHtml({ id: 'A', nombre: 'CLIENTE' }, cr);
  assert.equal(hooks.creditMoment(cr), '2026-10-03 · 10:47');
  assert.match(row, /2026-10-03 · 10:47/);
  assert.match(detail, /VENTA 2026-10-03 · 10:47/);
  assert.doesNotMatch(row, /10:47:33/);
  assert.doesNotMatch(detail, /VENTA 2026-10-03 · 10:47:33/);
});

test('CANON usa hora24, luego hora, luego timestamp y no inventa hora', () => {
  const ctx = context();
  const { creditMoment } = ctx.__NA_CREDIT_TIME_TEST__;
  assert.equal(typeof creditMoment, 'function');

  assert.equal(
    creditMoment(credit({ hora24: '21:05:59', hora: '09:05:59 p. m.', timestamp: '2026-10-03T04:01:00' })),
    '2026-10-03 · 21:05'
  );
  assert.equal(
    creditMoment(credit({ hora24: '', hora: '09:05:59 p. m.', timestamp: '2026-10-03T04:01:00' })),
    '2026-10-03 · 21:05'
  );
  assert.equal(
    creditMoment(credit({ hora24: '', hora: '', timestamp: '2026-10-03T14:32:00' })),
    '2026-10-03 · 14:32'
  );
  assert.equal(
    creditMoment(credit({ hora24: '', hora: '', timestamp: null })),
    '2026-10-03'
  );
});
