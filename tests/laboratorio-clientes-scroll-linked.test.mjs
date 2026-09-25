import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync('laboratorio/pos-lab/js/motion/page-transitions.js', 'utf8');
const css = readFileSync('laboratorio/pos-lab/animations/transitions.css', 'utf8');
const map = readFileSync('laboratorio/pos-lab/MOTION_MAP.yaml', 'utf8');
const contract = JSON.parse(readFileSync(
  'laboratorio/pos-lab/tasks/LAB-CLIENTES-SCROLL-LINKED-CHROME-001.json',
  'utf8'
));

const controller = js.slice(
  js.indexOf('function bindClientsScrollLinkedChrome'),
  js.indexOf('motion.clientsChrome = Object.assign')
);

test('Clientes marked chrome follows one normalized progress source', () => {
  assert.match(controller, /touchStartY - event\.touches\[0\]\.clientY/);
  assert.match(controller, /applyOffset\(touchStartOffset \+ fingerDelta, 'dragging'\)/);
  assert.match(controller, /core\.setProgress\(page, collapseOffset \/ totalHeight\)/);
  assert.match(controller, /filterHeight \* visible/);
  assert.match(controller, /statsHeight \* visible/);
  assert.match(css, /--lab-client-chrome-opacity/);
});

test('touch and native scroll do not double-count the same physical gesture', () => {
  assert.match(controller, /if \(touchActive \|\| Math\.abs\(delta\) < 0\.5\) return/);
  assert.match(controller, /pendingScrollDelta \+= delta/);
  assert.match(controller, /applyOffset\(collapseOffset \+ scrollDelta, 'idle'\)/);
  assert.doesNotMatch(controller, /setTimeout\(/);
});

test('canonical abrupt chrome hide is neutralized only for Clientes LAB mobile', () => {
  assert.match(css, /@media \(max-width:700px\)/);
  assert.match(css, /body\.lab-client-scroll-linked #pageClientes\.g-page-chrome-hidden > \.page-chrome\s*\{\s*display:block !important/);
  assert.match(css, /body\.lab-client-scroll-linked\.module-mobile-scroll > \.g-topbar\.g-topbar-hidden/);
  assert.match(css, /transition:none !important/);
  assert.doesNotMatch(css, /body\.lab-client-scroll-linked #pageInventario/);
});

test('owner-marked filter and stats collapse while title and tabs are untouched', () => {
  assert.match(css, /#pageClientes \.filter-bar/);
  assert.match(css, /#pageClientes \.stats-strip/);
  const linkedBlock = css.slice(css.indexOf('/* Clientes móvil:'), css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.doesNotMatch(linkedBlock, /\.top-mod-bar/);
  assert.doesNotMatch(linkedBlock, /\.tabs-wrap/);
});

test('controller is visual-only, documented and LAB-only', () => {
  assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|saveAppState|saveAllData/);
  assert.match(map, /secondary_responsibility:\s*clientes_mobile_scroll_linked_chrome/);
  assert.equal(contract.environment, 'LABORATORIO');
  assert.equal(contract.canon_writes, false);
  assert.equal(contract.production_writes, false);
  assert.ok(contract.forbidden_files.includes('POS/**'));
});
