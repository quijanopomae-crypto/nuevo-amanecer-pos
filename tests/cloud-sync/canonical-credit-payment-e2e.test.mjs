import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { deferred, intercept } from './a6-fixture.mjs';

// Real path: bridge -> canonical-client.createPayment -> Worker -> SQLite(D1
// contract) -> receipt -> refresh -> UI adapter. Synthetic data only.
const bridge = readFileSync('POS/js/sync/canonical-credit-payment-bridge.js', 'utf8');
const scripts = [['canonical-credit-payment-bridge.js', bridge]];
const CREDIT = 'CR:001';

function creditOf(tab) {
  return tab.api.legacySnapshot().credits.find((credit) => credit.id === CREDIT);
}
function fill(tab, { amount, method = 'efectivo', reference = '' }) {
  tab.context.pagoCredId = CREDIT;
  tab.el('pagoMonto').value = amount;
  tab.el('pagoMetodo').value = method;
  tab.el('pagoOperacion').value = reference;
}
async function openCash(tab) {
  await tab.api.openCash({ session_id: 'e2e-cash-session', opening_cents: 5000 });
  await tab.api.refresh();
}

async function createLiveCredit(tab, suffix) {
  const before = new Set(tab.api.snapshot().credits.map((credit) => credit.credit_id));
  const sale = await tab.api.createSale({
    items: [{ product_id: '00001', quantity: 1 }],
    payment_method: 'credito',
    customer_id: '000C',
    credit_due: '2099-12-31'
  });
  assert.equal(sale.status, 'created', suffix);
  await tab.api.refresh();
  const credit = tab.api.snapshot().credits.find((row) => row.provenance === 'LIVE' && !before.has(row.credit_id));
  assert.ok(credit, 'LIVE credit created: ' + suffix);
  return credit;
}

test('payment latency: one POST before receipt; full HTTP reconciliation and renders never hold Procesando', async (t) => {
  const f = await activeCanon(t);
  const gate = deferred();
  const stages = {};
  const restore = intercept(f, async (event) => {
    if (event.method !== 'batch' || !event.entries?.some(row => row.sql.includes('INSERT INTO canonical_financial_operations('))) return;
    stages.d1 ??= {};
    stages.d1[event.when] = performance.now();
  });
  t.after(restore);
  let posted = false;
  const renders = [];
  const tab = await device(f, {
    token: 'device-a-token', deviceId: 'device-a', scripts,
    globals: {
      cliRender() { renders.push('clients'); },
      cajRender() { renders.push('cash'); },
      updateDashboard() { renders.push('dashboard'); },
    },
    async onFetch(url, options, forward) {
      if (url.endsWith('/commands/payment.create')) {
        posted = true;
        stages.postStart = performance.now();
        const reply = await forward();
        stages.postEnd = performance.now();
        return reply;
      }
      if (posted && url.includes('/read/canonical/')) {
        stages.refreshStart ??= performance.now();
        if (url.endsWith('/status')) await gate.promise;
      }
      return null;
    },
  });
  const close = tab.context.__closed.push.bind(tab.context.__closed);
  tab.context.__closed.push = (...ids) => { stages.modalClosed = performance.now(); return close(...ids); };
  fill(tab, { amount: '1', method: 'yape', reference: 'LATENCY-1' });
  const before = tab.fetchLog.length;
  stages.tap = performance.now();
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), true);
  stages.uiReleased = performance.now();
  assert.equal(tab.api.receiptSnapshot().status, 'created');
  assert.equal(tab.el('pagoConfirmBtn').disabled, false);
  assert.notEqual(tab.el('pagoConfirmBtn').textContent, 'Procesando…');
  assert.deepEqual([...tab.context.__closed], ['mPagoCred']);
  assert.deepEqual(tab.fetchLog.slice(before).map(x => x.method + ' ' + new URL(x.url).pathname),
    ['POST /commands/payment.create', 'GET /read/canonical/status']);
  assert.deepEqual(renders, [], 'no bridge-driven full renders on the receipt path');
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 1);
  assert.ok(stages.d1.before >= stages.postStart && stages.d1.after <= stages.postEnd);
  gate.resolve();
  await tab.api.refresh();
  stages.refreshEnd = performance.now();
  const after = tab.fetchLog.slice(before);
  assert.equal(after.filter(x => x.method === 'POST').length, 1);
  assert.equal(after.filter(x => x.method === 'GET').length, 13, 'status + 12 single-page collections');
  assert.equal(creditOf(tab).saldo, 6);
  assert.deepEqual(renders, [], 'the canonical-updated listener, not the bridge, owns page rendering');
  t.diagnostic(JSON.stringify({
    httpBeforeReceipt: 1, httpAfterReceipt: after.length - 1,
    tapToPostMs: +(stages.postStart - stages.tap).toFixed(2),
    workerAndD1Ms: +(stages.postEnd - stages.postStart).toFixed(2),
    d1BatchMs: +(stages.d1.after - stages.d1.before).toFixed(2),
    receiptToModalCloseMs: +(stages.modalClosed - stages.postEnd).toFixed(2),
    postToUiReleaseMs: +(stages.uiReleased - stages.postEnd).toFixed(2),
    backgroundRefreshMs: +(stages.refreshEnd - stages.refreshStart).toFixed(2),
  }));
});

