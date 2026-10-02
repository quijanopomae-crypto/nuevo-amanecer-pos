import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('POS/index.html', 'utf8');
const css = readFileSync('POS/css/canon-pos-reference-ui.css', 'utf8');
const mirroredPosCss = readFileSync('POS/css/experience-v2/pages/pos.css', 'utf8');
const labPosCss = readFileSync('laboratorio/pos-lab/styles/pages/pos.css', 'utf8');
const logic = readFileSync('POS/js/legacy-inline/inline-14.js', 'utf8');
const sw = readFileSync('POS/sw.js', 'utf8');

test('CANON POS reference UI keeps LAB visual mirror byte-exact and loads a CANON-only layer', () => {
  assert.equal(mirroredPosCss, labPosCss);
  const mirrored = html.indexOf('css/experience-v2/pages/pos.css');
  const canonOnly = html.indexOf('css/canon-pos-reference-ui.css');
  assert.ok(mirrored >= 0);
  assert.ok(canonOnly > mirrored);
  assert.match(sw, /'\.\/css\/canon-pos-reference-ui\.css'/);
  assert.doesNotMatch(html, /laboratorio\/pos-lab\/styles/i);
});

test('POS markup preserves business-critical ids while exposing the approved workbench structure', () => {
  for (const id of [
    'pagePOS','posSearch','posArea','posSidebar','cartDrawer','cartItems','posSubtotal','posIgv','posTotal',
    'btnRapido','btnPagar','cartBadge'
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /class="pos-commandbar"/);
  assert.match(html, /class="pos-module-identity"/);
  assert.match(html, /class="cart-head-title">Venta actual/);
  assert.match(html, /id="posCartSummary">0 productos/);
  assert.match(html, /id="posProductCount">0 productos/);
  assert.match(html, /id="posUnitCount">0 unidades/);
  assert.match(html, /onclick="abrirCobro\('rapido'\)"/);
  assert.match(html, /onclick="abrirCobro\('normal'\)"/);
  assert.match(html, /onclick="abrirDescuento\(\)"/);
  assert.match(html, /onclick="toggleMayorista\(\)"/);
  assert.match(html, /onclick="abrirVentaLibre\(\)"/);
});

test('desktop uses categories + catalog + persistent current sale columns', () => {
  assert.match(css, /#pagePOS>\.pos-body\{[\s\S]*grid-template-columns:220px minmax\(0,1fr\) 390px/);
  assert.match(css, /#pagePOS \.sidebar\{[\s\S]*overflow-y:auto/);
  assert.match(css, /#pagePOS \.products-area\{[\s\S]*grid-template-columns:repeat\(auto-fill,minmax\(148px,1fr\)\)/);
  assert.match(css, /#pagePOS \.cart-drawer\{[\s\S]*position:relative/);
  assert.match(css, /#pagePOS \.cart-backdrop\{display:none\}/);
  assert.match(css, /#pagePOS \.cart-secondary-actions\{/);
  assert.match(css, /#pagePOS \.total-main\{[\s\S]*background:var\(--pos-ref-teal\)/);
});

test('tablet and phone return the current sale to a real drawer without horizontal layout collapse', () => {
  assert.match(css, /@media\(max-width:979px\)\{[\s\S]*#pagePOS>\.pos-body\{display:flex\}/);
  assert.match(css, /@media\(max-width:979px\)\{[\s\S]*#pagePOS \.cart-drawer\{[\s\S]*position:absolute/);
  assert.match(css, /#pagePOS \.cart-drawer\.open\{right:0!important\}/);
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*#pagePOS \.cart-drawer\{right:-100%!important;width:100%\}/);
});

test('product and cart presentation changes do not replace the existing business handlers', () => {
  assert.match(logic, /S\/ \$\{_naNumber\(price\)\.toFixed\(2\)\} x und/);
  assert.match(logic, /const lines=cart\.length,productText=/);
  assert.match(logic, /\['posCartSummary',productText\]/);
  assert.match(logic, /\['posProductCount',productText\]/);
  assert.match(logic, /\['posUnitCount',unitText\]/);
  for (const fn of ['posAdd','posQty','posRm']) {
    assert.match(logic, new RegExp(fn + '\\('));
  }
  assert.doesNotMatch(logic, /fetch\(|\/commands\//);
});

test('CANON-only stylesheet stays scoped to pagePOS', () => {
  const ruleLines = css.split(/\r?\n/).filter(line => line.trim().startsWith('#'));
  assert.ok(ruleLines.length > 20);
  for (const line of ruleLines) assert.match(line.trim(), /^#pagePOS\b/);
});
