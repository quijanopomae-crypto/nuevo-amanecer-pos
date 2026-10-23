// Sobre a6d1d76e (Bot 5/2/4): un párrafo neutro largo ya no cierra una tabla del dueño abierta (las filas «|» con las mismas columnas
// siguen tapadas, también en «sigue»); «Compras de clientes:» visible; el corte de 1200 no parte fechas, horas ni números de documento;
// en el celular las filas que siguen tras el párrafo se dibujan como filas con la cabecera ya pintada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createTextEmitter, redactFor, redactText, redactOwnerData, capReply, cutPrime, ownerHold, CUT_NOTICE, REPLY_MAX } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas', ROLES = ['owner', EMP];
const red = (t, role = EMP) => redactFor(role)(t);
function emit(text, role, n, max = 1e9, prime = false) { let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, max, redactFor(role), role === 'owner' ? null : ownerHold, prime); for (let i = 0; i < text.length; i += n) e.push(text.slice(i, i + n)); e.flush(); return o; }
const same = (t, role = EMP) => { const f = red(t, role); for (const n of [1, 2, 3, 7, 13, 47]) assert.equal(emit(t, role, n), f, role + ' trozos de ' + n + ': ' + JSON.stringify(t.slice(0, 50))); return f; };
const primed = (t) => { const f = redactOwnerData(redactText(t), true); for (const n of [1, 3, 7, 47]) assert.equal(emit(t, EMP, n, 1e9, true), f, '«sigue» trozos de ' + n); return f; };

const H = 'Te paso los costos:\n| Producto | Precio |\n|---|---|\n';
const LONG = 'Esta nota tiene más de ocho palabras para ver qué pasa ahora.';
const REPROS = [
  H + '\nAquí van los productos que pediste hace un rato.\n| Producto 0 | S/ 1.80 |',
  H + '| Producto 0 | S/ 1.80 |\n\n' + LONG + '\n| Producto 1 | S/ 1.81 |',
  H + '| Producto 0 | S/ 1.80 |\n\n\nOtra cosa: el local abre a las ocho de la mañana todos los días.\n\n| Producto 1 | S/ 1.81 |',
];

test('Bot 5, 3 fugas: un párrafo neutro de 8+ palabras dentro de la tabla del dueño ya no la reinicia (entero y en partes)', () => {
  for (const t of REPROS) { const f = same(t); assert.ok(!/1\.8[01]/.test(f), JSON.stringify(f)); assert.ok(f.includes('Aquí van') || f.includes('Esta nota') || f.includes('Otra cosa'), 'el párrafo se ve'); }
  // igual sin presentación (la columna «Costo» la tapa por sí sola), con y sin línea en blanco, y con varios párrafos largos seguidos
  for (const t of ['| Producto | Costo |\n|---|---|\n| A | S/ 1.80 |\n\n' + LONG + '\n\n| B | S/ 1.81 |', '| Producto | Costo |\n|---|---|\n| A | S/ 1.80 |\n\n' + LONG + '\n| B | S/ 1.81 |',
    H + '| Producto 0 | S/ 1.80 |\n\n' + LONG + '\n\n' + LONG + '\n\n' + LONG + '\n\n| Producto 1 | S/ 1.81 |\n| Producto 2 | S/ 1.82 |']) {
    const f = same(t); assert.ok(!/1\.8[012]/.test(f), JSON.stringify(f)); }
});

// (25ffde10 → regla fija de Bot 5) un título de venta, «Lista de precios» u otra cantidad de columnas YA NO sueltan la tabla del dueño: solo
// una cabecera nueva |---| (de venta explícita, o tras un título de venta, si vino de una presentación). Ver assistant-followups-25ffde10.
test('la tabla del dueño sigue hasta el final: se suelta solo con cabecera nueva |---| de venta; texto suelto se ve', () => {
  const A = H + '| Producto 0 | S/ 1.80 |\n\n' + LONG + '\n\n';
  assert.match(same(A + 'Arroz S/ 4.20'), /4\.20/, 'texto suelto tras el párrafo: se ve');
  assert.match(same(A + 'Precios de venta:\n| Producto | PVP |\n|---|---|\n| Arroz | S/ 4.20 |'), /4\.20/, 'título de venta');
  assert.doesNotMatch(same(A + 'Lista de precios\n| Arroz | S/ 4.20 |'), /4\.20/, '«Lista de precios» sin cabecera nueva: sigue tapado (regla fija)');
  assert.match(same(A + '| Producto | PVP |\n|---|---|\n| Arroz | S/ 4.20 |'), /4\.20/, 'cabecera nueva |---| de venta');
  assert.doesNotMatch(same('| Producto | Costo |\n|---|---|\n| A | S/ 1.80 |\n\n' + LONG + '\n\n| Arroz | S/ 4.20 | 3 u |'), /4\.20/, 'otra cantidad de columnas: sigue tapado (regla fija)');
  // tabla de venta (PVP) con párrafos largos: sigue a la vista; tabla del dueño con columna PVP: PVP visible, costo tapado
  assert.match(same('Precios de venta:\n| Producto | PVP |\n|---|---|\n| A | S/ 4.10 |\n\n' + LONG + '\n\n| B | S/ 4.30 |'), /4\.10[\s\S]*4\.30/);
  const mix = same('Te paso los costos:\n| Producto | Costo | PVP |\n|---|---|---|\n| A | S/ 1.80 | S/ 2.50 |\n\n' + LONG + '\n| B | S/ 1.90 | S/ 2.60 |');
  assert.ok(!/1\.80|1\.90/.test(mix) && /2\.50/.test(mix) && /2\.60/.test(mix), mix);
});

