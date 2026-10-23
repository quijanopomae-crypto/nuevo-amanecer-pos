// (auditoría 500, INV-047 / INV-008) Marca que la tienda no tiene: «por q el fideo lavaggi sale -5», «cuánta cerveza Pilsen me queda».
// Antes la consulta stock_producto listaba otros fideos/cervezas en silencio (la palabra genérica sí coincidía) y la respuesta los
// mostraba como si fueran la marca pedida. Ahora el texto empieza con «No tengo esa marca; lo más parecido es: …» (nunca repite la palabra escrita) y el modelo lo recibe
// en el resumen (Admin y empleado). Palabras genéricas (fideo, arroz, leche, tamaños, números, palabras de pregunta) no lo disparan, y si
// algún producto tiene la marca, no hay aviso. Nunca sale un nombre de persona como «marca».
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { runAssistantQuery } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const P = (id, nombre, stock, precio, costo = 1.11) => ({ id, nombre, controla: true, stock, min: 2, precio, costo });
const CATALOGO = [
  P('1', 'FIDEO ESPIGA DE ORO TALLARIN 500GR', -5, 3.5), P('2', 'FIDEO DON VITTORIO SPAGHETTI 500GR', 12, 4),
  P('3', 'CERVEZA CRISTAL 650ML', 24, 7.5), P('4', 'CERVEZA CORONA 355ML', 6, 6.5), P('5', 'CERVEZA CUSQUEÑA 620ML', 0, 8),
  P('6', 'LECHE GLORIA AZUL 400GR', 30, 4.2), P('7', 'LECHE PURA VIDA 400GR', 8, 3.6),
  P('8', 'ARROZ COSTEÑO 750GR', 40, 4), P('9', 'ARROZ PAISANA 5KG', 3, 22)
];
const reader = { products: async () => CATALOGO.map((p) => ({ ...p })) };
const stock = (producto) => runAssistantQuery(reader, { tipo: 'stock_producto', producto });

test('Lavaggi: hay fideos pero ninguno Lavaggi -> «No tengo esa marca; lo más parecido es: …» con los fideos (sin repetir «Lavaggi»)', async () => {
  for (const q of ['fideo lavaggi', 'Fideo LAVAGGI', 'por q el fideo lavaggi sale -5', 'fideos lavaggi 500gr']) {
    const r = await stock(q);
    assert.match(r.texto, /^No tengo esa marca; lo más parecido es: /, q); assert.ok(!/lavaggi/i.test(r.texto), q);
    assert.match(r.texto, /ESPIGA DE ORO/, q); assert.match(r.texto, /DON VITTORIO/, q);
    assert.equal(r.resumen.marca_no_encontrada, true, q);
    assert.match(r.resumen.aviso, /^No tengo esa marca/, q); assert.ok(!/lavaggi/i.test(JSON.stringify(r.resumen)), q);
    assert.ok(r.filas.length >= 2, q);
  }
});

test('Pilsen: otras cervezas -> aviso «No tengo esa marca» (sin repetir «Pilsen»)', async () => {
  for (const q of ['cerveza pilsen', 'cuánta cerveza Pilsen me queda', 'cervezas pilsen 630ml']) {
    const r = await stock(q);
    assert.match(r.texto, /^No tengo esa marca; lo más parecido es: /, q); assert.ok(!/pilsen/i.test(r.texto), q);
    assert.match(r.texto, /CRISTAL/, q);
    assert.equal(r.resumen.marca_no_encontrada, true, q); assert.ok(!/pilsen/i.test(JSON.stringify(r.resumen)), q);
  }
});

test('marca que SÍ está (Gloria, Costeño) -> sin aviso, igual que antes', async () => {
  for (const [q, nombre] of [['leche gloria', 'LECHE GLORIA AZUL'], ['Leche Gloria azul', 'LECHE GLORIA AZUL'], ['arroz costeño', 'ARROZ COSTEÑO']]) {
    const r = await stock(q);
    assert.ok(!/No tengo/.test(r.texto), q + ': ' + r.texto); assert.equal(r.resumen.marca_no_encontrada, undefined, q); assert.equal(r.resumen.aviso, undefined, q);
    assert.ok(r.texto.startsWith(nombre), q);
  }
});

