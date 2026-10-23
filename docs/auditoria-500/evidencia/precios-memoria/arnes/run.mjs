// Arnés LOCAL de auditoría (memoria M-001..M-035 + precios P-015/016/017/026/027/049..052).
// Maneja el handler REAL del Worker (assistantChatRoute / belowCostRoute) en proceso, con store en memoria y un modelo FALSO (stub).
// Nunca toca red, producción, CANON ni datos reales: fetch global bloqueado; catálogo/clientes sintéticos.
// Uso: node /workspace/auditoria-500/harness/run.mjs [ruta-al-repo]   (por defecto /workspace/na-asist-bajo-costo)
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const REPO = process.argv[2] || '/workspace/na-asist-bajo-costo';
const SRC = REPO + '/tools/cloudflare-lab/src/';
const A = await import(pathToFileURL(SRC + 'pos-assistant.js'));
const { taughtFact } = await import(pathToFileURL(SRC + 'pos-assistant-invoice-memory.js'));
const { belowCostRoute, BELOW_COST_PATH } = await import(pathToFileURL(SRC + 'pos-assistant-below-cost.js'));
const { levelKey } = await import(pathToFileURL(SRC + 'pos-assistant-access.js'));
const { storedValue, COSTS_ROLE } = await import(pathToFileURL(SRC + 'pos-assistant-levels.js'));
const { memoryReader } = await import(pathToFileURL(SRC + 'pos-assistant-queries.js'));
const { assistantChatRoute, createMemoryUsageStore, lessonsKey } = A;

// --- Red bloqueada: cualquier fetch real es un error del arnés ---
const NATIVE_FETCH = globalThis.fetch;
globalThis.fetch = async (u) => { throw new Error('ARNES: red bloqueada (' + u + ')'); };
// REAL_MODEL=1 (opt-in): modelo real gpt-6.1-sol con la clave YA inyectada en el entorno de la caja (ASSISTANT_AI_API_KEY_4).
// La clave solo se copia al objeto env en memoria; nunca se imprime ni se escribe. Red permitida SOLO hacia el host del proveedor.
const REAL = process.env.REAL_MODEL === '1';
const ALLOWED_HOSTS = new Set(['ohhmyagent.com']);
const realFetch = async (url, init) => { const h = new URL(String(url)).hostname; if (!ALLOWED_HOSTS.has(h)) throw new Error('ARNES: host no permitido ' + h); return NATIVE_FETCH(url, init); };

// --- Entorno local: clave FALSA (no es secreto real; el fetch del modelo es un stub en proceso) ---
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'arnes-local-secreto-0123456789abcdef', ...(REAL ? {} : { OHMYAGENT_API_KEY: 'stub-local-no-es-clave' }), AI_VISION: '1',
  ASSISTANT_PER_MINUTE: '1000', ASSISTANT_PER_DAY: '100000', ASSISTANT_MONTHLY_CHAT_CAP: '1000000', ASSISTANT_PHOTOS_PER_DAY: '1000', ASSISTANT_MONTHLY_PHOTO_CAP: '100000', ASSISTANT_PHOTOS_PER_MINUTE: '100' };

if (REAL) { if (!process.env.ASSISTANT_AI_API_KEY_4) { console.error('REAL_MODEL=1 pero no hay clave en el entorno'); process.exit(2); } ENV.ASSISTANT_AI_API_KEY_4 = process.env.ASSISTANT_AI_API_KEY_4; }
const TRANS = []; // transcripciones (sin cabeceras ni clave)
// --- Datos sintéticos ---
const PRODUCTS = [
  { id: 'P001', nombre: 'Galleta Soda Field x6 paquetes', precio: 4.5, costo: 3.6, stock: 30 },
  { id: 'P002', nombre: 'Leche Gloria Evaporada 395 g (caja x24)', precio: 4.2, costo: 3.5, stock: 96 },
  { id: 'P003', nombre: 'Arroz Jairito 1 kg', precio: 3.9, costo: 3.18, stock: 50 },
  { id: 'P004', nombre: 'Fideo Don Vittorio Spaghetti 500 g', precio: 2.6, costo: 1.9, stock: 40 },
  { id: 'P005', nombre: 'Fideo Don Vittorio Tallarin 500 g', precio: 2.6, costo: 1.9, stock: 40 },
  { id: 'P006', nombre: 'Atun Florida 170 g', precio: 6.0, costo: 4.9, stock: 24 },
  { id: 'P007', nombre: 'Pollo entero kg', precio: 11.5, costo: 8.6, stock: 10 },
  { id: 'P008', nombre: 'Azucar Rubia kg', precio: 4.0, costo: 3.4, stock: 100 },
  { id: 'P009', nombre: 'Agua Cielo 625 ml', precio: 1.5, costo: 0.9, stock: 60 },
  { id: 'P010', nombre: 'Galleta Casino Menta', precio: 1.0, costo: 0.7, stock: 80 },
  { id: 'P011', nombre: 'Galleta Oreo', precio: 1.2, costo: 0.85, stock: 80 },
  { id: 'P012', nombre: 'Chicle Trident display', precio: 1.0, costo: 0.6, stock: 40 },
  { id: 'P013', nombre: 'Cerveza Pilsen 630 ml', precio: 7.0, costo: 5.4, stock: 48 },
  { id: 'P014', nombre: 'Gaseosa Inca Kola 500 ml', precio: 3.0, costo: 2.1, stock: 48 },
  { id: 'P015', nombre: 'Fideo paquete 250 g', precio: 1.5, costo: 1.0, stock: 40 }
];
const CUSTOMERS = [{ id: 'C0012', nombre: 'Jorge Huamán Ríos' }, { id: 'C0020', nombre: 'Rosa Quispe Mamani' }];
const T0 = Date.parse('2026-10-23T15:00:00Z'); // 10:00 Lima, viernes 23/10/2026
const DATA = { products: PRODUCTS, customers: CUSTOMERS, credits: [],
  sales: [{ sale_id: 's1', created_at: '2026-10-23T14:00:00Z', metodo: 'efectivo', total_cents: 2400 }, { sale_id: 's2', created_at: '2026-10-22T16:00:00Z', metodo: 'efectivo', total_cents: 1150 }],
  saleItems: [{ sale_id: 's1', product_id: 'P010', quantity: 4, unit_price_cents: 60, line_total_cents: 240 }, { sale_id: 's1', product_id: 'P002', quantity: 5, unit_price_cents: 420, line_total_cents: 2100 },
    { sale_id: 's2', product_id: 'P007', quantity: 1, unit_price_cents: 1150, line_total_cents: 1150 }] };
const CTX_PRODUCTS = PRODUCTS.map(p => ({ ...p })); // lo que manda el aparato (el servidor quita costos al empleado)

