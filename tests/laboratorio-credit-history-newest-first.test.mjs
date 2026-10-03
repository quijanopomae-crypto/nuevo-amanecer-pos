import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('laboratorio/pos-lab/lab-overrides.js', 'utf8');
const canonModule = readFileSync('POS/js/modules/client-credit-accounts-v2.js', 'utf8');
function context(){
  const document={documentElement:{classList:{remove(){}},removeAttribute(){}},body:{appendChild(){}},getElementById(){return null;},querySelector(){return null;},querySelectorAll(){return[];},createElement(){return{className:'',hidden:true,innerHTML:'',dataset:{},appendChild(){},querySelector(){return null;}};}};
  const c={console:{info(){},warn(){},error(){}},setTimeout(fn){if(typeof fn==='function')fn();return 1;},clearTimeout(){},requestAnimationFrame(fn){if(typeof fn==='function')fn();return 1;},document,MutationObserver:undefined,clientes:[],creditos:[],diasHasta(){return 10;},_naSyncCreditStatus(cr){return cr.status||'vigente';},_naCreditOutstanding(cr){return Math.max(0,Number(cr.monto||0)-Number(cr.pagado||0));},_naEvaluateClientCredit(){return{exists:true,enabled:true,eligible:true,automaticLine:1000,assignedLine:1000,available:1000,manualActive:false,history:{debt:0,total:0,punctual:0,late:0,completed:0,partial:0,overdueActive:0,behavior:'sin_historial'}};},fmt(v){return'S/ '+Number(v).toFixed(2);},_naEsc(v){return String(v);},saveAllData(){throw Error('visual ordering must not persist');},_naWasPersisted(){return true;}};
  c.window=c;c.window.__NA_LAB__=true;c.window.matchMedia=()=>({matches:false});vm.createContext(c);vm.runInContext(source,c);return c;
}
function credit(id,fecha,timestamp){return{id,cliId:'A',clienteId:'A',monto:10,pagado:0,saldo:10,status:'vigente',vence:'2026-12-31',fecha,timestamp,ventaId:'V-'+id,tipo:'venta_credito',desc:'Crédito '+id,pagos:[],items:[{nombre:'P',cantidad:1,precioUnitario:10,subtotal:10}]};}

test('latest credit sale renders first; same-day timestamp is descending; source array is untouched',()=>{
  const c=context(),api=c.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2,client={id:'A',nombre:'A'};
  c.creditos=[credit('old','2026-09-01','2026-09-01T09:00:00-05:00'),credit('today-early','2026-10-03','2026-10-03T08:00:00-05:00'),credit('mid','2026-09-04','2026-09-04T12:00:00-05:00'),credit('today-late','2026-10-03','2026-10-03T10:30:00-05:00')];
  const before=c.creditos.map(x=>x.id),summary=api.categorySummary(client,api.categoriesForClient(client)[0]);
  assert.deepEqual(Array.from(summary.active,x=>x.id),['today-late','today-early','mid','old']);
  assert.deepEqual(c.creditos.map(x=>x.id),before);
});

test('batch payment keeps oldest-first FIFO independent from visual ordering',()=>{
  const start=canonModule.indexOf('function labBatchAllocationPlan');
  const end=canonModule.indexOf('function labBatchRow',start);
  assert.ok(start>=0&&end>start,'batch allocation implementation must remain present');
  const block=canonModule.slice(start,end);
  assert.match(block,/labBatchCreditDate\(a\)\.localeCompare\(labBatchCreditDate\(b\)\)/);
});
