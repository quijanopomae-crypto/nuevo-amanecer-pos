// Capa de proveedores del asistente (prototipo aislado, rama feature/asistente-aislado).
// - La configuración sale SOLO de secretos/variables del Worker: AI_PROVIDER, AI_MODEL, AI_BASE_URL (https y de la lista de hosts conocidos,
//   salvo AI_ALLOW_CUSTOM_BASE=1), una clave por proveedor (DEEPSEEK_API_KEY, OPENAI_API_KEY, …) y AI_API_KEY como respaldo del proveedor de AI_PROVIDER.
// - Nunca se acepta proveedor, URL ni clave del celular. Las claves no se guardan en la base ni salen hacia el celular.
// - El dueño solo puede elegir (desde Configuración) un proveedor del catálogo QUE YA TENGA CLAVE y un modelo de la lista que arma el servidor;
//   se guarda {provider, model} en pos_settings (clave interna, sin cambio de esquema).
// - Tres adaptadores con los mismos eventos internos (texto, herramienta, uso, fin, error):
//   OpenAI compatible (DeepSeek, OpenAI, xAI Grok, OpenRouter, Groq, Mistral, Together), Anthropic Messages y Google Gemini.

const any = () => true;
const re = (r) => (m) => r.test(String(m || ''));
export const PROVIDERS = Object.freeze({
  deepseek: { label: 'DeepSeek', kind: 'openai', base: 'https://api.deepseek.com', key: 'DEEPSEEK_API_KEY', model: 'deepseek-flash', vision: any }, // igual que antes del cambio
  openai: { label: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY', model: 'gpt-4o-mini', vision: re(/^(?:gpt-4o|chatgpt-4o|gpt-4\.1|gpt-5|o[134])/i) },
  xai: { label: 'xAI Grok', kind: 'openai', base: 'https://api.x.ai/v1', key: 'XAI_API_KEY', model: 'grok-3-mini', vision: re(/vision|grok-4/i) },
  openrouter: { label: 'OpenRouter', kind: 'openai', base: 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY', model: 'openai/gpt-4o-mini', vision: re(/vision|-vl|4o|gpt-4\.1|gpt-5|claude|gemini|pixtral|llama-4|grok-4/i) },
  groq: { label: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY', model: 'llama-3.3-70b-versatile', vision: re(/vision|llama-4/i) },
  mistral: { label: 'Mistral', kind: 'openai', base: 'https://api.mistral.ai/v1', key: 'MISTRAL_API_KEY', model: 'mistral-small-latest', vision: re(/pixtral|mistral-(?:small|medium)/i) },
  together: { label: 'Together', kind: 'openai', base: 'https://api.together.xyz/v1', key: 'TOGETHER_API_KEY', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', vision: re(/vision|-vl|llama-4/i) },
  anthropic: { label: 'Anthropic Claude', kind: 'anthropic', base: 'https://api.anthropic.com', key: 'ANTHROPIC_API_KEY', model: 'claude-haiku-4-5', vision: re(/^claude/i) },
  gemini: { label: 'Google Gemini', kind: 'gemini', base: 'https://generativelanguage.googleapis.com', key: 'GEMINI_API_KEY', model: 'gemini-2.5-flash', vision: re(/^gemini/i) }
});
export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));
export const ALLOWED_HOSTS = Object.freeze([...new Set(Object.values(PROVIDERS).map((p) => new URL(p.base).host))]);
export const PROVIDER_CHOICE_KEY = 'internal:asst:provider';
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,119}$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');

function envProvider(env) { return str(env?.AI_PROVIDER).toLowerCase(); }
function keyFor(env, id) { const p = PROVIDERS[id]; if (!p) return ''; return str(env?.[p.key]) || (envProvider(env) === id ? str(env?.AI_API_KEY) : ''); }
// URL base: solo https, sin usuario/clave en la URL, sin ? ni #, y de la lista de hosts conocidos salvo AI_ALLOW_CUSTOM_BASE=1.
export function checkBaseUrl(raw, env) {
  let u; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
  if (!ALLOWED_HOSTS.includes(u.host) && String(env?.AI_ALLOW_CUSTOM_BASE || '') !== '1') return null;
  return (u.origin + u.pathname).replace(/\/+$/, '');
}
// Modelos que el dueño puede elegir para un proveedor: los arma el servidor (AI_MODEL si es el de AI_PROVIDER, y el de fábrica).
export function modelsFor(env, id) {
  const p = PROVIDERS[id]; if (!p) return [];
  const m = envProvider(env) === id && MODEL_RE.test(str(env?.AI_MODEL)) ? [str(env.AI_MODEL)] : [];
  return [...new Set([...m, p.model])];
}
// Configuración estricta de UN proveedor. { ok:true, id, kind, label, base, key, model, vision } o { ok:false, reason }.
export function configFor(env, id, model) {
  const p = PROVIDERS[id]; if (!p) return { ok: false, reason: 'unknown_provider' };
  const key = keyFor(env, id); if (!key) return { ok: false, reason: 'missing_key', id };
  const custom = envProvider(env) === id ? str(env?.AI_BASE_URL) : '';
  const legacy = id === 'deepseek' && !custom ? str(env?.DEEPSEEK_BASE_URL) : ''; // nombre viejo, misma revisión
  const rawBase = custom || legacy; const base = rawBase ? checkBaseUrl(rawBase, env) : p.base;
  if (!base) return { ok: false, reason: 'bad_base_url', id };
  const models = modelsFor(env, id); const m = model && models.includes(model) ? model : models[0];
  const v = str(env?.AI_VISION); // '1' o '0' fuerza la lectura de fotos para el proveedor de AI_PROVIDER
  const vision = envProvider(env) === id && (v === '1' || v === '0') ? v === '1' : !!p.vision(m);
  return { ok: true, id, kind: p.kind, label: p.label, base, key, model: m, vision };
}
// Proveedor en uso: lo que eligió el dueño (si sigue listo) o, si no, AI_PROVIDER; sin AI_PROVIDER y con DEEPSEEK_API_KEY, DeepSeek (como antes).
export function resolveProvider(env, choice) {
  if (choice && PROVIDERS[choice.provider]) { const c = configFor(env, choice.provider, choice.model); if (c.ok) return { ...c, source: 'owner' }; }
  const id = envProvider(env) || (str(env?.DEEPSEEK_API_KEY) ? 'deepseek' : '');
  if (!id) return { ok: false, reason: 'no_provider' };
  const c = configFor(env, id); return c.ok ? { ...c, source: 'env' } : c;
}
// Lo que ve el dueño en Configuración: nunca la clave ni la URL.
export function providerOverview(env, choice) {
  const cur = resolveProvider(env, choice);
  return {
    current: cur.ok ? { provider: cur.id, label: cur.label, model: cur.model, vision: cur.vision, source: cur.source } : null,
    providers: PROVIDER_IDS.map((id) => { const c = configFor(env, id); const ok = c.ok;
      return { id, label: PROVIDERS[id].label, status: ok ? 'Conectado' : c.reason === 'missing_key' ? 'Falta clave' : 'Revisar configuración', connected: ok,
        models: ok ? modelsFor(env, id) : [], vision: ok ? c.vision : false, current: !!(cur.ok && cur.id === id) }; }),
    demo: String(env?.ASSISTANT_DEMO || '') === '1'
  };
}

// ---------- Utilidades comunes ----------
function textOf(content) { return typeof content === 'string' ? content : Array.isArray(content) ? content.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : String(content ?? ''); }
function parseArgs(a) { if (a && typeof a === 'object') return a; try { const v = JSON.parse(String(a || '{}')); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
function dataUrl(url) { const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(url || '')); return m ? { mime: m[1].toLowerCase(), data: m[2].replace(/\s+/g, '') } : null; }
const usageOf = (p, c) => ({ prompt_tokens: Number(p) || 0, completion_tokens: Number(c) || 0 });
function busyOr(status, busy) { return busy.includes(status) ? 'upstream_busy' : 'upstream_error'; }
// Sin herramientas en el pedido (segunda llamada que explica una consulta): las llamadas y resultados viejos van como texto plano,
// así Anthropic y Gemini no piden la definición de la herramienta.
const toolText = (c) => '(consulta ' + String(c?.function?.name || '') + ' ' + String(c?.function?.arguments || '') + ')';

// ---------- OpenAI compatible ----------
const openaiAdapter = {
  url: (cfg) => cfg.base + '/chat/completions',
  headers: (cfg, stream) => ({ authorization: 'Bearer ' + cfg.key, 'content-type': 'application/json', ...(stream ? { accept: 'text/event-stream' } : {}) }),
  body(cfg, req, stream) {
    const b = { ...req, model: cfg.model, stream: !!stream };
    if (cfg.id !== 'deepseek') delete b.thinking; // campo propio de DeepSeek
    if (!Array.isArray(b.tools) || !b.tools.length) { delete b.tools; delete b.tool_choice; }
    if (cfg.id === 'openai') { if (b.max_tokens != null) { b.max_completion_tokens = b.max_tokens; delete b.max_tokens; } if (/^(?:o\d|gpt-5)/i.test(cfg.model)) delete b.temperature; }
    if (stream && (cfg.id === 'openai' || cfg.id === 'openrouter')) b.stream_options = { include_usage: true };
    return b;
  },
  status: (s) => busyOr(s, [429]),
  parseJson(data) {
    const msg = data?.choices?.[0]?.message || {};
    const calls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((c, i) => ({ id: String(c?.id || 'call_' + i).slice(0, 64), name: c?.function?.name, arguments: c?.function?.arguments }));
    return { content: String(msg.content || ''), calls, usage: data?.usage ? usageOf(data.usage.prompt_tokens, data.usage.completion_tokens) : null };
  },
  parser: () => (j) => {
    const ev = [];
    if (j?.error) return [{ t: 'error', error: /rate|overload|busy/i.test(String(j.error?.type || j.error?.code || '')) ? 'upstream_busy' : 'upstream_error' }];
    if (j?.usage) ev.push({ t: 'usage', v: usageOf(j.usage.prompt_tokens, j.usage.completion_tokens) });
    const ch = j?.choices?.[0]; const d = ch?.delta || {};
    if (typeof d.content === 'string' && d.content) ev.push({ t: 'text', v: d.content });
    for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) ev.push({ t: 'tool', index: Number.isInteger(tc?.index) ? tc.index : null, id: tc?.id, name: tc?.function?.name, args: tc?.function?.arguments });
    if (ch?.finish_reason) ev.push({ t: 'done' });
    return ev;
  }
};

// ---------- Anthropic Messages ----------
function anthropicBody(cfg, req, stream) {
  const hasTools = Array.isArray(req.tools) && req.tools.length > 0; const sys = [], msgs = [];
  const push = (role, blocks) => { blocks = blocks.filter((b) => b.type !== 'text' || b.text); if (!blocks.length) return; const last = msgs[msgs.length - 1]; if (last && last.role === role) last.content.push(...blocks); else msgs.push({ role, content: blocks }); };
  for (const m of req.messages || []) {
    if (m.role === 'system') { sys.push(textOf(m.content)); continue; }
    if (m.role === 'tool') { push('user', [hasTools ? { type: 'tool_result', tool_use_id: String(m.tool_call_id || ''), content: String(m.content ?? '') } : { type: 'text', text: 'Resultado: ' + String(m.content ?? '') }]); continue; }
    if (m.role === 'assistant') { push('assistant', [{ type: 'text', text: textOf(m.content) }, ...(m.tool_calls || []).map((c) => hasTools ? { type: 'tool_use', id: String(c.id), name: c.function?.name, input: parseArgs(c.function?.arguments) } : { type: 'text', text: toolText(c) })]); continue; }
    push('user', typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []).map((x) => {
      if (x?.type === 'image_url') { const d = dataUrl(x.image_url?.url); return d ? { type: 'image', source: { type: 'base64', media_type: d.mime, data: d.data } } : { type: 'image', source: { type: 'url', url: String(x.image_url?.url || '') } }; }
      return { type: 'text', text: String(x?.text ?? '') };
    }));
  }
  const b = { model: cfg.model, max_tokens: req.max_tokens || 1024, messages: msgs, stream: !!stream };
  if (sys.length) b.system = sys.join('\n\n');
  if (req.temperature != null) b.temperature = req.temperature;
  if (hasTools) { b.tools = req.tools.map((t) => ({ name: t.function.name, description: t.function.description || '', input_schema: t.function.parameters || { type: 'object', properties: {} } })); b.tool_choice = { type: 'auto' }; }
  return b;
}
const anthropicAdapter = {
  url: (cfg) => cfg.base + '/v1/messages',
  headers: (cfg, stream) => ({ 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(stream ? { accept: 'text/event-stream' } : {}) }),
  body: anthropicBody,
  status: (s) => busyOr(s, [429, 529]),
  parseJson(data) {
    const blocks = Array.isArray(data?.content) ? data.content : [];
    return { content: blocks.filter((b) => b?.type === 'text').map((b) => b.text).join(''),
      calls: blocks.filter((b) => b?.type === 'tool_use').map((b, i) => ({ id: String(b.id || 'call_' + i).slice(0, 64), name: b.name, arguments: JSON.stringify(b.input || {}) })),
      usage: data?.usage ? usageOf(data.usage.input_tokens, data.usage.output_tokens) : null };
  },
  parser: () => { let inTok = 0; return (j) => {
    switch (j?.type) {
      case 'message_start': inTok = Number(j.message?.usage?.input_tokens) || 0; return [];
      case 'content_block_start': { const b = j.content_block || {};
        if (b.type === 'tool_use') return [{ t: 'tool', index: j.index, id: b.id, name: b.name, args: '' }];
        return b.type === 'text' && b.text ? [{ t: 'text', v: b.text }] : []; }
      case 'content_block_delta': { const d = j.delta || {};
        if (d.type === 'text_delta' && d.text) return [{ t: 'text', v: d.text }];
        if (d.type === 'input_json_delta') return [{ t: 'tool', index: j.index, args: d.partial_json || '' }];
        return []; }
      case 'message_delta': return j.usage ? [{ t: 'usage', v: usageOf(inTok, j.usage.output_tokens) }] : [];
      case 'message_stop': return [{ t: 'done' }];
      case 'error': return [{ t: 'error', error: /overload|rate/i.test(String(j.error?.type || '')) ? 'upstream_busy' : 'upstream_error' }];
      default: return [];
    }
  }; }
};

