import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css=readFileSync('laboratorio/pos-lab/styles/pages/clientes.css','utf8');

test('reference match keeps mobile hero in two columns with vertical debt divider',()=>{
  assert.match(css,/REFERENCE MATCH 004/);
  assert.match(css,/@media\(max-width:430px\)[\s\S]*grid-template-columns:minmax\(0,1\.08fr\) minmax\(0,\.92fr\)/);
  assert.match(css,/\.lab-v2-head-money\{[\s\S]*border-left:1px solid rgba\(15,118,110,\.24\)/);
  assert.match(css,/border-top:0/);
});

test('client name has stronger display contrast without external fonts',()=>{
  const start=css.lastIndexOf('#pageClientes .lab-v2-client-head h2{');
  assert.notEqual(start,-1);
  const block=css.slice(start,css.indexOf('}',start)+1);
  assert.match(block,/font-family:Impact,"Arial Black","Noto Sans",system-ui,sans-serif/);
  assert.match(block,/color:#080c16/);
  assert.match(block,/-webkit-text-stroke:\.55px #080c16/);
  assert.match(block,/transform:scaleX\(1\.1\)/);
  assert.doesNotMatch(block,/url\(|@import|https?:\/\//);
});

test('visual order places DNI before behavior badge without changing DOM',()=>{
  assert.match(css,/\.lab-v2-client-identity\{[\s\S]*grid-template-rows:auto auto auto auto/);
  assert.match(css,/\.lab-v2-name-line\{\s*display:contents/);
  assert.match(css,/\.lab-v2-client-head p\{[\s\S]*grid-row:3/);
  assert.match(css,/\.lab-v2-client-head \.lab-v2-risk\{[\s\S]*grid-row:4/);
});

test('navigation cards have stronger hierarchy without fixed-width overflow traps',()=>{
  assert.match(css,/\.lab-v2-row\{[\s\S]*min-height:74px[\s\S]*border-radius:18px/);
  assert.match(css,/\.lab-v2-module-icon,[\s\S]*width:46px/);
  assert.doesNotMatch(css.slice(css.lastIndexOf('REFERENCE MATCH 004')),/min-width:\s*[1-9]\d{2,}px/);
});
