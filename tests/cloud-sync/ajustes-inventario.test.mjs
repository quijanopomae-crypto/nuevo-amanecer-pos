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

function ownerCtx(extra) { return context({ NA_ROLES: { isOwner: () => true }, NA_PERMISSIONS: PERMISSIONS, crypto: globalThis.crypto, ...extra }); }

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

// Mensajes en español en vez de códigos crudos de CANON.
function rejectingCanon(lastError, lastStatus, { discardable = true } = {}) {
  const state = { journal: null, discards: 0, sent: 0 };
  const products = [{ product_id: 'p-exp', name: 'Leche', stock: 2, lots: [{ lot_id: 'L-V', lot_code: 'L-V', expiry_date: '2026-10-01', received_at: '2026-09-01T00:00:00Z', quantity: 2 }] }];
  const client = { enabled: () => true, snapshot: () => ({ products, inventoryMovements: [] }), refresh: async () => {},
    // Igual que canonical-client: el rechazo deja el comando PENDING en el diario y lanza CANONICAL_FINANCIAL_REJECTED_<status>.
    adjustInventory: async b => { state.sent++; state.journal = { state: 'PENDING', command: 'inventory.adjust', payload: b, last_error: lastError, last_status: lastStatus }; throw new Error('CANONICAL_FINANCIAL_REJECTED_' + lastStatus); },
    pendingSnapshot: () => state.journal && { ...state.journal },
    discardRejectedInventory: async () => { state.discards++; if (!discardable) return false; state.journal = null; return true; } };
  return { state, client };
}

test('Merma con stock solo en lotes vencidos: mensaje claro en español, sin el código crudo, y se libera el diario', async () => {
  const { state, client } = rejectingCanon('expired_lots_confirmation_required', 409);
  const ctx = ownerCtx({ NuevoAmanecerCanonical: client });
  const res = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p-exp', type: 'merma', quantity: 1 });
  assert.equal(res.ok, false);
  assert.equal(state.sent, 1);
  assert.equal(res.code, 'expired_lots_confirmation_required');
  assert.match(res.message, /^Este producto solo tiene stock en lotes vencidos/);
  assert.match(res.message, /Inventario con el botón «Salida»/);
  assert.match(res.message, /PIN del dueño/);
  assert.match(res.message, /No se modificó el stock\.$/);
  assert.doesNotMatch(res.message, /EXPIRED_LOTS|expired_lots|CANONICAL_FINANCIAL|REJECTED/);
  assert.equal(state.discards, 1);
  assert.equal(state.journal, null, 'el rechazo definitivo no deja el diario bloqueado');
});

test('otros códigos: mapeados en español; desconocidos conservan el código; un 5xx queda pendiente', async () => {
  const m = api.canonMessage;
  assert.match(m('INSUFFICIENT_PROJECTED_STOCK'), /ventas que aún se están enviando a CANON/);
  assert.match(m('LOT_STOCK_RESERVED_BY_PENDING_SALE'), /lotes reservados por ventas pendientes/);
  assert.match(m('INSUFFICIENT_CANONICAL_STOCK'), /No hay suficiente stock en CANON/);
  assert.match(m('insufficient_stock'), /No hay suficiente stock en CANON/);
  assert.match(m('stale_stock'), /El stock cambió en CANON/);
  assert.match(m('CANONICAL_FINANCIAL_PENDING'), /pendiente de confirmar/);
  assert.equal(m('ALGO_RARO'), 'CANON no registró el ajuste (ALGO_RARO).');
  assert.equal(m('constructor'), 'CANON no registró el ajuste (constructor).', 'no usa claves heredadas');
  // Error previo al envío (validación del cliente): se traduce directo.
  const pre = ownerCtx({ NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => ({ products: [{ product_id: 'p', name: 'Pan', stock: 1 }], inventoryMovements: [] }),
    adjustInventory: async () => { throw new Error('INSUFFICIENT_PROJECTED_STOCK'); } } });
  assert.match((await pre.NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 })).message, /ventas que aún se están enviando/);
  // Rechazo definitivo con otro código del Worker.
  const st = rejectingCanon('stale_stock', 409);
  const r2 = await ownerCtx({ NuevoAmanecerCanonical: st.client }).NA_AJUSTES_INVENTARIO.register({ productId: 'p-exp', type: 'correccion', direction: 'sumar', quantity: 1 });
  assert.match(r2.message, /El stock cambió en CANON/); assert.equal(st.state.journal, null);
  // 5xx: no es definitivo; el diario sigue pendiente y no se dice «no se modificó».
  const busy = rejectingCanon('HTTP_503', 503, { discardable: false });
  const r3 = await ownerCtx({ NuevoAmanecerCanonical: busy.client }).NA_AJUSTES_INVENTARIO.register({ productId: 'p-exp', type: 'merma', quantity: 1 });
  assert.equal(r3.pending, true);
  assert.equal(r3.retry, true);
  assert.match(r3.message, /CANON no respondió \(HTTP_503\)\. El ajuste quedó pendiente y se reintentará solo, sin duplicar/);
  assert.notEqual(busy.state.journal, null);
});

