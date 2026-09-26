import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('laboratorio/pos-lab/styles/pages/clientes.css','utf8');

test('client financial card uses a visible premium sky with two recognizable cloud layers',()=>{
  assert.match(css,/\.lab-v2-client-head\{[^}]*background:var\(--lab-v2-surface,#fff\)/);
  assert.match(css,/linear-gradient\(180deg,#8fe8ee 0%,#b8f2f0 38%,#d8faf6 72%,#f9ffff 100%\)/);
  assert.match(css,/radial-gradient\(ellipse 128px 58px/);
  assert.match(css,/radial-gradient\(ellipse 94px 66px/);
  assert.match(css,/radial-gradient\(ellipse 92px 40px/);
  assert.match(css,/radial-gradient\(ellipse 72px 54px/);
});

test('cloud layers move continuously at different visible speeds',()=>{
  assert.match(css,/animation:lab-v2-clouds-near 28s linear infinite/);
  assert.match(css,/animation:lab-v2-clouds-far 46s linear infinite/);
  assert.match(css,/@keyframes lab-v2-clouds-near/);
  assert.match(css,/@keyframes lab-v2-clouds-far/);
  assert.match(css,/520px 6px/);
  assert.match(css,/410px 8px/);
});

test('financial content remains above the decorative clouds',()=>{
  assert.match(css,/\.lab-v2-client-head>\*\{position:relative;z-index:2\}/);
  assert.match(css,/\.lab-v2-client-head:before,#pageClientes \.lab-v2-client-head:after\{[^}]*z-index:0/);
  assert.match(css,/overflow:hidden/);
});

test('reduced motion disables the cloud animation',()=>{
  const reduced=css.slice(css.indexOf('@media(prefers-reduced-motion:reduce)'));
  assert.match(reduced,/\.lab-v2-client-head:before,#pageClientes \.lab-v2-client-head:after\{animation:none!important;will-change:auto\}/);
});
