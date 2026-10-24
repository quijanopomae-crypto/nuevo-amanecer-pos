// Batería de preguntas del asistente (Burbuja): 122 preguntas escritas como las escribe el Admin o un empleado, cada una con sus reglas.
// Fuente: tests/asistente/fixtures/bateria-asistente.json. Cada pregunta trae `modo`:
//   - "offline": se revisa aquí, en CI, sin red. Un modelo SIMULADO devuelve la llamada de herramienta esperada (`simulacion`), así lo que
//     se prueba es el SERVIDOR: la tarjeta que arma (texto y filas), las puertas del empleado (403 / descartes), que al modelo no lleguen
//     nombres de clientes, que ninguna pregunta peligrosa deje una tarjeta que cambie algo y que nada pida PIN fuera de borrar/resetear.
//     Además se mide el ruteo del modo demostración (sin clave). Las fallas conocidas del producto van como `todo` (se ven, no frenan CI).
//   - "solo_en_vivo": dependen del modelo real (respuesta cortés, no inventar cifras, etc.). Aquí se saltan y se listan.
//   Las reglas de cada pregunta que solo se pueden revisar con el modelo real están en `reglas_solo_en_vivo`.
//
// MODO EN VIVO (manual, no corre en CI):
//   - Lo corre una persona desde la sesión del Admin YA ABIERTA en su navegador, en la página del POS, después de publicar.
//   - Las preguntas se mandan a /auth/assistant/chat desde esa misma página (fetch del propio sitio, con su sesión). Nunca se copian
//     cookies, tokens, claves de la IA ni el PIN a otro lado, ni a un script, ni a este repositorio. Solo preguntas: sin ventas ni cambios,
//     y ninguna tarjeta «Confirmar» se confirma.
//   - Se guarda la respuesta, las tarjetas y el tiempo de cada pregunta en /tmp/bateria-resultado.json (nunca dentro del repo) y se aplican
//     las mismas `reglas`; las que piden comparar con la pantalla (*_equals_screen) se revisan a mano.
//   - Cada falla en vivo se vuelve una regla del prompt y una pregunta "offline" nueva aquí, con el modelo simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assistantChatRoute, assistantConfirmRoute, createMemoryUsageStore, toolsForRole, EMPLOYEE_CHANGE_TEXT, DOC_TYPES } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader, QUERY_TYPES } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });

const BAT = JSON.parse(readFileSync(new URL('./fixtures/bateria-asistente.json', import.meta.url), 'utf8'));
const SECRET = 'secreto-de-prueba-bateria-0123456789';
const NOW = Date.parse('2026-10-23T01:30:00.000Z'); // jueves 2026-10-22, 20:30 en Lima: «hoy» sigue siendo el 22
const OWNER = { principalId: 'session:bateria-admin', posRole: 'owner' };
const EMP = { principalId: 'session:bateria-emp', posRole: 'empleado' };
const EMP_ROLE = 'empleado:consultas_documentos';
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEB';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

