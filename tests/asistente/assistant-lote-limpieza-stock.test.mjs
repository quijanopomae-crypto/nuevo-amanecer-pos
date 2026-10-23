// Revisión de #996 (INV-057, lista pendiente en pos_settings), con la base canónica real (activeCanon) y pos_settings real:
// 1) Al guardar una lista nueva (de CUALQUIER aparato) se borran las listas vencidas (más de 30 min) de todos los aparatos; las vigentes
//    y las demás claves de pos_settings no se tocan. Así la tabla no crece con listas que nadie confirmó.
// 2) Las tarjetas de una lista guardada hace ~25 min llevan el stock leído en el servidor AL decir «sí»; si después de esa lectura cambia
//    el stock en la base (una salida desde otro aparato, como una venta), «Aplicar» devuelve 409 stale_stock y la base queda con el valor nuevo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('lista de hace 25 min: «sí» lleva el stock leído en ese momento; si cambia antes de «Aplicar» -> 409 stale_stock y la base queda igual', async (t) => {
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
  assert.equal(b0.error, 'stale_stock');
  assert.equal(b0.product_id, p0.product_id);
  assert.match(b0.message, /cambió/);
  assert.deepEqual(stockOf(c.f, p0.product_id), now0, 'la base queda con el valor nuevo (sin aplicar nada viejo)');

  // El producto que NO cambió se aplica normal.
  const r1 = await apply(card1);
  assert.equal(r1.status, 200, JSON.stringify(await r1.clone().json()));
  assert.equal(card1.stock_actual, p1.current_stock_quantity);
});
