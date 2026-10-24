// «Foto de producto» (solo Admin): servidor (JSON, null, código EAN/UPC verificado, 403 sin cupo, sin visión, tiempo) y
// cliente (aviso de duplicado, prellenado que NO guarda: solo abre «Nuevo producto»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assistantProductoFotoRoute, PRODUCTO_FOTO_PATH, PRODUCTO_FOTO_DENIED, PRODUCTO_FOTO_PROMPT, PRODUCTO_FOTO_LIMITS, barcodeValid, upcEToA, normalizeProductoFoto, productoFotoChecks } from '../../tools/cloudflare-lab/src/pos-assistant-producto-foto.js';
import { createMemoryUsageStore, IMAGE_UNSUPPORTED } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const P = require('../../POS/js/modules/asistente/asistente-producto-foto.js');
const WORKER = readFileSync('tools/cloudflare-lab/src/worker.js', 'utf8');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const SRC = readFileSync('POS/js/modules/asistente/asistente-producto-foto.js', 'utf8');
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const OK = (content) => jsonR({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
const K4 = 'clave-prueba-omyagent-4';
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(400);
const GOOD = { nombre: 'Paracetamol', marca: 'Genfar', presentacion: 'tableta', contenido: '500 mg', unidad: 'caja', codigo_barras: '7751271011259', precio_etiqueta: '3,50', categoria: 'Analgésicos', rotacion: 0 };

async function route(body, { role = 'owner', posRole = 'owner', env = { ASSISTANT_AI_API_KEY_4: K4 }, fetch, timeoutMs, raw, store } = {}) {
  const seen = [], st = store || createMemoryUsageStore();
  const f = fetch || (async () => OK(JSON.stringify(GOOD)));
  const r = await assistantProductoFotoRoute(new Request('https://w.test' + PRODUCTO_FOTO_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1', ...env }, { principalId: 'session:x', posRole }, jsonR,
    { store: st, resolveRole: async () => role, timeoutMs, fetch: async (u, i) => { seen.push({ u, i, b: JSON.parse(i.body) }); return f(u, i); } });
  return { r, d: await r.json(), seen, store: st };
}

test('servidor: lee la etiqueta como JSON, normaliza y arma el nombre sugerido', async () => {
  const x = await route({ image: IMG }, { fetch: async () => OK('<think>x</think>```json\n' + JSON.stringify(GOOD) + '\n```') });
  assert.equal(x.r.status, 200); assert.equal(x.d.ok, true);
  assert.equal(x.d.producto.nombre_sugerido, 'Paracetamol Genfar 500 mg');
  assert.equal(x.d.producto.codigo_barras, '7751271011259'); assert.equal(x.d.producto.precio_etiqueta, 3.5);
  assert.equal(x.d.checks.barcode_invalid, false); assert.equal(x.d.checks.mostly_null, false);
  assert.equal(x.seen.length, 1); const parts = x.seen[0].b.messages[1].content;
  assert.equal(parts[0].text, PRODUCTO_FOTO_PROMPT); assert.equal(parts[1].image_url.url, IMG);
});

test('servidor: empleado o aparato sin rol Admin = 403 sin llamar al modelo ni gastar cupo', async () => {
  for (const [role, posRole] of [['employee', 'employee'], ['owner', 'employee'], ['employee', 'owner'], [null, undefined]]) {
    const x = await route({ image: IMG }, { role, posRole });
    assert.equal(x.r.status, 403); assert.deepEqual(x.d, PRODUCTO_FOTO_DENIED); assert.equal(x.seen.length, 0);
    assert.equal(x.store._map.size, 0, 'el almacén del cupo no se toca');
  }
});

test('servidor: apagado 404, foto inválida 400, modelo sin visión 503, ilegible 422, demora 504', async () => {
  let x = await route({ image: IMG }, { env: { ASSISTANT_ENABLED: '0' } }); assert.equal(x.r.status, 404);
  x = await route(null, { raw: JSON.stringify({ image: 'data:image/jpeg;base64,' + 'A'.repeat(PRODUCTO_FOTO_LIMITS.bodyBytes) }) });
  assert.equal(x.r.status, 413); assert.equal(x.d.error, 'payload_too_large'); assert.equal(x.seen.length, 0); assert.equal(x.store._map.size, 0);
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(PRODUCTO_FOTO_LIMITS.imageBytes * 4 / 3) + 8);
  if (big.length + 20 < PRODUCTO_FOTO_LIMITS.bodyBytes) { x = await route({ image: big }); assert.equal(x.r.status, 413); }
  x = await route({ image: 'data:text/plain;base64,QQ==' }); assert.equal(x.r.status, 400); assert.equal(x.d.error, 'bad_image'); assert.equal(x.seen.length, 0);
  x = await route({ image: IMG }, { env: {} }); assert.equal(x.r.status, 503); assert.deepEqual(x.d, IMAGE_UNSUPPORTED);
  x = await route({ image: IMG }, { fetch: async () => OK('no sé leer esto') }); assert.equal(x.r.status, 422); assert.equal(x.d.error, 'producto_foto_unreadable');
  x = await route({ image: IMG }, { timeoutMs: 20, fetch: (u, i) => new Promise((_, ko) => i.signal.addEventListener('abort', () => ko(Object.assign(new Error('a'), { name: 'AbortError' })))) });
  assert.equal(x.r.status, 504); assert.equal(x.d.error, 'producto_foto_timeout');
});

test('código de barras: solo pasa con dígito de control correcto (EAN-13, EAN-8, UPC-A)', () => {
  assert.equal(barcodeValid('7751271011259'), true); assert.equal(barcodeValid('7751271011258'), false);
  assert.equal(barcodeValid('96385074'), true); assert.equal(upcEToA('04252614'), '042100005264'); assert.equal(barcodeValid('04252614'), true, 'UPC-E'); assert.equal(barcodeValid('04252615'), false); assert.equal(barcodeValid('036000291452'), true); assert.equal(barcodeValid('12345'), false);
  const p = normalizeProductoFoto({ ...GOOD, codigo_barras: '7751 2710 1125 8' });
  assert.equal(p.codigo_barras, null); assert.equal(p.codigo_leido, '7751271011258'); assert.equal(productoFotoChecks(p).barcode_invalid, true);
});

test('normaliza: null para lo ilegible, sin teléfonos/RUC/correos/enlaces en el nombre, precio y giro acotados', () => {
  assert.equal(normalizeProductoFoto({ nombre: 'Leche Gloria Tel. 987654321 cel: 912345678' }).nombre, 'Leche Gloria');
  const p = normalizeProductoFoto({ nombre: 'Galletas  Soda 987654321 ventas@x.pe https://x.pe', marca: '', contenido: null, precio_etiqueta: -2, rotacion: 45, codigo_barras: 'abc' });
  assert.equal(p.nombre, 'Galletas Soda'); assert.equal(p.marca, null); assert.equal(p.precio_etiqueta, null); assert.equal(p.rotacion, 0); assert.equal(p.codigo_leido, null);
  const e = normalizeProductoFoto({}); assert.equal(e.nombre_sugerido, null); assert.equal(productoFotoChecks(e).mostly_null, true);
});

test('cliente: avisa si ya existe (por código o nombre) y prellena sin código inválido ni precio inventado', () => {
  const productos = [{ id: 'p1', nombre: 'Paracetamol Genfar 500 mg', barcode: '' }, { id: 'p2', nombre: 'Otro', barcode: '7751271011259' }];
  assert.deepEqual(P.match(productos, { codigo_barras: '7751271011259', nombre_sugerido: 'x' }), { by: 'codigo', id: 'p2', nombre: 'Otro' });
  assert.deepEqual(P.match(productos, { nombre_sugerido: 'paracetamol genfar 500 MG' }), { by: 'nombre', id: 'p1', nombre: 'Paracetamol Genfar 500 mg' });
  assert.equal(P.match(productos, { nombre_sugerido: 'Arroz' }), null);
  const prod = normalizeProductoFoto(GOOD);
  // el precio de la etiqueta NO llena «Precio de venta»; la categoría va a pCat
  assert.deepEqual(P.prefill(prod, {}), { nombre: 'Paracetamol Genfar 500 mg', codigo_barras: '7751271011259', precio: null, costo: null, unidad: 'caja', categoria: 'Analgésicos' });
  assert.deepEqual(P.prefill(prod, { nombre: ' Paracetamol 500 ', codigo_barras: 'x!', precio: '4,20', costo: '2.1' }), { nombre: 'Paracetamol 500', codigo_barras: null, precio: 4.2, costo: 2.1, unidad: 'caja', categoria: 'Analgésicos' });
  assert.match(UI, /set\('pCat', p\.categoria\)/);
});

test('cliente: start() solo prellena «Nuevo producto»; no guarda ni llama a otra ruta', async () => {
  const posts = [], said = [], opened = [];
  const node = () => ({ children: [], className: '', textContent: '', value: '', appendChild(c) { this.children.push(c); }, setAttribute() {} });
  const doc = { createElement: node }; let card;
  const ctx = { doc, productos: () => [], post: async (p, b) => { posts.push(p); return { ok: true, producto: normalizeProductoFoto(GOOD), checks: { mostly_null: false } }; },
    card: () => (card = node()), say: (t) => said.push(t), state() {}, busy() {}, openNewProduct: (v) => { opened.push(v); return true; } };
  await P.start(IMG, ctx);
  assert.deepEqual(posts, [PRODUCTO_FOTO_PATH]); assert.equal(opened.length, 0);
  const btn = card.children.find((c) => c.textContent === 'Abrir «Nuevo producto»'); btn.onclick();
  assert.equal(opened.length, 1); assert.equal(opened[0].nombre, 'Paracetamol Genfar 500 mg'); assert.match(said[0], /pulse Guardar/);
  assert.deepEqual(posts, [PRODUCTO_FOTO_PATH]);
  assert.doesNotMatch(SRC, /product\.create|confirmRemote|\/auth\/assistant\/confirm|guardarProd/);
  const pf = card.children.find((c) => c.children && c.children[0] && c.children[0].textContent === 'Precio de venta S/');
  assert.equal(pf.children[1].value, '', 'el precio de la etiqueta no llena el campo');
});

test('cliente: foto girada se gira UNA vez y se vuelve a leer; si la segunda falla queda la primera', async () => {
  const node = () => ({ children: [], textContent: '', value: '', appendChild(c) { this.children.push(c); }, setAttribute() {} });
  const mk = (over) => { const posts = [], rots = []; let cards = 0;
    const ctx = { doc: { createElement: node }, productos: () => [], card: () => { cards++; return node(); }, say() {}, state() {}, busy() {}, openNewProduct() { return true; },
      rotate: async (s, g) => { rots.push(g); return 'data:image/jpeg;base64,QkJC'; },
      post: async (p, b) => { posts.push(b.image); return over(posts.length); } };
    return { ctx, posts, rots, cards: () => cards }; };
  const first = { ok: true, producto: normalizeProductoFoto({ ...GOOD, rotacion: 90 }), checks: { mostly_null: false } };
  let t = mk((n) => n === 1 ? first : { ok: true, producto: normalizeProductoFoto({ ...GOOD, nombre: 'Ibuprofeno', rotacion: 0 }), checks: { mostly_null: false } });
  await P.start(IMG, t.ctx); assert.deepEqual(t.rots, [90]); assert.equal(t.posts.length, 2); assert.equal(t.posts[1], 'data:image/jpeg;base64,QkJC'); assert.equal(t.cards(), 1);
  t = mk((n) => n === 1 ? first : { ok: false, error: 'producto_foto_unreadable' });
  await P.start(IMG, t.ctx); assert.equal(t.posts.length, 2); assert.equal(t.cards(), 1, 'queda la primera lectura');
  t = mk(() => ({ ...first, producto: normalizeProductoFoto(GOOD) }));
  await P.start(IMG, t.ctx); assert.equal(t.posts.length, 1, 'derecha: una sola lectura'); assert.deepEqual(t.rots, []);
});

test('cableado: ruta en el Worker con bandera y sesión; chip y disparador solo para el Admin; sin migraciones', () => {
  assert.match(WORKER, /ASSISTANT_PRODUCTO_FOTO_PATH\) \{\n\s+if \(String\(env\.ASSISTANT_ENABLED/);
  assert.match(UI, /function prodFotoPick\(\) \{ if \(!isOwnerAccess\(\) \|\| !canPhoto\(\)\) \{ errMsg\('producto_foto_admin_only'\)/);
  assert.match(UI, /isOwnerAccess\(\) && PRODFOTO_RE\.test\(text\)/);
  assert.match(UI, /if \(isOwnerAccess\(\)\) return '[^\n]*data-prodfoto/); // el chip vive en la rama del Admin
});

test('botones del Admin: «Sugerencias de compra» y «Foto de producto» juntos; la fila pasa a otra línea en 360 px', async () => {
  const fs = await import('node:fs');
  const ui = fs.readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../../POS/css/asistente.css', import.meta.url), 'utf8');
  const owner = ui.split('\n').find((l) => l.includes('if (isOwnerAccess()) return') && l.includes('data-prodfoto'));
  assert.ok(owner && owner.includes('Sugerencias de compra'), 'los dos botones en la misma fila del Admin');
  assert.match(css, /\.na-asst-chips\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.na-asst-chips button\{[^}]*max-width:100%[^}]*white-space:normal/);
});
