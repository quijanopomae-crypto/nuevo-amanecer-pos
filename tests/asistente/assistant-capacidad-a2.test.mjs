// Capacidad del asistente (A2): lógica PURA nueva de asistente-core.js (sin red, sin pantalla, sin tokens):
// espera ante el tope de confirmaciones por minuto, plan de «Confirmar todo», aclaración de pedidos ambiguos,
// un solo nombre de acción («Confirmar») y textos de progreso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const T0 = 1700000000000; // un instante cualquiera; MIN = inicio de su minuto de reloj
const MIN = Math.floor(T0 / 60000) * 60000;

test('confirmPace: hasta 5 confirmaciones por minuto de reloj no esperan; la sexta espera hasta el próximo minuto (+1 s)', () => {
  const now = MIN + 20000;
  assert.equal(C.confirmPace([], now), 0);
  assert.equal(C.confirmPace([now - 1000, now - 900, now - 800, now - 700], now), 0);
  assert.equal(C.confirmPace([now - 5, now - 4, now - 3, now - 2, now - 1], now), 41); // faltan 40 s + 1 s de margen
  assert.equal(C.confirmPace([MIN - 1, MIN - 2, MIN - 3, MIN - 4, MIN - 5, MIN - 6], now), 0, 'las del minuto anterior ya no cuentan');
  assert.equal(C.confirmPace(Array(7).fill(MIN + 1), MIN + 59999), 2);
});
test('confirmPace: límite distinto, entradas raras y reloj roto no lanzan ni bloquean', () => {
  assert.equal(C.confirmPace([MIN + 1, MIN + 2], MIN + 10, 2) > 0, true);
  assert.equal(C.confirmPace(null, MIN), 0);
  assert.equal(C.confirmPace(['x', NaN, undefined], MIN), 0);
  assert.equal(C.confirmPace([MIN], NaN), 0);
  assert.equal(C.CONFIRMS_PER_MINUTE, 5);
});
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
test('batchPlan: solo precio y ajuste de UN toque sin avisos; el resto se confirma una por una; con menos de 2 no hay lote', () => {
  const plan = C.batchPlan([
    { key: 'a', type: 'precio', oneTap: true }, { key: 'b', type: 'ajuste', oneTap: true }, { key: 'c', type: 'precio', oneTap: false },
    { key: 'd', type: 'compra', oneTap: true }, { key: 'e', type: 'costo', oneTap: true }, { key: 'f', type: 'producto', oneTap: true },
    { key: 'g', type: 'configuracion', oneTap: true }, { key: 'h', type: 'precio' }, null, { type: 'precio', oneTap: true }]);
  assert.deepEqual(plan.keys, ['a', 'b']);
  assert.equal(plan.skipped, 6);
  assert.equal(plan.usable, true);
  assert.equal(C.batchPlan([{ key: 'a', type: 'precio', oneTap: true }]).usable, false);
  assert.equal(C.batchPlan([]).usable, false);
  assert.equal(C.batchPlan(undefined).usable, false);
  assert.equal(C.batchPlan([{ key: 'a', type: 'precio', oneTap: 'true' }, { key: 'b', type: 'precio', oneTap: 1 }]).keys.length, 0, 'oneTap tiene que ser exactamente true');
});
test('batchProgressText y batchSummary: textos claros, sin códigos, con lo guardado y lo pendiente', () => {
  assert.equal(C.batchProgressText(2, 5, 'Galleta Soda'), 'Confirmando 2 de 5: Galleta Soda…');
  assert.equal(C.batchProgressText(1, 2), 'Confirmando 1 de 2…');
  assert.deepEqual(C.batchSummary({ ok: 5, total: 5 }), { state: 'done', msg: 'Listo: los 5 cambios se guardaron.' });
  assert.equal(C.batchSummary({ ok: 1, total: 1 }).msg, 'Listo: 1 cambio guardado.');
  const p = C.batchSummary({ ok: 2, fail: 1, skipped: 2, total: 5, stopped: true, rest: 1 });
  assert.equal(p.state, 'partial');
  for (const part of ['Se guardaron 2 de 5.', '1 no se pudo', '2 tienen avisos', '1 quedó sin confirmar', 'revises Inventario']) assert.ok(p.msg.includes(part), part + ' en ' + p.msg);
  assert.equal(C.batchSummary({ ok: 2, skipped: 1, total: 3 }).state, 'partial');
  assert.doesNotMatch(p.msg, /rate_limited|network|_/);
});
test('unifyActionWords / batchNote: «Aplicar» pasa a «Confirmar»; con lote disponible el aviso de N productos lo dice', () => {
  assert.equal(C.unifyActionWords('Son 3 productos; cada uno se aplica aparte con su «Aplicar».'), 'Son 3 productos; cada uno se aplica aparte con su «Confirmar».');
  assert.equal(C.unifyActionWords('Pulsa Aplicar para guardar'), 'Pulsa Confirmar para guardar');
  assert.equal(C.unifyActionWords('Aplicar el descuento en Config'), 'Aplicar el descuento en Config', 'no toca otras frases');
  assert.equal(C.unifyActionWords(null), '');
  assert.equal(C.batchNote('Listo. Son 4 productos; cada uno se aplica aparte con su «Aplicar».', 4), 'Listo. Son 4 productos. Toca «Confirmar todo (4)» o confirma uno por uno.');
  assert.equal(C.batchNote('Son 4 productos; cada uno se aplica aparte con su «Aplicar».', 1), 'Son 4 productos; cada uno se aplica aparte con su «Confirmar».');
  assert.equal(C.batchNote('Hola', 5), 'Hola');
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
  for (const k of ['confirmPace', 'isRateLimitResult', 'retryWaitSeconds', 'waitText', 'batchPlan', 'batchProgressText', 'batchSummary', 'unifyActionWords', 'batchNote', 'thinkingText', 'confirmLimit', 'batchSchedule', 'clarifyAmbiguous']) assert.equal(typeof C[k], 'function', k);
  const src = C.confirmPace.toString() + C.batchPlan.toString() + C.clarifyAmbiguous.toString();
  assert.doesNotMatch(src, /fetch|XMLHttpRequest|confirm_token|NA_ROLES|localStorage|innerHTML/);
});

