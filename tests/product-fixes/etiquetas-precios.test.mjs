import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(readFileSync('POS/js/modules/etiquetas-precios.js', 'utf8'), context);
const E = context.NA_ETIQUETAS_PRECIOS;

const toModules = widths => [...widths].map((w, i) => (i % 2 ? '0' : '1').repeat(Number(w))).join('');

// Referencias externas (no salen de este código):
// - Símbolos y anchos: tabla CODE128 de ISO/IEC 15417:2007 (Tabla 1), reproducida en
//   https://en.wikipedia.org/wiki/Code_128 («Bar/space widths»).
// - Cadenas completas de módulos (1 = barra, 0 = espacio): generadas con la biblioteca
//   independiente python-barcode 0.16.1, `barcode.Code128(texto).build()[0]` (juego B).
// - Dígito de control: (104 + Σ posición × valor) mod 103, cálculo a mano abajo.
const REFERENCE = [
  // 104 + 1·33 + 2·34 + 3·35 = 310 → 310 mod 103 = 1
  { data: 'ABC', check: 1, modules: '11010010000101000110001000101100010001000110110011011001100011101011' },
  // 104 + 1·40 + 2·79 + 3·76 + 4·65 + 5·13 + 6·16 + 7·17 = 1070 → 1070 mod 103 = 40
  { data: 'Hola-01', check: 40, modules: '1101001000011000101000100011110101100101000010010110000100110111001001110110010011100110110001010001100011101011' },
  // 104 + 1·33 + 2·50 + 3·50 + 4·47 + 5·58 + 6·13 + 7·16 + 8·17 = 1191 → 1191 mod 103 = 58
  // Juego C (pares de dígitos): Start C(105) 77 50 12 34 56 78, Code B(100), '9'(25).
  // 105 + 1·77 + 2·50 + 3·12 + 4·34 + 5·56 + 6·78 + 7·100 + 8·25 = 2102 → 2102 mod 103 = 42
  { data: '7750123456789', check: 42, values: [105, 77, 50, 12, 34, 56, 78, 100, 25], modules: '110100111001111011101011000101110101100111001000101100011100010110110000101001011110111011100101100101101110001100011101011' },
  // Start B, 'A' 'B', Code C(99), 12 34 56: 104 + 33 + 2·34 + 3·99 + 4·12 + 5·34 + 6·56 = 1056 → 1056 mod 103 = 26
  { data: 'AB123456', check: 26, values: [104, 33, 34, 99, 12, 34, 56], modules: '11010010000101000110001000101100010111011110101100111001000101100011100010110111001001101100011101011' },
  { data: 'ARROZ-01', check: 58, modules: '110100100001010001100011000101110110001011101000111011011101100010100110111001001110110010011100110111011000101100011101011' }
];
// Extracto de la tabla del estándar para los símbolos usados en las referencias.
const STANDARD = { 1: '222122', 33: '111323', 34: '131123', 35: '131321', 104: '211214', 106: '2331112' };

test('CODE128 B: dígito de control y patrón coinciden con la referencia externa', () => {
  for (const ref of REFERENCE) {
    const values = Array.from(E.code128Values(ref.data));
    if (ref.values) assert.deepEqual(values.slice(0, -2), ref.values, ref.data + ' símbolos');
    else assert.equal(values[0], 104, 'Start B');
    assert.equal(values.at(-2), ref.check, ref.data + ' dígito de control');
    assert.equal(values.at(-1), 106, 'Stop');
    assert.equal(toModules(E.code128Pattern(ref.data)), ref.modules, ref.data);
  }
  for (const [value, widths] of Object.entries(STANDARD)) assert.equal(E.PATTERNS[value], widths, 'tabla ISO símbolo ' + value);
  assert.equal(E.code128Pattern('ABC'), STANDARD[104] + STANDARD[33] + STANDARD[34] + STANDARD[35] + STANDARD[1] + STANDARD[106]);
});

test('CODE128: sin código no hay barras; el SVG solo dibuja barras', () => {
  assert.equal(E.code128Pattern(''), '');
  assert.equal(E.code128Svg(''), '');
  const svg = E.code128Svg('ABC');
  assert.match(svg, /^<svg class="etq-bars"/);
  assert.equal((svg.match(/<rect /g) || []).length, 5 * 3 + 4, 'Start, A, B, C y control: 3 barras cada uno; Stop: 4');
  assert.doesNotMatch(E.labelHtml({ id: 1, name: 'Galleta', precio: 2 }), /<svg/);
  assert.match(E.labelHtml({ id: 1, name: 'Galleta', precio: 2 }), /Sin código/);
});

