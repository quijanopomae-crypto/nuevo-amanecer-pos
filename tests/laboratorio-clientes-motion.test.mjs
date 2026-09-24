import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('laboratorio/pos-lab/animations/transitions.css', 'utf8');
const js = readFileSync('laboratorio/pos-lab/lab-overrides.js', 'utf8');
const contract = JSON.parse(readFileSync('laboratorio/pos-lab/tasks/LAB-CLIENTES-MICRO-MOTION-001.json', 'utf8'));

test('Clientes LAB uses a fast exit and enter microtransition', () => {
  assert.match(css, /#pageClientes\.lab-client-refresh-out/);
  assert.match(css, /#pageClientes\.lab-client-refresh-in/);
  assert.match(css, /var\(--lab-motion-fast\)/);
  assert.match(js, /setTimeout\(function \(\) \{[\s\S]*originalCliRender\.apply\(context, args\);[\s\S]*labClientEnter\(page\);[\s\S]*\}, 70\)/);
});

test('first Clientes paint is not delayed and reduced motion is respected', () => {
  const firstPaint = js.indexOf('var firstResult = originalCliRender.apply(context, args);');
  const delayedRefresh = js.indexOf('labClientMotionTimer = setTimeout');
  assert.ok(firstPaint >= 0 && delayedRefresh > firstPaint);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('Clientes micro-motion stays LAB-only', () => {
  assert.equal(contract.environment, 'LABORATORIO');
  assert.equal(contract.canon_writes, false);
  assert.ok(contract.forbidden_files.includes('POS/**'));
});
