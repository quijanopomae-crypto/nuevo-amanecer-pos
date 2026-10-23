// Revisión de #996 (INV-057, lista pendiente en pos_settings), con la base canónica real (activeCanon) y pos_settings real:
// 1) Al guardar una lista nueva (de CUALQUIER aparato) se borran las listas vencidas (más de 30 min) de todos los aparatos; las vigentes
//    y las demás claves de pos_settings no se tocan. Así la tabla no crece con listas que nadie confirmó.
// 2) Las tarjetas de una lista guardada hace ~25 min llevan el stock leído en el servidor AL decir «sí»; si después de esa lectura cambia
//    el stock en la base (una salida desde otro aparato, como una venta), «Aplicar» devuelve 409 stock_changed (formato de #983: message +
//    tarjeta NUEVA firmada con el stock de ahora) y la base queda con el valor nuevo. El teléfono de #992 lo lee igual que el de un conteo.
// 3) La clave de la lista (internal:asst:lote: + hash del aparato) entra en el límite real de pos_settings (CHECK length(key) BETWEEN 1 AND 60).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { activeCanon, device } from '../cloud-sync/canon-browser-harness.mjs';
import * as PA from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { canonicalReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' };
const OWNER = { principalId: 'session:dueno', posRole: 'owner' };
const MIN = 60000, T0 = Date.parse('2026-10-23T15:00:00.000Z');
const bridge = readFileSync('POS/js/sync/canonical-inventory-bridge.js', 'utf8');
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const tool = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

async function canon(t) {
  const f = await activeCanon(t, { migrations: ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0024_pos_roles_owner_pin.sql'] });
  const db = f.env.nuevo_amanecer_lab;
  return { f, db, store: PA.createSettingsUsageStore(db), reader: canonicalReader(db) };
}
const rows = (f) => f.database.prepare("SELECT key,value_json FROM pos_settings ORDER BY key").all().map((r) => ({ key: r.key, value: JSON.parse(r.value_json) }));
const tracked = (f, n) => f.database.prepare('SELECT product_id,name,current_stock_quantity,stock_revision FROM products WHERE tracks_inventory=1 ORDER BY product_id LIMIT ?').all(n);
const stockOf = (f, id) => f.sql('SELECT current_stock_quantity,stock_revision FROM products WHERE product_id=?', id);

// Otro aparato (caja) mueve stock con la ruta canónica REAL de inventario (sube stock_revision, igual que una venta).
const tabs = new WeakMap();
async function move(f, productId, type, qty) {
  let tab = tabs.get(f);
  if (!tab) tabs.set(f, tab = await device(f, { token: 'device-a-token', deviceId: 'device-a', scripts: [['canonical-inventory-bridge.js', bridge]],
    globals: { invMovId: productId, invMovT: type, securityIsLocked() { return false; }, storage: { getItem() { return null; } },
      LOCK_KEYS: { master: 'a', readOnly: 'b', modules: { productos: 'c' } }, invRender() {}, posRender() {}, updateDashboard() {} } }));
  tab.context.invMovId = productId; tab.context.invMovT = type;
  tab.el('mMovCant').value = String(qty);
  assert.equal(await tab.context.NuevoAmanecerCanonicalInventoryBridge.save(), true);
}

function chatter({ store, reader }, prods) {
  let history = [];
  return async (text, now, calls = []) => {
    let n = 0;
    const r = await PA.assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST',
      body: JSON.stringify({ text, history, context: { products: prods.map((p) => ({ id: p.product_id, nombre: p.name, stock: 999, precio: 5 })) } }) }), ENV, OWNER, jsonR,
      { store, reader, now: () => now, resolveRole: async () => 'owner', audit: async () => {}, readBusinessName: async () => 'Bodega',
        fetch: async () => { n++; return jsonR({ choices: [{ message: { content: 'Listo.', tool_calls: n === 1 ? calls : [] } }] }); } });
    const body = await r.json();
    if (Array.isArray(body.turns)) history = [...history, ...body.turns];
    return { status: r.status, body, modelCalls: n };
  };
}
const adjCalls = (prods, q = 2) => prods.map((p, i) => tool('proponer_ajuste_stock', { product_id: p.product_id, tipo: 'entrada', cantidad: q, motivo: 'Ajuste de inventario' }, 'c' + i));

