// Seguimiento de #1001 (hallazgos no bloqueantes de la revisión del autor de caja):
// 1) «pan de molde» decía «No tengo esa marca»: «molde», «integral», «light», «entera», «descremada», «familiar», «tajado»… describen el
//    producto, no son una marca. No disparan el aviso; si hay pan, se muestra el pan normal.
// 2) «fideo marcos» metía el ATÚN MARCO POLO en la lista: si la persona dijo el tipo de producto («fideo»), la lista se queda con ese tipo.
//    Solo si no hay ninguno de ese tipo se mira el resto. Como ningún fideo es «Marcos», va el aviso fijo (sin repetir la palabra).
// 3) «gloritas» encuentra la leche Gloria.
// Todo lo de #1001 sigue igual: el aviso nunca repite la palabra, tolerancia solo en palabras de 5+ letras, «sal» no es SOL, «pan» no es
// PIN, el empleado recibe el aviso y nunca el costo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { runAssistantQuery } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');

const P = (id, nombre, stock, precio, costo = 1.11) => ({ id, nombre, controla: true, stock, min: 2, precio, costo });
const CATALOGO = [
  P('1', 'FIDEO ESPIGA DE ORO TALLARIN 500GR', -5, 3.5), P('2', 'FIDEO DON VITTORIO SPAGHETTI 500GR', 12, 4), P('3', 'CERVEZA CRISTAL 650ML', 24, 7.5),
  P('6', 'LECHE GLORIA AZUL 400GR', 30, 4.2), P('7', 'LECHE PURA VIDA 400GR', 8, 3.6), P('8', 'ARROZ COSTEÑO 750GR', 40, 4), P('9', 'ARROZ PAISANA 5KG', 3, 22),
  P('10', 'GASEOSA INCA KOLA 500ML', 10, 2.5), P('11', 'PAN BIMBO BLANCO', 5, 8), P('12', 'FIDEO LAVAGGI CODO 250GR', 7, 2), P('13', 'ACEITE SOL 1L', 6, 9),
  P('14', 'GALLETA PIN POP', 9, 1), P('15', 'ATUN MARCO POLO 170G', 4, 6), P('16', 'SAL EMSAL 1KG', 5, 1.5), P('17', 'ARROZ ROSAMAR 1KG', 5, 5)
];
const reader = { products: async () => CATALOGO.map((p) => ({ ...p })), customers: async () => [] };
const stock = (producto) => runAssistantQuery(reader, { tipo: 'stock_producto', producto });
const noAviso = (r, q) => { assert.ok(!/No tengo|No encontré/.test(r.texto), q + ': ' + r.texto); assert.equal(r.resumen.marca_no_encontrada, undefined, q); assert.equal(r.resumen.aviso, undefined, q); };

test('«pan de molde» y otras palabras que describen el producto: sin «No tengo esa marca», muestra el pan normal', async () => {
  for (const q of ['pan de molde', 'pan molde', 'tienes pan de molde?', 'pan integral', 'pan blanco grande', 'pan de molde chico', 'pan tajado', 'panes de molde']) {
    const r = await stock(q); noAviso(r, q); assert.ok(r.texto.startsWith('PAN BIMBO BLANCO'), q + ': ' + r.texto);
  }
  for (const q of ['leche entera', 'leche descremada light', 'leche familiar', 'leche deslactosada', 'leche semidescremada', 'leche entera grande']) {
    const r = await stock(q); noAviso(r, q); assert.match(r.texto, /^LECHE /, q);
  }
});

test('con un pan de molde de verdad en el catálogo, sale primero ese', async () => {
  const rd = { products: async () => [...CATALOGO, P('20', 'PAN DE MOLDE UNION 500GR', 3, 7.5)].map((p) => ({ ...p })) };
  const r = await runAssistantQuery(rd, { tipo: 'stock_producto', producto: 'pan de molde' });
  noAviso(r, 'pan de molde'); assert.ok(r.texto.startsWith('PAN DE MOLDE UNION'), r.texto);
});

test('«fideo marcos»: solo fideos en la lista (sin el atún Marco Polo) y aviso fijo sin repetir la palabra', async () => {
  for (const q of ['fideo marcos', 'fideos marcos', 'tienes fideo marcos?']) {
    const r = await stock(q);
    assert.ok(!/ATUN|MARCO POLO/.test(r.texto), q + ': ' + r.texto);
    assert.ok(r.filas.length >= 2 && r.filas.every((f) => /^FIDEO /.test(f[0])), q + ': ' + JSON.stringify(r.filas.map((f) => f[0])));
    assert.match(r.texto, /^No tengo esa marca; lo más parecido es: /, q);
    assert.equal(r.resumen.marca_no_encontrada, true, q);
    assert.ok(!/marcos/i.test(r.texto + JSON.stringify(r.resumen)), q);
  }
});

