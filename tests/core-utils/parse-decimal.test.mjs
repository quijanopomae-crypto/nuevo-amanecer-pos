import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Parser compartido de montos y cantidades escritos a mano (fuera de Venta). Datos sintéticos.
const source = readFileSync('POS/js/core/utils.js', 'utf8');
function load(extra = {}) { const ctx = vm.createContext({ ...extra }); vm.runInContext(source, ctx); return ctx; }
const D = load().NA_DECIMAL;

// Formato decidido por el dueño: coma para miles y punto para decimales («1,000.00»).
test('acepta punto decimal, coma de miles bien agrupada y coma decimal de 1 o 2 dígitos', () => {
  for (const [raw, n] of [
    ['450', 450], ['4.50', 4.5], ['4', 4], ['0', 0], ['.5', 0.5], ['1.000', 1], ['4.500', 4.5], ['2.', 2], ['1,000.', 1000], ['  12.25  ', 12.25],
    ['1,000', 1000], ['4,500', 4500], ['1,000,000', 1000000], ['1,000.50', 1000.5], ['1,000.00', 1000], ['12,345,678.9', 12345678.9],
    ['4,50', 4.5], ['1,5', 1.5], ['1,00', 1], ['0,01', 0.01], ['1234,50', 1234.5],
    ['0,500', 0.5], [',500', 0.5], [',50', 0.5], [',5', 0.5], ['0,5', 0.5],
  ]) assert.equal(D.parse(raw), n, raw);
});

test('una coma seguida de exactamente 3 dígitos es de miles; de 1 o 2, decimal (confirmado por el dueño)', () => {
  assert.equal(D.parse('1,234'), 1234);
  assert.equal(D.parse('4,50'), 4.5);
  assert.equal(D.parse('4,5'), 4.5);
});

test('rechaza agrupación inválida, europeo, más de 2 decimales, signos, exponentes y basura', () => {
  for (const raw of ['1,2345', '1,0000', '1,23,456', '12,34,56', '1.000,50', '1.234,50', '12,3456', '4.505', '1,000.505', '01,000', '0,000,000', '1234,567',
    '1e2', '1E2', '1.5E+3', '+2', '-2', '0x10', '1.234.567', '4,5,0', '2,', '4,', '1,000,', '.', ',', '4 50', 'abc', 'Infinity', 'NaN', '٤', '4,50 S/', 'S/ 4,50'])
    assert.ok(Number.isNaN(D.parse(raw)), raw);
  assert.ok(Number.isNaN(D.parse('')));
  assert.ok(Number.isNaN(D.parse(null)));
  assert.ok(Number.isNaN(D.parse(undefined)));
  assert.ok(Number.isNaN(D.parse('9'.repeat(400))), 'demasiado grande → no finito');
});

test('cantidades (qty) admiten más decimales con punto; mismas reglas de coma', () => {
  const Q = { qty: true };
  assert.equal(D.parse('2.375', Q), 2.375);
  assert.equal(D.parse('1,000.5', Q), 1000.5);
  assert.equal(D.parse('2,5', Q), 2.5);
  assert.ok(Number.isNaN(D.parse('1,2345', Q)));
  assert.ok(Number.isNaN(D.parse('1e2', Q)));
});

test('check devuelve mensajes claros en español', () => {
  assert.deepEqual({ ...D.check('') }, { empty: true, ok: false, value: NaN, message: '' });
  assert.deepEqual({ ...D.check('4,50') }, { empty: false, ok: true, value: 4.5, message: '' });
  assert.match(D.check('1.000,50').message, /usa punto para los miles.*1,000\.50/);
  assert.match(D.check('1,23,456').message, /coma de miles mal ubicada/);
  assert.match(D.check('1,2345').message, /1 o 2 decimales.*3 dígitos de miles/);
  assert.match(D.check('4.505').message, /más de 2 decimales/);
  assert.match(D.check('2,').message, /termina en coma/);
  assert.match(D.check('1e2').message, /no se aceptan exponentes/);
  assert.match(D.check('+2').message, /no se aceptan signos/);
  assert.match(D.check('0x10').message, /«0x10» no es un número válido/);
});

test('formato al salir del campo: miles con coma y 2 decimales; re-editar «1,000.00» vuelve a 1000', () => {
  for (const [n, t] of [[450, '450.00'], [1000, '1,000.00'], [1, '1.00'], [0.5, '0.50'], [4.5, '4.50'], [1000000, '1,000,000.00'], [0, '0.00']])
    assert.equal(D.format(n), t, String(n));
  assert.equal(D.format(1000, 'int'), '1,000');
  assert.equal(D.format(2.375, 'qty'), '2.375');
  for (const raw of ['1000', '1,000', '1,000.00', '450', '1.000', '0,500', '4,50']) assert.equal(D.parse(D.format(D.parse(raw))), D.parse(raw), raw);
});

