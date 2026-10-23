// Bot 3 sobre c97c41ca (y la sala): filtro en partes INCREMENTAL con la misma salida que el filtro del texto entero, correo lineal,
// el empleado ve el texto sin esperar (solo se tapa el monto), pedido a DeepSeek cortado si el celular se va o pasa el tope,
// relojes del celular que cuentan la subida de la foto, foto de empleado rechazada sin subir. Y lo de Bot 4 (puntitos, «Pensando»
// tras un reset, «unid..», contraste, último párrafo) y Bot 2 (nombres de productos que no son datos del dueño).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore, createTextEmitter, LABEL_TAIL, redactFor, redactText, redactOwnerData, OWNER_RETRO, FIRST_TEXT_MIN, capReply } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { runAssistantQuery } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = new TextEncoder();
const EMP = 'empleado:consultas';
const clean = (t) => t.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, ' ');
function stream(text, role, sizes) { // sizes: número fijo o función que da el tamaño del próximo trozo
  const out = []; const e = createTextEmitter((d) => out.push(d), 1200, redactFor(role)); const marks = [];
  for (let i = 0; i < text.length;) { const n = typeof sizes === 'function' ? sizes() : sizes; e.push(text.slice(i, i + n)); i += n; marks.push([i, out.filter((d) => d.t).map((d) => d.t).join('').length]); }
  e.flush(); return { text: out.filter((d) => d.t).map((d) => d.t).join(''), marks, events: out };
}
const full = (text, role) => capReply(redactFor(role)(clean(text))); // tope de 1200 con aviso (Bot 2), sobre el texto ya filtrado

// ---------- 1. correo ----------
// Estable con la máquina cargada: 7 corridas por caso; la MÁS RÁPIDA debe bajar de 25 ms (lo que cuesta de verdad, sin picos de carga)
// y la mediana de 80 ms. La versión vieja (cuadrática) tardaba ~1,9 s: falla igual con holgura.
test('1) correo: 50 KB de dígitos, letras o «@» seguidos: la corrida más rápida de 7 baja de 25 ms y la mediana de 80 ms (antes ~1,9 s); los correos normales se tapan', () => {
  for (const t of ['7'.repeat(50000), 'b'.repeat(50000), ('a'.repeat(70) + '@').repeat(700), 'x@' + 'a'.repeat(50000), 'x@' + 'a.'.repeat(25000)]) {
    redactText(t); const runs = [];
    for (let i = 0; i < 7; i++) { const t0 = performance.now(); redactText(t); runs.push(performance.now() - t0); }
    runs.sort((a, b) => a - b);
    assert.ok(runs[0] < 25, t.slice(0, 12) + '…: más rápida ' + runs[0].toFixed(1) + ' ms');
    assert.ok(runs[3] < 80, t.slice(0, 12) + '…: mediana ' + runs[3].toFixed(1) + ' ms');
  }
  assert.equal(redactText('Escribe a juan.perez+1@gmail.com o a ventas@botica-na.com.pe hoy'), 'Escribe a [correo oculto] o a [correo oculto] hoy');
});

// ---------- 2. propiedad: en partes = texto entero ----------
const SRC = readdirSync(new URL('./', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => readFileSync(new URL('./' + f, import.meta.url), 'utf8')).join('\n');
const LITS = [...SRC.matchAll(/'((?:[^'\\\n]|\\.){8,300})'|«([^»\n]{6,300})»/g)].map((x) => (x[1] ?? x[2]).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\'/g, "'"));
const TRICKY = ['juan.perez+1@gmail.com', '987 654 321', '+51 987-654-321', 'DNI 12345678', 'RUC N° 20123456789', 'clave es abc123', 'api key sk-123456', 'data:image/png;base64, QUJDREVGR0hJSktMTU5P QUJD QQ==',
  '| Producto | Costo | Precio |\n|---|---|---|\n| Arroz | 1.80 | 2.50 |\n', 'Producto\tCosto\nArroz\t1.80\n', 'El costo de 2 unidades… es S/ 3.60', 'S/ 1.80 es el costo', 'costo, precio S/ 1.80',
  'precio de venta S/ 2.50, costo S/ 1.80', 'lo compré a S/ 1.10', 'el proveedor nos lo vende a S/ 1.20', '10 por ciento de margen', 'Arroz Costeño 5 kg S/ 4.20', 'Distribuidora Inversiones Lima', '\x01\x02',
  'aprox. S/ 1.80', 'x12', 'S/ ', '1.80 ', 'costo ', 'precio ', 'de ', 'venta ', 'compra ', 'nos ', 'el ', '. ', ', ', '\n', ' ', '7'.repeat(30)];
const ALPHA = ['a', 'e', 'o', 's', 'S', '/', ' ', ' ', '.', ',', '1', '8', '0', '|', '\n', '\t', '@', '%', 'c', 'P', 'N', '-', ':'];
test('2) propiedad: con cortes al azar (1, 2-6, hasta 60 caracteres) lo enviado es EXACTAMENTE el filtro del texto entero, dueño y empleado', () => {
  let seed = 20261017; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); const pick = (a) => a[Math.floor(rnd() * a.length)];
  let cases = 0;
  for (let i = 0; i < 1500; i++) {
    let text = '';
    if (i % 3 === 2) { const n = 5 + Math.floor(rnd() * 120); for (let j = 0; j < n; j++) text += rnd() < 0.15 ? pick(TRICKY) : pick(ALPHA); }
    else { const parts = 1 + Math.floor(rnd() * 12); for (let j = 0; j < parts; j++) text += (rnd() < 0.5 ? pick(LITS) : pick(TRICKY)) + pick(['', ' ', '\n', '. ', ', ']); }
    for (const role of ['owner', EMP]) {
      const mode = rnd(), size = () => (mode < 0.3 ? 1 : mode < 0.6 ? 1 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 60));
      assert.equal(stream(text, role, size).text, full(text, role), role + ' ' + JSON.stringify(text)); cases++;
    }
  }
  assert.ok(cases >= 3000 && LITS.length > 500, 'casos de fuga de las otras pruebas incluidos: ' + LITS.length);
});

// ---------- 3. Bot 5: el monto llega en un trozo posterior ----------
for (const n of [1, 2, 47, 48, 49, 100]) {
  test('3) trozos de ' + n + ': «El costo de 2 unidades… es S/ 3.60» con el monto en un trozo posterior: nunca sale el monto; igual al texto entero', () => {
    for (const pre of ['', 'Hola. ', 'x'.repeat(40) + ' ', 'Revisé el Arroz Costeño y la Leche Gloria. ']) {
      const txt = pre + 'El costo de 2 unidades… es S/ 3.60. Hay 40 unidades.';
      const s = stream(txt, EMP, n);
      assert.ok(!s.text.includes('3.60') && !s.events.some((d) => d.t && /3\.6|3\.$/.test(d.t)), JSON.stringify(s.events));
      assert.equal(s.text, full(txt, EMP)); assert.ok(s.text.includes('El costo de 2 unidades… es [dato del Admin]. Hay 40 unidades.'), s.text);
      assert.equal(stream(txt, 'owner', n).text, txt);
    }
  });
}

// ---------- 4. sala: etiquetas de venta, monto antes de la palabra, tope ----------
const ROOM = [
  ['costo, precio S/ 1.80', 'costo, precio [dato del Admin]'],
  ['El costo no lo tengo, pero el precio de venta es S/ 2.50', 'El costo no lo tengo, pero el precio de venta es S/ 2.50'],
  ['S/ 1.80 es el costo', '[dato del Admin] es el costo'],
  ['S/ 1.80 de costo y S/ 2.50 de precio de venta.', '[dato del Admin] de costo y [dato del Admin] de precio de venta.'],
  ['precio de venta S/ 2.50, costo S/ 1.80', 'precio de venta S/ 2.50, costo [dato del Admin]'],
  ['el costo es S/ 1.80, pero el precio de venta es S/ 2.50', 'el costo es [dato del Admin], pero el precio de venta es S/ 2.50'],
  ['costo S/ 1.80 y venta S/ 2.50', 'costo [dato del Admin] y venta S/ 2.50'],
  ['El costo es S/ 1.80. Se vende a S/ 2.50, lo vendemos a S/ 2.40, vendo a S/ 2.30, PVP S/ 2.60, P. venta S/ 2.70.', 'El costo es [dato del Admin]. Se vende a S/ 2.50, lo vendemos a S/ 2.40, vendo a S/ 2.30, PVP S/ 2.60, P. venta S/ 2.70.'],
  ['El costo es S/ 1.80 y el proveedor se lo vende a S/ 1.50', 'El costo es [dato del Admin] y el proveedor se lo vende a [dato del Admin]'],
  ['Arroz S/ 2.50; el costo lo ve el dueño.', 'Arroz S/ 2.50; el costo lo ve el dueño.']
];
for (const n of [1, 2, 5, 47, 48, 49, 100]) {
  test('4) trozos de ' + n + ': solo el monto se tapa; etiquetas de venta (precio de venta, P. venta, PVP, se vende a, (lo) vendemos a, vendo a); «precio» solo no', () => {
    for (const [inp, want] of ROOM) { assert.equal(redactOwnerData(inp), want, inp); assert.equal(stream(inp, EMP, n).text, want, n + ': ' + inp); }
  });
}
test('4) monto sin fin de frase: espera como mucho ' + OWNER_RETRO + ' caracteres y entonces se tapa (a prueba de fallas); con punto antes sale', () => {
  const longTail = 'S/ 4.20 cada uno ' + 'y es bueno '.repeat(20);
  assert.ok(redactOwnerData(longTail).startsWith('[dato del Admin] cada uno'));
  assert.ok(redactOwnerData('S/ 4.20 cada uno. ' + 'y es bueno '.repeat(20)).startsWith('S/ 4.20 cada uno.'));
  const s = stream(longTail, EMP, 5); assert.equal(s.text, redactOwnerData(longTail));
  const firstAt = s.marks.find(([, out]) => out > 0)[0]; assert.ok(firstAt <= 7 + OWNER_RETRO + 10 + LABEL_TAIL, 'sale al llegar al tope: ' + firstAt); // (#962, diseño simple) + LABEL_TAIL: la cola fija que nunca pasa a las etapas (una etiqueta partida entre trozos no sale) (+ 5: un trozo, la cola corre la decisión de la etapa)
});

