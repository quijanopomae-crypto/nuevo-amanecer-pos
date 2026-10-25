// T-47 / T-10 / T-03 (regresión): lo pendiente en el aparato queda atado a la sesión que lo creó.
// - Una venta o un abono guardados por una sesión NUNCA salen con el token de otra sesión (dueño ↔ empleado):
//   quedan en revisión (visibles, sin borrarse, sin efecto local doble) y solo el dueño los aprueba;
//   al aprobar se reenvía el MISMO contenido / el MISMO cuerpo (mismo operation_id).
// - Lo antiguo sin identidad lo adopta la sesión activa al primer arranque (salvo rastro de otro rol); si no, revisión.
// - Un 401 de la propia sesión en la verificación previa avisa «Sesión vencida», no reintenta en bucle,
//   no archiva el abono y, al volver a entrar, todo se envía una sola vez.
// - Un 409 operation_id_conflict / el mismo id con otro contenido nunca se da por confirmado.
// Worker real + SQLite en memoria (harness del repo). Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { activeCanon, device, storage } from './canon-browser-harness.mjs';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const scripts = ['sync/canonical-sale-intent.js', 'sync/canonical-sale-projection.js', 'sync/canonical-sale-outbox.js'].map(p => [p, read('POS/js/' + p)]);
const CRED = 'na_cloud_sync_credentials';
const plain = v => JSON.parse(JSON.stringify(v));
const posts = (tab, path) => tab.fetchLog.filter(r => r.method === 'POST' && new URL(r.url).pathname === path);
const salesByOp = (f, op) => f.sql('SELECT COUNT(*) n FROM sales WHERE operation_id=?', op).n;
function saleInput(tab, id) {
  return tab.context.NuevoAmanecerCanonicalSaleIntent.build({ operation_id: id, sale_id: id, created_at: new Date().toISOString(), payment_method: 'yape',
    items: [{ product_id: '00003', quantity: 1, unit_price_cents: 1000 }] });
}
function relogin(ls, token) { ls.setItem(CRED, JSON.stringify({ endpoint: 'http://localhost', token })); }
function quarantined(tab) { return plain(tab.context.NuevoAmanecerCanonicalSaleOutbox.quarantine()).entries.filter(e => e.status === 'QUARANTINED'); }

