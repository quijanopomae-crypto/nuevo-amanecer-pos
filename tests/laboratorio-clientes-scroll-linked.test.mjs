import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync('laboratorio/pos-lab/js/motion/page-transitions.js', 'utf8');
const css = readFileSync('laboratorio/pos-lab/animations/transitions.css', 'utf8');
const map = readFileSync('laboratorio/pos-lab/MOTION_MAP.yaml', 'utf8');
const contract = JSON.parse(readFileSync(
  'laboratorio/pos-lab/tasks/LAB-CLIENTES-SCROLL-END-GAP-001.json',
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

test('Clientes gesture remains direct and visual writes stay coalesced to one RAF', () => {
  assert.match(controller, /queueOffset\(touchStartOffset \+ fingerDelta, 'dragging'\)/);
  assert.match(controller, /if \(renderFrame\) return/);
  assert.match(controller, /renderFrame = window\.requestAnimationFrame/);
  assert.doesNotMatch(controller, /--lab-client-filter-height|--lab-client-stats-height/);
});

test('full collapse commits real layout so the list has no phantom end gap', () => {
  assert.match(controller, /function commitCollapsedLayout\(\)/);
  assert.match(controller, /targetOffset < totalHeight - 0\.5/);
  assert.match(controller, /page\.classList\.add\('lab-client-chrome-committed'\)/);
  assert.match(linkedBlock, /#pageClientes\.lab-client-chrome-committed \.filter-bar,[\s\S]*#pageClientes\.lab-client-chrome-committed \.stats-strip[\s\S]*display:none !important/);
  assert.match(linkedBlock, /#pageClientes\.lab-client-chrome-committed \.cli-list[\s\S]*transform:none !important/);
});

test('layout commit never occurs while the finger is active', () => {
  assert.match(controller, /committedCollapsed \|\| touchActive \|\| targetOffset < totalHeight - 0\.5/);
  assert.match(controller, /if \(!touchActive && collapseOffset >= totalHeight - 0\.5\)[\s\S]*commitCollapsedLayout\(\)/);
  assert.match(controller, /if \(targetOffset >= totalHeight - 0\.5\) queueOffset\(targetOffset, 'idle'\)/);
});

test('reverse gesture uncommits from an equivalent fully-collapsed visual state', () => {
  assert.match(controller, /function uncommitCollapsedLayout\(\)/);
  assert.match(controller, /page\.classList\.remove\('lab-client-chrome-committed'\)/);
  assert.match(controller, /renderOffset\(totalHeight, 'idle'\)/);
  assert.match(controller, /if \(committedCollapsed\) uncommitCollapsedLayout\(\)/);
  assert.match(controller, /if \(committedCollapsed\)[\s\S]*if \(delta >= -0\.5\) return;[\s\S]*uncommitCollapsedLayout\(\)/);
});

test('one-frame synthetic scroll guard prevents layout shrink from reopening chrome', () => {
  assert.match(controller, /let suppressSyntheticScroll = false/);
  assert.match(controller, /function syncAfterLayoutCommit\(\)/);
  assert.match(controller, /suppressSyntheticScroll = true/);
  assert.match(controller, /lastScroll = currentScroll\(\);[\s\S]*suppressSyntheticScroll = false/);
  assert.match(controller, /if \(suppressSyntheticScroll\) return/);
});

test('reduced motion keeps direct geometry compensation instead of reintroducing blank space', () => {
  const reducedBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.doesNotMatch(reducedBlock, /\.cli-list[\s\S]*transform:none !important/);
  assert.match(reducedBlock, /opacity:1 !important/);
});

test('controller remains visual-only, documented and LAB-only', () => {
  assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|saveAppState|saveAllData/);
  assert.match(map, /render_strategy:\s*raf_coalesced_transform_clip_with_terminal_layout_commit/);
  assert.match(map, /terminal_layout_class:\s*lab-client-chrome-committed/);
  assert.equal(contract.environment, 'LABORATORIO');
  assert.equal(contract.canon_writes, false);
  assert.equal(contract.production_writes, false);
  assert.ok(contract.forbidden_files.includes('POS/**'));
});
