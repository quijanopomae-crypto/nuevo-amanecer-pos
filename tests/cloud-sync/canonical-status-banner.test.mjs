// Etapa 1.5 (auditoría 2026-10-12): franja superior única. Ámbar = reintentando,
// rojo = rechazado/bloqueado o caja de otro día; número + «Ver»; al reconectar
// reintenta con el MISMO operation_id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SCRIPTS = [['adapter', read('POS/js/adapters/canonical-ui-adapter.js')],
  ...['canonical-sale-intent', 'canonical-sale-outbox', 'canonical-status-banner'].map((n) => [n, read('POS/js/sync/' + n + '.js')])];
const MIGS = ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql'];

test('index y service worker cargan la franja', () => {
  assert.match(read('POS/index.html'), /<script src="js\/sync\/canonical-status-banner\.js"><\/script>/);
  assert.match(read('POS/sw.js'), /'\.\/js\/sync\/canonical-status-banner\.js'/);
});

test('sin pendientes no se muestra nada', async (t) => {
  const f = await activeCanon(t, { migrations: MIGS });
  const d = await device(f, { token: 'b0', deviceId: 'b0', scripts: SCRIPTS, globals: { obtenerHoy: () => new Date().toISOString().slice(0, 10) } });
  assert.equal(d.context.NuevoAmanecerStatusBanner.view(d.context.NuevoAmanecerStatusBanner.compute()), null);
});

test('503 en un ajuste: franja ámbar «1 pendiente · reintentando»; al reconectar se aplica UNA vez con el mismo operation_id y la franja desaparece', async (t) => {
  const f = await activeCanon(t, { migrations: MIGS });
  let fail = true;
  const d = await device(f, { token: 'b1', deviceId: 'b1', scripts: SCRIPTS,
    onFetch: async (url) => (fail && url.endsWith('/commands/inventory.adjust') ? Response.json({ error: 'service_unavailable' }, { status: 503 }) : null) });
  const p = d.api.snapshot().products.find((x) => Number(x.tracks_inventory) === 1);
  const before = f.sql('SELECT current_stock_quantity q FROM products WHERE product_id=?', p.product_id).q;
  await assert.rejects(d.api.adjustInventory({ product_id: p.product_id, movement_type: 'ENTRADA', quantity: 1, reason: 'Prueba banner' }));
  const op = d.api.pendingSnapshot().payload.operation_id;
  const banner = d.context.NuevoAmanecerStatusBanner;
  const v = banner.view(banner.compute());
  assert.equal(v.tone, 'amber'); assert.equal(v.count, 1); assert.match(v.text, /^1 operación pendiente · reintentando$/);
  fail = false;
  await banner.retryOnReconnect();
  assert.equal(f.sql('SELECT current_stock_quantity q FROM products WHERE product_id=?', p.product_id).q, before + 1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_manual_inventory_movements WHERE operation_id=?', op).n, 1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_manual_inventory_movements').n, 1);
  assert.equal(d.api.pendingSnapshot(), null);
  assert.equal(banner.view(banner.compute()), null);
});

test('rechazo definitivo (409): franja roja y NO se reintenta sola', async (t) => {
  const f = await activeCanon(t, { migrations: MIGS });
  const d = await device(f, { token: 'b2', deviceId: 'b2', scripts: SCRIPTS,
    onFetch: async (url) => (url.endsWith('/commands/inventory.adjust') ? Response.json({ error: 'stale_stock' }, { status: 409 }) : null) });
  const p = d.api.snapshot().products.find((x) => Number(x.tracks_inventory) === 1);
  await assert.rejects(d.api.adjustInventory({ product_id: p.product_id, movement_type: 'ENTRADA', quantity: 1, reason: 'Prueba banner' }));
  const banner = d.context.NuevoAmanecerStatusBanner;
  const v = banner.view(banner.compute());
  assert.equal(v.tone, 'red'); assert.match(v.text, /^1 operación rechazada o bloqueada$/);
  const posts = () => d.fetchLog.filter((x) => x.url.endsWith('/commands/inventory.adjust')).length;
  const n = posts(); await banner.retryOnReconnect(); assert.equal(posts(), n, 'sin reenvío automático de un rechazo');
});

test('caja abierta de otro día: franja roja con el aviso dentro', async (t) => {
  const f = await activeCanon(t, { migrations: MIGS });
  const d = await device(f, { token: 'b3', deviceId: 'b3', scripts: SCRIPTS, globals: { obtenerHoy: () => '2099-01-01' } });
  await d.api.openCash({ session_id: 'S-old', opening_cents: 0 }); await d.api.refresh();
  const banner = d.context.NuevoAmanecerStatusBanner;
  const v = banner.view(banner.compute());
  assert.equal(v.tone, 'red'); assert.match(v.text, /La caja abierta es del \d{4}-\d{2}-\d{2}: ciérrala y abre la de hoy/);
});

