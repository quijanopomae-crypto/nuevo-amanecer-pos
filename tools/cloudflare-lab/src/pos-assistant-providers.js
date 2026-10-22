// Capa de proveedores del asistente (prototipo aislado, rama feature/asistente-aislado).
// - La configuración sale SOLO de secretos/variables del Worker: AI_PROVIDER, AI_MODEL, AI_BASE_URL (https y de la lista de hosts conocidos,
//   salvo AI_ALLOW_CUSTOM_BASE=1), una clave por proveedor (DEEPSEEK_API_KEY, OPENAI_API_KEY, …) y AI_API_KEY como respaldo del proveedor de AI_PROVIDER.
// - Nunca se acepta proveedor, URL ni clave del celular. Las claves no se guardan en la base ni salen hacia el celular.
// - El dueño solo puede elegir (desde Configuración) un proveedor del catálogo QUE YA TENGA CLAVE y un modelo de la lista que arma el servidor;
//   se guarda {provider, model} en pos_settings (clave interna, sin cambio de esquema).
// - Tres adaptadores con los mismos eventos internos (texto, herramienta, uso, fin, error):
//   OpenAI compatible (DeepSeek, OpenAI, xAI Grok, OpenRouter, Groq, Mistral, Together), Anthropic Messages y Google Gemini.

import { createCodeMap } from './pos-assistant-codigos.js';
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
  // (22-10) Proveedor PRINCIPAL que eligió el Admin: OhMyAgent (compatible OpenAI, gpt-6.1-sol, ~4 s). Respaldo: Routeway (next).
  // Solo valores por defecto; la clave es secreto del Worker (ASSISTANT_AI_API_KEY_4 u OHMYAGENT_API_KEY), nunca en el código. AI_VISION=0 apaga las fotos.
  // (22-10, 3) gpt-6.1-sol LEE fotos (es el modelo de «Leer boleta con IA»). Clave: ASSISTANT_AI_API_KEY_4 (nombre que puso el Admin) u OHMYAGENT_API_KEY.
  ohmyagent: { label: 'OhMyAgent', kind: 'openai', base: 'https://ohhmyagent.com/v1', key: 'OHMYAGENT_API_KEY', altKeys: ['ASSISTANT_AI_API_KEY_4'], model: 'gpt-6.1-sol', next: 'routeway', vision: re(/^gpt-(?:4o|4\.1|5|6)/i) },
  // (22-10) Routeway, compatible OpenAI (respaldo de OhMyAgent; también se puede usar solo). Solo valores por defecto; la clave va como secreto del Worker
  // (ASSISTANT_AI_API_KEY_2 o ROUTEWAY_API_KEY, o AI_API_KEY con AI_PROVIDER=routeway), nunca en el código. Los modelos gratis dan 429 a menudo: ver callModel.
  routeway: { label: 'Routeway', kind: 'openai', base: 'https://api.routeway.ai/v1', key: 'ROUTEWAY_API_KEY', altKeys: ['ASSISTANT_AI_API_KEY_2'], model: 'gemma-4-26b-a4b-it-luminous:free', fallbacks: ['minimax-m2.7:free'], vision: () => false },
  gemini: { label: 'Google Gemini', kind: 'gemini', base: 'https://generativelanguage.googleapis.com', key: 'GEMINI_API_KEY', model: 'gemini-2.5-flash', vision: re(/^gemini/i) }
});
export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));
export const ALLOWED_HOSTS = Object.freeze([...new Set(Object.values(PROVIDERS).map((p) => new URL(p.base).host))]);
export const PROVIDER_CHOICE_KEY = 'internal:asst:provider';
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,119}$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');

