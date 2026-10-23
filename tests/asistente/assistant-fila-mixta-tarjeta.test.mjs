// UNI-067 (tras #997): la fila mixta «2 cajas y 3 sueltos» llega a la tarjeta de compra con cantidad null y «Falta cuántas trae la caja».
// En el celular salía « × Leche…» (cantidad en blanco) y «Está bien», que dejaba pasar una fila que «Nueva compra» y el servidor
// rechazan igual. Ahora: «Falta la cantidad» en vez del «×» vacío y solo «Quitar fila». Código REAL de cardHtml (asistente-ui.js),
// readLines (pos-purchases-client.js) y purchasesRoute (pos-purchases.js); no se toca el guardado de «Nueva compra».
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { makeDoc, Node_ } from './fake-dom.mjs';
import { purchasesRoute } from '../../tools/cloudflare-lab/src/pos-purchases.js';
import { MISSING_BOX_TEXT } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const UI = read('POS/js/modules/asistente/asistente-ui.js'), PUR = read('POS/js/config/pos-purchases-client.js');
const sliceFn = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

function card(lineas) {
  const ctx = vm.createContext({ C, deps: { productos: () => [{ id: 'P1', nombre: 'Leche Gloria 395g' }], clientes: () => [] }, String, Number, Math, Array, Object });
  vm.runInContext(sliceFn(UI, '  function soles(n) {', '  // (Bot 2 sobre d72b7601, INFO)') + sliceFn(UI, '  function lineName(l) {', '  function cardHtml(p) {') +
    sliceFn(UI, '  function cardHtml(p) {', '  function tokenData(p)'), ctx);
  return ctx.cardHtml({ type: 'compra', title: 'Compra', lineas });
}
const MIX = { product_id: null, nombre: 'Leche Gloria (2 cajas y 3 sueltos)', cantidad: null, costo_unitario: 3.5, costo_actual: null, revisar: [MISSING_BOX_TEXT] };

test('tarjeta: fila mixta sin cantidad = «Falta la cantidad» (sin «×» en blanco) y solo «Quitar fila» (sin «Está bien»)', () => {
  for (const cantidad of [null, undefined, '']) {
    const h = card([{ ...MIX, cantidad }]);
    assert.doesNotMatch(h, /data-accept/, 'sin «Está bien»: ' + JSON.stringify(cantidad));
    assert.match(h, /data-drop="0">Quitar fila</);
    assert.doesNotMatch(h, /<td>\s*×/, 'sin cantidad en blanco delante del «×»');
    assert.match(h, /Falta la cantidad/);
    assert.match(h, /Falta cuántas trae la caja/);
  }
});
test('tarjeta: una fila con cantidad y algo raro sigue con «Está bien» y «Quitar fila»; sin marcas, sin botones', () => {
  const h = card([{ product_id: 'P1', nombre: 'Leche', cantidad: 500, costo_unitario: 3.5, costo_actual: 3.4, revisar: ['cantidad'] }, { product_id: 'P1', nombre: 'Leche', cantidad: 2, costo_unitario: 3.5, costo_actual: 3.4 }]);
  assert.match(h, /data-accept="0">Está bien</); assert.match(h, /data-drop="0">Quitar fila</); assert.doesNotMatch(h, /data-(?:accept|drop)="1"/);
  assert.match(h, /<td>500 × Leche Gloria 395g/); assert.match(h, /<td>2 × Leche Gloria 395g/);
});
// 422 del servidor: markRows REAL (sacado de asistente-ui.js) sobre el DOM de prueba (fake-dom.mjs), con querySelector mínimo.
function shimDom() {
  const doc = makeDoc(), P = Node_.prototype;
  const match = (n, sel) => { if (n.nodeType !== 1) return false; if (sel[0] === '.') return n._cls.has(sel.slice(1));
    const m = /^tr\[data-row="(\d+)"\]$/.exec(sel); if (m) return n.tagName === 'TR' && (n.dataset.row === m[1] || n.attrs['data-row'] === m[1]);
    return n.tagName === sel.toUpperCase(); };
  P.querySelectorAll = function (sel) { if (sel === 'table tr') return this.byTag('table').flatMap((t) => t.byTag('tr')); return this.all().filter((n) => match(n, sel)); };
  P.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  P.removeAttribute = function (k) { delete this.attrs[k]; if (k.startsWith('data-')) delete this.dataset[k.slice(5)]; };
  return doc;
}
function cardDom(doc, lineas, flaggedAtRender) {
  const c = doc.createElement('div'), table = doc.createElement('table'); c.appendChild(table);
  const head = doc.createElement('tr'); head.appendChild(doc.createElement('th')); table.appendChild(head);
  lineas.forEach((l, i) => { const tr = doc.createElement('tr'), td = doc.createElement('td'); td.textContent = (l.cantidad == null ? 'Falta la cantidad · ' : l.cantidad + ' × ') + l.nombre; tr.appendChild(td); table.appendChild(tr);
    if (flaggedAtRender.includes(i)) { tr.classList.add('flag'); tr.dataset.row = String(i); const t = doc.createElement('div'); t.className = 'flag-t'; t.textContent = 'Revisa este dato: algo'; td.appendChild(t);
      const a = doc.createElement('div'); a.className = 'flag-a'; td.appendChild(a); } });
  return c;
}
function runMarkRows(lineas, idx, limit, flaggedAtRender = []) {
  const doc = shimDom(), c = cardDom(doc, lineas, flaggedAtRender), decided = { 0: 'accept', 1: 'accept' };
  const ctx = vm.createContext({ doc, c, p: { type: 'compra', lineas }, decided, String, Number });
  vm.runInContext(sliceFn(UI, '  function el(tag, cls, html) {', '\n') + '\n' + sliceFn(UI, '  var REVIEW_TEXT = ', '\n') + '\n' +
    sliceFn(UI, '  function noQty(l) {', '  function cardHtml(p) {') + sliceFn(UI, '    function markRows(idx, limit) {', '    // «Pedir de nuevo»'), ctx);
  ctx.markRows(idx, limit);
  const rows = c.querySelectorAll('table tr').slice(1);
  return { decided, rows: rows.map((tr) => ({ flag: tr._cls.has('flag'), notice: tr.querySelector('.flag-t')?.textContent ?? null, buttons: tr.querySelector('.flag-a')?.innerHTML ?? null })) };
}
const OK = { product_id: 'P1', nombre: 'Leche', cantidad: 500, costo_unitario: 3.5, costo_actual: 3.4, revisar: ['cantidad'] };

