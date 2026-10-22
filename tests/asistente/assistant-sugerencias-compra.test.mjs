// Sugerencias de compra (solo Admin, solo lectura): qué y cuánto reponer con el stock, el mínimo y lo vendido en los últimos días.
// Nunca crea una compra ni cambia stock. Empleado: 403 query_admin_only. Al modelo: solo número de fila, código y cantidades
// (sin nombres de productos ni de clientes, sin DNI ni teléfonos). Datos inventados; el proveedor de IA siempre simulado (sin red).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assistantChatRoute, createMemoryUsageStore, toolsForRole, employeeQueryDenied, QUERY_ADMIN_ONLY } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { runAssistantQuery, memoryReader, canonicalReader, purchaseSuggestions, purchasePlan, isGenericProduct, isServiceProduct, GENERIC_PRODUCT_NAMES, SERVICE_CATEGORIES, QUERY_TYPES, SUGGEST_RULES } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { PROVIDERS } from '../../tools/cloudflare-lab/src/pos-assistant-providers.js';
import { activeCanon } from '../cloud-sync/canon-browser-harness.mjs';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const enc = new TextEncoder();
const SECRET = 'secreto-de-prueba-sugerencias-123';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const ENV = { AI_PROVIDER: 'deepseek', [PROVIDERS.deepseek.key]: 'sk-test-FAKE-sug' };
// 2026-10-22 12:00 Lima = 17:00Z. Ventana por defecto: 30 días (2026-09-23 a 2026-10-22).
const NOW = Date.parse('2026-10-22T17:00:00Z');
const day = (d, h = 15) => d + 'T' + String(h).padStart(2, '0') + ':00:00.000Z';

// Cliente del fixture (nombre, DNI y teléfono únicos). La consulta no lee clientes, así que para que la prueba de privacidad PUEDA
// fallar el mismo nombre va DENTRO del nombre de un producto (encargo anotado por la tienda): al modelo solo debe ir el código «PH».
const CLIENTE = { id: 'C77', nombre: 'Rosa Quispe Mamani', dni: '45678912', telefono: '987654321' };
const PH_NAME = 'Jarabe para la tos (encargo ' + CLIENTE.nombre + ')';
const PRODUCTS = [
  { id: 'PA', nombre: 'Paracetamol 500 mg', stock: 0, min: 5, costo: 0.2, precio: 0.5, controla: true },
  { id: 'PB', nombre: 'Ibuprofeno 400 mg', stock: 10, min: 2, costo: 0.3, precio: 0.8, controla: true },
  { id: 'PC', nombre: 'Alcohol 70° 250 ml', stock: 3, min: 5, costo: null, precio: 4, controla: true },
  { id: 'PD', nombre: 'Gasa estéril', stock: 2, min: 4, costo: 1.5, precio: 2.5, controla: true },
  { id: 'PE', nombre: 'Vitamina C', stock: 50, min: 5, costo: 0.4, precio: 1, controla: true },
  { id: 'PF', nombre: 'Consulta de presión', stock: 0, min: 0, costo: null, precio: 3, controla: false },
  { id: 'PG', nombre: 'Producto sin movimiento', stock: 0, min: 0, costo: 1, precio: 2, controla: true },
  { id: 'PH', nombre: PH_NAME, stock: 0, min: 2, costo: 5, precio: 9, controla: true },
  { id: 'PI', nombre: 'Suero oral', stock: -3, min: 2, costo: 2, precio: 3.5, controla: true }, // stock negativo (vendido sin stock)
  { id: 'PJ', nombre: 'Curitas surtidas', stock: -2, min: 0, costo: null, precio: 0.2, controla: true } // negativo, sin mínimo ni ventas
];
// Ventas en los últimos 30 días: PA 30 u, PB 60 u, PC 15 u, PE 30 u. Una venta ANULADA (PB 100 u) y una de hace 40 días (PD 99 u) no cuentan.
const SALES = [
  { sale_id: 'S1', created_at: day('2026-10-01'), metodo: 'efectivo', total_cents: 1000, cliente: CLIENTE.id },
  { sale_id: 'S2', created_at: day('2026-10-20'), metodo: 'credito', total_cents: 2000, cliente: CLIENTE.id },
  { sale_id: 'S3', created_at: day('2026-10-21'), metodo: 'yape', total_cents: 9999, anulada: true },
  { sale_id: 'S4', created_at: day('2026-09-12'), metodo: 'efectivo', total_cents: 9999 }
];
const ITEMS = [
  { sale_id: 'S1', product_id: 'PA', quantity: 20, line_total_cents: 1000 }, { sale_id: 'S1', product_id: 'PB', quantity: 30, line_total_cents: 2400 },
  { sale_id: 'S2', product_id: 'PA', quantity: 10, line_total_cents: 500 }, { sale_id: 'S2', product_id: 'PB', quantity: 30, line_total_cents: 2400 },
  { sale_id: 'S2', product_id: 'PC', quantity: 15, line_total_cents: 6000 }, { sale_id: 'S2', product_id: 'PE', quantity: 30, line_total_cents: 3000 },
  { sale_id: 'S3', product_id: 'PB', quantity: 100, line_total_cents: 8000 }, { sale_id: 'S4', product_id: 'PD', quantity: 99, line_total_cents: 9999 }
];
const DATA = { products: PRODUCTS, sales: SALES, saleItems: ITEMS, customers: [CLIENTE], credits: [{ cliente: CLIENTE.id, saldo: 55.5, vence: '2026-10-01' }], purchases: [] };
const EXPECTED_ORDER = ['PA', 'PI', 'PH', 'PB', 'PC', 'PD']; // PG y PJ (0/negativo, sin mínimo ni ventas) van a «stock sin contar»

