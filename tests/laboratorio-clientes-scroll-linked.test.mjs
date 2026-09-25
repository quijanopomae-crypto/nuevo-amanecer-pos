import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync('laboratorio/pos-lab/js/motion/page-transitions.js', 'utf8');
const css = readFileSync('laboratorio/pos-lab/animations/transitions.css', 'utf8');
const map = readFileSync('laboratorio/pos-lab/MOTION_MAP.yaml', 'utf8');
const contract = JSON.parse(readFileSync(
  'laboratorio/pos-lab/tasks/LAB-SHARED-MOBILE-SCROLL-MOTION-001.json',
  'utf8'
));

const controller = js.slice(
  js.indexOf('function bindMobileScrollLinkedChrome'),
  js.indexOf('motion.moduleChrome = Object.assign')
);
const linkedBlock = css.slice(
  css.indexOf('/* Scroll móvil compartido:'),
  css.indexOf('@media (prefers-reduced-motion: reduce)')
);

test('shared controller skips incomplete non-browser DOM', () => {
  assert.match(controller, /typeof document === 'undefined'/);
  assert.match(controller, /typeof document\.getElementById !== 'function'/);
  assert.match(controller, /!document\.body/);
});

test('shared config covers Clientes, Inventario, Ventas, Caja and Gastos', () => {
  for (const pageId of ['pageClientes','pageInventario','pageVentas','pageCaja','pageGastos']) {
    assert.match(controller, new RegExp("pageId: '"+pageId+"'"));
  }
  assert.match(controller, /pageId: 'pageInventario'[\s\S]*secondarySelectors: \['\.filter-bar', '\.stats-strip'\]/);
  assert.match(controller, /pageId: 'pageVentas'[\s\S]*secondarySelectors: \['#ventasFilterBar', '#ventasReportControls', '#ventasKPI'\]/);
  assert.match(controller, /pageId: 'pageGastos'[\s\S]*secondarySelectors: \['\.stats-strip', '\.filter-bar'\]/);
});

test('Caja keeps sticky title/tabs and only targets natural summary content', () => {
  assert.match(controller, /pageId: 'pageCaja'[\s\S]*clipChrome: false/);
  assert.match(controller, /#cajContent > \.caj-banner-wrap/);
  assert.match(controller, /#cajContent > \.cj-stats-grid/);
  assert.match(controller, /#cajContent > div:first-child > \.banner-cerrada-cj/);
  assert.doesNotMatch(controller, /cajEstado|cajMovs|cajTotales|saveAllData/);
});

test('native window scroll delta remains the only gesture geometry input', () => {
  assert.match(controller, /const delta = now - lastScroll/);
  assert.match(controller, /queueOffset\(targetOffset \+ delta\)/);
  assert.doesNotMatch(controller, /touchstart|touchmove|fingerDelta|touchStartOffset/);
  assert.match(controller, /if \(Math\.abs\(delta\) < 0\.5\) return/);
});

test('each controller coalesces visual writes to one RAF', () => {
  assert.match(controller, /if \(renderFrame\) return/);
  assert.match(controller, /renderFrame = window\.requestAnimationFrame/);
  assert.match(controller, /renderOffset\(targetOffset\)/);
  assert.doesNotMatch(controller, /setTimeout\(/);
});

test('chrome clipping is opt-in and secondary elements share one visual contract', () => {
  assert.match(linkedBlock, /\[data-lab-scroll-clip="chrome"\]\.active > \.page-chrome[\s\S]*clip-path:inset\(0 0 var\(--lab-scroll-collapse-y,0px\) 0\)/);
  assert.match(linkedBlock, /\.lab-scroll-secondary[\s\S]*--lab-scroll-secondary-opacity/);
  assert.match(linkedBlock, /\.lab-scroll-secondary[\s\S]*--lab-scroll-secondary-shift/);
  assert.match(linkedBlock, /\.g-page-chrome-hidden > \.page-chrome[\s\S]*display:block !important/);
});

test('shared motion never transforms module lists, tables or root content containers', () => {
  assert.doesNotMatch(linkedBlock, /#pageClientes \.cli-list\s*\{/);
  assert.doesNotMatch(linkedBlock, /#pageInventario \.table-wrap\s*\{/);
  assert.doesNotMatch(linkedBlock, /#ventasContent\s*\{/);
  assert.doesNotMatch(linkedBlock, /#cajContent\s*\{/);
  assert.doesNotMatch(linkedBlock, /#gasContent\s*\{/);
  assert.doesNotMatch(controller, /--lab-client-total-hidden|--lab-client-filter-hidden|--lab-client-stats-hidden/);
});

test('titles and tabs are not configured as secondary collapse targets', () => {
  const configBlock = controller.slice(controller.indexOf('const configs = ['), controller.indexOf('const controllers = new Map()'));
  assert.doesNotMatch(configBlock, /top-mod-bar/);
  assert.doesNotMatch(configBlock, /tabs-wrap/);
});

test('dynamic module heights are remeasured without changing normalized progress', () => {
  assert.match(controller, /function remeasurePreservingProgress\(\)/);
  assert.match(controller, /const progress = totalHeight > 0 \? targetOffset \/ totalHeight : 0/);
  assert.match(controller, /measure\(\);[\s\S]*renderOffset\(progress \* totalHeight\)/);
  assert.match(controller, /new ResizeObserver\(remeasurePreservingProgress\)/);
});

test('controller remains visual-only and integrity skills are part of the task', () => {
  assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|saveAppState|saveAllData/);
  assert.match(map, /secondary_responsibility:\s*shared_mobile_scroll_linked_chrome/);
  assert.match(map, /supported_pages:\s*\[pageClientes, pageInventario, pageVentas, pageCaja, pageGastos\]/);
  assert.equal(contract.environment, 'LABORATORIO');
  assert.equal(contract.canon_writes, false);
  assert.equal(contract.production_writes, false);
  assert.ok(contract.required_skills.includes('inventory-integrity'));
  assert.ok(contract.required_skills.includes('cash-integrity'));
  assert.ok(contract.forbidden_files.includes('POS/**'));
});
