// Capacidad del asistente (A2): lógica PURA nueva de asistente-core.js (sin red, sin pantalla, sin tokens):
// espera ante el tope de confirmaciones por minuto (429), aclaración de pedidos ambiguos,
// un solo nombre de acción («Confirmar») y textos de progreso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const T0 = 1700000000000; // un instante cualquiera; MIN = inicio de su minuto de reloj
const MIN = Math.floor(T0 / 60000) * 60000;

test('isRateLimitResult / retryWaitSeconds: solo el 429 se reintenta solo; la espera sale del servidor (+1 s) con tope de 90 s', () => {
  assert.equal(C.isRateLimitResult({ ok: false, code: 'rate_limited' }), true);
  assert.equal(C.isRateLimitResult({ ok: false, code: 'HTTP_429' }), true);
  for (const code of ['network', 'confirm_expired', 'forbidden_role', 'precheck', 'error']) assert.equal(C.isRateLimitResult({ ok: false, code }), false, code);
  assert.equal(C.isRateLimitResult({ ok: true, code: 'rate_limited' }), false);
  assert.equal(C.isRateLimitResult(null), false);
  assert.equal(C.retryWaitSeconds({ retry_after_s: 12 }, 0), 13);
  assert.equal(C.retryWaitSeconds({ retry_after_s: 4.2 }, 0), 6);
  assert.equal(C.retryWaitSeconds({ retry_after_s: 9999 }, 0), 90);
  assert.equal(C.retryWaitSeconds({}, MIN + 50000), 11);
  assert.equal(C.retryWaitSeconds(null, MIN + 59999), 2);
  assert.equal(C.retryWaitSeconds({ retry_after_s: 0 }, MIN + 30000), 31);
});
test('waitText: «Espera N segundos…» en singular y plural', () => {
  assert.equal(C.waitText(1), 'Espera 1 segundo…');
  assert.equal(C.waitText(12), 'Espera 12 segundos…');
  assert.equal(C.waitText(0), 'Espera 1 segundo…');
  assert.equal(C.waitText(2.2), 'Espera 3 segundos…');
});
test('unifyActionWords: «Aplicar» pasa a «Confirmar» (un solo nombre de acción)', () => {
  assert.equal(C.unifyActionWords('Son 3 productos; cada uno se aplica aparte con su «Aplicar».'), 'Son 3 productos; cada uno se aplica aparte con su «Confirmar».');
  assert.equal(C.unifyActionWords('Pulsa Aplicar para guardar'), 'Pulsa Confirmar para guardar');
  assert.equal(C.unifyActionWords('Aplicar el descuento en Config'), 'Aplicar el descuento en Config', 'no toca otras frases');
  assert.equal(C.unifyActionWords(null), '');
});
test('thinkingText: nada antes de 3 s; luego «Pensando…», avisos a los 10, 25 y 60 s, sin prometer cambios hechos', () => {
  assert.equal(C.thinkingText(0), ''); assert.equal(C.thinkingText(2.9), ''); assert.equal(C.thinkingText(NaN), '');
  assert.equal(C.thinkingText(3), 'Pensando…'); assert.equal(C.thinkingText(9.9), 'Pensando…');
  assert.match(C.thinkingText(10), /^Sigo pensando… \(10 s\)/);
  assert.match(C.thinkingText(24), /hasta unos 25 segundos/);
  assert.match(C.thinkingText(30), /más de lo normal \(30 s\)/);
  assert.match(C.thinkingText(90), /no se hizo ningún cambio/);
});
const CAT = [{ id: '1', nombre: 'Galleta Soda Field', precio: 1 }, { id: '2', nombre: 'Galletas Oreo x6', precio: 1.5 }, { id: '3', nombre: 'Arroz Costeño 1 kg', precio: 4.5 }, { id: '4', nombre: 'Gaseosa Inca Kola', precio: 3 }];
test('clarifyAmbiguous: «súbele un poco a las galletas» -> UNA pregunta con opciones de % y los productos encontrados', () => {
  const r = C.clarifyAmbiguous('súbele un poco a las galletas', CAT);
  assert.equal(r.dir, 'sube'); assert.equal(r.term, 'galleta'); assert.equal(r.count, 2);
  assert.match(r.question, /^¿Cuánto les subo\? Hay 2 productos con «galleta»: Galleta Soda Field, Galletas Oreo x6\. Toca una opción\.$/);
  assert.deepEqual(r.options.map((o) => o.label), ['+3%', '+5%', '+10%', 'Otro monto', 'Solo algunas']);
  assert.equal(r.options[0].text, 'Sube 3% el precio de: Galleta Soda Field; Galletas Oreo x6.');
  assert.ok(r.options.slice(0, 3).every((o) => o.pct > 0 && !o.fill) && r.options.slice(3).every((o) => o.fill && !o.text));
  const b = C.clarifyAmbiguous('bájale algo al arroz', CAT);
  assert.equal(b.dir, 'baja'); assert.equal(b.options[0].label, '−3%'); assert.match(b.question, /^¿Cuánto les bajo\? Hay 1 producto con «arroz»/);
  assert.equal(b.options.length, 4, 'con un solo producto no se ofrece «Solo algunas»');
});
test('clarifyAmbiguous: no interrumpe pedidos completos, preguntas, ni productos que no existen', () => {
  for (const t of ['sube 5% las galletas', 'súbele a las galletas a 1.50', 'sube el arroz a 5', 'cuánto debo subir las galletas', '¿puedo subirle a las galletas?', 'hola', 'stock de galletas',
    'súbele a los zapatos', 'sube las galletas cinco céntimos', 'súbele a las galletas a dos soles', 'bájale la mitad al arroz', 'sube las galletas al costo más margen', 'sube', 'x'.repeat(200) + ' sube galletas', 'sube las galletas oreo soda field inca kola arroz']) assert.equal(C.clarifyAmbiguous(t, CAT), null, t);
  assert.equal(C.clarifyAmbiguous('súbele a las galletas', []), null);
  assert.equal(C.clarifyAmbiguous('súbele a las galletas', null), null);
  assert.equal(C.clarifyAmbiguous(undefined, CAT), null);
});
test('clarifyAmbiguous: con muchos productos no lista todos los nombres (pide por el término) y no pasa de 1200 letras', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: String(i), nombre: 'Galleta Sabor Numero ' + i + ' con un nombre bastante largo para llenar', precio: 1 }));
  const r = C.clarifyAmbiguous('aumenta un toque las galletas', many);
  assert.equal(r.count, 40);
  assert.match(r.options[1].text, /^Sube 5% el precio de todos los productos que tengan «galleta» en el nombre \(40\)\.$/);
  assert.ok(r.options.every((o) => (o.text || o.fill).length < 1200)); assert.ok(r.names.length <= 12);
});
test('el código nuevo no usa red, tokens ni PIN: solo funciones puras exportadas', () => {
  for (const k of ['isRateLimitResult', 'retryWaitSeconds', 'waitText', 'unifyActionWords', 'thinkingText', 'clarifyAmbiguous']) assert.equal(typeof C[k], 'function', k);
  const src = C.retryWaitSeconds.toString() + C.thinkingText.toString() + C.clarifyAmbiguous.toString();
  assert.doesNotMatch(src, /fetch|XMLHttpRequest|confirm_token|NA_ROLES|localStorage|innerHTML/);
});
