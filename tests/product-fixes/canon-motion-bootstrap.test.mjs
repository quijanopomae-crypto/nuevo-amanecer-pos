import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scroll=readFileSync('POS/js/motion/scroll-motion.js','utf8');
const transitions=readFileSync('POS/css/motion/transitions.css','utf8');

test('mobile scroll motion exposes approved presets without eager global bootstrap',()=>{
  for(const page of ['pageClientes','pageInventario','pageVentas','pageCaja','pageGastos']){
    assert.ok(scroll.includes(`pageId:'${page}'`),`missing preset ${page}`);
  }
  assert.match(scroll,/enablePreset:\s*function \(name\)/);
  assert.doesNotMatch(scroll,/Object\.keys\(motion\.scroll\.presets\)\.forEach/);
  assert.doesNotMatch(scroll,/register\(motion\.scroll\.presets\[name\]\)/);
});

test('Caja observes its dynamic content and does not clip its chrome',()=>{
  assert.match(scroll,/caja:\s*\{\s*pageId:'pageCaja',\s*clipChrome:false/);
  assert.match(scroll,/observeSelector:'#cajContent'/);
  assert.match(scroll,/resizeObserver\.observe\(observed\)/);
});

test('linked mobile scroll neutralizes the legacy topbar/chrome hide while active',()=>{
  assert.match(transitions,/body\.na-module-scroll-linked\.module-mobile-scroll\s*>\s*\.g-topbar\.g-topbar-hidden/);
  assert.match(transitions,/transform:none!important/);
  assert.match(transitions,/\.page\.na-scroll-linked\.g-page-chrome-hidden\s*>\s*\.page-chrome/);
  assert.match(transitions,/display:block!important/);
});

test('Motion remains visual-only and does not reference commerce persistence APIs',()=>{
  assert.doesNotMatch(scroll,/createSale|saveAllData|canonical-sale|openCash|closeCash|createPayment|fetch\s*\(/);
});
