// GROKBOT 5 (pruebas y calidad), P0-D: memoria entre sesiones — ámbito por persona, tope, caducidad y que NO se mezcle con el inventario.
// Nivel A (determinista): almacén en memoria, modelo FALSO, productos SINTÉTICOS. No toca CANON. 0 llamadas a un modelo real.
// Hechos que fija: hoy la memoria del Admin son «lecciones del día» (pos-assistant.js:2121-2188, máx. 20, día de Lima) + el token firmado de 8 h
// (pos-assistant-invoice-memory.js). NO hay memoria permanente ni forma de «olvidar»: las pruebas {todo} documentan esa brecha y los bugs reales
// (hechos de INVENTARIO guardados como «enseñanza», «Olvida…» guardado como lección nueva).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, createMemoryUsageStore, saveLesson, readLessons, lessonsKey, LESSONS_PREFIX } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { taughtFact, MAX_TAUGHT } from '../../tools/cloudflare-lab/src/pos-assistant-invoice-memory.js';
import { memoryReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const ENV = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef', DEEPSEEK_API_KEY: 'k' };
const jr = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const D1 = Date.parse('2026-10-26T20:00:00.000Z'); // lunes 15:00 Lima
const D2 = Date.parse('2026-10-27T15:00:00.000Z'); // martes 10:00 Lima
const A = { principalId: 'session:a5-dueno-A', posRole: 'owner' }, B = { principalId: 'session:a5-dueno-B', posRole: 'owner' };
const PR = [{ id: 'Q1', nombre: 'PRUEBA A5 Galleta', precio: 4.5, costo: 2, stock: 3, min: 5, controla: true }];

test('A5-G1) lecciones: la de una persona NO la ve otra; mismo día se leen; se quitan duplicados; tope de 20 conservando las más recientes', async () => {
  const store = createMemoryUsageStore();
  assert.ok(await saveLesson(store, A, D1, 'la caja de galletas trae 24 unidades'));
  assert.deepEqual(await readLessons(store, A, D1), ['la caja de galletas trae 24 unidades']);
  assert.deepEqual(await readLessons(store, B, D1), [], 'otra persona/aparato: nada (no se mezclan)');
  await saveLesson(store, A, D1, 'la caja de galletas trae 24 unidades');
  assert.equal((await readLessons(store, A, D1)).length, 1, 'sin duplicados');
  for (let i = 1; i <= 25; i++) await saveLesson(store, A, D1, 'el pack ' + i + ' trae ' + (10 + i) + ' unidades');
  const l = await readLessons(store, A, D1);
  assert.equal(MAX_TAUGHT, 20); assert.equal(l.length, 20);
  assert.equal(l[l.length - 1], 'el pack 25 trae 35 unidades'); assert.ok(!l.includes('el pack 1 trae 11 unidades'), 'las más viejas salen');
  assert.ok((await lessonsKey(A)).startsWith(LESSONS_PREFIX)); assert.notEqual(await lessonsKey(A), await lessonsKey(B));
});

test('A5-G2) caracterización: las lecciones caducan al cambiar el día de Lima (NO son memoria permanente)', async () => {
  const store = createMemoryUsageStore();
  await saveLesson(store, A, D1, 'la caja de galletas trae 24 unidades');
  assert.equal((await readLessons(store, A, D1 + 3 * 3600000)).length, 1, 'misma noche (18:00 Lima): sigue');
  assert.deepEqual(await readLessons(store, A, D2), [], 'al día siguiente: se perdió');
});

test('A5-G3) «Recuerda para mañana que una caja trae 24 UND» debe seguir disponible al día siguiente (memoria permanente por negocio/persona)', { todo: 'Brecha P0-D (informe §3/§9): no existe memoria permanente. readLessons (pos-assistant.js:2123-2126) exige v.d === limaDate(now). Requiere diseño con Worker + tabla versionada + permisos (no es un fix mínimo).' }, async () => {
  const store = createMemoryUsageStore();
  await saveLesson(store, A, D1, 'una caja trae 24 UND');
  assert.deepEqual(await readLessons(store, A, D2), ['una caja trae 24 UND']);
});

test('A5-G4) enseñar algo NO toca el inventario: la ruta real solo escribe claves internas del asistente y el stock del contexto llega intacto al modelo', async () => {
  const store = createMemoryUsageStore(); const seen = [];
  const fetch = async (_u, init) => { seen.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ choices: [{ message: { content: 'Anotado.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })); };
  const ask = async (text, now) => { const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text, context: { products: PR } }) }), ENV, A, jr,
    { store, resolveRole: async () => 'owner', fetch, reader: memoryReader({ products: PR }), audit: async () => {}, now: () => now }); return r.json(); };
  const r1 = await ask('Recuerda que la caja de galletas trae 24 unidades', D1);
  assert.equal(r1.ok, true); assert.ok(!r1.proposals.some((p) => p.type === 'ajuste' || p.type === 'compra' || p.type === 'precio'), 'una enseñanza no crea tarjetas de cambio');
  for (const k of store._map.keys()) assert.ok(k.startsWith('internal:asst:'), 'clave inesperada fuera del asistente: ' + k);
  assert.ok([...store._map.keys()].some((k) => k.startsWith(LESSONS_PREFIX)), 'la lección sí se guardó');
  await ask('¿y cuántas unidades me quedan de la galleta?', D1 + 60000);
  const msgs = seen[seen.length - 1].messages.map((m) => String(m.content)).join('\n');
  assert.match(msgs, /<ensenado_por_usuario>[\s\S]*caja de galletas trae 24[\s\S]*<\/ensenado_por_usuario>/, 'la lección va en su propio bloque «dato del usuario»');
  assert.match(msgs, /"stock":3\b|"stock": 3\b/, 'el stock REAL del contexto (3) sigue siendo el dato de inventario');
});