test('cálculo puro: entra agotado (siempre), bajo mínimo o que se acaba en menos de 7 días; objetivo = mínimo + 14 días de venta (sin ventas: doble del mínimo)', () => {
  const sold = new Map([['PA', 30], ['PB', 60], ['PC', 15], ['PE', 30]]);
  const s = purchaseSuggestions(PRODUCTS, sold, 30);
  assert.deepEqual(s.map((x) => x.id), EXPECTED_ORDER, 'orden: agotados (más unidades primero), luego los que se acaban antes, luego sin ventas');
  const by = Object.fromEntries(s.map((x) => [x.id, x]));
  assert.equal(by.PA.sugerido, 19); assert.equal(by.PA.alcanza, 0); // 1 u/día: 5 + 14 − 0
  assert.equal(by.PH.sugerido, 4); assert.equal(by.PH.alcanza, null); // sin ventas: 2 × 2 − 0
  assert.equal(by.PB.sugerido, 20); assert.equal(by.PB.alcanza, 5); // 2 u/día: 2 + 28 − 10; alcanza 10/2 = 5 días
  assert.equal(by.PC.sugerido, 9); assert.equal(by.PC.alcanza, 6); // 0,5 u/día: 5 + 7 − 3
  assert.equal(by.PD.sugerido, 6); // sin ventas recientes: 4 × 2 − 2
  assert.equal(by.PA.costoEst, 3.8); assert.equal(by.PC.costoEst, null, 'sin costo: sin estimado');
  // Agotados con mínimo o con ventas: siempre entran. Sin mínimo ni ventas (PG, PJ): stock sin contar, no es compra.
  assert.ok(!by.PG && !by.PJ, 'sin contar: fuera de la lista');
  assert.equal(by.PH.sinDatos, false, 'con mínimo sí hay dato');
  // Stock negativo: se repone lo que falta para volver a 0 más el objetivo.
  assert.equal(by.PI.sugerido, 7); assert.equal(by.PI.stock, -3); assert.equal(by.PI.alcanza, null); // 2 × 2 − (−3)
  const neg = purchaseSuggestions([{ id: 'N', nombre: 'n', stock: -4, min: 1, controla: true }], new Map([['N', 30]]), 30);
  assert.equal(neg[0].sugerido, 19); assert.equal(neg[0].alcanza, 0); // 1 u/día: 1 + 14 − (−4); alcanza 0 días
  for (const id of ['PE', 'PF']) assert.ok(!by[id], id + ' no entra (le alcanza / sin control de stock)');
  assert.deepEqual(purchaseSuggestions([], new Map(), 30), []);
  assert.equal(SUGGEST_RULES.diasVentas, 30);
});

