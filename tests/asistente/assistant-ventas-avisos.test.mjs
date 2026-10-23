// Auditoría de ventas 23-10 (VEN-027/028/040/046/048): el asistente avisa en vez de callar.
// - VEN-027: una fecha que no existe (31 de septiembre) se avisa; no se contesta «No hay ventas».
// - VEN-028: «mañana» o una fecha futura se avisa; no se cambia en silencio por hoy.
// - VEN-040: si la lista de más vendidos se corta, se dice cuántos hay («Mostrando 10 de 12»).
// - VEN-046: si el período pasa de 92 días, se dice que se recortó y qué fechas se contaron.
// - VEN-048: al modelo va también el peor día (con días sin ventas), no solo el mejor.
// Los avisos llegan por los dos caminos: el texto de la consulta (respuesta directa) y el resumen que lee el modelo.
// Datos inventados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore, employeeQueryResult } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { runAssistantQuery, memoryReader, canonicalReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { activeCanon } from '../cloud-sync/canon-browser-harness.mjs';

const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const NOW = Date.parse('2026-10-23T20:00:00Z'); // viernes 23-10, 15:00 en Lima
const SECRET = 'secreto-de-prueba-0123456789abcdef';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const enc = new TextEncoder(); const sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const delta = (d, fin) => sse({ choices: [{ delta: d, ...(fin ? { finish_reason: fin } : {}) }] });
const call = (tipo, extra = {}) => ({ index: 0, id: 'c1', function: { name: 'consultar', arguments: JSON.stringify({ tipo, ...extra }) } });
const first = (c) => [delta({ tool_calls: [c] }), delta({}, 'tool_calls')];
const SECOND = [delta({ content: 'Texto del modelo.' }), delta({}, 'stop')];
function seq(list, bodies) { let n = 0; return async (_u, init) => { bodies.push(String(init.body)); const parts = list[Math.min(n++, list.length - 1)];
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }); }; }
async function chat(text, { fetch, reader, role = 'owner' }) {
  const realNow = Date.now; Date.now = () => NOW;
  const o = console.log, w = console.warn; console.log = () => {}; console.warn = () => {};
  try {
    const r = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, text }) }),
      { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
      { store: createMemoryUsageStore(), resolveRole: async () => role, fetch, reader, audit: async () => {}, statusEveryMs: 60000, now: () => NOW });
    const raw = r.body ? await new Response(r.body).text() : ''; const out = []; C.createSseParser((e, d) => out.push({ ev: e, d })).feed(raw);
    return { status: r.status, final: out.find((x) => x.ev === 'final')?.d };
  } finally { Date.now = realNow; console.log = o; console.warn = w; }
}
// Lo que vio el modelo en la segunda llamada: el mensaje «tool» con el resumen.
const toolMsg = (bodies) => JSON.parse(bodies[1]).messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');

const S = (id, at, metodo, c) => ({ sale_id: id, created_at: at, metodo, total_cents: c });
const I = (sid, pid, qn, u) => ({ sale_id: sid, product_id: pid, quantity: qn, unit_price_cents: u, line_total_cents: qn * u });
const DATA = {
  products: [{ id: 'P1', nombre: 'Arroz', costo: 4, precio: 5, stock: 50 }, { id: 'P2', nombre: 'Coca Cola 3L', costo: 9, precio: 12, stock: 20 }],
  sales: [
    S('h1', '2026-10-23T15:00:00Z', 'efectivo', 1200), S('h2', '2026-10-23T16:00:00Z', 'yape', 1200), // hoy (23-10): S/ 24.00
    S('a1', '2026-10-22T15:00:00Z', 'efectivo', 700), // 22-10
    S('o1', '2026-10-05T15:00:00Z', 'efectivo', 3000), S('o2', '2026-10-06T15:00:00Z', 'efectivo', 200), // 05-10 y 06-10
    S('j1', '2026-07-20T15:00:00Z', 'efectivo', 999)], // fuera de los 92 días (antes del 23-07)
  saleItems: [I('h1', 'P1', 2, 600), I('h2', 'P2', 1, 1200), I('a1', 'P1', 1, 700), I('o1', 'P2', 2, 1500), I('o2', 'P1', 1, 200), I('j1', 'P1', 1, 999)]
};
const RD = () => memoryReader(DATA);
const q = (args, reader = RD()) => runAssistantQuery(reader, args, NOW);