test('tipos: rechaza claves heredadas (constructor, toString, __proto__, hasOwnProperty)', async () => {
  for (const t of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.equal(api.isType(t), false, t);
    assert.throws(() => api.encodeReason(t, { nombre: 'Ana', id: '1' }, ''), /TIPO_INVALIDO/, t);
    assert.equal(api.plan(t, 1), null, t);
    assert.equal(api.parseReason('ajuste:v1:' + JSON.stringify({ t, u: { n: 'Ana', i: '1' }, n: '' })), null, t);
    assert.equal(api.lotBlocked(t, { lots: [{ quantity: 1 }] }), false, t);
  }
  for (const t of Object.keys(api.TYPES)) assert.equal(api.isType(t), true, t);
  const sent = [];
  const ctx = ownerCtx({ NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => ({ products: [{ product_id: 'p', name: 'Pan', stock: 4 }], inventoryMovements: [] }),
    adjustInventory: async b => { sent.push(b); return { ok: true }; }, refresh: async () => {} } });
  for (const t of ['constructor', 'toString']) assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: t, quantity: 1 })).ok, false, t);
  assert.equal(sent.length, 0);
  // El reporte ignora movimientos con tipo heredado.
  assert.equal(api.collect([{ id: 'x', productId: 1, delta: -1, reason: 'ajuste:v1:{"t":"constructor","u":{"n":"a","i":""},"n":""}', timestamp: '2026-10-21T10:00:00Z' }], [], []).length, 0);
});

// Validación de cantidad en register() (no solo en el campo).
function qtyCtx(products) {
  const sent = [], calls = [];
  const ctx = ownerCtx({ NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => ({ products, inventoryMovements: [] }),
    adjustInventory: async b => { sent.push(b); return { ok: true }; }, refresh: async () => {} },
    applyInventoryMovement(o) { calls.push(o); return { ok: true, movement: o }; } });
  return { ctx, sent, calls };
}
const unitProduct = { product_id: 'u-1', name: 'Galleta', unit: 'unidad', stock: 50 };
const kiloProduct = { product_id: 'k-1', name: 'Arroz a granel', unit: 'kilogramo', stock: 20 };

test('cantidad 1e12: se rechaza por superar MAX_QTY, sin enviar', async () => {
  const { ctx, sent } = qtyCtx([unitProduct]);
  assert.equal(api.MAX_QTY, 1000000);
  for (const direction of ['sumar', 'restar']) {
    const res = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'correccion', direction, quantity: 1e12 });
    assert.equal(res.ok, false); assert.equal(res.invalidQuantity, true);
    assert.match(res.message, /no puede superar 1[\s.,\u00a0\u202f]?000[\s.,\u00a0\u202f]?000 por ajuste/);
  }
  assert.equal(sent.length, 0);
});

test('cantidad 0.001 en un producto por unidad: se rechaza (solo enteros); en kilogramo se acepta', async () => {
  const { ctx, sent } = qtyCtx([unitProduct, kiloProduct]);
  const res = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'merma', quantity: 0.001 });
  assert.equal(res.ok, false); assert.equal(res.invalidQuantity, true);
  assert.match(res.message, /unidades enteras/);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'merma', quantity: 2.5 })).ok, false);
  assert.equal(sent.length, 0);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'k-1', type: 'merma', quantity: 0.001 })).ok, true);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'k-1', type: 'merma', quantity: 0.0005 })).message, 'Usa como máximo 3 decimales.');
  assert.deepEqual(sent.map(b => b.quantity), [0.001]);
});

