import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('laboratorio/pos-lab/lab-overrides.js', 'utf8');

function makeContext() {
  const document = {
    documentElement:{ classList:{remove(){}}, removeAttribute(){} },
    body:{ appendChild(){} },
    getElementById(){ return null; },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    createElement(){ return { className:'', hidden:true, innerHTML:'', dataset:{}, appendChild(){}, querySelector(){return null;} }; }
  };
  const ctx = {
    console:{info(){},warn(){},error(){}},
    setTimeout(fn){ if(typeof fn==='function') fn(); return 1; },
    clearTimeout(){},
    requestAnimationFrame(fn){ if(typeof fn==='function') fn(); return 1; },
    document,
    MutationObserver:undefined,
    clientes:[],
    creditos:[],
    diasHasta(){ return 10; },
    _naSyncCreditStatus(cr){ return cr.status || cr.estado || 'vigente'; },
    _naCreditOutstanding(cr){ return Math.max(0, Number(cr.monto||0)-Number(cr.pagado||0)); },
    _naEvaluateClientCredit(){
      return {exists:true,enabled:true,eligible:true,automaticLine:1000,assignedLine:1000,available:1000,manualActive:false,history:{debt:0,total:0,punctual:0,late:0,completed:0,partial:0,overdueActive:0,behavior:'sin_historial'}};
    },
    fmt(value){ return 'S/ '+Number(value).toFixed(2); },
    _naEsc(value){ return String(value); },
    saveAllData(){ throw new Error('visual ordering must not persist'); },
    _naWasPersisted(){ return true; }
  };
  ctx.window=ctx;
  ctx.window.__NA_LAB__=true;
  ctx.window.matchMedia=()=>({matches:false});
  vm.createContext(ctx);
  vm.runInContext(source,ctx,{filename:'lab-overrides.js'});
  return ctx;
}

function credit(id, fecha, timestamp='') {
  return {
    id,
    cliId:'A',
    clienteId:'A',
    monto:10,
    pagado:0,
    saldo:10,
    status:'vigente',
    vence:'2026-12-31',
    fecha,
    timestamp:timestamp || null,
    ventaId:'V-'+id,
    tipo:'venta_credito',
    desc:'Crédito '+id,
    pagos:[],
    items:[{nombre:'Producto '+id,cantidad:1,precioUnitario:10,subtotal:10}]
  };
}

test('category history renders newest sale date first and newest timestamp first within the same day',()=>{
  const ctx=makeContext();
  const api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const client={id:'A',nombre:'Cliente A'};
  const oldest=credit('oldest','2026-09-01','2026-09-01T09:00:00-05:00');
  const sameDayEarlier=credit('same-day-earlier','2026-10-03','2026-10-03T08:00:00-05:00');
  const newest=credit('newest','2026-10-03','2026-10-03T10:30:00-05:00');
  const middle=credit('middle','2026-09-04','2026-09-04T12:00:00-05:00');
  ctx.creditos=[oldest,sameDayEarlier,middle,newest];
  const sourceOrder=ctx.creditos.map(cr=>cr.id);

  const summary=api.categorySummary(client,api.categoriesForClient(client)[0]);

  assert.deepEqual(Array.from(summary.active,cr=>cr.id),[
    'newest',
    'same-day-earlier',
    'middle',
    'oldest'
  ]);
  assert.deepEqual(ctx.creditos.map(cr=>cr.id),sourceOrder,'visual ordering must not mutate the authoritative credit array');
});
