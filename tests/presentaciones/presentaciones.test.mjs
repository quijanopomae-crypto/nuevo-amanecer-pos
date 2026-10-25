import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const P = require('../../POS/js/inventory/presentaciones.js');
const prod = { id: 'SYN-1', name: 'Galleta sintética', unidad: 'unidad', precio: 1.5, unidadCompra: 'paquete', factorCompra: 6, unidCaja: 12, precioCaja: 16, stock: 0 };

test('comprar 1 caja de 12 suma 12 al stock base', () => {
  const r = P.apply(prod, { opId: 'c1', type: 'compra', qty: 1, presentation: 'caja' });
  assert.equal(r.product.stock, 12);
});
test('vender 3 UND deja 9; vender 1 plancha/paquete (factorCompra 6) resta 6', () => {
  const s = new Set();
  let p = P.apply(prod, { opId: 'c1', type: 'compra', qty: 1, presentation: 'caja' }, s).product;
  p = P.apply(p, { opId: 'v1', type: 'venta', qty: 3, presentation: 'unidad' }, s).product;
  assert.equal(p.stock, 9);
  p = P.apply(p, { opId: 'v2', type: 'venta', qty: 1, presentation: 'paquete' }, s).product;
  assert.equal(p.stock, 3);
});
test('reintento con el mismo opId no duplica efectos', () => {
  const s = new Set();
  let p = P.apply(prod, { opId: 'c1', type: 'compra', qty: 1, presentation: 'caja' }, s).product;
  const r = P.apply(p, { opId: 'c1', type: 'compra', qty: 1, presentation: 'caja' }, s);
  assert.equal(r.applied, false); assert.equal(r.product.stock, 12);
});
test('ticket muestra cantidad y presentación', () => {
  assert.equal(P.ticketLabel({ qty: 1, ventaModo: 'paquete', unitsPerQty: 6 }), '1 PAQ x6');
  assert.equal(P.ticketLabel({ qty: 3, ventaModo: 'unidad', unitsPerQty: 1 }), '3 UND');
  assert.equal(P.find(prod, 'caja').price, 16);
});
test('kg conserva decimales; unidad no acepta fracciones', () => {
  const arroz = { id: 'SYN-2', unidad: 'kg', precio: 4, stock: 10, unidadCompra: 'bolsa', factorCompra: 50 };
  let p = P.apply(arroz, { opId: 'k1', type: 'venta', qty: 0.375, presentation: 'kg' }).product;
  assert.equal(p.stock, 9.625);
  p = P.apply(p, { opId: 'k2', type: 'compra', qty: 1, presentation: 'bolsa' }).product;
  assert.equal(p.stock, 59.625);
  assert.throws(() => P.baseUnits(prod, 1.5, 'unidad'), /CANTIDAD_ENTERA_REQUERIDA/);
});
test('presentación inexistente o cantidad inválida falla cerrado', () => {
  assert.throws(() => P.baseUnits(prod, 1, 'fardo'), /PRESENTACION_INVALIDA/);
  assert.throws(() => P.baseUnits(prod, 0, 'caja'), /CANTIDAD_INVALIDA/);
});
test('bloqueo venta-por-presentacion sigue cerrado por defecto', () => {
  assert.equal(P.locked(), true);
  const src = fs.readFileSync(new URL('../../POS/js/config/pos-permissions.js', import.meta.url), 'utf8');
  assert.match(src, /'venta-por-presentacion':\s*true/);
});
test('no usa campos inventados', () => {
  const src = fs.readFileSync(new URL('../../POS/js/inventory/presentaciones.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\.presentaciones\b|\.presentacion\b|presentacionLabel/);
});
test('gramo y mililitro conservan decimales; litro también', () => {
  for (const unidad of ['gramo', 'mililitro', 'litro', 'kilogramo', 'kg']) {
    const p = { id: 'SYN-' + unidad, unidad, precio: 1, stock: 1000 };
    assert.equal(P.apply(p, { opId: 'd-' + unidad, type: 'venta', qty: 2.5, presentation: unidad }).product.stock, 997.5, unidad);
  }
});
test('lista de unidades decimales coincide con inline-02 (si el parche cm066 está aplicado)', (t) => {
  const src = fs.readFileSync(new URL('../../POS/js/legacy-inline/inline-02.js', import.meta.url), 'utf8');
  const m = /const _NA_DECIMAL_UNITS=new Set\((\[[^\]]*\])\)/.exec(src);
  if (!m) { t.skip('cm066-redondeo-kg no aplicado'); return; }
  assert.deepEqual(JSON.parse(m[1].replace(/'/g, '"')), P.DECIMAL_UNITS);
});

test('locked() lee NA_PERMISSIONS (el global real): cerrado por defecto, abre solo con false, falla cerrado', () => {
  const g = globalThis;
  const saved = g.NA_PERMISSIONS;
  try {
    g.NA_PERMISSIONS = { featureLocked: id => id !== 'otro-id' }; // cerrado salvo otro id
    assert.equal(P.locked(), true);
    g.NA_PERMISSIONS = { featureLocked: id => (id === 'venta-por-presentacion' ? false : true) };
    assert.equal(P.locked(), false, 'abierto solo si featureLocked(id) === false');
    g.NA_PERMISSIONS = { featureLocked: () => { throw new Error('x'); } };
    assert.equal(P.locked(), true, 'si la política falla, queda cerrado');
    g.NA_PERMISSIONS = {};
    assert.equal(P.locked(), true);
  } finally { g.NA_PERMISSIONS = saved; }
});
test('con la tabla real de permisos el candado venta-por-presentacion sigue CERRADO', async () => {
  const vm = await import('node:vm');
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL('../../POS/js/config/pos-permissions.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(new URL('../../POS/js/inventory/presentaciones.js', import.meta.url), 'utf8'), ctx);
  assert.equal(ctx.NA_PERMISSIONS.featureLocked('venta-por-presentacion'), true);
  assert.equal(ctx.NA_PRESENTACIONES.locked(), true);
});
test('presentaciones.js está cargado en index.html y precacheado en sw.js, sin DOM ni innerHTML', () => {
  // Otras pruebas reescriben POS/index.html en disco durante una corrida completa: se lee la versión confirmada en git (con respaldo al disco).
  let idx; try { idx = execFileSync('git', ['show', 'HEAD:POS/index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (_) { idx = fs.readFileSync(new URL('../../POS/index.html', import.meta.url), 'utf8'); }
  const sw = fs.readFileSync(new URL('../../POS/sw.js', import.meta.url), 'utf8');
  const src = fs.readFileSync(new URL('../../POS/js/inventory/presentaciones.js', import.meta.url), 'utf8');
  assert.equal((idx.match(/js\/inventory\/presentaciones\.js/g) || []).length, 1);
  assert.equal((sw.match(/js\/inventory\/presentaciones\.js/g) || []).length, 1);
  assert.doesNotMatch(src, /document\.|innerHTML|localStorage|fetch\(/);
});