test('«sigue» (Bot 5): la continuación con filas, párrafo largo y más filas sigue tapada; nunca destapa; el corte tras el párrafo pide contexto', () => {
  const cont = '| Producto 5 | S/ 1.85 |\n\n' + LONG + '\n| Producto 6 | S/ 1.86 |\n\nOtra cosa: el local abre a las ocho de la mañana todos los días.\n\n| Producto 7 | S/ 1.87 |';
  const p = primed(cont); assert.ok(!/1\.8[567]/.test(p), JSON.stringify(p));
  // superconjunto: todo lo tapado sin contexto sigue tapado con él (aquí sin contexto se ven, pues no hay cabecera)
  const plain = red(cont); assert.ok(plain.split('[dato del Admin]').length <= p.split('[dato del Admin]').length);
  // cabecera nueva o título de venta en la continuación: vuelve a decidir como siempre
  assert.match(primed('| Producto 5 | S/ 1.85 |\n\n' + LONG + '\n\nPrecios de venta:\n| Producto | PVP |\n|---|---|\n| Arroz | S/ 4.20 |'), /4\.20/);
  assert.match(primed('| Producto 5 | S/ 1.85 |\n\n' + LONG + '\n\n| Producto | PVP |\n|---|---|\n| Arroz | S/ 4.20 |'), /4\.20/);
  // texto suelto tras el párrafo: igual que sin contexto
  assert.equal(primed('| Producto 5 | S/ 1.85 |\n\n' + LONG + '\n\nArroz S/ 4.20').endsWith('Arroz S/ 4.20'), true);
  // la parte cortada termina tras el párrafo largo (tabla dormida): el sí/no de «sigue» dice que hay contexto del dueño
  for (const t of [REPROS[1].slice(0, REPROS[1].lastIndexOf('|', REPROS[1].length - 2) - 14), H + '| P0 | S/ 1.80 |\n\n' + LONG, '| Producto | Costo |\n|---|---|\n| A | S/ 1.80 |\n\n' + LONG])
    assert.ok(['intro', 'col'].includes(cutPrime(red(t), true)), JSON.stringify(t.slice(-40)));
  // con la ruta completa: la respuesta cortada + «sigue» con la continuación
  const rows = (a, b) => Array.from({ length: b - a }, (_, i) => '| Producto número ' + (a + i) + ' | S/ 1.' + String(a + i).padStart(2, '0') + ' |\n').join('');
  const cut = capReply(red(H + rows(0, 40) + '\n' + LONG + '\n')); assert.ok(cut.endsWith(CUT_NOTICE)); assert.ok(['intro', 'col'].includes(cutPrime(cut, true)));
  const next = primed(rows(40, 42) + '\n' + LONG + '\n' + rows(42, 45)); assert.ok(!/1\.4\d/.test(next), next);
});

test('«Compras de clientes:» (Bot 5, menor): visible como «de los clientes» solo si cuenta únicamente por «compras»', () => {
  for (const t of ['Compras de clientes: S/ 30', 'Compras de cliente: S/ 30', 'Las compras de clientes: S/ 30']) assert.equal(same(t), t);
  for (const t of ['Costo de clientes: S/ 30', 'Compras al proveedor de clientes: S/ 30', 'Compras de compra de clientes: S/ 30', 'Compras para clientes: S/ 30']) assert.ok(!/30/.test(same(t)), t);
});

