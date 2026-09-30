import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { deferred } from './a6-fixture.mjs';

const migration=readFileSync('infra/database/migrations/0018_canonical_customer_credit_policy.sql','utf8');
const bridge=readFileSync('POS/js/sync/canonical-customer-credit-policy-bridge.js','utf8');
const inline04=readFileSync('POS/js/legacy-inline/inline-04.js','utf8');
const index=readFileSync('POS/index.html','utf8');
const sw=readFileSync('POS/sw.js','utf8');

const MIGRATIONS=[
  '0014_canonical_live_products.sql',
  '0015_canonical_inventory_adjust.sql',
  '0016_canonical_generic_sale_lines.sql',
  '0017_canonical_live_customers.sql',
  '0018_canonical_customer_credit_policy.sql',
];

test('manual S/50000 policy succeeds under production D1 compound SELECT limit', async t => {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  const db = f.env.nuevo_amanecer_lab;
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    if ((sql.match(/UNION\s+ALL/gi) || []).length >= 5) {
      throw new Error('too many terms in compound SELECT: SQLITE_ERROR');
    }
    return prepare(sql);
  };
  const tab = await policyTab(f);
  const receipt = await tab.api.setCustomerCreditPolicy({
    customer_id: tab.api.snapshot().customers[0].customer_id,
    mode: 'MANUAL', manual_limit_cents: 5000000,
    reason: 'Ampliación autorizada por administrador', administrator_name: 'Administrador'
  });
  assert.equal(receipt.status, 'created');
  assert.equal(receipt.manual_limit_cents, 5000000);
  assert.equal(receipt.policy_revision, 1);
});

async function policyTab(f,options={}){
  const opts={
    token:options.token||'device-a-token',
    localStorage:options.localStorage,
    scripts:[['canonical-customer-credit-policy-bridge.js',bridge]],
    globals:{
      cliRender(){},abrirEvaluacionCredito(){},cerrarModal(){},
      _naAudit(){},
      ...(options.globals||{})
    },
    onFetch:options.onFetch,
  };
  if(Object.prototype.hasOwnProperty.call(options,'deviceId'))opts.deviceId=options.deviceId;
  else if(!options.localStorage)opts.deviceId='device-a';
  return device(f,opts);
}

test('0018 defines immutable journal + CAS current policy tied to customer registry',()=>{
  for(const marker of [
    'canonical_customer_credit_policy_operations',
    'canonical_customer_credit_policies',
    "command='customer.credit-policy.set'",
    'expected_policy_revision',
    'manual_limit_cents',
    'administrator_name',
    'FOREIGN KEY(promotion_id,customer_id) REFERENCES canonical_customer_registry',
    'immutable_customer_credit_policy_operation',
    'immutable_customer_credit_policy_delete'
  ]) assert.ok(migration.includes(marker),marker);
});

test('manual policy persists, survives F5/second device, then automatic restore advances revision',async t=>{
  const f=await activeCanon(t,{migrations:MIGRATIONS});
  const tab=await policyTab(f);
  const customer=tab.api.snapshot().customers[0];
  assert.ok(customer?.customer_id);

  const first=await tab.api.setCustomerCreditPolicy({
    customer_id:customer.customer_id,
    mode:'MANUAL',
    manual_limit_cents:125000,
    reason:'Excepción aprobada por historial comercial',
    administrator_id:'admin-1',
    administrator_name:'Administrador'
  });
  assert.equal(first.status,'created');
  assert.equal(first.policy_revision,1);
  await tab.api.refresh();

  const local=tab.api.legacySnapshot().customers.find(c=>String(c.id)===String(customer.customer_id));
  assert.equal(local.lineaCreditoManualActiva,true);
  assert.equal(local.lineaCreditoManual,1250);
  assert.equal(local.lineaCreditoPolicyRevision,1);

  const reloaded=await policyTab(f,{localStorage:tab.localStorage});
  assert.equal(reloaded.api.legacySnapshot().customers.find(c=>String(c.id)===String(customer.customer_id)).lineaCreditoManual,1250);

  const other=await policyTab(f,{token:'device-b-token',deviceId:'device-b'});
  const otherCustomer=other.api.legacySnapshot().customers.find(c=>String(c.id)===String(customer.customer_id));
  assert.equal(otherCustomer.lineaCreditoManual,1250);
  assert.equal(otherCustomer.lineaCreditoPolicyRevision,1);

  const restored=await other.api.setCustomerCreditPolicy({
    customer_id:customer.customer_id,
    mode:'AUTOMATIC',
    manual_limit_cents:null,
    expected_policy_revision:1,
    reason:'Restaurar cálculo automático solicitado',
    administrator_id:'admin-2',
    administrator_name:'Administrador 2'
  });
  assert.equal(restored.policy_revision,2);
  await other.api.refresh();
  const restoredCustomer=other.api.legacySnapshot().customers.find(c=>String(c.id)===String(customer.customer_id));
  assert.notEqual(restoredCustomer.lineaCreditoManualActiva,true);
  assert.equal(restoredCustomer.lineaCreditoPolicyRevision,2);
});

