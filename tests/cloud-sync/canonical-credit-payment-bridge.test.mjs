import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('POS/js/sync/canonical-credit-payment-bridge.js','utf8');
const inline07=readFileSync('POS/js/legacy-inline/inline-07.js','utf8');
const index=readFileSync('POS/index.html','utf8');
const sw=readFileSync('POS/sw.js','utf8');

function element(value=''){
  return {
    value,
    textContent:'',
    disabled:false,
    focused:false,
    classList:{add(){},remove(){}},
    focus(){this.focused=true;}
  };
}

function harness(options={}){
  const calls=[];
  const ids={
    pagoMonto:element(options.amount ?? '25.50'),
    pagoMetodo:element(options.method ?? 'efectivo'),
    pagoOperacion:element(options.reference ?? ''),
    pagoConfirmBtn:element('✅ Confirmar'),
    mPagoCred:element()
  };
  let snapshot=options.snapshot ?? {
    credits:[{
      id:'CR-1',credit_id:'CR-1',monto:100,pagado:40,saldo:60,
      pagos:[]
    }],
    cashState:{abierta:true,sessionId:'CASH-1'}
  };
  let releasePayment;
  let releasePostRefresh;
  let refreshCount=0;
  const paymentGate=options.blockPayment ? new Promise(resolve=>{releasePayment=resolve;}) : null;
  const postRefreshGate=options.blockPostRefresh ? new Promise(resolve=>{releasePostRefresh=resolve;}) : null;
  const api={
    enabled(){return options.canonical !== false;},
    sourceState(){return options.currentSnapshot ? {validation:'current'} : {validation:'stale'};},
    pendingSnapshot(){return options.pending??null;},
    assertAction(action){calls.push(['assertAction',action]); if(options.currentSnapshot===false) throw new Error('CANONICAL_COMMERCE_CLOSED'); return true;},
    async refresh(){
      refreshCount+=1;
      calls.push(['refresh',refreshCount]);
      if(postRefreshGate && refreshCount===2) await postRefreshGate;
    },
    legacySnapshot(){calls.push(['snapshot']);return JSON.parse(JSON.stringify(snapshot));},
    async createPayment(payload){
      calls.push(['createPayment',JSON.parse(JSON.stringify(payload))]);
      if(paymentGate) await paymentGate;
      if(options.createError) throw new Error(options.createError);
      return {status:'created',operation_id:'OP-1'};
    }
  };
  const context={
    pagoCredId:options.creditId ?? 'CR-1',
    NuevoAmanecerCanonical:api,
    document:{
      getElementById(id){return ids[id]||null;}
    },
    toast(message,tone){calls.push(['toast',message,tone]);},
    cerrarModal(id){calls.push(['closeModal',id]);},
    cliRender(){calls.push(['cliRender']);},
    cajRender(){calls.push(['cajRender']);},
    updateDashboard(){calls.push(['dashboard']);},
    globalThis:null,
    Object,Number,String,Map,Set,Date,Math,Promise,Array,Error,JSON,console
  };
  context.globalThis=context;
  vm.runInNewContext(source,context,{filename:'canonical-credit-payment-bridge.js'});
  return {
    context,calls,ids,
    setSnapshot(value){snapshot=value;},
    releasePayment(value){if(releasePayment)releasePayment(value);},
    releasePostRefresh(value){if(releasePostRefresh)releasePostRefresh(value);}
  };
}

