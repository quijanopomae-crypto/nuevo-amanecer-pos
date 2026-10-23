// Auditoría de privacidad (2026-10-22): (1) nombres y direcciones de clientes conocidos no salen del aparato (se mandan como «cliente #código»,
// el estado de cuenta va por cliente_id y el nombre se pone solo en la pantalla); (3) el redactor tapa +51/51…, fijos, DNI con separadores
// y correos disfrazados; (6) las pistas aprendidas de boletas pasan por el redactor; (7) nombres de producto en <datos_pos> y proveedor de
// las compras recientes pasan por el redactor antes del modelo. (2) está en assistant-review-monitor / assistant-review. Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore, createTextEmitter, redactFor, redactText, redactModelOwner, redactOwnerText, redactEmployeeText, sanitizeContext, toProposal, redactDeep, customerCode } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { cleanHints, boletaRequest } from '../../tools/cloudflare-lab/src/pos-assistant-boleta.js';
import { memoryReader, runAssistantQuery } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
const require = createRequire(import.meta.url);
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = globalThis;
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const B = require('../../POS/js/modules/asistente/asistente-boleta.js');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const SRV = readFileSync('tools/cloudflare-lab/src/pos-assistant.js', 'utf8');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

// ---------- (3) redactor ----------
const LEAKS = ['+51987654321', '51987654321', '+51 987 654 321', '01 234 5678', '(01) 234-5678', '044 123 456', '4567 8912', '45.678.912', '45 678 912',
  'rosa(at)gmail.com', 'rosa [at] gmail [dot] com', 'rosa arroba gmail punto com', 'rosa @ gmail.com'];
test('3) servidor y aparato: +51/51 + celular, fijo, DNI con separadores y correo disfrazado quedan tapados (empleado, modelo del Admin, aparato)', () => {
  for (const x of LEAKS) {
    const t = 'dato: ' + x + ' gracias';
    for (const [name, f] of [['redactText', redactText], ['redactModelOwner', redactModelOwner], ['redactEmployeeText', redactEmployeeText], ['aparato', C.redactText]]) {
      const out = f(t); assert.ok(!out.includes(x), name + ': ' + x + ' -> ' + out);
      assert.ok(!/987654321|2345678|123456|45678912|678912|rosa/.test(out.replace(/\D*\*+\d{4}/g, '')), name + ' sin restos: ' + out);
    }
  }
  // al Admin en pantalla se le sigue mostrando el DNI (como antes); el celular y el correo no
  assert.match(redactOwnerText('DNI 4567 8912'), /4567 8912/);
  assert.ok(!redactOwnerText('cel +51987654321').includes('987654321'));
});
test('3) en partes (streaming) = texto entero: correo disfrazado, +51, fijo y DNI con separadores, cortado en 1..7 caracteres', () => {
  for (const x of LEAKS) for (const role of ['owner', 'empleado:consultas']) for (const n of [1, 2, 3, 5, 7]) {
    const t = 'Hola, el dato es ' + x + ' y nada más, gracias a usted.';
    let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, redactFor(role));
    for (let i = 0; i < t.length; i += n) e.push(t.slice(i, i + n)); e.flush();
    let w = ''; const f = createTextEmitter((d) => { if (d.t) w += d.t; }, 1e9, redactFor(role)); f.push(t); f.flush();
    assert.equal(o, w, role + ' / ' + n + ': ' + x); assert.equal(o, redactFor(role)(t));
    if (role !== 'owner' || !/^\d/.test(x) || /^\+?51|^\(?0/.test(x)) assert.ok(!o.includes(x), o); // al Admin en pantalla el DNI se le sigue mostrando
  }
});
test('3) sin falsos positivos: precios, cantidades, fechas, series de comprobante y códigos de producto siguen igual', () => {
  for (const t of ['Arroz S/ 1,234.50 x 12', 'Total S/ 4 567.80', 'F001-00012345', 'B001-123', '21/10/2026 10:30', 'Galleta cód. 12345678', 'Leche 400 g x 24 und', 'Precio 3.50 o 4.20', 'stock 1200 unidades'])
    assert.equal(redactModelOwner(t), t, t);
  assert.equal(C.redactText('Arroz S/ 1,234.50 x 12 el 21/10/2026'), 'Arroz S/ 1,234.50 x 12 el 21/10/2026');
});

// ---------- (1) clientes ----------
const CLI = [{ id: 'c1', nombre: 'Rosa Quispe Mamani', dni: '45678912', tel: '987654321', dir: 'Jr. Los Olivos 345, Ate' }, { id: 'c2', nombre: 'Rosa Huamán' },
  { id: '45678913', nombre: 'José Pérez' }, { id: 'c4', nombre: 'Gloria Ramos' }];
