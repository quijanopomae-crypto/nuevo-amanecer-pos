// Bot 4/3/5 sobre 66f1ecb5: tablas en la respuesta del asistente (solo en el celular, sobre texto YA filtrado por el servidor).
// createElement + textContent únicamente; fila por fila mientras llega; «[dato del Admin]» sin partirse; foto oculta con vision:false; proveedor en uso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createTextEmitter, redactFor, redactOwnerData, redactText } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const UI = read('POS/js/modules/asistente/asistente-ui.js'), CSS = read('POS/css/asistente.css'), CORE = read('POS/js/modules/asistente/asistente-core.js');

// DOM de mentira: sin innerHTML ni insertAdjacentHTML (si el código los usara, la prueba falla)
const ALLOWED_ATTR = { scope: ['col'], 'aria-hidden': ['true'] };
function fakeDoc() {
  const stats = { el: 0, txt: 0 };
  class N { constructor(tag) { this.tagName = tag.toUpperCase(); this.childNodes = []; this.attrs = {}; this.className = ''; stats.el++; }
    appendChild(k) { this.childNodes.push(k); k.parentNode = this; return k; }
    insertBefore(k, ref) { const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(k); else this.childNodes.splice(i, 0, k); k.parentNode = this; return k; }
    setAttribute(a, v) { this.attrs[a] = String(v); }
    get textContent() { return this.childNodes.map((k) => (k.nodeType === 3 ? k.data : k.textContent)).join(''); }
    set textContent(v) { this.childNodes = v ? [{ nodeType: 3, data: String(v) }] : []; }
    set innerHTML(_) { throw new Error('innerHTML usado'); } get innerHTML() { throw new Error('innerHTML leído'); }
    insertAdjacentHTML() { throw new Error('insertAdjacentHTML usado'); } }
  return { stats, createElement: (t) => new N(t), createTextNode: (t) => { stats.txt++; return { nodeType: 3, data: String(t) }; } };
}
const ser = (n) => n.nodeType === 3 ? JSON.stringify(n.data).slice(1, -1) : '<' + n.tagName.toLowerCase() + (n.className ? '.' + n.className : '') + Object.entries(n.attrs).map(([a, v]) => ' ' + a + '=' + v).join('') + '>' + n.childNodes.map(ser).join('') + '</>';
function walk(n, f) { f(n); if (n.childNodes) n.childNodes.forEach((k) => walk(k, f)); }
// ¿se juntan los nodos de texto seguidos? (el renderer suma al mismo nodo; partes y entero deben dar lo mismo al serializar)
function render(text, sizes) {
  const doc = fakeDoc(), host = doc.createElement('div'); const r = C.createReplyRenderer(doc, (n) => host.appendChild(n));
  const marks = [];
  for (let i = 0; i < text.length;) { const n = typeof sizes === 'function' ? sizes() : sizes; r.push(text.slice(i, i + n)); i += n; marks.push([i, r.rows()]); }
  r.finish(); return { host, doc, r, marks, html: ser(host) };
}
const T1 = 'Aquí va la lista:\n| Producto | Costo | PVP |\n|---|---|---|\n| Galleta | S/ 1.80 | S/ 2.50 |\n| Arroz | S/ 3.10 | S/ 4.20 |\nListo.';