test('multi-credit payment <=20 uses exactly one HTTP POST and one atomic D1 batch', async (t) => {
  const f = await activeCanon(t);
  const tab = await device(f, { token: 'device-a-token', deviceId: 'device-a', scripts });
  const first = await createLiveCredit(tab, 'batch-1');
  const second = await createLiveCredit(tab, 'batch-2');
  const beforeEvents = f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n;
  const beforeFetch = tab.fetchLog.length;

  const result = await tab.api.createPaymentBatch([
    { credit_id:first.credit_id, amount_cents:100, payment_method:'yape', reference:'BATCH-ONE-HTTP' },
    { credit_id:second.credit_id, amount_cents:150, payment_method:'yape', reference:'BATCH-ONE-HTTP' }
  ]);
  assert.equal(result.ok,true);
  assert.equal(result.receipts.length,2);

  const requests = tab.fetchLog.slice(beforeFetch).filter((row) => row.method === 'POST');
  assert.deepEqual(requests.map((row) => new URL(row.url).pathname), ['/commands/payment.batch']);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n,beforeEvents+2);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_operations WHERE command='payment.create'").n >= 2,true);
  assert.equal(f.sql('SELECT current_balance_cents b FROM canonical_credit_balances WHERE credit_id=?',first.credit_id).b,first.current_balance_cents-100);
  assert.equal(f.sql('SELECT current_balance_cents b FROM canonical_credit_balances WHERE credit_id=?',second.credit_id).b,second.current_balance_cents-150);
});

test('payment.batch stale child rolls back every new child payment', async (t) => {
  const f = await activeCanon(t);
  const firstTab = await device(f, { token:'device-a-token', deviceId:'device-a', scripts });
  const stale = await createLiveCredit(firstTab,'stale-batch-1');
  const untouched = await createLiveCredit(firstTab,'stale-batch-2');

  const secondTab = await device(f, { token:'device-b-token', deviceId:'device-b', scripts });
  await secondTab.api.createPayment({
    credit_id:stale.credit_id,amount_cents:50,payment_method:'yape',reference:'OTHER-DEVICE'
  });
  const afterOther = f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n;
  const untouchedBefore = f.sql('SELECT current_balance_cents b FROM canonical_credit_balances WHERE credit_id=?',untouched.credit_id).b;

  const result = await firstTab.api.createPaymentBatch([
    {credit_id:stale.credit_id,amount_cents:100,payment_method:'transferencia',reference:'ATOMIC-STALE'},
    {credit_id:untouched.credit_id,amount_cents:100,payment_method:'transferencia',reference:'ATOMIC-STALE'}
  ]);
  assert.equal(result.ok,false);
  assert.equal(result.rejected,true);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n,afterOther,
    'stale batch must not commit the valid sibling credit');
  assert.equal(f.sql('SELECT current_balance_cents b FROM canonical_credit_balances WHERE credit_id=?',untouched.credit_id).b,untouchedBefore);
});

