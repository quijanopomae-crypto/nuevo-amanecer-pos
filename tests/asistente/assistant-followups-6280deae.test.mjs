// Sobre 6280deae (Bot 5 FALLA + límites de Bots 3/5): 1) la línea siguiente que EMPIEZA con costo/margen/ganancia/utilidad tapa el monto del
// ítem de lista o la fila de ARRIBA (solo ese), decidido con ~20 caracteres; una fila de una tabla de VENTA no mira la línea siguiente y una
// fila «| costo … |» en ella tapa sus montos y abre la regla fija; 2) «S/ 1.80.» + salto mira igual la línea siguiente; 3) «sigue» lleva el
// ORIGEN de la regla fija ('col' | 'intro'); 4) DNI/RUC con (?<![0-9]) delante; 5) «data image/png;base64» sin «:» y «La clave del wifi X».
// Partes (1/2/3/7/13/47) = entero en todo. Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, assistantConfirmRoute, issueConfirmToken, toProposal, parseChatBody, sanitizeContext, redactModelOwner, createMemoryUsageStore, createTextEmitter, redactFor, redactText, redactOwnerData, capReply, cutPrime, ownerHold, CUT_NOTICE, REPLY_MAX } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas';
const M = '[dato del Admin]';
const red = (t, role = EMP) => redactFor(role)(t);
function emit(text, role, n, max = 1e9, prime = false) { let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, max, redactFor(role), role === 'owner' ? null : ownerHold, prime); for (let i = 0; i < text.length; i += n) e.push(text.slice(i, i + n)); e.flush(); return o; }
const SIZES = [1, 2, 3, 7, 13, 47];
const same = (t, role = EMP) => { const f = red(t, role); for (const n of SIZES) assert.equal(emit(t, role, n), f, role + ' trozos de ' + n + ': ' + JSON.stringify(t)); return f; };
const primedWith = (t, p) => { const f = redactOwnerData(redactText(t), p); for (const n of SIZES) assert.equal(emit(t, EMP, n, 1e9, p), f, '«sigue» (' + String(p) + ') trozos de ' + n); return f; };
const has = (t, m) => new RegExp('(^|[^\\d])' + m.replace(/[.$*+?()[\]{}|\\^/]/g, '\\$&') + '(?![\\d])').test(t);
const hides = (f, xs) => xs.forEach((x) => assert.ok(!has(f, x), 'se ve ' + x + ': ' + JSON.stringify(f)));
const shows = (f, xs) => xs.forEach((x) => assert.ok(has(f, x), 'no se ve ' + x + ': ' + JSON.stringify(f)));

const LONG = 'Esta nota tiene más de ocho palabras para ver qué pasa ahora.';
// ---------- 1) ítem / fila + línea siguiente ----------
const BOT5 = ['- Galleta S/ 1.80\ncosto unitario', '1. Galleta S/ 1.80\n(mi costo)', '* Galleta S/ 1.80\nmargen', '• Galleta S/ 1.80\nganancia', '| Galleta | S/ 1.80 |\ncosto unitario',
  'Galleta\tS/ 1.80\nutilidad', 'Galleta S/ 1.80.\ncosto unitario', '- Galleta S/ 1.80\n- costo unitario', '| Galleta | S/ 1.80 |\n| costo unitario | |', '- Galleta S/ 1.80\n  costo unitario',
  'La galleta sale S/ 1.80.\ncosto unitario.', 'a) Galleta S/ 1.80\nb) costo unitario'];
