// Códigos de cliente neutros hacia la IA (pos-assistant-codigos.js). Un código de cliente puede llevar el nombre («SIN-DOC-MISAEL»):
// justo antes de cada llamada al proveedor (OhMyAgent y su respaldo Routeway, con y sin partes) cada código real sale como «C-0001»,
// en todo el cuerpo (sistema, lecciones, resultados de consultas, historial, resumen). Lo que vuelve (texto y cliente_id de las
// herramientas) se traduce al código real antes de leer la base y antes de llegar al aparato; un neutro desconocido = «no encontré».
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, createMemoryUsageStore, customerCode, UNKNOWN_CUSTOMER_TEXT, lessonsKey, LESSONS_PREFIX } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader, runAssistantQuery } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { configFor, callModel } from '../../tools/cloudflare-lab/src/pos-assistant-providers.js';
import { createCodeMap, UNKNOWN_CUSTOMER } from '../../tools/cloudflare-lab/src/pos-assistant-codigos.js';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const NOW = Date.parse('2026-10-22T20:00:00.000Z');
const REAL = 'SIN-DOC-MISAEL';
const LEAK = /MISAEL/i;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();
const delta = (d, fin) => 'data: ' + JSON.stringify({ choices: [{ delta: d, ...(fin ? { finish_reason: fin } : {}) }] }) + '\n\n';
const streamR = (chunks) => { let i = 0; return new Response(new ReadableStream({ pull(c) { if (i < chunks.length) c.enqueue(enc.encode(chunks[i++])); else { c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
const call = (name, args, id = 'call_1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const msg = (m) => json({ choices: [{ message: m }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
const DATA = {
  products: [{ id: 'P1', nombre: 'Arroz 1 kg', precio: 4, costo: 3, stock: 50, min: 5, controla: true }],
  customers: [{ id: REAL, nombre: 'Misael Ramos' }, { id: 'C7', nombre: 'Otra Persona' }],
  credits: [{ cliente: REAL, saldo: 4.125, vence: '2026-11-05', fecha: '2026-10-05' }, { cliente: 'C7', saldo: 10, vence: '2026-11-01', fecha: '2026-10-01' }],
  sales: [], saleItems: []
};
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, OHMYAGENT_API_KEY: 'k-ohmy', ROUTEWAY_API_KEY: 'k-rw' };

// Pedido del Admin con lecturas espiadas; responses[i] = respuesta (o función) de la llamada i al proveedor.
async function route(body, responses, store = createMemoryUsageStore()) {
  const cap = [], hosts = [], reads = [];
  const base = memoryReader(DATA);
  const reader = Object.fromEntries(Object.entries(base).map(([k, fn]) => [k, (...a) => { reads.push(k); return fn(...a); }]));
  const f = async (url, init) => { cap.push(String(init.body)); hosts.push(new URL(url).host); const r = responses[Math.min(cap.length - 1, responses.length - 1)]; return typeof r === 'function' ? r() : msg(r); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { products: DATA.products }, ...body }) }),
    ENV, { principalId: 'session:x', posRole: 'owner' }, json,
    { store, resolveRole: async () => 'owner', fetch: f, reader, audit: async () => {}, mockChunkMs: 0, now: () => NOW });
  return { r, cap, hosts, reads };
}
const sseEvents = (text) => text.split('\n\n').filter(Boolean).map((b) => { const e = /^event: (\w+)/m.exec(b)?.[1]; const d = /^data: (.*)$/m.exec(b)?.[1]; return { e, d: d ? JSON.parse(d) : null }; });

test('1) hacia la IA nunca va el código real: consulta, historial, resumen y respuesta; el aparato recibe el real', async () => {
  const { r, cap } = await route({
    text: '¿Quiénes me deben? Sobre todo el cliente #' + REAL + '. Explícame.', // «explícame»: segunda llamada (#960)
    history: [{ role: 'user', content: 'El cliente #' + REAL + ' pasó hoy' }, { role: 'assistant', content: 'Anotado, cliente #' + REAL + '.' }],
    resumen: 'Antes se habló del cliente #' + REAL + ' y de su deuda.'
  }, [{ content: '', tool_calls: [call('consultar', { tipo: 'deudas_clientes' })] }, { content: 'El cliente #C-0001 debe S/ 4.13.' }]);
  assert.equal(r.status, 200); const d = await r.json();
  assert.equal(cap.length, 2);
  for (const b of cap) { assert.ok(!LEAK.test(b), 'llegó a la IA: ' + b.slice(0, 300)); assert.ok(b.includes('cliente #C-0001'), 'va el neutro'); }
  const tool = JSON.parse(cap[1]).messages.find((m) => m.role === 'tool');
  assert.ok(tool && tool.content.includes('C-0001') && !LEAK.test(tool.content), 'el resultado de la consulta va con el neutro');
  assert.match(d.reply, /cliente #SIN-DOC-MISAEL debe/); assert.ok(!d.reply.includes('C-0001'));
  const p = d.proposals.find((x) => x.type === 'consulta'); assert.ok(JSON.stringify(p.result).includes(REAL), 'la tabla del aparato lleva el real');
});

test('1b) OhMyAgent y respaldo Routeway: lecciones aprendidas, resultados de herramientas y argumentos anteriores salen neutros', async () => {
  const cfg = { ...configFor(ENV, 'ohmyagent'), retryWaits: [0, 0] };
  assert.equal(cfg.ok, true);
  const cap = [], hosts = [];
  const req = { messages: [
    { role: 'system', content: 'Lecciones (internal:asst:taught:ab12cd): cuando pregunten por cliente #' + REAL + ' usa deuda_cliente con "' + REAL + '".' },
    { role: 'user', content: 'cuánto debe ' + REAL + '?' },
    { role: 'assistant', content: '', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: REAL })] },
    { role: 'tool', tool_call_id: 'call_1', content: JSON.stringify({ tipo: 'deuda_cliente', resumen: { cliente: 'cliente #' + REAL, saldo_soles: 4.13 } }) }
  ] };
  const r = await callModel(cfg, req, async (url, init) => { cap.push(String(init.body)); hosts.push(new URL(url).host);
    return url.includes('ohhmyagent') ? json({ error: 'caído' }, 503) : msg({ content: 'cliente #C-0001 debe S/ 4.13', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: 'C-0001' }, 'call_2')] }); }, 5000);
  assert.ok(hosts.includes('ohhmyagent.com') && hosts.includes('api.routeway.ai'), hosts.join(','));
  for (const b of cap) { assert.ok(!LEAK.test(b), b.slice(0, 300)); assert.ok(b.includes('C-0001')); assert.ok(b.includes('internal:asst:taught:ab12cd')); }
  assert.equal(r.content, 'cliente #' + REAL + ' debe S/ 4.13');
  const args = r.calls?.[0]?.arguments; assert.equal((typeof args === 'string' ? JSON.parse(args) : args)?.cliente_id, REAL, JSON.stringify(r.calls));
});