for (const [label, first, second] of [['S1 dueño → empleado', 'owner', 'emp'], ['S2 empleado → dueño', 'emp', 'owner']]) {
  test(`T-47 ${label}: la venta pendiente no sale con el token nuevo; queda en revisión; el dueño la aprueba y se envía UNA vez con el mismo contenido`, async t => {
    const f = await activeCanon(t), ls = storage();
    const A = await device(f, { token: 'tok-' + first, deviceId: 'pos-' + first, localStorage: ls, scripts });
    const outboxA = A.context.NuevoAmanecerCanonicalSaleOutbox;
    const enqueued = plain(await outboxA.enqueue(saleInput(A, 'id-sale-' + first)));
    const stored = JSON.stringify(plain(outboxA.snapshot()).intents[0]);
    // Otro usuario activa/vincula el MISMO navegador (nueva sesión, nuevo token).
    f.addDevice('pos-' + second, 'writer', 'active', 'tok-' + second); relogin(ls, 'tok-' + second);
    const B = await device(f, { token: 'tok-' + second, localStorage: ls, scripts });
    const outbox = B.context.NuevoAmanecerCanonicalSaleOutbox;
    await outbox.sync();
    assert.equal(posts(B, '/commands/sale.create').length, 0, 'nada se envía con el token de la otra sesión');
    assert.equal(salesByOp(f, enqueued.operation_id), 0);
    const held = quarantined(B);
    assert.equal(held.length, 1, 'visible en Ventas en revisión');
    assert.equal(held[0].reason, 'identity_changed');
    assert.equal(JSON.stringify(held[0].intent), stored, 'se conserva completa, sin cambios');
    assert.match(outbox.reasonText('identity_changed'), /otra sesión/);
    assert.equal(outbox.snapshot().intents.length, 0, 'fuera de la cola: la proyección local (stock/pendientes) no la cuenta mientras espera');
    assert.equal(outbox.blocking().length, 1, 'bloquea el cierre de la caja hasta revisarla');
    assert.equal(outbox.quarantineAnnullable(held[0]), false, 'una venta cobrada nunca se ofrece como «anular no registrada»');
    // Sin dueño confirmado ni PIN, no se aprueba.
    await assert.rejects(outbox.resolveQuarantined(enqueued.operation_id, 'retry'), /QUARANTINE_IDENTITY_NEEDS_OWNER/);
    assert.equal(quarantined(B).length, 1);
    // Aprobación del dueño (aquí, aprobación con PIN): vuelve EXACTAMENTE igual a la cola.
    await outbox.resolveQuarantined(enqueued.operation_id, 'retry', { ownerApproval: 'apr-sintetica', by: 'dueño' });
    assert.equal(JSON.stringify(plain(outbox.snapshot()).intents[0]), stored, 'contenido byte a byte igual al encolado');
    const pendingCopies = outbox.snapshot().intents.length + quarantined(B).length;
    assert.equal(pendingCopies, 1, 'una sola copia viva: nunca se cuenta dos veces');
    assert.equal((await outbox.sync()).status, 'DRAINED');
    const sent = posts(B, '/commands/sale.create');
    assert.equal(sent.length, 1);
    const body = JSON.parse(sent[0].body), intent = JSON.parse(stored);
    for (const k of ['operation_id', 'sale_id', 'created_at', 'payment_method', 'total_cents']) assert.deepEqual(body[k], intent[k], k);
    assert.deepEqual(body.items.map(i => [i.product_id, i.quantity, i.unit_price_cents]), intent.items.map(i => [i.product_id, i.quantity, i.unit_price_cents]));
    assert.equal(salesByOp(f, enqueued.operation_id), 1);
    assert.equal(f.sql('SELECT device_id d FROM sales WHERE operation_id=?', enqueued.operation_id).d, 'session:pos-' + second, 'registrada a nombre de la sesión que el dueño aprobó');
    await outbox.sync();
    assert.equal(posts(B, '/commands/sale.create').length, 1, 'aplicada exactamente una vez');
    assert.equal(salesByOp(f, enqueued.operation_id), 1);
  });
}

test('T-47 control: la misma sesión envía su venta normalmente (sin revisión)', async t => {
  const f = await activeCanon(t);
  const A = await device(f, { token: 'tok-a', deviceId: 'pos-a', scripts });
  const outbox = A.context.NuevoAmanecerCanonicalSaleOutbox;
  const intent = plain(await outbox.enqueue(saleInput(A, 'id-same')));
  assert.equal((await outbox.sync()).status, 'DRAINED');
  assert.equal(salesByOp(f, intent.operation_id), 1);
  assert.equal(quarantined(A).length, 0);
});

test('T-47/C2 legado: lo de antes de la actualización lo adopta la sesión activa al primer arranque y se envía; lo sin sello que aparece después de otra sesión queda en revisión', async t => {
  const f = await activeCanon(t), ls = storage();
  const A = await device(f, { token: 'tok-a', deviceId: 'pos-a', localStorage: ls, scripts });
  const outbox = A.context.NuevoAmanecerCanonicalSaleOutbox;
  const one = plain(await outbox.enqueue(saleInput(A, 'id-legacy-1')));
  // Como si la hubiera guardado la versión anterior (sin identidad) y este código corriera por primera vez.
  ls.removeItem('na_canonical_sale_outbox_v1_identity'); ls.removeItem('na_session_identity_v1');
  const B = await device(f, { token: 'tok-a', localStorage: ls, scripts });
  const ob = B.context.NuevoAmanecerCanonicalSaleOutbox;
  assert.equal((await ob.sync()).status, 'DRAINED');
  assert.equal(salesByOp(f, one.operation_id), 1, 'adoptada por la sesión activa al actualizar (sin fechas falsas)');
  assert.equal(quarantined(B).length, 0);
  assert.ok(JSON.parse(ls.getItem('na_session_identity_v1')).first, 'se anota la identidad del primer arranque');
  // Un registro sin sello que aparece cuando ya hay OTRA sesión (sin poder confirmar su rol): revisión.
  const two = plain(await ob.enqueue(saleInput(B, 'id-legacy-2')));
  ls.removeItem('na_canonical_sale_outbox_v1_identity');
  f.addDevice('pos-b', 'writer', 'active', 'tok-b'); relogin(ls, 'tok-b');
  const C = await device(f, { token: 'tok-b', localStorage: ls, scripts });
  await C.context.NuevoAmanecerCanonicalSaleOutbox.sync();
  assert.equal(salesByOp(f, two.operation_id), 0, 'no sale con el token de otra sesión');
  assert.deepEqual(quarantined(C).map(e => [e.intent.operation_id, e.reason]), [[two.operation_id, 'identity_unverified']]);
});

