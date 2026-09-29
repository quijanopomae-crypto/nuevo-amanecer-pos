import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';

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

async function policyTab(f,options={}){
  return device(f,{
    token:options.token||'device-a-token',
    deviceId:options.deviceId||'device-a',
    localStorage:options.localStorage,
    scripts:[['canonical-customer-credit-policy-bridge.js',bridge]],
    globals:{
      cliRender(){},abrirEvaluacionCredito(){},cerrarModal(){},
      _naAudit(){},
      ...(options.globals||{})
    },
    onFetch:options.onFetch,
  });
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
  ]) assert.match(migration,new RegExp(marker.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')));
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
  assert.deepEqual(row,{mode:'MANUAL',manual_limit_cents:10000,revision:1});
});

test('CANON UI bridge owns manual/automatic policy writes and never calls legacy persistence',()=>{
  assert.match(bridge,/setCustomerCreditPolicy/);
  assert.match(bridge,/guardarLineaCreditoManual/);
  assert.match(bridge,/restaurarLineaCreditoAutomatica/);
  assert.doesNotMatch(bridge,/saveAllData\s*\(/);
  assert.match(inline04,/guardarLineaCreditoManual/);
  assert.match(index,/js\/sync\/canonical-customer-credit-policy-bridge\.js/);
  assert.match(sw,/\.\/js\/sync\/canonical-customer-credit-policy-bridge\.js/);
});
