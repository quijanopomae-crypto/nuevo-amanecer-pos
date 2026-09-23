import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchLatestCanonBackup,
  resolveBackupDocument,
  sanitizeSnapshotForLab,
  selectLatestR2Object,
  snapshotCounts
} from '../src/lab-workspace.js';

function snapshot() {
  return {
    version: 9,
    updatedAt: '2026-09-23T00:00:00.000Z',
    appConfig: { business: { nombre: 'Nuevo Amanecer' } },
    ui: { currentPage: 'pageClientes' },
    locks: { master: true, readOnly: true, modules: { clientes: true } },
    security: { pinEnabled: true, pinHash: 'not-for-lab' },
    data: {
      productos: [{ id: 1, name: 'Producto' }],
      ventas: [],
      clientes: [{ id: 1, nombre: 'Cliente' }],
      creditos: [{ id: 1, cliId: 1, monto: 100, pagado: 20, pagos: [{ id: 'P1', monto: 20 }] }],
      gastos: [],
      cajMovs: [],
      cashClosures: [],
      inventoryMovements: []
    },
    cart: [{ id: 1 }],
    draft: [{ id: 1 }],
    cloudSync: { operations: [{ operation_id: 'PROD-1' }] }
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}

test('CANON snapshot se sanitiza antes de entrar al LAB', () => {
  const clean = sanitizeSnapshotForLab(snapshot(), true);
  assert.equal(clean.cloudSync, undefined);
  assert.deepEqual(clean.cart, []);
  assert.equal(clean.draft, null);
  assert.equal(clean.ui.currentPage, 'pageMenu');
  assert.equal(clean.locks.master, false);
  assert.equal(clean.locks.readOnly, false);
  assert.equal(clean.security, undefined);
  assert.equal(clean.data.clientes.length, 1);
  assert.equal(clean.data.creditos.length, 1);
  assert.deepEqual(snapshotCounts(clean), {
    productos: 1, ventas: 0, clientes: 1, creditos: 1, pagos: 1, gastos: 0, cajMovs: 0
  });
});

test('wrapper de respaldo verifica SHA-256 payload-json', async () => {
  const payload = snapshot();
  const hash = await sha256(JSON.stringify(payload));
  const resolved = await resolveBackupDocument({
    format: 'nuevo-amanecer-pos-backup',
    version: 1,
    payload,
    integrity: { algorithm: 'SHA-256', scope: 'payload-json', value: hash }
  });
  assert.deepEqual(resolved, payload);
  await assert.rejects(
    resolveBackupDocument({
      format: 'nuevo-amanecer-pos-backup',
      version: 1,
      payload,
      integrity: { algorithm: 'SHA-256', scope: 'payload-json', value: '0'.repeat(64) }
    }),
    /integrity mismatch/
  );
});

test('selecciona el JSON más reciente del prefijo R2', () => {
  const latest = selectLatestR2Object([
    { key: 'nuevo-amanecer-prod-v2/a.json', uploaded: '2026-09-22T10:00:00Z' },
    { key: 'nuevo-amanecer-prod-v2/b.json', uploaded: '2026-09-23T10:00:00Z' },
    { key: 'nuevo-amanecer-prod-v2/readme.txt', uploaded: '2026-09-24T10:00:00Z' }
  ]);
  assert.equal(latest.key, 'nuevo-amanecer-prod-v2/b.json');
});

test('lector R2 solo ejecuta GET/listado y GET/objeto', async () => {
  const calls = [];
  const payload = snapshot();
  const mockFetch = async (input, options = {}) => {
    calls.push({ url: String(input), method: String(options.method || 'GET').toUpperCase() });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ key: 'nuevo-amanecer-prod-v2/latest.json', uploaded: '2026-09-23T10:00:00Z' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await fetchLatestCanonBackup({
    accountId: 'account',
    token: 'read-only',
    bucket: 'nuevo-amanecer-prod-v2-backups',
    prefix: 'nuevo-amanecer-prod-v2/'
  }, mockFetch);
  assert.equal(result.sourceRef, 'r2://nuevo-amanecer-prod-v2-backups/nuevo-amanecer-prod-v2/latest.json');
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET']);
  assert.equal(calls.some(call => ['PUT', 'POST', 'PATCH', 'DELETE'].includes(call.method)), false);
});
