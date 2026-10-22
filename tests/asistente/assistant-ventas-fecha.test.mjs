// Lentitud 22-10 (paso 1): las ventas se filtran por fecha (día de Lima) EN SQL, con SUM/COUNT/GROUP BY y LIMIT.
// Antes se leían como mucho 5000 ventas por páginas (ordenadas por sale_id) y se filtraba en el Worker: con más de 5000 ventas
// «¿cuánto vendí hoy?» podía responder que no hubo ventas. Datos inventados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAssistantQuery, canonicalReader, memoryReader, period, SALE_LINES_MAX } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { activeCanon } from '../cloud-sync/canon-browser-harness.mjs';

const NOW = Date.parse('2026-10-22T20:00:00.000Z'); // 15:00 en Lima
function counting(raw) {
  const st = { n: 0, sql: [] };
  const db = { prepare(sql) { const s = raw.prepare(sql); st.sql.push(sql); return { bind(...v) { s.bind(...v); return this; }, async first() { st.n++; return s.first(); }, async all() { st.n++; return s.all(); }, async run() { st.n++; return s.run(); } }; } };
  return { db, st };
}
// Solo prueba: sin las vallas de escritura (triggers) para sembrar ventas directo en la base de mentira.
function unfence(d) { for (const { name } of d.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('sales','sale_items','canonical_sale_context')").all()) d.exec('DROP TRIGGER "' + name + '"'); }
// 5200 ventas viejas (septiembre) con sale_id que ordenan ANTES que las de hoy, + 3 de hoy (una anulada) + 1 de ayer a las 23:30 de Lima.
function seed(f, { old = 5200 } = {}) {
  const d = f.database; const c = d.prepare('SELECT active_promotion_id p,authority_epoch e,revision r FROM canonical_control WHERE id=1').get();
  unfence(d);
  try { d.exec('PRAGMA foreign_keys=OFF'); } catch { /* nada */ }
  const sale = d.prepare("INSERT INTO sales(sale_id,operation_id,payload_hash,commit_token,device_id,payment_method,total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)");
  const ctx = d.prepare("INSERT INTO canonical_sale_context(sale_id,operation_id,promotion_id,authority_epoch,control_revision,customer_id,client_contract,created_at) VALUES(?,?,?,?,?,NULL,'a6-gate-c-v1',?)");
  const item = d.prepare("INSERT INTO sale_items(sale_id,line_number,operation_id,product_id,quantity,unit_price_cents,line_total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)");
  const h = 'a'.repeat(64);
  const add = (id, at, cents, metodo = 'efectivo', prod = 'PX') => { sale.run(id, 'op-' + id, h, 'tok', 'session:x', metodo, cents, at); ctx.run(id, 'op-' + id, c.p, c.e, c.r, at); item.run(id, 1, 'op-' + id, prod, 2, cents / 2, cents, at); };
  d.exec('BEGIN');
  for (let i = 0; i < old; i++) add('A' + String(i).padStart(5, '0'), '2026-09-' + String(1 + (i % 28)).padStart(2, '0') + 'T15:00:00.000Z', 100, 'efectivo', 'PVIEJO');
  add('Z-hoy-1', '2026-10-22T14:00:00.000Z', 1250, 'efectivo', 'PHOY');
  add('Z-hoy-2', '2026-10-22T19:30:00.000Z', 800, 'yape', 'PHOY');
  add('Z-hoy-anulada', '2026-10-22T16:00:00.000Z', 9900, 'efectivo', 'PHOY');
  add('Z-ayer-noche', '2026-10-22T04:30:00.000Z', 700, 'efectivo', 'PAYER'); // 23:30 del 21 en Lima: NO es de hoy
  d.exec('COMMIT');
  d.prepare("INSERT INTO pos_sale_annulments(sale_id,operation_id,promotion_id,reason,status,principal_id,created_at) VALUES('Z-hoy-anulada','an-1',?,'prueba','anulada','session:x','2026-10-22T16:05:00.000Z')").run(c.p);
}

test('ventas de hoy con más de 5000 ventas: cuenta las de hoy (Lima), sin la anulada ni la de ayer, en pocas consultas', async (t) => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql', '0026_pos_sale_annulments.sql'] });
  seed(f);
  const { db, st } = counting(f.env.nuevo_amanecer_lab);
  const r = await runAssistantQuery(canonicalReader(db), { tipo: 'ventas_periodo' }, NOW);
  assert.ok(!r.error, JSON.stringify(r));
  assert.equal(r.ventas, 2); assert.equal(r.total, 20.5);
  assert.deepEqual(r.resumen.por_metodo, { Efectivo: 12.5, Yape: 8 });
  assert.equal(r.desde, '2026-10-22');
  assert.ok(st.n <= 3, 'consultas a la base: ' + st.n); // control + una agregada (antes: ~84 = 21 páginas × 4)
  assert.ok(st.sql.some((s) => /GROUP BY/i.test(s) && /created_at>=\?2/.test(s)), 'filtro de fecha y suma en SQL');
});

test('top_productos y saleLines del período: solo hoy; saleLines mantiene la forma de #930', async (t) => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql', '0026_pos_sale_annulments.sql'] });
  seed(f);
  const reader = canonicalReader(f.env.nuevo_amanecer_lab);
  const top = await reader.topItems(period({}, NOW), 10);
  assert.deepEqual(top, [{ product_id: 'PHOY', q: 4, c: 2050 }]);
  const lines = await reader.saleLines(period({}, NOW));
  assert.equal(lines.length, 2); assert.equal(lines.truncated, false);
  assert.deepEqual(Object.keys(lines[0]).sort(), ['created_at', 'line_cents', 'product_id', 'quantity', 'sale_id', 'unit_cents']);
  assert.ok(lines.every((l) => l.product_id === 'PHOY' && l.sale_id !== 'Z-hoy-anulada'));
  const sem = await runAssistantQuery(reader, { tipo: 'ventas_periodo', desde: '2026-09-01', hasta: '2026-10-22' }, NOW);
  assert.equal(sem.ventas, 5200 + 3, 'período largo: todas, sin tope de 5000'); // 5200 viejas + 2 de hoy + la de ayer
  const top2 = await runAssistantQuery(reader, { tipo: 'top_productos', desde: '2026-09-01', hasta: '2026-10-22' }, NOW);
  assert.ok(!top2.error); assert.equal(top2.filas[0][0], 'PVIEJO');
});

