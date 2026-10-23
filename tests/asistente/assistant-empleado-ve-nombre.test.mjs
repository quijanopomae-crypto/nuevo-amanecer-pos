// Decisión del Admin de la tienda, 2026-10-23: el EMPLEADO también ve el nombre real del cliente y sus datos en el asistente
// (si alguien viene a pagar, «cliente #R7» no le dice quién es). Solo cambia la pantalla: hacia la IA el cliente sigue yendo como
// «cliente #código» para todos. El empleado puede preguntar cuánto debe UN cliente (deuda_cliente con cliente_id = su código);
// ganancia, totales de la tienda (deudas_clientes, caja, créditos atrasados, resúmenes) y costos siguen siendo solo del Admin.
// Nombres inventados. Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore, toolsForRole, systemPrompt, employeeQueryResult } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader, runAssistantQuery } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { makeDoc } from './fake-dom.mjs';
const require = createRequire(import.meta.url);
const store = new Map();
globalThis.localStorage = globalThis.localStorage || { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = globalThis;
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const NOW = Date.parse('2026-10-23T20:00:00.000Z');
const NAME = 'Rosa Prueba', NAME_RE = /Rosa|Prueba/i;
const LOCAL = [{ id: 'R7', nombre: NAME }, { id: 'R8', nombre: 'Tito Inventado' }];
const DATA = {
  products: [{ id: 'P1', nombre: 'Arroz 1 kg', precio: 4.5, costo: 3.1, stock: 2, min: 5, controla: true }],
  customers: [{ id: 'R7', nombre: NAME, dni: '40998877', telefono: '911222333' }, { id: 'R8', nombre: 'Tito Inventado' }],
  credits: [
    { cliente: 'R7', saldo: 37.4, vence: '2026-11-05', fecha: '2026-10-05', nombre: NAME },
    { cliente: 'R7', saldo: 12.6, vence: '2026-11-20', fecha: '2026-10-20' },
    { cliente: 'R8', saldo: 999.99, vence: '2026-11-01', fecha: '2026-10-01' }
  ],
  sales: [{ sale_id: 'S1', created_at: '2026-10-23T15:00:00.000Z', metodo: 'efectivo', total_cents: 77777 }],
  saleItems: [{ sale_id: 'S1', product_id: 'P1', quantity: 3, line_total_cents: 77777, unit_price_cents: 450 }],
  cashMovements: [], payments: [], purchases: [],
  cash: { ready: true, open: { opened_at: '2026-10-23T12:00:00.000Z', opening_cents: 55555, expected_cents: 66666 }, rows: [] }
};
const EMP = ['empleado:consultas', 'empleado:consultas_documentos', 'empleado:completo', 'empleado:completo+costos'];
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder(), sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const call = (args) => ({ id: 'call_q', type: 'function', function: { name: 'consultar', arguments: JSON.stringify(args) } });
const REPLY = 'Cliente #R7 tiene su deuda en la tabla.';
function scripted(args, cap, stream) {
  let i = 0;
  return async (_u, init) => { cap.push(String(init.body)); const first = i++ === 0;
    if (!stream) return json({ choices: [{ message: first ? { role: 'assistant', content: '', tool_calls: [call(args)] } : { role: 'assistant', content: REPLY } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const chunks = first
      ? [sse({ choices: [{ delta: { tool_calls: [{ index: 0, ...call(args) }] } }] }), sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })]
      : [sse({ choices: [{ delta: { content: REPLY } }] }), sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })];
    return new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
}
async function chat(role, args, { text, stream = false, key = true } = {}) {
  const cap = [], reads = [], base = memoryReader(DATA), rd = {};
  for (const k of Object.keys(base)) rd[k] = async (...a) => { reads.push(k); return base[k](...a); };
  const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, ...(key ? { DEEPSEEK_API_KEY: 'k' } : { ASSISTANT_DEMO: '1' }) };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, stream, context: { products: DATA.products } }) }),
    env, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, json,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: scripted(args, cap, stream), reader: rd, audit: async () => {}, now: () => NOW });
  let out;
  if (stream && /event-stream/.test(r.headers.get('content-type') || '')) {
    const ev = []; const p = C.createSseParser((e, d) => ev.push({ e, d }));
    const rr = r.body.getReader(), dec = new TextDecoder(); for (;;) { const { value, done } = await rr.read(); if (done) break; p.feed(dec.decode(value, { stream: true })); }
    out = JSON.stringify(ev);
  } else out = await r.text();
  return { status: r.status, out, toModel: cap, reads };
}
// Lo que dice el empleado en el aparato pasa por maskCustomers (igual que el Admin): el nombre se vuelve «cliente #código».
const ask = (t) => C.maskCustomers(t, LOCAL, DATA.products, []).text;

