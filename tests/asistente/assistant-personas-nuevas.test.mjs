// (fix/asist-tapar-personas-nuevas) Persona NUEVA (no está en la lista de clientes) escrita por el Admin: su nombre no llega al modelo.
// #998 tapaba solo tras «don/doña/señora…». Ahora la regla compartida (maskCuedPeople, junto a isBrandDon; la usan maskHistoryPeople y
// sanitizeLesson) tapa el nombre tras «cliente», «registra a», «le vendí a», «le fié a», «a» + Nombre, y el nombre antes/después de
// «me debe», «debe», «pagó»… Marcas y productos quedan («arroz costeño», «fideo don vittorio», «leche gloria», «a granel», «a S/ 3.50»).
// Datos inventados; el modelo siempre simulado (se mira el cuerpo REAL que iría al modelo).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const SECRET = 'secreto-de-prueba-personas-nuevas';
const NOW = Date.parse('2026-10-23T15:00:00.000Z');
const EMP = 'empleado:consultas';
const enc = new TextEncoder();
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const delta = (d, finish = null) => 'data: ' + JSON.stringify({ choices: [{ delta: d, finish_reason: finish }] }) + '\n\n';
const DATA = {
  products: [
    { id: 'P1', nombre: 'Arroz Costeño 1 kg', precio: 4.5, costo: 3.8, stock: 30, min: 0, controla: true },
    { id: 'P2', nombre: 'Fideo Don Vittorio spaghetti 500 g', precio: 2.6, costo: 1.9, stock: 30, min: 0, controla: true },
    { id: 'P3', nombre: 'Leche Gloria evaporada 395 g', precio: 4.2, costo: 3.6, stock: 48, min: 0, controla: true },
    { id: 'P4', nombre: 'Gaseosa Bolívar 500 ml', precio: 2, costo: 1.5, stock: 20, min: 0, controla: true }],
  customers: [{ id: 'C1', nombre: 'Marta Lucía Ccori' }], // Rosa Quispe y Juan Pérez NO están: personas nuevas
  credits: [], sales: [], saleItems: []
};
function seq(content, bodies, stream) { return async (_u, init) => { bodies.push(String(init.body));
  if (!stream) return jsonR({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] });
  const parts = [...(content.match(/[\s\S]{1,3}/g) || []).map((x) => delta({ content: x })), delta({}, 'stop')];
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); }; }
async function chat(text, { role = 'owner', stream = true, history, resumen, store = A.createMemoryUsageStore() } = {}) {
  const bodies = [];
  const r = await A.assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, stream, context: {}, ...(history ? { history } : {}), ...(resumen ? { resumen } : {}) }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:personas-nuevas', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store, resolveRole: async () => role, fetch: seq('Anotado.', bodies, stream), reader: memoryReader(DATA), audit: async () => {}, now: () => NOW, statusEveryMs: 60000 });
  const raw = await new Response(r.body).text();
  return { status: r.status, raw, bodies, lastUser: bodies.length ? String(JSON.parse(bodies[0]).messages.filter((m) => m.role === 'user').at(-1).content) : null };
}
const quiet = (t) => { const o = console.log; console.log = () => {}; t.after(() => { console.log = o; }); };
const NAMES = /Rosa|Quispe|Juan|P[eé]rez/i;

const NEW_PEOPLE = ['registra a Rosa Quispe como cliente', 'agrega cliente Juan Pérez', 'le vendí a Rosa Quispe 2 kg de arroz'];
test('Admin, mensaje actual: persona nueva tras «registra a», «cliente», «le vendí a» no llega al modelo (en partes y entero)', async (t) => {
  quiet(t);
  for (const stream of [true, false]) for (const text of NEW_PEOPLE) {
    const r = await chat(text, { stream });
    assert.equal(r.bodies.length, 1, 'stream=' + stream + ' ' + text + ': ' + r.raw.slice(0, 200));
    assert.doesNotMatch(r.bodies[0], NAMES, 'stream=' + stream + ': al modelo llegó el nombre de «' + text + '»');
    assert.match(r.lastUser, /\[nombre oculto\]/, 'stream=' + stream + ': ' + r.lastUser);
  }
  const r = await chat('le vendí a Rosa Quispe 2 kg de arroz', { stream: false });
  assert.match(r.lastUser, /le vendí a \[nombre oculto\] 2 kg de arroz/, r.lastUser);
});
test('Admin: marcas y productos quedan enteros junto a una persona tapada (en partes y entero)', async (t) => {
  quiet(t);
  for (const stream of [true, false]) {
    const r = await chat('le vendí a Rosa Quispe 2 kg de arroz costeño, leche gloria y fideo don vittorio', { stream });
    assert.doesNotMatch(r.bodies[0], NAMES, 'stream=' + stream);
    for (const keep of ['arroz costeño', 'leche gloria', 'fideo don vittorio']) assert.ok(r.lastUser.includes(keep), 'stream=' + stream + ': falta «' + keep + '» en ' + r.lastUser);
  }
});
const KEEP = ['véndele a 3.50 el arroz', 'pásalo a granel', 'agrega al cliente el fideo Don Vittorio', 'cliente #5 lleva Gloria', 'cliente compra Bolívar',
  'súbele a S/ 3.50 el arroz costeño', 'déjalo a 2 kg', 'la leche gloria y el fideo don vittorio'];
