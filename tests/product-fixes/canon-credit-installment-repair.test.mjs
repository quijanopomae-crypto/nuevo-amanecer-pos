import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ui = readFileSync('POS/js/modules/client-credit-accounts-v2.js','utf8');

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
