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

// ---- Impresión sin «afterprint» (algunos móviles): al salir de Etiquetas o al volver a la pestaña se limpia ----
// DOM mínimo de prueba (solo lo que usa el módulo); MutationObserver se dispara al cambiar la clase.
function fakeDom({ printing = false, firesBeforeprint = true, observer = true } = {}) {
  const observers = [];
  class ClassList { constructor(el) { this.el = el; this.set = new Set(); }
    add(...c) { c.forEach(x => this.set.add(x)); this.fire(); } remove(...c) { c.forEach(x => this.set.delete(x)); this.fire(); }
    contains(c) { return this.set.has(c); } fire() { observers.filter(o => o.el === this.el).forEach(o => o.cb([])); } }
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attrs = {}; this.classList = new ClassList(this); this.listeners = {}; this._html = ''; }
    get parentNode() { return this.parentElement; }
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentElement = null; return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; } removeAttribute(k) { delete this.attrs[k]; }
    set textContent(v) { this.children = []; this._text = v; } get textContent() { return this._text || ''; }
    set innerHTML(v) { this._html = v; } get innerHTML() { return this._html; }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); } get className() { return [...this.classList.set].join(' '); }
    matches(sel) { const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel); return !!m && this.hasAttribute(m[1]) && (m[2] === undefined || this.attrs[m[1]] === m[2]); }
    closest(sel) { let e = this; while (e) { if (e.matches && e.matches(sel)) return e; e = e.parentElement; } return null; }
    querySelector(sel) { for (const c of this.children) { if (c.matches(sel)) return c; const r = c.querySelector(sel); if (r) return r; } return null; }
    querySelectorAll(sel) { const out = []; const walk = e => e.children.forEach(c => { if (c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
    dispatch(t, ev = {}) { let e = this; ev.target ||= this; while (e) { (e.listeners[t] || []).slice().forEach(f => f(ev)); e = e.parentElement; } }
  }
  const html = new El('html'), head = html.appendChild(new El('head')), body = html.appendChild(new El('body'));
  const header = body.appendChild(new El('header')); const main = body.appendChild(new El('main'));
  const other = main.appendChild(new El('div')); other.id = 'pageInventario';
  const page = main.appendChild(new El('div')); page.id = 'pageEtiquetasPrecios'; page.classList.add('page', 'active');
  const shell = page.appendChild(new El('div')); const controls = shell.appendChild(new El('div'));
  const printBtn = controls.appendChild(new El('button')); printBtn.setAttribute('data-etq-print', '');
  controls.appendChild(new El('ul')).setAttribute('data-etq-selected', '');
  const wrap = shell.appendChild(new El('div')); wrap.appendChild(new El('div')).setAttribute('data-etq-sheet', '');
  const docListeners = {};
  const document = { readyState: 'complete', visibilityState: 'visible', documentElement: html, head, body,
    createElement: t => new El(t), getElementById: id => { const f = e => e.id === id ? e : e.children.map(f).find(Boolean); return f(html) || null; },
    addEventListener: (t, f) => (docListeners[t] ||= []).push(f) };
  const winListeners = {}, state = { printing, prints: 0 };
  const win = { document, productos: [],
    MutationObserver: observer ? class { constructor(cb) { this.cb = cb; } observe(el) { observers.push({ el, cb: this.cb }); } } : undefined,
    matchMedia: q => ({ matches: q === 'print' && state.printing }),
    // Como un navegador real: window.print() dispara «beforeprint» antes de armar las páginas.
    print: () => { state.prints++; if (firesBeforeprint) (winListeners.beforeprint || []).slice().forEach(f => f({})); }, confirm: () => true,
    addEventListener: (t, f) => (winListeners[t] ||= []).push(f), removeEventListener: (t, f) => { winListeners[t] = (winListeners[t] || []).filter(x => x !== f); } };
  const ctx = vm.createContext(win); win.window = win;
  vm.runInContext(readFileSync('POS/js/modules/etiquetas-precios.js', 'utf8'), ctx);
  const marks = () => { const out = []; const walk = e => { if (e.hasAttribute('data-etq-print-hide') || e.hasAttribute('data-etq-print-path')) out.push(e); e.children.forEach(walk); }; walk(html); return out.length; };
  return { win, document, body, html, head, page, other, printBtn, state, marks,
    printing: () => body.classList.contains('etq-printing') || html.classList.contains('etq-printing-root') || head.children.some(c => c.hasAttribute('data-etq-page-style')),
    clickPrint: () => page.dispatch('click', { target: printBtn }),
    afterprint: () => (winListeners.afterprint || []).slice().forEach(f => f({})),
    beforeprint: () => (winListeners.beforeprint || []).slice().forEach(f => f({})),
    visible: () => { document.visibilityState = 'visible'; (docListeners.visibilitychange || []).forEach(f => f({})); } };
}

test('impresión sin «afterprint»: al salir de Etiquetas se quitan clase, estilo y marcas', () => {
  const d = fakeDom();
  d.clickPrint();
  assert.equal(d.state.prints, 1);
  assert.ok(d.printing() && d.marks() > 0, 'durante la impresión: clase, estilo y marcas');
  assert.equal(d.other.hasAttribute('data-etq-print-hide'), true);
  d.page.classList.remove('active'); // goPage a otra pantalla, sin «afterprint»
  assert.equal(d.printing(), false, 'sin clase ni estilo de impresión');
  assert.equal(d.marks(), 0, 'sin marcas');
});

test('impresión sin «afterprint»: al volver a la pestaña se limpia; con el medio «print» activo, no', () => {
  const d = fakeDom({ printing: true });
  d.clickPrint();
  d.visible();
  d.page.classList.remove('active');
  assert.ok(d.printing() && d.marks() > 0, 'impresión en curso: no se toca');
  d.page.classList.add('active');
  d.state.printing = false;
  d.visible();
  assert.equal(d.printing(), false);
  assert.equal(d.marks(), 0);
});

test('«afterprint» sigue siendo el camino principal y una segunda impresión no deja restos', () => {
  const d = fakeDom();
  d.clickPrint(); d.afterprint();
  assert.equal(d.printing(), false); assert.equal(d.marks(), 0);
  d.clickPrint(); d.clickPrint();
  assert.equal(d.head.children.filter(c => c.hasAttribute('data-etq-page-style')).length, 1);
  d.afterprint();
  assert.equal(d.printing(), false); assert.equal(d.marks(), 0);
});

test('precio con «S/.» (forma peruana) y «+» inicial', () => {
  for (const [raw, n] of [['S/.4.50', 4.5], ['S/. 4.50', 4.5], ['s/.  12', 12], ['S/.1,234.50', 1234.5], ['+5', 5], ['+ 5.20', 5.2], ['S/. +3', 3]]) {
    assert.equal(E.parsePrice(raw), n, raw);
    assert.equal(E.hasPrice({ precio: raw }), true, raw);
  }
  assert.equal(E.formatPrice('S/. 4.50'), 'S/ 4.50');
  assert.equal(E.parsePrice('1,234'), 1.234, 'una sola coma sigue siendo decimal (lo decide el dueño)');
  for (const raw of ['+-5', '++5', '+', 'S/.', 'S/..5x']) assert.equal(E.hasPrice({ precio: raw }), false, raw);
});

test('producto borrado del catálogo: aviso visible, «Sin precio» y entra en la confirmación', () => {
  const gone = E.missingProduct({ id: 7, name: 'Leche vieja', barcode: 'LECHE-1', precio: 9.9 });
  const html = E.sheetHtml([gone], 'chica', new Date('2026-10-21T15:00:00Z'));
  assert.match(html, /data-etq-missing title="Producto ya no está en el catálogo">Producto ya no está en el catálogo</);
  assert.match(html, /Sin precio/);
  assert.doesNotMatch(html, /9\.90/, 'no sale el precio viejo');

  const d = fakeDom();
  d.win.productos = [{ id: 7, name: 'Leche vieja', barcode: 'LECHE-1', precio: 9.9 }];
  const add = d.page.appendChild(d.document.createElement('button')); add.setAttribute('data-etq-add', '7');
  d.page.dispatch('click', { target: add });
  const sheet = d.page.querySelector('[data-etq-sheet]');
  assert.match(sheet.innerHTML, /S\/ 9\.90/);
  d.win.productos = [{ id: 8, name: 'Otro', barcode: 'OTRO-1', precio: 1 }]; // se borró del catálogo (que sigue cargado)
  let asked = ''; d.win.confirm = m => { asked = String(m); return false; };
  d.clickPrint();
  assert.match(asked, /1 producto ya no está en el catálogo/);
  assert.match(asked, /Sin precio/);
  assert.equal(d.state.prints, 0, 'sin confirmar no imprime');
  assert.match(sheet.innerHTML, /Producto ya no está en el catálogo/);
  assert.doesNotMatch(sheet.innerHTML, /9\.90/);
  assert.ok(d.page.querySelector('[data-etq-missing-warn="7"]'), 'aviso en la lista');
});

test('catálogo vacío un momento (recarga/sincronización): no marca nada como borrado, usa lo elegido', () => {
  const d = fakeDom();
  d.win.productos = [{ id: 7, name: 'Leche', barcode: 'LECHE-1', precio: 9.9 }];
  const add = d.page.appendChild(d.document.createElement('button')); add.setAttribute('data-etq-add', '7');
  d.page.dispatch('click', { target: add });
  d.win.productos = [];
  let asked = ''; d.win.confirm = m => { asked = String(m); return true; };
  d.clickPrint();
  const sheet = d.page.querySelector('[data-etq-sheet]');
  assert.equal(asked, '', 'sin confirmación: no hay borrados ni «Sin precio»');
  assert.equal(d.state.prints, 1);
  assert.doesNotMatch(sheet.innerHTML, /ya no está en el catálogo/);
  assert.match(sheet.innerHTML, /S\/ 9\.90/);
  assert.equal(d.page.querySelector('[data-etq-missing-warn="7"]'), null);
  // Con catálogo cargado y sin el producto, sí se marca.
  d.afterprint(); d.win.productos = [{ id: 8, name: 'Otro', barcode: 'OTRO-1', precio: 1 }]; asked = '';
  d.clickPrint();
  assert.match(asked, /1 producto ya no está en el catálogo/);
});

test('guarda de impresión en curso: con el medio «print» activo, ni salir de Etiquetas ni volver a la pestaña limpian', () => {
  const d = fakeDom();
  d.clickPrint();
  d.state.printing = true; // el navegador está armando las páginas
  d.page.classList.remove('active');
  d.visible();
  assert.equal(d.marks() > 0 && d.printing(), true, 'la hoja sigue aislada mientras se imprime');
  d.state.printing = false;
  d.visible();
  assert.equal(d.marks(), 0);
});

test('marcas viejas y otra pantalla imprime (Ctrl+P en Venta): «beforeprint» las limpia antes; el de Etiquetas no', () => {
  const d = fakeDom();
  d.clickPrint(); // su propio «beforeprint» no limpia
  assert.ok(d.marks() > 0 && d.printing(), 'Etiquetas sigue aislada durante su impresión');
  // Sin «afterprint», y la única limpieza cayó con el medio «print» activo.
  d.state.printing = true; d.page.classList.remove('active'); d.state.printing = false;
  assert.ok(d.marks() > 0, 'quedan marcas viejas');
  d.beforeprint(); // Ctrl+P en Venta
  assert.equal(d.marks(), 0, 'sin marcas antes de que imprima Venta');
  assert.equal(d.printing(), false);
  // Una impresión nueva de Etiquetas vuelve a aislar y su «beforeprint» no la limpia.
  d.page.classList.add('active');
  d.clickPrint();
  assert.ok(d.marks() > 0 && d.printing());
  d.afterprint();
  assert.equal(d.marks(), 0);
});

// print() que nunca dispara «beforeprint» (algunos móviles): «ownPrint» quedaba en true y el siguiente Ctrl+P de otra
// pantalla se tomaba como de Etiquetas y no limpiaba las marcas viejas.
test('«ownPrint» atascado (print sin «beforeprint»): al salir de Etiquetas se olvida y el Ctrl+P de otra pantalla limpia', () => {
  const d = fakeDom({ firesBeforeprint: false });
  d.clickPrint();
  assert.ok(d.marks() > 0 && d.printing(), 'Etiquetas aislada (sin «beforeprint» propio)');
  d.state.printing = true; d.page.classList.remove('active'); d.state.printing = false; // la limpieza cae durante la impresión
  assert.ok(d.marks() > 0, 'quedan marcas viejas');
  d.beforeprint(); // Ctrl+P en Venta
  assert.equal(d.marks(), 0, 'sin marcas antes de que imprima Venta');
  assert.equal(d.printing(), false);
});

test('«ownPrint» atascado: salir y volver a Etiquetas lo olvida; un Ctrl+P allí limpia las marcas viejas', () => {
  const d = fakeDom({ firesBeforeprint: false });
  d.clickPrint();
  d.state.printing = true; d.page.classList.remove('active'); d.page.classList.add('active'); d.state.printing = false;
  assert.ok(d.marks() > 0, 'quedan marcas viejas');
  d.beforeprint(); // Ctrl+P del navegador, no el botón de Etiquetas
  assert.equal(d.marks(), 0);
  assert.equal(d.printing(), false);
});

test('«ownPrint» atascado y sin aviso de cambio de pantalla: «beforeprint» con Etiquetas oculta limpia igual', () => {
  const d = fakeDom({ firesBeforeprint: false, observer: false });
  d.clickPrint();
  d.page.classList.remove('active'); // sin MutationObserver: nada se entera de la salida
  assert.ok(d.marks() > 0, 'quedan marcas viejas');
  d.beforeprint(); // Ctrl+P en Venta
  assert.equal(d.marks(), 0);
  assert.equal(d.printing(), false);
  // Con Etiquetas a la vista, su propia impresión sigue protegida de su «beforeprint».
  d.page.classList.add('active');
  d.clickPrint(); d.beforeprint();
  assert.ok(d.marks() > 0 && d.printing());
});