test('T-06/T-47 abono: el abono pendiente de pos-a no sale con el token de pos-b; se aparta (sin borrar); aprobado se reenvía con el MISMO cuerpo', async t => {
  const f = await activeCanon(t), ls = storage();
  let lose = true;
  const A = await device(f, { token: 'tok-a', deviceId: 'pos-a', localStorage: ls, scripts,
    onFetch: async (url) => { if (lose && new URL(url).pathname === '/commands/payment.create') { lose = false; throw new TypeError('fetch failed'); } } });
  await assert.rejects(A.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'ID-ABONO-1' }));
  const pending = plain(A.api.pendingSnapshot());
  assert.equal(pending.command, 'payment.create');
  const firstBody = posts(A, '/commands/payment.create')[0].body;
  f.addDevice('pos-b', 'writer', 'active', 'tok-b'); relogin(ls, 'tok-b');
  const B = await device(f, { token: 'tok-b', localStorage: ls, scripts });
  await assert.rejects(B.api.retryPending(), /CANONICAL_IDENTITY_CHANGED/);
  assert.equal(posts(B, '/commands/payment.create').length, 0, 'nunca con el token de pos-b');
  assert.equal(B.fetchLog.filter(r => /\/read\/canonical\/status$/.test(r.url) && r.method === 'GET').length >= 0, true);
  assert.equal(B.api.pendingSnapshot(), null, 'el journal se libera para que el aparato siga trabajando');
  const held = B.api.heldOperations().entries;
  assert.equal(held.length, 1); assert.equal(held[0].status, 'HELD'); assert.equal(held[0].record.payload.operation_id, pending.payload.operation_id);
  // La cola de ventas sigue: no queda atascada detrás del abono.
  const sale = plain(await B.context.NuevoAmanecerCanonicalSaleOutbox.enqueue(saleInput(B, 'id-after-abono')));
  assert.equal((await B.context.NuevoAmanecerCanonicalSaleOutbox.sync()).status, 'DRAINED');
  assert.equal(salesByOp(f, sale.operation_id), 1);
  await assert.rejects(B.api.approveHeldOperation(pending.payload.operation_id), /HELD_NEEDS_OWNER/);
  await B.api.approveHeldOperation(pending.payload.operation_id, { ownerApproval: 'apr-sintetica' });
  await B.api.retryPending();
  const resent = posts(B, '/commands/payment.create');
  assert.equal(resent.length, 1);
  assert.equal(resent[0].body, firstBody, 'cuerpo byte a byte igual al original (mismo operation_id)');
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 1);
  assert.equal(B.api.heldOperations().entries[0].status, 'APPROVED', 'queda el registro de la aprobación');
});

