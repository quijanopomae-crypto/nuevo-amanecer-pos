import test from 'node:test';
import assert from 'node:assert/strict';
import { matchProducts, runAssistantQuery, stockQueryArgs } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { toProposal, employeeQueryResult, priceLookupMessage, assistantChatRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const p = (nombre, stock = 1, categoria = 'otros') => ({ id: nombre, nombre, stock, min: 5, controla: true, precio: 2, costo: 1, categoria });
const names = (list, q) => matchProducts(list.map((n) => p(n)), q).map((x) => x.nombre);
test('identidad y presentación: no basta una palabra o un fragmento coincidente', () => {
  assert.deepEqual(names(['AGUA 625ML', 'AGUARDIENTE 250ML', 'GALLETA DE AGUA 350G', 'AGUA 500ML'], 'agua 625 ml'), ['AGUA 625ML']);
  assert.deepEqual(names(['ARROZ JAIRITO', 'ARROZ AÑEJO'], 'arroz Costeño de un kilo'), []);
  assert.deepEqual(names(['DETERGENTE MARSELLA 150GR', 'DETERGENTE MARSELLA 750G', 'GELATINA 150G', 'MARSELLA 150ML'], 'detergente Marsella 150 gramos'), ['DETERGENTE MARSELLA 150GR']);
  assert.deepEqual(names(['ARROZ COSTEÑO 1000G'], 'arroz costeño 1 kg'), ['ARROZ COSTEÑO 1000G']);
});
test('conserva nombres a medias, plurales, six pack y preguntas de precio', () => {
  assert.equal(names(['Leche Gloria Azul', 'Leche Gloria Light', 'Leche Otra'], 'leche Gloria').length, 2);
  assert.equal(names(['Aceite Primor'], 'aceites').length, 1);
  assert.equal(names(['Cerveza Pilsen six pack'], 'six pack de cerveza').length, 1);
  const r = priceLookupMessage('owner', '¿a cuánto vendo el arroz jairito?', [p('Arroz Jairito'), p('Arroz Añejo')]);
  assert.match(r.content, /Jairito/); assert.doesNotMatch(r.content, /Añejo/);
});
test('filtros cero y negativo distintos de bajo mínimo', async () => {
  const list = [p('negativo', -2), p('cero', 0), p('bajo', 1), p('alto', 10), { ...p('servicio', 0), controla: false }];
  const reader = { products: async () => list };
  for (const [estado_stock, expected] of [['cero', ['cero']], ['negativo', ['negativo']]]) {
    const r = await runAssistantQuery(reader, { tipo: 'bajo_stock', estado_stock });
    assert.deepEqual(r.filas.map((f) => f[0]), expected);
  }
});
test('categoría exacta y ocho de N con advertencia de lectura parcial', async () => {
  const list = [...Array.from({ length: 12 }, (_, i) => p('Marca ' + i, 1, 'Galletas')), p('Galleta falsa', 1, 'otros')];
  list.truncated = true;
  const r = await runAssistantQuery({ products: async () => list }, { tipo: 'stock_producto', categoria: 'galletas' });
  assert.equal(r.total, 12); assert.equal(r.filas.length, 8); assert.match(r.texto, /8 de 12/); assert.match(r.texto, /lista larga/);
  assert.doesNotMatch(r.texto, /falsa/);
});
test('stock de ayer no se presenta como actual y no requiere reconstrucción ficticia', async () => {
  const r = await runAssistantQuery({ products: async () => [p('Aceite Primor')] }, { tipo: 'stock_producto', producto: 'aceite Primor', periodo: 'ayer' });
  assert.match(r.texto, /histórico|hist[oó]rico|ayer/i); assert.match(r.texto, /Kardex/); assert.equal(r.filas.length, 0);
});
test('normalización conserva parámetros cerrados de filtro', () => {
  const r = toProposal({ name: 'consultar', arguments: { tipo: 'stock_producto', categoria: 'Galletas', estado_stock: 'cero' } }, 'owner', { products: [] }, 0);
  assert.equal(r.query.categoria, 'Galletas'); assert.equal(r.query.estado_stock, 'cero');
});
async function chat(text, args) {
  const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'test-query-precision-secret', OHMYAGENT_API_KEY: 'test-only' };
  const res = await assistantChatRoute(new Request('https://test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text }) }), env, { principalId: 'test', sessionId: 'test' }, (d, s = 200) => new Response(JSON.stringify(d), { status: s }), {
    store: createMemoryUsageStore(), resolveRole: async () => 'owner', audit: async () => {}, reader: { products: async () => [p('cero', 0), p('negativo', -1), p('bajo', 1)] },
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'consultar', arguments: JSON.stringify(args) } }] } }] }))
  });
  return res.json();
}
test('ruta conserva intención exacta aunque modelo use bajo_stock y omita fecha', async () => {
  const zero = await chat('¿Cuáles productos están en cero?', { tipo: 'bajo_stock' });
  assert.deepEqual(zero.proposals[0].result.filas.map((f) => f[0]), ['cero']);
  const neg = await chat('¿Qué cosas tienen stock negativo?', { tipo: 'bajo_stock' });
  assert.deepEqual(neg.proposals[0].result.filas.map((f) => f[0]), ['negativo']);
  const hist = await chat('¿Cuánto quedaba ayer de aceite Primor?', { tipo: 'stock_producto', producto: 'aceite Primor' });
  assert.match(hist.reply, /hist[oó]rico/i); assert.match(hist.reply, /Kardex/);
});

