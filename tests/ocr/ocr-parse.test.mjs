// ocr-parse.test.mjs — suite permanente del PARSER OCR de compras (V1.1).
//
// OBJECTIVE_ID: OCR-COMPRAS-V1.1 / CICLO 1A
//
// Carga POS/js/ocr/ocr-parse.js REAL (byte a byte) en node:vm, sin DOM y sin
// el resto del producto: el parser es puro y no debe depender de nada mas.
// La suite NO escribe evidencia, NO toca stock, NO toca persistencia.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PARSER_REL = 'POS/js/ocr/ocr-parse.js';
const PARSER = path.join(ROOT, 'POS', 'js', 'ocr', 'ocr-parse.js');

const ctx = vm.createContext({ console });
new vm.Script(readFileSync(PARSER, 'utf8'), { filename: PARSER_REL }).runInContext(ctx);
const parsePurchaseText = vm.runInContext('parsePurchaseText', ctx);
const toNumber = vm.runInContext('_NA_OCR_PARSE.toNumber', ctx);
const isNonItemLine = vm.runInContext('_NA_OCR_PARSE.isNonItemLine', ctx);
const codeCandidate = vm.runInContext('_NA_OCR_PARSE.codeCandidate', ctx);

/** Ejecuta el parser y devuelve datos planos del realm de Node. */
function parse(text) {
  return JSON.parse(JSON.stringify(parsePurchaseText(text)));
}

/** Primera (y unica esperada) linea del resultado. */
function one(text) {
  const rows = parse(text);
  assert.equal(rows.length, 1, `se esperaba 1 linea de producto, hubo ${rows.length}`);
  return rows[0];
}

/** toNumber con datos planos del realm de Node (evita comparar prototipos). */
function num(token) {
  const result = toNumber(token);
  return result === null ? null : JSON.parse(JSON.stringify(result));
}

// ---------------------------------------------------------------------------
// 1-5 — contrato basico y layouts
// ---------------------------------------------------------------------------

test('P01 texto vacio devuelve []', () => {
  assert.deepEqual(parse(''), []);
  assert.deepEqual(parse('   '), []);
  assert.deepEqual(parse('\n\n\r\n'), []);
});

test('P02 NAME_QTY_PRICE', () => {
  const row = one('COCA COLA 600ML 2 3.50');
  assert.equal(row.layout, 'NAME_QTY_PRICE');
  assert.equal(row.name, 'COCA COLA 600ML');
  assert.equal(row.qty, 2);
  assert.equal(row.unitPrice, 3.5);
  assert.equal(row.total, null);
  assert.equal(row.qtyConfident, true);
  assert.equal(row.priceConfident, true);
  assert.equal(row.needsReview, false);
  assert.equal(row.raw, 'COCA COLA 600ML 2 3.50');
  assert.equal(row.lineNumber, 1);
});

test('P03 NAME_QTY_PRICE_TOTAL', () => {
  const row = one('GLORIA LECHE 400G 4 3.50 14.00');
  assert.equal(row.layout, 'NAME_QTY_PRICE_TOTAL');
  assert.equal(row.name, 'GLORIA LECHE 400G');
  assert.equal(row.qty, 4);
  assert.equal(row.unitPrice, 3.5);
  assert.equal(row.total, 14);
  assert.equal(row.totalMatches, true);
  assert.equal(row.needsReview, false);
});

test('P04 QTY_NAME_PRICE (cantidad al inicio)', () => {
  const row = one('3 ACEITE PRIMOR 900ML 8.50');
  assert.equal(row.layout, 'QTY_NAME_PRICE');
  assert.equal(row.name, 'ACEITE PRIMOR 900ML');
  assert.equal(row.qty, 3);
  assert.equal(row.unitPrice, 8.5);
  assert.equal(row.needsReview, false);
});

test('P05 NAME_PRICE sin cantidad -> needsReview', () => {
  const row = one('GALLETA SODA FIELD 1.20');
  assert.equal(row.layout, 'NAME_PRICE');
  assert.equal(row.qty, null);
  assert.equal(row.unitPrice, 1.2);
  assert.equal(row.qtyConfident, false);
  assert.equal(row.needsReview, true);
  assert.ok(row.reasons.includes('CANTIDAD_NO_DETECTADA'));
});