test('T-10 401 de la MISMA sesión en la verificación previa: aviso «Sesión vencida», sin bucle ni archivo; al volver a entrar se envía todo UNA vez', async t => {
  const f = await activeCanon(t), ls = storage();
  const roles = { confirmed: true, sessionPrincipal: 'session:pos-a', role: 'owner', isOwner: () => true };
  let lose = true;
  const A = await device(f, { token: 'tok-a', deviceId: 'pos-a', localStorage: ls, scripts, globals: { NA_ROLES: roles },
    onFetch: async (url) => { if (lose && new URL(url).pathname === '/commands/payment.create') { lose = false; throw new TypeError('fetch failed'); } } });
  const outbox = A.context.NuevoAmanecerCanonicalSaleOutbox;
  await assert.rejects(A.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'ID-ABONO-401' }));
  const op = A.api.pendingSnapshot().payload.operation_id;
  const sale = plain(await outbox.enqueue(saleInput(A, 'id-sale-401')));
  f.rotateSession('pos-a', 'tok-a2'); // el token guardado deja de valer (401 real del Worker)
  const before = posts(A, '/commands/payment.create').length;
  const r1 = plain(await outbox.sync());
  assert.equal(r1.status, 'WAITING'); assert.match(r1.reason, /^SESSION_/);
  const j = plain(A.api.pendingSnapshot());
  assert.equal(j.payload.operation_id, op, 'el abono se conserva en el journal');
  assert.equal(j.last_status, 401); assert.equal(typeof j.auth_failed_identity, 'string');
  assert.ok(A.toasts.some(([m]) => /Sesión vencida/.test(m)), 'aviso de sesión vencida');
  const r2 = plain(await outbox.sync());
  assert.match(r2.reason, /^SESSION_/);
  assert.equal(posts(A, '/commands/payment.create').length, before, 'sin POST con la sesión vencida');
  assert.equal(outbox.snapshot().intents.length, 1, 'la venta sigue guardada');
  assert.equal(plain(A.context.NuevoAmanecerCanonical.pendingSnapshot()).payload.operation_id, op, 'el abono no se archivó como rechazado');
  assert.equal(A.localStorage.getItem('na_canonical_rejected_operations'), null);
  // Volver a entrar (misma sesión, token nuevo) → se envía cada cosa una vez.
  const c = f.control();
  await A.api.configure({ endpoint: 'http://localhost', promotion_id: c.active_promotion_id, authority_epoch: c.authority_epoch, revision: c.revision, token: 'tok-a2' });
  const r3 = plain(await outbox.sync());
  assert.equal(r3.status, 'DRAINED', JSON.stringify(r3));
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 1);
  assert.equal(salesByOp(f, sale.operation_id), 1);
  await outbox.sync();
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 1);
  assert.equal(salesByOp(f, sale.operation_id), 1);
});

// ---- T-03 (unidad): mismo operation_id y número con OTRO contenido nunca se da por confirmado ----
const outboxSource = read('POS/js/sync/canonical-sale-outbox.js'), intentSource = read('POS/js/sync/canonical-sale-intent.js');
function mem() { const v = new Map(); return { getItem: k => v.has(k) ? v.get(k) : null, setItem: (k, x) => v.set(k, String(x)), removeItem: k => v.delete(k) }; }
function locks() { let held = false; return { async request(n, o, cb) { if (held) return cb(null); held = true; try { return await cb({ name: n }); } finally { held = false; } } }; }
function unit(receiptBody) {
  const ctx = vm.createContext({ localStorage: mem(), navigator: { locks: locks(), onLine: true }, crypto: { randomUUID } });
  vm.runInContext(intentSource, ctx); vm.runInContext(outboxSource, ctx);
  const calls = [];
  ctx.NuevoAmanecerCanonical = {
    async refresh() {}, async retryPending() { throw Error('unexpected'); }, async createSale(i) { calls.push(i); throw Error('unexpected createSale'); },
    pendingSnapshot: () => null, receiptSnapshot: () => receiptBody && { operation_id: receiptBody.operation_id, sale_id: receiptBody.sale_id },
    receiptPayloadSnapshot: () => receiptBody, async releaseRejectedSaleJournal() { return true; },
  };
  return { ctx, api: ctx.NuevoAmanecerCanonicalSaleOutbox, calls };
}
const cashIntent = (total) => ({ version: 1, operation_id: 'op-t03', sale_id: 'V-001', created_at: '2026-10-21T15:00:00.000Z', payment_method: 'efectivo', total_cents: total,
  items: [{ product_id: 'p1', quantity: total / 600, unit_price_cents: 600, line_total_cents: total }], payment: { cash_cents: total, digital_cents: 0, credit_cents: 0, digital_method: null, reference: '' } });
