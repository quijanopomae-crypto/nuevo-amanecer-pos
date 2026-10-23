// UNI-067 (tras #997): la fila mixta «2 cajas y 3 sueltos» llega a la tarjeta de compra con cantidad null y «Falta cuántas trae la caja».
// En el celular salía « × Leche…» (cantidad en blanco) y «Está bien», que dejaba pasar una fila que «Nueva compra» y el servidor
// rechazan igual. Ahora: «Falta la cantidad» en vez del «×» vacío y solo «Quitar fila». Código REAL de cardHtml (asistente-ui.js),
// readLines (pos-purchases-client.js) y purchasesRoute (pos-purchases.js); no se toca el guardado de «Nueva compra».
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
test('422 del servidor (markRows): a una fila sin cantidad tampoco se le ofrece «Está bien»', () => {
  const m = sliceFn(UI, '    function markRows(idx, limit) {', '    // «Pedir de nuevo»');
  assert.match(m, /limit \|\| noQty\(p\.lineas && p\.lineas\[i\]\) \? '' : '<button type="button" data-accept=/);
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