const PROD = [{ id: 'P1', nombre: 'Leche Gloria 400g' }];
test('1) aparato: nombres y direcciones de clientes conocidos -> «cliente #código» / «[dirección oculta]» (sin tildes ni mayúsculas, palabras enteras)', () => {
  const m = (t) => C.maskCustomers(t, CLI, PROD);
  assert.deepEqual(m('¿Cuánto debe Rosa Quispe?'), { text: '¿Cuánto debe cliente #c1?', codes: ['c1'] });
  assert.equal(m('estado de cuenta de ROSA QUISPE MAMANI').text, 'estado de cuenta de cliente #c1');
  assert.equal(m('quispe pagó 20').text, 'cliente #c1 pagó 20');
  assert.equal(m('cuánto debe Rosa').text, 'cuánto debe cliente #c1 o cliente #c2', 'nombre compartido: sus códigos');
  assert.equal(m('Quispe Mamani pagó').text, 'cliente #c1 pagó');
  assert.equal(m('Rosa Huamán pagó').text, 'cliente #c2 pagó');
  assert.equal(m('Jose Perez debe').text, 'un cliente debe', 'código que el redactor taparía (8 dígitos): «un cliente»');
  assert.equal(m('vive en Jr. Los Olivos 345, Ate').text, 'vive en [dirección oculta]');
  assert.equal(m('entrega en Av. Grau 123 Mz B Lt 5').text, 'entrega en [dirección oculta]');
  assert.equal(m('precio de Leche Gloria').text, 'precio de Leche Gloria', 'una palabra de un producto no se toma como cliente');
  assert.equal(m('Rosalinda compró arroz').text, 'Rosalinda compró arroz', 'solo palabras enteras');
  assert.equal(m('').text, ''); assert.equal(C.maskCustomers('hola Rosa', null).text, 'hola Rosa');
  for (const t of ['Rosa Quispe', 'Quispe Mamani', 'Huamán', 'Gloria Ramos']) assert.ok(!/rosa|quispe|mamani|huam|gloria ramos/i.test(m('hable con ' + t + ' hoy').text), t);
  assert.deepEqual(C.customerCodesIn('Sí, cliente #c2 debe; cliente #zz no existe; cliente #c2 otra vez', CLI), ['c2']);
});
test('1) UI: el mensaje pasa por maskCustomers ANTES del redactor y del envío (el historial guarda lo mismo); la respuesta pinta el nombre local', () => {
  assert.match(UI, /var masked = C\.maskCustomers \? C\.maskCustomers\(text, deps\.clientes\(\), deps\.productos\(\), deps\.proveedores \? deps\.proveedores\(\) : \[\]\) : \{ text: text \};\n\s*var body = \{ text: C\.redactText\(masked\.text\), history/);
  assert.match(UI, /if \(C\.customerCodesIn && isOwnerAccess\(\)\) linkCustomers\(bubble, C\.customerCodesIn\(d\.reply, deps\.clientes\(\)\)\);/);
  assert.ok(!/text: C\.redactText\(text\)/.test(UI), 'ya no se manda el texto sin cambiar nombres');
});
test('1) servidor: el estado de cuenta va por cliente_id (código), nunca por nombre; la herramienta ya no pide el nombre', async () => {
  assert.equal(customerCode('cliente #c7'), 'c7'); assert.equal(customerCode('#c7'), 'c7'); assert.equal(customerCode('Rosa Quispe'), null); assert.equal(customerCode('45678912'), null);
  const ec = toProposal({ name: 'preparar_documento', arguments: { tipo: 'estado_cuenta', cliente_id: 'c7', cliente: 'Rosa Quispe' } }, 'owner', { products: [] }, 1);
  assert.equal(ec.cliente_id, 'c7'); assert.ok(!JSON.stringify(ec).includes('Rosa'));
  assert.ok(!/cliente: \{ type: 'string' \}/.test(SRV), 'la herramienta no tiene el parámetro «cliente» (nombre)');
  assert.match(SRV, /cliente_id: \{ type: 'string', description: 'Solo el código de «cliente #CODIGO», sin el nombre\.' \}/);
  // ruta completa: lo que llega al modelo con el texto ya cambiado por el aparato no trae el nombre; la tarjeta trae el código
  const cap = [];
  const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: C.redactText(C.maskCustomers('estado de cuenta de Rosa Quispe, vive en Jr. Los Olivos 345', CLI).text) }) }),
  { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-1234567890', AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-test-FAKE' }, { principalId: 'session:dueno', posRole: 'owner' }, jsonR,
  { store: createMemoryUsageStore(), resolveRole: async () => 'owner', audit: async () => {}, mockChunkMs: 0,
    fetch: async (u, init) => { cap.push(JSON.parse(init.body)); return jsonR({ choices: [{ message: { content: 'Listo, cliente #c1.', tool_calls: [{ id: 't1', type: 'function', function: { name: 'preparar_documento', arguments: JSON.stringify({ tipo: 'estado_cuenta', cliente_id: 'c1' }) } }] } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }); } });
  const d = await r.json(), sent = JSON.stringify(cap);
  assert.ok(sent.includes('cliente #C-0001') && !sent.includes('cliente #c1') && !/Rosa|Quispe|Olivos/.test(sent), sent); // hacia la IA, código neutro
  assert.equal(d.proposals[0].cliente_id, 'c1'); assert.match(d.reply, /cliente #c1/);
});
test('1) aparato: el documento busca al cliente por su código y pone el nombre en la hoja (el modelo nunca lo vio)', async () => {
  const api = { summarizeClient: () => ({ active: [], overdueDebt: 0 }), effectiveBalance: () => 5, pending: () => null };
  const doc = (p) => C.buildDocument({ id: 'd', type: 'documento', tipo: 'estado_cuenta', title: 'Estado de cuenta del cliente', fiscal: false, ...p }, { api, clientes: CLI }, 'B');
  assert.ok((await doc({ cliente_id: 'c1' })).html.includes('Rosa Quispe Mamani'));
  assert.match((await doc({ cliente_id: 'nada' })).html, /Cliente no encontrado/);
});

