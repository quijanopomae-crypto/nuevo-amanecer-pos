import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createPosSandbox, json, POS_DIR } from '../product-fixes/fix04/lib/sandbox.mjs';
import { workerFixture } from './worker-fixture.mjs';

const OUTBOX_CODE = readFileSync(path.join(POS_DIR, 'js/sync/outbox.js'), 'utf8');
const PRODUCT = { id: 'P1', name: 'Arroz', stock: 10, controlInventario: true, precio: 25, costo: 5, unidad: 'unidad', sku: 'ARROZ-1' };

function withOutbox(stores) {
  const sb = createPosSandbox(stores ? { stores } : {});
  new vm.Script(OUTBOX_CODE, { filename: 'POS/js/sync/outbox.js' }).runInContext(sb.ctx);
  sb.seed();
  sb.run('NuevoAmanecerOutbox.initializeBaseline(_naBuildSnapshot());');
  return sb;
}

async function openCash(sb) {
  sb.el('cajFondo').value = '100';
  sb.el('cajCajero').value = 'CAJ-001';
  assert.equal(await sb.run('abrirCaja()'), true);
}

async function sell(sb, qty = 2) {
  await openCash(sb);
  sb.seedData('productos', [{ ...PRODUCT }]);
  sb.run(`cart.push({id:'P1',name:'Arroz',sku:'ARROZ-1',precio:25,qty:${qty},unitsPerQty:1,ventaModo:'unidad',costo:5,controlInventario:true,ventaLibre:false,ventaSinStock:false,unidad:'unidad'});`);
  sb.el('mMontoRec').value = String(25 * qty);
  await sb.run('confirmarVenta()');
}

function operationTypes(sb) {
  return json(sb, 'NuevoAmanecerOutbox.snapshot().outbox.map(x=>x.entity_type)');
}

function response(status, body) {
  return { status, async json() { return body; } };
}

async function captureOne(api, suffix = '') {
  const source = { data: { ventas: [{ id: 'V-' + suffix, timestamp: '2026-09-09T12:00:00.000Z', items: [] }], inventoryMovements: [] } };
  api.initializeBaseline({ data: { ventas: [], inventoryMovements: [] } });
  api.accept(await api.prepare(source));
  return api.snapshot().outbox[0];
}

function directApi() {
  const context = vm.createContext({
    console, structuredClone, TextEncoder, URL, AbortController,
    crypto: globalThis.crypto, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { onLine: true }, setTimeout, clearTimeout, addEventListener() {}, fetch: globalThis.fetch,
  });
  context.globalThis = context; context.window = context;
  new vm.Script(OUTBOX_CODE).runInContext(context);
  return { api: context.NuevoAmanecerOutbox, context };
}

function attachMemoryPersistence(api) {
  let durable = api.snapshot();
  api.configure({ token: 'test-token', persist: async (operation, patch) => {
    durable = api.updateState(durable, operation, patch);
    api.accept(durable);
    return { durable: true, verified: true };
  } });
  return () => structuredClone(durable);
}

test('venta durable crea sales, sale_items e inventory_movements en el mismo snapshot', async () => {
  const sb = withOutbox();
  await sell(sb, 2);
  const durable = sb.durableSnapshot();
  assert.equal(durable.data.ventas.length, 1);
  assert.equal(durable.data.productos.find((p) => p.id === 'P1').stock, 8);
  assert.deepEqual(durable.cloudSync.outbox.map((op) => op.entity_type), ['sales', 'sale_items', 'inventory_movements']);
  assert.ok(durable.cloudSync.outbox.every((op) => op.status === 'PENDING'));
  assert.deepEqual(operationTypes(sb), ['sales', 'sale_items', 'inventory_movements']);
});

