// (22-10) «Ventas bajo costo» con el permiso de costos del #939: Admin y empleado nivel 3 con «costos y cambios» pasan;
// cualquier otro empleado (nivel 0..3 sin permiso, permiso en nivel < 3, fila vieja) recibe 403 sin leer nada ni llamar al modelo.
// El rol sale del MISMO camino que el chat: assistantAccess (pos_device_roles + fila interna del nivel) y seesOwnerData.
import test from 'node:test';
import assert from 'node:assert/strict';
import { belowCostRoute, BELOW_COST_PATH, BELOW_COST_DENIED } from '../../tools/cloudflare-lab/src/pos-assistant-below-cost.js';
import { levelKey, assistantAccess } from '../../tools/cloudflare-lab/src/pos-assistant-access.js';
import { seesOwnerData, storedValue, COSTS_ROLE } from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';
import { memoryReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';

const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const NOW = Date.parse('2026-10-22T17:00:00Z');
const ENV = { ASSISTANT_ENABLED: '1' }, KEY = { ...ENV, OHMYAGENT_API_KEY: 'clave-prueba-ohmyagent' };
const req = () => new Request('https://w.example' + BELOW_COST_PATH, { method: 'POST', body: '{}' });
const DATA = {
  products: [{ id: '12', nombre: 'Arroz Costeño 5 kg', costo: 20, precio: 24 }, { id: '45', nombre: 'Encargo Sra. Rosa Quispe', costo: 10, precio: 9 }],
  sales: [{ sale_id: 's1', created_at: '2026-10-21T15:00:00Z', metodo: 'efectivo', total_cents: 3800, cliente: 'Rosa Quispe', customer_id: 'c-77' }],
  saleItems: [{ sale_id: 's1', product_id: '12', quantity: 2, unit_price_cents: 1900, line_total_cents: 3800 }, { sale_id: 's1', product_id: '45', quantity: 1, unit_price_cents: 800, line_total_cents: 800 }]
};
// D1 de mentira: solo lo que lee assistantAccess (pos_device_roles y la fila interna del nivel). Cualquier escritura falla la prueba.
async function fakeDb(devices) {
  const roles = new Map(), settings = new Map();
  for (const [id, d] of Object.entries(devices)) { roles.set(id, d.pos_role); if (d.stored !== undefined) settings.set(await levelKey(id), JSON.stringify(d.stored)); }
  return { prepare(sql) {
    assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE/i);
    return { bind(...a) { return { async first() {
      if (/FROM pos_device_roles/.test(sql)) return roles.has(a[0]) ? { pos_role: roles.get(a[0]) } : null;
      if (/FROM pos_settings/.test(sql)) return settings.has(a[0]) ? { value_json: settings.get(a[0]) } : null;
      return null;
    } }; } };
  } };
}
const DEVICES = {
  'dev-admin': { pos_role: 'owner' },
  'dev-n3c': { pos_role: 'empleado', stored: storedValue(3, true) },   // nivel 3 + «costos y cambios»
  'dev-n3': { pos_role: 'empleado', stored: storedValue(3, false) },   // nivel 3 sin permiso
  'dev-n2c': { pos_role: 'empleado', stored: storedValue(2, true) },   // permiso guardado en nivel 2: no cuenta
  'dev-n1': { pos_role: 'empleado', stored: storedValue(1) },
  'dev-off': { pos_role: 'empleado', stored: storedValue(0, true) },
  'dev-viejo': { pos_role: 'empleado', stored: { level: 'consultas_documentos' } }, // fila de antes del #939
  'dev-sinnivel': { pos_role: 'empleado' }                                          // empleado sin fila de nivel
};
const counting = () => { const c = { read: 0, model: 0 }; const base = memoryReader(DATA);
  return { c, reader: { async products() { c.read++; return base.products(); }, async saleLines(p) { c.read++; return base.saleLines(p); } },
    fetch: async (u, init) => { c.model++; c.sent = String(init?.body || ''); return jsonR({ choices: [{ message: { content: 'Revise producto #12 y producto #45.' } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }); } }; };
const run = async (db, auth, env = ENV) => { const t = counting(); const r = await belowCostRoute(req(), env, auth, jsonR, { db, reader: t.reader, store: createMemoryUsageStore(), now: () => NOW, fetch: t.fetch }); return { r, t }; };

test('el guardia usa la función del #939 (seesOwnerData) y no un permiso nuevo', async () => {
  const db = await fakeDb(DEVICES);
  assert.equal(await assistantAccess(db, { principalId: 'dev-n3c', posRole: 'empleado' }), COSTS_ROLE);
  assert.ok(seesOwnerData(COSTS_ROLE)); assert.ok(seesOwnerData('owner'));
  for (const r of ['empleado:completo', 'empleado:consultas_documentos', 'empleado:consultas', 'empleado:off', 'sin_rol', 'empleado']) assert.ok(!seesOwnerData(r), r);
});

test('Admin: pasa con el informe', async () => {
  const { r, t } = await run(await fakeDb(DEVICES), { principalId: 'dev-admin', posRole: 'owner' });
  assert.equal(r.status, 200); const d = await r.json();
  assert.equal(d.ok, true); assert.equal(t.c.read, 2); assert.deepEqual(d.ventas.map((g) => g.id), ['12', '45']);
});

test('empleado nivel 3 con «costos y cambios»: pasa; nombres de productos en su pantalla, al modelo solo «producto #código»', async () => {
  const { r, t } = await run(await fakeDb(DEVICES), { principalId: 'dev-n3c', posRole: 'empleado' }, KEY);
  assert.equal(r.status, 200); const d = await r.json();
  assert.equal(d.source, 'modelo'); assert.equal(t.c.model, 1);
  assert.match(t.c.sent, /producto #12/); assert.match(t.c.sent, /producto #45/);
  for (const n of ['Rosa', 'Quispe', 'Encargo', 'Arroz', 'c-77']) assert.ok(!t.c.sent.includes(n), 'al modelo: ' + n);
  assert.equal(d.report, 'Revise Arroz Costeño 5 kg y Encargo Sra. Rosa Quispe.');
  assert.equal(d.perdida_total, 4); // 2 × (20 − 19) + 1 × (10 − 8)
});

test('empleado sin el permiso (cualquier nivel), permiso fuera del nivel 3, fila vieja o sin fila: 403 sin leer ni llamar al modelo', async () => {
  const db = await fakeDb(DEVICES);
  for (const id of ['dev-n3', 'dev-n2c', 'dev-n1', 'dev-off', 'dev-viejo', 'dev-sinnivel', 'dev-desconocido']) {
    const { r, t } = await run(db, { principalId: id, posRole: 'empleado' }, KEY);
    assert.equal(r.status, 403, id); assert.deepEqual(await r.json(), BELOW_COST_DENIED, id);
    assert.equal(t.c.read, 0, id); assert.equal(t.c.model, 0, id);
  }
});

test('sesión que se dice Admin en un aparato empleado, o Admin con sesión de empleado: 403', async () => {
  const db = await fakeDb(DEVICES);
  for (const auth of [{ principalId: 'dev-n3', posRole: 'owner' }, { principalId: 'dev-admin', posRole: 'empleado' }, { principalId: 'dev-n1', posRole: 'owner' }]) {
    const { r, t } = await run(db, auth, KEY);
    assert.equal(r.status, 403, auth.principalId); assert.equal(t.c.read, 0); assert.equal(t.c.model, 0);
  }
  // resolveRole 'owner' con sesión de empleado sigue cerrado (como antes).
  const t = counting(); const r = await belowCostRoute(req(), ENV, { principalId: 'x', posRole: 'empleado' }, jsonR, { resolveRole: async () => 'owner', reader: t.reader });
  assert.equal(r.status, 403); assert.equal(t.c.read, 0);
});
