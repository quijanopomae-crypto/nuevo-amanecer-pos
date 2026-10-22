// Lentitud 22-10 (paso 1): las ventas se filtran por fecha (día de Lima) EN SQL, con SUM/COUNT/GROUP BY y LIMIT.
// Antes se leían como mucho 5000 ventas por páginas (ordenadas por sale_id) y se filtraba en el Worker: con más de 5000 ventas
// «¿cuánto vendí hoy?» podía responder que no hubo ventas. Datos inventados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAssistantQuery, canonicalReader, memoryReader, period, SALE_LINES_MAX, SALES_READ_MAX } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
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
  assert.ok(st.sql.some((s) => /GROUP BY/i.test(s) && /julianday\(r\.created_at\).*>=.*julianday\(\?2\)/.test(s)), 'filtro de fecha y suma en SQL');
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

// ---------- Seguimiento de alfa (22-10) ----------
function dropTriggers(d, tables) { for (const { name } of d.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN (${tables.map((x) => `'${x}'`).join(',')})`).all()) d.exec('DROP TRIGGER "' + name + '"'); }
test('top_productos: nombres SOLO de los más vendidos, por id, con el renombre vigente (sin leer el catálogo)', async (t) => {
  const f = await activeCanon(t, { migrations: ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql', '0017_canonical_live_customers.sql', '0018_canonical_customer_credit_policy.sql', '0019_canonical_debt_reconciliation.sql', '0020_canonical_customer_contacts.sql', '0021_canonical_payment_references.sql', '0022_canonical_product_revisions.sql', '0024_pos_roles_owner_pin.sql', '0026_pos_sale_annulments.sql'] });
  const d = f.database, c = d.prepare('SELECT active_promotion_id p,authority_epoch e,revision r FROM canonical_control WHERE id=1').get();
  const [p1, p2] = d.prepare('SELECT product_id,name FROM products WHERE promotion_id=? ORDER BY product_id LIMIT 2').all(c.p);
  unfence(d); dropTriggers(d, ['canonical_product_revisions']); d.exec('PRAGMA foreign_keys=OFF');
  const sale = d.prepare("INSERT INTO sales(sale_id,operation_id,payload_hash,commit_token,device_id,payment_method,total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)");
  const ctx = d.prepare("INSERT INTO canonical_sale_context(sale_id,operation_id,promotion_id,authority_epoch,control_revision,customer_id,client_contract,created_at) VALUES(?,?,?,?,?,NULL,'a6-gate-c-v1',?)");
  const item = d.prepare("INSERT INTO sale_items(sale_id,line_number,operation_id,product_id,quantity,unit_price_cents,line_total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)");
  const at = '2026-10-22T15:00:00.000Z';
  for (const [id, pid, cents] of [['S1', p1.product_id, 900], ['S2', p2.product_id, 300]]) { sale.run(id, 'o' + id, 'a'.repeat(64), 't', 'session:x', 'efectivo', cents, at); ctx.run(id, 'o' + id, c.p, c.e, c.r, at); item.run(id, 1, 'o' + id, pid, 1, cents, cents, at); }
  const rev = d.prepare(`INSERT INTO canonical_product_revisions(operation_id,promotion_id,product_id,command,request_hash,result_json,revision,name,alternate_codes_json,cost_cents,price_cents,stock_min_quantity,authority_epoch,control_revision,client_contract,principal_id,credential_hash,created_at)
    VALUES(?,?,?,'product.update',?,'{}',?,?,'[]',1,1,0,?,?,'a6-gate-c-v1','session:x',?,?)`);
  rev.run('rv1', c.p, p1.product_id, 'b'.repeat(64), 1, 'NOMBRE VIEJO', c.e, c.r, 'c'.repeat(64), at);
  rev.run('rv2', c.p, p1.product_id, 'b'.repeat(64), 2, 'NOMBRE NUEVO', c.e, c.r, 'c'.repeat(64), at);
  const { db, st } = counting(f.env.nuevo_amanecer_lab);
  const r = await runAssistantQuery(canonicalReader(db), { tipo: 'top_productos' }, NOW);
  assert.deepEqual(r.filas.map((x) => x[0]), ['NOMBRE NUEVO', p2.name], 'renombre vigente y nombre original');
  assert.ok(!st.sql.some((s) => /read_key/.test(s)), 'sin lectura del catálogo por páginas');
  assert.ok(st.n <= 4, 'sentencias: ' + st.n);
});

test('saleLines (contrato de #930): precio vacío = null (no 0); truncated si se corta la lectura de ventas o la de líneas', async (t) => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql', '0026_pos_sale_annulments.sql'] });
  const d = f.database; seed(f, { old: 0 });
  // Una base que trae el precio vacío (por ejemplo, una réplica sin la restricción): se lee con un lector cuyo SQL devuelve null.
  const raw = f.env.nuevo_amanecer_lab;
  const nullDb = { prepare(sql) { const s = raw.prepare(sql); return { bind(...v) { s.bind(...v); return this; }, async first() { return s.first(); }, async run() { return s.run(); },
    async all() { const o = await s.all(); return { results: (o.results || []).map((x) => ('unit_price_cents' in x ? { ...x, unit_price_cents: null, line_total_cents: '' } : x)) }; } }; } };
  const lines = await canonicalReader(nullDb).saleLines(period({}, NOW));
  assert.ok(lines.length > 0 && lines.every((l) => l.unit_cents === null && l.line_cents === null), JSON.stringify(lines));
  assert.equal(lines.truncated, false);
  const ok = await canonicalReader(raw).saleLines(period({}, NOW));
  assert.ok(ok.every((l) => Number.isFinite(l.unit_cents) && Number.isFinite(l.line_cents)));
  assert.ok(d);
});

test('saleLines: más de SALES_READ_MAX ventas en el período -> truncated (quedan las más nuevas)', async (t) => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql', '0026_pos_sale_annulments.sql'] });
  seed(f, { old: SALES_READ_MAX + 3 });
  const lines = await canonicalReader(f.env.nuevo_amanecer_lab).saleLines(period({ desde: '2026-09-01', hasta: '2026-10-22' }, NOW));
  assert.equal(lines.truncated, true); assert.equal(new Set(lines.map((l) => l.sale_id)).size, SALES_READ_MAX);
  assert.ok(lines.some((l) => l.sale_id === 'Z-hoy-2'), 'las de hoy (más nuevas) quedan');
});

test('created_at con desfase -05:00 cerca de la medianoche de Lima: cuenta por el momento real, no por el texto', async (t) => {
  const f = await activeCanon(t, { migrations: ['0024_pos_roles_owner_pin.sql', '0026_pos_sale_annulments.sql'] });
  const d = f.database, c = d.prepare('SELECT active_promotion_id p,authority_epoch e,revision r FROM canonical_control WHERE id=1').get();
  unfence(d); d.exec('PRAGMA foreign_keys=OFF');
  const sale = d.prepare("INSERT INTO sales(sale_id,operation_id,payload_hash,commit_token,device_id,payment_method,total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)");
  const ctx = d.prepare("INSERT INTO canonical_sale_context(sale_id,operation_id,promotion_id,authority_epoch,control_revision,customer_id,client_contract,created_at) VALUES(?,?,?,?,?,NULL,'a6-gate-c-v1',?)");
  const item = d.prepare("INSERT INTO sale_items(sale_id,line_number,operation_id,product_id,quantity,unit_price_cents,line_total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)");
  const add = (id, at, cents) => { sale.run(id, 'o' + id, 'a'.repeat(64), 't', 'session:x', 'efectivo', cents, at); ctx.run(id, 'o' + id, c.p, c.e, c.r, at); item.run(id, 1, 'o' + id, 'P' + id, 1, cents, cents, at); };
  add('M1', '2026-10-22T00:30:00-05:00', 100);    // 22 en Lima, 00:30 (como texto quedaría ANTES de 2026-10-22T05:00Z)
  add('M2', '2026-10-21T23:59:59-05:00', 200);    // 21 en Lima, un segundo antes de medianoche
  add('M3', '2026-10-23T02:00:00-05:00', 400);    // 23 en Lima (como texto quedaría ANTES de 2026-10-23T05:00Z)
  add('M4', '2026-10-22T05:00:00.000Z', 800);     // justo la medianoche del 22 en Lima, escrito en UTC
  const reader = canonicalReader(f.env.nuevo_amanecer_lab);
  const day = await runAssistantQuery(reader, { tipo: 'ventas_periodo', desde: '2026-10-22', hasta: '2026-10-22' }, NOW);
  assert.equal(day.ventas, 2, 'M1 y M4'); assert.equal(day.total, 9);
  const rng = await reader.salesTotals(period({ desde: '2026-10-21', hasta: '2026-10-23' }, NOW));
  assert.deepEqual(rng.map((r) => [r.dia, r.c]), [['2026-10-21', 200], ['2026-10-22', 900], ['2026-10-23', 400]]);
  const lines = await reader.saleLines(period({ desde: '2026-10-22', hasta: '2026-10-22' }, NOW));
  assert.deepEqual(lines.map((l) => l.sale_id).sort(), ['M1', 'M4']);
  const top = await reader.topItems(period({ desde: '2026-10-22', hasta: '2026-10-22' }, NOW), 10);
  assert.deepEqual(top.map((x) => x.product_id), ['PM4', 'PM1']);
  const mem = memoryReader({ sales: [{ sale_id: 'm', created_at: '2026-10-22T00:30:00-05:00', metodo: 'efectivo', total_cents: 100 }] });
  assert.equal((await mem.salesTotals(period({ desde: '2026-10-22', hasta: '2026-10-22' }, NOW))).length, 1, 'el lector en memoria también');
});

// (22-10, prueba en vivo) «más vendidos del mes» mostraba «GENERIC:<uuid>»: una línea genérica (VARIOS, VERDURAS…) sale con SU nombre guardado,
// las del mismo nombre juntas; sin nombre, «Producto genérico». Nunca el id crudo (ni en la tabla ni en lo que ve el modelo).
test('top_productos: líneas genéricas (GENERIC:<uuid>) con su nombre guardado, agrupadas; nunca el id', async (t) => {
  const f = await activeCanon(t, { migrations: ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql', '0024_pos_roles_owner_pin.sql', '0026_pos_sale_annulments.sql'] });
  const d = f.database, c = d.prepare('SELECT active_promotion_id p,authority_epoch e,revision r FROM canonical_control WHERE id=1').get();
  const [p1] = d.prepare('SELECT product_id,name FROM products WHERE promotion_id=? ORDER BY product_id LIMIT 1').all(c.p);
  unfence(d); dropTriggers(d, ['canonical_generic_sale_lines']); d.exec('PRAGMA foreign_keys=OFF');
  const sale = d.prepare("INSERT INTO sales(sale_id,operation_id,payload_hash,commit_token,device_id,payment_method,total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)");
  const ctx = d.prepare("INSERT INTO canonical_sale_context(sale_id,operation_id,promotion_id,authority_epoch,control_revision,customer_id,client_contract,created_at) VALUES(?,?,?,?,?,NULL,'a6-gate-c-v1',?)");
  const item = d.prepare("INSERT INTO sale_items(sale_id,line_number,operation_id,product_id,quantity,unit_price_cents,line_total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)");
  const gl = d.prepare('INSERT INTO canonical_generic_sale_lines(sale_id,line_number,operation_id,promotion_id,generic_product_id,name,code,quantity,unit_price_cents,line_total_cents,created_at) VALUES(?,?,?,?,?,?,NULL,?,?,?,?)');
  const at = '2026-10-22T15:00:00.000Z';
  const lines = [['G1', 'GENERIC:11111111-aaaa-4bbb-8ccc-000000000001', 'VARIOS', 1, 500], ['G2', 'GENERIC:11111111-aaaa-4bbb-8ccc-000000000002', ' varios ', 2, 400],
    ['G3', 'GENERIC:11111111-aaaa-4bbb-8ccc-000000000003', 'VERDURAS', 1, 700], ['P1', p1.product_id, null, 1, 300]];
  for (const [id, pid, name, q, cents] of lines) { sale.run(id, 'o' + id, 'a'.repeat(64), 't', 'session:x', 'efectivo', q * cents, at); ctx.run(id, 'o' + id, c.p, c.e, c.r, at);
    item.run(id, 1, 'o' + id, pid, q, cents, q * cents, at); if (name !== null) gl.run(id, 1, 'o' + id, c.p, pid, name, q, cents, q * cents, at); }
  // una genérica sin fila de nombre (réplica incompleta): etiqueta legible
  sale.run('G4', 'oG4', 'a'.repeat(64), 't', 'session:x', 'efectivo', 100, at); ctx.run('G4', 'oG4', c.p, c.e, c.r, at); item.run('G4', 1, 'oG4', 'GENERIC:11111111-aaaa-4bbb-8ccc-000000000004', 1, 100, 100, at);
  const r = await runAssistantQuery(canonicalReader(f.env.nuevo_amanecer_lab), { tipo: 'top_productos', periodo: 'mes' }, NOW);
  assert.deepEqual(r.filas, [['VARIOS', 3, 13], ['VERDURAS', 1, 7], [p1.name, 1, 3], ['Producto genérico', 1, 1]]);
  assert.ok(!JSON.stringify(r).includes('GENERIC:'), JSON.stringify(r));
  // el lector en memoria (prototipo) igual
  const m = memoryReader({ sales: lines.concat([['G4', 'GENERIC:x', null, 1, 100]]).map(([id]) => ({ sale_id: id, created_at: at, metodo: 'efectivo', total_cents: 1 })),
    products: [{ id: p1.product_id, nombre: p1.name }],
    saleItems: lines.concat([['G4', 'GENERIC:x', null, 1, 100]]).map(([id, pid, name, q, cents]) => ({ sale_id: id, product_id: pid, generic_name: name, quantity: q, unit_price_cents: cents, line_total_cents: q * cents, created_at: at })) });
  const rm = await runAssistantQuery(m, { tipo: 'top_productos', periodo: 'mes' }, NOW);
  assert.deepEqual(rm.filas, r.filas); assert.ok(!JSON.stringify(rm).includes('GENERIC:'));
});

// (22-10, prueba en vivo W72) el texto decía «otros siete» con 9 filas en la tarjeta: al modelo van como mucho 8 en «top»,
// así que se le pasa también cuántas filas ve el Admin en pantalla.
test('top_productos: el resumen al modelo dice cuántas filas tiene la tarjeta (filas_en_pantalla)', async () => {
  const at = '2026-10-22T15:00:00.000Z', ids = Array.from({ length: 10 }, (_, i) => 'P' + i);
  const m = memoryReader({ sales: ids.map((id) => ({ sale_id: 'S' + id, created_at: at, metodo: 'efectivo', total_cents: 1 })),
    products: ids.map((id) => ({ id, nombre: 'Producto ' + id })),
    saleItems: ids.map((id, i) => ({ sale_id: 'S' + id, product_id: id, quantity: 1, unit_price_cents: 100 + i, line_total_cents: 100 + i, created_at: at })) });
  const r = await runAssistantQuery(m, { tipo: 'top_productos', periodo: 'mes' }, NOW);
  assert.equal(r.filas.length, 10);
  assert.equal(r.resumen.filas_en_pantalla, r.filas.length);
  assert.ok(r.resumen.top.length < r.filas.length, 'al modelo van menos filas que en pantalla');
});
