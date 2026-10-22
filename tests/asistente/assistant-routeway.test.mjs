// (22-10) Routeway como proveedor por defecto (solo configuración; la clave es secreto del Worker), 429 con espera y modelo de respaldo,
// <think>…</think> fuera antes de la redacción, y markdown simple fuera en pantalla con paridad partes = entero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PROVIDERS, configFor, resolveProvider, providerOverview, modelsFor, callModel, callModelStream, createThinkStripper, stripThink, ALLOWED_HOSTS, RETRY_WAITS_MS } from '../../tools/cloudflare-lab/src/pos-assistant-providers.js';
import { assistantChatRoute, createMemoryUsageStore, OWNER_DATA_LABEL } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const KEY = 'clave-de-prueba-routeway';
const jsonR = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', ...h } });
const enc = new TextEncoder();
const sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const delta = (d, fin) => sse({ choices: [{ delta: d, ...(fin ? { finish_reason: fin } : {}) }] });
const streamR = (chunks) => { let i = 0; return new Response(new ReadableStream({ pull(c) { if (i < chunks.length) c.enqueue(enc.encode(chunks[i++])); else { c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
const okJson = (content) => jsonR({ choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 2 } });

test('Routeway: valores por defecto (base compatible OpenAI, gemma :free con respaldo minimax :free); la clave solo del Worker', () => {
  const p = PROVIDERS.routeway;
  assert.equal(p.kind, 'openai'); assert.equal(p.base, 'https://api.routeway.ai/v1'); assert.equal(p.key, 'ROUTEWAY_API_KEY');
  assert.equal(p.model, 'gemma-4-26b-a4b-it-luminous:free'); assert.deepEqual(p.fallbacks, ['minimax-m2.7:free']);
  assert.ok(ALLOWED_HOSTS.includes('api.routeway.ai'));
  assert.equal(configFor({}, 'routeway').reason, 'missing_key', 'sin secreto no hay proveedor (no hay clave en el código)');
  const c = configFor({ ROUTEWAY_API_KEY: KEY }, 'routeway');
  assert.equal(c.ok, true); assert.equal(c.model, 'gemma-4-26b-a4b-it-luminous:free'); assert.deepEqual(c.fallbacks.map((x) => x.model), ['minimax-m2.7:free']);
  assert.equal(configFor({ AI_PROVIDER: 'routeway', AI_API_KEY: KEY }, 'routeway').ok, true, 'también con AI_API_KEY');
  // por defecto: Routeway si tiene clave; si no, DeepSeek como antes
  assert.equal(resolveProvider({ ROUTEWAY_API_KEY: KEY, DEEPSEEK_API_KEY: 'd' }).id, 'routeway', 'sin OhMyAgent: Routeway');
  assert.equal(resolveProvider({ DEEPSEEK_API_KEY: 'd' }).id, 'deepseek');
  assert.equal(resolveProvider({ AI_PROVIDER: 'deepseek', ROUTEWAY_API_KEY: KEY, DEEPSEEK_API_KEY: 'd' }).id, 'deepseek', 'AI_PROVIDER manda');
  assert.deepEqual(modelsFor({ ROUTEWAY_API_KEY: KEY }, 'routeway'), ['gemma-4-26b-a4b-it-luminous:free', 'minimax-m2.7:free']);
  const ov = JSON.stringify(providerOverview({ ROUTEWAY_API_KEY: KEY }));
  assert.ok(!ov.includes(KEY) && !ov.includes('api.routeway.ai'), 'la vista del Admin no lleva clave ni URL');
  const src = readFileSync('tools/cloudflare-lab/src/pos-assistant-providers.js', 'utf8');
  assert.ok(!/\b(?:sk|rw|key)-[A-Za-z0-9]{16,}/.test(src), 'ninguna clave escrita en el código');
});

test('429: reintento con espera en el mismo modelo y paso al modelo de respaldo (JSON); otros errores no se reintentan', async () => {
  const seen = []; const cfg = { ...configFor({ ROUTEWAY_API_KEY: KEY }, 'routeway'), retryWaits: [40, 40] };
  let t0 = Date.now();
  let r = await callModel(cfg, { messages: [{ role: 'user', content: 'hola' }] }, async (u, init) => { const b = JSON.parse(init.body); seen.push(b.model);
    assert.equal(u, 'https://api.routeway.ai/v1/chat/completions'); assert.equal(init.headers.authorization, 'Bearer ' + KEY);
    return b.model === 'minimax-m2.7:free' ? okJson('Listo.') : jsonR({ error: { message: 'rate' } }, 429); }, 5000);
  assert.deepEqual(seen, ['gemma-4-26b-a4b-it-luminous:free', 'gemma-4-26b-a4b-it-luminous:free', 'minimax-m2.7:free']);
  assert.equal(r.content, 'Listo.'); assert.equal(r.model, 'minimax-m2.7:free'); assert.ok(Date.now() - t0 >= 35, 'esperó antes de reintentar');
  // todo 429: 4 intentos (2 por modelo) y «ocupado»
  seen.length = 0; r = await callModel(cfg, { messages: [] }, async (_u, init) => { seen.push(JSON.parse(init.body).model); return jsonR({}, 429); }, 5000);
  assert.equal(seen.length, 4); assert.equal(r.error, 'upstream_busy');
  // el reintento sí funciona en el mismo modelo
  seen.length = 0; let n = 0; r = await callModel(cfg, { messages: [] }, async (_u, init) => { seen.push(JSON.parse(init.body).model); return n++ ? okJson('ok') : jsonR({}, 429); }, 5000);
  assert.deepEqual(seen, ['gemma-4-26b-a4b-it-luminous:free', 'gemma-4-26b-a4b-it-luminous:free']); assert.equal(r.content, 'ok'); assert.equal(r.model, undefined);
  // 401, 403, 404 o 400: sin reintento; 5xx: igual que 429 (2 por modelo)
  for (const st of [400, 401, 403, 404]) { n = 0; r = await callModel(cfg, { messages: [] }, async () => { n++; return jsonR({}, st); }, 5000); assert.equal(n, 1, String(st)); }
  for (const st of [500, 502, 503]) { n = 0; r = await callModel(cfg, { messages: [] }, async () => { n++; return jsonR({}, st); }, 5000); assert.equal(n, 4, String(st)); }
  // Retry-After corto se respeta (1 s)
  n = 0; t0 = Date.now(); r = await callModel({ ...cfg, fallbacks: [] }, { messages: [] }, async () => (n++ ? okJson('ya') : jsonR({}, 429, { 'retry-after': '1' })), 5000);
  assert.equal(r.content, 'ya'); assert.ok(Date.now() - t0 >= 950, 'Retry-After 1 s');
  // la espera se corta si el pedido se corta (tope de 90 s / celular ido)
  const ac = new AbortController(); n = 0; t0 = Date.now(); setTimeout(() => ac.abort(), 30);
  r = await callModel({ ...cfg, retryWaits: [5000, 5000] }, { messages: [] }, async () => { n++; return jsonR({}, 429); }, 5000, ac.signal);
  assert.ok(Date.now() - t0 < 1000); assert.equal(n, 1); assert.ok(r.error);
  assert.deepEqual([...RETRY_WAITS_MS], [800, 1500], 'esperas cortas por defecto');
});

test('429 en partes: nada se pinta del intento fallido; el respaldo responde en partes; un 429 dentro del canal antes del texto también pasa al respaldo', async () => {
  const cfg = { ...configFor({ ROUTEWAY_API_KEY: KEY }, 'routeway'), retryWaits: [0, 0] };
  const seen = []; let out = '';
  let r = await callModelStream(cfg, { messages: [] }, async (_u, init) => { const m = JSON.parse(init.body).model; seen.push(m);
    if (m !== 'minimax-m2.7:free') return seen.length === 1 ? jsonR({}, 429) : streamR([sse({ error: { type: 'rate_limit', code: 429 } })]);
    return streamR([delta({ content: 'Hay ' }), delta({ content: '12 arroz.' }), delta({}, 'stop')]); }, 5000, (t) => { out += t; });
  assert.deepEqual(seen, ['gemma-4-26b-a4b-it-luminous:free', 'gemma-4-26b-a4b-it-luminous:free', 'minimax-m2.7:free']);
  assert.equal(out, 'Hay 12 arroz.'); assert.equal(r.content, 'Hay 12 arroz.'); assert.equal(r.model, 'minimax-m2.7:free');
  // si ya salió texto, un corte no se reintenta (no se repite nada en pantalla)
  seen.length = 0; out = '';
  r = await callModelStream(cfg, { messages: [] }, async (_u, init) => { seen.push(1); return streamR([delta({ content: 'Hola' }), sse({ error: { type: 'rate_limit' } })]); }, 5000, (t) => { out += t; });
  assert.equal(seen.length, 1); assert.equal(out, 'Hola'); assert.equal(r.partial, true);
});

test('<think>…</think>: fuera en JSON y en partes (corte en cualquier carácter), sin cierre se descarta, «</think>» suelto se quita', async () => {
  const cases = [
    ['<think>El costo es S/ 3.00, no decirlo.</think>\n\nHay 12 unidades.', 'Hay 12 unidades.'],
    ['<THINKING>a<b</THINKING>Listo <b>ok</b>', 'Listo <b>ok</b>'],
    ['Antes <think>x</think> después', 'Antes  después'],
    ['Hola <think>sin cierre S/ 9.99', 'Hola '],
    ['razono S/ 1.00</think>Respuesta', 'razono S/ 1.00Respuesta'],
    ['a < b y <thin pero no es etiqueta', 'a < b y <thin pero no es etiqueta'],
    ['sin nada raro', 'sin nada raro']
  ];
  for (const [inp, want] of cases) {
    assert.equal(stripThink(inp), want, inp);
    for (let s = 1; s <= 9; s++) { const t = createThinkStripper(); let o = ''; for (let i = 0; i < inp.length; i += s) o += t.push(inp.slice(i, i + s)); o += t.flush(); assert.equal(o, want, s + ' ' + inp); }
  }
  const cfg = { ...configFor({ ROUTEWAY_API_KEY: KEY }, 'routeway'), retryWaits: [0, 0] };
  const r = await callModel(cfg, { messages: [] }, async () => okJson('<think>pienso</think>\nHola.'), 5000);
  assert.equal(r.content, 'Hola.');
  const full = '<think>El costo fue S/ 2.10 y el margen 30%</think>\n\nHay 8 de arroz. <thi';
  for (const step of [1, 2, 3, 7, 50]) { let out = '';
    const ch = []; for (let i = 0; i < full.length; i += step) ch.push(delta({ content: full.slice(i, i + step) })); ch.push(delta({}, 'stop'));
    const s = await callModelStream(cfg, { messages: [] }, async () => streamR(ch), 5000, (t) => { out += t; });
    assert.equal(out, 'Hay 8 de arroz. <thi', String(step)); assert.equal(s.content, out); }
});

test('<think> fuera ANTES de la redacción: el empleado no recibe el razonamiento (ni tapado) y la respuesta sale por el filtro', async () => {
  const think = '<think>El costo del arroz es S/ 3.20 y el margen 25%. No se lo digo.</think>\n\n';
  const chunks = (think + 'Quedan 12 bolsas de arroz.').match(/.{1,5}/gs).map((w) => delta({ content: w })).concat(delta({}, 'stop'));
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '¿cuánto arroz hay?', stream: true }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef', ROUTEWAY_API_KEY: KEY }, { principalId: 'session:x', posRole: 'empleado' },
    jsonR, { store: createMemoryUsageStore(), resolveRole: async () => 'empleado:consultas', fetch: async () => streamR(chunks), reader: { products: async () => [] }, audit: async () => {} });
  const body = await r.text();
  assert.ok(!/think|3\.20|25%|margen|No se lo digo/.test(body), body.slice(0, 400));
  assert.ok(!body.includes(OWNER_DATA_LABEL), 'nada que tapar: el razonamiento ya no estaba');
  assert.match(body, /Quedan 12 bolsas/);
});

test('pantalla: **negrita**, __x__ y listas «- »/«* » sin asteriscos, después del filtro y de esc(); en partes = entero', () => {
  const S = C.stripDisplay;
  assert.equal(S('Hay **12** bolsas de __arroz__.'), 'Hay 12 bolsas de arroz.');
  assert.equal(S('Faltan:\n- Arroz\n- Azúcar\n  * Leche\n* Pan'), 'Faltan:\n\u2022 Arroz\n\u2022 Azúcar\n  \u2022 Leche\n\u2022 Pan');
  assert.equal(S('- **Arroz**: 12'), '\u2022 Arroz: 12');
  assert.equal(S('2*3 = 6, a_b y -5 unidades\n-3 kg\n---'), '2*3 = 6, a_b y -5 unidades\n-3 kg\n---', 'una * o _ sola y el guion de un número quedan');
  assert.equal(S('**' + OWNER_DATA_LABEL + '**'), OWNER_DATA_LABEL, 'la máscara del servidor queda igual');
  assert.equal(S(C.esc('**a & b**')), 'a &amp; b', 'después de esc(): sigue sin asteriscos y nada se vuelve HTML');
  const T = ['Hola **Carlos**, hay:\n- **Arroz** 12\n- Azúcar __3__\n* Pan *\n|a|b|\n|---|---|\n|**x**|1|\n- fin*', '  - x\n\n-\n*', '**', '_', '- ', 'a**', '***b***'];
  for (const t of T) { const whole = S(t);
    for (let s = 1; s <= 9; s++) { const d = C.createDisplayStripper(); let o = ''; for (let i = 0; i < t.length; i += s) o += d.push(t.slice(i, i + s)); o += d.flush(); assert.equal(o, whole, s + ' ' + JSON.stringify(t)); } }
  // la retención es mínima: solo una «*»/«_» del final o el inicio de línea sin decidir
  { const d = C.createDisplayStripper(); assert.equal(d.push('Hay *'), 'Hay '); assert.equal(d.push('*12** bolsas'), '12 bolsas'); }
  { const d = C.createDisplayStripper(); assert.equal(d.push('ok\n-'), 'ok\n'); assert.equal(d.push(' arroz'), '\u2022 arroz'); }
});
