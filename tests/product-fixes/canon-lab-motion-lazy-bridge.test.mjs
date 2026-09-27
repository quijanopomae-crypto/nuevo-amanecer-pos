import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('POS/js/motion/lab-parity-bridge.js','utf8');
const index = readFileSync('POS/index.html','utf8');
const sw = readFileSync('POS/sw.js','utf8');

function classList(initial=[]) {
  const set=new Set(initial);
  return {
    contains:name=>set.has(name),
    add:name=>set.add(name),
    remove:name=>set.delete(name)
  };
}

function harness(activeId='pageClientes') {
  const observerCallbacks=[];
  const pages=['pageMenu','pagePOS','pageInventario','pageClientes','pageCaja','pageVentas','pageGastos','pageConfig']
    .map(id=>({id,classList:classList(id===activeId?['page','active']:['page'])}));
  const enters=[],presets=[],events=[];

  class MutationObserver {
    constructor(cb){this.cb=cb;observerCallbacks.push(cb);}
    observe(){}
    disconnect(){}
  }

  const document={
    readyState:'complete',
    querySelectorAll(selector){return selector==='.page'?pages:[];},
    querySelector(selector){return selector==='.page.active'?pages.find(p=>p.classList.contains('active'))||null:null;}
  };

  const window={
    NA_MOTION:{
      page:{enter(page,cls){enters.push([page.id,cls]);return true;}},
      scroll:{
        enablePreset(name){
          presets.push(name);
          return {sync(){presets.push(name+':sync');}};
        }
      }
    },
    addEventListener(){},
    dispatchEvent(event){events.push(event.detail);}
  };

  const context={
    window,document,MutationObserver,
    WeakSet,WeakMap,Object,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init&&init.detail;}}
  };
  vm.runInNewContext(source,context);
  return {pages,enters,presets,events,observerCallbacks,motion:window.NA_MOTION};
}

test('lazy bridge enables only the scroll preset for the page that is active at bind time',()=>{
  const h=harness('pageClientes');
  assert.deepEqual(h.enters,[['pageClientes','lab-enter-fade']]);
  assert.deepEqual(h.presets,['clientes','clientes:sync']);
  assert.deepEqual(h.events,[{pageId:'pageClientes',preset:'clientes'}]);
});

test('a module receives its preset only when it transitions from inactive to active',()=>{
  const h=harness('pageMenu');
  assert.deepEqual(h.presets,[]);
  const inventory=h.pages.find(p=>p.id==='pageInventario');
  inventory.classList.add('active');
  const at=h.pages.indexOf(inventory);
  h.observerCallbacks[at]();
  assert.deepEqual(h.enters.slice(-1),[['pageInventario','lab-enter-fade']]);
  assert.deepEqual(h.presets,['inventario','inventario:sync']);
  h.observerCallbacks[at]();
  assert.deepEqual(h.presets,['inventario','inventario:sync'],'duplicate active mutation must not re-register');
});

test('menu, POS and config get entry motion but never a mobile scroll preset',()=>{
  for(const id of ['pageMenu','pagePOS','pageConfig']){
    const h=harness(id);
    assert.deepEqual(h.enters,[[id,'lab-enter-fade']]);
    assert.deepEqual(h.presets,[]);
  }
});

test('bridge is visual-only and does not own navigation, rendering, persistence or network',()=>{
  assert.doesNotMatch(source,/\bgoPage\s*=|\bgoMenu\s*=|\bcliRender\s*=|\bposRender\s*=/);
  assert.doesNotMatch(source,/saveAllData|saveAppState|fetch\s*\(|localStorage|sessionStorage|createSale|createPayment|openCash|closeCash/);
});

test('CANON shell loads and precaches lazy parity bridge after the motion primitives',()=>{
  const scroll=index.indexOf('js/motion/scroll-motion.js');
  const bridge=index.indexOf('js/motion/lab-parity-bridge.js');
  assert.ok(scroll>=0 && bridge>scroll);
  assert.match(sw,/\.\/js\/motion\/lab-parity-bridge\.js/);
});
