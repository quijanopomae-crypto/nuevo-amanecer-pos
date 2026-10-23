// Sobre 25ffde10 (Bot 5 FALLA, Bot 4, Bot 3): REGLA FIJA de la tabla del dueño para el EMPLEADO. Una vez abierta una tabla con columna del
// dueño (o bajo una presentación del dueño), toda línea con «|» (con o sin bordes, cualquier cantidad de columnas) o con tabulador tras texto
// tapa sus montos hasta el final del mensaje. Solo se suelta con una cabecera NUEVA + |---| sin columna del dueño (si vino de una
// presentación: con columna de venta explícita o tras un título de venta). Partes = entero; el dueño ve todo igual.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createTextEmitter, redactFor, redactText, redactOwnerData, capReply, cutPrime, ownerHold, CUT_NOTICE } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const CSS = readFileSync(new URL('../../POS/css/asistente.css', import.meta.url), 'utf8');

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas';
const red = (t, role = EMP) => redactFor(role)(t);
function emit(text, role, n, max = 1e9, prime = false) { let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, max, redactFor(role), role === 'owner' ? null : ownerHold, prime); for (let i = 0; i < text.length; i += n) e.push(text.slice(i, i + n)); e.flush(); return o; }
const SIZES = [1, 2, 3, 7, 13, 47];
const same = (t, role = EMP) => { const f = red(t, role); for (const n of SIZES) assert.equal(emit(t, role, n), f, role + ' trozos de ' + n + ': ' + JSON.stringify(t.slice(-60))); return f; };
const primed = (t) => { const f = redactOwnerData(redactText(t), true); for (const n of SIZES) assert.equal(emit(t, EMP, n, 1e9, true), f, '«sigue» trozos de ' + n); return f; };
const hides = (f, xs) => xs.forEach((x) => assert.ok(!f.includes(x), 'se ve ' + x + ': ' + JSON.stringify(f)));
const shows = (f, xs) => xs.forEach((x) => assert.ok(f.includes(x), 'no se ve ' + x + ': ' + JSON.stringify(f)));
const owner = (t) => assert.equal(same(t, 'owner'), redactText(t), 'el dueño ve todo igual');

const LONG = 'Esta nota tiene más de ocho palabras para ver qué pasa ahora.';
const T3 = '| Producto | Costo | PVP |\n|---|---|---|\n| Item 0 | S/ 1.80 | S/ 2.50 |\n\n' + LONG + '\n\n';
const CI = 'Te paso los costos:\n| Producto | Costo |\n|---|---|\n| A | S/ 1.80 |\n\n';
// [texto, se ven, se tapan]
const COLS = [
  [T3 + '| Galleta | S/ 1.80 |', [], ['1.80']],
  [T3 + '| Galleta | S/ 1.80 | S/ 2.50 | x |', [], ['1.80']],
  [T3 + '| Galleta | S/ 1.80 | | | |', [], ['1.80']],
  [T3 + '| Galleta | S/ 1.80 |\n| Item 2 | S/ 1.82 | S/ 2.52 |', ['2.52'], ['1.80', '1.82']],
  ['| Producto | P. compra |\n|---|---|\n| A | S/ 1.70 |\n\n' + LONG + '\n\n| Galleta | S/ 1.80 | S/ 2.50 | x |', [], ['1.70', '1.80', '2.50']],
  ['| Producto | Costo | PVP |\n|---|---|---|\n| Item 0 | S/ 1.70 | S/ 2.50 |\nGalleta | S/ 1.80', ['2.50'], ['1.70', '1.80']],
  ['| Producto | Costo | PVP |\n|---|---|---|\n| Item 0 | S/ 1.70 | S/ 2.50 |\n| | Galleta | S/ 1.80 |', ['2.50'], ['1.70', '1.80']],
  ['| Producto | Costo | PVP |\n|---|---|---|\n| Item 0 | S/ 1.70 | S/ 2.50 |\n| S/ 1.80 |', ['2.50'], ['1.70', '1.80']],
  [T3 + 'Galleta | S/ 1.80', [], ['1.80']],
  [T3 + 'S/ 1.80 | Galleta', [], ['1.80']],
  [T3 + 'Galleta\tS/ 1.80', [], ['1.80']], // INFO de Bot 5: filas con tabulador tras la tabla del dueño
];
const TITLES = [
  [CI + 'Precios:\n| B | S/ 1.81 |', [], ['1.80', '1.81']],
  [CI + 'PVP:\n| B | S/ 1.81 |', [], ['1.81']],
  [CI + '**Precios**\n| B | S/ 1.81 |', [], ['1.81']],
  ['Te paso los costos:\n| Producto | Costo |\n|---|---|\n| A | S/ 1.80 |\nPrecios:\n| B | S/ 1.81 |', [], ['1.81']],
  [CI + LONG + '\n\nPrecios:\n| B | S/ 1.81 |', [], ['1.81']],
  ['| Producto | Costo |\n|---|---|\n| A | S/ 1.80 |\n\nPrecios:\n| B | S/ 1.81 |', [], ['1.81']],
  ['| Producto | Costo | PVP |\n|---|---|---|\n| A | S/ 1.80 | S/ 2.50 |\n\nPVP\n| B | S/ 1.81 | S/ 2.51 |', ['2.51'], ['1.80', '1.81']],
  [CI + 'Lista de precios\n| B | S/ 1.81 |', [], ['1.81']], // regresión de 25ffde10 (en a6d1d76e salía tapado)
];