test('fallo durable revierte venta, stock, ledger y no acepta OUTBOX huérfano', async () => {
  const sb = withOutbox();
  await openCash(sb);
  sb.seedData('productos', [{ ...PRODUCT }]);
  await sb.run('saveAllData()');
  const before = sb.run('JSON.stringify(NuevoAmanecerOutbox.snapshot())');
  sb.breakPersistent();
  sb.run("cart.push({id:'P1',name:'Arroz',sku:'ARROZ-1',precio:25,qty:2,unitsPerQty:1,ventaModo:'unidad',costo:5,controlInventario:true,unidad:'unidad'});");
  sb.el('mMontoRec').value = '50';
  await sb.run('confirmarVenta()');
  assert.equal(json(sb, 'ventas.length'), 0);
  assert.equal(json(sb, 'productos[0].stock'), 10);
  assert.equal(json(sb, 'inventoryMovements.length'), 0);
  assert.equal(sb.run('JSON.stringify(NuevoAmanecerOutbox.snapshot())'), before);
});

test('reload conserva UUID, OUTBOX, hash y secuencia; siguiente operación es monotónica', async () => {
  const first = withOutbox();
  await sell(first, 1);
  const second = withOutbox(first.stores);
  await second.run('loadAllData()');
  const before = json(second, 'NuevoAmanecerOutbox.snapshot()');
  second.run("ventas.unshift({id:'V-NEW',timestamp:'2026-09-09T13:00:00.000Z',items:[]});");
  await second.run('saveAllData()');
  const after = json(second, 'NuevoAmanecerOutbox.snapshot()');
  assert.equal(after.device_id, before.device_id);
  assert.deepEqual(after.outbox.slice(0, before.outbox.length), before.outbox);
  assert.equal(after.outbox.at(-1).device_sequence, before.next_device_sequence);
  for (const op of after.outbox) assert.equal(await second.run(`NuevoAmanecerOutbox.sha256(${JSON.stringify(op.payload)})`), op.payload_hash);
});

test('fallback SHA-256 mantiene la venta local sin Web Crypto subtle', async () => {
  const { api, context } = directApi();
  context.crypto = { randomUUID: globalThis.crypto.randomUUID.bind(globalThis.crypto), getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
  const payload = 'abc';
  assert.equal(await api.sha256(payload), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  api.initializeBaseline({ data: { ventas: [], inventoryMovements: [] } });
  api.accept(await api.prepare({ data: { ventas: [{ id: 'V-FALLBACK', timestamp: '2026-09-09T00:00:00.000Z', items: [] }], inventoryMovements: [] } }));
  assert.equal(api.snapshot().outbox.length, 1);
});

test('snapshot antiguo establece baseline sin exportar historia previa', async () => {
  const { api } = directApi();
  const old = { data: { ventas: [{ id: 'V-OLD', timestamp: '2020-01-01T00:00:00.000Z', items: [{ id: 'P1' }] }], inventoryMovements: [{ id: 'IM-OLD' }] } };
  api.restore(null, old);
  api.accept(await api.prepare(old));
  assert.equal(api.snapshot().outbox.length, 0);
});

test('offline mantiene PENDING sin incrementar intentos y recuperación sincroniza', async () => {
  const { api, context } = directApi();
  const op = await captureOne(api, 'OFFLINE');
  const durable = attachMemoryPersistence(api);
  context.navigator.onLine = false;
  assert.equal((await api.syncPending(async () => { throw new Error('no debe llamar'); })).blocked, 'offline');
  assert.equal(api.snapshot().outbox[0].attempts, 0);
  context.navigator.onLine = true;
  const result = await api.syncPending(async (_url, options) => response(201, { status: 'inserted', operation_id: JSON.parse(options.body).operation_id }));
  assert.equal(result.synced, 1);
  assert.equal(durable().outbox[0].status, 'SYNCED');
  assert.equal(durable().outbox[0].operation_id, op.operation_id);
});

test('network y 5xx conservan PENDING; retry usa operation_id/hash idénticos y acepta already_processed', async () => {
  const { api } = directApi();
  await captureOne(api, 'RETRY');
  attachMemoryPersistence(api);
  const sent = [];
  let result = await api.syncPending(async (_url, options) => { sent.push(JSON.parse(options.body)); throw new Error('offline'); });
  assert.equal(result.blocked, 'network');
  assert.equal(api.snapshot().outbox[0].status, 'PENDING');
  api.configure({ token: 'test-token' });
  // Rehidratar elimina el backoff temporal, equivalente a reload/recuperación posterior.
  api.restore(api.snapshot(), { data: { ventas: [], inventoryMovements: [] } });
  result = await api.syncPending(async (_url, options) => { sent.push(JSON.parse(options.body)); return response(503, { error: 'unavailable' }); });
  assert.equal(result.blocked, 'server');
  assert.equal(api.snapshot().outbox[0].status, 'PENDING');
  api.restore(api.snapshot(), { data: { ventas: [], inventoryMovements: [] } });
  result = await api.syncPending(async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body);
    return response(200, { status: 'already_processed', operation_id: body.operation_id });
  });
  assert.equal(result.synced, 1);
  assert.ok(sent.every((body) => body.operation_id === sent[0].operation_id && body.payload_hash === sent[0].payload_hash));
  assert.equal(api.snapshot().outbox[0].attempts, 3);
});