// ---------------------------------------------------------------------------
// 6-10 — numeros y reparacion OCR
// ---------------------------------------------------------------------------

test('P06 decimal con coma', () => {
  const row = one('JABON PATITO 190G 6 2,50');
  assert.equal(row.unitPrice, 2.5);
  assert.equal(row.qty, 6);
  assert.ok(row.reasons.includes('DECIMAL_CON_COMA'));
  assert.equal(row.needsReview, false);
});

test('P07 decimal con punto', () => {
  const row = one('INKA KOLA 1L 3 4.20');
  assert.equal(row.unitPrice, 4.2);
  assert.equal(row.qty, 3);
  assert.ok(!row.reasons.includes('DECIMAL_CON_COMA'));
});

test('P08 OCR O->0 solo en contexto numerico', () => {
  // "1O" tiene un digito real: se repara a 10.
  assert.deepEqual(num('1O'), { value: 10, repaired: true, decimalComma: false, thousands: false });
  assert.deepEqual(num('3.5O'), { value: 3.5, repaired: true, decimalComma: false, thousands: false });
  // Sin ningun digito ASCII real NO se repara: "O" y "OO" no son numeros.
  assert.equal(num('O'), null);
  assert.equal(num('OO'), null);
  assert.equal(num('Oreo'), null);
});

test('P09 OCR I/l->1 solo en contexto numerico', () => {
  assert.deepEqual(num('I0'), { value: 10, repaired: true, decimalComma: false, thousands: false });
  assert.deepEqual(num('l2.50'), { value: 12.5, repaired: true, decimalComma: false, thousands: false });
  assert.equal(num('I'), null);
  assert.equal(num('II'), null);
  assert.equal(num('lll'), null);
});

test('P10 no altera O/I de nombres normales', () => {
  const row = one('PAPEL ELITE 4 ROLLOS I0 I2,5O');
  // Los tokens numericos SI se reparan...
  assert.equal(row.qty, 10);
  assert.equal(row.unitPrice, 12.5);
  assert.ok(row.reasons.includes('OCR_DIGITOS_CORREGIDOS'));
  // ...y el nombre comercial queda intacto, con sus O y sus L.
  assert.equal(row.name, 'PAPEL ELITE 4 ROLLOS');
});

// ---------------------------------------------------------------------------
// 11-13 — codigos y acentos
// ---------------------------------------------------------------------------

test('P11 barcode de 6 a 14 digitos', () => {
  assert.equal(codeCandidate('7750885000123'), '7750885000123'); // 13
  assert.equal(codeCandidate('123456'), '123456');               // 6 (minimo)
  assert.equal(codeCandidate('12345'), null);                    // 5 (corto)
  assert.equal(codeCandidate('123456789012345'), null);          // 15 (largo)
  assert.equal(codeCandidate('775O885OOO123'), '7750885000123'); // reparado
  assert.equal(codeCandidate('SKU-001'), null);                  // no es corrida
  assert.equal(codeCandidate('ROLLITOS'), null);                 // sin digitos
});

test('P12 barcode se elimina del nombre detectado', () => {
  const row = one('7750885000123 COCA COLA 600ML 2 3.50');
  assert.equal(row.name, 'COCA COLA 600ML');
  assert.deepEqual(row.codes, ['7750885000123']);
  assert.ok(row.reasons.includes('CODIGO_DETECTADO'));
  assert.equal(row.qty, 2);
  assert.equal(row.unitPrice, 3.5);
});

test('P13 acentos preservados en el nombre', () => {
  const row = one('JABÓN HENO DE PRAVIA 85G 3 4.50');
  assert.equal(row.name, 'JABÓN HENO DE PRAVIA 85G');
  const row2 = one('PAÑAL NINET TALLA L 2 25,90');
  assert.equal(row2.name, 'PAÑAL NINET TALLA L');
  assert.equal(row2.unitPrice, 25.9);
});

// ---------------------------------------------------------------------------
// 14-18 — filtrado de ruido documental
// ---------------------------------------------------------------------------