test('saleLines marca truncated cuando el período pasa el tope', async (t) => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql', '0026_pos_sale_annulments.sql'] });
  seed(f, { old: SALE_LINES_MAX + 5 });
  const lines = await canonicalReader(f.env.nuevo_amanecer_lab).saleLines(period({ desde: '2026-09-01', hasta: '2026-09-30' }, NOW));
  assert.equal(lines.length, SALE_LINES_MAX); assert.equal(lines.truncated, true);
});

test('sin la tabla de anulaciones (base sin 0026): igual responde, sin descontar nada', async (t) => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql'] });
  const d = f.database, c = d.prepare('SELECT active_promotion_id p,authority_epoch e,revision r FROM canonical_control WHERE id=1').get();
  assert.equal(d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='pos_sale_annulments'").get().n, 0, 'base sin la tabla');
  unfence(d); d.exec('PRAGMA foreign_keys=OFF');
  d.prepare("INSERT INTO sales(sale_id,operation_id,payload_hash,commit_token,device_id,payment_method,total_cents,created_at) VALUES('S1','o1',?,'t','session:x','plin',500,'2026-10-22T15:00:00.000Z')").run('b'.repeat(64));
  d.prepare("INSERT INTO canonical_sale_context(sale_id,operation_id,promotion_id,authority_epoch,control_revision,customer_id,client_contract,created_at) VALUES('S1','o1',?,?,?,NULL,'a6-gate-c-v1','2026-10-22T15:00:00.000Z')").run(c.p, c.e, c.r);
  const r = await runAssistantQuery(canonicalReader(f.env.nuevo_amanecer_lab), { tipo: 'ventas_periodo' }, NOW);
  assert.equal(r.ventas, 1); assert.equal(r.total, 5);
});

test('lector en memoria: saleLines con la misma forma', async () => {
  const m = memoryReader({ sales: [{ sale_id: 's1', created_at: '2026-10-22T15:00:00.000Z', metodo: 'efectivo', total_cents: 100 }], saleItems: [{ sale_id: 's1', product_id: 'P', quantity: 1, unit_price_cents: 100, line_total_cents: 100, created_at: '2026-10-22T15:00:00.000Z' }] });
  assert.deepEqual(await m.saleLines(period({}, NOW)), [{ sale_id: 's1', product_id: 'P', quantity: 1, unit_cents: 100, line_cents: 100, created_at: '2026-10-22T15:00:00.000Z' }]);
});
