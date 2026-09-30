import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { intercept } from './a6-fixture.mjs';

test('payment confirmation uses at most three D1 round trips including authentication and atomic commit', async t => {
  const f = await activeCanon(t);
  const tab = await device(f, { token: 'latency-token', deviceId: 'latency-device' });
  let trips = 0;
  const restore = intercept(f, event => { if (event.when === 'before') trips++; });
  try {
    await tab.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'TRIPS-1' });
    assert.equal(tab.api.legacySnapshot().credits.find(c => c.id === 'CR:001').saldo, 6);
    assert.ok(trips <= 3, `D1 round trips: ${trips}`);
    t.diagnostic(`D1 trips: baseline 7, optimized ${trips}`);
  } finally { restore(); }
});

test('new validated credit sale needs one HTTP request', async t => {
  const f = await activeCanon(t);
  const tab = await device(f, { token: 'latency-token', deviceId: 'latency-device' });
  const start = tab.fetchLog.length;
  await tab.api.createSale({ items: [{ product_id: tab.api.snapshot().products[0].product_id, quantity: 1 }],
    payment_method: 'credito', customer_id: tab.api.snapshot().customers[0].customer_id, credit_due: '2027-01-01' });
  assert.equal(tab.fetchLog.length - start, 1);
});

test('cash payment also uses three trips and preserves the cash revision', async t => {
  const f = await activeCanon(t);
  const tab = await device(f, { token: 'latency-token', deviceId: 'latency-device' });
  await tab.api.openCash({ session_id: 'latency-cash', opening_cents: 1000 });
  await tab.api.refresh();
  let trips = 0;
  const restore = intercept(f, event => { if (event.when === 'before') trips++; });
  try {
    await tab.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'efectivo', session_id: 'latency-cash' });
    assert.equal(trips, 3);
    assert.equal(tab.api.legacySnapshot().cashState.esperado, 11);
  } finally { restore(); }
});

test('revocation after the combined read still prevents the atomic payment commit', async t => {
  const f = await activeCanon(t);
  const tab = await device(f, { token: 'latency-token', deviceId: 'latency-device' });
  let revoked = false;
  const restore = intercept(f, event => {
    if (event.when === 'before' && event.method === 'batch' && !revoked) {
      revoked = true;
      f.exec("UPDATE devices SET status='revoked' WHERE device_id='session:latency-device'");
    }
  });
  try {
    await assert.rejects(tab.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'REVOKED-1' }), /REJECTED_409/);
    assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 0);
  } finally { restore(); }
});
