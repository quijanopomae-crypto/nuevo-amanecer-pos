// Sobre 84a49517 (Bot 5 FALLA): tras un ítem de lista o una fila (viñeta, numeración, «|», tabulador), la línea siguiente que empieza con
// «el», «ese es el», «es el» o «este es el» + costo/margen/ganancia/utilidad tapa el monto de arriba (solo ese). Las líneas de texto siguen con
// su regla («Galleta S/ 2.50\nEl costo lo ve el dueño.» se ve). Ventana ~20 caracteres y D' (su propio monto en la ventana tapa solo ese) iguales.
// Partes (1/2/3/7/13/47) = entero en todo. Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextEmitter, redactFor, ownerHold } from '../../tools/cloudflare-lab/src/pos-assistant.js';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas';
const M = '[dato del Admin]';
const red = (t, role = EMP) => redactFor(role)(t);
function emit(text, role, n) { let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, redactFor(role), role === 'owner' ? null : ownerHold, false); for (let i = 0; i < text.length; i += n) e.push(text.slice(i, i + n)); e.flush(); return o; }
const SIZES = [1, 2, 3, 7, 13, 47];
const same = (t, role = EMP) => { const f = red(t, role); for (const n of SIZES) assert.equal(emit(t, role, n), f, role + ' trozos de ' + n + ': ' + JSON.stringify(t)); return f; };
const has = (t, m) => new RegExp('(^|[^\\d])' + m.replace(/[.$*+?()[\]{}|\\^/]/g, '\\$&') + '(?![\\d])').test(t);
const hides = (f, xs) => xs.forEach((x) => assert.ok(!has(f, x), 'se ve ' + x + ': ' + JSON.stringify(f)));
const shows = (f, xs) => xs.forEach((x) => assert.ok(has(f, x), 'no se ve ' + x + ': ' + JSON.stringify(f)));

const LONG = 'Esta nota tiene más de ocho palabras para ver qué pasa ahora.';
const PRE = ['- Galleta S/ 1.80', '1. Galleta S/ 1.80', '* Galleta S/ 1.80', '| Galleta | S/ 1.80 |', 'Galleta\tS/ 1.80', '• Galleta S/ 1.80', 'a) Galleta S/ 1.80', 'Galleta | S/ 1.80', '1) Galleta S/ 1.80'];
const NX = ['el costo', 'Ese es el margen', 'es el costo', 'este es el costo', 'El margen', 'EL COSTO', 'ese es el costo unitario', 'Este es el margen', 'el costo.', '(el costo)', 'mi costo',
  'de costo', 'el ganancia', 'es el utilidad', '- el costo', '| el costo | |', '  Ese es el margen', '2. Ese es el margen', 'b) el costo'];