// ---------- pantalla: tabla y burbuja (líneas reales de asistente-ui.js) ----------
function uiApi() {
  const doc = makeDoc(), el = (t, c) => { const e = doc.createElement(t); if (c) e.className = c; return e; };
  const s0 = UI.indexOf('  var CLI_RE = '), s1 = UI.indexOf('  // ---------- «Leer boleta con IA»');
  assert.ok(s0 > 0 && s1 > s0, 'bloque de linkCustomers');
  const api = new Function('root', 'doc', 'C', 'el', 'addMsg', 'deps', UI.slice(s0, s1) + '\nreturn { linkCustomers: linkCustomers };')({}, doc, C, el, () => {}, { clientes: () => LOCAL });
  return { doc, linkCustomers: api.linkCustomers };
}
// Empleado con el asistente: isAdmin() (acceso al panel) = true, isOwnerAccess() (Admin) = false. Admin: ambos true.
const ROLES = { empleado: { isAdmin: () => true, isOwnerAccess: () => false }, admin: { isAdmin: () => true, isOwnerAccess: () => true } };

test('(a) tabla de la consulta: el EMPLEADO también ve el nombre real del cliente (de la lista de ESTE aparato); el Admin igual', () => {
  const line = UI.split('\n').find((l) => l.includes("var qt = p.type === 'consulta'")); assert.ok(line, 'línea de la tabla en addCard');
  const { doc, linkCustomers } = uiApi();
  for (const [who, g] of Object.entries(ROLES)) {
    const c = doc.createElement('div'), t = doc.createElement('table'); t.className = 'q';
    const td = doc.createElement('td'); td.textContent = 'cliente #R7'; t.appendChild(td); c.appendChild(t);
    c.querySelector = (sel) => (sel === 'table.q' ? t : null);
    new Function('p', 'c', 'C', 'deps', 'linkCustomers', 'isOwnerAccess', 'isAdmin', line)({ type: 'consulta' }, c, C, { clientes: () => LOCAL }, linkCustomers, g.isOwnerAccess, g.isAdmin);
    assert.ok(t.textContent.includes(NAME), who + ': nombre real en la tabla: ' + t.textContent);
    assert.equal(t.byClass('na-asst-cli').length, 1, who + ': el mismo botón del cliente que en el chat');
  }
});

test('(b) burbuja de la respuesta: el EMPLEADO también ve el nombre real del cliente; el Admin igual', () => {
  const line = UI.split('\n').find((l) => l.includes('linkCustomers(bubble')); assert.ok(line, 'línea de la burbuja');
  const { doc, linkCustomers } = uiApi();
  for (const [who, g] of Object.entries(ROLES)) {
    const bubble = doc.createElement('div'); bubble.textContent = 'El cliente #R7 debe S/ 50.00.';
    new Function('C', 'd', 'deps', 'bubble', 'linkCustomers', 'isOwnerAccess', 'isAdmin', line)(C, { reply: bubble.textContent }, { clientes: () => LOCAL }, bubble, linkCustomers, g.isOwnerAccess, g.isAdmin);
    assert.ok(bubble.textContent.includes(NAME), who + ': nombre real en la burbuja: ' + bubble.textContent);
  }
  assert.ok(!/isOwnerAccess\(\)/.test(line), 'la burbuja ya no depende de ser el Admin: ' + line);
});