test('cantidad NaN: mensaje en español, sin enviar', async () => {
  const { ctx, sent } = qtyCtx([unitProduct]);
  for (const quantity of [NaN, 'abc', '']) {
    const res = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'merma', quantity });
    assert.equal(res.ok, false, String(quantity)); assert.equal(res.message, 'Ingresa una cantidad válida mayor que 0.');
  }
  assert.equal(sent.length, 0);
});

test('cantidad Infinity (y ≤ 0): mensaje en español, sin enviar', async () => {
  const { ctx, sent } = qtyCtx([unitProduct]);
  for (const quantity of [Infinity, -Infinity, 0, -3]) {
    const res = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'merma', quantity });
    assert.equal(res.ok, false, String(quantity)); assert.equal(res.message, 'Ingresa una cantidad válida mayor que 0.');
  }
  assert.equal(sent.length, 0);
});

test('salidas no superan el stock; una Corrección que suma no pasa de stock + MAX_CORRECTION_UP; también en modo local', async () => {
  const { ctx, sent } = qtyCtx([unitProduct]);
  const over = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'merma', quantity: 51 });
  assert.equal(over.ok, false); assert.match(over.message, /más que el stock actual \(50\)/);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'correccion', direction: 'restar', quantity: 51 })).ok, false);
  assert.equal(api.MAX_CORRECTION_UP, 10000);
  const up = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'correccion', direction: 'sumar', quantity: 10001 });
  assert.equal(up.ok, false); assert.match(up.message, /no puede sumar más de 10[\s.,\u00a0\u202f]?000 sobre el stock actual \(50\)/);
  assert.equal(sent.length, 0);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'merma', quantity: 50 })).ok, true);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'correccion', direction: 'sumar', quantity: 10000 })).ok, true);
  // Modo local: misma validación antes de applyInventoryMovement.
  const calls = [];
  const local = ownerCtx({ productos: [{ id: 3, name: 'Pan', unidad: 'unidad', stock: 5 }], inventoryMovements: [],
    applyInventoryMovement(o) { calls.push(o); return { ok: true, movement: o }; }, saveAllData: async () => ({ persisted: true }), _naWasPersisted: r => !!r?.persisted });
  for (const quantity of [1e12, 0.001, NaN, Infinity, 6]) assert.equal((await local.NA_AJUSTES_INVENTARIO.register({ productId: 3, type: 'merma', quantity })).ok, false, String(quantity));
  assert.equal(calls.length, 0);
});

test('rechazo: solo se descarta la entrada del diario con el operation_id de ESTE ajuste', async () => {
  // Coincide: el operation_id enviado (UUID) es el del diario → se descarta.
  const ok = rejectingCanon('expired_lots_confirmation_required', 409);
  const r1 = await ownerCtx({ NuevoAmanecerCanonical: ok.client }).NA_AJUSTES_INVENTARIO.register({ productId: 'p-exp', type: 'merma', quantity: 1 });
  assert.match(r1.message, /^Este producto solo tiene stock en lotes vencidos/);
  assert.equal(ok.state.discards, 1);
  // No coincide: el diario tiene otra operación (p. ej. un movimiento de Inventario) → no se descarta.
  const other = rejectingCanon('stale_stock', 409);
  const adjust = other.client.adjustInventory;
  other.client.adjustInventory = async b => { try { await adjust(b); } catch (e) { other.state.journal.payload = { ...b, operation_id: '00000000-0000-4000-8000-000000000000' }; throw e; } };
  const r2 = await ownerCtx({ NuevoAmanecerCanonical: other.client }).NA_AJUSTES_INVENTARIO.register({ productId: 'p-exp', type: 'merma', quantity: 1 });
  assert.equal(r2.ok, false);
  assert.equal(other.state.discards, 0, 'no descarta una operación ajena');
  assert.notEqual(other.state.journal, null);
  assert.equal(r2.pending, true);
  assert.match(r2.message, /no es este ajuste \(stale_stock\)\. No se descartó/);
  // Sin crypto el ajuste igual tiene operation_id propio (respaldo): reconoce y descarta SU entrada.
  const nocrypto = rejectingCanon('stale_stock', 409);
  const r3 = await context({ NA_ROLES: { isOwner: () => true }, NA_PERMISSIONS: PERMISSIONS, NuevoAmanecerCanonical: nocrypto.client }).NA_AJUSTES_INVENTARIO.register({ productId: 'p-exp', type: 'merma', quantity: 1 });
  assert.equal(r3.ok, false); assert.equal(nocrypto.state.discards, 1);
});