test('P14 encabezados de columna ignorados', () => {
  assert.equal(isNonItemLine('CANT DESCRIPCION P.UNIT IMPORTE'), true);
  assert.equal(isNonItemLine('DESCRIPCIÓN'), true);
  assert.equal(isNonItemLine('CANTIDAD'), true);
  assert.equal(isNonItemLine('P. UNIT'), true);
  assert.equal(isNonItemLine('IMPORTE'), true);
  assert.deepEqual(parse('CANT DESCRIPCION P.UNIT IMPORTE'), []);
});

test('P15 TOTAL ignorado', () => {
  assert.deepEqual(parse('TOTAL 8.26'), []);
  assert.deepEqual(parse('TOTAL A PAGAR 8.26'), []);
});

test('P16 SUBTOTAL ignorado', () => {
  assert.deepEqual(parse('SUBTOTAL 7.00'), []);
  assert.deepEqual(parse('SUB TOTAL 7.00'), []);
});

test('P17 IGV ignorado', () => {
  assert.deepEqual(parse('IGV 18% 1.26'), []);
  assert.deepEqual(parse('I.G.V. 1.26'), []);
  assert.deepEqual(parse('OP. GRAVADAS 7.00'), []);
});

test('P18 RUC / factura ignorados', () => {
  assert.deepEqual(parse('RUC 20123456789'), []);
  assert.deepEqual(parse('FACTURA ELECTRONICA E001-123'), []);
  assert.deepEqual(parse('BOLETA DE VENTA B001-45'), []);
  assert.deepEqual(parse('FECHA 01/09/2026'), []);
  assert.deepEqual(parse('RAZON SOCIAL: DISTRIBUIDORA XYZ SAC'), []);
});

test('P18b factura completa deja solo las lineas de producto', () => {
  const rows = parse([
    'DISTRIBUIDORA XYZ S.A.C.',
    'RUC 20123456789',
    'FACTURA ELECTRONICA E001-00001234',
    'FECHA 01/09/2026',
    'CANT DESCRIPCION P.UNIT IMPORTE',
    'COCA COLA 600ML 2 3.50 7.00',
    'GLORIA LECHE 400G 4 3.50 14.00',
    'SUBTOTAL 21.00',
    'IGV 3.78',
    'TOTAL 24.78',
    'GRACIAS POR SU COMPRA',
  ].join('\n'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'COCA COLA 600ML');
  assert.equal(rows[0].lineNumber, 6);
  assert.equal(rows[1].name, 'GLORIA LECHE 400G');
  assert.equal(rows[1].lineNumber, 7);
});

// ---------------------------------------------------------------------------
// 19-22 — cuadre y no-invencion
// ---------------------------------------------------------------------------

test('P19 qty x unitPrice = total', () => {
  const row = one('ACEITE PRIMOR 900ML 2 8.50 17.00');
  assert.equal(row.qty, 2);
  assert.equal(row.unitPrice, 8.5);
  assert.equal(row.total, 17);
  assert.equal(row.totalMatches, true);
  assert.equal(row.needsReview, false);
  assert.ok(!row.reasons.includes('DISCREPANCIA_CANTIDAD_POR_PRECIO'));
});

test('P20 discrepancia qty x unitPrice != total -> needsReview', () => {
  const row = one('ACEITE PRIMOR 900ML 2 8.50 25.00');
  assert.equal(row.qty, 2);
  assert.equal(row.unitPrice, 8.5);
  assert.equal(row.total, 25);
  assert.equal(row.totalMatches, false);
  assert.equal(row.qtyConfident, false);
  assert.equal(row.priceConfident, false);
  assert.equal(row.needsReview, true);
  assert.ok(row.reasons.includes('DISCREPANCIA_CANTIDAD_POR_PRECIO'));
});

test('P21 cantidad inexistente -> null, no se inventa', () => {
  const row = one('GALLETA SODA FIELD 1.20');
  assert.equal(row.qty, null);
  assert.equal(row.needsReview, true);
  // Aunque total/precio diera un entero exacto, no se deriva la cantidad.
  const row2 = one('ARROZ COSTENO 5KG 18.90 94.50');
  assert.equal(row2.qty, null);
  assert.equal(row2.layout, 'NAME_PRICE_TOTAL');
  assert.ok(row2.reasons.includes('CANTIDAD_NO_DETECTADA'));
});

test('P22 precio inexistente -> null, no se inventa', () => {
  const row = one('3 COCA COLA 600ML');
  assert.equal(row.qty, 3);
  assert.equal(row.unitPrice, null);
  assert.equal(row.total, null);
  assert.equal(row.layout, 'QTY_NAME');
  assert.equal(row.priceConfident, false);
  assert.equal(row.needsReview, true);
  assert.ok(row.reasons.includes('PRECIO_NO_DETECTADO'));

  // Una linea sin cantidad NI precio NI codigo no lleva dato de compra:
  // es texto del documento y no se emite (ver P22b).
  assert.deepEqual(parse('ARROZ COSTENO 5KG'), []);
});

test('P22b linea con codigo pero sin precio se conserva para revision', () => {
  const row = one('7750885000123 ARROZ COSTENO 5KG');
  assert.deepEqual(row.codes, ['7750885000123']);
  assert.equal(row.name, 'ARROZ COSTENO 5KG');
  assert.equal(row.qty, null);
  assert.equal(row.unitPrice, null);
  assert.equal(row.layout, 'NAME_ONLY');
  assert.equal(row.needsReview, true);
});

// ---------------------------------------------------------------------------
// 23-25 — multiples lineas, formato irregular, entradas invalidas
// ---------------------------------------------------------------------------

test('P23 multiples productos', () => {
  const rows = parse([
    'COCA COLA 600ML 2 3.50',
    'INKA KOLA 1L 3 4,20',
    'ARROZ COSTENO 5KG 1 18.90',
    'JABON PATITO 190G 6 2,50',
  ].join('\n'));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.qty), [2, 3, 1, 6]);
  assert.deepEqual(rows.map((r) => r.unitPrice), [3.5, 4.2, 18.9, 2.5]);
  assert.deepEqual(rows.map((r) => r.lineNumber), [1, 2, 3, 4]);
  assert.ok(rows.every((r) => r.needsReview === false));
});

