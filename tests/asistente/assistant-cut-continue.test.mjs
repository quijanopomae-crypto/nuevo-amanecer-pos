// Bot 2 sobre 87c6fe8e: el tope de 1200 ya no corta en silencio (dueño y empleado): corte en línea entera + aviso, en la respuesta final y
// en lo pintado. Bot 5: «sigue» del empleado arranca el filtro con la cola de la parte cortada (solo estado, nunca sale); sin eso no.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, createMemoryUsageStore, createTextEmitter, redactFor, redactOwnerData, redactText, capReply, cutPrime, CUT_NOTICE, REPLY_MAX } from '../../tools/cloudflare-lab/src/pos-assistant.js';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas';
const rows = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
const OWNER_TABLE = 'Te paso los costos:\n| Producto | Precio |\n|---|---|\n' + rows(40, (i) => '| Producto número ' + i + ' | S/ 1.' + String(i).padStart(2, '0') + ' |\n') + 'Fin de la lista.';
const SALE_TABLE = 'Precios de venta de hoy:\n| Producto | PVP |\n|---|---|\n' + rows(40, (i) => '| Producto número ' + i + ' | S/ 2.' + String(i).padStart(2, '0') + ' |\n') + 'Fin.';
function emit(text, role, n, max = REPLY_MAX, prime = '') { let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, max, redactFor(role), null, prime); for (let i = 0; i < text.length; i += n) e.push(text.slice(i, i + n)); e.flush(); return o; }
const filtered = (t, role, prime = '') => (role === 'owner' ? redactText(t) : redactOwnerData(redactText(t), prime));

