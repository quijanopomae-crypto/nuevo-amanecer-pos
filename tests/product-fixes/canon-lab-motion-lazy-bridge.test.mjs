import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('POS/js/motion/lab-parity-bridge.js','utf8');

function classList(initial=[]) {
  const set=new Set(initial);
  return {
    contains:name=>set.has(name),
    add:name=>set.add(name),
    remove:name=>set.delete(name)
  };
}

function harness(width=1200, activeId='pageClientes', safe=false) {
  const frames=[];
  const pages=['pageMenu','pagePOS','pageInventario','pageClientes','pageCaja','pageVentas','pageGastos','pageConfig']
    .map(id=>({id,classList:classList(id===activeId?['page','active']:['page'])}));
  const enters=[],presets=[],events=[];
  class MutationObserver { constructor(cb){this.cb=cb;} observe(){} disconnect(){} }
  const document={
    readyState:'complete',
    querySelectorAll(s){return s==='.page'?pages:[];},
    querySelector(s){return s==='.page.active'?pages.find(p=>p.classList.contains('active'))||null:null;}
  };
  const window={
    innerWidth:width,
    NA_MOBILE_SAFE_NAV_ACTIVE:safe,
    NA_MOTION:{
      page:{enter(page,cls){enters.push([page.id,cls]);}},
      scroll:{enablePreset(name){presets.push(name);return{sync(){presets.push(name+':sync');}};}}
    },
    requestAnimationFrame(cb){frames.push(cb);},
    setTimeout(cb){frames.push(cb);},
    addEventListener(){},
    dispatchEvent(e){events.push(e.detail);}
  };
  const context={window,document,MutationObserver,WeakSet,WeakMap,Object,CustomEvent:class{constructor(t,i){this.detail=i&&i.detail;}}};
  vm.runInNewContext(source,context);
  const flush=()=>{const batch=frames.splice(0,frames.length);batch.forEach(cb=>cb());};
  return {enters,presets,events,flush};
}

test('desktop still gets deferred parity Motion',()=>{
  const h=harness(1200,'pageClientes',false);
  assert.deepEqual(h.enters,[]);
  h.flush(); h.flush();
  assert.deepEqual(h.enters,[['pageClientes','na-enter-fade']]);
  assert.deepEqual(h.presets,['clientes','clientes:sync']);
});

test('mobile safe navigation gets the same deferred entry and lazy scroll preset',()=>{
  const h=harness(390,'pageClientes',true);
  h.flush(); h.flush(); h.flush();
  assert.deepEqual(h.enters,[['pageClientes','na-enter-fade']]);
  assert.deepEqual(h.presets,['clientes','clientes:sync']);
  assert.equal(h.events.length,1);
});

test('bridge stays visual-only',()=>{
  assert.doesNotMatch(source,/saveAllData|saveAppState|fetch\s*\(|localStorage|sessionStorage|createSale|createPayment|openCash|closeCash/);
  assert.match(source,/NA_MOBILE_SAFE_NAV_ACTIVE/);
});
