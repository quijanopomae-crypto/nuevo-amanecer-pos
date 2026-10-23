// (auditoría 500, UNI-058 / INV-041 / INV-027) Nombres de producto en la respuesta al celular.
// 1) maskReplyPeople (#987) tapaba la marca: «FIDEO DON VITTORIO» salía «FIDEO DON [nombre oculto]». Ahora «don/doña» de una MARCA se queda
//    (misma regla que sanitizeLesson de #988: palabra de producto justo antes, o «don X» en el nombre de un producto conocido), también en
//    MAYÚSCULAS de catálogo. Las personas se siguen tapando; un cliente de la lista se tapa SIEMPRE; el DNI igual que antes.
// 2) INV-027: al Admin el texto decía «producto #N» (los productos de una consulta); ahora lleva el nombre, salvo que el nombre traiga
//    el de una persona («Encargo Sra. …») o de un cliente de la lista: ese sigue como código. El empleado, sin cambios.
// Datos inventados; el modelo siempre simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const { maskReplyPeople, createTextEmitter, redactFor, capReply, ownerHold, REPLY_MAX } = A;
const EMP = 'empleado:consultas';
const ROLES = ['owner', EMP];
// el mismo filtro entero que usa el emisor al cerrar (etapa del rol + maskReplyPeople con lo conocido del pedido)
const whole = (role, t, known) => capReply(maskReplyPeople(role === 'owner' ? A.redactOwnerText(t) : A.redactOwnerData(A.redactEmployeeText(t)), known));
function streamed(role, t, step, known) {
  let o = ''; const e = createTextEmitter((d) => { if (d.reset) o = ''; if (d.t) o += d.t; }, REPLY_MAX, redactFor(role), role === 'owner' ? null : ownerHold, false, known);
  for (let i = 0; i < t.length; i += step) e.push(t.slice(i, i + step)); e.flush(); return o;
}

// ---------- 1) marca con «don/doña» ----------
const UNI058 = 'Hay 5 productos en o bajo el mínimo. Los más urgentes: FIDEO DON VITTORIO SPAGHETTI 500GR X 20 (Faltan 2), ACEITE PRIMOR CLASICO 900ML X 12BOT (Faltan 3).';
const INV041 = 'Admin, encontré Fideo Lavaggi Spaghetti 500 g: precio S/ 2.50 y costo S/ 1.80; Fideo Don Vittorio 500 g: precio S/ 2.60 y costo S/ 1.90. ¿Cuál de los dos contaste en 25?';
const BRAND_KEEP = [UNI058, INV041, 'Te quedan 30 de FIDEO DON VITTORIO.', 'fideo don vittorio: 30 unid.', 'el fideo don vittorio está a S/ 2.60',
  'Hay aceite Doña Pepa y tallarín Don Vittorio en stock.', 'DON VITTORIO SPAGHETTI 500GR X 20: 30 unid.'];
test('UNI-058 / INV-041: «FIDEO DON VITTORIO» y «fideo don vittorio» quedan (Admin y empleado, entero y en partes 1/3/7)', () => {
  for (const role of ROLES) for (const t of BRAND_KEEP) {
    const w = whole(role, t);
    assert.doesNotMatch(w, /nombre oculto/, role + ': ' + t + ' -> ' + w);
    assert.match(w, /vittorio|pepa/i, role + ': ' + t);
    for (const step of [1, 3, 7]) assert.equal(streamed(role, t, step), w, role + ' paso ' + step + ': ' + t);
  }
});
test('producto conocido en el pedido: «Don Vittorio Tallarín» sin palabra de producto delante también queda', () => {
  const known = { products: [{ id: 'P10', nombre: 'Fideo Don Vittorio Tallarín 500 g' }] };
  const t = 'Te quedan 30 de Don Vittorio Tallarín.';
  for (const role of ROLES) {
    assert.equal(whole(role, t, known), t, role);
    for (const step of [1, 3, 7]) assert.equal(streamed(role, t, step, known), t, role + ' ' + step);
    assert.match(whole(role, t), /Don \[nombre oculto\]/, role + ': sin el catálogo es una persona');
  }
});

