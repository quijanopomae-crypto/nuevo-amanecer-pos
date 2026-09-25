import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync('laboratorio/pos-lab/js/motion/modal-motion.js', 'utf8');
const css = readFileSync('laboratorio/pos-lab/animations/modals.css', 'utf8');
const contract = JSON.parse(readFileSync(
  'laboratorio/pos-lab/tasks/LAB-WORKSPACE-SWIPE-SYNC-003.json',
  'utf8'
));

test('workspace swipe tracks the finger and visual disappearance from one progress', () => {
  assert.match(js, /touchstart/);
  assert.match(js, /touchmove/);
  assert.match(js, /touchend/);
  assert.match(js, /setVisualProgress\(overlay, panel, deltaY\)/);
  assert.match(js, /distance \/ visualTravel\(panel\)/);
  assert.match(js, /progress \* 0\.94/);
  assert.match(js, /0\.62 \* \(1 - progress\)/);
  assert.match(css, /translate3d\(0,var\(--lab-workspace-drag-y\),0\)/);
  assert.match(css, /opacity:var\(--lab-workspace-panel-opacity\)/);
});

test('release continues from the exact dragged frame instead of snapping', () => {
  assert.match(js, /function beginSettle\(overlay, applyTarget\)/);
  assert.match(js, /void overlay\.offsetWidth/);
  assert.match(js, /requestAnimationFrame\(function \(\) \{\s*applyTarget\(\)/);
  assert.match(js, /beginSettle\(overlay, function \(\) \{/);
  assert.doesNotMatch(js, /function dismissOverlay[\s\S]*--lab-workspace-panel-opacity', '0\.72'/);
});

test('dismiss reaches opacity zero before display none', () => {
  const dismiss = js.slice(js.indexOf('function dismissOverlay'), js.indexOf('function bindWorkspaceSwipe'));
  const opacityZero = dismiss.indexOf("--lab-workspace-panel-opacity', '0'");
  const displayNone = dismiss.indexOf("overlay.style.display = 'none'");
  assert.ok(opacityZero >= 0);
  assert.ok(displayNone > opacityZero);
  assert.match(js, /SETTLE_MS = 560/);
  assert.match(css, /560ms cubic-bezier\(\.22,1,\.36,1\)/);
});

test('workspace swipe preserves scrolling, controls, cleanup and reduced motion', () => {
  assert.match(js, /overlay\.scrollTop > 0/);
  assert.match(js, /isInteractive\(event\.target\)/);
  assert.match(js, /clearVisualState\(overlay\)/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(js, /new MutationObserver\(findAndBindWorkspace\)/);
});

test('workspace gesture remains visual-only and LAB-only', () => {
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|\/lab\/workspace\//);
  assert.equal(contract.environment, 'LABORATORIO');
  assert.equal(contract.canon_writes, false);
  assert.equal(contract.production_writes, false);
  assert.ok(contract.forbidden_files.includes('POS/**'));
});