// ---------- Datos inventados de una bodega (nunca datos reales) ----------
// Costos con centavos raros: si aparecen donde no deben (empleado), se nota. RECARGAS y PRÉSTAMOS llegan con control de stock,
// como en la base real (categoría «servicios» no se aparta).
const P = [
  ['P1', 'ARROZ COSTEÑO', 4.2, 3.61, 25, 5], ['P2', 'AZUCAR RUBIA', 3.5, 2.93, -3, 0], ['P3', 'LECHE GLORIA', 4.2, 3.47, 2, 6],
  ['P4', 'ACEITE PRIMOR', 9, 7.83, 0, 0], ['P5', 'GASEOSA INCA KOLA 500ML', 2.5, 1.79, 30, 12], ['P6', 'HUEVOS', 0.6, 0.47, 90, 30],
  ['P7', 'DETERGENTE BOLIVAR', 6.5, 5.11, 4, 3], ['P8', 'VERDURAS', 0.01, 0, -7660, 0], ['P9', 'VARIOS', 0.1, 0, -120, 0],
  ['P10', 'RECARGAS', 1, 0, -12, 0], ['P11', 'PRÉSTAMOS', 1, 0, 0, 0], ['P12', 'DULCES Y CARAMELOS', 0.1, 0.5, 40, 10]
];
const PRODUCTS = P.map(([id, nombre, precio, costo, stock, min]) => ({ id, nombre, precio, costo: costo || null, stock, min, controla: true }));
const COST_VALUES = ['3.61', '2.93', '3.47', '7.83', '1.79', '0.47', '5.11'];
const CUSTOMERS = [{ id: 'C0012', nombre: 'Rosa Quispe', dni: '40112233', tel: '987111222' }, { id: 'C0007', nombre: 'Juan Mamani', dni: '45556677', tel: '987333444' }, { id: 'C0003', nombre: 'Lucía Torres', dni: '47778899', tel: '987555666' }];
const PERSONAL = CUSTOMERS.flatMap((c) => [c.nombre, c.dni, c.tel, c.nombre.split(' ')[1]]);
const limaIso = (dia, hhmm) => new Date(Date.parse(dia + 'T' + hhmm + ':00.000-05:00')).toISOString();
const SALES_DEF = [['V1', '2026-10-22', '09:10', 'efectivo', [['P1', 2], ['P5', 1]]], ['V2', '2026-10-22', '11:30', 'yape', [['P3', 3]]],
  ['V3', '2026-10-22', '19:40', 'plin', [['P7', 1], ['P6', 10]]], // después de las 7 p. m.: en UTC ya es el 23
  ['V4', '2026-10-21', '10:00', 'yape', [['P1', 5]]], ['V5', '2026-10-21', '18:00', 'efectivo', [['P5', 4]]], ['V6', '2026-10-19', '12:00', 'efectivo', [['P4', 1]]],
  ['V7', '2026-10-14', '16:00', 'efectivo', [['P1', 3]]], ['V8', '2026-09-15', '10:00', 'yape', [['P3', 2]]]];
const SALES = [], ITEMS = [];
for (const [id, dia, h, metodo, lines] of SALES_DEF) {
  let total = 0;
  lines.forEach(([pid, q], n) => { const c = Math.round(PRODUCTS.find((p) => p.id === pid).precio * q * 100); total += c; ITEMS.push({ sale_id: id, line_number: n + 1, product_id: pid, quantity: q, line_total_cents: c }); });
  SALES.push({ sale_id: id, created_at: limaIso(dia, h), metodo, total_cents: total, dia });
}
const DATA = { products: PRODUCTS, sales: SALES, saleItems: ITEMS,
  purchases: [{ supplier: 'Distribuidora Lima SAC', document_ref: 'F001-000120', total_cost_cents: 18640, line_count: 4, status: 'aplicada', created_at: limaIso('2026-10-20', '10:00') },
    { supplier: 'Mayorista Inventado EIRL', document_ref: 'F002-004512', total_cost_cents: 7420, line_count: 2, status: 'aplicada', created_at: limaIso('2026-10-08', '15:00') }],
  customers: CUSTOMERS.map((c) => ({ id: c.id, nombre: c.nombre })),
  credits: [{ cliente: 'C0012', saldo: 28.5, vence: '2026-10-30' }, { cliente: 'C0007', saldo: 18, vence: '2026-10-20' }, { cliente: 'C0012', saldo: 12, vence: '2026-11-15' }, { cliente: 'C0003', saldo: 0, vence: '2026-09-30' }] };
const CONTEXT = { screen: 'pageInventario', products: PRODUCTS.map((p) => ({ id: p.id, nombre: p.nombre, precio: p.precio, costo: p.costo, stock: p.stock })) };
const READ_METHODS = new Set(['products', 'productsById', 'credits', 'customers', 'salesTotals', 'topItems', 'purchases']);

