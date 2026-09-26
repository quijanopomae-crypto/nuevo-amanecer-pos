import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('laboratorio/pos-lab/styles/pages/clientes.css','utf8');

test('client financial card uses a soft sky background with two cloud layers',()=>{
  assert.match(css,/\.lab-v2-client-head\{[^}]*background:var\(--lab-v2-surface,#fff\)/);
  assert.match(css,/background-image:\s*linear-gradient\(135deg,#eefcf8 0%,#e8faff 48%,#f9ffff 100%\)/);
  assert.match(css,/\.lab-v2-client-head:before,#pageClientes \.lab-v2-client-head:after\{/);
  assert.match(css,/radial-gradient\(ellipse 76px 28px/);
  assert.match(css,/radial-gradient\(ellipse 54px 20px/);
});

test('cloud layers move continuously at different speeds',()=>{
  assert.match(css,/animation:lab-v2-clouds-near 34s linear infinite/);
  assert.match(css,/animation:lab-v2-clouds-far 52s linear infinite/);
  assert.match(css,/@keyframes lab-v2-clouds-near/);
  assert.match(css,/@keyframes lab-v2-clouds-far/);
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
