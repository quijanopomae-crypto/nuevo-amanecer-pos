// #884 re-revisión (asistente 2): lo que estaba EN VUELO con la identidad anterior (escritura de la réplica del
// dueño, lectura de la caché en startPOS, recibo de un comando) no publica ni persiste nada tras el cambio de rol.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { activeCanon, device, storage } from './canon-browser-harness.mjs';
import { webLocks } from './web-locks-sim.mjs';

const GUARD = readFileSync(new URL('../../POS/js/sync/cache-identity-guard.js', import.meta.url), 'utf8');
const INLINE02 = readFileSync(new URL('../../POS/js/legacy-inline/inline-02.js', import.meta.url), 'utf8');
const NOTE = 'GASTO-DUENO-W', EXPENSE_CENTS = 4321;
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const plain = (v) => JSON.parse(JSON.stringify(v));
function fp(token) { const c = { setTimeout, clearTimeout, Promise }; vm.createContext(c); vm.runInContext(GUARD, c); return c.NuevoAmanecerCacheIdentity.fingerprint(token); }
const replicaOf = (ls) => { const raw = ls.getItem('na_snapshot_v9'); return raw ? JSON.parse(raw).canonicalReplica : null; };
const setRole = (f, id, role) => { f.exec(`DELETE FROM pos_device_roles WHERE device_id='session:${id}'`); if (role === 'empleado') f.exec(`INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('session:${id}','empleado','t','2026-10-21T00:00:00Z')`); };
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

// Escritor de la réplica como inline-02.js: en cola; `honor` = comprueba stillCurrent al escribir. Con honor=false
// representa una escritura que ya pasó esa comprobación (dentro de _naCommitSnapshot) cuando cambia la identidad.
function writerFor(ls, ctl) {
  return async (value, stillCurrent) => {
    const v = JSON.parse(JSON.stringify(value));
    if (ctl.hold) { ctl.pending = true; await ctl.hold.promise; }
    if (ctl.honor && typeof stillCurrent === 'function' && !stillCurrent()) { ctl.skipped = (ctl.skipped || 0) + 1; return { ok: false, skipped: 'identity-changed' }; }
    const s = JSON.parse(ls.getItem('na_snapshot_v9') || '{}'); s.canonicalReplica = v; ls.setItem('na_snapshot_v9', JSON.stringify(s)); return { ok: true };
  };
}
async function tab(f, { token, id, role, ls, ctl, onFetch, extra = {}, reload = false }) {
  ls.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'http://localhost', token }));
  ls.setItem('na_cache_identity_v1', JSON.stringify({ v: 1, fp: fp(token), role, device_id: 'session:' + id }));
  ls.setItem('na_pos_role_v1', JSON.stringify({ role }));
  setRole(f, id, role);
  let ctx = null;
  const run = device(f, { token, deviceId: reload ? undefined : id, localStorage: ls, onFetch,
    globals: { _naReadCanonicalReplica: async () => replicaOf(ls), _naWriteCanonicalReplica: writerFor(ls, ctl), NA_ROLES: { confirmed: true, deviceId: 'session:' + id, role }, __cap: (c) => { ctx = c; }, ...extra },
    scripts: [['cache-identity-guard.js', GUARD], ['cap.js', 'globalThis.__cap(globalThis)']] });
  return { run, get ctx() { return ctx; } };
}
function switchRole(f, t, ls, id, role) {
  setRole(f, id, role); ls.setItem('na_pos_role_v1', JSON.stringify({ role }));
  t.ctx.NA_ROLES = { confirmed: true, deviceId: 'session:' + id, role }; t.ctx.dispatchEvent(new t.ctx.CustomEvent('na:role'));
}
const hasOwner = (v) => JSON.stringify(v).includes(NOTE);
async function ownerWithExpense(api) {
  await api.openCash({ session_id: 'w-cash', opening_cents: 5000 }); await api.refresh();
  assert.equal((await api.createExpense({ amount_cents: EXPENSE_CENTS, concept: 'Compra', category: 'Limpieza', payment_method: 'efectivo', expense_date: new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10), note: NOTE, session_id: 'w-cash' })).status, 'created');
}

