import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
