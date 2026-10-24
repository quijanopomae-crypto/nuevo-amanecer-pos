// F2 (#884): al cambiar de rol con un commit pendiente de relectura, la relectura es COMPLETA y nada de la
// identidad anterior (gastos, movimientos, eventos financieros, sellos, esperado de caja) se reutiliza ni se persiste.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { activeCanon, device, storage } from './canon-browser-harness.mjs';
import { webLocks } from './web-locks-sim.mjs';

const GUARD = readFileSync(new URL('../../POS/js/sync/cache-identity-guard.js', import.meta.url), 'utf8');
const CREDIT = 'CR:001';
const EXPENSE_CENTS = 4321, EXPENSE_NOTE = 'GASTO-DUENO-F2';
const COLLECTIONS = ['products', 'customers', 'credits', 'payments', 'creditAccounts', 'sales', 'saleItems', 'inventoryMovements', 'cashMovements', 'cashSessions', 'financialEvents', 'expenses'];
const pick = (s) => JSON.parse(JSON.stringify(Object.fromEntries(COLLECTIONS.map((k) => [k, s[k]]))));
const reads = (log) => log.filter((x) => x.method === 'GET' && x.url.includes('/read/canonical/')).map((x) => new URL(x.url).pathname.replace('/read/canonical/', ''));
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
function fingerprint(token) { const ctx = { setTimeout, clearTimeout, Promise }; vm.createContext(ctx); vm.runInContext(GUARD, ctx); return ctx.NuevoAmanecerCacheIdentity.fingerprint(token); }
const replicaOf = (ls) => { const raw = ls.getItem('na_snapshot_v9'); return raw ? JSON.parse(raw).canonicalReplica : null; };
// Lector/escritor de la réplica como en la app: na_snapshot_v9.canonicalReplica (lo que depura el guardián).
function replicaGlobals(ls) {
  return {
    _naReadCanonicalReplica: async () => replicaOf(ls),
    _naWriteCanonicalReplica: async (value, stillCurrent) => { if (typeof stillCurrent === 'function' && !stillCurrent()) return { ok: false, skipped: 'identity-changed' }; const snap = JSON.parse(ls.getItem('na_snapshot_v9') || '{}'); snap.canonicalReplica = JSON.parse(JSON.stringify(value)); ls.setItem('na_snapshot_v9', JSON.stringify(snap)); return true; },
  };
}
const setRole = (f, deviceId, role) => {
  f.exec(`DELETE FROM pos_device_roles WHERE device_id='session:${deviceId}'`);
  if (role === 'empleado') f.exec(`INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('session:${deviceId}','empleado','test','2026-10-21T00:00:00Z')`);
};
// Una pestaña con canonical-client + guardián, identidad ya etiquetada con `role`.
async function tab(f, { token, deviceId, role, ls = storage(), onFetch, extra = {}, reload = false }) {
  ls.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'http://localhost', token }));
  ls.setItem('na_cache_identity_v1', JSON.stringify({ v: 1, fp: fingerprint(token), role, device_id: 'session:' + deviceId }));
  // Como pos-roles-client.js: el último rol confirmado por /auth/me queda en na_pos_role_v1 (el guardián lo compara, F1).
  ls.setItem('na_pos_role_v1', JSON.stringify({ role }));
  setRole(f, deviceId, role);
  let captured = null;
  const globals = { ...replicaGlobals(ls), NA_ROLES: { confirmed: true, deviceId: 'session:' + deviceId, role }, __capture: (ctx) => { captured = ctx; }, ...extra };
  const scripts = [['cache-identity-guard.js', GUARD], ['capture.js', 'globalThis.__capture(globalThis)']];
  const run = device(f, { token, deviceId: reload ? undefined : deviceId, localStorage: ls, globals, scripts, onFetch });
  return { run, ls, get context() { return captured; } };
}
// /auth/me confirma otro rol: lo que hace pos-roles-client.js (NA_ROLES + evento na:role).
async function switchRole(f, t, deviceId, role) {
  setRole(f, deviceId, role);
  // pos-roles-client.js persiste el rol nuevo y luego emite na:role.
  t.ls.setItem('na_pos_role_v1', JSON.stringify({ role }));
  t.context.NA_ROLES = { confirmed: true, deviceId: 'session:' + deviceId, role };
  t.context.dispatchEvent(new t.context.CustomEvent('na:role'));
}
async function settled(t, role) {
  const api = t.context.NuevoAmanecerCanonical, guard = t.context.NuevoAmanecerCacheIdentity;
  for (let i = 0; i < 400; i++) {
    const d = guard.diagnostics();
    if (d.tag && d.tag.role === role && !d.memoryFilter && api.sourceState().validation === 'current') { await tick(); return; }
    await tick();
  }
  throw new Error('role switch did not settle: ' + JSON.stringify({ diag: guard.diagnostics(), state: api.sourceState() }));
}
function noOwnerFinancials(label, value) {
  const j = JSON.stringify(value);
  assert.ok(!j.includes(EXPENSE_NOTE), label + ': nota del gasto del dueño');
  assert.ok(!j.includes(String(EXPENSE_CENTS)), label + ': monto del gasto del dueño');
}
// Ningún monto esperado (incluye gastos en efectivo) => no se puede despejar un gasto.
function noExpected(label, sessions) {
  for (const s of sessions || []) for (const k of ['expected_cents', 'counted_cents', 'difference_cents']) assert.equal(s[k], undefined, label + ': ' + k + ' de ' + s.session_id);
}
async function ownerWithCommit(f, t) {
  const api = (await t.run).api;
  await api.openCash({ session_id: 'f2-cash', opening_cents: 5000 }); await api.refresh();
  const expense = await api.createExpense({ amount_cents: EXPENSE_CENTS, concept: 'Compra', category: 'Limpieza', payment_method: 'efectivo', expense_date: '2026-10-21', note: EXPENSE_NOTE, session_id: 'f2-cash' });
  assert.equal(expense.status, 'created');
  await api.refresh();
  assert.ok(JSON.stringify(replicaOf(t.ls).expenses).includes(EXPENSE_NOTE), 'precondición: el dueño tiene su gasto persistido');
  // Commit del dueño SIN relectura después: deja afterCommit (relectura dirigida) pendiente.
  assert.equal((await api.createPayment({ credit_id: CREDIT, amount_cents: 100, payment_method: 'efectivo' })).status, 'created');
  return api;
}

