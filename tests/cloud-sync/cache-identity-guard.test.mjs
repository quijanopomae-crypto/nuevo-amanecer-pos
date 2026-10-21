// T-47 S3: la caché local del usuario anterior no llega a otra identidad (fix-cache-rol).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../POS/js/sync/cache-identity-guard.js', import.meta.url), 'utf8');
function store(init = {}) { const m = new Map(Object.entries(init)); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; }
const ownerSnapshot = () => JSON.stringify({ version: 9, updatedAt: '2026-10-21T00:00:00Z', appConfig: { negocio: 'x' },
  data: { productos: [{ id: '00001', precio: 5, costo: 7770.01 }], ventas: [{ id: 'V-1', items: [{ id: '00001', costo: 7770.01, precio: 5 }] }], clientes: [], creditos: [],
    gastos: [{ desc: 'GASTO-RESTRINGIDO', monto: 8880.02, nota: 'nota restringida' }], cajMovs: [], cashClosures: [{ id: 'c1' }], inventoryMovements: [{ reason: 'PROVEEDOR-RESTRINGIDO F9' }] },
  cart: [{ id: '00001', qty: 1, costo: 7770.01 }], cloudSync: { pending: [{ op: 'keep-me' }] },
  canonicalReplica: { products: [{ product_id: '00001', cost_cents: 777001 }], expenses: [{ amount_cents: 888002, note: 'nota restringida' }] } });
function boot({ token = 'tok-B', tag, role, extraLocal = {} } = {}) {
  const local = store({ na_cloud_sync_credentials: token ? JSON.stringify({ endpoint: 'https://x', token }) : undefined, na_snapshot_v9: ownerSnapshot(),
    na_canonical_sale_outbox_v1: '{"version":1,"intents":[{"operation_id":"op-1"}]}', na_canonical_sale_journal: '{"state":"PENDING"}', na_pos_reviews_cache_v1: '{"reviews":[]}', ...extraLocal });
  if (!token) local.removeItem('na_cloud_sync_credentials');
  if (tag) local.setItem('na_cache_identity_v1', JSON.stringify(tag));
  if (role) local.setItem('na_pos_role_v1', JSON.stringify({ role }));
  const session = store({ na_snapshot_v9_session: ownerSnapshot() });
  const events = {}; const loads = [];
  const ctx = { localStorage: local, sessionStorage: session, setTimeout, clearTimeout, Promise, JSON, Math,
    addEventListener: (n, f) => { events[n] = f; }, loadAllData: async () => { loads.push(local.getItem('na_snapshot_v9')); return 'loaded'; } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  return { ctx, local, session, events, loads, api: ctx.NuevoAmanecerCacheIdentity };
}
const fpOf = t => boot({ token: t }).api.fingerprint(t);
const clean = raw => { const s = JSON.parse(raw); return !s.canonicalReplica && s.data.gastos.length === 0 && !JSON.stringify(s).includes('7770.01') && !JSON.stringify(s).includes('PROVEEDOR'); };

test('token distinto al de la etiqueta: purga snapshot local/sesión antes de loadAllData y conserva colas pendientes', async () => {
  const b = boot({ token: 'tok-B', tag: { v: 1, fp: fpOf('tok-A'), role: 'owner', device_id: 'session:A' } });
  assert.equal(await b.ctx.loadAllData(), 'loaded');
  assert.equal(b.api.decision, 'identity-changed-purged');
  assert.ok(clean(b.loads[0]), 'loadAllData ve el snapshot ya purgado');
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
    assert.equal(e.api.decision, 'legacy-untagged-purged'); assert.ok(clean(e.loads[0]));
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