// Lector de solo lectura que anota lo que se usa; `truncated` simula una base que pasó las 20 páginas de 250 filas.
function readerFor({ truncated = false } = {}) {
  const base = memoryReader(DATA), used = [];
  const mark = (v) => { if (truncated && Array.isArray(v)) v.truncated = true; return v; };
  const r = new Proxy(base, { get(t, k) { if (typeof k !== 'string' || k === 'then') return undefined; used.push(k); const f = t[k]; return typeof f === 'function' ? async (...a) => mark(await f.apply(t, a)) : f; } });
  return { reader: r, used };
}
// Base de mentira: anota cada SQL (nada de lo que se prueba debe escribir).
function dbSpy() { const sql = []; const stmt = (s) => ({ bind: () => stmt(s), all: async () => ({ results: [] }), first: async () => null, run: async () => ({}) }); return { sql, prepare: (s) => { sql.push(String(s)); return stmt(s); } }; }
// Modelo simulado (formato DeepSeek): 1.ª respuesta = las llamadas esperadas; las siguientes = texto. Guarda cada pedido.
function scriptedModel(sim) {
  const bodies = [];
  const f = async (url, init) => {
    bodies.push(String(init.body));
    const msg = bodies.length === 1 && sim.llamadas.length
      ? { content: '', tool_calls: sim.llamadas.map((c, i) => ({ id: 'call_' + (i + 1), type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
      : { content: sim.texto_modelo };
    return jsonR({ choices: [{ message: msg, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  };
  f.bodies = bodies; return f;
}
async function ask(item, { demo = false, truncated = false } = {}) {
  const emp = item.rol === 'empleado', sim = item.simulacion, fetch = demo ? null : scriptedModel(sim), rd = readerFor({ truncated }), db = dbSpy(), audit = [];
  const body = { text: item.pregunta.replace(/^\[(foto|pdf)\]\s*/, ''), context: CONTEXT, ...(sim.imagen ? { image: IMG } : {}) };
  const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, ...(demo ? { ASSISTANT_DEMO: '1' } : { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-test-FAKE-bateria' }) };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    env, emp ? EMP : OWNER, jsonR, { store: createMemoryUsageStore(), resolveRole: async () => (emp ? EMP_ROLE : 'owner'), fetch: fetch || undefined, reader: rd.reader, db,
      audit: async (_db, rows) => { audit.push(...rows); }, now: () => NOW, mockChunkMs: 0 });
  const out = await r.json();
  return { status: r.status, out, bodies: fetch ? fetch.bodies : [], used: rd.used, sql: db.sql, env };
}

// ---------- Ayudas de texto ----------
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const rx = (s) => { const i = /^\(\?i\)/.test(s); return new RegExp(i ? s.slice(4) : s, i ? 'i' : ''); };
const rule = (item, tipo) => item.reglas.find((r) => r.tipo === tipo);
const cardOf = (res) => (res.out.proposals || [])[0];
const cardText = (p) => p && p.result ? [p.result.titulo, p.result.texto, JSON.stringify(p.result.columnas), JSON.stringify(p.result.filas)].join(' | ') : JSON.stringify(p || {});
const visible = (res) => JSON.stringify((res.out.proposals || []).map(({ id, confirm_token, ...p }) => p)) + ' ' + (res.out.reply || '') + ' ' + (res.out.message || '');
const STORE_WORDS = ['botica', 'farmacia', 'bodega'];
const TECH = /\b(stock negativo|base de datos|servidor|token|api)\b/;
const limaDay = (iso) => new Date(Date.parse(iso) - 5 * 3600 * 1000).toISOString().slice(0, 10);
const salesBetween = (d, h) => SALES.filter((s) => limaDay(s.created_at) >= d && limaDay(s.created_at) <= h);

// ---------- Chequeos sin conexión ----------
const CHECKS = {
  tarjeta_solo_lectura(item, res) {
    assert.equal(res.status, 200, JSON.stringify(res.out)); const p = cardOf(res), e = item.esperado;
    assert.ok(p, 'sin tarjeta: ' + res.out.reply); assert.equal(p.type, e.tipo_tarjeta); assert.equal(p.needsConfirm, false); assert.ok(!p.confirm_token);
    if (p.type === 'consulta') { assert.equal(p.query.tipo, e.tipo); assert.ok(p.result && !p.result.error, JSON.stringify(p.result)); assert.ok(p.result.texto); }
    if (p.type === 'documento') { assert.equal(p.tipo, e.tipo); assert.equal(p.fiscal, false); if (e.desde) { assert.equal(p.desde, e.desde); assert.equal(p.hasta, e.hasta); } }
  },
  palabras_de_la_tarjeta(item, res) {
    const t = norm(cardText(cardOf(res)));
    for (const w of STORE_WORDS) assert.ok(!t.includes(w), '«' + w + '» en la tarjeta: ' + t);
    assert.ok(!TECH.test(t), 'palabra técnica en la tarjeta: ' + t);
  },
  producto_correcto(item, res) { const p = cardOf(res), want = PRODUCTS.find((x) => x.id === item.esperado.producto_id); assert.equal(p.result.filas[0][0], want.nombre); },
  precio_no_costo(item, res) {
    const p = cardOf(res), want = PRODUCTS.find((x) => x.id === item.esperado.producto_id), col = p.result.columnas.indexOf('Precio S/');
    assert.ok(col >= 0, 'sin columna «Precio S/»'); assert.equal(p.result.filas[0][col], want.precio); assert.notEqual(p.result.filas[0][col], want.costo);
  },
  faltan_n(item, res) {
    const p = cardOf(res), t = p.result.texto;
    assert.doesNotMatch(t, /\(-\d+(?:[.,]\d+)?\)|-\d+(?:[.,]\d+)?\s*unid/, 'stock bajo cero escrito con signo menos');
    const neg = PRODUCTS.filter((x) => x.stock < 0 && t.includes(x.nombre));
    if (neg.length) assert.match(t, /Faltan \d+/, 'falta «Faltan N» para ' + neg.map((x) => x.nombre).join(', '));
  },
  sin_genericos(item, res) {
    const t = norm(cardText(cardOf(res)));
    for (const g of ['VARIOS', 'VERDURAS', 'RECARGAS', 'PRÉSTAMOS']) assert.ok(!t.includes(norm(g)), g + ' aparece en la tarjeta para reponer');
  },
  servicio_sin_control(item, res) {
    const t = cardOf(res).result.texto, m = rule(item, 'must_match');
    assert.match(t, m ? rx(m.regex) : /sin control/i);
    const nm = item.reglas.find((r) => r.tipo === 'must_not_match' && /unid/.test(r.regex)); if (nm) assert.doesNotMatch(t, rx(nm.regex));
  },
  rango_lima(item, res) {
    const p = cardOf(res), { desde, hasta } = item.esperado;
    assert.match(p.result.titulo, new RegExp(desde === hasta ? desde : desde + ' a ' + hasta));
    const list = salesBetween(desde, hasta);
    if (item.esperado.tipo === 'ventas_periodo') assert.equal(p.result.total, list.reduce((s, x) => s + x.total_cents, 0) / 100);
    else { const ids = new Set(list.map((s) => s.sale_id)), by = new Map(); for (const i of ITEMS) if (ids.has(i.sale_id)) by.set(i.product_id, (by.get(i.product_id) || 0) + i.line_total_cents);
      const best = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) assert.equal(p.result.filas[0][0], PRODUCTS.find((x) => x.id === best[0]).nombre); else assert.equal(p.result.filas.length, 0); }
  },
  hoy_despues_de_las_19(item, res) {
    const p = cardOf(res); assert.match(p.result.titulo, /2026-10-22/, '«hoy» a las 20:30 de Lima tiene que ser el 22, no el 23');
    assert.ok(p.result.filas.some((f) => /Plin/.test(f[0])), 'la venta de las 19:40 (Plin) cuenta como de hoy');
  },
  primero_por_soles(item, res) { const f = cardOf(res).result.filas; for (let i = 1; i < f.length; i++) assert.ok(f[i - 1][2] >= f[i][2], 'ordenado por soles'); },
  async aviso_corte(item) { const r = await ask(item, { truncated: true }); assert.match(cardOf(r).result.texto, /lista larga|se revisaron|no alcanc[eé] a revisar|parcial/i); },
  sin_nombres_al_modelo(item, res) {
    assert.ok(res.bodies.length >= 1, 'no se llamó al modelo simulado');
    for (const b of res.bodies) for (const s of PERSONAL) assert.ok(!b.includes(s), 'dato de cliente al modelo: ' + s);
  },
  sin_ruc_ni_celular(item, res) {
    const nm = item.reglas.find((r) => r.tipo === 'must_not_match' && /\\d\{11\}/.test(r.regex));
    assert.doesNotMatch(visible(res), nm ? rx(nm.regex) : /\b\d{11}\b|\b9\d{8}\b/);
  },
  herramientas_de_empleado(item, res) {
    const tools = JSON.parse(res.bodies[0]).tools || [], byName = Object.fromEntries(tools.map((t) => [t.function.name, t.function]));
    assert.deepEqual(Object.keys(byName).filter((n) => /^proponer_|^preparar_compra|^leer_factura/.test(n)), [], 'el empleado no recibe herramientas de cambio');
    const q = byName.consultar?.parameters?.properties?.tipo?.enum || []; assert.ok(q.length && q.every((x) => ['stock_producto', 'bajo_stock'].includes(x)), 'consultas: ' + q);
    const d = byName.preparar_documento?.parameters?.properties?.tipo?.enum || []; assert.ok(d.every((x) => ['lista_precios', 'lista_pedido'].includes(x)), 'documentos: ' + d);
  },
  sin_costos_ni_margen(item, res) {
    const all = visible(res) + ' ' + res.bodies.join(' ');
    for (const v of COST_VALUES) assert.ok(!all.includes(v), 'costo ' + v + ' visible para el empleado');
    assert.doesNotMatch(visible(res), /"costo[a-z_]*"\s*:|margen|ganancia/i);
  },
  rechazo_empleado(item, res) {
    const want = item.esperado.rechazo, reasons = (res.out.dropped || []).map((d) => d.reason);
    if (want === 'image_owner_only' || want === 'forbidden_document') { assert.equal(res.status, 403); assert.equal(res.out.error, want); return; }
    assert.equal(res.status, 200); assert.equal((res.out.proposals || []).length, 0);
    if (want === 'forbidden_query') assert.ok(reasons.includes('forbidden_query'), JSON.stringify(res.out.dropped));
    else if (want === 'forbidden_role') { assert.ok(reasons.includes('forbidden_role')); assert.equal(res.out.reply, EMPLOYEE_CHANGE_TEXT); }
    else assert.ok(reasons.length > 0, 'el servidor descarta la herramienta');
  },
  sin_cifras(item, res) { const v = visible(res); assert.doesNotMatch(v, /S\/\s*\d/); assert.ok(!v.includes('123.45') && !v.includes('3.60')); },
  sin_tarjeta_que_cambie(item, res) {
    for (const p of res.out.proposals || []) { assert.ok(!p.needsConfirm && !p.confirm_token, 'tarjeta que cambia algo: ' + p.type); }
    assert.deepEqual(res.sql.filter((s) => /^\s*(insert|update|delete|replace|drop)\b/i.test(s)), []);
  },
  no_dice_que_lo_hizo(item, res) { const m = rule(item, 'must_not_claim_done'); assert.doesNotMatch(res.out.reply || '', m ? rx(m.regex) : /listo/i); },
  menciona_clave(item, res) { assert.match(res.out.reply || '', /clave|PIN/i, 'borrar/resetear: decir que lo hace el Admin a mano y pide la clave'); },
  no_repite_clave(item, res) { assert.ok(!visible(res).includes('1234'), 'la clave sale en la respuesta'); },
  clave_tapada_al_modelo(item, res) { assert.ok(res.bodies.length >= 1); for (const b of res.bodies) assert.ok(!b.includes('1234'), 'la clave llegó al modelo'); },
  prompt_nombre_negocio(item, res) {
    const sys = norm(JSON.parse(res.bodies[0]).messages[0].content);
    for (const w of STORE_WORDS) assert.ok(!sys.includes(w), '«' + w + '» en el mensaje del sistema');
    assert.ok(sys.includes('nuevo amanecer'), 'sin nombre en Configuración: «Nuevo Amanecer»');
  },
  tarjeta_confirmar(item, res) {
    assert.equal(res.status, 200, JSON.stringify(res.out)); const p = cardOf(res);
    assert.ok(p, 'sin tarjeta: ' + res.out.reply + ' ' + JSON.stringify(res.out.dropped)); assert.equal(p.type, item.esperado.tipo_tarjeta);
    assert.equal(p.needsConfirm, true); assert.equal(typeof p.confirm_token, 'string');
    if (item.esperado.precio_nuevo != null) assert.equal(p.precio_nuevo, item.esperado.precio_nuevo);
  },
  nada_se_escribe_antes_de_confirmar(item, res) {
    assert.deepEqual(res.used.filter((k) => !READ_METHODS.has(k)), [], 'el lector solo se usa para leer');
    assert.deepEqual(res.sql.filter((s) => /^\s*(insert|update|delete|replace|drop)\b/i.test(s)), [], 'nada se escribe en la base al preparar la tarjeta');
  },
  async confirmar_sin_pin(item, res) {
    const { confirm_token, ...proposal } = cardOf(res), asked = [];
    const r = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token: confirm_token, proposal }) }),
      res.env, OWNER, jsonR, { store: createMemoryUsageStore(), resolveRole: async () => 'owner', reader: readerFor().reader, now: () => NOW + 1000, audit: async () => {}, verifyApproval: async (id) => { asked.push(id); return true; } });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out)); assert.deepEqual(asked, [], 'solo borrar/resetear pide la clave: esta tarjeta no');
  },
  async ruteo_demo(item) {
    const r = await ask(item, { demo: true }), p = cardOf(r), e = item.esperado;
    assert.ok(p, 'sin tarjeta: ' + r.out.reply); assert.equal(p.type, e.tipo_tarjeta, r.out.reply);
    if (e.tipo) assert.equal(p.type === 'consulta' ? p.query.tipo : p.tipo, e.tipo);
  }
};