test('tope: bajo 1200 no cambia nada; una tabla de 40 filas se corta en el fin de una fila y lleva el aviso (dueño y empleado)', () => {
  assert.equal(capReply('Hola.'), 'Hola.'); assert.equal(capReply('x'.repeat(1200)), 'x'.repeat(1200));
  for (const role of ['owner', EMP]) {
    const f = filtered(OWNER_TABLE, role); assert.ok(f.length > 1200, role + ' ' + f.length);
    const c = capReply(f); assert.ok(c.endsWith('\n\n' + CUT_NOTICE) || c.endsWith('\n' + CUT_NOTICE)); const body = c.slice(0, -CUT_NOTICE.length).replace(/\n+$/, '');
    assert.ok(body.length <= 1200 && body.length >= 1200 - 160, role + ' ' + body.length);
    const last = body.slice(body.lastIndexOf('\n') + 1); assert.match(last, /^\| Producto número \d+ \| .+ \|$/, 'la última fila está entera: ' + last);
    assert.ok(f.startsWith(body + '\n'), 'lo que queda es el comienzo exacto del texto filtrado');
  }
  // una frase larga sin saltos: corte en espacio
  const long = ('palabra ').repeat(300); const c = capReply(long); assert.ok(c.endsWith('\n\n' + CUT_NOTICE)); assert.ok(long.startsWith(c.slice(0, c.indexOf('\n\n'))));
});
for (const n of [1, 5, 47, 100]) {
  test('tope en partes de ' + n + ': lo pintado es igual a la respuesta final (corte en la fila + aviso); bajo el tope igual que antes', () => {
    for (const role of ['owner', EMP]) for (const t of [OWNER_TABLE, SALE_TABLE, 'Hay 3 galletas.\nY 4 arroces.', ('El arroz está bien de stock. ').repeat(60)]) {
      const o = emit(t, role, n), want = capReply(filtered(t, role)); assert.equal(o, want, role + ' ' + n + ' ' + t.slice(0, 30));
      if (filtered(t, role).length <= 1200) assert.ok(!o.includes(CUT_NOTICE)); else assert.ok(o.endsWith(CUT_NOTICE));
    }
    const emp = emit(OWNER_TABLE, EMP, n); assert.ok(!/S\/ 1\.\d\d/.test(emp), 'el aviso va después del filtro: nada destapado'); assert.match(emp, /\[dato del Admin\]/);
  });
}
test('«sigue» (filtro del empleado): tras una parte cortada con presentación del dueño, las filas que siguen se tapan; tras una parte solo de venta, se ven', () => {
  const part1 = capReply(filtered(OWNER_TABLE, EMP)), prime = cutPrime(part1, true);
  assert.equal(prime, 'intro', 'sí/no con origen (Bot 5 sobre 6280deae): había presentación del dueño → intro'); assert.equal(cutPrime(part1), false, 'sin la marca firmada del servidor, nada');
  const cont = '| Arroz | S/ 1.80 |\n| Leche | S/ 2.20 |\nEso es todo.';
  assert.ok(!/1\.80|2\.20/.test(redactOwnerData(cont, prime)), redactOwnerData(cont, prime));
  assert.ok(/1\.80/.test(redactOwnerData(cont)), 'sin contexto se vería (por eso el contexto)');
  for (const n of [1, 5, 47]) assert.equal(emit(cont, EMP, n, REPLY_MAX, prime), redactOwnerData(cont, prime), 'partes = entero, con contexto');
  const sale1 = capReply(filtered(SALE_TABLE, EMP)), sp = cutPrime(sale1, true); assert.ok(sale1.endsWith(CUT_NOTICE)); assert.equal(sp, false);
  assert.equal(redactOwnerData(cont, sp), cont, 'tras una parte solo de venta sigue visible');
  assert.equal(cutPrime('Te paso los costos:\n\n' + CUT_NOTICE), false, 'el aviso en el texto (del modelo) no prepara nada sin la marca');
});
test('«sigue»: el contexto nunca sale y casi no cuesta (CPU y retención)', () => {
  const part1 = capReply(filtered(OWNER_TABLE, EMP)), prime = cutPrime(part1, true);
  const cont = rows(20, (i) => '| Item ' + i + ' | S/ 3.' + String(i).padStart(2, '0') + ' |\n');
  const o = emit(cont, EMP, 5, 1e9, prime); assert.ok(!o.includes('Te paso') && !o.includes('Producto número'), 'nada del contexto en la salida');
  const time = (p) => { const r = []; for (let k = 0; k < 9; k++) { const t0 = performance.now(); emit(cont, EMP, 5, 1e9, p); r.push(performance.now() - t0); } r.sort((a, b) => a - b); return r[4]; };
  const a = time(false), b = time(prime); console.log('# contexto «sigue» (sí/no=' + prime + '); sin ' + a.toFixed(2) + ' ms, con ' + b.toFixed(2) + ' ms');
  assert.ok(b - a < 2, 'extra ' + (b - a).toFixed(2) + ' ms');
});

