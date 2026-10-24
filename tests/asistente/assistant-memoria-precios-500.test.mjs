// (auditoría 500, fix/asist-memoria-precios-500) Memoria y precios del asistente:
// 1) lo enseñado nunca guarda preguntas (aunque no lleven «?»): M-007, P-015, P-016; las afirmaciones se siguen guardando.
// 2) «don» de una marca («fideo Don Vittorio», P-027) no es un nombre de persona; los clientes de verdad se siguen tapando.
// 3) «el pollo ahora me cuesta 9.20» (M-035): tarjeta «Actualizar costo» con un toque (nunca se aplica sola), sin guardarlo como lección.
// 4) «vendiendo a pérdida» / «a perdida» = venta bajo costo (servidor y teléfono, mismo patrón).
// 5) el teléfono abre «Ventas bajo costo» también para el nivel 3 con «costos y cambios» (el servidor ya lo permite).
// 6) P-044 «el azucar ponlo a 400» con precio S/ 4.00: la tarjeta y la respuesta preguntan «¿Quiso decir S/ 4.00?».
// Proveedor siempre simulado: nunca hay red real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { taughtFact, readInvoiceMemory } from '../../tools/cloudflare-lab/src/pos-assistant-invoice-memory.js';
import { COSTS_ROLE } from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const SECRET = 'secreto-de-prueba-memoria-precios-500';
const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' };
const OWNER = { principalId: 'session:dev-owner-500', posRole: 'owner' };
const NOW = 200000;
const PRODUCTS = [
  { id: 'P1', nombre: 'Pollo entero x kg', precio: 11, costo: 8.5, stock: 20 },
  { id: 'P2', nombre: 'Fideo Don Vittorio spaghetti 500 g', precio: 2.2, costo: 1.6, stock: 40 },
  { id: 'P3', nombre: 'Azúcar rubia 1 kg', precio: 4, costo: 3.2, stock: 30 },
  { id: 'P4', nombre: 'Leche Gloria evaporada 395 g', precio: 4.2, costo: 3.6, stock: 48 },
];
const CUST = [{ id: 'c9', nombre: 'Vittorio Ramos Paz' }, { id: 'c2', nombre: 'Juana Pérez' }];
const tool = (name, args) => ({ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } });
async function chat(text, { role = 'owner', products = PRODUCTS, message = { content: 'Anotado.' }, store = A.createMemoryUsageStore() } = {}) {
  let calls = 0;
  const r = await A.assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text, context: { products } }) }), ENV, OWNER,
    (d, s = 200) => new Response(JSON.stringify(d), { status: s }), {
      store, now: () => NOW, resolveRole: async () => role, audit: async () => {},
      reader: { products: async () => products, credits: async () => [], customers: async () => CUST },
      fetch: async () => { calls++; return new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 5, completion_tokens: 5 } })); } });
  const body = await r.json();
  const saved = await store.get(await A.lessonsKey(OWNER));
  const mem = body.invoice_memory ? await readInvoiceMemory(body.invoice_memory, SECRET, OWNER, NOW) : null;
  return { status: r.status, body, calls, lessons: saved?.value?.items || [], taught: mem?.taught || [] };
}