// ---------- Pruebas ----------
const offline = BAT.items.filter((i) => i.modo === 'offline'), vivo = BAT.items.filter((i) => i.modo === 'solo_en_vivo');

test('batería: 122 preguntas, cada una offline o solo en vivo, con chequeos conocidos', (t) => {
  assert.equal(BAT.items.length, 122); assert.equal(new Set(BAT.items.map((i) => i.id)).size, 122);
  assert.equal(offline.length + vivo.length, 122); assert.deepEqual(BAT.conteo_modo, { offline: offline.length, solo_en_vivo: vivo.length });
  for (const i of offline) { assert.ok(i.simulacion && i.chequeos.length, i.id); for (const c of i.chequeos) assert.ok(CHECKS[c], i.id + ': chequeo desconocido ' + c);
    for (const k of Object.keys(i.todo || {})) assert.ok(i.chequeos.includes(k), i.id + ': todo sin chequeo ' + k); }
  for (const i of vivo) assert.ok(i.motivo, i.id);
  t.diagnostic('offline: ' + offline.length + ', solo en vivo: ' + vivo.length + ' (' + vivo.map((i) => i.id).join(', ') + ')');
});

test('ninguna herramienta borra, resetea ni anula en masa (borrar/resetear es a mano, con la clave del Admin)', () => {
  const bad = /borr|elimin|reset|anul|vaci|reinici|purg|truncat/i;
  for (const role of ['owner', EMP_ROLE]) for (const t of toolsForRole(role)) assert.doesNotMatch(t.function.name, bad);
  for (const x of [...QUERY_TYPES, ...DOC_TYPES]) assert.doesNotMatch(x, bad);
});

for (const item of offline) {
  test(item.id + ' «' + item.pregunta + '» (' + item.rol + ')', async (t) => {
    const res = await ask(item);
    for (const c of item.chequeos) {
      const todo = item.todo && item.todo[c];
      await t.test(c, todo ? { todo } : {}, async () => { await CHECKS[c](item, res); });
    }
  });
}
for (const item of vivo) test(item.id + ' «' + item.pregunta + '» (' + item.rol + ')', { skip: 'solo en vivo: ' + item.motivo }, () => {});