// ---------- VEN-027: fecha que no existe ----------
test('VEN-027: 2026-09-31 no existe: se avisa, sin «No hay ventas» y sin leer la base', async () => {
  let reads = 0; const base = RD(); const spy = new Proxy(base, { get: (o, k) => (typeof o[k] === 'function' ? (...a) => { reads++; return o[k](...a); } : o[k]) });
  for (const args of [{ tipo: 'ventas_periodo', fecha: '2026-09-31' }, { tipo: 'top_productos', fecha: '2026-09-31' }, { tipo: 'ventas_periodo', desde: '2026-02-30', hasta: '2026-03-05' }]) {
    const r = await q(args, spy);
    assert.ok(!r.error, JSON.stringify(r));
    assert.doesNotMatch(r.texto, /No hay ventas/i, r.texto);
    assert.match(r.texto, /no existe/i, r.texto);
    assert.match(r.resumen.aviso, /no existe/i);
    assert.deepEqual(r.filas, []);
  }
  const r = await q({ tipo: 'ventas_periodo', fecha: '2026-09-31' });
  assert.match(r.texto, /31 de septiembre de 2026 no existe/);
  assert.match(r.texto, /septiembre tiene 30 días/);
  assert.equal(reads, 0, 'no se lee nada para una fecha que no existe');
  // 29 de febrero: existe en año bisiesto, no en los otros
  assert.match((await q({ tipo: 'ventas_periodo', fecha: '2026-02-29' })).texto, /29 de febrero de 2026 no existe/);
  assert.doesNotMatch((await q({ tipo: 'ventas_periodo', fecha: '2024-02-29' })).texto, /no existe/);
});

test('VEN-027: en el chat la respuesta directa y el resumen del modelo dicen que la fecha no existe', async () => {
  const b1 = []; const c1 = await chat('cuanto vendi el 31 de septiembre', { fetch: seq([first(call('ventas_periodo', { fecha: '2026-09-31' })), SECOND], b1), reader: RD() });
  assert.equal(c1.status, 200);
  assert.match(c1.final.reply, /31 de septiembre de 2026 no existe/, c1.final.reply);
  assert.doesNotMatch(c1.final.reply, /No hay ventas/i);
  const b2 = []; await chat('explicame cuanto vendi el 31 de septiembre', { fetch: seq([first(call('ventas_periodo', { fecha: '2026-09-31' })), SECOND], b2), reader: RD() });
  assert.equal(b2.length, 2);
  assert.match(toolMsg(b2), /no existe/);
});

// ---------- VEN-028: «mañana» y fechas futuras ----------
test('VEN-028: «mañana» y una fecha futura se avisan; no se contestan con las ventas de hoy', async () => {
  for (const args of [{ tipo: 'ventas_periodo', periodo: 'mañana' }, { tipo: 'ventas_periodo', fecha: '2026-10-24' }, { tipo: 'top_productos', periodo: 'manana' }, { tipo: 'ventas_periodo', desde: '2026-11-01', hasta: '2026-11-05' }]) {
    const r = await q(args);
    assert.ok(!r.error, JSON.stringify(r));
    assert.match(r.texto, /futur/i, JSON.stringify(args) + ' → ' + r.texto);
    assert.doesNotMatch(r.texto, /24\.00|Arroz|Coca/, 'no son las ventas de hoy: ' + r.texto);
    assert.match(r.resumen.aviso, /futur/i);
    assert.equal(r.resumen.fecha_futura, true);
    assert.deepEqual(r.filas, []);
  }
  const r = await q({ tipo: 'ventas_periodo', periodo: 'mañana' });
  assert.match(r.texto, /24 de octubre de 2026/); assert.match(r.texto, /hoy es 23 de octubre/i);
  // Rango que empieza en el pasado y termina en el futuro: se cuenta hasta hoy y se avisa.
  const m = await q({ tipo: 'ventas_periodo', desde: '2026-10-22', hasta: '2026-10-30' });
  assert.equal(m.resumen.hasta, '2026-10-23'); assert.equal(m.resumen.total_soles, 31);
  assert.match(m.texto, /futur/i); assert.match(m.resumen.aviso, /hasta hoy/i);
});

