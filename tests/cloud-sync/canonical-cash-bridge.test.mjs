import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('POS/js/sync/canonical-cash-bridge.js','utf8');
const index=readFileSync('POS/index.html','utf8');
const sw=readFileSync('POS/sw.js','utf8');
const cashRender=readFileSync('POS/js/legacy-inline/inline-11.js','utf8');

function element(value=''){
  const attrs=new Map();
  return {
    value,textContent:'',disabled:false,className:'',children:[],
    classList:{add(){},remove(){}},
    setAttribute(k,v){attrs.set(k,String(v));},
    removeAttribute(k){attrs.delete(k);},
    getAttribute(k){return attrs.get(k)||null;},
    append(node){this.children.push(node);},
    replaceChildren(){this.children=[];}
  };
}

function harness(canonical=true){
  const ids={
    cajFondo:element('10.50'),cajCajero:element('cashier-1'),mApertura:element(),
    mMovCaja:element(),mMovCajaHead:element(),mMovCajaTit:element(),cajMovBtn:element(),
    cajMovMonto:element('7.25'),cajMovDesc:element('Cambio sencillo'),cajMovCat:element('Otro ingreso'),
    cajMovMetodo:element('transferencia'),mCierre:element(),cajContado:element('25.30')
  };
  const calls=[];
  const originals={
    abrirModalApertura(){calls.push(['legacy-open-modal']);},
    abrirCaja(){calls.push(['legacy-open']);return 'legacy-open';},
    abrirMovCaja(type){calls.push(['legacy-move-modal',type]);},
    guardarMovCaja(){calls.push(['legacy-move']);return 'legacy-move';},
    cerrarCaja(){calls.push(['legacy-close']);return 'legacy-close';}
  };
  const api={
    enabled(){return canonical;},
    async refresh(){calls.push(['refresh']);},
    async openCash(payload){calls.push(['openCash',payload]);return {operation_id:'open-1'};},
    async closeCash(payload){calls.push(['closeCash',payload]);return {operation_id:'close-1'};},
    async createAdjustment(payload){calls.push(['adjust',payload]);return {operation_id:'adj-1'};}
  };
  const context={
    ...originals,
    NuevoAmanecerCanonical:api,
    document:{
      getElementById(id){return ids[id]||null;},
      querySelector(sel){
        if(sel==='#mApertura .mbtn-ok')return ids.mAperturaButton||(ids.mAperturaButton=element());
        if(sel==='#mCierre .mbtn-ok')return ids.mCierreButton||(ids.mCierreButton=element());
        return null;
      },
      createElement(){return element();}
    },
    crypto:{randomUUID(){return 'session-uuid-1';}},
    toast(msg,tone){calls.push(['toast',msg,tone]);},
    cerrarModal(id){calls.push(['closeModal',id]);},
    cajRender(){calls.push(['renderCash']);},
    updateDashboard(){calls.push(['dashboard']);},
    _naF10AuthorizePermission(){calls.push(['permission']);return true;},
    _naAuthorize(){calls.push(['close-authorize']);return true;},
    _naFindCashier(){return {id:'cashier-1',nombre:'Caja 1'};},
    _naF10VerifyCashierPin(){calls.push(['pin']);return true;},
    _naPopulateCashierSelect(){calls.push(['populate']);},
    _naSessionOpen(){return true;},
    appConfig:{activeCashierId:'cashier-1'},
    cajMovTipo:'ing',
    globalThis:null,
    Object,Number,String,Map,Set,Date,Math,Promise,Array,Error,JSON,console
  };
  context.globalThis=context;
  vm.runInNewContext(source,context,{filename:'canonical-cash-bridge.js'});
  return {context,calls,ids};
}