test('payload alterado se bloquea por integridad antes de cualquier POST', async () => {
  const { api } = directApi();
  await captureOne(api, 'TAMPER');
  const altered = api.snapshot();
  altered.outbox[0].payload = '{"altered":true}';
  api.restore(altered, { data: { ventas: [], inventoryMovements: [] } });
  attachMemoryPersistence(api);
  let calls = 0;
  const result = await api.syncPending(async () => { calls++; return response(201, {}); });
  assert.equal(result.blocked, 'integrity');
  assert.equal(calls, 0);
  assert.equal(api.snapshot().outbox[0].status, 'FAILED');
  assert.equal(api.snapshot().outbox[0].last_error, 'PAYLOAD_HASH_MISMATCH');
});

test('401 queda FAILED sin bucle y solo reintenta tras token nuevo explícito', async () => {
  const { api } = directApi();
  await captureOne(api, 'AUTH');
  attachMemoryPersistence(api);
  let calls = 0;
  assert.equal((await api.syncPending(async () => { calls++; return response(401, { error: 'unauthorized' }); })).blocked, 'authentication');
  assert.equal(api.snapshot().outbox[0].status, 'FAILED');
  assert.equal((await api.syncPending(async () => { calls++; return response(201, {}); })).blocked, 'authentication');
  assert.equal(calls, 1);
  const id = api.snapshot().outbox[0].operation_id;
  api.configure({ token: 'replacement-token' });
  assert.equal(await api.retryFailed(id), true);
  const result = await api.syncPending(async (_url, options) => response(201, { status: 'inserted', operation_id: JSON.parse(options.body).operation_id }));
  assert.equal(result.synced, 1);
});

test('409 queda FAILED, preserva payload y nunca habilita Last-Push-Wins', async () => {
  const { api } = directApi();
  const original = await captureOne(api, 'CONFLICT');
  attachMemoryPersistence(api);
  let calls = 0;
  assert.equal((await api.syncPending(async () => { calls++; return response(409, { status: 'conflict' }); })).blocked, 'conflict');
  const failed = api.snapshot().outbox[0];
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.last_error, 'CONFLICT_409');
  assert.equal(failed.payload, original.payload);
  assert.equal(failed.payload_hash, original.payload_hash);
  assert.equal(await api.retryFailed(failed.operation_id), false);
  assert.equal((await api.syncPending(async () => { calls++; return response(201, {}); })).blocked, 'conflict');
  assert.equal(calls, 1);
});

test('acuse perdido y reload reintentan exactamente una vez contra el Worker real', async (t) => {
  const fixture = workerFixture();
  t.after(() => fixture.close());
  const { api } = directApi();
  const original = await captureOne(api, 'ACK-LOSS');
  fixture.addDevice(original.device_id, 'writer', 'active', 'fixture-token');
  attachMemoryPersistence(api);
  api.configure({ token: 'fixture-token' });
  let loseAck = true;
  const transport = async (url, options) => {
    const reply = await fixture.fetch(url, options);
    if (loseAck) { loseAck = false; throw new Error('ACK_LOST_AFTER_INSERT'); }
    return reply;
  };
  assert.equal((await api.syncPending(transport)).blocked, 'network');
  assert.equal(fixture.count(), 1);
  api.restore(api.snapshot(), { data: { ventas: [], inventoryMovements: [] } });
  assert.equal((await api.syncPending(transport)).synced, 1);
  assert.equal(fixture.count(), 1);
  assert.equal(fixture.row(original.operation_id).payload_hash, original.payload_hash);
  assert.equal(api.snapshot().outbox[0].status, 'SYNCED');
});