test('el tipo de producto manda solo si hay de ese tipo: «atun marcos», «marcos», «aceite sal», «galleta pan» siguen igual', async () => {
  const a = await stock('atun marcos'); noAviso(a, 'atun marcos'); assert.ok(a.texto.startsWith('ATUN MARCO POLO'), a.texto);
  const m = await stock('marco polo'); noAviso(m, 'marco polo'); assert.ok(m.texto.startsWith('ATUN MARCO POLO'), m.texto);
  const s = await stock('aceite sal'); assert.match(s.texto, /ACEITE SOL/); assert.match(s.texto, /SAL EMSAL/);
  const g = await stock('galleta pan'); assert.match(g.texto, /PAN BIMBO/); assert.match(g.texto, /GALLETA PIN POP/);
  const l = await stock('fideo lavagi'); noAviso(l, 'fideo lavagi'); assert.ok(l.texto.startsWith('FIDEO LAVAGGI'), l.texto);
});

test('«gloritas» encuentra la leche Gloria sin aviso', async () => {
  for (const q of ['gloritas', 'leche gloritas', 'tienes gloritas?']) {
    const r = await stock(q); noAviso(r, q); assert.ok(r.texto.startsWith('LECHE GLORIA'), q + ': ' + r.texto);
  }
});

test('#1001 sigue igual: «sal» no es SOL, «pan» no es PIN, Pilsen con aviso sin repetir la palabra', async () => {
  const s = await stock('sal'); assert.ok(!/ACEITE SOL/.test(s.texto), s.texto);
  const p = await stock('pan'); assert.ok(!/PIN POP/.test(p.texto), p.texto);
  const c = await stock('cerveza pilsen'); assert.match(c.texto, /^No tengo esa marca; lo más parecido es: CERVEZA CRISTAL/); assert.ok(!/pilsen/i.test(c.texto + JSON.stringify(c.resumen)));
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
const MODEL_SAYS = [delta({ content: 'Aquí tienes la lista.' }), delta({}, 'stop')];
const toolParts = (body) => JSON.parse(body).messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');

test('chat Admin y empleado: «fideo marcos» con aviso, sin atún, sin la palabra y el empleado sin costos', async (t) => {
  quiet(t);
  for (const role of ['owner', 'empleado:consultas']) {
    const d = await chat('tienes fideo marcos', [first(call('fideo marcos')), MODEL_SAYS], role);
    assert.match(d.final.reply, /^No tengo esa marca; lo más parecido es: /, role); assert.ok(!/ATUN|MARCO POLO|marcos/i.test(d.final.reply), role + ': ' + d.final.reply);
    const s = await chat('tienes fideo marcos? explícame', [first(call('fideo marcos')), MODEL_SAYS], role);
    assert.equal(s.bodies.length, 2, role); const tp = toolParts(s.bodies[1]);
    assert.match(tp, /No tengo esa marca/, role); assert.ok(!/ATUN|MARCO POLO|marcos/i.test(tp), role + ': ' + tp);
    if (role !== 'owner') { assert.ok(!d.raw.includes('1.11'), 'sin costo en el canal'); assert.ok(!tp.includes('1.11'), 'sin costo al modelo'); }
  }
});

test('chat Admin y empleado: «pan de molde» muestra el pan sin «No tengo»', async (t) => {
  quiet(t);
  for (const role of ['owner', 'empleado:consultas']) {
    const d = await chat('tienes pan de molde', [first(call('pan de molde')), MODEL_SAYS], role);
    assert.ok(!/No tengo|No encontré/.test(d.final.reply), role + ': ' + d.final.reply); assert.match(d.final.reply, /PAN BIMBO BLANCO/);
    if (role !== 'owner') assert.ok(!d.raw.includes('1.11'));
  }
});

// ---------- revisión de #1005 (autor de caja) con el catálogo de referencia de AV ----------
// El filtro por tipo tomaba la primera palabra EXACTA del nombre: «FID. DON VITTORIO», «DET BOLIVAR», «JAB.BOLIVAR» quedaban fuera y
// «fideo don vittorio» daba 2 fideos de otra marca sin aviso. Decisión de alfa: el tipo solo acota «lo más parecido» cuando la marca no
// está; si la marca sí está, sale todo igual que en la base. El tipo se reconoce por la palabra entera o por su abreviatura de 3+ letras
// (FID., DET, JAB.), con o sin punto y sin importar tildes. Los totales de la base (e26d2326) se midieron con este mismo catálogo.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const AV = (() => {
  const ctx = vm.createContext({});
  new vm.Script(readFileSync(new URL('../../POS/js/catalog/reference-catalog-data.js', import.meta.url), 'utf8') + ';this.D = _NA_REFERENCE_CATALOG_DATA;').runInContext(ctx);
  return ctx.D.rows.map((r, i) => P('av' + i, r.NOMBRE_LIMPIO_SEGURO, 5, 1));
})();
const avReader = { products: async () => AV.map((p) => ({ ...p })) };
const av = (producto) => runAssistantQuery(avReader, { tipo: 'stock_producto', producto });

