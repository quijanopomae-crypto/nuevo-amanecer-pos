import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('laboratorio/pos-lab/animations/transitions.css', 'utf8');
const js = readFileSync('laboratorio/pos-lab/lab-overrides.js', 'utf8');
const contract = JSON.parse(readFileSync('laboratorio/pos-lab/tasks/LAB-CLIENTES-MICRO-MOTION-001.json', 'utf8'));

test('Clientes LAB transition is about half-speed and stays visible', () => {
  assert.match(css, /opacity 520ms/);
  assert.match(css, /transform 560ms/);
  assert.match(css, /transition-duration: 360ms, 380ms/);
  assert.match(css, /opacity:\s*\.82/);
  assert.match(css, /translateY\(-6px\)/);
  assert.match(js, /\}, 340\)/);
});

test('refresh updates at the end of the same slide without opposite-direction jump', () => {
  assert.match(js, /originalCliRender\.apply\(context, args\);[\s\S]*requestAnimationFrame\(function \(\) \{[\s\S]*classList\.remove\('lab-client-refresh-out'\)/);
  const refreshSection = js.slice(js.indexOf('// Refrescos siguientes:'), js.indexOf('function clearRouteRestoreShield'));
  assert.doesNotMatch(refreshSection, /labClientEnter\(page\)/);
});

test('Clientes animation does not fully hide changing content', () => {
  const motionBlock = css.slice(css.indexOf('/* Clientes/Créditos'), css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.doesNotMatch(motionBlock, /opacity:\s*0\s*;/);
});

test('first paint remains immediate and reduced motion is respected', () => {
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
