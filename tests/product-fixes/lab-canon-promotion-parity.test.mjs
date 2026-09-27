import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(path,'utf8');
const posIndex = read('POS/index.html');
const labIndex = read('laboratorio/pos-lab/index.html');

const sectionNames = ['menu','punto-venta','inventario','clientes','caja','ventas','gastos','configuracion'];

function srcs(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
}
function css(html) {
  return [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["'][^>]*>/gi)].map(m=>m[1]);
}

test('LAB approved page sections are the CANON shell with only explicit production chrome differences',()=>{
  for (const name of sectionNames) {
    const section=read(`laboratorio/pos-lab/sections/${name}.html`).replace(/\n$/,'');
    if (name === 'clientes') {
      const normalized=posIndex.replace('<span id="cliAuthorityBadge" hidden></span>','');
      assert.ok(normalized.includes(section),`Clientes differs beyond the allowed CANON authority badge`);
    } else {
      assert.ok(posIndex.includes(section),`${name} LAB section drifted from CANON shell`);
    }
  }
});

test('LAB and CANON execute the same shared product core; environment overlays stay isolated',()=>{
  const labScripts=srcs(labIndex);
  const canonScripts=srcs(posIndex);
  const sharedLabScripts=labScripts.filter(src=>src.startsWith('js/'));
  for (const src of sharedLabScripts) assert.ok(canonScripts.includes(src),`CANON missing shared LAB core script ${src}`);

  const allowedLabOnly=[
    '../laboratorio/pos-lab/lab-guard.js',
    '../laboratorio/pos-lab/js/motion/page-transitions.js',
    '../laboratorio/pos-lab/js/motion/cart-motion.js',
    '../laboratorio/pos-lab/js/motion/modal-motion.js',
    '../laboratorio/pos-lab/js/motion/feedback-motion.js',
    '../laboratorio/pos-lab/js/lab-workspace.js',
    '../laboratorio/pos-lab/lab-overrides.js'
  ];
  const labOnly=labScripts.filter(src=>!canonScripts.includes(src));
  assert.deepEqual(labOnly,allowedLabOnly);
  assert.doesNotMatch(posIndex,/laboratorio\/pos-lab/);
  assert.doesNotMatch(posIndex,/lab-workspace\.js|lab-overrides\.js|lab-guard\.js/);
});

test('shared base CSS remains common while LAB-only styling never becomes a production runtime dependency',()=>{
  const labCss=css(labIndex), canonCss=css(posIndex);
  for (const src of ['css/base.css','css/layout.css','css/components.css','css/responsive.css','css/print.css']) {
    assert.ok(labCss.includes(src));
    assert.ok(canonCss.includes(src));
  }
  assert.ok(labCss.some(src=>src.includes('../laboratorio/pos-lab/styles/')));
  assert.ok(canonCss.includes('css/client-credit-accounts-v2.css'));
  assert.ok(canonCss.includes('css/motion/notifications.css'));
  assert.doesNotMatch(posIndex,/\.\.\/laboratorio\/pos-lab\/styles|\.\.\/laboratorio\/pos-lab\/animations/);
});

test('approved client financial capabilities exist in CANON without importing the LAB override runtime',()=>{
  const canon=read('POS/js/modules/client-credit-accounts-v2.js');
  const required=[
    'labCategoriesForClient',
    'labInstallmentPlan',
    'labGeneralHistoryHtml',
    'naCanonOpenCanceledCredits',
    'naCanonOpenClientPaymentHistory',
    'naCanonOpenCreditLine',
    'naCanonSelectCreditDestination',
    'createCreditAccount',
    'function naRenderClientList'
  ];
  for (const marker of required) assert.ok(canon.includes(marker),`CANON client V2 missing promoted capability: ${marker}`);
  assert.doesNotMatch(canon,/\bcliRender\s*=/);
  assert.equal(existsSync('POS/js/motion/client-list-motion.js'),false);
});

test('LAB motion controllers have productive CANON counterparts rather than runtime imports',()=>{
  const pairs=[
    ['laboratorio/pos-lab/js/motion/page-transitions.js','POS/js/motion/page-transitions.js'],
    ['laboratorio/pos-lab/js/motion/cart-motion.js','POS/js/motion/cart-motion.js'],
    ['laboratorio/pos-lab/js/motion/modal-motion.js','POS/js/motion/modal-motion.js'],
    ['laboratorio/pos-lab/js/motion/feedback-motion.js','POS/js/motion/feedback-motion.js']
  ];
  for (const [lab,canon] of pairs) {
    assert.ok(existsSync(lab),`missing LAB controller ${lab}`);
    assert.ok(existsSync(canon),`missing CANON counterpart ${canon}`);
  }
});