// ---------- 5. Bot 2: nombres que no son datos del dueño ----------
test('5) nombres de productos y proveedores (Arroz Costeño, Galletas Costa, Margarina Primor, Distribuidora Inversiones Lima, Ganadero) se ven completos', () => {
  for (const t of ['Arroz Costeño 5 kg S/ 4.20, hay 12 en stock.', 'Galletas Costa S/ 1.50 (30 unidades)', 'Margarina Primor S/ 3.80, quedan 8.', 'Distribuidora Inversiones Lima trae el Ganadero a S/ 6.00 de precio de venta.',
    'Ganadero S/ 6.00, stock 4.', 'Costeño, Costa y Primor están a S/ 4.20, S/ 1.50 y S/ 3.80.']) {
    assert.equal(redactOwnerData(t), t, t); for (const n of [1, 3, 48]) assert.equal(stream(t, EMP, n).text, t, n + ': ' + t);
  }
  // palabras enteras: costo/costó/costos/cost/margen/ganancia/inversión/utilidad siguen contando
  for (const t of ['costo S/ 1.80', 'costó S/ 1.80', 'costos S/ 1.80', 'cost 1.80', 'margen 20%', 'ganancia S/ 2.00', 'inversión S/ 300', 'utilidad 15%', 'Arroz Costo S/ 1.80'])
    assert.ok(redactOwnerData(t).endsWith('[dato del Admin]'), t);
});

// ---------- 6. tiempos ----------
test('6) CPU: 4000 caracteres en trozos de 5 cuestan unos pocos ms en total (dueño y empleado), también con números largos o una línea sin punto', () => {
  const words = 'Hay arroz en la tienda y está bien de stock, el precio de venta es S/ 4.20 y tienes 40 unidades. El costo lo ve el dueño. ';
  const texts = { normal: words.repeat(40).slice(0, 4000), digitos: '7'.repeat(4000), sinPunto: ('el arroz cuesta S/ 4.20 y está bien de stock y ').repeat(90).slice(0, 4000) };
  for (const [name, t] of Object.entries(texts)) for (const role of ['owner', EMP]) {
    stream(t, role, 5); const t0 = performance.now(); const s = stream(t, role, 5); const ms = performance.now() - t0;
    assert.ok(ms < 20, name + ' ' + role + ': ' + ms.toFixed(2) + ' ms'); assert.equal(s.text, full(t, role));
  }
});
test('6) primera letra: el empleado recibe el primer texto en el mismo trozo que el dueño (texto sin montos) y nunca menos de ' + FIRST_TEXT_MIN + ' caracteres', () => {
  const t = 'Claro, te explico cómo revisar el stock del arroz en Inventario: entra a la ficha y mira la columna Stock. ';
  const o = stream(t, 'owner', 5), e = stream(t, EMP, 5);
  const fo = o.marks.find(([, x]) => x > 0), fe = e.marks.find(([, x]) => x > 0);
  assert.deepEqual(fe, fo); assert.ok(fe[1] >= FIRST_TEXT_MIN);
  // con una palabra del dueño delante, el texto que no es monto sigue saliendo (sin la pausa de antes)
  const k = 'El costo lo ve el dueño desde su teléfono; tú puedes ver el stock y el precio de venta en Inventario cuando quieras. ';
  const ke = stream(k, EMP, 5); ke.marks.forEach(([pushed, out]) => { if (pushed > 40) assert.ok(pushed - out <= 14 + LABEL_TAIL + 5, pushed + '/' + out); }); // (#962, diseño simple) + LABEL_TAIL: la cola fija que nunca pasa a las etapas (una etiqueta partida entre trozos no sale) (+ 5: un trozo, la cola corre la decisión de la etapa)
});

// ---------- 7. cortar el pedido a DeepSeek ----------
function endless(counter) {
  return async (_u, init) => { counter.signal = init.signal;
    return new Response(new ReadableStream({ async pull(c) { await sleep(10); counter.pulls++; c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'hola ' } }] }) + '\n\n')); }, cancel() { counter.cancelled = true; } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
}
const route = (fetch, deps = {}) => assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hola', stream: true }) }),
  { ASSISTANT_ENABLED: '1', DEEPSEEK_API_KEY: 'k', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef' }, { principalId: 'session:x', posRole: 'owner' },
  (d, s = 200) => new Response(JSON.stringify(d), { status: s }), { store: createMemoryUsageStore(), resolveRole: async () => 'owner', fetch, reader: { products: async () => [] }, audit: async () => {}, ...deps });