test('VEN-028: en el chat «mañana» llega a la consulta y la respuesta avisa que es futura', async () => {
  const b = []; const c = await chat('cuanto vendi mañana', { fetch: seq([first(call('ventas_periodo', { periodo: 'mañana' })), SECOND], b), reader: RD() });
  assert.equal(c.final.proposals[0].query.periodo, 'manana', 'la palabra no se pierde (antes: null → hoy)');
  assert.match(c.final.reply, /futur/i, c.final.reply);
  assert.doesNotMatch(c.final.reply, /24\.00/);
});

// ---------- VEN-040: lista de más vendidos cortada ----------
const MANY = (() => { const prods = Array.from({ length: 12 }, (_, i) => ({ id: 'X' + i, nombre: 'Prod ' + i, costo: 1, precio: 2 }));
  return { products: prods, sales: [S('t1', '2026-10-23T15:00:00Z', 'efectivo', 2466)], saleItems: prods.map((p, i) => I('t1', p.id, 1, 200 + i)) }; })();
test('VEN-040: top_productos con 12 productos: muestra 10 y dice «Mostrando 10 de 12»', async () => {
  const r = await q({ tipo: 'top_productos', periodo: 'hoy' }, memoryReader(MANY));
  assert.equal(r.filas.length, 10);
  assert.equal(r.total, 12);
  assert.match(r.texto, /Mostrando 10 de 12 productos/);
  assert.equal(r.resumen.productos_vendidos, 12); assert.equal(r.resumen.lista_cortada, true); assert.equal(r.resumen.filas_en_pantalla, 10);
  assert.match(r.resumen.aviso, /Mostrando 10 de 12/);
  // sin corte: nada de «Mostrando»
  const s = await q({ tipo: 'top_productos', periodo: 'hoy' });
  assert.equal(s.total, 2); assert.equal(s.resumen.lista_cortada, false); assert.doesNotMatch(s.texto, /Mostrando/); assert.equal(s.resumen.aviso, undefined);
});

test('VEN-040: el lector canónico (SQL) también cuenta cuántos productos se vendieron en total', async (t) => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql', '0026_pos_sale_annulments.sql'] });
  const d = f.database; const c = d.prepare('SELECT active_promotion_id p,authority_epoch e,revision r FROM canonical_control WHERE id=1').get();
  for (const { name } of d.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('sales','sale_items','canonical_sale_context')").all()) d.exec('DROP TRIGGER "' + name + '"');
  try { d.exec('PRAGMA foreign_keys=OFF'); } catch { /* nada */ }
  const at = '2026-10-23T15:00:00.000Z', h = 'a'.repeat(64);
  d.prepare("INSERT INTO sales(sale_id,operation_id,payload_hash,commit_token,device_id,payment_method,total_cents,created_at) VALUES('V1','op-V1',?,'tok','session:x','efectivo',2466,?)").run(h, at);
  d.prepare("INSERT INTO canonical_sale_context(sale_id,operation_id,promotion_id,authority_epoch,control_revision,customer_id,client_contract,created_at) VALUES('V1','op-V1',?,?,?,NULL,'a6-gate-c-v1',?)").run(c.p, c.e, c.r, at);
  const item = d.prepare("INSERT INTO sale_items(sale_id,line_number,operation_id,product_id,quantity,unit_price_cents,line_total_cents,created_at) VALUES('V1',?,'op-V1',?,1,?,?,?)");
  for (let i = 0; i < 12; i++) item.run(i + 1, 'PC' + i, 200 + i, 200 + i, at);
  const r = await runAssistantQuery(canonicalReader(f.env.nuevo_amanecer_lab), { tipo: 'top_productos', periodo: 'hoy' }, NOW);
  assert.ok(!r.error, JSON.stringify(r));
  assert.equal(r.filas.length, 10); assert.equal(r.total, 12); assert.match(r.texto, /Mostrando 10 de 12 productos/);
});

