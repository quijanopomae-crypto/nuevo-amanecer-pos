// Bot 2 sobre 66f1ecb5 (tapado de más): (a) en la línea siguiente solo cuentan frases de compra, no «costo» suelto; (b) la palabra del
// dueño dentro de un ítem tapa solo ese ítem (salvo presentación antes de la lista); (c) «Compras del cliente:» no presenta la lista/tabla
// de abajo; (d) la presentación alcanza su párrafo o el anterior, un párrafo neutro en medio la corta. Lo pintado en partes = lo final.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextEmitter, redactFor } from '../../tools/cloudflare-lab/src/pos-assistant.js';

const EMP = 'empleado:consultas', red = redactFor(EMP), M = '[dato del Admin]';
function emit(text, n) { let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, red); for (let i = 0; i < text.length; i += n) e.push(text.slice(i, i + n)); e.flush(); return o; }
const BUL = [['- ', '- '], ['* ', '* '], ['• ', '• '], ['1. ', '2. '], ['1) ', '2) ']];
// [texto, montos que se ven, montos que se tapan]
const VISIBLE = [
  ['Arroz S/ 4.20\nEl costo lo ve el dueño.', ['4.20'], []],
  ['Arroz S/ 4.20\nLos costos los maneja el dueño.', ['4.20'], []],
  ...BUL.map(([a, b]) => ['Precios de hoy:\n' + a + 'Arroz: costo S/ 1.80\n' + b + 'Leche: S/ 3.80', ['3.80'], ['1.80']]),
  ['Leche Gloria\tS/ 3.70\ncosto\tS/ 1.80\nLeche Gloria\tS/ 3.80', ['3.70', '3.80'], ['1.80']],
  ['Leche Gloria\tS/ 3.70\nNo sé el costo\tS/ 1.80\nLeche Gloria\tS/ 3.80', ['3.70', '3.80'], ['1.80']],
  // (d, afinado): solo un párrafo neutro de 8+ palabras que no termina en «:» corta (o un título de venta)
  ['El costo lo vemos luego.\n\nAhora te cuento otra cosa distinta sobre la tienda de hoy.\n\n| Producto | Precio S/ |\n|---|---|\n| Galleta | S/ 2.50 |', ['2.50'], []],
  ['El costo es este.\n\nAhora te cuento otra cosa distinta sobre la tienda de hoy.\n\n- Arroz S/ 1.80', ['1.80'], []],
  ['El costo es este.\n\nAhora te cuento otra cosa distinta sobre la tienda de hoy.\n\nArroz S/ 1.80', ['1.80'], []],
  ['Te paso los costos:\n\nPrecios de hoy:\n- Galleta S/ 1.80', ['1.80'], []],
  ['Compras del cliente: S/ 30', ['30'], []], ['Compras de los clientes: S/ 30', ['30'], []], ['El cliente pagó sus compras: S/ 30', ['30'], []],
  ['El cliente compró sus cosas: S/ 30', ['30'], []], ['S/ 30 es lo que el cliente compró', ['30'], []],
  ['Compras del cliente:\n- Galleta S/ 2.50\n- Leche S/ 3.80', ['2.50', '3.80'], []],
  ['Compras del cliente:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 2.50 |', ['2.50'], []],
];
const MASKED = [
  'Arroz S/ 4.20\n(costo)', 'Arroz S/ 4.20\nlo que pagué', 'Arroz S/ 4.20\nes lo que pagué', 'Arroz S/ 4.20\nme costó eso',
  'Arroz S/ 4.20\nvendido a costo', 'Arroz S/ 4.20\nprecio de compra', 'Arroz S/ 4.20\ncosto de compra', 'Arroz S/ 4.20\ncostó así', 'Arroz S/ 4.20\nlo pagamos así',
  'Te paso los costos:\n- Arroz S/ 1.80\n- Leche S/ 3.80', 'Costos de hoy:\n- Arroz S/ 1.80\n- Leche S/ 3.80', 'Esto es lo que pagué.\n- Arroz S/ 1.80\n- Leche S/ 3.80',
  'El costo es este.\n\n- Arroz S/ 1.80', 'Costo del arroz:\n\nS/ 1.80', 'Compras del cliente:\n- Galleta costo S/ 2.50', 'Compras del cliente:\n- Galleta S/ 2.50 (lo que pagué)',
  'Compras de hoy:\n- Galleta S/ 2.50', 'Costo del pedido del cliente: S/ 1.80',
  // vuelven a taparse con la regla afinada (párrafo neutro corto o que termina en «:» no corta): se prefiere tapar
  'El costo lo vemos luego.\n\nAquí va otro párrafo sin montos.\n\n| Producto | Precio S/ |\n|---|---|\n| Galleta | S/ 2.50 |', 'El costo es este.\n\nOtro párrafo.\n\n- Arroz S/ 1.80',
  'Te paso los costos:\n\nSon de esta semana.\n\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |', 'Te paso los costos:\n\nEstos son los que anoté ayer en la tienda central de Lima:\n\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |',
  // «para el cliente» NO es la excepción
  'Compras para el cliente: Galleta S/ 1.80, Arroz S/ 3.10', 'Compras para el cliente:\n- Galleta S/ 1.80\n- Arroz S/ 3.10', 'Compras para los clientes: Galleta S/ 1.80', 'El cliente me dijo que lo compró a S/ 1.80',
];
test('Bot 2 (a)–(d): los casos tapados de más ahora se ven; lo del dueño en el mismo ítem/fila sigue tapado', () => {
  for (const [t, vis, hid] of VISIBLE) { const o = red(t); for (const a of vis) assert.ok(o.includes(a), JSON.stringify(t) + ' → ' + JSON.stringify(o)); for (const a of hid) assert.ok(!o.includes(a), JSON.stringify(o)); }
});
test('Bot 2 (a)–(d): frases de compra en la línea siguiente, presentación antes de la lista y título de compras siguen tapando todo', () => {
  for (const t of MASKED) { const o = red(t); assert.ok(o.includes(M) && !/S\/ \d/.test(o.replace(/costo: \[dato del Admin\]/, '')), JSON.stringify(t) + ' → ' + JSON.stringify(o)); }
});
for (const n of [1, 2, 3, 5, 7, 47]) test('Bot 2 (a)–(d) en partes de ' + n + ': igual a lo final', () => {
  for (const t of [...VISIBLE.map((x) => x[0]), ...MASKED]) assert.equal(emit(t, n), red(t), n + ' ' + JSON.stringify(t));
});
test('Bot 2 (a)–(d), propiedad: textos armados al azar con párrafos, ítems, «costo» en la línea siguiente y «cliente», en cortes al azar = lo final', () => {
  const P = ['Precios de hoy:', 'Compras del cliente:', 'Te paso los costos:', 'El costo es este.', 'Otro párrafo.', '- Arroz S/ 1.80', '* Leche: costo S/ 2.10', '1. Pan S/ 0.50',
    'Arroz S/ 4.20', 'El costo lo ve el dueño.', '(costo)', 'costo: S/ 3.00', 'lo que pagué', 'a costo', '| Galleta | S/ 2.50 |', 'Leche\tS/ 3.70', '', 'No sé el costo.'];
  let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let c = 0; c < 3000; c++) {
    const t = Array.from({ length: 2 + Math.floor(rnd() * 6) }, () => P[Math.floor(rnd() * P.length)]).join('\n');
    let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, red);
    for (let i = 0; i < t.length;) { const n = 1 + Math.floor(rnd() * 9); e.push(t.slice(i, i + n)); i += n; } e.flush();
    assert.equal(o, red(t), JSON.stringify(t));
  }
});