test('Registrar pago (efectivo) persists through payment.create, survives F5 and is seen by a second device', async (t) => {
  const f = await activeCanon(t);
  const tab = await device(f, { token: 'device-a-token', deviceId: 'device-a', scripts });
  assert.equal(creditOf(tab).saldo, 7);
  await openCash(tab);

  fill(tab, { amount: '2.50' });
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), true);
  await tab.api.refresh();

  const events = f.all("SELECT * FROM canonical_financial_events WHERE event_type='PAYMENT'");
  assert.equal(events.length, 1);
  assert.equal(events[0].credit_id, CREDIT);
  assert.equal(events[0].credit_delta_cents, -250);
  assert.equal(events[0].cash_delta_cents, 250);
  assert.equal(events[0].session_id, 'e2e-cash-session');
  assert.equal(f.sql("SELECT current_balance_cents b FROM canonical_credit_balances WHERE credit_id=?", CREDIT).b, 450);
  assert.equal(f.sql("SELECT expected_cents e FROM canonical_cash_state WHERE session_id='e2e-cash-session'").e, 5250);

  // Visible projection after the post-commit refresh.
  const credit = creditOf(tab);
  assert.equal(credit.saldo, 4.5);
  assert.ok(credit.pagos.some((p) => p.id === events[0].event_id && p.monto === 2.5 && p.metodo === 'efectivo'));
  assert.equal(tab.api.legacySnapshot().cashState.esperado, 52.5);
  assert.deepEqual(tab.context.__closed, ['mPagoCred']);
  assert.ok(tab.toasts.some(([m, tone]) => /Pago CANON de S\/ 2\.50 CONFIRMADO/.test(m) && tone === 'success'));

  // F5: same localStorage, brand-new runtime.
  const reloaded = await device(f, { token: 'device-a-token', localStorage: tab.localStorage, scripts });
  assert.equal(creditOf(reloaded).saldo, 4.5);
  assert.equal(creditOf(reloaded).pagos.filter((p) => p.id === events[0].event_id).length, 1);

  // Second device with its own storage and session.
  const other = await device(f, { token: 'device-b-token', deviceId: 'device-b', scripts });
  assert.equal(creditOf(other).saldo, 4.5);
  assert.equal(other.api.legacySnapshot().cashState.esperado, 52.5);
});

test('digital payment keeps the reference, attaches no cash session and duplicate reference is rejected', async (t) => {
  const f = await activeCanon(t);
  const tab = await device(f, { token: 'device-a-token', deviceId: 'device-a', scripts });
  fill(tab, { amount: '1', method: 'yape', reference: 'YAPE-7788' });
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), true);
  await tab.api.refresh();
  const event = f.sql("SELECT * FROM canonical_financial_events WHERE event_type='PAYMENT'");
  assert.equal(event.reference, 'YAPE-7788');
  assert.equal(event.session_id, null);
  assert.equal(event.cash_delta_cents, 0);
  assert.equal(creditOf(tab).pagos.find((p) => p.id === event.event_id).numeroOperacion, 'YAPE-7788');

  fill(tab, { amount: '1', method: 'transferencia', reference: 'yape-7788' });
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), false);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 1);
  assert.ok(tab.toasts.some(([m]) => /ya fue registrado/.test(m)));
});

test('lost ACK after commit: retry reuses the same operation_id and never duplicates the payment', async (t) => {
  const f = await activeCanon(t);
  let dropAck = true;
  const tab = await device(f, {
    token: 'device-a-token', deviceId: 'device-a', scripts,
    async onFetch(url, options, forward) {
      if (url.endsWith('/commands/payment.create') && dropAck) { dropAck = false; await forward(); throw new TypeError('network lost after commit'); }
      return null;
    },
  });
  fill(tab, { amount: '3', method: 'yape', reference: 'OP-ACK-1' });
  const initialStatusReads = tab.fetchLog.filter(x => x.url.endsWith('/read/canonical/status')).length;
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), false);
  const afterFirstStatusReads = tab.fetchLog.filter(x => x.url.endsWith('/read/canonical/status')).length;
  assert.equal(afterFirstStatusReads - initialStatusReads, 0, 'no additional status GET before first payment POST');
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 1, 'server committed');
  assert.ok(tab.toasts.some(([m]) => /NO lo registres de nuevo/.test(m)));
  assert.deepEqual(tab.context.__closed, [], 'modal stays open while unconfirmed');
  const pending = tab.api.pendingSnapshot();
  assert.equal(pending.command, 'payment.create');

  // The user taps again (even with other values): the SAME operation is retried.
  fill(tab, { amount: '5', method: 'yape', reference: 'OP-OTHER' });
  const statusBeforeRetry = tab.fetchLog.filter(x => x.url.endsWith('/read/canonical/status')).length;
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), true);
  const rows = f.all("SELECT * FROM canonical_financial_events WHERE event_type='PAYMENT'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation_id, pending.payload.operation_id);
  assert.equal(rows[0].credit_delta_cents, -300);
  assert.equal(tab.api.pendingSnapshot(), null);
  assert.equal(tab.api.receiptSnapshot().status, 'already_processed');
  assert.ok(tab.toasts.some(([m]) => /Pago CANON pendiente de S\/ 3\.00/.test(m)));
  assert.equal(tab.fetchLog.filter(x => x.url.endsWith('/commands/payment.create')).length, 2);
  assert.ok(tab.fetchLog.filter(x => x.url.endsWith('/read/canonical/status')).length > statusBeforeRetry,
    'authority status is checked before retrying the same operation');
  await tab.api.refresh();
  assert.equal(creditOf(tab).saldo, 4);
});

