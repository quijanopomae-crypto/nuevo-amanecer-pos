// T-46 (regresión): el empleado no recibe el costo de compra (cost_cents) ni el proveedor/comprobante de las
// compras por las lecturas canónicas (/read/canonical/products, /snapshot, /inventory-movements).
// Misma regla que /auth/purchases (purchases.costs.view, solo dueño). La salida del dueño no cambia.
// Worker real + SQLite en memoria. Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { redactCanonicalItem } from '../../tools/cloudflare-lab/src/a6-canonical.js';

const read = n => readFileSync(new URL('../../infra/database/migrations/' + n, import.meta.url), 'utf8');
const H = token => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json' });
async function call(f, path, token, body, extra = {}) {
  const r = await f.fetch('http://localhost' + path, { method: body ? 'POST' : 'GET', headers: { ...(token ? H(token) : { 'content-type': 'application/json' }), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, text, body: JSON.parse(text) };
}
const ctl = f => { const c = f.control(); return { promotion_id: c.active_promotion_id, client_contract: 'a6-gate-c-v1', authority_epoch: c.authority_epoch, expected_control_revision: c.revision }; };
async function setup(t) {
  const f = await activeCanon(t, { migrations: ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql', '0017_canonical_live_customers.sql', '0018_canonical_customer_credit_policy.sql', '0020_canonical_customer_contacts.sql', '0022_canonical_product_revisions.sql'] });
  try { f.database.exec(read('0010_session_auth.sql').replace(/DROP INDEX[^;]*;/, '')); } catch {}
  f.database.exec(read('0024_pos_roles_owner_pin.sql'));
  f.database.exec(read('0025_pos_reviews_pin_failures.sql'));
  f.database.exec(read('0028_pos_purchases.sql'));
  f.addDevice('owner-phone', 'writer', 'active', 'owner-token');
  f.addDevice('emp-phone', 'writer', 'active', 'emp-token');
  f.database.exec("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('emp-phone','empleado','owner-phone','2026-10-13'),('session:emp-phone','empleado','owner-phone','2026-10-13')");
  assert.equal((await call(f, '/auth/owner-pin', 'owner-token', { new_pin: '4821' })).status, 200);
  const buy = await call(f, '/auth/purchases', 'owner-token', { ...ctl(f), operation_id: 'buy-sint-1', created_at: '2026-10-12T17:00:00.000Z',
    supplier: 'PROVEEDOR-RESTRINGIDO-SINT', document_ref: 'F9-SINT', lines: [{ line: 1, product_id: '00003', quantity: 2, unit_cost_cents: 777001 }] });
  assert.equal(buy.status, 201, buy.text);
  return f;
}
const MARKERS = /PROVEEDOR-RESTRINGIDO-SINT|F9-SINT|cost_cents/;

test('empleado: /read/canonical/products sin cost_cents; el resto del producto sigue igual', async t => {
  const f = await setup(t);
  const emp = await call(f, '/read/canonical/products?limit=250', 'emp-token');
  const own = await call(f, '/read/canonical/products?limit=250', 'owner-token');
  assert.equal(emp.status, 200); assert.equal(own.status, 200);
  assert.ok(own.body.items.length > 0 && own.body.items.every(p => 'cost_cents' in p), 'el dueño sí ve el costo');
  assert.equal(emp.body.items.length, own.body.items.length);
  assert.ok(emp.body.items.every(p => !('cost_cents' in p)), 'el empleado no recibe cost_cents');
  assert.doesNotMatch(emp.text, MARKERS);
  // Fuera del costo, mismo contenido que el dueño.
  assert.deepEqual(emp.body.items, own.body.items.map(({ cost_cents, ...rest }) => rest));
  assert.ok(emp.body.items.every(p => Number.isInteger(p.price_cents)), 'precio de venta intacto');
});

test('empleado: /read/canonical/inventory-movements sin proveedor ni comprobante en reason; dueño completo', async t => {
  const f = await setup(t);
  const emp = await call(f, '/read/canonical/inventory-movements?limit=250', 'emp-token');
  const own = await call(f, '/read/canonical/inventory-movements?limit=250', 'owner-token');
  const mine = own.body.items.find(m => /buy-sint-1/.test(m.reason || ''));
  assert.match(mine.reason, /^Compra PROVEEDOR-RESTRINGIDO-SINT F9-SINT buy-sint-1, línea 1: \+2$/);
  const theirs = emp.body.items.find(m => m.movement_id === mine.movement_id);
  assert.equal(theirs.reason, 'Compra, línea 1: +2');
  assert.equal(theirs.quantity, mine.quantity); assert.equal(theirs.product_id, mine.product_id);
  assert.doesNotMatch(emp.text, MARKERS);
});

test('empleado: /read/canonical/snapshot sin costo, sin proveedor y sin gastos; dueño ve todo', async t => {
  const f = await setup(t);
  const emp = await call(f, '/read/canonical/snapshot', 'emp-token');
  const own = await call(f, '/read/canonical/snapshot', 'owner-token');
  assert.equal(emp.status, 200, emp.text); assert.equal(own.status, 200, own.text);
  assert.ok(emp.body.products.length > 0 && emp.body.products.every(p => !('cost_cents' in p)));
  assert.ok(own.body.products.every(p => 'cost_cents' in p));
  assert.deepEqual(emp.body.expenses, []);
  assert.doesNotMatch(emp.text, MARKERS);
  assert.match(own.text, /PROVEEDOR-RESTRINGIDO-SINT/);
  assert.deepEqual(Object.keys(emp.body).sort(), Object.keys(own.body).sort(), 'misma forma: 12 colecciones');
});

test('aparato sin fila de rol sigue siendo dueño y ve el costo (comportamiento existente, no cambia en este PR)', async t => {
  const f = await setup(t);
  // worker.js authorizeSession: sin fila en pos_device_roles => 'owner'. Se documenta; no se cambia aquí.
  f.addDevice('norole-phone', 'writer', 'active', 'norole-token');
  const nr = await call(f, '/read/canonical/products?limit=250', 'norole-token');
  const own = await call(f, '/read/canonical/products?limit=250', 'owner-token');
  assert.equal(nr.text, own.text);
  assert.ok(nr.body.items.every(p => 'cost_cents' in p));
});

test('redactCanonicalItem: solo quita costo de productos y proveedor de las compras; lo demás no cambia', () => {
  assert.deepEqual(redactCanonicalItem('products', { product_id: '1', cost_cents: 5, price_cents: 9 }), { product_id: '1', price_cents: 9 });
  assert.deepEqual(redactCanonicalItem('inventory_movements', { reason: 'Compra OCR OCR-PURCHASE-ab:1, línea 1: +3' }), { reason: 'Compra, línea 1: +3' });
  assert.deepEqual(redactCanonicalItem('inventory_movements', { reason: 'Compra rara sin línea' }), { reason: 'Compra' });
  assert.deepEqual(redactCanonicalItem('inventory_movements', { reason: 'Entrada de inventario' }), { reason: 'Entrada de inventario' });
  assert.deepEqual(redactCanonicalItem('inventory_movements', { reason: null }), { reason: null });
  assert.deepEqual(redactCanonicalItem('sales', { total_cents: 1 }), { total_cents: 1 });
});

test('cliente del empleado: réplica sin cost_cents no rompe (costo 0 en la vista) y editar un producto no borra el costo', async t => {
  const f = await setup(t);
  const emp = await device(f, { token: 'emp2-token', deviceId: 'emp2-phone' });
  f.database.exec("INSERT INTO pos_device_roles(device_id,pos_role,created_by,created_at) VALUES('emp2-phone','empleado','owner-phone','2026-10-13'),('session:emp2-phone','empleado','owner-phone','2026-10-13')");
  assert.equal((await call(f, '/auth/me', 'emp2-token')).body.pos_role, 'empleado');
  await emp.api.refresh();
  const raw = emp.api.snapshot().products.find(p => p.product_id === '00003');
  assert.ok(raw && !('cost_cents' in raw));
  const legacy = emp.api.legacySnapshot().products.find(p => String(p.id) === '00003');
  assert.equal(legacy.costo, 0, 'el adaptador tolera la ausencia (0, número)');
  assert.equal(typeof legacy.precio, 'number');
  const ownerBefore = (await call(f, '/read/canonical/products?limit=250', 'owner-token')).body.items.find(p => p.product_id === '00003');
  assert.ok(ownerBefore.cost_cents > 0);
  // Edición del empleado (con PIN del dueño, product.update lo exige) como la arma la ficha: el costo de la vista (0) viaja en cost_cents.
  const editBody = { ...ctl(f), operation_id: 'emp-edit-1', created_at: '2026-10-12T18:00:00.000Z', product_id: raw.product_id,
    expected_metadata_revision: Number(raw.metadata_revision) || 0, name: raw.name + ' (ed)',
    sku: raw.sku ?? null, barcode: raw.barcode ?? null, alternate_codes: [], category: raw.category ?? null, brand: raw.brand ?? null, description: raw.description ?? null,
    icon: raw.icon ?? null, cost_cents: Math.round(legacy.costo * 100), price_cents: raw.price_cents + 10, box_price_cents: raw.box_price_cents ?? null,
    units_per_box: raw.box_price_cents == null ? null : raw.units_per_box, stock_min_quantity: raw.stock_min_quantity ?? 0, expiry_date: raw.expiry_date ?? null };
  const ap = await call(f, '/auth/owner-approval', 'emp2-token', { pin: '4821', action: 'product.update', operation_id: 'emp-edit-1' });
  assert.equal(ap.status, 201, ap.text);
  const r = await call(f, '/commands/product.update', 'emp2-token', editBody, { 'x-owner-approval': ap.body.approval_id });
  assert.equal(r.status, 201, r.text);
  const replay = await call(f, '/commands/product.update', 'emp2-token', editBody, { 'x-owner-approval': ap.body.approval_id });
  assert.deepEqual([replay.status, replay.body.status], [200, 'already_processed'], 'el reintento idéntico sigue siendo idempotente');
  const ownerAfter = (await call(f, '/read/canonical/products?limit=250', 'owner-token')).body.items.find(p => p.product_id === '00003');
  assert.equal(ownerAfter.price_cents, raw.price_cents + 10, 'el resto de la edición sí aplica');
  assert.equal(ownerAfter.cost_cents, ownerBefore.cost_cents, 'el costo del dueño no se pisa con 0');
  // El dueño sigue pudiendo cambiar el costo.
  const o = await call(f, '/commands/product.update', 'owner-token', { ...ctl(f), operation_id: 'own-cost-1', created_at: '2026-10-12T18:00:00.000Z',
    product_id: '00003', expected_metadata_revision: ownerAfter.metadata_revision, name: ownerAfter.name, sku: ownerAfter.sku, barcode: ownerAfter.barcode, alternate_codes: [],
    category: ownerAfter.category, brand: ownerAfter.brand, description: ownerAfter.description, icon: ownerAfter.icon, cost_cents: 4321, price_cents: ownerAfter.price_cents,
    box_price_cents: ownerAfter.box_price_cents ?? null, units_per_box: ownerAfter.box_price_cents == null ? null : ownerAfter.units_per_box, stock_min_quantity: ownerAfter.stock_min_quantity ?? 0, expiry_date: ownerAfter.expiry_date ?? null });
  assert.equal(o.status, 201, o.text);
  assert.equal((await call(f, '/read/canonical/products?limit=250', 'owner-token')).body.items.find(p => p.product_id === '00003').cost_cents, 4321);
});
