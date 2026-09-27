import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('POS/js/sync/canonical-client.js','utf8');
const adapterSource=readFileSync('POS/js/adapters/canonical-ui-adapter.js','utf8');

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