test('plural correcto en la franja', async () => {
  const src = read('POS/js/sync/canonical-status-banner.js');
  const sb = { setInterval() {}, clearInterval() {} }; sb.globalThis = sb;
  new Function('globalThis', src)(sb);
  const b = sb.NuevoAmanecerStatusBanner;
  assert.equal(b.view({ retrying: 3, blocked: 0, otherDay: null, items: [] }).text, '3 operaciones pendientes · reintentando');
  assert.equal(b.view({ retrying: 0, blocked: 2, otherDay: null, items: [] }).text, '2 operaciones rechazadas o bloqueadas');
  assert.doesNotMatch(src, /\(s\)/);
  const off = b.view({ retrying: 0, blocked: 0, otherDay: null, offline: true, items: [] });
  assert.equal(off.tone, 'amber'); assert.match(off.text, /^Sin conexión/);
});

test('abono en efectivo con respuesta perdida + reconexión: la caja queda correcta y el servidor tiene exactamente 1 pago', async (t) => {
  const f = await activeCanon(t, { migrations: MIGS });
  let lose = false;
  const d = await device(f, { token: 'b4', deviceId: 'b4', scripts: SCRIPTS, globals: { obtenerHoy: () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }) },
    onFetch: async (url, _o, real) => { if (lose && url.endsWith('/commands/payment.create')) { await real(); throw new TypeError('Failed to fetch'); } return null; } });
  await d.api.openCash({ session_id: 'S-abono', opening_cents: 1000 }); await d.api.refresh();
  const credit = d.api.snapshot().credits.find((c) => Number(c.current_balance_cents) >= 100);
  assert.ok(credit, 'hay un crédito con saldo');
  const paymentsBefore = f.sql("SELECT COUNT(*) n FROM canonical_financial_operations WHERE command='payment.create'").n;
  lose = true;
  await assert.rejects(d.api.createPayment({ credit_id: credit.credit_id, amount_cents: 100, payment_method: 'efectivo', session_id: 'S-abono' }));
  lose = false;
  const op = d.api.pendingSnapshot().payload.operation_id;
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_operations WHERE command='payment.create'").n, paymentsBefore + 1, 'el servidor sí lo registró');
  const banner = d.context.NuevoAmanecerStatusBanner;
  assert.equal(banner.view(banner.compute()).tone, 'amber');
  await banner.retryOnReconnect();
  assert.equal(d.api.pendingSnapshot(), null);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_financial_operations WHERE command='payment.create'").n, paymentsBefore + 1, 'exactamente 1 pago, sin duplicar');
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_financial_operations WHERE operation_id=?', op).n, 1);
  const cash = d.context.NuevoAmanecerCanonicalUIAdapter.cashState(d.api.snapshot().cashSessions);
  assert.equal(cash.sessionId, 'S-abono'); assert.equal(cash.abierta, true);
  assert.equal(cash.esperado, 11, 'fondo S/ 10 + abono S/ 1');
  assert.equal(banner.view(banner.compute()), null);
});

test('caja de otro día: la franja roja desaparece sin F5 cuando el servidor ya muestra la caja de hoy', async (t) => {
  const f = await activeCanon(t, { migrations: MIGS });
  let today = '2099-01-01';
  const d = await device(f, { token: 'b5', deviceId: 'b5', scripts: SCRIPTS, globals: { obtenerHoy: () => today } });
  await d.api.openCash({ session_id: 'S-ayer', opening_cents: 0 }); await d.api.refresh();
  const banner = d.context.NuevoAmanecerStatusBanner;
  assert.equal(banner.view(banner.compute()).tone, 'red');
  // Otro equipo cierra la caja vieja y abre la de hoy.
  const other = await device(f, { token: 'b5o', deviceId: 'b5o', scripts: SCRIPTS });
  await other.api.refresh(); await other.api.closeCash({ counted_cents: 0 }); await other.api.refresh();
  await other.api.openCash({ session_id: 'S-hoy', opening_cents: 0 });
  await d.api.refresh(); // misma lectura que hace la app al reconectar o volver a la pestaña (sin recargar)
  const open = d.context.NuevoAmanecerCanonicalUIAdapter.cashState(d.api.snapshot().cashSessions);
  assert.equal(open.sessionId, 'S-hoy');
  today = open.fechaApertura; // la caja abierta es la de hoy
  assert.equal(banner.view(banner.compute()), null, 'sin franja roja, sin F5');
});