test('84a49517: los casos FALLA-fuga de casos-6280 («el costo», «Ese es el margen» tras ítem/fila) se tapan; solo ese monto; el dueño ve todo', () => {
  // los 12 de la corrida de Bot 5 (guion, num, ast, fila, tab, bala × 2) + variantes
  for (const pre of PRE) for (const nx of NX) for (const tail of ['', '\n', '\nGracias.', '\n\n' + LONG + '\n\nArroz S/ 4.20\n']) {
    const t = pre + '\n' + nx + tail, f = same(t); hides(f, ['1.80']); assert.ok(f.includes(M), f); if (tail.includes('4.20')) shows(f, ['4.20']);
    assert.equal(same(t, 'owner'), t); }
});
test('84a49517: con hermanos de lista — el ítem de arriba de la línea del dueño se tapa, los anteriores no (el de abajo lo tapa la ventana de 60 de la palabra, igual que «costo unitario» en 84a49517)', () => {
  const t = '- Arroz S/ 4.20\n- Galleta S/ 1.80\n- el costo\n- Leche S/ 3.80\n'; const f = same(t); shows(f, ['4.20']); hides(f, ['1.80', '3.80']);
  const r = '| Arroz | S/ 4.20 |\n| Galleta | S/ 1.80 |\nEse es el margen\n| Leche | S/ 3.80 |\n'; const g = same(r); shows(g, ['4.20']); hides(g, ['1.80', '3.80']);
});
test('84a49517: texto sin viñeta mantiene su regla — «El costo lo ve el dueño.» se ve; «el costo» corto se tapa', () => {
  for (const t of ['Galleta S/ 2.50\nEl costo lo ve el dueño.', 'Galleta S/ 2.50\nEl costo lo ve el dueño.\n', 'Arroz S/ 4.20\nEl costo lo ve el dueño.', 'Precio S/ 2.50\nEl margen lo decide el dueño cada mes.\n']) assert.equal(same(t), t);
  for (const nx of ['el costo', 'Ese es el margen']) hides(same('Galleta S/ 1.80\n' + nx + '\n'), ['1.80']);
});
test('84a49517: sin palabra del dueño tras el comienzo, el ítem se ve (el / ese / este / es + otra palabra; nombres con E)', () => {
  for (const nx of ['- El precio es bueno', '- Ese es el más vendido', '- Este es el nuevo S/ 3.00', '- Es el favorito', '- Esencia S/ 3.00', '- Elefante S/ 3.00', '- Detergente S/ 3.00', '- de la casa S/ 3.00',
    '- El costeño S/ 3.00', '- Es elegante', 'El precio sube mañana.']) { const t = '- Galleta S/ 2.50\n' + nx + '\n'; shows(same(t), ['2.50']); }
  for (const nx of ['| El precio | S/ 3.00 |', '| Ese es el más vendido | S/ 3.00 |']) shows(same('| Galleta | S/ 2.50 |\n' + nx + '\n'), ['2.50', '3.00']);
});
test("84a49517: D' igual — la línea con su propio monto en la ventana tapa solo ese", () => {
  for (const [t, vis, hid] of [['- Galleta S/ 1.80\nel costo S/ 1.20', ['1.80'], ['1.20']], ['- Galleta S/ 1.80\nEse es el margen 30%', [], ['1.80', '30%']], ['- Galleta S/ 1.80\nel margen S/ 0.30', [], ['1.80', '0.30']],
    ['- Galleta S/ 1.80\n- el costo S/ 1.20', ['1.80'], ['1.20']], ['| Galleta | S/ 1.80 |\n| el costo | S/ 1.20 |', ['1.80'], ['1.20']]]) { const f = same(t); shows(f, vis); hides(f, hid); }
  // monto pasada la ventana de 20: tapa los dos (a prueba de fallas)
  hides(same('- Galleta S/ 1.80\nese es el costo unitario de hoy S/ 1.20'), ['1.80', '1.20']);
});
test('84a49517: retención por fila igual a 84a49517 en 120 filas/ítems (venta, neutra, lista; nombres con E/el/es)', () => {
  const N = 120, p2 = (i) => String(i % 100).padStart(2, '0'), nm = (i) => 'abcdefghijklmnopqrstuvwxyz'[i % 26] + 'abcdefghijklmnopqrstuvwxyz'[(i / 26) | 0] + ' de la casa';
  const lag = (t) => { assert.equal(red(t), t); let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, redactFor(EMP), ownerHold);
    const ends = [...t.matchAll(/S\/ \d\.\d\d/g)].map((m) => m.index + m[0].length); let r = 0, mx = 0;
    for (let i = 0; i < t.length; i++) { e.push(t[i]); while (r < ends.length && o.length >= ends[r]) { mx = Math.max(mx, i + 1 - ends[r]); r++; } } e.flush(); return mx; };
  const sale = '| Producto | PVP |\n|---|---|\n' + Array.from({ length: N }, (_, i) => `| Producto ${nm(i)} | S/ 2.${p2(i)} |\n`).join('');
  const neutral = '| Producto | Monto |\n|---|---|\n' + Array.from({ length: N }, (_, i) => `| Producto ${nm(i)} | S/ 2.${p2(i)} |\n`).join('');
  const list = Array.from({ length: N }, (_, i) => `- Producto ${nm(i)} S/ 2.${p2(i)}\n`).join('');
  const got = [lag(sale), lag(neutral), lag(list)]; console.log('# retención máx. por fila (venta, neutra, lista): ' + got.join(', '));
  assert.deepEqual(got, [31, 31, 67]); // (#962, diseño simple) medido: 21, 21, 55 + la cola fija LABEL_TAIL (10) de la etapa de etiquetas;
  const E = ['Esencia', 'Elefante', 'El Chino', 'Este mes', 'Es de casa', 'Detergente'];
  const listE = Array.from({ length: N }, (_, i) => `- ${E[i % E.length]} ${nm(i)} S/ 2.${p2(i)}\n`).join('');
  const neuE = '| Producto | Monto |\n|---|---|\n' + Array.from({ length: N }, (_, i) => `| ${E[i % E.length]} ${nm(i)} | S/ 2.${p2(i)} |\n`).join('');
  const gotE = [lag(listE), lag(neuE)]; console.log('# retención máx. por fila, nombres con E/el/es (lista, neutra): ' + gotE.join(', '));
  assert.deepEqual(gotE, [71, 31]); // 84a49517 con el mismo arnés: 61, 21; (#962, diseño simple) + la cola fija LABEL_TAIL (10)
});

