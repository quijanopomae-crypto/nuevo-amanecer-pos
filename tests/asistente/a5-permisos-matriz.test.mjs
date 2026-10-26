// GROKBOT 5 (pruebas y calidad), P0 permisos: «el servidor decide» — matriz rol × herramienta × consulta × costos, contra el Worker REAL
// (toProposal, toolsForRole, assistantChatRoute, assistantConfirmRoute) con modelo FALSO y datos SINTÉTICOS. Nivel A (sin modelo real ni red).
// Es una MATRIZ DORADA: si alguien amplía un permiso por accidente (o lo recorta), falla aquí con el nombre del rol y de la consulta.
// Complementa assistant-levels*.test.mjs, assistant-employee-*.test.mjs y assistant-seguridad-500.test.mjs (no los repite: cruza todo en una tabla).
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolsForRole, toProposal, assistantChatRoute, assistantConfirmRoute, createMemoryUsageStore, employeeQueryResult } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { QUERY_TYPES, runAssistantQuery, memoryReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const NOW = Date.parse('2026-10-26T20:00:00.000Z');
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef', DEEPSEEK_API_KEY: 'k' };
const jr = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const names = (role) => (toolsForRole(role) || []).map((t) => t.function?.name || t.name);
const allowedQueries = (role) => QUERY_TYPES.filter((tipo) => !toProposal({ name: 'consultar', arguments: { tipo, cliente_id: 'C1' } }, role, { products: [] }, 1).dropped);

// Lo que dice la tabla de niveles (pos-assistant-levels.js, cabecera) escrito a mano, NO calculado desde el código.
const EXPECT = {
  owner: { tools: ['explicar_pasos', 'consultar', 'proponer_ajuste_stock', 'preparar_compra', 'leer_factura_compra', 'proponer_cambio_precio', 'proponer_producto_nuevo', 'preparar_documento', 'configurar_app', 'configurar_nivel'], queries: [...QUERY_TYPES] },
  'empleado:off': { tools: [], queries: [] },
  'empleado:consultas': { tools: ['explicar_pasos', 'consultar'], queries: ['stock_producto', 'bajo_stock'] },
  'empleado:consultas_documentos': { tools: ['explicar_pasos', 'consultar', 'preparar_documento'], queries: ['stock_producto', 'bajo_stock'] },
  'empleado:completo': { tools: ['explicar_pasos', 'consultar', 'preparar_documento'], queries: ['stock_producto', 'bajo_stock'] },
  'empleado:completo+costos': { tools: ['explicar_pasos', 'consultar', 'proponer_ajuste_stock', 'preparar_compra', 'proponer_cambio_precio', 'proponer_producto_nuevo', 'preparar_documento', 'configurar_app'],
    queries: ['stock_producto', 'bajo_stock', 'sin_costo', 'ventas_periodo', 'top_productos', 'compras_recientes', 'ganancia', 'productos_sin_ventas', 'ventas_por_hora'] }
};
const NO_ROLE = ['sin_rol', '', 'admin', 'OWNER', 'Owner', 'empleado', 'empleado:', 'empleado:inexistente', 'empleado:completo+costos+x', undefined, null];

test('A5-E1) herramientas por rol: tabla exacta (el empleado nunca recibe herramientas de cambio salvo nivel 3 + «costos y cambios»)', () => {
  for (const [role, e] of Object.entries(EXPECT)) assert.deepEqual([...names(role)].sort(), [...e.tools].sort(), role);
  for (const r of NO_ROLE) assert.deepEqual(names(r), [], 'rol no reconocido = cerrado: ' + String(r));
});

test('A5-E2) consultas por rol: tabla exacta; los resúmenes, créditos, caja y sugerencias de compra son SOLO del Admin (aun con «costos y cambios»)', () => {
  for (const [role, e] of Object.entries(EXPECT)) assert.deepEqual(allowedQueries(role).sort(), [...e.queries].sort(), role);
  for (const r of NO_ROLE) assert.deepEqual(allowedQueries(r), [], 'rol no reconocido = cerrado: ' + String(r));
  const soloAdmin = ['resumen_dia', 'resumen_mes', 'deudas_clientes', 'creditos_atrasados', 'caja_abierta', 'sugerencias_compra', 'deuda_cliente'];
  for (const role of Object.keys(EXPECT).filter((r) => r !== 'owner')) for (const q of soloAdmin) assert.ok(!allowedQueries(role).includes(q), role + ' no debe poder ' + q);
});

test('A5-E3) cambios (precio, stock, producto nuevo, compra): solo Admin y nivel 3 + costos; los demás roles reciben la herramienta DESCARTADA', () => {
  const calls = [['proponer_cambio_precio', { product_id: 'Q1', precio_nuevo: 5 }], ['proponer_ajuste_stock', { product_id: 'Q1', tipo: 'entrada', cantidad: 2 }],
    ['proponer_producto_nuevo', { nombre: 'PRUEBA NUEVO', precio: 3 }], ['preparar_compra', { lineas: [{ product_id: 'Q1', cantidad: 2, costo_unitario: 1 }] }]];
  const ctx = { products: [{ id: 'Q1', nombre: 'PRUEBA A5 01', precio: 4.5, costo: 2, stock: 3, controla: true }] };
  for (const role of [...Object.keys(EXPECT), ...NO_ROLE]) for (const [name, args] of calls) {
    const x = toProposal({ name, arguments: args }, role, ctx, 1);
    const puede = role === 'owner' || role === 'empleado:completo+costos';
    assert.equal(!x.dropped, puede, role + ' / ' + name + ' -> ' + JSON.stringify(x.dropped));
  }
});

async function chat(role, calls, { body = {}, products, onFetch } = {}) {
  const PR = products || [{ id: 'Q1', nombre: 'PRUEBA A5 01', precio: 4.5, costo: 3.18, stock: 3, min: 5, controla: true }];
  const seen = []; let n = 0;
  const fetch = async (_u, init) => { seen.push(String(init.body)); if (onFetch) onFetch(); return new Response(JSON.stringify({ choices: [{ message: n++ === 0 && calls ? { content: '', tool_calls: calls } : { content: 'listo' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: '¿cuánto me cuesta y cuánto gano con la PRUEBA A5 01?', context: { products: PR, role: 'owner' }, ...body }) }), ENV,
    { principalId: 'session:a5-emp', posRole: 'owner' }, jr, { store: createMemoryUsageStore(), resolveRole: async () => role, fetch, reader: memoryReader({ products: PR, sales: [], saleItems: [] }), audit: async () => {}, now: () => NOW });
  return { status: r.status, body: await r.json(), seen };
}
const tc = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('A5-E4) el cliente NO elige el rol: `role:"owner"`/`pos_role:"owner"` en el cuerpo y en el contexto se ignoran; el empleado sin costos NO manda el costo al modelo', async () => {
  for (const role of ['empleado:consultas', 'empleado:consultas_documentos', 'empleado:completo']) {
    const r = await chat(role, null, { body: { role: 'owner', pos_role: 'owner', admin: true, pin: '1234' } });
    assert.equal(r.status, 200, role);
    assert.equal(r.body.role, role, 'el rol de la respuesta es el del servidor');
    assert.ok(r.seen.length >= 1);
    for (const s of r.seen) { assert.ok(!s.includes('3.18'), role + ': el costo salió hacia el modelo'); assert.ok(!/"costo"\s*:\s*3/.test(s), role); assert.ok(!s.includes('1234'), role + ': PIN al modelo'); }
  }
});

test('A5-E5) empleado sin costos que pide ganancia: 403 costs_admin_only (decide el servidor aunque el modelo la pida) y NINGUNA tarjeta de cambio sale', async () => {
  const r = await chat('empleado:consultas', [tc('consultar', { tipo: 'ganancia' }, '1'), tc('proponer_cambio_precio', { product_id: 'Q1', precio_nuevo: 5 }, '2')]);
  assert.equal(r.status, 403); assert.equal(r.body.error, 'costs_admin_only'); assert.ok(!('proposals' in r.body) || r.body.proposals.length === 0);
  const r2 = await chat('empleado:completo', [tc('consultar', { tipo: 'resumen_dia' }, '1')]);
  assert.equal(r2.status, 403); assert.match(r2.body.error, /summary_admin_only|forbidden_summary/);
});

test('A5-E6) revocación: el rol se lee del servidor en CADA pedido; al quitar el permiso, el siguiente chat es 403 assistant_off SIN llamar al modelo', async () => {
  let role = 'empleado:completo';
  const store = createMemoryUsageStore(); let fetched = 0;
  const call = async () => assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: 'stock de la PRUEBA A5 01', context: { products: [] } }) }), ENV, { principalId: 'session:a5-emp', posRole: 'empleado' }, jr,
    { store, resolveRole: async () => role, fetch: async () => { fetched++; return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })); }, reader: memoryReader({ products: [] }), audit: async () => {}, now: () => NOW });
  assert.equal((await call()).status, 200); const before = fetched;
  role = 'empleado:off'; const r = await call();
  assert.equal(r.status, 403); assert.equal((await r.json()).error, 'assistant_off'); assert.equal(fetched, before, 'sin llamar al modelo');
});