test('2) herramienta con C-000N -> código real (estado de cuenta, con cliente_id y con «cliente #C-0001»)', async () => {
  for (const args of [{ tipo: 'estado_cuenta', cliente_id: 'C-0001' }, { tipo: 'estado_cuenta', cliente: 'cliente #C-0001' }, { tipo: 'estado_cuenta', cliente_id: 'c-0001' }]) {
    const { r, cap } = await route({ text: 'estado de cuenta del cliente #' + REAL }, [{ content: 'Listo, cliente #C-0001.', tool_calls: [call('preparar_documento', args)] }]);
    const d = await r.json();
    assert.ok(!LEAK.test(cap.join('')));
    assert.equal(d.proposals[0]?.cliente_id, REAL, JSON.stringify(args)); assert.match(d.reply, /cliente #SIN-DOC-MISAEL/);
  }
});

test('2b) deuda_cliente (#958): cliente_id neutro hacia la IA, real hacia la base; SIN-DOC-MISAEL debe S/ 4.125', async () => {
  const { r, cap, reads } = await route({ text: '¿Cuánto debe el cliente #' + REAL + '? Explícame.' },
    [{ content: '', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: 'C-0001' })] }, { content: 'El cliente #C-0001 debe S/ 4.13 en 1 crédito.' }]);
  assert.equal(r.status, 200); const d = await r.json();
  assert.equal(cap.length, 2); for (const b of cap) assert.ok(!LEAK.test(b), b.slice(0, 300));
  const p = d.proposals.find((x) => x.type === 'consulta');
  assert.equal(p.query.cliente_id, REAL, 'la base se lee con el código real'); assert.ok(reads.includes('credits'));
  const direct = await runAssistantQuery(memoryReader(DATA), { tipo: 'deuda_cliente', cliente_id: REAL }, NOW);
  assert.equal(direct.resumen.creditos_abiertos, 1); assert.equal(Number(direct.filas[0][1]).toFixed(2), Number(4.125 * 1).toFixed(2));
  assert.deepEqual(p.result.filas, direct.filas); assert.match(p.result.texto, /^cliente #SIN-DOC-MISAEL debe S\/ /);
  const sent = JSON.parse(JSON.parse(cap[1]).messages.find((m) => m.role === 'tool').content);
  assert.equal(sent.resumen.cliente, 'cliente #C-0001'); assert.equal(sent.resumen.saldo_soles, direct.resumen.saldo_soles);
  assert.match(d.reply, /cliente #SIN-DOC-MISAEL debe/);
  // Respuesta directa (#960, sin segunda llamada): el texto lo arma el servidor con el código real; a la IA solo fue el neutro.
  const x = await route({ text: '¿Cuánto debe el cliente #' + REAL + '?' }, [{ content: '', tool_calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: 'C-0001' })] }]);
  const dx = await x.r.json(); assert.equal(x.cap.length, 1); assert.ok(!LEAK.test(x.cap[0]));
  assert.match(dx.reply, /cliente #SIN-DOC-MISAEL debe S\/ /);
});