// ---------- Ampliación (Bot 5 sobre 84a49517: cantidades, ganancia/margen/utilidad, más comienzos, «(mi costo)», claves) ----------
const QTY = ['costo por 12.5 kg', 'costo de 2.5 kg', 'costo al 15%', 'margen 30%', 'costo x 0.5 kg', '(costo, 1.5 kg)', 'costo unitario 2.5 kg', 'costo por caja de 12.5', 'ganancia 1.5%', 'costo 1,5 kg', 'costo: 2.5 kg', 'costo del pack 2.5'];
const QPRE = ['Arroz S/ 45.00', '- Arroz S/ 45.00', '| Arroz | S/ 45.00 |', '1. Arroz S/ 45.00', 'Arroz\tS/ 45.00', 'Arroz S/ 45.00.'];
test('ampliación 1) cantidad o porcentaje (sin moneda) en la línea siguiente NO es su monto propio: el de arriba se tapa (texto, listas, filas)', () => {
  for (const pre of QPRE) for (const nx of QTY) for (const tail of ['\n', '', '\nGracias.']) { const t = pre + '\n' + nx + tail, f = same(t); hides(f, ['45.00']); assert.equal(same(t, 'owner'), t); }
  // con moneda sí es su monto propio (solo «costo»): el de arriba se ve
  for (const [t, vis, hid] of [['Arroz S/ 4.20\ncosto S/ 1.80', ['4.20'], ['1.80']], ['- Arroz S/ 4.20\n- costo PEN 1.80', ['4.20'], ['1.80']], ['| Arroz | S/ 4.20 |\n| costo | US$ 1.80 |', ['4.20'], ['1.80']],
    ['Arroz S/ 4.20\ncosto: $1.80', ['4.20'], ['1.80']], ['Arroz S/ 4.20\nEl costo es S/. 1.80', ['4.20'], ['1.80']]]) { const f = same(t); shows(f, vis); hides(f, hid); }
});
test('ampliación 2) ganancia, margen y utilidad NUNCA sueltan el monto de arriba, aunque traigan el suyo (texto, listas, filas, tab)', () => {
  const PRE2 = ['Galleta S/ 1.80', 'Galleta S/ 1.80.', 'La galleta sale S/ 1.80.', '- Galleta S/ 1.80', '- Galleta S/ 1.80.', '1. Galleta S/ 1.80', '1) Galleta S/ 1.80', '* Galleta S/ 1.80', '• Galleta S/ 1.80',
    '| Galleta | S/ 1.80 |', 'Galleta | S/ 1.80', 'Galleta\tS/ 1.80', '  - Galleta S/ 1.80'];
  for (const pre of PRE2) for (const nx of ['ganancia S/ 0.70', 'margen S/ 0.70', 'utilidad S/ 0.70', 'Ganancia: S/ 0.70', 'el margen S/ 0.70', 'la ganancia S/ 0.70']) {
    const t = pre + '\n' + nx + '\n', f = same(t); hides(f, ['1.80', '0.70']); assert.equal(same(t, 'owner'), t); }
  for (const t of ['• Galleta S/ 1.80\n• ganancia S/ 0.70', '| Galleta | S/ 1.80 |\n| ganancia S/ 0.70 | |', '1) Galleta S/ 1.80\n1) margen S/ 0.70']) hides(same(t), ['1.80', '0.70']);
});
test('ampliación 3) tras ítem/fila/tab también se quitan «la», «ese», «esa», «este», «esta», «es» del comienzo', () => {
  for (const pre of PRE) for (const nx of ['la ganancia', 'esa ganancia', 'esta ganancia', 'ese costo', 'este margen', 'es costo', 'Esta es la ganancia', 'Esa es la utilidad', 'es la ganancia', 'La utilidad']) {
    const t = pre + '\n' + nx + '\n', f = same(t); hides(f, ['1.80']); assert.equal(same(t, 'owner'), t); }
  for (const nx of ['- La leche S/ 3.00', '- Esa marca S/ 3.00', '- Esta semana S/ 3.00', '- Es nuevo S/ 3.00', '- Lavavajilla S/ 3.00', '- Estofado S/ 3.00']) shows(same('- Galleta S/ 2.50\n' + nx + '\n'), ['2.50', '3.00']);
});
test('ampliación 4) tabla de venta: 1.ª celda «(mi costo)», «mi costo», «el costo», «la ganancia» tapa esa fila y las siguientes (regla fija)', () => {
  const HV = '| Producto | PVP |\n|---|---|\n| Galleta | S/ 1.80 |\n';
  for (const c of ['(mi costo)', 'mi costo', 'el costo', 'la ganancia', '(costo)', 'Este es el margen', '(mi costo unitario)']) {
    const t = HV + `| ${c} | S/ 1.20 |\n| Arroz | S/ 1.21 |\n| Leche | S/ 1.22 |\n`, f = same(t); shows(f, ['1.80']); hides(f, ['1.20', '1.21', '1.22']); assert.equal(same(t, 'owner'), t); }
  // sin palabra del dueño en la 1.ª celda: se ve
  shows(same(HV + '| (mi favorito) | S/ 1.20 |\n| Arroz | S/ 1.21 |\n'), ['1.80', '1.20', '1.21']);
});
test('ampliación 5) claves en los dos roles: «:» o «=» tras las palabras de enlace; pin con 4-8 dígitos; hasta 4 palabras', () => {
  for (const role of [EMP, 'owner']) {
    for (const [t, want] of [['La clave del wifi: Zq9xK2mPw7', 'La clave del wifi: [oculto]'], ['La clave del wifi = Zq9xK2mPw7 fin.', 'La clave del wifi = [oculto] fin.'], ['El pin para la caja 4321 fin.', 'El pin para la caja [oculto] fin.'],
      ['El pin de la caja: 98765432 ok', 'El pin de la caja: [oculto] ok'], ['La contraseña de mi correo es Zq9xK2mPw7 fin.', 'La contraseña de mi correo es [oculto] fin.'], ['token de la api sk-test-FAKE-abc123 fin.', 'token de la api [oculto] fin.'],
      ['La clave del wifi Zq9xK2mPw7 fin.', 'La clave del wifi [oculto] fin.'], ['pin: 4321', 'pin: [oculto]'], ['Mi contraseña de caja es Ab12cd34 ok', 'Mi contraseña de caja es [oculto] ok']]) assert.equal(same(t, role), want, role + ' ' + t);
    // un número suelto sin etiqueta sigue igual (no es clave)
    assert.equal(same('Quedan 4321 unidades.', role), 'Quedan 4321 unidades.');
  }
});
test('ampliación: menor aceptado — «- Utilidades varias S/ 4.00» tras un ítem tapa (utilidad nunca suelta; se prefiere tapar)', () => {
  hides(same('- Galleta S/ 2.50\n- Utilidades varias S/ 4.00\n'), ['2.50', '4.00']);
  for (const t of ['1. Galleta S/ 2.50\nCostumbre de la casa: pan fresco.\n', '- Galleta S/ 2.50\ncostumbre\n', '| Galleta | S/ 2.50 |\n| Costilla | S/ 9.00 |\n', '- Galleta S/ 2.50\nMargarina S/ 3.00\n']) shows(same(t), ['2.50']);
});