test('7) el celular se va (corta la lectura): el Worker corta el pedido a DeepSeek y deja de recibir', async () => {
  const c = { pulls: 0, cancelled: false }; const r = await route(endless(c));
  const rd = r.body.getReader(); await rd.read(); await sleep(120); await rd.cancel();
  await sleep(60); const at = c.pulls; await sleep(200);
  assert.ok(c.pulls <= at + 1, 'DeepSeek ya no recibe lecturas: ' + at + ' -> ' + c.pulls); assert.ok(c.cancelled, 'el cuerpo de DeepSeek se canceló'); assert.ok(c.signal.aborted, 'señal cortada');
});
test('7) tope del servidor (90 s, aquí 200 ms) contado desde que se leyó el cuerpo: corta DeepSeek y avisa upstream_timeout', async () => {
  const c = { pulls: 0, cancelled: false }; const t0 = Date.now(); const r = await route(endless(c), { maxStreamMs: 200 });
  const txt = await r.text(); const ms = Date.now() - t0;
  assert.match(txt, /event: error\ndata: \{"error":"upstream_timeout","status":504/); assert.ok(ms < 1500, ms + ' ms');
  const at = c.pulls; await sleep(150); assert.ok(c.pulls <= at + 1 && c.cancelled && c.signal.aborted);
});

// ---------- 8. celular: relojes con foto, tandas, foto de empleado ----------
test('8) foto en 3G lento: el reloj del primer trozo (10 s) y el tope suman el tiempo de subida; sin foto quedan igual', async () => {
  assert.equal(C.uploadMs(undefined), 0); assert.equal(C.uploadMs('x'.repeat(1200)), 100); assert.equal(C.uploadMs('x'.repeat(1.4e6)), Math.min(C.STREAM.uploadMaxMs, Math.ceil(1.4e6 / C.STREAM.uploadBps * 1000)));
  const slow = (delay) => async () => { await sleep(delay); return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('event: final\ndata: {"ok":true,"reply":"Listo"}\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }); };
  const big = 'x'.repeat(3600); // 300 ms de subida a 12 KB/s
  const ok = await C.streamChat(slow(250), 'u', { body: big }, { firstMs: 100, idleMs: 1000 }); assert.equal(ok.final.reply, 'Listo', 'con foto: espera la subida');
  await assert.rejects(C.streamChat(slow(250), 'u', { body: 'x' }, { firstMs: 100, idleMs: 1000 }), (e) => e.timeout === true, 'sin foto: el reloj de siempre');
});
test('8) lo que llega de golpe se pinta en tandas de ~48 caracteres (cortadas en espacio), sin perder ni repetir', () => {
  const writes = [], q = []; const p = C.createTextPainter((t) => writes.push(t), { minMs: 0, schedule: (cb) => q.push(cb) });
  const txt = 'El arroz está bien de stock y no hace falta pedir hoy, revisa la leche y el azúcar mañana temprano por favor gracias. ';
  p.push(txt); while (q.length) q.shift()();
  assert.equal(writes.join(''), txt); assert.ok(writes.length >= 2 && writes.slice(0, -1).every((w) => w.length <= 60 && w.endsWith(' ')), JSON.stringify(writes));
  const w2 = []; const p2 = C.createTextPainter((t) => w2.push(t), { minMs: 0, schedule: () => {} }); p2.push(txt); p2.finish(); assert.deepEqual(w2, [txt], 'finish pinta todo');
});
test('8) foto de un empleado: el celular avisa «Eso solo lo puede hacer el Admin.» al instante, sin subirla', () => {
  const UI = read('POS/js/modules/asistente/asistente-ui.js'); const sendFn = UI.slice(UI.indexOf('  async function send(text, image) {'), UI.indexOf('  // Comprime en el aparato'));
  const a = sendFn.indexOf("if (image && access && access.role !== 'owner') { addMsg('u', text || 'Foto'); errMsg('image_owner_only'); setState('error', 2600); return; }");
  assert.ok(a > 0 && a < sendFn.indexOf('reqInit(') && a < sendFn.indexOf('busy = true'), 'antes de armar o mandar el pedido');
  assert.equal(C.friendlyError('image_owner_only').msg, 'Eso solo lo puede hacer el Admin.');
});

// ---------- 9. Bot 4 ----------
test('9) Bot 4: puntitos mientras llega, «Pensando» tras un reset, contraste del aviso en modo oscuro, sin «unid..», último párrafo con texto', async () => {
  const UI = read('POS/js/modules/asistente/asistente-ui.js'), CSS = read('POS/css/asistente.css');
  assert.match(UI, /function ensureBubble\(\) \{[^\n]*thinking\.appendChild\(dots\); bubble\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(UI, /function backToThinking\(\) \{[^\n]*bubble\.textContent = 'Pensando'; bubble\.appendChild\(dots\);/); assert.match(UI, /onReset: backToThinking/);
  assert.match(CSS, /body\.dark \.na-asst-msg \.na-asst-incomplete\{color:#cbd5e1\}/);
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  assert.ok(ratio('#cbd5e1', '#10241a') >= 4.5, 'contraste ' + ratio('#cbd5e1', '#10241a').toFixed(2));
  const r = await runAssistantQuery({ products: async () => [{ id: 'a', nombre: 'Arroz', controla: true, stock: 5, min: 2, precio: 4.2 }, { id: 'b', nombre: 'Arroz Costeño', controla: true, stock: 3, min: 1, precio: 4.5 }] }, { tipo: 'stock_producto', producto: 'arroz' });
  assert.ok(!/\.\./.test(r.texto) && /unid\.$/.test(r.texto), r.texto);
  // último párrafo con texto (nota de Reporte de deuda, aviso vacío de Kardex) cuenta para el espacio de abajo
  const src = UI.slice(UI.indexOf('  function lastNote(pg, br) {'), UI.indexOf('  // Lo más bajo entre'));
  const box = (top, bottom, left = 0, right = 360) => ({ top, bottom, left, right, width: right - left, height: bottom - top });
  const mk = (text, r) => ({ textContent: text, getBoundingClientRect: () => r });
  const ps = [mk('Total de deudas', box(100, 120)), mk('Nota: los montos son referenciales.', box(600, 640)), mk('   ', box(700, 720)), mk('Sin movimientos', box(650, 670, 400, 500))];
  const lastNote = new Function('LAST_N', 'rootEl', 'getComputedStyle', 'pinned', src + '\nreturn lastNote;')(40, { contains: () => false }, () => ({ visibility: 'visible' }), () => false);
  const best = lastNote({ querySelectorAll: () => ps }, box(500, 700, 0, 360)); assert.equal(best.el, ps[1], 'el párrafo con texto más bajo, en la franja de la burbuja');
});

// ---------- 10. Bot 2 sobre c97c41ca: las 21 frases que dejaban ver el costo ----------
const BOT2 = ['El costo. S/ 1.80', 'costo\nS/ 1.80', 'Costo:\nS/ 1.80', 'costo; S/ 1.80', 'Inversión. S/ 7,797.00', 'Margen\n30%',
  'costo, aunque S/ 1.80', 'costo pero S/ 1.80', 'no es el costo sino S/ 1.80', 'costo mientras S/ 1.80',
  'costo sin PVP: S/ 1.80', 'costo, precio S/ 1.80', 'El costo y el precio: S/ 1.80.',
  'El costo, se vende S/ 1.80.', 'costo, vendemos S/ 1.80', 'costo vendo S/ 1.80',
  'S/ 1.80 es el costo.', 'S/ 1.80, ese es el costo.', 'P. de compra S/ 1.80',
  'costo (no de venta) S/ 1.80', 'costo aprox. S/ 1.80'];
const MORE2 = ['costo, pero S/ 1.80', 'costo, sino S/ 1.80', 'costo, mientras S/ 1.80', 'Margen Bruto 30%', 'Arroz Margen Bruto 30%', 'Ganancia Neta S/ 500', 'Leche Gloria Utilidad Total 15%'];
for (const n of [1, 2, 5, 47, 48, 49, 100]) {
  test('10) trozos de ' + n + ': las 21 frases de Bot 2 (punto, salto de línea, pero/aunque/sino/mientras, PVP negado, «se vende» sin «a», P. de compra…) quedan tapadas', () => {
    assert.equal(BOT2.length, 21);
    for (const t of [...BOT2, ...MORE2]) {
      const want = redactOwnerData(t); assert.ok(!/1\.80|7,797|30%|500|15%/.test(want) && want.includes('[dato del Admin]'), t + ' -> ' + want);
      assert.equal(stream(t, EMP, n).text, want, n + ': ' + t);
      assert.equal(stream(t, 'owner', n).text, t, 'el dueño ve todo');
    }
    // solo una etiqueta de venta explícita deja ver el monto
    for (const t of ['El costo no lo tengo, pero el precio de venta es S/ 2.50', 'El costo es S/ 1.80. Se vende a S/ 2.50', 'costo S/ 1.80, PVP S/ 2.50', 'costo S/ 1.80; lo vendemos a S/ 2.50'])
      assert.ok(stream(t, EMP, n).text.includes('2.50'), t);
  });
}

// ---------- 11. Frases de bodega del dueño (17-10) ----------
const BODEGA = ['Lo que pagué fue S/ 1.80 por unidad.', 'Pagué S/ 1.80 la caja.', 'Me salió a S/ 1.80 cada una.', 'me salio a S/ 1.80', 'Me sale a S/ 1.80 con el proveedor.',
  'Me costó S/ 1.80.', 'Nos costó S/ 18.00 el paquete.', 'Lo compré a S/ 1.80.', 'Lo traje a S/ 1.80 de Lima.', 'Mi costo es S/ 1.80.', 'lo que pague: S/ 1.80',
  'S/ 1.80, que es lo que me costó la caja.', 'S/ 1.80, que es lo que pagué.', 'S/ 1.80 me salió a mí.', 'Pagué. S/ 1.80'];
const BODEGA_OK = ['El cliente pagó S/ 2.50 en efectivo.', 'Pagó con Yape S/ 10.', 'El cliente pagó con Yape S/ 10 y se fue.', 'Que pague S/ 2.50 en caja.', 'Me sale aquí S/ 2.50 de precio de venta.',
  'Hay 12 en stock a S/ 2.50.', 'Lo traje ayer, está a S/ 2.50 de precio de venta.'];
for (const n of [1, 2, 47, 48, 49, 100]) {
  test('11) trozos de ' + n + ': «lo que pagué», «pagué», «me salió/sale a», «me/nos costó», «lo compré a», «lo traje a», «mi costo» (también con el monto antes) se tapan; «el cliente pagó», «pagó con Yape» se ven', () => {
    for (const t of BODEGA) {
      const want = redactOwnerData(t); assert.ok(!/1\.80|18\.00/.test(want) && want.includes('[dato del Admin]'), t + ' -> ' + want);
      assert.equal(stream(t, EMP, n).text, want, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t);
    }
    for (const t of BODEGA_OK) { assert.equal(redactOwnerData(t), t, t); assert.equal(stream(t, EMP, n).text, t, n + ': ' + t); }
  });
}

// ---------- 12. Bot 5 sobre f6061e85 ----------
const NAMES = ['Arroz Costeño 5 kg', 'Galletas Costa', 'Margarina Primor', 'Leche Gloria', 'Azúcar rubia', 'Aceite Primor'];
const rows = (n) => Array.from({ length: n }, (_, i) => '| ' + (i < 2 ? NAMES[i] : NAMES[i % NAMES.length] + ' ' + i) + ' | S/ ' + (1 + (i % 9)) + '.50 |').join('\n');
const LIST_WITH_HEAD = '| Producto | Precio |\n|---|---|\n' + rows(480);
const LIST_NO_HEAD = rows(480);
const LIST_TAB = 'Producto\tPrecio\n' + Array.from({ length: 480 }, (_, i) => (i < 2 ? NAMES[i] : NAMES[i % 6] + ' ' + i) + '\tS/ 2.50').join('\n');
// Sin el tope de 1200 del chat: la lista entera pasa por el mismo filtro (el texto en partes y el texto completo).
function streamBig(text, role, n) { const out = []; const e = createTextEmitter((d) => out.push(d), 1e6, redactFor(role)); const marks = [];
  for (let i = 0; i < text.length; i += n) { e.push(text.slice(i, i + n)); marks.push([i + n, out.filter((d) => d.t).map((d) => d.t).join('').length]); }
  e.flush(); return { text: out.filter((d) => d.t).map((d) => d.t).join(''), marks }; }
const OWNER_TABLE = '| Producto | Costo | P. compra | Inversión | Precio |\n|---|---|---|---|---|\n| Arroz Costeño | 3.00 | 3.10 | 300 | S/ 4.20 |\n| Galletas Costa | 1.00 | 1.10 | 50 | S/ 1.50 |';
const B5_MASK = ['costo, se vende a S/ 1.80', 'costo PVP S/ 1.80', 'Costo: PVP S/ 1.80', 'el costo, precio de venta S/ 1.80',
  'No tengo el costo exacto, pero fue S/ 1.80', 'No sé el costo de hoy; ayer fue S/ 1.80', 'No hay costo registrado, S/ 1.80', 'El costo. S/ 1.80',
  'El costo de este producto, que es el arroz extra superior de la marca que siempre traemos de Lima, es S/ 1.80',
  'Me costó, según la boleta del proveedor que vino el martes en la tarde con todo el pedido, S/ 1.80 la unidad'];
// «No tengo el costo. Hay 24 unidades a S/ 2.50» pasó a tapado (zona negada de dos frases, a prueba de fallas): ver sección 13.
const B5_SHOW = ['El costo no lo tengo, pero el precio de venta es S/ 2.50', 'No sé el costo.\nEl precio es S/ 2.50',
  'Desconozco el margen. El precio es S/ 2.50.', 'Sin dato de costo.\nPrecio S/ 2.50', 'El costo es S/ 1.80. Se vende a S/ 2.50', 'costo S/ 1.80, PVP S/ 2.50'];
for (const n of [1, 2, 47, 48, 49, 100]) {
  test('12) trozos de ' + n + ': lista de 480 filas con «Arroz Costeño»/«Galletas Costa» intacta (con y sin encabezado, tabulador); columnas Costo, P. compra, Inversión tapadas', () => {
    for (const t of [LIST_WITH_HEAD, LIST_NO_HEAD, LIST_TAB]) { assert.equal(redactOwnerData(t), t); assert.equal(streamBig(t, EMP, n).text, t, n + ': lista'); }
    const want = redactOwnerData(OWNER_TABLE);
    assert.ok(!/3\.00|3\.10|\b300\b|1\.00|1\.10|\| 50 \|/.test(want) && want.includes('S/ 4.20') && want.includes('Arroz Costeño') && want.includes('Galletas Costa'), want);
    assert.equal(stream(OWNER_TABLE, EMP, n).text, want);
  });
  test('12) trozos de ' + n + ': etiqueta de venta pegada a la palabra del dueño no deja ver; negación cierra al fin de frase (no con «;»); monto a >60 en la misma frase se tapa', () => {
    for (const t of B5_MASK) { const w = redactOwnerData(t); assert.ok(!w.includes('1.80') && w.includes('[dato del Admin]'), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); }
    for (const t of B5_SHOW) { const w = redactOwnerData(t); assert.ok(w.includes('2.50'), t + ' -> ' + w); assert.ok(!w.includes('1.80'), t); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); }
  });
}
test('12) la lista de 480 filas sale rápido y en partes (no espera la tabla entera)', () => {
  const t0 = performance.now(); const s = streamBig(LIST_WITH_HEAD, EMP, 48); const ms = performance.now() - t0;
  assert.equal(s.text, LIST_WITH_HEAD); assert.ok(ms < 2000, ms.toFixed(0) + ' ms');
  const firstAt = s.marks.find(([, out]) => out > 0)[0]; assert.ok(firstAt < 200, 'primer trozo a los ' + firstAt);
});

// ---------- 13. Zona negada (Bot 5 sobre 57d368c6): resto de la frase + la siguiente, solo etiqueta de venta deja ver ----------
const NEG_MASK = [['No sé el costo.\nEra S/ 1.80', ['1.80']], ['No tengo el costo. Hay 24 unidades a S/ 2.50', ['2.50']], ['No sé el costo.\n\nEra S/ 1.80 o S/ 1.90', ['1.80', '1.90']],
  ['No tengo el costo exacto, pero fue S/ 1.80', ['1.80']], ['No sé el costo de hoy; ayer fue S/ 1.80', ['1.80']], ['No hay costo registrado, S/ 1.80', ['1.80']],
  ['No sé el costo. Era S/ 1.80. El precio es S/ 2.50', ['1.80']], ['No sé el costo. El precio es S/ 2.50 y antes S/ 1.80', ['1.80']],
  // sin negación: etiqueta del dueño al final de la línea y el monto en la siguiente
  ['Costo unitario:\nS/ 1.80', ['1.80']], ['P. compra\n1.80', ['1.80']], ['Costo\n\nS/ 1.80', ['1.80']]];
const NEG_SHOW = [['No sé el costo.\nEl precio es S/ 2.50', '2.50'], ['Desconozco el margen. El precio es S/ 2.50.', '2.50'], ['Sin dato de costo.\nPrecio: S/ 2.50', '2.50'],
  ['No sé el costo.\nPVP S/ 2.50', '2.50'], ['No sé el costo. Se vende a S/ 2.50', '2.50'], ['No sé el costo. Era S/ 1.80. El precio es S/ 2.50', '2.50'],
  ['No sé el costo. Ok. Fin. Hay 3 a S/ 2.50', '2.50'], ['Costo desconocido, P. venta S/ 2.50', '2.50'], ['El costo no lo tengo, pero el precio de venta es S/ 2.50', '2.50']];
for (const n of [1, 2, 47, 48, 49, 100]) {
  test('13) trozos de ' + n + ': zona negada (resto de la frase + la siguiente) tapa todo monto salvo detrás de una etiqueta de venta o «precio»; etiqueta del dueño al final de línea tapa el monto de abajo', () => {
    for (const [t, hide] of NEG_MASK) { const w = redactOwnerData(t); for (const h of hide) assert.ok(!w.includes(h), t + ' -> ' + w); assert.ok(w.includes('[dato del Admin]')); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
    for (const [t, v] of NEG_SHOW) { const w = redactOwnerData(t); assert.ok(w.includes(v), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); }
  });
}

// ---------- 14. Bot 5 sobre f58a3947: «precio» suelto en la zona negada + filas de tabla ----------
// En la zona negada «precio» solo deja ver en formas pegadas al monto: «precio es/sería/será S/», «precio: S/», o «Precio S/» al
// empezar frase/línea. Con cualquier palabra en medio, o «, precio S/» en la misma frase, se tapa.
const PRECIO_MASK = [['No sé el costo. El precio al que lo traje: S/ 1.80', ['1.80']], ['No sé el costo. Precio anterior del proveedor S/ 1.80', ['1.80']],
  ['Precio anterior del proveedor S/ 1.80', ['1.80']], ['No sé el costo, precio S/ 1.80', ['1.80']], ['No sé el costo. Precio de compra S/ 1.80', ['1.80']],
  ['No sé el costo. El precio que pagué S/ 1.80', ['1.80']], ['No sé el costo. Precio del proveedor: S/ 1.80', ['1.80']], ['No tengo el costo. El precio de antes fue S/ 1.80', ['1.80']],
  ['No sé el costo.\nPrecio anterior S/ 1.80', ['1.80']], ['No sé el costo. El precio es S/ 2.50 y antes S/ 1.80', ['1.80']]];
const PRECIO_SHOW = [['No sé el costo. Precio: S/ 2.50', '2.50'], ['No sé el costo. El precio es S/ 2.50', '2.50'], ['No sé el costo.\nPrecio S/ 2.50', '2.50'],
  ['No sé el costo. El precio sería S/ 2.50', '2.50'], ['No sé el costo. El precio será 2.50 soles', '2.50'], ['No sé el costo. Precio S/ 2.50', '2.50']];
// Tablas (con o sin fila separadora, | o tabulador): la ventana del dueño y la zona negada no pasan a las celdas de la fila siguiente.
const ROW_SHOW = [['| Producto | Nota |\n| Arroz | no sé el costo |\n| Azúcar | S/ 2.50 |', '2.50'], ['| Producto | Nota |\n|---|---|\n| Arroz | no sé el costo |\n| Azúcar | S/ 2.50 |', '2.50'],
  ['Producto\tNota\nArroz\tno sé el costo\nAzúcar\tS/ 2.50', '2.50'], ['| Producto | Nota |\n| Arroz | costo pendiente |\n| Azúcar | S/ 2.50 |', '2.50'],
  ['Producto\tNota\nArroz\tcosto pendiente\nAzúcar\t2.50 soles', '2.50'], ['| Producto | Nota | Precio |\n| Arroz | sin datos de costo | |\n| Azúcar | ok | S/ 2.50 |', '2.50']];
const ROW_MASK = [['| Costo unitario |\n| S/ 1.80 |', ['1.80']], ['Producto\tNota\nArroz\tno sé el costo\nAzúcar\tcosto S/ 1.80', ['1.80']], ['Producto | Nota\nArroz | no sé el costo\nS/ 1.80', ['1.80']],
  ['| Producto | Nota |\n| Arroz | no sé el costo, S/ 1.80 |', ['1.80']], ['Producto\tNota\nArroz\tno sé el costo\nS/ 1.80\tAzúcar', ['1.80']], ['| Producto | Nota |\n| Arroz | el costo |\n| S/ 1.80 | x |', ['1.80']]];
for (const n of [1, 2, 47, 48, 49, 100]) {
  test('14) trozos de ' + n + ': zona negada: «precio» solo pegado al monto deja ver; con palabras en medio o «, precio S/» se tapa; la ventana y la zona no cruzan filas de tabla', () => {
    for (const [t, hide] of [...PRECIO_MASK, ...ROW_MASK]) { const w = redactOwnerData(t); for (const h of hide) assert.ok(!w.includes(h), t + ' -> ' + w); assert.ok(w.includes('[dato del Admin]')); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
    for (const [t, v] of [...PRECIO_SHOW, ...ROW_SHOW]) { const w = redactOwnerData(t); assert.ok(w.includes(v), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); }
  });
}

// ---------- 15. Bot 5 FALLA sobre 7150d291 (+ Bot 4): título del dueño antes de la tabla, «Precio S/» con dueño detrás, frases nuevas ----------
// Una palabra del dueño (o zona negada) en la frase/línea JUSTO antes de una tabla tapa todos sus montos salvo las columnas con encabezado
// de venta (PVP, P. venta, Precio de venta, Precio venta, Venta); sin encabezado, todos. Párrafos más atrás no cuentan.
const T15_MASK = [
  ['Te paso los costos:\n\n| Producto | Monto |\n|---|---|\n| Galleta | S/ 1.80 |\n| Arroz | S/ 3.10 |', ['1.80', '3.10']],
  ['El costo de cada uno:\n| Producto | Monto |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']],
  ['Te paso los costos:\n| Producto | Monto |\n| Galleta | S/ 1.80 |\n| Arroz | S/ 3.10 |', ['1.80', '3.10']],
  ['Costo\tGalleta\nArroz\tS/ 1.80', ['1.80']],
  ['Costos:\n| Galleta | S/ 1.80 |\n| Arroz | S/ 3.10 |', ['1.80', '3.10']],
  ['Costos de compra\nGalleta\tS/ 1.80\nArroz\tS/ 3.10', ['1.80', '3.10']],
  ['No sé el costo.\nAquí la lista:\n| Producto | Monto |\n| Galleta | S/ 1.80 |\n| Arroz | S/ 3.10 |', ['1.80', '3.10']],
  ['Te paso costo y precio:\n| Producto | Costo | PVP |\n|---|---|---|\n| Galleta | S/ 1.20 | S/ 1.80 |', ['1.20']],
  ['Lo que pagué por cada uno:\n| Galleta | S/ 1.80 |\n| Arroz | S/ 3.10 |\n| Azúcar | S/ 2.90 |', ['1.80', '3.10', '2.90']],
  // «Precio S/» en la zona negada espera el fin de su frase (y un salto de línea): dueño detrás lo tapa
  ['No sé el costo.\nPrecio S/ 1.80 (lo que pagué)', ['1.80']], ['No sé el costo.\nPrecio: S/ 1.80, lo que me costó', ['1.80']],
  ['No sé el costo.\nPrecio S/ 1.80\n(lo que pagué)', ['1.80']], ['No sé el costo. El precio es S/ 1.80, lo que me costó', ['1.80']],
  // frases nuevas del dueño
  ['Pagamos S/ 1.80', ['1.80']], ['Nos salió a S/ 1.80', ['1.80']], ['nos salio a 1.80 soles', ['1.80']], ['Lo conseguí a S/ 1.80', ['1.80']], ['lo consegui a S/ 1.80 la caja', ['1.80']]];
const T15_SHOW = [
  ['Te paso costo y precio:\n| Producto | Costo | PVP |\n|---|---|---|\n| Galleta | S/ 1.20 | S/ 1.80 |', ['1.80']],
  ['El costo no lo tengo, pero esta es la lista:\n| Producto | P. venta |\n|---|---|\n| Galleta | S/ 1.80 |\n| Arroz | S/ 3.10 |', ['1.80', '3.10']],
  ['Te paso los costos:\n| Producto | Venta | Precio venta | Precio de venta |\n| Galleta | S/ 2.00 | S/ 2.10 | S/ 2.20 |', ['2.00', '2.10', '2.20']],
  ['El costo es alto este mes.\n\nOtra cosa. Aquí la lista de precios:\n| Producto | PVP |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']],
  // 17-10: una línea en blanco + título propio de precios corta la presentación del dueño (vuelve a verse, como en 1c17310c)
  ['El costo subió.\n\nPrecios de hoy:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']],
  ['| Costo | S/ 1.80 |\n| PVP | S/ 2.50 |', ['PVP', '2.50']], ['| Producto | Costo |\n|---|---|\n| Galleta | S/ 1.20 |\n| x | PVP |', ['PVP']],
  ['No sé el costo.\nPrecio S/ 2.50\nGracias', ['2.50']], ['No sé el costo. Precio: S/ 2.50. Lo que pagué no lo sé.', ['2.50']],
  ['Pagamos con Yape y salió bien, PVP S/ 2.50', ['2.50']], ['El cliente pagó S/ 2.50', ['2.50']],
  ['Lista:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |\n| Arroz | costo pendiente |\n| Azúcar | S/ 2.50 |', ['1.80', '2.50']]];
for (const n of [1, 2, 47, 48, 49, 100]) {
  test('15) trozos de ' + n + ': título del dueño justo antes de la tabla tapa sus montos (salvo columnas de venta); «Precio S/» con dueño detrás se tapa; pagamos/nos salió a/lo conseguí a; «PVP» bajo «Costo» no se tapa', () => {
    for (const [t, hide] of T15_MASK) { const w = redactOwnerData(t); for (const h of hide) assert.ok(!w.includes(h), t + ' -> ' + w); assert.ok(w.includes('[dato del Admin]')); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
    for (const [t, vs] of T15_SHOW) { const w = redactOwnerData(t); for (const v of vs) assert.ok(w.includes(v), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
  });
}
test('15) los nombres de la tabla se quedan: con título del dueño solo salen los montos («Galleta», «Arroz», «Producto», «Monto» visibles)', () => {
  const w = redactOwnerData('Te paso los costos:\n| Producto | Monto |\n|---|---|\n| Galleta | S/ 1.80 |\n| Arroz | S/ 3.10 c/u |');
  assert.equal(w, 'Te paso los costos:\n| Producto | Monto |\n|---|---|\n| Galleta | [dato del Admin] |\n| Arroz | [dato del Admin] c/u |');
});

// ---------- 16. Bot 5 sobre 1c17310c (+ Bot 3, Bot 4): 3 frases antes de tabla/lista, venta con dueño detrás, verbos, encabezados, retención ----------
const T16_MASK = [
  ['Te paso los costos.\nAquí va:\n| Producto | Monto |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']], ['Te paso los costos. Aquí va:\n| Producto | Monto |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']],
  ['Te paso los costos.\n\nAquí va.\nMira:\n| Producto | Monto |\n| Galleta | S/ 1.80 |', ['1.80']],
  ['No sé el costo.\nPVP S/ 1.80, lo que me costó', ['1.80']], ['| PVP | S/ 1.80 (costo) |', ['1.80']], ['No sé el costo. P. venta S/ 1.80 (lo que pagué)', ['1.80']],
  ['lo conseguimos a S/ 1.80', ['1.80']], ['la conseguí a S/ 1.80', ['1.80']], ['los conseguimos a 1.80 soles', ['1.80']], ['nos sale a S/ 1.80', ['1.80']], ['me sale a S/ 1.80', ['1.80']],
  ['me salió a S/ 1.80', ['1.80']], ['nos salieron a S/ 1.80 cada una', ['1.80']], ['te salió a S/ 1.80', ['1.80']], ['lo compraste a S/ 1.80', ['1.80']], ['las trajimos a S/ 1.80', ['1.80']],
  ['No sé el costo.\nPrecio S/ 1.80\n\n(lo que pagué)', ['1.80']], ['No sé el costo.\nPrecio S/ 1.80\n(lo que pagué)', ['1.80']],
  ['Te paso los costos:\n| Producto | Costo de venta | Venta (costo) | P. venta / costo |\n|---|---|---|---|\n| Galleta | S/ 1.80 | S/ 1.90 | S/ 2.00 |', ['1.80', '1.90', '2.00']],
  // listas tras una presentación del dueño (Bot 5)
  ['Te paso los costos:\n- Galleta: S/ 1.80\n- Arroz: S/ 3.10', ['1.80', '3.10']], ['Lo que pagué:\n1. Galleta S/ 1.80\n2. Arroz S/ 3.10', ['1.80', '3.10']],
  ['Te paso los costos:\n1) Galleta S/ 1.80\n2) Arroz S/ 3.10', ['1.80', '3.10']], ['Te paso los costos:\n* Galleta S/ 1.80\n• Arroz S/ 3.10', ['1.80', '3.10']],
  ['Te paso los costos:\n\n- Galleta: S/ 1.80\n\n- Arroz: S/ 3.10', ['1.80', '3.10']], ['Te paso los costos:\n- PVP: S/ 2.50 (lo que pagué)', ['2.50']],
  ['Costos de compra\nGalleta\tS/ 1.80\nArroz\tS/ 3.10', ['1.80', '3.10']],
  // 17-10: con una columna del dueño en la misma tabla, «Precio» solo se tapa (antes se veía)
  ['Te paso costo y precio:\n| Producto | Costo | Precio |\n|---|---|---|\n| Galleta | S/ 1.20 | S/ 1.80 |', ['1.20', '1.80']],
  // 17-10 (2): presentación del dueño sin negar justo antes: «Precio» solo se tapa
  ['Te paso los costos:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']]];
const T16_SHOW = [
  ['No sé el costo. Precio S/ 2.50 y lo traje a S/ 1.80', ['2.50']], ['te sale a S/ 2.50', ['2.50']], ['El cliente pagó S/ 2.50', ['2.50']],
  ['Te paso los costos:\n| Producto | PVP (S/) | Precio de venta S/ | P. venta (S/) | **Venta** |\n|---|---|---|---|---|\n| Galleta | S/ 1.80 | S/ 1.90 | S/ 2.00 | S/ 2.10 |', ['1.80', '1.90', '2.00', '2.10']],
  // 17-10: «Precio» solo es venta tras presentación negada (sin columna del dueño)
  ['No tengo el costo, esta es la lista:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']],
  ['Lista de hoy:\n- Galleta: S/ 1.80\n- Arroz: S/ 3.10', ['1.80', '3.10']], ['Te paso los costos:\n- Galleta: S/ 1.80\n- PVP: S/ 2.50', ['2.50']],
  ['Te paso los costos:\n- Galleta: S/ 1.80\n- Precio de venta S/ 2.60', ['2.60']], ['Te paso los costos:\n- Galleta: S/ 1.80\n\nListo, el precio de venta es S/ 5.00', ['5.00']],
  ['Hola.\nTe cuento.\nAquí va.\nMira:\n| Producto | Monto |\n| Galleta | S/ 1.80 |', ['1.80']],
  ['El costo es alto. Uno. Dos. Tres.\n| Producto | Monto |\n| Galleta | S/ 1.80 |', ['1.80']], ['| Producto | Costo | Precio |\n|---|---|---|\n| Arroz | 1.80 | 2.50 |', ['2.50']]];
for (const n of [1, 2, 47, 48, 49, 100]) {
  test('16) trozos de ' + n + ': 3 frases antes de tabla/lista, listas ítem por ítem, venta con dueño detrás, verbos (conseguimos, nos sale, compraste…), encabezados de venta', () => {
    for (const [t, hide] of T16_MASK) { const w = redactOwnerData(t); for (const h of hide) assert.ok(!w.includes(h), t + ' -> ' + w); assert.ok(w.includes('[dato del Admin]')); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
    for (const [t, vs] of T16_SHOW) { const w = redactOwnerData(t); for (const v of vs) assert.ok(w.includes(v), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
  });
}
// Retención (Bot 3): entra de a 5 caracteres; retenido = entrado − salido (los montos tapados cuentan como el monto original).
function held(text, role = EMP, size = 5) {
  const out = []; const e = createTextEmitter((d) => out.push(d), 1e9, redactFor(role)); let max = 0, last = 0;
  for (let i = 0; i < text.length; i += size) { e.push(text.slice(i, i + size)); const got = out.filter((d) => d.t).map((d) => d.t).join('').split(OWNER_LABEL).join('S/ 1.80').length; last = Math.min(i + size, text.length) - got; max = Math.max(max, last); }
  e.flush(); return { max, last };
}
const OWNER_LABEL = '[dato del Admin]';
const FILL = (n) => 'texto normal de la tienda '.repeat(Math.ceil(n / 26)).slice(0, n);
test('16) retención: una presentación del dueño ya no retiene la línea siguiente (Bot 3: 4000 → ~20); «Precio S/» en la zona solo hasta su tope; listas y tablas ítem por ítem', () => {
  for (const [t, cap] of [['El costo no lo tengo.\n' + FILL(4000), 40], ['Tu margen fue bueno esta semana.\n' + FILL(600), 40], ['Lo que pagué lo ves tú.\n' + FILL(300), 40], ['Hola, te cuento.\n' + FILL(4000), 40],
    ['Te paso los costos:\n' + Array.from({ length: 200 }, (_, i) => '- Producto ' + i + ': S/ 1.80\n').join(''), 60],
    ['Te paso los costos:\n| Producto | Monto | PVP |\n|---|---|---|\n' + Array.from({ length: 480 }, (_, i) => '| Producto ' + i + ' | S/ 1.80 | S/ 1.80 |\n').join(''), 80]]) {
    const h = held(t); assert.ok(h.max <= cap, JSON.stringify(t.slice(0, 40)) + ' retiene ' + h.max);
  }
  // «No sé el costo. Precio S/ 1.80 …» con salto en el carácter 150: espera a lo más el tope (OWNER_RETRO) y luego vuelve a ~20
  const neg = 'No sé el costo. Precio S/ 1.80 ' + FILL(150 - 31) + '\n' + FILL(3818);
  const h = held(neg); assert.ok(h.max <= OWNER_RETRO + 40, 'pico ' + h.max); assert.ok(h.last <= 40, 'al final ' + h.last);
  assert.ok(!redactOwnerData(neg).includes('1.80'), 'al tope se tapa (a prueba de fallas)');
});
test('16) lista de 480 filas sin presentación del dueño: 0 nombres tapados, montos de venta visibles', () => {
  const t = 'Lista de precios:\n' + Array.from({ length: 480 }, (_, i) => '- Arroz Costeño ' + i + ': S/ 2.50\n').join('');
  const w = redactOwnerData(t); assert.equal(w, t); assert.equal(streamBig(t, EMP, 5).text, t);
});

// ---------- 17. Bot 2 sobre 1c17310c: monto al final de línea + dueño en la línea siguiente; títulos de compras/proveedor; «El Margen» ----------
const T17_MASK = [
  // entrada exacta de Bot 2, sin y con negación delante
  ['Precio S/ 1.80\n(lo que pagué)', ['1.80']], ['No sé el costo.\nPrecio S/ 1.80\n(lo que pagué)', ['1.80']], ['Precio S/ 1.80\nEso es lo que pagué', ['1.80']],
  ['Galleta S/ 1.80  \n   (me costó eso)', ['1.80']], ['Galleta S/ 1.80\nlo compré a ese precio', ['1.80']],
  // títulos que presentan compras/proveedor antes de tabla o lista (barras, tabuladores, viñetas)
  ['Resumen de compras:\n| Producto | Cantidad | Total |\n|---|---|---|\n| Arroz | 10 | S/ 18.00 |\n| Azúcar | 12 | S/ 21.60 |', ['18.00', '21.60']],
  ['Factura del proveedor\n| Producto | Cant. | Importe |\n|---|---|---|\n| Arroz | 10 | S/ 18.00 |', ['18.00']], ['Factura del proveedor\nProducto\tImporte\nArroz\tS/ 18.00', ['18.00']],
  ['Boleta del proveedor\n* Arroz S/ 18.00', ['18.00']], ['Compras de hoy:\n- Arroz S/ 18.00\n- Azúcar S/ 21.60', ['18.00', '21.60']],
  ['Resumen de compras de hoy.\nDetalle:\n| Producto | Total |\n| Arroz | S/ 18.00 |', ['18.00']], ['Proveedores:\n1. Arroz S/ 18.00', ['18.00']],
  // mayúscula tras artículo o posesivo
  ['El Margen es S/ 0.70', ['0.70']], ['Tu Inversión es S/ 300.00', ['300.00']], ['La Ganancia: S/ 3.00', ['3.00']], ['Nuestra Utilidad fue S/ 50.00', ['50.00']],
  ['Te paso los costos.\nAquí va:\n| Producto | Monto |\n| Galleta | S/ 1.80 |', ['1.80']]];
const T17_SHOW = [
  ['Precio S/ 1.80\nGracias por tu compra, vuelve pronto.', ['1.80']], ['Galleta S/ 1.80\nArroz S/ 2.50\nAzúcar S/ 3.10', ['1.80', '2.50', '3.10']],
  ['Las compras de hoy fueron buenas, el arroz se vende a S/ 2.50', ['2.50']], ['El proveedor llegó tarde. Arroz a S/ 2.50', ['2.50']], ['Compré pan. Arroz S/ 2.50', []],
  ['Distribuidora Inversiones Lima vende Arroz a S/ 2.50', ['2.50']], ['Arroz Costeño a S/ 2.50', ['2.50']],
  ['El costo subió.\n\nPrecios de hoy:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']], ['Te paso los costos.\n\nPrecios de hoy:\n- Galleta S/ 1.80', ['1.80']],
  ['El costo subió.\n\nLista de precios\n- Galleta S/ 1.80', ['1.80']]];
for (const n of [1, 2, 47, 48, 49, 100]) {
  test('17) trozos de ' + n + ': monto al final de línea con dueño en los primeros 20 caracteres de la siguiente; títulos de compras/proveedor; «El Margen»; título de precios corta la presentación', () => {
    for (const [t, hide] of T17_MASK) { const w = redactOwnerData(t); for (const h of hide) assert.ok(!w.includes(h), t + ' -> ' + w); assert.ok(w.includes('[dato del Admin]')); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
    for (const [t, vs] of T17_SHOW) { const w = redactOwnerData(t); for (const v of vs) assert.ok(w.includes(v), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
  });
}
test('17) retención: lista de 480 líneas de precios (un monto por línea) sin nada tapado y con poca retención; dueño en la línea siguiente espera a lo más ~20 caracteres', () => {
  const list = 'Lista de precios:\n' + Array.from({ length: 480 }, (_, i) => 'Producto ' + i + ' S/ 1.80\n').join('');
  assert.equal(redactOwnerData(list), list); assert.equal(streamBig(list, EMP, 5).text, list);
  const h = held(list); assert.ok(h.max <= 45, 'retiene ' + h.max);
  const plain = Array.from({ length: 480 }, (_, i) => 'Galleta ' + i + ': S/ 1.80\n').join(''); assert.equal(redactOwnerData(plain), plain); assert.ok(held(plain).max <= 45);
  // monto al final de línea: 20 caracteres con texto de la siguiente + lo que hace falta para decidir una frase que empieza ahí («lo que pagué», hasta 36)
  const eol = 'Precio S/ 1.80\n' + FILL(4000); const he = held(eol); assert.ok(he.max <= 80, 'monto al final de línea: ' + he.max); assert.ok(he.last <= 40);
});

// ---------- 18. «Precio» solo tras presentación del dueño sin negar; solo un título de VENTA tras línea en blanco corta la presentación ----------
const T18_MASK = [
  ['Te paso los costos:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']], ['Te paso los costos:\nProducto\tPrecio\nGalleta\tS/ 1.80', ['1.80']],
  ['Te paso los costos.\n\nDetalle:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']], ['Te paso los costos.\n\nAquí va:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']],
  ['Te paso los costos.\n\nResumen:\n- Galleta S/ 1.80', ['1.80']], ['No sé el costo de todo. Te paso los costos:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']],
  ['Resumen de compras:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']], ['Te paso los costos, no se olviden:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']],
  ['El costo no lo tengo. Te paso los costos:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']], ['Te paso los costos que tengo:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']], ['El costo no lo tengo, pero esta es la lista:\n| Producto | Costo | Precio |\n| Galleta | S/ 1.20 | S/ 1.80 |', ['1.20', '1.80']]];
const T18_SHOW = [
  ['El costo subió.\n\nPrecios de hoy:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']], ['Te paso los costos.\n\nPrecios:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']],
  ['Te paso los costos.\n\nLista de precios\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']], ['Te paso los costos.\n\nPVP\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']],
  ['Te paso los costos.\n\nPrecios de venta:\n- Galleta S/ 1.80', ['1.80']],
  ['El costo no lo tengo, pero esta es la lista:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']], ['No tengo el costo, esta es la lista:\nProducto\tPrecio\nGalleta\tS/ 1.80', ['1.80']],
  ['Aquí va la lista:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']], ['El costo no lo sé, esta es la lista:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']], ['El costo lo desconozco. Lista:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']],
  ['Te paso los costos:\n| Producto | PVP | Precio de venta | P. venta | Venta |\n| Galleta | S/ 1.80 | S/ 1.90 | S/ 2.00 | S/ 2.10 |', ['1.80', '1.90', '2.00', '2.10']]];