function envProvider(env) { return str(env?.AI_PROVIDER).toLowerCase(); }
function keyFor(env, id) { const p = PROVIDERS[id]; if (!p) return ''; return str(env?.[p.key]) || (p.altKeys || []).map((k) => str(env?.[k])).find(Boolean) || (envProvider(env) === id ? str(env?.AI_API_KEY) : ''); }
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
  return [...new Set([...m, p.model, ...(p.fallbacks || [])])];
}
// Modelos de respaldo del MISMO proveedor (en orden) cuando el elegido responde 429/5xx: los del catálogo y AI_FALLBACK_MODEL (si es el de AI_PROVIDER).
function fallbacksFor(env, id, model) {
  const p = PROVIDERS[id]; if (!p) return [];
  const extra = envProvider(env) === id && MODEL_RE.test(str(env?.AI_FALLBACK_MODEL)) ? [str(env.AI_FALLBACK_MODEL)] : [];
  return [...new Set([...extra, ...(p.fallbacks || []), p.model])].filter((x) => x && x !== model).slice(0, 2);
}
// Configuración estricta de UN proveedor. { ok:true, id, kind, label, base, key, model, vision } o { ok:false, reason }.
export function configFor(env, id, model, noNext = false) {
  const p = PROVIDERS[id]; if (!p) return { ok: false, reason: 'unknown_provider' };
  const key = keyFor(env, id); if (!key) return { ok: false, reason: 'missing_key', id };
  const custom = envProvider(env) === id ? str(env?.AI_BASE_URL) : '';
  const legacy = id === 'deepseek' && !custom ? str(env?.DEEPSEEK_BASE_URL) : ''; // nombre viejo, misma revisión
  const rawBase = custom || legacy; const base = rawBase ? checkBaseUrl(rawBase, env) : p.base;
  if (!base) return { ok: false, reason: 'bad_base_url', id };
  const models = modelsFor(env, id); const m = model && models.includes(model) ? model : models[0];
  const v = str(env?.AI_VISION); // '1' o '0' fuerza la lectura de fotos para el proveedor de AI_PROVIDER
  const vision = envProvider(env) === id && (v === '1' || v === '0') ? v === '1' : !!p.vision(m);
  const same = p.fallbacks || (envProvider(env) === id && str(env?.AI_FALLBACK_MODEL)) ? fallbacksFor(env, id, m) : [];
  const own = { id, kind: p.kind, label: p.label, base, key, model: m, vision };
  // Respaldo: primero otros modelos del mismo proveedor, luego el proveedor siguiente (p.next) si tiene su propia clave, con sus modelos.
  const fallbacks = same.map((x) => ({ ...own, model: x, vision: envProvider(env) === id && (v === '1' || v === '0') ? v === '1' : !!p.vision(x) }));
  if (p.next && p.next !== id && PROVIDERS[p.next] && !noNext) {
    const n = configFor(env, p.next, undefined, true);
    if (n.ok) { const { fallbacks: nf, ok: _ok, ...nc } = n; fallbacks.push(nc, ...nf); }
  }
  return { ok: true, ...own, fallbacks: fallbacks.slice(0, 3) };
}
// Proveedor en uso: lo que eligió el dueño (si sigue listo) o, si no, AI_PROVIDER; sin AI_PROVIDER: OhMyAgent si tiene clave (lo que eligió
// el Admin, con Routeway de respaldo si también tiene clave), si no Routeway, si no DeepSeek con DEEPSEEK_API_KEY (como antes).
export function resolveProvider(env, choice) {
  if (choice && PROVIDERS[choice.provider]) { const c = configFor(env, choice.provider, choice.model); if (c.ok) return { ...c, source: 'owner' }; }
  const id = envProvider(env) || (keyFor(env, 'ohmyagent') ? 'ohmyagent' : str(env?.ROUTEWAY_API_KEY) ? 'routeway' : str(env?.DEEPSEEK_API_KEY) ? 'deepseek' : '');
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

// ---------- Bloques de razonamiento ----------
// (22-10) Algunos modelos (gratis de Routeway y otros) escriben su razonamiento entre <think>…</think> (o <thinking>). Se quita ANTES de que el
// texto llegue a la redacción del servidor y al celular. En partes: una etiqueta cortada entre trozos se espera; un bloque sin cierre al final
// se descarta entero. Un «</think>» suelto se quita. Si se quitó un bloque, el espacio en blanco del comienzo de la respuesta también.
const THINK_OPEN_RE = /<think(?:ing)?>/i, THINK_CLOSE_RE = /<\/think(?:ing)?>/i, THINK_TAGS = ['<think>', '<thinking>', '</think>', '</thinking>'];
function tagTail(buf) { // cola de buf que todavía puede ser el comienzo de una de las etiquetas
  const k = buf.lastIndexOf('<'); if (k < 0 || buf.length - k > 11) return 0;
  const t = buf.slice(k).toLowerCase(); return THINK_TAGS.some((x) => x.startsWith(t) && x !== t) ? buf.length - k : 0;
}
export function createThinkStripper() {
  let buf = '', inside = false, seen = false, emitted = false;
  const emit = (o) => { if (!emitted && seen) o = o.replace(/^\s+/, ''); if (o) emitted = true; return o; };
  function run(fin) {
    let out = '';
    for (;;) {
      if (inside) { const m = THINK_CLOSE_RE.exec(buf); if (!m) { if (fin) buf = ''; else { const h = tagTail(buf); buf = h ? buf.slice(-h) : ''; } return out; }
        buf = buf.slice(m.index + m[0].length); inside = false; continue; }
      const o = THINK_OPEN_RE.exec(buf), c = THINK_CLOSE_RE.exec(buf);
      const m = o && (!c || o.index < c.index) ? o : c;
      if (m) { out += emit(buf.slice(0, m.index)); buf = buf.slice(m.index + m[0].length); seen = true; if (m === o) inside = true; continue; }
      const h = fin ? 0 : tagTail(buf); out += emit(buf.slice(0, buf.length - h)); buf = buf.slice(buf.length - h); return out;
    }
  }
  return { push: (t) => { buf += String(t || ''); return run(false); }, flush: () => { const o = run(true); buf = ''; return o; } };
}
export function stripThink(text) { const t = createThinkStripper(); return t.push(text) + t.flush(); }

export const ADAPTERS = Object.freeze({ openai: openaiAdapter, anthropic: anthropicAdapter, gemini: geminiAdapter });

// ---------- Llamadas (iguales para todos los proveedores) ----------
// Señal de afuera (Bot 3): si el celular se va, se pasa el tope de 90 s o vence un tiempo, el pedido se corta (deja de recibir).
export function linkAbort(controller, outer) { if (!outer) return; if (outer.aborted) controller.abort(); else outer.addEventListener('abort', () => controller.abort(), { once: true }); }
function adapterOf(cfg) { const a = cfg && cfg.ok !== false ? ADAPTERS[cfg.kind] : null; return a || null; }

// (22-10) 429 y 5xx: el mismo modelo se reintenta una vez tras una espera corta (Retry-After si es de 3 s o menos) y luego se pasa a los
// respaldos (cfg.fallbacks: otros modelos del proveedor y el proveedor siguiente, p. ej. OhMyAgent -> Routeway), cada uno con el mismo
// reintento. Solo si NO llegó texto todavía (nada se repite en pantalla). Con foto, solo respaldos que leen fotos. Esperas cortas: no
// gastan CPU del Worker y el tope de 90 s del pedido sigue mandando (outer corta también la espera). 401/403/404/400 no se reintentan.
export const RETRY_WAITS_MS = Object.freeze([800, 1500]);
// (lentitud 22-10) Modelos gratis (sufijo «:free», p. ej. los de Routeway): dan 429 a menudo y tardan. Con cfg.noFreeFallback (la segunda
// llamada que explica una consulta: si falla, ya está el texto armado con los números) NO se pasa a ellos; el primero de la cadena (el que
// eligió el Admin) se usa siempre, aunque sea gratis.
export const isFreeModel = (m) => /:free$/i.test(String(m || ''));
// (lentitud 22-10) Espera SIN datos al empezar una respuesta en partes: si en 12 s no llegó ni un byte, se corta (antes 25 s). Después del
// primer trozo manda idleMs (25 s) como siempre. Con foto no se acorta (leer una foto tarda más en empezar).
export const FIRST_DATA_MS = 12000;
const MAX_RETRY_AFTER_MS = 3000;
function waitMs(ms, outer) {
  if (!(ms > 0) || outer?.aborted) return Promise.resolve();
  return new Promise((ok) => { const t = setTimeout(ok, ms); outer?.addEventListener?.('abort', () => { clearTimeout(t); ok(); }, { once: true }); });
}
function retryAfter(r, i, cfg) {
  const waits = Array.isArray(cfg.retryWaits) ? cfg.retryWaits : RETRY_WAITS_MS; const base = Number(waits[Math.min(i, waits.length - 1)]) || 0;
  const ra = Number(r?.retryAfterS); return ra > 0 && ra * 1000 <= MAX_RETRY_AFTER_MS && base > 0 ? ra * 1000 : base;
}
export const isRetryable = (r) => !!r && !!r.error && !r.content && (r.status === 429 || (r.status >= 500 && r.status <= 599) || (!r.status && r.error === 'upstream_busy'));
const hasImage = (req) => (req?.messages || []).some((m) => Array.isArray(m?.content) && m.content.some((x) => x?.type === 'image_url'));
async function withRetries(cfg, req, outer, once) {
  const chain = [cfg, ...(Array.isArray(cfg.fallbacks) ? cfg.fallbacks : [])]
    .map((c) => (typeof c === 'string' ? { ...cfg, model: c } : { ...c, retryWaits: cfg.retryWaits }))
    .filter((c, i, a) => c.model && a.findIndex((x) => x.base === c.base && x.model === c.model) === i)
    .filter((c, i) => i === 0 || !hasImage(req) || c.vision)
    .filter((c, i) => i === 0 || !(cfg.noFreeFallback && isFreeModel(c.model)));
  let r = null, n = 0; // n: intentos hechos (tiempos del asistente: cuántas veces se llamó al proveedor)
  const tag = (x, k) => (x && typeof x === 'object' ? Object.assign(x, { attempts: n, fallback: k > 0 }) : x);
  for (let k = 0; k < chain.length; k++) {
    const c = chain[k];
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await waitMs(retryAfter(r, k, cfg), outer);
      if (outer?.aborted) return tag(r || { error: 'upstream_timeout' }, k);
      r = await once(c); n++;
      if (!isRetryable(r)) return k === 0 ? tag(r, 0) : tag({ ...r, model: c.model, provider: c.id }, k);
    }
  }
  return tag(r, chain.length - 1);
}
function retryAfterS(res) { const v = Number(res?.headers?.get?.('retry-after')); return Number.isFinite(v) && v > 0 ? v : null; }

