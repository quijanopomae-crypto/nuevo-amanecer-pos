import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js=readFileSync('laboratorio/pos-lab/lab-overrides.js','utf8');
const css=readFileSync('laboratorio/pos-lab/styles/pages/clientes.css','utf8');

test('client loading state creates exactly one Nuevo Amanecer sunrise mark',()=>{
  const start=js.indexOf('function labEnsureClientLoadingUi');
  const end=js.indexOf('function labClientWorkspaceConnecting',start);
  const block=js.slice(start,end);
  assert.match(block,/loader\.id = 'naLabClientLoading'/);
  assert.match(block,/logo = document\.createElement\('span'\)/);
  assert.match(block,/logo\.textContent = '🌅'/);
  assert.equal((block.match(/logo\.textContent = '🌅'/g)||[]).length,1);
  assert.doesNotMatch(block,/icon-192\.png|document\.createElement\('img'\)/);
  assert.match(block,/title\.textContent = 'Cargando clientes…'/);
  assert.match(block,/copy\.textContent = 'Obteniendo datos, por favor espera\.'/);
});

test('loader observes the existing LAB connecting badge without changing workspace logic',()=>{
  const start=js.indexOf('function labClientWorkspaceConnecting');
  const end=js.indexOf('function labClientReducedMotion',start);
  const block=js.slice(start,end);
  assert.match(block,/getElementById\('naLabBadge'\)/);
  assert.match(block,/CONECTANDO/);
  assert.match(block,/classList\.toggle\('lab-client-loading-active', connecting\)/);
  assert.doesNotMatch(block,/fetch\(|localStorage|sessionStorage|IndexedDB|replaceChildren/);
});

test('loading state hides only cliList and keeps page chrome visible',()=>{
  const start=css.lastIndexOf('CLIENTES LOADING LOGO 001');
  const block=css.slice(start);
  assert.match(block,/#pageClientes\.lab-client-loading-active #cliList\{\s*display:none!important/);
  assert.match(block,/#pageClientes\.lab-client-loading-active \.lab-client-loading\{\s*display:flex/);
  assert.doesNotMatch(block,/\.page-chrome\s*\{[^}]*display:none/);
  assert.doesNotMatch(block,/\.stats-strip\s*\{[^}]*display:none/);
});

test('branded loader uses a single rotating ring and respects reduced motion',()=>{
  const start=css.lastIndexOf('CLIENTES LOADING LOGO 001');
  const block=css.slice(start);
  assert.match(block,/animation:lab-client-loading-spin 1\.15s linear infinite/);
  assert.match(block,/@keyframes lab-client-loading-spin/);
  assert.match(block,/@media\(prefers-reduced-motion:reduce\)[\s\S]*animation:none!important/);
  assert.match(block,/\.lab-client-loading-logo\{[\s\S]*width:64px[\s\S]*height:64px[\s\S]*background:linear-gradient\(145deg,#21d2c6/);
});