test('CANON cash credit payment sends exact cents and open canonical cash session',async()=>{
  const h=harness({amount:'25.50',method:'efectivo'});
  assert.equal(await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(),true);
  const call=h.calls.find(x=>x[0]==='createPayment');
  assert.deepEqual(call[1],{
    credit_id:'CR-1',
    amount_cents:2550,
    payment_method:'efectivo',
    session_id:'CASH-1'
  });
  assert.equal(h.calls.filter(x=>x[0]==='refresh').length,2);
  assert.ok(h.calls.some(x=>x[0]==='closeModal'&&x[1]==='mPagoCred'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls.filter(x=>['cliRender','cajRender','dashboard'].includes(x[0])).length,0,
    'canonical update event owns the page render; the bridge does not duplicate it');
  assert.equal(h.ids.pagoConfirmBtn.disabled,false);
});

test('confirmed payment does not keep the user waiting for the post-commit full refresh',async()=>{
  const h=harness({amount:'5',blockPostRefresh:true});
  const result=await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm();
  assert.equal(result,true);
  assert.ok(h.calls.some(x=>x[0]==='closeModal'&&x[1]==='mPagoCred'));
  assert.ok(h.calls.some(x=>x[0]==='toast'&&/CONFIRMADO/.test(x[1])&&x[2]==='success'));
  assert.equal(h.calls.filter(x=>x[0]==='createPayment').length,1);
  assert.equal(h.calls.filter(x=>x[0]==='refresh').length,2);
  h.releasePostRefresh();
  await new Promise(resolve=>setImmediate(resolve));
});

test('current CANON snapshot skips the redundant full refresh before payment',async()=>{
  const h=harness({amount:'5',currentSnapshot:true});
  assert.equal(await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(),true);
  await new Promise(resolve=>setImmediate(resolve));
  const refreshes=h.calls.filter(x=>x[0]==='refresh');
  assert.equal(refreshes.length,1,'only background reconciliation should refresh');
  const createIndex=h.calls.findIndex(x=>x[0]==='createPayment');
  const refreshIndex=h.calls.findIndex(x=>x[0]==='refresh');
  assert.ok(createIndex>=0 && refreshIndex>createIndex,'payment ACK should happen before the full refresh');
});

test('CANON digital payment sends reference and never attaches cash session',async()=>{
  const h=harness({amount:'10',method:'transferencia',reference:'  OP-7788  '});
  assert.equal(await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(),true);
  const payload=h.calls.find(x=>x[0]==='createPayment')[1];
  assert.deepEqual(payload,{
    credit_id:'CR-1',
    amount_cents:1000,
    payment_method:'transferencia',
    reference:'OP-7788'
  });
  assert.equal('session_id' in payload,false);
});

test('CANON payment rejects overpayment before creating a command',async()=>{
  const h=harness({amount:'60.01'});
  assert.equal(await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(),false);
  assert.equal(h.calls.some(x=>x[0]==='createPayment'),false);
  assert.ok(h.calls.some(x=>x[0]==='toast'&&/supera el saldo/.test(x[1])));
});

test('CANON cash payment requires an open canonical cash session',async()=>{
  const h=harness({
    amount:'5',
    snapshot:{
      credits:[{id:'CR-1',credit_id:'CR-1',monto:100,pagado:40,saldo:60,pagos:[]}],
      cashState:{abierta:false,sessionId:null}
    }
  });
  assert.equal(await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(),false);
  assert.equal(h.calls.some(x=>x[0]==='createPayment'),false);
  assert.ok(h.calls.some(x=>x[0]==='toast'&&/Abre la caja/.test(x[1])));
});

test('CANON digital payment preserves duplicate-operation guard',async()=>{
  const h=harness({
    amount:'5',
    method:'yape',
    reference:'ABC-1234',
    snapshot:{
      credits:[
        {id:'CR-1',credit_id:'CR-1',monto:100,pagado:40,saldo:60,pagos:[]},
        {id:'CR-2',credit_id:'CR-2',monto:50,pagado:5,saldo:45,pagos:[{numeroOperacion:'abc-1234'}]}
      ],
      cashState:{abierta:true,sessionId:'CASH-1'}
    }
  });
  assert.equal(await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(),false);
  assert.equal(h.calls.some(x=>x[0]==='createPayment'),false);
  assert.ok(h.calls.some(x=>x[0]==='toast'&&/ya fue registrado/.test(x[1])));
});

test('double submission cannot create two CANON payments',async()=>{
  const h=harness({amount:'5',blockPayment:true});
  const first=h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm();
  await new Promise(resolve=>setImmediate(resolve));
  const second=await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm();
  assert.equal(second,false);
  assert.equal(h.calls.filter(x=>x[0]==='createPayment').length,1);
  h.releasePayment();
  assert.equal(await first,true);
  assert.equal(h.calls.filter(x=>x[0]==='createPayment').length,1);
});

test('failed CANON command does not close modal or report success',async()=>{
  const h=harness({amount:'5',createError:'CANONICAL_FINANCIAL_PENDING'});
  assert.equal(await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(),false);
  assert.equal(h.calls.some(x=>x[0]==='closeModal'),false);
  assert.ok(h.calls.some(x=>x[0]==='toast'&&/CANONICAL_FINANCIAL_PENDING/.test(x[1])&&x[2]==='error'));
});

test('a pending credit policy explains how to resolve it before attempting the payment again',async()=>{
  const h=harness({pending:{command:'customer.credit-policy.set',last_error:'internal_error',payload:{customer_id:'MISAEL'}}});
  assert.equal(await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirm(),false);
  assert.equal(h.calls.some(x=>x[0]==='createPayment'),false);
  const message=h.calls.find(x=>x[0]==='toast'&&x[2]==='error')?.[1]||'';
  assert.match(message,/ajuste manual de línea/i);
  assert.match(message,/reintentar/i);
  assert.match(message,/misma operación/i);
  assert.match(message,/no se registró el pago/i);
});

test('bridge never writes legacy persistence or local financial arrays',()=>{
  assert.doesNotMatch(source,/saveAllData\s*\(|saveAppState\s*\(|localStorage|sessionStorage/);
  assert.doesNotMatch(source,/creditos\s*\.(?:push|unshift)|cajMovs\s*\.(?:push|unshift)/);
  assert.doesNotMatch(source,/fetch\s*\(|D1|R2/);
  assert.match(source,/createPayment\s*\(/);
  assert.match(source,/refreshCanonical\s*\(/);
});

test('final F10 winner routes CANON to bridge while preserving permission and legacy fallback',()=>{
  assert.match(inline07,/_naF10AuthorizePermission\('credits','Confirmar un pago de crédito'\)/);
  assert.match(inline07,/NuevoAmanecerCanonicalCreditPaymentBridge/);
  assert.match(inline07,/bridge\.confirm\(\)/);
  assert.match(inline07,/_naF10BaseConfirmarPago\.apply\(this,args\)/);
});

test('CANON shell loads and precaches credit payment bridge after canonical client',()=>{
  const client=index.indexOf('js/sync/canonical-client.js');
  const bridge=index.indexOf('js/sync/canonical-credit-payment-bridge.js');
  const globals=index.indexOf('js/compat/legacy-globals.js');
  assert.ok(client>=0 && bridge>client && globals>bridge);
  assert.match(sw,/\.\/js\/sync\/canonical-credit-payment-bridge\.js/);
});
