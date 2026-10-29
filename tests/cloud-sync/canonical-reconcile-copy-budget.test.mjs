import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCanon, device } from './canon-browser-harness.mjs';

test('payment reconciliation avoids an extra copy of unchanged products and preserves snapshot isolation', async (t) => {
  const f = await activeCanon(t);
  let productCopies = 0;
  const tab = await device(f, {
    token: 'copy-budget-token', deviceId: 'copy-budget-device',
    globals: { JSON: {
      parse: JSON.parse,
      stringify(value, ...args) {
        if (Array.isArray(value) && value.length && value[0]?.product_id) productCopies++;
        return JSON.stringify(value, ...args);
      },
    } },
  });
  const before = tab.api.snapshot();
  const receipt = await tab.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'COPY-1' });
  assert.equal(receipt.status, 'created');
  productCopies = 0;
  const readStart = tab.fetchLog.length;
  const after = await tab.api.refresh();
  assert.equal(productCopies, 2, 'only replica construction and publication copy the product collection');
  assert.equal(tab.fetchLog.slice(readStart).some(row => row.url.includes('/read/canonical/products')), false);
  assert.deepEqual(JSON.parse(JSON.stringify(after.products)), JSON.parse(JSON.stringify(before.products)));
  assert.equal(after.credits.find(row => row.credit_id === 'CR:001').current_balance_cents,
    before.credits.find(row => row.credit_id === 'CR:001').current_balance_cents - 100);
  after.products[0].name = 'external mutation';
  assert.equal(tab.api.snapshot().products[0].name, before.products[0].name);
  assert.equal(tab.api.sourceState().validation, 'current');
});