test('1) Bot 5: los 9 mínimos (y sus variantes) tapan el 1.80 para el empleado; el dueño ve todo; partes = entero', () => {
  for (const t of BOT5) for (const tail of ['', '\n', '\nGracias.']) { const f = same(t + tail); hides(f, ['1.80', '0.70']); assert.ok(f.includes(M), f); assert.equal(same(t + tail, 'owner'), t + tail); }
});
const NX_START = ['costo unitario', 'es el costo', 'de costo', '(mi costo)', 'margen', '(costo por unidad)', 'ganancia del mes', 'utilidad', 'Costo total', 'márgenes del mes'];
const PRE = [['guion', '- Galleta S/ 1.80'], ['num', '1. Galleta S/ 1.80'], ['ast', '* Galleta S/ 1.80'], ['fila', '| Galleta | S/ 1.80 |'], ['tab', 'Galleta\tS/ 1.80'], ['bala', '• Galleta S/ 1.80'], ['letra', 'a) Galleta S/ 1.80'], ['sinbordes', 'Galleta | S/ 1.80']];
test('1) ítem/fila × línea siguiente que EMPIEZA con una palabra del dueño (tras «(», «mi», «es el», «de»): solo ese monto se tapa', () => {
  for (const [, pre] of PRE) for (const nx of NX_START) { const t = 'Hola.\n' + pre + '\n' + nx + '\n\n' + LONG + '\n\nArroz S/ 4.20\n'; const f = same(t); hides(f, ['1.80', '0.70']); shows(f, ['4.20']); }
  // la frase con punto final: igual (y la regla corta de texto sigue para las líneas sin viñeta)
  for (const nx of [...NX_START, 'el costo', 'Ese es el margen']) { const f = same('La galleta sale S/ 1.80.\n' + nx + '.\n'); hides(f, ['1.80']); }
});
test('1) límites (Bots 3/5): en ítems/filas NO se usa la regla de línea corta (40/5); desde 84a49517 «el costo» o «Ese es el margen» tras un ítem tapan por el comienzo («el», «ese es el»); en texto también', () => {
  for (const [, pre] of PRE) for (const nx of ['el costo', 'Ese es el margen']) { const f = same(pre + '\n' + nx + '\n'); hides(f, ['1.80']); }
  for (const nx of ['el costo', 'Ese es el margen']) hides(same('Galleta S/ 1.80\n' + nx + '\n'), ['1.80']);
});
test('1) Bot 2 b sigue: la palabra del dueño DENTRO de un ítem/fila hermano con SU monto tapa solo ese ítem; listas y tablas de precios se ven', () => {
  for (const [t, vis, hid] of [['- Arroz S/ 4.20\n- costo S/ 1.80', ['4.20'], ['1.80']], ['Leche Gloria\tS/ 3.70\ncosto\tS/ 1.80\nLeche Gloria\tS/ 3.80', ['3.70', '3.80'], ['1.80']],
    ['| Galleta | S/ 2.50 |\n| costo unitario | S/ 1.20 |', ['2.50'], ['1.20']], ['1. Arroz S/ 4.20\n2. Margen 30%\n3. Leche S/ 3.80', ['3.80'], ['4.20', '30%']] /* 84a49517: margen nunca suelta el de arriba */,
    ['- Galleta S/ 2.50\n- Arroz S/ 4.20\n- Leche S/ 3.80', ['2.50', '4.20', '3.80'], []], ['| A | S/ 2.50 |\n| B | S/ 4.20 |', ['2.50', '4.20'], []],
    ['- Galleta S/ 2.50\n- El costo lo ve el dueño.', [], ['2.50']], ['- Galleta S/ 2.50\n- Costeño 1 kg S/ 4.20', ['2.50', '4.20'], []], ['- Galleta S/ 2.50\n- Margarina S/ 3.10', ['2.50', '3.10'], []],
    ['| Arroz | S/ 4.20 |\n| Costa Rica café | S/ 9.90 |', ['4.20', '9.90'], []], ['- Galleta S/ 2.50\n- de la casa S/ 3.00', ['2.50', '3.00'], []], ['- Galleta S/ 2.50\n- mixto S/ 3.00', ['2.50', '3.00'], []]]) {
    const f = same(t); shows(f, vis); hides(f, hid); }
});
test('1) tabla de VENTA (Bots 3/5): sus filas no miran la línea siguiente; una fila cuya 1.ª celda empieza con costo/margen/ganancia/utilidad tapa sus montos y abre la regla fija (origen col)', () => {
  const t = '| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |\n| costo unitario | S/ 1.20 |\n| Arroz | S/ 4.20 |';
  const f = same(t); shows(f, ['1.80']); hides(f, ['1.20', '4.20']); assert.equal(same(t, 'owner'), t);
  for (const h of ['PVP', 'P. venta', 'Venta', 'Precio de venta']) for (const w of ['costo unitario', 'Margen', 'ganancia', 'Utilidad neta']) {
    const g = same(`| Producto | ${h} |\n|---|---|\n| Galleta | S/ 1.80 |\n| ${w} | S/ 1.20 |\n| Arroz | S/ 4.20 |\n`); shows(g, ['1.80']); hides(g, ['1.20', '4.20']); }
  // sin fila del dueño: todo se ve, también con «costo» más adelante en la celda o en una línea siguiente
  shows(same('| Producto | PVP |\n|---|---|\n| Galleta | S/ 1.80 |\n| Arroz | S/ 4.20 |\n'), ['1.80', '4.20']);
  // la regla fija abierta por la fila se suelta con una cabecera nueva sin columna del dueño (como una columna del dueño)
  const r = same(t + '\n\n| Producto | Monto |\n|---|---|\n| Leche | S/ 3.80 |\n'); hides(r, ['1.20', '4.20']); shows(r, ['1.80', '3.80']);
  // el corte con esa regla abierta pide contexto con origen «col»
  const rows = Array.from({ length: 40 }, (_, i) => `| Producto número ${i} | S/ 2.${String(i).padStart(2, '0')} |\n`).join('');
  const cut = capReply(red('| Producto | PVP |\n|---|---|\n| costo unitario | S/ 1.20 |\n' + rows)); assert.ok(cut.endsWith(CUT_NOTICE)); assert.equal(cutPrime(cut, true), 'col');
});
test('1) retención: 120 filas de una tabla de venta / neutra y 120 ítems de una lista de precios esperan lo mismo que en 6280deae (medido)', () => {
  const N = 120, p2 = (i) => String(i % 100).padStart(2, '0'), nm = (i) => 'abcdefghijklmnopqrstuvwxyz'[i % 26] + 'abcdefghijklmnopqrstuvwxyz'[(i / 26) | 0] + ' de la casa';
  const lag = (t) => { assert.equal(red(t), t); let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, redactFor(EMP), ownerHold);
    const ends = [...t.matchAll(/S\/ \d\.\d\d/g)].map((m) => m.index + m[0].length); let r = 0, mx = 0;
    for (let i = 0; i < t.length; i++) { e.push(t[i]); while (r < ends.length && o.length >= ends[r]) { mx = Math.max(mx, i + 1 - ends[r]); r++; } } e.flush(); return mx; };
  const sale = '| Producto | PVP |\n|---|---|\n' + Array.from({ length: N }, (_, i) => `| Producto ${nm(i)} | S/ 2.${p2(i)} |\n`).join('');
  const neutral = '| Producto | Monto |\n|---|---|\n' + Array.from({ length: N }, (_, i) => `| Producto ${nm(i)} | S/ 2.${p2(i)} |\n`).join('');
  const list = Array.from({ length: N }, (_, i) => `- Producto ${nm(i)} S/ 2.${p2(i)}\n`).join('');
  const got = [lag(sale), lag(neutral), lag(list)]; console.log('# retención máx. por fila (venta, neutra, lista): ' + got.join(', '));
  assert.deepEqual(got, [31, 31, 67]); // (#962, diseño simple) medido: 21, 21, 55 + la cola fija LABEL_TAIL (10) de la etapa de etiquetas; // iguales a 6280deae (medido con el mismo arnés: 21, 21, 55)
});

