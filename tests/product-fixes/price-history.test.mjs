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
    NA_PERMISSIONS: { featureLocked: id => id !== 'historial-precios-producto', canDo: (role, action) => role === 'owner' && action === 'purchases.costs.view' },
    NA_ROLES: { role: 'owner', label: 'Ana', deviceId: 'dev-ana', confirmed: true, isOwner: () => true }
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
  assert.equal(added.find(row => row.type === 'venta').userId, 'dev-ana');
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

test('un empleado y un dueño en caché no ven costos; el dueño confirmado sí', () => {
  const context = load();
  const api = context.NA_PRICE_HISTORY;
  api.recordDiff({ productId: 'P', origin: 'ficha', at: '2026-10-20T12:00:00.000Z', before: { venta: 2, mayorista: 10, costo: 1 }, after: { venta: 3, mayorista: 12, costo: 1.5 } });
  assert.equal(api.list('P').find(row => row.type === 'venta').userId, 'dev-ana');
  context.NA_ROLES = { role: 'owner', label: 'Ana', deviceId: 'dev-ana', confirmed: false, isOwner: () => false };
  assert.equal(api.canSeeCost(), false);
  assert.equal(api.list('P', { role: 'owner' }).some(row => row.type === 'costo'), false);
  context.NA_ROLES = { role: 'empleado', label: 'Luis', deviceId: 'dev-luis', confirmed: true, isOwner: () => false };
  const employee = api.list('P');
  assert.deepEqual(plain(employee.map(row => row.type).sort()), ['mayorista', 'venta']);
  assert.equal(employee.some(row => row.type === 'costo'), false);
  assert.equal(api.canSeeCost(), false);
  context.NA_ROLES = { role: 'owner', label: 'Ana', deviceId: 'dev-ana', confirmed: true, isOwner: () => true };
  assert.equal(api.list('P').some(row => row.type === 'costo'), true);
  assert.equal(api.canSeeCost(), true);
  assert.equal(api.list('P', { includeCost: false }).some(row => row.type === 'costo'), false);
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
  assert.match(read('../../POS/js/config/pos-purchases-client.js'), /recordPurchase\(operationId, lines, err\.data\)/);
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
  assert.doesNotMatch(history, /canDo\(/);
  assert.match(history, /isOwner\(\)/);
});

test('dos cambios del mismo campo en el mismo instante se conservan', () => {
  const context = load();
  const api = context.NA_PRICE_HISTORY;
  const at = '2026-10-20T12:00:00.000Z';
  const first = api.recordDiff({ productId: 'P', origin: 'ficha', at, partial: true, before: { venta: 1 }, after: { venta: 2 } });
  const second = api.recordDiff({ productId: 'P', origin: 'ficha', at, partial: true, before: { venta: 2 }, after: { venta: 3 } });
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0].id, second[0].id);
  assert.deepEqual(plain(api.list('P').map(row => row.after)), [3, 2]);
});

test('una compra a medias conserva el costo ya aplicado y el reintento no lo duplica', () => {
  const products = [{ id: 'A', precio: 5, costo: 1 }, { id: 'B', precio: 5, costo: 1 }];
  const context = load({ productos: products });
  const api = context.NA_PRICE_HISTORY;
  const lines = [
    { line: 1, product_id: 'A', quantity: 1, unit_cost_cents: 180 },
    { line: 2, product_id: 'B', quantity: 1, unit_cost_cents: 220 }
  ];
  const partial = api.recordPurchase('PUR-H', lines, { error: 'purchase_line_failed', applied: [{ line: 1, product_id: 'A' }] });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].after, 1.8);
  const retry = api.recordPurchase('PUR-H', lines, { applied: [{ line: 1, product_id: 'A' }, { line: 2, product_id: 'B' }] });
  assert.equal(retry.length, 1);
  assert.equal(retry[0].after, 2.2);
  assert.equal(api.list('A', { includeCost: true }).length, 1);
  assert.equal(api.list('B', { includeCost: true })[0].after, 2.2);
  assert.equal(products[0].costo, 1);
  assert.equal(products[1].costo, 1);
});

