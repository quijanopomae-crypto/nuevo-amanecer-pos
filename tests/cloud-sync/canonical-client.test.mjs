import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('POS/js/sync/canonical-client.js','utf8');
const adapterSource=readFileSync('POS/js/adapters/canonical-ui-adapter.js','utf8');
const expenseBridgeSource=readFileSync('POS/js/sync/canonical-expense-bridge.js','utf8');
const indexSource=readFileSync('POS/index.html','utf8');
const swSource=readFileSync('POS/sw.js','utf8');

test('canonical client reads all operational routes only through the existing read pipeline',()=>{
  for(const pair of [
    "['sales','sales']",
    "['sale-items','saleItems']",
    "['inventory-movements','inventoryMovements']",
    "['cash-movements','cashMovements']",
    "['cash-sessions', 'cashSessions']",
    "['financial-events', 'financialEvents']"
  ]) assert.ok(source.includes(pair),pair);
});

test('operational arrays survive replica cache round-trips without becoming required for old caches',()=>{
  for(const marker of ['replica.sales == null','replica.sale_items == null','replica.inventory_movements == null','replica.cash_movements == null']) assert.ok(source.includes(marker),marker);
  for(const marker of ['sales: copy(value.sales || [])','sale_items: copy(value.saleItems || [])','inventory_movements: copy(value.inventoryMovements || [])','cash_movements: copy(value.cashMovements || [])']) assert.ok(source.includes(marker),marker);
  for(const marker of ['sales: copy(replica.sales || [])','saleItems: copy(replica.sale_items || [])','inventoryMovements: copy(replica.inventory_movements || [])','cashMovements: copy(replica.cash_movements || [])']) assert.ok(source.includes(marker),marker);
});

test('sale fast path reads only status + products + customers and never waits for operational history',()=>{
  const start=source.indexOf('async function refreshSaleAuthority()');
  const end=source.indexOf('function assertSaleAction()',start);
  assert.ok(start>=0&&end>start);
  const block=source.slice(start,end);
  assert.match(block,/\/read\/canonical\/status/);
  assert.match(block,/readRows\('products'\)/);
  assert.match(block,/readRows\('customers'\)/);
  assert.doesNotMatch(block,/readRows\('sales'\)|readRows\('sale-items'\)|readRows\('cash-movements'\)|readRows\('inventory-movements'\)/);
  const saleStart=source.indexOf('async function createSale(sale)');
  const saleEnd=source.indexOf('async function createCommand',saleStart);
  assert.match(source.slice(saleStart,saleEnd),/prepareSaleCommand\(\)/);
});

test('confirmed sale advances only the sale stock overlay and keeps other commands refresh-gated',()=>{
  assert.match(source,/var saleProductEffects = new Map\(\)/);
  assert.match(source,/function effectiveSaleProduct\(productId\)/);
  assert.match(source,/saleProductEffects\.set\(effect\.product_id,effect\)/);
  assert.match(source,/saleMutationGeneration \+= 1/);
  assert.match(source,/if \(command === 'sale\.create' && skipStatus === true\) assertSaleAction\(\)/);
  assert.match(source,/else assertAction\(command\)/);
  assert.match(source,/var product = effectiveSaleProduct\(requested\.product_id\)/);
});

test('full refresh is fenced against a newer durable sale receipt',()=>{
  assert.match(source,/var saleGenerationAtStart = saleMutationGeneration/);
  assert.match(source,/CANONICAL_REFRESH_SUPERSEDED/);
  assert.match(source,/assertRefreshNotSuperseded\(\);\s*publishReplica\(incoming, 'remote'\)/);
});

test('sale conflict repair requires remote proof before journal removal',()=>{
  const start=source.indexOf('async function repairRejectedSaleConflict');
  const end=source.indexOf('async function retryPending',start);
  assert.ok(start>=0&&end>start);
  const block=source.slice(start,end);
  assert.match(block,/last_error !== 'canonical_sale_conflict'/);
  assert.match(block,/\/read\/canonical\/sales\?limit=100/);
  assert.match(block,/sameOperation/);
  assert.match(block,/conflictingSale/);
  const remove=block.indexOf('root.localStorage.removeItem(JOURNAL)');
  const proof=block.indexOf("if (!conflictingSale) return { status:'NOT_PROVEN'");
  assert.ok(remove>proof,'journal removal must occur only after collision proof');
  assert.match(block,/await refreshSaleAuthority\(\)/);
});