test('tabla: «| … |» con «|---|» sale como tabla; texto antes y después igual; columnas con su etiqueta (para la ficha a 480 px)', () => {
  const { host, html } = render(T1, T1.length);
  const tbl = host.childNodes.find((k) => k.className === 'na-asst-tbl'); assert.ok(tbl, html);
  assert.equal(host.childNodes[0].data, 'Aquí va la lista:\n'); assert.equal(host.childNodes[2].data, 'Listo.');
  const tb = tbl.childNodes[0].childNodes[1]; assert.equal(tb.tagName, 'TBODY'); assert.equal(tb.childNodes.length, 2);
  const td = tb.childNodes[0].childNodes[2]; assert.equal(td.childNodes[0].className, 'na-asst-tl'); assert.equal(td.childNodes[0].textContent, 'PVP'); assert.equal(td.childNodes[0].attrs['aria-hidden'], 'true');
  assert.equal(td.childNodes[1].textContent, 'S/\u00a02.50', '«S/» unido a su monto con espacio que no se parte (solo en pantalla, Bot 4 sobre 25ffde10)');
  assert.equal(tbl.childNodes[0].childNodes[0].childNodes[0].childNodes.map((th) => th.textContent).join('|'), 'Producto|Costo|PVP');
});
test('tabla: sin «|---|» no es tabla (queda texto tal cual); «a | b» en medio de una frase tampoco', () => {
  for (const t of ['| hola | chau |\nno es separador', 'Elige a | b según el caso.\nGracias', '| solo una línea', 'Precio | 2.50\n---\nfin']) {
    const { host } = render(t, 3); assert.ok(!host.childNodes.some((k) => k.className === 'na-asst-tbl'), t); assert.equal(host.textContent, t, t); }
});
for (const n of [1, 2, 5, 47]) {
  test('tabla en partes de ' + n + ': mismo resultado que de una vez; cada fila aparece al cerrar su línea, sin esperar el fin de la tabla', () => {
    const one = render(T1, T1.length).html, part = render(T1, n);
    assert.equal(part.html, one);
    const afterRow1 = T1.indexOf('| Galleta') + '| Galleta | S/ 1.80 | S/ 2.50 |\n'.length;
    const m = part.marks.find(([i]) => i >= afterRow1); assert.ok(m[1] >= 1, 'la fila 1 ya está dibujada antes de que llegue el resto: ' + JSON.stringify(m));
  });
}
test('propiedad: con cortes al azar el DOM es igual al de una sola vez (texto, tablas, cabeceras falsas, filas sin salto final)', () => {
  let seed = 99; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); const pick = (a) => a[Math.floor(rnd() * a.length)];
  const P = ['| A | B |\n', '|---|---|\n', '| x | [dato del Admin] |\n', '| y | S/ 2.50 |', 'Texto normal. ', 'Hola\n', '\n', '  | sangría | z |\n', '---|---\n', '| :--- | ---: |\n', 'a | b\n', '<b>x</b> ', '| <img src=x onerror=alert(1)> | <script>alert(1)</script> |\n'];
  for (let i = 0; i < 1500; i++) { let t = ''; const k = 1 + Math.floor(rnd() * 12); for (let j = 0; j < k; j++) t += pick(P);
    const one = render(t, t.length || 1).html, mode = rnd(); const size = () => (mode < 0.3 ? 1 : mode < 0.6 ? 1 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 40));
    assert.equal(render(t, size).html, one, JSON.stringify(t)); }
});
test('seguridad (Bot 5): <img onerror> y <script> en celdas solo como texto; nada de innerHTML; atributos fijos, nunca texto del modelo', () => {
  const t = 'Te paso:\n| Producto | <script>alert(1)</script> |\n|---|---|\n| <img src=x onerror=alert(1)> | <b onclick=x>2</b> |\n| "><svg onload=alert(1)> | ok |\n';
  for (const n of [1, 3, t.length]) {
    const { host } = render(t, n); const tags = new Set();
    walk(host, (k) => { if (k.nodeType === 3) return; tags.add(k.tagName); for (const [a, v] of Object.entries(k.attrs)) assert.ok(ALLOWED_ATTR[a] && ALLOWED_ATTR[a].includes(v), 'atributo ' + a + '=' + v);
      assert.ok(['', 'na-asst-tbl', 'na-asst-tl', 'na-asst-tv', 'na-asst-mask'].includes(k.className), 'clase ' + k.className); });
    assert.deepEqual([...tags].sort(), ['DIV', 'SPAN', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR'].sort().filter((x) => tags.has(x)));
    for (const bad of ['IMG', 'SCRIPT', 'SVG', 'B']) assert.ok(!tags.has(bad), bad);
    assert.ok(host.textContent.includes('<img src=x onerror=alert(1)>') && host.textContent.includes('<script>alert(1)</script>'), 'queda como texto visible');
  }
  // el código del renderer no usa innerHTML/insertAdjacentHTML/outerHTML
  const src = CORE.slice(CORE.indexOf('function createReplyRenderer'), CORE.indexOf('// Pide el chat en partes.'));
  assert.ok(src.length > 500 && !/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(src));
  assert.match(UI, /function paintReply\(m, t, opts\) \{ m\.textContent = ''; if \(m\.classList\) m\.classList\.remove\('na-asst-wide'\); var r = C\.createReplyRenderer\(doc,/);
});
test('el renderer trabaja DESPUÉS del filtro: el costo original no está en el DOM ni en atributos; «[dato del Admin]» en un span que no se parte', () => {
  const src = 'Te paso costo y precio:\n| Producto | Costo | PVP |\n|---|---|---|\n| Galleta | S/ 7.77 | S/ 2.50 |\n| Arroz | 3.21 | S/ 4.20 |\n';
  for (const n of [1, 5, 47]) {
    // lo que de verdad llega al celular: el emisor del servidor (empleado), en partes
    let wire = ''; const em = createTextEmitter((d) => { if (d.t) wire += d.t; }, 1200, redactFor('empleado:consultas')); for (let i = 0; i < src.length; i += n) em.push(src.slice(i, i + n)); em.flush();
    assert.equal(wire, redactOwnerData(redactText(src)));
    const { host } = render(wire, n); let all = '';
    walk(host, (k) => { all += k.nodeType === 3 ? k.data : Object.values(k.attrs).join(' ') + ' ' + k.className; });
    assert.ok(!/7\.77|3\.21/.test(all), all);
    const masks = []; walk(host, (k) => { if (k.className === 'na-asst-mask') masks.push(k.textContent); });
    assert.deepEqual(masks, ['[dato del Admin]', '[dato del Admin]']);
    assert.ok(all.includes('S/\u00a02.50') && all.includes('S/\u00a04.20'));
  }
  assert.match(CSS, /\.na-asst-mask\{white-space:nowrap\}/);
});
test('480 filas en partes de 5 (Bot 3): lineal, filas dibujadas mientras llegan; CPU del celular medido', () => {
  const mk = (n) => '| Producto | PVP | Stock |\n|---|---|---|\n' + Array.from({ length: n }, (_, i) => '| Producto ' + i + ' | S/ 2.50 | ' + i + ' |\n').join('');
  const time = (t) => { const runs = []; for (let r = 0; r < 7; r++) { const t0 = performance.now(); render(t, 5); runs.push(performance.now() - t0); } runs.sort((a, b) => a - b); return runs[3]; };
  const t480 = mk(480), t1920 = mk(1920);
  const r = render(t480, 5); assert.equal(r.r.rows(), 480);
  const half = r.marks.find(([i]) => i >= t480.length / 2); assert.ok(half[1] >= 235, 'a mitad del texto ya hay ~240 filas: ' + half[1]);
  const a = time(t480), b = time(t1920); console.log('# CPU tabla 480 filas en trozos de 5: ' + a.toFixed(2) + ' ms (1920 filas: ' + b.toFixed(2) + ' ms)');
  assert.ok(a < 60, '480 filas ' + a.toFixed(1) + ' ms'); assert.ok(b < a * 7, 'lineal: ' + a.toFixed(1) + ' → ' + b.toFixed(1));
  // un solo nodo por celda: nada se rehace
  assert.ok(r.doc.stats.el < 480 * 12, 'elementos ' + r.doc.stats.el);
});
test('texto sin tabla sale enseguida (no espera el salto de línea); una línea con «|» espera solo hasta su salto', () => {
  const doc = fakeDoc(), host = doc.createElement('div'); const r = C.createReplyRenderer(doc, (n) => host.appendChild(n));
  r.push('Hola, aquí tienes'); assert.equal(host.textContent, 'Hola, aquí tienes'); r.push(' la lista\n| A |'); assert.equal(host.textContent, 'Hola, aquí tienes la lista\n');
  r.push(' B |\n|---|---|\n| 1 | 2 |'); assert.equal(r.rows(), 0); r.push('\n'); assert.equal(r.rows(), 1); r.finish(); assert.equal(r.raw(), 'Hola, aquí tienes la lista\n| A | B |\n|---|---|\n| 1 | 2 |\n');
});
test('celular: la burbuja pinta con el renderer (fila por fila) y el final reemplaza solo si cambió; reset borra el estado', () => {
  assert.match(UI, /function writeText\(t\) \{ var b = ensureBubble\(\); if \(!b\._md\) b\._md = C\.createReplyRenderer\(doc,[^\n]*b\._md\.push\(t\); \}/);
  assert.match(UI, /function backToThinking\(\) \{ painter\.reset\(\); if \(!bubble\) return; bubble\._md = null;/);
  assert.match(UI, /if \(bubble && bubble\._md\) bubble\._md\.finish\(\);/);
  assert.match(UI, /function addMsg\(kind, text, img\) \{ var m = el\('div', 'na-asst-msg ' \+ kind\); if \(kind === 'a'\) paintReply\(m, text\); else m\.textContent = text;/);
  assert.match(CSS, /@media \(max-width:480px\)\{[\s\S]*\.na-asst-tbl table,\.na-asst-tbl tbody,\.na-asst-tbl tr,\.na-asst-tbl td\{display:block/);
  assert.match(CSS, /\.na-asst-tl\{display:none\}/);
});
test('foto con vision:false (Bot 4): sin botón ni chip de factura, también para el dueño; el aviso de send() sigue de respaldo', () => {
  assert.match(UI, /function canPhoto\(\) \{ return isOwnerAccess\(\) && !\(access && access\.vision === false\); \}/);
  assert.equal((UI.match(/photoBtn\.hidden = !canPhoto\(\)/g) || []).length, 2);
  assert.match(UI, /\(canPhoto\(\) \? '<button type="button" data-photo>Leer factura \(foto\)<\/button>' : ''\)/);
  assert.match(UI, /\.filter\(function \(c\) \{ return c\[2\] !== 'photo' \|\| canPhoto\(\); \}\)/);
  assert.match(UI, /if \(image && access && access\.vision === false\) \{ addMsg\('u', text \|\| 'Foto'\); errMsg\('image_unsupported'\);/);
  assert.match(UI, /access\.role \+ ':' \+ access\.level \+ ':' \+ \(access\.vision === false \? 'nv' : 'v'\)/, 'si cambia vision, se vuelve a pintar el panel');
});
test('proveedor (Bot 4): «En uso» desde el inicio con lo que ya trae el servidor; a 360 la lista deja sitio a la burbuja', () => {
  assert.match(UI, /<p class="na-asst-prov-cur" role="status"><\/p>/);
  assert.match(UI, /curEl\.textContent = d\.current \? 'En uso: ' \+/);
  assert.match(UI, /'En uso: ninguno\. Falta poner una clave en el servidor\.'/);
  assert.match(CSS, /@media \(max-width:767px\)\{\.na-asst-prov-l\{padding-bottom:96px\}\}/);
});