// ---------- 1) preguntas sin «?» ----------
const QUESTIONS = [
  'quien te dijo q la caja de gloria trae 24 y cuando',                                                  // M-007
  'si la caja de leche gloria me cuesta 85 y trae 24 a cuanto vendo cada una pa ganar 20%',              // P-015
  'la leche gloria evaporada de 24 latas x 395gr me cuesta 93 la caja, a cuanto me sale cada lata',      // P-016
  'quién te dijo que el arroz cuesta 4',
  'y cuanto trae la caja de gaseosa',
  'a cuanto vendo el aceite si me cuesta 9',
  'el six pack me cuesta 27, cuanto gano por lata',
  'cuál es el costo de la caja que trae 12',
  'la caja trae 24 y cuando llega el pedido',
  'dónde compro la caja de 12 que cuesta 30',
];
const FACTS = [
  'ojo la caja de galleta soda field trae 30 paquetitos',
  'al arroz jairito se lo compro a distribuidora san juan',
  'recuerda: al #C0012 no le fíes más de 100',
  'recuerda que el six pack de Pilsen cuesta 27 soles',
  'la caja de leche gloria trae 24 latas',
];
test('1) lo enseñado: las preguntas no se guardan aunque no lleven «?» (M-007, P-015, P-016)', () => {
  for (const q of QUESTIONS) assert.equal(taughtFact(q), null, 'no es lección: ' + q);
});
test('1) lo enseñado: las afirmaciones con un dato se siguen guardando', () => {
  for (const f of FACTS) assert.equal(taughtFact(f), f, 'sí es lección: ' + f);
});
test('1) chat del Admin: M-007 y P-016 no quedan en las lecciones del día ni en el token', async () => {
  for (const q of [QUESTIONS[0], QUESTIONS[2]]) {
    const r = await chat(q);
    assert.equal(r.status, 200); assert.deepEqual(r.lessons, [], q); assert.deepEqual(r.taught, [], q);
  }
  const ok = await chat('ojo la caja de galleta soda field trae 30 paquetitos');
  assert.deepEqual(ok.lessons, ['ojo la caja de galleta soda field trae 30 paquetitos']);
});

