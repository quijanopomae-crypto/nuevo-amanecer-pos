// B2 (#886): product.update acepta cost_cents AUSENTE para cualquier rol y conserva el costo actual.
// Con costo actual NULL se queda NULL, sin error (la revisión lleva el marcador cost_kept_null y un 0
// de relleno que nunca se lee como costo). cost_cents presente: validación y comportamiento de #886.
// Worker real + SQLite en memoria. Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon } from './canon-browser-harness.mjs';
import { syntheticRows } from './a6-fixture.mjs';
import { REVISION_COST_SQL } from '../../tools/cloudflare-lab/src/a6-products.js';

const read = n => readFileSync(new URL('../../infra/database/migrations/' + n, import.meta.url), 'utf8');
const H = token => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json' });
async function call(f, path, token, body, extra = {}) {
  const r = await f.fetch('http://localhost' + path, { method: body ? 'POST' : 'GET', headers: { ...H(token), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, text, body: JSON.parse(text) };
}
const ctl = f => { const c = f.control(); return { promotion_id: c.active_promotion_id, client_contract: 'a6-gate-c-v1', authority_epoch: c.authority_epoch, expected_control_revision: c.revision }; };
const NULL_ID = '00005';

async function setup(t) {
  // 00005 llega del import sin costo (cost_cents NULL); el resto con 29.
  const rows = syntheticRows().map(r => r.entity_type === 'products' && r.source_key === NULL_ID ? { ...r, payload: { ...r.payload, costo: null } } : r);
  const f = await activeCanon(t, { rows, migrations: ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql', '0017_canonical_live_customers.sql', '0018_canonical_customer_credit_policy.sql', '0020_canonical_customer_contacts.sql', '0022_canonical_product_revisions.sql'] });
  try { f.database.exec(read('0010_session_auth.sql').replace(/DROP INDEX[^;]*;/, '')); } catch {}
  f.database.exec(read('0024_pos_roles_owner_pin.sql'));
  f.database.exec(read('0025_pos_reviews_pin_failures.sql'));
  f.addDevice('owner-phone', 'writer', 'active', 'owner-token');
  f.addDevice('emp-phone', 'writer', 'active', 'emp-token');
  f.database.exec("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('emp-phone','empleado','owner-phone','2026-10-13'),('session:emp-phone','empleado','owner-phone','2026-10-13')");
  assert.equal((await call(f, '/auth/owner-pin', 'owner-token', { new_pin: '4821' })).status, 200);
  return f;
}
const ownerView = async (f, id) => (await call(f, '/read/canonical/products?limit=250', 'owner-token')).body.items.find(p => p.product_id === id);
// Cuerpo como lo arma la ficha, a partir de la vista del dueño; withCost=false omite cost_cents.
function editOf(f, p, opId, patch = {}, { withCost = false } = {}) {
  const b = { ...ctl(f), operation_id: opId, created_at: '2026-10-21T18:00:00.000Z', product_id: p.product_id, expected_metadata_revision: p.metadata_revision,
    name: p.name, sku: p.sku, barcode: p.barcode, alternate_codes: [], category: p.category, brand: p.brand, description: p.description, icon: p.icon,
    price_cents: p.price_cents, box_price_cents: p.box_price_cents ?? null, units_per_box: p.box_price_cents == null ? null : p.units_per_box,
    stock_min_quantity: p.stock_min_quantity ?? 0, expiry_date: p.expiry_date ?? null, ...patch };
  if (withCost) b.cost_cents = p.cost_cents; else delete b.cost_cents;
  return b;
}
async function empUpdate(f, body) {
  const ap = await call(f, '/auth/owner-approval', 'emp-token', { pin: '4821', action: 'product.update', operation_id: body.operation_id });
  assert.equal(ap.status, 201, ap.text);
  return call(f, '/commands/product.update', 'emp-token', body, { 'x-owner-approval': ap.body.approval_id });
}
// Costo vigente tal como lo resuelve product.update (productState): última revisión vía REVISION_COST_SQL, si no la base.
const currentCost = (f, id) => f.sql(`SELECT COALESCE((SELECT ${REVISION_COST_SQL('r')} FROM canonical_product_revisions r WHERE r.product_id=?1 ORDER BY r.revision DESC LIMIT 1),
  (SELECT cost_cents FROM products WHERE product_id=?1)) AS c`, id).c;
const snapCost = async (f, id) => (await call(f, '/read/canonical/snapshot', 'owner-token')).body.products.find(p => p.product_id === id).cost_cents;
const revisionCosts = (f, id) => f.all('SELECT revision,cost_cents,result_json FROM canonical_product_revisions WHERE product_id=? ORDER BY revision', id);

test('sin cost_cents + costo existente: dueño y empleado conservan el costo; no se escribe otro valor de costo', async t => {
  const f = await setup(t);
  const before = await ownerView(f, '00003');
  assert.equal(before.cost_cents, 29);
  const o = await call(f, '/commands/product.update', 'owner-token', editOf(f, before, 'own-nocost-1', { price_cents: before.price_cents + 5 }));
  assert.equal(o.status, 201, o.text);
  assert.ok(!('cost_kept_null' in o.body));
  const mid = await ownerView(f, '00003');
  assert.deepEqual([mid.cost_cents, mid.price_cents], [29, before.price_cents + 5]);
  const e = await empUpdate(f, editOf(f, mid, 'emp-nocost-1', { name: mid.name + ' (ed)' }));
  assert.equal(e.status, 201, e.text);
  const after = await ownerView(f, '00003');
  assert.deepEqual([after.cost_cents, after.name], [29, mid.name + ' (ed)']);
  // Las revisiones solo copian el costo vigente (29); ninguna lo cambia.
  assert.deepEqual(revisionCosts(f, '00003').map(r => [r.revision, r.cost_cents, JSON.parse(r.result_json).cost_kept_null ?? null]), [[1, 29, null], [2, 29, null]]);
  // Idempotencia: el mismo cuerpo sin costo se reconoce; con costo es otro pedido (conflicto).
  const body = editOf(f, before, 'own-nocost-1', { price_cents: before.price_cents + 5 });
  assert.deepEqual([(await call(f, '/commands/product.update', 'owner-token', body)).body.status], ['already_processed']);
  assert.equal((await call(f, '/commands/product.update', 'owner-token', { ...body, cost_cents: 29 })).status, 409);
});

test('sin cost_cents + costo NULL: 201 sin error, el costo sigue NULL (dueño y empleado); el dueño luego puede fijarlo', async t => {
  const f = await setup(t);
  assert.equal(f.sql('SELECT cost_cents FROM products WHERE product_id=?', NULL_ID).cost_cents, null, 'semilla: costo NULL');
  const p0 = await ownerView(f, NULL_ID);
  assert.equal(p0.cost_cents, null);
  const e = await empUpdate(f, editOf(f, p0, 'emp-null-1', { price_cents: p0.price_cents + 1 }));
  assert.equal(e.status, 201, e.text);
  assert.equal(e.body.cost_kept_null, true);
  const p1 = await ownerView(f, NULL_ID);
  assert.deepEqual([p1.cost_cents, p1.price_cents, p1.metadata_revision], [null, p0.price_cents + 1, 1]);
  const o = await call(f, '/commands/product.update', 'owner-token', editOf(f, p1, 'own-null-2', { name: p1.name + ' (ed)' }));
  assert.equal(o.status, 201, o.text);
  const p2 = await ownerView(f, NULL_ID);
  assert.deepEqual([p2.cost_cents, p2.name], [null, p1.name + ' (ed)']);
  // Snapshot también lo ve NULL.
  const snap = (await call(f, '/read/canonical/snapshot', 'owner-token')).body.products.find(p => p.product_id === NULL_ID);
  assert.equal(snap.cost_cents, null);
  // Reintento idéntico: idempotente.
  const again = await call(f, '/commands/product.update', 'owner-token', editOf(f, p1, 'own-null-2', { name: p1.name + ' (ed)' }));
  assert.deepEqual([again.status, again.body.status, again.body.cost_kept_null], [200, 'already_processed', true]);
  // El dueño fija el costo explícitamente: ahora sí vale; la siguiente edición sin costo lo conserva.
  const set = await call(f, '/commands/product.update', 'owner-token', editOf(f, { ...p2, cost_cents: 1500 }, 'own-null-3', {}, { withCost: true }));
  assert.equal(set.status, 201, set.text);
  const p3 = await ownerView(f, NULL_ID);
  assert.equal(p3.cost_cents, 1500);
  assert.equal((await empUpdate(f, editOf(f, p3, 'emp-null-4'))).status, 201);
  assert.equal((await ownerView(f, NULL_ID)).cost_cents, 1500);
});

test('cost_cents presente: el dueño lo cambia; el empleado no puede pisarlo (#886)', async t => {
  const f = await setup(t);
  const p0 = await ownerView(f, '00003');
  const o = await call(f, '/commands/product.update', 'owner-token', editOf(f, { ...p0, cost_cents: 4321 }, 'own-cost-1', {}, { withCost: true }));
  assert.equal(o.status, 201, o.text);
  const p1 = await ownerView(f, '00003');
  assert.equal(p1.cost_cents, 4321);
  const zero = await call(f, '/commands/product.update', 'owner-token', editOf(f, { ...p1, cost_cents: 0 }, 'own-cost-0', {}, { withCost: true }));
  assert.equal(zero.status, 201, zero.text);
  const p2 = await ownerView(f, '00003');
  assert.equal(p2.cost_cents, 0, 'un 0 explícito del dueño es un costo real');
  const e = await empUpdate(f, editOf(f, { ...p2, cost_cents: 999999 }, 'emp-cost-1', { price_cents: p2.price_cents + 3 }, { withCost: true }));
  assert.equal(e.status, 201, e.text);
  const p3 = await ownerView(f, '00003');
  assert.deepEqual([p3.cost_cents, p3.price_cents], [0, p2.price_cents + 3], 'el costo enviado por el empleado se ignora');
});

test('cost_cents inválido: 400 con field cost_cents (antes decía price_cents); precio inválido sigue con price_cents', async t => {
  const f = await setup(t);
  const p = await ownerView(f, '00003');
  for (const bad of [-1, 1.5, '29', null]) {
    const r = await call(f, '/commands/product.update', 'owner-token', { ...editOf(f, p, 'bad-cost'), cost_cents: bad });
    assert.deepEqual([r.status, r.body], [400, { error: 'invalid_product_update', field: 'cost_cents' }], String(bad));
  }
  for (const bad of [0, -5, 1.5, undefined]) {
    const r = await call(f, '/commands/product.update', 'owner-token', { ...editOf(f, p, 'bad-price'), price_cents: bad });
    assert.deepEqual([r.status, r.body], [400, { error: 'invalid_product_update', field: 'price_cents' }], String(bad));
  }
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_product_revisions').n, 0);
});

test('/auth/me anuncia capabilities.product_update_absent_cost (aditivo; dueño y empleado)', async t => {
  const f = await setup(t);
  for (const token of ['owner-token', 'emp-token']) {
    const me = await call(f, '/auth/me', token);
    assert.equal(me.status, 200, me.text);
    assert.deepEqual(me.body.capabilities, { product_update_absent_cost: true });
    assert.ok('pos_role' in me.body && 'owner_pin_set' in me.body && 'roles_ready' in me.body && 'device_id' in me.body, 'campos previos intactos');
  }
});

test('cost_kept_null y luego el dueño fija un costo real: las lecturas muestran ese costo (ni NULL ni 0); sin costo después, se conserva', async t => {
  const f = await setup(t);
  const p0 = await ownerView(f, NULL_ID);
  const k = await call(f, '/commands/product.update', 'owner-token', editOf(f, p0, 'kn-1', { price_cents: p0.price_cents + 1 }));
  assert.deepEqual([k.status, k.body.cost_kept_null], [201, true], k.text);
  const p1 = await ownerView(f, NULL_ID);
  assert.equal(p1.cost_cents, null);
  const set = await call(f, '/commands/product.update', 'owner-token', editOf(f, { ...p1, cost_cents: 777 }, 'kn-2', {}, { withCost: true }));
  assert.equal(set.status, 201, set.text);
  assert.ok(!('cost_kept_null' in set.body));
  const p2 = await ownerView(f, NULL_ID);
  assert.equal(p2.cost_cents, 777);
  assert.equal(await snapCost(f, NULL_ID), 777);
  assert.equal(currentCost(f, NULL_ID), 777);
  // Edición sin costo del dueño y del empleado: se conserva 777; el empleado tampoco puede cambiarlo enviándolo.
  const o = await call(f, '/commands/product.update', 'owner-token', editOf(f, p2, 'kn-3', { name: p2.name + ' (ed)' }));
  assert.deepEqual([o.status, 'cost_kept_null' in o.body], [201, false], o.text);
  const p3 = await ownerView(f, NULL_ID);
  assert.equal((await empUpdate(f, editOf(f, p3, 'kn-4'))).status, 201);
  const p4 = await ownerView(f, NULL_ID);
  assert.equal((await empUpdate(f, editOf(f, { ...p4, cost_cents: 5 }, 'kn-5', {}, { withCost: true }))).status, 201);
  const p5 = await ownerView(f, NULL_ID);
  assert.deepEqual([p5.cost_cents, p5.metadata_revision, await snapCost(f, NULL_ID), currentCost(f, NULL_ID)], [777, 5, 777, 777]);
  // Solo la primera revisión lleva el marcador; las posteriores copian el costo real.
  assert.deepEqual(revisionCosts(f, NULL_ID).map(r => [r.revision, r.cost_cents, JSON.parse(r.result_json).cost_kept_null ?? null]),
    [[1, 0, true], [2, 777, null], [3, 777, null], [4, 777, null], [5, 777, null]]);
});

test('ediciones sin costo encadenadas sobre costo NULL: sigue NULL en /read, /snapshot y costo vigente, nunca 0', async t => {
  const f = await setup(t);
  for (let i = 1; i <= 4; i++) {
    const p = await ownerView(f, NULL_ID);
    const r = i % 2 ? await empUpdate(f, editOf(f, p, `chain-${i}`, { price_cents: p.price_cents + 1 }))
      : await call(f, '/commands/product.update', 'owner-token', editOf(f, p, `chain-${i}`, { name: `Encadenado ${i}` }));
    assert.deepEqual([r.status, r.body.cost_kept_null], [201, true], `edición ${i}: ${r.text}`);
    const after = await ownerView(f, NULL_ID);
    assert.equal(after.metadata_revision, i);
    assert.strictEqual(after.cost_cents, null, `/read tras ${i}`);
    assert.strictEqual(await snapCost(f, NULL_ID), null, `/snapshot tras ${i}`);
    assert.strictEqual(currentCost(f, NULL_ID), null, `costo vigente tras ${i}`);
  }
  // En la tabla, solo 0 de relleno, todos marcados.
  assert.deepEqual(revisionCosts(f, NULL_ID).map(r => [r.cost_cents, JSON.parse(r.result_json).cost_kept_null]), [[0, true], [0, true], [0, true], [0, true]]);
  // El empleado tampoco ve 0: su lectura omite cost_cents.
  const emp = (await call(f, '/read/canonical/products?limit=250', 'emp-token')).body.items.find(p => p.product_id === NULL_ID);
  assert.ok(!('cost_cents' in emp));
  assert.equal(emp.name, 'Encadenado 4');
});
