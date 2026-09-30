import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('POS/js/motion/scroll-motion.js','utf8');

function classList(initial=[]){
  const set=new Set(initial);
  return {
    add:function(){for(const name of arguments)set.add(name);},
    remove:function(){for(const name of arguments)set.delete(name);},
    toggle(name,on){if(on===undefined)on=!set.has(name);on?set.add(name):set.delete(name);return on;},
    contains:name=>set.has(name)
  };
}

function style(){
  const values=new Map();
  return {
    setProperty:(name,value)=>values.set(name,String(value)),
    removeProperty:name=>values.delete(name),
    get:name=>values.get(name)
  };
}

function harness(preset){
  const frames=[];
  const listeners=new Map();
  const filter={hidden:false,scrollHeight:100,classList:classList()};
  const stats={hidden:false,scrollHeight:100,classList:classList()};
  const chrome={};
  const page={
    id:preset==='clientes'?'pageClientes':'pageInventario',
    classList:classList(['page','active']),
    style:style(),
    dataset:{},
    querySelector(sel){return sel===':scope > .page-chrome'?chrome:null;},
    querySelectorAll(sel){
      if(sel==='.filter-bar')return [filter];
      if(sel==='.stats-strip')return [stats];
      return [];
    },
    removeAttribute(name){if(name==='data-na-scroll-clip')delete this.dataset.naScrollClip;}
  };
  const body={classList:classList(['module-mobile-scroll'])};
  const documentElement={scrollTop:0};
  const document={
    body,
    documentElement,
    getElementById(id){return id===page.id?page:null;}
  };
  const window={
    innerWidth:390,
    scrollY:0,
    NA_MOTION:{
      core:{
        clamp:(v,min,max)=>Math.min(max,Math.max(min,v)),
        reducedMotion:()=>false,
        setProgress:(el,v)=>v,
        setState(){},
        inspect:()=>({}),
        registerController(){}
      }
    },
    addEventListener(type,fn){listeners.set(type,fn);},
    requestAnimationFrame(fn){frames.push(fn);return frames.length;},
    cancelAnimationFrame(){},
    matchMedia(){return {addEventListener(){},matches:false};}
  };
  class MutationObserver{constructor(cb){this.cb=cb;}observe(){}disconnect(){}}
  vm.runInNewContext(source,{window,document,MutationObserver,Map,Array,Object,Number,String,Math});
  const controller=window.NA_MOTION.scroll.enablePreset(preset);
  function flush(){while(frames.length)frames.shift()();}
  function scrollTo(y){
    window.scrollY=y;
    listeners.get('scroll')();
    flush();
  }
  return {window,controller,scrollTo};
}

test('Clientes reveals secondary chrome slower than the document returns so client cards are not covered',()=>{
  const h=harness('clientes');
  h.scrollTo(200);
  assert.equal(h.controller.inspect().targetOffset,200,'Clientes must fully collapse after enough downward scroll');

  h.scrollTo(100);
  assert.equal(h.controller.inspect().targetOffset,150,
    'returning 100px reveals only 50px of sticky chrome, leaving 50px of net room for client cards');
});

test('the anti-cover return rate is scoped to Clientes only',()=>{
  const h=harness('inventario');
  h.scrollTo(200);
  assert.equal(h.controller.inspect().targetOffset,200);

  h.scrollTo(100);
  assert.equal(h.controller.inspect().targetOffset,100,
    'other presets keep the original 1:1 return behavior');
});

test('Motion runtime remains visual-only after the Clientes return fix',()=>{
  assert.doesNotMatch(source,/saveAllData|saveAppState|localStorage|sessionStorage|indexedDB|fetch\s*\(|createSale|createPayment/);
  assert.match(source,/revealRate:0\.5/);\n  assert.match(source,/resetAtTopPx:2/);
});


test('Clientes fully resets its chrome when the document returns to the top before a new downward gesture',()=>{
  const h=harness('clientes');
  h.scrollTo(200);
  assert.equal(h.controller.inspect().targetOffset,200);

  h.scrollTo(100);
  assert.equal(h.controller.inspect().targetOffset,150,
    'the slower reveal is preserved while still away from the top');

  h.scrollTo(0);
  assert.equal(h.controller.inspect().targetOffset,0,
    'reaching the top must fully restore the client chrome instead of leaving it half collapsed');

  h.scrollTo(100);
  assert.equal(h.controller.inspect().targetOffset,100,
    'the next downward gesture starts from a clean zero state and cannot hide halfway');
});
