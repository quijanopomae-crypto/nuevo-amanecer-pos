// Auditoría 500, unidades y cajas (UNI-007, UNI-018/019, UNI-032, UNI-033): «caja», «display» y «paquete» NO son unidades.
// Tamaño sacado del nombre = provisional (nunca arma tarjetas de stock); tamaño confirmado = el de la ficha (units_per_box), que el Admin
// guarda con la tarjeta «Guardar tamaño de caja» (un toque «Aplicar», sin PIN, solo Admin, en la bitácora). Precio de lista o factura =
// «precio del proveedor». Nombres de productos de la evidencia (docs/auditoria-500/evidencia/unidades-001-035), datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCanon } from '../cloud-sync/canon-browser-harness.mjs';
import { assistantChatRoute, buildDeepSeekRequest, toolsForRole, toolAllowed, createMemoryUsageStore, readLessons, payloadBytes } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { LEVELS_PATH } from '../../tools/cloudflare-lab/src/pos-assistant-levels-route.js';
import { canonicalReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

const T = await import('../../tools/cloudflare-lab/src/pos-assistant-tamanos.js').catch(() => ({}));
const SECRET = 'secreto-de-prueba-0123456789abcdef';
const WAFER = 'WAFER NIK CHICO 12PQT X 6UND', FOSF = 'FOSFORERA SIN LINTERNA 20 DIS X 50UN', GLORIA = 'LECHE GLORIA EVAPORADA 48 LATAS X 170GR';
const P = (id, nombre, extra = {}) => ({ id, nombre, stock: 50, min: 0, costo: 1, precio: 2.4, controla: true, caja: null, precio_caja: null, ...extra });

function modelReturning({ name, args, content = '' }, seen = []) {
  return async (url, init) => {
    seen.push(JSON.parse(init.body));
    const msg = name ? { content, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { content };
    return new Response(JSON.stringify({ choices: [{ message: msg }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  };
}
async function chat({ text, products, call = {}, role = 'owner', history = [], store = createMemoryUsageStore(), seen = [] }) {
  const reader = { products: async () => products, productsById: async (ids) => new Map(products.filter((p) => ids.includes(String(p.id))).map((p) => [String(p.id), p])) };
  const body = JSON.stringify({ text, history, context: { products: products.map(({ id, nombre, stock, precio, costo, controla }) => ({ id, nombre, stock, precio, costo, controla })) } });
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:dueno', posRole: role },
    (d, s = 200) => new Response(JSON.stringify(d), { status: s }), { store, resolveRole: async () => role, fetch: modelReturning(call, seen), reader });
  return { status: r.status, body: await r.json(), store, seen };
}

// ---------- tamaño según el nombre: siempre provisional ----------
test('nameSize/packInfo: lee cajas, displays y paquetes del nombre (sin gramos ni mililitros) y lo marca provisional', () => {
  assert.equal(typeof T.nameSize, 'function', 'falta pos-assistant-tamanos.js');
  assert.deepEqual(T.nameSize(WAFER), { unidades: 72, paquete: 6 });
  assert.deepEqual(T.nameSize(FOSF), { unidades: 1000, display: 50 });
  assert.deepEqual(T.nameSize('FOSFORERA CON LINTERNA 12 DIS X 25UN'), { unidades: 300, display: 25 });
  assert.deepEqual(T.nameSize('MINI PIRATAS X 24 UNID X 12 GR X 20 DISP'), { unidades: 480, display: 24 });
  assert.deepEqual(T.nameSize('ACEITE PRIMOR CLASICO 900ML X 12BOT'), { unidades: 12 });
  assert.deepEqual(T.nameSize('CHUPETIN GLOBO POP 30BOL X 24UND'), { unidades: 720, paquete: 24 });
  assert.deepEqual(T.nameSize('LECHE GLORIA EVAPORADA 395GR CAJA CERRADA X 24'), { unidades: 24 });
  assert.deepEqual(T.nameSize(GLORIA), { unidades: 48 });
  assert.deepEqual(T.nameSize('PANADOL ANTIGRIPAL CAJA X 100 TAB'), { unidades: 100 });
  assert.equal(T.nameSize('ARROZ COSTEÑO 750 GR'), null);
  assert.equal(T.nameSize('GASEOSA INCA KOLA 1.5 LT'), null);
  assert.deepEqual(T.packInfo(P('u05', WAFER)), { unidades: 72, paquete: 6, estado: 'provisional', nota: 'provisional, según el nombre' });
  assert.deepEqual(T.packInfo(P('u05', WAFER, { caja: 60 })), { unidades: 60, estado: 'confirmado' });
  assert.equal(T.PROVISIONAL_LABEL, 'provisional, según el nombre');
});

// ---------- UNI-033 ----------
test('UNI-033: «tengo 1 caja» sin tamaño guardado: sin tarjeta de ajuste; pregunta cuántas trae y marca lo del nombre como provisional', async () => {
  const r = await chat({ text: 'pon el stock de wafer nik en 72 que tengo 1 caja', products: [P('u05', WAFER)],
    call: { name: 'proponer_ajuste_stock', args: { product_id: 'u05', tipo: 'entrada', cantidad: 22, motivo: 'Ajuste de inventario' }, content: 'Listo. Revisa y pulsa Confirmar.' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.proposals.filter((p) => p.type === 'ajuste').length, 0, 'no arma la tarjeta con 72 sacado del nombre');
  assert.match(r.body.reply, /¿Cuántas unidades trae la caja de WAFER NIK CHICO 12PQT X 6UND\?/);
  assert.match(r.body.reply, /72 \(provisional, según el nombre\)/);
  assert.doesNotMatch(r.body.reply, /pulsa Confirmar/);
  assert.ok(r.body.dropped.some((d) => d.reason === 'tamano_sin_confirmar'));
});
test('UNI-033: con el tamaño confirmado en la ficha la tarjeta sale y la respuesta dice que usó la caja guardada', async () => {
  const r = await chat({ text: 'pon el stock de wafer nik en 72 que tengo 1 caja', products: [P('u05', WAFER, { caja: 72, precio_caja: 30 })],
    call: { name: 'proponer_ajuste_stock', args: { product_id: 'u05', tipo: 'entrada', cantidad: 22, motivo: 'Ajuste de inventario' } } });
  assert.equal(r.body.proposals.filter((p) => p.type === 'ajuste').length, 1);
  assert.match(r.body.reply, /caja guardada en la ficha de WAFER NIK CHICO 12PQT X 6UND: 72 unidades/);
});
test('UNI-033: si la persona dice cuántas trae la caja en el mensaje, la tarjeta sale sin volver a preguntar', async () => {
  const r = await chat({ text: 'tengo 1 caja de wafer nik, la caja trae 72, ponlo en 72', products: [P('u05', WAFER)],
    call: { name: 'proponer_ajuste_stock', args: { product_id: 'u05', tipo: 'entrada', cantidad: 22, motivo: 'Ajuste de inventario' } } });
  assert.equal(r.body.proposals.filter((p) => p.type === 'ajuste').length, 1);
  assert.doesNotMatch(r.body.reply, /¿Cuántas unidades trae/);
});

// ---------- UNI-032 ----------
test('UNI-032: «guarda que todas las cajas traen 12»: sin «¿Confirmas?», ofrece ir producto por producto y no guarda lección', async () => {
  const r = await chat({ text: 'guarda que todas las cajas traen 12', products: [P('u01', 'LECHE GLORIA EVAPORADA 395GR X 24'), P('u02', GLORIA)], content: '' ,
    call: { content: 'Entendido. ¿Confirmas que todas las cajas traen 12 unidades?' } });
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.body.reply, /¿Confirmas/);
  assert.match(r.body.reply, /No puedo guardar una regla para todas las cajas/);
  assert.match(r.body.reply, /uno por uno/);
  assert.equal(r.body.proposals.filter((p) => p.needsConfirm).length, 0);
  assert.deepEqual(await readLessons(r.store, { principalId: 'session:dueno', posRole: 'owner' }, Date.now()), []);
});

// ---------- UNI-018 / UNI-019 ----------
test('UNI-018/019: «son 2 cajas» / «eran 2 displays»: el modelo recibe el tamaño conocido (provisional con su marca) y la regla de recalcular', async () => {
  const products = [P('u08', FOSF), P('u05', WAFER, { caja: 72 })];
  const history = [{ role: 'user', content: 'me llegaron fosforeras sin linterna' }, { role: 'assistant', content: '¿Cuántas te llegaron?' }];
  const a = await chat({ text: 'son 2 cajas grandes', products, history, call: { content: '2 cajas son 2000 unidades.' } });
  const req = a.seen[0], all = JSON.stringify(req.messages);
  assert.match(req.messages[0].content, /«son 2 cajas»/);
  assert.match(req.messages[0].content, /no lo vuelvas a preguntar/);
  assert.match(all, /<tamanos_caja>/);
  assert.match(all, /FOSFORERA SIN LINTERNA 20 DIS X 50UN\\",\\"unidades_por_caja\\":1000,\\"por_display\\":50,\\"estado\\":\\"provisional, según el nombre/);
  const b = await chat({ text: 'no no, eran 2 displays nomas', products, history: [...history, { role: 'user', content: 'son 2 cajas grandes' }, { role: 'assistant', content: '2 cajas son 2000 unidades.' }], call: { content: '2 displays son 100 unidades.' } });
  assert.match(JSON.stringify(b.seen[0].messages), /por_display\\":50/);
  // el confirmado se dice como confirmado
  const c = await chat({ text: 'son 3 cajas de wafer nik', products, call: { content: 'ok' } });
  assert.match(JSON.stringify(c.seen[0].messages), /WAFER NIK CHICO 12PQT X 6UND\\",\\"unidades_por_caja\\":72,\\"estado\\":\\"confirmado/);
});

// ---------- herramienta y bytes ----------
test('guardar_tamano_caja: solo Admin y solo cuando el mensaje habla de cajas (el primer pedido no crece)', () => {
  const names = (role, text) => buildDeepSeekRequest({ role, ctx: { products: [] }, history: [], text }).tools.map((t) => t.function.name);
  assert.ok(names('owner', 'la caja de wafer nik trae 72, guárdalo').includes('guardar_tamano_caja'));
  assert.ok(!names('owner', 'hola, cuánto vendí hoy').includes('guardar_tamano_caja'));
  for (const lvl of ['1', '2', '3']) { assert.equal(toolAllowed('empleado:' + lvl, 'guardar_tamano_caja'), false); assert.ok(!toolsForRole('empleado:' + lvl).some((t) => t.function.name === 'guardar_tamano_caja')); }
  const sys = buildDeepSeekRequest({ role: 'owner', ctx: { products: [] }, history: [], text: 'hola' }).messages[0].content;
  assert.doesNotMatch(sys, /CAJAS, DISPLAYS Y PAQUETES/);
  console.log('primer pedido Admin (hola): ' + payloadBytes(buildDeepSeekRequest({ role: 'owner', ctx: { products: [] }, history: [], text: 'hola' })) + ' bytes');
});

// ---------- tarjeta «Guardar tamaño de caja» (base real) ----------
const MIG = ['0024_pos_roles_owner_pin.sql', '0025_pos_reviews_pin_failures.sql', '0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql',
  '0016_canonical_generic_sale_lines.sql', '0017_canonical_live_customers.sql', '0018_canonical_customer_credit_policy.sql', '0020_canonical_customer_contacts.sql', '0022_canonical_product_revisions.sql'];
async function setup(t) {
  const f = await activeCanon(t, { migrations: MIG });
  Object.assign(f.env, { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' });
  f.addDevice('dueno', 'writer', 'active', 'tok-dueno'); f.addDevice('emp', 'writer', 'active', 'tok-emp');
  const at = new Date().toISOString();
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,label,created_by,created_at) VALUES('session:dueno','owner','Dueño','test',?)", at);
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,label,created_by,created_at) VALUES('session:emp','empleado','Caja 2','session:dueno',?)", at);
  const call = async (tok, path, body, method = 'POST') => {
    const r = await f.fetch('http://localhost' + path, { method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const raw = await r.text(); let b = null; try { b = JSON.parse(raw); } catch { b = raw; } return { status: r.status, body: b };
  };
  assert.equal((await call('tok-dueno', LEVELS_PATH, { device_id: 'session:emp', nivel: 3 })).status, 200); // nivel 3 (el más alto de empleado)
  return { f, call };
}
test('tarjeta tamano_caja: el Admin aplica con un toque (sin PIN), se escribe units_per_box + box_price_cents, bitácora; reenvío no duplica', async (t) => {
  const { f, call } = await setup(t);
  const prod = f.sql("SELECT product_id,name,price_cents,units_per_box,box_price_cents FROM products WHERE promotion_id=(SELECT active_promotion_id FROM canonical_control WHERE id=1) LIMIT 1");
  assert.ok(prod, 'el fixture trae productos importados');
  const real = globalThis.fetch; const seen = [];
  globalThis.fetch = modelReturning({ name: 'guardar_tamano_caja', args: { product_id: prod.product_id, unidades: 24, precio_caja: 55.5 } }, seen);
  t.after(() => { globalThis.fetch = real; });
  const ctx = { products: [{ id: prod.product_id, nombre: prod.name, stock: 5, precio: prod.price_cents / 100 }] };
  const c = await call('tok-dueno', '/auth/assistant/chat', { text: 'la caja de ' + prod.name + ' trae 24, a 55.50 la caja, guárdalo', context: ctx });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const card = c.body.proposals.find((p) => p.type === 'tamano_caja');
  assert.ok(card, JSON.stringify(c.body.dropped));
  assert.equal(card.boton, 'Aplicar'); assert.equal(card.requiresRole, 'owner'); assert.equal(card.unidades, 24); assert.equal(card.precio_caja, 55.5);
  assert.equal(card.unidades_antes, prod.units_per_box > 0 ? prod.units_per_box : null);
  const { confirm_token, ...proposal } = card;
  // el empleado (nivel 3) no la aplica
  assert.equal((await call('tok-emp', '/auth/assistant/confirm', { token: confirm_token, proposal })).status, 403);
  const ok = await call('tok-dueno', '/auth/assistant/confirm', { token: confirm_token, proposal });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.proposal.resultado.unidades, 24);
  const rev = f.sql('SELECT units_per_box,box_price_cents,price_cents,name FROM canonical_product_revisions WHERE product_id=? ORDER BY revision DESC LIMIT 1', prod.product_id);
  assert.deepEqual({ ...rev }, { units_per_box: 24, box_price_cents: 5550, price_cents: prod.price_cents, name: prod.name });
  const again = await call('tok-dueno', '/auth/assistant/confirm', { token: confirm_token, proposal });
  assert.ok([200, 409].includes(again.status));
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_product_revisions WHERE product_id=?', prod.product_id).n, 1, 'un solo cambio');
  const audit = (await call('tok-dueno', '/auth/assistant/audit?limit=500', null, 'GET')).body;
  const rows = JSON.stringify(audit);
  assert.match(rows, /asistente\.caja/); assert.match(rows, /caja:[-\d]+->24/);
  // el lector del asistente ya ve el tamaño confirmado
  const list = await canonicalReader(f.env.DB).products();
  const seenP = list.find((p) => String(p.id) === String(prod.product_id));
  assert.equal(seenP.caja, 24); assert.equal(seenP.precio_caja, 55.5);
});
test('tarjeta tamano_caja: sin precio de caja (ni dicho ni en la ficha) no sale tarjeta: pregunta a cuánto vende la caja', async () => {
  const products = [P('u05', WAFER)];
  const reader = { products: async () => products, productsById: async () => new Map(), packSizes: async () => new Map([['u05', { caja: null, precio_caja: null }]]) };
  const body = JSON.stringify({ text: 'la caja de wafer nik trae 72, guárdalo', context: { products: [{ id: 'u05', nombre: WAFER, stock: 50, precio: 0.5 }] } });
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body }), { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' },
    { principalId: 'session:dueno', posRole: 'owner' }, (d, s = 200) => new Response(JSON.stringify(d), { status: s }),
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', fetch: modelReturning({ name: 'guardar_tamano_caja', args: { product_id: 'u05', unidades: 72 } }), reader });
  const b = await r.json();
  assert.equal(b.proposals.filter((p) => p.type === 'tamano_caja').length, 0);
  assert.match(b.reply, /a cuánto vendes la caja/i);
});

// ---------- UNI-007 ----------
test('UNI-007: un precio de la lista del proveedor sale marcado «precio del proveedor», no como precio de venta', async () => {
  const products = [P('u02', GLORIA, { precio: 2.4 })];
  const r = await chat({ text: 'cuanto vale la caja de gloria chica en la lista', products, call: { content: 'La caja de Gloria chica en la lista está a S/ 99.50.' } });
  assert.match(r.body.reply, /precio del proveedor/);
  assert.match(r.body.reply, /no (?:es )?tu precio de venta/);
  assert.match(r.seen[0].messages[0].content, /«precio del proveedor»/);
  const ok = await chat({ text: 'cuanto vale la caja de gloria chica en la lista', products, call: { content: 'En la lista, precio del proveedor: S/ 99.50 la caja. Tú lo vendes a S/ 2.40 la lata.' } });
  assert.equal((ok.body.reply.match(/precio del proveedor/g) || []).length, 1, 'no repite el aviso');
});