// Códigos de cliente neutros (pos-assistant-codigos.js): cfg.codes es el mapa de la conversación (pos-assistant.js lo comparte entre la
// primera y la segunda llamada); sin él, uno por llamada. El cuerpo se reescribe en el fetch (todos los adaptadores, reintentos y respaldo)
// y la respuesta vuelve con los códigos reales antes de cualquier lectura de la base o del aparato.
const codesOf = (cfg) => (cfg && cfg.codes) || createCodeMap();
const realResult = (codes, r) => (!r || typeof r !== 'object' ? r : { ...r, ...(typeof r.content === 'string' ? { content: codes.toReal(r.content) } : {}), ...(Array.isArray(r.calls) ? { calls: codes.callsToReal(r.calls) } : {}) });
export async function callModel(cfg, req, fetchImpl, timeoutMs, outer) {
  if (!adapterOf(cfg)) return { error: 'upstream_error' };
  const codes = codesOf(cfg), f = codes.fetch(fetchImpl);
  const r = await withRetries(cfg, req, outer, (c) => callModelOnce(c, req, f, timeoutMs, outer));
  return realResult(codes, r && typeof r.content === 'string' ? { ...r, content: stripThink(r.content) } : r);
}
async function callModelOnce(cfg, req, fetchImpl, timeoutMs, outer) {
  const A = adapterOf(cfg); if (!A) return { error: 'upstream_error' };
  const controller = new AbortController(); linkAbort(controller, outer);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(A.url(cfg, false), { method: 'POST', signal: controller.signal, headers: A.headers(cfg, false), body: JSON.stringify(A.body(cfg, req, false)) });
    if (!res.ok) return { error: A.status(res.status), status: res.status, retryAfterS: retryAfterS(res) };
    return A.parseJson(await res.json());
  } catch (e) {
    return { error: e?.name === 'AbortError' || controller.signal.aborted ? 'upstream_timeout' : 'upstream_error' };
  } finally { clearTimeout(timer); }
}