test('AV: si la marca está, sale lo mismo que en la base («fideo don vittorio» 47, «fideo espiga de oro» 71)', async () => {
  const d = await av('fideo don vittorio'); noAviso(d, 'fideo don vittorio'); assert.equal(d.total, 47);
  assert.ok(d.filas.every((f) => /DON VITTORIO/.test(f[0])), JSON.stringify(d.filas.map((f) => f[0])));
  const e = await av('fideo espiga de oro'); noAviso(e, 'fideo espiga de oro'); assert.equal(e.total, 71);
  assert.ok(e.filas.every((f) => /ESPIGA DE ORO/.test(f[0])), JSON.stringify(e.filas.map((f) => f[0])));
});

test('AV: «detergente bolivar», «jabon bolivar», «jabón bolívar» y «gaseosa kola real» sin aviso, igual que la base', async () => {
  for (const [q, total, re] of [['detergente bolivar', 42, /DET BOLIVAR/], ['jabon bolivar', 76, /BOLIVAR/], ['jabón bolívar', 76, /BOLIVAR/], ['gaseosa kola real', 53, /KOLA/]]) {
    const r = await av(q); noAviso(r, q); assert.equal(r.total, total, q); assert.match(r.texto, re, q);
  }
});

test('AV: «fideo marcos» y «atun marcos» dan lista y nunca repiten «marcos»', async () => {
  for (const q of ['fideo marcos', 'atun marcos', 'tienes fideos marcos?']) {
    const r = await av(q); assert.ok(r.filas.length > 0, q);
    assert.ok(!/marcos/i.test(r.texto + JSON.stringify(r.resumen)), q + ': ' + r.texto);
  }
  const f = await av('fideo marcos'); assert.ok(!/ATUN/.test(f.texto), f.texto);
});

test('AV: «lavagi», «glora», «sal», «pan» y «cerveza pilsen» siguen como en #1001', async () => {
  const l = await av('fideo lavagi'); noAviso(l, 'fideo lavagi'); assert.match(l.texto, /^[^:]*LAVAGGI/, l.texto);
  const g = await av('leche glora'); noAviso(g, 'leche glora'); assert.match(g.texto, /^LECHE GLORIA/, g.texto);
  const s = await av('sal'); assert.ok(!/\bSOL\b/.test(s.texto), s.texto);
  const p = await av('pan'); assert.ok(!/\bPIN\b/.test(p.texto), p.texto);
  const c = await av('cerveza pilsen'); noAviso(c, 'cerveza pilsen');
});

test('marca que no está: «lo más parecido» se queda con el tipo, también abreviado (FID., DET, JAB.)', async () => {
  const rd = { products: async () => [P('a', 'FID. ANITA CODO 250GR', 3, 2), P('b', 'FIDEO NICOLINI TALLARIN', 3, 3), P('c', 'ATUN FLORIDA 170G', 3, 6),
    P('d', 'DET BOLIVAR 730GR', 3, 9), P('e', 'DETERGENTE ARIEL 780GR', 3, 9), P('f', 'JAB.BOLIVAR 190GR', 3, 2), P('g', 'JABON TROME 190GR', 3, 2), P('h', 'SAL EMSAL 1KG', 3, 1)].map((p) => ({ ...p })) };
  const q = (producto) => runAssistantQuery(rd, { tipo: 'stock_producto', producto });
  const f = await q('fideo pastalindo');
  assert.match(f.texto, /^No tengo esa marca; lo más parecido es: /); assert.ok(!/pastalindo/i.test(f.texto + JSON.stringify(f.resumen)));
  assert.deepEqual(f.filas.map((x) => x[0]).sort(), ['FID. ANITA CODO 250GR', 'FIDEO NICOLINI TALLARIN']);
  const d = await q('detergente zorrito'); assert.match(d.texto, /^No tengo esa marca/);
  assert.deepEqual(d.filas.map((x) => x[0]).sort(), ['DET BOLIVAR 730GR', 'DETERGENTE ARIEL 780GR']);
  const j = await q('jabón zorrito'); assert.deepEqual(j.filas.map((x) => x[0]).sort(), ['JAB.BOLIVAR 190GR', 'JABON TROME 190GR']);
  const b = await q('detergente bolivar'); noAviso(b, 'detergente bolivar'); assert.ok(b.texto.startsWith('DET BOLIVAR'), b.texto);
});