test('confirmLimit (M-3): lee el tope por minuto de una configuración; 5 por defecto; valores raros vuelven a 5', () => {
  assert.equal(C.confirmLimit(undefined), 5);
  assert.equal(C.confirmLimit({}), 5);
  assert.equal(C.confirmLimit({ confirms_per_minute: 30 }), 30);
  assert.equal(C.confirmLimit({ confirmsPerMinute: 12.9 }), 12);
  for (const bad of [0, -3, 'x', NaN, 61, null]) assert.equal(C.confirmLimit({ confirms_per_minute: bad }), 5, String(bad));
});
test('batchSchedule (M-2): calendario estimado del lote; la que cruza el minuto espera al siguiente (+1 s)', () => {
  const now = MIN + 20000;
  assert.deepEqual(C.batchSchedule(3, [], now, 5, 4000), [0, 4000, 8000]);
  const six = C.batchSchedule(6, [], now, 5, 4000);
  assert.equal(six[4], 16000);
  assert.equal(six[5], MIN + 61000 - now, 'la 6.ª sale 1 s después del próximo minuto de reloj');
  assert.equal(C.batchSchedule(1, [now - 1, now - 2, now - 3, now - 4, now - 5], now, 5, 4000)[0], MIN + 61000 - now, 'cuenta las ya gastadas en este minuto');
  assert.deepEqual(C.batchSchedule(6, [], now, 30, 4000), [0, 4000, 8000, 12000, 16000, 20000], 'con un tope mayor no espera');
  assert.deepEqual(C.batchSchedule(2, [], NaN, 5, 4000), []);
});
test('batchSummary (H-2/M-1/M-2): solo dice «Listo» si TODAS se guardaron; detenido/vencido/pendiente nunca lo dicen', () => {
  assert.equal(C.batchSummary({ ok: 3, total: 3 }).state, 'done');
  for (const o of [{ ok: 0, total: 3, fail: 1, rest: 2 }, { ok: 2, total: 3, user: true, rest: 1 }, { ok: 2, total: 3, expired: 1 }, { ok: 2, total: 3, rest: 1 }]) {
    const r = C.batchSummary(o); assert.equal(r.state, 'partial'); assert.doesNotMatch(r.msg, /Listo/);
  }
  const r = C.batchSummary({ ok: 0, total: 3, fail: 1, rest: 2, stopped: true });
  assert.match(r.msg, /Se guardaron 0 de 3\./); assert.match(r.msg, /2 quedaron sin confirmar/); assert.match(r.msg, /No repitas lo ya guardado/);
  assert.match(C.batchSummary({ ok: 2, total: 3, user: true, rest: 1 }).msg, /^Lo detuviste\./);
  assert.match(C.batchSummary({ ok: 1, total: 3, expired: 2 }).msg, /2 vencieron \(la firma dura 5 minutos\)/);
});