test('(c) el nombre NUNCA llega a la IA en modo empleado (aparato -> «cliente #código»; servidor, con y sin partes)', async () => {
  const text = ask('¿Cuánto debe Rosa Prueba?');
  assert.ok(!NAME_RE.test(text), 'el aparato tapa el nombre: ' + text); assert.match(text, /cliente #R7/);
  for (const role of EMP) for (const stream of [false, true]) {
    const r = await chat(role, { tipo: 'deuda_cliente', cliente_id: 'R7' }, { text, stream });
    assert.ok(r.toModel.length >= 1, role + ': hubo llamada al modelo');
    for (const b of r.toModel) assert.ok(!NAME_RE.test(b) && !b.includes('40998877') && !b.includes('911222333'), role + (stream ? ' partes' : '') + ': nombre/DNI/teléfono hacia la IA: ' + b.slice(0, 300));
  }
});

test('(d) empleado: deuda_cliente con cliente_id = código -> el monto en la tarjeta y hacia la IA, sin 403 (con y sin partes)', async () => {
  for (const role of EMP) {
    const c = toolsForRole(role).find((t) => t.function.name === 'consultar');
    assert.ok(c, role + ': tiene consultar');
    assert.ok(c.function.parameters.properties.tipo.enum.includes('deuda_cliente'), role + ': deuda_cliente en la lista');
    assert.ok(c.function.parameters.properties.cliente_id, role + ': cliente_id para deuda_cliente');
    assert.match(systemPrompt(role, '', ''), /deuda_cliente/, role + ': la instrucción de deuda_cliente también le llega');
    for (const stream of [false, true]) {
      const r = await chat(role, { tipo: 'deuda_cliente', cliente_id: 'R7' }, { text: ask('¿Cuánto me debe Rosa Prueba?'), stream });
      const tag = role + (stream ? ' partes' : '');
      assert.equal(r.status, 200, tag + ': ' + r.out.slice(0, 300));
      assert.ok(!/admin_only|forbidden|solo para el Admin/i.test(r.out), tag + ': no bloquea: ' + r.out.slice(0, 400));
      assert.ok(r.reads.includes('credits'), tag + ': leyó los créditos');
      assert.match(r.out, /50\.00/, tag + ': el monto (37.40 + 12.60) llega a la pantalla: ' + r.out.slice(0, 600));
      assert.match(r.out, /cliente #R7/, tag + ': la tarjeta va con «cliente #código» (el nombre lo pone el aparato)');
      assert.ok(!NAME_RE.test(r.out) && !r.out.includes('999.99'), tag + ': sin nombre del servidor ni deuda de otro cliente');
      // respuesta directa (pedido simple): la burbuja dice el mismo texto de la consulta, con el monto
      const reply = stream ? JSON.parse(r.out).filter((x) => x.e === 'text' || x.e === 'done').map((x) => x.d.t || x.d.reply || '').join('') : JSON.parse(r.out).reply;
      assert.match(reply, /cliente #R7 debe S\/ 50\.00/, tag + ': burbuja: ' + reply);
      // pedido que pide explicación: segunda llamada; la IA recibe el saldo (sin nombre, ver (c))
      const r2 = await chat(role, { tipo: 'deuda_cliente', cliente_id: 'R7' }, { text: ask('Explícame por qué debe tanto Rosa Prueba'), stream });
      assert.equal(r2.toModel.length, 2, tag + ': segunda llamada');
      assert.match(r2.toModel[1], /saldo_soles\\?"?:\s*50\b/, tag + ': la IA recibe el saldo: ' + r2.toModel[1].slice(-800));
      assert.ok(!NAME_RE.test(r2.toModel.join('\n')), tag + ': sin nombre hacia la IA');
    }
  }
});

test('(d) modo demostración (sin clave): «¿cuánto debe el cliente #R7?» del empleado -> la deuda, sin 403', async () => {
  for (const role of EMP) {
    const r = await chat(role, {}, { text: '¿Cuánto debe el cliente #R7?', key: false });
    assert.equal(r.status, 200, role + ': ' + r.out.slice(0, 300));
    assert.match(r.out, /50\.00/, role + ': ' + r.out.slice(0, 500));
  }
});

test('(e) empleado: ganancia, totales de la tienda y costos siguen bloqueados (403 o sin tarjeta, sin leer los datos)', async () => {
  const BLOCKED_403 = ['ganancia', 'creditos_atrasados', 'caja_abierta', 'resumen_dia'];
  for (const role of EMP) for (const stream of [false, true]) {
    const tag = role + (stream ? ' partes' : '');
    for (const tipo of BLOCKED_403) {
      if (tipo === 'ganancia' && role === 'empleado:completo+costos') continue; // el permiso de costos del Admin
      const r = await chat(role, { tipo, periodo: 'hoy' }, { text: 'dame el dato', stream });
      const st = stream && r.status === 200 ? (JSON.parse(r.out).find((x) => x.e === 'error') || { d: {} }).d.status : r.status; // en partes: evento «error» con status
      assert.equal(st, 403, tag + ' ' + tipo + ': ' + r.out.slice(0, 300));
      assert.ok(!r.out.includes('777.77') && !r.out.includes('666.66'), tag + ' ' + tipo);
    }
    // deudas de TODA la tienda: no hay tarjeta ni se leen los créditos
    const r = await chat(role, { tipo: 'deudas_clientes' }, { text: 'dame el dato', stream });
    assert.ok(!r.reads.includes('credits'), tag + ' deudas_clientes leyó créditos');
    assert.ok(!/999\.99|50\.00|1049\.99/.test(r.out), tag + ' deudas_clientes: ' + r.out.slice(0, 400));
    // costos: el resultado de deuda_cliente no trae costos ni ganancia, y la herramienta no ofrece deudas_clientes
    const c = toolsForRole(role).find((t) => t.function.name === 'consultar');
    assert.ok(!c.function.parameters.properties.tipo.enum.includes('deudas_clientes'), role + ': deudas_clientes sigue fuera');
    if (role !== 'empleado:completo+costos') assert.ok(!c.function.parameters.properties.tipo.enum.includes('ganancia'), role + ': ganancia sigue fuera');
  }
});

// ---------- (f) dos clientes con el mismo nombre (revisión #1006, CLI-025) ----------
// El aparato manda «cliente #R7 o cliente #R9» (mismo nombre en Clientes). Con deuda_cliente abierto al empleado, si la IA consulta
// solo a uno, la tarjeta se quita y se pregunta cuál (dropOnePickedClient de #1006), no «No puedo hacer eso…»; si consulta a los dos,
// salen las dos tarjetas. Esa parte llega con #1006 (clientAlternatives): sin ella la prueba se salta.
const SRV_MOD = await import('../../tools/cloudflare-lab/src/pos-assistant.js');
const HAS_1006 = typeof SRV_MOD.clientAlternatives === 'function';
const LOCAL2 = [{ id: 'R7', nombre: NAME }, { id: 'R9', nombre: NAME }, { id: 'R8', nombre: 'Tito Inventado' }];
const DATA2 = { ...DATA, customers: [...DATA.customers, { id: 'R9', nombre: NAME }], credits: [...DATA.credits, { cliente: 'R9', saldo: 20, vence: '2026-11-03', fecha: '2026-10-03' }] };
const neutral = (body) => [...new Set([...JSON.parse(body).messages.filter((m) => m.role === 'user').map((m) => String(m.content)).join(' ')
  .matchAll(/cliente #(C-\d{4})/g)].map((m) => m[1]))];
async function chatPick(role, text, which, stream) {
  const cap = []; let i = 0;
  const qc = (id, n) => ({ id: 'call_' + n, type: 'function', function: { name: 'consultar', arguments: JSON.stringify({ tipo: 'deuda_cliente', cliente_id: id }) } });
  const fetch = async (_u, init) => { const body = String(init.body); cap.push(body); const first = i++ === 0;
    const calls = first ? which(neutral(body)).map(qc) : null;
    if (!stream) return json({ choices: [{ message: calls ? { role: 'assistant', content: '', tool_calls: calls } : { role: 'assistant', content: 'Listo.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const chunks = calls ? [sse({ choices: [{ delta: { tool_calls: calls.map((c, k) => ({ index: k, ...c })) } }] }), sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })]
      : [sse({ choices: [{ delta: { content: 'Listo.' } }] }), sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })];
    return new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, stream, context: { products: DATA2.products } }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: 'empleado' }, json,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch, reader: memoryReader(DATA2), audit: async () => {}, now: () => NOW });
  const raw = await r.text(); assert.equal(r.status, 200, raw.slice(0, 300));
  if (!stream) return { b: JSON.parse(raw), cap };
  const ev = []; const p = C.createSseParser((e, d) => ev.push({ e, d })); p.feed(raw);
  assert.ok(!ev.some((x) => x.e === 'error'), JSON.stringify(ev).slice(0, 300));
  return { b: ev.find((x) => x.e === 'final').d, cap };
}

test('(f) empleado, dos clientes con el mismo nombre: si la IA consulta a uno (pick1) -> «¿cuál?» con los códigos; a los dos -> dos tarjetas', { skip: !HAS_1006 && 'llega con #1006 (dropOnePickedClient)' }, async () => {
  const text = C.maskCustomers('¿cuánto debe ' + NAME + '?', LOCAL2, DATA2.products, []).text; // lo que manda el aparato
  assert.match(text, /cliente #R7 o cliente #R9|cliente #R9 o cliente #R7/, text);
  for (const role of EMP) for (const stream of [false, true]) {
    const tag = role + (stream ? ' (por partes)' : '');
    const one = await chatPick(role, text, (codes) => { assert.equal(codes.length, 2, tag + ': ' + codes); return [codes[0]]; }, stream);
    assert.match(one.b.reply, /¿es cliente #R\d o cliente #R\d\?/, tag + ': ' + one.b.reply);
    assert.ok(!/No puedo hacer eso|solo para el Admin|S\/|\d+\.\d\d/.test(one.b.reply), tag + ': ' + one.b.reply);
    assert.ok(!(one.b.proposals || []).some((p) => p.type === 'consulta'), tag + ': eligió uno: ' + JSON.stringify(one.b.proposals));
    const both = await chatPick(role, text, (codes) => codes, stream);
    const cards = (both.b.proposals || []).filter((p) => p.type === 'consulta');
    assert.equal(cards.length, 2, tag + ': ' + JSON.stringify(both.b.proposals));
    assert.deepEqual(cards.map((p) => p.query.cliente_id).sort(), ['R7', 'R9'], tag);
    assert.ok(!/No puedo hacer eso|¿es cliente/.test(both.b.reply), tag + ': ' + both.b.reply);
    for (const body of [...one.cap, ...both.cap]) assert.ok(!NAME_RE.test(body) && !/\bR[79]\b/.test(body), tag + ': nombre o código real hacia la IA');
  }
});

// ---------- (g) formato de texto y total de deuda_cliente para el empleado (revisión #1018) ----------
// El texto del empleado es una de estas frases fijas, con «cliente #código» y montos de ESE cliente; el total es null o el número de
// créditos abiertos (nunca plata ni totales de la tienda). Sin nombre, DNI ni teléfono. Si el texto de la consulta trae otra cosa
// (otro formato, un nombre, un total de la tienda), al empleado no le llega: se arma de nuevo con lo que pasó la lista blanca.
const CODE = '[A-Za-z0-9_-]{1,40}';
const DEBT_TEXTS = [
  new RegExp('^cliente #' + CODE + ' debe S/ \\d+\\.\\d{2} en \\d+ créditos? abiertos?(?:; el primero vence el \\d{4}-\\d{2}-\\d{2})?\\.$'),
  new RegExp('^cliente #' + CODE + ' no tiene deudas pendientes\\.$'),
  new RegExp('^No encontré deudas de cliente #' + CODE + '\\. Revise el código en Clientes\\.$'),
  /^Dime el código del cliente \(aparece como «cliente #código» en Clientes\)\.$/];
const PII_RE = /Rosa|Prueba|Tito|Inventado|40998877|911222333/i;
const pinned = (e, tag) => {
  assert.ok(DEBT_TEXTS.some((re) => re.test(e.texto)), tag + ': formato del texto: ' + e.texto);
  assert.ok(e.total === null || (Number.isInteger(e.total) && e.total === e.resumen.creditos_abiertos), tag + ': total = null o n.º de créditos: ' + e.total);
  assert.ok(!PII_RE.test(JSON.stringify(e)), tag + ': sin nombre, DNI ni teléfono: ' + JSON.stringify(e));
  assert.ok(!/999\.99|1049\.99|22057|tienda|todos/i.test(JSON.stringify(e)), tag + ': sin otro cliente ni totales de la tienda: ' + JSON.stringify(e));
};
test('(g) deuda_cliente del empleado: texto y total con formato fijo (código, saldo de ESE cliente), sin nombre, DNI, teléfono ni totales de la tienda', async () => {
  const rd = memoryReader(DATA), now = NOW;
  const cases = [
    [{ cliente_id: 'R7' }, 'cliente #R7 debe S/ 50.00 en 2 créditos abiertos; el primero vence el 2026-11-05.', null],
    [{ cliente_id: 'cliente #R8' }, 'cliente #R8 debe S/ 999.99 en 1 crédito abierto; el primero vence el 2026-11-01.', null],
    [{ cliente_id: 'R9' }, 'No encontré deudas de cliente #R9. Revise el código en Clientes.', null],
    [{}, 'Dime el código del cliente (aparece como «cliente #código» en Clientes).', null]];
  for (const [args, texto, total] of cases) {
    const e = employeeQueryResult(await runAssistantQuery(rd, { tipo: 'deuda_cliente', ...args }, now)), tag = JSON.stringify(args);
    assert.equal(e.texto, texto, tag); assert.equal(e.total, total, tag);
    if (args.cliente_id !== 'cliente #R8') pinned(e, tag);
  }
  // sin deuda pendiente (cliente conocido)
  const paid = { ...DATA, credits: [{ cliente: 'R7', saldo: 0, vence: '2026-10-01', fecha: '2026-09-01' }] };
  const e0 = employeeQueryResult(await runAssistantQuery(memoryReader(paid), { tipo: 'deuda_cliente', cliente_id: 'R7' }, now));
  assert.equal(e0.texto, 'cliente #R7 no tiene deudas pendientes.'); pinned(e0, 'pagado');
  // más créditos que filas: total = número de créditos abiertos (no plata)
  const many = { ...DATA, credits: Array.from({ length: 40 }, (_, i) => ({ cliente: 'R7', saldo: 1, vence: '2026-12-' + String(1 + (i % 28)).padStart(2, '0'), fecha: '2026-10-01' })) };
  const em = employeeQueryResult(await runAssistantQuery(memoryReader(many), { tipo: 'deuda_cliente', cliente_id: 'R7' }, now));
  if (em.total !== null) assert.equal(em.total, 40); pinned(em, 'muchos créditos');
  // un texto o total que no son del formato (nombre, DNI, teléfono, total de la tienda) no le llegan al empleado
  const base = await runAssistantQuery(rd, { tipo: 'deuda_cliente', cliente_id: 'R7' }, now);
  for (const bad of [
    { texto: 'Rosa Prueba (DNI 40998877, cel 911222333) debe S/ 50.00.' },
    { texto: base.texto + ' La tienda tiene S/ 22057.72 por cobrar de todos los clientes.' },
    { texto: 'cliente #R7 debe S/ 50.00; cliente #R8 debe S/ 999.99.' },
    { total: 22057.72 }, { total: 1049.99 }, { total: '2' }]) {
    const e = employeeQueryResult({ ...base, ...bad }), tag = JSON.stringify(bad);
    pinned(e, tag);
    assert.equal(e.texto, 'cliente #R7 debe S/ 50.00 en 2 créditos abiertos; el primero vence el 2026-11-05.', tag + ': se arma de nuevo con lo de la lista blanca');
  }
  // hacia la IA (segunda llamada): código neutro, sin nombre, DNI, teléfono, código real, otro cliente ni totales de la tienda
  for (const role of EMP) for (const stream of [false, true]) {
    const r = await chat(role, { tipo: 'deuda_cliente', cliente_id: 'R7' }, { text: ask('Explícame por qué debe tanto Rosa Prueba'), stream });
    const tag = role + (stream ? ' partes' : ''), toAi = r.toModel.join('\n');
    assert.equal(r.toModel.length, 2, tag);
    assert.ok(!PII_RE.test(toAi), tag + ': sin nombre, DNI ni teléfono hacia la IA');
    assert.ok(!/\bR[78]\b/.test(toAi), tag + ': sin el código real hacia la IA');
    assert.ok(!/999\.99|1049\.99|777\.77|555\.55|666\.66/.test(toAi), tag + ': sin otro cliente ni totales de la tienda hacia la IA');
  }
});
