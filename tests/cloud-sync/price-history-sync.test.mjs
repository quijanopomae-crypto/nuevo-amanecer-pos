// Misión 3 (#857): sincronización web de na_price_history_v1 contra el Worker real (fixture local).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { activeCanon, storage } from './canon-browser-harness.mjs';

const mig = n => readFileSync(new URL('../../infra/database/migrations/' + n, import.meta.url), 'utf8');
const src = p => readFileSync(p, 'utf8');
async function server(t, { schema = true } = {}) {
  const f = await activeCanon(t, { migrations: ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql'] });
  try { f.database.exec(mig('0010_session_auth.sql').replace(/DROP INDEX[^;]*;/, '')); } catch {}
  f.database.exec(mig('0024_pos_roles_owner_pin.sql'));
  f.database.exec(mig('0028_pos_purchases.sql'));
  if (schema) f.database.exec(mig('0034_price_history.sql'));
  f.addDevice('owner-phone', 'writer', 'active', 'owner-token');
  f.addDevice('emp-phone', 'writer', 'active', 'emp-token');
  f.database.exec("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('emp-phone','empleado','owner-phone','2026-10-13'),('session:emp-phone','empleado','owner-phone','2026-10-13')");
  return f;
}
function device(f, { token, deviceId, owner, initial }) {
  const calls = [];
  const ls = storage(initial);
  const ctx = vm.createContext({ localStorage: ls, crypto: webcrypto, TextEncoder, console, Date, Intl,
    addEventListener() {}, dispatchEvent() { return true; }, CustomEvent: class { constructor(n) { this.type = n; } } });
  ctx.NA_ROLES = { confirmed: true, deviceId, role: owner ? 'owner' : 'empleado', isOwner: () => owner,
    async api(path, body) {
      calls.push(path);
      const r = await f.fetch('http://localhost' + path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const data = await r.json(); if (!r.ok) { const e = new Error(data.error || 'HTTP'); e.status = r.status; throw e; } return data;
    } };
  vm.runInContext(src('POS/js/products/price-history.js'), ctx);
  vm.runInContext(src('POS/js/products/price-history-sync.js'), ctx);
  return { ctx, ls, calls, H: ctx.NA_PRICE_HISTORY, S: ctx.NA_PRICE_HISTORY_SYNC };
}
const legacy = {
  na_price_history_v1: JSON.stringify({ '00003': [
    { id: '00003:2026-10-01T15:00:00.000Z:venta:change:1', seq: 1, at: '2026-10-01T15:00:00.000Z', user: 'Ana · "X" | 1', userId: 'C-1', type: 'venta', before: 4.5, after: 5, origin: 'ficha' },
    { id: '00003:2026-10-02T15:00:00.000Z:costo:PUR-1:1:costo:2', seq: 2, at: '2026-10-02T15:00:00.000Z', user: 'Ana', userId: 'C-1', type: 'costo', before: 3, after: 3.2, origin: 'compra', ref: 'PUR-1:1:costo' }
  ] })
};
const plain = v => JSON.parse(JSON.stringify(v));

test('backfill al iniciar sesión: sube lo local sin borrar nada, ids deterministas; repetirlo (otra pestaña) no duplica', async t => {
  const f = await server(t);
  const a = device(f, { token: 'owner-token', deviceId: 'owner-phone', owner: true, initial: legacy });
  assert.equal(a.S.enabled(), false);
  const r = await a.S.sync();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(a.S.enabled(), true, 'la función se activa recién tras el backfill');
  assert.equal(a.calls[0], '/auth/price-history/batch', 'el backfill va antes de leer de la nube');
  const local = plain(a.H.readAll())['00003'];
  assert.equal(local.length, 2, 'no se pierde nada local');
  assert.ok(local.every(e => /^ph1:legacy:[0-9a-f]{64}$/.test(e.cid) && e.synced === true));
  const rows = f.database.prepare('SELECT change_id,field,before_cents,after_cents,origin,ref,user_name,legacy_id FROM price_history ORDER BY changed_at').all();
  assert.deepEqual(rows.map(x => [x.field, x.before_cents, x.after_cents, x.origin, x.ref, x.user_name]), [['venta', 450, 500, 'ficha', null, 'Ana · "X" | 1'], ['costo', 300, 320, 'compra', 'PUR-1:1', 'Ana']]);
  // Otra pestaña con la misma copia local (sin cid): mismo change_id -> duplicate, 0 filas nuevas.
  const b = device(f, { token: 'owner-token', deviceId: 'owner-phone', owner: true, initial: legacy });
  assert.equal((await b.S.sync()).ok, true);
  assert.equal(f.sql('SELECT COUNT(*) n FROM price_history').n, 2);
  assert.deepEqual(plain(b.H.readAll())['00003'].map(e => e.cid), local.map(e => e.cid));
});

test('dos aparatos: lo del otro llega por /changes y se une sin duplicar (gana la fila del servidor)', async t => {
  const f = await server(t);
  const a = device(f, { token: 'owner-token', deviceId: 'owner-phone', owner: true, initial: legacy });
  await a.S.sync();
  const b = device(f, { token: 'owner-token', deviceId: 'owner-tablet', owner: true });
  await b.S.sync();
  const listB = plain(b.H.list('00003'));
  assert.deepEqual(listB.map(r => [r.type, r.after]), [['costo', 3.2], ['venta', 5]]);
  await a.S.sync();
  assert.equal(plain(a.H.list('00003')).length, 2, 'local + nube de la misma entrada se ven una sola vez');
});

test('nuevo cambio después del backfill: lleva cid ph1:<aparato>:<uuid> y se sube', async t => {
  const f = await server(t);
  const a = device(f, { token: 'owner-token', deviceId: 'owner-phone', owner: true });
  await a.S.sync();
  const added = plain(a.H.recordDiff({ productId: '00003', origin: 'ficha', before: { venta: 4.5, mayorista: null, costo: 3 }, after: { venta: 4.8, mayorista: null, costo: 3 } }));
  assert.match(added[0].cid, /^ph1:owner-phone:[0-9a-f-]{36}$/);
  await a.S.sync();
  assert.equal(f.sql('SELECT after_cents a FROM price_history WHERE change_id=?', added[0].cid).a, 480);
});

test('empleado: nunca recibe costo de la nube y, tras confirmarse, su teléfono no guarda montos de costo', async t => {
  const f = await server(t);
  const owner = device(f, { token: 'owner-token', deviceId: 'owner-phone', owner: true, initial: legacy });
  await owner.S.sync();
  const emp = device(f, { token: 'emp-token', deviceId: 'emp-phone', owner: false, initial: { na_price_history_v1: JSON.stringify({ '00003': [
    { id: 'e1', seq: 1, at: '2026-10-03T15:00:00.000Z', user: 'Beto', userId: 'C-2', type: 'costo', before: 3.2, after: 9.99, origin: 'ficha' }] }) } });
  assert.equal((await emp.S.sync()).ok, true);
  const all = emp.ls.dump();
  assert.equal(all.na_price_history_cloud_v1.includes('"costo"'), false, 'la caché del empleado no trae costo');
  const mine = plain(emp.H.readAll())['00003'][0];
  assert.deepEqual([mine.before, mine.after, mine.redacted], [null, null, true]);
  assert.equal(plain(emp.H.list('00003', { includeCost: false })).some(r => r.type === 'costo'), false);
  assert.equal(f.sql("SELECT review_status s FROM price_history WHERE user_name='Beto'").s, 'pending', 'costo de empleado sin compra válida queda en revisión');
});

test('servidor sin la función (503): todo sigue local, sin activar ni borrar nada', async t => {
  const f = await server(t, { schema: false });
  const a = device(f, { token: 'owner-token', deviceId: 'owner-phone', owner: true, initial: legacy });
  const r = await a.S.sync();
  assert.deepEqual([r.ok, r.reason], [false, 'no_disponible']);
  assert.equal(a.S.enabled(), false);
  assert.equal(plain(a.H.readAll())['00003'].length, 2);
  assert.ok(plain(a.H.readAll())['00003'].every(e => !e.synced));
});
