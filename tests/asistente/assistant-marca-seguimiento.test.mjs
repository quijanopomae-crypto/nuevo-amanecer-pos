// Seguimiento de #1001 (hallazgos no bloqueantes de la revisión del autor de caja):
// 1) «pan de molde» decía «No tengo esa marca»: «molde», «integral», «light», «entera», «descremada», «familiar», «tajado»… describen el
//    producto, no son una marca. No disparan el aviso; si hay pan, se muestra el pan normal.
// 2) Tipo de producto («fideo», «detergente»): solo acota «lo más parecido» cuando la marca NO está en ningún nombre. Si la marca está
//    (aunque sea con otro tipo: «fideo marcos» y el ATÚN MARCO POLO), la lista es la de la base y sin aviso (2ª revisión, decisión de alfa).
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

// (2ª revisión de #1005, decisión de alfa) el aviso sale SOLO si la marca no está en ningún nombre del catálogo. «Marco» está en el ATÚN
// MARCO POLO: se muestra ese producto, sin aviso. Nunca se dice que algo no está cuando sí está. La palabra pedida nunca se repite.
test('«fideo marcos»: la marca está (ATÚN MARCO POLO), así que se muestra sin aviso y sin repetir «marcos»', async () => {
  for (const q of ['fideo marcos', 'fideos marcos', 'tienes fideo marcos?']) {
    const r = await stock(q); noAviso(r, q);
    assert.ok(r.filas.some((f) => f[0] === 'ATUN MARCO POLO 170G'), q + ': ' + JSON.stringify(r.filas.map((f) => f[0])));
    assert.ok(!/marcos/i.test(r.texto + JSON.stringify(r.resumen)), q);
  }
});