test('A5-G5) los hechos de INVENTARIO («tienen 24 en stock», «el stock de leche es de 12») NO deben guardarse como enseñanza (quedarían viejos y contradecirían al inventario)', { todo: 'BUG P0-D confirmado: taughtFact (pos-assistant-invoice-memory.js:~46) acepta «tienen/tiene/es de + número» sin distinguir equivalencias (caja trae 24) de existencias. Arreglo mínimo: rechazar si el texto habla de stock/existencias/almacén/quedan/hay.' }, () => {
  for (const t of ['Las galletas tienen 24 unidades en stock', 'el arroz tiene 50 en el almacén', 'el stock de leche es de 12', 'quedan 3 galletas en el estante, ya tienen 3'])
    assert.equal(taughtFact(t), null, t);
});

test('A5-G6) «Olvida la regla…», «Corrige tu recuerdo…» y «Usa mi preferencia…» no deben guardarse como una enseñanza NUEVA (no existe «olvidar»)', { todo: 'BUG P0-D confirmado: taughtFact devuelve el texto de «Olvida la regla de una caja trae 24 UND» como lección (TEACH_FACT + dígito). Resultado: pedir olvidar AÑADE una entrada. Arreglo mínimo: excluir verbos olvida/borra/elimina/corrige/usa y, aparte, implementar borrado (diseño).' }, () => {
  for (const t of ['Olvida la regla de una caja trae 24 UND', 'Corrige tu recuerdo de una caja trae 24 UND', 'Usa mi preferencia de una caja trae 24 UND en otra sesión'])
    assert.equal(taughtFact(t), null, t);
});

test('A5-G7) preferencias sin número («vendo por display», «prefiero precios terminados en .50») dichas con «Recuerda…» deben poder guardarse', { todo: 'Brecha P0-D: taughtFact exige un dígito/verbo de equivalencia; «Recuerda para mañana que vendo por display» devuelve null (se pierde en silencio y el asistente igual responde «anotado»).' }, () => {
  assert.ok(taughtFact('Recuerda para mañana que vendo por display.'));
});

test('A5-G8) lo que SÍ funciona: preguntas, costos dichos («me cuesta 9.20») y frases sin dato no se guardan como lección', () => {
  for (const t of ['¿Cuántas trae la caja?', '¿Qué aprendiste sobre una caja trae 24 UND ayer?', 'el pollo ahora me cuesta 9.20', 'hola, buenos días', '']) assert.equal(taughtFact(t), null, t);
  for (const t of ['una caja trae 24 UND', 'la caja de gaseosa trae 12', 'Recuerda que uso stock mínimo 10', 'Recuerda para mañana que prefiero precios terminados en .50']) assert.ok(taughtFact(t), t);
});