// ---------- 2) punto al final de la línea del monto ----------
test('2) «S/ 1.80.» + salto: se mira la línea siguiente; «Gracias.» o una línea neutra no tapa', () => {
  for (const t of ['Galleta S/ 1.80.\ncosto unitario', 'Galleta S/ 1.80. \ncosto unitario', 'Galleta S/ 1.80.\r\n(mi costo)', 'Galleta S/ 1.80.\n\nmargen', 'La galleta sale S/ 1.80.\nganancia neta.']) hides(same(t), ['1.80']);
  for (const t of ['Galleta S/ 2.50.\nGracias.', 'Galleta S/ 2.50.\nEl costo lo ve el dueño.', 'Galleta S/ 2.50. Arroz S/ 4.20.\nLeche fresca S/ 3.80.', 'Galleta S/ 2.50.']) assert.equal(same(t), t);
});

// ---------- 3) «sigue» con origen ----------
const rowsC = (n) => Array.from({ length: n }, (_, i) => `| P${i} | S/ 1.${String(i).padStart(2, '0')} | S/ 2.${String(i).padStart(2, '0')} |\n`).join('');
const COLCUT = () => capReply(red('| Producto | Costo | PVP |\n|---|---|---|\n' + rowsC(60)));
const INTROCUT = () => capReply(red('Te paso los costos:\n| Producto | Precio |\n|---|---|\n' + Array.from({ length: 60 }, (_, i) => `| P${i} | S/ 1.${String(i).padStart(2, '0')} |\n`).join('')));
test('3) cutPrime da el origen: tabla con columna del dueño → «col»; presentación del dueño → «intro»; sin marca o venta → false', () => {
  assert.equal(cutPrime(COLCUT(), true), 'col'); assert.equal(cutPrime(INTROCUT(), true), 'intro'); assert.equal(cutPrime(COLCUT()), false);
  // columna del dueño + otra cosa abierta (ventana de una palabra del dueño al final): «intro» (más estricto)
  assert.equal(cutPrime('| Producto | Costo |\n|---|---|\n| A | S/ 1.80 |\n\nEl costo', true), 'intro');
});
test('3) «sigue» desde una columna del dueño: «| Producto | Monto |» + |---| suelta (como en la parte cortada); desde una presentación no; nunca destapa respecto de sin contexto', () => {
  const neutral = '| Producto | Monto |\n|---|---|\n| B | S/ 2.51 |\n';
  const pc = cutPrime(COLCUT(), true), pi = cutPrime(INTROCUT(), true);
  shows(primedWith(neutral, pc), ['2.51']); hides(primedWith(neutral, pi), ['2.51']);
  for (const cont of ['| B | S/ 1.81 |\n', 'B | S/ 1.81\n', 'B\tS/ 1.81\n', LONG + '\n\n| B | S/ 1.81 |\n', 'Precios:\n| B | S/ 1.81 |\n', '| Galleta | S/ 1.81 |\n|---|---|\n| B | S/ 1.82 |\n', '- B: S/ 1.81\n', 'B S/ 1.81\n',
    '| Producto | Costo | Precio |\n|---|---|---|\n| A | S/ 1.81 | S/ 1.82 |\n', neutral + '| C | S/ 2.52 |\n', '| Producto | PVP |\n|---|---|\n| B | S/ 2.51 |\n']) {
    const c = primedWith(cont, 'col'), i = primedWith(cont, 'intro'), z = redactOwnerData(redactText(cont), false);
    for (const m of cont.match(/\d\.\d\d/g) || []) { if (!has(z, m)) assert.ok(!has(c, m), 'destapa ' + m + ' respecto de sin contexto: ' + c);
      if (cont !== neutral + '| C | S/ 2.52 |\n' && !has(i, m)) assert.ok(!has(c, m), 'col destapa ' + m + ' respecto de intro fuera de la cabecera neutra: ' + c); }
    hides(c, cont.includes('Producto | Monto') || cont.includes('| PVP |') ? [] : ['1.81', '1.82']); }
  // «Precio» junto a una columna del dueño en la continuación sigue tapado como con «intro» (seeded: columnas de venta leídas como intro)
  hides(primedWith('| Producto | Costo | Precio |\n|---|---|---|\n| A | S/ 1.81 | S/ 1.82 |\n', 'col'), ['1.81', '1.82']);
});
test('3) origen alterado o desconocido → «intro» (lo más estricto)', () => {
  const neutral = '| Producto | Monto |\n|---|---|\n| B | S/ 2.51 |\n', ref = primedWith(neutral, 'intro');
  for (const p of [true, 'COL', 'col ', 'columna', 1, { src: 'col' }, ['col'], 'sale']) assert.equal(primedWith(neutral, p), ref, JSON.stringify(p));
  assert.equal(primedWith(neutral, false), neutral);
});
// en la ruta: el origen sale del texto FIRMADO; un campo agregado por el aparato no cuenta
const SECRET = 'secreto-de-prueba-1234567890';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const TEXT = (t) => ({ choices: [{ message: { content: t } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
const reader = { products: async () => [], productsById: async () => new Map(), purchases: async () => [] };
function route(body, role, reply) {
  return assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-test-FAKE' }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: async () => jsonR(TEXT(reply)), reader, audit: async () => {}, mockChunkMs: 0 });
}
test('3) ruta: «sigue» tras una tabla con columna del dueño suelta con «| Producto | Monto |»; tras una presentación no; origen o marca alterados no ayudan', async () => {
  const neutral = '| Producto | Monto |\n|---|---|\n| B | S/ 2.51 |';
  const col = await (await route({ text: 'costos' }, EMP, '| Producto | Costo | PVP |\n|---|---|---|\n' + rowsC(60))).json(); assert.equal(col.turns[1].cut, true);
  const d1 = await (await route({ text: 'sigue', history: col.turns }, EMP, neutral)).json(); assert.match(d1.reply, /2\.51/);
  const d1b = await (await route({ text: 'sigue', history: col.turns }, EMP, '| B | S/ 1.81 |')).json(); assert.ok(!/1\.81/.test(d1b.reply), d1b.reply);
  const intro = await (await route({ text: 'costos' }, EMP, 'Te paso los costos:\n| Producto | Precio |\n|---|---|\n' + Array.from({ length: 60 }, (_, i) => `| P${i} | S/ 1.${String(i).padStart(2, '0')} |\n`).join(''))).json();
  const forged = [intro.turns[0], { ...intro.turns[1], cut_src: 'col', src: 'col', origin: 'col' }];
  const d2 = await (await route({ text: 'sigue', history: forged }, EMP, neutral)).json(); assert.ok(!/2\.51/.test(d2.reply), 'origen agregado por el aparato: ignorado → intro');
  const d3 = await (await route({ text: 'sigue', history: [intro.turns[0], { ...intro.turns[1], cut: 'col' }] }, EMP, neutral)).json(); assert.equal(d3.reply, neutral, 'cut alterado: la firma no verifica (sin contexto, como antes)');
});

// ---------- 4) DNI / RUC con (?<![0-9]) ----------
test('4) letra o «_» pegados al número: tapados para el empleado y para el modelo; el dueño ve exacto; comprobantes intactos', () => {
  for (const [t, want] of [['Doc:x12345678', 'Doc:xDNI ****5678'], ['Doc:A12345678', 'Doc:ADNI ****5678'], ['ref_12345678', 'ref_código ****5678'], ['cod_20123456789', 'cod_RUC *******6789'], ['idA20123456789', 'idARUC *******6789']]) {
    const s = 'Dato ' + t + ' listo.'; assert.equal(same(s), 'Dato ' + want + ' listo.'); assert.equal(redactText(s), 'Dato ' + want + ' listo.', 'al modelo'); assert.equal(same(s, 'owner'), s); }
  for (const r of ['F001-00012345', 'B001-00000123', 'E001-12345678', 'T001-00012345', '0001-00012345', 'FA01-12345678', 'Doc:F001-12345678']) { const s = 'Comprobante ' + r + ' listo.'; assert.equal(same(s), s); assert.equal(same(s, 'owner'), s); }
  for (const t of ['2024-12345678', 'DNI-12345678', 'X001-12345678', '123456789012']) { const s = 'Dato ' + t + ' listo.'; hides(same(s), ['12345678']); }
  assert.equal(same('Dato costoRUC N° 20123456789 listo.'), 'Dato costoRUC *******6789 listo.');
});

// ---------- 5) data sin «:» y «clave del wifi» ----------
test('5) «data image/png;base64,…» sin «:» → [imagen omitida] (dueño y empleado); «La clave del wifi Zq9xK2mPw7» tapa el valor, no «del»', () => {
  const B = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldY';
  for (const tail of ['', ' =', ' es', ' era', ' de']) for (const ws of [' ', '   ', '\n', ' \n \n ', ' '.repeat(200), '\t\t']) for (const role of [EMP, 'owner']) {
    const f = same('Dato data' + tail + ws + 'image/png;base64,' + B + ' fin.', role); assert.ok(!f.includes(B) && f.includes('[imagen omitida]') && f.endsWith(' fin.'), f); }
  for (const role of [EMP, 'owner']) {
    assert.equal(same('La clave del wifi Zq9xK2mPw7 fin.', role), 'La clave del wifi [oculto] fin.');
    assert.equal(same('Mi contraseña de caja es Ab12cd34 ok', role), 'Mi contraseña de caja es [oculto] ok');
    assert.equal(same('el token para la api Tk9a8b7c6 listo', role), 'el token para la api [oculto] listo');
    // sin valor mezclado en 4 palabras: como siempre (se tapa lo que sigue a la etiqueta)
    assert.equal(same('la clave del pin es 1234', role), 'la clave del pin es [oculto]'); // 84a49517: \d{4,8} vale como valor
    assert.equal(same('clave: abc', role), 'clave: [oculto]'); assert.equal(same('token abcdefghijklmnop fin.', role), 'token [oculto] fin.'); }
});

// ---------- D') línea siguiente con SU monto (ventana de ~20 caracteres, Bots 2/3) ----------
test("D') (desde 84a49517 solo «costo» + monto con moneda) la línea siguiente con palabra del dueño y SU monto en sus primeros 20 caracteres tapa solo ese monto y suelta el de arriba; sin monto tapa el de arriba", () => {
  for (const [t, vis, hid] of [['Arroz S/ 4.20\nEl costo es S/ 1.80.', ['4.20'], ['1.80']], ['Galleta S/ 1.80\nganancia S/ 0.70', [], ['1.80', '0.70']], ['Galleta S/ 1.80\ncosto: S/ 1.20', ['1.80'], ['1.20']],
    ['- Galleta S/ 1.80\n- costo S/ 1.20', ['1.80'], ['1.20']], ['• Galleta S/ 1.80\nganancia S/ 0.70', [], ['1.80', '0.70']], ['| Galleta | S/ 1.80 |\n| costo unitario | S/ 1.20 |', ['1.80'], ['1.20']],
    ['Galleta S/ 1.80.\nmargen 30%', [], ['1.80', '30%']], // 84a49517: margen/ganancia/utilidad nunca sueltan; % sin moneda no es monto propio
    ['Galleta S/ 1.80\ncosto unitario', [], ['1.80']], ['Galleta S/ 1.80\n(mi costo)', [], ['1.80']], ['Galleta S/ 1.80\nEse es el margen', [], ['1.80']],
    ['Galleta S/ 1.80\ncosto unitario de la casa: S/ 1.20', [], ['1.80', '1.20']], ['- Galleta S/ 1.80\n- costo unitario del proveedor S/ 1.20', [], ['1.80', '1.20']]]) {
    const f = same(t); shows(f, vis); hides(f, hid); }
});
test("D') propiedad: ningún monto con etiqueta del dueño delante se ve nunca (línea siguiente, ítems, filas, partes al azar)", () => {
  let seed = 6280; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), pick = (a) => a[Math.floor(rnd() * a.length)];
  const PRE = ['Galleta S/ 2.50', '- Galleta S/ 2.50', '1. Galleta S/ 2.50', '| Galleta | S/ 2.50 |', 'Galleta\tS/ 2.50', 'Galleta S/ 2.50.'];
  const OWN = ['El costo es S/ 9.%', 'costo: S/ 9.%', 'ganancia S/ 9.%', '- costo S/ 9.%', '| costo unitario | S/ 9.% |', 'margen 9%%', 'costo unitario S/ 9.%', '(mi costo) S/ 9.%', 'utilidad: S/ 9.%'];
  for (let i = 0; i < 300; i++) { const own = pick(OWN).replace('%', String(10 + Math.floor(rnd() * 89))); const t = pick(PRE) + '\n' + own + pick(['', '\n', '\nGracias.']);
    const want = red(t), n = 1 + Math.floor(rnd() * 13); assert.equal(emit(t, EMP, n), want, JSON.stringify(t));
    const m = own.match(/9\.\d\d|9\d%/); if (m) assert.ok(!want.includes(m[0]), 'monto del dueño visible: ' + JSON.stringify(want)); }
});

// ---------- A/A'/A'') lo que va AL MODELO para el dueño ----------
const MODEL_TXT = 'Factura de Alicorp RUC 20100055237 y de Bodega Juan RUC 10456789012; código interno 12345678; EAN 87654321; cód. 11223344; barras: 99887766; DNI 45678912; suelto 34567812; F001-00012345.';
test("A) redactModelOwner: RUC 20/15/17 exacto, RUC 10 tapado, 8 dígitos con código/cód./EAN/barras o en su columna exactos, sueltos o con DNI tapados; clave/correo/teléfono tapados", () => {
  const o = redactModelOwner(MODEL_TXT + ' clave: Zq9xK2 correo ana@x.test cel 987654321 15123456789 17123456789');
  for (const x of ['20100055237', 'código interno 12345678', 'EAN 87654321', 'cód. 11223344', 'barras: 99887766', 'F001-00012345', '15123456789', '17123456789']) assert.ok(o.includes(x), x + ' → ' + o);
  for (const x of ['10456789012', '45678912', '34567812', 'Zq9xK2', 'ana@x.test', '987654321']) assert.ok(!o.includes(x), x + ' → ' + o);
  const tbl = redactModelOwner('| Producto | Código de barras | Lote |\n|---|---|---|\n| Galleta | 12345678 | 87654321 |\n| Arroz | 23456789 | 34567890 |');
  assert.ok(tbl.includes('| 12345678 |') && tbl.includes('| 23456789 |') && !tbl.includes('87654321') && !tbl.includes('34567890'), tbl);
  // el empleado (y lo que no sea dueño): todo tapado
  const e = redactText(MODEL_TXT); for (const x of ['20100055237', '10456789012', '12345678', '87654321', '45678912']) assert.ok(!e.includes(x), x + ' → ' + e);
  // parseChatBody / sanitizeContext con el rol del servidor
  const pb = parseChatBody({ text: MODEL_TXT, history: [{ role: 'assistant', content: 'Proveedor RUC 20100190797, DNI 44556677' }] }, 'owner');
  assert.ok(pb.text.includes('20100055237') && !pb.text.includes('10456789012') && pb.history[0].content.includes('20100190797') && !pb.history[0].content.includes('44556677'));
  for (const r of [undefined, null, 'empleado:consultas', 'OWNER', 'admin']) { const q = parseChatBody({ text: MODEL_TXT }, r); assert.ok(!q.text.includes('20100055237') && !q.text.includes('12345678'), String(r)); }
  const ctx = sanitizeContext({ products: [{ id: 'P1', nombre: 'Galleta cód. 12345678 prov RUC 20100055237 lote 87654321', precio: 1, stock: 1 }] }, 'owner');
  assert.equal(ctx.products[0].nombre, 'Galleta cód. 12345678 prov RUC 20100055237 lote código ****4321');
  assert.ok(!/12345678|20100055237/.test(sanitizeContext({ products: [{ id: 'P1', nombre: 'Galleta cód. 12345678 prov RUC 20100055237', precio: 1, stock: 1 }] }, 'empleado:consultas').products[0].nombre));
});
const SECRET2 = 'secreto-de-prueba-1234567890';
function routeCap(body, role, msg, cap) {
  return assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET2, AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-test-FAKE' }, { principalId: role === 'owner' ? 'session:dueno' : 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: async (u, init) => { cap.push(JSON.parse(init.body)); return jsonR({ choices: [{ message: msg }], usage: { prompt_tokens: 5, completion_tokens: 5 } }); }, reader, audit: async () => {}, mockChunkMs: 0 });
}
test("A/C) ruta: el pedido al modelo del DUEÑO lleva RUC de empresa y códigos exactos (mensaje, historial, contexto); el del empleado no; el par del dueño no sirve como historial del empleado", async () => {
  const body = { text: MODEL_TXT, history: [{ role: 'user', content: 'compras' }, { role: 'assistant', content: '| Comprobante | RUC |\n|---|---|\n| F001-00012345 | 20100190797 |' }],
    context: { products: [{ id: 'P1', nombre: 'Galleta cód. 12345678 prov RUC 20100055237', precio: 1, stock: 1 }] } };
  const capO = []; const d = await (await routeCap(body, 'owner', { content: 'Listo, RUC 20100055237.' }, capO)).json(); const so = JSON.stringify(capO[0]);
  for (const x of ['20100055237', '20100190797', 'código interno 12345678', 'cód. 12345678', 'EAN 87654321']) assert.ok(so.includes(x), 'dueño → modelo: falta ' + x);
  for (const x of ['10456789012', '45678912', '34567812']) assert.ok(!so.includes(x), 'dueño → modelo: ' + x);
  assert.match(d.reply, /20100055237/); assert.ok(d.turns[0].content.includes('20100055237'), 'el par firmado del dueño guarda el RUC exacto');
  const capE = []; await (await routeCap(body, 'empleado:consultas', { content: 'ok' }, capE)).json(); const se = JSON.stringify(capE[0]);
  for (const x of ['20100055237', '20100190797', '12345678', '87654321', '10456789012', '45678912']) assert.ok(!se.includes(x), 'empleado → modelo: ' + x);
  // el par firmado del dueño no verifica como historial del empleado (la clase va dentro de la firma)
  const capR = []; await (await routeCap({ text: 'sigue', history: d.turns }, 'empleado:consultas', { content: 'ok' }, capR)).json();
  assert.ok(!JSON.stringify(capR[0]).includes('20100055237') && !JSON.stringify(capR[0].messages).includes('Listo, RUC'), 'par del dueño descartado para el empleado');
});

// ---------- B/B') tarjeta de compra ----------
const TOOL = (args) => ({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'preparar_compra', arguments: JSON.stringify(args) } }] });
const LINEAS = [{ nombre: 'Galleta', cantidad: 3, costo_unitario: 1.2 }];
test("B) tarjeta de compra del dueño: RUC de empresa y comprobante exactos; RUC 10, DNI suelto o clave → campo VACÍO + completar (nunca la máscara)", async () => {
  const ok = toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Alicorp SAC RUC 20100055237', documento: 'F001-00012345 cód. 12345678', lineas: LINEAS } }, 'owner', { products: [] }, 1);
  assert.equal(ok.proveedor, 'Alicorp SAC RUC 20100055237'); assert.equal(ok.documento, 'F001-00012345 cód. 12345678'); assert.equal(ok.completar, undefined);
  // (desde 84a49517, Bot 2) el campo conserva la parte EXACTA antes de la máscara, sin la etiqueta suelta («RUC», «DNI», «clave:»)
  const PREFIX = { 'Bodega Juan RUC 10456789012': 'Bodega Juan', 'pedido 12345678': 'pedido', 'Juan DNI 45678912': 'Juan', 'clave: Zq9xK2 F001-1': '', 'Alicorp RUC *******5237': 'Alicorp', 'DNI ****5678': '', 'Prov [dato del Admin]': 'Prov' };
  for (const [prov, docu, miss] of [['Bodega Juan RUC 10456789012', 'F001-00012345', ['proveedor']], ['Alicorp SAC', 'pedido 12345678', ['documento']], ['Juan DNI 45678912', 'clave: Zq9xK2 F001-1', ['proveedor', 'documento']],
    ['Alicorp RUC *******5237', 'DNI ****5678', ['proveedor', 'documento']], ['Prov [dato del Admin]', 'F001-2', ['proveedor']]]) {
    const p = toProposal({ name: 'preparar_compra', arguments: { proveedor: prov, documento: docu, lineas: LINEAS } }, 'owner', { products: [] }, 1);
    assert.deepEqual(p.completar, miss, prov + ' / ' + docu); for (const n of miss) assert.equal(p[n], PREFIX[n === 'proveedor' ? prov : docu]);
    assert.ok(!/\*{3}|\[(?:dato|oculto)/.test(JSON.stringify(p)), 'nunca una máscara en la tarjeta: ' + JSON.stringify(p)); }
  const cap = []; const r = await (await routeCap({ text: 'arma la compra' }, 'owner', TOOL({ proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345', lineas: LINEAS }), cap)).json();
  assert.equal(r.proposals[0].proveedor, 'Bodega Juan'); assert.deepEqual(r.proposals[0].completar, ['proveedor']); assert.equal(r.proposals[0].documento, 'F001-00012345');
});
test("B') empleado que fuerza una tarjeta de compra: se descarta (forbidden_role), sin campos ni RUC en la respuesta, y no puede confirmar una compra", async () => {
  const p = toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Alicorp RUC 20100055237', documento: 'F001-00012345 cód. 12345678', lineas: LINEAS } }, 'empleado:consultas_documentos', { products: [] }, 1);
  assert.equal(p.dropped, 'forbidden_role'); assert.equal(p.proveedor, undefined);
  const cap = []; const r = await (await routeCap({ text: 'arma la compra' }, 'empleado:consultas_documentos', TOOL({ proveedor: 'Alicorp RUC 20100055237', documento: 'pedido 12345678', lineas: LINEAS, owner: true, rol: 'owner' }), cap)).json();
  assert.equal(r.proposals.length, 0); assert.ok(!JSON.stringify(r).includes('20100055237') && !JSON.stringify(r).includes('12345678'), JSON.stringify(r));
  // una tarjeta de compra firmada (aunque fuera del dueño) presentada desde una sesión de empleado: no se confirma
  const proposal = { id: 'x1', type: 'compra', needsConfirm: true, requiresRole: 'owner', title: 'Preparar compra', proveedor: 'Alicorp RUC 20100055237', lineas: [{ product_id: 'P1', nombre: 'Galleta', cantidad: 1, costo_unitario: 1 }] };
  const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET2 };
  for (const signedAs of ['owner', 'empleado:consultas_documentos']) {
    const token = await issueConfirmToken(proposal, signedAs, { principalId: 'session:x', posRole: 'empleado' }, SECRET2, Date.now());
    const res = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token, proposal }) }), env, { principalId: 'session:x', posRole: 'empleado' }, jsonR,
      { store: createMemoryUsageStore(), resolveRole: async () => 'empleado:consultas_documentos', verifyApproval: async () => true, reader, audit: async () => {} });
    assert.ok(res.status >= 400, signedAs + ' → ' + res.status); const b = await res.json(); assert.ok(!b.ok && !b.operation_id, JSON.stringify(b)); }
});