test('el ajuste envía su propio operation_id (UUID)', async () => {
  const sent = [];
  const ctx = ownerCtx({ NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => ({ products: [{ product_id: 'p', name: 'Pan', stock: 4 }], inventoryMovements: [] }),
    adjustInventory: async b => { sent.push(b); return { ok: true }; }, refresh: async () => {} } });
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 })).ok, true);
  assert.match(sent[0].operation_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

// Seguimiento #856: red caída, tiempo de espera, pendiente ajena, ACK perdido, hex y aviso de «Salida».
function transportCanon(mode) {
  // Como canonical-client: un fallo de transporte guarda la entrada PENDING (sin last_error) y lanza CANONICAL_FINANCIAL_PENDING.
  const state = { journal: null, sent: 0, discards: 0 };
  const client = { enabled: () => true, snapshot: () => ({ products: [{ product_id: 'p', name: 'Pan', unit: 'unidad', stock: 10 }], inventoryMovements: [] }), refresh: async () => {},
    adjustInventory: async b => {
      if (state.journal) throw new Error('CANONICAL_FINANCIAL_PENDING'); // ranura ocupada: no se envía nada
      state.sent++; state.journal = { state: 'PENDING', command: 'inventory.adjust', payload: b };
      if (mode === 'timeout') state.journal.last_error = 'TIMEOUT';
      throw new Error('CANONICAL_FINANCIAL_PENDING');
    },
    pendingSnapshot: () => state.journal && { ...state.journal },
    discardRejectedInventory: async () => { state.discards++; return false; } };
  return { state, client };
}

test('red caída y tiempo de espera: el ajuste queda pendiente y se avisa que se reintentará (sin descartar)', async () => {
  for (const mode of ['down', 'timeout']) {
    const { state, client } = transportCanon(mode);
    const res = await ownerCtx({ NuevoAmanecerCanonical: client }).NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 });
    assert.equal(res.ok, false, mode); assert.equal(res.retry, true, mode); assert.equal(res.pending, true, mode);
    assert.match(res.message, /se reintentará solo, sin duplicar/, mode);
    assert.doesNotMatch(res.message, /puede ser este ajuste/);
    if (mode === 'timeout') assert.match(res.message, /\(TIMEOUT\)/);
    assert.equal(state.discards, 0); assert.notEqual(state.journal, null);
  }
});

test('ACK perdido: volver a pulsar Registrar no duplica (no se envía otra operación) y avisa del reintento', async () => {
  const { state, client } = transportCanon('down');
  const ctx = ownerCtx({ NuevoAmanecerCanonical: client });
  const first = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 });
  const op = state.journal.payload.operation_id;
  assert.equal(first.retry, true);
  const again = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 });
  assert.equal(again.ok, false);
  assert.equal(state.sent, 1, 'una sola operación enviada');
  assert.equal(state.journal.payload.operation_id, op, 'se conserva la MISMA operación');
  assert.equal(again.code, 'CANONICAL_FINANCIAL_PENDING');
});

test('pendiente de otra pantalla: no dice «puede ser este ajuste», no envía ni descarta', async () => {
  const { state, client } = transportCanon('down');
  state.journal = { state: 'PENDING', command: 'inventory.adjust', payload: { operation_id: 'otra-op', product_id: 'x' }, last_error: 'HTTP_503', last_status: 503 };
  const res = await ownerCtx({ NuevoAmanecerCanonical: client }).NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 });
  assert.equal(res.ok, false); assert.equal(res.retry, undefined);
  assert.equal(res.message, 'Hay otra operación de CANON pendiente de confirmar. No se registró el ajuste; espera a que se confirme o se resuelva y vuelve a intentarlo.');
  assert.doesNotMatch(res.message, /puede ser este ajuste/);
  assert.equal(state.sent, 0); assert.equal(state.discards, 0); assert.equal(state.journal.payload.operation_id, 'otra-op');
});

test('cantidad: solo decimales estrictos; «0x10», «1e3», «+2», « Infinity» se rechazan', async () => {
  for (const raw of ['0x10', '0X1A', '+2', '-2', 'Infinity', '0b11', '0o7', '2.', '.', ',', '1,2,3', '2 5', ' ']) {
    assert.ok(Number.isNaN(api.parseQuantity(raw)), raw);
    assert.equal(api.quantityError({ unit: 'unidad', stock: 100 }, 'merma', raw), 'Ingresa una cantidad válida mayor que 0.', raw);
  }
  assert.equal(api.parseQuantity('12'), 12); assert.equal(api.parseQuantity(' 2,5 '), 2.5); assert.equal(api.parseQuantity('0.125'), 0.125);
  const sent = [];
  const ctx = ownerCtx({ NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => ({ products: [{ product_id: 'p', name: 'Pan', unit: 'unidad', stock: 50 }], inventoryMovements: [] }),
    adjustInventory: async b => { sent.push(b); return { ok: true }; }, refresh: async () => {} } });
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: '0x10' })).ok, false);
  assert.equal(sent.length, 0);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: '16' })).ok, true);
  assert.equal(sent[0].quantity, 16);
});

