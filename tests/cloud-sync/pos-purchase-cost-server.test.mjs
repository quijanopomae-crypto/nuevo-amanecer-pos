// Fase 2 (a): compra de empleado con PIN del dueño -> el Worker actualiza el costo (product.update interno).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon } from './canon-browser-harness.mjs';
import { lastCostByProduct, redactCostUpdates, serverHandledAll } from '../../tools/cloudflare-lab/src/pos-purchase-cost.js';

const read = n => readFileSync(new URL('../../infra/database/migrations/' + n, import.meta.url), 'utf8');
const H = token => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json' });
async function call(f, path, token, body, extra = {}) {
  const r = await f.fetch('http://localhost' + path, { method: body ? 'POST' : 'GET', headers: { ...H(token), ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}
async function setup(t) {
  const f = await activeCanon(t, { migrations: ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql', '0017_canonical_live_customers.sql', '0018_canonical_customer_credit_policy.sql', '0020_canonical_customer_contacts.sql', '0022_canonical_product_revisions.sql'] });
  try { f.database.exec(read('0010_session_auth.sql').replace(/DROP INDEX[^;]*;/, '')); } catch {}
  f.database.exec(read('0024_pos_roles_owner_pin.sql'));
  f.database.exec(read('0025_pos_reviews_pin_failures.sql'));
  f.database.exec(read('0028_pos_purchases.sql'));
  f.addDevice('owner-phone', 'writer', 'active', 'owner-token');
  assert.equal((await call(f, '/auth/owner-pin', 'owner-token', { new_pin: '4821' })).status, 200);
  f.addDevice('emp-phone', 'writer', 'active', 'emp-token');
  f.database.exec("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('emp-phone','empleado','owner-phone','2026-10-13'),('session:emp-phone','empleado','owner-phone','2026-10-13')");
  return f;
}
const ctl = f => { const c = f.control(); return { promotion_id: c.active_promotion_id, client_contract: 'a6-gate-c-v1', authority_epoch: c.authority_epoch, expected_control_revision: c.revision }; };
const purchase = (f, op, lines) => ({ ...ctl(f), operation_id: op, created_at: '2026-10-12T17:00:00.000Z', supplier: 'Distribuidora Sol', document_ref: 'F001-1', lines });
const revs = (f, id) => f.database.prepare('SELECT operation_id,revision,cost_cents,price_cents,name FROM canonical_product_revisions WHERE product_id=? ORDER BY revision').all(id);
const base = (f, id) => f.sql('SELECT cost_cents,price_cents,name FROM products WHERE product_id=?', id);
async function empBuy(f, op, lines) {
  const ap = await call(f, '/auth/owner-approval', 'emp-token', { pin: '4821', action: 'inventory.adjust', operation_id: op });
  assert.equal(ap.status, 201, JSON.stringify(ap.body));
  return call(f, '/auth/purchases', 'emp-token', purchase(f, op, lines), { 'x-owner-approval': ap.body.approval_id });
}

test('última línea con costo por producto; solo líneas aplicadas', () => {
  const m = lastCostByProduct([{ line: 1, product_id: 'A', unit_cost_cents: 100 }, { line: 3, product_id: 'A', unit_cost_cents: 130 }, { line: 2, product_id: 'B', unit_cost_cents: null }, { line: 4, product_id: 'C', unit_cost_cents: 50 }], [1, 2, 3]);
  assert.deepEqual([...m], [['A', { line: 3, cents: 130 }]]);
  const gift = lastCostByProduct([{ line: 1, product_id: 'A', unit_cost_cents: 200 }, { line: 2, product_id: 'A', unit_cost_cents: 0 }, { line: 3, product_id: 'B', unit_cost_cents: '' }, { line: 4, product_id: 'C', unit_cost_cents: -5 }], [1, 2, 3, 4]);
  assert.deepEqual([...gift], [['A', { line: 1, cents: 200 }]], 'costo 0/vacío/negativo no cuenta (igual que #870)');
  assert.equal(serverHandledAll([{ status: 'updated' }, { status: 'unchanged' }]), true);
  assert.equal(serverHandledAll([{ status: 'updated' }, { status: 'failed' }]), false);
  assert.deepEqual(redactCostUpdates([{ product_id: 'A', before_cents: 1, after_cents: 2, status: 'updated' }], false), [{ product_id: 'A', status: 'updated' }]);
});

test('empleado con PIN: el Worker sube la revisión con el costo de la última línea, sin tocar precio/nombre; sin costos en claro', async t => {
  const f = await setup(t);
  const b0 = base(f, '00003');
  const r = await empBuy(f, 'emp-c-1', [{ line: 1, product_id: '00003', quantity: 2, unit_cost_cents: 350 }, { line: 2, product_id: '00003', quantity: 1, unit_cost_cents: 370 }]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.cost_source, 'server', JSON.stringify(r.body));
  assert.equal(r.body.cost_updates[0].status, 'updated', JSON.stringify(r.body));
  assert.deepEqual(r.body.cost_updates.map(u => [u.product_id, u.status, u.line]), [['00003', 'updated', 2]]);
  assert.equal(JSON.stringify(r.body).includes('370'), false, 'el empleado no recibe el costo');
  const rv = revs(f, '00003');
  assert.equal(rv.length, 1);
  assert.deepEqual([rv[0].operation_id, rv[0].revision, rv[0].cost_cents, rv[0].price_cents, rv[0].name], ['emp-c-1:costo:2', 1, 370, b0.price_cents, b0.name]);
});

test('reintento de la misma compra: no crea otra revisión (idempotente)', async t => {
  const f = await setup(t);
  const lines = [{ line: 1, product_id: '00003', quantity: 1, unit_cost_cents: 420 }];
  assert.equal((await empBuy(f, 'emp-c-2', lines)).status, 201);
  const again = await empBuy(f, 'emp-c-2', lines);
  assert.deepEqual([again.status, again.body.idempotent], [200, true]);
  assert.equal(revs(f, '00003').length, 1);
});

test('compra del dueño: el Worker no toca el costo (lo hace el aparato, #858) -> sin doble actualización', async t => {
  const f = await setup(t);
  const r = await call(f, '/auth/purchases', 'owner-token', purchase(f, 'own-c-1', [{ line: 1, product_id: '00003', quantity: 1, unit_cost_cents: 999 }]));
  assert.equal(r.status, 201);
  assert.equal('cost_source' in r.body, false);
  assert.equal(revs(f, '00003').length, 0);
});

test('mismo costo: no crea revisión; sin aprobación: 403 y nada cambia', async t => {
  const f = await setup(t);
  const same = base(f, '00003').cost_cents;
  const r = await empBuy(f, 'emp-c-3', [{ line: 1, product_id: '00003', quantity: 1, unit_cost_cents: same }]);
  assert.equal(r.body.cost_updates[0].status, 'unchanged');
  const denied = await call(f, '/auth/purchases', 'emp-token', purchase(f, 'emp-c-4', [{ line: 1, product_id: '00003', quantity: 1, unit_cost_cents: 1 }]));
  assert.equal(denied.status, 403);
  assert.equal(revs(f, '00003').length, 0);
});

test('parte de la revisión vigente: conserva el precio que puso el dueño antes', async t => {
  const f = await setup(t);
  assert.equal((await empBuy(f, 'emp-c-5', [{ line: 1, product_id: '00003', quantity: 1, unit_cost_cents: 300 }])).status, 201);
  const own = f.database.prepare('SELECT * FROM canonical_product_revisions WHERE product_id=? ORDER BY revision DESC LIMIT 1').get('00003');
  const up = await call(f, '/commands/product.update', 'owner-token', { ...ctl(f), operation_id: 'own-edit-1', product_id: '00003', created_at: '2026-10-12T18:00:00.000Z', expected_metadata_revision: 1,
    name: own.name, sku: own.sku, barcode: own.barcode, alternate_codes: JSON.parse(own.alternate_codes_json), category: own.category, brand: own.brand, description: own.description, icon: own.icon,
    cost_cents: 300, price_cents: own.price_cents + 100, box_price_cents: own.box_price_cents, units_per_box: own.units_per_box, stock_min_quantity: own.stock_min_quantity, expiry_date: own.expiry_date });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal((await empBuy(f, 'emp-c-6', [{ line: 1, product_id: '00003', quantity: 1, unit_cost_cents: 310 }])).status, 201);
  const last = revs(f, '00003').at(-1);
  assert.deepEqual([last.revision, last.cost_cents, last.price_cents], [3, 310, own.price_cents + 100]);
});

test('cliente #858: con cost_source=server el aparato no repite la actualización', () => {
  const src = readFileSync(new URL('../../POS/js/products/costo-compra-ficha.js', import.meta.url), 'utf8');
  assert.match(src, /result\.cost_source === 'server'\) \{ report\.skipped\.push\('server'\)/);
});

test('compra de empleado con regalo (costo 0) no pone el costo en 0', async t => {
  const f = await setup(t);
  const r = await empBuy(f, 'emp-g-1', [{ line: 1, product_id: '00003', quantity: 1, unit_cost_cents: 0 }]);
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.cost_updates, []);
  assert.equal(revs(f, '00003').length, 0);
});

test('si una actualización falla no se responde cost_source=server (el cliente puede hacer su respaldo)', async t => {
  const f = await setup(t);
  f.database.exec("CREATE TRIGGER t_fail BEFORE INSERT ON canonical_product_revisions BEGIN SELECT RAISE(ABORT,'boom'); END;");
  const r = await empBuy(f, 'emp-f-1', [{ line: 1, product_id: '00003', quantity: 1, unit_cost_cents: 555 }]);
  assert.equal(r.status, 201);
  assert.equal('cost_source' in r.body, false);
  assert.equal(r.body.cost_updates[0].status, 'failed');
});

test('línea ya aplicada por la ruta vieja (mismo operation_id) también cuenta para el costo, una sola vez', async t => {
  const f = await setup(t);
  const s = f.sql('SELECT stock_revision r FROM products WHERE product_id=?', '00003');
  const old = await call(f, '/commands/inventory.adjust', 'owner-token', { ...ctl(f), operation_id: 'emp-o-1:1', created_at: '2026-10-12T17:00:00.000Z', product_id: '00003', movement_type: 'ENTRADA', quantity: 1, expected_stock_revision: s.r, reason: 'Compra emp-o-1, línea 1: +1' });
  assert.ok([200, 201].includes(old.status), JSON.stringify(old.body));
  const r = await empBuy(f, 'emp-o-1', [{ line: 1, product_id: '00003', quantity: 1, unit_cost_cents: 610 }]);
  assert.deepEqual(r.body.skipped.map(x => x.line), [1]);
  assert.equal(r.body.cost_source, 'server');
  assert.deepEqual(revs(f, '00003').map(x => [x.operation_id, x.cost_cents]), [['emp-o-1:costo:1', 610]]);
});

test('respuesta idempotente guarda la revisión (metadata_revision) de la actualización previa', async () => {
  const src = readFileSync(new URL('../../tools/cloudflare-lab/src/pos-purchase-cost.js', import.meta.url), 'utf8');
  assert.match(src, /idempotent: true, metadata_revision: Number\(prior\.revision\)/);
});
