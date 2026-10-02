import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ui = readFileSync('POS/js/modules/client-credit-accounts-v2.js','utf8');
const repair = readFileSync('tools/cloudflare-prod/scripts/credit-installment-repair.mjs','utf8');
const trigger = JSON.parse(readFileSync('ops/v1.3-canon-debt-ui-repair-trigger.json','utf8'));

function extractFunction(source, name, nextName) {
  const start = source.indexOf('function ' + name);
  const end = source.indexOf('\n  function ' + nextName, start);
  assert.ok(start >= 0 && end > start, name + ' block must exist');
  return source.slice(start, end);
}

function installmentApi() {
  const sandbox = {
    labInstallmentRawPlan(cr){ return cr.installments.slice(); },
    labSplitInstallmentAmounts(total,count){
      const cents=Math.round(Number(total)*100), base=Math.floor(cents/count), rem=cents-base*count;
      return Array.from({length:count},(_,i)=>(base+(i<rem?1:0))/100);
    },
    labEffectivePayments(cr){ return (cr.pagos||[]).slice(); }
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(ui,'labInstallmentPlan','labInstallmentSummary'),sandbox);
  return sandbox.labInstallmentPlan;
}

test('imported active credits count as visible purchases',()=>{
  assert.match(ui,/var purchaseCount = active\.length;/);
});

test('reprogrammed Luis schedule subtracts historical paid baseline before counting paid installments',()=>{
  const plan=installmentApi();
  const installments=[
    ...Array.from({length:10},(_,i)=>({number:i+1,due:'2026-10-01',amount:160.83})),
    {number:11,due:'2027-02-27',amount:160.88}
  ];
  const pagos=Array.from({length:5},(_,i)=>({pagoId:'P'+(i+1),monto:160.83,timestamp:'2026-09-'+String(10+i).padStart(2,'0')+'T10:00:00'}));
  const rows=Array.from(plan({monto:2412.50,pagado:804.15,installments,pagos}));
  assert.equal(rows.filter(x=>x.paid).length,1);
  assert.equal(rows[0].paidAmount,160.83);
  assert.equal(rows[0].remaining,0);
  assert.equal(rows[1].paidAmount,0);
});

test('Cristian first scheduled installment is partial, not fully paid',()=>{
  const plan=installmentApi();
  const installments=Array.from({length:7},(_,i)=>({number:i+1,due:'2026-10-02',amount:195}));
  const pagos=[
    {monto:195},{monto:195},{monto:195},{monto:195},{monto:195},{monto:120}
  ];
  const rows=Array.from(plan({monto:2340,pagado:1095,installments,pagos}));
  assert.equal(rows.filter(x=>x.paid).length,0);
  assert.equal(rows[0].partial,true);
  assert.equal(rows[0].paidAmount,120);
  assert.equal(rows[0].remaining,75);
  assert.equal(rows[1].paidAmount,0);
});

test('partial installment has explicit visual state',()=>{
  const sandbox={labTodayIso(){return '2026-10-01';}};
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(ui,'labInstallmentVisualState','labDescriptionInstallmentHint'),sandbox);
  assert.deepEqual({...sandbox.labInstallmentVisualState({number:1,due:'2026-10-02',paid:false,partial:true},1,'2026-10-01')},{key:'partial',label:'Parcial',next:true});
});

test('repair payload preserves the global debt invariant and source arithmetic',()=>{
  const p=trigger.credit_installment_repair;
  assert.equal(p.expected_total_cents,2368495);
  assert.equal(p.expected_positive_customers,29);
  for(const target of p.targets){
    for(const doc of target.documents){
      assert.equal(doc.total_cents-doc.paid_cents,doc.current_cents);
      const schedule=doc.installments.reduce((sum,row)=>sum+row.amount_cents,0);
      const baseline=doc.total_cents-schedule;
      const schedulePaid=doc.paid_cents-baseline;
      assert.ok(schedulePaid>=0 && schedulePaid<=schedule);
    }
  }
});

test('production repair writes only credit metadata and installment rows',()=>{
  const inserts=[...repair.matchAll(/INSERT INTO\s+([a-zA-Z0-9_]+)/g)].map(m=>m[1]);
  assert.ok(inserts.length>0);
  assert.deepEqual([...new Set(inserts)].sort(),['canonical_credit_installments','canonical_credit_metadata']);
  assert.doesNotMatch(repair,/\bUPDATE\s+(?:credits|live_credits|credit_payments|canonical_financial_events|sales|cash_movements)\b/i);
  assert.doesNotMatch(repair,/\bDELETE\s+FROM\b/i);
});
