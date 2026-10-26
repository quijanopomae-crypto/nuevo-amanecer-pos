// GROKBOT 5 (pruebas y calidad), P0-B: idempotencia y recuperación de un LOTE de confirmaciones en el Worker REAL
// (assistantChatRoute + assistantConfirmRoute), con modelo FALSO (DeepSeek simulado), almacén en memoria y productos sintéticos.
// Nivel A (determinista, sin modelo real, sin red, sin base real). No toca CANON ni datos reales.
// Qué fija: un lote de 7 tarjetas con tope 5/min; el 429 NO gasta la tarjeta; un reenvío tras «ACK perdido» devuelve el MISMO
// operation_id (aunque la firma ya haya vencido); toques simultáneos = un solo efecto; rol perdido a mitad = 403 sin gastar nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, assistantConfirmRoute, createMemoryUsageStore, CONFIRM_TTL_MS, ASSISTANT_LIMITS } from '../../tools/cloudflare-lab/src/pos-assistant.js';

const jsonR = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef', DEEPSEEK_API_KEY: 'k' };
const OWN = { principalId: 'session:a5-dueno', posRole: 'owner' };
const T0 = Date.parse('2026-10-26T15:00:10.000Z'); // 10:00:10 Lima; 10 s dentro del minuto de reloj
const N = 7;
// Catálogo SINTÉTICO (nunca productos reales): PRUEBA A5 01..07
const PRODS = Array.from({ length: N }, (_, i) => ({ id: 'Q' + (i + 1), nombre: 'PRUEBA A5 ' + String(i + 1).padStart(2, '0'), precio: 4.5, costo: 2, stock: 3, controla: true }));
const reader = { products: async () => PRODS.map((p) => ({ ...p })) };
const tool = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const fakeModel = (calls) => async () => new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: calls } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
const payload = (tok) => JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString());

async function chat(calls, { store, now = T0, role = 'owner' } = {}) {
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: 'sube 7 unidades a cada PRUEBA A5', context: { products: PRODS } }) }), ENV, OWN, jsonR,
    { store, resolveRole: async () => role, fetch: fakeModel(calls), reader, audit: async () => {}, now: () => now });
  return { status: r.status, body: await r.json() };
}
function confirmer(store, audit) {
  return async (card, { now = T0, role = 'owner', auth = OWN } = {}) => {
    const { confirm_token, ...proposal } = card;
    const r = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token: confirm_token, proposal }) }), ENV, auth, jsonR,
      { store, resolveRole: async () => role, reader, audit: async (_db, rows) => { audit.push(...rows); }, now: () => now });
    return { status: r.status, body: await r.json() };
  };
}
const usedCount = (store) => [...store._map.entries()].filter(([k, v]) => /:u:/.test(k) && v.value?.op).length;
async function lote(store) {
  const calls = PRODS.map((p, i) => tool('proponer_ajuste_stock', { product_id: p.id, tipo: 'entrada', cantidad: 7, motivo: 'Ajuste de inventario' }, 'c' + i));
  const { status, body } = await chat(calls, { store });
  assert.equal(status, 200, JSON.stringify(body));
  const cards = body.proposals.filter((p) => p.type === 'ajuste');
  assert.equal(cards.length, N, 'una tarjeta firmada por producto (no una tarjeta masiva)');
  return cards;
}

test('A5-B1) lote de 7 con tope 5/min: 5 pasan, la 6.ª y 7.ª reciben 429 SIN gastar su firma; al minuto siguiente pasan con la MISMA firma', async () => {
  assert.equal(ASSISTANT_LIMITS.confirmsPerMinute, 5, 'el tope por defecto documentado en el informe');
  const store = createMemoryUsageStore(), audit = [], confirm = confirmer(store, audit), cards = await lote(store);
  const first = [];
  for (const c of cards) first.push(await confirm(c));
  assert.deepEqual(first.map((r) => r.status), [200, 200, 200, 200, 200, 429, 429]);
  assert.ok(first.slice(5).every((r) => r.body.error === 'rate_limited' && r.body.retry_after_s >= 1 && r.body.retry_after_s <= 60));
  assert.equal(usedCount(store), 5, 'el 429 no marca la tarjeta como usada');
  const later = T0 + 60000;
  const second = [await confirm(cards[5], { now: later }), await confirm(cards[6], { now: later })];
  assert.deepEqual(second.map((r) => r.status), [200, 200]);
  const ops = [...first.slice(0, 5), ...second].map((r) => r.body.operation_id);
  assert.equal(new Set(ops).size, N, 'un operation_id distinto por línea');
  assert.deepEqual(ops, cards.map((c) => payload(c.confirm_token).op), 'cada línea usa el op de SU firma');
  assert.equal(audit.filter((a) => a.outcome === 'confirmed').length, N, 'bitácora: exactamente 7 confirmadas');
  assert.ok(audit.filter((a) => a.outcome === 'rejected:rate_limited').every((a) => a.aggregate === true));
});

