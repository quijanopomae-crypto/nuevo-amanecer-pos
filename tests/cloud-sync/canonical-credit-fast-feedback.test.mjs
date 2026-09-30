import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { deferred } from './a6-fixture.mjs';

test('two confirmed payments update balances without a full-history refresh between them', async t => {
  const f = await activeCanon(t);
  const tab = await device(f, { token: 'fast-token', deviceId: 'fast-device' });
  await tab.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'FAST-1' });
  assert.equal(tab.api.legacySnapshot().credits.find(c => c.id === 'CR:001').saldo, 6);
  const reads = tab.fetchLog.length;
  await tab.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'FAST-2' });
  assert.equal(tab.api.legacySnapshot().credits.find(c => c.id === 'CR:001').saldo, 5);
  assert.equal(tab.fetchLog.slice(reads).filter(r => r.url.includes('/read/')).length, 0);
});

test('credit sale receipt exposes the new credit before any reconciliation reads', async t => {
  const f = await activeCanon(t);
  const tab = await device(f, { token: 'fast-token', deviceId: 'fast-device' });
  const product = tab.api.snapshot().products[0];
  const customer = tab.api.snapshot().customers[0];
  const receipt = await tab.api.createSale({
    items: [{ product_id: product.product_id, quantity: 1 }], payment_method: 'credito',
    customer_id: customer.customer_id, credit_due: '2027-01-01'
  });
  const credit = tab.api.legacySnapshot().credits.find(c => c.sale_id === receipt.sale_id);
  assert.ok(credit, 'confirmed credit must already be visible');
  assert.ok(credit.saldo > 0);
  assert.equal(credit.pagado, 0);
  await tab.api.createPayment({ credit_id: credit.id, amount_cents: 1, payment_method: 'yape', reference: 'NEW-CREDIT-PAY' });
  assert.equal(tab.api.legacySnapshot().credits.find(c => c.id === credit.id).saldo, credit.saldo - 0.01);
});

test('slow reconciliation cannot overwrite a newer confirmed payment', async t => {
  const f = await activeCanon(t);
  const gate = deferred(), captured = deferred();
  let slow = false;
  const tab = await device(f, { token: 'fast-token', deviceId: 'fast-device', async onFetch(url, options, forward) {
    if (slow && url.includes('/read/canonical/sales?')) {
      const response = await forward();
      captured.resolve(); await gate.promise;
      return response;
    }
    return null;
  } });
  await tab.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'RACE-1' });
  slow = true;
  const refresh = tab.api.refresh();
  try {
    await captured.promise;
    await tab.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'RACE-2' });
  } finally { gate.resolve(); await refresh; }
  assert.equal(tab.api.legacySnapshot().credits.find(c => c.id === 'CR:001').saldo, 5);
  assert.equal(tab.api.sourceState().validation, 'receipt-patched');
});

test('reconciliation starts history reads together and preserves confirmed payments while history is slow', async t => {
  const f = await activeCanon(t);
  const gate = deferred();
  let slow = false;
  const routes = [];
  const tab = await device(f, { token: 'fast-token', deviceId: 'fast-device', async onFetch(url) {
    if (slow && /\/read\/canonical\/(financial-events|expenses|sales|sale-items|inventory-movements|cash-movements)\?/.test(url)) {
      routes.push(new URL(url).pathname.split('/').at(-1));
      await gate.promise;
    }
    return null;
  } });
  await tab.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'FAST-1' });
  slow = true;
  const refresh = tab.api.refresh();
  try {
    for (let i = 0; i < 100 && routes.length < 6; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(new Set(routes).size, 6, 'slow financial history must not serialize other routes');
    assert.equal(tab.api.snapshot().mode, 'ACTIVE', 'background refresh must not replace the active view with bootstrap');
    assert.equal(tab.api.legacySnapshot().credits.find(c => c.id === 'CR:001').saldo, 6);
  } finally { gate.resolve(); await refresh; }
});
