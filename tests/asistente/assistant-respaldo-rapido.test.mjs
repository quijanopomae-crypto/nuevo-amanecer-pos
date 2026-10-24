// Lentitud 22-10 (paso 4): la segunda llamada (explicar una consulta) no pasa a modelos gratis; espera sin datos al empezar: 12 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { callModelStream, configFor, isFreeModel, FIRST_DATA_MS } from '../../tools/cloudflare-lab/src/pos-assistant-providers.js';

const SECRET = 'secreto-de-prueba-0123456789abcdef';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READER = { products: async () => [{ id: 'A', nombre: 'Arroz', controla: true, stock: 0, min: 5, precio: 4 }] };
const tool = { id: 'c1', type: 'function', function: { name: 'consultar', arguments: JSON.stringify({ tipo: 'bajo_stock' }) } };
const quiet = (t) => { const o = console.log; console.log = () => {}; t.after(() => { console.log = o; }); };
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, OHMYAGENT_API_KEY: 'k1', ROUTEWAY_API_KEY: 'k2' };

test('catálogo: el respaldo de OhMyAgent son modelos gratis de Routeway (por eso se cortan en la segunda llamada)', () => {
  const c = configFor(ENV, 'ohmyagent');
  assert.ok(c.ok); assert.ok(c.fallbacks.length >= 1);
  assert.ok(c.fallbacks.every((f) => f.id === 'routeway' && isFreeModel(f.model)), JSON.stringify(c.fallbacks.map((f) => f.model)));
  assert.equal(isFreeModel('gpt-6.1-sol'), false); assert.equal(FIRST_DATA_MS, 12000);
});

test('segunda llamada con OhMyAgent ocupado: NO pasa a Routeway gratis; queda el texto armado con los números', async (t) => {
  quiet(t); const urls = [];
  const fetch = async (url, init) => { urls.push(url); const b = JSON.parse(init.body);
    if (b.tools) return jsonR({ choices: [{ message: { content: '', tool_calls: [tool] } }] }); // 1.ª llamada (sin partes): pide la consulta
    return new Response('{}', { status: 429 }); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: '¿qué falta y por qué?' }) }), ENV, { principalId: 'session:o', posRole: 'owner' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', fetch, reader: READER, audit: async () => {} });
  const body = await r.json();
  assert.equal(r.status, 200); assert.match(body.reply, /Hay 1 producto/);
  assert.equal(urls.filter((u) => /routeway/.test(u)).length, 0, 'sin Routeway: ' + urls.join(' '));
  assert.equal(urls.length, 3, '1.ª llamada + 2 intentos al mismo modelo pagado');
  assert.equal(body.timings.fallback, false);
});

test('primera llamada con OhMyAgent ocupado: el respaldo a Routeway SIGUE (si no, no habría respuesta)', async (t) => {
  quiet(t); const urls = [];
  const fetch = async (url) => { urls.push(url); return /routeway/.test(url) ? jsonR({ choices: [{ message: { content: 'Hola.' } }] }) : new Response('{}', { status: 503 }); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: 'hola' }) }), ENV, { principalId: 'session:o', posRole: 'owner' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', fetch, reader: READER, audit: async () => {} });
  assert.equal(r.status, 200); assert.equal((await r.json()).reply, 'Hola.'); assert.ok(urls.some((u) => /routeway/.test(u)));
});