// ---------- 2) «don» de una marca ----------
test('2) «Don Vittorio» es marca: la lección la conserva (P-027); los nombres de clientes se siguen tapando', () => {
  const p027 = 'pon 30 de margen al fideo don vittorio, el paquete de 20 bolsitas me cuesta 31.50';
  assert.equal(A.sanitizeLesson(p027, CUST, PRODUCTS), p027, 'con el catálogo');
  assert.equal(A.sanitizeLesson(p027, CUST), p027, 'sin catálogo: «fideo don …» es un producto');
  assert.equal(A.sanitizeLesson('el aceite Don Vittorio trae 12 botellas', [], []), 'el aceite Don Vittorio trae 12 botellas');
  // personas: se siguen tapando
  assert.equal(A.sanitizeLesson('don pepe paga los viernes 20 soles', [], PRODUCTS), 'don paga los viernes 20 soles');
  for (const [t, code] of [['doña juana pérez lleva 2 leches', '#c2'], ['don vittorio ramos me debe 30', '#c9']]) { // cliente de la lista (aunque se llame como la marca)
    const o = A.sanitizeLesson(t, CUST, PRODUCTS);
    assert.ok(o.includes(code), o); assert.doesNotMatch(o, /juana|p[eé]rez|vittorio|ramos/i, o);
  }
});
test('2) «don/doña + nombre» con verbo de deuda o pago se tapa siempre (le gana a la palabra de producto y al producto conocido)', () => {
  const KNOWN = [{ nombre: 'Café Don Juan 250g' }, { nombre: 'Galletas Doña Pepa x 6' }];
  for (const [t, want] of [
    ['leche don pedro debe 20', 'leche don debe 20'],
    ['le di arroz don Pedro, debe 5 soles', 'le di arroz don , debe 5 soles'],
    ['el producto don Pedro debe', 'el producto don debe'],
    ['la marca don Pedro me debe 10', 'la marca don me debe 10'],
    ['DON JUAN DEBE 2 KG', 'DON DEBE 2 KG'],
    ['don juan debe 2 kg', 'don debe 2 kg'],
    ['a don juan le fié 3 kg', 'a don le fié 3 kg'],
    ['DEBE DON PEDRO', 'DEBE DON'],
    ['DON PEDRO 2 KG', 'DON 2 KG'],
    ['DOÑA ROSA PAGÓ 2 KG', 'DOÑA PAGÓ 2 KG'],
    ['aceite doña Rosa pagó ayer', 'aceite doña pagó ayer'],
    ['doña pepa debe 20', 'doña debe 20'],
    ['café don juan, hoy me abonó 15', 'café don , hoy me abonó 15'],
    ['arroz don Lucho fiado a 2 semanas', 'arroz don fiado a 2 semanas'],
    ['azucar don Beto le presto 50', 'azucar don le presto 50'],
    ['le fié arroz don Pedro', 'le fié arroz don'],
  ]) {
    const o = A.sanitizeLesson(t, [], KNOWN);
    assert.equal(o, want, t);
    assert.doesNotMatch(o, /pedro|juan|rosa|pepa|lucho|beto/i, t);
  }
  // marcas sin verbo de deuda: se quedan
  for (const t of ['fideo don vittorio cuesta 2.20', 'trae 6 cajas de galletas doña pepa', 'el café don juan sube a 9.50',
    'pon 30 de margen al fideo don vittorio, el paquete de 20 bolsitas me cuesta 31.50'])
    assert.equal(A.sanitizeLesson(t, [], KNOWN), t, t);
  assert.equal(A.sanitizeLesson('doña pepa viene en caja de 6', [], KNOWN), 'doña pepa viene en caja de 6', 'producto conocido sin verbo');
  // «producto» y «marca» ya no destapan solos; las mayúsculas solas tampoco
  assert.equal(A.sanitizeLesson('el producto don Pedro trae 3', [], []), 'el producto don trae 3');
  assert.equal(A.sanitizeLesson('MARCA DON PEDRO', [], []), 'MARCA DON');
  // clientes de la lista: siempre primero
  const o = A.sanitizeLesson('fideo don vittorio ramos debe 30', CUST, KNOWN);
  assert.ok(o.includes('#c9'), o); assert.doesNotMatch(o, /vittorio|ramos/i, o);
});
// isBrandDon(text, start, end, known): ¿el tramo text[start,end) («don/doña + nombre») es una MARCA? Regla compartida (lecciones y #998).
test('2) isBrandDon: verbo de deuda o pago gana siempre; mayúsculas, «producto», «marca» o un tamaño solos no destapan', () => {
  assert.equal(typeof A.isBrandDon, 'function');
  const KNOWN = [{ nombre: 'Café Don Juan 250g' }, { nombre: 'Galletas Doña Pepa x 6' }];
  const span = (t) => { const m = /\b(?:don|do[nñ]a)\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/i.exec(t); assert.ok(m, t); return [m.index, m.index + m[0].length]; };
  const brand = (t, known = KNOWN) => A.isBrandDon(t, ...span(t), known);
  for (const t of ['leche don pedro debe 20', 'le di arroz don Pedro, debe 5 soles', 'el producto don Pedro debe', 'DON JUAN DEBE 2 KG', 'DEBE DON PEDRO',
    'CLIENTE DON PEDRO', 'A DON JUAN LE FIÉ 3 KG', 'DON PEDRO 2 KG', 'DOÑA ROSA PAGÓ 20', 'DOÑA ROSA PAGÓ 2 KG', 'don juan debe 2 kg', 'a don juan le fié',
    'recuerda que la leche doña Rosa debe 2 kg', 'anota: el arroz don Pedro paga el viernes 20 soles', 'los fideos de don Pedro, le fío hasta el lunes',
    'doña pepa me debe 20', 'MARCA DON PEDRO', 'el producto don Pedro', 'arroz don Lucho pagan los dos', 'leche doña Rosa abona 5', 'le fía arroz don Pedro',
    'cobrar a don Pedro el arroz', 'prestar a doña Rosa 10'])
    assert.equal(brand(t), false, 'persona: ' + t);
  for (const t of ['FIDEO DON VITTORIO SPAGHETTI 500GR X 20', 'fideo don vittorio', 'fideo don vittorio cuesta 2.20', 'trae 6 cajas de doña pepa', 'el café don juan sube a 9.50'])
    assert.equal(brand(t), true, 'marca: ' + t);
  assert.equal(A.isBrandDon('señora Rosa', 0, 11, KNOWN), false, 'solo «don/doña»');
  assert.equal(A.isBrandDon('la doña pepa', 3, 12, ['Galletas Doña Pepa x 6']), true, 'known también acepta nombres sueltos');
});
test('2) sanitizeLesson con la regla compartida: frases de las dos revisiones', () => {
  const KNOWN = [{ nombre: 'Café Don Juan 250g' }, { nombre: 'Galletas Doña Pepa x 6' }];
  for (const t of ['CLIENTE DON PEDRO', 'A DON JUAN LE FIÉ 3 KG', 'DOÑA ROSA PAGÓ 20', 'DOÑA ROSA PAGÓ 2 KG', 'recuerda que la leche doña Rosa debe 2 kg',
    'anota: el arroz don Pedro paga el viernes 20 soles', 'arroz don Lucho pagan los dos', 'leche doña Rosa le fía'])
    assert.doesNotMatch(A.sanitizeLesson(t, [], KNOWN), /pedro|juan|rosa|lucho/i, t);
  assert.equal(A.sanitizeLesson('FIDEO DON VITTORIO SPAGHETTI 500GR X 20', [], KNOWN), 'FIDEO DON VITTORIO SPAGHETTI 500GR X 20');
});
test('2) persona tapada: se va el nombre completo con apellidos en minúscula; «X 2» que sigue se queda', () => {
  const KNOWN = [{ nombre: 'Café Don Juan 250g' }];
  for (const [t, want] of [['doña juana pérez debe 5', 'doña debe 5'], ['doña juana maría pérez debe 5', 'doña debe 5'], ['leche doña rosa pérez debe 2', 'leche doña debe 2'],
    ['don pedro ramos quispe paga 20', 'don paga 20'], ['DON PEDRO X 2', 'DON X 2'], ['don pedro x 2 kg', 'don x 2 kg']])
    assert.equal(A.sanitizeLesson(t, [], KNOWN), want, t);
});
test('2) chat del Admin: P-027 se guarda con la marca', async () => {
  const p027 = 'pon 30 de margen al fideo don vittorio, el paquete de 20 bolsitas me cuesta 31.50';
  const r = await chat(p027);
  assert.deepEqual(r.lessons, [p027]);
});

