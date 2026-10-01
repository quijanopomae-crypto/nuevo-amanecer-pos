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
  let createCount=0;
  let pending=options.pending ?? null;
  const paymentGate=options.blockPayment ? new Promise(resolve=>{releasePayment=resolve;}) : null;
  const postRefreshGate=options.blockPostRefresh ? new Promise(resolve=>{releasePostRefresh=resolve;}) : null;
  function applyPayment(payload){
    if(!options.applyPayments)return;
    const row=snapshot.credits.find(item=>String(item.credit_id??item.id)===String(payload.credit_id));
    if(!row)return;
    const amount=payload.amount_cents/100;
    row.pagado=Number(row.pagado||0)+amount;
    row.saldo=Math.max(0,Number(row.saldo||0)-amount);
  }
  const api={
    enabled(){return options.canonical !== false;},
    sourceState(){return options.currentSnapshot ? {validation:'current'} : {validation:'stale'};},
    assertAction(action){calls.push(['assertAction',action]); if(options.currentSnapshot===false) throw new Error('CANONICAL_COMMERCE_CLOSED'); return true;},
    async refresh(){
      refreshCount+=1;
      calls.push(['refresh',refreshCount]);
      if(options.refreshErrorAt===refreshCount)throw new Error('CANONICAL_REFRESH_FAILED');
      if(postRefreshGate && refreshCount===2) await postRefreshGate;
    },
    legacySnapshot(){calls.push(['snapshot']);return JSON.parse(JSON.stringify(snapshot));},
    pendingSnapshot(){return pending?JSON.parse(JSON.stringify(pending)):null;},
    async retryPending(){
      calls.push(['retryPending']);
      if(options.retryError)throw new Error(options.retryError);
      const payload=pending?.payload;
      if(payload?.amount_cents)applyPayment(payload);
      const receipt={status:'already_processed',operation_id:payload?.operation_id||'OP-REPLAY'};
      pending=null;
      return receipt;
    },
    async discardRejectedPayment(){
      calls.push(['discardRejectedPayment']);
      if(!pending || !['payment.create','payment.batch'].includes(pending.command) || !pending.last_error || ![400,409].includes(pending.last_status))return false;
      pending=null;
      return true;
    },
    async createPaymentBatch(inputs){
      calls.push(['createPaymentBatch',JSON.parse(JSON.stringify(inputs))]);
      const receipts=[];
      for(let i=0;i<inputs.length;i+=1){
        try{
          receipts.push(await api.createPayment(inputs[i]));
        }catch(error){
          const retryable=pending;
          if(retryable&&retryable.command==='payment.create'&&!retryable.invalid&&!retryable.last_error){
            try{
              receipts.push(await api.retryPending());
              continue;
            }catch(retryError){
              return {ok:false,pending_unresolved:true,rejected:false,failed_index:i,error:String(retryError?.message||retryError),receipts};
            }
          }
          return {ok:false,pending_unresolved:false,rejected:true,failed_index:i,error:String(error?.message||error),receipts};
        }
      }
      return {ok:true,receipts};
    },
    async createPayment(payload){
      createCount+=1;
      calls.push(['createPayment',JSON.parse(JSON.stringify(payload))]);
      if(paymentGate) await paymentGate;
      if(options.createError || options.createErrorAt===createCount){
        if(options.pendingOnCreateError){
          pending={
            command:'payment.create',
            invalid:false,
            payload:{...JSON.parse(JSON.stringify(payload)),operation_id:'OP-PENDING-'+createCount}
          };
          if(options.pendingOnCreateError==='rejected'){pending.last_error='stale_credit';pending.last_status=409;}
        }
        throw new Error(options.createError||'CANONICAL_FINANCIAL_PENDING');
      }
      applyPayment(payload);
      return {status:'created',operation_id:'OP-'+createCount};
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

test('bridge never writes legacy persistence or local financial arrays',()=>{
  assert.doesNotMatch(source,/saveAllData\s*\(|saveAppState\s*\(|localStorage|sessionStorage/);
  assert.doesNotMatch(source,/creditos\s*\.(?:push|unshift)|cajMovs\s*\.(?:push|unshift)/);
  assert.doesNotMatch(source,/fetch\s*\(|D1|R2/);
  assert.match(source,/createPayment\s*\(/);
  assert.match(source,/createPaymentBatch/);
  assert.match(source,/reconcileBatchAfterCommit/);
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


test('batch cash payment uses one client batch call and only one background canonical refresh',async()=>{
  const h=harness({
    currentSnapshot:true,
    applyPayments:true,
    snapshot:{
      credits:[
        {id:'CR-1',credit_id:'CR-1',monto:60,pagado:0,saldo:60,pagos:[]},
        {id:'CR-2',credit_id:'CR-2',monto:45,pagado:0,saldo:45,pagos:[]}
      ],
      cashState:{abierta:true,sessionId:'CASH-1'}
    }
  });
  const result=await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirmBatch({
    allocations:[
      {credit_id:'CR-1',amount_cents:6000},
      {credit_id:'CR-2',amount_cents:1000}
    ],
    payment_method:'efectivo'
  });
  assert.equal(result.ok,true);
  assert.equal(result.completed_count,2);
  assert.equal(result.completed_cents,7000);
  const writes=h.calls.filter(x=>x[0]==='createPayment').map(x=>x[1]);
  assert.deepEqual(writes,[
    {credit_id:'CR-1',amount_cents:6000,payment_method:'efectivo',session_id:'CASH-1'},
    {credit_id:'CR-2',amount_cents:1000,payment_method:'efectivo',session_id:'CASH-1'}
  ]);
  assert.equal(h.calls.filter(x=>x[0]==='createPaymentBatch').length,1,'bridge must hand the selected debts to one locked client batch');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls.filter(x=>x[0]==='refresh').length,1,'full canonical reconciliation runs once after the confirmed batch, never between debts');
  assert.equal(result.reconciling,true);
  assert.equal(h.calls.some(x=>x[0]==='closeModal'),false,'batch flow is inline and must not close the single-payment modal');
  assert.ok(h.calls.some(x=>x[0]==='toast'&&/Cobro múltiple CANON CONFIRMADO/.test(x[1])&&x[2]==='success'));
});

test('batch automatically clears a definitively rejected prior payment and continues with fresh data',async()=>{
  const h=harness({
    currentSnapshot:true,
    pending:{
      command:'payment.create',
      invalid:false,
      last_error:'stale_credit',
      last_status:409,
      payload:{operation_id:'OLD-REJECTED',credit_id:'CR-OLD',amount_cents:300,payment_method:'efectivo'}
    },
    snapshot:{
      credits:[{id:'CR-1',credit_id:'CR-1',monto:11,pagado:0,saldo:11,pagos:[]}],
      cashState:{abierta:true,sessionId:'CASH-1'}
    }
  });
  const result=await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirmBatch({
    allocations:[{credit_id:'CR-1',amount_cents:1100}],
    payment_method:'efectivo'
  });
  assert.equal(result.ok,true);
  assert.equal(h.calls.filter(x=>x[0]==='discardRejectedPayment').length,1);
  assert.equal(h.calls.filter(x=>x[0]==='retryPending').length,0);
  assert.equal(h.calls.filter(x=>x[0]==='refresh').length,2,'rejected stale payment forces a fresh snapshot and then background reconciliation');
  assert.equal(h.calls.filter(x=>x[0]==='createPaymentBatch').length,1);
  assert.equal(h.calls.some(x=>x[0]==='toast'&&/operación CANON pendiente/.test(x[1])),false);
});

test('batch replays an uncertain prior payment once, refreshes balances and does not create a second payment in the same click',async()=>{
  const h=harness({
    currentSnapshot:true,
    applyPayments:true,
    pending:{
      command:'payment.create',
      invalid:false,
      payload:{operation_id:'OLD-UNCERTAIN',credit_id:'CR-1',amount_cents:500,payment_method:'efectivo'}
    },
    snapshot:{
      credits:[{id:'CR-1',credit_id:'CR-1',monto:11,pagado:0,saldo:11,pagos:[]}],
      cashState:{abierta:true,sessionId:'CASH-1'}
    }
  });
  const result=await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirmBatch({
    allocations:[{credit_id:'CR-1',amount_cents:1100}],
    payment_method:'efectivo'
  });
  assert.equal(result.ok,false);
  assert.equal(result.recovered,true);
  assert.equal(result.code,'PRIOR_CANONICAL_PAYMENT_CONFIRMED');
  assert.equal(h.calls.filter(x=>x[0]==='retryPending').length,1);
  assert.equal(h.calls.filter(x=>x[0]==='refresh').length,1);
  assert.equal(h.calls.filter(x=>x[0]==='createPaymentBatch').length,0,'same click must never create a second financial intent after replay');
  assert.ok(h.calls.some(x=>x[0]==='toast'&&/Saldos actualizados/.test(x[1])&&x[2]==='success'));
});

test('batch still blocks an unrelated CANON pending command instead of deleting it',async()=>{
  const h=harness({
    currentSnapshot:true,
    pending:{command:'sale.create',invalid:false,payload:{operation_id:'SALE-PENDING'}}
  });
  const result=await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirmBatch({
    allocations:[{credit_id:'CR-1',amount_cents:500}],
    payment_method:'efectivo'
  });
  assert.equal(result.ok,false);
  assert.equal(result.code,'CANONICAL_OTHER_PENDING');
  assert.equal(h.calls.filter(x=>x[0]==='discardRejectedPayment').length,0);
  assert.equal(h.calls.filter(x=>x[0]==='retryPending').length,0);
  assert.equal(h.calls.filter(x=>x[0]==='createPaymentBatch').length,0);
});

test('batch digital payment keeps one real external reference across all selected allocations',async()=>{
  const h=harness({
    currentSnapshot:true,
    applyPayments:true,
    snapshot:{
      credits:[
        {id:'CR-1',credit_id:'CR-1',monto:20,pagado:0,saldo:20,pagos:[]},
        {id:'CR-2',credit_id:'CR-2',monto:20,pagado:0,saldo:20,pagos:[]}
      ],
      cashState:{abierta:true,sessionId:'CASH-1'}
    }
  });
  const result=await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirmBatch({
    allocations:[
      {credit_id:'CR-1',amount_cents:500},
      {credit_id:'CR-2',amount_cents:700}
    ],
    payment_method:'yape',
    reference:' YP-9001 '
  });
  assert.equal(result.ok,true);
  const writes=h.calls.filter(x=>x[0]==='createPayment').map(x=>x[1]);
  assert.equal(writes.length,2);
  assert.ok(writes.every(x=>x.reference==='YP-9001'));
  assert.ok(writes.every(x=>!('session_id' in x)));
});

test('batch stops after the first rejected later allocation and never recreates already confirmed payments',async()=>{
  const h=harness({
    currentSnapshot:true,
    applyPayments:true,
    createErrorAt:2,
    pendingOnCreateError:'rejected',
    snapshot:{
      credits:[
        {id:'CR-1',credit_id:'CR-1',monto:10,pagado:0,saldo:10,pagos:[]},
        {id:'CR-2',credit_id:'CR-2',monto:10,pagado:0,saldo:10,pagos:[]},
        {id:'CR-3',credit_id:'CR-3',monto:10,pagado:0,saldo:10,pagos:[]}
      ],
      cashState:{abierta:true,sessionId:'CASH-1'}
    }
  });
  const result=await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirmBatch({
    allocations:[
      {credit_id:'CR-1',amount_cents:1000},
      {credit_id:'CR-2',amount_cents:1000},
      {credit_id:'CR-3',amount_cents:1000}
    ],
    payment_method:'efectivo'
  });
  assert.equal(result.ok,false);
  assert.equal(result.partial,true);
  assert.equal(result.completed_count,1);
  assert.equal(result.completed_cents,1000);
  assert.equal(result.remaining_cents,2000);
  assert.equal(h.calls.filter(x=>x[0]==='createPayment').length,2,'third credit must not be touched after rejection');
  assert.ok(h.calls.some(x=>x[0]==='toast'&&/S\/ 10\.00 ya quedó CONFIRMADO/.test(x[1])&&/NO repitas/.test(x[1])));
});

test('batch resolves one lost ACK by replaying the same pending operation before continuing',async()=>{
  const h=harness({
    currentSnapshot:true,
    applyPayments:true,
    createErrorAt:1,
    pendingOnCreateError:'uncertain',
    snapshot:{
      credits:[
        {id:'CR-1',credit_id:'CR-1',monto:10,pagado:0,saldo:10,pagos:[]},
        {id:'CR-2',credit_id:'CR-2',monto:10,pagado:0,saldo:10,pagos:[]}
      ],
      cashState:{abierta:true,sessionId:'CASH-1'}
    }
  });
  const result=await h.context.NuevoAmanecerCanonicalCreditPaymentBridge.confirmBatch({
    allocations:[
      {credit_id:'CR-1',amount_cents:500},
      {credit_id:'CR-2',amount_cents:500}
    ],
    payment_method:'efectivo'
  });
  assert.equal(result.ok,true);
  assert.equal(h.calls.filter(x=>x[0]==='retryPending').length,1,'only one replay of the same operation is allowed');
  assert.equal(h.calls.filter(x=>x[0]==='createPayment').length,2,'second createPayment belongs only to the second credit');
  assert.equal(result.completed_count,2);
});