function slowStream(firstDelay, gap) { return async (_u, init) => {
  await new Promise((ok, no) => { const tm = setTimeout(ok, firstDelay); init.signal.addEventListener('abort', () => { clearTimeout(tm); no(Object.assign(new Error('abort'), { name: 'AbortError' })); }, { once: true }); });
  let i = 0; const parts = ['data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hola ' } }] }) + '\n\n', 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Admin.' }, finish_reason: 'stop' }] }) + '\n\n', 'data: [DONE]\n\n'];
  return new Response(new ReadableStream({ async pull(c) { if (i) await sleep(gap); if (i < parts.length) c.enqueue(enc.encode(parts[i++])); else c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); }; }

test('espera sin datos: sin un byte en firstMs se corta (sin pasar a otro modelo); después del primer trozo manda idleMs', async () => {
  const cfg = { ...configFor({ OHMYAGENT_API_KEY: 'k' }, 'ohmyagent'), fallbacks: [] };
  const req = { messages: [{ role: 'user', content: 'hola' }] };
  let t0 = Date.now(); const cut = await callModelStream(cfg, req, slowStream(400, 0), 5000, () => {}, null, null, undefined, { firstMs: 60 });
  assert.equal(cut.error, 'upstream_timeout'); assert.ok(Date.now() - t0 < 300, 'cortó a los ~60 ms: ' + (Date.now() - t0));
  t0 = Date.now(); const ok = await callModelStream(cfg, req, slowStream(20, 120), 1000, () => {}, null, null, undefined, { firstMs: 60 });
  assert.equal(ok.content, 'Hola Admin.', 'pausa de 120 ms entre trozos > firstMs pero < idleMs: sigue');
});

test('con foto la espera inicial no se acorta (firstMs = idleMs)', async () => {
  const cfg = { ...configFor({ OHMYAGENT_API_KEY: 'k' }, 'ohmyagent'), fallbacks: [] };
  const req = { messages: [{ role: 'user', content: [{ type: 'text', text: 'lee' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] }] };
  const ok = await callModelStream(cfg, req, slowStream(150, 0), 400, () => {}, null, null, undefined);
  assert.equal(ok.content, 'Hola Admin.');
});

test('stallMs (segunda llamada): corta una pausa SIN DATOS a mitad del flujo, pero no pone tope al tiempo total', async () => {
  const cfg = { ...configFor({ OHMYAGENT_API_KEY: 'k' }, 'ohmyagent'), fallbacks: [] };
  const req = { messages: [{ role: 'user', content: 'hola' }] };
  const cut = await callModelStream(cfg, req, slowStream(10, 250), 5000, () => {}, null, null, undefined, { stallMs: 80 });
  assert.equal(cut.error, 'upstream_timeout'); assert.equal(cut.partial, true, 'llegó «Hola » y luego 250 ms sin nada > 80 ms');
  // 3 trozos con pausas de 60 ms (< 80) suman más de 80 ms en total: no se corta.
  const t0 = Date.now(); const ok = await callModelStream(cfg, req, slowStream(60, 60), 5000, () => {}, null, null, undefined, { stallMs: 80 });
  assert.equal(ok.content, 'Hola Admin.'); assert.ok(Date.now() - t0 > 80, 'el total pasó de stallMs: ' + (Date.now() - t0));
});

test('stallMs con foto: no se acorta (manda idleMs, como antes)', async () => {
  const cfg = { ...configFor({ OHMYAGENT_API_KEY: 'k' }, 'ohmyagent'), fallbacks: [] };
  const req = { messages: [{ role: 'user', content: [{ type: 'text', text: 'lee' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] }] };
  const ok = await callModelStream(cfg, req, slowStream(10, 150), 1000, () => {}, null, null, undefined, { stallMs: 50 });
  assert.equal(ok.content, 'Hola Admin.');
});

test('ruta en partes: la segunda llamada usa el corte por espera sin datos (deps.firstDataMs); la primera no', async (t) => {
  quiet(t); let n = 0;
  const sse = (chunks, gap) => new Response(new ReadableStream({ async start(c) { for (let i = 0; i < chunks.length; i++) { if (i) await sleep(gap); c.enqueue(enc.encode(chunks[i])); } c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const d = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
  const fetch = async () => { n++;
    if (n === 1) return sse([d({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'consultar', arguments: JSON.stringify({ tipo: 'bajo_stock' }) } }] } }] }), d({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), 'data: [DONE]\n\n'], 150); // 1.ª: pausas de 150 ms, sigue
    return sse([d({ choices: [{ delta: { content: 'Explico ' } }] }), d({ choices: [{ delta: { content: 'todo.' }, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'], 400); }; // 2.ª: se queda 400 ms sin datos
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: '¿qué falta y por qué?', stream: true }) }), ENV, { principalId: 'session:o', posRole: 'owner' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', fetch, reader: READER, audit: async () => {}, firstDataMs: 100, timeoutMs: 5000 });
  const txt = await r.text();
  assert.match(txt, /Hay 1 producto/, 'la 2.ª se cortó: queda el texto con los números');
  assert.doesNotMatch(txt, /todo\./);
  assert.ok(n >= 2);
});
