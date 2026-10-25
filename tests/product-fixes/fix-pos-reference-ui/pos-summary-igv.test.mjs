import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fsAll from 'node:fs';
const require_fs = () => fsAll;
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

  // El cálculo comercial sigue intacto; únicamente cambia la salida textual.
  assert.match(core, /\['posSubtotal',_naPosDisplayMoney\(parts\.subtotal\)\]/);
  assert.match(core, /\['posTotal',_naPosDisplayMoney\(parts\.totalVenta\)\]/);
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

test('TOTAL uppercase and amount share one horizontal row in PC/tablet only', () => {
  const block = css.match(/body:not\(\.na-pos-phone-device\) #pagePOS \.cart-totals>\.total-main\{([^}]+)\}/);
  assert.ok(block, 'PC/tablet total row selector exists');
  assert.match(block[1], /flex-direction:row;/);
  assert.match(block[1], /align-items:center;/);
  assert.match(block[1], /justify-content:center;/);
  assert.match(css, /#pagePOS \.cart-totals>\.total-main>span:first-child\{[^}]*text-transform:uppercase;/);
  assert.match(css, /#pagePOS \.cart-totals>\.total-main>span:last-child\{font-size:clamp\(9px,1\.3vw,19px\)/);
  assert.match(css, /--na-pos-summary-height:44px/);
  assert.match(css, /--na-pos-summary-height:36px/);
  assert.match(html, /<div class="total-main"><span>Total<\/span><span id="posTotal">/);
});

test('TOTAL y monto: mismo tamaño sin IGV; con IGV ambos más chicos (dueño 14:45) para que entre S/ 111,110.00', () => {
  const label = css.match(/body:not\(\.na-pos-phone-device\) #pagePOS \.cart-totals>\.total-main>span:first-child\{([^}]+)\}/);
  const money = css.match(/body:not\(\.na-pos-phone-device\) #pagePOS \.cart-totals>\.total-main>span:last-child\{([^}]+)\}/);
  assert.ok(label && money, 'both selectors must exist under PC/tablet only');
  const font = /font-size:(clamp\([^;]+\));/;
  assert.equal(label[1].match(font)?.[1], 'clamp(7px,.94vw,11.5px)');
  assert.equal(money[1].match(font)?.[1], 'clamp(9px,1.3vw,19px)');
  assert.match(label[1], /text-transform:uppercase/);
  // Sin IGV ambos vuelven exactamente al tamaño anterior, compartido.
  assert.match(css, /#pagePOS\.na-pos-summary-igv-hidden \.cart-totals>\.total-main>span:first-child,\s*body:not\(\.na-pos-phone-device\) #pagePOS\.na-pos-summary-igv-hidden \.cart-totals>\.total-main>span:last-child\{font-size:clamp\(11px,1\.4vw,19px\)\}/);
  assert.match(css, /--na-pos-summary-height:44px/);
  assert.match(css, /--na-pos-summary-height:36px/);
});

test('cart-only thousands formatter is deterministic and never changes raw monetary values', () => {
  const from = core.indexOf('function _naPosDisplayMoney(value)');
  const to = core.indexOf('// Seguridad: tarjetas y carrito', from);
  assert.ok(from >= 0 && to > from, 'isolated formatting utility is defined in POS renderer');
  const snippet = core.slice(from, to);
  const format = value => runInNewContext(snippet + '\n_naPosDisplayMoney(input)', {
    input: value, _naNumber: v => Number(v) || 0,
  });
  // Redondeo idéntico a fmt()/toFixed(2): venta y ticket nunca difieren en un céntimo.
  const plain = v => 'S/ ' + Number(v).toFixed(2);
  for (const v of [1.005, 2.675, 1.255, 0.015, 1234.565, 9999.995, 111110, 0.1 + 0.2, 1e6 + 0.005])
    assert.equal(format(v).replace(/,/g, ''), plain(v), 'mismo redondeo que toFixed para ' + v);
  for (const [value, expected] of [
    [0, 'S/ 0.00'], [4, 'S/ 4.00'], [1000, 'S/ 1,000.00'],
    [111110, 'S/ 111,110.00'], [11250.5, 'S/ 11,250.50'],
    [-1110.25, 'S/ -1,110.25'],
  ]) assert.equal(format(value), expected);
  assert.match(core, /\['posIgv',_naPosDisplayMoney\(parts\.totalIGV\)\]/);
  assert.match(core, /_naPosDisplayMoney\(_naNumber\(item\.precio\)\*_naNumber\(item\.qty\)\)/);
  assert.match(core, /const parts=_naTaxBreakdownForSaleItems\(cart,!!appConfig\.igvActive\)/);
  assert.doesNotMatch(core, /parseFloat\(document\.getElementById\('posTotal'\)/);
  assert.match(ticket, /function _naTkMoney\(value,showCurrency=true\)/);
});

test('cobro, vuelto y ticket usan miles con el mismo redondeo que fmt; los cálculos y los inputs no cambian', () => {
  const cobro = readFileSync('POS/js/legacy-inline/inline-02.js', 'utf8');
  const share = readFileSync('POS/js/modules/ticket/share-receipt.js', 'utf8');
  const pick = (src, re) => { const m = src.match(re); assert.ok(m, String(re)); return m[0]; };
  const cobroFn = pick(cobro, /function _naCobroMoney\(n\)\{[^\n]*\}/);
  const tkFn = pick(ticket, /function _naTkMoney\(value,showCurrency=true\)\{[^\n]*\}/);
  const shareFn = pick(share, /function money\(value\)\{[^\n]*\}/);
  const run = (fn, call, input) => runInNewContext(fn + '\n' + call, { input });
  const plain = v => 'S/ ' + Number(v).toFixed(2);
  for (const v of [0, 4.5, 1.005, 2.675, 1234.5, 1234.565, 9999.995, 111110, 1e6 + 0.005]) {
    for (const out of [run(cobroFn, '_naCobroMoney(input)', v), run(tkFn, '_naTkMoney(input)', v), run(shareFn, 'money(input)', v)])
      assert.equal(out.replace(/,/g, ''), plain(v), 'mismo céntimo que toFixed para ' + v);
  }
  assert.equal(run(cobroFn, '_naCobroMoney(input)', 1234.5), 'S/ 1,234.50');
  assert.equal(run(tkFn, '_naTkMoney(input,false)', 111110), '111,110.00');
  assert.equal(run(shareFn, 'money(input)', 1353.9), 'S/ 1,353.90');
  // Vuelto y Total del cobro se muestran con miles; los valores de input siguen numéricos (toFixed sin comas).
  assert.match(cobro, /el\.textContent=_naCobroMoney\(Math\.max\(0,change\)\)/);
  assert.match(cobro, /mCobroTotal'\)\.textContent=_naCobroMoney\(total\);received\.value=total\.toFixed\(2\)/);
  assert.match(cobro, /change=\(Math\.round\(received\*100\)-Math\.round\(total\*100\)\)\/100/);
  assert.match(cobro, /vuelto=posPayM==='efectivo'\?Math\.max\(0,Number\(\(recibido-total\)\.toFixed\(2\)\)\):0/);
});

test('ningún código del POS vuelve a leer montos mostrados (con comas) usando parseFloat/Number', () => {
  const { readdirSync, statSync } = require_fs();
  const offenders = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const p = dir + '/' + name; if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) {
    const src = readFileSync(p, 'utf8');
    if (/(parseFloat|Number|_naNumber)\([^()]{0,80}(textContent|innerText)/.test(src) ||
        /(parseFloat|Number|_naNumber)\([^()]{0,60}getElementById\('(posTotal|posSubtotal|posIgv|mCobroTotal|mCambio|mQuickPaymentTotal)'\)/.test(src)) offenders.push(p);
  } } };
  walk('POS/js');
  assert.deepEqual(offenders, []);
});