test('Admin: frases sin persona llegan intactas al modelo (en partes y entero)', async (t) => {
  quiet(t);
  for (const stream of [true, false]) for (const text of KEEP) {
    const r = await chat(text, { stream });
    if (!r.bodies.length) continue; // atajo del servidor sin modelo: nada que mirar
    const code = (x) => x.replace(/cliente #[\w-]+/g, 'cliente #X'); // «cliente #5» -> «cliente #C-0001» (códigos neutros, ya en la base)
    assert.ok(code(r.lastUser).includes(code(text)), 'stream=' + stream + ': «' + text + '» cambió: ' + r.lastUser);
    assert.doesNotMatch(r.lastUser, /\[nombre oculto\]/, 'stream=' + stream + ': ' + r.lastUser);
  }
});
test('Admin: historial y resumen del teléfono sin la persona nueva hacia el modelo (en partes y entero)', async (t) => {
  quiet(t);
  const history = [{ role: 'user', content: 'le fié a Rosa Quispe 3 kg de arroz costeño' }, { role: 'assistant', content: 'Anotado.' }];
  const resumen = 'Antes: agrega cliente Juan Pérez; Rosa Quispe me debe 2 kg.';
  for (const stream of [true, false]) {
    const r = await chat('¿y qué más?', { stream, history, resumen });
    assert.equal(r.bodies.length, 1, 'stream=' + stream + ': ' + r.raw.slice(0, 200));
    assert.doesNotMatch(r.bodies[0], NAMES, 'stream=' + stream + ': al modelo llegó un nombre del historial o del resumen');
    assert.match(r.bodies[0], /arroz costeño/, 'stream=' + stream + ': la marca queda');
  }
});
test('empleado: al menos igual de estricto (la persona nueva tampoco llega al modelo)', async (t) => {
  quiet(t);
  for (const stream of [true, false]) {
    const r = await chat('le vendí a Rosa Quispe 2 kg de arroz', { role: EMP, stream });
    if (!r.bodies.length) continue;
    assert.doesNotMatch(r.bodies[0], NAMES, 'stream=' + stream);
  }
});
test('empleado (pedido de alfa): «le fié a Rosa Quispe» llega al modelo como «[nombre oculto]», en partes y entero; también en su historial firmado', async (t) => {
  quiet(t);
  for (const stream of [true, false]) {
    const r = await chat('le fié a Rosa Quispe', { role: EMP, stream });
    assert.equal(r.bodies.length, 1, 'stream=' + stream + ': ' + r.raw.slice(0, 200));
    assert.doesNotMatch(r.bodies[0], /Rosa Quispe|Rosa|Quispe/, 'stream=' + stream);
    assert.match(r.lastUser, /le fié a \[nombre oculto\]/, 'stream=' + stream + ': ' + r.lastUser);
    // historial del empleado: turno firmado por el servidor con el nombre crudo -> la copia del modelo va tapada
    const iat = NOW - 1000, u = 'le fié a Rosa Quispe 2 kg de arroz', a = 'Anotado.';
    const sig = await A.signTurnPair(SECRET, 'empleado', 'session:personas-nuevas', 0, iat, u, a);
    const h = await chat('¿y qué más?', { role: EMP, stream, history: [{ role: 'user', content: u, sig, n: 0, iat }, { role: 'assistant', content: a, sig, n: 0, iat }] });
    assert.equal(h.bodies.length, 1, 'stream=' + stream + ': ' + h.raw.slice(0, 200));
    const msgs = JSON.parse(h.bodies[0]).messages.map((m) => String(m.content));
    assert.ok(msgs.some((m) => /le fié a \[nombre oculto\] 2 kg de arroz/.test(m)), 'stream=' + stream + ': el turno firmado vuelve al modelo, tapado: ' + msgs.join(' | ').slice(0, 400));
    assert.doesNotMatch(h.bodies[0], /Rosa|Quispe/, 'stream=' + stream);
  }
});
test('regla compartida maskCuedPeople: personas tapadas, marcas/números/unidades quedan', () => {
  assert.equal(typeof A.maskCuedPeople, 'function');
  const K = DATA.products;
  for (const t of [...NEW_PEOPLE, 'Rosa Quispe me debe 2 kg', 'me debe Rosa Quispe 2 kg', 'A Rosa Quispe le fié 3 kg', 'pagó Juan Pérez 20 soles',
    'registra a rosa quispe como cliente', 'agrega cliente juan pérez, teléfono [teléfono oculto]', 'la vecina Rosa Quispe paga el viernes'])
    assert.doesNotMatch(A.maskCuedPeople(t, K), NAMES, t + ' -> ' + A.maskCuedPeople(t, K));
  for (const t of [...KEEP, 'arroz costeño', 'fideo don vittorio', 'leche gloria', 'a granel', 'a S/ 3.50', 'a 2 kg', 'registra un cliente nuevo', 'cliente #C-0001 debe 20',
    'pasa a Inventario', 'mi proveedor del arroz es distribuidora san juan', 'La compraste a S/ 7.77 a Distribuidora Secreta SAC', 'le compré a Alicorp 2 cajas', 'el arroz costeño cuesta 4.50'])
    assert.equal(A.maskCuedPeople(t, K), t, t);
});
test('lecciones (sanitizeLesson): «Rosa Quispe me debe 2 kg» no guarda el nombre', () => {
  for (const t of ['Rosa Quispe me debe 2 kg', 'recuerda que Rosa Quispe me debe 2 kg', 'le fié a Juan Pérez 3 kg de arroz'])
    assert.doesNotMatch(A.sanitizeLesson(t, [], DATA.products), NAMES, t + ' -> ' + A.sanitizeLesson(t, [], DATA.products));
  assert.equal(A.sanitizeLesson('el arroz costeño trae 12 bolsas', [], DATA.products), 'el arroz costeño trae 12 bolsas');
});
test('lecciones, camino real de la base (chat → taughtFact → saveLesson en el servidor): guardado sin el nombre', async (t) => {
  quiet(t);
  const store = A.createMemoryUsageStore();
  const r = await chat('recuerda que Rosa Quispe me debe 2 kg', { stream: false, store });
  assert.equal(r.status, 200);
  const saved = (await store.get(await A.lessonsKey({ principalId: 'session:personas-nuevas' })))?.value?.items || [];
  assert.equal(saved.length, 1, JSON.stringify(saved));
  assert.doesNotMatch(saved[0], NAMES, saved[0]);
  assert.match(saved[0], /me debe 2 kg/, saved[0]);
  assert.doesNotMatch(r.bodies[0], NAMES, 'al modelo tampoco');
});
test('lecciones, memoria FIRMADA (invoice_memory.taught) sin el nombre', { todo: 'se activa cuando fix/asist-leccion-clave (sanitizeLesson en la memoria firmada) esté en la base' }, async () => {
  const { readInvoiceMemory } = await import('../../tools/cloudflare-lab/src/pos-assistant-invoice-memory.js');
  const bodies = [];
  const r = await A.assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'recuerda que Rosa Quispe me debe 2 kg', stream: false, context: {} }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:personas-nuevas', posRole: 'owner' }, jsonR,
    { store: A.createMemoryUsageStore(), resolveRole: async () => 'owner', fetch: seq('Anotado.', bodies, false), reader: memoryReader(DATA), audit: async () => {}, now: () => NOW });
  const body = await r.json(), mem = await readInvoiceMemory(body.invoice_memory, SECRET, { principalId: 'session:personas-nuevas', posRole: 'owner' }, NOW);
  assert.ok(mem && mem.taught.length === 1, JSON.stringify(mem && mem.taught));
  assert.doesNotMatch(mem.taught[0], NAMES, mem.taught[0]);
});
test('limpieza (pedido de alfa): HISTORY_DON_CUE ya no existe (maskHistoryPeople tapa siempre con la regla compartida)', () => {
  assert.equal('HISTORY_DON_CUE' in A, false);
});