test('Bot 5 (1): otra cantidad de columnas, celdas corridas o sin bordes tras la tabla del dueño: tapadas (entero y en partes 1/2/3/7/13/47)', () => {
  for (const [t, vis, hid] of COLS) { const f = same(t); shows(f, vis); hides(f, hid); owner(t); }
});

test('Bot 5 (2): un título de venta («Precios:», «PVP», «**Precios**», «Lista de precios») NO cierra la tabla de costo', () => {
  for (const [t, vis, hid] of TITLES) { const f = same(t); shows(f, vis); hides(f, hid); owner(t); }
});

test('suelta solo con cabecera nueva + |---|: tabla por columna del dueño → cualquier cabecera sin columna del dueño', () => {
  const base = '| Producto | Costo |\n|---|---|\n| A | S/ 1.80 |\n\n' + LONG + '\n\n';
  let f = same(base + '| Producto | Precio |\n|---|---|\n| B | S/ 4.20 |'); shows(f, ['4.20']); hides(f, ['1.80']);
  f = same(base + '| Producto | Stock |\n|---|---|\n| B | S/ 4.20 |'); shows(f, ['4.20']);
  f = same(base + '| Producto | Costo nuevo |\n|---|---|\n| B | S/ 4.20 |'); hides(f, ['4.20']); // cabecera nueva CON columna del dueño: sigue
  f = same(base + '| Producto | Precio |\n| B | S/ 4.20 |'); hides(f, ['4.20']); // sin |---|: es una fila, no suelta
});

test('suelta solo con cabecera de venta explícita o título de venta + cabecera, si vino de una presentación del dueño (Bot 5)', () => {
  const base = CI + LONG + '\n\n';
  let f = same(base + '| Producto | Precio |\n|---|---|\n| B | S/ 4.20 |'); hides(f, ['4.20']); // neutra: no suelta
  f = same(base + '| Producto | Monto |\n|---|---|\n| B | S/ 4.20 |'); hides(f, ['4.20']);
  for (const h of ['PVP', 'P. venta', 'Venta', 'Precio de venta']) { f = same(base + '| Producto | ' + h + ' |\n|---|---|\n| B | S/ 4.20 |'); shows(f, ['4.20']); }
  f = same(base + 'Precios de hoy:\n| Producto | Precio |\n|---|---|\n| B | S/ 4.20 |'); shows(f, ['4.20']);
  f = same(base + 'Lista de precios\n\n| Producto | Precio |\n|---|---|\n| B | S/ 4.20 |'); shows(f, ['4.20']);
  f = same(base + 'Precios de hoy:\nY esto otro.\n| Producto | Precio |\n|---|---|\n| B | S/ 4.20 |'); hides(f, ['4.20']); // el título debe ir antes de la cabecera
  f = same(base + 'Precios de hoy:\n| Producto | Costo |\n|---|---|\n| B | S/ 4.20 |'); hides(f, ['4.20']); // con columna del dueño: no
  // presentación sin columna del dueño en la tabla (la de Bot 5 en a6d1d76e)
  f = same('Te paso los costos:\n| Producto | Precio |\n|---|---|\n| A | S/ 1.80 |\n\n' + LONG + '\n\n| Producto | Precio |\n|---|---|\n| B | S/ 4.20 |'); hides(f, ['1.80', '4.20']);
});

