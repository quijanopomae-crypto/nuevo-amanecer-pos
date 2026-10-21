import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PERMISSIONS } from '../../tools/cloudflare-lab/src/pos-permissions.js';

// Misión 7: ajustes de inventario con motivo. Datos sintéticos.
const read = p => readFileSync(p, 'utf8');
const source = read('POS/js/modules/ajustes-inventario.js');
function context(extra = {}) { const ctx = vm.createContext(extra); vm.runInContext(source, ctx); return ctx; }
const api = context().NA_AJUSTES_INVENTARIO;
const plain = v => JSON.parse(JSON.stringify(v));

test('motivo: prefijo fijo + JSON; ida y vuelta con «·», «|» y comillas', () => {
  const user = { nombre: 'Ana "La" · Pérez | Caja', id: 'C-0001' }, note = 'Se cayó | caja · "dañada"\ny mojada';
  const reason = api.encodeReason('rotura', user, note);
  assert.ok(reason.startsWith('ajuste:v1:{'));
  assert.deepEqual(plain(api.parseReason(reason)), { type: 'rotura', label: 'Rotura', user, note: 'Se cayó | caja · "dañada" y mojada' });
  assert.throws(() => api.encodeReason('robo', user, ''), /TIPO_INVALIDO/);
});

test('motivo dentro de 500 caracteres (límite del Worker) aun con nombre y nota largos', () => {
  const r = api.encodeReason('merma', { nombre: 'N'.repeat(500), id: 'I'.repeat(500) }, '"|·'.repeat(400));
  assert.ok(r.length <= 500, String(r.length));
  const parsed = api.parseReason(r);
  assert.equal(parsed.type, 'merma'); assert.equal(parsed.user.nombre.length, 100);
});

test('compras, ventas y movimientos normales nunca se leen como ajuste', () => {
  for (const reason of ['Compra a proveedor', 'Venta V-000001', 'Entrada de inventario: +3', 'AJUSTE|merma|x', 'ajuste:v1:', 'ajuste:v1:{"t":"robo","u":{}}', 'ajuste:v1:no-json', ' ajuste:v1:{"t":"merma","u":{"n":"x"}}', null, 42])
    assert.equal(api.parseReason(reason), null, String(reason));
});

test('tipo → movimiento: merma/rotura/vencido restan; corrección suma o resta', () => {
  assert.deepEqual(plain(api.plan('merma', 2)), { movement_type: 'SALIDA', delta: -2, quantity: 2 });
  assert.deepEqual(plain(api.plan('vencido', '1.5')), { movement_type: 'SALIDA', delta: -1.5, quantity: 1.5 });
  assert.deepEqual(plain(api.plan('correccion', 4, 'sumar')), { movement_type: 'ENTRADA', delta: 4, quantity: 4 });
  assert.deepEqual(plain(api.plan('correccion', 4, 'restar')), { movement_type: 'SALIDA', delta: -4, quantity: 4 });
  assert.equal(api.plan('merma', 0), null); assert.equal(api.plan('otro', 1), null);
});

test('reporte: une local y CANON, ignora movimientos normales, fecha de Lima', () => {
  const reason = api.encodeReason('vencido', { nombre: 'Luis', id: 'C-2' }, 'lote L1');
  const rows = api.collect(
    [{ id: 'IM-1', productId: 1, type: 'SALIDA', delta: -3, reason, timestamp: '2026-10-21T03:30:00Z' }, { id: 'IM-2', productId: 1, delta: 5, reason: 'Compra a proveedor', timestamp: '2026-10-20T10:00:00Z' }],
    [{ operation_id: 'op-9', product_id: '2', movement_type: 'SALIDA', quantity: 2, reason: api.encodeReason('merma', { nombre: 'Ana', id: 'C-1' }, ''), created_at: '2026-10-19T15:00:00Z' }],
    [{ id: 1, name: 'Leche' }, { product_id: '2', name: 'Pan' }]);
  assert.deepEqual(plain(rows.map(r => [r.product, r.type, r.delta, r.day])), [['Leche', 'vencido', -3, '2026-10-20'], ['Pan', 'merma', -2, '2026-10-19']]);
  assert.equal(api.limaLabel('2026-10-21T03:30:00Z'), '20/10/2026 22:30');
  assert.deepEqual(plain(api.summary(rows)), { merma: -2, rotura: 0, vencido: -3, correccion: 0 });
  const csv = api.toCsv(rows).slice(1).split('\r\n');
  assert.equal(csv[0], 'Fecha (Lima),Producto,Tipo,Cantidad,Usuario,Nota');
  assert.equal(csv[1], 'Leche,Vencido,-3,Luis · C-2,lote L1'.replace(/^/, '20/10/2026 22:30,'));
});

function ownerCtx(extra) { return context({ NA_ROLES: { isOwner: () => true }, NA_PERMISSIONS: PERMISSIONS, ...extra }); }