test('operational history remains a read concern and adds no new commands',()=>{
  const commands=source.match(/var COMMANDS = \[([^\]]+)\]/)?.[1]||'';
  assert.doesNotMatch(commands,/sales\.read|cash\.read|inventory\.read/);
  assert.doesNotMatch(source,/createOperational|writeSaleHistory|writeCashHistory/);
});


test('operational adapter preserves sale totals, mixed payment parts and exact cash session linkage',()=>{
  const context={globalThis:{}};
  vm.runInNewContext(adapterSource,context,{filename:'canonical-ui-adapter.js'});
  const adapter=context.globalThis.NuevoAmanecerCanonicalUIAdapter;
  const out=adapter.snapshot({
    authority:'canonical',promotion_id:'p',authority_epoch:1,revision:1,financial_revision:1,mode:'ACTIVE',read_only:false,
    products:[{product_id:'prod-1',name:'Producto',category:'a',icon:'📦',cost_cents:200,price_cents:500,current_stock_quantity:5,stock_revision:1,stock_min_quantity:1,tracks_inventory:1}],
    customers:[{customer_id:'cli-1',name:'Cliente',document:'70000001',total_purchases_cents:1000}],
    creditAccounts:[],credits:[],payments:[],
    sales:[{sale_id:'sale-1',operation_id:'op-1',payment_method:'mixto',total_cents:1000,payment_reference:'REF',created_at:'2026-09-27T17:00:00.000Z',customer_id:'cli-1'}],
    saleItems:[{sale_id:'sale-1',line_number:1,operation_id:'op-1',product_id:'prod-1',quantity:2,unit_price_cents:500,line_total_cents:1000,created_at:'2026-09-27T17:00:00.000Z'}],
    inventoryMovements:[{movement_id:'inv-1',operation_id:'op-1',sale_id:'sale-1',line_number:1,product_id:'prod-1',quantity:-2,created_at:'2026-09-27T17:00:00.000Z'}],
    cashMovements:[{movement_id:'cash-1',operation_id:'op-1',sale_id:'sale-1',payment_method:'mixto',amount_cents:1000,cash_cents:400,digital_cents:600,credit_cents:0,digital_method:'transferencia',reference:'REF',created_at:'2026-09-27T17:00:00.000Z',session_id:'sess-1'}],
    cashSessions:[{session_id:'sess-1',opening_cents:10000,opened_at:'2026-09-27T16:00:00.000Z',status:'OPEN',expected_cents:10600,revision:2}],
    financialEvents:[{event_id:'pay-1',operation_id:'pay-1',event_type:'PAYMENT',session_id:'sess-1',credit_id:'cr-1',credit_delta_cents:-200,cash_delta_cents:200,payment_method:'efectivo',created_at:'2026-09-27T17:05:00.000Z'}]
  });
  assert.equal(out.sales[0].items.reduce((n,item)=>n+item.qty*item.precio,0),10);
  assert.deepEqual(JSON.parse(JSON.stringify(out.sales[0].paymentBreakdown)),{efectivo:4,digital:6,digitalMethod:'transferencia',reference:'REF'});
  assert.equal(out.sales[0].canonicalReadOnly,true);
  assert.equal(out.cashState.sessionId,'sess-1');
  assert.equal(out.cashState.esperado,106);
  assert.equal(out.cashMovements.find(x=>x.ventaId==='sale-1').sessionId,'sess-1');
  assert.equal(out.cashMovements.find(x=>x.creditoId==='cr-1').efectivo,2);
  assert.equal(out.inventoryMovements[0].delta,-2);
});


