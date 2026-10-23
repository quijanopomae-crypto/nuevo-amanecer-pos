// Arnés OCR: rutas reales de la rama (chat, boleta, producto-foto) + estáticos de POS/, con MODELO REAL y base SIMULADA.
// La clave solo vive en process.env y en la cabecera del fetch al proveedor; nunca se guarda ni se imprime.
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const WT = '/workspace/_audit_ocr', RUN = '/workspace/_ocr_run', OUT = RUN + '/out';
mkdirSync(OUT, { recursive: true });
const A = await import(WT + '/tools/cloudflare-lab/src/pos-assistant.js');
const Q = await import(WT + '/tools/cloudflare-lab/src/pos-assistant-queries.js');
const P = await import(WT + '/tools/cloudflare-lab/src/pos-assistant-providers.js');
const B = await import(WT + '/tools/cloudflare-lab/src/pos-assistant-boleta.js');
const F = await import(WT + '/tools/cloudflare-lab/src/pos-assistant-producto-foto.js');
const core = createRequire(import.meta.url)(WT + '/POS/js/modules/asistente/asistente-core.js');
const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'audit500-ocr-' + Math.random().toString(36).slice(2) + 'xxxxxxxxxxxx', ASSISTANT_PER_MINUTE: '1000' };
for (const k of ['ASSISTANT_AI_API_KEY_4']) if (process.env[k]) env[k] = process.env[k];
const cfg = P.resolveProvider(env, null); if (!cfg.ok) { console.error('sin proveedor', cfg.reason); process.exit(2); }
console.error('proveedor', cfg.id, cfg.model, 'vision=' + !!cfg.vision);
const KEYV = env.ASSISTANT_AI_API_KEY_4 || '\u0000none';
export const NAMES_RE = /[cliente]|ch[aá]vez|[cliente]|[cliente]|[cliente]|[cliente]|[cliente]|[cliente]/gi;

