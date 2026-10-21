// Ajustes de inventario contra el Worker CANON real (arnés de navegador): rechazo definitivo, 5xx,
// red caída, tiempo de espera, ACK perdido y pendientes de otra pantalla. Basado en la prueba del asistente 3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { activeCanon, device } from './canon-browser-harness.mjs';

const PERMS = readFileSync('POS/js/config/pos-permissions.js', 'utf8');
const AJ = readFileSync('POS/js/modules/ajustes-inventario.js', 'utf8');
const MIG = ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql'];
const RETRY = /El ajuste quedó pendiente y se reintentará solo, sin duplicar, cuando vuelva la conexión\. No lo registres de nuevo\./;
const OTHER = 'Hay otra operación de CANON pendiente de confirmar. No se registró el ajuste; espera a que se confirme o se resuelva y vuelve a intentarlo.';

async function tab(f, o) {
  const d = await device(f, { ...o, globals: { NA_ROLES: { isOwner: () => true } } });
  vm.runInContext(PERMS, d.context);
  vm.runInContext('(function(){var __d=globalThis.document;globalThis.document=undefined;try{' + AJ + '}finally{globalThis.document=__d;}})()', d.context);
  d.aj = d.context.NA_AJUSTES_INVENTARIO;
  return d;
}
const prod = f => f.sql('SELECT product_id FROM products WHERE tracks_inventory=1 AND current_stock_quantity>=0 ORDER BY product_id LIMIT 1');
async function seed(f, x, ...tabs) {
  await x.api.adjustInventory({ product_id: x.__pid, movement_type: 'ENTRADA', quantity: 20, reason: 'seed' });
  for (const t of tabs) await t.api.refresh();
  return f.sql('SELECT product_id,current_stock_quantity q,stock_revision r,unit FROM products WHERE product_id=?', x.__pid);
}
const row = (f, id) => f.sql('SELECT current_stock_quantity q,stock_revision r FROM products WHERE product_id=?', id);
const isAdjust = url => url.endsWith('/commands/inventory.adjust');

test('409 stale_stock: descarta solo su entrada, la DB queda intacta y luego se puede reintentar', async t => {
  const f = await activeCanon(t, { migrations: MIG }); let p = prod(f);
  const a = await tab(f, { token: 'ta', deviceId: 'da' }), b = await tab(f, { token: 'tb', deviceId: 'db' });
  a.__pid = p.product_id; p = await seed(f, a, a, b);
  assert.equal((await a.aj.register({ productId: p.product_id, type: 'merma', quantity: 1 })).ok, true);
  const before = row(f, p.product_id);
  const res = await b.aj.register({ productId: p.product_id, type: 'merma', quantity: 1 });
  assert.equal(res.ok, false); assert.equal(res.code, 'stale_stock');
  assert.match(res.message, /El stock cambió en CANON/);
  assert.equal(b.api.pendingSnapshot(), null);
  assert.deepEqual(row(f, p.product_id), before);
  await b.api.refresh();
  assert.equal((await b.aj.register({ productId: p.product_id, type: 'merma', quantity: 1 })).ok, true);
});