test('marca que solo está con otro tipo («fideo zeta» y solo hay SPAGHETTI ZETA): se muestra, sin aviso', async () => {
  const rd = { products: async () => [...CATALOGO, P('30', 'SPAGHETTI ZETA 500GR', 4, 3)].map((p) => ({ ...p })) };
  for (const q of ['fideo zeta', 'fideos zeta']) {
    const r = await runAssistantQuery(rd, { tipo: 'stock_producto', producto: q }); noAviso(r, q);
    assert.ok(r.filas.some((f) => f[0] === 'SPAGHETTI ZETA 500GR'), q + ': ' + r.texto);
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

test('chat Admin y empleado: «fideo marcos» sin aviso ni la palabra; «cerveza pilsen» con aviso fijo; el empleado sin costos', async (t) => {
  quiet(t);
  for (const role of ['owner', 'empleado:consultas']) {
    const d = await chat('tienes fideo marcos', [first(call('fideo marcos')), MODEL_SAYS], role);
    assert.ok(!/No tengo/.test(d.final.reply), role + ': ' + d.final.reply); assert.ok(!/marcos/i.test(d.final.reply), role + ': ' + d.final.reply);
    const c = await chat('tienes cerveza pilsen', [first(call('cerveza pilsen')), MODEL_SAYS], role);
    assert.match(c.final.reply, /^No tengo esa marca; lo más parecido es: CERVEZA CRISTAL/, role); assert.ok(!/pilsen/i.test(c.final.reply), role);
    const s = await chat('tienes fideo marcos? explícame', [first(call('fideo marcos')), MODEL_SAYS], role);
    assert.equal(s.bodies.length, 2, role); const tp = toolParts(s.bodies[1]);
    assert.ok(!/No tengo/.test(tp), role); assert.ok(!/marcos/i.test(tp), role + ': ' + tp);
    if (role !== 'owner') { for (const x of [d.raw, c.raw, s.raw]) assert.ok(!x.includes('1.11'), 'sin costo en el canal'); assert.ok(!tp.includes('1.11'), 'sin costo al modelo'); }
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
  return Array.from(ctx.D.rows, (r, i) => P('av' + i, r.NOMBRE_LIMPIO_SEGURO, 5, 1));
})();
const avReader = { products: async () => AV.map((p) => ({ ...p })) };
const av = (producto) => runAssistantQuery(avReader, { tipo: 'stock_producto', producto });

// Lo que da la base (8b75691c) con el catálogo de AV: [total, filas]. Con la marca presente, el PR debe dar exactamente lo mismo.
// «leche condensada», «yogurt laive», «jabon en barra»: el tipo va en medio del nombre (GLORIA LECHE CONDENSADA, BEB YOGURT YOPI LAIVE,
// ÑA PANCHA JABON EN BARRA); la 1ª cabeza del PR decía «No tengo esa marca» y los perdía (2ª revisión).
const AV_BASE = {"leche condensada": [35, ["GLORIA LECHE CONDENSADA LATA CJ X 24 393GR", "NESTLE LECHE CONDENSADA 96 UN X 100GR", "NESTLE LECHE CONDENSADA X 24 UN X 393GR", "NESTLE LECHE CONDENSADA + JARRA 393GR X 32 UND", "LECHE GLORIA UHT ENTERA TTP X12UND X 1LT", "LECHE GLORIA EVAPORADA 24 LATAS X 395GR", "LECHE GLORIA EVAPORADA 48 LATAS X 170GR", "GALL CHOCODONUTS LECHE Y GRAJEAS 14X6X36GR"]], "yogurt laive": [4, ["BEB YOGURT YOPI LAIVE FRESA 180ML X 24UND", "BOLY KIDS YOGURT 12BOL X 40UND", "CHOCOLATADA LAIVE 180ML X24UND", "YOGURT YOGUITO GLORIA X 24UND X180ML ZEROLACTEOS F. Y FRESA"]], "jabon en barra": [48, ["ÑA PANCHA JABON EN BARRA DUOPACK 400GR X 24UND", "JABON TROME LIMON 190GR X 40 BR", "JABON TROME FLORAL 190GR X 40 BR", "JABON POPEYE AMARILLO X 210GM X 40UND", "JABON POPEYE ROSADO X 210KG 40 UND", "JABON POPEYE ATB 210GRX40UND AZUL", "JABON MARSELLA FLORAL 190GR X 40BRR", "HALLS BARRA SURTIDO MIX X 30 DP X 12 UND"]], "fideo don vittorio": [47, ["FID. DON VITTORIO MUNICION 235GR 20BOL", "FID. DON VITTORIO LETRAS/NUM 235G 20BOL", "FID. DON VITTORIO CANUTO CHICO 235GR 20BOL", "FID. DON VITTORIO CODO RAYADO 500GR 12BOL", "FID. DON VITTORIO CORBATA CHICO 235GR 20BOL", "FID. DON VITTORIO CORBATA GRANDE 225GR 20BOL", "FID. DON VITTORIO CARACOL CHICO 235GR 20BOL", "FID. DON VITTORIO RIGATONI 500GR 12BOL"]], "fideo espiga de oro": [71, ["FIDEO SOPA ESPIGA DE ORO SURTIDO X 10KG", "FID ESPIGA DE ORO CANUTO CHICO 225GR 20BOLS", "FID ESPIGA DE ORO CANUTO RAYADO 235GR 20BOLS", "FID ESPIGA DE ORO CARACOL CHICO 225GR 20BOLS", "FID ESPIGA DE ORO CARACOL GRANDE 225GR 20BOLS", "FID ESPIGA DE ORO ARITO 235GR 20BOLS", "FID ESPIGA DE ORO CODO RAYADO 225GR 20BOLS", "FID ESPIGA DE ORO SAYON TORNILLO 225GR 20BOLS"]], "detergente bolivar": [42, ["DET BOLIVAR CUIDADO TOTAL 140GR 60BOL", "SUAV.BOLIVAR GENERACION BB 800ML X 12FCO", "DET BOLIVAR CUIDADO TOTAL 730GR 15BOL", "DET BOLIVAR RENACIMIENTO AROM SUAVIDAD 730GR 15BOL", "SUAV.BOLIVAR AROM.ACTIVE 800ML 12FCO", "SUAV.BOLIVAR AROM.ACTIVE 2.8L X 6FCO", "DET BOLIVAR CUIDADO TOTAL 2.4KG 6BLS", "JAB.BOLIVAR BB KIDS 190GR 48BRR"]], "jabon bolivar": [76, ["JABON TROME LIMON 190GR X 40 BR", "JABON TROME FLORAL 190GR X 40 BR", "DET BOLIVAR CUIDADO TOTAL 140GR 60BOL", "SUAV.BOLIVAR GENERACION BB 800ML X 12FCO", "JABON POPEYE AMARILLO X 210GM X 40UND", "JABON POPEYE ROSADO X 210KG 40 UND", "JABON POPEYE ATB 210GRX40UND AZUL", "DET BOLIVAR CUIDADO TOTAL 730GR 15BOL"]], "gaseosa kola real": [53, ["GASEOSA VILLA KOLA 1.300LT X 6UND", "GASEOSA VILLA KOLA 250ML X 24UND", "GASEOSA VILLA KOLA 3LT X 6UND -IQ GUARANA", "GASEOSA VILLA KOLA 3LT X 6UND - IQ AMARILLO", "GASEOSA VILLA KOLA 420ML X 15UND IQ GUARANA", "GASEOSA VILLA KOLA 420ML X 15UND - IQ AMARILLA", "GASEOSA VILLA KOLA 3LT X 6UND - SURTIDO", "GASEOSA VILLA KOLA 420ML X 15UND - SURTIDO"]], "fideo marcos": [5, ["FIDEO SOPA ESPIGA DE ORO SURTIDO X 10KG", "SEMOLA MARCO POLO 20X180GR", "CANCHA DE FIDEOS X 1K", "FIDEO ANITA SPAQUETTI X 10 KG", "MARCO POLO SPAGHETTI 32 20X500GR"]], "atun marcos": [20, ["FANNY TROZO ATUN ACEIT VEG.48X170G", "FILETE DE ATUN FLORIDA 48 X 140GR", "FILETE DE ATUN A-1 X 48UN X 170GR", "FILETE ATUN PRIMOR 140GR 48LTA", "SEMOLA MARCO POLO 20X180GR", "MIMASKOT GATOS SALMON ATUN 9 KG", "FANNY GRATED ATUN EN AGUA Y SAL 48 X 170GR", "FILETE ATUN NICOLINI X 48UN X 170GR"]]};
test('AV: con la marca presente, total y lista idénticos a la base y sin aviso', async () => {
  for (const [q, [total, filas]] of Object.entries(AV_BASE)) {
    const r = await av(q); noAviso(r, q); assert.equal(r.total, total, q); assert.deepEqual(r.filas.map((f) => f[0]), filas, q);
  }
  const j = await av('jabón bolívar'); noAviso(j, 'jabón bolívar'); assert.equal(j.total, 76);
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

test('marca que no está: «lo más parecido» se queda con el tipo (en cualquier palabra del nombre, también abreviado: FID., DET, JAB.)', async () => {
  const rd = { products: async () => [P('a', 'FID. ANITA CODO 250GR', 3, 2), P('b', 'FIDEO NICOLINI TALLARIN', 3, 3), P('c', 'ATUN FLORIDA 170G', 3, 6),
    P('d', 'DET BOLIVAR 730GR', 3, 9), P('e', 'DETERGENTE ARIEL 780GR', 3, 9), P('f', 'JAB.BOLIVAR 190GR', 3, 2), P('g', 'JABON TROME 190GR', 3, 2), P('h', 'SAL EMSAL 1KG', 3, 1),
    P('i', 'FILETE DE ATUN FLORIDA 140GR', 3, 6), P('j', 'SALSA DE TOMATE 400GR', 3, 4), P('k', 'PAN BIMBO BLANCO', 3, 8), P('l', 'PANETON DONOFRIO 900GR', 3, 20),
    P('m', 'PAÑAL HUGGIES XG 40UND', 3, 40)].map((p) => ({ ...p })) };
  const q = (producto) => runAssistantQuery(rd, { tipo: 'stock_producto', producto });
  const names = (r) => r.filas.map((x) => x[0]).sort();
  const f = await q('fideo pastalindo');
  assert.match(f.texto, /^No tengo esa marca; lo más parecido es: /); assert.ok(!/pastalindo/i.test(f.texto + JSON.stringify(f.resumen)));
  assert.deepEqual(names(f), ['FID. ANITA CODO 250GR', 'FIDEO NICOLINI TALLARIN']);
  const d = await q('detergente zorrito'); assert.match(d.texto, /^No tengo esa marca/); assert.deepEqual(names(d), ['DET BOLIVAR 730GR', 'DETERGENTE ARIEL 780GR']);
  const j = await q('jabón zorrito'); assert.deepEqual(names(j), ['JAB.BOLIVAR 190GR', 'JABON TROME 190GR']);
  const b = await q('detergente bolivar'); noAviso(b, 'detergente bolivar'); assert.ok(b.texto.startsWith('DET BOLIVAR'), b.texto);
  // el tipo en medio del nombre
  const af = await q('atun florida'); noAviso(af, 'atun florida'); assert.ok(af.filas.some((x) => x[0] === 'FILETE DE ATUN FLORIDA 140GR'), af.texto);
  const az = await q('atun zorrito'); assert.match(az.texto, /^No tengo esa marca/); assert.deepEqual(names(az), ['ATUN FLORIDA 170G', 'FILETE DE ATUN FLORIDA 140GR']);
  // SAL y PAN no son abreviaturas; la ñ no es n
  const sa = await q('salsa zorrito'); assert.match(sa.texto, /^No tengo esa marca/); assert.deepEqual(names(sa), ['SALSA DE TOMATE 400GR']);
  const pa = await q('paneton zorrito'); assert.match(pa.texto, /^No tengo esa marca/); assert.deepEqual(names(pa), ['PANETON DONOFRIO 900GR']);
  const pn = await q('pañal zorrito'); assert.match(pn.texto, /^No tengo esa marca/); assert.deepEqual(names(pn), ['PAÑAL HUGGIES XG 40UND']);
  const pn2 = await q('pañales zorrito'); assert.deepEqual(names(pn2), ['PAÑAL HUGGIES XG 40UND']);
});