test('lista pendiente: al guardar una nueva se borran las vencidas de cualquier aparato; vigentes y otras claves quedan', async (t) => {
  const c = await canon(t), prods = tracked(c.f, 6);
  const A = { principalId: 'session:aparato-A' }, C = { principalId: 'session:aparato-C' };
  const one = adjCalls(prods.slice(0, 6)).map((x) => ({ name: x.function.name, arguments: x.function.arguments }));
  assert.equal(await PA.saveBulk(c.store, A, T0 - 31 * MIN, one, true), true); // vencida (31 min)
  assert.equal(await PA.saveBulk(c.store, C, T0 - 10 * MIN, one, true), true); // vigente (10 min)
  // Otras claves del asistente y del POS, viejas: no se tocan.
  const other = PA.USAGE_PREFIX + 'otra:' + 'a'.repeat(40);
  assert.equal(await c.store.put(other, { iat: T0 - 90 * MIN }, 0), true);
  assert.equal(await c.store.put(PA.USAGE_PREFIX + 'w:abc', { min: 1, n: 3 }, 0), true);
  c.f.database.prepare("INSERT INTO pos_settings(key,value_json,revision,updated_at,updated_by) VALUES('negocio.nombre','{\"v\":\"Bodega\"}',1,'2020-01-01T00:00:00Z','x')").run();
  const keyA = await PA.bulkKey(A), keyB = await PA.bulkKey(OWNER), keyC = await PA.bulkKey(C);
  const before = rows(c.f).map((r) => r.key);
  assert.ok(before.includes(keyA) && before.includes(keyC));

  // Aparato B (el Admin) recibe un pedido masivo: se guarda SU lista y se limpian las vencidas.
  const say = chatter(c, prods);
  const q = await say('sumale 2 a todo', T0, adjCalls(prods));
  assert.equal(q.body.reply, 'Son 6 productos; ¿le muestro la lista para revisarla antes?');
  const after = rows(c.f), keys = after.map((r) => r.key);
  assert.ok(!keys.includes(keyA), 'la lista vencida del aparato A se borró');
  assert.ok(keys.includes(keyB), 'la lista nueva del aparato B está');
  assert.equal(after.find((r) => r.key === keyB).value.calls.length, 6);
  assert.ok(keys.includes(keyC), 'la lista vigente del aparato C sigue');
  assert.deepEqual(after.find((r) => r.key === keyC).value.calls, one);
  for (const k of [other, PA.USAGE_PREFIX + 'w:abc', 'negocio.nombre']) assert.ok(keys.includes(k), k + ' no se toca');
  assert.deepEqual(before.filter((k) => !keys.includes(k)), [keyA], 'solo se borró la fila vencida de A');
  assert.deepEqual(keys.filter((k) => !before.includes(k) && k.startsWith(PA.BULK_PREFIX)), [keyB], 'la única lista nueva es la de B (lo demás: cupo del turno)');
});