test('palabras genéricas, tamaños, números y de pregunta -> sin aviso', async () => {
  for (const q of ['cuánto arroz', 'cuanto arroz me queda', 'arroz 5kg', 'arroz x 750 gr', 'leche', 'cuántas cervezas hay', 'stock de fideos', 'fideo', 'q tanto arroz tengo']) {
    const r = await stock(q);
    assert.ok(!/No tengo/.test(r.texto), q + ': ' + r.texto); assert.equal(r.resumen.marca_no_encontrada, undefined, q);
  }
});

test('nombre de persona nunca sale como «marca»', async () => {
  for (const q of ['arroz de doña rosa', 'leche que llevó don juan', 'fideo para la señora carmen']) {
    const r = await stock(q);
    assert.ok(!/rosa|juan|carmen/i.test(r.texto), q + ': ' + r.texto); assert.ok(!/rosa|juan|carmen/i.test(JSON.stringify(r.resumen)), q);
  }
});

test('sin ningún parecido sigue «No encontré ese producto.»', async () => {
  const r = await stock('gaseosa lavaggi');
  assert.equal(r.texto, 'No encontré ese producto.');
});

// ---------- chat completo (Admin y empleado) ----------
const SECRET = 'secreto-de-prueba-0123456789abcdef';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();
const sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const delta = (d, fin) => sse({ choices: [{ delta: d, ...(fin ? { finish_reason: fin } : {}) }] });
const call = (producto) => ({ index: 0, id: 'c1', function: { name: 'consultar', arguments: JSON.stringify({ tipo: 'stock_producto', producto }) } });
const first = (c) => [delta({ tool_calls: [c] }), delta({}, 'tool_calls')];
function seq(list, bodies) { let n = 0; return async (_u, init) => { bodies.push(init.body); const parts = list[Math.min(n++, list.length - 1)];
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); }; }
async function chat(text, script, role = 'owner') {
  const bodies = [];
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, text }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: seq(script, bodies), reader, audit: async () => {}, statusEveryMs: 60000 });
  const raw = await new Response(r.body).text(); const out = []; const p = C.createSseParser((e, d) => out.push({ ev: e, d })); p.feed(raw);
  return { raw, bodies, final: out.find((x) => x.ev === 'final')?.d };
}
const quiet = (t) => { const o = console.log; console.log = () => {}; t.after(() => { console.log = o; }); };
const MODEL_SAYS = [delta({ content: 'El fideo Espiga de Oro tiene Faltan 5: revisa el Kardex.' }), delta({}, 'stop')];

test('Admin, respuesta directa: el aviso va primero', async (t) => {
  quiet(t);
  const r = await chat('cuánto fideo lavaggi me queda', [first(call('fideo lavaggi')), MODEL_SAYS]);
  assert.equal(r.bodies.length, 1, 'sin segunda llamada');
  assert.match(r.final.reply, /^No tengo esa marca; lo más parecido es: /);
});

test('Admin, con segunda llamada: el modelo recibe el aviso y, si no lo dice, el servidor lo pone antes', async (t) => {
  quiet(t);
  const r = await chat('por q el fideo lavaggi sale -5? explícame', [first(call('fideo lavaggi')), MODEL_SAYS]);
  assert.equal(r.bodies.length, 2);
  assert.match(r.bodies[1], /No tengo esa marca/); assert.match(r.bodies[1], /marca_no_encontrada/);
  assert.match(r.final.reply, /^No tengo esa marca; lo más parecido es lo de la lista\.\n/);
  assert.match(r.final.reply, /Espiga de Oro/);
});

test('Admin, el modelo ya lo dijo: no se repite', async (t) => {
  quiet(t);
  const said = [delta({ content: 'No tengo esa marca; lo más parecido es Espiga de Oro (Faltan 5).' }), delta({}, 'stop')];
  const r = await chat('por q el fideo lavaggi sale -5? explícame', [first(call('fideo lavaggi')), said]);
  assert.equal((r.final.reply.match(/No tengo esa marca/g) || []).length, 1);
});