test('2) chat del Admin (taughtFact → redactModelOwner → sanitizeLesson): producto + «don/doña» + verbo de deuda o pago guarda el nombre tapado', async () => {
  for (const [t, cue] of [['recuerda que la leche doña Rosa debe 2 kg', /doña debe 2 kg/i], ['anota: el arroz don Pedro paga el viernes 20 soles', /don paga el viernes 20 soles/i]]) {
    const r = await chat(t);
    assert.equal(r.status, 200);
    assert.equal(r.lessons.length, 1, t + ' -> ' + JSON.stringify(r.lessons));
    assert.match(r.lessons[0], cue, r.lessons[0]);
    for (const l of r.lessons) assert.doesNotMatch(String(l), /rosa|pedro/i, t + ' -> ' + l); // lo guardado en pos_settings
  }
});

// ---------- 3) costo dicho en el chat ----------
test('3) M-035 «el pollo ahora me cuesta 9.20»: tarjeta «Actualizar costo» firmada, sin lección', async () => {
  const r = await chat('el pollo ahora me cuesta 9.20, acuerdate pa las ganancias');
  assert.equal(r.status, 200);
  const c = r.body.proposals.filter((p) => p.type === 'costo');
  assert.equal(c.length, 1, JSON.stringify(r.body.proposals));
  assert.equal(c[0].product_id, 'P1'); assert.equal(c[0].costo_actual, 8.5); assert.equal(c[0].costo_nuevo, 9.2);
  assert.equal(c[0].needsConfirm, true); assert.equal(c[0].requiresRole, 'owner'); assert.equal(typeof c[0].confirm_token, 'string', 'se aplica solo con el toque (confirm)');
  assert.match(r.body.reply, /Pollo entero x kg/); assert.match(r.body.reply, /S\/ 9\.20/); assert.match(r.body.reply, /Confirmar/);
  assert.deepEqual(r.lessons, [], 'no se guarda como lección'); assert.deepEqual(r.taught, []);
  for (const t of ['el costo del pollo ahora es 9.20', 'ya me cuesta 9.20 el pollo']) {
    const x = await chat(t); assert.equal(x.body.proposals.filter((p) => p.type === 'costo').length, 1, t); assert.deepEqual(x.lessons, [], t);
  }
});
test('3) costo dicho con varios productos parecidos: pregunta cuál, sin tarjeta ni lección', async () => {
  const two = [...PRODUCTS, { id: 'P9', nombre: 'Pollo pierna x kg', precio: 12, costo: 9, stock: 5 }];
  const r = await chat('el pollo ahora me cuesta 9.20', { products: two });
  assert.equal(r.body.proposals.filter((p) => p.type === 'costo').length, 0);
  assert.match(r.body.reply, /Pollo entero x kg/); assert.match(r.body.reply, /Pollo pierna x kg/); assert.match(r.body.reply, /cu[aá]l/i);
  assert.deepEqual(r.lessons, []);
});
test('3) caja/paquete o preguntas no son «costo dicho»; el empleado nunca recibe la tarjeta', async () => {
  for (const t of ['la caja de leche gloria me cuesta 93', 'a cuanto me sale el pollo si me cuesta 9.20', 'el pollo cuesta 9.20']) {
    const r = await chat(t); assert.equal(r.body.proposals.filter((p) => p.type === 'costo').length, 0, t);
  }
  const e = await chat('el pollo ahora me cuesta 9.20', { role: COSTS_ROLE });
  assert.equal(e.body.proposals.filter((p) => p.type === 'costo').length, 0);
});

