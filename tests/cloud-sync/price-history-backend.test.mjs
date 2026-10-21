// Misión 3 (#857): rutas del Worker para el historial de precios en la nube.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon } from './canon-browser-harness.mjs';
import { roleOf, priceHistoryRoute } from '../../tools/cloudflare-lab/src/price-history.js';

const read = n => readFileSync(new URL('../../infra/database/migrations/' + n, import.meta.url), 'utf8');
const H = token => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json' });
async function call(f, path, token, body, extra = {}) {
  const r = await f.fetch('http://localhost' + path, { method: body ? 'POST' : 'GET', headers: { ...H(token), ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}
async function setup(t, { schema = true } = {}) {
  const f = await activeCanon(t, { migrations: ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql'] });
  try { f.database.exec(read('0010_session_auth.sql').replace(/DROP INDEX[^;]*;/, '')); } catch {}
  f.database.exec(read('0024_pos_roles_owner_pin.sql'));
  f.database.exec(read('0025_pos_reviews_pin_failures.sql'));
  f.database.exec(read('0028_pos_purchases.sql'));
  if (schema) f.database.exec(read('0034_price_history.sql'));
  f.addDevice('owner-phone', 'writer', 'active', 'owner-token');
  assert.equal((await call(f, '/auth/owner-pin', 'owner-token', { new_pin: '4821' })).status, 200);
  f.addDevice('emp-phone', 'writer', 'active', 'emp-token');
  f.database.exec("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('emp-phone','empleado','owner-phone','2026-10-13'),('session:emp-phone','empleado','owner-phone','2026-10-13')");
  return f;
}
const user = 'Ana · "La Jefa" | 1';
const e = (id, over = {}) => ({ change_id: 'ph1:' + id, product_id: '00003', field: 'venta', before_cents: 450, after_cents: 500, origin: 'ficha', ref: null, user_name: user, user_id: 'C-1', changed_at: '2026-10-21T03:30:00.000Z', ...over });
const batch = (f, token, entries) => call(f, '/auth/price-history/batch', token, { entries });
const count = f => f.sql('SELECT COUNT(*) n FROM price_history').n;

test('reenvío del mismo lote es idempotente: duplicate y 0 filas nuevas; otro contenido con el mismo id: conflict', async t => {
  const f = await setup(t);
  const one = await batch(f, 'owner-token', [e('a'), e('b', { field: 'costo', before_cents: 300, after_cents: 320 })]);
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.results.map(r => r.status), ['inserted', 'inserted']);
  const again = await batch(f, 'owner-token', [e('a'), e('b', { field: 'costo', before_cents: 300, after_cents: 320 })]);
  assert.deepEqual(again.body.results.map(r => r.status), ['duplicate', 'duplicate']);
  assert.equal(count(f), 2);
  const clash = await batch(f, 'owner-token', [e('a', { after_cents: 999 })]);
  assert.equal(clash.body.results[0].status, 'conflict');
  assert.equal(f.sql("SELECT after_cents a FROM price_history WHERE change_id='ph1:a'").a, 500, 'no se sobrescribe');
});

test('misma compra desde dos aparatos: una sola fila por (ref, field); el segundo recibe duplicate', async t => {
  const f = await setup(t);
  const c = id => e(id, { field: 'venta', origin: 'compra', ref: 'PUR-9:1' });
  assert.equal((await batch(f, 'owner-token', [c('dev-a')])).body.results[0].status, 'inserted');
  assert.equal((await batch(f, 'owner-token', [c('dev-b')])).body.results[0].status, 'duplicate');
  assert.equal(count(f), 1);
});

test('usuario con «·», «|» y comillas se guarda igual; fecha en UTC; device_id sale de la sesión', async t => {
  const f = await setup(t);
  await batch(f, 'emp-token', [e('u1', { changed_at: '2026-10-21T03:30:00Z' })]);
  const row = f.sql("SELECT * FROM price_history WHERE change_id='ph1:u1'");
  assert.deepEqual([row.user_name, row.user_id, row.changed_at, row.device_id], [user, 'C-1', '2026-10-21T03:30:00.000Z', 'session:emp-phone']);
  assert.match(row.received_at, /Z$/);
});

test('validación: campo/origen/céntimos/fecha futura/id inválidos -> invalid; lote >100 -> 400', async t => {
  const f = await setup(t);
  const bad = await batch(f, 'owner-token', [e('x1', { field: 'otro' }), e('x2', { after_cents: 1.5 }), e('x3', { changed_at: new Date(Date.now() + 3600e3).toISOString() }), { ...e('x4'), change_id: 'no' }, { ...e('x5'), extra: 1 }]);
  assert.deepEqual(bad.body.results.map(r => r.status), ['invalid', 'invalid', 'invalid', 'invalid', 'invalid']);
  assert.equal((await batch(f, 'owner-token', Array.from({ length: 101 }, (_, i) => e('n' + i)))).status, 400);
  assert.equal(count(f), 0);
});

test('empleado: GET nunca trae filas de costo (filtro SQL); el dueño sí', async t => {
  const f = await setup(t);
  await batch(f, 'owner-token', [e('v1'), e('c1', { field: 'costo', before_cents: 300, after_cents: 320, changed_at: '2026-10-21T04:00:00.000Z' })]);
  const emp = await call(f, '/auth/price-history?product_id=00003', 'emp-token');
  const own = await call(f, '/auth/price-history?product_id=00003', 'owner-token');
  assert.deepEqual(emp.body.rows.map(r => r.field), ['venta']);
  assert.deepEqual(own.body.rows.map(r => r.field), ['costo', 'venta']);
  assert.equal(JSON.stringify(emp.body).includes('320'), false);
  const ch = await call(f, '/auth/price-history/changes?since=', 'emp-token');
  assert.deepEqual(ch.body.rows.map(r => r.field), ['venta']);
});

test('costo de empleado: con compra aplicada y costo igual se acepta; sin ref válido queda pending y no sale en ningún GET (ni del dueño)', async t => {
  const f = await setup(t);
  const c = f.control();
  const ctl = { promotion_id: c.active_promotion_id, client_contract: 'a6-gate-c-v1', authority_epoch: c.authority_epoch, expected_control_revision: c.revision };
  const buy = await call(f, '/auth/purchases', 'owner-token', { ...ctl, operation_id: 'PUR-7', created_at: '2026-10-12T17:00:00.000Z', lines: [{ line: 1, product_id: '00003', quantity: 1, unit_cost_cents: 333 }] });
  assert.equal(buy.status, 201, JSON.stringify(buy.body));
  const r = await batch(f, 'emp-token', [
    e('ok', { field: 'costo', origin: 'compra', ref: 'PUR-7:1', before_cents: 300, after_cents: 333 }),
    e('bad-cost', { field: 'costo', origin: 'compra', ref: 'PUR-7:2', before_cents: 300, after_cents: 999 }),
    e('ficha', { field: 'costo', origin: 'ficha', before_cents: 300, after_cents: 1 })]);
  assert.deepEqual(r.body.results.map(x => [x.status, x.review || null]), [['inserted', null], ['inserted', 'pending'], ['inserted', 'pending']]);
  const own = await call(f, '/auth/price-history?product_id=00003', 'owner-token');
  assert.deepEqual(own.body.rows.map(x => x.change_id), ['ph1:ok']);
  const q = await call(f, '/auth/price-history/reviews', 'owner-token');
  assert.deepEqual(q.body.rows.map(x => x.change_id).sort(), ['ph1:bad-cost', 'ph1:ficha']);
  assert.equal((await call(f, '/auth/price-history/reviews', 'emp-token')).status, 403);
  assert.equal((await call(f, '/auth/price-history/review', 'emp-token', { change_id: 'ph1:ficha', decision: 'approved' })).status, 403);
  assert.equal((await call(f, '/auth/price-history/review', 'owner-token', { change_id: 'ph1:ficha', decision: 'approved' })).status, 200);
  assert.equal((await call(f, '/auth/price-history/review', 'owner-token', { change_id: 'ph1:ficha', decision: 'rejected' })).status, 409);
  const after = await call(f, '/auth/price-history?product_id=00003', 'owner-token');
  assert.deepEqual(after.body.rows.map(x => x.change_id).sort(), ['ph1:ficha', 'ph1:ok']);
  const cost = f.sql("SELECT cost_cents c FROM products WHERE product_id='00003'").c;
  assert.notEqual(cost, 1, 'aprobar no cambia el costo del producto');
});

test('paginación por changed_at/change_id y changes por received_at', async t => {
  const f = await setup(t);
  await batch(f, 'owner-token', [1, 2, 3].map(i => e('p' + i, { changed_at: '2026-10-1' + i + 'T00:00:00.000Z' })));
  const p1 = await call(f, '/auth/price-history?product_id=00003&limit=2', 'owner-token');
  assert.deepEqual(p1.body.rows.map(r => r.change_id), ['ph1:p3', 'ph1:p2']);
  const p2 = await call(f, `/auth/price-history?product_id=00003&limit=2&before=${encodeURIComponent(p1.body.next.before)}&before_id=${p1.body.next.before_id}`, 'owner-token');
  assert.deepEqual(p2.body.rows.map(r => r.change_id), ['ph1:p1']);
  const ch = await call(f, '/auth/price-history/changes?limit=2', 'owner-token');
  assert.equal(ch.body.rows.length, 2); assert.equal(ch.body.more, true);
  const ch2 = await call(f, `/auth/price-history/changes?since=${encodeURIComponent(ch.body.cursor.since)}&since_id=${ch.body.cursor.since_id}`, 'owner-token');
  assert.equal(ch2.body.rows.length, 1);
});

test('sin migración 0034: 503 schema_not_ready (la web sigue solo local)', async t => {
  const f = await setup(t, { schema: false });
  assert.deepEqual([(await batch(f, 'owner-token', [e('z')])).status], [503]);
});

test('rol falla cerrado: solo posRole=owner es dueño; vacío/desconocido/ausente = empleado (sin costo)', async t => {
  assert.equal(roleOf({ posRole: 'owner' }), 'owner');
  for (const a of [{ posRole: '' }, { posRole: 'unknown' }, { posRole: 'Owner' }, {}, null, undefined]) assert.equal(roleOf(a), 'empleado', JSON.stringify(a));
  const f = await setup(t);
  await batch(f, 'owner-token', [e('v'), e('c', { field: 'costo', before_cents: 300, after_cents: 321 })]);
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  for (const posRole of ['', 'unknown', undefined]) {
    const r = await priceHistoryRoute(new Request('http://localhost/auth/price-history?product_id=00003'), f.env, { posRole, principalId: 'x' }, json);
    const body = await r.json();
    assert.deepEqual(body.rows.map(x => x.field), ['venta'], 'rol ' + String(posRole) + ' no ve costo');
    const q = await priceHistoryRoute(new Request('http://localhost/auth/price-history/reviews'), f.env, { posRole, principalId: 'x' }, json);
    assert.equal(q.status, 403);
  }
});

test('costo falso de empleado (pendiente) sobre una ref de compra no bloquea el registro real del dueño', async t => {
  const f = await setup(t);
  const fake = await batch(f, 'emp-token', [e('fake', { field: 'costo', origin: 'compra', ref: 'PUR-55:1', before_cents: 300, after_cents: 1 })]);
  assert.deepEqual([fake.body.results[0].status, fake.body.results[0].review], ['inserted', 'pending']);
  const real = await batch(f, 'owner-token', [e('real', { field: 'costo', origin: 'compra', ref: 'PUR-55:1', before_cents: 300, after_cents: 340 })]);
  assert.equal(real.body.results[0].status, 'inserted');
  const own = await call(f, '/auth/price-history?product_id=00003', 'owner-token');
  assert.deepEqual(own.body.rows.map(x => [x.change_id, x.after_cents]), [['ph1:real', 340]]);
  const again = await batch(f, 'owner-token', [e('real2', { field: 'costo', origin: 'compra', ref: 'PUR-55:1', before_cents: 300, after_cents: 340 })]);
  assert.equal(again.body.results[0].status, 'duplicate', 'la ref real sigue siendo única');
  const ap = await call(f, '/auth/price-history/review', 'owner-token', { change_id: 'ph1:fake', decision: 'approved' });
  assert.deepEqual([ap.status, ap.body.error], [409, 'ref_already_recorded']);
  assert.equal((await call(f, '/auth/price-history/review', 'owner-token', { change_id: 'ph1:fake', decision: 'rejected' })).status, 200);
});