test('P24 espacios dobles, tabs y saltos de linea irregulares', () => {
  const rows = parse('\n\n   COCA COLA    600ML   2    3.50   \n\r\n\n\tINKA KOLA 1L 3 4.20\t\n\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'COCA COLA 600ML');
  assert.equal(rows[0].raw, 'COCA COLA 600ML 2 3.50');
  assert.equal(rows[0].qty, 2);
  assert.equal(rows[1].name, 'INKA KOLA 1L');
  assert.equal(rows[1].qty, 3);
});

test('P25 entradas no-string / null / undefined no rompen', () => {
  assert.deepEqual(parse(null), []);
  assert.deepEqual(parse(undefined), []);
  assert.deepEqual(parse(0), []);
  assert.deepEqual(parse(false), []);
  assert.deepEqual(parse(123), []);
  assert.deepEqual(parse(3.5), []);
  assert.deepEqual(parse([]), []);
  // Un objeto se coacciona a texto: no lanza y no produce cantidad ni precio.
  assert.doesNotThrow(() => parse({}));
  const rows = parse({});
  for (const row of rows) {
    assert.equal(row.qty, null);
    assert.equal(row.unitPrice, null);
    assert.equal(row.needsReview, true);
  }
});

// ---------------------------------------------------------------------------
// ADVERSARIAL — la reparacion OCR no debe corromper texto comercial
// ---------------------------------------------------------------------------

const BRAND_TOKENS = [
  'COCA', 'COLA', 'PILSEN', 'PRIMOR', 'ROLLITOS', 'Oreo', 'OREO',
  'BOLIVAR', 'OPAL', 'NINET', 'KOLYNOS', 'TROME', 'PATITO', 'FIELD',
  'GLORIA', 'IDEAL', 'NICOLINI', 'DON', 'VITTORIO', 'LOOP', 'IO',
];

test('A01 tokens comerciales sin digitos nunca son numeros', () => {
  for (const token of BRAND_TOKENS) {
    assert.equal(toNumber(token), null, `"${token}" no debe leerse como numero`);
    assert.equal(codeCandidate(token), null, `"${token}" no debe leerse como codigo`);
  }
});

test('A02 nombres comerciales sobreviven intactos al parseo', () => {
  const cases = [
    ['COCA COLA 600ML 2 3.50', 'COCA COLA 600ML'],
    ['PILSEN CALLAO 630ML 12 5.20', 'PILSEN CALLAO 630ML'],
    ['ACEITE PRIMOR 900ML 1 8.90', 'ACEITE PRIMOR 900ML'],
    ['ROLLITOS DE CANELA 6 1.50', 'ROLLITOS DE CANELA'],
    ['Oreo Original 36g 10 1.20', 'Oreo Original 36g'],
    ['DETERGENTE BOLIVAR 730G 2 12.50', 'DETERGENTE BOLIVAR 730G'],
    ['LOOP TOALLA 100 UND 1 15.00', 'LOOP TOALLA 100 UND'],
  ];
  for (const [input, expectedName] of cases) {
    const row = one(input);
    assert.equal(row.name, expectedName, `nombre corrompido en: ${input}`);
  }
});

test('A03 presentaciones alfanumericas no se convierten en cantidad ni precio', () => {
  // 600ML / 1L / 5KG / 36g / 2X500ML llevan digitos pero NO son numeros puros.
  for (const token of ['600ML', '1L', '5KG', '36g', '2X500ML', '190G', '730G', '18ML', 'X23']) {
    assert.equal(toNumber(token), null, `"${token}" no debe leerse como numero`);
  }
  const row = one('GASEOSA 2X500ML PACK 3 7.90');
  assert.equal(row.name, 'GASEOSA 2X500ML PACK');
  assert.equal(row.qty, 3);
  assert.equal(row.unitPrice, 7.9);
});

test('A04 palabra ambigua CAJA con estructura de producto NO se descarta', () => {
  // "CAJA" es cabecera en un ticket ("CAJA: 01") pero tambien producto real.
  const row = one('CAJA FOSFOROS INTI 10 1.00');
  assert.equal(row.name, 'CAJA FOSFOROS INTI');
  assert.equal(row.qty, 10);
  assert.equal(row.unitPrice, 1);
  // La cabecera real, sin estructura de producto, si se descarta.
  assert.deepEqual(parse('CAJA: 01'), []);
  assert.deepEqual(parse('CAJA 01'), []);
});

test('A05 marca ambigua TOTAL con estructura de producto NO se descarta', () => {
  const row = one('TOTAL QUARTZ 5W30 2 45.00');
  assert.equal(row.name, 'TOTAL QUARTZ 5W30');
  assert.equal(row.qty, 2);
  assert.equal(row.unitPrice, 45);
  // El total del documento si se descarta.
  assert.deepEqual(parse('TOTAL 8.26'), []);
  assert.deepEqual(parse('TOTAL S/ 24.78'), []);
});

test('A06 simbolo monetario y separador de miles', () => {
  assert.equal(num('S/3.50').value, 3.5);
  assert.equal(num('S/.3,50').value, 3.5);
  assert.equal(num('$12.00').value, 12);
  assert.equal(num('1,250').value, 1250);      // miles
  assert.equal(num('1,250.75').value, 1250.75); // miles + decimal
  assert.equal(num('1.250,75').value, 1250.75); // formato europeo
  const row = one('ARROZ FARO 50KG 1 S/ 189,50');
  assert.equal(row.unitPrice, 189.5);
  assert.equal(row.qty, 1);
  assert.equal(row.name, 'ARROZ FARO 50KG');
});

test('A07 tokens basura no producen numeros', () => {
  for (const token of ['', '   ', '-', '--', '.', ',', '.,', 'S/', '$', 'N/A', 'ABC']) {
    assert.equal(num(token), null, `"${token}" no debe leerse como numero`);
  }
});

test('A08 el parser es puro: mismo texto -> mismo resultado', () => {
  const text = 'COCA COLA 600ML 2 3.50\nTOTAL 7.00';
  assert.deepEqual(parse(text), parse(text));
});

test('A09 no se emiten lineas sin nombre ni codigo', () => {
  assert.deepEqual(parse('2 3.50'), []);
  assert.deepEqual(parse('---'), []);
  assert.deepEqual(parse('....'), []);
});

test('A10 linea solo con codigo y numeros se conserva para revision', () => {
  const row = one('7750885000123 2 3.50');
  assert.deepEqual(row.codes, ['7750885000123']);
  assert.equal(row.name, '');
  assert.equal(row.qty, 2);
  assert.equal(row.unitPrice, 3.5);
  assert.ok(row.reasons.includes('NOMBRE_NO_DETECTADO'));
});