test('empleado: mismo aviso en la respuesta y en lo que lee el modelo, sin costos', async (t) => {
  quiet(t);
  const d = await chat('cuánta cerveza pilsen me queda', [first(call('cerveza pilsen')), MODEL_SAYS], 'empleado:consultas');
  assert.match(d.final.reply, /^No tengo esa marca; lo más parecido es: /); assert.match(d.final.reply, /CRISTAL/);
  assert.ok(!d.raw.includes('1.11'), 'sin costo en el canal');
  const s = await chat('cuánta cerveza pilsen me queda? explícame', [first(call('cerveza pilsen')), MODEL_SAYS], 'empleado:consultas');
  assert.equal(s.bodies.length, 2); assert.match(s.bodies[1], /No tengo esa marca/); assert.ok(!s.bodies[1].includes('1.11'));
  assert.match(s.final.reply, /^No tengo esa marca; lo más parecido es lo de la lista\.\n/);
});

test('Admin y empleado, marca que sí está: sin aviso', async (t) => {
  quiet(t);
  for (const role of ['owner', 'empleado:consultas']) {
    const r = await chat('cuánta leche gloria hay', [first(call('leche gloria')), MODEL_SAYS], role);
    assert.ok(!/No tengo/.test(r.final.reply), role + ': ' + r.final.reply); assert.match(r.final.reply, /GLORIA/);
  }
});

// ---------- revisión de #1001 (alfa y autor de caja) ----------
// Decisión de alfa: el aviso NUNCA repite la palabra que escribió la persona («No tengo esa marca; lo más parecido es…» + la lista del
// catálogo). Así un nombre de persona («arroz rosa», «fideo de pedro», «arroz que fió juan quispe») no llega ni al resumen, ni al campo
// aviso, ni al texto del empleado, ni a la respuesta, ni a la segunda llamada al modelo (Admin y empleado).
// Marca mal escrita: con «FIDEO LAVAGGI CODO 250GR» en el catálogo, «tienes lavagi?» la encuentra. Tolerancia (una letra distinta, de
// más o de menos, letras dobles) SOLO en palabras de 5 letras o más: «sal» no encuentra «sol», «pan» no encuentra «pin».
const CLIENTES = [{ id: 'CLI-ROSA', nombre: 'Rosa Quispe' }, { id: 'CLI-PEDRO', nombre: 'Pedro Huamán' }, { id: 'CLI-JUAN', nombre: 'Juan Quispe' }];
const CATALOGO2 = [...CATALOGO, P('10', 'FIDEO LAVAGGI CODO 250GR', 15, 2.8), P('11', 'ACEITE SOL 1LT', 5, 9.9), P('12', 'GALLETA PIN POP 30GR', 50, 0.5)];
const reader2 = { products: async () => CATALOGO2.map((p) => ({ ...p })), customers: async () => CLIENTES.map((c) => ({ ...c })) };
const stock2 = (producto) => runAssistantQuery(reader2, { tipo: 'stock_producto', producto });

test('Lavaggi mal escrita (letra doble, una letra de más o distinta, tilde): la encuentra y no dice «No tengo»', async () => {
  for (const q of ['tienes lavagi?', 'lavagi', 'fideo lavagi', 'Fideo LAVAGI', 'lavággi', 'lavvaggi', 'fideos lavagui']) {
    const r = await stock2(q);
    assert.ok(!/No tengo|No encontré/.test(r.texto), q + ': ' + r.texto);
    assert.equal(r.resumen.marca_no_encontrada, undefined, q); assert.equal(r.resumen.aviso, undefined, q);
    assert.match(r.texto, /LAVAGGI/, q);
  }
});

test('«leche glora»: encuentra Gloria y no dice «No tengo»', async () => {
  const r = await stock2('leche glora');
  assert.ok(!/No tengo/.test(r.texto), r.texto); assert.ok(r.texto.startsWith('LECHE GLORIA'), r.texto);
});