test('manual line can rise from S/ 500 to S/ 5000 and fall to S/ 3000; receipt updates the ficha before reconciliation',async t=>{
  const f=await activeCanon(t,{migrations:MIGRATIONS});
  let holdNextReconciliation=false,receiptSeen=false;
  let reconciliationStarted=deferred(),releaseReconciliation=deferred();
  const tab=await policyTab(f,{
    async onFetch(url,options,forward){
      if(url.endsWith('/commands/customer.credit-policy.set')){
        const response=await forward();
        if(holdNextReconciliation){holdNextReconciliation=false;receiptSeen=true;}
        return response;
      }
      if(receiptSeen&&url.endsWith('/read/canonical/status')){
        receiptSeen=false;reconciliationStarted.resolve();
        await releaseReconciliation.promise;
      }
      return null;
    }
  });
  const bridge=tab.context.NuevoAmanecerCanonicalCustomerCreditPolicyBridge;
  const id=tab.api.snapshot().customers[0].customer_id;
  const setLine=(amount,reason)=>bridge.saveManual({
    customer_id:id,manual_limit_cents:amount*100,
    reason,administrator_id:'admin-1',administrator_name:'Administrador'
  });

  assert.equal(await setLine(500,'Aprobación inicial de línea'),true);
  assert.equal(tab.api.legacySnapshot().customers.find(c=>String(c.id)===String(id)).lineaCreditoManual,500);

  holdNextReconciliation=true;
  const growing=setLine(5000,'Ampliación aprobada de línea');
  try{
    await reconciliationStarted.promise;
    const result=await Promise.race([growing.then(()=> 'confirmed'),new Promise(resolve=>setTimeout(()=>resolve('waiting'),40))]);
    assert.equal(result,'confirmed','the policy bridge returns after the durable receipt, while full reconciliation is blocked');
    const immediate=tab.api.legacySnapshot().customers.find(c=>String(c.id)===String(id));
    assert.equal(immediate.lineaCreditoManualActiva,true);
    assert.equal(immediate.lineaCreditoManual,5000);
    assert.equal(immediate.lineaCreditoPolicyRevision,2);
    assert.equal(tab.api.sourceState().validation,'receipt-patched');
  }finally{
    releaseReconciliation.resolve();
  }
  assert.equal(await growing,true);

  assert.equal(await setLine(3000,'Reducción aprobada de línea'),true);
  const local=tab.api.legacySnapshot().customers.find(c=>String(c.id)===String(id));
  assert.equal(local.lineaCreditoManual,3000);
  assert.equal(local.lineaCreditoPolicyRevision,3);
  const used=tab.api.legacySnapshot().credits.filter(c=>String(c.clienteId)===String(id)).reduce((sum,c)=>sum+c.saldo,0);
  assert.equal(Math.max(0,local.lineaCreditoManual-used),Math.max(0,3000-used),'disponible recalculates from approved line minus current use');

  const reloaded=await policyTab(f,{localStorage:tab.localStorage});
  assert.equal(reloaded.api.legacySnapshot().customers.find(c=>String(c.id)===String(id)).lineaCreditoManual,3000);
  const other=await policyTab(f,{token:'device-b-token',deviceId:'device-b'});
  assert.equal(other.api.legacySnapshot().customers.find(c=>String(c.id)===String(id)).lineaCreditoManual,3000);
});

test('a transient Worker 500 retries the same S/ 50000 policy command and clears its pending journal',async t=>{
  const f=await activeCanon(t,{migrations:MIGRATIONS});
  let failFirst=true;
  const posted=[];
  const tab=await policyTab(f,{
    async onFetch(url,options,forward){
      if(!url.endsWith('/commands/customer.credit-policy.set'))return null;
      posted.push(JSON.parse(options.body));
      if(failFirst){
        failFirst=false;
        return new Response(JSON.stringify({error:'internal_error'}),{status:500,headers:{'content-type':'application/json'}});
      }
      return null;
    }
  });
  const bridge=tab.context.NuevoAmanecerCanonicalCustomerCreditPolicyBridge;
  const id=tab.api.snapshot().customers[0].customer_id;

  assert.equal(await bridge.saveManual({
    customer_id:id,manual_limit_cents:5000000,
    reason:'GH de la nación',administrator_id:'CAJ-001',administrator_name:'Frank'
  }),true);
  assert.equal(posted.length,2);
  assert.equal(posted[0].operation_id,posted[1].operation_id);
  assert.deepEqual(posted[0],posted[1]);
  assert.equal(posted[1].manual_limit_cents,5000000);
  assert.equal(tab.api.pendingSnapshot(),null);
  const row=f.sql('SELECT mode,manual_limit_cents,revision FROM canonical_customer_credit_policies WHERE customer_id=?',id);
  assert.equal(row.mode,'MANUAL');
  assert.equal(row.manual_limit_cents,5000000);
  assert.equal(row.revision,1);
});