test('modo local: pasa por applyInventoryMovement (nunca escribe stock), guarda y revierte si no persiste', async () => {
  const calls = [];
  const products = [{ id: 7, name: 'Arroz', stock: 10 }];
  const moves = [];
  const ctx = ownerCtx({ productos: products, inventoryMovements: moves,
    applyInventoryMovement(o) { calls.push(o); const p = products[0]; p.stock += o.delta; const m = { id: 'IM-x', ...o }; moves.push(m); return { ok: true, movement: m }; },
    saveAllData: async () => ({ persisted: true }), _naWasPersisted: r => !!r?.persisted, _naGetActiveCashier: () => ({ id: 'C-0001', nombre: 'Ana · Caja' }) });
  const res = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: '7', type: 'merma', quantity: 2, note: 'roto' });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'SALIDA'); assert.equal(calls[0].delta, -2); assert.equal(calls[0].source, 'ADJUSTMENT');
  assert.deepEqual(plain(ctx.NA_AJUSTES_INVENTARIO.parseReason(calls[0].reason).user), { nombre: 'Ana · Caja', id: 'C-0001' });
  assert.equal(products[0].stock, 8);
  ctx.saveAllData = async () => ({ persisted: false });
  const fail = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: '7', type: 'rotura', quantity: 1 });
  assert.equal(fail.ok, false); assert.equal(products[0].stock, 8); assert.equal(moves.length, 1);
});

test('modo CANON: adjustInventory con ENTRADA/SALIDA y motivo codificado; sin applyInventoryMovement', async () => {
  const sent = [];
  const ctx = ownerCtx({ NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => ({ products: [{ product_id: 'p-1', name: 'Pan', stock: 4 }], inventoryMovements: [] }),
    adjustInventory: async b => { sent.push(b); return { ok: true }; }, refresh: async () => {} },
    applyInventoryMovement() { throw new Error('no debe usarse en CANON'); } });
  const res = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p-1', type: 'correccion', direction: 'sumar', quantity: 3, note: 'conteo' });
  assert.equal(res.ok, true);
  assert.equal(sent[0].movement_type, 'ENTRADA'); assert.equal(sent[0].quantity, 3); assert.equal(sent[0].product_id, 'p-1');
  assert.ok(sent[0].reason.startsWith('ajuste:v1:') && sent[0].reason.length <= 500);
});

test('solo dueño (isOwner en try/catch) y no toca ventas ni pagos', async () => {
  for (const roles of [undefined, { isOwner: () => false }, { isOwner() { throw new Error('x'); } }]) {
    const ctx = context({ NA_ROLES: roles, NA_PERMISSIONS: PERMISSIONS });
    assert.equal(ctx.NA_AJUSTES_INVENTARIO.available(), false);
    assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 1, type: 'merma', quantity: 1 })).ok, false);
  }
  assert.deepEqual(Array.from(PERMISSIONS.SCREENS.pageAjustesInventario), ['owner']);
  assert.equal(PERMISSIONS.featureLocked('ajustes-inventario'), false);
  assert.doesNotMatch(source, /\bventas\s*[.[=]|\bcajMovs\b|\bcreditos\b|\.innerHTML\s*=|fetch\s*\(/);
  assert.doesNotMatch(source.replace('product.stock = before;', ''), /\.stock\s*=[^=]/, 'solo revierte el stock tras fallar el guardado');
});

test('Kardex clasifica los ajustes como «Ajuste», nunca como compra o venta', () => {
  const k = vm.createContext({}); vm.runInContext(read('POS/js/modules/kardex.js'), k);
  const kardexSrc = read('POS/js/modules/kardex.js');
  assert.match(kardexSrc, /move\.reason\.indexOf\('ajuste:v1:'\) === 0\) return 'Ajuste'/);
  const historial = vm.createContext({}); vm.runInContext(read('POS/js/inventory/historial-compras.js'), historial);
  const reason = api.encodeReason('correccion', { nombre: 'Compra Pérez', id: 'C-1' }, 'compra de más');
  const h = historial.NA_HISTORIAL_COMPRAS.buildHistory([], [{ movement_id: 'm1', type: 'ENTRADA', reason, product_id: '5', quantity: 3, created_at: '2026-10-20T10:00:00Z' }], '5');
  assert.equal(h.rows.length, 0, 'un ajuste ENTRADA no es una compra');
});

test('fallo al guardar: quita solo nuestro movimiento (identidad o id) y conserva los ajenos agregados durante el guardado', async () => {
  for (const copy of [false, true]) {
    const products = [{ id: 7, name: 'Arroz', stock: 10 }];
    const moves = [{ id: 'IM-prev', productId: 7, delta: 1 }];
    let saves = 0;
    const ctx = ownerCtx({ productos: products, inventoryMovements: moves,
      applyInventoryMovement(o) { products[0].stock += o.delta; const m = { id: 'IM-own', ...o }; moves.push(copy ? { ...m } : m); return { ok: true, movement: m }; },
      saveAllData: async () => { if (saves++ === 0) moves.push({ id: 'IM-other', productId: 7, delta: -1 }); return { persisted: false }; },
      _naWasPersisted: r => !!r?.persisted, _naGetActiveCashier: () => ({ id: 'C-1', nombre: 'Ana' }) });
    const res = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 7, type: 'merma', quantity: 2 });
    assert.equal(res.ok, false);
    assert.deepEqual(moves.map(x => x.id), ['IM-prev', 'IM-other'], copy ? 'por id' : 'por identidad');
    assert.equal(products[0].stock, 10);
  }
});