// ---------- 2) personas: se siguen tapando ----------
const PEOPLE = [
  ['la señora Rosa Pérez debe S/ 20.', 'la señora [nombre oculto] debe S/ 20.'],
  ['Don Juan debe S/ 15 desde el lunes.', 'Don [nombre oculto] debe S/ 15 desde el lunes.'],
  ['DON JUAN DEBE 20 SOLES', 'DON [nombre oculto] DEBE 20 SOLES'],
  ['le vendí fideo a don Pepe y pagó.', 'le vendí fideo a don [nombre oculto] y pagó.'],
  ['La señora Rosa Quispe tiene DNI 45678912 y debe S/ 20.', 'La señora [nombre oculto] tiene DNI ****8912 y debe S/ 20.']
];
test('personas reales siguen tapadas (Admin y empleado, entero y en partes 1/3/7); el DNI igual que antes', () => {
  const known = { products: [{ id: 'P10', nombre: 'Fideo Don Vittorio Tallarín 500 g' }] };
  for (const role of ROLES) for (const [t, want] of PEOPLE) for (const k of [undefined, known]) {
    assert.equal(whole(role, t, k), want, role + ': ' + t);
    for (const step of [1, 3, 7]) assert.equal(streamed(role, t, step, k), want, role + ' ' + step + ': ' + t);
  }
  for (const role of ROLES) { const w = whole(role, 'doña juana pérez lleva 2 leches'); assert.doesNotMatch(w, /juana/i, w); }
});
// (revisión del lead, #998) MAYÚSCULAS solas no bastan: hace falta palabra de producto antes, producto conocido o medida (KG, GR, X 20…).
// Tras DON/DOÑA + nombre, un verbo de deuda/pago (debe, pagó, abonó, fió, le fié…) es siempre una persona: se tapa.
const CAPS_PEOPLE = [
  ['DON JUAN DEBE 2 KG', 'DON [nombre oculto] DEBE 2 KG'],
  ['DOÑA ROSA PAGÓ 20', 'DOÑA [nombre oculto] PAGÓ 20'],
  ['DOÑA ROSA PAGO 20', 'DOÑA [nombre oculto] PAGO 20'],
  ['ATENCIÓN DON JUAN', 'ATENCIÓN DON [nombre oculto]'],
  ['VENTA FIADA DOÑA ROSA', 'VENTA FIADA DOÑA [nombre oculto]'],
  ['DON JUAN ABONÓ 10 DE 2 KG', 'DON [nombre oculto] ABONÓ 10 DE 2 KG'],
  ['FIDEO DON JUAN DEBE 20', 'FIDEO DON [nombre oculto] DEBE 20'],
  ['DON JUAN LE FIÉ 2 KG DE ARROZ', 'DON [nombre oculto] LE FIÉ 2 KG DE ARROZ'],
  ['doña rosa fio 3 leches de 1 L', 'doña [nombre oculto] fio 3 leches de 1 L'],
  ['Don Vittorio abonó S/ 10', 'Don [nombre oculto] abonó S/ 10']
];
const CAPS_KNOWN = { products: [{ id: 'P10', nombre: 'Fideo Don Vittorio Tallarín 500 g' }, { id: 'P11', nombre: 'Aceite Doña Pepa 1 L' }] };
test('MAYÚSCULAS solas no dejan pasar a una persona; verbo de deuda/pago tras el nombre siempre tapa (entero y en partes 1/3/7)', () => {
  for (const role of ROLES) for (const [t, want] of CAPS_PEOPLE) for (const k of [undefined, CAPS_KNOWN]) {
    assert.equal(whole(role, t, k), want, role + ': ' + t);
    for (const step of [1, 3, 7]) assert.equal(streamed(role, t, step, k), want, role + ' ' + step + ': ' + t);
  }
});
test('marca en MAYÚSCULAS con producto antes, producto conocido o medida: queda (entero y en partes 1/3/7)', () => {
  const keep = [['FIDEO DON VITTORIO', undefined], ['Te quedan 4 de FIDEO DON VITTORIO.', undefined], ['DON VITTORIO SPAGHETTI 500GR X 20', undefined],
    ['DOÑA PEPA', CAPS_KNOWN], ['Te quedan 4 de DOÑA PEPA.', CAPS_KNOWN], ['DON VITTORIO TALLARIN', CAPS_KNOWN]];
  for (const role of ROLES) for (const [t, k] of keep) {
    assert.equal(whole(role, t, k), t, role + ': ' + t);
    for (const step of [1, 3, 7]) assert.equal(streamed(role, t, step, k), t, role + ' ' + step + ': ' + t);
  }
  for (const role of ROLES) assert.equal(whole(role, 'DOÑA PEPA'), 'DOÑA [nombre oculto]', role + ': sin catálogo DOÑA PEPA es una persona');
});
test('cliente de la lista: siempre tapado, aunque se llame como la marca o vaya en mayúsculas', () => {
  const known = { products: [{ id: 'P10', nombre: 'Fideo Don Vittorio Tallarín 500 g' }], customers: [{ id: 'c9', nombre: 'Vittorio Ramos Paz' }, { id: 'c2', nombre: 'Juana Pérez' }] };
  for (const role of ROLES) {
    for (const t of ['don vittorio ramos me debe 30', 'Don Vittorio Ramos me debe 30', 'FIDEO DON VITTORIO RAMOS', 'doña juana pérez lleva 2 leches']) {
      const w = whole(role, t, known);
      assert.doesNotMatch(w, /vittorio|ramos|juana|p[eé]rez/i, role + ': ' + t + ' -> ' + w);
      for (const step of [1, 3, 7]) assert.equal(streamed(role, t, step, known), w, role + ' ' + step + ': ' + t);
    }
    assert.equal(whole(role, 'Te quedan 30 de FIDEO DON VITTORIO TALLARIN.', known), 'Te quedan 30 de FIDEO DON VITTORIO TALLARIN.', role + ': la marca sola no es el cliente');
  }
});