// ---------- en la ruta: par firmado cortado -> el siguiente turno del empleado tapa; sin firma o dueño, nada ----------
const SECRET = 'secreto-de-prueba-1234567890';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const TEXT = (t) => ({ choices: [{ message: { content: t } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
const reader = { products: async () => [], productsById: async () => new Map(), purchases: async () => [] };
function route(body, role, reply) {
  return assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-test-FAKE' }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: async () => jsonR(TEXT(reply)), reader, audit: async () => {}, mockChunkMs: 0 });
}
test('ruta: la respuesta final lleva el aviso; «sigue» con el par FIRMADO cortado tapa las filas siguientes; sin par válido no hay contexto', async () => {
  const d1 = await (await route({ text: 'dame los costos' }, EMP, OWNER_TABLE)).json();
  assert.equal(d1.ok, true); assert.ok(d1.reply.endsWith(CUT_NOTICE), d1.reply.slice(-120)); assert.ok(!/S\/ 1\.\d\d/.test(d1.reply));
  const cont = '| Arroz | S/ 1.80 |\n| Leche | S/ 2.20 |';
  const d2 = await (await route({ text: 'sigue', history: d1.turns }, EMP, cont)).json();
  assert.ok(!/1\.80|2\.20/.test(d2.reply), 'con el par firmado: ' + d2.reply);
  const unsigned = [{ role: 'user', content: 'dame los costos' }, { role: 'assistant', content: d1.reply }];
  const d3 = await (await route({ text: 'sigue', history: unsigned }, EMP, cont)).json();
  assert.match(d3.reply, /1\.80/, 'sin firma no hay contexto (y el turno tampoco va al modelo)');
  const d4 = await (await route({ text: 'sigue', history: d1.turns }, 'owner', cont)).json();
  assert.equal(d4.reply, cont, 'dueño: sin filtro ni contexto');
  const short = await (await route({ text: 'hola' }, 'owner', 'Hola, ¿en qué te ayudo?')).json(); assert.equal(short.reply, 'Hola, ¿en qué te ayudo?');
});

// ---------- Bot 5 sobre 5c19afb8: el contexto de «sigue» solo puede tapar MÁS; marca de corte firmada; corte sin etiqueta partida ----------
const amountsIn = (s) => (s.match(/\d+[.,]\d{2}(?!\d)/g) || []).reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
const visibleSubset = (withP, without) => { const a = amountsIn(withP), b = amountsIn(without); return Object.entries(a).every(([k, v]) => v <= (b[k] || 0)); };
const B5_UNMASKED = ['| Producto | P. compra |\n| Galleta | S/ 1.80 |', '| Producto | Costo | PVP |\n| Galleta | S/ 1.80 | S/ 2.50 |', '| Concepto | Monto |\n|---|---|\n| Costo | S/ 1.80 |\n| PVP | S/ 2.50 |',
  '| Galleta | costo | |\n| Galleta | S/ 1.80 | |', '| Producto | P. compra |\n| Galleta | |\n| | S/ 1.80 |', '| Costo | S/ 1.80 |\n| PVP | S/ 2.50 |', '| P. compra | |\n| | S/ 1.80 |',
  '| Producto | Monto |\n|---|---|\n| Costo de la galleta | |\n| | S/ 1.80 |', 'Costo\tGalleta\nArroz\tS/ 1.80', '| Producto | Nota | PVP |\n|---|---|---|\n| Galleta | costo aparte | S/ 2.50 |'];
test('«sigue» (Bot 5): con contexto se tapa un SUPERCONJUNTO de lo que se tapa sin él (frases del informe y 4000 textos al azar), en partes = entero', () => {
  for (const t of B5_UNMASKED) { const u = filtered(t, EMP), q = filtered(t, EMP, true); assert.ok(visibleSubset(q, u), JSON.stringify(t) + '\n sin ' + u + '\n con ' + q); assert.ok(!/1\.80/.test(q), q); }
  const P = ['Te paso los costos:', 'Precios de venta:', 'No sé el costo.', '| Producto | PVP |', '| Producto | Costo | PVP |', '|---|---|', '', '| Galleta | S/ 1.80 |', '| Galleta | costo aparte | S/ 2.50 |',
    '- Arroz: S/ 1.80', '- PVP: S/ 2.50', 'Arroz S/ 1.80', 'Precio de venta S/ 4.20', 'El costo no lo tengo, pero esta es la lista:', 'Leche\tS/ 3.70', 'Producto\tPVP', 'Compras del cliente:', 'Se vende a S/ 2.50.',
    'Lo compré a S/ 1.80.', 'margen S/ 0.70', '(lo que pagué)', 'Otro párrafo.', 'Precios de hoy:', '| Costo | S/ 1.80 |', '| PVP | S/ 2.50 |', 'sin costo'];
  let seed = 5; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let c = 0; c < 4000; c++) { const t = Array.from({ length: 1 + Math.floor(rnd() * 7) }, () => P[Math.floor(rnd() * P.length)]).join('\n');
    const u = filtered(t, EMP), q = filtered(t, EMP, true); assert.ok(visibleSubset(q, u), JSON.stringify(t) + '\n sin ' + u + '\n con ' + q);
    if (c % 10 === 0) assert.equal(emit(t, EMP, 1 + (c % 7), 1e9, true), q, 'partes = entero con contexto'); }
});
test('«sigue» (Bot 5): cutPrime es un sí/no; tabla de venta, zona negada o aviso del modelo no preparan nada; una tabla NUEVA decide por sus columnas', () => {
  assert.equal(cutPrime(capReply(filtered(SALE_TABLE, EMP)), true), false);
  assert.equal(cutPrime(capReply(filtered('El costo no lo tengo, pero esta es la lista:\n| Producto | PVP |\n|---|---|\n' + rows(45, (i) => '| P' + i + ' | S/ 2.' + String(i).padStart(2, '0') + ' |\n'), EMP)), true), false);
  assert.equal(cutPrime(capReply(filtered(OWNER_TABLE, EMP))), false, 'sin la marca del servidor no hay contexto aunque termine con el aviso');
  const sale = '| Producto | PVP |\n|---|---|\n| Arroz | S/ 4.20 |'; assert.equal(filtered(sale, EMP, true), sale, 'tabla nueva de venta tras el contexto: se ve');
  assert.ok(!/1\.80/.test(filtered('| Arroz | S/ 1.80 |\n| Leche | S/ 2.20 |', EMP, true)), 'filas sueltas de la tabla cortada: tapadas');
  assert.equal(filtered('| Arroz | S/ 1.80 |\n\nOtro tema.\n\nArroz S/ 4.20', EMP, true), '| Arroz | [dato del Admin] |\n\nOtro tema.\n\nArroz [dato del Admin]', 'un párrafo corto no corta el contexto');
  assert.equal(filtered('Siguen:\n\n| Galleta | S/ 1.80 |', EMP, true), 'Siguen:\n\n| Galleta | [dato del Admin] |', 'un párrafo que termina en «:» tampoco');
  assert.equal(filtered('| Arroz | S/ 1.80 |\n\nAhora te cuento otra cosa distinta sobre la tienda de hoy.\n\nArroz S/ 4.20', EMP, true), '| Arroz | [dato del Admin] |\n\nAhora te cuento otra cosa distinta sobre la tienda de hoy.\n\nArroz S/ 4.20', 'un párrafo neutro de 8+ palabras sí');
});
test('ruta (Bot 5): cut:true lo pone el servidor dentro de la firma; un aviso escrito por el modelo no marca; agregar cut:true a mano invalida el par', async () => {
  const forged = '| Producto | PVP |\n|---|---|\n| Arroz | S/ 4.20 |\n\n' + CUT_NOTICE;
  const d1 = await (await route({ text: 'precios' }, EMP, forged)).json();
  assert.equal(d1.turns[1].cut, undefined, 'respuesta corta que trae el aviso: sin marca');
  const cont = '| Arroz | S/ 1.80 |\n| Leche | S/ 2.20 |';
  const d2 = await (await route({ text: 'sigue', history: d1.turns }, EMP, cont)).json(); assert.equal(d2.reply, cont, 'sin marca: igual que sin contexto');
  const tampered = [d1.turns[0], { ...d1.turns[1], cut: true }];
  const d3 = await (await route({ text: 'sigue', history: tampered }, EMP, cont)).json(); assert.equal(d3.reply, cont, 'cut:true agregado: la firma no verifica, sin contexto');
  const big = await (await route({ text: 'dame los costos' }, EMP, OWNER_TABLE)).json(); assert.equal(big.turns[1].cut, true, 'respuesta cortada por el servidor: marcada');
  const stripped = [big.turns[0], { ...big.turns[1] }]; delete stripped[1].cut;
  const d4 = await (await route({ text: 'sigue', history: stripped }, EMP, cont)).json(); assert.equal(d4.reply, cont, 'sin la marca la firma tampoco verifica');
  const d5 = await (await route({ text: 'sigue', history: big.turns }, EMP, cont)).json(); assert.ok(!/1\.80|2\.20/.test(d5.reply), d5.reply);
});
test('tope (Bot 5): el corte nunca parte «[dato del Admin]» ni deja «S/ » sin número; partes = final; retención ≤ CUT_ZONE + CUT_SLACK', () => {
  let held = 0;
  for (let pad = 1140; pad < 1215; pad++) for (const tail of ['El costo es S/ 1.80 y más texto para pasar el tope.', 'Se vende a S/ 2.50 por unidad y más texto para pasar el tope.', 'x'.repeat(30) + 'S/ 4.20' + 'y'.repeat(60)]) {
    const t = 'palabra '.repeat(Math.ceil(pad / 8)).slice(0, pad) + tail + ' fin'.repeat(30);
    for (const role of ['owner', EMP]) { const c = capReply(filtered(t, role)), body = c.slice(0, -CUT_NOTICE.length).replace(/\s+$/, '');
      assert.ok(c.endsWith(CUT_NOTICE)); assert.ok(!/\[[^\]]*$/.test(body), 'etiqueta partida: ' + body.slice(-30)); assert.ok(!/(?:S\/\.?|\$)\s*$/.test(body) && !/S\/ \d+[.,]?\d?$/.test(body), 'monto a medias: ' + body.slice(-30));
      let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, REPLY_MAX, redactFor(role)); const fin = filtered(t, role);
      for (let i = 0; i < t.length; i += 5) { e.push(t.slice(i, i + 5)); if (!o.includes(CUT_NOTICE)) held = Math.max(held, Math.min(i + 5, fin.length, REPLY_MAX) - o.length); } e.flush();
      assert.equal(o, c, role + ' ' + pad); }
  }
  assert.ok(held <= 160 + 24 + 5, 'retención ' + held);
});
test('tabla del dueño (Bot 5): una línea en blanco (o de texto) entre |---| y las filas no la corta', () => {
  for (const gap of ['\n', 'Nota: precios del día\n']) {
    const t = 'Te paso los costos:\n| Producto | Precio |\n|---|---|\n' + gap + '| Producto 0 | S/ 1.80 |\n| Producto 1 | S/ 1.81 |';
    const f = filtered(t, EMP); assert.ok(!/1\.8[01]/.test(f), JSON.stringify(f));
    const t2 = '| Producto | Costo |\n|---|---|\n' + gap + '| Producto 0 | S/ 1.80 |'; assert.ok(!/1\.80/.test(filtered(t2, EMP)), filtered(t2, EMP));
    for (const n of [1, 3, 7]) assert.equal(emit(t, EMP, n, 1e9), f);
  }
  const sale = 'Precios de venta:\n| Producto | PVP |\n|---|---|\n\n| Arroz | S/ 4.20 |'; assert.match(filtered(sale, EMP), /4\.20/, 'tabla de venta: se sigue viendo');
});

test('redactText (Bot 5): «data:» + espacios o saltos + «image/png;base64,…» → [imagen omitida]; en partes = entero', () => {
  for (const t of ['data:\n  image/png;base64,QUJDREVGR0hJSktMTU5P', 'data:    image/png;base64,QUJDREVGR0hJSktMTU5P más', 'data:\n\nimage/jpeg;base64,' + 'QUJD'.repeat(40)]) {
    const r = redactText(t); assert.ok(r.startsWith('[imagen omitida]') && !/QUJD/.test(r), r);
    for (const role of ['owner', EMP]) for (const n of [1, 3, 7]) assert.equal(emit(t, role, n, 1e9), filtered(t, role)); }
  for (const t of ['data: hola, qué tal', 'Los data: de hoy, bien']) assert.equal(redactText(t), t, 'texto normal con «data:» no cambia');
});