// ---------- 4) «a pérdida» ----------
const PHONE_BELOW = () => new RegExp(UI.match(/var BELOW_RE = \/(.+)\/i;/)[1], 'i');
const LOSS = ['q productos estoy vendiendo a perdida', 'estoy vendiendo a pérdida?', 'vendo a perdida el arroz?', 'Vendiendo a Pérdida', 'algo se vende a perdida'];
const NOT_LOSS = ['¿Cuánto vendimos hoy?', 'perdí el recibo', 'Productos sin costo', 'estoy perdido en la pantalla', 'perdiendo la señal'];
test('4) «vendiendo a perdida» / «a pérdida»: teléfono y servidor, mismo patrón', () => {
  const phone = PHONE_BELOW();
  assert.ok(A.BELOW_COST_ASK_RE instanceof RegExp, 'el servidor tiene su patrón');
  assert.equal(A.BELOW_COST_ASK_RE.source, phone.source, 'mismo patrón en el teléfono y en el servidor');
  for (const t of LOSS) { assert.ok(phone.test(t), 'teléfono: ' + t); assert.ok(A.BELOW_COST_ASK_RE.test(t), 'servidor: ' + t); }
  for (const t of NOT_LOSS) { assert.ok(!phone.test(t), 'teléfono: ' + t); assert.ok(!A.BELOW_COST_ASK_RE.test(t), 'servidor: ' + t); }
});
test('4) servidor: empleado sin permiso de costos que pregunta «vendiendo a perdida» = 403 below_cost_admin_only, sin modelo', async () => {
  for (const role of ['empleado:consultas', 'empleado:completo']) {
    const r = await chat('q productos estoy vendiendo a perdida', { role });
    assert.equal(r.status, 403, role); assert.equal(r.body.error, 'below_cost_admin_only'); assert.equal(r.calls, 0);
  }
  const ok = await chat('q productos estoy vendiendo a perdida', { role: COSTS_ROLE });
  assert.equal(ok.status, 200, 'nivel 3 con costos sí pasa');
});