for (const honor of [true, false]) {
  test(`ventana (sonda a2): escritura del dueño en vuelo durante el cambio a empleado sin red — ${honor ? 'la escritura en cola comprueba la identidad' : 'escritura ya comprometida: se vuelve a depurar al terminar'}`, async (t0) => {
    const f = await activeCanon(t0, { migrations: ['0024_pos_roles_owner_pin.sql'] });
    const ls = storage(), token = 'w-token-' + honor, id = 'w-dev-' + honor, ctl = { honor };
    let down = false;
    const t = await tab(f, { token, id, role: 'owner', ls, ctl, onFetch: async (url) => { if (down && url.includes('/read/canonical/')) throw new TypeError('Failed to fetch'); return null; } });
    const api = (await t.run).api;
    await ownerWithExpense(api);
    // refresh() del dueño cuya escritura de réplica está en vuelo (ya pasó sameIdentity()).
    ctl.hold = deferred(); ctl.pending = false;
    const p = api.refresh().catch((e) => e.message);
    for (let i = 0; i < 200 && !ctl.pending; i++) await tick();
    assert.ok(ctl.pending, 'escritura del dueño pendiente');
    down = true;
    switchRole(f, t, ls, id, 'empleado');
    // Reset SÍNCRONO en onConfirmed (antes de la purga): la memoria ya no tiene nada del dueño.
    assert.ok(!hasOwner(api.snapshot()), 'memoria limpia en el mismo tick del evento');
    assert.throws(() => api.assertAction('payment.create'), /CANONICAL_COMMERCE_CLOSED/);
    for (let i = 0; i < 100 && t.ctx.NuevoAmanecerCacheIdentity.diagnostics().tag.role !== 'empleado'; i++) await tick();
    const writeLanded = ctl.hold; ctl.hold = null; writeLanded.resolve();
    assert.equal(await p, 'CANONICAL_IDENTITY_CHANGED', 'la lectura del dueño no termina publicada');
    for (let i = 0; i < 100 && !t.ctx.NuevoAmanecerCacheIdentity.diagnostics().purges.some((x) => x.reason === 'confirmed-inflight-settled' && x.ok !== undefined); i++) await tick();
    await tick(20);
    const persisted = replicaOf(ls);
    assert.ok(!hasOwner(persisted), 'réplica persistida sin el gasto del dueño');
    assert.deepEqual(persisted.expenses, []);
    assert.equal(persisted.remote_validated_at, undefined, 'sin sellos del dueño');
    if (honor) assert.equal(ctl.skipped, 1, 'la escritura en cola se descartó al escribir');
    else assert.ok(t.ctx.NuevoAmanecerCacheIdentity.diagnostics().purges.some((x) => x.reason === 'confirmed-inflight-settled'), 'se volvió a depurar al terminar la carga en vuelo');
    assert.ok(!hasOwner(api.snapshot()), 'memoria sin el gasto del dueño');
    // Recarga sin conexión como empleado.
    const off = await tab(f, { token, id, role: 'empleado', ls, ctl, reload: true, extra: { navigator: { onLine: false, locks: webLocks() } } });
    await off.run.catch(() => {});
    assert.ok(!hasOwner(await off.ctx.NuevoAmanecerCanonical.startPOS()), 'recarga offline sin el gasto del dueño');
    // Recarga con red como empleado: lectura completa, nada del dueño en memoria ni persistido.
    down = false;
    const on = await tab(f, { token, id, role: 'empleado', ls, ctl, reload: true });
    const a3 = (await on.run).api; await tick(20);
    assert.equal(a3.sourceState().validation, 'current');
    assert.ok(!hasOwner(a3.snapshot()) && !hasOwner(replicaOf(ls)));
  });
}