test('A5-B2) «ACK perdido»: reenviar las 7 con el mismo cuerpo devuelve el MISMO operation_id (replay) y no suma efectos, aunque la firma ya venció', async () => {
  const store = createMemoryUsageStore(), audit = [], confirm = confirmer(store, audit), cards = await lote(store);
  const ops = [];
  for (let i = 0; i < N; i++) ops.push((await confirm(cards[i], { now: T0 + Math.floor(i / 5) * 60000 })).body.operation_id);
  const late = T0 + CONFIRM_TTL_MS + 60000; // ya pasó la validez de 5 min
  for (let i = 0; i < N; i++) {
    const r = await confirm(cards[i], { now: late });
    assert.equal(r.status, 200, 'una firma YA usada se revisa antes que la vencida: no es 410');
    assert.equal(r.body.replay, true); assert.equal(r.body.already_confirmed, true); assert.equal(r.body.operation_id, ops[i]);
  }
  assert.equal(audit.filter((a) => a.outcome === 'confirmed').length, N, 'los reenvíos no agregan confirmaciones a la bitácora');
  assert.equal(usedCount(store), N);
});

test('A5-B3) doble/triple toque simultáneo sobre la MISMA tarjeta: un solo efecto y el mismo operation_id para todos', async () => {
  const store = createMemoryUsageStore(), audit = [], confirm = confirmer(store, audit), [card] = await lote(store);
  const rs = await Promise.all([confirm(card), confirm(card), confirm(card)]);
  assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.body)));
  assert.equal(rs.filter((r) => !r.body.already_confirmed).length, 1, 'solo uno es la confirmación original');
  assert.equal(new Set(rs.map((r) => r.body.operation_id)).size, 1);
  assert.equal(audit.filter((a) => a.outcome === 'confirmed').length, 1);
});

test('A5-B4) firma vencida y NO usada: 410 confirm_expired, sin gastar ni anotar confirmación (el teléfono debe pedirla otra vez)', async () => {
  const store = createMemoryUsageStore(), audit = [], confirm = confirmer(store, audit), [card] = await lote(store);
  const r = await confirm(card, { now: T0 + CONFIRM_TTL_MS + 1 });
  assert.equal(r.status, 410); assert.equal(r.body.error, 'confirm_expired');
  assert.equal(usedCount(store), 0); assert.equal(audit.filter((a) => a.outcome === 'confirmed').length, 0);
});

test('A5-B5) fallo parcial por permiso: si el rol cambia a mitad del lote (Admin -> empleado), las siguientes reciben 403 y NO se gastan', async () => {
  const store = createMemoryUsageStore(), audit = [], confirm = confirmer(store, audit), cards = await lote(store);
  const a = await confirm(cards[0]), b = await confirm(cards[1]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  for (const role of ['empleado:consultas', 'empleado:off', 'sin_rol']) {
    const r = await confirm(cards[2], { role });
    assert.equal(r.status, 403, role + ': ' + JSON.stringify(r.body));
  }
  assert.equal(usedCount(store), 2, 'solo las 2 primeras quedaron usadas');
  // el Admin vuelve: la 3.ª sigue válida (no se gastó con los 403)
  assert.equal((await confirm(cards[2])).status, 200);
});

test('A5-B6) otro aparato con la tarjeta del Admin: 403 other_device, sin propuesta ni operation_id, y la tarjeta sigue sin gastar', async () => {
  const store = createMemoryUsageStore(), audit = [], confirm = confirmer(store, audit), [card] = await lote(store);
  const r = await confirm(card, { auth: { principalId: 'session:a5-otro', posRole: 'owner' } });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'other_device');
  assert.ok(!('operation_id' in r.body) && !('proposal' in r.body));
  assert.equal(usedCount(store), 0);
  assert.equal((await confirm(card)).status, 200, 'el aparato correcto la puede usar');
  const again = await confirm(card, { auth: { principalId: 'session:a5-otro', posRole: 'owner' } });
  assert.deepEqual([again.status, again.body.error, again.body.confirmed], [403, 'other_device', true], 'ya confirmada: el otro aparato solo sabe que ya se hizo');
});

test('A5-B7) el mismo cambio propuesto dos veces en una respuesta del modelo = UNA tarjeta (prevención de duplicados en origen)', async () => {
  const store = createMemoryUsageStore();
  const dup = [tool('proponer_ajuste_stock', { product_id: 'Q1', tipo: 'entrada', cantidad: 7, motivo: 'Ajuste de inventario' }, 'd1'),
    tool('proponer_ajuste_stock', { product_id: 'Q1', tipo: 'entrada', cantidad: 9, motivo: 'Ajuste de inventario' }, 'd2'),
    tool('proponer_cambio_precio', { product_id: 'Q1', precio_nuevo: 4.8 }, 'd3'), tool('proponer_cambio_precio', { product_id: 'Q1', precio_nuevo: 4.9 }, 'd4')];
  const { body } = await chat(dup, { store });
  assert.equal(body.proposals.filter((p) => p.type === 'ajuste').length, 1);
  assert.equal(body.proposals.filter((p) => p.type === 'precio').length, 1);
  assert.equal(body.proposals.find((p) => p.type === 'ajuste').cantidad, 7, 'queda la PRIMERA');
  assert.ok(body.dropped.filter((d) => d.reason === 'duplicate_action').length >= 2);
});