// (revisión #988) dar de baja mercadería «a pérdida» NO es preguntar por ventas bajo costo: sin verbo de venta no abre el informe ni da 403.
const WRITE_OFF = ['pasa 3 leches vencidas a pérdida', 'manda a pérdidas el pan malogrado'];
const LOSS_WORDS_BETWEEN = ['qué estoy vendiendo a pérdida', 'vendo algo a perdida', 'vendo el arroz a pérdida', 'vendí la leche a pérdida', 'vendemos el pan a perdida', 'vendimos el arroz a pérdida'];
test('4) bajas «a pérdida» (sin verbo de venta) no son «ventas bajo costo», en el teléfono ni en el servidor', () => {
  const phone = PHONE_BELOW();
  for (const t of WRITE_OFF) { assert.ok(!phone.test(t), 'teléfono: ' + t); assert.ok(!A.BELOW_COST_ASK_RE.test(t), 'servidor: ' + t); }
  for (const t of LOSS_WORDS_BETWEEN) { assert.ok(phone.test(t), 'teléfono: ' + t); assert.ok(A.BELOW_COST_ASK_RE.test(t), 'servidor: ' + t); }
});
test('4) servidor: empleado sin permiso de costos que pide una baja «a pérdida» no recibe 403', async () => {
  for (const role of ['empleado:consultas', 'empleado:completo']) for (const t of WRITE_OFF) {
    const r = await chat(t, { role });
    assert.notEqual(r.status, 403, role + ': ' + t); assert.notEqual(r.body && r.body.error, 'below_cost_admin_only', role + ': ' + t); assert.equal(r.status, 200, role + ': ' + t);
  }
});
test('4) servidor (comportamiento fijado): varios pedidos en un mensaje y uno es sobre ventas bajo costo = 403 completo al empleado sin costos', async () => {
  const t = 'pasa 3 leches vencidas a pérdida y dime qué vendo el arroz a pérdida';
  for (const role of ['empleado:consultas', 'empleado:completo']) {
    const r = await chat(t, { role });
    assert.equal(r.status, 403, role); assert.equal(r.body.error, 'below_cost_admin_only', role); assert.equal(r.calls, 0, role);
  }
});

// ---------- 5) teléfono: nivel 3 con «costos y cambios» ----------
function phoneGate(access) {
  const src = ['isAdmin', 'isOwnerAccess', 'canBelowCost'].map((n) => UI.match(new RegExp('  function ' + n + '\\(\\) \\{.*\\}\\n'))[0]).join('');
  return new Function('access', 'adminOff', src + '; return canBelowCost();')(access, false);
}
test('5) teléfono: «Ventas bajo costo» abre para el Admin y el nivel 3 con «costos y cambios»; no para el resto', () => {
  assert.equal(phoneGate({ role: 'owner', level: 'dueno' }), true);
  assert.equal(phoneGate({ role: 'empleado', level: 'consultas_documentos', cambios: true }), true);
  assert.equal(phoneGate({ role: 'empleado', level: 'consultas_documentos', cambios: false }), false);
  assert.equal(phoneGate({ role: 'empleado', level: 'consultas', cambios: true }), false, 'nivel 1 con cambios raro: no');
  assert.equal(phoneGate(null), false);
  assert.match(UI, /canBelowCost\(\) && BELOW_RE\.test\(text\)/, 'la ruta usa la misma puerta');
});

// ---------- 6) P-044 precio 100× ----------
test('6) P-044 «el azucar ponlo a 400» con S/ 4.00: la tarjeta y la respuesta preguntan «¿Quiso decir S/ 4.00?»', async () => {
  const r = await chat('el azucar ponlo a 400', { message: { content: 'Listo, revisa y pulsa Confirmar.', tool_calls: [tool('proponer_cambio_precio', { product_id: 'P3', precio_nuevo: 400 })] } });
  const p = r.body.proposals.find((x) => x.type === 'precio');
  assert.ok(p, JSON.stringify(r.body));
  assert.equal(p.quisoDecir, 4); assert.equal(p.precio_nuevo, 400); assert.equal(typeof p.confirm_token, 'string', 'un toque, sin PIN');
  assert.match(r.body.reply, /¿Quiso decir S\/ 4\.00\?/);
  assert.match(UI, /p\.quisoDecir/); assert.match(UI, /¿Quiso decir /);
  // cambio grande normal (no 100×): sin la pregunta
  const n = await chat('el azucar ponlo a 7', { message: { content: 'Listo.', tool_calls: [tool('proponer_cambio_precio', { product_id: 'P3', precio_nuevo: 7 })] } });
  const q = n.body.proposals.find((x) => x.type === 'precio');
  assert.equal(q.cambioGrande, true); assert.equal(q.quisoDecir, undefined); assert.doesNotMatch(n.body.reply, /Quiso decir/);
});