// ---------- Google Gemini ----------
const GEMINI_SCHEMA_KEYS = new Set(['type', 'description', 'enum', 'items', 'properties', 'required', 'maxItems', 'minItems', 'nullable', 'minimum', 'maximum']);
export function geminiSchema(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (!GEMINI_SCHEMA_KEYS.has(k)) continue;
    if (k === 'properties') o.properties = Object.fromEntries(Object.entries(v || {}).map(([n, x]) => [n, geminiSchema(x)]));
    else if (k === 'items') o.items = geminiSchema(v);
    else if (k === 'type' && Array.isArray(v)) { const t = v.filter((x) => x !== 'null'); o.type = t[0] || 'string'; if (t.length < v.length) o.nullable = true; }
    else o[k] = v;
  }
  return o;
}
function geminiBody(cfg, req) {
  const hasTools = Array.isArray(req.tools) && req.tools.length > 0; const sys = [], contents = [], names = {};
  const push = (role, parts) => { parts = parts.filter((p) => !('text' in p) || p.text); if (!parts.length) return; const last = contents[contents.length - 1]; if (last && last.role === role) last.parts.push(...parts); else contents.push({ role, parts }); };
  for (const m of req.messages || []) {
    if (m.role === 'system') { sys.push(textOf(m.content)); continue; }
    if (m.role === 'assistant') { for (const c of m.tool_calls || []) names[c.id] = c.function?.name;
      push('model', [{ text: textOf(m.content) }, ...(m.tool_calls || []).map((c) => hasTools ? { functionCall: { name: c.function?.name, args: parseArgs(c.function?.arguments) } } : { text: toolText(c) })]); continue; }
    if (m.role === 'tool') { const r = parseArgs(m.content);
      push('user', [hasTools ? { functionResponse: { name: names[m.tool_call_id] || 'consultar', response: Object.keys(r).length ? r : { content: String(m.content ?? '') } } } : { text: 'Resultado: ' + String(m.content ?? '') }]); continue; }
    push('user', typeof m.content === 'string' ? [{ text: m.content }] : (m.content || []).map((x) => {
      if (x?.type === 'image_url') { const d = dataUrl(x.image_url?.url); return d ? { inlineData: { mimeType: d.mime, data: d.data } } : { text: '' }; }
      return { text: String(x?.text ?? '') };
    }));
  }
  const b = { contents, generationConfig: { maxOutputTokens: req.max_tokens || 1024, ...(req.temperature != null ? { temperature: req.temperature } : {}) } };
  if (sys.length) b.systemInstruction = { parts: [{ text: sys.join('\n\n') }] };
  if (hasTools) { b.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.function.name, description: t.function.description || '', parameters: geminiSchema(t.function.parameters) })) }]; b.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }; }
  return b;
}
function geminiParts(j) { const c = j?.candidates?.[0]; return { parts: Array.isArray(c?.content?.parts) ? c.content.parts : [], fin: c?.finishReason, usage: j?.usageMetadata }; }
const geminiAdapter = {
  url: (cfg, stream) => cfg.base + '/v1beta/models/' + encodeURIComponent(cfg.model) + (stream ? ':streamGenerateContent?alt=sse' : ':generateContent'),
  headers: (cfg, stream) => ({ 'x-goog-api-key': cfg.key, 'content-type': 'application/json', ...(stream ? { accept: 'text/event-stream' } : {}) }), // la clave nunca va en la URL
  body: geminiBody,
  status: (s) => busyOr(s, [429, 503]),
  parseJson(data) {
    const { parts, usage } = geminiParts(data);
    return { content: parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join(''),
      calls: parts.filter((p) => p.functionCall).map((p, i) => ({ id: String(p.functionCall.id || 'call_' + i).slice(0, 64), name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) })),
      usage: usage ? usageOf(usage.promptTokenCount, usage.candidatesTokenCount) : null };
  },
  parser: () => { let n = 0; return (j) => {
    if (j?.error) return [{ t: 'error', error: Number(j.error.code) === 429 || /RESOURCE_EXHAUSTED|UNAVAILABLE/.test(String(j.error.status || '')) ? 'upstream_busy' : 'upstream_error' }];
    const { parts, fin, usage } = geminiParts(j); const ev = [];
    for (const p of parts) {
      if (typeof p.text === 'string' && p.text && !p.thought) ev.push({ t: 'text', v: p.text });
      if (p.functionCall) { const i = n++; ev.push({ t: 'tool', index: i, id: p.functionCall.id || 'call_' + i, name: p.functionCall.name, args: JSON.stringify(p.functionCall.args || {}) }); }
    }
    if (usage) ev.push({ t: 'usage', v: usageOf(usage.promptTokenCount, usage.candidatesTokenCount) });
    if (fin || j?.promptFeedback?.blockReason) ev.push({ t: 'done' });
    return ev;
  }; }
};