test('startPOS: la caché leída con la identidad anterior no se publica si la identidad cambia durante la lectura', async (t0) => {
  const f = await activeCanon(t0, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  const ls = storage(), token = 's-token', id = 's-dev', ctl = { honor: true };
  const owner = await tab(f, { token, id, role: 'owner', ls, ctl });
  await ownerWithExpense((await owner.run).api); await (await owner.run).api.refresh();
  assert.ok(hasOwner(replicaOf(ls)), 'precondición: réplica del dueño persistida');
  // Recarga sin red con la lectura de la réplica retenida; a mitad de la lectura la identidad cambia.
  const gate = deferred(); let reading = false;
  const off = await tab(f, { token, id, role: 'owner', ls, ctl, reload: true, extra: { navigator: { onLine: false, locks: webLocks() },
    _naReadCanonicalReplica: async () => { const v = replicaOf(ls); reading = true; await gate.promise; return v; } } });
  await off.run.catch(() => {});
  const api = off.ctx.NuevoAmanecerCanonical;
  const started = api.startPOS().catch((e) => e.message);
  for (let i = 0; i < 100 && !reading; i++) await tick();
  assert.ok(reading);
  api.resetForIdentityChange();
  gate.resolve();
  await started;
  assert.notEqual(api.sourceState().source, 'cache', 'la caché de la identidad anterior no se publicó');
  assert.ok(!hasOwner(api.snapshot()));
});

test('recibo tardío: un cierre de caja del dueño que vuelve tras el cambio a empleado no repone esperado/contado/diferencia ni deja la réplica lista', async (t0) => {
  const f = await activeCanon(t0, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  const ls = storage(), token = 'c-token', id = 'c-dev', ctl = { honor: true };
  let holdClose = null, closeSent = false;
  const t = await tab(f, { token, id, role: 'owner', ls, ctl, onFetch: async (url, _o, real) => {
    if (holdClose && url.includes('/commands/cash.close')) { closeSent = true; await holdClose.promise; return real(); }
    return null;
  } });
  const api = (await t.run).api;
  await ownerWithExpense(api); await api.refresh();
  holdClose = deferred();
  const closing = api.closeCash({ counted_cents: 777 }).catch((e) => e.message);
  for (let i = 0; i < 200 && !closeSent; i++) await tick();
  assert.ok(closeSent, 'cierre del dueño en vuelo');
  switchRole(f, t, ls, id, 'empleado');
  for (let i = 0; i < 400 && !(t.ctx.NuevoAmanecerCacheIdentity.diagnostics().tag.role === 'empleado' && !t.ctx.NuevoAmanecerCacheIdentity.diagnostics().memoryFilter); i++) await tick();
  assert.equal(api.sourceState().validation, 'current', 'lectura completa del empleado terminada');
  const release = holdClose; holdClose = null; release.resolve();
  const receipt = plain(await closing);
  assert.equal(receipt.status, 'created');
  for (const k of ['expected_cents', 'counted_cents', 'difference_cents']) assert.equal(receipt[k], undefined, 'recibo devuelto sin ' + k);
  const session = plain(api.snapshot()).cashSessions.find((s) => s.session_id === 'w-cash');
  assert.equal(session.status, 'OPEN', 'el recibo no se proyectó en memoria');
  assert.ok(session.counted_cents == null && session.difference_cents == null);
  assert.throws(() => api.assertAction('payment.create'), /CANONICAL_COMMERCE_CLOSED/, 'no quedó lista por el recibo');
  const journal = JSON.parse(ls.getItem('na_canonical_sale_journal'));
  assert.equal(journal.state, 'CONFIRMED');
  for (const k of ['expected_cents', 'counted_cents', 'difference_cents']) assert.equal(journal.receipt[k], undefined, 'diario sin ' + k);
  assert.ok(!JSON.stringify(replicaOf(ls)).includes('"counted_cents":777'));
  // La siguiente lectura es completa y la vuelve a dejar lista.
  await api.refresh();
  assert.equal(api.sourceState().validation, 'current');
});

test('inline-02.js _naWriteCanonicalReplica: comprueba la identidad al escribir (no al encolar)', async () => {
  const line = INLINE02.split('\n').find((l) => l.startsWith('window._naWriteCanonicalReplica='));
  assert.ok(line);
  const commits = [];
  const ctx = { window: {}, Promise, JSON, String,
    _naReadIDBSnapshot: async () => null, _naReadLocalSnapshot: () => null, _naReadSessionSnapshot: () => null, _naValidSnapshot: () => false,
    _naLegacySnapshot: () => null, _naBuildSnapshot: () => ({ data: {} }), _naClone: (v) => JSON.parse(JSON.stringify(v)),
    _naCommitSnapshot: async (next) => { commits.push(next.canonicalReplica.tag); return { ok: true, durable: true, verified: true }; },
    _naWasPersisted: () => true, _naPublishPersistResult: (r) => r, _naPersistFailed: (e) => ({ ok: false, error: e }) };
  vm.createContext(ctx);
  vm.runInContext('var _naPersistChain = Promise.resolve(), _naCanonicalReplicaCommit = false, _naCloudDurableSnapshot = null;\n' + line, ctx);
  const write = ctx.window._naWriteCanonicalReplica;
  let current = true;
  await write({ tag: 'sin-comprobacion' });
  await write({ tag: 'vigente' }, () => current);
  // Encolada con la identidad vigente; al escribir ya cambió => no se escribe.
  const queued = [write({ tag: 'A' }, () => true), write({ tag: 'dueño-encolado' }, () => current)];
  current = false;
  const results = await Promise.all(queued);
  assert.deepEqual(commits, ['sin-comprobacion', 'vigente', 'A']);
  assert.equal(results[1].skipped, 'identity-changed');
});
