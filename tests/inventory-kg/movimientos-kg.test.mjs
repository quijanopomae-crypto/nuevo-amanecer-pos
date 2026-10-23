import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const utils = read('POS/js/core/utils.js').split('\n').filter(l => /^const _na(Number|Int)=/.test(l)).join('\n');
const src = read('POS/js/legacy-inline/inline-02.js').split('\n');
const helper = src.filter(l => /^const _NA_DECIMAL_UNITS=|^function _naMovQty\(/.test(l)).join('\n');
const line = src.find(l => /^\s*inventoryMovements=\(Array\.isArray\(inventoryMovements\)/.test(l));
function run(productos, inventoryMovements) {
  const ctx = { productos, inventoryMovements, _naClean: v => String(v ?? '').trim(), obtenerHoy: () => '2026-10-23' };
  vm.createContext(ctx);
  vm.runInContext(utils.replace(/^const /gm, 'var ') + '\n' + helper.replace(/^const /gm, 'var ') + '\n' + line + '\nthis.out=inventoryMovements;', ctx);
  return ctx.out;
}
const prods = [{ id: 1, unidad: 'kilogramo' }, { id: 2, unidad: 'unidad' }, { id: 3 }];
test('kg: movimiento 2.5 se queda en 2.5', () => {
  const [m] = run(prods, [{ productId: 1, before: 10, delta: -2.5, after: 7.5 }]);
  assert.equal(m.after, 7.5); assert.equal(m.delta, -2.5);
  const [n] = run(prods, [{ productId: 1, before: 0, delta: 2.5, after: 2.5 }]);
  assert.equal(n.after, 2.5);
});
test('UND sigue entero como hoy', () => {
  const [m] = run(prods, [{ productId: 2, before: 9.7, delta: -3, after: 6.7 }]);
  assert.equal(m.before, 9); assert.equal(m.after, 6);
});
test('datos existentes sin cambio (sin unidad, producto inexistente, enteros)', () => {
  const ms = run(prods, [{ productId: 3, before: 5.5, delta: 1, after: 6.5, reason: 'x', type: 'COMPRA', source: 'MANUAL', fecha: '2026-10-01' }, { productId: 99, before: '4,9', delta: 0, after: 4.9 }, { productId: 2, before: 12, delta: -3, after: 9 }]);
  assert.deepEqual([ms[0].before, ms[0].after, ms[1].before, ms[1].after, ms[2].before, ms[2].after], [5, 6, 4, 4, 12, 9]);
  assert.equal(ms[0].type, 'COMPRA'); assert.equal(ms[0].fecha, '2026-10-01');
});