export const ADAPTERS = Object.freeze({ openai: openaiAdapter, anthropic: anthropicAdapter, gemini: geminiAdapter });

// ---------- Llamadas (iguales para todos los proveedores) ----------
// Señal de afuera (Bot 3): si el celular se va, se pasa el tope de 90 s o vence un tiempo, el pedido se corta (deja de recibir).
export function linkAbort(controller, outer) { if (!outer) return; if (outer.aborted) controller.abort(); else outer.addEventListener('abort', () => controller.abort(), { once: true }); }
function adapterOf(cfg) { const a = cfg && cfg.ok !== false ? ADAPTERS[cfg.kind] : null; return a || null; }

export async function callModel(cfg, req, fetchImpl, timeoutMs, outer) {
  const A = adapterOf(cfg); if (!A) return { error: 'upstream_error' };
  const controller = new AbortController(); linkAbort(controller, outer);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(A.url(cfg, false), { method: 'POST', signal: controller.signal, headers: A.headers(cfg, false), body: JSON.stringify(A.body(cfg, req, false)) });
    if (!res.ok) return { error: A.status(res.status), status: res.status };
    return A.parseJson(await res.json());
  } catch (e) {
    return { error: e?.name === 'AbortError' || controller.signal.aborted ? 'upstream_timeout' : 'upstream_error' };
  } finally { clearTimeout(timer); }
}