test('corte de 1200 (Bot 2): no parte fechas, horas, «3/4» ni números de documento; partes = final; montos y etiquetas como antes', () => {
  const TOK = ['17/10/2026', 'F001-00012345', '3/4', '12:30', 'B002-123', '2026-10-17', 'v1.3.2', '12:30:45'];
  for (const tok of TOK) for (let off = 1; off < tok.length; off++) {
    const t = 'palabra '.repeat(100).trim() + '_'.repeat(1200 - 799 - off) + tok + '_'.repeat(80);
    assert.equal(t.indexOf(tok), 1200 - off);
    const c = capReply(redactText(t)); assert.ok(c.endsWith(CUT_NOTICE)); const body = c.slice(0, -CUT_NOTICE.length).replace(/\n+$/, '');
    assert.ok(!body.includes(tok.slice(0, off)) || body.endsWith('_'), tok + ' ' + off + ': ' + JSON.stringify(body.slice(-16)));
    assert.ok(body.endsWith('_'), 'corta justo antes: ' + JSON.stringify(body.slice(-16)));
    for (const n of [1, 4, 9, 33]) assert.equal(emit(t, 'owner', n, REPLY_MAX), c, tok + ' partes de ' + n);
  }
  // propiedad: texto con fechas/documentos/horas y montos al azar cerca del tope; ninguna pieza partida, partes = final, ambos roles
  let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), pick = (a) => a[Math.floor(rnd() * a.length)];
  const PIECES = [...TOK, 'S/ 1,250.40', '12.5 kg', 'US$2', 'F001', 'abc', 'hola-mundo', 'x/y'];
  const SEP = [' ', '_', '\n', ', ', '; ', '(', ')', ''];
  const JOIN = /[A-Za-z0-9/:.\-]+/g; let cuts = 0;
  for (let c = 0; c < 500; c++) {
    let t = ''; const spaces = rnd() < 0.5; while (t.length < 1050 + rnd() * 120) t += spaces ? pick(['palabra ', 'texto ', 'y ']) : '_';
    while (t.length < 1330) { t += pick(PIECES); t += pick(SEP); }
    for (const role of ROLES) {
      const f = red(t, role), cut = capReply(f); if (!cut.endsWith(CUT_NOTICE)) continue; cuts++;
      const body = cut.slice(0, -CUT_NOTICE.length).replace(/\n+$/, ''); assert.ok(f.startsWith(body));
      for (const m of f.matchAll(JOIN)) { const s = m.index, e = s + m[0].length; if (!/\d/.test(m[0]) || m[0].length > 40) continue;
        assert.ok(!(s < body.length && body.length < e), role + ' pieza partida ' + JSON.stringify(m[0]) + ' en ' + body.length); }
      for (const n of [1 + Math.floor(rnd() * 9), 37]) assert.equal(emit(t, role, n, REPLY_MAX), cut, role + ' partes de ' + n);
    }
  }
  assert.ok(cuts > 600, 'casos cortados ' + cuts);
});

test('celular (Bot 4): filas tras un párrafo se dibujan como filas con la cabecera ya pintada (createElement/textContent), entero y en partes', () => {
  const fake = () => { const kids = []; const mk = (tag) => ({ tagName: tag, childNodes: [], className: '', attrs: {}, appendChild(k) { this.childNodes.push(k); return k; }, setAttribute(a, v) { this.attrs[a] = v; }, set textContent(v) { this.childNodes = [{ nodeType: 3, data: v }]; } });
    return { kids, doc: { createElement: mk, createTextNode: (t) => ({ nodeType: 3, data: t }) } }; };
  const txt = (n) => (n.nodeType === 3 ? n.data : (n.childNodes || []).map(txt).join(''));
  const ths = (w) => { const out = []; const walk = (n) => { if (n.tagName === 'th') out.push(txt(n)); (n.childNodes || []).forEach(walk); }; walk(w); return out; };
  const srv = red(REPROS[1]); assert.ok(!/1\.8/.test(srv));
  for (const step of [1e9, 1, 3, 11]) {
    const f = fake(); const r = C.createReplyRenderer(f.doc, (n) => f.kids.push(n)); for (let i = 0; i < srv.length; i += step) r.push(srv.slice(i, i + step)); r.finish();
    const tables = f.kids.filter((k) => k.className === 'na-asst-tbl'); assert.equal(tables.length, 2, 'dos tablas (la segunda retoma la cabecera) en pasos de ' + step);
    assert.deepEqual(ths(tables[1]), ['Producto', 'Precio'], 'cabecera reusada de lo pintado');
    assert.ok(f.kids.filter((k) => k.nodeType === 3).every((k) => !k.data.includes('|')), 'ninguna fila como texto con «|»');
    assert.ok(txt(tables[1]).includes('Producto 1') && txt(tables[1]).includes('[dato del Admin]'));
    assert.ok(f.kids.some((k) => k.nodeType === 3 && k.data.includes('Esta nota')), 'el párrafo queda como texto');
  }
  // (Bot 4 sobre 25ffde10) otra cantidad de columnas tras la tabla: también fila (las celdas que sobran se juntan en la última), nunca texto con «|»
  const f = fake(); const r = C.createReplyRenderer(f.doc, (n) => f.kids.push(n)); r.push('| A | B |\n|---|---|\n| 1 | 2 |\n\nNota.\n| x | y | z |\n'); r.finish();
  assert.equal(f.kids.filter((k) => k.className === 'na-asst-tbl').length, 2);
  assert.ok(f.kids.filter((k) => k.nodeType === 3).every((k) => !k.data.includes('|')));
});
