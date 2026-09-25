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

test('1 sale with no explicit destination defaults to small account',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  assert.equal(api.accountMeta(credit('1')).categoryId,api.smallAccountId);
});

test('2 amount never determines category',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  assert.equal(api.accountMeta(credit('1','A',1)).categoryId,'small');
  assert.equal(api.accountMeta(credit('2','A',500)).categoryId,'small');
});

test('3 multi-product S/100 legacy sale still belongs to small account',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const cr=credit('3','A',100,0,{items:[{nombre:'A'},{nombre:'B'},{nombre:'C'}]});
  assert.equal(api.accountMeta(cr).categoryId,'small');
  assert.match(api.productSummary(cr),/\+ 2 productos/);
});

test('4 manually created client category is reusable',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const client={id:'A',nombre:'A',labCreditCategories:[{id:'tech',name:'Tecnología',mode:'separate'}]};
  const a=Array.from(api.categoriesForClient(client),x=>x.name);
  const b=Array.from(api.categoriesForClient(client),x=>x.name);
  assert.deepEqual(a,b);
  assert.deepEqual(a,['Créditos pequeños','Tecnología']);
});

test('5 sale can be associated with an existing category by metadata',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  ctx.creditos=[credit('5','A',120,0,{labCreditAccount:{categoryId:'tech',categoryName:'Tecnología',mode:'separate'}})];
  assert.equal(api.creditsForCategory('A','tech').length,1);
  assert.equal(api.creditsForCategory('A','small').length,0);
});

test('6 small credits aggregate purchases instead of product-level accounts',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const client={id:'A',nombre:'A'};
  ctx.creditos=[credit('6a','A',32),credit('6b','A',18.5),credit('6c','A',36)];
  const s=api.categorySummary(client,api.categoriesForClient(client)[0]);
  assert.equal(s.purchaseCount,3);
  assert.equal(s.activeCount,3);
  assert.equal(s.pending,86.5);
});

test('7 separate category preserves independent credits',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const client={id:'A',nombre:'A',labCreditCategories:[{id:'tech',name:'Tecnología',mode:'separate'}]};
  ctx.creditos=[
    credit('7a','A',80,0,{labCreditAccount:{categoryId:'tech',categoryName:'Tecnología',mode:'separate'}}),
    credit('7b','A',40,0,{labCreditAccount:{categoryId:'tech',categoryName:'Tecnología',mode:'separate'}})
  ];
  const s=api.categorySummary(client,api.categoriesForClient(client)[1]);
  assert.equal(s.activeCount,2);
  assert.equal(s.pending,120);
});

test('8 category pending equals sum of outstanding balances',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const client={id:'A',nombre:'A'};
  ctx.creditos=[credit('8a','A',100,35),credit('8b','A',80,20)];
  assert.equal(api.categorySummary(client,api.categoriesForClient(client)[0]).pending,125);
});

test('9 installments distinguish paid and pending',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const cr=credit('9','A',100,60,{labInstallments:[
    {number:1,due:'2026-10-01',amount:20},{number:2,due:'2026-11-01',amount:20},
    {number:3,due:'2026-12-01',amount:20},{number:4,due:'2027-01-01',amount:20},{number:5,due:'2027-02-01',amount:20}
  ]});
  const s=api.installments(cr);
  assert.equal(s.paidCount,3); assert.equal(s.pendingCount,2);
});

test('10 installment dates remain independent',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const cr=credit('10','A',90,0,{labInstallments:[
    {number:1,due:'2026-10-01',amount:30},{number:2,due:'2026-11-01',amount:30},{number:3,due:'2026-12-01',amount:30}
  ]});
  assert.deepEqual(Array.from(api.installments(cr).plan,x=>x.due),['2026-10-01','2026-11-01','2026-12-01']);
});

test('11 payment timestamp is preserved when an installment becomes paid',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const cr=credit('11','A',100,50,{labInstallments:[{number:1,due:'2026-10-01',amount:50},{number:2,due:'2026-11-01',amount:50}],pagos:[
    {pagoId:'P1',monto:50,fecha:'2026-09-25',hora:'10:42 AM',hora24:'10:42:00',timestamp:'2026-09-25T10:42:00'}
  ]});
  const first=api.installments(cr).paid[0];
  assert.equal(first.paymentId,'P1');
  assert.equal(first.paidAt,'2026-09-25T10:42:00');
});