test('consulta en memoria: ventana de 30 días, anuladas fuera, totales y tabla con nombres solo para la pantalla', async () => {
  assert.ok(QUERY_TYPES.includes('sugerencias_compra'));
  const r = await runAssistantQuery(memoryReader(DATA), { tipo: 'sugerencias_compra' }, NOW);
  assert.ok(!r.error, JSON.stringify(r));
  assert.equal(r.desde, '2026-09-23'); assert.equal(r.hasta, '2026-10-22'); assert.equal(r.total, 6); assert.equal(r.truncado, false);
  assert.deepEqual(r.filas.map((f) => f[1]), EXPECTED_ORDER.map((id) => PRODUCTS.find((p) => p.id === id).nombre), 'la pantalla del dueño ve los nombres, en orden');
  assert.deepEqual(r.filas[0], [1, 'Paracetamol 500 mg', 0, 5, 30, 0, 19, 3.8]);
  assert.equal(r.resumen.productos_sugeridos, 6); assert.equal(r.resumen.unidades_total, 65); // 19 + 7 + 4 + 20 + 9 + 6
  assert.equal(r.resumen.costo_estimado_soles, 52.8); // 3.8 + 14 + 20 + 6 + 9 (PC sin costo)
  assert.equal(r.resumen.sin_costo, 1); assert.equal(r.resumen.dias_analizados, 30); assert.equal(r.resumen.truncado, false);
  assert.deepEqual(r.sin_contar, { total: 2, lista: [{ codigo: 'PJ', nombre: 'Curitas surtidas', stock: -2 }, { codigo: 'PG', nombre: 'Producto sin movimiento', stock: 0 }] });
  assert.deepEqual(r.resumen.sin_contar, { total: 2, codigos: ['PJ', 'PG'] });
  assert.deepEqual(r.revisar_datos, { total: 0, lista: [] }); assert.equal(r.genericos_excluidos, 0);
  assert.deepEqual(r.resumen.primeros.map((x) => x.codigo), EXPECTED_ORDER);
  assert.deepEqual(r.resumen.primeros.map((x) => x.fila), [1, 2, 3, 4, 5, 6]);
  assert.match(r.texto, /Sugiero reponer 6 productos: 65 unidades, unos S\/ 52\.80 según el costo registrado \(1 sin costo\)/); assert.match(r.texto, /2 productos están en 0 o en negativo, sin mínimo y sin ventas en 30 días: es stock sin contar/); assert.ok(!/Ojo/.test(r.texto)); assert.match(r.texto, /Registrar compra/);
  // Al modelo: ni nombres de productos ni nada del cliente. Control: la pantalla del dueño SÍ trae el nombre con la clienta.
  assert.ok(r.filas.some((f) => f[1] === PH_NAME));
  const sent = JSON.stringify(r.resumen);
  for (const p of PRODUCTS) assert.ok(!sent.includes(p.nombre), 'sin nombre de producto al modelo: ' + p.nombre);
  for (const v of [CLIENTE.nombre, 'Rosa', 'Quispe', CLIENTE.dni, CLIENTE.telefono]) assert.ok(!sent.includes(v), v);
  assert.ok(sent.length < 1500);
  // Período pedido: solo cuenta lo vendido en él.
  const oct = await runAssistantQuery(memoryReader(DATA), { tipo: 'sugerencias_compra', desde: '2026-10-15', hasta: '2026-10-22' }, NOW);
  assert.equal(oct.resumen.dias_analizados, 8);
  assert.equal(oct.resumen.primeros.find((x) => x.codigo === 'PB').vendidos, 30, 'solo S2 (la anulada S3 no cuenta)');
});