test('a repeated Worker 500 explains that policy outcome is unknown and retry replays the original payload',async t=>{
  const f=await activeCanon(t,{migrations:MIGRATIONS});
  let failures=2;
  const posted=[];
  const tab=await policyTab(f,{
    async onFetch(url,options){
      if(!url.endsWith('/commands/customer.credit-policy.set'))return null;
      posted.push(JSON.parse(options.body));
      if(failures>0){
        failures--;
        return new Response(JSON.stringify({error:'internal_error'}),{status:500,headers:{'content-type':'application/json'}});
      }
      return null;
    }
  });
  const bridge=tab.context.NuevoAmanecerCanonicalCustomerCreditPolicyBridge;
  const id=tab.api.snapshot().customers[0].customer_id;
  const firstInput={customer_id:id,manual_limit_cents:5000000,reason:'GH de la nación',administrator_id:'CAJ-001',administrator_name:'Frank'};

  assert.equal(await bridge.saveManual(firstInput),false);
  assert.ok(tab.api.pendingSnapshot());
  assert.match(tab.toasts.at(-1)[0],/no confirmó/i);
  assert.match(tab.toasts.at(-1)[0],/pendiente/i);
  assert.doesNotMatch(tab.toasts.at(-1)[0],/rechazó.*no se modificó/i);

  assert.equal(await bridge.saveManual({...firstInput,manual_limit_cents:9000000,reason:'Este nuevo valor espera al pendiente'}),true);
  assert.equal(posted.length,3);
  assert.equal(posted[0].operation_id,posted[1].operation_id);
  assert.equal(posted[1].operation_id,posted[2].operation_id);
  assert.deepEqual(posted[0],posted[1]);
  assert.deepEqual(posted[1],posted[2]);
  assert.equal(posted[2].manual_limit_cents,5000000);
  assert.equal(tab.api.pendingSnapshot(),null);
  const row=f.sql('SELECT mode,manual_limit_cents,revision FROM canonical_customer_credit_policies WHERE customer_id=?',id);
  assert.equal(row.mode,'MANUAL');
  assert.equal(row.manual_limit_cents,5000000);
  assert.equal(row.revision,1);
});

test('policy uses optimistic CAS so stale second writer cannot overwrite newer policy',async t=>{
  const f=await activeCanon(t,{migrations:MIGRATIONS});
  const a=await policyTab(f);
  const b=await policyTab(f,{token:'device-b-token',deviceId:'device-b'});
  const id=a.api.snapshot().customers[0].customer_id;

  await a.api.setCustomerCreditPolicy({
    customer_id:id,mode:'MANUAL',manual_limit_cents:10000,expected_policy_revision:0,
    reason:'Primera política manual válida',administrator_id:'a',administrator_name:'Admin A'
  });

  await assert.rejects(
    b.api.setCustomerCreditPolicy({
      customer_id:id,mode:'MANUAL',manual_limit_cents:20000,expected_policy_revision:0,
      reason:'Intento obsoleto desde segundo navegador',administrator_id:'b',administrator_name:'Admin B'
    }),
    /CANONICAL_FINANCIAL_REJECTED_409/
  );
  assert.equal(b.api.pendingSnapshot().last_error,'stale_policy');
  const row=f.sql('SELECT mode,manual_limit_cents,revision FROM canonical_customer_credit_policies WHERE customer_id=?',id);
  assert.equal(row.mode,'MANUAL');
  assert.equal(row.manual_limit_cents,10000);
  assert.equal(row.revision,1);
});

