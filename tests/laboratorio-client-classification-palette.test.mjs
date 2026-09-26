import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync('laboratorio/pos-lab/lab-overrides.js','utf8');
const css=readFileSync('laboratorio/pos-lab/styles/pages/clientes.css','utf8');
const palette=css.slice(css.lastIndexOf('CLASSIFICATION PALETTE 005'));

test('classification palette exposes only green amber red and neutral slate states',()=>{
  assert.match(palette,/\.lab-v2-risk-green\{/);
  assert.match(palette,/\.lab-v2-risk-amber\{/);
  assert.match(palette,/\.lab-v2-risk-red\{/);
  assert.match(palette,/\.lab-v2-risk-slate\{/);
  assert.doesNotMatch(palette,/lab-v2-risk-blue|lab-v2-risk-teal|lab-v2-behavior-nav\.lab-v2-tone-blue|lab-v2-behavior-nav\.lab-v2-tone-teal/);
});

test('stable regular danger and neutral states use owner-approved semantic colors',()=>{
  assert.match(palette,/\.lab-v2-risk-green\{[\s\S]*background:#e9f8ee[\s\S]*color:#167a3e/);
  assert.match(palette,/\.lab-v2-risk-amber\{[\s\S]*background:#fff4cc[\s\S]*color:#986400/);
  assert.match(palette,/\.lab-v2-risk-red\{[\s\S]*background:#ffe7ea[\s\S]*color:#b42318/);
  assert.match(palette,/\.lab-v2-risk-slate\{[\s\S]*background:#f1f3f5[\s\S]*color:#667085/);
});

test('classification logic does not introduce a new score or mutate credit evaluation',()=>{
  const start=source.indexOf('function labClassifyClient');
  const end=source.indexOf('function labProductSummary',start);
  const block=source.slice(start,end);
  assert.match(block,/e\.eligible === false/);
  assert.match(block,/behavior === 'sin_historial'/);
  assert.match(block,/label = 'PELIGRO'; tone = 'red'/);
  assert.match(block,/label = 'ESTABLE'; tone = 'green'/);
  assert.match(block,/label = 'REGULAR'; tone = 'amber'/);
  assert.match(block,/label = 'NUEVO', tone = 'slate'/);
  assert.doesNotMatch(block,/score|saveAllData|assignedLine\s*=|automaticLine\s*=/);
});

test('behavior navigation receives an explicit classification-only hook',()=>{
  assert.match(source,/behaviorClass = title === 'COMPORTAMIENTO' \? ' lab-v2-behavior-nav' : ''/);
  assert.match(palette,/\.lab-v2-behavior-nav\.lab-v2-tone-green/);
  assert.match(palette,/\.lab-v2-behavior-nav\.lab-v2-tone-amber/);
  assert.match(palette,/\.lab-v2-behavior-nav\.lab-v2-tone-red/);
  assert.match(palette,/\.lab-v2-behavior-nav\.lab-v2-tone-slate/);
});