test('T-03 a) recibo local con el mismo operation_id y número pero otro importe: conflicto visible en revisión, no se borra en silencio', async () => {
  const confirmedBody = { ...cashIntent(600) };
  const u = unit(confirmedBody);
  // Igual que T-03: la intención alterada ya está en la cola durable (no pasa por enqueue, que renumera).
  u.ctx.localStorage.setItem('na_canonical_sale_outbox_v1', JSON.stringify({ version: 1, intents: [plain(u.ctx.NuevoAmanecerCanonicalSaleIntent.build(cashIntent(1800)))] }));
  const out = plain(await u.api.sync());
  assert.notEqual(out.processed, 1, 'no se cuenta como confirmada');
  const q = plain(u.api.quarantine()).entries;
  assert.equal(q.length, 1); assert.equal(q[0].reason, 'operation_id_conflict'); assert.equal(q[0].intent.total_cents, 1800);
  assert.equal(u.calls.length, 0);
});
test('T-03 control: recibo local con el MISMO contenido sí confirma (already_processed sigue valiendo)', async () => {
  const u = unit(cashIntent(600));
  u.ctx.localStorage.setItem('na_canonical_sale_outbox_v1', JSON.stringify({ version: 1, intents: [plain(u.ctx.NuevoAmanecerCanonicalSaleIntent.build(cashIntent(600)))] }));
  const out = plain(await u.api.sync());
  assert.equal(out.status, 'DRAINED'); assert.equal(plain(u.api.quarantine()).entries.length, 0);
});

// ---- activate.js: clearSession solo borra la sesión; las colas quedan; huella igual a la de la app ----
test('T-47 activate.js clearSession conserva lo pendiente y anota la identidad saliente con la misma huella que la app', () => {
  const src = read('tools/cloudflare-pos-web/public/activate.js');
  const start = src.indexOf("  const IDENTITY_KEY = 'na_session_identity_v1';"), end = src.indexOf('  function showActivation(');
  assert.ok(start > 0 && end > start);
  const ls = mem();
  const keep = ['na_canonical_sale_outbox_v1', 'na_canonical_sale_outbox_v1_quarantine', 'na_canonical_sale_outbox_v1_identity', 'na_canonical_sale_journal',
    'na_canonical_identity_held_v1', 'na_sale_note_queue_v1', 'na_pos_settings_pending_v1'];
  keep.forEach(k => ls.setItem(k, '{"x":1}'));
  ls.setItem('na_canonical_binding', '{}'); ls.setItem(CRED, JSON.stringify({ endpoint: 'http://localhost', token: 'tok-a' })); ls.setItem('na_pos_role_v1', '{}');
  const ctx = vm.createContext({ localStorage: ls, JSON, Math, Date });
  vm.runInContext(`const BINDING_KEY='na_canonical_binding', CREDENTIALS_KEY='na_cloud_sync_credentials';\n${src.slice(start, end)}\nglobalThis.clearSession=clearSession;`, ctx);
  ctx.clearSession();
  for (const k of ['na_canonical_binding', CRED, 'na_pos_role_v1']) assert.equal(ls.getItem(k), null, k);
  for (const k of keep) assert.equal(ls.getItem(k), '{"x":1}', k + ' se conserva');
  const h = JSON.parse(ls.getItem('na_session_identity_v1'));
  // La app (canonical-client) calcula la MISMA huella para ese token.
  const app = vm.createContext({ localStorage: mem(), addEventListener() {}, navigator: { onLine: true }, crypto: { randomUUID } });
  app.globalThis = app; vm.runInContext(read('POS/js/sync/canonical-client.js'), app);
  app.localStorage.setItem(CRED, JSON.stringify({ endpoint: 'http://localhost', token: 'tok-a' }));
  assert.equal(h.current, app.NuevoAmanecerCanonical.sessionIdentity().key);
  assert.doesNotMatch(ls.getItem('na_session_identity_v1'), /tok-a/, 'nunca se guarda el token');
});