test('columna de venta de la tabla del dueño: visible solo con las mismas columnas e índice correcto; texto suelto sigue visible', () => {
  let f = same(T3 + '| B | S/ 1.90 | S/ 2.60 |'); shows(f, ['2.60']); hides(f, ['1.90']);
  f = same(T3 + 'B | S/ 1.90 | S/ 2.60'); shows(f, ['2.60']); hides(f, ['1.90']); // sin bordes, mismas columnas: igual
  f = same(T3 + '| B | S/ 1.90 | S/ 2.60 | x |'); hides(f, ['1.90', '2.60']);
  f = same(T3 + '| B | S/ 2.60 |'); hides(f, ['2.60']);
  f = same(T3 + '| B | S/ 1.90 | S/ 2.60 costo |'); hides(f, ['2.60']); // la celda nombra al dueño
  f = same(T3 + 'Arroz S/ 4.20 en la tienda.'); shows(f, ['4.20']); // sin «|»: texto normal
  f = same('Precios de venta:\n| Producto | PVP |\n|---|---|\n| A | S/ 4.10 |\n\n' + LONG + '\n\n| B | S/ 4.30 | 3 u |'); shows(f, ['4.10', '4.30']); // tabla de venta: nada cambia
  f = same('| Costo | S/ 1.80 |\n| PVP | S/ 2.50 |'); shows(f, ['2.50']); hides(f, ['1.80']); // clave-valor: «PVP» bajo «Costo»
});

test('las 3 fugas de a6d1d76e y «Compras de clientes: S/ 30» siguen igual', () => {
  const H = 'Te paso los costos:\n| Producto | Precio |\n|---|---|\n';
  for (const t of [H + '\nAquí van los productos que pediste hace un rato.\n| Producto 0 | S/ 1.80 |', H + '| Producto 0 | S/ 1.80 |\n\n' + LONG + '\n| Producto 1 | S/ 1.81 |',
    H + '| Producto 0 | S/ 1.80 |\n\n\nOtra cosa: el local abre a las ocho de la mañana todos los días.\n\n| Producto 1 | S/ 1.81 |']) hides(same(t), ['1.80', '1.81']);
  assert.equal(same('Compras de clientes: S/ 30'), 'Compras de clientes: S/ 30');
});

test('Bot 3: la fila se tapa apenas llega su «|» y el monto; no espera el fin de la línea', () => {
  const pre = T3 + '| Galleta | S/ 1.80 | y sigue un texto largo sin salto';
  let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, redactFor(EMP), ownerHold);
  for (const ch of pre) e.push(ch);
  assert.ok(o.includes('| Galleta | [dato del Admin] |'), JSON.stringify(o.slice(-80)));
  assert.ok(!o.includes('1.80 |'));
  e.flush();
});

test('«sigue»: corte con la regla fija activa → cutPrime sí; la continuación sigue tapando (superconjunto) hasta la cabecera que suelta', () => {
  for (const t of [T3.trimEnd(), CI + LONG, T3 + '| Galleta | S/ 1.80 |', CI + 'Precios:']) assert.ok(['intro', 'col'].includes(cutPrime(red(t), true)), JSON.stringify(t.slice(-30)));
  const rows = (a, b) => Array.from({ length: b - a }, (_, i) => '| Producto número ' + (a + i) + ' | S/ 1.' + String(a + i).padStart(2, '0') + ' | S/ 2.' + String(a + i).padStart(2, '0') + ' |\n').join('');
  const cut = capReply(red('| Producto | Costo | PVP |\n|---|---|---|\n' + rows(0, 30) + '\n' + LONG + '\n')); assert.ok(cut.endsWith(CUT_NOTICE)); assert.ok(['intro', 'col'].includes(cutPrime(cut, true)));
  for (const cont of ['| Galleta | S/ 1.80 |', '| Galleta | S/ 1.80 | S/ 2.50 | x |', 'Galleta | S/ 1.80', LONG + '\n\nPrecios:\n| B | S/ 1.81 |', 'Lista de precios\n| B | S/ 1.81 |',
    LONG + '\n\n| Producto | Precio |\n|---|---|\n| B | S/ 1.81 |', 'Galleta\tS/ 1.80']) {
    const p = primed(cont), u = red(cont); hides(p, ['1.80', '1.81']);
    assert.ok(u.split('[dato del Admin]').length <= p.split('[dato del Admin]').length, 'superconjunto');
  }
  assert.match(primed('| Producto | PVP |\n|---|---|\n| Arroz | S/ 4.20 |'), /4\.20/, 'cabecera de venta explícita: suelta');
  assert.match(primed(LONG + '\n\nArroz S/ 4.20'), /4\.20/, 'texto suelto tras un párrafo largo: igual que sin contexto');
});