test('CANON UI bridge owns manual/automatic policy writes and never calls legacy persistence',()=>{
  assert.match(bridge,/setCustomerCreditPolicy/);
  assert.match(bridge,/saveManual/);
  assert.match(bridge,/restoreAutomatic/);
  assert.doesNotMatch(bridge,/saveAllData\s*\(/);
  assert.match(inline04,/NuevoAmanecerCanonicalCustomerCreditPolicyBridge/);
  assert.match(index,/js\/sync\/canonical-customer-credit-policy-bridge\.js/);
  assert.match(sw,/\.\/js\/sync\/canonical-customer-credit-policy-bridge\.js/);
});

test('CANON authority never falls back to legacy saveAllData when the credit-policy bridge is unavailable',()=>{
  const manual=inline04.slice(
    inline04.indexOf('async function guardarLineaCreditoManual'),
    inline04.indexOf('async function restaurarLineaCreditoAutomatica')
  );
  const automatic=inline04.slice(
    inline04.indexOf('async function restaurarLineaCreditoAutomatica'),
    inline04.indexOf('function _naCreditModalSummaryHtml')
  );
  assert.match(inline04,/function _naCanonicalCreditPolicyAuthority\(\)/);
  assert.match(manual,/_naCanonicalCreditPolicyAuthority\(\)/);
  assert.match(automatic,/_naCanonicalCreditPolicyAuthority\(\)/);
  assert.match(manual,/canonicalPolicyBridge\.saveManual/);
  assert.match(automatic,/canonicalPolicyBridge\.restoreAutomatic/);
  assert.doesNotMatch(manual,/canonicalPolicyBridge\.enabled/);
  assert.doesNotMatch(automatic,/canonicalPolicyBridge\.enabled/);
  assert.match(manual,/integración CANON no disponible/);
  assert.match(automatic,/integración CANON no disponible/);
});


test('lost ACK retries the same policy operation and never advances revision twice',async t=>{
  const f=await activeCanon(t,{migrations:MIGRATIONS});
  let dropAck=true;
  const tab=await policyTab(f,{
    async onFetch(url,options,forward){
      if(url.endsWith('/commands/customer.credit-policy.set')&&dropAck){
        dropAck=false;
        await forward();
        throw new TypeError('network lost after commit');
      }
      return null;
    }
  });
  const id=tab.api.snapshot().customers[0].customer_id;
  const policyBridge=tab.context.NuevoAmanecerCanonicalCustomerCreditPolicyBridge;
  assert.equal(await policyBridge.saveManual({
    customer_id:id,manual_limit_cents:10000,
    reason:'Excepción manual con ACK perdido',
    administrator_id:'admin-a',administrator_name:'Admin A'
  }),false);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_customer_credit_policy_operations').n,1);
  let current=f.sql('SELECT mode,manual_limit_cents,revision FROM canonical_customer_credit_policies WHERE customer_id=?',id);
  assert.equal(current.mode,'MANUAL');
  assert.equal(current.manual_limit_cents,10000);
  assert.equal(current.revision,1);
  const pending=tab.api.pendingSnapshot();
  assert.equal(pending.command,'customer.credit-policy.set');

  assert.equal(await policyBridge.saveManual({
    customer_id:id,manual_limit_cents:20000,
    reason:'Estos valores no deben crear otra operación',
    administrator_id:'admin-a',administrator_name:'Admin A'
  }),true);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_customer_credit_policy_operations').n,1);
  current=f.sql('SELECT mode,manual_limit_cents,revision FROM canonical_customer_credit_policies WHERE customer_id=?',id);
  assert.equal(current.manual_limit_cents,10000);
  assert.equal(current.revision,1);
  assert.equal(tab.api.pendingSnapshot(),null);
  assert.equal(tab.api.receiptSnapshot().status,'already_processed');
});

test('pre-0018 customer reads remain compatible and policy command fails closed',async t=>{
  const f=await activeCanon(t,{migrations:[
    '0014_canonical_live_products.sql',
    '0015_canonical_inventory_adjust.sql',
    '0016_canonical_generic_sale_lines.sql',
    '0017_canonical_live_customers.sql',
  ]});
  const tab=await policyTab(f);
  const id=tab.api.snapshot().customers[0].customer_id;
  assert.ok(id);
  assert.equal(tab.api.legacySnapshot().customers.some(c=>String(c.id)===String(id)),true);
  await assert.rejects(
    tab.api.setCustomerCreditPolicy({
      customer_id:id,mode:'MANUAL',manual_limit_cents:5000,expected_policy_revision:0,
      reason:'Intento antes de aplicar migración 0018',
      administrator_id:'admin-a',administrator_name:'Admin A'
    }),
    /CANONICAL_FINANCIAL_REJECTED_503/
  );
  assert.equal(tab.api.pendingSnapshot().last_error,'customer_credit_policy_schema_not_ready');
  await tab.api.refresh();
  assert.equal(tab.api.legacySnapshot().customers.some(c=>String(c.id)===String(id)),true);
});