// ---------- VEN-046: período recortado a 92 días ----------
test('VEN-046: período de más de 92 días: se avisa que se recortó y qué fechas se contaron', async () => {
  const r = await q({ tipo: 'ventas_periodo', desde: '2026-01-01', hasta: '2026-10-23' });
  assert.equal(r.resumen.desde, '2026-07-23'); assert.equal(r.resumen.hasta, '2026-10-23'); // el tope se queda
  assert.match(r.texto, /92 días/); assert.match(r.texto, /2026-01-01/); assert.match(r.texto, /2026-07-23/);
  assert.match(r.resumen.aviso, /92 días/);
  assert.deepEqual(r.resumen.periodo_pedido, { desde: '2026-01-01', hasta: '2026-10-23' });
  const tp = await q({ tipo: 'top_productos', desde: '2026-01-01', hasta: '2026-10-23' });
  assert.match(tp.texto, /92 días/); assert.match(tp.resumen.aviso, /92 días/);
  // dentro del tope: sin aviso
  const ok = await q({ tipo: 'ventas_periodo', desde: '2026-09-01', hasta: '2026-10-23' });
  assert.equal(ok.resumen.aviso, undefined); assert.equal(ok.resumen.periodo_pedido, undefined); assert.doesNotMatch(ok.texto, /92 días/);
});

test('VEN-046: el aviso de recorte llega a la respuesta directa y al modelo', async () => {
  const args = { desde: '2026-01-01', hasta: '2026-10-23' };
  const b1 = []; const c1 = await chat('cuanto vendi este año', { fetch: seq([first(call('ventas_periodo', args)), SECOND], b1), reader: RD() });
  assert.match(c1.final.reply, /92 días/, c1.final.reply);
  const b2 = []; await chat('explicame las ventas de este año', { fetch: seq([first(call('ventas_periodo', args)), SECOND], b2), reader: RD() });
  assert.match(toolMsg(b2), /92 días/);
});

// ---------- VEN-048: peor día ----------
test('VEN-048: ventas del mes: al modelo va el peor día (días sin ventas incluidos), además del mejor', async () => {
  const r = await q({ tipo: 'ventas_periodo', periodo: 'este_mes' });
  assert.deepEqual(r.resumen.mejor_dia, { dia: '2026-10-05', soles: 30 });
  // 01-10 no tuvo ventas: es el peor (el primero de los días en S/ 0). Hoy (aún abierto) no cuenta para el peor.
  assert.deepEqual(r.resumen.peor_dia, { dia: '2026-10-01', soles: 0 });
  assert.equal(r.resumen.dias_sin_ventas, 19); // del 1 al 22 de octubre (hoy no entra): 22 días, con ventas el 5, 6 y 22
});

test('VEN-048: con ventas todos los días el peor es el de menos plata; un solo día no lleva peor día', async () => {
  const d = { products: DATA.products, sales: [S('d1', '2026-10-19T15:00:00Z', 'efectivo', 500), S('d2', '2026-10-20T15:00:00Z', 'efectivo', 300), S('d3', '2026-10-21T15:00:00Z', 'efectivo', 900), S('d4', '2026-10-22T15:00:00Z', 'efectivo', 400)], saleItems: [] };
  const r = await q({ tipo: 'ventas_periodo', desde: '2026-10-19', hasta: '2026-10-22' }, memoryReader(d));
  assert.deepEqual(r.resumen.peor_dia, { dia: '2026-10-20', soles: 3 }); assert.equal(r.resumen.dias_sin_ventas, 0);
  const one = await q({ tipo: 'ventas_periodo', fecha: '2026-10-20' }, memoryReader(d));
  assert.equal(one.resumen.peor_dia, null);
});

test('VEN-048: «¿cuál fue mi peor día este mes?» → el modelo recibe peor_dia', async () => {
  const b = []; await chat('cual fue mi peor dia este mes', { fetch: seq([first(call('ventas_periodo', { periodo: 'este_mes' })), SECOND], b), reader: RD() });
  assert.equal(b.length, 2);
  const m = toolMsg(b);
  assert.match(m, /"peor_dia":\{"dia":"2026-10-01","soles":0\}/, m);
});

// ---------- Empleado: el aviso (solo fechas) no se pierde en la lista blanca ----------
test('avisos: employeeQueryResult deja pasar «aviso» (solo fechas, sin datos del Admin)', async () => {
  const r = employeeQueryResult(await q({ tipo: 'top_productos', desde: '2026-01-01', hasta: '2026-10-23' }));
  assert.match(r.resumen.aviso, /92 días/);
});