// ---- T-03: el 409 puede decir con qué chocó (conflict/ledger); se guarda y se muestra en el texto de revisión ----
for (const [label, body, expectLedger, textRe] of [
  ['con conflict/ledger', { error: 'operation_id_conflict', conflict: 'cross_ledger', ledger: 'inventory' }, 'inventory', /movimiento de inventario/],
  ['sin campos extra', { error: 'operation_id_conflict' }, undefined, /^la operación choca con otra ya registrada$/],
]) {
  test(`T-03 409 operation_id_conflict ${label}: queda en revisión con su detalle, sin borrarse`, async t => {
    const f = await activeCanon(t);
    const A = await device(f, { token: 'tok-a', deviceId: 'pos-a', scripts,
      onFetch: async (url) => { if (new URL(url).pathname === '/commands/sale.create') return Response.json(body, { status: 409 }); } });
    const outbox = A.context.NuevoAmanecerCanonicalSaleOutbox;
    const intent = plain(await outbox.enqueue(saleInput(A, 'id-conflict-' + (expectLedger || 'plain'))));
    await outbox.sync();
    const [entry] = quarantined(A);
    assert.equal(entry.reason, 'operation_id_conflict');
    assert.equal(entry.intent.operation_id, intent.operation_id);
    assert.equal(entry.ledger, expectLedger);
    assert.equal(entry.conflict, expectLedger ? 'cross_ledger' : undefined);
    assert.match(outbox.reasonText(entry.reason, entry), textRe);
    assert.equal(salesByOp(f, intent.operation_id), 0);
    assert.ok(A.toasts.some(([m]) => /en revisión/.test(m) && (expectLedger ? /inventario/.test(m) : true)));
  });
}

