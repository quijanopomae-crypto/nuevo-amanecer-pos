import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('laboratorio/pos-lab/lab-overrides.js', 'utf8');
const clientCss = readFileSync('laboratorio/pos-lab/styles/pages/clientes.css', 'utf8');
const posCss = readFileSync('laboratorio/pos-lab/styles/pages/pos.css', 'utf8');

function makeContext() {
  const dueMap = new Map([
    ['2026-09-20', -5],
    ['2026-09-25', 0],
    ['2026-10-01', 6],
    ['2026-10-15', 20],
    ['2026-11-01', 37],
    ['2026-12-01', 67]
  ]);
  let saves = 0;
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
    diasHasta(value){ return dueMap.has(value) ? dueMap.get(value) : null; },
    _naSyncCreditStatus(cr){ return cr.status || cr.estado || 'vigente'; },
    _naCreditOutstanding(cr){ return Math.max(0, Number(cr.monto||0)-Number(cr.pagado||0)); },
    _naEvaluateClientCredit(clientId){
      const id=String(clientId);
      const base={exists:true,enabled:true,eligible:true,automaticLine:650,assignedLine:650,available:500,manualActive:false,history:{debt:150,total:3,punctual:0,late:0,completed:0,partial:0,overdueActive:0,behavior:'sin_historial'}};
      if(id==='A') return {...base,assignedLine:1000,available:650,history:{...base.history,punctual:8,completed:3,behavior:'puntual'}};
      if(id==='C') return {...base,manualActive:true,manualLine:900,assignedLine:900,available:600,history:{...base.history,punctual:3,completed:2,behavior:'puntual'}};
      if(id==='F') return {...base,assignedLine:500,available:200,history:{...base.history,punctual:3,late:1,completed:2,behavior:'irregular'}};
      if(id==='G') return {...base,assignedLine:300,available:0,history:{...base.history,punctual:1,late:3,overdueActive:1,behavior:'impuntual'}};
      if(id==='D') return {...base,assignedLine:0,automaticLine:0,available:0,eligible:false};
      return base;
    },
    fmt(value){ return 'S/ '+Number(value).toFixed(2); },
    _naEsc(value){ return String(value); },
    saveAllData(){ saves++; return Promise.resolve({ok:true,durable:true}); },
    _naWasPersisted(){ return true; },
    __getSaves(){ return saves; }
  };
  ctx.window=ctx;
  ctx.window.__NA_LAB__=true;
  ctx.window.matchMedia=()=>({matches:false});
  vm.createContext(ctx);
  vm.runInContext(source,ctx,{filename:'lab-overrides.js'});
  return ctx;
}

function credit(id, clientId='A', amount=100, paid=0, extra={}) {
  return {id,cliId:clientId,clienteId:clientId,monto:amount,pagado:paid,saldo:amount-paid,status:paid>=amount?'cancelado':'vigente',vence:'2026-10-15',fecha:'2026-09-25',ventaId:'V-'+id,tipo:'venta_credito',desc:'Crédito '+id,pagos:[],items:[{nombre:'Producto '+id,cantidad:1,precioUnitario:amount,subtotal:amount}],...extra};
}

test('legacy credits remain compatible and default to Créditos pequeños',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const meta=api.accountMeta(credit('L1'));
  assert.equal(meta.categoryId,'small');
  assert.equal(meta.mode,'accumulated');
  assert.equal(meta.categoryName,'Créditos pequeños');
});

test('manual line override remains owned by existing evaluation',()=>{
  const ctx=makeContext(); ctx.clientes=[{id:'C',nombre:'Cliente C'}];
  const s=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2.summarizeClient(ctx.clientes[0]);
  assert.equal(s.evaluation.manualActive,true);
  assert.equal(s.evaluation.assignedLine,900);
  assert.equal(s.evaluation.automaticLine,650);
});

test('new client UI is full-screen and old expandable financial dashboard is gone',()=>{
  assert.match(source,/lab-client-account-screen/);
  assert.match(source,/naLabOpenClientAccount/);
  assert.match(clientCss,/\.client-creds\{display:none!important\}/);
  assert.doesNotMatch(source,/PRÓXIMA ACCIÓN/);
  assert.doesNotMatch(source,/SITUACIÓN ACTUAL/);
  assert.doesNotMatch(source,/lab-fin-profile/);
});

test('main client screen contains no summary or collection-next-action block',()=>{
  const start=source.indexOf('function labHomeHtml');
  const end=source.indexOf('function labPurchaseRow',start);
  const home=source.slice(start,end);
  assert.match(home,/CUENTAS Y CRÉDITOS/);
  assert.match(home,/HISTORIAL DE PAGOS/);
  assert.match(home,/CRÉDITOS CANCELADOS/);
  assert.match(home,/LÍNEA DE CRÉDITO/);
  assert.match(home,/COMPORTAMIENTO/);
  assert.doesNotMatch(home,/RESUMEN|PRÓXIMA ACCIÓN|Cobrar/);
});

test('LAB V2 does not implement a second cash or FIFO ledger',()=>{
  const start=source.indexOf('// ===== LAB ETAPA 02');
  const end=source.indexOf('// ===== FIN LAB ETAPA 02',start);
  const block=source.slice(start,end);
  assert.doesNotMatch(block,/cajMovs\.push|_naAllocateCreditPayment\s*=|FIFO|OUTBOX/);
  assert.match(block,/abrirPago\(/);
  assert.match(block,/_naEvaluateClientCredit/);
});

test('responsive CSS provides mobile width guard and touch targets',()=>{
  assert.match(clientCss,/@media\(max-width:430px\)/);
  assert.match(clientCss,/min-height:44px/);
  assert.match(clientCss,/min-width:0/);
  assert.match(clientCss,/overflow-wrap:anywhere/);
  assert.match(posCss,/@media\(max-width:430px\)/);
});