test('canonical client treats expenses as a durable command and replicated operational entity',()=>{
  assert.match(source,/['"]expense\.create['"]/);
  assert.match(source,/\['expenses','expenses'\]/);
  assert.match(source,/expenses:\s*copy\(value\.expenses \|\| \[\]\)/);
  assert.match(source,/expenses:\s*copy\(replica\.expenses \|\| \[\]\)/);
  assert.match(source,/function makeExpensePayload\(input\)/);
  assert.match(source,/function createExpense\(input\)/);
  assert.match(source,/createExpense:\s*createExpense/);
  assert.match(source,/record\.command === 'expense\.create'/);
});

test('expense bridge writes only through canonical createExpense and keeps legacy storage out of CANON path',()=>{
  assert.match(expenseBridgeSource,/api\(\)\.createExpense\(input\)/);
  assert.match(expenseBridgeSource,/date === today\(\)/);
  assert.match(expenseBridgeSource,/input\.session_id = cash\.sessionId/);
  assert.doesNotMatch(expenseBridgeSource,/saveAllData\s*\(/);
  assert.doesNotMatch(expenseBridgeSource,/gastos\.(?:push|unshift)\s*\(/);
  const cash=indexSource.indexOf('js/sync/canonical-cash-bridge.js');
  const expense=indexSource.indexOf('js/sync/canonical-expense-bridge.js');
  assert.ok(cash>=0 && expense>cash,'expense bridge must wrap the final cash/legacy handlers');
  assert.match(swSource,/\.\/js\/sync\/canonical-expense-bridge\.js/);
});

test('expense bridge attaches only todays open CANON session and redirects Caja gasto to the same modal',async()=>{
  const fields={
    gasDesc:{value:'Compra bolsas'},
    gasMonto:{value:'12.50'},
    gasMetodo:{value:'efectivo'},
    gasFecha:{value:'2026-09-27'},
    gasCat:{value:'Operativo'},
    gasNota:{value:'turno'},
    mGasto:{classList:{add(){},remove(){}}},
  };
  const button={disabled:false,textContent:'💾 Registrar'};
  const calls=[];
  const context={
    document:{
      getElementById(id){return fields[id]||null;},
      querySelector(selector){return selector==='#mGasto .mbtn-ok'?button:null;}
    },
    NuevoAmanecerCanonical:{
      enabled(){return true;},
      async refresh(){calls.push(['refresh']);},
      legacySnapshot(){return {cashState:{abierta:true,sessionId:'sess-1'}};},
      async createExpense(input){calls.push(['expense',JSON.parse(JSON.stringify(input))]);return {session_id:input.session_id||null};}
    },
    _naF10AuthorizePermission(){return true;},
    obtenerHoy(){return '2026-09-27';},
    cerrarModal(id){calls.push(['close',id]);},
    gasRender(){calls.push(['gasRender']);},
    cajRender(){calls.push(['cajRender']);},
    updateDashboard(){calls.push(['dashboard']);},
    toast(message,tone){calls.push(['toast',message,tone]);},
    abrirModalGasto(){calls.push(['legacy-open']);},
    guardarGasto(){calls.push(['legacy-save']);},
    abrirMovCaja(type){calls.push(['legacy-cash',type]);},
    Object,Promise,Number,String,Date,JSON
  };
  context.globalThis=context;
  vm.runInNewContext(expenseBridgeSource,context,{filename:'canonical-expense-bridge.js'});

  context.abrirMovCaja('gas');
  assert.equal(calls.some(x=>x[0]==='legacy-cash'),false);
  fields.gasDesc.value='Compra bolsas';
  fields.gasMonto.value='12.50';
  fields.gasMetodo.value='efectivo';
  fields.gasFecha.value='2026-09-27';
  fields.gasCat.value='Operativo';
  fields.gasNota.value='turno';
  await context.guardarGasto();
  const first=calls.find(x=>x[0]==='expense')[1];
  assert.equal(first.amount_cents,1250);
  assert.equal(first.session_id,'sess-1');
  assert.equal(first.expense_date,'2026-09-27');
  assert.equal(first.category,'Operativo');

  fields.gasFecha.value='2026-09-26';
  calls.length=0;
  await context.guardarGasto();
  const backdated=calls.find(x=>x[0]==='expense')[1];
  assert.equal(Object.prototype.hasOwnProperty.call(backdated,'session_id'),false);
});

test('adapter projects canonical expenses to Gastos and only session expenses to Caja',()=>{
  const context={globalThis:{}};
  vm.runInNewContext(adapterSource,context,{filename:'canonical-ui-adapter.js'});
  const adapter=context.globalThis.NuevoAmanecerCanonicalUIAdapter;
  const out=adapter.snapshot({
    authority:'canonical',promotion_id:'p',authority_epoch:1,revision:1,financial_revision:3,mode:'ACTIVE',read_only:false,
    products:[],customers:[],creditAccounts:[],credits:[],payments:[],sales:[],saleItems:[],inventoryMovements:[],cashMovements:[],financialEvents:[],
    cashSessions:[{session_id:'s1',opening_cents:10000,opened_at:'2026-09-27T15:00:00.000Z',status:'OPEN',expected_cents:8750,revision:2}],
    expenses:[
      {expense_id:'e1',operation_id:'op1',session_id:'s1',amount_cents:1250,cash_delta_cents:-1250,concept:'Bolsas',category:'Operativo',payment_method:'efectivo',expense_date:'2026-09-27',note:'',created_at:'2026-09-27T16:00:00.000Z'},
      {expense_id:'e2',operation_id:'op2',session_id:null,amount_cents:500,cash_delta_cents:0,concept:'Internet',category:'Servicios',payment_method:'transferencia',expense_date:'2026-09-26',note:'mes',created_at:'2026-09-27T16:05:00.000Z'}
    ]
  });
  assert.equal(out.expenses.length,2);
  assert.equal(out.expenses[0].monto,12.5);
  assert.equal(out.expenses[0].canonicalReadOnly,true);
  const gas=out.cashMovements.filter(x=>x.tipo==='gas');
  assert.equal(gas.length,1);
  assert.equal(gas[0].expenseId,'e1');
  assert.equal(gas[0].efectivo,12.5);
  assert.equal(out.cashState.esperado,87.5);
});


test('rejected payment journal cleanup is narrow and never clears uncertain transport failures',()=>{
  const start=source.indexOf('async function discardRejectedPayment()');
  const end=source.indexOf('async function discardRejectedProduct()',start);
  assert.ok(start>=0&&end>start,'discardRejectedPayment must exist before product cleanup');
  const block=source.slice(start,end);
  assert.match(block,/\['payment\.create','payment\.batch'\]\.includes\(record\.command\)/);
  assert.match(block,/\!\[400,409\]\.includes\(record\.last_status\) \|\| !record\.last_error/);
  assert.match(block,/localStorage\.removeItem\(JOURNAL\)/);
  assert.doesNotMatch(block,/500|503|CANONICAL_FINANCIAL_PENDING/,'uncertain/server failures must never be auto-discarded');
  assert.match(source,/discardRejectedPayment:\s*discardRejectedPayment/);
});

test('payment batch lean path uses one batch transport for one-to-twenty debts and keeps retries authority-checked',()=>{
  const start=source.indexOf('async function createPaymentBatch(inputs)');
  const end=source.indexOf('function createProduct(input)',start);
  assert.ok(start>=0&&end>start,'createPaymentBatch must exist before command wrappers');
  const block=source.slice(start,end);
  assert.doesNotMatch(block,/inputs\.length === 1/,'one debt must not detour through the heavier generic payment.create endpoint');
  assert.doesNotMatch(block,/await createPayment\(/,'Cobro múltiple always uses the specialized payment.batch transport');
  assert.match(block,/return withWriterLock\(async function \(\)/);
  assert.match(block,/assertAction\('payment\.create'\)/);
  assert.match(block,/seen\.has\(creditId\)/);
  assert.match(block,/makeFinancialPayload\('payment\.create', input\)/,'each debt remains a payment.create child');
  assert.match(block,/var CHUNK = 20/);
  assert.match(block,/command: 'payment\.batch'/);
  assert.match(block,/route: '\/commands\/payment\.batch'/);
  assert.match(block,/Object\.assign\(commonPayload\(\), \{ payments: payments \}\)/);
  assert.match(block,/durableJournal\(record\)/);
  assert.match(block,/sendPending\(record, true\)/,'new atomically validated batch must skip the redundant status GET');
  assert.match(block,/sendPending\(retryRecord, false\)/,'retry must still verify remote authority');
  assert.doesNotMatch(block,/route: '\/commands\/payment\.create'/);
  assert.doesNotMatch(block,/\brefresh\s*\(/,'batch fast path must not perform full replica refreshes between payments');
  assert.match(source,/record\.command === 'payment\.batch'/);
  assert.match(source,/createPaymentBatch:\s*createPaymentBatch/);
});