test('lotes vencidos: el mensaje aclara que una «Salida» no aparece como «Vencido» en el reporte', () => {
  const msg = api.canonMessage('expired_lots_confirmation_required');
  assert.match(msg, /Una salida hecha con «Salida» no aparece como «Vencido» en el reporte de Ajustes\./);
});

test('operation_id nunca vacío: con randomUUID, solo getRandomValues o sin crypto siempre es un UUID v4 distinto', async () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const variants = [globalThis.crypto, { getRandomValues: a => globalThis.crypto.getRandomValues(a) }, { randomUUID: () => '' , getRandomValues: a => globalThis.crypto.getRandomValues(a) }, undefined];
  for (const crypto of variants) {
    const sent = [];
    const ctx = context({ NA_ROLES: { isOwner: () => true }, NA_PERMISSIONS: PERMISSIONS, crypto, NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => ({ products: [{ product_id: 'p', name: 'Pan', stock: 9 }], inventoryMovements: [] }),
      adjustInventory: async b => { sent.push(b); return { ok: true }; }, refresh: async () => {} } });
    for (let i = 0; i < 2; i++) assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 })).ok, true);
    assert.ok(sent.every(b => UUID.test(b.operation_id)), JSON.stringify(sent.map(b => b.operation_id)));
    assert.notEqual(sent[0].operation_id, sent[1].operation_id);
  }
});

test('canonFailure no tapa own(): ninguna variable local se llama own', () => {
  const src = readFileSync('POS/js/modules/ajustes-inventario.js', 'utf8');
  const body = src.slice(src.indexOf('async function canonFailure'), src.indexOf('if (/^CANONICAL_FINANCIAL_REJECTED_'));
  assert.doesNotMatch(body, /\b(var|let|const) own\b/);
});

// Seguimiento #869 (B2): el campo es de texto; «.5»/«,5» valen 0.5 y los exponentes avisan del tope.
test('cantidad «.5» y «,5»: se aceptan como 0.5 (kg) y se rechazan en un producto por unidad', async () => {
  assert.equal(api.parseQuantity('.5'), 0.5); assert.equal(api.parseQuantity(',5'), 0.5); assert.equal(api.parseQuantity(' ,25 '), 0.25);
  assert.equal(api.parseQuantity('1,5'), 1.5);
  for (const raw of ['5.', '.', ',', '..5', ',.5', '.5.']) assert.ok(Number.isNaN(api.parseQuantity(raw)), raw);
  assert.equal(api.quantityError(kiloProduct, 'merma', '.5'), '');
  assert.equal(api.quantityError(kiloProduct, 'merma', ',5'), '');
  assert.match(api.quantityError(unitProduct, 'merma', '.5'), /unidades enteras/);
  const { ctx, sent } = qtyCtx([unitProduct, kiloProduct]);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'k-1', type: 'merma', quantity: '.5' })).ok, true);
  assert.equal((await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'merma', quantity: '.5' })).ok, false);
  assert.deepEqual(sent.map(b => b.quantity), [0.5]);
});

test('cantidad «1e12» (texto): avisa del tope de 1 000 000, no el mensaje genérico; «1e3» pide solo números', async () => {
  const MAX = /no puede superar 1[\s.,\u00a0\u202f]?000[\s.,\u00a0\u202f]?000 por ajuste/;
  for (const raw of ['1e12', '1E12', ' 1e7 ', '1e999', '9'.repeat(400)]) {
    assert.match(api.quantityError(unitProduct, 'merma', raw), MAX, raw.slice(0, 12));
    assert.match(api.quantityError(kiloProduct, 'correccion', raw, 'sumar'), MAX, raw.slice(0, 12));
  }
  for (const raw of ['1e3', '2E1', '1e-3', 'e', '1e']) assert.equal(api.quantityError(unitProduct, 'merma', raw), 'Escribe la cantidad solo con números, sin «e» (ej. 1000).', raw);
  const { ctx, sent } = qtyCtx([unitProduct]);
  const res = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'u-1', type: 'merma', quantity: '1e12' });
  assert.equal(res.ok, false); assert.equal(res.invalidQuantity, true); assert.match(res.message, MAX);
  assert.equal(sent.length, 0);
});

