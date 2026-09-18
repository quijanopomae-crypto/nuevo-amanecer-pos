import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workerFixture } from './worker-fixture.mjs';

const READ = { 'x-read-token': 'fixture-read-token' };
const WRITE = { 'x-sync-token': 'fixture-token', 'content-type': 'application/json' };

function row(type, id, payload, sequence, receivedAt) {
  return {
    operation_id: crypto.randomUUID(), device_id: 'device-main', device_sequence: sequence,
    entity_type: type, entity_id: id, payload,
    created_at: new Date(Date.parse(receivedAt) - 1000).toISOString(), received_at: receivedAt,
  };
}

async function json(response) { return { status: response.status, body: await response.json(), headers: response.headers }; }

function seed(fixture) {
  fixture.insert(row('sales', 'V-001', { id: 'V-001', total: 25 }, 1, '2026-09-09T12:00:01.000Z'));
  fixture.insert(row('sale_items', 'V-001:0', { sale_id: 'V-001', line_index: 0, item: { name: 'Arroz', qty: 1 } }, 2, '2026-09-09T12:00:02.000Z'));
  fixture.insert(row('sale_items', 'V-OTHER:0', { sale_id: 'V-OTHER', line_index: 0, item: { name: 'Azúcar' } }, 3, '2026-09-09T12:00:03.000Z'));
  fixture.insert(row('inventory_movements', 'IM-001', { id: 'IM-001', productId: 'P1', delta: -1 }, 4, '2026-09-09T12:00:04.000Z'));
}

test('lee ventas, líneas asociadas, inventario y estado sin exponer hashes', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close()); seed(fixture);
  const sales = await json(await fixture.fetch('https://worker.test/read/sales', { headers: READ }));
  assert.equal(sales.status, 200);
  assert.equal(sales.body.items.length, 1);
  assert.equal(sales.body.items[0].payload.id, 'V-001');
  assert.equal('payload_hash' in sales.body.items[0], false);

  const lines = await json(await fixture.fetch('https://worker.test/read/sales/V-001/items', { headers: READ }));
  assert.equal(lines.status, 200);
  assert.equal(lines.body.items.length, 1);
  assert.equal(lines.body.items[0].payload.sale_id, 'V-001');

  const movements = await json(await fixture.fetch('https://worker.test/read/inventory-movements', { headers: READ }));
  assert.equal(movements.status, 200);
  assert.equal(movements.body.items.length, 1);
  assert.equal(movements.body.items[0].payload.id, 'IM-001');

  const status = await json(await fixture.fetch('https://worker.test/read/status', { headers: READ }));
  assert.deepEqual(status.body.counts, { sales: 1, sale_items: 2, inventory_movements: 1 });
  assert.equal(status.body.last_received_at, '2026-09-09T12:00:04.000Z');
  assert.doesNotMatch(JSON.stringify([sales.body, lines.body, movements.body, status.body]), /fixture-(?:read-)?token/);
});

test('lectura requiere READ_TOKEN y no acepta SYNC_TOKEN', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  for (const headers of [{}, { 'x-read-token': 'wrong' }, { 'x-sync-token': 'fixture-token' }]) {
    const response = await fixture.fetch('https://worker.test/read/status', { headers });
    assert.equal(response.status, 401);
  }
  const missingSecretFixture = workerFixture('fixture-token', undefined);
  t.after(() => missingSecretFixture.close());
  // El fixture usa default cuando undefined; comprobar fail-closed directamente con cadena vacía.
  const unconfigured = workerFixture('fixture-token', '');
  t.after(() => unconfigured.close());
  assert.equal((await unconfigured.fetch('https://worker.test/read/status', { headers: READ })).status, 503);
});

