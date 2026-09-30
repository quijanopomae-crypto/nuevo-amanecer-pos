import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { activeCanon, device } from './canon-browser-harness.mjs';

async function createSellableProduct(tab, suffix) {
  const id = 'LIVE-BATCH-' + suffix + '-' + randomUUID().slice(0,8);
  const receipt = await tab.api.createProduct({
    product_id:id,name:'Producto batch ' + suffix,sku:id+'-SKU',barcode:id+'-BAR',
    alternate_codes:[],category:'test',brand:'Test',description:null,icon:'📦',image:null,
    unit:'unidad',purchase_unit:'unidad',purchase_factor:1,cost_cents:100,price_cents:250,
    box_price_cents:null,units_per_box:null,initial_stock_quantity:10,stock_min_quantity:0,
    expiry_date:null,includes_igv:true,tax_type:'gravado',complementary_tax:'',tracks_inventory:true
  });
  assert.equal(receipt.status,'created',suffix);
  await tab.api.refresh();
  return id;
}

async function liveCredit(tab, suffix, productId) {
  const before = new Set(tab.api.snapshot().credits.map((row) => row.credit_id));
  const sale = await tab.api.createSale({
    items: [{ product_id: productId, quantity: 1 }],
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

function payment(control, credit, amount, method, extra = {}) {
  return {
    operation_id: randomUUID(),
    promotion_id: control.active_promotion_id,
    client_contract: 'a6-gate-c-v1',
    authority_epoch: control.authority_epoch,
    expected_control_revision: control.revision,
    created_at: new Date().toISOString(),
    credit_id: credit.credit_id,
    expected_credit_revision: credit.revision,
    amount_cents: amount,
    payment_method: method,
    ...extra
  };
}

function batch(control, payments) {
  return {
    operation_id: randomUUID(),
    promotion_id: control.active_promotion_id,
    client_contract: 'a6-gate-c-v1',
    authority_epoch: control.authority_epoch,
    expected_control_revision: control.revision,
    created_at: new Date().toISOString(),
    payments
  };
}

async function postBatch(f, token, body) {
  return f.fetch('http://localhost/commands/payment.batch', {
    method: 'POST',
    headers: { 'content-type':'application/json', authorization:'Bearer '+token },
    body: JSON.stringify(body)
  });
}

test('payment.batch persists multiple payment.create children atomically and exact replay is idempotent', async (t) => {
  const f = await activeCanon(t);
  const token = 'device-a-token';
  const tab = await device(f, { token, deviceId:'device-a' });
  const productId = await createSellableProduct(tab,'atomic');
  const first = await liveCredit(tab,'first',productId);
  const second = await liveCredit(tab,'second',productId);
  const control = f.control();
  const body = batch(control, [
    payment(control,first,100,'yape',{reference:'BATCH-BACKEND-1'}),
    payment(control,second,150,'yape',{reference:'BATCH-BACKEND-1'})
  ]);

  const before = f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n;
  const response = await postBatch(f,token,body);
  const result = await response.json();
  assert.equal(response.status,201,JSON.stringify(result));
  assert.equal(result.status,'created');
  assert.equal(result.command,'payment.batch');
  assert.equal(result.receipts.length,2);
  assert.ok(result.receipts.every((row) => row.command === 'payment.create'));
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n,before+2);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_operations WHERE operation_id IN (?,?)",body.payments[0].operation_id,body.payments[1].operation_id).n,2);
  assert.equal(f.sql('SELECT current_balance_cents b FROM canonical_credit_balances WHERE credit_id=?',first.credit_id).b,first.current_balance_cents-100);
  assert.equal(f.sql('SELECT current_balance_cents b FROM canonical_credit_balances WHERE credit_id=?',second.credit_id).b,second.current_balance_cents-150);

  const replay = await postBatch(f,token,body);
  const replayBody = await replay.json();
  assert.equal(replay.status,200,JSON.stringify(replayBody));
  assert.equal(replayBody.status,'already_processed');
  assert.ok(replayBody.receipts.every((row) => row.status === 'already_processed' && row.idempotent === true));
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n,before+2,'replay must not duplicate');
});

test('payment.batch stale child rejects the whole transaction and leaves valid sibling untouched', async (t) => {
  const f = await activeCanon(t);
  const token = 'device-a-token';
  const tab = await device(f, { token, deviceId:'device-a' });
  const productId = await createSellableProduct(tab,'stale');
  const stale = await liveCredit(tab,'stale',productId);
  const sibling = await liveCredit(tab,'sibling',productId);
  const control = f.control();

  await tab.api.createPayment({
    credit_id: stale.credit_id,
    amount_cents: 50,
    payment_method: 'yape',
    reference: 'STALE-SEED'
  });
  const afterSeed = f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n;
  const siblingBefore = f.sql('SELECT current_balance_cents b FROM canonical_credit_balances WHERE credit_id=?',sibling.credit_id).b;

  const body = batch(control, [
    payment(control,stale,100,'transferencia',{reference:'ATOMIC-STALE'}),
    payment(control,sibling,100,'transferencia',{reference:'ATOMIC-STALE'})
  ]);
  const response = await postBatch(f,token,body);
  const result = await response.json();
  assert.equal(response.status,409,JSON.stringify(result));
  assert.equal(result.error,'stale_credit');
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n,afterSeed);
  assert.equal(f.sql('SELECT current_balance_cents b FROM canonical_credit_balances WHERE credit_id=?',sibling.credit_id).b,siblingBefore);
});

test('payment.batch cash children share one open session and accumulate cash exactly once', async (t) => {
  const f = await activeCanon(t);
  const token = 'device-a-token';
  const tab = await device(f, { token, deviceId:'device-a' });
  const productId = await createSellableProduct(tab,'cash');
  const first = await liveCredit(tab,'cash-first',productId);
  const second = await liveCredit(tab,'cash-second',productId);
  await tab.api.openCash({session_id:'batch-cash-session',opening_cents:5000});
  await tab.api.refresh();

  const control = f.control();
  const before = f.sql("SELECT expected_cents,revision FROM canonical_cash_state WHERE session_id='batch-cash-session'");
  const body = batch(control, [
    payment(control,first,100,'efectivo',{session_id:'batch-cash-session'}),
    payment(control,second,150,'efectivo',{session_id:'batch-cash-session'})
  ]);
  const response = await postBatch(f,token,body);
  const result = await response.json();
  assert.equal(response.status,201,JSON.stringify(result));
  assert.equal(result.receipts[0].session_revision,before.revision+1);
  assert.equal(result.receipts[1].session_revision,before.revision+2);
  const after = f.sql("SELECT expected_cents,revision FROM canonical_cash_state WHERE session_id='batch-cash-session'");
  assert.equal(after.expected_cents,before.expected_cents+250);
  assert.equal(after.revision,before.revision+2);
});
