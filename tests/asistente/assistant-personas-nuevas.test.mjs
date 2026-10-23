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
    { id: 'P4', nombre: 'Gaseosa Bolívar 500 ml', precio: 2, costo: 1.5, stock: 20, min: 0, controla: true },
    // (revisión de alfa) marcas y proveedor que deben quedar enteros tras «rebaja a», «dale a», «le debo a»…
    { id: 'P5', nombre: 'Chocolate Sublime 30 g', precio: 1.5, costo: 1.1, stock: 40, min: 0, controla: true },
    { id: 'P6', nombre: 'Cerveza Pilsen Callao 630 ml', precio: 6, costo: 4.8, stock: 24, min: 0, controla: true },
    { id: 'P7', nombre: 'Gaseosa Inca Kola 500 ml', precio: 2.5, costo: 1.9, stock: 24, min: 0, controla: true },
    { id: 'P8', nombre: 'Mayonesa Alacena Alicorp 100 g', precio: 3, costo: 2.2, stock: 12, min: 0, controla: true },
    { id: 'P9', nombre: 'Galleta Doña Pepa 6 un', precio: 1, costo: 0.7, stock: 30, min: 0, controla: true }],
  customers: [{ id: 'C1', nombre: 'Marta Lucía Ccori' }], // Rosa Quispe y Juan Pérez NO están: personas nuevas
  credits: [], sales: [], saleItems: []
};
function seq(content, bodies, stream) { return async (_u, init) => { bodies.push(String(init.body));
  if (!stream) return jsonR({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] });
  const parts = [...(content.match(/[\s\S]{1,3}/g) || []).map((x) => delta({ content: x })), delta({}, 'stop')];
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); }; }
async function chat(text, { role = 'owner', stream = true, history, resumen, store = A.createMemoryUsageStore(), reply = 'Anotado.' } = {}) {
  const bodies = [];
  const r = await A.assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, stream, context: {}, ...(history ? { history } : {}), ...(resumen ? { resumen } : {}) }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:personas-nuevas', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store, resolveRole: async () => role, fetch: seq(reply, bodies, stream), reader: memoryReader(DATA), audit: async () => {}, now: () => NOW, statusEveryMs: 60000 });
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

// ---------- (revisión de alfa sobre #1011: cambios pedidos) ----------
// Cada frase se mira en el cuerpo EXACTO que iría al modelo (assistantChatRoute), en partes y entero.
// [frase, nombres que no pueden llegar]
const LEAKS = [
  // a) texto entre la señal y el nombre
  ['cliente: Rosa Quispe', /Rosa|Quispe/], ['el cliente se llama Rosa Quispe', /Rosa|Quispe/], ['agrega un cliente nuevo Rosa Quispe', /Rosa|Quispe/],
  // b) partículas dentro del nombre
  ['cliente María del Carmen', /Mar[ií]a|Carmen/], ['agrega cliente Juan de Dios Pérez', /Juan|Dios|P[eé]rez/], ['registra a María de los Ángeles Quispe', /Mar[ií]a|[ÁA]ngeles|Quispe/],
  // c) nombre largo
  ['Rosa Quispe Mamani Huamán me debe 5', /Rosa|Quispe|Mamani|Huam[aá]n/],
  // d) palabras entre el nombre y el verbo; dos personas
  ['Rosa Quispe ya pagó', /Rosa|Quispe/], ['Rosa Quispe, cliente nueva, me debe 2 kg', /Rosa|Quispe/], ['Rosa Quispe y Juan Pérez me deben', /Rosa|Quispe|Juan|P[eé]rez/],
  // e) minúsculas con señal fuerte
  ['le fié a oscar aguilar', /oscar|aguilar/i], ['le vendí a vicente alvarado', /vicente|alvarado/i], ['le fié a concepción mamani', /concepci[oó]n|mamani/i], ['oscar me debe 10', /oscar/i]];