test('lista de hace 25 min: «sí» lleva el stock leído en ese momento; si cambia antes de «Aplicar» -> 409 stock_changed con tarjeta nueva y la base queda igual', async (t) => {
  const c = await canon(t), prods = tracked(c.f, 6), [p0, p1] = prods;
  const say = chatter(c, prods);
  const q = await say('sumale 2 a todo', T0, adjCalls(prods));
  assert.equal(q.body.proposals.length, 0);

  // 20 min después otro aparato registra una entrada de 2 en el primer producto (antes del «sí»).
  await move(c.f, p0.product_id, 'entrada', 2);
  const mid = stockOf(c.f, p0.product_id);
  assert.equal(mid.current_stock_quantity, p0.current_stock_quantity + 2);

  // 25 min después: «sí». Sin modelo; la tarjeta trae el stock del servidor de AHORA (no el de hace 25 min ni el 999 del aparato).
  const T1 = T0 + 25 * MIN;
  const yes = await say('sí', T1);
  assert.equal(yes.modelCalls, 0);
  assert.equal(yes.body.proposals.length, 5);
  const card0 = yes.body.proposals[0], card1 = yes.body.proposals[1];
  assert.equal(card0.product_id, p0.product_id);
  assert.equal(card0.stock_actual, mid.current_stock_quantity);
  assert.equal(card0.stock_despues, mid.current_stock_quantity + 2);
  assert.match(yes.body.reply, new RegExp('stock ' + String(mid.current_stock_quantity).replace('.', '\\.') + ' → '));

  // Después del «sí» y antes de «Aplicar»: sale 1 unidad desde la caja (como una venta).
  await move(c.f, p0.product_id, 'salida', 1);
  const now0 = stockOf(c.f, p0.product_id);
  assert.equal(now0.current_stock_quantity, mid.current_stock_quantity - 1);

  const apply = async (card) => { const { confirm_token, ...proposal } = card;
    return PA.assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token: confirm_token, proposal }) }), ENV, OWNER, jsonR,
      { store: c.store, reader: c.reader, now: () => T1 + MIN, resolveRole: async () => 'owner', audit: async () => {} }); };
  const r0 = await apply(card0), b0 = await r0.json();
  assert.equal(r0.status, 409, JSON.stringify(b0));
  assert.equal(b0.error, 'stock_changed');
  assert.equal(b0.nombre, p0.name);
  assert.equal(b0.stock_antes, mid.current_stock_quantity);
  assert.equal(b0.stock_ahora, now0.current_stock_quantity);
  assert.equal(b0.objetivo, now0.current_stock_quantity + 2, 'la misma entrada de 2, sobre el stock de ahora');
  assert.equal(typeof b0.operation_id, 'string');
  assert.match(b0.message, /cambió/);
  const fresh = b0.proposal;
  assert.ok(fresh && typeof fresh.confirm_token === 'string' && fresh.confirm_token, 'tarjeta nueva firmada');
  assert.notEqual(fresh.id, card0.id);
  assert.deepEqual({ type: fresh.type, product_id: fresh.product_id, tipo: fresh.tipo, cantidad: fresh.cantidad, motivo: fresh.motivo, stock_actual: fresh.stock_actual, stock_despues: fresh.stock_despues, stock_de_servidor: fresh.stock_de_servidor },
    { type: 'ajuste', product_id: p0.product_id, tipo: 'entrada', cantidad: 2, motivo: card0.motivo, stock_actual: now0.current_stock_quantity, stock_despues: now0.current_stock_quantity + 2, stock_de_servidor: true });
  assert.deepEqual(stockOf(c.f, p0.product_id), now0, 'la base queda con el valor nuevo (sin aplicar nada viejo)');
  // La tarjeta nueva se aplica (200); si el stock vuelve a cambiar, vuelve a dar 409.
  const rf = await apply(fresh);
  assert.equal(rf.status, 200, JSON.stringify(await rf.clone().json()));
  // La vieja sigue sin poder aplicarse.
  assert.equal((await apply(card0)).status, 409);

  // El producto que NO cambió se aplica normal.
  const r1 = await apply(card1);
  assert.equal(r1.status, 200, JSON.stringify(await r1.clone().json()));
  assert.equal(card1.stock_actual, p1.current_stock_quantity);
});