test('3) en partes: el neutro llega al aparato como código real, aunque venga cortado entre partes', async () => {
  const chunks = [delta({ content: 'Hola, cliente #C-0' }), delta({ content: '001 debe S/ 4.13; ' }), delta({ content: 'revise #C' }), delta({ content: '-0001.' }, 'stop')];
  const { r, cap } = await route({ text: '¿Cuánto debe el cliente #' + REAL + '?', stream: true }, [() => streamR(chunks)]);
  const text = await r.text(); const ev = sseEvents(text);
  assert.ok(!LEAK.test(cap.join('')));
  const shown = ev.filter((x) => x.e === 'text' && x.d?.t).map((x) => x.d.t).join('');
  assert.ok(!/C-0|#C\b/.test(text.replace(/SIN-DOC-MISAEL/g, '')), text.slice(0, 500));
  assert.equal(shown, 'Hola, cliente #SIN-DOC-MISAEL debe S/ 4.13; revise #SIN-DOC-MISAEL.');
  const fin = ev.find((x) => x.e === 'final'); assert.match(fin.d.reply, /cliente #SIN-DOC-MISAEL debe/);
});

test('3b) partes: cualquier corte da lo mismo que el texto entero; un neutro desconocido queda igual', () => {
  const m = createCodeMap(); m.outbound(JSON.stringify({ a: 'cliente #' + REAL + ' y cliente #C7' }));
  assert.equal(m.neutral(REAL), 'C-0001'); assert.equal(m.neutral('C7'), 'C-0002');
  const whole = 'Ver cliente #C-0001, luego C-0002 y C-0042; fin C-0001';
  const want = 'Ver cliente #' + REAL + ', luego C7 y C-0042; fin ' + REAL;
  assert.equal(m.toReal(whole), want);
  for (let i = 0; i <= whole.length; i++) for (let j = i; j <= whole.length; j++) {
    let out = ''; const st = m.streamer((t) => { out += t; });
    st.push(whole.slice(0, i)); st.push(whole.slice(i, j)); st.push(whole.slice(j)); st.flush();
    assert.equal(out, want, i + ',' + j);
  }
});

test('4) neutro desconocido = «no encontré», sin leer la base (estado de cuenta y deuda_cliente)', async () => {
  for (const tc of [call('preparar_documento', { tipo: 'estado_cuenta', cliente_id: 'C-0042' }), call('consultar', { tipo: 'deuda_cliente', cliente_id: 'C-0042' }), call('consultar', { tipo: 'deuda_cliente', cliente: 'cliente #C-0042' })]) {
    const { r, reads, cap } = await route({ text: '¿y el cliente #' + REAL + '?' }, [{ content: '', tool_calls: [tc] }, { content: 'nada' }]);
    const d = await r.json();
    assert.deepEqual(reads, [], 'no se leyó la base: ' + tc.function.arguments);
    assert.equal(d.reply, UNKNOWN_CUSTOMER_TEXT); assert.equal(d.proposals.length, 0);
    assert.ok(!LEAK.test(cap.join('')));
  }
  const m = createCodeMap(); m.outbound('{"t":"cliente #' + REAL + '"}');
  assert.equal(JSON.parse(m.argsToReal('{"cliente_id":"C-0042"}')).cliente_id, UNKNOWN_CUSTOMER);
  assert.equal(customerCode(UNKNOWN_CUSTOMER), null, 'el centinela nunca es un código');
  assert.equal(JSON.parse(m.argsToReal('{"cliente_id":"C-0001"}')).cliente_id, REAL);
});

test('5) #957: la lección guardada en internal:asst:taught (con el código real) sale hacia la IA con el neutro, sin nombre', async () => {
  const store = createMemoryUsageStore(), auth = { principalId: 'session:x', posRole: 'owner' };
  await route({ text: 'apunta: Misael Ramos me debe 3 cajas de leche' }, [{ content: 'Anotado.' }], store);
  const key = await lessonsKey(auth); assert.ok(key.startsWith('internal:asst:taught:') && key.startsWith(LESSONS_PREFIX), key);
  const saved = (await store.get(key)).value; assert.deepEqual(saved.items, ['apunta: cliente #' + REAL + ' me debe 3 cajas de leche'], JSON.stringify(saved));
  const { r, cap } = await route({ text: '¿Qué te enseñé hoy?' }, [{ content: 'Me enseñó que el cliente #C-0001 le debe 3 cajas de leche.' }], store);
  assert.equal(r.status, 200); const d = await r.json();
  assert.equal(cap.length, 1);
  const taught = JSON.parse(cap[0]).messages.find((m) => m.role === 'user' && /ensenado_por_usuario/.test(m.content));
  assert.ok(taught && taught.content.includes('cliente #C-0001 me debe 3 cajas de leche'), 'la lección va con el neutro: ' + (taught && taught.content));
  assert.ok(!LEAK.test(cap[0]) && !/Ramos/.test(cap[0]), 'ni código real ni nombre hacia la IA');
  assert.match(d.reply, /cliente #SIN-DOC-MISAEL le debe 3 cajas/); assert.ok(!d.reply.includes('C-0001'));
});