test('normaliza una presentación dicha en palabras sin perderla ni confundir gas', () => {
  assert.deepEqual(names(['Arroz Costeño 1KG', 'Arroz Costeño 5KG'], 'arroz costeño de un kilo'), ['Arroz Costeño 1KG']);
  assert.deepEqual(names(['Agua con gas 625ML', 'Agua sin gas 625ML'], 'agua sin gas 625 ml'), ['Agua sin gas 625ML']);
});
test('categoría explícita no queda en la ruta general de bajo mínimo', () => {
  const q = stockQueryArgs({ tipo: 'bajo_stock' }, '¿Puedo ver lo que queda de toda la categoría galletas?');
  assert.equal(q.tipo, 'stock_producto'); assert.equal(q.categoria, 'galletas');
});
test('fecha de hoy conserva stock actual; sin costo no adquiere semántica histórica', async () => {
  const now = Date.UTC(2026, 9, 23, 16), reader = { products: async () => [p('Aceite Primor')] };
  const current = await runAssistantQuery(reader, { tipo: 'stock_producto', producto: 'aceite Primor', fecha: '2026-10-23' }, now);
  assert.equal(current.filas.length, 1);
  const noCost = await runAssistantQuery(reader, { tipo: 'sin_costo', periodo: 'ayer' }, now);
  assert.doesNotMatch(noCost.texto, /histórico/);
});
test('cero coincidencias en lectura cortada tampoco afirma búsqueda completa', async () => {
  const list = [p('Arroz')]; list.truncated = true;
  const r = await runAssistantQuery({ products: async () => list }, { tipo: 'stock_producto', categoria: 'galletas' });
  assert.match(r.texto, /lista larga/); assert.equal(r.truncado, true);
});

test('salvedades de cobertura e histórico sobreviven al filtro de empleado sin costos', async () => {
  const list = Array.from({ length: 12 }, (_, i) => p('Marca ' + i, 1, 'Galletas'));
  const result = employeeQueryResult(await runAssistantQuery({ products: async () => list }, { tipo: 'stock_producto', categoria: 'galletas' }));
  assert.match(JSON.stringify(result.resumen), /8 de 12/); assert.doesNotMatch(JSON.stringify(result.resumen), /costo/);
  const historic = employeeQueryResult(await runAssistantQuery({ products: async () => list }, { tipo: 'stock_producto', periodo: 'ayer' }));
  assert.match(JSON.stringify(historic.resumen), /Kardex/);
});
test('categoría combinada con filtro conserva la categoría validada y delimita inferencia', () => {
  const text = 'Muéstrame la categoría galletas con stock en cero';
  const supplied = stockQueryArgs({ tipo: 'stock_producto', categoria: 'galletas', estado_stock: 'cero' }, text);
  assert.equal(supplied.categoria, 'galletas'); assert.equal(supplied.estado_stock, 'cero');
  const inferred = stockQueryArgs({ tipo: 'stock_producto' }, text);
  assert.equal(inferred.categoria, 'galletas'); assert.equal(inferred.estado_stock, 'cero');
});
test('plural en es conserva panes frente a Pan sin prefijos parciales', () => {
  assert.deepEqual(names(['Pan', 'Panela', 'Pantalón'], 'panes'), ['Pan']);
});
test('plural no añade una e a nombres singulares distintos', () => {
  assert.deepEqual(names(['Pane', 'Panela'], 'pan'), []);
});