test('503: queda pendiente, avisa que se reintentará y retryPending lo aplica una sola vez', async t => {
  const f = await activeCanon(t, { migrations: MIG }); let p = prod(f); let fail = false;
  const a = await tab(f, { token: 'ta', deviceId: 'da', onFetch: async url => {
    if (isAdjust(url) && fail) { fail = false; return new Response(JSON.stringify({ error: 'service_unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } }); }
    return null;
  } });
  a.__pid = p.product_id; p = await seed(f, a, a); fail = true;
  const res = await a.aj.register({ productId: p.product_id, type: 'merma', quantity: 2 });
  assert.equal(res.pending, true); assert.equal(res.retry, true); assert.match(res.message, RETRY);
  assert.ok(a.api.pendingSnapshot());
  assert.equal(row(f, p.product_id).q, p.q);
  await a.api.retryPending();
  assert.equal(row(f, p.product_id).q, p.q - 2); assert.equal(a.api.pendingSnapshot(), null);
});

test('red caída sin commit: se conserva, avisa del reintento y se aplica una vez', async t => {
  const f = await activeCanon(t, { migrations: MIG }); let p = prod(f); let down = false;
  const a = await tab(f, { token: 'ta', deviceId: 'da', onFetch: async url => { if (isAdjust(url) && down) { down = false; throw new TypeError('Failed to fetch'); } return null; } });
  a.__pid = p.product_id; p = await seed(f, a, a); down = true;
  const r1 = await a.aj.register({ productId: p.product_id, type: 'merma', quantity: 1 });
  assert.equal(r1.ok, false); assert.equal(r1.retry, true); assert.match(r1.message, RETRY);
  assert.doesNotMatch(r1.message, /puede ser este ajuste/);
  assert.ok(a.api.pendingSnapshot()); assert.equal(row(f, p.product_id).q, p.q);
  await a.api.retryPending();
  assert.equal(row(f, p.product_id).q, p.q - 1); assert.equal(a.api.pendingSnapshot(), null);
});

test('tiempo de espera agotado: se conserva y avisa del reintento', async t => {
  const f = await activeCanon(t, { migrations: MIG }); let p = prod(f); let slow = false;
  const a = await tab(f, { token: 'ta', deviceId: 'da', onFetch: async url => {
    if (isAdjust(url) && slow) { slow = false; const e = new Error('The operation timed out.'); e.name = 'TimeoutError'; throw e; }
    return null;
  } });
  a.__pid = p.product_id; p = await seed(f, a, a); slow = true;
  const res = await a.aj.register({ productId: p.product_id, type: 'merma', quantity: 1 });
  assert.equal(res.ok, false); assert.equal(res.retry, true); assert.match(res.message, RETRY);
  assert.ok(a.api.pendingSnapshot());
  await a.api.retryPending();
  assert.equal(row(f, p.product_id).q, p.q - 1);
});

test('ACK perdido tras commit: volver a Registrar no duplica y el reintento conserva la MISMA operación', async t => {
  const f = await activeCanon(t, { migrations: MIG }); let p = prod(f); let lost = false;
  const a = await tab(f, { token: 'ta', deviceId: 'da', onFetch: async (url, _o, fwd) => { if (isAdjust(url) && lost) { lost = false; await fwd(); throw new TypeError('lost ack'); } return null; } });
  a.__pid = p.product_id; p = await seed(f, a, a); lost = true;
  const r1 = await a.aj.register({ productId: p.product_id, type: 'merma', quantity: 1 });
  const j1 = a.api.pendingSnapshot();
  assert.equal(r1.retry, true); assert.match(r1.message, RETRY);
  assert.ok(j1); assert.equal(row(f, p.product_id).q, p.q - 1);
  // El usuario vuelve a pulsar Registrar: no se envía otra operación ni se descarta la pendiente.
  const r2 = await a.aj.register({ productId: p.product_id, type: 'merma', quantity: 1 });
  assert.equal(r2.ok, false);
  assert.equal(a.api.pendingSnapshot().payload.operation_id, j1.payload.operation_id);
  assert.equal(row(f, p.product_id).q, p.q - 1);
  // El reintento usa el mismo operation_id: CANON lo reconoce y no descuenta dos veces.
  await a.api.retryPending();
  assert.equal(a.api.pendingSnapshot(), null);
  assert.equal(row(f, p.product_id).q, p.q - 1);
});

test('pendiente de otra pantalla (rechazada 409, otro producto): no se descarta ni se dice «puede ser este ajuste»', async t => {
  const f = await activeCanon(t, { migrations: MIG }); let p = prod(f);
  const other = f.sql('SELECT product_id FROM products WHERE tracks_inventory=1 AND product_id<>? ORDER BY product_id LIMIT 1', p.product_id);
  const a = await tab(f, { token: 'ta', deviceId: 'da' }), b = await tab(f, { token: 'tb', deviceId: 'db' });
  a.__pid = p.product_id; p = await seed(f, a, a, b);
  await a.api.adjustInventory({ product_id: other.product_id, movement_type: 'ENTRADA', quantity: 1, reason: 'Entrada de inventario: +1' });
  await assert.rejects(b.api.adjustInventory({ product_id: other.product_id, movement_type: 'ENTRADA', quantity: 1, reason: 'Entrada de inventario: +1' }), /REJECTED_409/);
  const foreign = b.api.pendingSnapshot();
  const before = row(f, p.product_id);
  const res = await b.aj.register({ productId: p.product_id, type: 'merma', quantity: 1 });
  assert.equal(res.ok, false); assert.equal(res.message, OTHER);
  const after = b.api.pendingSnapshot();
  assert.equal(after.payload.operation_id, foreign.payload.operation_id); assert.equal(after.last_error, 'stale_stock');
  assert.deepEqual(row(f, p.product_id), before);
});

test('pendiente de otra pantalla 503 (mismo producto): no se descarta y no se registra un segundo movimiento', async t => {
  const f = await activeCanon(t, { migrations: MIG }); let p = prod(f); let fail = false;
  const a = await tab(f, { token: 'ta', deviceId: 'da', onFetch: async url => { if (isAdjust(url) && fail) { fail = false; return new Response('{"error":"x"}', { status: 503, headers: { 'content-type': 'application/json' } }); } return null; } });
  a.__pid = p.product_id; p = await seed(f, a, a); fail = true;
  await assert.rejects(a.api.adjustInventory({ product_id: p.product_id, movement_type: 'SALIDA', quantity: 1, reason: 'Salida de inventario: -1' }), /REJECTED_503/);
  const foreign = a.api.pendingSnapshot();
  const res = await a.aj.register({ productId: p.product_id, type: 'merma', quantity: 1 });
  assert.equal(res.ok, false); assert.equal(res.message, OTHER); assert.equal(res.retry, undefined);
  assert.equal(a.api.pendingSnapshot().payload.operation_id, foreign.payload.operation_id);
  assert.equal(row(f, p.product_id).q, p.q);
});

// Seguimiento #869 (B1): falla SOLO la lectura de estado previa al POST (red caída, 503, timeout real de 8 s).
// createCommand ya guardó la entrada PENDING con el operation_id de este ajuste: la pantalla no puede decir
// «no registró», porque el reintento la aplica después. Se comprueba el aviso y que se aplica UNA sola vez.
const isStatus = url => url.includes('/read/canonical/status');
const opsOf = (f, id) => f.sql("SELECT COUNT(*) n FROM canonical_inventory_operations WHERE product_id=? AND reason LIKE 'ajuste:v1:%'", id).n;
for (const [mode, code] of [['red caída', null], ['503', 'CANONICAL_READ_503'], ['timeout', 'CANONICAL_READ_TIMEOUT']]) {
  test(`lectura de estado previa al POST falla (${mode}): «quedó pendiente», sin «no registró», y se aplica una sola vez`, { timeout: 40000 }, async t => {
    const f = await activeCanon(t, { migrations: MIG }); let p = prod(f); let fail = false, statusCalls = 0, posts = 0;
    const a = await tab(f, { token: 'ta', deviceId: 'da', onFetch: async url => {
      if (isAdjust(url)) posts++;
      if (!isStatus(url) || !fail) return null;
      fail = false; statusCalls++;
      if (mode === 'red caída') throw new TypeError('Failed to fetch');
      if (mode === '503') return new Response('{"error":"service_unavailable"}', { status: 503, headers: { 'content-type': 'application/json' } });
      return new Promise(() => {}); // sin respuesta: vence el plazo real de lectura (8 s)
    } });
    a.__pid = p.product_id; p = await seed(f, a, a); fail = true; posts = 0;
    const res = await a.aj.register({ productId: p.product_id, type: 'merma', quantity: 1 });
    assert.equal(statusCalls, 1, 'falló exactamente la lectura de estado'); assert.equal(posts, 0, 'no llegó a enviarse el POST');
    assert.equal(res.ok, false); assert.equal(res.pending, true); assert.equal(res.retry, true); assert.match(res.message, RETRY);
    assert.doesNotMatch(res.message, /no registró|No se registró|Hay otra operación|Failed to fetch/);
    if (code) assert.match(res.message, new RegExp('^CANON no respondió \\(' + code + '\\)\\.'));
    const j = a.api.pendingSnapshot();
    assert.ok(j); assert.equal(j.payload.operation_id, res.operationId);
    assert.equal(row(f, p.product_id).q, p.q);
    // El dueño vuelve a pulsar Registrar: no se envía una segunda operación.
    const again = await a.aj.register({ productId: p.product_id, type: 'merma', quantity: 1 });
    assert.equal(again.ok, false); assert.doesNotMatch(again.message, /Hay otra operación/); assert.match(again.message, /^Tu ajuste anterior sigue pendiente/);
    assert.equal(a.api.pendingSnapshot().payload.operation_id, res.operationId); assert.equal(posts, 0);
    // El reintento (banner al reconectar) aplica la MISMA operación una sola vez: 20 → 19.
    const receipt = await a.api.retryPending();
    assert.equal(receipt.operation_id, res.operationId);
    assert.equal(a.api.pendingSnapshot(), null);
    assert.equal(row(f, p.product_id).q, p.q - 1); assert.equal(opsOf(f, p.product_id), 1);
    await assert.rejects(a.api.retryPending(), /NO_CANONICAL_FINANCIAL_PENDING/);
    assert.equal(row(f, p.product_id).q, p.q - 1);
  });
}