test('lectura cortada (muchas ventas o líneas): truncado llega al resultado, al texto, al modelo y a la tarjeta del dueño', async () => {
  const base = memoryReader(DATA);
  const reader = { ...base, async soldQty(p) { const m = await base.soldQty(p); m.truncated = true; return m; } };
  const r = await runAssistantQuery(reader, { tipo: 'sugerencias_compra' }, NOW);
  assert.equal(r.truncado, true); assert.equal(r.resumen.truncado, true); assert.match(r.texto, /Ojo: hay muchos datos y solo se leyó una parte/);
  const f = provider((n) => jsonR(n === 1 ? firstCall({ tipo: 'sugerencias_compra' }) : textReply('Revisa la tabla.')));
  const res = await route({ text: 'Dame las sugerencias de compra' }, { role: 'owner', fetch: f, reader });
  const d = await res.json(); const card = d.proposals.find((p) => p.type === 'consulta');
  assert.equal(card.result.truncado, true, 'la tarjeta lo sabe');
  assert.match(JSON.parse(f.calls[1]).messages.find((m) => m.role === 'tool').content, /"truncado":true/, 'el modelo lo sabe');
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  assert.match(UI, /r\.truncado \? '<div class="warn">Ojo: solo se leyó una parte de los datos\./, 'aviso visible en la tabla');
  // Lector canónico (#960): suma en SQL por producto (misma lectura de ventas que topItems) y se marca si se pasa del tope.
  const Q = readFileSync(new URL('../../tools/cloudflare-lab/src/pos-assistant-queries.js', import.meta.url), 'utf8');
  assert.match(Q, /async soldQty\(p\) \{\n\s+const rows = await salesSql\(p, 'i\.product_id AS product_id,SUM\(i\.quantity\) AS q'/);
  assert.match(Q, /m\.truncated = rows\.length > SOLD_QTY_MAX/);
});

// ---------- Puntos 2 y 4 (#929): genéricos y servicios fuera, «stock sin contar» y «revisar datos» aparte ----------
const prod = (id, nombre, stock, min = 0, extra = {}) => ({ id, nombre, stock, min, costo: 1, precio: 2, controla: true, ...extra });

test('genéricos: VARIOS, VERDURAS, RECARGAS, PRÉSTAMOS (sin tildes ni mayúsculas, entero o prefijo claro) y categoría servicios/servicio', () => {
  assert.deepEqual([...GENERIC_PRODUCT_NAMES], ['VARIOS', 'VERDURAS', 'RECARGAS', 'PRÉSTAMOS']); assert.ok(Object.isFrozen(GENERIC_PRODUCT_NAMES));
  assert.deepEqual([...SERVICE_CATEGORIES], ['servicios', 'servicio']);
  for (const n of ['VARIOS', 'varios', ' Verduras ', 'VERDURAS - kg', 'Recargas', 'RECARGA CLARO', 'PRÉSTAMOS', 'prestamos', 'Préstamo 50']) assert.equal(isGenericProduct({ nombre: n }), true, n);
  for (const n of ['VARIOSITO', 'Arroz verduras', 'Pila recargable', 'Recargador USB', 'PEPSI 500 ml', '', null]) assert.equal(isGenericProduct({ nombre: n }), false, String(n));
  for (const c of ['servicios', 'Servicios', 'SERVICIO', ' servicio ']) { assert.equal(isServiceProduct({ categoria: c }), true, c); assert.equal(isGenericProduct({ nombre: 'Pago luz', categoria: c }), true, c); }
  for (const c of ['abarrotes', 'servicios-extra', null, undefined]) assert.equal(isServiceProduct({ categoria: c }), false, String(c));
  // La lista se puede ampliar (p. ej. si el dueño decide que DULCES Y CARAMELOS es genérico).
  assert.equal(isGenericProduct({ nombre: 'DULCES Y CARAMELOS' }), false);
  assert.equal(isGenericProduct({ nombre: 'Dulces y caramelos' }, [...GENERIC_PRODUCT_NAMES, 'DULCES Y CARAMELOS']), true);
});

test('genéricos y servicios nunca entran en sugerencias, ni en sin contar ni en revisar datos (solo se cuentan)', () => {
  const list = [prod('G1', 'VERDURAS', -7660), prod('G2', 'VARIOS', 0), prod('G3', 'RECARGAS', -12, 5), prod('G4', 'Préstamos', 0),
    prod('S1', 'Pago de luz', 0, 3, { categoria: 'servicios' }), prod('S2', 'Free Fire', -2, 0, { categoria: 'servicio' }), prod('R1', 'Arroz', 0, 5)];
  const sold = new Map([['G1', 900], ['G2', 50], ['S1', 10], ['R1', 30]]);
  const plan = purchasePlan(list, sold, 30);
  assert.deepEqual(plan.sugerencias.map((x) => x.id), ['R1']); assert.deepEqual(plan.sinContar, []); assert.deepEqual(plan.revisarDatos, []);
  assert.equal(plan.genericos, 6);
  assert.deepEqual(purchaseSuggestions(list, sold, 30).map((x) => x.id), ['R1'], 'purchaseSuggestions sigue devolviendo solo la lista');
});

test('revisar datos: stock por debajo de −50 no es compra (aunque tenga ventas); −50 justo sí se sugiere', () => {
  const list = [prod('N1', 'Azúcar rubia', -80, 2), prod('N2', 'Aceite', -51), prod('N3', 'Fideos', -50, 0), prod('N4', 'Leche', -300, 0)];
  const plan = purchasePlan(list, new Map([['N1', 60], ['N3', 30]]), 30);
  assert.deepEqual(plan.revisarDatos.map((x) => [x.id, x.stock]), [['N4', -300], ['N1', -80], ['N2', -51]], 'más negativo primero');
  assert.equal(plan.revisarDatos.find((x) => x.id === 'N1').vendidos, 60);
  assert.deepEqual(plan.sugerencias.map((x) => x.id), ['N3']); assert.deepEqual(plan.sinContar, [], 'bajo −50 va a revisar, no a sin contar');
  assert.equal(SUGGEST_RULES.revisarBajo, -50);
});

test('stock sin contar: 0 o negativo, sin mínimo y sin ventas; con mínimo o con ventas sí es sugerencia', () => {
  const list = [prod('A', 'Sin nada', 0), prod('B', 'Negativo sin nada', -3), prod('C', 'Con mínimo', 0, 2), prod('D', 'Con ventas', -1, 0), prod('E', 'Mínimo vacío', 0, null), prod('F', 'Hay stock', 4, 0)];
  const plan = purchasePlan(list, new Map([['D', 15]]), 30);
  assert.deepEqual(plan.sinContar.map((x) => x.id), ['B', 'A', 'E']); assert.deepEqual(plan.sugerencias.map((x) => x.id).sort(), ['C', 'D']);
  assert.ok(plan.sugerencias.every((x) => x.sinDatos === false), 'ya no hay «sin datos» en la lista: esos son stock sin contar');
});

test('consulta: sin_contar y revisar_datos aparte (lista con tope de 20), texto que lo dice y al modelo solo totales y códigos', async () => {
  const many = Array.from({ length: 25 }, (_, i) => prod('Z' + String(i).padStart(2, '0'), 'Producto viejo ' + i, 0));
  const products = [...many, prod('V', 'VERDURAS', -7660), prod('X', 'Gaseosa 3 L', -120, 2), prod('P', 'Pan', 0, 10)];
  const r = await runAssistantQuery(memoryReader({ products, sales: [], saleItems: [] }), { tipo: 'sugerencias_compra' }, NOW);
  assert.equal(r.total, 1); assert.equal(r.filas[0][1], 'Pan'); assert.equal(SUGGEST_RULES.listaMax, 20);
  assert.equal(r.sin_contar.total, 25); assert.equal(r.sin_contar.lista.length, 20); assert.deepEqual(r.sin_contar.lista[0], { codigo: 'Z00', nombre: 'Producto viejo 0', stock: 0 });
  assert.deepEqual(r.revisar_datos, { total: 1, lista: [{ codigo: 'X', nombre: 'Gaseosa 3 L', stock: -120, vendidos: 0 }] }, 'VERDURAS es genérico: no va a revisar');
  assert.equal(r.genericos_excluidos, 1);
  assert.match(r.texto, /Sugiero reponer 1 producto/); assert.match(r.texto, /1 producto tiene el stock muy en negativo \(menos de -50\): revisa sus datos antes de comprar\./);
  assert.match(r.texto, /25 productos están en 0 o en negativo, sin mínimo y sin ventas en 30 días: es stock sin contar, no los sugiero\./);
  assert.ok(!/VERDURAS|Producto viejo|Gaseosa/.test(r.texto));
  assert.deepEqual(r.resumen.revisar_datos, { total: 1, codigos: ['X'] }); assert.equal(r.resumen.sin_contar.total, 25); assert.equal(r.resumen.sin_contar.codigos.length, 20);
  assert.equal(r.resumen.genericos_excluidos, 1);
  const sent = JSON.stringify(r.resumen); assert.ok(!/Producto viejo|Gaseosa|VERDURAS|Pan"/.test(sent), sent); assert.ok(sent.length < 1500, String(sent.length));
  // Nada que comprar, pero sí cosas aparte: el texto igual las menciona.
  const only = await runAssistantQuery(memoryReader({ products: [prod('A', 'Viejo', 0), prod('X', 'Gaseosa', -99, 1)], sales: [], saleItems: [] }), { tipo: 'sugerencias_compra' }, NOW);
  assert.equal(only.total, 0); assert.match(only.texto, /^Según las ventas de los últimos 30 días no hace falta reponer nada\. 1 producto tiene el stock muy en negativo.*\. 1 producto está en 0 o en negativo.*stock sin contar, no los sugiero\.$/);
});

test('lector canónico: pasa la categoría del producto (para reconocer servicios)', () => {
  const Q = readFileSync(new URL('../../tools/cloudflare-lab/src/pos-assistant-queries.js', import.meta.url), 'utf8');
  assert.match(Q, /categoria: p\.category \?\? null/);
});

test('bajo_stock («¿qué falta reponer?»): servicios fuera, igual que la pestaña «Crítico» de Inventario; el texto no cambia', async () => {
  const products = [prod('A', 'Arroz', 0, 5), prod('S1', 'Recarga Claro', 0, 0, { categoria: 'servicios' }), prod('S2', 'Préstamo', -4, 0, { categoria: 'Servicio' }), prod('V', 'VERDURAS', -7660, 0, { categoria: 'abarrotes' })];
  const r = await runAssistantQuery(memoryReader({ products }), { tipo: 'bajo_stock' });
  assert.equal(r.total, 2); assert.deepEqual(r.filas.map((f) => f[0]).sort(), ['Arroz', 'VERDURAS'], 'solo se quitan los servicios (por categoría), como en la pantalla');
  assert.ok(!JSON.stringify(r).includes('Recarga Claro') && !JSON.stringify(r).includes('Préstamo'));
  assert.match(r.texto, /^Hay 2 productos en o bajo el mínimo\. Los más urgentes: VERDURAS \(Faltan 7660\), Arroz \(Sin stock\)\.$/);
  assert.equal(r.resumen.total, 2); assert.equal(r.resumen.revisados, 4);
  // Sin categoría (datos viejos): como antes.
  const old = await runAssistantQuery(memoryReader({ products: [prod('A', 'Arroz', 0, 5)] }), { tipo: 'bajo_stock' });
  assert.equal(old.total, 1);
});

test('consulta: nada que reponer -> texto simple y lista vacía', async () => {
  const r = await runAssistantQuery(memoryReader({ products: [PRODUCTS[4]], sales: [], saleItems: [] }), { tipo: 'sugerencias_compra' }, NOW);
  assert.equal(r.total, 0); assert.deepEqual(r.filas, []); assert.match(r.texto, /no hace falta reponer nada/);
});

test('la consulta es de solo lectura: el módulo de consultas no escribe ni toca el guardado de «Nueva compra»', () => {
  const Q = readFileSync(new URL('../../tools/cloudflare-lab/src/pos-assistant-queries.js', import.meta.url), 'utf8');
  assert.ok(!/\b(INSERT|UPDATE|DELETE|REPLACE\s+INTO|ALTER|CREATE\s+TABLE)\b/i.test(Q.replace(/\/\/.*$/gm, '')), 'sin escrituras SQL');
  assert.ok(!/codigos-duplicados|purchase(s)?-save|registrarCompra/i.test(Q));
});

// ---------- Chat (ruta del Worker) ----------
function provider(make) { const calls = []; const f = async (url, init) => { calls.push(String(init.body)); return make(calls.length); }; f.calls = calls; return f; }
const firstCall = (args) => ({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'consultar', arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
const textReply = (t) => ({ choices: [{ message: { content: t } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
const CONTEXT = { screen: 'pageInventario', products: [] };
// Espías: cada lectura del lector (la «base») y cada escritura del cupo quedan contadas.
function spyReader(inner) { const reads = []; const r = {}; for (const k of Object.keys(inner)) r[k] = (...a) => { reads.push(k); return inner[k](...a); }; r.reads = reads; return r; }
function spyStore() { const s = createMemoryUsageStore(), puts = []; return { get: s.get, async put(k, v, rev) { puts.push(k); return s.put(k, v, rev); }, puts }; }
function route(body, { role, fetch, env = ENV, reader = spyReader(memoryReader(DATA)), store = spyStore() }) {
  return assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: CONTEXT, ...body }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, ...env }, { principalId: 'session:sug', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store, resolveRole: async () => role, fetch, reader, audit: async () => {}, mockChunkMs: 0, now: () => NOW });
}
async function drain(r) { if (!r.body) return ''; const rd = r.body.getReader(), dec = new TextDecoder(); let s = ''; for (;;) { const { value, done } = await rd.read(); if (done) break; s += dec.decode(value, { stream: true }); } return s; }

test('Admin: recibe la tabla de sugerencias; al modelo va solo el resumen con códigos (sin nombres, DNI ni teléfono); no se crea ninguna compra', async () => {
  const f = provider((n) => jsonR(n === 1 ? firstCall({ tipo: 'sugerencias_compra' }) : textReply('Te sugiero reponer 5 productos, unas 58 unidades. Revisa la tabla.')));
  const reader = spyReader(memoryReader(DATA)), store = spyStore();
  const r = await route({ text: 'Dame las sugerencias de compra' }, { role: 'owner', fetch: f, reader, store });
  assert.equal(r.status, 200); const d = await r.json();
  assert.equal(f.calls.length, 2, 'primera llamada + explicación');
  assert.ok(reader.reads.includes('soldQty') && reader.reads.includes('products'), 'control: el espía sí ve las lecturas del dueño');
  assert.ok(store.puts.length > 0, 'control: el espía sí ve el cupo del dueño');
  const card = d.proposals.find((p) => p.type === 'consulta');
  assert.ok(card, JSON.stringify(d)); assert.equal(card.needsConfirm, false); assert.equal(card.result.total, 6);
  assert.equal(card.result.filas[0][1], 'Paracetamol 500 mg', 'los nombres se ponen del lado del aparato del dueño');
  assert.ok(card.result.filas.some((x) => x[1] === PH_NAME), 'control: la tarjeta del dueño SÍ trae el nombre con la clienta');
  assert.ok(!d.proposals.some((p) => p.type === 'compra' || p.needsConfirm), 'ninguna compra ni tarjeta para confirmar');
  assert.equal(d.reply, 'Te sugiero reponer 5 productos, unas 58 unidades. Revisa la tabla.');
  const second = JSON.parse(f.calls[1]), toolMsg = second.messages.find((m) => m.role === 'tool');
  assert.ok(toolMsg && /"codigo":"PA"/.test(toolMsg.content) && /"codigo":"PH"/.test(toolMsg.content), toolMsg && toolMsg.content);
  for (const p of PRODUCTS) assert.ok(!toolMsg.content.includes(p.nombre), 'resultado de la herramienta sin nombre: ' + p.nombre);
  const all = f.calls.join('\n');
  for (const v of [CLIENTE.nombre, 'Rosa', 'Quispe', 'Mamani', 'Jarabe', CLIENTE.dni, CLIENTE.telefono]) assert.ok(!all.includes(v), 'nada del cliente ni del nombre del producto al modelo: ' + v);
});

test('Admin en modo demostración: la frase «¿qué debo comprar?» abre la misma consulta', async () => {
  const r = await route({ text: '¿Qué debo comprar esta semana?' }, { role: 'owner', fetch: async () => { throw new Error('sin red'); }, env: { ASSISTANT_DEMO: '1' } });
  assert.equal(r.status, 200); const d = await r.json();
  assert.equal(d.proposals[0].type, 'consulta'); assert.equal(d.proposals[0].result.total, 6);
});

for (const role of ['empleado:consultas', 'empleado:consultas_documentos']) {
  test(role + ': pedir sugerencias de compra -> 403 query_admin_only antes del modelo (sin cupo ni datos)', async () => {
    for (const text of ['Dame las sugerencias de compra', '¿Qué debo comprar?', 'cuánto tengo que pedir al proveedor', 'sugiéreme qué comprar']) {
      const f = provider(() => { throw new Error('no debe llamar al modelo'); }), reader = spyReader(memoryReader(DATA)), store = spyStore();
      const r = await route({ text }, { role, fetch: f, reader, store });
      assert.equal(r.status, 403, text); const d = await r.json();
      assert.equal(d.error, 'query_admin_only'); assert.equal(f.calls.length, 0);
      assert.deepEqual(store.puts, [], 'sin cupo: no se reservó nada'); assert.deepEqual(reader.reads, [], 'sin leer la base');
      assert.ok(!JSON.stringify(d).includes('Paracetamol'));
    }
  });
  test(role + ': si el modelo igual pide la consulta, 403 sin leer la base ni segunda llamada (JSON)', async () => {
    const f = provider(() => jsonR(firstCall({ tipo: 'sugerencias_compra' })));
    const reader = spyReader(memoryReader(DATA));
    const r = await route({ text: 'stock' }, { role, fetch: f, reader });
    assert.equal(r.status, 403); const d = await r.json();
    assert.deepEqual(d, { ...QUERY_ADMIN_ONLY }); assert.equal(f.calls.length, 1, 'sin segunda llamada');
    assert.deepEqual(reader.reads, [], 'sin leer la base');
  });
}
test('empleado en partes: herramienta prohibida a mitad -> evento de error 403 query_admin_only y nada de la tabla', async () => {
  const sse = (chunks) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const ev = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
  const f = provider(() => sse([ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'consultar', arguments: '{"tipo":"sugerencias_compra"}' } }] } }] }), ev({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), 'data: [DONE]\n\n']));
  const reader = spyReader(memoryReader(DATA));
  const r = await route({ text: 'stock', stream: true }, { role: 'empleado:consultas', fetch: f, reader });
  const out = await drain(r);
  assert.deepEqual(reader.reads, [], 'sin leer la base');
  assert.match(out, /"error":"query_admin_only"/); assert.match(out, /"status":403/); assert.ok(!/Paracetamol|Sugerido/.test(out));
});
test('empleado: el modelo ni ve la consulta (enum recortado); el dueño sí', () => {
  const tipos = (role) => toolsForRole(role).find((t) => t.function.name === 'consultar').function.parameters.properties.tipo.enum;
  assert.ok(tipos('owner').includes('sugerencias_compra'));
  for (const role of ['empleado:consultas', 'empleado:consultas_documentos']) assert.ok(!tipos(role).includes('sugerencias_compra'), role);
  assert.equal(employeeQueryDenied('owner', 'sugerencias de compra'), false);
  assert.equal(employeeQueryDenied('empleado:consultas', '¿Qué falta reponer?'), false, 'lo de siempre sigue para el empleado');
});

