// «Lo enseñado» (lote 3) en la base real: pos_settings.key admite 1..60 caracteres (migración 0024). La clave de lecciones tenía 61
// («internal:asst:taught:» + 40 hex), así que el guardado fallaba en D1 y el error se tragaba. Aquí: tabla creada con la migración REAL
// (node:sqlite, Node 22+), guardado y lectura por la ruta real del chat; aviso en el registro cuando el guardado falla (sin datos);
// y la memoria firmada (invoice_memory.taught) pasa por sanitizeLesson antes de firmarse: el nombre de una persona no vuelve a la IA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { writeInvoiceMemory, readInvoiceMemory } from '../../tools/cloudflare-lab/src/pos-assistant-invoice-memory.js';

const { assistantChatRoute, createMemoryUsageStore, createSettingsUsageStore, lessonsKey, readLessons, saveLesson, LESSONS_PREFIX } = A;
const SECRET = 'secreto-de-prueba-0123456789abcdef';
const NOW = Date.parse('2026-10-22T20:00:00.000Z');
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, OHMYAGENT_API_KEY: 'k-ohmy' };
const OWNER = { principalId: 'session:admin-leccion', posRole: 'owner' };
const DATA = {
  products: [{ id: 'P1', nombre: 'Arroz 1 kg', precio: 4, costo: 3, stock: 50, min: 5, controla: true }, { id: 'P2', nombre: 'Fideo Don Vittorio 500 g', precio: 3, costo: 2, stock: 20, min: 2, controla: true }],
  customers: [{ id: 'C1', nombre: 'Juan Díaz' }], credits: [], sales: [], saleItems: []
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder();
const delta = (d, fin) => 'data: ' + JSON.stringify({ choices: [{ delta: d, ...(fin ? { finish_reason: fin } : {}) }] }) + '\n\n';
const streamR = (chunks) => { let i = 0; return new Response(new ReadableStream({ pull(c) { if (i < chunks.length) c.enqueue(enc.encode(chunks[i++])); else { c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
const msg = (content) => json({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

// pos_settings con la migración real 0024 (CHECK length(key) BETWEEN 1 AND 60) y un adaptador mínimo con el contrato de D1.
function realSettingsDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../infra/database/migrations/0024_pos_roles_owner_pin.sql', import.meta.url), 'utf8'));
  const d1 = { prepare: (sql) => ({ bind: (...a) => ({
    first: async () => db.prepare(sql).get(...a) ?? null,
    run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }
  }) }) };
  return { db, d1 };
}
async function route(body, store, responses = [() => msg('Anotado.')]) {
  const cap = [];
  const f = async (_u, init) => { cap.push(String(init.body)); const r = responses[Math.min(cap.length - 1, responses.length - 1)]; return r(); };
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { products: DATA.products }, ...body }) }),
    ENV, OWNER, json, { store, resolveRole: async () => 'owner', fetch: f, reader: memoryReader(DATA), audit: async () => {}, mockChunkMs: 0, now: () => NOW });
  return { r, cap };
}
const sseFinal = (text) => text.split('\n\n').filter((b) => /^event: final/m.test(b)).map((b) => JSON.parse(/^data: (.*)$/m.exec(b)[1]))[0];

test('1) la clave de lecciones cabe en pos_settings (60) y lo enseñado se guarda y se lee en la tabla real', async () => {
  const key = await lessonsKey(OWNER);
  assert.ok(key.startsWith(LESSONS_PREFIX) && LESSONS_PREFIX === 'internal:asst:taught:', key);
  assert.ok(key.length <= 60, 'clave de ' + key.length + ' caracteres');
  assert.match(key.slice(LESSONS_PREFIX.length), /^[0-9a-f]+$/);
  const { db, d1 } = realSettingsDb(), store = createSettingsUsageStore(d1);
  const { r } = await route({ text: 'apunta: el arroz de la tienda trae 50 kg por saco' }, store);
  assert.equal(r.status, 200);
  const rows = db.prepare("SELECT key FROM pos_settings WHERE key LIKE 'internal:asst:taught:%'").all();
  assert.equal(rows.length, 1, 'se guardó en la tabla real'); assert.equal(rows[0].key, key);
  assert.deepEqual(await readLessons(store, OWNER, NOW), ['apunta: el arroz de la tienda trae 50 kg por saco']);
  // y la puerta directa, por la tabla real
  assert.equal(await saveLesson(store, OWNER, NOW, 'apunta: el aceite viene en cajas de 12'), true);
  assert.equal((await readLessons(store, OWNER, NOW)).length, 2);
});

test('2) si el guardado falla, queda un aviso en el registro (sin clave, aparato ni texto); al Admin nada cambia', async (t) => {
  const warns = []; t.mock.method(console, 'warn', (...a) => { warns.push(a.map(String).join(' ')); });
  const k = await lessonsKey(OWNER);
  const broken = { async get() { return { value: {}, revision: 0 }; }, async put() { throw new Error('D1_ERROR: CHECK constraint failed: length(key) BETWEEN 1 AND 60 ' + k); } };
  assert.equal(await saveLesson(broken, OWNER, NOW, 'apunta: doña Rosa Quispe debe 2 kg, dni 45678912'), false);
  assert.equal(warns.length, 1, 'un aviso');
  for (const bad of ['Rosa', 'Quispe', '45678912', OWNER.principalId, 'admin-leccion', k, k.slice(LESSONS_PREFIX.length)]) assert.ok(!warns[0].includes(bad), 'el aviso lleva ' + bad + ': ' + warns[0]);
  assert.match(warns[0], /lecci|enseñ/i);
  // conflicto de revisión que no se resuelve en 4 intentos: también avisa
  const busy = { async get() { return { value: {}, revision: 1 }; }, async put() { return false; } };
  assert.equal(await saveLesson(busy, OWNER, NOW, 'apunta: el aceite viene en cajas de 12'), false);
  assert.equal(warns.length, 2);
  // por la ruta: la respuesta al Admin es la misma
  const { r } = await route({ text: 'apunta: el arroz trae 50 kg por saco' }, { ...createMemoryUsageStore(), put: async (key, ...rest) => { if (String(key).startsWith(LESSONS_PREFIX)) throw new Error('x'); return createMemoryUsageStore().put(key, ...rest); } });
  assert.equal(r.status, 200); assert.equal((await r.json()).reply, 'Anotado.');
});

for (const stream of [false, true]) test('3) lo enseñado en la memoria firmada pasa por sanitizeLesson: «doña Rosa» no vuelve a la IA; «fideo don vittorio» se queda' + (stream ? ' (en partes)' : ''), async () => {
  const later = (cap) => cap[cap.length - 1];
  const reply = stream ? () => streamR([delta({ content: 'Listo.' }, 'stop')]) : () => msg('Listo.');
  const read = async (r) => (stream ? sseFinal(await r.text()) : await r.json());
  const t1 = await route({ text: 'apunta: doña Rosa debe 2 kg de arroz', stream }, createMemoryUsageStore(), [reply]);
  const tok = (await read(t1.r)).invoice_memory; assert.equal(typeof tok, 'string');
  const mem = await readInvoiceMemory(tok, SECRET, OWNER, NOW);
  assert.ok(mem.taught.length === 1 && !/Rosa/.test(mem.taught[0]) && /2 kg de arroz/.test(mem.taught[0]), JSON.stringify(mem.taught));
  // otro turno con la memoria firmada (almacén nuevo: lo único que lleva lo enseñado es el token)
  const t2 = await route({ text: '¿qué te enseñé hoy?', invoice_memory: tok, stream }, createMemoryUsageStore(), [reply]);
  await read(t2.r);
  const sent = later(t2.cap); assert.ok(/ensenado_por_usuario/.test(sent), 'va lo enseñado');
  assert.ok(!/Rosa/i.test(sent), 'llegó a la IA: ' + sent.slice(sent.indexOf('ensenado'), sent.indexOf('ensenado') + 300));
  // marca
  const b1 = await route({ text: 'apunta: siempre pido fideo don vittorio los lunes', stream }, createMemoryUsageStore(), [reply]);
  const tokB = (await read(b1.r)).invoice_memory;
  const b2 = await route({ text: '¿qué te enseñé hoy?', invoice_memory: tokB, stream }, createMemoryUsageStore(), [reply]);
  await read(b2.r);
  assert.match(later(b2.cap), /fideo don vittorio los lunes/);
});

test('3b) un token firmado antes del arreglo (frase cruda) también sale limpio hacia la IA', async () => {
  const old = await writeInvoiceMemory({ previous: null, image: null, proposals: [], reply: 'Anotado.', text: 'apunta: doña Rosa debe 2 kg de arroz', secret: SECRET, auth: OWNER, now: NOW, clean: (x) => String(x) });
  assert.match(JSON.stringify((await readInvoiceMemory(old, SECRET, OWNER, NOW)).taught), /Rosa/, 'el token viejo lleva el nombre');
  const t2 = await route({ text: '¿qué te enseñé hoy?', invoice_memory: old }, createMemoryUsageStore(), [() => msg('Listo.')]);
  const d = await t2.r.json(); const sent = t2.cap[t2.cap.length - 1];
  assert.ok(/ensenado_por_usuario/.test(sent) && /2 kg de arroz/.test(sent), 'va lo enseñado');
  assert.ok(!/Rosa/i.test(sent), 'llegó a la IA');
  assert.ok(!/Rosa/.test(JSON.stringify((await readInvoiceMemory(d.invoice_memory, SECRET, OWNER, NOW)).taught)), 'el token nuevo sale limpio');
});

// (alfa) En la ventana del verbo de deuda o pago de isBrandDon, la puntuación no cuenta como palabra (ni los pronombres átonos «me», «lo»…):
// «el arroz don Pedro, que siempre me lo debe» es una persona aunque vaya después de «arroz».
test('4) la puntuación no cuenta en la ventana del verbo de deuda: «arroz don Pedro, que siempre me lo debe» tapa «Pedro»; las marcas siguen', async () => {
  const PHRASE = 'recuerda que el arroz don Pedro, que siempre me lo debe, llega el 5';
  const { isBrandDon, sanitizeLesson } = A;
  const at = PHRASE.indexOf('don Pedro');
  assert.equal(isBrandDon(PHRASE, at, at + 'don Pedro'.length, DATA.products), false);
  assert.equal(isBrandDon('el arroz don Pedro ; que me lo debe', 9, 18, []), false);
  assert.equal(isBrandDon('el arroz don Pedro. Me lo debe', 9, 18, []), false);
  const clean = sanitizeLesson(PHRASE, DATA.customers, DATA.products);
  assert.ok(!/Pedro/i.test(clean) && /llega el 5/.test(clean) && /me lo debe/.test(clean), clean);
  // marcas intactas
  const KNOWN = [...DATA.products, { nombre: 'Doña Pepa 1 kg' }];
  assert.equal(sanitizeLesson('apunta: siempre pido fideo don vittorio, los lunes', [], KNOWN), 'apunta: siempre pido fideo don vittorio, los lunes');
  assert.equal(sanitizeLesson('anota: FIDEO DON VITTORIO SPAGHETTI 500GR X 20 llega el 5', [], KNOWN), 'anota: FIDEO DON VITTORIO SPAGHETTI 500GR X 20 llega el 5');
  assert.equal(sanitizeLesson('anota: Doña Pepa, trae 12 cajas', [], KNOWN), 'anota: Doña Pepa, trae 12 cajas');
  const x = sanitizeLesson('apunta: DON PEDRO X 2 cajas', [], KNOWN); assert.ok(!/PEDRO/.test(x) && /X 2 cajas/.test(x), x);
  // guardado (pos_settings real) y lo que llega a la IA en el turno siguiente (servidor y token), con y sin partes
  for (const stream of [false, true]) {
    const { db, d1 } = realSettingsDb(), store = createSettingsUsageStore(d1);
    const reply = stream ? () => streamR([delta({ content: 'Listo.' }, 'stop')]) : () => msg('Listo.');
    const read = async (r) => (stream ? sseFinal(await r.text()) : await r.json());
    const t1 = await route({ text: PHRASE, stream }, store, [reply]); const tok = (await read(t1.r)).invoice_memory;
    const saved = db.prepare("SELECT value_json FROM pos_settings WHERE key LIKE 'internal:asst:taught:%'").all();
    assert.equal(saved.length, 1); assert.ok(!/Pedro/i.test(saved[0].value_json) && /llega el 5/.test(saved[0].value_json), saved[0].value_json);
    const t2 = await route({ text: '¿qué te enseñé hoy?', invoice_memory: tok, stream }, store, [reply]); await read(t2.r);
    const sent = t2.cap[t2.cap.length - 1];
    assert.ok(/ensenado_por_usuario/.test(sent) && /llega el 5/.test(sent), 'va lo enseñado');
    assert.ok(!/Pedro/i.test(sent), 'llegó a la IA' + (stream ? ' (en partes)' : ''));
  }
});

// (alfa) Guarda: quitar los pronombres átonos y la puntuación de la ventana no debe tapar marcas.
test('4b) con pronombres y puntuación cerca, «fideo don vittorio» y «doña pepa» quedan enteros', async () => {
  const { sanitizeLesson, isBrandDon } = A;
  const KNOWN = [...DATA.products, { nombre: 'Doña Pepa 1 kg' }];
  for (const t of [
    'apunta: el fideo don vittorio me lo traen los lunes, 5 cajas',
    'apunta: fideo don vittorio, se lo llevan siempre; trae 20 por caja',
    'recuerda: la doña pepa la llevo siempre, 12 bolsas',
    'anota: doña pepa, me la traen el 5 y se les acaba rápido',
    'apunta: FIDEO DON VITTORIO, LO TRAEN EN CAJAS DE 20'
  ]) {
    assert.equal(sanitizeLesson(t, DATA.customers, KNOWN), t, t);
    const i = t.search(/don vittorio|doña pepa/i), len = /vittorio/i.test(t.slice(i, i + 12)) ? 12 : 9;
    assert.equal(isBrandDon(t, i, i + len, KNOWN), true, t);
  }
});

// (alfa) La aclaración de la boleta (invoice_memory.clarifications[].usuario) es texto crudo del Admin que vuelve a la IA en
// <boleta_recordada> en los turnos siguientes: misma regla que lo enseñado (sanitizeLesson + isBrandDon) antes de firmarse y al leer un token viejo.
const BOLETA = [{ type: 'compra', proveedor: 'Distribuidora Lima', documento: 'F001-123', fecha: '2026-10-22', lineas: [{ nombre: 'Arroz 1 kg', cantidad: 50, costo_unitario: 3 }] }];
const boletaToken = () => writeInvoiceMemory({ previous: null, image: null, proposals: BOLETA, reply: 'Leí la boleta F001-123.', text: '', secret: SECRET, auth: OWNER, now: NOW, clean: (x) => String(x) });
const CTX_PEPA = { products: [...DATA.products, { id: 'P3', nombre: 'Doña Pepa 1 kg', precio: 5, costo: 4, stock: 10, min: 1, controla: true }] };
const boletaSent = (s) => { const i = s.lastIndexOf('<boleta_recordada>'); return i < 0 ? '' : s.slice(i, s.indexOf('</boleta_recordada>', i)); }; // el mensaje, no la regla del sistema

for (const stream of [false, true]) test('5) la aclaración de la boleta pasa por sanitizeLesson antes de firmarse: el nombre no vuelve a la IA; las marcas sí' + (stream ? ' (en partes)' : ''), async () => {
  const reply = stream ? () => streamR([delta({ content: 'Entendido.' }, 'stop')]) : () => msg('Entendido.');
  const read = async (r) => (stream ? sseFinal(await r.text()) : await r.json());
  for (const [said, name, keep] of [
    ['doña Carmen Salas trajo la boleta, el arroz es 50 kg', /Carmen|Salas/i, /50 kg/],
    ['la boleta es de don Ernesto Villar', /Ernesto|Villar/i, /la boleta es de/],
    ['ojo, el fideo don vittorio de la boleta viene en cajas de 20', null, /fideo don vittorio de la boleta viene en cajas de 20/],
    ['la doña pepa de la boleta trae 12 bolsas', null, /la doña pepa de la boleta trae 12 bolsas/]
  ]) {
    const t1 = await route({ text: said, invoice_memory: await boletaToken(), context: CTX_PEPA, stream }, createMemoryUsageStore(), [reply]);
    const tok = (await read(t1.r)).invoice_memory; assert.equal(typeof tok, 'string', said);
    const clar = (await readInvoiceMemory(tok, SECRET, OWNER, NOW)).clarifications.map((c) => c.usuario);
    assert.equal(clar.length, 1, said); assert.match(clar[0], keep, 'guardado: ' + clar[0]);
    if (name) { assert.ok(!name.test(clar[0]), 'se firmó con el nombre: ' + clar[0]); for (const s of t1.cap) assert.ok(!name.test(s), 'llegó a la IA en el mismo turno: ' + said); }
    const t2 = await route({ text: 'listo, regístrala', invoice_memory: tok, context: CTX_PEPA, stream }, createMemoryUsageStore(), [reply]); await read(t2.r);
    const sent = boletaSent(t2.cap[t2.cap.length - 1]); assert.ok(sent.includes('aclaraciones_del_usuario'), 'va la boleta recordada');
    assert.match(sent, keep, 'a la IA: ' + sent);
    if (name) assert.ok(!name.test(sent), 'llegó a la IA en <boleta_recordada>: ' + sent);
  }
});

test('5b) un token firmado antes del arreglo (aclaración cruda) sale limpio hacia la IA y se vuelve a firmar limpio', async () => {
  const prev = await readInvoiceMemory(await boletaToken(), SECRET, OWNER, NOW);
  const old = await writeInvoiceMemory({ previous: prev, image: null, proposals: [], reply: 'Entendido.', text: 'doña Carmen Salas trajo la boleta, el arroz es 50 kg', secret: SECRET, auth: OWNER, now: NOW, clean: (x) => String(x) });
  assert.match(JSON.stringify((await readInvoiceMemory(old, SECRET, OWNER, NOW)).clarifications), /Carmen Salas/, 'el token viejo lleva el nombre');
  const t2 = await route({ text: 'listo, regístrala', invoice_memory: old }, createMemoryUsageStore(), [() => msg('Listo.')]);
  const d = await t2.r.json(), sent = boletaSent(t2.cap[t2.cap.length - 1]);
  assert.ok(/aclaraciones_del_usuario/.test(sent) && /50 kg/.test(sent), 'va la aclaración');
  assert.ok(!/Carmen|Salas/i.test(sent), 'llegó a la IA: ' + sent);
  assert.ok(!/Carmen|Salas/.test(JSON.stringify((await readInvoiceMemory(d.invoice_memory, SECRET, OWNER, NOW)).clarifications)), 'el token nuevo sale limpio');
});