test('READ_TOKEN no puede escribir y métodos mutantes /read se rechazan sin tocar D1', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close()); seed(fixture);
  const before = fixture.count();
  const payload = JSON.stringify(row('sales', 'V-WRITE', { id: 'V-WRITE' }, 99, '2026-09-09T13:00:00.000Z'));
  const readCannotWrite = await fixture.fetch('https://worker.test/sync/operations', {
    method: 'POST', headers: { 'content-type': 'application/json', ...READ }, body: payload,
  });
  assert.equal(readCannotWrite.status, 401);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fixture.fetch('https://worker.test/read/sales', { method, headers: { ...READ, 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'GET, OPTIONS');
  }
  assert.equal(fixture.count(), before);
});

test('READ_TOKEN se rechaza como credencial de dispositivo sin consultar identidad ni exponerlo', async (t) => {
  const readToken = 'fixture-read-token';
  const fixture = workerFixture('unused', readToken); t.after(() => fixture.close());
  const response = await fixture.fetch('https://worker.test/sync/operations', {
    method: 'POST', headers: { 'x-sync-token': readToken }, body: '{}',
  });
  assert.equal(response.status, 401);
  assert.equal((await response.text()).includes(readToken), false);
  assert.equal(fixture.count(), 0);
});

test('paginación aplica default, máximo, cursor opaco y páginas sin duplicados', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  for (let index = 0; index < 103; index += 1) {
    fixture.insert(row('sales', `V-${String(index).padStart(3, '0')}`, { id: `V-${index}` }, index + 1, new Date(Date.UTC(2026, 8, 9, 12, 0, index)).toISOString()));
  }
  const first = await json(await fixture.fetch('https://worker.test/read/sales', { headers: READ }));
  assert.equal(first.body.items.length, 25);
  assert.equal(first.body.limit, 25);
  assert.ok(first.body.next_cursor);
  const second = await json(await fixture.fetch(`https://worker.test/read/sales?limit=25&cursor=${encodeURIComponent(first.body.next_cursor)}`, { headers: READ }));
  assert.equal(second.body.items.length, 25);
  assert.equal(new Set([...first.body.items, ...second.body.items].map((item) => item.operation_id)).size, 50);

  const max = await json(await fixture.fetch('https://worker.test/read/sales?limit=100', { headers: READ }));
  assert.equal(max.body.items.length, 100);
  assert.ok(max.body.next_cursor);
  for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=-1', 'cursor=not_base64!']) {
    assert.equal((await fixture.fetch('https://worker.test/read/sales?' + query, { headers: READ })).status, 400, query);
  }
});

test('CORS autoriza header de lectura y no anuncia métodos mutantes', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  const response = await fixture.fetch('https://worker.test/read/sales', {
    method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-read-token' },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('access-control-allow-headers'), 'x-read-token');
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.doesNotMatch(response.headers.get('access-control-allow-methods'), /POST|PUT|PATCH|DELETE/);
  assert.doesNotMatch(response.headers.get('access-control-allow-headers'), /x-sync-token/);
  for (const [path, options, expectedStatus] of [
    ['/read/status', { headers: READ }, 200],
    ['/read/status', {}, 401],
    ['/read/sales?limit=101', { headers: READ }, 400],
    ['/read/sales', { method: 'POST', headers: READ }, 405],
    ['/read/missing', { headers: READ }, 404],
  ]) {
    const actual = await fixture.fetch('https://worker.test' + path, options);
    assert.equal(actual.status, expectedStatus);
    assert.equal(actual.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
    assert.equal(actual.headers.get('access-control-allow-headers'), 'x-read-token');
    assert.equal(actual.headers.get('cache-control'), 'no-store');
  }
});

test('visor estático solo carga cliente READ-ONLY y este solo usa GET', () => {
  const html = readFileSync(new URL('../../POS/read-only.html', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../../POS/js/sync/read-only.js', import.meta.url), 'utf8');
  assert.match(html, /js\/sync\/read-only\.js/);
  assert.doesNotMatch(html, /inline-|app\.js|outbox\.js|confirmarVenta|guardarMovInv/);
  assert.doesNotMatch(client, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  assert.match(client, /method:\s*['"]GET['"]/);
  assert.match(client, /sessionStorage/);
  assert.doesNotMatch(client + html, /SYNC_TOKEN|fixture-token|fixture-read-token/);
});
