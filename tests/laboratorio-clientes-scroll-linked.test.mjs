import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync('laboratorio/pos-lab/js/motion/page-transitions.js', 'utf8');
const css = readFileSync('laboratorio/pos-lab/animations/transitions.css', 'utf8');
const map = readFileSync('laboratorio/pos-lab/MOTION_MAP.yaml', 'utf8');
const contract = JSON.parse(readFileSync(
  'laboratorio/pos-lab/tasks/LAB-CLIENTES-SCROLL-SMOOTHNESS-001.json',
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
  assert.ok(controller.indexOf("document.getElementById('pageClientes')") > controller.indexOf("typeof document.getElementById !== 'function'"));
});

test('Clientes gesture remains direct but visual writes are coalesced to one RAF', () => {
  assert.match(controller, /touchStartY - event\.touches\[0\]\.clientY/);
  assert.match(controller, /queueOffset\(touchStartOffset \+ fingerDelta, 'dragging'\)/);
  assert.match(controller, /if \(renderFrame\) return/);
  assert.match(controller, /renderFrame = window\.requestAnimationFrame/);
  assert.match(controller, /renderOffset\(targetOffset, pendingState\)/);
  assert.doesNotMatch(controller, /setTimeout\(/);
});

test('scroll-linked Clientes avoids per-frame layout height mutation', () => {
  assert.doesNotMatch(controller, /--lab-client-filter-height|--lab-client-stats-height/);
  assert.doesNotMatch(linkedBlock, /height\s*:\s*var\(--lab-client-(?:filter|stats)-height/);
  assert.doesNotMatch(linkedBlock, /will-change\s*:\s*height/);
  assert.match(controller, /--lab-client-filter-hidden/);
  assert.match(controller, /--lab-client-stats-hidden/);
  assert.match(controller, /--lab-client-total-hidden/);
});

test('clip and transforms reproduce the collapsing geometry without re-layout', () => {
  assert.match(linkedBlock, /clip-path:inset\(0 0 var\(--lab-client-filter-hidden/);
  assert.match(linkedBlock, /clip-path:inset\(0 0 var\(--lab-client-stats-hidden/);
  assert.match(linkedBlock, /calc\(var\(--lab-client-chrome-shift,0px\) - var\(--lab-client-filter-hidden,0px\)\)/);
  assert.match(linkedBlock, /#pageClientes \.cli-list[\s\S]*calc\(-1 \* var\(--lab-client-total-hidden,0px\)\)/);
  assert.match(linkedBlock, /will-change:transform,opacity,clip-path/);
});

test('touch and native scroll still do not double-count one physical gesture', () => {
  assert.match(controller, /if \(touchActive \|\| Math\.abs\(delta\) < 0\.5\) return/);
  assert.match(controller, /queueOffset\(targetOffset \+ delta, 'idle'\)/);
  assert.match(controller, /touchStartOffset = targetOffset/);
});

test('canonical abrupt chrome hide is neutralized only for Clientes LAB mobile', () => {
  assert.match(css, /@media \(max-width:700px\)/);
  assert.match(css, /body\.lab-client-scroll-linked #pageClientes\.g-page-chrome-hidden > \.page-chrome\s*\{\s*display:block !important/);
  assert.match(css, /body\.lab-client-scroll-linked\.module-mobile-scroll > \.g-topbar\.g-topbar-hidden/);
  assert.doesNotMatch(css, /body\.lab-client-scroll-linked #pageInventario/);
});

test('owner-marked chrome collapses while title and tabs remain untouched', () => {
  assert.match(linkedBlock, /#pageClientes \.filter-bar/);
  assert.match(linkedBlock, /#pageClientes \.stats-strip/);
  assert.match(linkedBlock, /#pageClientes \.cli-list/);
  assert.doesNotMatch(linkedBlock, /\.top-mod-bar/);
  assert.doesNotMatch(linkedBlock, /\.tabs-wrap/);
});

test('controller remains visual-only, documented and LAB-only', () => {
  assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|saveAppState|saveAllData/);
  assert.match(map, /secondary_responsibility:\s*clientes_mobile_scroll_linked_chrome/);
  assert.match(map, /render_strategy:\s*raf_coalesced_transform_clip_no_per_frame_layout/);
  assert.equal(contract.environment, 'LABORATORIO');
  assert.equal(contract.canon_writes, false);
  assert.equal(contract.production_writes, false);
  assert.ok(contract.forbidden_files.includes('POS/**'));
});
