// T-47 S3: la caché local del usuario anterior no llega a otra identidad (fix-cache-rol).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../POS/js/sync/cache-identity-guard.js', import.meta.url), 'utf8');
function store(init = {}) { const m = new Map(Object.entries(init)); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, _m: m }; }
const ownerSnapshot = () => JSON.stringify({ version: 9, updatedAt: '2026-10-21T00:00:00Z', appConfig: { negocio: 'x' },
  data: { productos: [{ id: '00001', precio: 5, costo: 7770.01 }], ventas: [{ id: 'V-1', items: [{ id: '00001', costo: 7770.01, precio: 5 }] }], clientes: [], creditos: [],
    gastos: [{ desc: 'GASTO-RESTRINGIDO', monto: 8880.02, nota: 'nota restringida' }], cajMovs: [], cashClosures: [{ id: 'c1' }], inventoryMovements: [{ reason: 'PROVEEDOR-RESTRINGIDO F9' }] },
  cart: [{ id: '00001', qty: 1, costo: 7770.01 }], cloudSync: { pending: [{ op: 'keep-me' }] },
  canonicalReplica: replica() });
// Réplica con la forma de canonical-client.js replicaOf (schema 2) y sellos de validación remota.
const replica = () => ({ schema_version: 2, cached_at: '2026-10-21T00:00:00Z', promotion_id: 'p1', authority_epoch: 1, revision: 3, financial_revision: 9,
  canonical_digest: 'dig-owner', digests: { products: 'd1', expenses: 'd2' }, mode: 'ACTIVE', read_only: false, minimum_client_contract: 'c',
  remote_validated_at: '2026-10-21T00:00:00Z', remote_validated_context: 'ctx-owner', remote_validated_build: 'b1',
  products: [{ product_id: '00001', name: 'Arroz', price_cents: 500, stock_units: 40, cost_cents: 777001, supplier_name: 'PROVEEDOR-RESTRINGIDO' }],
  customers: [{ customer_id: 'C1', name: 'Cliente' }], credits: [], credit_payments: [], credit_accounts: [],
  sales: [{ sale_id: 'S1', total_cents: 500 }], sale_items: [{ sale_id: 'S1', product_id: '00001', unit_price_cents: 500, unit_cost_cents: 777001 }],
  inventory_movements: [{ product_id: '00001', reason: 'Compra PROVEEDOR-RESTRINGIDO factura F9' }], cash_movements: [], cash_sessions: [{ session_id: 'K1', status: 'OPEN' }],
  financial_events: [], expenses: [{ amount_cents: 888002, note: 'nota restringida' }] });
function boot({ token = 'tok-B', tag, role, extraLocal = {}, idb } = {}) {
  const local = store({ na_cloud_sync_credentials: token ? JSON.stringify({ endpoint: 'https://x', token }) : undefined, na_snapshot_v9: ownerSnapshot(),
    na_canonical_sale_outbox_v1: '{"version":1,"intents":[{"operation_id":"op-1"}]}', na_canonical_sale_journal: '{"state":"PENDING"}', na_pos_reviews_cache_v1: '{"reviews":[]}', ...extraLocal });
  if (!token) local.removeItem('na_cloud_sync_credentials');
  if (tag) local.setItem('na_cache_identity_v1', JSON.stringify(tag));
  if (role) local.setItem('na_pos_role_v1', JSON.stringify({ role }));
  const session = store({ na_snapshot_v9_session: ownerSnapshot() });
  const events = {}; const loads = [];
  const ctx = { localStorage: local, sessionStorage: session, setTimeout, clearTimeout, Promise, JSON, Math,
    addEventListener: (n, f) => { events[n] = f; }, loadAllData: async () => { loads.push(local.getItem('na_snapshot_v9')); return 'loaded'; },
    _naReadCanonicalReplica: async () => ({ owner: 'replica-sin-depurar' }), _naReadIDBSnapshot: async () => ({ owner: 'snapshot-idb-sin-depurar' }) };
  if (idb) ctx.indexedDB = idb;
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  return { ctx, local, session, events, loads, api: ctx.NuevoAmanecerCacheIdentity };
}
const fpOf = t => boot({ token: t }).api.fingerprint(t);
const clean = raw => { const s = JSON.parse(raw), j = JSON.stringify(s);
  return s.data.gastos.length === 0 && !j.includes('7770.01') && !j.includes('777001') && !j.includes('888002') && !j.includes('PROVEEDOR') && !j.includes('nota restringida'); };