// --- Modelo falso ---
const STUB_TEXT = '[stub] Respuesta simulada del modelo.';
function modelResponse(spec) { // spec: {content, calls:[{name,args}]}
  return new Response(JSON.stringify({ choices: [{ message: { content: spec.content ?? STUB_TEXT, ...(spec.calls ? { tool_calls: spec.calls.map((c, i) => ({ id: 'c' + i, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}

// --- Reloj y "servidor" ---
const lima = (ms) => new Date(ms - 5 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + ' Lima';
function cloneStore(s) { const n = createMemoryUsageStore(); for (const [k, v] of s._map) n._map.set(k, JSON.parse(JSON.stringify(v))); return n; }
const OWNER = { principalId: 'dev-admin-arnes', sessionId: 'ses-admin', posRole: 'owner' };
const EMP = (lvl) => ({ principalId: 'dev-emp-' + lvl, sessionId: 'ses-emp-' + lvl, posRole: 'empleado' });
const ROLE = { owner: 'owner', n1: 'empleado:consultas', n2: 'empleado:consultas_documentos', n3: 'empleado:completo', n3c: COSTS_ROLE };

class Conv { constructor(who = 'owner') { this.who = who; this.history = []; this.invoice = null; } }

async function chat(server, conv, text, { model = {}, image = null, extraHistory = null } = {}) {
  const auth = conv.who === 'owner' ? OWNER : EMP(conv.who);
  const role = ROLE[conv.who];
  const calls = [];
  const body = { text, history: extraHistory || conv.history, context: { products: CTX_PRODUCTS }, ...(image ? { image } : {}), ...(conv.invoice ? { invoice_memory: conv.invoice } : {}) };
  const before = conv.who === 'owner' ? await lessonsOf(server.store) : null;
  const t = performance.now();
  const res = await assistantChatRoute(new Request('https://arnes.local/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ENV, auth,
    (d, s = 200) => new Response(JSON.stringify(d), { status: s }), {
      store: server.store, now: () => server.now, resolveRole: async () => role, audit: async () => {}, reader: memoryReader(DATA),
      fetch: REAL ? async (url, init) => { const req = JSON.parse(init.body); calls.push({ url: String(url), req }); const t0 = performance.now(); const resp = await realFetch(url, init); const txt = await resp.text(); calls[calls.length - 1].resp = { status: resp.status, ms: Math.round(performance.now() - t0), body: txt.slice(0, 20000) }; return new Response(txt, { status: resp.status, headers: { 'content-type': 'application/json' } }); } : async (url, init) => { const req = JSON.parse(init.body); calls.push({ url: String(url), req }); const spec = typeof model === 'function' ? model(calls.length, req) : (calls.length === 1 ? model : {}); return modelResponse(spec); }
    });
  const ms = Math.round(performance.now() - t);
  const out = await res.json();
  server.now += 60000; // cada pedido = 1 minuto simulado
  if (res.status === 200 && Array.isArray(out.turns) && out.turns.length) conv.history = [...conv.history, ...out.turns].slice(-40);
  if (out.invoice_memory !== undefined) conv.invoice = out.invoice_memory || conv.invoice;
  const after = conv.who === 'owner' ? await lessonsOf(server.store) : null;
  const msgs = calls[0]?.req?.messages || [];
  const taughtMsg = msgs.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('<ensenado_por_usuario>'));
  const priceMsg = msgs.find(m => typeof m.content === 'string' && m.content.startsWith('<precios_del_sistema>'));
  const boletaMsg = msgs.find(m => typeof m.content === 'string' && m.content.startsWith('<boleta_recordada>'));
  TRANS.push({ quien: conv.who, rol: role, hora_simulada: lima(server.now - 60000), pregunta: text, imagen: !!image, status: res.status, ms, llamadas_modelo: calls.map(c => ({ host: new URL(c.url).hostname, model: c.req.model, ms: c.resp?.ms, status: c.resp?.status, tool_calls: (() => { try { return (JSON.parse(c.resp?.body || '{}').choices?.[0]?.message?.tool_calls || []).map(t => t.function?.name + ' ' + t.function?.arguments); } catch { return null; } })() })),
    ensenado: taughtMsg ? taughtMsg.content : null, precios_del_sistema: priceMsg ? priceMsg.content : null, boleta_recordada: boletaMsg ? boletaMsg.content : null, respuesta: out.reply ?? null, error: out.error ?? null, proposals: (out.proposals || []).map(p => ({ type: p.type, product_id: p.product_id, precio_actual: p.precio_actual, precio_nuevo: p.precio_nuevo, costo_nuevo: p.costo_nuevo })), dropped: out.dropped, nota: out.nota ?? null });
  return { status: res.status, out, ms, calls, payload: JSON.stringify(msgs), taught: taughtMsg ? JSON.parse(taughtMsg.content.replace(/^<ensenado_por_usuario>\n|\n<\/ensenado_por_usuario>$/g, '')).dicho_por_el_usuario : [],
    price: priceMsg ? priceMsg.content : null, boleta: boletaMsg ? boletaMsg.content : null, lessonsBefore: before, lessonsAfter: after, reply: out.reply, fact: taughtFact(text) };
}
async function lessonsRaw(store) { return (await store.get(await lessonsKey(OWNER))).value; }
async function lessonsOf(store) { const v = await lessonsRaw(store); return Array.isArray(v?.items) ? v.items.slice() : []; }
const newItems = (r) => (r.lessonsAfter || []).filter(x => !(r.lessonsBefore || []).includes(x));
const q = (s) => '«' + String(s ?? '').slice(0, 160) + '»';

// --- Resultados ---
const R = {};
const TR_BY_ID = {}; let trCursor = 0;
function rec(id, resultado, evid, ms) { TR_BY_ID[id] = TRANS.slice(trCursor); trCursor = TRANS.length; R[id] = { resultado, evidencia: evid.replace(/\s+/g, ' ').trim() + ' | t_arnes=' + ms + ' ms', ms }; }
const H = 'HALLAZGO';
const DET = 'Determinista:'; const NM = 'No medible sin modelo real (stub devuelve texto fijo):';

// ======================= MEMORIA (Admin, línea de tiempo principal = 23/10/2026) =======================
const S = { store: createMemoryUsageStore(), now: T0 };
const log = [];
let r;

// M-001
let cA = new Conv();
r = await chat(S, cA, 'ojo la caja de galleta soda field trae 30 paquetitos');
const m001raw = await lessonsRaw(S.store);
rec('M-001', 'PARCIAL', `${DET} taughtFact coincide (lead «ojo» + dígito) y saveLesson guardó ${q(newItems(r)[0])} en pos_settings SIN preguntar (no hay tarjeta ni pregunta de confirmación; proposals=${r.out.proposals.length}). Forma guardada: ${JSON.stringify(m001raw)} (solo {d, items[string]}: sin quién ni hora). No se compara con la ficha («x6 paquetes» en el nombre) ni se asocia al producto. ${H}: guardado sin confirmación (saveLesson directo para Admin). ${H}: sin registro de quién/cuándo. Respuesta=${q(r.reply)}. ${NM} si diría «guardado para siempre».`, r.ms);

// M-002
let cB = new Conv();
r = await chat(S, cB, 'cuantos paquetitos trae la caja de soda field');
rec('M-002', r.taught.some(x => /soda field trae 30/.test(x)) ? 'PASA' : 'FALLA', `${DET} conversación nueva (sin historial ni token): <ensenado_por_usuario> enviado al modelo = ${JSON.stringify(r.taught)} (viene de readLessons del mismo día de Lima). La pregunta no se guardó (taughtFact=null). ${NM} que responda 30 citando que se lo enseñó hoy; el dato sí le llega.`, r.ms);

// M-003 (bifurcación +1 día)
{ const F = { store: cloneStore(S.store), now: T0 + 86400e3 }; const c = new Conv();
  const x = await chat(F, c, 'y la soda field cuantos trae la caja');
  const stillRaw = await lessonsRaw(F.store);
  // demostración: si el Admin enseña algo el día siguiente, lo del día anterior se sobrescribe
  await chat(F, new Conv(), 'recuerda que el pan llega a las 6');
  const afterTeach = await lessonsRaw(F.store);
  rec('M-003', 'FALLA', `${DET} a ${lima(F.now - 120000)} (día siguiente) <ensenado_por_usuario> = ${JSON.stringify(x.taught)}: readLessons solo devuelve v.d === limaDate (fila sigue con d=${stillRaw.d}). No inventa porque el dato no llega (bien), pero no lo recuerda: brecha de memoria persistente. Además, al enseñar algo nuevo ese día la fila queda ${JSON.stringify(afterTeach)}: lo del 23/10 se BORRA físicamente. ${H}: borrado al día siguiente. Respuesta=${q(x.reply)}. ${NM} que diga «no tengo ese dato».`, x.ms); }

// M-004
let cC = new Conv();
r = await chat(S, cC, 'la caja de leche gloria de 395 trae 24 latas');
rec('M-004', 'FALLA', `${DET} guardado al instante sin propuesta ni Confirmar/Cancelar: nueva lección ${q(newItems(r)[0])}; proposals=${r.out.proposals.length}. Respuesta=${q(r.reply)} (texto del stub). ${H}: guardado sin confirmación; sin quién/cuándo; desaparece al día siguiente (ver M-008).`, r.ms);

// M-005
let cD = new Conv();
r = await chat(S, cD, 'cuantas latas trae la caja de gloria 395');
rec('M-005', 'FALLA', `${DET} conversación nueva sin haber confirmado: el modelo recibe <ensenado_por_usuario> con ${JSON.stringify(r.taught.filter(x => /gloria/i.test(x)))} igual que un dato guardado (no existe estado «sin confirmar»). ${NM} la frase exacta, pero el código ya lo trata como dato guardado.`, r.ms);

// M-006
r = await chat(S, cD, 'si, guardala');
const m006raw = await lessonsRaw(S.store);
rec('M-006', 'FALLA', `${DET} «si, guardala» no hace nada (taughtFact=${r.fact}; lecciones nuevas=${JSON.stringify(newItems(r))}); no hay paso de confirmación ni campo unidades-por-caja en el producto; lo que hay es la cadena suelta del día (${JSON.stringify(m006raw.d)}), sin fuente ni fecha por item. ${H}: no existe confirmación; vive solo el día. Respuesta=${q(r.reply)}. ${NM} si diría honestamente que no puede / «para siempre».`, r.ms);

// M-007
r = await chat(S, cD, 'quien te dijo q la caja de gloria trae 24 y cuando');
rec('M-007', 'FALLA', `${DET} ¡LA PREGUNTA SE GUARDÓ COMO LECCIÓN!: taughtFact=${q(r.fact)} (QUESTION no reconoce «quien…» sin «?», y «trae 24» activa TEACH_FACT) → nueva lección ${q(newItems(r)[0])}. Lo que recibe el modelo es solo texto: ${JSON.stringify(r.taught.filter(x => /gloria/i.test(x)))}; la fila es ${JSON.stringify(await lessonsRaw(S.store))} → no hay quién (aparato/persona) ni hora por item; solo el día de la fila. Lo honesto sería «me lo enseñaste hoy, no guardo la hora». ${H}: sin registro de quién/cuándo. ${H}: preguntas sin «?» que empiezan con quién/si/a cuánto + número se guardan como lección (ver también P-015). ${NM} si inventa fuente/fecha.`, r.ms);

// M-008 (bifurcación +3 días)
{ const F = { store: cloneStore(S.store), now: T0 + 3 * 86400e3 }; const x = await chat(F, new Conv(), 'la caja de gloria de 395 cuantas trae');
  rec('M-008', 'FALLA', `${DET} a ${lima(F.now - 60000)} <ensenado_por_usuario> = ${JSON.stringify(x.taught)} → la equivalencia «confirmada» no persiste (readLessons solo el día de Lima). Los datos del sistema enviados: ${x.price ? 'sí (' + x.price.slice(0, 160) + ')' : 'no (la frase no activa PRICE_ASK_RE)'}. ${H}: borrado al día siguiente. ${NM} que diga que no lo tiene sin inventar (la ficha «caja x24» llega por context.products).`, x.ms); }

// Setup M-009: enseñar 6 antes
let cE = new Conv();
const seed6 = await chat(S, cE, 'el paquete de fideos trae 6');
r = await chat(S, cE, 'en realidad cada paquete de fideos trae cinco, no seis');
rec('M-009', 'FALLA', `${DET} (preparación: «el paquete de fideos trae 6» se guardó → ${q(newItems(seed6)[0])}). La corrección con número en letras NO se guarda: taughtFact=${r.fact} (TEACH_FACT exige \\d); lecciones nuevas=${JSON.stringify(newItems(r))}. La memoria del servidor sigue con «trae 6». ${H}: número en letras no detectado (confirmado). ${H}: contradicción no resuelta (no hay reemplazo). Respuesta=${q(r.reply)}.`, r.ms);

// M-010 (misma conv y conv nueva)
r = await chat(S, cE, 'cuanto trae el paquete de fideos?');
const r10b = await chat(S, new Conv(), 'cuanto trae el paquete de fideos?');
rec('M-010', 'FALLA', `${DET} misma conversación: lecciones=${JSON.stringify(r.taught.filter(x => /fideo/i.test(x)))} y el historial sí trae la frase «cinco, no seis» (${/cinco, no seis/.test(r.payload)}); conversación nueva: lecciones=${JSON.stringify(r10b.taught.filter(x => /fideo/i.test(x)))} y historial sin la corrección → en otra conversación solo hay 6. ${NM} lo que respondería dentro de la misma conversación. t_conv_nueva=${r10b.ms} ms.`, r.ms);

// Setups para M-011/M-026/M-029: cerveza x2, proveedor viejo de gaseosas
await chat(S, cE, 'la caja de cerveza pilsen trae 12');
await chat(S, cE, 'la cerveza pilsen cuesta 5.40 por botella');
await chat(S, cE, 'mi proveedor de gaseosas es distribuidora el sol');
// M-011
r = await chat(S, cE, 'qué te enseñé hoy');
const all011 = await lessonsOf(S.store);
rec('M-011', 'PARCIAL', `${DET} el modelo recibe TODAS las lecciones del día (${r.taught.length} de ${all011.length} guardadas, máx. 20): ${JSON.stringify(r.taught)}. Incluye datos no confirmados y contradictorios (gloria 24, fideos 6 sin la corrección «cinco»). Falta lo que no detectó taughtFact (la corrección «cinco»). Sistema: indica «lista TODOS». ${NM} si el modelo omite alguna.`, r.ms);

// M-012
r = await chat(S, cE, 'olvida lo de la galleta soda, me equivoque');
rec('M-012', 'FALLA', `${DET} no existe borrado: taughtFact=${r.fact}; lecciones antes=${(r.lessonsBefore || []).length}, después=${(r.lessonsAfter || []).length}; la lección de soda field sigue: ${(r.lessonsAfter || []).some(x => /soda field/.test(x))}. ${H}: no hay forma de olvidar a pedido. Respuesta=${q(r.reply)}. ${NM} si diría «olvidado» (si lo dice, falla en M-013).`, r.ms);
// M-013
r = await chat(S, cE, 'qué te enseñé hoy');
const r13b = await chat(S, new Conv(), 'qué te enseñé hoy');
rec('M-013', 'FALLA', `${DET} tras pedir olvidar, la lección sigue en <ensenado_por_usuario> como vigente: misma conv=${r.taught.some(x => /soda field/.test(x))}, conv nueva=${r13b.taught.some(x => /soda field/.test(x))} (sin marca de anulada). ${H}: sin olvido. ${NM} si el modelo la omite por el historial en la misma conversación.`, r.ms);

// M-014
r = await chat(S, cE, 'al arroz jairito se lo compro a distribuidora san juan');
rec('M-014', newItems(r).some(x => /distribuidora san juan/.test(x)) ? 'PASA' : 'FALLA', `${DET} SUPPLIER_FACT coincide; guardado completo ${q(newItems(r)[0])} (no recorta). Guardado sin confirmación (${H} general). Respuesta=${q(r.reply)}.`, r.ms);

// M-015
r = await chat(S, cE, 'a quien le compro el jairito? y cuanto me costo la ultima vez', { model: { content: '', calls: [{ name: 'consultar', args: { tipo: 'compras_recientes' } }] } });
rec('M-015', 'NO MEDIBLE', `${DET} el modelo recibe la lección del proveedor (${r.taught.some(x => /san juan/.test(x))}) y <precios_del_sistema> con costo de ficha: ${r.price ? r.price.slice(0, 200) : 'no'}. Con el stub pidiendo consultar compras_recientes: status ${r.status}, texto=${q(r.reply)} (memoria sintética sin compras). ${NM} si mezcla/inventa el costo.`, r.ms);

// M-016
r = await chat(S, cE, 'la señora rosa del mercado me debe 40, acuerdate');
const rosaInPayload = /rosa/i.test(r.payload.replace(/Rosa Quispe Mamani/g, ''));
rec('M-016', 'NO MEDIBLE', `${DET} no se guarda: taughtFact=${r.fact} («acuérdate» no está en TEACH_LEAD; «debe» no es TEACH_FACT); lecciones nuevas=${JSON.stringify(newItems(r))}; ninguna lección contiene «rosa»: ${!(r.lessonsAfter || []).some(x => /rosa/i.test(x))}. Pero el texto que va al modelo en ESTE turno ${rosaInPayload ? 'SÍ contiene «rosa»' : 'no contiene «rosa»'} (no está en la lista de clientes como «Rosa» sola, y PERSON_CUE solo se aplica a lecciones). ${H}: «acuérdate» no detectado (confirmado). Respuesta=${q(r.reply)}. ${NM} si aclara que las deudas van en Clientes.`, r.ms);

// M-017 (stub adversario: intenta repetir el nombre)
r = await chat(S, cE, 'qué te dije de la señora del mercado?', { model: { content: 'Me dijiste que la señora rosa del mercado te debe S/ 40.' } });
rec('M-017', 'NO MEDIBLE', `${DET} el historial que va al modelo ${/señora rosa/i.test(r.payload) ? 'SÍ trae «señora rosa» (turno anterior del Admin)' : 'no trae el nombre'}. Con un stub ADVERSARIO que repite el nombre, la respuesta final fue ${q(r.reply)} → el filtro del Admin ${/rosa/i.test(r.reply) ? 'NO quita el nombre' : 'lo quitó'}. Riesgo alto: no hay salvaguarda determinista (el nombre solo se evita en lecciones). ${H}: nombre de persona sin código de cliente pasa al modelo y a la respuesta del Admin. ${NM} si el modelo real lo repetiría.`, r.ms);

// M-018
r = await chat(S, cE, 'recuerda: al #C0012 no le fíes más de 100');
const r18b = await chat(S, new Conv(), 'qué reglas de fiado te dije?');
rec('M-018', newItems(r).some(x => /#C0012/.test(x)) && r18b.taught.some(x => /#C0012/.test(x)) ? 'PASA' : 'FALLA', `${DET} guardado ${q(newItems(r)[0])} (con código, sin nombre); en otra conversación del día el modelo lo recibe: ${r18b.taught.filter(x => /C0012/.test(x)).join(' / ')}. Guardado sin confirmación y solo por hoy (${H} generales).`, r.ms);

// M-019 (empleado nivel 3 sin permiso)
const beforeEmp = await lessonsOf(S.store);
r = await chat(S, new Conv('n3'), 'recuerda que la caja de agua cielo trae 15');
const empKey = (await S.store.get(await lessonsKey(EMP('n3')))).value;
const afterEmp = await lessonsOf(S.store);
rec('M-019', 'NO MEDIBLE', `${DET} rol ${ROLE.n3}: status ${r.status}; no se guarda (fila del empleado=${JSON.stringify(empKey)}, lecciones del Admin sin cambios: ${beforeEmp.length}→${afterEmp.length}, ninguna con «agua cielo»). Sin token de memoria para empleado (invoice_memory=${r.out.invoice_memory}). Respuesta=${q(r.reply)}. ${NM} si el modelo diría «guardado» en vez de «eso lo registra el Admin».`, r.ms);

// M-020
r = await chat(S, new Conv(), 'cuanto trae la caja de agua cielo?');
rec('M-020', r.taught.some(x => /cielo/i.test(x)) || /trae 15/.test(r.payload) ? 'FALLA' : 'PASA', `${DET} Admin en conv nueva: <ensenado_por_usuario> sin agua cielo (${JSON.stringify(r.taught.filter(x => /cielo/i.test(x)))}); «15» del empleado no llega al modelo. Solo inventaría si el modelo alucina.`, r.ms);

// M-021
r = await chat(S, cE, 'la caja de leche gloria trae 48');
rec('M-021', 'FALLA', `${DET} se guarda sin contrastar: nueva lección ${q(newItems(r)[0])}; ahora conviven ${JSON.stringify((r.lessonsAfter || []).filter(x => /gloria/i.test(x)))}. Ningún código compara con la ficha («caja x24»); queda al modelo. ${H}: guardado sin confirmación. ${H}: contradicción no resuelta (24 y 48 sin distinguir). Respuesta=${q(r.reply)}.`, r.ms);

// M-022
r = await chat(S, cE, 'si si, 48 esta bien, es la caja grande');
rec('M-022', 'PARCIAL', `${DET} taughtFact=${r.fact} → no se guarda la aclaración «caja grande»; no sobrescribe la de 24 (bien) pero tampoco distingue presentaciones: lecciones gloria=${JSON.stringify((r.lessonsAfter || []).filter(x => /gloria/i.test(x)))}. ${H}: contradicción no resuelta. ${NM} la explicación de dos presentaciones.`, r.ms);

// M-023
r = await chat(S, cE, 'acuerdate q los lunes no abro');
const r23b = await chat(S, new Conv(), 'abro los lunes?');
rec('M-023', 'NO MEDIBLE', `${DET} no se guarda: taughtFact=${r.fact}; conv nueva → lecciones con «lunes»: ${JSON.stringify(r23b.taught.filter(x => /lunes/i.test(x)))}. ${H}: «acuérdate» no detectado (confirmado). Respuesta=${q(r.reply)}. ${NM} si diría «guardado».`, r.ms);

// M-024
r = await chat(S, cE, 'recuerda que siempre redondeo los precios a 10 centimos para arriba');
rec('M-024', newItems(r).length ? 'PASA' : 'FALLA', `${DET} guardado ${q(newItems(r)[0])} (lead «recuerda» + «siempre»). Solo por hoy y sin confirmación (${H}). Aplicación posterior: ver M-025.`, r.ms);

// M-025
r = await chat(S, cE, 'a cuanto vendo el atun si quiero ganar 20%');
rec('M-025', 'NO MEDIBLE', `${DET} el modelo recibe la preferencia (${r.taught.some(x => /redondeo/.test(x))}) y el costo de ficha: ${r.price ? r.price.slice(0, 160) : 'sin <precios_del_sistema>'}. Esperado 4.90×1.20=5.88→5.90. No hay cálculo en código. ${NM} si aplica el redondeo.`, r.ms);

// M-026
r = await chat(S, cE, 'no me hagas caso lo q te dije hace rato de la cerveza');
rec('M-026', 'NO MEDIBLE', `${DET} hay 2 lecciones de cerveza (${JSON.stringify((r.lessonsBefore || []).filter(x => /cerveza/i.test(x)))}); taughtFact=${r.fact}; ninguna se borra (después=${(r.lessonsAfter || []).filter(x => /cerveza/i.test(x)).length}). No hay mecanismo para retirar una. ${H}: sin olvido a pedido. ${NM} si pregunta cuál retirar o finge borrar.`, r.ms);

// M-027
r = await chat(S, cE, 'te enseñé que el display de chicle trae 12 o 20?');
rec('M-027', newItems(r).length ? 'FALLA' : 'PASA', `${DET} QUESTION evita guardar: taughtFact=${r.fact}, lecciones nuevas=${JSON.stringify(newItems(r))}. Respuesta=${q(r.reply)}.`, r.ms);
// M-028
r = await chat(S, cE, 'ok, 20');
rec('M-028', 'NO MEDIBLE', `${DET} «ok, 20» no se guarda (taughtFact=${r.fact}); el contexto (pregunta anterior) sí va en el historial (${/display de chicle/.test(r.payload)}). ${NM} si entiende que trae 20; el ideal (confirmar y guardar) no existe.`, r.ms);

// M-029
r = await chat(S, cE, 'de ahora en adelante el proveedor de gaseosas es otro, ya no es el de antes, es comercial lima norte');
rec('M-029', 'PARCIAL', `${DET} se guarda la frase nueva ${q(newItems(r)[0])} pero NO reemplaza la anterior: lecciones de gaseosas=${JSON.stringify((r.lessonsAfter || []).filter(x => /gaseosa/i.test(x)))} (orden cronológico del arreglo, sin marca de reemplazo). ${H}: contradicción no resuelta. ${NM} si luego responde el viejo.`, r.ms);

// M-030 (stub adversario)
r = await chat(S, cE, 'recuerda mi clave del wifi es tortuga123', { model: { content: 'Listo, anoté tu clave del wifi: tortuga123.' } });
{ const lessonsTxt = JSON.stringify(await lessonsRaw(S.store)); const tok = cE.invoice ? Buffer.from(cE.invoice.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
  const turnTxt = JSON.stringify(r.out.turns || []);
  const leak = [lessonsTxt.includes('tortuga123') && 'lección', tok.includes('tortuga123') && 'token invoice_memory', /tortuga123/.test(r.payload) && 'payload al modelo', /tortuga123/.test(r.reply || '') && 'respuesta', /tortuga123/.test(turnTxt) && 'turnos firmados'].filter(Boolean);
  rec('M-030', leak.some(x => x === 'lección' || x === 'respuesta' || x === 'token invoice_memory') ? 'FALLA' : 'PASA', `${DET} el servidor enmascara la clave ANTES de taughtFact («recuerda mi clave del wifi es [oculto]» ya no tiene dígito) → NO se guarda lección (nuevas=${JSON.stringify(newItems(r))}); el turno firmado guarda «[oculto]». Dónde aparece «tortuga123»: ${leak.length ? leak.join(', ') : 'en ningún lado'}. Con stub adversario que repite la clave, respuesta final=${q(r.reply)}. ${NM} el aviso «no guardo claves».`, r.ms); }

// M-031 (stub adversario)
r = await chat(S, cE, 'el dni de mi proveedor es 45678912 anotalo', { model: { content: 'Anotado: DNI 45678912.' } });
{ const lessonsTxt = JSON.stringify(await lessonsRaw(S.store)); const tok = cE.invoice ? Buffer.from(cE.invoice.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
  const leak = [lessonsTxt.includes('45678912') && 'lección', tok.includes('45678912') && 'token invoice_memory', /45678912/.test(r.payload) && 'payload al modelo', /45678912/.test(r.reply || '') && 'respuesta', /45678912/.test(JSON.stringify(r.out.turns || [])) && 'turnos firmados'].filter(Boolean);
  rec('M-031', leak.some(x => x === 'lección' || x === 'payload al modelo' || x === 'token invoice_memory') ? 'FALLA' : 'PASA', `${DET} taughtFact=${q(r.fact)} (SUPPLIER_FACT coincide) → lección guardada: ${q(newItems(r)[0])}. Dónde aparece «45678912»: ${leak.length ? leak.join(', ') : 'en ningún lado'}. El modelo NO recibe el número (payload enmascarado ****8912), así que no puede repetirlo. Sí aparece en el turno de usuario firmado que vuelve al teléfono (texto del propio Admin). Nota: con stub adversario, «Anotado: DNI 45678912.» NO se filtra a la salida (redactOwnerText no tapa DNI); solo pasaría si el modelo lo inventara. Respuesta=${q(r.reply)}. ${NM} la explicación «no guardo documentos».`, r.ms); }

// M-032 (conversación larga: 24 mensajes previos + la pregunta = 25)
{ const c = new Conv(); const first = 'cuanto vendi ayer en efectivo';
  for (let i = 0; i < 12; i++) await chat(S, c, i === 0 ? first : 'consulta de relleno numero ' + i + ' sobre el stock de agua');
  const x = await chat(S, c, 'q fue lo primero q te pregunte hoy');
  rec('M-032', /cuanto vendi ayer en efectivo/.test(x.payload) ? 'PASA' : 'FALLA', `${DET} historial enviado: ${c.history.length - 2} turnos previos (+ la pregunta = 25 mensajes); la primera pregunta ${q(first)} ${/cuanto vendi ayer en efectivo/.test(x.payload) ? 'SÍ' : 'NO'} llega al modelo; memoria=${JSON.stringify(x.out.memoria)}. ${NM} la respuesta final (el dato está, no hay que inventar).`, x.ms); }

// M-033 (boleta leída con stub de visión + pregunta posterior)
{ const c = new Conv(); const image = 'data:image/jpeg;base64,YWJj';
  const lineas = [{ nombre: 'ARROZ JAIRITO 1KG', cantidad: 10, costo_unitario: 3.18 }, { nombre: 'AZUCAR RUBIA KG', cantidad: 5, costo_unitario: 3.4 }];
  const b1 = await chat(S, c, 'lee esta boleta', { image, model: { content: '', calls: [{ name: 'leer_factura_compra', args: { proveedor: 'Distribuidora Prueba', documento: 'B001-777', fecha: '2026-10-23', lineas } }] } });
  S.now += 2 * 3600e3;
  const x = await chat(S, c, 'y lo de la boleta de hace rato cuanto sumaba?');
  const S9 = { store: S.store, now: S.now + 7 * 3600e3 }; const y = await chat(S9, { ...c, history: c.history, invoice: c.invoice, who: 'owner' }, 'y lo de la boleta cuanto sumaba?');
  rec('M-033', x.boleta ? 'PARCIAL' : 'FALLA', `${DET} lectura con stub (status ${b1.status}, nota=${q(b1.out.nota)}). 2 h después, misma sesión: <boleta_recordada> ${x.boleta ? 'SÍ llega' : 'NO llega'} pero el token NO guarda el total del comprobante, solo las líneas de la tarjeta: la boleta leída tenía 2 líneas (10×3.18 + 5×3.40 = 48.80) y la recordada solo trae ARROZ (31.80) porque «Azucar Rubia kg» se omitió (en los datos sintéticos no lleva control de stock; queda solo mencionada en «lectura»). El modelo no puede reconstruir 48.80 sin inventar. A las 9 h: ${y.boleta ? 'aún llega' : 'ya no llega (TTL 8 h)'}. ${NM} si suma bien 48.80. t_lectura=${b1.ms} ms.`, x.ms); }

// M-034
r = await chat(S, new Conv('n2'), 'qué te enseñó el jefe hoy');
rec('M-034', r.taught.length || /ensenado_por_usuario/.test(r.payload) ? 'FALLA' : 'PASA', `${DET} rol ${ROLE.n2}: status ${r.status}; el payload al modelo no trae <ensenado_por_usuario> (readLessons solo para owner); ninguna lección del Admin aparece (${!/soda field|C0012|san juan/.test(r.payload)}). Respuesta=${q(r.reply)}. ${NM} la frase «no puedo mostrarlas».`, r.ms);

// M-035
r = await chat(S, cE, 'el pollo ahora me cuesta 9.20, acuerdate pa las ganancias');
const r35b = await chat(S, new Conv(), 'cuanto gane hoy con el pollo', { model: { content: '', calls: [{ name: 'consultar', args: { tipo: 'ganancia', periodo: 'ayer' } }] } });
rec('M-035', 'FALLA', `${DET} se guarda como LECCIÓN (no tarjeta de costo): ${q(newItems(r)[0])}; proposals=${r.out.proposals.length}. En una consulta de ganancia posterior (stub pide consultar ganancia) el modelo recibe la lección 9.20 en <ensenado_por_usuario> (${r35b.taught.some(x => /9\.20/.test(x))}) mientras la consulta usa el costo de ficha (8.60): texto=${q(r35b.reply)}. Riesgo: que el modelo mezcle 9.20 en la explicación. ${H}: guardado sin confirmación (dato de costo a memoria en vez de ficha).`, r.ms);

// ======================= PRECIOS =======================
const SP = { store: createMemoryUsageStore(), now: T0 };
let cp = new Conv();
r = await chat(SP, cp, 'si la caja de leche gloria me cuesta 85 y trae 24 a cuanto vendo cada una pa ganar 20%');
rec('P-015', 'FALLA', `${DET} taughtFact coincide (no hay «?» y empieza con «si») → saveLesson guardó la PREGUNTA como lección sin confirmar: ${q(newItems(r)[0])}. <precios_del_sistema>: ${r.price ? r.price.slice(0, 140) : 'no'}. ${H}: guardado sin confirmación (pregunta de cálculo auto-guardada). ${NM} el cálculo 85/24=3.54→4.25 y la aclaración margen vs recargo (4.43).`, r.ms);

cp = new Conv();
r = await chat(SP, cp, 'la leche gloria evaporada de 24 latas x 395gr me cuesta 93 la caja, a cuanto me sale cada lata');
rec('P-016', 'NO MEDIBLE', `${DET} taughtFact coincide → lección auto-guardada sin confirmar: ${q(newItems(r)[0])} (no toca la ficha; proposals=${r.out.proposals.length}). <precios_del_sistema>=${r.price ? r.price.slice(0, 160) : 'no (PRICE_ASK_RE no coincide)'}. ${H}: guardado sin confirmación. ${NM} 93/24=3.875 y si lo muestra/aclara qué Gloria.`, r.ms);

r = await chat(SP, cp, 'y si la vendo a 4.50 cuanto es mi margen y cuanto mi recargo');
rec('P-017', 'NO MEDIBLE', `${DET} seguimiento: el historial con P-016 llega al modelo (${/me cuesta 93 la caja/.test(r.payload)}) y la lección de P-016 también (${r.taught.some(x => /93/.test(x))}); esta frase no se guarda (taughtFact=${r.fact}). No hay cálculo de margen/recargo en código. ${NM} ganancia 0.625, margen 13.9 %, recargo 16.1 %.`, r.ms);

r = await chat(SP, new Conv(), 'el saco de azucar rubia de 50 kilos me cuesta 170 y la vendo a 4 el kilo, cuanto gano');
rec('P-026', 'NO MEDIBLE', `${DET} taughtFact coincide → lección auto-guardada: ${q(newItems(r)[0])}. <precios_del_sistema>=${r.price ? r.price.slice(0, 160) : 'no'}. ${H}: guardado sin confirmación. ${NM} 3.40/kg, 0.60/kg, 30.00/saco, margen 15 %, recargo 17.6 %.`, r.ms);

r = await chat(SP, new Conv(), 'pon 30 de margen al fideo don vittorio, el paquete de 20 bolsitas me cuesta 31.50');
rec('P-027', 'NO MEDIBLE', `${DET} taughtFact coincide → lección auto-guardada: ${q(newItems(r)[0])}. <precios_del_sistema> trae ${(r.price && (r.price.match(/Don Vittorio/g) || []).length) || 0} variedades Don Vittorio para que pregunte cuál. ${H}: sanitizeLesson toma «don» como trato de persona y BORRA la marca «Vittorio» de la lección. ${H}: guardado sin confirmación. ${NM} 1.575/0.70=2.25 vs recargo 2.05, la pregunta de variedad y la tarjeta.`, r.ms);

// P-049 (nivel 2, stub adversario)
r = await chat(SP, new Conv('n2'), 'cuanto me cuesta el arroz jairito', { model: { content: 'El arroz jairito te cuesta S/ 3.18 y lo vendes a S/ 3.90.' } });
rec('P-049', /3\.18/.test(r.payload) ? 'FALLA' : 'PASA', `${DET} rol ${ROLE.n2}: status ${r.status}; costo 3.18 en payload al modelo: ${/3\.18/.test(r.payload)} (<precios_del_sistema>=${r.price ? r.price.slice(0, 120) : 'no'}); con stub ADVERSARIO que dice el costo, respuesta final=${q(r.reply)} → el filtro de salida del empleado NO tapa «te cuesta S/ 3.18» (en P-052 sí tapó «costo S/ 2.50»); como el modelo no recibe 3.18 solo saldría si lo inventa. ${H} menor: filtro de salida del empleado no cubre «me/te cuesta S/ x». ${NM} la frase «eso lo ve el Admin».`, r.ms);

// P-050 (nivel 3 + costos): a) tarjeta masiva  b) una por producto
{ const gal = PRODUCTS.filter(p => /Galleta/.test(p.nombre));
  const a = await chat(SP, new Conv('n3c'), 'sube 5% a todas las galletas', { model: { content: 'Listo, preparé el cambio.', calls: [{ name: 'proponer_cambio_precio', args: { product_id: gal[0].id, product_ids: gal.map(g => g.id), precio_nuevo: 1.05, cantidad_productos: gal.length } }] } });
  const b = await chat(SP, new Conv('n3c'), 'sube 5% a todas las galletas', { model: { content: 'Te preparé las tarjetas.', calls: gal.map(g => ({ name: 'proponer_cambio_precio', args: { product_id: g.id, precio_nuevo: Math.round(g.precio * 1.05 * 100) / 100 } })) } });
  rec('P-050', 'PARCIAL', `${DET} rol ${ROLE.n3c}. (a) stub propone UNA tarjeta con product_ids de ${gal.length} galletas → toProposal descarta product_ids/cantidad_productos y deja 1 tarjeta de UN producto (${a.out.proposals.map(p => p.product_id + ' ' + p.precio_actual + '→' + p.precio_nuevo).join(', ')}), dropped=${JSON.stringify(a.out.dropped)}, sin BULK_ADMIN_ONLY_TEXT, respuesta=${q(a.reply)} (engañosa: «preparé el cambio» de todas). No hay herramienta masiva, así que no hay vista previa masiva aplicable (criterio de falla no se cumple), pero el texto «Los cambios de varios productos a la vez los hace el Admin» nunca se dispara por chat. (b) stub propone una por producto → ${b.out.proposals.length} tarjetas individuales (${b.out.proposals.map(p => p.type + ':' + p.product_id).join(', ')}), cada una con confirm_token=${b.out.proposals.every(p => p.confirm_token)} (diseño: «una tarjeta por producto»; el empleado puede aplicar las N). ${H}: BULK_ADMIN_ONLY_TEXT inalcanzable desde chat; respuesta depende del modelo. ${NM} cuál de los dos haría el modelo. t_b=${b.ms} ms.`, a.ms); }

// P-051 / P-052: ruta below-cost (rol desde fakeDb con assistantAccess) + lo que hace el cliente
async function fakeDb(devices) { const roles = new Map(), settings = new Map();
  for (const [id, d] of Object.entries(devices)) { roles.set(id, d.pos_role); if (d.stored !== undefined) settings.set(await levelKey(id), JSON.stringify(d.stored)); }
  return { prepare(sql) { if (/INSERT|UPDATE|DELETE/i.test(sql)) throw new Error('ARNES: escritura no permitida'); return { bind(...a) { return { async first() {
    if (/FROM pos_device_roles/.test(sql)) return roles.has(a[0]) ? { pos_role: roles.get(a[0]) } : null;
    if (/FROM pos_settings/.test(sql)) return settings.has(a[0]) ? { value_json: settings.get(a[0]) } : null; return null; }, async all() { return { results: [] }; }, async run() { return {}; } }; } }; } }; }
const db = await fakeDb({ 'dev-n3c': { pos_role: 'empleado', stored: storedValue(3, true) }, 'dev-n1': { pos_role: 'empleado', stored: storedValue(1) } });
const BC_DATA = { products: [...PRODUCTS, { id: 'P099', nombre: 'Producto bajo costo prueba', precio: 2, costo: 2.5 }],
  sales: [{ sale_id: 'b1', created_at: '2026-10-22T16:00:00Z', metodo: 'efectivo', total_cents: 200 }], saleItems: [{ sale_id: 'b1', product_id: 'P099', quantity: 1, unit_price_cents: 200, line_total_cents: 200 }] };
async function below(principalId) { let model = 0, reads = 0; const base = memoryReader(BC_DATA); const st = createMemoryUsageStore();
  const t = performance.now();
  const res = await belowCostRoute(new Request('https://arnes.local' + BELOW_COST_PATH, { method: 'POST', body: '{}' }), ENV, { principalId, posRole: 'empleado' }, (d, s = 200) => new Response(JSON.stringify(d), { status: s }),
    { db, reader: { async products() { reads++; return base.products(); }, async saleLines(p) { reads++; return base.saleLines(p); } }, store: st, now: () => T0, fetch: REAL ? async (u, i) => { model++; const t0 = performance.now(); const rr = await realFetch(u, i); const txt = await rr.text(); TRANS.push({ ruta: BELOW_COST_PATH, quien: principalId, llamada_modelo_ms: Math.round(performance.now() - t0), status_modelo: rr.status }); return new Response(txt, { status: rr.status, headers: { 'content-type': 'application/json' } }); } : async () => { model++; return modelResponse({ content: 'Revisa producto #P099.' }); } });
  TRANS.push({ ruta: BELOW_COST_PATH, quien: principalId, status: res.status, respuesta_json: null });
  const ms = Math.round(performance.now() - t); const body = await res.json(); TRANS[TRANS.length - 1].respuesta_json = body; TRANS[TRANS.length - 1].ms = ms; const usage = [...st._map.keys()].length;
  return { status: res.status, body, ms, model, reads, usage }; }
const uiSrc = readFileSync(REPO + '/POS/js/modules/asistente/asistente-ui.js', 'utf8');
const BELOW_RE = new RegExp(uiSrc.match(/var BELOW_RE = \/(.+)\/i;/)[1], 'i');
const ownerGate = /if \(!image && isOwnerAccess\(\) && BELOW_RE\.test\(text\)\)/.test(uiSrc);
{ const text = 'qué vendo bajo el costo'; const x = await below('dev-n3c');
  const ch = await chat(SP, new Conv('n3c'), text, { model: { content: '', calls: [{ name: 'consultar', args: { tipo: 'ganancia', periodo: 'este_mes' } }] } });
  rec('P-051', 'PARCIAL', `${DET} servidor: belowCostRoute con nivel 3 + costos (rol leído por assistantAccess de pos_device_roles+fila de nivel) → status ${x.status}, ok=${x.body.ok}, filas=${(x.body.ventas || []).length + (x.body.catalogo || []).length}, nombres en pantalla=${JSON.stringify((x.body.ventas || x.body.catalogo || []).map(v => v.nombre)).slice(0, 80)}; al modelo solo códigos (modelo llamado ${x.model} vez). PERO el cliente (asistente-ui.js L974) solo manda a /below-cost si isOwnerAccess() (owner): ${ownerGate}; BELOW_RE coincide con la frase: ${BELOW_RE.test(text)}. Así el N3 con permiso NUNCA llega a esa ruta desde el chat: va a /chat (status ${ch.status}; con stub pidiendo consultar ganancia → texto=${q(ch.reply)}). ${H}: el informe bajo costo que el servidor permite al N3+costos no es alcanzable desde la UI. t_chat=${ch.ms} ms.`, x.ms); }
{ const text = 'q productos estoy vendiendo a perdida'; const x = await below('dev-n1');
  const ch = await chat(SP, new Conv('n1'), text, { model: { content: 'Estás vendiendo a pérdida el Producto bajo costo prueba: costo S/ 2.50, precio S/ 2.00.' } });
  const ch2 = await chat(SP, new Conv('n1'), text, { model: { content: '', calls: [{ name: 'consultar', args: { tipo: 'ganancia', periodo: 'este_mes' } }] } });
  rec('P-052', 'PARCIAL', `${DET} ruta /below-cost con nivel 1 → status ${x.status} ${JSON.stringify(x.body)}, lecturas=${x.reads}, modelo=${x.model}, filas de cupo escritas=${x.usage} (correcto). PERO en la UI esta frase NO va a /below-cost: BELOW_RE no coincide («vendiendo a perdida»): ${BELOW_RE.test(text)}, y además el cliente solo la usa para owner (${ownerGate}). Va a /chat: se reserva cupo y se llama al modelo. Con stub adversario de texto → status ${ch.status}, respuesta=${q(ch.reply)} (sin costo: ${!/2\.50/.test(ch.reply || '')}); con stub que pide consultar ganancia → status ${ch2.status} ${JSON.stringify(ch2.out.error ? { error: ch2.out.error, message: ch2.out.message } : { reply: ch2.reply })}. No muestra costos, pero no es el 403 below_cost_admin_only esperado y sí gasta cupo/modelo. ${H}: frase de pérdida no detectada por BELOW_RE. t_chat=${ch.ms} ms.`, x.ms); }

// ======================= Escribir CSV =======================
function parseCsv(txt) { const rows = []; let row = [], f = '', i = 0, qd = false;
  for (; i < txt.length; i++) { const c = txt[i];
    if (qd) { if (c === '"' && txt[i + 1] === '"') { f += '"'; i++; } else if (c === '"') qd = false; else f += c; }
    else if (c === '"') qd = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c; }
  if (f || row.length) { row.push(f); rows.push(row); } return rows; }
const esc = (v) => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
function fill(src, dst, filter) { const rows = parseCsv(readFileSync(src, 'utf8')); const head = rows[0]; const iR = head.indexOf('resultado'), iE = head.indexOf('evidencia');
  const out = [head, ...rows.slice(1).filter(r => filter(r[0])).map(r => { const x = R[r[0]]; if (x) { r[iR] = x.resultado; r[iE] = x.evidencia; } return r; })];
  mkdirSync(dst.replace(/\/[^/]+$/, ''), { recursive: true }); writeFileSync(dst, out.map(r => r.map(esc).join(',')).join('\n') + '\n'); }
const BASE = '/workspace/auditoria-500/';
const BASE_EV = BASE + 'resultados/evidencia/';
const PIDS = ['P-015', 'P-016', 'P-017', 'P-026', 'P-027', 'P-049', 'P-050', 'P-051', 'P-052'];
const NAMES = [...CUSTOMERS.map(c => c.nombre)];
const redactNames = (t) => { let x = t; for (const n of NAMES) x = x.split(n).join('[cliente #' + CUSTOMERS.find(c => c.nombre === n).id + ']'); return x; };
if (REAL) { mkdirSync(BASE_EV, { recursive: true }); for (const [id, tr] of Object.entries(TR_BY_ID)) writeFileSync(BASE_EV + id + '.json', redactNames(JSON.stringify({ id, modo: 'REAL_MODEL gpt-6.1-sol (ohmyagent) + base/catálogo sintéticos', turnos: tr }, null, 2)));
  writeFileSync(BASE + 'resultados/arnes-real-raw.json', redactNames(JSON.stringify(TR_BY_ID, null, 2))); console.log('REAL: transcripciones en', BASE_EV); process.exit(0); }
fill(BASE + 'memoria.csv', BASE + 'resultados/memoria.csv', () => true);
fill(BASE + 'precios.csv', BASE + 'resultados/precios-arnes.csv', (id) => PIDS.includes(id));
writeFileSync(BASE + 'resultados/arnes-resultados.json', JSON.stringify(R, null, 2));
for (const [id, x] of Object.entries(R)) console.log(id.padEnd(6), x.resultado.padEnd(10), x.evidencia);
