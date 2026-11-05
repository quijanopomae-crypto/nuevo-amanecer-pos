// (22-10) «Leer boleta con IA» (solo Admin): servidor (JSON, null, total, 403, tiempo, sin visión), cliente (giro, EXIF, aprendizaje,
// auto-giro con un solo reintento, revisión que NO guarda y solo prellena «Nueva compra»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assistantBoletaRoute, BOLETA_PATH, BOLETA_DENIED, BOLETA_LIMITS, BOLETA_PROMPT, extractJson, normalizeBoleta, boletaChecks, parseAmount, parseFecha, cleanHints } from '../../tools/cloudflare-lab/src/pos-assistant-boleta.js';
import { createMemoryUsageStore, IMAGE_UNSUPPORTED } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { makeDoc } from './fake-dom.mjs';
const require = createRequire(import.meta.url);
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = globalThis; // el módulo se cuelga de window
const B = require('../../POS/js/modules/asistente/asistente-boleta.js');
const WORKER = readFileSync('tools/cloudflare-lab/src/worker.js', 'utf8');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const BOL_SRC = readFileSync('POS/js/modules/asistente/asistente-boleta.js', 'utf8');
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const OK = (content) => jsonR({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
const K4 = 'clave-prueba-omyagent-4', K2 = 'clave-prueba-routeway-2';
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(400);
const GOOD = { numero: 'B001-123', fecha: '21/10/2026', items: [{ cant: 2, um: 'UNID', cod: 'P1', descripcion: 'Arroz 1kg', precio_unit: '4,50', importe: 9 }, { cant: 1, um: null, cod: null, descripcion: 'Azúcar', precio_unit: 3.6, importe: 3.6 }], total: 'S/ 12.60', rotacion: 0 };

async function route(body, { role = 'owner', posRole = 'owner', env = { ASSISTANT_AI_API_KEY_4: K4 }, fetch, timeoutMs, raw } = {}) {
  const seen = [];
  const f = fetch || (async () => OK(JSON.stringify(GOOD)));
  const r = await assistantBoletaRoute(new Request('https://w.test' + BOLETA_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1', ...env }, { principalId: 'session:x', posRole }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, timeoutMs, fetch: async (u, i) => { seen.push({ u, i, b: JSON.parse(i.body) }); return f(u, i); } });
  return { r, d: await r.json(), seen };
}

test('servidor: el modelo devuelve SOLO JSON (con o sin ```json / <think>); se normaliza, null para lo ilegible, total y suma revisados', async () => {
  const x = await route({ image: IMG }, { fetch: async () => OK('<think>pienso</think>```json\n' + JSON.stringify(GOOD) + '\n```') });
  assert.equal(x.r.status, 200); assert.equal(x.d.ok, true);
  assert.deepEqual(x.d.boleta, { numero: 'B001-123', fecha: '2026-10-21', total: 12.6, rotacion: 0, items: [
    { cant: 2, um: 'UNID', cod: 'P1', descripcion: 'Arroz 1kg', precio_unit: 4.5, importe: 9 }, { cant: 1, um: null, cod: null, descripcion: 'Azúcar', precio_unit: 3.6, importe: 3.6 }] });
  assert.equal(x.d.checks.total_mismatch, false); assert.equal(x.d.checks.sum, 12.6); assert.equal(x.d.checks.nulls, 2);
  // pedido: modelo con visión de OhMyAgent, clave ASSISTANT_AI_API_KEY_4, prompt de solo JSON con «rotacion»
  assert.equal(x.seen[0].u, 'https://ohhmyagent.com/v1/chat/completions'); assert.equal(x.seen[0].b.model, 'gpt-6.1-sol'); assert.equal(x.seen[0].i.headers.authorization, 'Bearer ' + K4);
  const user = x.seen[0].b.messages[1].content; assert.equal(user[1].type, 'image_url'); assert.match(user[0].text, /SOLO con un objeto JSON/); assert.match(BOLETA_PROMPT, /"rotacion": 0\|90\|180\|270/);
  assert.ok(!JSON.stringify(x.d).includes(K4), 'la clave nunca vuelve');
});

test('servidor: total que no cuadra, casi todo null y rotación se avisan; JSON roto -> 422 boleta_unreadable', async () => {
  let x = await route({ image: IMG }, { fetch: async () => OK(JSON.stringify({ ...GOOD, total: 50 })) });
  assert.equal(x.d.checks.total_mismatch, true);
  x = await route({ image: IMG }, { fetch: async () => OK(JSON.stringify({ numero: null, fecha: null, items: [{ cant: null, um: null, cod: null, descripcion: 'x', precio_unit: null, importe: null }], total: null, rotacion: 90 })) });
  assert.equal(x.d.checks.mostly_null, true); assert.equal(x.d.checks.rotated, true); assert.equal(x.d.boleta.rotacion, 90);
  x = await route({ image: IMG }, { fetch: async () => OK('No puedo leer la imagen') }); assert.equal(x.r.status, 422); assert.equal(x.d.error, 'boleta_unreadable');
  assert.equal(extractJson('texto {"a": "}"} fin').a, '}'); assert.equal(extractJson('{roto'), null);
  assert.deepEqual(normalizeBoleta({ items: 'x', total: 'abc', rotacion: 45 }), { numero: null, fecha: null, items: [], total: null, rotacion: 0 });
  assert.equal(parseAmount('S/ 1.234,50'), 1234.5); assert.equal(parseAmount('645.19'), 645.19); assert.equal(parseFecha('31/02/2026'), null); assert.equal(parseFecha('2026-10-21'), '2026-10-21');
  assert.equal(boletaChecks(normalizeBoleta({ items: [], total: 5 })).mostly_null, true);
});

test('servidor: empleado (cualquier nivel), aparato sin rol o sesión no dueño -> 403 boleta_admin_only sin llamar al modelo', async () => {
  for (const [role, posRole] of [['empleado:consultas', 'empleado'], ['empleado:consultas_documentos', 'empleado'], ['sin_rol', 'owner'], ['owner', 'empleado']]) {
    const x = await route({ image: IMG }, { role, posRole }); assert.equal(x.r.status, 403, role); assert.deepEqual(x.d, BOLETA_DENIED); assert.equal(x.seen.length, 0);
  }
  assert.equal((await route({ image: 'data:text/html;base64,AAAA' })).r.status, 400);
  assert.equal((await route(null, { raw: '{"image":"' + 'A'.repeat(BOLETA_LIMITS.bodyBytes) + '"}' })).r.status, 413);
});

test('servidor: tiempo máximo -> 504 boleta_timeout (sin cuerpo del proveedor); sin modelo con visión -> 503; el respaldo sin visión no se usa', async () => {
  const hang = (u, i) => new Promise((_, ko) => i.signal.addEventListener('abort', () => { const e = new Error('abort'); e.name = 'AbortError'; ko(e); }));
  let x = await route({ image: IMG }, { fetch: hang, timeoutMs: 40 }); assert.equal(x.r.status, 504); assert.equal(x.d.error, 'boleta_timeout');
  assert.equal(BOLETA_LIMITS.modelMs, 90000);
  x = await route({ image: IMG }, { env: { ROUTEWAY_API_KEY: K2 } }); assert.equal(x.r.status, 503); assert.deepEqual(x.d, IMAGE_UNSUPPORTED); assert.equal(x.seen.length, 0);
  x = await route({ image: IMG }, { env: { ASSISTANT_AI_API_KEY_4: K4, ASSISTANT_AI_API_KEY_2: K2 }, fetch: async () => jsonR({}, 429) });
  assert.ok(x.seen.length >= 1 && x.seen.every((s) => s.u.startsWith('https://ohhmyagent.com')), 'Routeway Gemma no lee fotos: no se usa'); assert.equal(x.r.status, 502);
});

test('servidor: pistas de correcciones (máx. 20, sin DNI ni correos) van al prompt', async () => {
  const hints = [{ campo: 'um', de: 'UNID', a: 'UNIDAD' }, { campo: 'cod', de: '45678912', a: 'X' }, { campo: 'nombre', de: 'a', a: 'b' }, ...Array.from({ length: 30 }, (_, i) => ({ campo: 'cod', de: 'c' + i, a: 'd' + i }))];
  assert.equal(cleanHints(hints).length, 18); // 20 primeros, menos el DNI y el campo inválido
  const x = await route({ image: IMG, hints });
  const t = x.seen[0].b.messages[1].content[0].text; assert.match(t, /um «UNID» -> «UNIDAD»/); assert.ok(!t.includes('45678912'));
});

// ---------- cliente: puras ----------
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
test('giro: rotateSpec/compose dejan la foto dentro del lienzo (90/180/270 y EXIF 1..8)', () => {
  for (const deg of [0, 90, 180, 270, -90, 450]) { const r = B.rotateSpec(deg, 40, 30); const pts = [[0, 0], [40, 0], [0, 30], [40, 30]].map(([x, y]) => apply(r.m, x, y));
    for (const [x, y] of pts) assert.ok(x >= -1e-9 && x <= r.w + 1e-9 && y >= -1e-9 && y <= r.h + 1e-9, deg + ':' + x + ',' + y); }
  assert.deepEqual([B.rotateSpec(90, 40, 30).w, B.rotateSpec(90, 40, 30).h], [30, 40]); assert.equal(B.rotateSpec(-90, 1, 1).deg, 270);
  // 90° horario: la esquina de arriba a la izquierda queda arriba a la derecha
  assert.deepEqual(apply(B.rotateSpec(90, 40, 30).m, 0, 0), [30, 0]);
  for (let o = 1; o <= 8; o++) for (const deg of [0, 90]) { const c = B.compose(o, deg, 40, 30); for (const [x, y] of [[0, 0], [40, 0], [0, 30], [40, 30]].map(([a, b]) => apply(c.m, a, b))) assert.ok(x >= -1e-9 && x <= c.w + 1e-9 && y >= -1e-9 && y <= c.h + 1e-9, o + '/' + deg); }
  assert.deepEqual([B.compose(6, 0, 40, 30).w, B.compose(6, 0, 40, 30).h], [30, 40]); assert.deepEqual([B.compose(6, 90, 40, 30).w, B.compose(6, 90, 40, 30).h], [40, 30]);
  assert.equal(B.fitScale(4000, 3000, 2000), 0.5); assert.equal(B.fitScale(100, 50, 2000), 1);
  assert.equal(B.dataUrlBytes('data:image/jpeg;base64,QUJD'), 3); assert.equal(B.dataUrlBytes('data:image/jpeg;base64,QUI='), 2);
  assert.equal(B.LIMITS.IMG_MAX_BYTES, 4 * 1024 * 1024);
});
test('EXIF: se lee la orientación de un JPEG (II y MM); sin EXIF -> 1', () => {
  const jpeg = (le, o) => { const b = new Uint8Array(40); const v = new DataView(b.buffer); v.setUint16(0, 0xFFD8); v.setUint16(2, 0xFFE1); v.setUint16(4, 30); v.setUint32(6, 0x45786966);
    const t = 12; v.setUint16(t, le ? 0x4949 : 0x4D4D); v.setUint16(t + 2, 42, le); v.setUint32(t + 4, 8, le); v.setUint16(t + 8, 1, le); v.setUint16(t + 10, 0x0112, le); v.setUint16(t + 12, 3, le); v.setUint32(t + 14, 1, le); v.setUint16(t + 18, o, le); return b.buffer; };
  assert.equal(B.exifOrientation(jpeg(true, 6)), 6); assert.equal(B.exifOrientation(jpeg(false, 8)), 8); assert.equal(B.exifOrientation(new Uint8Array([0x89, 0x50]).buffer), 1);
});
test('aprendizaje: pares leído->corregido (cod, descripción, unidad), coincidencia exacta, tope 300, pistas top 20, borrar', () => {
  store.clear();
  const items = [{ cant: 2, um: 'UNIDAD', cod: 'ARZ-1', descripcion: 'Arroz Costeño 1kg', precio_unit: 4.5, importe: 9, _orig: { cant: 2, um: 'UNID', cod: 'AR2-1', descripcion: 'Arroz Costeno 1kg', precio_unit: 4.5, importe: 9 } },
    { cant: 1, um: 'UNID', cod: 'X', descripcion: 'Cliente 45678912', _orig: { cant: 1, um: 'UNID', cod: 'X', descripcion: 'Cliente 4567891' } }];
  const pairs = B.correctionsOf(items);
  assert.deepEqual(pairs, [{ campo: 'cod', de: 'AR2-1', a: 'ARZ-1' }, { campo: 'um', de: 'UNID', a: 'UNIDAD' }], 'tildes iguales no cuentan; con 8+ dígitos no se guarda');
  assert.equal(B.countEdits(items), 4);
  B.learnAdd(pairs);
  const b = B.prep({ numero: 'B1', items: [{ cant: 3, um: 'unid', cod: 'ar2-1', descripcion: 'Fideos', precio_unit: 2, importe: 6 }], total: 6 });
  assert.equal(b.applied, 2); assert.equal(b.items[0].um, 'UNIDAD'); assert.equal(b.items[0].cod, 'ARZ-1'); assert.deepEqual(b.items[0]._applied, { um: true, cod: true });
  assert.equal(b.items[0]._orig.cod, 'ar2-1', 'lo leído queda aparte para medir correcciones');
  for (let i = 0; i < 400; i++) B.learnAdd([{ campo: 'cod', de: 'c' + i, a: 'd' + i }]);
  assert.equal(B.learnRead().length, 300); B.learnAdd([{ campo: 'cod', de: 'c399', a: 'd399' }]); B.learnAdd([{ campo: 'cod', de: 'c399', a: 'z' }]);
  const h = B.learnHints(); assert.equal(h.length, 20); assert.deepEqual(h[0], { campo: 'cod', de: 'c399', a: 'z' });
  B.learnClear(); assert.equal(B.learnRead().length, 0);
  assert.match(BOL_SRC, /esto es aprender de sus correcciones, no entrenar al modelo/); assert.match(BOL_SRC, /corregido por historial/);
});
test('revisión: suma vs total, null resaltado, seenKey y buscar producto por código o nombre', () => {
  assert.deepEqual(B.checks({ numero: 'B1', fecha: null, total: '10', items: [{ cant: 1, um: 'U', cod: 'a', descripcion: 'b', precio_unit: 4, importe: 4 }] }).total_mismatch, true);
  assert.equal(B.checks({ numero: 'B1', fecha: 'x', total: 4, items: [{ cant: 1, um: 'U', cod: 'a', descripcion: 'b', precio_unit: 4, importe: '4,00' }] }).total_mismatch, false);
  assert.equal(B.seenKey({ numero: 'b001 - 123', total: '12.6' }), 'B001123|12.60'); assert.equal(B.seenKey({ numero: null, total: 1 }), null);
  const P = [{ id: 7, name: 'Arroz 1kg', sku: 'P1' }, { id: 8, name: 'Azúcar', barcode: '775' }];
  assert.equal(B.matchProduct({ cod: 'p1' }, P).id, 7); assert.equal(B.matchProduct({ cod: null, descripcion: 'azucar' }, P).id, 8); assert.equal(B.matchProduct({ cod: 'zz', descripcion: 'otro' }, P), null);
});

// ---------- cliente: flujo con proveedor simulado ----------
function host(replies) {
  const doc = makeDoc(), msgs = doc.createElement('div'), calls = [], said = [], filled = [];
  const ctx = { doc, productos: () => [{ id: 7, name: 'Arroz 1kg', sku: 'P1' }],
    post: async (path, body) => { calls.push({ path, body }); const r = replies.shift(); if (r instanceof Error) throw r; return r; },
    card: (cls) => { const m = doc.createElement('div'); m.className = 'na-asst-msg a ' + cls; msgs.appendChild(m); return m; },
    say: (t) => said.push(t), state() {}, busy() {},
    openPurchase: () => ({ id: 'naPurchaseDialog' }), fillPurchase: (w, p) => filled.push(p) };
  return { ctx, doc, msgs, calls, said, filled };
}
const dec = { src: {}, w: 40, h: 30, exif: 1 };
test('auto-giro: si el modelo dice «rotacion» (o casi todo null) se gira en el aparato y se reintenta UNA sola vez; se muestra la foto derecha', async () => {
  store.clear();
  const h = host([{ ok: true, boleta: { ...GOOD, rotacion: 90, items: [] }, checks: { mostly_null: true } }, { ok: true, boleta: { ...GOOD, total: 12.6, fecha: '2026-10-21', rotacion: 0 }, checks: { mostly_null: false } }]);
  await B.readAt(dec, 0, h.ctx, true);
  assert.equal(h.calls.length, 2, 'un solo reintento'); assert.equal(h.calls[0].path, '/auth/assistant/boleta'); assert.match(h.calls[0].body.image, /^data:image\/jpeg;base64,/);
  const card = h.msgs.byClass('na-asst-bol')[0]; assert.ok(card, 'pantalla de revisión'); assert.equal(card.byClass('na-asst-bol-img')[0].alt, 'Boleta enderezada');
  // ya derecha: no reintenta
  const h2 = host([{ ok: true, boleta: { ...GOOD, total: 12.6 }, checks: { mostly_null: false } }]); await B.readAt(dec, 0, h2.ctx, true); assert.equal(h2.calls.length, 1);
  // giro manual (botones): no hay reintento automático
  const h3 = host([{ ok: true, boleta: { ...GOOD, rotacion: 180 }, checks: { mostly_null: false } }]); await B.readAt(dec, 90, h3.ctx, false); assert.equal(h3.calls.length, 1);
  const rot = h2.msgs.byClass('na-asst-bol-rot')[0].byTag('button').map((b) => b.textContent); assert.deepEqual(rot, ['⟲ 90°', '⟳ 90°', '180°']);
});
test('revisión: null en amarillo, aviso de total; «Confirmar» NO guarda nada: solo prellena «Nueva compra», aprende lo corregido; boleta repetida pide «Sí, es otra compra»', async () => {
  store.clear();
  const h = host([{ ok: true, boleta: { ...GOOD, total: 20 }, checks: {} }]);
  await B.readAt(dec, 0, h.ctx, false);
  const card = h.msgs.byClass('na-asst-bol')[0];
  assert.ok(card.byClass('na-asst-bol-null').length >= 2, 'lo ilegible resaltado'); assert.match(card.byClass('na-asst-bol-warn')[0].textContent, /no coincide con el total/);
  const um = card.byClass('na-asst-bol-um')[0]; um.value = 'UNIDAD'; um.dispatch('input');
  const tot = card.byTag('input')[2]; tot.value = '12.60'; tot.dispatch('input'); assert.doesNotMatch(card.byClass('na-asst-bol-warn')[0].textContent, /no coincide/);
  const ok = card.byClass('na-asst-ok')[0]; ok.click();
  assert.equal(h.filled.length, 1); const p = h.filled[0];
  assert.equal(p.documento, 'B001-123'); assert.deepEqual(p.lineas.map((l) => [l.product_id, l.cantidad, l.costo_unitario]), [[7, 2, 4.5], [null, 1, 3.6]]);
  assert.deepEqual(B.learnRead().map((x) => [x.campo, x.de, x.a]), [['um', 'UNID', 'UNIDAD']]);
  assert.ok(h.said.some((t) => /Registrar compra/.test(t)));
  // la misma boleta otra vez en este aparato -> aviso y botón rojo, sin prellenar hasta confirmar
  const h2 = host([{ ok: true, boleta: { ...GOOD, total: 12.6 }, checks: {} }]); await B.readAt(dec, 0, h2.ctx, false);
  const ok2 = h2.msgs.byClass('na-asst-bol')[0].byClass('na-asst-ok')[0]; ok2.click(); assert.equal(h2.filled.length, 0); assert.equal(ok2.textContent, 'Sí, es otra compra');
  ok2.click(); assert.equal(h2.filled.length, 1);
  // el módulo no escribe en la base ni llama a guardar: solo /auth/assistant/boleta
  assert.doesNotMatch(BOL_SRC, /\/commands\/|purchase\.create|NA_PURCHASES\.save|codigos-duplicados/);
});
test('errores: tiempo (90 s) y foto ilegible se explican; el aparato mide lecturas para la revisión del POS', async () => {
  const seen = []; globalThis.NA_ASISTENTE_REVISION = { ocr: (x) => seen.push(x) };
  const h = host([{ error: 'boleta_timeout', status: 504 }]); await B.readAt(dec, 0, h.ctx, false); assert.match(h.said[0], /más de 90 s/);
  const h2 = host([{ error: 'boleta_unreadable' }, { error: 'boleta_unreadable' }]); await B.readAt(dec, 0, h2.ctx, true); assert.equal(h2.calls.length, 2); assert.match(h2.said[0], /No pude leer esa boleta/);
  assert.deepEqual(seen.map((x) => [x.ok, x.timeout]), [[false, true], [false, false], [false, false]]);
  delete globalThis.NA_ASISTENTE_REVISION;
  assert.equal(B.LIMITS.CLIENT_TIMEOUT_MS >= 90000, true);
});

// ---------- UI y Worker ----------
test('UI: solo Admin (chip y texto), carga diferida del módulo, foto por el mismo selector; ruta en el Worker con la bandera', () => {
  const chips = UI.slice(UI.indexOf('function chipsHtml()'), UI.indexOf('function chipsHtml()') + 1400).split('\n');
  assert.match(chips[1], /if \(isOwnerAccess\(\)\) return .*\(canPhoto\(\) \? '<button type="button" data-boleta>Leer boleta con IA<\/button>' : ''\)/);
  assert.ok(!chips.slice(2, 4).join('\n').includes('data-boleta'));
  assert.match(UI, /if \(!image && isOwnerAccess\(\) && BOLETA_RE\.test\(text\)\) \{ inputEl\.value = ''; return boletaPick\(\); \}/);
  assert.match(UI, /sc\.src = 'js\/modules\/asistente\/asistente-boleta\.js'/);
  assert.match(UI, /if \(mode === 'boleta'\) \{ if \(isOwnerAccess\(\)\) got\.then\(function \(r\) \{ boletaStart\(r\.blob\); \}, function \(\) \{\}\); return; \}/);
  const re = new RegExp(UI.match(/var BOLETA_RE = \/(.*)\/i;/)[1], 'i'); for (const t of ['Lee esta boleta', 'leer boleta', 'boleta con IA']) assert.match(t, re, t);
  assert.match(WORKER, /if \(url\.pathname === ASSISTANT_BOLETA_PATH\) \{\n\s+if \(String\(env\.ASSISTANT_ENABLED \|\| ''\) !== '1'\) return json\(\{ error: 'not_found' \}, 404\);\n\s+const auth = await authorizeSession\(request, env\);/);
  assert.doesNotMatch(BOL_SRC, /\.innerHTML\s*=|insertAdjacentHTML/);
});

// (auditoría OCR-021) Lista manuscrita derecha con dos precios ilegibles: la 1.ª lectura deja null (bien) y sale «casi todo null»
// porque una lista no tiene cant/um/cod/importe. Antes se giraba igual y la relectura girada (que el modelo dice «rotacion 270»)
// inventaba 165.20 y 2.75. Regla: solo se relee girada si el modelo dijo que estaba girada o si la 1.ª lectura no tiene NADA legible.
const LISTA = (precios, rot) => ({ numero: null, fecha: null, total: null, rotacion: rot, items: [['Arroz Costeño 50 kg', precios[0]], ['Azúcar rubia 50 kg', precios[1]], ['Aceite Primor caja 12', precios[2]], ['Leche Gloria 24 x 395', precios[3]], ['Fideo Don Vittorio', precios[4]]]
  .map(([descripcion, precio_unit]) => ({ cant: null, um: null, cod: null, descripcion, precio_unit, importe: null })) });
test('OCR-021: con datos legibles y sin giro detectado NO se relee girada; lo ilegible sigue null (no se rellena con la relectura)', async () => {
  store.clear();
  const h = host([{ ok: true, boleta: LISTA([182, null, 118.5, 91, null], 0), checks: { mostly_null: true } }, { ok: true, boleta: LISTA([182, 165.2, 118.5, 91, 2.75], 270), checks: { mostly_null: true } }]);
  await B.readAt(dec, 0, h.ctx, true);
  assert.equal(h.calls.length, 1, 'sin relectura girada');
  const card = h.msgs.byClass('na-asst-bol')[0];
  assert.deepEqual(card.byClass('na-asst-bol-precio_unit').map((i) => i.value), ['182', '', '118.5', '91', '']);
  assert.match(card.byClass('na-asst-bol-warn')[0].textContent, /no se leyeron|Casi nada se pudo leer/);
});
test('OCR-021: foto sin nada legible (o con giro detectado) sí se relee girada UNA vez y se usa la lectura derecha', async () => {
  store.clear();
  const blank = { numero: null, fecha: null, total: null, rotacion: 0, items: [{ cant: null, um: null, cod: null, descripcion: null, precio_unit: null, importe: null }] };
  const h = host([{ ok: true, boleta: blank, checks: { mostly_null: true } }, { ok: true, boleta: { ...GOOD, total: 12.6, rotacion: 0 }, checks: { mostly_null: false } }]);
  await B.readAt(dec, 0, h.ctx, true);
  assert.equal(h.calls.length, 2);
  assert.equal(h.msgs.byClass('na-asst-bol')[0].byClass('na-asst-bol-descripcion')[0].value, 'Arroz 1kg');
  const h2 = host([{ ok: true, boleta: { ...GOOD, rotacion: 90 }, checks: { mostly_null: false } }, { ok: true, boleta: { ...GOOD, total: 12.6, rotacion: 0 }, checks: { mostly_null: false } }]);
  await B.readAt(dec, 0, h2.ctx, true);
  assert.equal(h2.calls.length, 2, 'el modelo dijo que estaba girada');
});
