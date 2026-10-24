import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PERMISSIONS } from '../../tools/cloudflare-lab/src/pos-permissions.js';

// CM-073 · Regularización de stock negativo. Datos sintéticos, modo local (sin CANON).
const AJ = readFileSync('POS/js/modules/ajustes-inventario.js', 'utf8');
const SN = readFileSync('POS/js/modules/stock-negativo.js', 'utf8');
const BROWSER_PERMS = readFileSync('POS/js/config/pos-permissions.js', 'utf8');
function memStore(m = new Map()) { return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), map: m }; }
function ctx({ locked = false, owner = true, localStorage = memStore() } = {}) {
  const c = vm.createContext({ console, productos: [
    { id: 1, name: 'Galleta', stock: -3, unidad: 'unidad', costo: 1.2 },
    { id: 2, name: 'Arroz', stock: -10, unidad: 'kg', costo: 3 },
    { id: 3, name: 'Leche', stock: 5, unidad: 'unidad' },
    { id: 4, name: 'Servicio', stock: -1, controlInventario: false } ], inventoryMovements: [], saves: 0, localStorage });
  c.NA_ROLES = { isOwner: () => owner };
  c.NA_PERMISSIONS = { canAccessScreen: () => true, featureLocked: id => id === 'stock-negativo-configurable' ? locked : false };
  vm.runInContext(`globalThis.applyInventoryMovement = function (o) { var p = productos.find(function (x) { return String(x.id) === String(o.productId); });
    var before = p.stock, after = before + o.delta; var m = { id: 'IM-' + (inventoryMovements.length + 1), productId: p.id, type: o.type, before: before, delta: o.delta, after: after, reason: o.reason, source: o.source };
    inventoryMovements.push(m); p.stock = after; return { ok: true, movement: m }; };
    globalThis.saveAllData = async function () { saves++; return { ok: true }; };`, c);
  vm.runInContext(AJ, c); vm.runInContext(SN, c);
  return c;
}

test('candado: entrada existente, abierta (OK dueño 2026-10-23) y solo dueño', () => {
  assert.equal(PERMISSIONS.FEATURE_LOCKS['stock-negativo-configurable'], false);
  const c = vm.createContext({}); vm.runInContext(BROWSER_PERMS, c);
  assert.equal(c.NA_PERMISSIONS.featureLocked('stock-negativo-configurable'), false);
  assert.deepEqual([...c.NA_PERMISSIONS.FEATURE_ROLES['stock-negativo-configurable']], ['owner']);
  assert.equal(ctx({ locked: true }).NA_STOCK_NEGATIVO.available(), false);
  assert.equal(ctx({ owner: false }).NA_STOCK_NEGATIVO.available(), false);
  assert.equal(ctx().NA_STOCK_NEGATIVO.available(), true);
});

test('lista: solo productos con control de stock y stock < 0, del más negativo', () => {
  const c = ctx(); const rows = c.NA_STOCK_NEGATIVO.negatives(c.productos);
  assert.deepEqual(rows.map(r => [r.id, r.stock, r.proposed]), [['2', -10, 0], ['1', -3, 0]]);
});

test('simulación: sin valor no hay ajuste; nunca valores negativos ni menores al actual', () => {
  const sn = ctx().NA_STOCK_NEGATIVO, row = { id: '1', name: 'Galleta', stock: -3, unit: 'unidad' };
  for (const v of ['', '  ', null, '-1', 'abc', '1e3', '2.5', '0x10']) assert.equal(sn.simulate(row, v).ok, false, String(v));
  const s = sn.simulate(row, '10');
  assert.equal(s.ok, true); assert.equal(s.before, -3); assert.equal(s.after, 10); assert.equal(s.delta, 13);
  assert.match(s.summary, /-3 → 10/);
  assert.equal(sn.simulate({ ...row, unit: 'kg', stock: -1.5 }, '0,5').delta, 2);
});

test('aplicar: Corrección · Sumar con motivo rastreable; reintento no duplica; costo intacto', async () => {
  const c = ctx(), sn = c.NA_STOCK_NEGATIVO, aj = c.NA_AJUSTES_INVENTARIO;
  const row = sn.negatives(c.productos).find(r => r.id === '1'), sim = sn.simulate(row, '0');
  const [r1, r2] = await Promise.all([sn.apply(sim), sn.apply(sim)]);
  assert.equal(r1.ok, true); assert.equal(r2.ok, false); assert.equal(r2.duplicate, true);
  const r3 = await sn.apply(sim); assert.equal(r3.ok, true); assert.equal(r3.duplicate, true);
  assert.equal(c.inventoryMovements.length, 1);
  const m = c.inventoryMovements[0];
  assert.deepEqual([m.type, m.before, m.delta, m.after, m.source], ['ENTRADA', -3, 3, 0, 'ADJUSTMENT']);
  const info = aj.parseReason(m.reason);
  assert.equal(info.type, 'correccion'); assert.match(info.note, /Regularización de stock negativo: de -3 a 0/);
  assert.equal(c.productos[0].stock, 0); assert.equal(c.productos[0].costo, 1.2);
});