test('si localStorage está lleno, recorta lo más viejo y no lanza', () => {
  const context = load();
  const api = context.NA_PRICE_HISTORY;
  const notes = [];
  context.toast = (message) => notes.push(String(message));
  api.recordDiff({ productId: 'P', origin: 'ficha', at: '2026-10-18T00:00:00.000Z', partial: true, before: { venta: 1 }, after: { venta: 2 } });
  api.recordDiff({ productId: 'P', origin: 'ficha', at: '2026-10-19T00:00:00.000Z', partial: true, before: { venta: 2 }, after: { venta: 3 } });
  let fails = 2;
  const real = context.localStorage.setItem.bind(context.localStorage);
  context.localStorage.setItem = (key, value) => {
    if (fails > 0) { fails -= 1; const err = new Error('quota'); err.name = 'QuotaExceededError'; throw err; }
    return real(key, value);
  };
  assert.doesNotThrow(() => api.recordDiff({ productId: 'P', origin: 'ficha', at: '2026-10-20T00:00:00.000Z', partial: true, before: { venta: 3 }, after: { venta: 4 } }));
  const rows = api.list('P');
  assert.equal(rows[0].after, 4);
  assert.equal(rows.some(row => row.after === 2), false);
  assert.ok(notes.some(note => /almacenamiento/.test(note)));
  context.localStorage.setItem = () => { const err = new Error('quota'); err.name = 'QuotaExceededError'; err.code = 22; throw err; };
  assert.doesNotThrow(() => api.recordDiff({ productId: 'P', origin: 'ficha', at: '2026-10-21T00:00:00.000Z', partial: true, before: { venta: 4 }, after: { venta: 5 } }));
});

test('mayorista: S/ 0.00 y vacío son «sin precio»; pasar de uno a otro no se registra', () => {
  const api = load().NA_PRICE_HISTORY;
  const base = { id: 'P0', precio: 2, costo: 1 };
  for (const [before, after] of [[0, ''], [0, null], [0, undefined], ['', 0], [null, 0], ['0', ''], [0, '0.00']]) {
    const added = api.recordCatalogDiff([{ ...base, precioCaja: before }], [{ ...base, precioCaja: after }], 'ficha');
    assert.deepEqual(plain(added), [], `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  }
  assert.deepEqual(plain(api.list('P0')), []);
  // Un precio real sigue registrándose, desde y hacia «sin precio».
  const up = api.recordCatalogDiff([{ ...base, precioCaja: 0 }], [{ ...base, precioCaja: 5 }], 'ficha');
  assert.deepEqual(plain(up.map(row => [row.type, row.before, row.after])), [['mayorista', 0, 5]]);
  const down = api.recordCatalogDiff([{ ...base, precioCaja: 5 }], [{ ...base, precioCaja: '' }], 'ficha');
  assert.deepEqual(plain(down.map(row => [row.type, row.before, row.after])), [['mayorista', 5, null]]);
  // Solo el mayorista: venta y costo conservan su detección (0 → vacío sí cuenta).
  const sale = api.recordDiff({ productId: 'P0', origin: 'ficha', before: { venta: 0, mayorista: 0, costo: 0 }, after: { venta: null, mayorista: null, costo: null } });
  assert.deepEqual(plain(sale.map(row => row.type).sort()), ['costo', 'venta']);
});

test('canSeeCost: solo isOwner() === true; un valor no booleano o un error fallan cerrado', () => {
  for (const [isOwner, expected] of [[() => true, true], [() => 'yes', false], [() => 1, false], [() => false, false], [() => { throw new Error('boom'); }, false]]) {
    const context = load({ NA_ROLES: { role: 'owner', confirmed: true, isOwner } });
    assert.equal(context.NA_PRICE_HISTORY.canSeeCost(), expected, String(isOwner));
  }
  assert.equal(load({ NA_ROLES: undefined }).NA_PRICE_HISTORY.canSeeCost(), false);
});
