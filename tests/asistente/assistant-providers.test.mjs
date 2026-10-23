// Capa de proveedores: adaptador OpenAI compatible (DeepSeek, OpenAI, xAI, OpenRouter, Groq, Mistral, Together), Anthropic y Gemini
// con los mismos eventos internos; config solo del Worker; bloque de Configuración solo del dueño. Sin red: fetch global prohibido.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PROVIDERS, PROVIDER_IDS, resolveProvider, configFor, checkBaseUrl, providerOverview, callModel, callModelStream, geminiSchema, PROVIDER_CHOICE_KEY } from '../../tools/cloudflare-lab/src/pos-assistant-providers.js';
import { providerRoute, PROVIDER_PATH } from '../../tools/cloudflare-lab/src/pos-assistant-provider-route.js';
import { assistantChatRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });

const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'sk-NO-DEBE-SALIR-1234567890';
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(200);
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
// Respuesta en partes de mentira. hang: no termina nunca (para probar el corte); cancel queda anotado.
function sseRes(chunks, { gap = 0, hang = false, status = 200 } = {}) {
  const st = { cancelled: false }; let i = 0;
  const body = new ReadableStream({ async pull(c) { if (i < chunks.length) { if (gap) await sleep(gap); c.enqueue(enc.encode(chunks[i++])); return; } if (hang) { await new Promise(() => {}); } c.close(); }, cancel() { st.cancelled = true; } }, { highWaterMark: 0 });
  const r = new Response(body, { status, headers: { 'content-type': 'text/event-stream' } }); r._st = st; return r;
}
function stub(make) {
  const calls = []; const f = async (url, init) => { calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body), signal: init.signal }); return make(calls.length, url, init); };
  f.calls = calls; return f;
}
const d = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const ev = (name, o) => 'event: ' + name + '\n' + d(o);

