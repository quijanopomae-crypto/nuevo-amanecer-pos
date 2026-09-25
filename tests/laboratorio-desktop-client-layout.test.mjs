import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = readFileSync('POS/css/base.css', 'utf8');
const layout = readFileSync('POS/css/layout.css', 'utf8');
const workspace = readFileSync('laboratorio/pos-lab/js/lab-workspace.js', 'utf8');

test('desktop client stats keep four columns while inventory keeps six', () => {
  assert.match(base, /#pageInventario \.stats-strip\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}/);
  assert.doesNotMatch(base, /@media\(min-width:1100px\)[\s\S]{0,1400}?\n\s*\.stats-strip\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}/);
});

test('desktop client cards cannot shrink into horizontal lines', () => {
  assert.match(
    layout,
    /#pageClientes \.client-card\{height:auto;max-height:none;flex:0 0 auto;min-height:64px\}/
  );
});

test('LAB activation resets overlay scroll and closes only after D1 loads', () => {
  assert.match(workspace, /overlay\.scrollTop = 0;\s*overlay\.style\.display = 'block'/);
  assert.match(workspace, /var loaded = await loadRemoteWorkspace\(\{ silent: false \}\)/);
  assert.match(workspace, /if \(loaded\) overlay\.style\.display = 'none'/);
});