test('stock cambió desde la simulación: no registra nada', async () => {
  const c = ctx(), sn = c.NA_STOCK_NEGATIVO;
  const sim = sn.simulate(sn.negatives(c.productos)[0], '0');
  c.productos[1].stock = -8;
  const r = await sn.apply(sim);
  assert.equal(r.ok, false); assert.equal(r.stale, true); assert.equal(c.inventoryMovements.length, 0);
});

test('con candado cerrado no aplica aunque se llame directo', async () => {
  const c = ctx({ locked: true }), sn = c.NA_STOCK_NEGATIVO;
  const sim = sn.simulate({ id: '1', name: 'G', stock: -3, unit: '' }, '0');
  assert.equal((await sn.apply(sim)).ok, false); assert.equal(c.inventoryMovements.length, 0);
});

test('fuente: sin innerHTML, sin ownerAllowed y sin costos', () => {
  assert.doesNotMatch(SN, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(SN, /ownerAllowed/);
  assert.doesNotMatch(SN, /costo|cost_/i);
  assert.match(SN, /featureLocked\(FEATURE_ID\) === false/);
});

test('kg: decimales en la simulación y en el ajuste (delta 10.25 sin redondear en este módulo)', async () => {
  const c = ctx(), sn = c.NA_STOCK_NEGATIVO;
  c.productos[1].stock = -10.25;
  const sim = sn.simulate(sn.negatives(c.productos).find(r => r.id === '2'), '0');
  assert.equal(sim.delta, 10.25);
  const r = await sn.apply(sim); assert.equal(r.ok, true);
  assert.equal(c.inventoryMovements[0].delta, 10.25); assert.equal(c.productos[1].stock, 0);
  assert.equal(sn.simulate({ id: '2', name: 'Arroz', stock: -1, unit: 'kg' }, '0.1234').ok, true);
});

test('lotes: producto negativo con lotes queda marcado y bloqueado, sin movimiento', async () => {
  const c = ctx(), sn = c.NA_STOCK_NEGATIVO;
  c.productos[0].lots = [{ lot: 'L1', quantity: 2 }];
  const row = sn.negatives(c.productos).find(r => r.id === '1');
  assert.equal(row.lots, true);
  const sim = sn.simulate(row, '0'); assert.equal(sim.ok, false); assert.equal(sim.blocked, 'LOTS');
  const forced = await sn.apply({ ok: true, simId: 'sn-forced', productId: '1', before: -3, after: 0, delta: 3 });
  assert.equal(forced.blocked, 'LOTS'); assert.equal(c.inventoryMovements.length, 0);
});

test('idempotencia persistida: tras recargar, el mismo ajuste no se repite', async () => {
  const ls = memStore(), a = ctx({ localStorage: ls });
  const sim = a.NA_STOCK_NEGATIVO.simulate(a.NA_STOCK_NEGATIVO.negatives(a.productos).find(r => r.id === '1'), '0');
  assert.equal((await a.NA_STOCK_NEGATIVO.apply(sim)).ok, true);
  assert.deepEqual(JSON.parse(ls.getItem('na_stock_negativo_done_v1')), [sim.simId]);
  const b = ctx({ localStorage: ls }); // otra pestaña / recarga, mismos datos sintéticos (stock -3 otra vez)
  const r = await b.NA_STOCK_NEGATIVO.apply(sim);
  assert.equal(r.duplicate, true); assert.equal(b.inventoryMovements.length, 0);
});

test('unidades: decimales solo kg, g, L, mL; UND y metros enteros', () => {
  const sn = ctx().NA_STOCK_NEGATIVO;
  for (const u of ['kg', 'g', 'L', 'mL', 'litros']) assert.equal(sn.simulate({ id: 'x', name: 'x', stock: -1, unit: u }, '0.5').ok, true, u);
  for (const u of ['unidad', 'UND', 'm', '']) assert.equal(sn.simulate({ id: 'x', name: 'x', stock: -1, unit: u }, '0.5').ok, false, u);
});

test('mismo caso otra vez después de completar: nueva simulación sí se registra; reintento de la misma no', async () => {
  const ls = memStore(), c = ctx({ localStorage: ls }), sn = c.NA_STOCK_NEGATIVO;
  const row = () => sn.negatives(c.productos).find(r => r.id === '1');
  const s1 = sn.simulate(row(), '0');
  assert.equal((await sn.apply(s1)).ok, true);
  c.productos[0].stock = -3; // vuelve al mismo negativo
  assert.equal((await sn.apply(s1)).duplicate, true); // reintento de la misma simulación
  const s2 = sn.simulate(row(), '0');
  assert.notEqual(s2.simId, s1.simId);
  const r2 = await sn.apply(s2); assert.equal(r2.ok, true); assert.equal(r2.duplicate, undefined);
  assert.equal(c.inventoryMovements.length, 2); assert.equal(c.productos[0].stock, 0);
  assert.equal((await sn.apply({ ...s2, simId: '' })).ok, false);
});

test('registro podado: guarda solo los últimos 50', async () => {
  const ls = memStore(), c = ctx({ localStorage: ls }), sn = c.NA_STOCK_NEGATIVO;
  for (let i = 0; i < 55; i++) { c.productos[0].stock = -3; assert.equal((await sn.apply(sn.simulate(sn.negatives(c.productos).find(r => r.id === '1'), '0'))).ok, true); }
  assert.equal(JSON.parse(ls.getItem('na_stock_negativo_done_v1')).length, 50);
});