// El catálogo offline sigue ahí: productos con precio y stock, clientes, ventas, caja abierta.
const catalogKept = raw => { const r = JSON.parse(raw).canonicalReplica;
  return !!r && r.products[0].price_cents === 500 && r.products[0].stock_units === 40 && r.customers.length === 1 && r.sales.length === 1 && r.sale_items[0].unit_price_cents === 500 && r.cash_sessions.length === 1; };
// Misma condición que canonical-client.js validReplica (schema, ids, arreglos, sin claves secretas) y que fastRevalidationCandidate.
const acceptedOffline = raw => { const r = JSON.parse(raw).canonicalReplica;
  return r.schema_version === 2 && typeof r.promotion_id === 'string' && Number.isSafeInteger(r.revision) && ['products','customers','credits','credit_payments'].every(k => Array.isArray(r[k])) &&
    !/token|secret|password|api.?key|credential/i.test(Object.keys(r).join(' ')); };
const fastCandidate = raw => { const r = JSON.parse(raw).canonicalReplica; return typeof r.remote_validated_at === 'string' && Number.isFinite(Date.parse(r.remote_validated_at)); };

test('token distinto al de la etiqueta: purga snapshot local/sesión antes de loadAllData y conserva colas pendientes', async () => {
  const b = boot({ token: 'tok-B', tag: { v: 1, fp: fpOf('tok-A'), role: 'owner', device_id: 'session:A' } });
  assert.equal(await b.ctx.loadAllData(), 'loaded');
  assert.equal(b.api.decision, 'identity-changed-scrubbed');
  assert.ok(clean(b.loads[0]), 'loadAllData ve el snapshot ya depurado');
  assert.ok(catalogKept(b.loads[0]), 'el catálogo offline se conserva');
  assert.ok(clean(b.session.getItem('na_snapshot_v9_session')));
  const s = JSON.parse(b.local.getItem('na_snapshot_v9'));
  assert.deepEqual(s.cloudSync, { pending: [{ op: 'keep-me' }] }); assert.equal(s.data.ventas[0].items[0].precio, 5); assert.equal(s.cart[0].qty, 1);
  assert.equal(b.local.getItem('na_canonical_sale_outbox_v1'), '{"version":1,"intents":[{"operation_id":"op-1"}]}');
  assert.equal(b.local.getItem('na_canonical_sale_journal'), '{"state":"PENDING"}');
  assert.equal(b.local.getItem('na_pos_reviews_cache_v1'), null);
  assert.equal(JSON.parse(b.local.getItem('na_cache_identity_v1')).fp, fpOf('tok-B'));
});
test('misma identidad: no toca la caché (el dueño conserva sus datos sin conexión)', async () => {
  const b = boot({ token: 'tok-A', tag: { v: 1, fp: fpOf('tok-A'), role: 'owner' } });
  await b.ctx.loadAllData(); assert.equal(b.api.decision, 'match'); assert.ok(!clean(b.loads[0]));
});
test('caché heredada sin etiqueta: se conserva solo con rol owner en caché; si no, falla cerrada', async () => {
  const o = boot({ token: 'tok-A', role: 'owner' }); await o.ctx.loadAllData();
  assert.equal(o.api.decision, 'legacy-owner-adopted'); assert.ok(!clean(o.loads[0]));
  for (const role of ['empleado', undefined]) {
    const e = boot({ token: 'tok-B', role }); await e.ctx.loadAllData();
    assert.equal(e.api.decision, 'legacy-untagged-scrubbed'); assert.ok(clean(e.loads[0])); assert.ok(catalogKept(e.loads[0]));
  }
});
test('sin credenciales (modo local, dueño): no purga', async () => {
  const b = boot({ token: null }); await b.ctx.loadAllData(); assert.equal(b.api.decision, 'no-credentials'); assert.ok(!clean(b.loads[0]));
});
test('/auth/me confirma otro aparato o rol con el mismo token: purga y vuelve a etiquetar', async () => {
  const b = boot({ token: 'tok-A', tag: { v: 1, fp: fpOf('tok-A'), role: 'owner', device_id: 'session:A' } });
  await b.ctx.loadAllData();
  b.ctx.NA_ROLES = { confirmed: true, deviceId: 'session:A', role: 'empleado' };
  b.events['na:role'](); await new Promise(r => setTimeout(r, 10));
  assert.ok(clean(b.local.getItem('na_snapshot_v9')));
  const tag = JSON.parse(b.local.getItem('na_cache_identity_v1')); assert.equal(tag.role, 'empleado'); assert.equal(tag.device_id, 'session:A');
});
test('modo hide (diario futuro): no borra, oculta lo que no lleva la huella actual', async () => {
  const b = boot({ token: 'tok-B', tag: { v: 1, fp: fpOf('tok-B') } }); await b.ctx.loadAllData();
  b.api.registerStore({ db: 'Journal', store: 'ops', mode: 'hide' });
  const rows = [{ id: 1, identity_fp: fpOf('tok-A') }, { id: 2, identity_fp: fpOf('tok-B') }, { id: 3 }];
  assert.deepEqual(b.api.visibleRecords(rows).map(r => r.id), [2]);
  assert.throws(() => b.api.registerStore({ db: 'J', store: 'o', mode: 'delete-all' }), /CACHE_IDENTITY_INVALID_STORE/);
});
test('réplica depurada: válida offline, nunca califica para la re-confirmación rápida, y digest anulado', async () => {
  const b = boot({ token: 'tok-B', role: 'empleado' }); await b.ctx.loadAllData();
  const raw = b.local.getItem('na_snapshot_v9'), r = JSON.parse(raw).canonicalReplica;
  assert.ok(acceptedOffline(raw)); assert.ok(!fastCandidate(raw));
  assert.equal(r.canonical_digest, null); assert.deepEqual(r.digests, {});
  assert.equal(r.remote_validated_context, undefined); assert.equal(r.remote_validated_build, undefined);
  assert.deepEqual([r.promotion_id, r.authority_epoch, r.revision, r.financial_revision], ['p1', 1, 3, 9], 'revisión intacta: cacheIsNewer no la prefiere a la del servidor');
  assert.deepEqual([r.expenses, r.inventory_movements], [[], []]); assert.ok(r.identity_scrubbed_at);
  // Segunda depuración sobre la misma réplica: idempotente (no reescribe nada).
  const snap = JSON.parse(raw); assert.equal(b.api.scrubSnapshot(snap), false);
});
test('réplica con esquema desconocido: se borra entera (falla cerrada)', () => {
  const b = boot({ token: 'tok-A', role: 'owner' });
  const snap = { data: {}, canonicalReplica: { schema_version: 99, products: [{ cost_cents: 1 }] } };
  assert.equal(b.api.scrubSnapshot(snap), true); assert.equal(snap.canonicalReplica, undefined);
});
test('check() repetido (lanzador: arranque + activación) no depura dos veces', async () => {
  const b = boot({ token: 'tok-B', tag: { v: 1, fp: fpOf('tok-A') } });
  const second = await b.api.check('activation');
  assert.equal(second, 'match'); assert.equal(b.api.diagnostics().purges.length, 1);
});
test('/auth/me confirma empleado con la app abierta: vacía en memoria gastos/costos y re-pinta antes de refresh()', async () => {
  const b = boot({ token: 'tok-A', tag: { v: 1, fp: fpOf('tok-A'), role: 'owner', device_id: 'session:A' } });
  await b.ctx.loadAllData();
  // Globals de la página (let en inline-02.js) simulados en el contexto global.
  vm.runInContext(`var gastos = [{ monto: 8880.02 }]; var productos = [{ id: '00001', precio: 5, costo: 7770.01 }]; var cart = []; var ventas = []; var inventoryMovements = [{ reason: 'PROVEEDOR' }]; var cashClosures = []; var cajMovs = [{ tipo: 'gas', monto: 8880.02 }, { tipo: 'vta', monto: 5 }]; var cajEstado = { abierta: true, esperado: 1, diferencia: 2 };
    var document = { getElementById: () => ({}) }; var rendered = []; var rendersAtRefresh = null; function _naRenderPageNow(id) { rendered.push(id); }
    var projected = null; function _naApplyCanonicalLegacyView(c) { projected = c; }
    var NuevoAmanecerCanonical = { refresh: () => { rendersAtRefresh = { gastos: gastos.length, costo: productos[0].costo, rendered: rendered.slice() }; return new Promise(() => {}); } };`, b.ctx);
  b.ctx.NA_ROLES = { confirmed: true, deviceId: 'session:A', role: 'empleado' };
  b.events['na:role']();
  const g = vm.runInContext('({ gastos, productos, rendered, cajMovs, cajEstado })', b.ctx);
  assert.equal(JSON.stringify(g.cajMovs), '[{"tipo":"vta","monto":5}]'); assert.equal(JSON.stringify(g.cajEstado), '{"abierta":true}');
  assert.equal(g.gastos.length, 0); assert.equal(g.productos[0].costo, undefined); assert.equal(g.productos[0].precio, 5);
  assert.ok(g.rendered.includes('pageMenu') && g.rendered.includes('pageGastos') && g.rendered.includes('pageInventario'));
  // Mientras refresh() no termina, una proyección desde la memoria de canonical-client no trae gastos ni costos.
  vm.runInContext(`_naApplyCanonicalLegacyView({ expenses: [{ amount_cents: 888002 }], inventoryMovements: [{}], products: [{ cost_cents: 777001, price_cents: 500 }], sales: [] })`, b.ctx);
  const p = vm.runInContext('projected', b.ctx);
  assert.equal(JSON.stringify(p.expenses), '[]'); assert.equal(p.products[0].cost_cents, undefined); assert.equal(p.products[0].price_cents, 500);
  await new Promise(r => setTimeout(r, 10));
  const at = vm.runInContext('rendersAtRefresh', b.ctx); assert.equal(at.gastos, 0); assert.equal(at.costo, undefined);
});

