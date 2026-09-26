import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync('laboratorio/pos-lab/lab-overrides.js','utf8');
const template=readFileSync('laboratorio/pos-lab/index.template.html','utf8');
const menu=readFileSync('laboratorio/pos-lab/sections/menu.html','utf8');

test('top menu button is the global exit and client card re-enters through pageClientes',()=>{
  assert.match(template,/id="backBtn"\s+onclick="goMenu\(\)">← Menú<\/button>/);
  assert.match(menu,/onclick="goPage\('pageClientes'\)"/);
});

test('menu reset runs only while pageClientes is active and closes client detail state',()=>{
  const start=source.indexOf('function labResetClientNavigationForMenu');
  const end=source.indexOf('function labBindClientMenuReset',start);
  assert.notEqual(start,-1);
  const block=source.slice(start,end);
  assert.match(block,/getElementById\('pageClientes'\)/);
  assert.match(block,/!page\.classList\.contains\('active'\)/);
  assert.match(block,/labCloseScreen\(\)/);
});

test('top menu reset is bound in capture phase before inline goMenu executes',()=>{
  const start=source.indexOf('function labBindClientMenuReset');
  const end=source.indexOf('function labBackButton',start);
  assert.notEqual(start,-1);
  const block=source.slice(start,end);
  assert.match(block,/getElementById\('backBtn'\)/);
  assert.match(block,/dataset\.labClientMenuReset === 'true'/);
  assert.match(block,/addEventListener\('click',[\s\S]*labResetClientNavigationForMenu\(\);[\s\S]*}, true\)/);
});

test('internal client back navigation remains route-by-route and does not call menu reset',()=>{
  const start=source.indexOf('window.naLabClientBack = function');
  const end=source.indexOf('window.naLabOpenCreditCategory',start);
  assert.notEqual(start,-1);
  const block=source.slice(start,end);
  assert.match(block,/route === 'home'\) return labCloseScreen\(\)/);
  assert.match(block,/route === 'purchase' \|\| labClientScreenState\.route === 'credit'/);
  assert.match(block,/route === 'creditHistory'/);
  assert.match(block,/labClientScreenState\.route = 'home'/);
  assert.doesNotMatch(block,/labResetClientNavigationForMenu|goMenu\(|goPage\(/);
});

test('menu reset binding is self-healed on initial boot load and pageshow',()=>{
  const startup=source.slice(source.lastIndexOf('// Enganche inmediato'));
  assert.ok((startup.match(/labBindClientMenuReset\(\)/g)||[]).length >= 3);
});