// Misma conversación (texto en dos trozos + una herramienta con argumentos en dos trozos) en los tres formatos.
const STREAMS = {
  openai: [d({ choices: [{ delta: { content: 'Hola ' } }] }), d({ choices: [{ delta: { content: 'mundo' } }] }),
    d({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'consultar', arguments: '{"tipo":' } }] } }] }),
    d({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"bajo_stock"}' } }] } }] }),
    d({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), 'data: [DONE]\n\n'],
  anthropic: [ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } }),
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hola ' } }), ev('ping', { type: 'ping' }),
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'mundo' } }),
    ev('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'consultar', input: {} } }),
    ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"tipo":' } }),
    ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"bajo_stock"}' } }),
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }), ev('message_stop', { type: 'message_stop' })],
  gemini: [d({ candidates: [{ content: { role: 'model', parts: [{ text: 'Hola ' }] } }] }), d({ candidates: [{ content: { role: 'model', parts: [{ text: 'mundo' }] } }] }),
    d({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'consultar', args: { tipo: 'bajo_stock' } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })]
};
const JSONS = {
  openai: { choices: [{ message: { content: 'Hola mundo', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'consultar', arguments: '{"tipo":"bajo_stock"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
  anthropic: { content: [{ type: 'text', text: 'Hola mundo' }, { type: 'tool_use', id: 'toolu_1', name: 'consultar', input: { tipo: 'bajo_stock' } }], usage: { input_tokens: 10, output_tokens: 5 } },
  gemini: { candidates: [{ content: { parts: [{ text: 'Hola mundo' }, { functionCall: { name: 'consultar', args: { tipo: 'bajo_stock' } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }
};
const ENV_OF = (id, extra = {}) => ({ AI_PROVIDER: id, [PROVIDERS[id].key]: KEY, ...extra });
const REQ = { model: 'x', messages: [{ role: 'system', content: 'Eres un asistente.' }, { role: 'user', content: '<datos_pos>{}</datos_pos>' }, { role: 'user', content: [{ type: 'text', text: 'lee' }, { type: 'image_url', image_url: { url: IMG, detail: 'auto' } }] }],
  tools: [{ type: 'function', function: { name: 'consultar', description: 'Consulta', parameters: { type: 'object', properties: { tipo: { type: 'string', enum: ['bajo_stock'] } }, required: ['tipo'], additionalProperties: false } } }],
  tool_choice: 'auto', thinking: { type: 'disabled' }, temperature: 0.2, max_tokens: 300, stream: false };

// ---------- Adaptadores ----------
for (const id of PROVIDER_IDS) {
  const kind = PROVIDERS[id].kind;
  test('adaptador ' + id + ' (' + kind + '): en partes, texto y herramienta armada al final, pedido con la forma del proveedor, sin red', async () => {
    const cfg = configFor(ENV_OF(id), id); assert.equal(cfg.ok, true);
    const f = stub(() => sseRes(STREAMS[kind])); const texts = []; let tools = 0;
    const r = await callModelStream(cfg, REQ, f, 2000, (t) => texts.push(t), () => tools++, null);
    assert.equal(r.error, undefined, JSON.stringify(r)); assert.equal(r.content, 'Hola mundo'); assert.deepEqual(texts, ['Hola ', 'mundo']); assert.ok(tools >= 1);
    assert.equal(r.calls.length, 1); assert.equal(r.calls[0].name, 'consultar'); assert.deepEqual(JSON.parse(r.calls[0].arguments), { tipo: 'bajo_stock' });
    assert.deepEqual(r.usage, { prompt_tokens: 10, completion_tokens: 5 });
    const c = f.calls[0], h = c.headers, b = c.body;
    if (kind === 'openai') {
      assert.equal(c.url, PROVIDERS[id].base + '/chat/completions'); assert.equal(h.authorization, 'Bearer ' + KEY); assert.equal(b.model, PROVIDERS[id].model); assert.equal(b.stream, true);
      assert.equal(b.tools[0].function.name, 'consultar'); assert.equal(b.messages[2].content[1].type, 'image_url');
      assert.equal('thinking' in b, id === 'deepseek', 'thinking solo para DeepSeek');
      if (id === 'openai') { assert.equal(b.max_completion_tokens, 300); assert.equal('max_tokens' in b, false); }
    } else if (kind === 'anthropic') {
      assert.equal(c.url, 'https://api.anthropic.com/v1/messages'); assert.equal(h['x-api-key'], KEY); assert.equal(h['anthropic-version'], '2023-06-01'); assert.equal(h.authorization, undefined);
      assert.equal(b.system, 'Eres un asistente.'); assert.equal(b.max_tokens, 300); assert.equal(b.stream, true);
      assert.equal(b.messages.length, 1, 'mensajes seguidos del mismo rol se juntan'); assert.equal(b.messages[0].role, 'user');
      const img = b.messages[0].content.find((x) => x.type === 'image'); assert.equal(img.source.type, 'base64'); assert.equal(img.source.media_type, 'image/jpeg');
      assert.equal(b.tools[0].name, 'consultar'); assert.equal(b.tools[0].input_schema.type, 'object'); assert.deepEqual(b.tool_choice, { type: 'auto' });
    } else {
      assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'); assert.equal(h['x-goog-api-key'], KEY); assert.ok(!c.url.includes(KEY), 'la clave nunca va en la URL');
      assert.equal(b.systemInstruction.parts[0].text, 'Eres un asistente.'); assert.equal(b.contents.length, 1); assert.equal(b.contents[0].role, 'user');
      assert.ok(b.contents[0].parts.some((p) => p.inlineData && p.inlineData.mimeType === 'image/jpeg'));
      assert.equal(b.tools[0].functionDeclarations[0].name, 'consultar'); assert.equal('additionalProperties' in b.tools[0].functionDeclarations[0].parameters, false); assert.equal(b.generationConfig.maxOutputTokens, 300);
    }
  });
}
for (const kind of ['openai', 'anthropic', 'gemini']) {
  const id = { openai: 'openai', anthropic: 'anthropic', gemini: 'gemini' }[kind];
  test(kind + ': sin partes (JSON) da el mismo resultado normalizado', async () => {
    const f = stub(() => jsonR(JSONS[kind])); const r = await callModel(configFor(ENV_OF(id), id), REQ, f, 2000);
    assert.equal(r.content, 'Hola mundo'); assert.equal(r.calls[0].name, 'consultar'); assert.deepEqual(JSON.parse(r.calls[0].arguments), { tipo: 'bajo_stock' }); assert.deepEqual(r.usage, { prompt_tokens: 10, completion_tokens: 5 });
    if (kind === 'gemini') assert.ok(f.calls[0].url.endsWith(':generateContent'));
  });
  test(kind + ': errores del proveedor -> códigos de siempre (429 ocupado, 401/500 error), sin texto del proveedor', async () => {
    const cfg = configFor(ENV_OF(id), id);
    const busy = kind === 'anthropic' ? [429, 529] : kind === 'gemini' ? [429, 503] : [429];
    for (const s of [...busy, 401, 403, 500, 400]) {
      const f = stub(() => jsonR({ error: { message: 'detalle interno ' + KEY } }, s));
      const a = await callModelStream(cfg, REQ, f, 2000, () => {}, null, null), b = await callModel(cfg, REQ, f, 2000);
      const want = busy.includes(s) ? 'upstream_busy' : 'upstream_error';
      assert.equal(a.error, want, s + ''); assert.equal(b.error, want, s + ''); assert.equal(a.status, s); assert.ok(!JSON.stringify(a).includes(KEY));
    }
    const thrown = await callModel(cfg, REQ, async () => { throw new TypeError('fetch failed'); }, 2000); assert.equal(thrown.error, 'upstream_error');
  });
  test(kind + ': error a mitad y corte sin fin -> error con lo recibido (partial), herramientas a medias no salen', async () => {
    const cfg = configFor(ENV_OF(id), id); const first = STREAMS[kind].slice(0, kind === 'anthropic' ? 3 : 1);
    const mid = kind === 'anthropic' ? ev('error', { type: 'error', error: { type: 'overloaded_error' } }) : d({ error: { code: kind === 'gemini' ? 500 : 'server_error', message: 'x' } });
    const r = await callModelStream(cfg, REQ, stub(() => sseRes([...first, mid])), 2000, () => {}, null, null);
    assert.equal(r.error, kind === 'anthropic' ? 'upstream_busy' : 'upstream_error'); assert.equal(r.partial, true); assert.equal(r.content, 'Hola ');
    const cut = await callModelStream(cfg, REQ, stub(() => sseRes(STREAMS[kind].slice(0, -1).filter((x) => !/finish|STOP/.test(x)))), 2000, () => {}, null, null);
    assert.equal(cut.error, 'upstream_error'); assert.equal(cut.partial, true); assert.equal(cut.calls, undefined);
  });
  test(kind + ': corte de afuera (celular ido / tope) y tiempo sin trozos -> upstream_timeout, se cancela la lectura', async () => {
    const cfg = configFor(ENV_OF(id), id); let res;
    const outer = new AbortController(); const f = stub(() => (res = sseRes(STREAMS[kind].slice(0, kind === 'anthropic' ? 3 : 1), { hang: true })));
    const p = callModelStream(cfg, REQ, f, 5000, () => {}, null, null, outer.signal); await sleep(40); outer.abort();
    const r = await p; assert.equal(r.error, 'upstream_timeout'); assert.equal(r.content, 'Hola '); assert.equal(res._st.cancelled, true); assert.equal(f.calls[0].signal.aborted, true);
    const idle = await callModelStream(cfg, REQ, stub(() => sseRes([], { hang: true })), 60, () => {}, null, null); assert.equal(idle.error, 'upstream_timeout');
    const pre = new AbortController(); pre.abort(); const j = await callModel(cfg, REQ, async (_u, init) => { if (init.signal.aborted) { const e = new Error('a'); e.name = 'AbortError'; throw e; } return jsonR(JSONS[kind]); }, 2000, pre.signal);
    assert.equal(j.error, 'upstream_timeout');
  });
  test(kind + ': herramienta prohibida para el empleado a mitad -> se corta ahí (guard igual para todos)', async () => {
    const cfg = configFor(ENV_OF(id), id); const r = await callModelStream(cfg, REQ, stub(() => sseRes(STREAMS[kind])), 2000, () => {}, null, (c) => (c.name === 'consultar' ? 'forbidden_role' : null));
    assert.equal(r.forbidden, 'forbidden_role'); assert.deepEqual(r.calls, []);
  });
}
test('segunda llamada sin herramientas: Anthropic y Gemini reciben las consultas viejas como texto (no piden la herramienta)', () => {
  const msgs = [{ role: 'user', content: 'cuánto hay' }, { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'consultar', arguments: '{"tipo":"bajo_stock"}' } }] }, { role: 'tool', tool_call_id: 'c1', content: '{"resumen":"3 productos"}' }];
  const fa = stub(() => jsonR(JSONS.anthropic)), fg = stub(() => jsonR(JSONS.gemini));
  return Promise.all([callModel(configFor(ENV_OF('anthropic'), 'anthropic'), { messages: msgs, max_tokens: 50 }, fa, 1000), callModel(configFor(ENV_OF('gemini'), 'gemini'), { messages: msgs, max_tokens: 50 }, fg, 1000)]).then(() => {
    const a = JSON.stringify(fa.calls[0].body), g = JSON.stringify(fg.calls[0].body);
    assert.ok(!a.includes('tool_use') && !a.includes('tool_result') && a.includes('3 productos')); assert.ok(!g.includes('functionCall') && !g.includes('functionResponse') && g.includes('3 productos'));
    // con herramientas: bloques nativos
    const withTools = { messages: msgs, tools: REQ.tools, max_tokens: 50 };
    return Promise.all([callModel(configFor(ENV_OF('anthropic'), 'anthropic'), withTools, fa, 1000), callModel(configFor(ENV_OF('gemini'), 'gemini'), withTools, fg, 1000)]).then(() => {
      assert.ok(JSON.stringify(fa.calls[1].body).includes('"tool_result"')); assert.ok(JSON.stringify(fg.calls[1].body).includes('"functionResponse"'));
      assert.equal(fg.calls[1].body.contents.find((c) => c.parts.some((p) => p.functionResponse)).parts[0].functionResponse.name, 'consultar');
    });
  });
});
test('esquema para Gemini: solo claves que entiende (type con null -> nullable)', () => {
  assert.deepEqual(geminiSchema({ type: 'object', additionalProperties: false, $schema: 'x', properties: { a: { type: ['string', 'null'], pattern: 'x' } }, required: ['a'] }),
    { type: 'object', properties: { a: { type: 'string', nullable: true } }, required: ['a'] });
});

// ---------- Configuración (solo secretos del Worker) ----------
test('config: proveedor, modelo y URL solo del Worker; AI_API_KEY solo para AI_PROVIDER; URL https de la lista salvo AI_ALLOW_CUSTOM_BASE=1', () => {
  assert.equal(resolveProvider({ DEEPSEEK_API_KEY: KEY }).id, 'deepseek', 'como antes: solo la clave de DeepSeek');
  assert.equal(resolveProvider({}).ok, false);
  const a = resolveProvider({ AI_PROVIDER: 'anthropic', AI_API_KEY: KEY, AI_MODEL: 'claude-sonnet-4-5' }); assert.equal(a.id, 'anthropic'); assert.equal(a.key, KEY); assert.equal(a.model, 'claude-sonnet-4-5');
  assert.equal(configFor({ AI_PROVIDER: 'anthropic', AI_API_KEY: KEY }, 'openai').reason, 'missing_key', 'la clave genérica no viaja a otro proveedor');
  assert.equal(resolveProvider({ AI_PROVIDER: 'nadie', AI_API_KEY: KEY }).reason, 'unknown_provider');
  assert.equal(resolveProvider({ AI_PROVIDER: 'openai' }).reason, 'missing_key');
  for (const bad of ['http://api.openai.com/v1', 'https://evil.example/v1', 'https://user:pw@api.openai.com/v1', 'https://api.openai.com/v1?x=1', 'javascript:alert(1)', 'nada'])
    assert.equal(resolveProvider(ENV_OF('openai', { AI_BASE_URL: bad })).reason, 'bad_base_url', bad);
  assert.equal(resolveProvider(ENV_OF('openai', { AI_BASE_URL: 'https://api.openai.com/v1/' })).base, 'https://api.openai.com/v1');
  assert.equal(resolveProvider(ENV_OF('openai', { AI_BASE_URL: 'https://proxy.mi-negocio.pe/v1', AI_ALLOW_CUSTOM_BASE: '1' })).base, 'https://proxy.mi-negocio.pe/v1');
  assert.equal(resolveProvider(ENV_OF('openai', { AI_BASE_URL: 'http://proxy.mi-negocio.pe/v1', AI_ALLOW_CUSTOM_BASE: '1' })).ok, false, 'https siempre');
  assert.equal(resolveProvider({ DEEPSEEK_API_KEY: KEY, DEEPSEEK_BASE_URL: 'http://127.0.0.1:4599' }).ok, false, 'el nombre viejo pasa la misma revisión');
  assert.equal(checkBaseUrl('https://api.x.ai/v1', {}), 'https://api.x.ai/v1');
  // fotos: según el modelo; AI_VISION lo fuerza
  assert.equal(configFor(ENV_OF('groq'), 'groq').vision, false); assert.equal(configFor(ENV_OF('gemini'), 'gemini').vision, true);
  assert.equal(configFor(ENV_OF('groq', { AI_VISION: '1' }), 'groq').vision, true); assert.equal(configFor(ENV_OF('openai', { AI_MODEL: 'gpt-3.5-turbo' }), 'openai').vision, false);
  // lo que ve el dueño: sin clave ni URL
  const o = providerOverview(ENV_OF('anthropic', { GEMINI_API_KEY: KEY + 'g', AI_BASE_URL: 'https://api.anthropic.com' }), null);
  const s = JSON.stringify(o); assert.ok(!s.includes(KEY) && !s.includes('https://') && !s.includes('_API_KEY'));
  assert.equal(o.providers.length, PROVIDER_IDS.length); assert.equal(o.providers.find((p) => p.id === 'anthropic').status, 'Conectado'); assert.equal(o.providers.find((p) => p.id === 'openai').status, 'Falta clave');
  assert.equal(o.current.provider, 'anthropic');
});

// ---------- Chat con cualquier proveedor: mismas puertas y filtros ----------
const SECRET = 'secreto-de-prueba-0123456789abcdef';
async function chat(body, { env = {}, role = 'owner', fetch, store } = {}) {
  return assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, ...env }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: store || createMemoryUsageStore(), resolveRole: async () => role, fetch, reader: { products: async () => [] }, audit: async () => {}, mockChunkMs: 0 });
}
async function events(r) { const out = []; const p = C.createSseParser((e, x) => out.push({ e, x })); const rd = r.body.getReader(), dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; p.feed(dec.decode(value, { stream: true })); } return out; }
const textStreams = {
  openai: (t) => [d({ choices: [{ delta: { content: t } }] }), d({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'],
  anthropic: (t) => [ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }), ev('message_stop', { type: 'message_stop' })],
  gemini: (t) => [d({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] })]
};
for (const id of ['xai', 'anthropic', 'gemini', 'mistral']) {
  const kind = PROVIDERS[id].kind;
  test('chat con ' + id + ': en partes para el dueño; el empleado recibe el costo tapado en cada trozo y en final; el celular no elige proveedor, URL ni clave', async () => {
    const f = stub(() => sseRes(textStreams[kind]('El costo es S/ 1.80 y el precio de venta es S/ 2.50. Hay 4 en stock.')));
    const sneaky = { provider: 'openai', base_url: 'https://evil.example', baseUrl: 'https://evil.example', api_key: 'sk-cliente', model: 'gpt-5', ai_provider: 'openai' };
    const own = await events(await chat({ text: 'hola', stream: true, ...sneaky }, { env: ENV_OF(id), fetch: f }));
    const fin = own.find((x) => x.e === 'final').x; assert.equal(fin.mode, id); assert.ok(fin.reply.includes('S/ 1.80'));
    assert.ok(f.calls[0].url.startsWith(PROVIDERS[id].base), f.calls[0].url); assert.ok(!JSON.stringify(f.calls[0]).includes('sk-cliente') && !JSON.stringify(f.calls[0]).includes('evil'));
    assert.ok(!JSON.stringify(own).includes(KEY), 'la clave nunca va al celular');
    const emp = await events(await chat({ text: 'hola', stream: true }, { env: ENV_OF(id), role: 'empleado:consultas', fetch: stub(() => sseRes(textStreams[kind]('El costo es S/ 1.80 y el precio de venta es S/ 2.50. Hay 4 en stock.'))) }));
    const seen = emp.filter((x) => x.e === 'text').map((x) => x.x.t || '').join('');
    assert.ok(!seen.includes('1.80') && seen.includes('S/ 2.50'), seen); assert.ok(!emp.find((x) => x.e === 'final').x.reply.includes('1.80'));
  });
}
test('foto: modelo sin lectura de fotos -> 422 «no disponible» sin cupo ni llamada; con Gemini la foto viaja; el empleado sigue con 403', async () => {
  const f = stub(() => jsonR(JSONS.openai)); const store = createMemoryUsageStore();
  const r = await chat({ text: 'lee', image: IMG }, { env: ENV_OF('groq'), fetch: f, store });
  assert.equal(r.status, 422); const b = await r.json(); assert.equal(b.error, 'image_unsupported'); assert.equal(b.message, 'Leer fotos no está disponible por ahora.');
  assert.equal(f.calls.length, 0); assert.equal(store._map.size, 0, 'sin cupo');
  const g = stub(() => jsonR(JSONS.gemini)); const ok = await chat({ text: 'lee', image: IMG }, { env: ENV_OF('gemini'), fetch: g });
  assert.equal(ok.status, 200); assert.ok(g.calls[0].body.contents.at(-1).parts.some((p) => p.inlineData));
  const e = await chat({ text: 'lee', image: IMG }, { env: ENV_OF('gemini'), role: 'empleado:consultas', fetch: g }); assert.equal(e.status, 403); assert.equal((await e.json()).error, 'image_owner_only');
});
test('falla cerrado: sin proveedor, sin clave o con URL mala -> 503 sin llamar; demostración igual que antes', async () => {
  for (const env of [{}, { AI_PROVIDER: 'openai' }, { AI_PROVIDER: 'nadie', AI_API_KEY: KEY }, ENV_OF('openai', { AI_BASE_URL: 'https://evil.example/v1' })]) {
    const f = stub(() => jsonR(JSONS.openai)); const r = await chat({ text: 'hola' }, { env, fetch: f });
    assert.equal(r.status, 503, JSON.stringify(env)); assert.equal((await r.json()).error, 'assistant_not_configured'); assert.equal(f.calls.length, 0);
  }
  const demo = await chat({ text: 'hola' }, { env: { ASSISTANT_DEMO: '1' }, fetch: stub(() => { throw new Error('no'); }) });
  assert.equal(demo.status, 200); assert.equal((await demo.json()).mode, 'mock');
  const ping = await chat({ ping: true }, { env: {} }); assert.equal(ping.status, 200, 'el ping no depende del proveedor');
});

// ---------- Bloque de Configuración: dueño, empleado, sin sesión ----------
const OWNER_ENV = { ASSISTANT_ENABLED: '1', AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: KEY, ANTHROPIC_API_KEY: KEY + 'a', GEMINI_API_KEY: KEY + 'g' };
async function route(method, sub, body, { role = 'owner', store, fetch, env = OWNER_ENV, auth = { principalId: 'dev-owner', posRole: 'owner' }, noResolve = false, now } = {}) {
  const r = await providerRoute(new Request('https://w.test' + PROVIDER_PATH + sub, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) }),
    env, auth, jsonR, { store: store || createMemoryUsageStore(), ...(noResolve ? {} : { resolveRole: async () => role }), fetch: fetch || stub(() => jsonR(JSONS.openai)), ...(now ? { now: () => now } : {}) });
  return { status: r.status, body: await r.json() };
}
test('dueño: ve la lista con Conectado / Falta clave (nunca la clave), prueba con una llamada chica y cambia con Confirmar (sin PIN)', async () => {
  const store = createMemoryUsageStore();
  const g = await route('GET', '', null, { store }); assert.equal(g.status, 200);
  assert.ok(!JSON.stringify(g.body).includes(KEY)); assert.equal(g.body.current.provider, 'deepseek');
  const st = Object.fromEntries(g.body.providers.map((p) => [p.id, p.status])); assert.equal(st.deepseek, 'Conectado'); assert.equal(st.anthropic, 'Conectado'); assert.equal(st.gemini, 'Conectado'); assert.equal(st.openai, 'Falta clave'); assert.equal(st.xai, 'Falta clave');
  // Probar
  const okF = stub(() => jsonR(JSONS.anthropic)); const t = await route('POST', '/test', { provider: 'anthropic' }, { store, fetch: okF });
  assert.equal(t.body.ok, true); assert.equal(t.body.status, 'Conectado'); assert.equal(okF.calls.length, 1); assert.ok(okF.calls[0].body.max_tokens <= 16); assert.equal(okF.calls[0].body.tools, undefined);
  assert.ok(!JSON.stringify(okF.calls[0].body).includes('datos_pos'), 'sin datos del negocio');
  const bad = await route('POST', '/test', { provider: 'gemini' }, { store, fetch: stub(() => jsonR({ error: { message: 'API key not valid ' + KEY } }, 400)) });
  assert.equal(bad.body.ok, false); assert.ok(!JSON.stringify(bad.body).includes(KEY));
  const denied = await route('POST', '/test', { provider: 'gemini' }, { store, fetch: stub(() => jsonR({}, 401)) }); assert.equal(denied.body.message, 'La clave no fue aceptada.');
  const miss = await route('POST', '/test', { provider: 'openai' }, { store }); assert.equal(miss.status, 409); assert.equal(miss.body.status, 'Falta clave');
  // Cambiar en dos pasos: «Usar» arma la tarjeta con operation_id del servidor; «Confirmar» la gasta UNA vez.
  assert.equal((await route('POST', '/select', { provider: 'openai' }, { store })).status, 409, 'sin clave no se arma tarjeta');
  assert.equal((await route('POST', '/select', { provider: 'nadie' }, { store })).status, 400);
  assert.equal((await route('POST', '/select', { provider: 'anthropic', model: 'modelo-inventado' }, { store })).body.error, 'unknown_model');
  assert.equal((await route('POST', '/select', { provider: 'anthropic', confirm: true }, { store })).body.error, 'operation_id_required', 'confirm:true solo ya no cambia nada');
  assert.equal((await route('POST', '/select', { operation_id: 'PRV-inventado', confirm: true }, { store })).body.error, 'bad_operation');
  const card = await route('POST', '/select', { provider: 'anthropic', base_url: 'https://evil.example', api_key: 'sk-cliente', key: 'x' }, { store });
  assert.equal(card.status, 200); assert.equal(card.body.confirm_required, true); assert.match(card.body.operation_id, /^PRV-/); assert.equal(card.body.expires_in_s, 300);
  assert.equal((await chat({ text: 'hola' }, { env: OWNER_ENV, fetch: stub(() => jsonR(JSONS.openai)), store }).then((r) => r.json())).mode, 'deepseek', 'armar la tarjeta no cambia nada');
  assert.equal((await route('POST', '/select', { operation_id: card.body.operation_id, confirm: true }, { store, auth: { principalId: 'otro-dueno', posRole: 'owner' } })).body.error, 'bad_operation', 'otro aparato no la usa');
  assert.equal((await route('POST', '/select', { operation_id: card.body.operation_id, provider: 'gemini', confirm: true }, { store })).body.error, 'bad_operation', 'no se cambia el proveedor en el Confirmar');
  const sel = await route('POST', '/select', { operation_id: card.body.operation_id, confirm: true }, { store });
  assert.equal(sel.status, 200); assert.equal(sel.body.current.provider, 'anthropic');
  const again = await route('POST', '/select', { operation_id: card.body.operation_id, confirm: true }, { store });
  assert.equal(again.status, 409); assert.equal(again.body.error, 'already_confirmed', 'repetido: rechazado');
  const saved = (await store.get(PROVIDER_CHOICE_KEY)).value; assert.deepEqual(Object.keys(saved).sort(), ['at', 'model', 'provider']); assert.equal(saved.provider, 'anthropic'); assert.ok(!JSON.stringify(saved).includes('evil') && !JSON.stringify(saved).includes('sk-'));
  // El chat usa lo elegido (misma tienda de ajustes)
  const f = stub(() => jsonR({ content: [{ type: 'text', text: 'Listo, hola.' }], usage: { input_tokens: 1, output_tokens: 1 } }));
  const r = await chat({ text: 'hola' }, { env: OWNER_ENV, fetch: f, store }); assert.equal(r.status, 200); assert.equal((await r.json()).mode, 'anthropic'); assert.ok(f.calls[0].url.startsWith('https://api.anthropic.com'));
  // Si quitan la clave del elegido, vuelve a lo del Worker (no queda roto)
  const { ANTHROPIC_API_KEY, ...noA } = OWNER_ENV; void ANTHROPIC_API_KEY;
  const f2 = stub(() => jsonR(JSONS.openai)); const r2 = await chat({ text: 'hola' }, { env: noA, fetch: f2, store }); assert.equal((await r2.json()).mode, 'deepseek');
  // tope de pruebas
  let last; for (let i = 0; i < 8; i++) last = await route('POST', '/test', { provider: 'anthropic' }, { store, fetch: okF }); assert.equal(last.status, 429);
});
test('Usar: la tarjeta vence a los 5 minutos (410) y no se puede usar después; dos Confirmar a la vez = un solo cambio', async () => {
  const store = createMemoryUsageStore(), t0 = Date.parse('2026-10-17T10:00:00Z');
  const card = await route('POST', '/select', { provider: 'gemini' }, { store, now: t0 });
  const late = await route('POST', '/select', { operation_id: card.body.operation_id, confirm: true }, { store, now: t0 + 5 * 60 * 1000 + 1 });
  assert.equal(late.status, 410); assert.equal(late.body.error, 'confirm_expired');
  assert.equal((await store.get(PROVIDER_CHOICE_KEY)).value.provider, undefined, 'nada guardado');
  const card2 = await route('POST', '/select', { provider: 'gemini' }, { store, now: t0 });
  const ok = await route('POST', '/select', { operation_id: card2.body.operation_id, confirm: true }, { store, now: t0 + 4 * 60 * 1000 }); assert.equal(ok.status, 200);
  const replayLater = await route('POST', '/select', { operation_id: card2.body.operation_id, confirm: true }, { store, now: t0 + 10 * 60 * 1000 }); assert.equal(replayLater.status, 409);
  // una tarjeta nueva reemplaza a la anterior
  const a = await route('POST', '/select', { provider: 'anthropic' }, { store, now: t0 }), b = await route('POST', '/select', { provider: 'gemini' }, { store, now: t0 });
  assert.equal((await route('POST', '/select', { operation_id: a.body.operation_id, confirm: true }, { store, now: t0 })).body.error, 'bad_operation');
  const both = await Promise.all([route('POST', '/select', { operation_id: b.body.operation_id, confirm: true }, { store, now: t0 }), route('POST', '/select', { operation_id: b.body.operation_id, confirm: true }, { store, now: t0 })]);
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
});
test('Probar: el tope de 6 por minuto es por aparato Admin, no global; si no se puede contar, no se prueba', async () => {
  const store = createMemoryUsageStore(), f = stub(() => jsonR(JSONS.openai)), A = { principalId: 'dueno-1', posRole: 'owner' }, B = { principalId: 'dueno-2', posRole: 'owner' };
  for (let i = 0; i < 6; i++) assert.equal((await route('POST', '/test', { provider: 'deepseek' }, { store, fetch: f, auth: A })).status, 200);
  assert.equal((await route('POST', '/test', { provider: 'deepseek' }, { store, fetch: f, auth: A })).status, 429);
  assert.equal((await route('POST', '/test', { provider: 'deepseek' }, { store, fetch: f, auth: B })).status, 200, 'otro aparato Admin sigue pudiendo');
  const stuck = { get: store.get, put: async () => false }; const g = stub(() => jsonR(JSONS.openai));
  const r = await route('POST', '/test', { provider: 'deepseek' }, { store: stuck, fetch: g, auth: { principalId: 'dueno-3', posRole: 'owner' } }); assert.equal(r.status, 503); assert.equal(g.calls.length, 0);
});
test('empleado y sin sesión: 403 en todo el bloque, sin llamar al proveedor ni guardar nada', async () => {
  for (const opt of [{ role: 'empleado:consultas' }, { role: 'empleado:consultas_documentos' }, { role: 'sin_rol' }, { role: 'empleado:off' }, { noResolve: true, auth: null }, { noResolve: true, auth: { principalId: 'x', posRole: 'owner' } }]) {
    const store = createMemoryUsageStore(), f = stub(() => jsonR(JSONS.openai));
    for (const [m, sub, b] of [['GET', '', null], ['POST', '/test', { provider: 'deepseek' }], ['POST', '/select', { provider: 'anthropic', confirm: true }]]) {
      const r = await route(m, sub, b, { ...opt, store, fetch: f }); assert.equal(r.status, 403, JSON.stringify(opt) + sub); assert.equal(r.body.error, 'admin_only'); assert.ok(!JSON.stringify(r.body).includes('Conectado'));
    }
    assert.equal(f.calls.length, 0); assert.equal(store._map.size, 0);
  }
  assert.equal((await route('GET', '', null, { env: {} })).status, 404, 'asistente apagado: 404');
});
test('celular: el bloque solo se arma para el dueño, sin campos de clave ni URL; cambio con tarjeta Confirmar; textos de error simples', async () => {
  const { readFileSync } = await import('node:fs');
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  const block = UI.slice(UI.indexOf('function decorateProvider'), UI.indexOf('// ---------- Aparatos de dueño'));
  assert.ok(block.length > 500); assert.ok(!/api_?key|base_?url|type="password"|<input/i.test(block), 'nunca se escribe una clave ni una URL en el celular');
  assert.match(block, /data-act="confirm"[^]*Confirmar/); assert.match(block, /isOwnerAccess\(\)/); assert.match(UI, /decorateProvider\(host\)/);
  assert.match(UI, /function decorateConfig\(\) \{\s*if \(offHere\(\) \|\| !isOwnerAccess\(\)/);
  const PERM = readFileSync(new URL('../../POS/js/config/pos-permissions.js', import.meta.url), 'utf8');
  assert.match(PERM, /'\/auth\/assistant\/provider', methods: \['GET'\], roles: owner/);
  const CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8'); assert.match(CORE, /image_unsupported: \['Leer fotos no está disponible por ahora\.'\]/);
});

// ---------- Bot 3 P2: foto con un modelo sin fotos se corta ANTES de leer el cuerpo; el ping dice si hay fotos ----------
// Pedido de mentira que cuenta lo que el servidor leyó del cuerpo (1,32 MB, como la foto de Bot 3).
function countingReq({ query = '', headers = {}, bytes = 1_320_000, chunk = 16_384, body } = {}) {
  const st = { read: 0, cancelled: false, textCalled: false };
  const payload = enc.encode(body ?? JSON.stringify({ text: 'lee', image: 'data:image/jpeg;base64,' + 'A'.repeat(Math.max(0, bytes - 60)) }));
  let off = 0;
  const stream = new ReadableStream({ pull(c) { if (off >= payload.length) { c.close(); return; } const v = payload.slice(off, off + chunk); off += v.length; st.read += v.length; c.enqueue(v); }, cancel() { st.cancelled = true; } }, { highWaterMark: 0 });
  const h = new Headers({ 'content-type': 'application/json', ...headers });
  const req = { method: 'POST', url: 'https://w.test/auth/assistant/chat' + query, headers: h, body: stream, text: async () => { st.textCalled = true; return new TextDecoder().decode(payload); } };
  return { req, st };
}
async function chatRaw(req, { env, role = 'owner', fetch, store }) {
  return assistantChatRoute(req, { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, ...env }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: store || createMemoryUsageStore(), resolveRole: async () => role, fetch, reader: { products: async () => [] }, audit: async () => {} });
}
test('Bot 3: modelo sin fotos + foto declarada (?image=1, x-assistant-image o tamaño declarado) -> 422 sin leer NADA del cuerpo, sin cupo ni llamada', async () => {
  for (const opt of [{ query: '?image=1' }, { headers: { 'x-assistant-image': '1' } }, { headers: { 'content-length': '1320000' } }, { headers: { 'content-type': 'image/jpeg' } }]) {
    const { req, st } = countingReq(opt); const f = stub(() => jsonR(JSONS.openai)); const store = createMemoryUsageStore();
    const r = await chatRaw(req, { env: ENV_OF('groq'), fetch: f, store });
    assert.equal(r.status, 422, JSON.stringify(opt)); const b = await r.json(); assert.equal(b.error, 'image_unsupported'); assert.equal(b.message, 'Leer fotos no está disponible por ahora.');
    assert.equal(st.read, 0, 'no se leyó el cuerpo: ' + JSON.stringify(opt)); assert.equal(st.textCalled, false); assert.equal(f.calls.length, 0); assert.equal(store._map.size, 0);
  }
});
test('Bot 3: sin aviso ni tamaño, el servidor lee como mucho ~256 KB, corta la lectura y responde 422 (nunca los 1,32 MB)', async () => {
  const { req, st } = countingReq(); const f = stub(() => jsonR(JSONS.openai));
  const r = await chatRaw(req, { env: ENV_OF('groq'), fetch: f });
  assert.equal(r.status, 422); assert.ok(st.read <= 256_000 + 16_384, 'leído ' + st.read); assert.equal(st.cancelled, true); assert.equal(st.textCalled, false); assert.equal(f.calls.length, 0);
  // foto chica sin aviso: se lee (es chica) y el campo image la delata
  const small = countingReq({ bytes: 20_000 }); const r2 = await chatRaw(small.req, { env: ENV_OF('groq'), fetch: f }); assert.equal(r2.status, 422); assert.equal(f.calls.length, 0);
});
test('Bot 3: sin foto, el modelo sin fotos sigue respondiendo; con un modelo que lee fotos, ?image=1 sube y llega al proveedor', async () => {
  const t = countingReq({ body: JSON.stringify({ text: 'hola' }) }); const f = stub(() => jsonR(JSONS.openai));
  const r = await chatRaw(t.req, { env: ENV_OF('groq'), fetch: f }); assert.equal(r.status, 200); assert.ok(f.calls.length >= 1); assert.ok(!JSON.stringify(f.calls[0].body).includes('image_url'));
  const g = stub(() => jsonR(JSONS.gemini)); const p = countingReq({ query: '?image=1', bytes: 300_000 });
  const r2 = await chatRaw(p.req, { env: ENV_OF('gemini'), fetch: g }); assert.equal(r2.status, 200); assert.ok(g.calls[0].body.contents.at(-1).parts.some((x) => x.inlineData));
  // el empleado sigue con su 403 (antes de leer)
  const e = countingReq({ query: '?image=1' }); const r3 = await chatRaw(e.req, { env: ENV_OF('gemini'), role: 'empleado:consultas', fetch: g }); assert.equal(r3.status, 403); assert.equal(e.st.read, 0);
});
test('Bot 3: el ping dice si el modelo en uso lee fotos (vision), sin nombre de proveedor ni modelo; empleado siempre false', async () => {
  const ping = async (env, role = 'owner') => { const r = await chat({ ping: true }, { env, role }); assert.equal(r.status, 200); return r.json(); };
  assert.equal((await ping(ENV_OF('groq'))).vision, false); assert.equal((await ping(ENV_OF('gemini'))).vision, true);
  assert.equal((await ping(ENV_OF('groq', { AI_VISION: '1' }))).vision, true); assert.equal((await ping(ENV_OF('gemini'), 'empleado:consultas')).vision, false);
  assert.equal((await ping({ ASSISTANT_DEMO: '1' })).vision, true, 'demostración como antes'); assert.equal((await ping({})).vision, false, 'sin proveedor');
  const b = await ping(ENV_OF('anthropic')); assert.deepEqual(Object.keys(b), ['ok', 'enabled', 'role', 'level', 'vision', 'cambios']); assert.ok(!/anthropic|claude|groq|gemini/i.test(JSON.stringify(b)));
});
test('Bot 3: el celular no sube la foto si el ping dijo vision:false (frase simple) y avisa ?image=1 cuando sí la manda', async () => {
  const { readFileSync } = await import('node:fs');
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  const sendFn = UI.slice(UI.indexOf('  async function send(text, image) {'), UI.indexOf('  // Comprime en el aparato'));
  const a = sendFn.indexOf("if (image && access && access.vision === false) { addMsg('u', text || 'Foto'); errMsg('image_unsupported'); setState('error', 2600); return; }");
  assert.ok(a > 0 && a < sendFn.indexOf('reqInit(') && a < sendFn.indexOf('busy = true') && a < sendFn.indexOf('body.image = image'), 'antes de armar o mandar el pedido');
  assert.match(sendFn, /reqInit\('\/auth\/assistant\/chat' \+ \(image \? '\?image=1' : ''\), body\)/); assert.match(sendFn, /post\('\/auth\/assistant\/chat' \+ \(image \? '\?image=1' : ''\), body/);
  assert.match(UI, /access = \{ role: d\.role === 'owner' \? 'owner' : 'empleado', level: d\.level, vision: d\.vision !== false \}/);
  const f = C.friendlyError('image_unsupported'); assert.equal(f.msg, 'Leer fotos no está disponible por ahora.'); assert.equal(f.retry, false);
});