const INTACT = ['¿cuánto me debe cliente #5?', '¿cuánto me deben?', 'Cuánto pagó cliente #5', 'cuantos me deben', 'cual me debe más', 'qué me debe cliente #5',
  'rebaja a Sublime a 1', 'dále a Pilsen precio de 5.50', 'rebájale a Gloria 20 céntimos', 'registra a Gloria como proveedor', 'el cliente #5 pagó Inca Kola',
  'pagué a Gloria 500', 'le debo a Alicorp 300', 'cuánto vendí a Gloria', 'clientes morosos', 'clientes deudores', 'clientes activos',
  'cámbiale el precio a Gloria a 4.50', 'sube a Pilsen 6 soles', 'compré a Alicorp', 'vendí a granel', 'debe pagar a Sunat'];
const code = (x) => x.replace(/cliente #[\w-]+/g, 'cliente #X');
test('revisión 1) fugas: cada frase llega al modelo sin el nombre, Admin y empleado (en partes y entero)', async (t) => {
  quiet(t);
  for (const role of ['owner', EMP]) for (const stream of [true, false]) for (const [text, re] of LEAKS) {
    const r = await chat(text, { role, stream });
    assert.equal(r.bodies.length, 1, role + ' stream=' + stream + ' «' + text + '»: ' + r.raw.slice(0, 200));
    assert.doesNotMatch(r.bodies[0], re, role + ' stream=' + stream + ': «' + text + '» llegó como «' + r.lastUser + '»');
    assert.match(r.lastUser, /\[nombre oculto\]/, role + ' stream=' + stream + ': ' + r.lastUser);
  }
});
test('revisión 1) las mismas frases en el historial y el resumen del teléfono (Admin) llegan tapadas (en partes y entero)', async (t) => {
  quiet(t);
  for (const stream of [true, false]) {
    const history = LEAKS.flatMap(([u]) => [{ role: 'user', content: u }, { role: 'assistant', content: 'Anotado.' }]).slice(-16);
    const resumen = LEAKS.slice(0, 8).map(([u]) => u).join('. ');
    const r = await chat('¿y qué más?', { stream, history, resumen });
    assert.equal(r.bodies.length, 1, 'stream=' + stream + ': ' + r.raw.slice(0, 200));
    for (const [u, re] of LEAKS) {
      const inHist = history.some((m) => m.content === u), inRes = resumen.includes(u);
      if (inHist || inRes) assert.doesNotMatch(r.bodies[0], re, 'stream=' + stream + ': «' + u + '» llegó con el nombre desde ' + (inHist ? 'el historial' : 'el resumen'));
    }
  }
});
test('revisión 1) historial FIRMADO del empleado: las frases nuevas vuelven tapadas (en partes y entero)', async (t) => {
  quiet(t);
  for (const stream of [true, false]) for (const [u, re] of [LEAKS[1], LEAKS[5], LEAKS[6], LEAKS[9], LEAKS[10]]) {
    const iat = NOW - 1000, a = 'Anotado.', sig = await A.signTurnPair(SECRET, 'empleado', 'session:personas-nuevas', 0, iat, u, a);
    const h = await chat('¿y qué más?', { role: EMP, stream, history: [{ role: 'user', content: u, sig, n: 0, iat }, { role: 'assistant', content: a, sig, n: 0, iat }] });
    assert.equal(h.bodies.length, 1, 'stream=' + stream + ': ' + h.raw.slice(0, 200));
    assert.ok(JSON.parse(h.bodies[0]).messages.some((m) => String(m.content).includes('[nombre oculto]')), 'stream=' + stream + ': el turno firmado no volvió tapado («' + u + '»)');
    assert.doesNotMatch(h.bodies[0], re, 'stream=' + stream + ': «' + u + '»');
  }
});
test('revisión 1) lecciones: «recuerda que oscar aguilar me debe 2 kg» se guarda tapado', async (t) => {
  quiet(t);
  assert.doesNotMatch(A.sanitizeLesson('recuerda que oscar aguilar me debe 2 kg', [], DATA.products), /oscar|aguilar/i);
  const store = A.createMemoryUsageStore();
  const r = await chat('recuerda que oscar aguilar me debe 2 kg', { stream: false, store });
  assert.equal(r.status, 200);
  const saved = (await store.get(await A.lessonsKey({ principalId: 'session:personas-nuevas' })))?.value?.items || [];
  assert.equal(saved.length, 1, JSON.stringify(saved));
  assert.doesNotMatch(saved[0], /oscar|aguilar/i, saved[0]); assert.match(saved[0], /me debe 2 kg/, saved[0]);
  assert.doesNotMatch(r.bodies[0], /oscar|aguilar/i, 'al modelo tampoco');
});
test('revisión 2) y 3) quedan enteras: preguntas con «cuánto/cuál/qué», marcas y proveedores del catálogo, «clientes morosos…» (en partes y entero)', async (t) => {
  quiet(t);
  for (const text of INTACT) assert.equal(A.maskCuedPeople(text, DATA.products), text, 'maskCuedPeople cambió «' + text + '»');
  for (const role of ['owner', EMP]) for (const stream of [true, false]) for (const text of INTACT) {
    const r = await chat(text, { role, stream });
    if (!r.bodies.length) continue; // atajo del servidor o pedido que el empleado no puede hacer: no hubo modelo
    assert.ok(code(r.lastUser).includes(code(text)), role + ' stream=' + stream + ': «' + text + '» cambió: ' + r.lastUser);
    assert.doesNotMatch(r.lastUser, /\[nombre oculto\]/, role + ' stream=' + stream + ': ' + r.lastUser);
  }
});
test('revisión 4) empleado: la regla #998 completa (don/doña/señora) más la persona nueva (en partes y entero)', async (t) => {
  quiet(t);
  for (const stream of [true, false]) for (const [text, re] of [['le vendí a doña Rosa 2 kg', /Rosa/], ['la señora Rosa Quispe llevó arroz', /Rosa|Quispe/], ['le fié a Rosa Quispe', /Rosa|Quispe/]]) {
    const r = await chat(text, { role: EMP, stream });
    assert.equal(r.bodies.length, 1, 'stream=' + stream + ' «' + text + '»: ' + r.raw.slice(0, 200));
    assert.doesNotMatch(r.bodies[0], re, 'stream=' + stream + ': «' + text + '» llegó como «' + r.lastUser + '»');
    assert.match(r.lastUser, /\[nombre oculto\]/, 'stream=' + stream + ': ' + r.lastUser);
  }
});
test('revisión (no bloqueante): 3000 productos y 50 KB de texto se tapan rápido (catálogo preparado una vez por llamada)', () => {
  const prods = Array.from({ length: 3000 }, (_, i) => ({ nombre: 'Producto Marca' + i + ' Linea' + (i % 97) + ' 500 g' }));
  const chunk = 'le vendí a Rosa Quispe 2 kg, rebaja a Marca17 a 3, Juan Pérez me debe 5, cliente Ana Torres. ';
  const text = chunk.repeat(Math.ceil(50000 / chunk.length)); // 50 KB o un poco más, en frases enteras
  const t0 = performance.now(), out = A.maskCuedPeople(text, prods), ms = performance.now() - t0;
  assert.ok(text.length >= 50000); const leak = out.match(/Rosa|Quispe|Juan|P[eé]rez|Ana Torres/); assert.equal(leak, null, 'quedó: ' + (leak && out.slice(Math.max(0, leak.index - 40), leak.index + 40)));
  assert.match(out, /rebaja a Marca17 a 3/);
  assert.ok(ms < 3000, 'tardó ' + Math.round(ms) + ' ms');
});

// (alfa) la palabra que sigue al nombre tapado se queda: «doña Carmen Salas trajo la boleta» -> «doña [nombre oculto] trajo la boleta».
const AFTER = [['doña Carmen Salas trajo la boleta', /Carmen|Salas/, /doña \[nombre oculto\] trajo la boleta/],
  ['la boleta es de don Ernesto Villar', /Ernesto|Villar/, /la boleta es de don \[nombre oculto\]/]];
const AFTER_KEEP = ['fideo don vittorio', 'doña pepa viene en caja de 6'];
test('alfa) palabra tras el nombre tapado: Admin y empleado, mensaje actual (en partes y entero); «fideo don vittorio» y «doña pepa» quedan', async (t) => {
  quiet(t);
  for (const role of ['owner', EMP]) for (const stream of [true, false]) {
    for (const [text, re, want] of AFTER) {
      const r = await chat(text, { role, stream });
      assert.equal(r.bodies.length, 1, role + ' stream=' + stream + ' «' + text + '»: ' + r.raw.slice(0, 200));
      assert.doesNotMatch(r.bodies[0], re, role + ' stream=' + stream + ': ' + r.lastUser);
      assert.match(r.lastUser, want, role + ' stream=' + stream + ': ' + r.lastUser);
    }
    for (const text of AFTER_KEEP) {
      const r = await chat(text, { role, stream });
      if (!r.bodies.length) continue;
      assert.ok(code(r.lastUser).includes(code(text)), role + ' stream=' + stream + ': «' + text + '» cambió: ' + r.lastUser);
    }
  }
});
test('alfa) palabra tras el nombre tapado: historial del Admin y historial FIRMADO del empleado (en partes y entero)', async (t) => {
  quiet(t);
  for (const stream of [true, false]) for (const [u, re, want] of AFTER) {
    const r = await chat('¿y qué más?', { stream, history: [{ role: 'user', content: u }, { role: 'assistant', content: 'Anotado.' }] });
    assert.equal(r.bodies.length, 1, 'stream=' + stream + ': ' + r.raw.slice(0, 200));
    assert.doesNotMatch(r.bodies[0], re, 'Admin stream=' + stream + ': «' + u + '»');
    assert.ok(JSON.parse(r.bodies[0]).messages.some((m) => want.test(String(m.content))), 'Admin stream=' + stream + ': «' + u + '» no quedó como se espera');
    const iat = NOW - 1000, a = 'Anotado.', sig = await A.signTurnPair(SECRET, 'empleado', 'session:personas-nuevas', 0, iat, u, a);
    const h = await chat('¿y qué más?', { role: EMP, stream, history: [{ role: 'user', content: u, sig, n: 0, iat }, { role: 'assistant', content: a, sig, n: 0, iat }] });
    assert.equal(h.bodies.length, 1, 'empleado stream=' + stream + ': ' + h.raw.slice(0, 200));
    assert.doesNotMatch(h.bodies[0], re, 'empleado stream=' + stream + ': «' + u + '»');
    assert.ok(JSON.parse(h.bodies[0]).messages.some((m) => want.test(String(m.content))), 'empleado stream=' + stream + ': «' + u + '» no quedó como se espera');
  }
});
test('alfa) palabra tras el nombre tapado: lecciones (sanitizeLesson) guardan «trajo la boleta» sin Carmen ni Salas', () => {
  for (const prods of [DATA.products, []]) {
    const o = A.sanitizeLesson('doña Carmen Salas trajo la boleta', [], prods);
    assert.doesNotMatch(o, /Carmen|Salas/, o); assert.match(o, /^doña .*trajo la boleta$/, o);
    const o2 = A.sanitizeLesson('la boleta es de don Ernesto Villar', [], prods);
    assert.doesNotMatch(o2, /Ernesto|Villar/, o2); assert.match(o2, /^la boleta es de don/, o2);
  }
  assert.equal(A.sanitizeLesson('fideo don vittorio', [], DATA.products), 'fideo don vittorio');
  assert.equal(A.sanitizeLesson('doña pepa viene en caja de 6', [], DATA.products), 'doña pepa viene en caja de 6');
});

// (alfa) el empleado recibe el MISMO «known» (productos y clientes) que el Admin para el filtro final de la respuesta: las marcas del
// catálogo («Galleta Doña Pepa», «Fideo Don Vittorio») no se tapan; los nombres de personas sí. Hacia la IA el tapado es igual para los dos.
// Solo cambian las listas del tapado: el empleado no recibe costos ni ganancias.
const finalReply = (raw) => { const m = raw.match(/event: final\ndata: (.*)\n/); return JSON.parse(m ? m[1] : raw).reply; };
const BRAND_REPLY = 'Quedan 30 de Galleta Doña Pepa 6 un y 30 de Fideo Don Vittorio spaghetti; don Ernesto Villar pagó.';
test('alfa) empleado: la respuesta deja las marcas del catálogo (mismo known que el Admin) y tapa las personas (en partes y entero)', async (t) => {
  quiet(t);
  for (const role of ['owner', EMP]) for (const stream of [true, false]) {
    const r = await chat('stock de galleta y fideo', { role, stream, reply: BRAND_REPLY });
    const shown = finalReply(r.raw), tag = role + ' stream=' + stream + ': ' + shown;
    assert.match(shown, /Galleta Doña Pepa 6 un/, tag); assert.match(shown, /Fideo Don Vittorio spaghetti/, tag);
    assert.doesNotMatch(shown, /Ernesto|Villar/, tag); assert.match(shown, /don \[nombre oculto\]/, tag);
    if (stream) assert.doesNotMatch(r.raw, /Ernesto|Villar/, 'en partes, ningún trozo con el nombre: ' + tag);
  }
});
test('alfa) empleado: hacia la IA «cliente compra Bolívar» y «rebaja a Gloria a 4.50» dejan la marca; la persona se tapa (igual que el Admin)', async (t) => {
  quiet(t);
  for (const stream of [true, false]) {
    const same = {};
    for (const role of ['owner', EMP]) for (const [text, keep] of [['cliente compra Bolívar', /cliente compra Bolívar/], ['rebaja a Gloria a 4.50', /rebaja a Gloria a 4\.50/], ['le fié a Rosa Quispe 2 kg de arroz', /le fié a \[nombre oculto\] 2 kg de arroz/]]) {
      const r = await chat(text, { role, stream });
      assert.match(r.lastUser, keep, role + ' stream=' + stream + ': ' + r.lastUser); assert.doesNotMatch(r.bodies[0], NAMES);
      (same[text] = same[text] || []).push(r.lastUser.replace(/^[\s\S]*<dato_usuario>/, ''));
    }
    for (const [text, v] of Object.entries(same)) assert.equal(v[0], v[1], 'mismo tapado Admin/empleado: ' + text);
  }
});
test('alfa) empleado: con el known del Admin no recibe costos ni ganancias (ni hacia la IA ni en la respuesta)', async (t) => {
  quiet(t);
  for (const stream of [true, false]) {
    const r = await chat('stock de galleta y fideo', { role: EMP, stream, reply: BRAND_REPLY });
    assert.doesNotMatch(r.bodies[0] + r.raw, /"(?:costo\w*|ganancia\w*|margen\w*|utilidad\w*|cost\w*)"\s*:/i);
  }
});

// (segunda revisión, BLOCK) marca del catálogo al empezar la frase, antes de «debe/pagó»: en la base llegaba entera. Hacia atrás también
// se mira el catálogo con mayúscula («Pilsen debe…», «Inca Kola me debe…»); una persona real antes de «debe/pagó» se sigue tapando.
const BRAND_DEBT = ['Pilsen debe subir de precio', 'Gloria me debe mandar 2 cajas', 'Alicorp me debe una factura', 'Inca Kola me debe 2 cajas',
  'Sublime me debe el bonificado', 'Alicorp ya pagó la nota de crédito', 'Pilsen pagó la promoción', 'Inca Kola debe venir el lunes'];
test('revisión 2) marca del catálogo antes de «debe/pagó» queda entera; la persona sigue tapada (regla compartida)', () => {
  for (const text of BRAND_DEBT) assert.equal(A.maskCuedPeople(text, DATA.products), text, text);
  for (const [text, want] of [['Rosa Quispe ya pagó', '[nombre oculto] ya pagó'], ['oscar me debe 10', '[nombre oculto] me debe 10'],
    ['Rosa Quispe me debe 2 kg', '[nombre oculto] me debe 2 kg'], ['Gloria y Rosa Quispe me deben', 'Gloria y [nombre oculto] me deben'],
    ['Rosa Quispe y Pilsen me deben', '[nombre oculto] y Pilsen me deben']]) assert.equal(A.maskCuedPeople(text, DATA.products), want, text);
});
test('revisión 2) marca del catálogo antes de «debe/pagó» llega entera al modelo, Admin y empleado (en partes y entero)', async (t) => {
  quiet(t);
  for (const role of ['owner', EMP]) for (const stream of [true, false]) for (const text of BRAND_DEBT) {
    const r = await chat(text, { role, stream });
    assert.equal(r.bodies.length, 1, role + ' stream=' + stream + ' ' + text + ': ' + r.raw.slice(0, 200));
    assert.doesNotMatch(r.lastUser, /\[nombre oculto\]/, role + ' stream=' + stream + ': ' + r.lastUser);
    assert.ok(r.lastUser.includes(text), role + ' stream=' + stream + ': ' + r.lastUser);
  }
});