// ---- Teléfono de #992 (fix/asist-ajuste-conteo-409-telefono @ df0712db): el MISMO confirmRemote (asistente-ui.js) y la MISMA puerta
// (asistente-core.js) que leen el 409 stock_changed. Esa rama no está en la base de #996, así que se usan copias EXACTAS de esos dos archivos
// (tests/asistente/fixtures/pr992-df0712db, sin cambios; el sha256 de abajo lo comprueba). Los archivos del POS de esta rama no se tocan.
const FX = new URL('./fixtures/pr992-df0712db/', import.meta.url);
const PHONE_SHA = { 'asistente-core.js': '66ef97820a8837134292c043b5b4b6be14cc13bc3072d25d0c5e70d0b7b1495a', 'asistente-ui.js': '050fd8b4d4bbcef2fc90e1b5a42da4f3547371612cded69b4ef0351432f7d29a' };
const phoneSrc = (n) => { const b = readFileSync(new URL(n, FX)); assert.equal(createHash('sha256').update(b).digest('hex'), PHONE_SHA[n], n + ' es la copia exacta de #992'); return b.toString('utf8'); };
const sliceFn = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
function phone(server) { // server: (path, body) -> Response del Worker real
  const CORE = phoneSrc('asistente-core.js'), UI = phoneSrc('asistente-ui.js');
  const win = {}; const ctx = vm.createContext({ window: win, setTimeout, clearTimeout, setInterval, clearInterval, Date, AbortController, console, Intl, URL, TextEncoder, TextDecoder });
  vm.runInContext(CORE, ctx); const C = win.NA_ASISTENTE_CORE;
  win.addEventListener = () => {}; win.removeEventListener = () => {};
  win.fetch = async (url, init) => { const r = await server(url, JSON.parse(init.body)); const d = await r.json(); return { status: r.status, ok: r.status < 300, json: async () => d }; };
  const ui = vm.createContext({ C, root: win, reqInit: (path, body) => ({ url: path, init: { method: 'POST', body: JSON.stringify(body) } }), setTimeout, Promise, Object, JSON, Error, Array });
  vm.runInContext(sliceFn(UI, '  async function post(', '  // Confirmación: el MISMO token') + sliceFn(UI, '  async function confirmRemote(', '  // ---------- Funciones existentes del POS'), ui);
  return { C, confirmRemote: ui.confirmRemote };
}

test('teléfono de #992: el 409 stock_changed de una tarjeta del lote se reconoce, muestra el message del servidor y toma la tarjeta nueva', async (t) => {
  const c = await canon(t), prods = tracked(c.f, 6), [p0] = prods;
  const say = chatter(c, prods);
  await say('sumale 2 a todo', T0, adjCalls(prods));
  await move(c.f, p0.product_id, 'entrada', 2); // (los datos sintéticos traen lotes vencidos: la salida usa los de esta entrada)
  const T1 = T0 + 25 * MIN, yes = await say('sí', T1), card0 = yes.body.proposals[0];
  const before = stockOf(c.f, p0.product_id); assert.equal(card0.stock_actual, before.current_stock_quantity);
  await move(c.f, p0.product_id, 'salida', 1); // venta entre el «sí» y «Aplicar»
  const after = stockOf(c.f, p0.product_id);
  const sent = [];
  const { C, confirmRemote } = phone((url, body) => { sent.push(url); return PA.assistantConfirmRoute(new Request('https://w.test' + url, { method: 'POST', body: JSON.stringify(body) }), ENV, OWNER, jsonR,
    { store: c.store, reader: c.reader, now: () => T1 + MIN, resolveRole: async () => 'owner', audit: async () => {} }); });
  const calls = [];
  const deps = { roles: () => ({ role: 'owner', isOwner: () => true }), online: () => true, confirm: confirmRemote, navigate: () => {},
    productos: () => prods.map((p) => ({ id: p.product_id, name: p.name, stock: 999, controla: true })),
    openStockMove: (id, tipo, cant, motivo) => { calls.push([id, tipo, cant, motivo]); return true; } };
  const g = C.createGate(deps), key = g.add(card0);
  const r = await g.execute(key, { confirmed: true });
  assert.deepEqual(sent, ['/auth/assistant/confirm']);
  assert.equal(r.ok, false); assert.equal(r.code, 'stock_changed');
  assert.ok(r.msg.startsWith('El stock de ' + p0.name + ' cambió de ' + before.current_stock_quantity + ' a ' + after.current_stock_quantity + ' desde que preparé la tarjeta.'), r.msg);
  assert.notEqual(r.msg, C.FRIENDLY.stock_changed[0]);
  assert.ok(r.fresh, 'toma la tarjeta nueva'); assert.notEqual(r.fresh.id, card0.id);
  assert.equal(r.fresh.stock_actual, after.current_stock_quantity); assert.equal(r.fresh.cantidad, 2); assert.equal(r.fresh.tipo, 'entrada');
  assert.equal(calls.length, 0, 'la tarjeta vieja no abre «Registrar movimiento»'); assert.equal(g.state(key), 'denied');
  const f = C.confirmFailureView(r, { type: 'ajuste' });
  assert.equal(f.kind, 'stale'); assert.equal(f.msg, r.msg); assert.equal(f.again, false);
  // La tarjeta nueva pasa por la misma puerta y el servidor la acepta: se abre «Registrar movimiento» con la entrada de 2.
  const k2 = g.add(r.fresh); assert.ok(k2); const r2 = await g.execute(k2, { confirmed: true });
  assert.equal(r2.ok, true, JSON.stringify(r2)); assert.deepEqual(calls, [[p0.product_id, 'entrada', 2, card0.motivo]]);
  assert.deepEqual(stockOf(c.f, p0.product_id), after, 'el servidor no movió stock: el movimiento lo guarda «Registrar movimiento»');
});