// ---------- 3) INV-027: «producto #N» -> nombre para el Admin ----------
const NOW = Date.parse('2026-10-22T20:00:00.000Z');
const SECRET = 'secreto-de-prueba-0123456789abcdef';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();
const sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const delta = (d, fin) => sse({ choices: [{ delta: d, ...(fin ? { finish_reason: fin } : {}) }] });
const DATA = {
  products: [{ id: 'P1', nombre: 'Arroz 1 kg', precio: 4, costo: 3, stock: 50, min: 5, controla: true },
    { id: 'P5', nombre: 'Lejía Sapolio 1 L', precio: 5, costo: 3, stock: 7, min: 0, controla: true },
    { id: 'P6', nombre: 'Encargo Sra. Rosa Quispe', precio: 50, costo: 40, stock: 1, min: 0, controla: true },
    { id: 'P7', nombre: 'Torta Juan Mamani', precio: 30, costo: 20, stock: 3, min: 0, controla: true }],
  customers: [{ id: 'C1', nombre: 'Rosa Quispe Huamán' }, { id: 'C2', nombre: 'Juan Mamani' }],
  credits: [],
  sales: [{ sale_id: 'S1', created_at: '2026-10-22T15:00:00.000Z', metodo: 'efectivo', total_cents: 2000 }],
  saleItems: [{ sale_id: 'S1', product_id: 'P1', quantity: 5, line_total_cents: 2000 }]
};
// cada respuesta simulada: { content } o { calls }; en partes de 3 letras si el pedido es en partes, JSON entero si no
const TOOL = (tipo) => ({ id: 'c1', type: 'function', function: { name: 'consultar', arguments: JSON.stringify({ tipo }) } });
function seq(list, bodies, stream) { let n = 0; return async (_u, init) => { bodies.push(String(init.body)); const r = list[Math.min(n++, list.length - 1)];
  if (!stream) return jsonR({ choices: [{ message: { role: 'assistant', content: r.content || '', ...(r.calls ? { tool_calls: r.calls } : {}) }, finish_reason: r.calls ? 'tool_calls' : 'stop' }] });
  const parts = r.calls ? [...r.calls.map((c, i) => delta({ tool_calls: [{ index: i, ...c }] })), delta({}, 'tool_calls')]
    : [...(r.content.match(/[\s\S]{1,3}/g) || []).map((x) => delta({ content: x })), delta({}, 'stop')];
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); }; }
async function chat(text, { role = 'owner', stream = true, list }) {
  const bodies = [];
  const r = await A.assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, stream, context: {} }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: A.createMemoryUsageStore(), resolveRole: async () => role, fetch: seq(list, bodies, stream), reader: memoryReader(DATA), audit: async () => {}, now: () => NOW, statusEveryMs: 60000 });
  const raw = await new Response(r.body).text();
  if (!stream) return { raw, bodies, final: JSON.parse(raw), text: null };
  const out = []; const p = C.createSseParser((e, d) => out.push({ ev: e, d })); p.feed(raw);
  let painted = ''; for (const x of out) if (x.ev === 'text') { if (x.d.reset) painted = ''; if (x.d.t) painted += x.d.t; }
  return { raw, bodies, final: out.find((x) => x.ev === 'final')?.d, text: painted };
}
const FIRST = { calls: [TOOL('productos_sin_ventas')] };
const quiet = (t) => { const o = console.log; console.log = () => {}; t.after(() => { console.log = o; }); };
const checkOwner = (r, label) => {
  const reply = r.final.reply;
  assert.match(reply, /Lejía Sapolio 1 L/, label + ': ' + reply);
  assert.doesNotMatch(reply, /producto #P5/, label);
  assert.match(reply, /producto #P6/, label + ': nombre con «Sra. …» sigue como código');
  assert.match(reply, /producto #P7/, label + ': nombre con un cliente de la lista sigue como código');
  // el texto y el historial firmado (vuelve al modelo) sin nombres de persona/cliente; la tarjeta de la consulta trae sus nombres como siempre
  assert.doesNotMatch(reply + JSON.stringify(r.final.turns || []), /Rosa|Quispe|Mamani/, label);
  if (r.text !== null) assert.equal(r.text, reply, label + ': lo pintado en partes = la respuesta final');
};
test('INV-027 Admin, respuesta directa de la consulta: el nombre del producto, no «producto #N» (en partes y entero)', async (t) => {
  quiet(t);
  for (const stream of [true, false]) {
    const r = await chat('q productos no se mueven', { stream, list: [FIRST] });
    assert.equal(r.bodies.length, 1, 'respuesta directa'); checkOwner(r, 'directa stream=' + stream);
  }
});
test('INV-027 Admin, segunda llamada que cita «producto #P5»: nombre; los no seguros quedan como código', async (t) => {
  quiet(t);
  const second = (content) => ({ content });
  for (const stream of [true, false]) {
    const r = await chat('q productos no se mueven y por qué', { stream, list: [FIRST, second('Sin ventas: producto #P5 (7 unid.), producto #P7 y producto #P6. Revísalos.')] });
    assert.equal(r.bodies.length, 2); checkOwner(r, 'segunda stream=' + stream);
    assert.match(r.final.reply, /^Sin ventas: Lejía Sapolio 1 L \(7 unid\.\), producto #P7 y producto #P6\. Revísalos\.$/);
    for (const b of r.bodies) assert.doesNotMatch(b, /Rosa|Quispe|Mamani/, 'al modelo nunca llega el nombre de un cliente');
  }
});
test('INV-027 empleado: sin cambios (sigue «producto #N», nunca nombres de la consulta)', async (t) => {
  quiet(t);
  const r = await chat('q productos no se mueven', { role: 'empleado:completo+costos', list: [FIRST] });
  assert.ok(r.final && r.final.reply, r.raw.slice(0, 300));
  // hoy el empleado también ve «producto #N» en el texto (la tarjeta trae los nombres que su nivel permite): se deja igual, reportado.
  assert.equal(r.final.reply, '3 productos no tuvieron ventas 2026-09-23 a 2026-10-22 (de 4 revisados). Con más stock: producto #P5 (7), producto #P7 (3), producto #P6 (1).');
  assert.equal(r.text, r.final.reply);
});