test('fallo al persistir SYNCED deja PENDING y el retry idempotente cierra sin duplicar', async (t) => {
  const fixture = workerFixture();
  t.after(() => fixture.close());
  const { api } = directApi();
  const original = await captureOne(api, 'SYNC-PERSIST');
  fixture.addDevice(original.device_id, 'writer', 'active', 'fixture-token');
  let durable = api.snapshot();
  let rejectSyncedOnce = true;
  api.configure({ token: 'fixture-token', persist: async (operation, patch) => {
    if (patch.status === 'SYNCED' && rejectSyncedOnce) { rejectSyncedOnce = false; return { durable: false, verified: false }; }
    durable = api.updateState(durable, operation, patch); api.accept(durable);
    return { durable: true, verified: true };
  } });
  assert.equal((await api.syncPending(fixture.fetch)).blocked, 'result_not_persisted');
  assert.equal(fixture.count(), 1);
  assert.equal(api.snapshot().outbox[0].status, 'PENDING');
  api.restore(api.snapshot(), { data: { ventas: [], inventoryMovements: [] } });
  assert.equal((await api.syncPending(fixture.fetch)).synced, 1);
  assert.equal(fixture.count(), 1);
  assert.equal(api.snapshot().outbox[0].status, 'SYNCED');
});

test('persistencia de acuses no captura cambios financieros todavía no confirmados', async () => {
  const sb = withOutbox();
  await sell(sb, 1);
  const operation = sb.durableSnapshot().cloudSync.outbox[0];
  sb.run("productos[0].stock=999;cart.push({id:'DRAFT',qty:1,precio:1});");
  const result = await sb.run(`_naQueueCloudSyncPersist(${JSON.stringify(operation)},{status:'SYNCED',attempts:1,last_error:null})`);
  assert.equal(result.durable, true);
  const durable = sb.durableSnapshot();
  assert.equal(durable.data.productos[0].stock, 9);
  assert.deepEqual(durable.cart, []);
  assert.equal(durable.cloudSync.outbox[0].status, 'SYNCED');
});

test('beforeunload no persiste datos financieros mientras el hash OUTBOX está pendiente', async () => {
  const sb = withOutbox();
  sb.seedData('productos', [{ ...PRODUCT }]);
  await sb.run('saveAllData()');
  sb.run("ventas.unshift({id:'V-RACE',timestamp:'2026-09-09T14:00:00.000Z',items:[]}); NuevoAmanecerOutbox.sha256=async function(){return await new Promise(()=>{});};");
  sb.run('saveAllData()');
  sb.run('_naFlushRecoveryBeforeUnload()');
  assert.equal(sb.durableSnapshot().data.ventas.length, 0);
});

test('backup focal conserva OUTBOX pero excluye endpoint y token', async () => {
  const sb = withOutbox();
  await sell(sb, 1);
  sb.run("NuevoAmanecerOutbox.configure({endpoint:'https://runtime.invalid',token:'secret-only-runtime'});");
  const backup = await sb.run('_naCreateCompleteBackup()');
  const serialized = JSON.stringify(backup);
  assert.match(serialized, /cloudSync/);
  assert.doesNotMatch(serialized, /runtime\.invalid|secret-only-runtime/);
  sb.run(`globalThis.__backupPayload=${JSON.stringify(JSON.parse(serialized).payload)}`);
  const prepared = json(sb, '_naPrepareBackupSnapshot(globalThis.__backupPayload)');
  assert.deepEqual(prepared.snapshot.cloudSync, sb.durableSnapshot().cloudSync);
});

test('credenciales permanecen fuera del snapshot financiero', () => {
  const { api, context } = directApi();
  let stored = '';
  context.localStorage.setItem = (_key, value) => { stored = value; };
  context.localStorage.getItem = () => stored;
  api.initializeBaseline({ data: { ventas: [], inventoryMovements: [] } });
  api.configure({ token: 'secret-only-runtime', remember: true });
  assert.doesNotMatch(JSON.stringify(api.snapshot()), /secret-only-runtime/);
  assert.match(stored, /secret-only-runtime/);
});