test('clave de la lista: internal:asst:lote: + hash = 59 caracteres; el flujo completo entra en el límite real de 60 de pos_settings', async (t) => {
  const c = await canon(t), prods = tracked(c.f, 12);
  const ddl = c.f.database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pos_settings'").get().sql;
  assert.match(ddl, /CHECK \(length\(key\) BETWEEN 1 AND 60\)/, 'el esquema de prueba es el de la migración 0024');
  const key = await PA.bulkKey(OWNER);
  assert.equal(key.length, 59); assert.equal(PA.BULK_PREFIX.length, 19); assert.match(key.slice(19), /^[0-9a-f]{40}$/);
  // El límite está vivo: 61 caracteres no entran.
  assert.throws(() => c.f.database.prepare("INSERT INTO pos_settings(key,value_json,revision,updated_at,updated_by) VALUES(?,'{}',1,'x','x')").run('k'.repeat(61)), /length\(key\)/);
  const old = { principalId: 'session:otro-aparato' };
  assert.equal(await PA.saveBulk(c.store, old, T0 - 40 * MIN, [{ name: 'proponer_ajuste_stock', arguments: '{"product_id":"' + prods[0].product_id + '","tipo":"entrada","cantidad":1}' }], true), true);
  const say = chatter(c, prods);
  const q = await say('sumale 2 a todo', T0, adjCalls(prods));
  assert.equal(q.body.reply, 'Son 12 productos; ¿le muestro la lista para revisarla antes?');
  const row = () => c.f.sql('SELECT key,value_json FROM pos_settings WHERE key=?', key);
  assert.equal(JSON.parse(row().value_json).calls.length, 12, 'la lista se guardó en pos_settings real');
  assert.equal(c.f.sql('SELECT count(*) n FROM pos_settings WHERE key=?', await PA.bulkKey(old)).n, 0, 'limpieza: la vencida se borró');
  const a = await say('sí', T0 + MIN); assert.equal(a.body.proposals.length, 5);
  const b = await say('siguientes', T0 + 2 * MIN); assert.equal(b.body.proposals.length, 5);
  const d = await say('siguientes', T0 + 3 * MIN); assert.equal(d.body.proposals.length, 2);
  assert.deepEqual([a, b, d].flatMap((x) => x.body.proposals.map((p) => p.product_id)), prods.map((p) => p.product_id));
  assert.deepEqual(JSON.parse(row().value_json), {}, 'lista terminada');
  const e = await say('siguientes', T0 + 4 * MIN); assert.equal(e.body.proposals.length, 0);
  // Otra lista (de cualquier aparato) 31 min después: la fila terminada «{}» también se limpia antes de guardar.
  await PA.saveBulk(c.store, { principalId: 'session:tercero' }, T0 + 35 * MIN, [{ name: 'x', arguments: '{}' }], true);
  assert.equal(row(), undefined);
});
