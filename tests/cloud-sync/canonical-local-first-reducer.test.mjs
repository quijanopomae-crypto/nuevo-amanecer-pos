import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {existsSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const path='POS/js/sync/canonical-local-reducer.js';
const ctx=vm.createContext({console});ctx.globalThis=ctx;
if(existsSync(path))vm.runInContext(readFileSync(path,'utf8'),ctx);
function api(){assert.equal(typeof ctx.NuevoAmanecerCanonicalLocalReducer,'object','local reducer must exist');return ctx.NuevoAmanecerCanonicalLocalReducer;}
export function base(){return {authority:'canonical',promotion_id:'promo',authority_epoch:3,revision:4,financial_revision:0,mode:'ACTIVE',read_only:false,minimum_client_contract:'a6-gate-c-v1',products:[{product_id:'p1',name:'Synthetic',price_cents:200,cost_cents:100,tracks_inventory:1,current_stock_quantity:173,stock_revision:0}],customers:[{customer_id:'c1',name:'Synthetic customer',total_purchases_cents:0}],credits:[{credit_id:'cr1',customer_id:'c1',provenance:'IMPORT',opening_balance_cents:1000,current_balance_cents:1000,revision:0}],payments:[],creditAccounts:[],sales:[],saleItems:[],cashSessions:[],cashMovements:[],financialEvents:[],inventoryMovements:[],expenses:[]};}
export function payload(extra={}){return {operation_id:randomUUID(),promotion_id:'promo',authority_epoch:3,expected_control_revision:4,client_contract:'a6-gate-c-v1',created_at:'2026-10-01T00:00:00.000Z',...extra};}
function apply(state,command,p){return api().apply(state,{command,payload:p}).projection;}
function open(state=base()){return apply(state,'cash.open',payload({session_id:'cash',opening_cents:0}));}
function sale(id='V-001',revision=0){return payload({sale_id:id,payment_method:'efectivo',session_id:'cash',total_cents:200,payment:{cash_cents:200,digital_cents:0,credit_cents:0},items:[{product_id:'p1',quantity:1,unit_price_cents:200,line_total_cents:200,expected_stock_revision:revision}]});}
test('offline local sale updates stock, cash, history once and leaves input immutable',()=>{
 const before=open(),raw=JSON.stringify(before),p=sale();const r=api().apply(before,{command:'sale.create',payload:p});
 assert.equal(JSON.stringify(before),raw);assert.equal(r.projection.products[0].current_stock_quantity,172);assert.equal(r.projection.cashSessions[0].expected_cents,200);assert.equal(r.projection.cashSessions[0].revision,1);assert.equal(r.projection.sales[0].operation_id,p.operation_id);assert.equal(r.receipt.status,'local_committed');assert.equal(r.projection.inventoryMovements.length,1);assert.equal(r.projection.cashMovements.length,1);
});
test('second sale without cloud ACK uses next local resource revision',()=>{
 let s=apply(open(),'sale.create',sale());s=apply(s,'sale.create',sale('V-002',1));assert.equal(s.products[0].current_stock_quantity,171);assert.equal(s.products[0].stock_revision,2);assert.equal(s.cashSessions[0].expected_cents,400);assert.equal(s.sales.length,2);
});
test('open, sale, payment, expense and close use all local movements and exact session revision',()=>{
 let s=apply(open(),'sale.create',sale());s=apply(s,'payment.create',payload({credit_id:'cr1',expected_credit_revision:0,amount_cents:300,payment_method:'efectivo',session_id:'cash'}));
 s=apply(s,'expense.create',payload({expense_id:'e1',amount_cents:100,payment_method:'efectivo',concept:'Synthetic expense',category:'Other',expense_date:'2026-10-01',session_id:'cash',expected_session_revision:2}));
 s=apply(s,'cash.close',payload({session_id:'cash',expected_session_revision:3,counted_cents:390}));const c=s.cashSessions[0];assert.equal(c.status,'CLOSED');assert.equal(c.expected_cents,400);assert.equal(c.counted_cents,390);assert.equal(c.difference_cents,-10);assert.equal(c.revision,4);assert.equal(s.credits[0].current_balance_cents,700);
});
test('batch payment is atomic and unrelated pending sale does not gate it',()=>{
 let s=open();s.credits.push({...s.credits[0],credit_id:'cr2'});const payments=['cr1','cr2'].map(credit_id=>payload({credit_id,expected_credit_revision:0,amount_cents:100,payment_method:'efectivo',session_id:'cash'}));
 const p=payload({payments});const r=api().apply(s,{command:'payment.batch',payload:p});assert.equal(r.receipt.receipts.length,2);assert.equal(r.projection.cashSessions[0].revision,2);assert.equal(r.projection.payments.length,2);assert.equal(r.projection.credits[0].current_balance_cents,900);
 const raw=JSON.stringify(s);payments[1].amount_cents=2000;assert.throws(()=>api().apply(s,{command:'payment.batch',payload:p}),/BALANCE/);assert.equal(JSON.stringify(s),raw);
});
test('stock, digital reference, money overflow, closed session and stale resource revisions are rejected',()=>{
 const s=open();assert.throws(()=>apply(s,'sale.create',sale('V-001',99)),/REVISION/);
 const p=sale();p.items[0].quantity=200;p.items[0].line_total_cents=40000;p.total_cents=40000;p.payment.cash_cents=40000;assert.throws(()=>apply(s,'sale.create',p),/STOCK/);
 const digital=payload({credit_id:'cr1',expected_credit_revision:0,amount_cents:100,payment_method:'yape',reference:'REF-1'});const after=apply(s,'payment.create',digital);assert.throws(()=>apply(after,'payment.create',payload({...digital,operation_id:randomUUID(),expected_credit_revision:1})),/REFERENCE/);
 assert.throws(()=>apply(s,'adjustment.create',payload({session_id:'cash',expected_session_revision:0,amount_cents:Number.MAX_SAFE_INTEGER+1,reason:'Synthetic'})),/UNSAFE|AMOUNT/);
 const closed=apply(s,'cash.close',payload({session_id:'cash',expected_session_revision:0,counted_cents:0}));assert.throws(()=>apply(closed,'sale.create',sale()),/CASH_SESSION/);
});
test('customer → account → credit sale → payment keeps exact identity and balances',()=>{
 let s=open();s=apply(s,'customer.create',payload({customer_id:'c2',name:'New synthetic customer',document:null,phone:null,address:null,color:1}));s=apply(s,'credit-account.create',payload({customer_id:'c2',account_id:'large',name:'Large',mode:'separate'}));
 const p=sale();p.customer_id='c2';p.payment_method='credito';delete p.session_id;p.payment={cash_cents:0,digital_cents:0,credit_cents:200};p.credit_due='2026-10-20';p.credit_account={account_id:'large',name:'Large',mode:'separate'};
 s=apply(s,'sale.create',p);const id=p.operation_id+':credit';assert.equal(s.credits.find(c=>c.credit_id===id).current_balance_cents,200);
 s=apply(s,'payment.create',payload({credit_id:id,expected_credit_revision:0,amount_cents:200,payment_method:'yape',reference:'ref-credit'}));assert.equal(s.credits.find(c=>c.credit_id===id).current_balance_cents,0);
});
test('product create, inventory adjustments and credit policy are local with CAS',()=>{
 let s=base();s=apply(s,'product.create',payload({product_id:'p2',name:'New synthetic product',sku:'sku2',barcode:'code2',alternate_codes:['alt2'],price_cents:200,cost_cents:100,tracks_inventory:true,initial_stock_quantity:3}));
 s=apply(s,'inventory.adjust',payload({product_id:'p2',movement_type:'SALIDA',quantity:1,expected_stock_revision:0,reason:'Synthetic adjustment'}));assert.equal(s.products.find(p=>p.product_id==='p2').current_stock_quantity,2);
 s=apply(s,'customer.credit-policy.set',payload({customer_id:'c1',mode:'MANUAL',manual_limit_cents:2000,expected_policy_revision:0,reason:'Synthetic owner reason',administrator_id:null,administrator_name:'Owner'}));assert.equal(s.customers[0].credit_policy_revision,1);
 assert.throws(()=>apply(s,'customer.credit-policy.set',payload({customer_id:'c1',mode:'MANUAL',manual_limit_cents:3000,expected_policy_revision:0})),/REVISION/);
});
test('compensation restores exact credit/cash and cannot compensate twice',()=>{
 let s=open();const p=payload({credit_id:'cr1',expected_credit_revision:0,amount_cents:100,payment_method:'efectivo',session_id:'cash'});s=apply(s,'payment.create',p);
 const c=payload({compensates_operation_id:p.operation_id,session_id:'cash',expected_session_revision:1,expected_credit_revision:1,reason:'Synthetic reversal'});s=apply(s,'compensation.create',c);assert.equal(s.credits[0].current_balance_cents,1000);assert.equal(s.cashSessions[0].expected_cents,0);assert.equal(s.payments[1].amount_cents,-100);assert.equal(s.payments[1].method,null);assert.throws(()=>apply(s,'compensation.create',payload({...c,operation_id:randomUUID()})),/COMPENSATED/);
});

test('credit account does not advance the backend financial counter',()=>{const s=base();const next=apply(s,'credit-account.create',payload({customer_id:'c1',account_id:'large',name:'Large',mode:'separate'}));assert.equal(next.financial_revision,s.financial_revision);});

test('sale preserves imported purchase basis exactly like canonical reads',()=>{const s=open();const p=sale();p.customer_id='c1';assert.equal(apply(s,'sale.create',p).customers[0].total_purchases_cents,s.customers[0].total_purchases_cents);});
