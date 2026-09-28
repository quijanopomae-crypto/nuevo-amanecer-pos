import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('POS/js/motion/page-transitions.js','utf8');

function harness(){
  const raf=[];
  const deliveries=[];
  const page={observers:[]};
  const classes=new Set(['page']);
  const classList={
    contains(name){return classes.has(name);},
    add(name){if(classes.has(name))return;const oldValue=Array.from(classes).join(' ');classes.add(name);notify(oldValue);},
    remove(name){if(!classes.has(name))return;const oldValue=Array.from(classes).join(' ');classes.delete(name);notify(oldValue);}
  };
  page.classList=classList;

  function notify(oldValue){
    for(const observer of page.observers) deliveries.push({observer,record:{type:'attributes',attributeName:'class',oldValue,target:page}});
  }

  class FakeMutationObserver{
    constructor(callback){this.callback=callback;}
    observe(target){target.observers.push(this);}
    disconnect(){}
  }

  const root={
    NA_MOTION:{core:{reducedMotion(){return false;},registerController(){}}},
    requestAnimationFrame(callback){raf.push(callback);return raf.length;},
    setTimeout(callback){callback();return 1;},
    clearTimeout(){},
    matchMedia(){return {matches:false};}
  };
  const document={getElementById(id){return id==='pageClientes'?page:null;}};
  vm.runInNewContext(source,{window:root,document,MutationObserver:FakeMutationObserver,Map,WeakMap});

  function flushObservers(){
    let rounds=0;
    while(deliveries.length&&rounds++<100){
      const batch=deliveries.splice(0,deliveries.length);
      const grouped=new Map();
      for(const item of batch){
        if(!grouped.has(item.observer))grouped.set(item.observer,[]);
        grouped.get(item.observer).push(item.record);
      }
      for(const [observer,records] of grouped)observer.callback(records);
    }
    assert.ok(rounds<100,'observer delivery itself did not settle');
  }

  return {root,page,classList,raf,flushObservers};
}

test('activating Clientes runs one enter animation and does not create a MutationObserver/rAF loop',()=>{
  const h=harness();
  h.root.NA_MOTION.page.bind('pageClientes',{enterClass:'na-enter-fade'});
  h.classList.add('active');
  h.flushObservers();
  assert.equal(h.raf.length,1,'activation should schedule one animation frame');

  h.raf.shift()();
  h.flushObservers();

  assert.equal(h.raf.length,0,'animation class mutations must not schedule another enter frame');
  assert.equal(h.classList.contains('na-enter-fade'),true,'the enter class should remain applied');
});