test('committed payment whose post-commit refresh fails is reported as CONFIRMED, not as a failure', async (t) => {
  const f = await activeCanon(t);
  let failReads = false;
  const tab = await device(f, {
    token: 'device-a-token', deviceId: 'device-a', scripts,
    async onFetch(url) {
      if (url.includes('/commands/payment.create')) { failReads = true; return null; }
      if (failReads && url.includes('/read/canonical/')) return new Response(JSON.stringify({ error: 'boom' }), { status: 503 });
      return null;
    },
  });
  fill(tab, { amount: '1', method: 'transferencia', reference: 'TRF-0001' });
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), true);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 1);
  assert.deepEqual(tab.context.__closed, ['mPagoCred']);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(tab.toasts.some(([m]) => /CONFIRMADO/.test(m) && /NO repitas el pago/.test(m)));
  assert.equal(tab.toasts.some(([m]) => /No se registró/.test(m)), false);
  assert.equal(tab.api.receiptSnapshot().status, 'created');
});

test('server rejection is a definitive failure and does not create a second command on retry tap', async (t) => {
  const f = await activeCanon(t);
  const tab = await device(f, {
    token: 'device-a-token', deviceId: 'device-a', scripts,
    async onFetch(url) {
      if (url.endsWith('/commands/payment.create')) return new Response(JSON.stringify({ error: 'stale_credit' }), { status: 409 });
      return null;
    },
  });
  fill(tab, { amount: '1', method: 'yape', reference: 'REJ-0001' });
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), false);
  assert.ok(tab.toasts.some(([m]) => /rechazó el pago \(stale_credit\)/.test(m)));
  const before = tab.fetchLog.filter((x) => x.url.endsWith('/commands/payment.create')).length;
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), false);
  assert.equal(tab.fetchLog.filter((x) => x.url.endsWith('/commands/payment.create')).length, before);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events").n, 0);
});

test('second device with an old credit revision cannot overwrite the new balance (stale_credit)', async (t) => {
  const f = await activeCanon(t);
  const first = await device(f, { token: 'device-a-token', deviceId: 'device-a', scripts });
  const second = await device(f, { token: 'device-b-token', deviceId: 'device-b', scripts });
  fill(first, { amount: '1', method: 'yape', reference: 'DEVICE-A-1' });
  assert.equal(await first.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), true);
  fill(second, { amount: '1', method: 'transferencia', reference: 'DEVICE-B-1' });
  assert.equal(await second.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), false);
  assert.equal(second.api.pendingSnapshot().last_error, 'stale_credit');
  assert.deepEqual(second.context.__closed, []);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 1);
  assert.equal(f.sql('SELECT current_balance_cents b FROM canonical_credit_balances WHERE credit_id=?', CREDIT).b, 600);
});

test('reference dedupe matches legacy scope (sales) and ignores payments reversed by COMPENSATION', async (t) => {
  const f = await activeCanon(t);
  const tab = await device(f, { token: 'device-a-token', deviceId: 'device-a', scripts });
  await tab.api.createSale({ items: [{ product_id: '00002', quantity: 1 }], payment_method: 'yape', reference: 'SALE-REF-1' });
  await tab.api.refresh();
  fill(tab, { amount: '1', method: 'yape', reference: 'sale-ref-1' });
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), false, 'reference already used by a sale');
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 0);

  fill(tab, { amount: '1', method: 'yape', reference: 'WRONG-CREDIT-9' });
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), true);
  await tab.api.refresh();
  const paid = f.sql("SELECT operation_id FROM canonical_financial_events WHERE event_type='PAYMENT'");
  await tab.api.createCompensation({ compensates_operation_id: paid.operation_id, reason: 'Registrado por error' });
  await tab.api.refresh();
  assert.equal(creditOf(tab).saldo, 7);

  fill(tab, { amount: '1', method: 'yape', reference: 'WRONG-CREDIT-9' });
  assert.equal(await tab.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(), true, 'reversed reference is not a false positive');
  await tab.api.refresh();
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 2);
  assert.equal(creditOf(tab).saldo, 6);
});

test('double tap on the real stack produces exactly one payment.create request', async (t) => {
  const f = await activeCanon(t);
  const tab = await device(f, { token: 'device-a-token', deviceId: 'device-a', scripts });
  fill(tab, { amount: '1', method: 'yape', reference: 'TAP-0001' });
  const bridgeApi = tab.context.NuevoAmanecerCanonicalCreditPaymentBridge;
  const [first, second] = await Promise.all([bridgeApi.confirm(), bridgeApi.confirm()]);
  assert.deepEqual([first, second], [true, false]);
  assert.equal(tab.fetchLog.filter((x) => x.url.endsWith('/commands/payment.create')).length, 1);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 1);
});