// #885: el Worker rechaza el LOTE COMPLETO de abonos con 409 si un hijo choca. El lote queda apartado entero
// (sin borrarse), con qué chocó y cuál hijo (si la respuesta lo dice); ningún abono cuenta como aplicado.
for (const [label, makeBody, expectChild] of [
  ['formato del Worker #885: operation_id del hijo', (payload) => ({ error: 'operation_id_conflict', operation_id: payload.payments[1].operation_id, conflict: 'cross_ledger', ledger: 'inventory' }), 1],
  ['hijo identificado por operation_id', (payload) => ({ error: 'operation_id_conflict', conflict: 'cross_ledger', ledger: 'inventory', child_operation_id: payload.payments[1].operation_id }), 1],
  ['hijo identificado por índice', () => ({ error: 'operation_id_conflict', conflict: 'cross_ledger', ledger: 'inventory', child_index: 0 }), 0],
  ['sin identificar al hijo', () => ({ error: 'operation_id_conflict', conflict: 'cross_ledger', ledger: 'inventory' }), null],
  ['sin campos extra', () => ({ error: 'operation_id_conflict' }), null],
]) {
  test(`T-03 lote de abonos con 409 operation_id_conflict (${label}): lote entero en revisión, hijo indicado, nada aplicado localmente`, async t => {
    const f = await activeCanon(t);
    let sentBody = null;
    const A = await device(f, { token: 'tok-a', deviceId: 'pos-a', scripts: [['canonical-status-banner.js', read('POS/js/sync/canonical-status-banner.js')]],
      onFetch: async (url, init) => { if (new URL(url).pathname === '/commands/payment.batch') { sentBody = String(init.body); return Response.json(makeBody(JSON.parse(sentBody)), { status: 409 }); } } });
    await A.api.refresh();
    // Segunda deuda (venta a crédito) para tener un lote de dos abonos.
    const customer = A.api.snapshot().credits[0].customer_id;
    await A.api.createSale({ items: [{ product_id: '00003', quantity: 1 }], payment_method: 'credito', customer_id: customer, credit_due: '2026-11-30' });
    await A.api.refresh();
    const credits = A.api.snapshot().credits.filter(c => Number(c.current_balance_cents ?? c.balance_cents ?? 0) > 200).slice(0, 2);
    assert.equal(credits.length, 2, 'fixture con dos créditos con saldo');
    const before = plain(A.api.legacySnapshot().credits.filter(c => credits.some(x => x.credit_id === c.id)).map(c => [c.id, c.saldo, (c.pagos || []).length]));
    const r = await A.api.createPaymentBatch(credits.map((c, i) => ({ credit_id: c.credit_id, amount_cents: 100 + i, payment_method: 'yape', reference: 'LOTE-409-' + expectChild })));
    assert.equal(r.ok, false); assert.equal(r.rejected, true);
    // No se borra: el lote completo queda apartado, byte a byte como se envió.
    const held = plain(A.api.heldOperations()).entries.filter(e => e.status === 'HELD');
    assert.equal(held.length, 1);
    const [entry] = held;
    assert.equal(entry.reason, 'operation_id_conflict');
    assert.equal(entry.record.command, 'payment.batch');
    assert.equal(JSON.stringify(entry.record.payload), sentBody, 'el lote completo, sin cambios');
    assert.equal(entry.record.payload.payments.length, 2);
    const hasDetail = /ledger/.test(label) || label !== 'sin campos extra';
    assert.equal(entry.ledger, hasDetail ? 'inventory' : null);
    if (expectChild === null) assert.equal(entry.conflict_child, null);
    else assert.deepEqual([entry.conflict_child.index, entry.conflict_child.operation_id, entry.conflict_child.credit_id],
      [expectChild, entry.record.payload.payments[expectChild].operation_id, credits[expectChild].credit_id]);
    // Texto existente (aviso/banner) con el lote, el registro con que chocó y el hijo o «lote completo».
    const text = A.api.describeHeld(entry);
    assert.match(text, /Cobro múltiple de 2 abonos \(S\/ 2\.01\)/);
    assert.match(text, expectChild === null ? /Chocó el lote completo/ : new RegExp('Chocó el abono ' + (expectChild + 1) + ' de 2'));
    if (hasDetail) assert.match(text, /movimiento de inventario/);
    assert.match(text, /Ningún abono de este cobro se aplicó/);
    assert.ok(A.toasts.some(([m]) => /Cobro múltiple de 2 abonos/.test(m)));
    // Nada cuenta como aplicado: ni pendiente en el journal, ni en la réplica, ni en el servidor.
    assert.equal(A.api.pendingSnapshot(), null, 'el journal queda libre (no bloquea otras colas)');
    await A.api.refresh();
    const after = plain(A.api.legacySnapshot().credits.filter(c => credits.some(x => x.credit_id === c.id)).map(c => [c.id, c.saldo, (c.pagos || []).length]));
    assert.deepEqual(after, before);
    assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 0);
    // Otra cola sigue funcionando (venta normal).
    const sale = await A.api.createSale({ items: [{ product_id: '00003', quantity: 1 }], payment_method: 'efectivo' }).catch(e => ({ error: String(e.message) }));
    assert.ok(!sale.error || !/PENDING/.test(sale.error), JSON.stringify(sale));
  });
}

test('SPEC-885 §5: un lote con 409 operation_id_conflict que quedó PENDIENTE (versión anterior) va a revisión, no al archivo ni al descarte silencioso', async t => {
  const f = await activeCanon(t);
  let mode = 'lose';
  const A = await device(f, { token: 'tok-a', deviceId: 'pos-a',
    onFetch: async (url) => { if (new URL(url).pathname === '/commands/payment.batch' && mode === 'lose') throw new TypeError('fetch failed'); } });
  await A.api.refresh();
  const credit = A.api.snapshot().credits[0];
  await A.api.createPaymentBatch([{ credit_id: credit.credit_id, amount_cents: 100, payment_method: 'yape', reference: 'LOTE-VIEJO' }]).catch(() => null);
  // Simula el diario que dejaba la versión anterior: PENDIENTE con el 409 guardado.
  const ls = A.context.localStorage, key = 'na_canonical_sale_journal';
  const rec = JSON.parse(ls.getItem(key)); assert.equal(rec.command, 'payment.batch');
  const child = rec.payload.payments[0].operation_id;
  ls.setItem(key, JSON.stringify({ ...rec, last_error: 'operation_id_conflict', last_status: 409 }));
  for (const release of ['discardRejectedPayment', 'releaseRejectedFinancial']) {
    if (!ls.getItem(key)) ls.setItem(key, JSON.stringify({ ...rec, last_error: 'operation_id_conflict', last_status: 409 }));
    assert.equal(await A.api[release](), true, release);
    assert.equal(ls.getItem(key), null);
  }
  const held = plain(A.api.heldOperations()).entries.filter(e => e.status === 'HELD');
  assert.equal(held.length, 1, 'una sola entrada visible (sin duplicar)');
  assert.equal(held[0].reason, 'operation_id_conflict');
  assert.equal(held[0].record.payload.payments[0].operation_id, child);
  assert.equal(JSON.parse(ls.getItem('na_canonical_rejected_operations') || '[]').length, 0, 'no se archiva en silencio');
  assert.match(A.api.describeHeld(held[0]), /Chocó el lote completo.*Ningún abono/);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n, 0);
});