test('precio en S/ con 2 decimales', () => {
  assert.equal(E.formatPrice(4.5), 'S/ 4.50');
  assert.equal(E.formatPrice(10), 'S/ 10.00');
  assert.equal(E.formatPrice('3,456'), 'S/ 3.46');
  assert.equal(E.formatPrice(0.005), 'S/ 0.01');
  assert.equal(E.formatPrice(undefined), 'S/ 0.00');
  assert.equal(E.formatPrice('abc'), 'S/ 0.00');
});

test('nombres largos se cortan con «…» y los cortos quedan igual', () => {
  assert.equal(E.truncateName('Arroz'), 'Arroz');
  const long = 'Aceite vegetal de girasol premium botella familiar 1 litro';
  const cut = E.truncateName(long);
  assert.ok(Array.from(cut).length <= 32, cut);
  assert.ok(cut.endsWith('…'));
  assert.ok(long.startsWith(cut.slice(0, -1)));
  assert.equal(E.truncateName('x'.repeat(32)), 'x'.repeat(32));
});

test('el nombre se escapa: sin XSS en la etiqueta', () => {
  const html = E.labelHtml({ id: 9, name: '<img src=x onerror=alert(1)>"&\'', precio: 1, barcode: '<b>' });
  assert.doesNotMatch(html, /<img|<b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&amp;&#39;/);
  assert.equal(E.escapeHtml('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('cantidad de etiquetas entre 1 y 100', () => {
  assert.equal(E.clampQty(0), 1); assert.equal(E.clampQty(250), 100); assert.equal(E.clampQty('7'), 7); assert.equal(E.clampQty('x'), 1);
});

test('EAN-13 en juego C entra en la etiqueta chica (38 mm)', () => {
  const modules = toModules(E.code128Pattern('7750123456789')).length;
  // Juego C: 10 símbolos de 11 módulos + Stop de 13 = 123 (en juego B serían 189).
  assert.equal(modules, 123);
  // Ancho útil de la chica: 38 mm − 2 × 1,5 mm de margen; con 20 módulos de zona de silencio cada módulo ≥ 0,23 mm.
  assert.ok((38 - 3) / (modules + 20) >= 0.23);
});

test('un solo precio para el buscador y la etiqueta (precio o price)', () => {
  assert.equal(E.productPrice({ precio: 3 }), 'S/ 3.00');
  assert.equal(E.productPrice({ price: 2.5 }), 'S/ 2.50');
  assert.equal(E.productPrice({ precio: 1, price: 9 }), 'S/ 1.00');
  assert.match(E.labelHtml({ id: 3, name: 'Solo price', price: 2.5 }), /S\/ 2\.50/);
});

test('código con caracteres fuera de Code 128: solo texto y aviso visible', () => {
  assert.equal(E.code128Values('CAFÉ-Ñ1'), null);
  const html = E.labelHtml({ id: 4, name: 'Café', precio: 5, barcode: 'CAFÉ-Ñ1' });
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /CAFÉ-Ñ1/);
  assert.match(html, /data-etq-warn>sin barras: código con caracteres no válidos</);
  assert.doesNotMatch(E.labelHtml({ id: 5, name: 'Galleta', precio: 2 }), /data-etq-warn/, 'sin código no muestra el aviso');
});

// ---- Misión 1: impresión, sin precio, tope y hora de Lima ----
test('@page: A4 sin margen y rollo con el tamaño exacto de la etiqueta', () => {
  assert.equal(E.pageCss('a4'), '@page { size: A4; margin: 0; }');
  assert.equal(E.pageCss('chica'), '@page { size: 38mm 25mm; margin: 0; }');
  assert.equal(E.pageCss('mediana'), '@page { size: 50mm 30mm; margin: 0; }');
  assert.equal(E.pageCss('otro'), '@page { size: 50mm 30mm; margin: 0; }');
  // 3 × 70 mm = 210 mm y 8 × 37 mm = 296 mm: entra en A4 (210 × 297) sin margen.
  assert.ok(3 * E.FORMATS.a4.width <= 210 && 8 * E.FORMATS.a4.height <= 297);
});

test('A4: un grid por cada 24 etiquetas', () => {
  const p = { id: 1, name: 'X', precio: 1 };
  const html = E.sheetHtml(Array(50).fill(p), 'a4', new Date());
  const pages = html.split('data-etq-a4-page').length - 1;
  assert.equal(pages, 3);
  const first = html.split('<div class="etq-a4-page" data-etq-a4-page>')[1];
  assert.equal(first.split('data-etq-label').length - 1, 24);
  assert.doesNotMatch(E.sheetHtml(Array(5).fill(p), 'chica', new Date()), /etq-a4-page/);
});

test('sin precio: nunca «S/ 0.00» sin aviso', () => {
  for (const p of [{ precio: 0 }, {}, { precio: '' , price: '' }, { precio: 'abc' }, { precio: -3 }, { precio: 0.004 }]) {
    assert.equal(E.hasPrice(p), false, JSON.stringify(p));
    assert.equal(E.productPrice(p), 'Sin precio');
    const html = E.labelHtml({ id: 1, name: 'A', ...p });
    assert.doesNotMatch(html, /S\/ 0\.00/);
    assert.match(html, /etq-no-price/);
    assert.match(html, /data-etq-noprice>Sin precio</);
  }
  assert.equal(E.hasPrice({ precio: '', price: 2 }), true);
  assert.doesNotMatch(E.labelHtml({ id: 2, name: 'B', precio: 3 }), /etq-no-price|data-etq-noprice/);
});

test('tope total de etiquetas en la vista previa', () => {
  const p = { id: 1 };
  const plan = E.labelPlan([{ product: p, qty: 100 }, { product: p, qty: 100 }, { product: p, qty: 100 }]);
  assert.equal(E.MAX_TOTAL, 240);
  assert.equal(plan.total, 240); assert.equal(plan.requested, 300); assert.equal(plan.truncated, true);
  const small = E.labelPlan([{ product: p, qty: 3 }]);
  assert.equal(small.total, 3); assert.equal(small.truncated, false);
});

test('fecha en hora de Lima, no en la del aparato', () => {
  assert.equal(E.formatDate(new Date('2026-10-21T03:00:00Z')), '20/10/2026');
  assert.equal(E.formatDate(new Date('2026-10-21T05:00:00Z')), '21/10/2026');
  assert.equal(E.formatDate(new Date('2027-01-01T04:59:00Z')), '31/12/2026');
});

test('precio como texto: separador de miles y decimal, sin «Sin precio» falso', () => {
  const cases = [['1,234.50', 1234.5], ['1.234,50', 1234.5], ['S/ 1,234.50', 1234.5], ['s/4.50', 4.5], ['4,50', 4.5], ['3,456', 3.456], ['1,234,567', 1234567], ['1.234.567', 1234567], [' 12.5 ', 12.5], [7, 7]];
  for (const [raw, n] of cases) {
    assert.equal(E.parsePrice(raw), n, String(raw));
    assert.equal(E.hasPrice({ precio: raw }), true, String(raw));
  }
  assert.equal(E.formatPrice('1,234.50'), 'S/ 1234.50');
  assert.equal(E.productPrice({ precio: '1.234,50' }), 'S/ 1234.50');
  for (const raw of ['abc', '1,2,3', '1.2.3', '1,23,456', '--1', '', '0,00', '0.004', '-5']) assert.equal(E.hasPrice({ precio: raw }), false, String(raw));
});

// La fecha no depende de la zona del aparato: el mismo instante da la fecha de Lima con TZ=UTC, Tokio, Kiritimati
// (UTC+14) o Los Ángeles. También sin soporte de zonas en Intl (respaldo fijo UTC−5).
test('fecha de Lima con el aparato en otra zona horaria (TZ) y sin Intl', async () => {
  const { execFileSync } = await import('node:child_process');
  const script = `
    const vm = require('node:vm'), fs = require('node:fs');
    const run = (ctx) => { vm.createContext(ctx); vm.runInContext(fs.readFileSync('POS/js/modules/etiquetas-precios.js', 'utf8'), ctx); return ctx.NA_ETIQUETAS_PRECIOS; };
    const instants = ['2026-10-21T03:00:00Z', '2026-10-21T05:00:00Z', '2027-01-01T04:59:00Z', '2026-10-21T23:30:00Z'];
    const noIntl = { Intl: { DateTimeFormat: function () { throw new RangeError('sin zonas'); } } };
    const fmt = E => instants.map(i => E.formatDate(new Date(i)));
    process.stdout.write(JSON.stringify({ local: new Date('2026-10-21T03:00:00Z').getDate(), intl: fmt(run({})), fallback: fmt(run(noIntl)) }));`;
  const expected = ['20/10/2026', '21/10/2026', '31/12/2026', '21/10/2026'];
  for (const TZ of ['UTC', 'Asia/Tokyo', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
    const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }));
    if (TZ !== 'America/Los_Angeles') assert.equal(out.local, 21, `${TZ}: el aparato ve otro día`);
    assert.deepEqual(out.intl, expected, `${TZ} con Intl`);
    assert.deepEqual(out.fallback, expected, `${TZ} sin Intl`);
  }
});
