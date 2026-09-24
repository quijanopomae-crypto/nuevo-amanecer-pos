import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../POS/js/sync/canonical-sale-integration.js', import.meta.url), 'utf8');
const intentSource = readFileSync(new URL('../../POS/js/sync/canonical-sale-intent.js', import.meta.url), 'utf8');
const outboxSource = readFileSync(new URL('../../POS/js/sync/canonical-sale-outbox.js', import.meta.url), 'utf8');
const projectionSource = readFileSync(new URL('../../POS/js/sync/canonical-sale-projection.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../POS/index.html', import.meta.url), 'utf8');
const inline03 = readFileSync(new URL('../../POS/js/legacy-inline/inline-03.js', import.meta.url), 'utf8');

function harness({ enabled = true, method = 'efectivo', cart = [{ id: 7, qty: 2, precio: 4.25, unitsPerQty: 1 }], enqueueError = null, projectionError = false, lock = false, storageFailure = false, sessionOpen = true, stock = 10, paymentValid = true, verified = true, duplicateReference = false } = {}) {
  const els = new Map();
  for (const id of ['mMontoRec','mDigitalRef','mMixedRef','mMixedCash','mMixedDigitalMethod','mMixedDigitalVerified','mDigitalVerified','mCreditoCliente','mCreditoVence','mVentaCliente','mCobro','mBtnConf','cartDrawer','cartBackdrop','btnDescInfo']) els.set(id,{value:'',checked:true,classList:{remove(){},add(){}}});
  els.get('mMontoRec').value = '99'; els.get('mDigitalRef').value='real-ref'; els.get('mMixedRef').value='mixed-ref'; els.get('mMixedCash').value='3.00'; els.get('mMixedDigitalMethod').value='plin'; els.get('mCreditoCliente').value='cust-9'; els.get('mCreditoVence').value='2026-11-03';
  const calls = { build:0, enqueue:0, project:0, legacy:0, save:0, sync:0, fetch:0, toast:[], close:0 };
  let stored = null;
  const storage = new Map();
  const context = vm.createContext({ console, Date, Number, String, Object, Array, Math, JSON, Promise, Error, RegExp, Set, Map, crypto,
    navigator:{locks:{request:async(_name,_options,work)=>work({})}}, localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>{if(storageFailure)throw Error('storage');storage.set(key,value);}},
    CustomEvent: class { constructor(type,init){this.type=type;this.detail=init.detail;} }, dispatchEvent(){},
    document:{getElementById:id=>els.get(id)||null,querySelectorAll:()=>[],querySelector:()=>null},
    cart, productos:[{id:7,stock,precio:999}], ventas:duplicateReference?[{id:'V-004',paymentRef:method==='mixto'?'mixed-ref':'real-ref',anulada:false}]:[], clientes:[{id:'cust-9'}], creditos:[], cajMovs:[], inventoryMovements:[], posProc:false, posPayM:method, cajEstado:{abierta:true}, appConfig:{},
    NuevoAmanecerCanonical:{enabled:()=>enabled,snapshot:()=>({products:[{id:'7',stock:10}],customers:[{id:'cust-9'}],credits:[]})},
    isModuleLocked:(name,options)=>lock,
    _naSessionOpen:()=>sessionOpen,_naTracksStock:()=>true,_naUnitsSold:item=>item.qty*item.unitsPerQty,_naUnitsPerQty:item=>item.unitsPerQty||1,
    _naPaymentState:()=>({valid:paymentValid,message:'payment invalid'}),_naDigitalSalePayment:()=>method==='mixto'||['yape','plin','transferencia'].includes(method),_naDigitalPaymentVerified:()=>verified,_naClean:x=>String(x||'').trim(),_naMixedPaymentData:()=>({cash:3,digital:5.5,digitalMethod:'plin',reference:'mixed-ref'}),
    _naSetPaymentHint(){},_naPaymentFocusTarget:()=>null,toast:(...x)=>calls.toast.push(x),posUpdateCart(){},posRender(){},cerrarModal(){calls.close++;},
    saveAllData(){calls.save++;},_naWasPersisted:()=>true,fetch(){calls.fetch++;throw Error('network forbidden');}
  });
  context.confirmarVenta=async()=>{calls.legacy++;};
  context.globalThis=context;
  vm.runInContext(intentSource,context);
  const intentApi=context.NuevoAmanecerCanonicalSaleIntent;
  context.NuevoAmanecerCanonicalSaleIntent={VERSION:intentApi.VERSION,build(input){calls.build++;if(!calls.input)calls.input=input;return intentApi.build(input);}};
  vm.runInContext(outboxSource,context);
  const outbox=context.NuevoAmanecerCanonicalSaleOutbox;
  context.NuevoAmanecerCanonicalSaleOutbox={VERSION:outbox.VERSION,async enqueue(intent){calls.enqueue++;if(enqueueError)throw enqueueError;stored=await outbox.enqueue(intent);return stored;},snapshot:outbox.snapshot,sync(){calls.sync++;throw Error('sync forbidden');}};
  vm.runInContext(projectionSource,context);
  const projector=context.NuevoAmanecerCanonicalSaleProjection;
  context.NuevoAmanecerCanonicalSaleProjection={VERSION:projector.VERSION,project(base,snapshot){calls.project++;if(projectionError)throw Error('projection');return projector.project(base,snapshot);}};
  vm.runInContext(source,context);
  return {context,calls,els,get stored(){return stored;}};
}

