import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index=readFileSync('POS/index.html','utf8');
const client=readFileSync('POS/js/modules/client-credit-accounts-v2.js','utf8');
const core=readFileSync('POS/js/motion/core.js','utf8');
const page=readFileSync('POS/js/motion/page-transitions.js','utf8');
const scroll=readFileSync('POS/js/motion/scroll-motion.js','utf8');
const modal=readFileSync('POS/js/motion/modal-motion.js','utf8');
const feedback=readFileSync('POS/js/motion/feedback-motion.js','utf8');
const cart=readFileSync('POS/js/motion/cart-motion.js','utf8');
const motionCss=readFileSync('POS/css/motion/motion.css','utf8');
const motionMap=readFileSync('docs/MOTION_MAP.yaml','utf8');
const repoMap=readFileSync('REPO_MAP.yaml','utf8');
const allMotionJs=[core,page,scroll,modal,feedback,cart].join('\n');

test('CANON loads motion CSS and runtime before Client Credit Accounts V2',()=>{
  const cssCore=index.indexOf('css/motion/motion.css');
  const cssClient=index.indexOf('css/client-credit-accounts-v2.css');
  const jsCore=index.indexOf('js/motion/core.js');
  const jsClient=index.indexOf('js/modules/client-credit-accounts-v2.js');
  assert.ok(cssCore>=0 && cssClient>cssCore);
  assert.ok(jsCore>=0 && jsClient>jsCore);
  for(const path of [
    'js/motion/page-transitions.js',
    'js/motion/scroll-motion.js',
    'js/motion/modal-motion.js',
    'js/motion/feedback-motion.js',
    'js/motion/cart-motion.js'
  ]) assert.ok(index.includes(path),path);
});

test('NA_MOTION exposes the approved visual-only core contract',()=>{
  assert.match(core,/root\.NA_MOTION = root\.NA_MOTION \|\| \{\}/);
  assert.match(core,/motion\.authority = 'visual-only'/);
  for(const api of [
    'clamp','reducedMotion','parseTimeMs','cssTimeMs','restartClass',
    'setState','getState','setProgress','inspect','whenTransitionEnds',
    'registerController','controller'
  ]) assert.match(core,new RegExp(api+':'));
  assert.match(core,/data.*naMotionState|dataset\.naMotionState/);
  assert.match(core,/--na-motion-progress/);
});

test('motion runtime has no storage network sync or business persistence authority',()=>{
  for(const forbidden of [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /localStorage/,
    /sessionStorage/,
    /indexedDB/i,
    /saveAllData/,
    /NuevoAmanecerCanonical/,
    /canonical-sale/i,
    /D1\b/,
    /R2\b/
  ]) assert.doesNotMatch(allMotionJs,forbidden);
});

test('motion CSS has a global reduced-motion contract',()=>{
  assert.match(motionCss,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(motionCss,/\[data-na-motion-state\]/);
  assert.match(motionCss,/animation-duration:\.01ms!important/);
  assert.match(motionCss,/transition-duration:\.01ms!important/);
});

test('Clientes V2 consumes common motion primitives with safe local fallbacks',()=>{
  assert.match(client,/function naMotionCore\(\)/);
  assert.match(client,/core\.reducedMotion\(\)/);
  assert.match(client,/core\.cssTimeMs\(element, propertyName, fallback\)/);
  assert.match(client,/core\.setState\(element, state\)/);
  assert.match(client,/core\.getState\(element\)/);
  assert.match(client,/core\.setProgress\(element, value\)/);
  assert.match(client,/if \(core && typeof core\.setState === 'function'\)/);
  assert.match(client,/if \(core && typeof core\.reducedMotion === 'function'\)/);
});

test('CANON motion map documents fail-soft visual-only authority',()=>{
  assert.match(motionMap,/namespace: window\.NA_MOTION/);
  assert.match(motionMap,/authority: visual_only/);
  assert.match(motionMap,/failure_mode: fail_soft_static_ui/);
  assert.match(motionMap,/business_authority: false/);
  assert.match(motionMap,/storage_authority: false/);
  assert.match(motionMap,/network_authority: false/);
  assert.match(motionMap,/POS_runtime_must_not_depend_on_laboratorio/);
  assert.match(repoMap,/motion:\r?\n[\s\S]*architecture_map: docs\/MOTION_MAP\.yaml/);
});

test('generic controllers remain opt-in where global behavior could change UX',()=>{
  assert.match(motionMap,/scroll:[\s\S]*default_activation: false/);
  assert.match(motionMap,/modal:[\s\S]*default_activation: false/);
  assert.doesNotMatch(scroll,/register\(motion\.scroll\.presets\./);
  assert.doesNotMatch(modal,/querySelectorAll\([^)]*modal/i);
});