test('marca que de verdad no está (con Lavaggi en el catálogo) sigue con el aviso, sin repetir la palabra', async () => {
  for (const [q, w] of [['fideo barilla', /barilla/i], ['cerveza pilsen', /pilsen/i]]) {
    const r = await stock2(q);
    assert.match(r.texto, /^No tengo esa marca; lo más parecido es: /, q); assert.ok(!w.test(r.texto + JSON.stringify(r.resumen)), q);
    assert.equal(r.resumen.marca_no_encontrada, true, q);
  }
});

test('palabras cortas (menos de 5 letras) sin tolerancia: «sal» no encuentra «SOL», «pan» no encuentra «PIN»', async () => {
  for (const [q, bad] of [['sal', /ACEITE SOL/], ['pan', /PIN POP/], ['aceite sal', /x^/], ['galleta pan', /x^/]]) {
    const r = await stock2(q);
    assert.ok(!bad.test(r.texto), q + ': ' + r.texto);
  }
  const s = await stock2('sal'); assert.equal(s.texto, 'No encontré ese producto.');
  const p = await stock2('pan'); assert.equal(p.texto, 'No encontré ese producto.');
});

const PERSONAS = ['arroz rosa', 'fideo de pedro', 'arroz que fió juan quispe', 'tienes algo de doña Rosa?', 'tienes leche de Rosa?'];
const NAME_RE = /rosa|pedro|juan|quispe/i;
test('nombre de persona nunca vuelve en el texto, el resumen ni el aviso', async () => {
  for (const rd of [stock, stock2]) for (const q of PERSONAS) {
    const r = await rd(q);
    assert.ok(!NAME_RE.test(r.texto), q + ': ' + r.texto);
    assert.ok(!NAME_RE.test(JSON.stringify(r.resumen)), q + ': ' + JSON.stringify(r.resumen));
    assert.ok(!NAME_RE.test(String(r.resumen.aviso || '')), q);
  }
});

async function chat2(text, script, role = 'owner') {
  const bodies = [];
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, text }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: seq(script, bodies), reader: reader2, audit: async () => {}, statusEveryMs: 60000 });
  const raw = await new Response(r.body).text(); const out = []; const p = C.createSseParser((e, d) => out.push({ ev: e, d })); p.feed(raw);
  return { raw, bodies, final: out.find((x) => x.ev === 'final')?.d };
}
// Lo que el servidor le pone de su parte al modelo (resultado de la consulta), sin el texto que escribió la persona.
const toolParts = (body) => JSON.parse(body).messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');

test('chat Admin y empleado: frases con nombre de persona -> sin nombre en la respuesta ni en la segunda llamada al modelo', async (t) => {
  quiet(t);
  const casos = [['arroz rosa', 'arroz rosa'], ['fideo de pedro', 'fideo de pedro'], ['arroz que fió juan quispe', 'arroz que fió juan quispe'],
    ['tienes algo de doña Rosa?', 'algo de doña Rosa'], ['tienes leche de Rosa?', 'leche de Rosa']];
  for (const role of ['owner', 'empleado:consultas']) for (const [text, producto] of casos) {
    const d = await chat2(text, [first(call(producto)), MODEL_SAYS], role);
    assert.ok(d.final && !NAME_RE.test(d.final.reply), role + ' directa ' + text + ': ' + d.final?.reply);
    const s = await chat2(text + '? explícame', [first(call(producto)), MODEL_SAYS], role);
    assert.equal(s.bodies.length, 2, role + ' ' + text);
    assert.ok(!NAME_RE.test(toolParts(s.bodies[1])), role + ' modelo ' + text + ': ' + toolParts(s.bodies[1]));
    assert.ok(!NAME_RE.test(s.final.reply), role + ' respuesta ' + text + ': ' + s.final.reply);
  }
});

test('chat Admin y empleado: «tienes lavagi?» y «fideo lavagi» encuentran Lavaggi sin «No tengo»', async (t) => {
  quiet(t);
  for (const role of ['owner', 'empleado:consultas']) for (const [text, producto] of [['tienes lavagi?', 'lavagi'], ['fideo lavagi', 'fideo lavagi']]) {
    const d = await chat2(text, [first(call(producto)), MODEL_SAYS], role);
    assert.ok(!/No tengo|No encontré/.test(d.final.reply), role + ': ' + d.final.reply); assert.match(d.final.reply, /LAVAGGI/);
  }
});
