// Cambios masivos (una tarjeta que cambia MÁS DE UN producto con un solo «Aplicar», p. ej. «Cambiar precio de 408 productos a S/ 1.00»):
// solo el Admin (capacidad cambios_masivos). Un empleado, aunque sea nivel 3 con «costos y cambios», recibe una tarjeta por producto.
// Base real del laboratorio (activeCanon, node:sqlite), sin migraciones nuevas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCanon } from '../cloud-sync/canon-browser-harness.mjs';
import { LEVEL_CAPABILITIES, ADMIN_CAPABILITIES, COSTS_CAPABILITIES, COSTS_ROLE, levelCan, bulkAllowed, isBulkProposal, proposalProductCount, dropBulkProposals, BULK_ADMIN_ONLY_TEXT, levelMap }
  from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';
import { LEVELS_PATH } from '../../tools/cloudflare-lab/src/pos-assistant-levels-route.js';
import { issueConfirmToken } from '../../tools/cloudflare-lab/src/pos-assistant.js';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const PRODUCTS = [{ id: '00003', nombre: 'Synthetic 00003', precio: 12.34, costo: 0.29, stock: 5 }, { id: '00004', nombre: 'Synthetic 00004', precio: 3.5, costo: 1.2, stock: 5 },
  { id: '00005', nombre: 'Synthetic 00005', precio: 7, costo: 2, stock: 5 }];

async function setup(t) {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql', '0025_pos_reviews_pin_failures.sql'] });
  Object.assign(f.env, { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, ASSISTANT_DEMO: '1', DEEPSEEK_API_KEY: 'k-prueba' });
  f.addDevice('dueno', 'writer', 'active', 'tok-dueno'); f.addDevice('emp', 'writer', 'active', 'tok-emp');
  const at = new Date().toISOString();
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,label,created_by,created_at) VALUES('session:dueno','owner','Dueño','test',?)", at);
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,label,created_by,created_at) VALUES('session:emp','empleado','Caja 2','session:dueno',?)", at);
  const call = async (tok, path, body) => {
    const r = await f.fetch('http://localhost' + path, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const raw = await r.text(); let b = null; try { b = JSON.parse(raw); } catch { b = raw; }
    return { status: r.status, body: b, raw };
  };
  // Modelo simulado: devuelve las llamadas a herramientas que diga «next».
  const real = globalThis.fetch; let next = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: next.map((a, i) => ({ id: 'c' + i, type: 'function', function: { name: a.name, arguments: JSON.stringify(a.args) } })) } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { globalThis.fetch = real; });
  const chat = (tok, text, calls) => { next = calls; return call(tok, '/auth/assistant/chat', { text, context: { products: PRODUCTS } }); };
  return { f, call, chat };
}
const PRICE_ALL = PRODUCTS.map((p) => ({ name: 'proponer_cambio_precio', args: { product_id: p.id, precio_nuevo: 1 } }));

test('mapa: cambios_masivos solo para el Admin; ningún nivel de empleado ni el permiso «costos y cambios» lo tiene', () => {
  assert.equal(ADMIN_CAPABILITIES.cambios_masivos, true);
  for (const c of LEVEL_CAPABILITIES) assert.equal(c.cambios_masivos, false);
  assert.equal(COSTS_CAPABILITIES.cambios_masivos, false); assert.equal(COSTS_CAPABILITIES.cambios, true, 'sigue con sus tarjetas de un producto');
  assert.deepEqual(['owner', COSTS_ROLE, 'empleado:completo', 'empleado:consultas_documentos', 'empleado:consultas', 'empleado:off', 'sin_rol'].map(bulkAllowed), [true, false, false, false, false, false, false]);
  assert.equal(levelCan(COSTS_ROLE, 'cambios_masivos'), false);
  assert.equal(levelMap().permiso_costos.capacidades.cambios_masivos, false, 'Configuración lo muestra igual');
});

test('qué es una tarjeta masiva: más de un producto en UNA tarjeta (por lista o por total declarado); la compra no cuenta', () => {
  assert.equal(isBulkProposal({ type: 'precio', product_id: '00003' }), false);
  assert.equal(isBulkProposal({ type: 'precio', product_id: '00003', product_ids: ['00003'] }), false, 'el mismo producto dos veces = uno');
  assert.equal(isBulkProposal({ type: 'precio_masivo', product_ids: ['00003', '00004'] }), true);
  assert.equal(isBulkProposal({ type: 'precio_masivo', productos: [{ product_id: '1' }, { id: '2' }] }), true);
  assert.equal(proposalProductCount({ type: 'precio_masivo', cantidad_productos: 408, ejemplos: [{ product_id: '1' }] }), 408, 'resumen con 408 y algunos ejemplos');
  assert.equal(isBulkProposal({ type: 'ajuste_masivo', masivo: true }), true);
  for (const type of ['compra', 'documento', 'consulta', 'pasos']) assert.equal(isBulkProposal({ type, lineas: [{ product_id: '1' }, { product_id: '2' }], productos: ['1', '2'] }), false, type);
  for (const bad of [null, undefined, 'x', 3]) assert.equal(isBulkProposal(bad), false);
});

