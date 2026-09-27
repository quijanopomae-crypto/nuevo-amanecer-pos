import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scroll=readFileSync('POS/js/motion/scroll-motion.js','utf8');
const transitions=readFileSync('POS/css/motion/transitions.css','utf8');
const pageTransitions=readFileSync('POS/js/motion/page-transitions.js','utf8');
const bridge=readFileSync('POS/js/motion/lab-parity-bridge.js','utf8');

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

test('page entry no longer forces synchronous layout via offsetWidth',()=>{
  assert.doesNotMatch(pageTransitions,/offsetWidth/);
  assert.doesNotMatch(pageTransitions,/core\.restartClass/);
  assert.match(pageTransitions,/requestAnimationFrame/);
});

test('parity bridge waits two animation frames before page motion or scroll measurement',()=>{
  assert.match(bridge,/raf\(function \(\) \{\s*raf\(callback\);\s*\}\);/);
  assert.match(bridge,/motion\.page\.enter\(page, 'lab-enter-fade'\)/);
  assert.match(bridge,/motion\.scroll\.enablePreset\(preset\)/);
});

test('Motion remains visual-only and does not reference commerce persistence APIs',()=>{
  assert.doesNotMatch(scroll+pageTransitions+bridge,/createSale|saveAllData|canonical-sale|openCash|closeCash|createPayment|fetch\s*\(/);
});

test('lazy parity bridge is the only runtime consumer of scroll presets',()=>{
  assert.match(bridge,/motion\.scroll\.enablePreset\(preset\)/);
  assert.doesNotMatch(scroll,/Object\.keys\(motion\.scroll\.presets\)\.forEach/);
  assert.doesNotMatch(bridge,/Object\.keys\(motion\.scroll\.presets\)\.forEach/);
});