// En partes: cada trozo de texto va a onText en cuanto llega; las llamadas a herramientas se juntan aquí y recién al final se devuelven
// (nunca se arma una tarjeta con un pedazo). El tiempo cuenta desde el ÚLTIMO trozo (idleMs). Si se corta a mitad: { error, partial:true }.
export async function callModelStream(cfg, req, fetchImpl, idleMs, onText, onTool, guard, outer) {
  const A = adapterOf(cfg); if (!A) return { error: 'upstream_error' };
  const controller = new AbortController(); let timer = null; let reader = null; linkAbort(controller, outer);
  controller.signal.addEventListener('abort', () => { try { if (reader) reader.cancel().catch(() => {}); } catch { /* ya cortado */ } }, { once: true });
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), idleMs); };
  let content = '', usage = null, forbidden = null, failed = null; const calls = [];
  try {
    arm();
    const res = await fetchImpl(A.url(cfg, true), { method: 'POST', signal: controller.signal, headers: A.headers(cfg, true), body: JSON.stringify(A.body(cfg, req, true)) });
    if (!res.ok) return { error: A.status(res.status), status: res.status };
    if (!res.body || typeof res.body.getReader !== 'function') return { error: 'upstream_error' };
    reader = res.body.getReader(); const dec = new TextDecoder(); const parse = A.parser(); let buf = '', done = false;
    const handle = (e) => {
      if (e.t === 'text') { content += e.v; onText(e.v); }
      else if (e.t === 'usage') usage = e.v;
      else if (e.t === 'done') done = true;
      else if (e.t === 'error') { failed = e.error || 'upstream_error'; done = true; }
      else if (e.t === 'tool') {
        if (onTool) onTool(); // el modelo arma una búsqueda: aviso «buscando»
        const i = Number.isInteger(e.index) ? e.index : calls.length; const c = calls[i] || (calls[i] = { id: '', name: '', arguments: '' });
        if (e.id) c.id = String(e.id).slice(0, 64); if (e.name) c.name += e.name; if (typeof e.args === 'string') c.arguments += e.args;
        const why = guard ? guard(c) : null; if (why && !forbidden) { forbidden = why; done = true; } // herramienta prohibida: se corta aquí
      }
    };
    const line = (l) => {
      if (!l.startsWith('data:')) return; const d = l.slice(5).trim(); if (!d) return;
      if (d === '[DONE]') { done = true; return; }
      let j; try { j = JSON.parse(d); } catch { return; }
      for (const e of parse(j)) { handle(e); if (forbidden || failed) break; }
    };
    for (;;) {
      const { value, done: end } = await reader.read(); arm();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let k; while (!forbidden && !failed && (k = buf.indexOf('\n')) >= 0) { line(buf.slice(0, k).replace(/\r$/, '')); buf = buf.slice(k + 1); }
      if (forbidden || failed) { try { reader.cancel().catch(() => {}); } catch { /* ya cortado */ } controller.abort(); break; }
    }
    if (forbidden) return { forbidden, content, calls: [], usage };
    if (failed) return { error: failed, partial: !!content, content };
    if (controller.signal.aborted) return { error: 'upstream_timeout', partial: !!content, content }; // tiempo, tope o celular ido
    if (buf) line(buf.trim());
    if (forbidden) return { forbidden, content, calls: [], usage };
    if (failed) return { error: failed, partial: !!content, content };
    // Sin fin del proveedor: el corte fue a mitad (lo recibido queda, las herramientas a medias NO se usan).
    if (!done) return { error: 'upstream_error', partial: true, content };
    return { content, calls: calls.filter(Boolean).map((c, i) => ({ id: c.id || 'call_' + i, name: c.name, arguments: c.arguments })), usage };
  } catch (e) {
    return { error: e?.name === 'AbortError' || controller.signal.aborted ? 'upstream_timeout' : 'upstream_error', partial: !!content, content };
  } finally { clearTimeout(timer); }
}

// Prueba chica para el botón «Probar» (solo dueño): unas pocas palabras, sin herramientas, sin datos del negocio.
export async function testProvider(cfg, fetchImpl, timeoutMs = 10000) {
  const t0 = Date.now();
  const r = await callModel(cfg, { messages: [{ role: 'user', content: 'Responde solo: ok' }], max_tokens: 16, temperature: 0 }, fetchImpl, timeoutMs);
  const ms = Date.now() - t0;
  if (!r.error) return { ok: true, ms, message: 'Conectado. Respondió en ' + (ms / 1000).toFixed(1).replace('.', ',') + ' s.' };
  const message = r.status === 401 || r.status === 403 ? 'La clave no fue aceptada.' : r.error === 'upstream_busy' ? 'Está ocupado. Prueba en un rato.'
    : r.error === 'upstream_timeout' ? 'No respondió a tiempo.' : r.status === 404 ? 'No encontró ese modelo.' : 'No respondió bien.';
  return { ok: false, ms, message };
}