// ---------- (6) pistas de boletas ----------
test('6) pistas aprendidas: servidor y aparato las pasan por el redactor; con algo tapado, la pista no se manda', () => {
  const hints = [{ campo: 'descripcion', de: 'Torta Rosa +51987654321', a: 'Torta' }, { campo: 'descripcion', de: 'Pan', a: 'Pan rosa(at)gmail.com' },
    { campo: 'cod', de: 'X 4567 8912', a: 'X1' }, { campo: 'um', de: 'UNID', a: 'UNIDAD' }, { campo: 'descripcion', de: 'Leche', a: 'clave: Zq9xK2' }];
  assert.deepEqual(cleanHints(hints), [{ campo: 'um', de: 'UNID', a: 'UNIDAD' }]);
  const msg = JSON.stringify(boletaRequest('data:image/jpeg;base64,AAAA', hints));
  assert.ok(!/987654321|gmail|8912|Zq9xK2/.test(msg), msg); assert.match(msg, /UNID/);
  // aparato: no aprende ni manda pistas con datos; las guardadas antes de la regla también se filtran al enviarse
  B.learnClear();
  assert.deepEqual(B.correctionsOf([{ descripcion: 'Torta', _orig: { descripcion: 'Torta 51 987 654 321' } }, { um: 'UNIDAD', _orig: { um: 'UNID' } }]), [{ campo: 'um', de: 'UNID', a: 'UNIDAD' }]);
  store.set('na_asst_bol_learn', JSON.stringify({ v: 1, list: [{ campo: 'descripcion', de: 'Pan 45.678.912', a: 'Pan', n: 9, t: 2 }, { campo: 'um', de: 'UNID', a: 'UNIDAD', n: 1, t: 1 }] }));
  assert.deepEqual(B.learnHints(), [{ campo: 'um', de: 'UNID', a: 'UNIDAD' }]);
  B.learnClear();
});

// ---------- (7) <datos_pos> y compras recientes ----------
test('7) <datos_pos>: el nombre de producto pasa por el redactor (cualquier rol); el proveedor de las compras recientes llega al modelo tapado', async () => {
  const raw = { products: [{ id: 'P1', nombre: 'Torta encargo Rosa +51987654321', precio: 1, stock: 1 }, { id: 'P2', nombre: 'Queque rosa(at)gmail.com 45.678.912', precio: 1, stock: 1 }] };
  for (const role of ['owner', 'empleado:consultas']) { const s = JSON.stringify(sanitizeContext(raw, role)); assert.ok(!/987654321|gmail|678\.912/.test(s), role + ': ' + s); }
  const reader = memoryReader({ purchases: [{ supplier: 'Juan Pérez cel 987654321 DNI 45678912', document_ref: 'F001-1', total_cost_cents: 1000, line_count: 1, created_at: '2026-10-21T10:00:00Z' }] });
  const q = await runAssistantQuery(reader, { tipo: 'compras_recientes' });
  const forModel = redactDeep(q.resumen);
  assert.ok(!/987654321|45678912/.test(JSON.stringify(forModel)), JSON.stringify(forModel)); assert.equal(forModel.compras, 1);
  assert.match(SRV, /resumen: redactDeep\(seesOwnerData\(role\) \? r\.resumen : stripOwnerKeys\(r\.resumen\), 0, redactRefs\)/); // #931: mismo redactor, con «producto #código» protegido
  assert.deepEqual(redactDeep({ a: ['x 987654321', 2, null], b: { c: 'ok' } }), { a: ['x ' + redactText('987654321'), 2, null], b: { c: 'ok' } });
});