test('422 (markRows real): fila sin cantidad -> conserva su aviso «Falta cuántas trae la caja» y solo «Quitar fila»', () => {
  for (const flaggedAtRender of [[], [0]]) { // marcada por el servidor recién en el 422, o ya marcada al dibujar la tarjeta
    const r = runMarkRows([MIX, OK], [0, 1], false, flaggedAtRender);
    const [mix, ok] = r.rows;
    assert.ok(mix.flag);
    assert.match(mix.notice, /Falta cuántas trae la caja/, 'el aviso propio de la fila: ' + mix.notice);
    assert.notEqual(mix.notice, 'Revisa este dato');
    assert.doesNotMatch(mix.buttons, /data-accept/); assert.match(mix.buttons, /data-drop="0">Quitar fila</);
    assert.equal(ok.notice, 'Revisa este dato', 'fila con cantidad: igual que antes');
    assert.match(ok.buttons, /data-accept="1">Está bien</); assert.match(ok.buttons, /data-drop="1">Quitar fila</);
    assert.deepEqual({ ...r.decided }, {}, 'el 422 borra las decisiones previas de esas filas');
  }
  const bare = runMarkRows([{ ...MIX, revisar: undefined }], [0], false).rows[0]; // sin «revisar»: igual dice qué falta
  assert.match(bare.notice, /Falta la cantidad/); assert.doesNotMatch(bare.buttons, /data-accept/);
});
test('422 de límite (markRows real): el texto de límite y solo «Quitar fila», con o sin cantidad', () => {
  const r = runMarkRows([MIX, OK], [0, 1], true);
  for (const [i, row] of r.rows.entries()) { assert.equal(row.notice, 'Fuera del límite: quita la fila o corrige la factura'); assert.equal(row.buttons, '<button type="button" data-drop="' + i + '">Quitar fila</button>'); }
});

// «Nueva compra»: una fila sin cantidad no se registra (readLines la marca como mala; el botón Registrar muestra «Revisa la línea N»).
test('«Nueva compra» rechaza la fila sin cantidad (readLines -> bad)', () => {
  const row = (label, qty) => { const v = { '.na-pur-prod': label, '.na-pur-qty': qty, '.na-pur-cost': '3.50', '.na-pur-lot': '', '.na-pur-expiry': '' };
    return { querySelector: (s) => ({ value: v[s] }) }; };
  const w = { querySelectorAll: () => [row('Leche Gloria 395g', ''), row('Leche Gloria 395g', '2')] };
  const ctx = vm.createContext({ Set, Number, Math, String, root: {}, productByLabel: (l) => (l === 'Leche Gloria 395g' ? { id: 'P1' } : null) });
  vm.runInContext(sliceFn(PUR, '  function readLines(w) {', '\n  }\n') + '\n  }', ctx);
  const r = ctx.readLines(w);
  assert.deepEqual([...r.bad], [1]); assert.equal(r.lines.length, 1); assert.equal(r.lines[0].quantity, 2);
  assert.match(PUR, /if \(r\.bad\.length\) \{ fail\('Revisa la línea '/);
});

test('servidor POST /auth/purchases: línea sin cantidad (null, 0 o falta) -> 400 invalid_line, sin escribir nada', async () => {
  const writes = [];
  const db = { prepare: (sql) => ({ bind() { return this; }, first: async () => { if (/sqlite_master/.test(sql)) return { ok: 1 }; writes.push(sql); return null; },
    all: async () => { writes.push(sql); return { results: [] }; }, run: async () => { writes.push(sql); return {}; } }) };
  const json = (b, s = 200) => ({ status: s, body: b });
  for (const quantity of [null, 0, undefined]) {
    const line = { line: 1, product_id: 'P1', unit_cost_cents: 350 }; if (quantity !== undefined) line.quantity = quantity;
    const body = { operation_id: 'pur-1', promotion_id: 'promo', authority_epoch: 1, expected_control_revision: 1, client_contract: 'x', created_at: new Date().toISOString(), lines: [line] };
    const r = await purchasesRoute({ method: 'POST', url: 'https://x/auth/purchases', json: async () => body }, { DB: db }, { principalId: 'owner' }, json);
    assert.equal(r.status, 400, JSON.stringify(quantity)); assert.equal(r.body.error, 'invalid_line');
  }
  assert.equal(writes.length, 0);
});