// IndexedDB falsa: 'ok' responde; 'timeout' nunca responde; 'error' dispara onerror; 'blocked' dispara onblocked (otra pestaña).
function fakeIDB(mode, stores = {}) {
  const later = (f, ms = 0) => setTimeout(f, ms);
  return { stores, open() {
    const req = {};
    later(() => {
      if (mode === 'timeout') return;
      if (mode === 'error') return req.onerror && req.onerror({});
      if (mode === 'blocked') return req.onblocked && req.onblocked({});
      req.result = { objectStoreNames: { contains: n => n in stores }, close() {}, transaction(name) {
        const m = stores[name], tx = {};
        tx.objectStore = () => ({ get(k) { const g = {}; later(() => { g.result = m.has(k) ? structuredClone(m.get(k)) : undefined; g.onsuccess && g.onsuccess(); }); return g; },
          put(v, k) { m.set(k, structuredClone(v)); }, delete(k) { m.delete(k); }, clear() { m.clear(); } });
        later(() => tx.oncomplete && tx.oncomplete(), 5);
        return tx;
      } };
      req.onsuccess && req.onsuccess();
    });
    return req;
  } };
}
for (const mode of ['timeout', 'error', 'blocked']) {
  test(`B1 IndexedDB ${mode}: no escribe la etiqueta, decisión de falla y réplica/snapshot IDB anulados en esta carga`, async () => {
    const oldTag = { v: 1, fp: fpOf('tok-A'), role: 'owner' };
    const b = boot({ token: 'tok-B', tag: oldTag, idb: fakeIDB(mode) });
    await b.ctx.loadAllData();
    assert.equal(b.api.decision, 'identity-changed-idb-failed');
    assert.equal(b.api.failClosed, true);
    assert.equal(JSON.parse(b.local.getItem('na_cache_identity_v1')).fp, oldTag.fp, 'la etiqueta vieja sigue: se reintenta al próximo arranque');
    assert.equal(await b.ctx._naReadCanonicalReplica(), null);
    assert.equal(await b.ctx._naReadIDBSnapshot(), null);
    assert.ok(clean(b.loads[0]), 'el almacenamiento síncrono sí quedó depurado');
    assert.equal(b.api.diagnostics().purges[0].ok, false);
  });
}
test('B1: el siguiente arranque con IndexedDB sana depura IDB, etiqueta y vuelve a leer', async () => {
  const stores = { state: new Map([['snapshot_v9', JSON.parse(ownerSnapshot())], ['snapshot_v10', { full: 'GASTO 8880.02' }], ['otro', 1]]), checkpoints: new Map([['legacy-v9:1', { costo: 7770.01 }]]), operations: new Map([['op-1', { pending: true }]]) };
  const b = boot({ token: 'tok-B', tag: { v: 1, fp: fpOf('tok-A') }, idb: fakeIDB('ok', stores) });
  await b.ctx.loadAllData();
  assert.equal(b.api.decision, 'identity-changed-scrubbed'); assert.equal(b.api.failClosed, false);
  assert.equal(JSON.parse(b.local.getItem('na_cache_identity_v1')).fp, fpOf('tok-B'));
  assert.ok(clean(JSON.stringify(stores.state.get('snapshot_v9')))); assert.ok(catalogKept(JSON.stringify(stores.state.get('snapshot_v9'))));
  assert.equal(stores.state.has('snapshot_v10'), false); assert.equal(stores.state.get('otro'), 1);
  assert.equal(stores.checkpoints.size, 0); assert.equal(stores.operations.get('op-1').pending, true, 'operaciones V10 pendientes intactas');
  assert.equal(JSON.stringify(await b.ctx._naReadCanonicalReplica()), '{"owner":"replica-sin-depurar"}', 'sin falla, el lector original responde');
});
test('cobertura §1 SPEC-a3: cajMovs, cajEstado, cierres de caja, ajustes, claves heredadas, V10 y aviso de revocado', async () => {
  const snap = JSON.parse(ownerSnapshot());
  snap.data.cajMovs = [{ tipo: 'gas', desc: 'GASTO-DUENO', monto: 8880.02, expenseId: 'e1' }, { tipo: 'egr', desc: 'Retiro', monto: 50 }, { tipo: 'ing', cat: 'Ajuste', desc: 'Ajuste', monto: 3 }, { tipo: 'cob', desc: 'Cobro de crédito', monto: 20 }, { tipo: 'vta', monto: 5 }];
  snap.data.cajEstado = { abierta: true, fondo: 100, contado: 555.55, esperado: 600, diferencia: -44.45, horaCierre: '18:00' };
  snap.data.ventas[0].ganancia = 12; snap.data.ventas[0].utilidad = 12;
  snap.canonicalReplica.cash_sessions = [{ session_id: 'K0', status: 'CLOSED', opening_cents: 1000, counted_cents: 55555, expected_cents: 60000, difference_cents: -4445, closed_by_device_id: 'session:A', closing_watermark: 'w' }, { session_id: 'K1', status: 'OPEN', opening_cents: 10000 }];
  snap.canonicalReplica.financial_events = [{ event_type: 'ADJUSTMENT', cash_delta_cents: -99999, reason: 'AJUSTE-DUENO' }, { event_type: 'COMPENSATION', cash_delta_cents: 1, reason: 'COMP-DINERO' }, { event_type: 'PAYMENT', credit_id: 'CR1', credit_delta_cents: -2000 }, { event_type: 'COMPENSATION', credit_id: 'CR1', compensates_operation_id: 'op-p' }];
  const b = boot({ token: 'tok-B', tag: { v: 1, fp: fpOf('tok-A') }, extraLocal: { na_snapshot_v9: JSON.stringify(snap),
    na_cajMovs: JSON.stringify(snap.data.cajMovs), na_cajEstado: JSON.stringify(snap.data.cajEstado), na_ventas: JSON.stringify([{ items: [{ costo: 7770.01, precio: 5 }] }]),
    na_snapshot_v10: '{"gastos":[8880.02]}', na_snapshot_v10_conflict_1: '{"x":7770.01}', na_device_revoked_v1: '1' } });
  await b.ctx.loadAllData();
  const out = JSON.parse(b.local.getItem('na_snapshot_v9')), j = JSON.stringify(out);
  for (const m of ['GASTO-DUENO', '8880.02', '555.55', '-44.45', '55555', '-4445', 'closed_by', 'closing_watermark', 'AJUSTE-DUENO', 'COMP-DINERO', 'Retiro', 'ganancia', 'utilidad']) assert.ok(!j.includes(m), m);
  assert.deepEqual(out.data.cajMovs.map(m => m.tipo), ['cob', 'vta']);
  assert.deepEqual(out.data.cajEstado, { abierta: true, fondo: 100 });
  assert.deepEqual(out.canonicalReplica.cash_sessions.map(r => [r.session_id, r.status, r.opening_cents]), [['K0', 'CLOSED', 1000], ['K1', 'OPEN', 10000]]);
  assert.deepEqual(out.canonicalReplica.financial_events.map(e => e.event_type), ['PAYMENT', 'COMPENSATION']);
  assert.equal(b.local.getItem('na_cajMovs'), JSON.stringify([{ tipo: 'cob', desc: 'Cobro de crédito', monto: 20 }, { tipo: 'vta', monto: 5 }]));
  assert.equal(b.local.getItem('na_cajEstado'), '{"abierta":true,"fondo":100}');
  assert.equal(b.local.getItem('na_ventas'), '[{"items":[{"precio":5}]}]');
  for (const k of ['na_snapshot_v10', 'na_snapshot_v10_conflict_1', 'na_device_revoked_v1']) assert.equal(b.local.getItem(k), null, k);
});
