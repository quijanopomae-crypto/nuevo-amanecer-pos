// #939 × #927: creditos_atrasados y caja_abierta son SOLO del Admin. Ningún nivel de empleado los tiene, tampoco el nivel 3 con
// permiso de costos y cambios: si los pide (por frase clara o porque el modelo llama a la herramienta) recibe 403 query_admin_only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_CAPABILITIES, COSTS_CAPABILITIES, COSTS_ROLE, LEVEL_NAMES, queryAllowed, capabilitiesFor, roleForLevel } from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';
import { assistantChatRoute, createMemoryUsageStore, toolsForRole, toProposal, employeeToolGuard, ADMIN_ONLY_QUERY_TYPES, EMPLOYEE_QUERY_TYPES } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const NOW = Date.parse('2026-10-22T17:00:00.000Z');
const ADMIN_ONLY = ['creditos_atrasados', 'caja_abierta'];
const EMPLOYEE_ROLES = [...LEVEL_NAMES.slice(1).map((n) => 'empleado:' + n), COSTS_ROLE];

test('ningún nivel (ni el 3 con costos) tiene creditos_atrasados ni caja_abierta; el Admin sí', () => {
  assert.equal(roleForLevel(3, true), COSTS_ROLE);
  for (const t of ADMIN_ONLY) {
    assert.ok(ADMIN_ONLY_QUERY_TYPES.includes(t), t);
    for (const caps of [...LEVEL_CAPABILITIES, COSTS_CAPABILITIES]) assert.ok(!caps.consultas.includes(t), t);
    assert.ok(!EMPLOYEE_QUERY_TYPES.includes(t), t);
    for (const role of EMPLOYEE_ROLES) assert.equal(queryAllowed(role, t), false, role + ' ' + t);
    assert.equal(queryAllowed('owner', t), true, t);
    assert.equal(capabilitiesFor('owner').consultas, 'todas');
  }
});

test('nivel 3 con costos: la herramienta no los ofrece; si el modelo los pide, query_admin_only (tarjeta y guard)', () => {
  for (const role of EMPLOYEE_ROLES) {
    const c = toolsForRole(role).find((t) => t.function.name === 'consultar');
    for (const t of ADMIN_ONLY) {
      assert.ok(!c || !JSON.stringify(c).includes(t), role + ' ' + t);
      const p = toProposal({ id: 'x', name: 'consultar', arguments: JSON.stringify({ tipo: t }) }, role, { products: [] }, 0);
      assert.equal(p.dropped, 'query_admin_only', role + ' ' + t);
      assert.equal(employeeToolGuard(role)({ name: 'consultar', arguments: JSON.stringify({ tipo: t }) }), 'query_admin_only', role + ' ' + t);
    }
  }
});

function route(text, role, tipo) {
  const cap = [], reads = [], store = createMemoryUsageStore();
  const reader = memoryReader({ customers: [{ id: 'C1', nombre: 'Rosa Quispe', dni: '45678912', tel: '987654321' }], credits: [{ cliente: 'C1', saldo: 30, vence: '2026-09-01' }], products: [] });
  const spy = Object.fromEntries(Object.entries(reader).map(([k, fn]) => [k, (...a) => { reads.push(k); return fn(...a); }]));
  const f = async (url, init) => { cap.push(String(init.body)); const n = cap.length;
    const msg = n === 1 ? { content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'consultar', arguments: JSON.stringify({ tipo }) } }] } : { content: 'Listo.' };
    return json({ choices: [{ message: msg }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); };
  return assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef', DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: 'empleado' }, json,
    { store, resolveRole: async () => role, fetch: f, reader: spy, audit: async () => {}, mockChunkMs: 0, now: () => NOW }).then(async (r) => ({ r, cap, reads }));
}

test('chat del nivel 3 con costos: 403 query_admin_only para creditos_atrasados y caja_abierta, sin leer la base', async () => {
  // Frase clara: corta antes del modelo.
  { const { r, cap, reads } = await route('¿Quiénes tienen créditos atrasados?', COSTS_ROLE, 'creditos_atrasados');
    assert.equal(r.status, 403); assert.equal((await r.json()).error, 'query_admin_only'); assert.equal(cap.length, 0); assert.equal(reads.length, 0); }
  // El modelo pide la herramienta igual: 403 sin leer la base.
  for (const tipo of ADMIN_ONLY) {
    const { r, reads } = await route('Dame un dato del negocio', COSTS_ROLE, tipo);
    assert.equal(r.status, 403, tipo); const body = await r.text(); assert.match(body, /query_admin_only/, tipo);
    assert.equal(reads.length, 0, tipo + ': sin leer la base'); assert.ok(!body.includes('Rosa Quispe'));
  }
});
