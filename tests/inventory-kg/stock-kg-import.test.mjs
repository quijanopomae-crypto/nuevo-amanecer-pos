import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const utils = read('POS/js/core/utils.js').split('\n').filter(l => /^const _na(Number|Int)=/.test(l)).join('\n');
const helper = read('POS/js/legacy-inline/inline-02.js').split('\n').filter(l => /^const _NA_DECIMAL_UNITS=|^function _naIsDecimalUnit\(|^function _naStockQty\(/.test(l)).join('\n');
const src3 = read('POS/js/legacy-inline/inline-03.js');
const importStmt = /if\(!blank\(get\('stock'\)\)\)data\.stock=[^;]*;/.exec(src3)[0];
const updateExpr = /beforeStock=(_naStockQty\(previous\.unidad,previous\.stock\)),targetStock=(_naTracksStock\(next\)\?_naStockQty\(next\.unidad,next\.stock\):0)/.exec(src3);
const deltaExpr = /delta=(_naIsDecimalUnit\(next\.unidad\)\?Math\.round\(\(targetStock-beforeStock\)\*1e6\)\/1e6:targetStock-beforeStock);/.exec(src3);
const createExpr = /const targetStock=(_naTracksStock\(action\.product\)\?_naStockQty\(action\.product\.unidad,action\.product\.stock\):0)/.exec(src3);
function ctx(extra) {
  const c = { _naClean: v => String(v ?? '').trim(), _naTracksStock: p => p?.controlInventario !== false, ...extra };
  vm.createContext(c); vm.runInContext((utils + '\n' + helper).replace(/^const /gm, 'var '), c); return c;
}
function importStock(unidad, raw, existing = null, unitCell = unidad) {
  const cells = { stock: raw, unit: unitCell };
  const c = ctx({ data: { unidad }, existing, controlInventario: true, blank: v => v === '' || v == null, get: k => cells[k] });
  vm.runInContext(importStmt, c); return c.data.stock;
}
test('import: kg conserva decimales, UND entero', () => {
  assert.ok(updateExpr && createExpr, 'expresiones de inline-03 encontradas');
  assert.equal(importStock('kilogramo', '2.5'), 2.5);
  assert.equal(importStock('mililitro', '2,25'), 2.25);
  assert.equal(importStock('unidad', '9.7'), 9);
  assert.equal(importStock('unidad', '-3'), 0);
});
test('import actualización (antes/objetivo): kg decimales, UND entero', () => {
  const run = (prev, next) => { const c = ctx({ previous: prev, next }); return [vm.runInContext(updateExpr[1], c), vm.runInContext(updateExpr[2], c)]; };
  assert.deepEqual(run({ unidad: 'kg', stock: 1.25 }, { unidad: 'kg', stock: 2.5 }), [1.25, 2.5]);
  assert.deepEqual(run({ unidad: 'unidad', stock: 4.9 }, { unidad: 'unidad', stock: 7.6 }), [4, 7]);
  assert.equal(run({ unidad: 'gramo', stock: 1 }, { unidad: 'gramo', stock: 2, controlInventario: false })[1], 0);
});
test('import alta: kg decimales, UND entero', () => {
  const run = product => vm.runInContext(createExpr[1], ctx({ action: { product } }));
  assert.equal(run({ unidad: 'litro', stock: 2.5 }), 2.5);
  assert.equal(run({ unidad: 'unidad', stock: 2.5 }), 2);
});
test('inline-03 ya no redondea stock con _naInt', () => {
  assert.doesNotMatch(src3, /_naInt\(get\('stock'\)\)|_naInt\(previous\.stock\)|_naInt\(next\.stock\)|_naInt\(action\.product\.stock\)/);
});
const unitExpr = /unidad:(blank\(get\('unit'\)\)&&existing\?_naClean\(existing\.unidad\)\|\|'unidad':_naImportUnit\(get\('unit'\)\)),/.exec(src3);
const importUnitFn = /^function _naImportUnit\(value\)\{.*$/m.exec(src3)[0];
function rowUnit(existing, unitCell) {
  const c = ctx({ existing, blank: v => v === '' || v == null, get: k => ({ unit: unitCell })[k], sinTildes: v => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '') });
  vm.runInContext(importUnitFn, c); return vm.runInContext(unitExpr[1], c);
}
test('fila sin unidad sobre producto kg existente: unidad sigue kilogramo y stock 2.5', () => {
  assert.ok(unitExpr, 'expresión unidad encontrada');
  const previous = { id: 7, unidad: 'kilogramo', stock: 1 };
  const unidad = rowUnit(previous, '');
  assert.equal(unidad, 'kilogramo');
  const data = { unidad, stock: importStock(unidad, '2.5') };
  const next = { ...previous, ...data };
  const c = ctx({ previous, next });
  assert.equal(next.unidad, 'kilogramo');
  assert.equal(vm.runInContext(updateExpr[2], c), 2.5);
});
test('producto nuevo sin unidad sigue siendo unidad; unidad explícita manda', () => {
  assert.equal(rowUnit(null, ''), 'unidad');
  assert.equal(rowUnit(null, 'kg'), 'kilogramo');
  assert.equal(rowUnit({ unidad: 'kilogramo' }, 'unidad'), 'unidad');
  assert.equal(importStock(rowUnit(null, ''), '2.5'), 2);
});
test('delta del import se redondea a 6 decimales en unidades decimales; UND igual', () => {
  assert.ok(deltaExpr, 'expresión delta encontrada');
  const run = (unidad, beforeStock, targetStock) => vm.runInContext(deltaExpr[1], ctx({ next: { unidad }, beforeStock, targetStock }));
  assert.equal(2.6 - 2.5 === 0.1, false);
  assert.equal(run('kilogramo', 2.5, 2.6), 0.1);
  assert.equal(run('mililitro', 0.3, 0.1), -0.2);
  assert.equal(run('unidad', 4, 7), 3);
});