test('12 canceled credits stay separate from active debt',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const client={id:'A',nombre:'A'};
  ctx.creditos=[credit('12a','A',100,0),credit('12b','A',50,50)];
  const s=api.summarizeClient(client);
  assert.equal(s.active.length,1); assert.equal(s.closed.length,1); assert.equal(s.debt,100);
});

test('13 classification uses objective stable regular and high-risk states',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  ctx.clientes=[{id:'A',nombre:'A'},{id:'F',nombre:'F'},{id:'G',nombre:'G'}];
  ctx.creditos.push(credit('g','G',100,0,{vence:'2026-09-20',status:'vencido'}));
  assert.equal(api.classifyClient(ctx.clientes[0]).label,'ESTABLE');
  assert.equal(api.classifyClient(ctx.clientes[1]).label,'REGULAR');
  assert.equal(api.classifyClient(ctx.clientes[2]).label,'RIESGO ALTO');
});

test('14 manual line remains intact',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const client={id:'C',nombre:'C'};
  const e=api.summarizeClient(client).evaluation;
  assert.equal(e.manualActive,true); assert.equal(e.assignedLine,900); assert.equal(e.automaticLine,650);
});

test('15 in-memory fixtures do not persist during pure summaries',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const client={id:'A',nombre:'A'}; ctx.creditos=[credit('15')];
  api.summarizeClient(client); api.categorySummary(client,api.categoriesForClient(client)[0]); api.classifyClient(client);
  assert.equal(ctx.__getSaves(),0);
});

test('16 Clientes hook changes navigation, not financial records',()=>{
  assert.match(source,/labBindClientCards/);
  assert.match(source,/head\.onclick/);
  assert.match(source,/naLabOpenClientAccount/);
});

test('17 Ventas wrapper delegates to the existing confirmarVenta',()=>{
  const block=source.slice(source.indexOf('function labInstallSaleHooks'),source.indexOf('function labAttachSaleClientListener'));
  assert.match(block,/var baseConfirm = confirmarVenta/);
  assert.match(block,/await baseConfirm\.apply/);
  assert.match(block,/labAnnotateNewCredit/);
});

test('18 Caja receives no new mutation path in LAB V2',()=>{
  const block=source.slice(source.indexOf('// ===== LAB ETAPA 02'),source.indexOf('// ===== FIN LAB ETAPA 02'));
  assert.doesNotMatch(block,/cajMovs\.push|cajEstado\s*=|_naRunCriticalOperation/);
});

test('19 mobile motion and scrolling are preserved without horizontal layouts',()=>{
  assert.match(clientCss,/overflow:auto/);
  assert.match(clientCss,/overscroll-behavior:contain/);
  assert.match(clientCss,/@media\(max-width:430px\)/);
  assert.match(clientCss,/@media\(prefers-reduced-motion:reduce\)/);
});

test('20 no horizontal overflow primitives are introduced',()=>{
  assert.match(clientCss,/min-width:0/);
  assert.match(clientCss,/overflow-wrap:anywhere/);
  assert.doesNotMatch(clientCss,/width:\s*[5-9]\d\dpx/);
});

test('installment split preserves cents exactly',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const parts=Array.from(api.splitInstallmentAmounts(100,3));
  assert.equal(parts.reduce((a,b)=>a+b,0),100);
  assert.deepEqual(parts,[33.34,33.33,33.33]);
});

test('custom accumulated category groups purchases while keeping underlying credits',()=>{
  const ctx=makeContext(), api=ctx.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2;
  const client={id:'A',nombre:'A',labCreditCategories:[{id:'mat',name:'Materiales',mode:'accumulated'}]};
  ctx.creditos=[credit('m1','A',10,0,{labCreditAccount:{categoryId:'mat',categoryName:'Materiales',mode:'accumulated'}}),credit('m2','A',20,0,{labCreditAccount:{categoryId:'mat',categoryName:'Materiales',mode:'accumulated'}})];
  const s=api.categorySummary(client,api.categoriesForClient(client)[1]);
  assert.equal(s.purchaseCount,2); assert.equal(s.pending,30); assert.equal(ctx.creditos.length,2);
});
