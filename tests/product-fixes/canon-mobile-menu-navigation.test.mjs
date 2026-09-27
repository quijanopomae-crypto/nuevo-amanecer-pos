import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('POS/js/navigation/menu-navigation.js', 'utf8');
const index = readFileSync('POS/index.html', 'utf8');
const sw = readFileSync('POS/sw.js', 'utf8');

function classList(initial=[]) {
  const set=new Set(initial);
  return {
    contains:name=>set.has(name),
    add:function(){for(const name of arguments)set.add(name);},
    remove:function(){for(const name of arguments)set.delete(name);}
  };
}

function makeCard(pageId) {
  const attrs = new Map([['onclick', `goPage('${pageId}')`]]);
  const menuMarker = {};
  return {
    attrs,
    label: { textContent: pageId },
    getAttribute(name) { return attrs.get(name) ?? null; },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    hasAttribute(name) { return attrs.has(name); },
    querySelector(selector) { return selector === '.module-label' ? this.label : null; },
    closest(selector) {
      if (selector === '.module-card') return this;
      if (selector === '#pageMenu') return menuMarker;
      return null;
    }
  };
}

function harness(width=390) {
  const cards = [
    makeCard('pagePOS'),
    makeCard('pageInventario'),
    makeCard('pageVentas'),
    makeCard('pageClientes'),
    makeCard('pageCaja'),
    makeCard('pageGastos'),
    makeCard('pageConfig')
  ];
  const listeners = new Map();
  const menuAttrs = new Map();
  const frameQueue=[];
  const idleQueue=[];
  const timerQueue=[];
  const pages=['pageMenu','pagePOS','pageInventario','pageVentas','pageClientes','pageCaja','pageGastos','pageConfig']
    .map(id=>({id,classList:classList(id==='pageMenu'?['page','active']:['page'])}));
  const back={style:{display:'none'}};
  const menu = {
    id:'pageMenu',
    classList:pages.find(p=>p.id==='pageMenu').classList,
    getAttribute(name) { return menuAttrs.get(name) ?? null; },
    setAttribute(name, value) { menuAttrs.set(name, String(value)); },
    querySelectorAll(selector) { return selector === '.module-card' ? cards : []; },
    addEventListener(type, fn) { listeners.set(type, fn); }
  };
  const byId=new Map(pages.map(p=>[p.id,p]));
  byId.set('pageMenu',menu);
  byId.set('backBtn',back);
  const calls=[];
  const renders=[];
  let clock = 100;
  const html={classList:classList()};
  const body={classList:classList()};

  const context = {
    window: null,
    document: {
      readyState: 'complete',
      documentElement: html,
      body,
      getElementById(id) { return byId.get(id)||null; },
      querySelectorAll(selector) { return selector==='.page'?pages:[]; },
      addEventListener() {}
    },
    innerWidth: width,
    performance: { now: () => clock },
    requestAnimationFrame(cb){frameQueue.push(cb);return frameQueue.length;},
    requestIdleCallback(cb){idleQueue.push(cb);return idleQueue.length;},
    setTimeout(cb){timerQueue.push(cb);return timerQueue.length;},
    scrollTo(){},
    _naSchedulePageRender(id){renders.push(id);},
    Date,Object,Array,Map,Set,console,
    goPage(id){calls.push(id);}
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'menu-navigation.js' });

  function flushFrames(){
    const batch=frameQueue.splice(0,frameQueue.length);
    batch.forEach(cb=>cb());
  }
  function flushAfterPaint(){
    flushFrames();
    flushFrames();
  }
  function flushIdle(){
    const batch=idleQueue.splice(0,idleQueue.length);
    batch.forEach(cb=>cb({didTimeout:false,timeRemaining:()=>50}));
  }

  return {
    cards,listeners,calls,renders,pages,body,html,back,context,
    flushFrames,flushAfterPaint,flushIdle,
    setClock(value){clock=value;}
  };
}

function evt(target, extra = {}) {
  return Object.assign({
    target,
    pointerType: 'touch',
    pointerId: 7,
    clientX: 100,
    clientY: 200,
    key: '',
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  }, extra);
}

test('mobile tap exposes the requested page without calling goPage', () => {
  const h=harness(390);
  const card=h.cards[3];
  h.listeners.get('pointerdown')(evt(card));
  h.listeners.get('pointerup')(evt(card));
  assert.deepEqual(h.calls,[]);
  assert.equal(h.pages.find(p=>p.id==='pageMenu').classList.contains('active'),false);
  assert.equal(h.pages.find(p=>p.id==='pageClientes').classList.contains('active'),true);
  assert.equal(h.back.style.display,'block');
  assert.equal(h.context.NA_MOBILE_SAFE_NAV_ACTIVE,true);
  assert.deepEqual(h.renders,[]);
});

test('mobile renderer is deferred until after paint and idle, while scroll mode is applied later', () => {
  const h=harness(390);
  h.context.NA_MENU_NAVIGATION.mobileSafeNavigate('pageInventario');
  assert.equal(h.body.classList.contains('module-mobile-scroll'),false);
  h.flushFrames();
  assert.equal(h.body.classList.contains('module-mobile-scroll'),false);
  h.flushFrames();
  assert.equal(h.body.classList.contains('module-mobile-scroll'),true);
  assert.deepEqual(h.renders,[]);
  h.flushIdle();
  assert.deepEqual(h.renders,['pageInventario']);
});

test('desktop keeps the existing goPage path', () => {
  const h=harness(1200);
  h.listeners.get('click')(evt(h.cards[0],{pointerType:'mouse'}));
  assert.deepEqual(h.calls,['pagePOS']);
  assert.equal(h.pages.find(p=>p.id==='pageMenu').classList.contains('active'),true);
});

test('finger scroll gesture still does not navigate', () => {
  const h=harness(390);
  const card=h.cards[1];
  h.listeners.get('pointerdown')(evt(card));
  h.listeners.get('pointerup')(evt(card,{clientY:245}));
  assert.equal(h.pages.find(p=>p.id==='pageMenu').classList.contains('active'),true);
  assert.deepEqual(h.calls,[]);
});

test('navigation layer stays free of business/storage/network authority', () => {
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sale\.create|payment\.create|cash\.open|cash\.close|credit-account\.create/i);
  assert.match(source,/mobileSafeNavigate/);
  assert.match(source,/root\._naSchedulePageRender\(pageId\)/);
});

test('CANON shell still loads and precaches menu navigation', () => {
  const nav = index.indexOf('js/navigation/menu-navigation.js');
  const motion = index.indexOf('js/motion/core.js');
  assert.ok(nav >= 0);
  assert.ok(motion > nav);
  assert.match(sw, /'\.\/js\/navigation\/menu-navigation\.js'/);
});
