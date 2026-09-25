import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync('laboratorio/pos-lab/js/motion/modal-motion.js', 'utf8');
const css = readFileSync('laboratorio/pos-lab/animations/modals.css', 'utf8');
const contract = JSON.parse(readFileSync(
  'laboratorio/pos-lab/tasks/LAB-WORKSPACE-SWIPE-DISMISS-001.json',
  'utf8'
));

test('workspace swipe tracks a downward finger gesture continuously', () => {
  assert.match(js, /touchstart/);
  assert.match(js, /touchmove/);
  assert.match(js, /touchend/);
  assert.match(js, /event\.preventDefault\(\)/);
  assert.match(js, /--lab-workspace-drag-y/);
  assert.match(js, /setVisualProgress\(overlay, panel, deltaY\)/);
  assert.match(css, /translate3d\(0,var\(--lab-workspace-drag-y\),0\)/);
});

test('workspace swipe fades slowly while preserving scroll and controls', () => {
  assert.match(js, /overlay\.scrollTop > 0/);
  assert.match(js, /isInteractive\(event\.target\)/);
  assert.match(js, /progress \* 0\.18/);
  assert.match(js, /progress \* 0\.88/);
  assert.match(css, /360ms cubic-bezier\(\.22,1,\.36,1\)/);
});

test('workspace only dismisses after threshold or a deliberate fast swipe', () => {
  assert.match(js, /Math\.min\(190, Math\.max\(110, panelHeight \* 0\.22\)\)/);
  assert.match(js, /distance >= 60 && velocity >= 0\.85/);
  assert.match(js, /overlay\.style\.display = 'none'/);
  assert.match(js, /settleBack\(overlay\)/);
});

test('workspace motion cleans itself and respects reduced motion', () => {
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