test('UI: el atajo «Sugerencias de compra» sale solo en modo Admin y el 403 tiene frase simple', () => {
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  const CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
  const fn = UI.slice(UI.indexOf('function chipsHtml()'), UI.indexOf('function chipsHtml()') + 2000).split('\n');
  assert.match(fn[1], /if \(isOwnerAccess\(\)\) return .*Sugerencias de compra/);
  assert.ok(!fn.slice(2, 4).join('\n').includes('Sugerencias de compra'), 'el empleado no ve el atajo');
  assert.match(CORE, /query_admin_only: \['Esa consulta es solo para el Admin\.'\]/);
  assert.equal(QUERY_ADMIN_ONLY.message, 'Esa consulta es solo para el Admin.', 'mensaje genérico, reusable por otras consultas del Admin');
});

test('base real (lectura canónica existente): la consulta responde sin escribir nada', async (t) => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  const db = f.env.nuevo_amanecer_lab, sqls = [];
  // Espía en la base: toda sentencia preparada queda anotada; y total_changes() de SQLite cuenta toda fila escrita en la conexión.
  const spy = new Proxy(db, { get(o, k) { if (k === 'prepare') return (sql) => { sqls.push(String(sql)); return o.prepare(sql); };
    if (k === 'batch' || k === 'exec') return () => { throw new Error('la consulta no debe escribir (' + String(k) + ')'); }; const v = o[k]; return typeof v === 'function' ? v.bind(o) : v; } });
  const changes = () => f.database.prepare('SELECT total_changes() AS n').get().n;
  const before = changes();
  const reader = canonicalReader(spy);
  const r = await runAssistantQuery(reader, { tipo: 'sugerencias_compra' }, NOW);
  assert.equal(changes(), before, 'ninguna fila escrita');
  assert.ok(sqls.length > 0, 'control: el espía ve las lecturas');
  for (const q of sqls) assert.ok(!/^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i.test(q), 'solo lecturas: ' + q.slice(0, 60));
  assert.ok(!r.error, JSON.stringify(r)); assert.ok(r.resumen.revisados >= 1); assert.ok(r.filas.length <= SUGGEST_RULES.filas);
  assert.ok(r.resumen.primeros.length <= 8); assert.ok(!JSON.stringify(r.resumen).includes('sintético'));
});