// En partes: cada trozo de texto va a onText en cuanto llega; las llamadas a herramientas se juntan aquí y recién al final se devuelven
// (nunca se arma una tarjeta con un pedazo). El tiempo cuenta desde el ÚLTIMO trozo (idleMs). Si se corta a mitad: { error, partial:true }.
// opts.stallMs: espera máxima entre trozos (y hasta el primero), sin foto. opts.firstMs: espera máxima hasta el PRIMER byte (por defecto FIRST_DATA_MS sin foto; con foto, idleMs). Nunca más que idleMs.
export async function callModelStream(cfg, req, fetchImpl, idleMs, onText, onTool, guard, outer, opts = {}) {
  if (!adapterOf(cfg)) return { error: 'upstream_error' };
  const firstMs = Math.min(idleMs, Number(opts.firstMs) > 0 ? Number(opts.firstMs) : hasImage(req) ? idleMs : FIRST_DATA_MS);
  // opts.stallMs (segunda llamada): corte por ESPERA SIN DATOS en todo el flujo (no un tope total: cada trozo reinicia la cuenta). Con foto, idleMs.
  const idle = Number(opts.stallMs) > 0 && !hasImage(req) ? Math.min(idleMs, Number(opts.stallMs)) : idleMs;
  const codes = codesOf(cfg), f = codes.fetch(fetchImpl); let st = null;
  const r = await withRetries(cfg, req, outer, (c) => { st = codes.streamer(onText); return callModelStreamOnce(c, req, f, idle, st.push, onTool, guard, outer, Math.min(firstMs, idle)); });
  if (st) { if (r && !r.error && !r.forbidden) st.flush(); else st.drop(); } // la cola retenida («C-00») sale solo si terminó bien
  return realResult(codes, r);
}
async function callModelStreamOnce(cfg, req, fetchImpl, idleMs, onText, onTool, guard, outer, firstMs = idleMs) {
  const A = adapterOf(cfg); if (!A) return { error: 'upstream_error' };
  const think = createThinkStripper(); // <think>…</think> fuera antes de la redacción (onText) y del texto final
  const controller = new AbortController(); let timer = null; let reader = null; linkAbort(controller, outer);
  controller.signal.addEventListener('abort', () => { try { if (reader) reader.cancel().catch(() => {}); } catch { /* ya cortado */ } }, { once: true });
  const arm = (ms = idleMs) => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), ms); };
  let content = '', usage = null, forbidden = null, failed = null; const calls = [];
  try {
    arm(firstMs); // hasta el primer byte: firstMs; luego, idleMs desde el último trozo
    const res = await fetchImpl(A.url(cfg, true), { method: 'POST', signal: controller.signal, headers: A.headers(cfg, true), body: JSON.stringify(A.body(cfg, req, true)) });
    if (!res.ok) return { error: A.status(res.status), status: res.status, retryAfterS: retryAfterS(res) };
    if (!res.body || typeof res.body.getReader !== 'function') return { error: 'upstream_error' };
    reader = res.body.getReader(); const dec = new TextDecoder(); const parse = A.parser(); let buf = '', done = false;
    const handle = (e) => {
      if (e.t === 'text') { const v = think.push(e.v); if (v) { content += v; onText(v); } }
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
    { const tail = think.flush(); if (tail && !forbidden && !failed) { content += tail; onText(tail); } } // cola retenida («<thi» que no era etiqueta)
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