// ---------- B'') celular: campo vacío de la tarjeta ----------
function fakeDoc() {
  const mk = (tag) => { const n = { tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, value: '', id: '',
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, fire(t) { (this.listeners[t] || []).forEach((f) => f({ target: this })); }, focus() { fakeDoc.focused = this; } }; return n; };
  let created = 0; return { createElement(t) { created++; return mk(t); }, get created() { return created; } };
}
test("B'') celular: campo vacío con borde de alerta y «Complete este dato», foco en el primero, Confirmar apagado hasta llenarlo; nunca una máscara; solo createElement/textContent", () => {
  const doc = fakeDoc(); let changes = 0;
  const p = { type: 'compra', proveedor: '', documento: 'F001-', completar: ['proveedor', 'documento', 'otro'] };
  const need = C.needFields(doc, p, () => changes++); assert.ok(need); assert.equal(need.inputs.length, 2); assert.equal(need.missing(), 2);
  const [a, b] = need.inputs; assert.equal(a.className, 'na-asst-need'); assert.equal(a.getAttribute('aria-invalid'), 'true');
  const hint = a.parentNode.children[2]; assert.equal(hint.textContent, 'Complete este dato'); assert.equal(a.getAttribute('aria-describedby'), hint.id); assert.equal(need.first, a);
  a.value = 'RUC *******9012'; a.fire('input'); assert.equal(need.missing(), 2, 'una máscara no cuenta como dato');
  a.value = 'Bodega Juan RUC 10456789012'; a.fire('input'); assert.equal(need.missing(), 1); assert.equal(a.className, 'na-asst-need ok'); assert.equal(hint.hidden, true); assert.equal(a.getAttribute('aria-invalid'), 'false');
  assert.equal(b.value, 'F001-', 'parte exacta de inicio'); b.fire('input'); assert.equal(need.missing(), 1, 'solo la parte exacta no cuenta'); b.value = 'F001-00012345'; b.fire('input'); assert.equal(need.missing(), 0); assert.equal(changes, 4);
  Object.defineProperty(p, '_manual', { value: need.state, enumerable: false });
  assert.equal(C.purchaseValue(p, 'proveedor'), 'Bodega Juan RUC 10456789012'); assert.ok(!JSON.stringify(p).includes('Bodega'), 'lo escrito no entra a la propuesta firmada');
  assert.equal(C.purchaseValue({ proveedor: 'Alicorp RUC *******5237' }, 'proveedor'), ''); assert.equal(C.purchaseValue({ proveedor: 'Alicorp SAC' }, 'proveedor'), 'Alicorp SAC');
  assert.equal(C.needFields(doc, { type: 'compra', proveedor: 'x' }), null); assert.equal(C.needFields(doc, { type: 'precio', completar: ['proveedor'] }), null);
  // cableado en la tarjeta: Confirmar cuenta los datos que faltan, foco en el primero, fillPurchase usa purchaseValue; sin innerHTML en lo nuevo
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8'), CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
  assert.match(UI, /ok\.disabled = n > 0 \|\| miss > 0/); assert.match(UI, /need\.first\.focus/); assert.match(UI, /C\.purchaseValue\(p, 'proveedor'\)/); assert.match(UI, /enumerable: false/);
  const fn = CORE.slice(CORE.indexOf('function needFields'), CORE.indexOf('var needSeq')); assert.ok(fn.length > 200 && !/innerHTML|insertAdjacentHTML/.test(fn));
  // contraste ≥ 4.5 (claro y nocturno): texto del aviso sobre la tarjeta y borde de alerta (≥ 3, componente de interfaz)
  const CSS = readFileSync(new URL('../../POS/css/asistente.css', import.meta.url), 'utf8');
  const lum = (h) => { const v = h.match(/\w\w/g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const col = (sel) => { const m = CSS.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*?color:(#[0-9a-f]{6})')); assert.ok(m, sel); return m[1]; };
  assert.ok(ratio(col('.na-asst-need-t'), '#ffffff') >= 4.5); assert.ok(ratio(col('body.dark .na-asst-need-t'), '#10241a') >= 4.5);
  assert.ok(ratio('#b91c1c', '#ffffff') >= 4.5 && ratio('#f87171', '#07130c') >= 4.5 && ratio('#f87171', '#10241a') >= 3);
  assert.ok(CSS.includes('.na-asst-need{') && CSS.includes('border:2px solid #b91c1c') && CSS.includes('body.dark .na-asst-need{background:#07130c;color:#e5f3ea;border-color:#f87171}'));
  assert.ok(ratio('#0f172a', '#ffffff') >= 4.5 && ratio('#e5f3ea', '#07130c') >= 4.5, 'texto escrito en el campo');
});
test("B'') contexto que manda el celular del dueño: RUC de empresa y códigos exactos; empleado igual que antes", () => {
  assert.equal(C.redactOwnerContext('Galleta cód. 12345678 RUC 20100055237 RUC 10456789012 lote 87654321'), 'Galleta cód. 12345678 RUC 20100055237 [RUC oculto] lote [DNI oculto]');
  assert.equal(C.redactText('Galleta cód. 12345678 RUC 20100055237'), 'Galleta cód. [DNI oculto] [RUC oculto]');
});

// ---------- INFO: el corte del dueño no deja «RUC»/«DNI» sin su número ----------
test('INFO) dueño: el corte de 1200 nunca deja «RUC»/«DNI» al final con el número en la parte siguiente; partes = final', () => {
  let bad = 0;
  for (let pad = 1150; pad < 1215; pad++) for (const lab of ['RUC ', 'RUC N° ', 'DNI ', 'RUC: ']) {
    const t = 'x '.repeat(pad >> 1) + 'Proveedor ' + lab + '20100055237 y más texto para pasar el tope.' + ' fin'.repeat(40);
    const c = capReply(redactFor('owner')(t)), body = c.slice(0, -CUT_NOTICE.length).trimEnd();
    if (/(?:RUC|DNI)(?:\s*N[°º.]?)?\s*:?$/.test(body)) bad++;
    for (const n of [1, 7, 47]) assert.equal(emit(t, 'owner', n, REPLY_MAX), c, pad + ' ' + lab + ' ' + n); }
  assert.equal(bad, 0);
});