// ---------- (1) tabla de la consulta de deudas (prueba en vivo 22-10: la tarjeta mostraba nombres y «Mostrando 10 de 22057.72») ----------
test('(1) deudas_clientes: la TABLA también va con «cliente #código» (sin nombres del servidor), igual que el texto; el pie cuenta clientes, no soles', async () => {
  const { makeDoc } = await import('./fake-dom.mjs');
  const customers = Array.from({ length: 14 }, (_, i) => ({ id: i ? String(1729550000000 + i) : '45678912', nombre: 'Cliente Real Apellido ' + i }));
  const credits = customers.map((c, i) => ({ cliente: c.id, saldo: 1000 + i * 37.25 }));
  const r = await runAssistantQuery(memoryReader({ products: [], customers, credits }), { tipo: 'deudas_clientes' });
  const js = JSON.stringify({ filas: r.filas, resumen: r.resumen });
  for (const c of customers) assert.ok(!js.includes(c.nombre), 'sin nombre: ' + c.nombre);
  assert.ok(!js.includes('45678912'), 'un id con forma de DNI no sale como código');
  assert.ok(r.filas.every((f) => /^(?:cliente #\d{13}|Cliente \d+)$/.test(f[0])), JSON.stringify(r.filas));
  assert.deepEqual(r.resumen.mayores_saldos.map((x) => x.cliente), r.filas.slice(0, r.resumen.mayores_saldos.length).map((f) => f[0]), 'texto y tabla dicen lo mismo');
  // UI: el pie usa la cantidad de clientes (no el total en soles) y la tabla pasa por linkCustomers como el texto del chat
  const a = UI.indexOf('  function qCount(r)'), b = UI.indexOf('\n', a);
  const qCount = new Function(UI.slice(a, b) + '\nreturn qCount;')();
  assert.equal(qCount({ tipo: 'deudas_clientes', total: 22057.72, clientes: 22 }), 22);
  assert.equal(qCount({ tipo: 'ventas_periodo', total: 22057.72 }), null);
  assert.equal(qCount({ tipo: 'bajo_stock', total: 31 }), 31);
  assert.equal(qCount({ tipo: 'deudas_clientes', total: 22057.72 }), null, 'Worker viejo sin «clientes»: sin pie, nunca la plata');

  // la celda «cliente #código» se vuelve el mismo botón del chat (nombre de la lista de ESTE aparato)
  const doc = makeDoc(), el = (t, c) => { const e = doc.createElement(t); if (c) e.className = c; return e; };
  const s0 = UI.indexOf('  var CLI_RE = '), s1 = UI.indexOf('  // ---------- «Leer boleta con IA»');
  const local = customers.slice(-2).map((c) => ({ id: c.id, nombre: c.nombre }));
  const api = new Function('root', 'doc', 'C', 'el', 'addMsg', 'deps', UI.slice(s0, s1) + '\nreturn { linkCustomers: linkCustomers };')({}, doc, C, el, () => {}, { clientes: () => local });
  const cell = doc.createElement('td'); cell.textContent = r.filas.find((f) => f[0] === 'cliente #' + local[0].id)[0];
  const codes = C.customerCodesIn(cell.textContent, local); assert.deepEqual(codes, [local[0].id]);
  assert.equal(api.linkCustomers(cell, codes), 1);
  assert.equal(cell.byClass('na-asst-cli')[0].textContent, 'cliente #' + local[0].id + ' (' + local[0].nombre + ')');
  // la línea real de addCard: Admin ve el nombre en la tarjeta; el empleado solo «cliente #código» (sin botón ni nombre)
  const line = UI.split('\n').find((l) => l.includes("var qt = p.type === 'consulta'")); assert.ok(line && line.includes('isOwnerAccess()'), line);
  const card = (owner) => { const c = doc.createElement('div'), t = doc.createElement('table'); t.className = 'q'; const td = doc.createElement('td'); td.textContent = 'cliente #' + local[0].id; t.appendChild(td); c.appendChild(t);
    c.querySelector = (sel) => (sel === 'table.q' ? t : null);
    new Function('p', 'c', 'C', 'deps', 'linkCustomers', 'isOwnerAccess', line)({ type: 'consulta' }, c, C, { clientes: () => local }, api.linkCustomers, () => owner); return t; };
  const adm = card(true), emp = card(false);
  assert.ok(adm.textContent.includes(local[0].nombre), 'Admin: nombre real en la tarjeta: ' + adm.textContent);
  assert.equal(emp.textContent, 'cliente #' + local[0].id, 'empleado: solo el código'); assert.equal(emp.byClass('na-asst-cli').length, 0);
});
