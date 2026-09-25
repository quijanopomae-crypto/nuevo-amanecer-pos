import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync('laboratorio/pos-lab/js/motion/page-transitions.js', 'utf8');
const css = readFileSync('laboratorio/pos-lab/animations/transitions.css', 'utf8');
const map = readFileSync('laboratorio/pos-lab/MOTION_MAP.yaml', 'utf8');
const contract = JSON.parse(readFileSync(
  'laboratorio/pos-lab/tasks/LAB-CLIENTES-NATIVE-SCROLL-CLIP-001.json',
  'utf8'
));

const controller = js.slice(
  js.indexOf('function bindClientsScrollLinkedChrome'),
  js.indexOf('motion.clientsChrome = Object.assign')
);
const linkedBlock = css.slice(
  css.indexOf('/* Clientes móvil:'),
  css.indexOf('@media (prefers-reduced-motion: reduce)')
);

test('Clientes controller skips incomplete non-browser DOM without disabling browser logic', () => {
  assert.match(controller, /typeof document === 'undefined'/);
  assert.match(controller, /typeof document\.getElementById !== 'function'/);
  assert.match(controller, /!document\.body/);
});

test('native window scroll delta is the only collapse geometry input', () => {
  assert.match(controller, /const delta = now - lastScroll/);
  assert.match(controller, /queueOffset\(targetOffset \+ delta\)/);
  assert.doesNotMatch(controller, /touchstart|touchmove|fingerDelta|touchStartOffset/);
  assert.match(controller, /if \(Math\.abs\(delta\) < 0\.5\) return/);
});

test('visual writes are coalesced to one requestAnimationFrame', () => {
  assert.match(controller, /if \(renderFrame\) return/);
  assert.match(controller, /renderFrame = window\.requestAnimationFrame/);
  assert.match(controller, /renderOffset\(targetOffset\)/);
  assert.doesNotMatch(controller, /setTimeout\(/);
});

test('sticky page chrome is clipped by the exact collapse offset', () => {
  assert.match(controller, /--lab-client-collapse-y/);
  assert.match(linkedBlock, /#pageClientes\.active > \.page-chrome[\s\S]*clip-path:inset\(0 0 var\(--lab-client-collapse-y,0px\) 0\)/);
  assert.match(linkedBlock, /-webkit-clip-path:inset\(0 0 var\(--lab-client-collapse-y,0px\) 0\)/);
  assert.match(linkedBlock, /will-change:clip-path/);
});

test('collapse maximum is exactly filter plus stats height', () => {
  assert.match(controller, /const filterHeight = Math\.max/);
  assert.match(controller, /const statsHeight = Math\.max/);
  assert.match(controller, /totalHeight = Math\.max\(1, filterHeight \+ statsHeight\)/);
  assert.match(controller, /core\.clamp\(Number\(nextOffset\) \|\| 0, 0, totalHeight\)/);
});

test('client list stays in native document flow with no scroll-linked transform', () => {
  assert.doesNotMatch(controller, /--lab-client-total-hidden|--lab-client-filter-hidden|--lab-client-stats-hidden/);
  assert.doesNotMatch(linkedBlock, /#pageClientes \.cli-list\s*\{/);
  assert.doesNotMatch(linkedBlock, /height\s*:\s*var\(--lab-client/);
});

test('canonical abrupt chrome hide remains neutralized only for Clientes LAB mobile', () => {
  assert.match(linkedBlock, /#pageClientes\.g-page-chrome-hidden > \.page-chrome[\s\S]*display:block !important/);
  assert.match(linkedBlock, /\.g-topbar\.g-topbar-hidden[\s\S]*transform:none !important/);
  assert.doesNotMatch(linkedBlock, /#pageInventario/);
});

test('title and tabs remain outside the hideable selectors', () => {
  assert.match(linkedBlock, /#pageClientes \.filter-bar/);
  assert.match(linkedBlock, /#pageClientes \.stats-strip/);
  assert.doesNotMatch(linkedBlock, /\.top-mod-bar/);
  assert.doesNotMatch(linkedBlock, /\.tabs-wrap/);
});

test('controller remains visual-only, documented and LAB-only', () => {
  assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|saveAppState|saveAllData/);
  assert.match(map, /render_strategy:\s*native_scroll_delta_raf_sticky_clip_no_list_transform/);
  assert.match(map, /geometry_source:\s*window_scroll_delta/);
  assert.equal(contract.environment, 'LABORATORIO');
  assert.equal(contract.canon_writes, false);
  assert.equal(contract.production_writes, false);
  assert.ok(contract.forbidden_files.includes('POS/**'));
});
