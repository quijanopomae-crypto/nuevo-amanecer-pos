import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const utils = read('POS/js/core/utils.js').split('\n').filter(l => /^const _na(Number|Int)=/.test(l)).join('\n');
const src = read('POS/js/legacy-inline/inline-02.js');
const helper = src.split('\n').filter(l => /^const _NA_DECIMAL_UNITS=|^function _naIsDecimalUnit\(|^function _naStockQty\(/.test(l)).join('\n');
const ctx = { _naClean: v => String(v ?? '').trim() };
vm.createContext(ctx);
vm.runInContext((utils + '\n' + helper).replace(/^const /gm, 'var '), ctx);
test('stock en unidades decimales conserva decimales', () => {
  for (const u of ['kilogramo', 'kg', 'gramo', 'litro', 'mililitro']) assert.equal(ctx._naStockQty(u, 2.5), 2.5, u);
  assert.equal(ctx._naStockQty('kilogramo', '2,75'), 2.75);
});
test('UND y demás unidades siguen enteras como hoy', () => {
  for (const u of ['unidad', 'caja', 'paquete', '', undefined]) assert.equal(ctx._naStockQty(u, 9.7), 9, String(u));
  assert.equal(ctx._naStockQty('unidad', 12), 12);
});
test('los 4 puntos que redondeaban stock usan el helper', () => {
  assert.match(src, /stock:p\.controlInventario===false\?0:_naStockQty\(p\.unidad,p\.stock\)/);
  assert.match(src, /const before=_naStockQty\(product\.unidad,product\.stock\)/);
  assert.match(src, /invEditId\?_naStockQty\(unidad,document\.getElementById\('pStock'\)\.value\)/);
  assert.match(src, /beforeStock=_naStockQty\(previous\.unidad,previous\.stock\)/);
  assert.doesNotMatch(src, /_naInt\(p\.stock\)|_naInt\(product\.stock\)|_naInt\(previous\.stock\)/);
});
