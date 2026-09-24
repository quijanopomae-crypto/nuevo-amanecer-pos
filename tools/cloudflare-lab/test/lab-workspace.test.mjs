import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleLabWorkspace,
  isLabWorkspacePath,
  sanitizeSnapshotForLab,
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

test('CANON snapshot se sanitiza antes de entrar al LAB', () => {
  const clean = sanitizeSnapshotForLab(snapshot(), true);
  assert.equal(clean.cloudSync, undefined);
  assert.deepEqual(clean.cart, []);
  assert.equal(clean.draft, null);
  assert.equal(clean.ui.currentPage, 'pageMenu');
  assert.equal(clean.locks.master, false);
  assert.equal(clean.locks.readOnly, false);
  assert.equal(clean.security, undefined);
  assert.deepEqual(snapshotCounts(clean), {
    productos: 1, ventas: 0, clientes: 1, creditos: 1, pagos: 1, gastos: 0, cajMovs: 0
  });
});

test('workspace reconoce el import firmado desde GitHub Actions', () => {
  assert.equal(isLabWorkspacePath('/lab/workspace/import-baseline'), true);
  assert.equal(isLabWorkspacePath('/lab/workspace/save'), true);
  assert.equal(isLabWorkspacePath('/lab/workspace/not-real'), false);
});


test('firma se verifica sobre el snapshot recibido antes de sanitizar', async () => {
  const source = snapshot();
  const signedHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(source)));
  const hex = [...new Uint8Array(signedHash)].map(v => v.toString(16).padStart(2, '0')).join('');
  const clean = sanitizeSnapshotForLab(source, true);
  const cleanHashRaw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(clean)));
  const cleanHex = [...new Uint8Array(cleanHashRaw)].map(v => v.toString(16).padStart(2, '0')).join('');
  assert.notEqual(hex, cleanHex, 'sanitation mutates the snapshot; signature must target pre-sanitized input');
});


test('LAB save sanitation preserves client timestamp so a replay is hash-stable', () => {
  const source = snapshot();
  const first = sanitizeSnapshotForLab(source, false);
  const second = sanitizeSnapshotForLab(source, false);
  assert.equal(first.updatedAt, source.updatedAt);
  assert.deepEqual(first, second);
});

test('workspace save fails closed if writer is revoked between auth and commit', async () => {
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('FROM lab_workspace_control')) {
                return { active_revision: 1, active_baseline_id: 'B1' };
              }
              if (sql.includes('FROM lab_workspace_revisions') && sql.includes('operation_id')) return null;
              if (sql.includes('FROM devices')) return null;
              return null;
            }
          };
        }
      };
    },
    async batch() {
      return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
    }
  };
  const env = { nuevo_amanecer_lab: db };
  const request = new Request('https://lab.example/lab/workspace/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expected_revision: 1,
      operation_id: 'op-revoked',
      snapshot: snapshot()
    })
  });
  const response = await handleLabWorkspace(request, new URL(request.url), env, {
    jsonLab: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
    authorizeRead: () => null,
    authorizeSession: async () => ({ principalId: 'session:test', credentialHash: 'a'.repeat(64) })
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'device_revoked');
});

test('workspace reset requires expected_revision instead of accepting blind reset', async () => {
  const env = { nuevo_amanecer_lab: { prepare() { throw new Error('DB must not be reached'); } } };
  const request = new Request('https://lab.example/lab/workspace/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  const response = await handleLabWorkspace(request, new URL(request.url), env, {
    jsonLab: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
    authorizeRead: () => null,
    authorizeSession: async () => ({ principalId: 'session:test', credentialHash: 'a'.repeat(64) })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'expected_revision_required');
});