test('Bot 2 P2: un cierre de caja con 500 NUNCA se reenvía solo (ni al reconectar ni desde la cola de ventas)', async (t) => {
  const f = await activeCanon(t, { migrations: MIGS });
  let fail = true;
  const d = await device(f, { token: 'b9', deviceId: 'b9', scripts: SCRIPTS, globals: { obtenerHoy: () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }) },
    onFetch: async (url) => (fail && url.endsWith('/commands/cash.close') ? Response.json({ error: 'internal' }, { status: 500 }) : null) });
  await d.api.openCash({ session_id: 'S-p2', opening_cents: 1000 }); await d.api.refresh();
  await assert.rejects(d.api.closeCash({ counted_cents: 1000, session_id: 'S-p2' }));
  fail = false;
  const posts = () => d.fetchLog.filter((x) => x.url.endsWith('/commands/cash.close')).length;
  const n = posts();
  await d.context.NuevoAmanecerStatusBanner.retryOnReconnect();
  try { await d.context.NuevoAmanecerCanonicalSaleOutbox.sync(); } catch (_) {}
  assert.equal(posts(), n, 'sin reenvío automático del cierre');
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_cash_closures").n, 0, 'la caja sigue abierta');
  assert.equal(d.api.pendingSnapshot().command, 'cash.close', 'queda esperando que el cajero vuelva a confirmar');
});

// Rendimiento (2026-10-23): la franja no debe copiar toda la réplica cada 5 s.
test('compute() usa cashSessionsSnapshot y NO snapshot() completo; la caja de otro día se sigue avisando', async (t) => {
  const f = await activeCanon(t, { migrations: MIGS });
  const d = await device(f, { token: 'b9', deviceId: 'b9', scripts: SCRIPTS, globals: { obtenerHoy: () => new Date().toISOString().slice(0, 10) } });
  const banner = d.context.NuevoAmanecerStatusBanner;
  assert.equal(typeof d.context.NuevoAmanecerCanonical.cashSessionsSnapshot, 'function');
  assert.ok(Array.isArray(d.context.NuevoAmanecerCanonical.cashSessionsSnapshot()));
  const real = d.context.NuevoAmanecerCanonical;
  let full = 0, light = 0;
  const spy = Object.assign({}, real, { snapshot: () => { full++; return real.snapshot(); }, cashSessionsSnapshot: () => { light++; return real.cashSessionsSnapshot(); } });
  const orig = d.context.NuevoAmanecerCanonical;
  d.context.NuevoAmanecerCanonical = spy;
  try { banner.compute(); } finally { d.context.NuevoAmanecerCanonical = orig; }
  assert.equal(full, 0, 'sin copia completa'); assert.equal(light, 1);
});

test('con la lectura liviana la caja abierta de otro día SIGUE avisándose (otherDay) y sin copia completa', async (t) => {
  const f = await activeCanon(t, { migrations: MIGS });
  const d = await device(f, { token: 'b10', deviceId: 'b10', scripts: SCRIPTS, globals: { obtenerHoy: () => '2099-01-01' } });
  await d.api.openCash({ session_id: 'S-old2', opening_cents: 0 }); await d.api.refresh();
  const real = d.context.NuevoAmanecerCanonical; let full = 0;
  d.context.NuevoAmanecerCanonical = Object.assign({}, real, { snapshot: () => { full++; return real.snapshot(); } });
  let st; try { st = d.context.NuevoAmanecerStatusBanner.compute(); } finally { d.context.NuevoAmanecerCanonical = real; }
  assert.match(String(st.otherDay), /^\d{4}-\d{2}-\d{2}$/); assert.equal(full, 0);
});

test('pestaña oculta: el tick de 5 s NO calcula ni dibuja; al volver visible sí dibuja', async () => {
  const src = read('POS/js/sync/canonical-status-banner.js');
  let calls = 0, tickFn = null; const handlers = {}; const docHandlers = {};
  const doc = { hidden: true, body: undefined, readyState: 'complete', addEventListener(n, fn) { docHandlers[n] = fn; }, getElementById() { return null; } };
  const sb = { document: doc, setInterval(fn) { tickFn = fn; return 1; }, clearInterval() {}, addEventListener(n, fn) { handlers[n] = fn; }, setTimeout() {},
    NuevoAmanecerCanonical: { enabled() { return true; }, cashSessionsSnapshot() { calls++; return []; }, pendingSnapshot() { return null; } } };
  sb.globalThis = sb;
  new Function('globalThis', 'setInterval', 'setTimeout', src)(sb, sb.setInterval, sb.setTimeout); // sin temporizadores reales
  sb.NuevoAmanecerStatusBanner.start();
  const arranque = calls; // start() dibuja una vez
  for (let i = 0; i < 10; i++) tickFn();
  assert.equal(calls, arranque, 'oculta: ningún cálculo en 10 ticks');
  doc.hidden = false; for (let i = 0; i < 5; i++) tickFn();
  assert.equal(calls, arranque + 1, 'visible: dibuja en el quinto tick');
  doc.hidden = true; const antes = calls; doc.hidden = false; docHandlers.visibilitychange();
  assert.equal(calls, antes + 1, 'al volver visible redibuja');
});
