import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync('POS/js/config/config-e2.js', 'utf8');
const css = readFileSync('POS/css/canon-pos-reference-ui.css', 'utf8');
const core = readFileSync('POS/js/legacy-inline/inline-14.js', 'utf8');
const ticket = readFileSync('POS/js/modules/ticket/legacy.js', 'utf8');
const html = readFileSync('POS/index.html', 'utf8');

test('IGV visual toggle moves PC/tablet summary state without recalculating sales or tickets', () => {
  const attrs = new Set();
  const row = { hidden: false };
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById(id) {
      if (id === 'posIgv') return { closest: () => row };
      if (id === 'pagePOS') return { classList: {
        toggle(name, active) { assert.equal(name, 'na-pos-summary-igv-hidden'); active ? attrs.add(name) : attrs.delete(name); }
      }};
      return null;
    }
  };
  let setting = '1';
  const window = {
    document,
    localStorage: { getItem: name => name === 'na_show_igv_line' ? setting : null },
    addEventListener() {}
  };
  runInNewContext(source, { window });
  const refresh = window.NA_CONFIG_E2.syncIgvRow;
  assert.equal(typeof refresh, 'function');

  refresh();
  assert.equal(row.hidden, false);
  assert.equal(attrs.has('na-pos-summary-igv-hidden'), false);
  setting = '0';
  refresh();
  assert.equal(row.hidden, true);
  assert.equal(attrs.has('na-pos-summary-igv-hidden'), true);
  setting = '1';
  refresh();
  assert.equal(row.hidden, false);
  assert.equal(attrs.has('na-pos-summary-igv-hidden'), false);

  // Sigue habiendo una única actualización comercial; no se cambian los importes.
  assert.match(core, /\['posSubtotal',fmt\(parts\.subtotal\)\]/);
  assert.match(core, /\['posTotal',fmt\(parts\.totalVenta\)\]/);
  assert.match(ticket, /_naTicketTaxBreakdown\(v\)/);
});

test('same-height green bar has 3 columns for IGV and 2 for counter; phone excluded', () => {
  assert.match(css, /@media\(min-width:701px\)/);
  assert.match(css, /body:not\(\.na-pos-phone-device\) #pagePOS \.cart-totals\{/);
  assert.match(css, /--na-pos-summary-height:44px/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) minmax\(0,1\.3fr\)/);
  assert.match(css, /#pagePOS\.na-pos-summary-igv-hidden \.cart-totals\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /#pagePOS\.na-pos-summary-igv-hidden \.cart-count-line\{\s*position:static/);
  assert.match(css, /#pagePOS\.na-pos-summary-igv-hidden \.cart-totals>\.total-row\{display:none!important\}/);
  assert.match(css, /#pagePOS \.cart-totals>\.total-main\{\s*grid-column:3/);
  assert.match(css, /--na-pos-summary-height:36px/);
  assert.match(html, /id="posSubtotal"/);
  assert.match(html, /id="posIgv"/);
  assert.match(html, /id="posTotal"/);
  assert.match(css, /body:not\(\.na-pos-phone-device\) #pagePOS\.na-pos-summary-igv-hidden/);
});
