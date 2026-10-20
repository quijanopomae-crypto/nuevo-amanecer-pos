import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function memory() {
  const bag = new Map();
  return {
    getItem(key) { return bag.has(key) ? bag.get(key) : null; },
    setItem(key, value) { bag.set(key, String(value)); },
    removeItem(key) { bag.delete(key); }
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function load(extra) {
  const context = Object.assign({
    localStorage: memory(),
    NA_PERMISSIONS: { canDo: (role, action) => role === 'owner' && action === 'purchases.costs.view' },
    NA_ROLES: { role: 'owner', label: 'Ana' }
  }, extra || {});
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../../POS/js/products/price-history.js', import.meta.url), 'utf8'), context);
  return context;
}

test('la ficha registra venta, mayorista y costo, y omite el precio que no cambió', () => {
  const context = load();
  const api = context.NA_PRICE_HISTORY;
  const sale = { id: 'T-9', items: [{ id: 'P1', precio: 2, costo: 1 }] };
  const beforeSale = structuredClone(sale);
  const previous = { id: 'P1', precio: 2, precioCaja: 20, costo: 1 };
  const saved = { id: 'P1', precio: 2.5, precioCaja: 20, costo: 1.4 };
  const added = api.recordCatalogDiff([previous], [saved], 'ficha');
  assert.deepEqual(plain(added.map(row => row.type).sort()), ['costo', 'venta']);
  assert.equal(added.find(row => row.type === 'venta').before, 2);
  assert.equal(added.find(row => row.type === 'venta').after, 2.5);
  assert.equal(added.find(row => row.type === 'venta').user, 'Ana');
  assert.equal(added.find(row => row.type === 'venta').origin, 'ficha');
  assert.equal(added.some(row => row.type === 'mayorista'), false);
  assert.deepEqual(previous, { id: 'P1', precio: 2, precioCaja: 20, costo: 1 });
  assert.deepEqual(sale, beforeSale);
  assert.equal(context.localStorage.getItem(api.KEY).includes('T-9'), false);
});

test('la importación registra solo precios distintos y no toca el ticket anterior', () => {
  const context = load();
  const api = context.NA_PRICE_HISTORY;
  const ticket = { n: 1842, items: [{ precio: 4, costo: 2 }] };
  const frozen = structuredClone(ticket);
  const before = [{ id: 'A', precio: 4, precioCaja: null, costo: 2 }, { id: 'B', precio: 1, precioCaja: 10, costo: 0.5 }];
  const after = [{ id: 'A', precio: 4, precioCaja: 40, costo: 2 }, { id: 'B', precio: 1, precioCaja: 10, costo: 0.5 }, { id: 'C', precio: 9, costo: 3 }];
  const added = api.recordCatalogDiff(before, after, 'importacion');
  assert.equal(added.length, 1);
  assert.equal(added[0].type, 'mayorista');
  assert.equal(added[0].before, null);
  assert.equal(added[0].after, 40);
  assert.equal(added[0].origin, 'importacion');
  assert.deepEqual(ticket, frozen);
  assert.equal(api.list('B').length, 0);
  assert.equal(api.list('C').length, 0);
});

test('la compra registra el costo nuevo y un reintento del mismo costo no se duplica', () => {
  const products = [{ id: 'A', precio: 5, precioCaja: null, costo: 1 }];
  const context = load({ productos: products });
  const api = context.NA_PRICE_HISTORY;
  const lines = [{ line: 1, product_id: 'A', quantity: 2, unit_cost_cents: 180 }];
  const first = api.recordPurchase('PUR-1', lines, { applied: [{ line: 1, product_id: 'A' }] });
  const again = api.recordPurchase('PUR-1', lines, { applied: [{ line: 1, product_id: 'A' }] });
  const same = api.recordPurchase('PUR-2', [{ line: 1, product_id: 'A', quantity: 1, unit_cost_cents: 100 }], { applied: [{ line: 1 }] });
  const skipped = api.recordPurchase('PUR-3', lines, { idempotent: true, applied: [{ line: 1 }] });
  assert.equal(first.length, 1);
  assert.equal(first[0].origin, 'compra');
  assert.equal(first[0].type, 'costo');
  assert.equal(first[0].before, 1);
  assert.equal(first[0].after, 1.8);
  assert.equal(again.length, 0);
  assert.equal(same.length, 0);
  assert.equal(skipped.length, 0);
  assert.deepEqual(products[0], { id: 'A', precio: 5, precioCaja: null, costo: 1 });
});

test('el mismo precio de la ficha no se registra', () => {
  const context = load();
  const api = context.NA_PRICE_HISTORY;
  const product = { id: 'P', precio: 3.5, precioCaja: 30, costo: 2 };
  const copy = { id: 'P', precio: 3.5, precioCaja: 30, costo: 2 };
  assert.deepEqual(plain(api.recordCatalogDiff([product], [copy], 'ficha')), []);
  assert.equal(api.list('P').length, 0);
});

test('el historial queda con el cambio más reciente primero', () => {
  const context = load();
  const api = context.NA_PRICE_HISTORY;
  api.recordDiff({ productId: 'P', origin: 'ficha', user: 'Ana', at: '2026-10-18T15:00:00.000Z', before: { venta: 1, mayorista: null, costo: 1 }, after: { venta: 2, mayorista: null, costo: 1 } });
  api.recordDiff({ productId: 'P', origin: 'importacion', user: 'Ana', at: '2026-10-20T15:00:00.000Z', before: { venta: 2, mayorista: null, costo: 1 }, after: { venta: 4, mayorista: null, costo: 1 } });
  const rows = api.list('P');
  assert.deepEqual(plain(rows.map(row => row.after)), [4, 2]);
  assert.ok(Date.parse(rows[0].at) > Date.parse(rows[1].at));
});

test('un empleado no ve los cambios de costo; el dueño sí', () => {
  const context = load();
  const api = context.NA_PRICE_HISTORY;
  api.recordDiff({ productId: 'P', origin: 'ficha', at: '2026-10-20T12:00:00.000Z', before: { venta: 2, mayorista: 10, costo: 1 }, after: { venta: 3, mayorista: 12, costo: 1.5 } });
  context.NA_ROLES = { role: 'empleado', label: 'Luis' };
  const employee = api.list('P', { role: 'empleado' });
  const owner = api.list('P', { role: 'owner' });
  assert.deepEqual(plain(employee.map(row => row.type).sort()), ['mayorista', 'venta']);
  assert.equal(employee.some(row => row.type === 'costo'), false);
  assert.equal(owner.some(row => row.type === 'costo'), true);
  assert.equal(api.canSeeCost('empleado'), false);
  assert.equal(api.canSeeCost('owner'), true);
});

test('una segunda compra al mismo costo ya registrado no se duplica', () => {
  const products = [{ id: 'A', precio: 5, costo: 1 }];
  const context = load({ productos: products });
  const api = context.NA_PRICE_HISTORY;
  const line = [{ line: 1, product_id: 'A', quantity: 1, unit_cost_cents: 180 }];
  assert.equal(api.recordPurchase('PUR-1', line, { applied: [{ line: 1 }] }).length, 1);
  assert.equal(api.recordPurchase('PUR-9', line, { applied: [{ line: 1 }] }).length, 0);
  const raised = api.recordPurchase('PUR-10', [{ line: 1, product_id: 'A', quantity: 1, unit_cost_cents: 250 }], { applied: [{ line: 1 }] });
  assert.equal(raised.length, 1);
  assert.equal(raised[0].before, 1.8);
  assert.equal(raised[0].after, 2.5);
  assert.deepEqual(products[0], { id: 'A', precio: 5, costo: 1 });
});

test('la ficha, la importación y la compra quedan enganchadas sin tocar ventas', () => {
  const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(read('../../POS/js/legacy-inline/inline-02.js'), /NA_PRICE_HISTORY\.recordCatalogDiff\(/);
  assert.match(read('../../POS/js/legacy-inline/inline-03.js'), /recordCatalogDiff\(backup\.productos,productos,'importacion'\)/);
  assert.match(read('../../POS/js/config/pos-purchases-client.js'), /NA_PRICE_HISTORY\.recordPurchase\(/);
  assert.match(read('../../POS/js/sync/canonical-product-bridge.js'), /recordFichaPrice\(id, legacy, input\)/);
  assert.match(read('../../POS/js/sync/canonical-product-bridge.js'), /recordFichaPrice\(id, legacy, pending\.payload\)/);
  const html = read('../../POS/index.html');
  assert.match(html, /id="pPriceHistory"/);
  assert.match(html, /js\/products\/price-history\.js/);
  assert.match(html, /js\/products\/price-history-ui\.js/);
  assert.match(read('../../POS/sw.js'), /\.\/js\/products\/price-history\.js/);
  const history = read('../../POS/js/products/price-history.js');
  assert.match(history, /na_price_history_v1/);
  assert.doesNotMatch(history, /setItem\((?!KEY)/);
});