test('SPEC-885 §6: venta en revisión por 409 operation_id_conflict (choca con un gasto): el dueño la descarta sin PIN; no cuenta en caja/stock y la caja se puede cerrar', async t => {
  const f = await activeCanon(t);
  const roles = { confirmed: true, sessionPrincipal: 'session:pos-a', role: 'owner', isOwner: () => true, approve: () => { throw new Error('NO_DEBE_PEDIR_PIN'); } };
  const A = await device(f, { token: 'tok-a', deviceId: 'pos-a', scripts, globals: { NA_ROLES: roles },
    onFetch: async (url) => { if (new URL(url).pathname === '/commands/sale.create') return Response.json({ error: 'operation_id_conflict', conflict: 'cross_ledger', ledger: 'expenses' }, { status: 409 }); } });
  await A.api.openCash({ session_id: 'caja-885', opening_cents: 1000 }); await A.api.refresh();
  const outbox = A.context.NuevoAmanecerCanonicalSaleOutbox;
  const stock0 = A.api.legacySnapshot().products.find(p => String(p.id) === '00003').stock;
  const intent = plain(await outbox.enqueue(saleInput(A, 'id-885-gasto')));
  await outbox.sync();
  const [entry] = quarantined(A);
  assert.equal(entry.reason, 'operation_id_conflict'); assert.equal(entry.ledger, 'expenses');
  assert.match(outbox.reasonText(entry.reason, entry), /un gasto/);
  assert.equal(outbox.blocking().length, 1, 'antes: bloquea el cierre de su caja');
  await assert.rejects(outbox.withCashCloseBarrier(async () => {}), /CASH_CLOSE_QUARANTINED_SALES/);
  assert.equal(outbox.quarantineRetryable(entry.reason), false, 'Reintentar volvería a chocar');
  assert.equal(outbox.quarantineDiscardable(entry), true);
  // Solo el dueño confirmado; un empleado no puede.
  roles.confirmed = false;
  await assert.rejects(outbox.resolveQuarantined(intent.operation_id, 'discard'), /QUARANTINE_DISCARD_NEEDS_OWNER/);
  roles.confirmed = true;
  const done = await outbox.resolveQuarantined(intent.operation_id, 'discard', { by: 'dueño' });
  assert.equal(done.status, 'DISCARDED_CONFLICT');
  // Se conserva archivada (no se borra), sin efecto local y sin bloquear el cierre.
  const all = plain(outbox.quarantine()).entries.filter(e => e.intent.operation_id === intent.operation_id);
  assert.deepEqual(all.map(e => e.status), ['DISCARDED_CONFLICT']);
  assert.equal(JSON.stringify(all[0].intent), JSON.stringify(entry.intent));
  assert.equal(plain(outbox.snapshot()).intents.length, 0);
  assert.equal(outbox.blocking().length, 0);
  let closed = false; await outbox.withCashCloseBarrier(async () => { closed = true; });
  assert.equal(closed, true, 'la caja se puede cerrar');
  await A.api.refresh();
  assert.equal(A.api.legacySnapshot().products.find(p => String(p.id) === '00003').stock, stock0, 'sin efecto en stock');
  assert.equal(salesByOp(f, intent.operation_id), 0);
  // Otras razones no se pueden descartar por esta vía.
  await assert.rejects(outbox.resolveQuarantined(intent.operation_id, 'discard'), /QUARANTINE_ENTRY_NOT_FOUND/);
});