test('A5-E7) confirmar: una firma de Admin presentada con cualquier rol de empleado (también nivel 3 + costos) es 403 y NO se gasta', async () => {
  const PR = [{ id: 'Q1', nombre: 'PRUEBA A5 01', precio: 4.5, costo: 2, stock: 3, controla: true }];
  const store = createMemoryUsageStore();
  const c = await chat('owner', [tc('proponer_cambio_precio', { product_id: 'Q1', precio_nuevo: 4.8 }, '1')], { products: PR });
  const card = c.body.proposals.find((p) => p.type === 'precio'); assert.ok(card);
  const { confirm_token, ...proposal } = card;
  const used = () => [...store._map.entries()].filter(([k, v]) => /:u:/.test(k) && v.value?.op).length;
  const go = async (role) => assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token: confirm_token, proposal }) }), ENV, { principalId: 'session:a5-emp', posRole: 'owner' }, jr,
    { store, resolveRole: async () => role, reader: memoryReader({ products: PR }), audit: async () => {}, now: () => NOW });
  // el token lo firmó OTRO store de chat; el aparato es el mismo (principalId) a propósito para llegar a la puerta de rol
  for (const role of ['empleado:consultas', 'empleado:completo', 'empleado:completo+costos', 'sin_rol']) { const r = await go(role); assert.equal(r.status, 403, role + ' ' + JSON.stringify(await r.json())); }
  assert.equal(used(), 0);
});

test('A5-E8) lo que ve el empleado de una consulta de stock: sin columna ni campos de costo; el Admin los conserva', async () => {
  const PR = [{ id: 'Q1', nombre: 'PRUEBA A5 01', precio: 4.5, costo: 3.18, stock: 3, min: 5, controla: true }];
  const raw = await runAssistantQuery(memoryReader({ products: PR }), { tipo: 'stock_producto', producto: 'PRUEBA A5 01' }, NOW);
  assert.ok(raw.columnas.includes('Costo S/')); assert.ok(JSON.stringify(raw).includes('3.18'), 'el Admin ve el costo');
  const emp = employeeQueryResult(JSON.parse(JSON.stringify(raw)));
  assert.ok(!JSON.stringify(emp).includes('3.18'), 'el empleado no ve el costo en ninguna parte del resultado');
  assert.ok(!emp.columnas.includes('Costo S/'));
});
