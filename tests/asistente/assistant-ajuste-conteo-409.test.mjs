// Auditoría 500, VE-009: una corrección de conteo armada con un stock viejo no se aplica a ciegas.
// Base real del laboratorio (activeCanon) y Worker real; DeepSeek no se llama (modo demostración).
import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCanon } from '../cloud-sync/canon-browser-harness.mjs';
import { staleCountCard, STALE_COUNT_MOTIVO } from '../../tools/cloudflare-lab/src/pos-assistant.js';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
async function setup(t) {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql', '0025_pos_reviews_pin_failures.sql'] });
  Object.assign(f.env, { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, ASSISTANT_DEMO: '1' });
  f.addDevice('dueno', 'writer', 'active', 'tok-dueno');
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,label,created_by,created_at) VALUES('session:dueno','owner','Dueño','test',?)", new Date().toISOString());
  const call = (path, body) => f.fetch('http://localhost' + path, { method: 'POST', headers: { authorization: 'Bearer tok-dueno', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // Simula «otro aparato cambió el stock»: en la prueba se quitan los candados de UPDATE de products (en la app real el stock
  // cambia por una venta o un inventory.adjust autorizados; aquí solo importa que el número de la base ya no es el de la tarjeta).
  for (const r of f.all("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='products' AND sql LIKE '%UPDATE ON products%'")) f.database.exec('DROP TRIGGER ' + r.name);
  const setStock = (n) => f.exec("UPDATE products SET current_stock_quantity=? WHERE product_id='00003'", n);
  const card = async (text, stock) => { const r = await call('/auth/assistant/chat', { text, context: { products: [{ id: '00003', nombre: 'Synthetic 00003', precio: 5, costo: 1, stock }] } });
    const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); const c = b.proposals.find((p) => p.type === 'ajuste'); assert.ok(c, JSON.stringify(b)); return c; };
  const confirm = async (p) => { const { confirm_token, ...proposal } = p; const r = await call('/auth/assistant/confirm', { token: confirm_token, proposal }); return { status: r.status, body: await r.json() }; };
  return { setStock, card, confirm };
}

test('VE-009: conteo con el mismo stock en la base -> 200 como antes', async (t) => {
  const { setStock, card, confirm } = await setup(t);
  setStock(12);
  const c = await card('ajuste de 3 Synthetic 00003', 12);
  assert.equal(c.motivo, STALE_COUNT_MOTIVO); assert.equal(c.stock_actual, 12); assert.equal(c.stock_despues, 15);
  const r = await confirm(c); assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('VE-009: otro aparato cambió el stock -> 409 stock_changed con tarjeta nueva al mismo número contado; la nueva confirma 200 y la vieja sigue en 409', async (t) => {
  const { setStock, card, confirm } = await setup(t);
  setStock(12);
  const c = await card('ajuste de 3 Synthetic 00003', 12); // conté 15, el sistema decía 12
  setStock(10); // otro aparato vendió 2
  const r = await confirm(c);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'stock_changed');
  assert.deepEqual([r.body.stock_antes, r.body.stock_ahora, r.body.objetivo], [12, 10, 15]);
  const n = r.body.proposal; assert.ok(n && n.confirm_token);
  assert.deepEqual([n.tipo, n.cantidad, n.stock_actual, n.stock_despues, n.motivo], ['entrada', 5, 10, 15, STALE_COUNT_MOTIVO]);
  assert.match(r.body.message, /cambió de 12 a 10/); assert.match(r.body.message, /entrada de 5/);
  assert.equal((await confirm(n)).status, 200);
  assert.equal((await confirm(c)).status, 409, 'la tarjeta vieja no se aplica');
});

test('VE-009: el cambio pasó el número contado -> la tarjeta nueva es una salida', async (t) => {
  const { setStock, card, confirm } = await setup(t);
  setStock(12);
  const c = await card('ajuste de 3 Synthetic 00003', 12); // objetivo 15
  setStock(18); // otro aparato registró una compra de 6
  const r = await confirm(c); assert.equal(r.status, 409);
  assert.deepEqual([r.body.proposal.tipo, r.body.proposal.cantidad, r.body.proposal.stock_despues], ['salida', 3, 15]);
});

test('VE-009: si el stock ya llegó al número contado, 409 sin tarjeta y lo dice', async (t) => {
  const { setStock, card, confirm } = await setup(t);
  setStock(12);
  const c = await card('ajuste de 3 Synthetic 00003', 12);
  setStock(15);
  const r = await confirm(c); assert.equal(r.status, 409); assert.equal(r.body.proposal, null); assert.match(r.body.message, /No hace falta el ajuste/);
});

test('VE-009: entradas y salidas simples (merma, vencido, devolución) siguen igual aunque el stock haya cambiado', async (t) => {
  const { setStock, card, confirm } = await setup(t);
  for (const text of ['merma de 2 Synthetic 00003', 'vencido 1 Synthetic 00003', 'devolucion de 1 Synthetic 00003']) {
    setStock(12);
    const c = await card(text, 12);
    assert.notEqual(c.motivo, STALE_COUNT_MOTIVO);
    setStock(9);
    const r = await confirm(c); assert.equal(r.status, 200, text + ' ' + JSON.stringify(r.body));
  }
});

test('staleCountCard: sin stock en la tarjeta o en la base, o con otro motivo -> null (no bloquea)', async () => {
  const auth = { principalId: 'session:dueno' };
  const card = { id: 'p1', type: 'ajuste', motivo: STALE_COUNT_MOTIVO, tipo: 'entrada', cantidad: 3, stock_actual: 12, stock_despues: 15, nombre: 'X', product_id: '1' };
  assert.equal(await staleCountCard({ ...card, stock_actual: null }, { stock: 10 }, 'owner', auth, SECRET, 0), null);
  assert.equal(await staleCountCard(card, { stock: null }, 'owner', auth, SECRET, 0), null);
  assert.equal(await staleCountCard({ ...card, motivo: 'Merma / daño' }, { stock: 10 }, 'owner', auth, SECRET, 0), null);
  assert.equal(await staleCountCard(card, { stock: 12.0004 }, 'owner', auth, SECRET, 0), null, 'redondeo a 3 decimales');
  const big = await staleCountCard(card, { stock: -1e9 }, 'owner', auth, SECRET, 0); assert.equal(big.proposal, null); assert.match(big.message, /límite/);
});