test('outside CANON the bridge delegates to original legacy handlers',async()=>{
  const h=harness(false);
  assert.equal(await h.context.abrirCaja(),'legacy-open');
  assert.equal(await h.context.guardarMovCaja(),'legacy-move');
  assert.equal(await h.context.cerrarCaja(),'legacy-close');
  h.context.abrirMovCaja('ing');
  assert.ok(h.calls.some(x=>x[0]==='legacy-move-modal'));
  assert.equal(h.ids.cajMovMetodo.disabled,false);
});

test('CANON cash.open uses exact cents and never legacy persistence',async()=>{
  const h=harness(true);
  const ok=await h.context.abrirCaja();
  assert.equal(ok,true);
  const call=h.calls.find(x=>x[0]==='openCash');
  assert.deepEqual(JSON.parse(JSON.stringify(call[1])),{session_id:'session-uuid-1',opening_cents:1050});
  assert.equal(h.calls.filter(x=>x[0]==='refresh').length,2);
  assert.ok(h.calls.some(x=>x[0]==='permission'));
  assert.ok(h.calls.some(x=>x[0]==='pin'));
});

test('CANON ingreso and egreso use signed adjustment cents and cash-only UI',async()=>{
  const incoming=harness(true);
  incoming.context.abrirMovCaja('ing');
  assert.equal(incoming.ids.cajMovMetodo.value,'efectivo');
  assert.equal(incoming.ids.cajMovMetodo.disabled,true);
  incoming.ids.cajMovMonto.value='7.25';
  incoming.ids.cajMovDesc.value='Cambio sencillo';
  incoming.context.cajMovTipo='ing';
  assert.equal(await incoming.context.guardarMovCaja(),true);
  assert.equal(incoming.calls.find(x=>x[0]==='adjust')[1].amount_cents,725);

  const outgoing=harness(true);
  outgoing.context.abrirMovCaja('egr');
  outgoing.ids.cajMovMonto.value='7.25';
  outgoing.ids.cajMovDesc.value='Retiro de prueba';
  outgoing.context.cajMovTipo='egr';
  assert.equal(await outgoing.context.guardarMovCaja(),true);
  assert.equal(outgoing.calls.find(x=>x[0]==='adjust')[1].amount_cents,-725);
});

test('CANON cobro and gasto never become generic cash adjustments',async()=>{
  for(const type of ['cob','gas']){
    const h=harness(true);
    h.context.abrirMovCaja(type);
    assert.equal(h.calls.some(x=>x[0]==='adjust'),false);
    h.context.cajMovTipo=type;
    assert.equal(await h.context.guardarMovCaja(),false);
    assert.equal(h.calls.some(x=>x[0]==='adjust'),false);
  }
});

test('CANON cash.close sends exact counted cents after authorization',async()=>{
  const h=harness(true);
  assert.equal(await h.context.cerrarCaja(),true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(x=>x[0]==='closeCash')[1])),{counted_cents:2530});
  assert.ok(h.calls.some(x=>x[0]==='close-authorize'));
  assert.equal(h.calls.filter(x=>x[0]==='refresh').length,2);
});

test('bridge source cannot write legacy storage or data APIs',()=>{
  assert.doesNotMatch(source,/saveAllData|saveAppState|localStorage|sessionStorage/);
  assert.doesNotMatch(source,/fetch\s*\(|D1|R2/);
  assert.match(source,/createAdjustment/);
  assert.match(source,/openCash/);
  assert.match(source,/closeCash/);
});

test('CANON shell loads the cash bridge late and precaches it',()=>{
  const client=index.indexOf('js/sync/canonical-client.js');
  const bridge=index.indexOf('js/sync/canonical-cash-bridge.js');
  const globals=index.indexOf('js/compat/legacy-globals.js');
  assert.ok(client>=0 && bridge>client && globals>bridge);
  assert.match(sw,/\.\/js\/sync\/canonical-cash-bridge\.js/);
});

test('cash renderer does not emit protected-module toast when canonical bridge is enabled',()=>{
  assert.match(cashRender,/NuevoAmanecerCanonical.*enabled/);
});