// ---------- celular (Bot 4) ----------
function fakeDoc() {
  class N { constructor(tag) { this.tagName = tag.toUpperCase(); this.childNodes = []; this.attrs = {}; this.className = ''; }
    appendChild(k) { this.childNodes.push(k); k.parentNode = this; return k; }
    insertBefore(k, ref) { const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(k); else this.childNodes.splice(i, 0, k); k.parentNode = this; return k; }
    get nextSibling() { return null; }
    setAttribute(a, v) { if (!({ scope: 1, 'aria-hidden': 1 })[a]) throw new Error('atributo ' + a); this.attrs[a] = String(v); }
    get textContent() { return this.childNodes.map((k) => (k.nodeType === 3 ? k.data : k.textContent)).join(''); }
    set textContent(v) { this.childNodes = v ? [{ nodeType: 3, data: String(v) }] : []; }
    set innerHTML(_) { throw new Error('innerHTML usado'); } }
  return { createElement: (t) => new N(t), createTextNode: (t) => ({ nodeType: 3, data: String(t) }) };
}
function render(text, step) { const doc = fakeDoc(), host = doc.createElement('div'); const r = C.createReplyRenderer(doc, (n) => host.appendChild(n)); for (let i = 0; i < text.length; i += step) r.push(text.slice(i, i + step)); r.finish(); return host; }
const all = (n, f, out = []) => { if (f(n)) out.push(n); (n.childNodes || []).forEach((k) => all(k, f, out)); return out; };

test('celular (Bot 4): filas tapadas tras la regla fija se dibujan como filas (también con otras columnas), nunca texto con «|»', () => {
  const srv = red(T3 + '| Galleta | S/ 1.80 |\n| Item 2 | S/ 1.82 | S/ 2.52 |\n| G2 | S/ 1.83 | S/ 2.53 | x |\nFin.');
  hides(srv, ['1.80', '1.82', '1.83']);
  for (const step of [1e9, 1, 3, 11]) {
    const host = render(srv, step);
    const texts = all(host, (n) => n.nodeType === 3 && n.parentNode === undefined && host.childNodes.includes(n));
    assert.ok(host.childNodes.filter((k) => k.nodeType === 3).every((k) => !k.data.includes('|')), 'sin «|» en el texto, pasos de ' + step);
    const tbls = host.childNodes.filter((k) => k.className === 'na-asst-tbl'); assert.equal(tbls.length, 2);
    const trs = all(tbls[1], (n) => n.tagName === 'TR' && n.parentNode && n.parentNode.tagName === 'TBODY');
    assert.equal(trs.length, 3, 'tres filas');
    trs.forEach((tr) => assert.equal(tr.childNodes.length, 3, 'mismas columnas que la cabecera (relleno o juntas)'));
    assert.ok(trs[2].childNodes[2].textContent.includes('x'), 'la celda sobrante se junta en la última');
    void texts;
  }
});