const CUSTOMERS = [{ id: '1', nombre: '[cliente] [cliente] [cliente]', dni: '47812345', tel: '951234567' }, { id: '3', nombre: '[cliente]' }];
const pr = (id, nombre, stock, min, precio, costo, controla = true) => ({ id, nombre, controla, stock, min, precio, costo });
const PRODUCTS = [
  pr('p1', 'LECHE GLORIA EVAPORADA 395GR', 30, 6, 4.2, 3.79),
  pr('p2', 'LECHE GLORIA EVAPORADA 48 LATAS X 170GR', 2, 1, 110.0, 98.5),
  pr('p3', 'WAFER NIK 6 UND', 20, 6, 0.7, 0.53),
  pr('p4', 'GLOBOPOP', 60, 24, 0.3, 0.19),
  pr('p5', 'ENCENDEDOR CLIPPER', 20, 5, 2.0, 1.1),
  pr('p6', 'GALLETA CHOKO 6 X 32G', 18, 6, 1.0, 0.3),
  pr('p7', 'Arroz Costeño 1 kg', 40, 10, 4.0, 3.4),
  pr('p8', 'Azúcar Rubia 1 kg', 20, 5, 4.0, 3.4),
  pr('p9', 'Aceite Primor 1 L', 8, 3, 11.5, 9.8),
  pr('p10', 'Fideo Don Vittorio Spaghetti 500 g', 20, 6, 3.2, 2.6),
  pr('p11', 'Inca Kola 500 ml', 36, 12, 2.5, 1.6),
  pr('p12', 'Coca-Cola 500 ml', 48, 12, 2.5, 1.75)
];
const T = (d, h, m = 0) => `2026-${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const purchases = [{ supplier: 'Distribuidora Los Andes', document_ref: 'F001-004410', total_cost_cents: 30120, line_count: 3, status: 'registrada', created_at: T('10-16', 15) }];
const DATA = { products: PRODUCTS, customers: CUSTOMERS, credits: [], sales: [], saleItems: [], cashMovements: [], payments: [], purchases };
const CASH_OPEN = { ready: true, open: { opened_at: T('10-23', 13, 5), opening_cents: 10000, expected_cents: 10000 }, rows: [], lastClosedAt: T('10-23', 3, 10) };
const POSP = PRODUCTS.map((p) => ({ id: p.id, name: p.nombre, precio: p.precio, stock: p.stock, costo: p.costo }));
writeFileSync(OUT + '/_datos-simulados.json', JSON.stringify({ PRODUCTS, purchases, nota: 'Datos inventados. Hoy = 2026-10-23.' }, null, 1));

const sessions = new Map();
function sess(id) { if (!sessions.has(id)) sessions.set(id, { store: A.createMemoryUsageStore() }); return sessions.get(id); }
const log = [];
const scrubImg = (v) => typeof v === 'string' && v.startsWith('data:') ? '[imagen ' + v.length + ' chars]' : v;
function scrubMsgs(ms) { return (ms || []).map((m) => m.role === 'system' ? { role: 'system', chars: String(m.content || '').length }
  : { ...m, content: Array.isArray(m.content) ? m.content.map((p) => p.type === 'image_url' ? { type: 'image_url', image_url: '[imagen ' + String(p.image_url?.url || '').length + ' chars]' } : p) : m.content }); }
function safe(s) { s = String(s).split(KEYV).join('[CLAVE-TAPADA]'); return s.replace(NAMES_RE, '[cliente]'); }

async function handle(req, res, raw) {
  const u = new URL(req.url, 'http://x'), caso = req.headers['x-audit-case'] || 'sin-caso', role = req.headers['x-audit-role'] || 'owner', sid = req.headers['x-audit-session'] || caso;
  const s = sess(sid), auth = { principalId: 'audit-ocr-' + sid, sessionId: 's-' + sid, posRole: role === 'owner' ? 'owner' : 'employee' };
  const calls = [];
  const rfetch = async (url, init) => { let b = null; try { b = JSON.parse(init.body); } catch {}
    const c = { url: String(url).replace(/\?.*$/, ''), model: b?.model, tools: b?.tools ? b.tools.map((t) => t.function?.name) : null, messages: scrubMsgs(b?.messages) }; calls.push(c);
    const r = await fetch(url, init); const txt = await r.text(); c.response = { status: r.status, body: txt.slice(0, 20000) }; return new Response(txt, { status: r.status, headers: r.headers }); };
  const json = (d, st = 200) => new Response(JSON.stringify(d), { status: st, headers: { 'content-type': 'application/json' } });
  const deps = { store: s.store, resolveRole: async () => role, audit: async () => {}, fetch: rfetch, reader: Q.memoryReader({ ...DATA, cash: CASH_OPEN }), readBusinessName: async () => 'MULTISERVICIOS NUEVO AMANECER' };
  let body = null; try { body = JSON.parse(raw); } catch {}
  // chat: el aparato manda texto enmascarado + contexto (como asistente-ui.js); el arnés lo arma si viene "raw_text"
  if (u.pathname === '/auth/assistant/chat' && body && body.raw_text != null) {
    const text = body.raw_text; delete body.raw_text;
    body.text = core.redactText(core.maskCustomers(text, CUSTOMERS, PRODUCTS, []).text);
    body.context = core.buildContext(POSP, 'owner', null, text);
    raw = JSON.stringify(body);
  }
  const rq = new Request('https://lab.test' + u.pathname + u.search, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(raw)) }, body: raw });
  const t0 = Date.now(); let r;
  try {
    if (u.pathname === '/auth/assistant/chat') r = await A.assistantChatRoute(rq, env, auth, json, deps);
    else if (u.pathname === B.BOLETA_PATH) r = await B.assistantBoletaRoute(rq, env, auth, json, deps);
    else if (u.pathname === F.PRODUCTO_FOTO_PATH) r = await F.assistantProductoFotoRoute(rq, env, auth, json, deps);
    else r = json({ error: 'not_found' }, 404);
  } catch (e) { r = json({ error: 'EXC', detail: String(e && e.stack || e) }, 500); }
  const ms = Date.now() - t0, txt = await r.text();
  let out = null; try { out = JSON.parse(txt); } catch {}
  const reqLog = body ? { ...body, image: scrubImg(body.image), context: body.context ? '[contexto ' + JSON.stringify(body.context).length + ' chars]' : undefined,
    invoice_memory: body.invoice_memory ? '[token ' + String(body.invoice_memory).length + ' chars]' : undefined, history: body.history ? body.history.map((h) => ({ role: h.role, content: h.content, firmado: !!h.sig })) : undefined } : null;
  const outLog = out ? { ...out, invoice_memory: out.invoice_memory ? '[token ' + String(out.invoice_memory).length + ' chars]' : undefined, turns: out.turns ? out.turns.map((t) => ({ role: t.role, content: t.content })) : undefined } : txt.slice(0, 2000);
  const entry = { caso, ruta: u.pathname, rol: role, sesion: sid, status: r.status, ms, pedido: reqLog, respuesta: outLog, model_calls: calls };
  log.push(entry);
  writeFileSync(OUT + '/_log.jsonl', log.map((e) => safe(JSON.stringify(e))).join('\n') + '\n');
  console.error(caso, u.pathname, r.status, ms + 'ms', safe((out && (out.reply || out.error || (out.boleta && JSON.stringify(out.boleta)) || (out.producto && JSON.stringify(out.producto))) || '')).slice(0, 200).replace(/\n/g, ' '));
  res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(txt);
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf', '.json': 'application/json', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.xlsm': 'application/octet-stream' };
http.createServer((req, res) => {
  if (req.method === 'POST') { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => handle(req, res, Buffer.concat(ch).toString('utf8')).catch((e) => { res.writeHead(500); res.end(String(e)); })); return; }
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname);
  let f = p.startsWith('/_t/') ? path.join(RUN, p.slice(4)) : path.join(WT, 'POS', p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
}).listen(8787, '127.0.0.1', () => console.error('listo :8787'));
