import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workerFixture } from './worker-fixture.mjs';

function sale(operationId = crypto.randomUUID()) {
  return {
    operation_id: operationId,
    sale_id: `sale-${crypto.randomUUID()}`,
    created_at: '2026-09-18T12:00:00.000Z',
    payment_method: 'efectivo',
    total_cents: 1250,
    items: [
      { product_id: 'rice-1kg', quantity: 2, unit_price_cents: 500 },
      { product_id: 'oil-250ml', quantity: 1, unit_price_cents: 250 },
    ],
  };
}

function post(fixture, body, credential = 'writer-secret', deviceId = 'writer-1') {
  return fixture.fetch('https://worker.test/commands/sale.create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sync-token': credential, 'x-device-id': deviceId },
    body: JSON.stringify(body),
  });
}

function count(fixture, table, operationId) {
  return fixture.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE operation_id = ?`).get(operationId).count;
}

test('writer crea venta, líneas, inventario y caja exactamente una vez', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const body = sale();
  const response = await post(fixture, body);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    status: 'created', operation_id: body.operation_id, sale_id: body.sale_id, idempotent: false,
  });
  assert.equal(count(fixture, 'sales', body.operation_id), 1);
  assert.equal(count(fixture, 'sale_items', body.operation_id), 2);
  assert.equal(count(fixture, 'inventory_movements', body.operation_id), 2);
  assert.equal(count(fixture, 'cash_movements', body.operation_id), 1);
  assert.deepEqual(
    fixture.database.prepare('SELECT product_id, quantity FROM inventory_movements WHERE operation_id = ? ORDER BY line_number').all(body.operation_id).map((row) => ({ ...row })),
    [{ product_id: 'rice-1kg', quantity: -2 }, { product_id: 'oil-250ml', quantity: -1 }],
  );
  assert.deepEqual(
    { ...fixture.database.prepare(`SELECT amount_cents, cash_cents, digital_cents, credit_cents
      FROM cash_movements WHERE operation_id = ?`).get(body.operation_id) },
    { amount_cents: 1250, cash_cents: 1250, digital_cents: 0, credit_cents: 0 },
  );
});

test('línea conserva total redondeado e inventario físico independientes', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const body = {
    ...sale(), total_cents: 100,
    items: [{ product_id: 'box-item', quantity: 0.3, unit_price_cents: 333, line_total_cents: 100, inventory_quantity: 36 }],
  };
  assert.equal((await post(fixture, body)).status, 201);
  assert.deepEqual(
    { ...fixture.database.prepare('SELECT quantity, unit_price_cents, line_total_cents FROM sale_items WHERE operation_id = ?').get(body.operation_id) },
    { quantity: 0.3, unit_price_cents: 333, line_total_cents: 100 },
  );
  assert.equal(fixture.database.prepare('SELECT quantity FROM inventory_movements WHERE operation_id = ?').get(body.operation_id).quantity, -36);
});

test('caja conserva el desglose económico de pagos mixtos y créditos', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const mixed = { ...sale(), payment_method: 'mixto', payment: { cash_cents: 500, digital_cents: 750, digital_method: 'yape', reference: 'YP-42' } };
  const credit = { ...sale(), payment_method: 'credito', customer_id: 'customer-1', credit_due: '2026-10-18' };
  assert.equal((await post(fixture, mixed)).status, 201);
  assert.equal((await post(fixture, credit)).status, 201);
  assert.deepEqual(
    { ...fixture.database.prepare(`SELECT cash_cents, digital_cents, credit_cents, digital_method, reference
      FROM cash_movements WHERE operation_id = ?`).get(mixed.operation_id) },
    { cash_cents: 500, digital_cents: 750, credit_cents: 0, digital_method: 'yape', reference: 'YP-42' },
  );
  assert.deepEqual(
    { ...fixture.database.prepare(`SELECT cash_cents, digital_cents, credit_cents
      FROM cash_movements WHERE operation_id = ?`).get(credit.operation_id) },
    { cash_cents: 0, digital_cents: 0, credit_cents: 1250 },
  );
});

test('retry idéntico es idempotente y payload diferente causa conflicto sin efectos', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const body = sale();
  assert.equal((await post(fixture, body)).status, 201);
  const retry = await post(fixture, body);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), {
    status: 'already_processed', operation_id: body.operation_id, sale_id: body.sale_id,
    idempotent: true, already_processed: true,
  });
  const changed = { ...body, client_reference: 'different-content' };
  const conflict = await post(fixture, changed);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, 'operation_id_conflict');
  assert.equal(count(fixture, 'sales', body.operation_id), 1);
  assert.equal(count(fixture, 'sale_items', body.operation_id), 2);
  assert.equal(count(fixture, 'inventory_movements', body.operation_id), 2);
  assert.equal(count(fixture, 'cash_movements', body.operation_id), 1);
});

test('dos solicitudes concurrentes con el mismo operation_id producen un solo efecto', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const body = sale();
  const responses = await Promise.all([post(fixture, body), post(fixture, body)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  assert.equal(count(fixture, 'sales', body.operation_id), 1);
  assert.equal(count(fixture, 'sale_items', body.operation_id), 2);
  assert.equal(count(fixture, 'inventory_movements', body.operation_id), 2);
  assert.equal(count(fixture, 'cash_movements', body.operation_id), 1);
});

test('sale_id ya utilizado no crea entidades huérfanas para otra operación', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const first = sale();
  assert.equal((await post(fixture, first)).status, 201);
  const second = { ...sale(), sale_id: first.sale_id };
  const response = await post(fixture, second);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'sale_not_created');
  assert.equal(count(fixture, 'sales', second.operation_id), 0);
  assert.equal(count(fixture, 'sale_items', second.operation_id), 0);
  assert.equal(count(fixture, 'inventory_movements', second.operation_id), 0);
  assert.equal(count(fixture, 'cash_movements', second.operation_id), 0);
});

test('referencia digital duplicada revierte toda la segunda venta', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const first = { ...sale(), payment_method: 'yape', payment: { reference: 'YP-DUPLICATE' } };
  const second = { ...sale(), payment_method: 'transferencia', payment: { reference: 'YP-DUPLICATE' } };
  assert.equal((await post(fixture, first)).status, 201);
  const response = await post(fixture, second);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'sale_not_created');
  for (const table of ['sales', 'sale_items', 'inventory_movements', 'cash_movements']) {
    assert.equal(count(fixture, table, second.operation_id), 0, table);
  }
});

test('read_only, revoked y credencial inválida no producen efectos', async (t) => {
  for (const scenario of [
    { id: 'reader', role: 'read_only', status: 'active', stored: 'reader-secret', sent: 'reader-secret', expected: 403 },
    { id: 'revoked', role: 'writer', status: 'revoked', stored: 'revoked-secret', sent: 'revoked-secret', expected: 403 },
    { id: 'invalid', role: 'writer', status: 'active', stored: 'correct-secret', sent: 'wrong-secret', expected: 401 },
  ]) {
    const fixture = workerFixture(); t.after(() => fixture.close());
    fixture.addDevice(scenario.id, scenario.role, scenario.status, scenario.stored);
    const body = sale();
    assert.equal((await post(fixture, body, scenario.sent, scenario.id)).status, scenario.expected, scenario.id);
    assert.equal(count(fixture, 'sales', body.operation_id), 0, scenario.id);
  }
});

test('fallo intermedio revierte venta, líneas, inventario y caja', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  fixture.failBatchAt(3);
  const body = sale();
  const response = await post(fixture, body);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'internal_error' });
  for (const table of ['sales', 'sale_items', 'inventory_movements', 'cash_movements']) {
    assert.equal(count(fixture, table, body.operation_id), 0, table);
  }
});

test('entradas inválidas se rechazan antes de cualquier efecto financiero', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const base = sale();
  const invalid = [
    { ...base, operation_id: '' },
    { ...base, device_id: 'different-device' },
    { ...base, items: [] },
    { ...base, items: [{ product_id: 'rice', quantity: 0, unit_price_cents: 1250 }] },
    { ...base, total_cents: 1 },
    { ...base, payment_method: 'bitcoin' },
    { ...base, payment_method: 'credito' },
    { ...base, payment_method: 'mixto' },
    { ...base, payment_method: 'mixto', payment: { cash_cents: 500, digital_cents: 500, digital_method: 'yape' } },
  ];
  for (const body of invalid) assert.ok([400, 403].includes((await post(fixture, body)).status));
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM sales').get().count, 0);
});

test('health y CORS siguen públicos, y las respuestas no exponen secretos', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const health = await fixture.fetch('https://worker.test/health');
  assert.equal(health.status, 200);
  const preflight = await fixture.fetch('https://worker.test/commands/sale.create', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  const response = await post(fixture, sale());
  const text = await response.text();
  assert.equal(text.includes('writer-secret'), false);
  assert.equal(text.includes(fixture.device('writer-1').credential_hash), false);
  assert.equal(text.includes('fixture-device-pepper'), false);
});

test('Wrangler enruta comandos al Worker y la migración A3 es reaplicable', (t) => {
  const config = readFileSync(new URL('../../tools/cloudflare-lab/wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(config, /"\/commands\/\*"/);
  const fixture = workerFixture(); t.after(() => fixture.close());
  const migration = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0004_sale_create.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => fixture.database.exec(migration));
});