test('filtro: al empleado se le quita SOLO la tarjeta masiva (bulk_admin_only); las de un producto quedan; el Admin no pierde nada', () => {
  const mk = () => [{ type: 'precio', product_id: '1' }, { type: 'precio_masivo', product_ids: ['1', '2', '3'], _call: { name: 'proponer_cambio_precio' } }, { type: 'ajuste', product_id: '2' }, { type: 'compra', lineas: [{ product_id: '1' }, { product_id: '2' }] }];
  for (const role of [COSTS_ROLE, 'empleado:completo']) {
    const ps = mk(), dropped = [];
    assert.equal(dropBulkProposals(role, ps, dropped), 1, role);
    assert.deepEqual(ps.map((p) => p.type), ['precio', 'ajuste', 'compra']);
    assert.deepEqual(dropped, [{ dropped: 'bulk_admin_only', tool: 'proponer_cambio_precio' }]);
  }
  const ps = mk(), dropped = [];
  assert.equal(dropBulkProposals('owner', ps, dropped), 0); assert.equal(ps.length, 4); assert.deepEqual(dropped, []);
  assert.match(BULK_ADMIN_ONLY_TEXT, /Admin/); assert.ok(!/403|error|bulk|token/i.test(BULK_ADMIN_ONLY_TEXT), 'frase simple, sin palabras técnicas');
});

test('chat: empleado nivel 3 + «costos y cambios» que pide cambiar varios precios recibe UNA tarjeta por producto, cada una con su «Aplicar»', async (t) => {
  const { call, chat } = await setup(t);
  assert.equal((await call('tok-dueno', LEVELS_PATH, { device_id: 'session:emp', nivel: 3, costos: true })).status, 200);
  const r = await chat('tok-emp', 'cambia todos los precios a 1 sol', PRICE_ALL); assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.role, COSTS_ROLE);
  const cards = r.body.proposals.filter((p) => p.type === 'precio');
  assert.deepEqual(cards.map((p) => p.product_id).sort(), ['00003', '00004', '00005']);
  for (const c of cards) { assert.ok(c.confirm_token, 'cada una con su token'); assert.equal(isBulkProposal(c), false); }
  assert.ok(!r.body.dropped.some((d) => d.reason === 'bulk_admin_only'));
  const own = await chat('tok-dueno', 'cambia todos los precios a 1 sol', PRICE_ALL); assert.equal(own.status, 200, own.raw);
  assert.equal(own.body.proposals.filter((p) => p.type === 'precio').length, 3, 'el Admin igual');
});

test('confirmar: una tarjeta masiva firmada para el empleado (aunque la firma sea válida) recibe 403 bulk_admin_only; la de un producto pasa la barrera', async (t) => {
  const { call } = await setup(t);
  assert.equal((await call('tok-dueno', LEVELS_PATH, { device_id: 'session:emp', nivel: 3, costos: true })).status, 200);
  const now = Date.now();
  const bulk = { id: 'pid-bulk-1', type: 'precio', needsConfirm: true, title: 'Cambiar precio de 3 productos a S/ 1.00', product_id: '00003', product_ids: ['00003', '00004', '00005'], precio_nuevo: 1, cantidad_productos: 3 };
  const tok = await issueConfirmToken(bulk, COSTS_ROLE, { principalId: 'session:emp' }, SECRET, now);
  const r = await call('tok-emp', '/auth/assistant/confirm', { token: tok, proposal: bulk });
  assert.equal(r.status, 403, r.raw); assert.deepEqual(r.body, { error: 'bulk_admin_only', message: BULK_ADMIN_ONLY_TEXT });
  // Misma tarjeta para el Admin: la barrera de masivos no la frena (sigue a las demás revisiones de siempre).
  const tokA = await issueConfirmToken(bulk, 'owner', { principalId: 'session:dueno' }, SECRET, now);
  const a = await call('tok-dueno', '/auth/assistant/confirm', { token: tokA, proposal: bulk });
  assert.notEqual(a.body?.error, 'bulk_admin_only', a.raw);
});
