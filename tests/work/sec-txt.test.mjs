// _naSecTxt (POS/js/legacy-inline/inline-10.js): texto de fecha, hora y cliente en Ventas. Nunca «[object Object]», «0», «false» ni «Invalid Date».
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const src = readFileSync('POS/js/legacy-inline/inline-10.js', 'utf8');
const start = src.indexOf('function _naSecTxt');
assert.ok(start >= 0, 'falta _naSecTxt en inline-10.js');
const end = src.indexOf('\nfunction _naSecAppend', start);
const ctx = {}; vm.createContext(ctx);
vm.runInContext(src.slice(start, end) + '\nthis.fn=_naSecTxt;', ctx);
const t = v => ctx.fn(v);

test('texto normal, sin cambios', () => {
  assert.equal(t('2026-10-25'), '2026-10-25');
  assert.equal(t('Ana Pérez'), 'Ana Pérez');
  assert.equal(t('14:30:05'), '14:30:05');
  assert.equal(t(7), '7');
});
test('vacíos: null, undefined, false, true, 0, NaN, texto en blanco → vacío', () => {
  for (const v of [null, undefined, false, true, 0, NaN, Infinity, '', '   ', '0'.slice(1)]) assert.equal(t(v), '', String(v));
});
test('textos que son residuos de una conversión mala → vacío', () => {
  for (const v of ['undefined', 'null', 'NaN', 'false', 'Invalid Date', '[object Object]', ' [object Object] ']) assert.equal(t(v), '', v);
  assert.equal(t('Cliente [object Object]'), 'Cliente');
});
test('objetos: usa su texto (nombre, date, …) y nunca «[object Object]»', () => {
  assert.equal(t({nombre: 'Luis'}), 'Luis');
  assert.equal(t({name: 'Rosa'}), 'Rosa');
  assert.equal(t({date: '2026-10-25'}), '2026-10-25');
  assert.equal(t({nombre: {nombre: 'Anidado'}}), 'Anidado');
  assert.equal(t({nombre: 0, name: 'Sol'}), 'Sol');
  assert.equal(t({otra: 1}), '');
  assert.equal(t({}), '');
  assert.equal(t(['a', null, {nombre: 'b'}]), 'a b');
  const ciclo = {}; ciclo.nombre = ciclo; assert.equal(t(ciclo), '');
});
test('Date: AAAA-MM-DD local; fecha inválida → vacío', () => {
  const d = new Date(2026, 9, 25, 23, 30); // 25/10/2026 23:30 hora local
  assert.equal(t(d), '2026-10-25');
  assert.equal(t(new Date('basura')), '');
  assert.equal(t({fecha: d}), '2026-10-25');
});
test('no toca dinero: el archivo sigue usando fmt(totalV(sale)) para el total', () => {
  assert.match(src, /fmt\(totalV\(sale\)\)/);
  assert.doesNotMatch(src.slice(start, end), /fmt\(|toFixed|totalV/);
});