// Bloqueo provisional: «Rotura» y «Vencido» en productos con lotes (el Worker no permite elegir el lote).
test('hasLots: solo lotes con cantidad > 0; datos de lotes ilegibles cuentan como lotes', () => {
  assert.equal(api.hasLots(null), false);
  assert.equal(api.hasLots({ id: 1 }), false);
  assert.equal(api.hasLots({ id: 1, lots: [] }), false);
  assert.equal(api.hasLots({ id: 1, lots: [{ lot_id: 'a', quantity: 0 }] }), false);
  assert.equal(api.hasLots({ id: 1, lots: [{ lot_id: 'a', quantity: 0 }, { lot_id: 'b', quantity: 2 }] }), true);
  assert.equal(api.hasLots({ id: 1, lots_json: '[{"lot_id":"a","quantity":3}]' }), true);
  assert.equal(api.hasLots({ id: 1, lots_json: '[]' }), false);
  assert.equal(api.hasLots({ id: 1, lots_json: 'no-json' }), true);
  for (const t of ['rotura', 'vencido']) assert.equal(api.lotBlocked(t, { lots: [{ quantity: 1 }] }), true, t);
  for (const t of ['merma', 'correccion']) assert.equal(api.lotBlocked(t, { lots: [{ quantity: 1 }] }), false, t);
  assert.equal(api.lotBlocked('vencido', { lots: [] }), false);
});

test('CANON: Rotura/Vencido con lotes no se envían; Merma/Corrección y productos sin lotes sí', async () => {
  const sent = [];
  const today = '2026-10-21';
  const snapshotProducts = [
    { product_id: 'p-lot', name: 'Leche', stock: 8, lots: [{ lot_id: 'L-VENC', lot_code: 'L-VENC', expiry_date: '2026-10-01', received_at: '2026-09-01T00:00:00Z', quantity: 3 }, { lot_id: 'L-OK', lot_code: 'L-OK', expiry_date: '2026-12-01', received_at: '2026-10-01T00:00:00Z', quantity: 5 }] },
    { product_id: 'p-only-expired', name: 'Yogur', stock: 2, lots: [{ lot_id: 'L-V2', lot_code: 'L-V2', expiry_date: '2026-10-02', received_at: '2026-09-01T00:00:00Z', quantity: 2 }] },
    { product_id: 'p-plain', name: 'Pan', stock: 4 }
  ];
  const ctx = ownerCtx({ NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => ({ products: snapshotProducts, inventoryMovements: [] }),
    adjustInventory: async b => { sent.push(b); return { ok: true }; }, refresh: async () => {} },
    applyInventoryMovement() { throw new Error('no debe usarse en CANON'); } });
  for (const productId of ['p-lot', 'p-only-expired']) for (const type of ['vencido', 'rotura']) {
    const res = await ctx.NA_AJUSTES_INVENTARIO.register({ productId, type, quantity: 1, note: today });
    assert.equal(res.ok, false, productId + ' ' + type);
    assert.equal(res.blocked, 'LOTS_REQUIRE_LOT_SELECTION');
    assert.match(res.message, /lotes.*Rotura.*Vencido.*desactivados.*Se habilitarán cuando el servidor permita elegir el lote/);
  }
  assert.equal(sent.length, 0, 'ningún Rotura/Vencido con lotes llega a adjustInventory');
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p-lot', type: 'merma', quantity: 1 })).ok, true);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p-lot', type: 'correccion', direction: 'restar', quantity: 1 })).ok, true);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p-plain', type: 'vencido', quantity: 1 })).ok, true);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p-plain', type: 'rotura', quantity: 1 })).ok, true);
  assert.deepEqual(sent.map(b => [b.product_id, api.parseReason(b.reason).type]), [['p-lot', 'merma'], ['p-lot', 'correccion'], ['p-plain', 'vencido'], ['p-plain', 'rotura']]);
});

test('modo local: Rotura/Vencido con lotes tampoco llaman a applyInventoryMovement ni cambian stock', async () => {
  const calls = [];
  const products = [{ id: 9, name: 'Queso', stock: 6, lots_json: JSON.stringify([{ lot_id: 'a', lot_code: 'a', expiry_date: '2026-10-01', received_at: '2026-09-01T00:00:00Z', quantity: 6 }]) }];
  const ctx = ownerCtx({ productos: products, inventoryMovements: [],
    applyInventoryMovement(o) { calls.push(o); products[0].stock += o.delta; return { ok: true, movement: { id: 'IM-1', ...o } }; },
    saveAllData: async () => ({ persisted: true }), _naWasPersisted: r => !!r?.persisted });
  for (const type of ['vencido', 'rotura']) assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 9, type, quantity: 1 })).ok, false);
  assert.equal(calls.length, 0); assert.equal(products[0].stock, 6);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 9, type: 'merma', quantity: 1 })).ok, true);
  assert.equal(calls.length, 1);
});