test('celular (Bot 4): todos los montos tapados → máscara corta por CSS y UNA nota bajo la tabla; con un monto visible no hay nota', () => {
  const host = render('| Producto | Costo |\n|---|---|\n| A | [dato del Admin] |\n| B | [dato del Admin] |\n| C | [dato del Admin] |\nListo.', 1e9);
  const notes = all(host, (n) => n.className && /na-asst-tnote/.test(n.className));
  assert.equal(notes.length, 1); assert.equal(notes[0].textContent, C.MASK_NOTE); assert.equal(notes[0].className, 'na-asst-tnote');
  const tbl = host.childNodes.find((k) => k.className === 'na-asst-tbl'); assert.equal(host.childNodes.indexOf(notes[0]), host.childNodes.indexOf(tbl) + 1, 'nota justo bajo la tabla');
  assert.equal(tbl.childNodes[0].className, 'na-asst-allmask');
  assert.equal(all(host, (n) => n.className === 'na-asst-mask').length, 3, 'el texto del DOM sigue siendo la etiqueta');
  const mix = render('| Producto | Costo | PVP |\n|---|---|---|\n| A | [dato del Admin] | S/ 2.50 |\n', 1e9);
  const n2 = all(mix, (n) => n.className && /na-asst-tnote/.test(n.className)); assert.ok(n2.every((n) => /na-asst-off/.test(n.className)), 'con un monto visible: sin nota');
  assert.equal(all(mix, (n) => n.className === 'na-asst-allmask').length, 0);
  // partes = entero
  const t = '| Producto | Costo |\n|---|---|\n| A | [dato del Admin] |\n| B | S/ 2.50 |\n';
  const ser = (n) => (n.nodeType === 3 ? n.data : '<' + n.tagName + '.' + n.className + '>' + n.childNodes.map(ser).join('') + '</>');
  for (const s of [1, 2, 5, 13]) assert.equal(ser(render(t, s)), ser(render(t, 1e9)));
  assert.match(CSS, /\.na-asst-allmask \.na-asst-mask\{font-size:0/); assert.match(CSS, /\.na-asst-allmask \.na-asst-mask::after\{content:'•••'/);
  assert.match(CSS, /\.na-asst-tnote\.na-asst-off\{display:none\}/);
});

test('una «cabecera» con montos («| Galleta | S/ 1.80 |» + |---|) es una fila disfrazada: no suelta la tabla del dueño', () => {
  for (const pre of [T3, '| Producto | P. compra |\n|---|---|\n| Item 0 | S/ 1.70 |\n\nNota corta.\n']) {
    const f = same(pre + '| Galleta | S/ 1.80 |\n|---|---|\n| Arroz | S/ 1.83 |\n'); hides(f, ['1.80', '1.83']); }
});

// ---------- Bot 3 (velocidad) sobre a6d1d76e ----------
test('Bot 3 (1): filtro previo de la etapa de espacios: todas las etiquetas (dueño y empleado) siguen tapando su valor tras 160+ espacios; partes = entero', () => {
  const LABELS = ['RUC', 'ruc:', 'RUC N°', 'RUC Nº', 'RUC No', 'RUC N°.', 'DNI', 'dni:', 'pin', 'PIN:', 'pin =', 'clave', 'Clave es', 'clave era', 'clave de', 'contraseña', 'CONTRASEÑA:', 'contrasena',
    'password', 'password=', 'token', 'token =', 'api key', 'api-key:', 'apikey', 'api_key es'];
  const VAL = { RUC: '20123456789', DNI: '12345678' };
  let n = 0;
  for (const l of LABELS) for (const ws of [' '.repeat(170), '\n'.repeat(3) + ' '.repeat(200), '\t'.repeat(165)]) for (const role of ['owner', EMP]) {
    const v = /ruc/i.test(l) ? VAL.RUC : /dni/i.test(l) ? VAL.DNI : 'abc12345'; const t = 'Dato ' + l + ws + v + ' fin.';
    // (Bot 2 sobre 25ffde10) el dueño ve el RUC exacto (el DNI ya no: auditoría 500, 8): para él solo se comprueba que la racha se junte en un espacio
    const f = red(t, role); if (role === 'owner' && /ruc/i.test(l)) assert.ok(f.includes(' ' + v) && !/\s{2,}/.test(f), JSON.stringify(f)); else assert.ok(!f.includes(v), role + ' ' + JSON.stringify(l) + ' -> ' + JSON.stringify(f.replace(/\s+/g, ' ')));
    for (const k of [1, 3, 7]) assert.equal(emit(t, role, k), f, role + ' ' + l + ' trozos de ' + k); n++;
  }
  assert.ok(n >= 150);
  // palabras que terminan en esas letras sin ser etiqueta: igual que siempre (los espacios largos se quedan)
  for (const t of ['Galleta' + ' '.repeat(170) + 'S/ 2.50', 'Arroz:' + ' '.repeat(170) + 'listo']) for (const role of ['owner', EMP]) for (const k of [1, 5]) assert.equal(emit(t, role, k), red(t, role));
});

test('Bot 3 (2): racha larga sin espacios del empleado: «[texto largo omitido]» sale apenas pasa de 160, sin esperar el fin de la racha; partes = entero', () => {
  const t = 'Abra este enlace: https://x.example/' + 'a'.repeat(2000) + ' y listo.';
  let o = '', at = -1; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, redactFor(EMP), ownerHold);
  for (let i = 0; i < t.length; i++) { e.push(t[i]); if (at < 0 && o.includes('[texto largo omitido]')) at = i; }
  const pre = o; e.flush(); // (#962, diseño simple) la cola fija LABEL_TAIL espera 10 caracteres DESPUÉS de la racha (o el cierre): antes «at < 260»
  assert.ok(!/aaaa/.test(pre) && o.startsWith(pre), 'nada de la racha antes de cerrar: ' + at); assert.equal(o, red(t)); assert.equal(o, 'Abra este enlace: h[texto largo omitido] y listo.');
  assert.ok(!o.includes('\u2029') && !o.includes('\u2028'));
  for (const k of SIZES) assert.equal(emit(t, EMP, k), o);
  assert.equal(same(t, 'owner'), redactText(t), 'dueño: el enlace intacto');
});

test('Bot 3 (3, INFO): el corte de 1200 nunca parte «DNI ****2345» ni «RUC *******6789»', () => {
  let hit = 0;
  for (let pad = 1170; pad <= 1200; pad++) for (const v of ['00012345', '20123456789']) {
    const t = 'ab '.repeat(400).slice(0, pad) + ' ' + v + ' y más texto aquí para pasar el tope.'; for (const role of ['owner', EMP]) {
      const c = capReply(red(t, role)), body = c.slice(0, c.indexOf(CUT_NOTICE) >= 0 ? c.indexOf(CUT_NOTICE) : c.length).trimEnd();
      assert.ok(!/(?:DNI|RUC)$/.test(body) && !/(?:DNI|RUC) \*+\d{0,3}$/.test(body), role + ' ' + pad + ': ' + JSON.stringify(body.slice(-20)));
      assert.equal(emit(t, role, 7, 1200), c, 'partes = final'); if (/\*{4}/.test(red(t, role).slice(1150, 1215))) hit++; } }
  assert.ok(hit > 20, 'casos con la etiqueta cerca del tope: ' + hit);
});

// ---------- Bot 4 sobre 25ffde10 ----------
test('Bots 4/5/2: series de comprobante y guía intactas en ambos roles; «2024-12345678», «DNI-12345678», tapados para el empleado; el dueño ve DNI/RUC exactos', () => {
  for (const r of ['F001-00012345', 'B001-00000123', 'E001-12345678', 'T001-00012345', '0001-00012345']) for (const role of ['owner', EMP]) {
    const t = 'Comprobante ' + r + ' del 17/10/2026.'; assert.equal(same(t, role), t, role + ' ' + r);
    assert.equal(redactText(t), t, 'también en lo que va al modelo'); }
  // la excepción es SOLO la serie: un año u otro número de 4 + guion sigue siendo DNI para el empleado
  for (const t of ['DNI-12345678', 'DNI 12345678']) assert.match(same(t, EMP), /DNI \*{4}5678/, t);
  assert.equal(same('Doc: 12345678', EMP), 'Doc: ****5678', '(Bot 5 sobre 36f6ae51) sin repetir la etiqueta tras «Doc:»');
  // (Bot 4 sobre 39ccd25c) sin DNI/documento/doc/identidad delante: tapado con etiqueta neutra «código ****»
  for (const t of ['2024-12345678', '1234-12345678', 'X001-12345678', 'f001-12345678']) assert.match(same(t, EMP), /código \*{4}5678/, t);
  // (Bot 5 sobre 6280deae, antes INFO) letra o «_» pegados a los dígitos: (?<![0-9]) en vez de \b, ahora se tapan para el empleado
  for (const t of ['Doc:x12345678', 'Doc:A12345678']) assert.match(same(t, EMP), /DNI \*{4}5678$/, t);
  assert.match(same('ref_12345678', EMP), /código \*{4}5678$/);
  assert.match(same('RUC 20100055237', EMP), /RUC \*{7}5237/);
  // dueño (Bot 2, ev/dueno-comprobantes.json): sin DNI/RUC tapados; PIN, clave, token y data: siguen tapados
  const doc = 'Compra registrada\n| Comprobante | Proveedor | RUC | Total |\n|---|---|---|---|\n| F001-00012345 | Alicorp SAC | 20100055237 | S/ 229.40 |\n| B001-00000123 | Gloria SA | RUC 20100190797 | S/ 58.10 |\nCódigo interno 12345678\nDNI del cliente 44556677';
  // (auditoría 500, 8) el DNI escrito en la respuesta ya se tapa también para el dueño; RUC, series y códigos siguen exactos
  const docOwner = doc.replace('DNI del cliente 44556677', 'DNI del cliente ****6677');
  for (const k of [1, 2, 3, 7, 13, 47]) assert.equal(emit(doc, 'owner', k), docOwner, 'dueño trozos de ' + k);
  assert.equal(red(doc, 'owner'), docOwner);
  for (const [t, v] of [['clave: abc123', 'abc123'], ['PIN 4321', '4321'], ['token = sk-999999', 'sk-999999'], ['data:image/png;base64,QUJDREVGR0hJSktMTU5PUFFS', 'QUJD']]) assert.ok(!same(t, 'owner').includes(v), t);
  // lo que va al modelo sigue con el filtro completo
  assert.equal(redactText('RUC 20100055237 y 12345678'), 'RUC *******5237 y código ****5678');
});

test('Bot 4: el corte de 1200 no separa un número de su unidad corta («1,250 unid.», «12.5 kg», «3 cajas», «2 paq.»); partes = final', () => {
  for (const u of ['1,250 unid.', '12.5 kg', '3 cajas', '2 paq.', '500 ml', '6 und.']) for (let pad = 1180; pad <= 1200; pad++) for (const role of ['owner', EMP]) {
    const t = 'ab '.repeat(400).slice(0, pad) + ' ' + u + ' y más texto para pasar el tope.'; const c = capReply(red(t, role));
    const body = c.slice(0, c.indexOf(CUT_NOTICE)).trimEnd(); const num = u.split(' ')[0];
    assert.ok(!body.endsWith(num) && !/\d$/.test(body), role + ' ' + pad + ' ' + JSON.stringify(body.slice(-16)));
    assert.equal(emit(t, role, 7, 1200), c, 'partes = final'); }
  // sin espacios antes del número (Bot 5 corte-numeros): el corte en partes espera la unidad aunque el número caiga justo en el tope
  for (const u of ['1,250 unid.', '12.5 kg']) for (let L = 1185; L <= 1205; L++) for (const role of ['owner', EMP]) {
    const t = 'a'.repeat(L) + u + 'b'.repeat(300), c = capReply(red(t, role)); for (const k of [1, 7]) assert.equal(emit(t, role, k, 1200), c, role + ' ' + u + ' L=' + L + ' trozos de ' + k); }
});

test('Bot 4: 2+ filas sueltas sin cabecera con las mismas columnas → tabla sin etiquetas; una sola sigue como texto; «S/» unido a su monto', () => {
  const t = 'Aquí:\n| Galleta | S/ 1.80 |\n| Arroz | S/ 3.10 |\n| Leche | S/ 4.20 |\nFin.';
  const ser = (n) => (n.nodeType === 3 ? n.data : '<' + n.tagName + '.' + n.className + '>' + n.childNodes.map(ser).join('') + '</>');
  const whole = render(t, 1e9);
  for (const s of [1, 2, 3, 7, 13]) assert.equal(ser(render(t, s)), ser(whole), 'partes = entero ' + s);
  const tbl = whole.childNodes.find((k) => k.className === 'na-asst-tbl'); assert.ok(tbl);
  assert.equal(all(tbl, (n) => n.tagName === 'THEAD').length, 0, 'sin cabecera');
  assert.equal(all(tbl, (n) => n.tagName === 'TR').length, 3);
  assert.ok(whole.childNodes.filter((k) => k.nodeType === 3).every((k) => !k.data.includes('|')));
  assert.ok(tbl.textContent.includes('S/\u00a01.80'));
  const one = render('| Galleta | S/ 1.80 |\nFin.', 1e9); assert.ok(!one.childNodes.some((k) => k.className === 'na-asst-tbl'));
  // texto: «S/ » + monto con espacio que no se parte, también si llegan en trozos distintos
  for (const s of [1, 2, 5]) assert.equal(render('Cuesta S/ 2.50 y US$ 3 hoy.', s).textContent, 'Cuesta S/\u00a02.50 y US$\u00a03 hoy.');
});

test('Bot 4/3: la tabla se crea con su primera fila (cabecera + párrafo no deja una tabla vacía); el ancho de la burbuja va por clase, sin :has', () => {
  const t = '| Producto | Costo | PVP |\n|---|---|---|\n\nEsta nota tiene más de ocho palabras para ver qué pasa ahora.\n| A | [dato del Admin] | S/ 2.50 |\n';
  const host = render(t, 1e9); const tbls = host.childNodes.filter((k) => k.className === 'na-asst-tbl');
  assert.equal(tbls.length, 1, 'una sola tabla, sin la vacía');
  assert.equal(all(tbls[0], (n) => n.tagName === 'TH').map((n) => n.textContent).join('|'), 'Producto|Costo|PVP', 'la cabecera una sola vez');
  for (const s of [1, 3, 11]) assert.equal(render(t, s).childNodes.filter((k) => k.className === 'na-asst-tbl').length, 1);
  assert.ok(!/:has\(/.test(CSS)); assert.match(CSS, /\.na-asst-msg\.a\.na-asst-wide\{max-width:100%\}/);
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  assert.equal((UI.match(/if \(n\.className === 'na-asst-tbl'\) [mb]\.classList\.add\('na-asst-wide'\)/g) || []).length, 2);
  assert.match(UI, /\['Leer factura', null, 'photo', 'Factura'\]/, 'texto corto del atajo de foto en el celular');
});

test('Bot 2 (regresión desde f3375c09): la línea siguiente que EMPIEZA con costo/margen/ganancia/utilidad, o es corta y la trae, tapa el monto de arriba; «El costo lo ve el dueño.» no', () => {
  // (Bot 2/3 sobre 6280deae) «ganancia S/ 0.70» trae SU monto en sus primeros 20 caracteres: tapa el 0.70 y suelta el de arriba (ver la prueba de 6280deae)
  for (const nx of ['costo unitario', 'es el costo', 'de costo', '(mi costo)', 'margen', '(costo por unidad)', 'utilidad', 'el costo', 'Ese es el margen']) {
    const t = 'Galleta S/ 1.80\n' + nx; const f = same(t); assert.ok(!f.includes('1.80') && f.startsWith('Galleta [dato del Admin]\n'), JSON.stringify(f));
    assert.ok(!f.includes('0.70')); assert.equal(same(t + '\nGracias.'), f + '\nGracias.'); assert.equal(same(t, 'owner'), t); }
  for (const t of ['Galleta S/ 1.80\nEl costo lo ve el dueño.', 'Arroz S/ 4.20\nEl costo lo ve el dueño.', 'Galleta S/ 1.80\nCosteño de la sierra', 'Galleta S/ 1.80\nLeche S/ 3.80',
    'Galleta S/ 1.80\nEl costo es alto este mes en todas las tiendas', 'Galleta S/ 1.80\nGracias por su compra, vuelva pronto.']) assert.equal(same(t), t, t);
  // retención: igual que en 25ffde10 (medido: 38, 31, 31 y 18 caracteres de la línea siguiente); nunca espera al tope de 160
  const lagAt = (t) => { let o = '', got = -1; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, redactFor(EMP), ownerHold);
    for (let i = 0; i < t.length; i++) { e.push(t[i]); if (got < 0 && o.includes('1.80')) got = i; } e.flush(); return got; };
  const a = 'Hola, te paso el precio. Galleta S/ 1.80\n';
  const lags = ['Gracias por su compra y vuelva pronto a la tienda de siempre, amigo.', 'uno dos tres cuatro cinco seis siete ocho', 'Leche fresca entera de vaca de la granja local y mas', 'Hasta luego.\nOtra linea mas larga aqui'].map((b) => lagAt(a + b) - a.length);
  // (auditoría de privacidad 2026-10-22) 39 en la primera: «… pronto a la …» espera UN carácter más para saber si «a» empieza «arroba»
  // (correo disfrazado «rosa arroba gmail punto com»); las demás igual.
  // (#962, diseño simple) + LABEL_TAIL (10) de la cola fija: 49, 41, 28; la 2.ª línea tiene 41 caracteres, así que su monto sale al cerrar (-1)
  assert.deepEqual(lags.map((x) => (x < 0 ? -1 : x)), [49, -1, 41, 28]);
  // ítem de lista o fila con tabulador: la palabra del dueño tapa solo su ítem (Bot 2 b, sin cambios)
  for (const t of ['- Arroz S/ 4.20\n- costo S/ 1.80', 'Leche Gloria\tS/ 3.70\ncosto\tS/ 1.80']) { const f = same(t); assert.ok(/4\.20|3\.70/.test(f) && !f.includes('1.80'), f); }
});