test('legacy mode delegates exactly once and does not enter canonical pipeline', async()=>{const h=harness({enabled:false});await h.context.confirmarVenta();assert.equal(h.calls.legacy,1);assert.equal(h.calls.build+h.calls.enqueue+h.calls.project,0);});
test('canonical cash captures effective cart economics and projects after one durable enqueue',async()=>{const h=harness();await h.context.confirmarVenta();assert.equal(h.calls.legacy,0);assert.equal(h.calls.enqueue,1);assert.equal(h.calls.project,1);assert.equal(h.calls.save,0);assert.equal(h.calls.sync+h.calls.fetch,0);assert.equal(h.calls.input.items[0].product_id,'7');assert.equal(h.calls.input.items[0].quantity,2);assert.equal(h.calls.input.items[0].precio,4.25);assert.equal(h.stored.items[0].unit_price_cents,425);assert.match(h.stored.sale_id,/^V-\d{3}$/);assert.equal(h.stored.sale_id,h.calls.input.sale_id);assert.equal(h.context.cart.length,0);const first=h.context.NuevoAmanecerCanonicalSaleIntegration.lastProjection();first.sales.length=0;assert.equal(h.context.NuevoAmanecerCanonicalSaleIntegration.lastProjection().sales.length,1);});
test('mixed and credit payments retain their exact POS fields',async()=>{const mixed=harness({method:'mixto'});await mixed.context.confirmarVenta();assert.deepEqual(JSON.parse(JSON.stringify(mixed.calls.input.payment)),{cash_cents:300,digital_cents:550,digital_method:'plin',reference:'mixed-ref'});const credit=harness({method:'credito'});await credit.context.confirmarVenta();assert.equal(credit.calls.input.customer_id,'cust-9');assert.equal(credit.calls.input.credit_due,'2026-11-03');});
test('digital payment retains the POS reference and never uses it as operation identity',async()=>{for(const method of ['yape','plin','transferencia']){const h=harness({method});await h.context.confirmarVenta();assert.equal(h.stored.payment.reference,'real-ref');assert.notEqual(h.stored.operation_id,'real-ref');}});
test('cash, stock, payment, digital verification, duplicate reference and lock validations block capture',async()=>{for(const options of [{sessionOpen:false},{stock:1},{paymentValid:false},{method:'yape',verified:false},{method:'yape',duplicateReference:true},{lock:true}]){const h=harness(options),initialLength=h.context.cart.length;await h.context.confirmarVenta();assert.equal(h.calls.enqueue,0);assert.equal(h.context.cart.length,initialLength);assert.equal(h.calls.close,0);}});
test('unsupported cart entries and storage failure leave cart and modal intact',async()=>{for(const item of [{ventaLibre:true},{ventaModo:'caja'},{unidadesSinStock:1}]){const h=harness({cart:[{id:7,qty:1,precio:4.25,unitsPerQty:1,...item}]});await h.context.confirmarVenta();assert.equal(h.calls.enqueue,0);assert.equal(h.context.cart.length,1);}const h=harness({storageFailure:true});await h.context.confirmarVenta();assert.equal(h.calls.enqueue,1);assert.equal(h.context.cart.length,1);assert.equal(h.calls.close,0);assert.equal(h.calls.project,0);assert.equal(h.calls.save,0);});
test('projection failure after enqueue never retries automatically or rolls back the durable intent',async()=>{const h=harness({projectionError:true});await h.context.confirmarVenta();assert.equal(h.calls.enqueue,1);assert.ok(h.stored);assert.equal(h.context.cart.length,0);assert.match(h.calls.toast.at(-1)[0],/guardada localmente/);h.context.cart=[{id:7,qty:2,precio:4.25,unitsPerQty:1}];await h.context.confirmarVenta();assert.equal(h.calls.enqueue,1);});
test('capture lock option skips only canonical blanket lock and still evaluates all POS locks',()=>{const lockLine=inline03.split('\n').find(line=>line.startsWith('isModuleLocked=function(moduleName,options)'));assert.ok(lockLine);const context=vm.createContext({NuevoAmanecerCanonical:{enabled:()=>true},securityIsLocked:()=>false,storage:{getItem:key=>key==='master'?'false':'false'},LOCK_KEYS:{master:'master',readOnly:'readonly',modules:{ventas:'ventas',productos:'productos'}}});vm.runInContext(lockLine,context);assert.equal(context.isModuleLocked('ventas'),true);assert.equal(context.isModuleLocked('ventas',{canonicalSaleCapture:true}),false);assert.equal(context.isModuleLocked('productos',{canonicalSaleCapture:true}),true);context.securityIsLocked=()=>true;assert.equal(context.isModuleLocked('ventas',{canonicalSaleCapture:true}),true);context.securityIsLocked=()=>false;context.storage.getItem=key=>key==='master'?'true':'false';assert.equal(context.isModuleLocked('ventas',{canonicalSaleCapture:true}),true);context.storage.getItem=key=>key==='readonly'?'true':'false';assert.equal(context.isModuleLocked('ventas',{canonicalSaleCapture:true}),true);context.storage.getItem=key=>key==='ventas'?'true':'false';assert.equal(context.isModuleLocked('ventas',{canonicalSaleCapture:true}),true);});
test('parsed script order places canonical dependencies before integration between inline 03 and 07',()=>{const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match=>match[1]);const pos=needle=>scripts.findIndex(src=>src.endsWith(needle));assert.ok(pos('js/legacy-inline/inline-03.js')<pos('js/sync/canonical-sale-integration.js'));assert.ok(pos('js/sync/canonical-sale-integration.js')<pos('js/legacy-inline/inline-07.js'));for(const dep of ['canonical-sale-intent.js','canonical-sale-outbox.js','canonical-sale-projection.js'])assert.ok(pos(dep)<pos('js/sync/canonical-sale-integration.js'));});