for (const n of [1, 2, 47, 48, 49, 100]) {
  test('18) trozos de ' + n + ': «Precio» solo se tapa tras presentación del dueño sin negar; un título neutro tras línea en blanco no corta, uno de venta sí', () => {
    for (const [t, hide] of T18_MASK) { const w = redactOwnerData(t); for (const h of hide) assert.ok(!w.includes(h), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
    for (const [t, vs] of T18_SHOW) { const w = redactOwnerData(t); for (const v of vs) assert.ok(w.includes(v), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
  });
}

// ---------- 19. Bot 5 sobre 43a80dbc: dueño dentro de la celda de venta; título de precios con compra/proveedor; título en la misma línea; listas ----------
const T19_MASK = [
  ['Te paso los costos:\n| Producto | PVP |\n|---|---|\n| Galleta | costo S/ 1.80 |', ['1.80']], ['Te paso los costos:\n| Producto | PVP |\n|---|---|\n| Galleta | Costo: S/ 1.80 |', ['1.80']],
  ['Te paso los costos:\n| Producto | PVP |\n| Galleta | lo que pagué S/ 1.80 |', ['1.80']], ['Te paso los costos:\nProducto\tPVP\nGalleta\tcosto S/ 1.80', ['1.80']],
  ['Te paso los costos:\n\nPrecios del proveedor:\n- Galleta: S/ 1.80', ['1.80']], ['Te paso los costos:\n\nPrecios de hoy (compra):\n- Galleta: S/ 1.80', ['1.80']],
  ['Te paso los costos:\n\nPrecios de compra:\n| Producto | Monto |\n|---|---|\n| Galleta | S/ 1.80 |', ['1.80']], ['Te paso los costos:\n\nPrecios de costo:\n- Galleta S/ 1.80', ['1.80']],
  ['Precios del proveedor:\n- Galleta: S/ 1.80', ['1.80']], ['Precios de hoy (compra):\n| Producto | Monto |\n| Galleta | S/ 1.80 |', ['1.80']],
  ['Compras de hoy: Galleta S/ 1.80', ['1.80']], ['Compras de hoy: Galleta S/ 1.80, PVP S/ 2.50, Arroz S/ 3.10', ['1.80', '3.10']],
  ['Precios de compra: Galleta S/ 1.80', ['1.80']], ['Los precios de compra: Galleta S/ 1.80, Arroz S/ 3.10', ['1.80', '3.10']], ['Factura del proveedor: S/ 18.00', ['18.00']],
  ['Te paso los costos:\n-Galleta: S/ 1.80\n-Arroz: S/ 3.10', ['1.80', '3.10']], ['Te paso los costos:\na) Galleta: S/ 1.80\nb) Arroz: S/ 3.10', ['1.80', '3.10']],
  ['Te paso los costos:\nGalleta: S/ 1.80\nArroz: S/ 3.10\nAzúcar S/ 4.20', ['1.80', '3.10', '4.20']], ['Compras de hoy:\nGalleta S/ 1.80\nArroz S/ 3.10', ['1.80', '3.10']],
  ['Galleta S/ 1.80\n\n(lo que pagué)', ['1.80']], ['Galleta S/ 1.80\n\n\n  Eso es lo que pagué', ['1.80']]];
const T19_SHOW = [
  ['Te paso los costos:\n| Producto | PVP |\n|---|---|\n| Galleta | S/ 2.50 |', ['2.50']], ['Compras de hoy: Galleta S/ 1.80, PVP S/ 2.50', ['2.50']],
  ['El costo: S/ 1.80, se vende a S/ 2.50', ['2.50']], ['Las compras de hoy fueron buenas: arroz a S/ 2.50', ['2.50']], ['Hola:\nGalleta: S/ 1.80\nArroz: S/ 3.10', ['1.80', '3.10']],
  ['Te paso los costos:\nGalleta: S/ 1.80\nArroz: S/ 3.10\n\nEl precio de venta es S/ 5.00', ['5.00']], ['Lista:\na) Galleta S/ 1.80', ['1.80']],
  ['El costo subió.\n\nPrecios de hoy:\n- Galleta S/ 1.80', ['1.80']], ['El costo subió.\n\nPrecios de venta:\n| Producto | Precio |\n| Galleta | S/ 1.80 |', ['1.80']],
  ['Galleta S/ 1.80\n\nGracias por tu compra.', ['1.80']], ['El proveedor llegó tarde. Arroz a S/ 2.50', ['2.50']]];
for (const n of [1, 2, 47, 48, 49, 100]) {
  test('19) trozos de ' + n + ': dueño en la celda de venta; título con compra/proveedor no corta; título en la misma línea; listas -Galleta, a), sin viñeta; línea en blanco antes de «(lo que pagué)»', () => {
    for (const [t, hide] of T19_MASK) { const w = redactOwnerData(t); for (const h of hide) assert.ok(!w.includes(h), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
    for (const [t, vs] of T19_SHOW) { const w = redactOwnerData(t); for (const v of vs) assert.ok(w.includes(v), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
  });
}
test('19) retención acotada: ítems sin viñeta, lista «a)», monto con líneas en blanco detrás', () => {
  const lines = 'Te paso los costos:\n' + Array.from({ length: 200 }, (_, i) => 'Producto ' + i + ': S/ 1.80\n').join('');
  assert.ok(!redactOwnerData(lines).includes('1.80')); assert.ok(held(lines).max <= 60, 'sin viñeta ' + held(lines).max);
  const abc = 'Te paso los costos:\n' + Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i) + ') Producto: S/ 1.80\n').join('');
  assert.ok(!redactOwnerData(abc).includes('1.80')); assert.ok(held(abc).max <= 60, 'a) ' + held(abc).max);
  const gap = 'Galleta S/ 1.80\n\n\n' + FILL(4000); const h = held(gap); assert.ok(h.max <= 80, 'líneas en blanco ' + h.max); assert.ok(h.last <= 40);
});
test('19) siguen los ajustes anteriores: «Precio» solo tras presentación sin negar, solo título de venta corta, llave HMAC una vez, cabeza del monto guardada', () => {
  assert.ok(!redactOwnerData('Te paso los costos:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |').includes('1.80'));
  assert.ok(redactOwnerData('El costo no lo tengo, pero esta es la lista:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |').includes('1.80'));
  assert.ok(!redactOwnerData('Te paso los costos.\n\nDetalle:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |').includes('1.80'));
  assert.ok(redactOwnerData('El costo subió.\n\nPrecios de hoy:\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |').includes('1.80'));
  const SRC = readFileSync(new URL('../../tools/cloudflare-lab/src/pos-assistant.js', import.meta.url), 'utf8');
  assert.match(SRC, /if \(hmacKeyCache\.secret !== secret\) hmacKeyCache = \{ secret, key: crypto\.subtle\.importKey\(/);
  assert.match(SRC, /const numNeed = \(i\) => \{ let e; if \(nm\.i === i\) e = nm\.e;/);
});

// ---------- 20. Bot 5 sobre a82a747f: título largo con «Compras» / proveedor / de compra / costo; «cliente» no cuenta. Bot 3: rachas de espacios ----------
const T20_MASK = [
  ['Compras de hoy en la tienda: Galleta S/ 1.80', ['1.80']], ['Compras de hoy del proveedor Lima Norte: Galleta S/ 1.80', ['1.80']],
  ['Compras de hoy en la tienda central de la avenida: Galleta S/ 1.80, Arroz S/ 3.10', ['1.80', '3.10']], ['**Compras** de hoy en la tienda: Galleta S/ 1.80', ['1.80']],
  ['Lo que nos trajo hoy el proveedor de la avenida: Galleta S/ 1.80', ['1.80']], ['Estos son los precios de compra de la semana pasada: Galleta S/ 1.80', ['1.80']],
  ['Lo que anoto de la tienda central sobre el costo de hoy: Galleta S/ 1.80', ['1.80']],
  ['Compras ' + 'de la tienda '.repeat(8) + 'hoy: Galleta S/ 1.80', ['1.80']],
  // «cliente» solo anula lo que viene únicamente de «compras» (Bot 5 sobre 6f9f3dae)
  ['Costo del pedido del cliente: S/ 1.80', ['1.80']], ['Compras al proveedor para el cliente Juan: S/ 1.80', ['1.80']], ['Precio de compra del cliente: S/ 1.80', ['1.80']],
  ['Compras al proveedor para el cliente Juan: Galleta S/ 1.80, Arroz S/ 3.10', ['1.80', '3.10']], ['Proveedor del cliente: Galleta S/ 1.80', ['1.80']],
  ['Lo que anoto del costo para el cliente de la avenida: Galleta S/ 1.80', ['1.80']]];
const T20_SHOW = [
  ['Las compras del cliente: S/ 30', ['30']], ['El cliente pagó sus compras: S/ 30', ['30']], ['Compras del cliente Juan en la tienda: S/ 30', ['30']],
  ['Compras de hoy en la tienda: Galleta S/ 1.80, PVP S/ 2.50', ['2.50']], ['Estos son los precios de venta de la semana pasada en tienda: Galleta S/ 1.80', ['1.80']],
  ['Las compras de hoy fueron buenas: arroz a S/ 2.50', ['2.50']], ['Compras de hoy ' + 'en la tienda '.repeat(10) + 'central: Galleta S/ 1.80', ['1.80']],
  ['Hoy no sé nada del proveedor de la avenida central: Galleta S/ 1.80', ['1.80']]];
for (const n of [1, 2, 5, 47, 48, 49, 100]) {
  test('20) trozos de ' + n + ': título largo que empieza con «Compras» o nombra proveedor / de compra / costo tapa (hasta 120 caracteres); con «cliente» no cuenta; igual al texto entero', () => {
    for (const [t, hide] of T20_MASK) { const w = redactOwnerData(t); for (const h of hide) assert.ok(!w.includes(h), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
    for (const [t, vs] of T20_SHOW) { const w = redactOwnerData(t); for (const v of vs) assert.ok(w.includes(v), t + ' -> ' + w); assert.equal(stream(t, EMP, n).text, w, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t); }
  });
}
test('20) retención: el título largo no retiene la línea esperando el «:»; una racha de líneas de espacios cuenta dentro del tope de 160', () => {
  for (const t of ['Compras de hoy en la tienda: Galleta S/ 1.80', 'Compras de hoy del proveedor Lima Norte: Galleta S/ 1.80', 'Las compras del cliente: S/ 30', 'El cliente pagó sus compras: S/ 30']) assert.ok(held(t).max <= 40 + LABEL_TAIL, t + ' ' + held(t).max);
  // 500 caracteres que empiezan con «Compras», sin «:», monto en 30 o en 130: lo decide la regla normal (tope de su frase), nada más
  const base = 'Compras de hoy en la tienda y ' + FILL(600);
  // (#962, diseño simple) + LABEL_TAIL: la cola fija que nunca pasa a las etapas (una etiqueta partida entre trozos no sale) (+ 5: un trozo, la cola corre la decisión de la etapa)
  for (const at of [30, 130]) { const t = (base.slice(0, at) + 'S/ 1.80 ' + base.slice(at)).slice(0, 500); const h = held(t); assert.ok(h.max <= OWNER_RETRO + 30 + LABEL_TAIL + 5, at + ': ' + h.max); assert.equal(stream(t, EMP, 5).text, full(t, EMP)); }
  // Bot 3: 30 líneas de 10 espacios tras un monto al final de línea retenían 355; ahora a lo más el tope
  for (const [l, sp] of [[2, 19], [5, 10], [10, 15], [30, 10], [100, 40]]) { const t = 'Paracetamol caja S/ 1.80\n' + (' '.repeat(sp) + '\n').repeat(l) + FILL(300); const h = held(t);
    assert.ok(h.max <= OWNER_RETRO + 30 + LABEL_TAIL, l + 'x' + sp + ': ' + h.max); assert.equal(stream(t, EMP, 5).text, full(t, EMP)); assert.equal(stream(t, 'owner', 5).text, full(t, 'owner')); }
});
test('20) propiedad: cortar entre espacios no cambia lo tapado (RUC, DNI, clave, foto, teléfono y montos separados por rachas de espacios)', () => {
  let seed = 4242; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); const pick = (a) => a[Math.floor(rnd() * a.length)];
  const P = ['RUC', 'RUC N°', 'DNI:', 'DNI', 'clave', 'clave es', 'api key', 'data:image/png;base64,', 'QUJDREVGR0hJSktMTU5P', 'QQ==', '20123456789', '12345678', '987', '654', '321', '+51', 'abc123',
    'S/ 1.80', 'costo', 'precio de venta', 'Compras de hoy', 'proveedor', 'cliente', ':', '.', 'Galleta', '(lo que pagué)'];
  const W = [' ', '  ', '\n', ' \n ', '          \n', '\t', '\n\n', ' '.repeat(30)];
  for (let i = 0; i < 1200; i++) { let t = ''; const n = 2 + Math.floor(rnd() * 14); for (let j = 0; j < n; j++) t += pick(P) + pick(W);
    for (const role of ['owner', EMP]) { const mode = rnd(), size = () => (mode < 0.3 ? 1 : mode < 0.6 ? 1 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 60));
      assert.equal(stream(t, role, size).text, full(t, role), role + ' ' + JSON.stringify(t)); } }
});
test('20) Bot 5: una etiqueta de clave/pin/token, RUC, DNI o data: que espera su valor no suelta nada durante una racha de espacios (trozos de 1); el valor queda tapado', () => {
  const sp = (n) => ' '.repeat(n);
  const CASES = [['RUC:', sp(500) + '20123456789', /20123456789|23456/], ['RUC N°', sp(300) + '\n' + sp(200) + '20123456789', /20123456789/], ['DNI:', sp(500) + '12345678', /12345678/],
    ['DNI', '\n\n\n' + sp(400) + '12345678', /12345678/], ['clave', sp(500) + 'abc123', /abc123/], ['clave es', sp(500) + 'abc123', /abc123/], ['clave', sp(200) + 'es' + sp(300) + 'abc123', /abc123/],
    ['token =', sp(400) + 'sk-999999', /sk-999999/], ['pin:', '\n' + sp(450) + '4321', /4321/], ['data:image/png;base64,', sp(400) + 'QUJDREVGR0hJSktMTU5P' + sp(300) + 'QQ==', /QUJD|QQ==/]];
  for (const [label, rest, secret] of CASES) for (const role of ['owner', EMP]) {
    const t = label + rest, red = redactFor(role); let o = ''; const em = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, red);
    let i = 0; for (; i < t.length; i++) { em.push(t[i]); const pendingWs = i >= label.length && !/\S/.test(t.slice(label.length, i + 1).replace(/\bes\b/, '')); if (pendingWs) assert.ok(o.length <= label.length, role + ' ' + label + ': soltó ' + o.length + ' caracteres con la etiqueta esperando'); }
    em.flush(); assert.ok(role === 'owner' && /^RUC/.test(label) ? secret.test(o) : !secret.test(o), role + ' ' + label + ' -> ' + o); // el dueño ve el RUC (Bot 2 sobre 25ffde10); el DNI ya no (auditoría 500, 8) assert.equal(o, red(t), role + ' ' + label + ': igual al texto entero');
  }
});
test('20) Bot 3: un tramo de solo espacios no pasa por redactText (mismo resultado); con una etiqueta esperando su valor no se suelta', () => {
  const SRCF = readFileSync(new URL('../../tools/cloudflare-lab/src/pos-assistant.js', import.meta.url), 'utf8');
  assert.match(SRCF, /out\(WS_ONLY\.test\(piece\) \? piece : red\(piece\)\)/); assert.match(SRCF, /const WS_ONLY = \/\^\\s\+\$\/;/);
  for (const t of [' '.repeat(3300), 'Paracetamol caja S/ 1.80\n' + ' '.repeat(3300) + 'listo', 'RUC:' + ' '.repeat(3300) + '20123456789', 'clave' + '\n'.repeat(5) + ' '.repeat(3000) + 'abc123'])
    for (const role of ['owner', EMP]) { const red = redactFor(role); let o = ''; const em = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, red); for (const ch of t) em.push(ch); em.flush();
      assert.equal(o, red(t)); assert.ok(!/abc123/.test(o)); if (role !== 'owner') assert.ok(!/20123456789/.test(o)); }
});

// (auditoría 2026-10-22, ALTA) caso fijo: en partes se veía «sk-123456» (un «[oculto]» de antes hace que «api key» empiece palabra en el texto
// entero). Ahora en partes = texto entero con cualquier tamaño de trozo, y lo mismo con la etiqueta pegada a otros datos tapados.
test('2b) «clave 4.321api key sk-123456 | Producto |»: en partes (1..todo) = texto entero, sin la api key a la vista; familia de etiquetas pegadas', () => {
  const t = 'clave 4.321api key sk-123456 | Producto |';
  assert.equal(redactText(t), 'clave [oculto]api key [oculto] | Producto |');
  const parts = (s, role, n) => { let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, redactFor(role)); for (let i = 0; i < s.length; i += n) e.push(s.slice(i, i + n)); e.flush(); return o; };
  for (const role of ['owner', 'empleado:consultas']) for (let n = 1; n <= t.length; n++) { const o = parts(t, role, n); assert.equal(o, redactFor(role)(t), role + '/' + n); assert.ok(!o.includes('sk-123456'), o); }
  const pre = ['clave 4.321', 'pin 4321', 'DNI 45678912', '987654321', 'a@b.com', 'x', 'rosa [at] gmail [dot] com '];
  const kw = ['api key', 'api_key', 'pin', 'clave', 'token', 'password', 'clave del wifi'];
  const val = [' sk-123456', ' 4321', ' Zq9xK2mPw7', ' 4.321', ' "abc def"'];
  for (const a of pre) for (const sep of ['', ' ']) for (const k of kw) for (const v of val) for (const z of [' | Producto |', ' y listo']) {
    const s = a + sep + k + v + z;
    for (const role of ['owner', 'empleado:consultas']) for (const n of [1, 3, 1000]) assert.equal(parts(s, role, n), redactFor(role)(s), role + '/' + n + ' ' + JSON.stringify(s));
  }
});

// (22-10, PR #934) caso fijo: «caja fuerte 4321 data:text/html;base64,AAAA, producto clave S/ 4.50» en partes dejaba «S/ 4.50» a la vista; el
// texto entero lo tapa (la ventana de 40 del adjetivo se mide sin el «data:…;» que el filtro quita). Familia: data largo, correo, DNI con puntos.
test('2c) «caja fuerte 4321 data:…, producto clave S/ 4.50»: en partes (1..todo) = texto entero, el monto tapado; familia con data largo, correo y DNI con puntos', () => {
  const parts = (s, role, n) => { let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, redactFor(role)); for (let i = 0; i < s.length; i += n) e.push(s.slice(i, i + n)); e.flush(); return o; };
  const t = 'caja fuerte 4321 data:text/html;base64,AAAA, producto clave S/ 4.50 y listo';
  for (const role of ['owner', 'empleado:consultas']) {
    assert.match(redactFor(role)(t), /producto clave S\/ \[oculto\]/);
    for (let n = 1; n <= t.length; n++) { const o = parts(t, role, n); assert.equal(o, redactFor(role)(t), role + '/' + n); assert.ok(!o.includes('4.50'), o); }
  }
  for (const a of ['caja fuerte 4321', 'el wifi', 'pin 4321', 'x']) for (const m of [' data:text/html;base64,AAAA,', ' data:image/png;base64,' + 'QUJD'.repeat(30) + ',', ' rosa.q@x.com', ' 45.678.912', ''])
    for (const z of [' producto clave S/ 4.50 y listo', ' | producto clave | S/ 4.50 |']) { const s = a + m + z;
      for (const role of ['owner', 'empleado:consultas']) for (const n of [1, 2, 5, 13, 1000]) assert.equal(parts(s, role, n), redactFor(role)(s), role + '/' + n + ' ' + JSON.stringify(s)); }
});
test('2d) «costo⏎la contraseña es para proteger tu cuentaGalleta S/ 1.80AST-otro, »: en partes (1..todo y al azar) = texto entero en los dos sentidos (ni tapa de más ni de menos)', () => {
  const core = 'la contraseña es para proteger tu cuentaGalleta S/ 1.80AST-otro, ';
  const cases = [['S/ 1.80 es el costo\n' + core, true], [']) for (const role of [EMP,  DNI 12345678. S/ 1.80 es el costo\n' + core, true], ['costo la ' + 'contraseña S/ 1.80 ok', null],
    ['El precio del ' + 'pin es S/ 4.50 ok', null], [core, false], ['x\n' + core, false]];
  for (const [t, visible] of cases) {
    if (visible !== null) assert.equal(redactFor('owner')(t).includes('Galleta S/ 1.80AST'), visible, 'entero ' + t); // precio/costo justo antes de la etiqueta: se ve
    let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (const role of ['owner', EMP]) {
      const want = full(t, role);
      for (let n = 1; n <= t.length; n++) assert.equal(stream(t, role, n).text, want, role + ' ' + n + ': ' + t);
      for (let r = 0; r < 40; r++) assert.equal(stream(t, role, () => 1 + Math.floor(rnd() * 8)).text, want, role + ' al azar: ' + t);
    }
  }
});