test('mensajes en español para canonical_inventory_conflict y stale_authority (sin el código crudo)', () => {
  assert.match(api.canonMessage('canonical_inventory_conflict'), /otra operación cambió este producto al mismo tiempo\. No se modificó el stock/);
  assert.match(api.canonMessage('stale_authority'), /ya no tiene una autorización vigente para escribir en CANON.*No se modificó el stock/);
  for (const c of ['canonical_inventory_conflict', 'stale_authority']) assert.doesNotMatch(api.canonMessage(c), new RegExp(c));
});

test('B1: cualquier error con la entrada propia en el diario (lectura de estado caída, 503, timeout) → «quedó pendiente», nunca «no registró»', async () => {
  for (const err of ['Failed to fetch', 'CANONICAL_READ_503', 'CANONICAL_READ_TIMEOUT', 'STALE_AUTHORITY_BINDING', 'CANONICAL_COMMERCE_CLOSED']) {
    const state = { journal: null, sent: 0 };
    const client = { enabled: () => true, snapshot: () => ({ products: [{ product_id: 'p', name: 'Pan', unit: 'unidad', stock: 10 }], inventoryMovements: [] }), refresh: async () => {},
      // Como canonical-client: createCommand guarda la entrada PENDING y la lectura de estado previa al POST falla.
      adjustInventory: async b => { state.journal = { state: 'PENDING', command: 'inventory.adjust', payload: b }; throw err === 'Failed to fetch' ? new TypeError(err) : new Error(err); },
      pendingSnapshot: () => state.journal && { ...state.journal }, discardRejectedInventory: async () => { throw new Error('no debe descartar'); } };
    const res = await ownerCtx({ NuevoAmanecerCanonical: client }).NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 });
    assert.equal(res.ok, false, err); assert.equal(res.pending, true, err); assert.equal(res.retry, true, err);
    assert.equal(res.operationId, state.journal.payload.operation_id, err);
    assert.match(res.message, /El ajuste quedó pendiente y se reintentará solo, sin duplicar, cuando vuelva la conexión\. No lo registres de nuevo\./, err);
    assert.doesNotMatch(res.message, /no registró|No se registró|Failed to fetch/, err);
    if (err !== 'Failed to fetch') assert.match(res.message, new RegExp('\\(' + err + '\\)'), err);
  }
  // Sin entrada propia en el diario (falló antes de guardarla) sí se puede decir que no se registró.
  const none = { enabled: () => true, snapshot: () => ({ products: [{ product_id: 'p', name: 'Pan', unit: 'unidad', stock: 10 }], inventoryMovements: [] }),
    adjustInventory: async () => { throw new Error('CANONICAL_COMMERCE_CLOSED'); }, pendingSnapshot: () => null };
  const r = await ownerCtx({ NuevoAmanecerCanonical: none }).NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 });
  assert.equal(r.retry, undefined); assert.equal(r.message, 'CANON no registró el ajuste (CANONICAL_COMMERCE_CLOSED).');
});

test('segundo clic con el ajuste propio aún pendiente: no dice «otra operación», avisa que el anterior sigue pendiente', async () => {
  const { state, client } = transportCanon('down');
  const ctx = ownerCtx({ NuevoAmanecerCanonical: client });
  const first = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 });
  const again = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 });
  assert.doesNotMatch(again.message, /Hay otra operación/);
  assert.match(again.message, /^Tu ajuste anterior sigue pendiente en CANON y se reintentará solo\./);
  assert.equal(again.pending, true); assert.equal(again.retry, true); assert.equal(again.operationId, first.operationId);
  assert.equal(state.sent, 1);
  // Si el anterior fue rechazado (4xx) y no se descartó, no se promete reintento.
  state.journal.last_error = 'invalid_json'; state.journal.last_status = 400;
  const third = await ctx.NA_AJUSTES_INVENTARIO.register({ productId: 'p', type: 'merma', quantity: 1 });
  assert.equal(third.retry, undefined); assert.match(third.message, /^Tu ajuste anterior fue rechazado por CANON \(invalid_json\)/);
});