test('dueño hace un commit y el rol cambia a empleado: relectura completa, sin gastos/movimientos/eventos del dueño, recarga offline limpia', async (t0) => {
  const f = await activeCanon(t0, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  let hold = null;
  const t = await tab(f, { token: 'f2-tab-token', deviceId: 'f2-tab', role: 'owner',
    onFetch: async (url) => { if (hold && url.includes('/read/canonical/')) await hold.promise; return null; } });
  const api = await ownerWithCommit(f, t);
  // Entre el cambio y la lectura completa (lecturas retenidas): ni la memoria ni lo persistido traen datos del dueño.
  let release; hold = { promise: new Promise((r) => { release = r; }) };
  const logStart = (await t.run).fetchLog.length;
  await switchRole(f, t, 'f2-tab', 'empleado');
  for (let i = 0; i < 50 && t.context.NuevoAmanecerCacheIdentity.diagnostics().tag.role !== 'empleado'; i++) await tick();
  const mid = plain(api.snapshot());
  assert.deepEqual([mid.expenses, mid.cashMovements, mid.financialEvents, mid.inventoryMovements], [[], [], [], []]);
  noOwnerFinancials('memoria durante la relectura', mid); noExpected('memoria durante la relectura', mid.cashSessions);
  assert.equal(mid.cashSessions.find((s) => s.status === 'OPEN').expected_withheld, true);
  const midReplica = replicaOf(t.ls);
  noOwnerFinancials('réplica persistida durante la relectura', midReplica); noExpected('réplica persistida', midReplica.cash_sessions);
  assert.equal(midReplica.remote_validated_at, undefined, 'sin sellos del dueño');
  assert.throws(() => api.assertAction('payment.create'), /CANONICAL_COMMERCE_CLOSED/);
  hold = null; release();
  await settled(t, 'empleado');
  // Lectura COMPLETA (no la dirigida de 7 rutas del commit del dueño); sin la ruta de gastos (solo dueño).
  const read = reads((await t.run).fetchLog.slice(logStart));
  for (const route of ['products', 'customers', 'sales', 'sale-items', 'inventory-movements']) assert.ok(read.includes(route), route + ' releída');
  assert.ok(!read.includes('expenses'));
  const after = plain(api.snapshot()), persisted = replicaOf(t.ls);
  assert.deepEqual(after.expenses, []); assert.deepEqual(persisted.expenses, []);
  noOwnerFinancials('memoria tras la relectura', { ...after, cashSessions: [] });
  noOwnerFinancials('réplica tras la relectura', { ...persisted, cash_sessions: [] });
  // Igual a lo que el servidor da a ese empleado en una lectura en limpio: nada reutilizado del dueño.
  const fresh = await device(f, { token: 'f2-tab-token' });
  assert.deepEqual(pick(after), pick(fresh.api.snapshot()));
  assert.ok(Date.parse(persisted.remote_validated_at) > 0 && persisted.remote_validated_context, 'sellos propios de la lectura completa del empleado');
  // Recarga sin conexión: lo que carga es la réplica del empleado, sin gastos del dueño.
  const offline = await tab(f, { token: 'f2-tab-token', deviceId: 'f2-tab', role: 'empleado', ls: t.ls, reload: true, extra: { navigator: { onLine: false, locks: webLocks() } } });
  await assert.rejects(offline.run, /AUTHORITY_UNAVAILABLE/);
  const view = plain(await offline.context.NuevoAmanecerCanonical.startPOS());
  assert.equal(offline.context.NuevoAmanecerCanonical.sourceState().source, 'cache');
  assert.deepEqual(view.expenses, []);
  noOwnerFinancials('recarga offline', { ...view, cashSessions: [] });
});

test('sin conexión en el cambio a empleado: la memoria y la recarga offline no permiten despejar gastos; la siguiente lectura es completa', async (t0) => {
  const f = await activeCanon(t0, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  let down = false;
  const t = await tab(f, { token: 'f2-off-token', deviceId: 'f2-off', role: 'owner',
    onFetch: async (url) => { if (down && url.includes('/read/canonical/')) throw new TypeError('Failed to fetch'); return null; } });
  const api = await ownerWithCommit(f, t);
  down = true;
  await switchRole(f, t, 'f2-off', 'empleado');
  for (let i = 0; i < 100 && t.context.NuevoAmanecerCacheIdentity.diagnostics().tag.role !== 'empleado'; i++) await tick();
  await tick(30);
  const mem = plain(api.snapshot()), persisted = replicaOf(t.ls);
  for (const [label, v, sessions] of [['memoria', mem, mem.cashSessions], ['réplica', persisted, persisted.cash_sessions]]) {
    noOwnerFinancials(label, v); noExpected(label, sessions);
    assert.equal(sessions.find((s) => s.status === 'OPEN').expected_withheld, true, label + ': caja abierta reconocible sin monto');
  }
  assert.deepEqual([persisted.expenses, persisted.inventory_movements], [[], []]);
  assert.ok(!persisted.financial_events.some((e) => e.event_type !== 'PAYMENT' && e.credit_id == null), 'solo cobros de crédito');
  // Recarga offline: la caja abierta sigue ahí, sin esperado ni gastos.
  const offline = await tab(f, { token: 'f2-off-token', deviceId: 'f2-off', role: 'empleado', ls: t.ls, reload: true, extra: { navigator: { onLine: false, locks: webLocks() } } });
  await assert.rejects(offline.run);
  const view = plain(await offline.context.NuevoAmanecerCanonical.startPOS());
  noOwnerFinancials('recarga offline', view); noExpected('recarga offline', view.cashSessions);
  assert.equal(view.cashSessions.find((s) => s.status === 'OPEN').expected_withheld, true);
  // Vuelve la red: la siguiente lectura es COMPLETA aunque el dueño dejó un commit pendiente, y el abono en efectivo sale.
  down = false;
  const logStart = (await t.run).fetchLog.length;
  await api.refresh();
  const read = reads((await t.run).fetchLog.slice(logStart));
  for (const route of ['products', 'customers', 'sales', 'sale-items', 'inventory-movements']) assert.ok(read.includes(route), route + ' releída');
  assert.deepEqual(plain(api.snapshot().expenses), []);
  assert.equal((await api.createPayment({ credit_id: CREDIT, amount_cents: 100, payment_method: 'efectivo' })).status, 'created');
});

test('empleado con caja abierta registra un abono en efectivo justo después del cambio, también con la caja sin monto esperado', async (t0) => {
  const f = await activeCanon(t0, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  let withhold = false;
  // Caja abierta como la deja el guardián (expected_withheld, sin expected_cents): openSession() la acepta y el
  // servidor vuelve a comprobar la caja en la misma operación.
  const onFetch = async (url, _o, real) => {
    if (!withhold || !url.includes('/read/canonical/cash-sessions')) return null;
    const body = await (await real()).json();
    body.items = body.items.map((s) => { if (s.status !== 'OPEN') return s; const { expected_cents, ...rest } = s; void expected_cents; return { ...rest, expected_withheld: true }; });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const t = await tab(f, { token: 'f2-cash-token', deviceId: 'f2-cash', role: 'owner', onFetch });
  const api = await ownerWithCommit(f, t);
  await switchRole(f, t, 'f2-cash', 'empleado');
  await settled(t, 'empleado');
  assert.equal((await api.createPayment({ credit_id: CREDIT, amount_cents: 100, payment_method: 'efectivo' })).status, 'created', 'abono justo después del cambio');
  withhold = true;
  await api.refresh();
  const open = api.snapshot().cashSessions.find((s) => s.status === 'OPEN');
  assert.equal(open.expected_cents, undefined); assert.equal(open.expected_withheld, true);
  const r = await api.createPayment({ credit_id: CREDIT, amount_cents: 100, payment_method: 'efectivo' });
  assert.equal(r.status, 'created', 'openSession acepta la caja abierta sin monto esperado');
  withhold = false;
  const before = f.sql("SELECT expected_cents FROM canonical_cash_state WHERE session_id='f2-cash'").expected_cents;
  assert.equal(before, 5000 + 300 - EXPENSE_CENTS, 'el servidor contó los tres abonos y el gasto');
});

test('empleado cambia a dueño: la lectura completa restablece gastos y todo lo del dueño', async (t0) => {
  const f = await activeCanon(t0, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  const owner = await device(f, { token: 'f2-owner-token', deviceId: 'f2-owner' });
  await owner.api.openCash({ session_id: 'f2-own-cash', opening_cents: 5000 }); await owner.api.refresh();
  assert.equal((await owner.api.createExpense({ amount_cents: EXPENSE_CENTS, concept: 'Compra', category: 'Limpieza', payment_method: 'efectivo', expense_date: '2026-10-21', note: EXPENSE_NOTE, session_id: 'f2-own-cash' })).status, 'created');
  const t = await tab(f, { token: 'f2-emp-token', deviceId: 'f2-emp', role: 'empleado' });
  const api = (await t.run).api;
  assert.deepEqual(plain(api.snapshot().expenses), []);
  // Commit del empleado sin relectura (afterCommit pendiente) y luego pasa a dueño.
  assert.equal((await api.createPayment({ credit_id: CREDIT, amount_cents: 100, payment_method: 'efectivo' })).status, 'created');
  const logStart = (await t.run).fetchLog.length;
  await switchRole(f, t, 'f2-emp', 'owner');
  await settled(t, 'owner');
  const read = reads((await t.run).fetchLog.slice(logStart));
  assert.ok(read.includes('expenses') && read.includes('products') && read.includes('sales'), read.join(','));
  const snap = plain(api.snapshot());
  assert.ok(JSON.stringify(snap.expenses).includes(EXPENSE_NOTE), 'gasto del dueño restablecido');
  assert.ok(JSON.stringify(replicaOf(t.ls).expenses).includes(EXPENSE_NOTE), 'y persistido');
  assert.equal(snap.cashSessions.find((s) => s.status === 'OPEN').expected_cents, 5000 + 100 - EXPENSE_CENTS);
  const fresh = await device(f, { token: 'f2-owner-token' });
  assert.deepEqual(pick(snap), pick(fresh.api.snapshot()));
  assert.ok(Date.parse(replicaOf(t.ls).remote_validated_at) > 0, 'sellos nuevos de una lectura completa');
});

test('guardián: la caja ABIERTA conserva solo expected_withheld; los cierres pasados siguen sin montos', () => {
  const ctx = { setTimeout, clearTimeout, Promise }; vm.createContext(ctx); vm.runInContext(GUARD, ctx);
  const snap = { canonicalReplica: { schema_version: 2, products: [], remote_validated_at: 'x', cash_sessions: [
    { session_id: 'K0', status: 'CLOSED', expected_cents: 60000, counted_cents: 55555, difference_cents: -4445 },
    { session_id: 'K1', status: 'OPEN', revision: 3, opening_cents: 5000, expected_cents: 779 }] } };
  assert.equal(ctx.NuevoAmanecerCacheIdentity.scrubSnapshot(snap), true);
  assert.deepEqual(plain(snap.canonicalReplica.cash_sessions), [{ session_id: 'K0', status: 'CLOSED' }, { session_id: 'K1', status: 'OPEN', revision: 3, opening_cents: 5000, expected_withheld: true }]);
  assert.equal(ctx.NuevoAmanecerCacheIdentity.scrubSnapshot(snap), false, 'idempotente');
});