test('display: valores guardados listos para editar (2 decimales; nunca bloquean Guardar si no se tocan)', () => {
  for (const [stored, shown] of [[3.3333, '3.33'], [0.30000000000000004, '0.30'], [0.1 + 0.2, '0.30'], [1234.5, '1,234.50'], [4, '4.00'], ['4.5', '4.50'], [0, '0.00']]) {
    assert.equal(D.display(stored), shown, String(stored));
    assert.ok(D.check(D.display(stored)).ok, String(stored));
  }
  assert.equal(D.display(null), '');
  assert.equal(D.display(''), '');
  assert.equal(D.display(30, 'int'), '30');
  assert.equal(D.display(1000, 'int'), '1,000');
  assert.equal(D.display(7.5, 'int'), '7.5', 'un entero antiguo con decimales no se redondea a escondidas');
  assert.equal(D.display(24, 'qty'), '24');
  assert.equal(D.display(2.375, 'qty'), '2.375');
});

test('el redondeo a céntimos sigue siendo Math.round(monto * 100)', () => {
  for (const [raw, c] of [['4,50', 450], ['4,5', 450], [',50', 50], ['0,01', 1], ['19,99', 1999], ['1,000.50', 100050], ['1234,5', 123450], ['0,500', 50]])
    assert.equal(Math.round(D.parse(raw) * 100), c, raw);
});

test('value, validate y mark sobre campos (DOM mínimo)', () => {
  const toasts = [];
  const make = (v) => ({ value: v, attrs: {}, validity: '', focused: false,
    setAttribute(k, x) { this.attrs[k] = x; }, removeAttribute(k) { delete this.attrs[k]; }, hasAttribute(k) { return k in this.attrs; },
    setCustomValidity(m) { this.validity = m; }, focus() { this.focused = true; } });
  const els = { a: make('4,50'), b: make(''), c: make('1e2') };
  const ctx = load({ document: { getElementById: (id) => els[id] || null }, toast: (m, k) => toasts.push([m, k]) });
  const N = ctx.NA_DECIMAL;
  assert.equal(N.value('a'), 4.5);
  assert.ok(Number.isNaN(N.value('b')));
  assert.equal(N.value('b', 0), 0);
  assert.ok(Number.isNaN(N.value('c', 0)));
  assert.equal(N.validate([['a', 'Costo'], ['b', 'Precio']]), true);
  assert.equal(toasts.length, 0);
  assert.equal(N.validate([['a', 'Costo'], ['c', 'Monto']]), false);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][0], /^Monto: no se aceptan exponentes/);
  assert.equal(toasts[0][1], 'error');
  assert.equal(els.c.attrs['aria-invalid'], 'true');
  assert.ok(els.c.validity.length > 0 && els.c.focused);
  els.c.value = '1,5';
  assert.equal(N.mark(els.c), true);
  assert.equal('aria-invalid' in els.c.attrs, false);
  assert.equal(els.c.validity, '');
});

test('PATTERN acepta exactamente lo mismo que parse (sin contar el límite de 2 decimales)', () => {
  for (const raw of ['1,000', '1,000.50', '4,50', ',500', '0,500', '1.000', '1,2345', '1,23,456', '1.000,50', '1e2', '+2'])
    assert.equal(D.PATTERN.test(raw), !Number.isNaN(D.parse(raw, { qty: true })), raw);
});

test('enteros: dígitos o miles con coma («1,000»); «4,50» y «4.50» se rechazan con aviso en vez de truncar', () => {
  const I = { integer: true };
  assert.equal(D.parse('3', I), 3);
  assert.equal(D.parse(' 12 ', I), 12);
  assert.equal(D.parse('1,000', I), 1000);
  for (const raw of ['4,50', '4.50', '1e2', '+2', '-2', '0x10', '1.234', '1,00', '01,000', ''])
    assert.ok(Number.isNaN(D.parse(raw, I)), raw);
  assert.match(D.check('4,50', I).message, /«4,50» no es un número entero/);
  assert.match(D.check('1e2', I).message, /no se aceptan exponentes.*número entero/);
});

test('toCents: Math.round(monto*100) con entero seguro; inválido → NaN', () => {
  assert.equal(D.toCents('4,50'), 450);
  assert.equal(D.toCents('4,5'), 450);
  assert.equal(D.toCents(',50'), 50);
  assert.equal(D.toCents(4.5), 450);
  assert.equal(D.toCents('1,000.00'), 100000);
  assert.ok(Number.isNaN(D.toCents('1.234,50')));
  assert.ok(Number.isNaN(D.toCents('1e2')));
  assert.ok(Number.isNaN(D.toCents('9'.repeat(30))));
});

test('_naNumber NO cambia (datos guardados e importaciones, p. ej. «1.5E+3» de Excel)', () => {
  const ctx = load();
  const n = vm.runInContext('_naNumber', ctx);
  assert.equal(n('1e2'), 12);
  assert.equal(n('1.5E+3'), 1.53);
  assert.equal(n('4,50'), 4.5);
  assert.equal(n('1.234,50'), 1234.5);
  assert.equal(n(''), 0);
  assert.equal(n(1500), 1500);
});
