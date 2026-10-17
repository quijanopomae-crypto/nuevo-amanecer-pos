// Bot 3 sobre c97c41ca (y la sala): filtro en partes INCREMENTAL con la misma salida que el filtro del texto entero, correo lineal,
// el empleado ve el texto sin esperar (solo se tapa el monto), pedido a DeepSeek cortado si el celular se va o pasa el tope,
// relojes del celular que cuentan la subida de la foto, foto de empleado rechazada sin subir. Y lo de Bot 4 (puntitos, «Pensando»
// tras un reset, «unid..», contraste, último párrafo) y Bot 2 (nombres de productos que no son datos del dueño).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore, createTextEmitter, redactFor, redactText, redactOwnerData, OWNER_RETRO, FIRST_TEXT_MIN } from '../../tools/cloudflare-lab/src/pos-assistant.js';
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
const full = (text, role) => redactFor(role)(clean(text)).slice(0, 1200);

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
      assert.equal(s.text, full(txt, EMP)); assert.ok(s.text.includes('El costo de 2 unidades… es [dato del dueño]. Hay 40 unidades.'), s.text);
      assert.equal(stream(txt, 'owner', n).text, txt);
    }
  });
}

// ---------- 4. sala: etiquetas de venta, monto antes de la palabra, tope ----------
const ROOM = [
  ['costo, precio S/ 1.80', 'costo, precio [dato del dueño]'],
  ['El costo no lo tengo, pero el precio de venta es S/ 2.50', 'El costo no lo tengo, pero el precio de venta es S/ 2.50'],
  ['S/ 1.80 es el costo', '[dato del dueño] es el costo'],
  ['S/ 1.80 de costo y S/ 2.50 de precio de venta.', '[dato del dueño] de costo y [dato del dueño] de precio de venta.'],
  ['precio de venta S/ 2.50, costo S/ 1.80', 'precio de venta S/ 2.50, costo [dato del dueño]'],
  ['el costo es S/ 1.80, pero el precio de venta es S/ 2.50', 'el costo es [dato del dueño], pero el precio de venta es S/ 2.50'],
  ['costo S/ 1.80 y venta S/ 2.50', 'costo [dato del dueño] y venta S/ 2.50'],
  ['El costo es S/ 1.80. Se vende a S/ 2.50, lo vendemos a S/ 2.40, vendo a S/ 2.30, PVP S/ 2.60, P. venta S/ 2.70.', 'El costo es [dato del dueño]. Se vende a S/ 2.50, lo vendemos a S/ 2.40, vendo a S/ 2.30, PVP S/ 2.60, P. venta S/ 2.70.'],
  ['El costo es S/ 1.80 y el proveedor se lo vende a S/ 1.50', 'El costo es [dato del dueño] y el proveedor se lo vende a [dato del dueño]'],
  ['Arroz S/ 2.50; el costo lo ve el dueño.', 'Arroz S/ 2.50; el costo lo ve el dueño.']
];
for (const n of [1, 2, 5, 47, 48, 49, 100]) {
  test('4) trozos de ' + n + ': solo el monto se tapa; etiquetas de venta (precio de venta, P. venta, PVP, se vende a, (lo) vendemos a, vendo a); «precio» solo no', () => {
    for (const [inp, want] of ROOM) { assert.equal(redactOwnerData(inp), want, inp); assert.equal(stream(inp, EMP, n).text, want, n + ': ' + inp); }
  });
}
test('4) monto sin fin de frase: espera como mucho ' + OWNER_RETRO + ' caracteres y entonces se tapa (a prueba de fallas); con punto antes sale', () => {
  const longTail = 'S/ 4.20 cada uno ' + 'y es bueno '.repeat(20);
  assert.ok(redactOwnerData(longTail).startsWith('[dato del dueño] cada uno'));
  assert.ok(redactOwnerData('S/ 4.20 cada uno. ' + 'y es bueno '.repeat(20)).startsWith('S/ 4.20 cada uno.'));
  const s = stream(longTail, EMP, 5); assert.equal(s.text, redactOwnerData(longTail));
  const firstAt = s.marks.find(([, out]) => out > 0)[0]; assert.ok(firstAt <= 7 + OWNER_RETRO + 10, 'sale al llegar al tope: ' + firstAt);
});

// ---------- 5. Bot 2: nombres que no son datos del dueño ----------
test('5) nombres de productos y proveedores (Arroz Costeño, Galletas Costa, Margarina Primor, Distribuidora Inversiones Lima, Ganadero) se ven completos', () => {
  for (const t of ['Arroz Costeño 5 kg S/ 4.20, hay 12 en stock.', 'Galletas Costa S/ 1.50 (30 unidades)', 'Margarina Primor S/ 3.80, quedan 8.', 'Distribuidora Inversiones Lima trae el Ganadero a S/ 6.00 de precio de venta.',
    'Ganadero S/ 6.00, stock 4.', 'Costeño, Costa y Primor están a S/ 4.20, S/ 1.50 y S/ 3.80.']) {
    assert.equal(redactOwnerData(t), t, t); for (const n of [1, 3, 48]) assert.equal(stream(t, EMP, n).text, t, n + ': ' + t);
  }
  // palabras enteras: costo/costó/costos/cost/margen/ganancia/inversión/utilidad siguen contando
  for (const t of ['costo S/ 1.80', 'costó S/ 1.80', 'costos S/ 1.80', 'cost 1.80', 'margen 20%', 'ganancia S/ 2.00', 'inversión S/ 300', 'utilidad 15%', 'Arroz Costo S/ 1.80'])
    assert.ok(redactOwnerData(t).endsWith('[dato del dueño]'), t);
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
  const ke = stream(k, EMP, 5); ke.marks.forEach(([pushed, out]) => { if (pushed > 40) assert.ok(pushed - out <= 14, pushed + '/' + out); });
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
test('8) foto de un empleado: el celular avisa «Eso solo lo puede hacer el dueño.» al instante, sin subirla', () => {
  const UI = read('POS/js/modules/asistente/asistente-ui.js'); const sendFn = UI.slice(UI.indexOf('  async function send(text, image) {'), UI.indexOf('  // Comprime en el aparato'));
  const a = sendFn.indexOf("if (image && access && access.role !== 'owner') { addMsg('u', text || 'Foto'); errMsg('image_owner_only'); setState('error', 2600); return; }");
  assert.ok(a > 0 && a < sendFn.indexOf('reqInit(') && a < sendFn.indexOf('busy = true'), 'antes de armar o mandar el pedido');
  assert.equal(C.friendlyError('image_owner_only').msg, 'Eso solo lo puede hacer el dueño.');
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
      const want = redactOwnerData(t); assert.ok(!/1\.80|7,797|30%|500|15%/.test(want) && want.includes('[dato del dueño]'), t + ' -> ' + want);
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
      const want = redactOwnerData(t); assert.ok(!/1\.80|18\.00/.test(want) && want.includes('[dato del dueño]'), t + ' -> ' + want);
      assert.equal(stream(t, EMP, n).text, want, n + ': ' + t); assert.equal(stream(t, 'owner', n).text, t);
    }
    for (const t of BODEGA_OK) { assert.equal(redactOwnerData(t), t, t); assert.equal(stream(t, EMP, n).text, t, n + ': ' + t); }
  });
}
