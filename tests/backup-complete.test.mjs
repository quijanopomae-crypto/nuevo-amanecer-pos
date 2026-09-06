import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPosSandbox, json } from './release-invariants/lib/sandbox.mjs';

const sha256 = (value) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

function seedCompleteState(pos) {
  pos.seed();
  pos.seedData('productos', [{ id: 'P1', name: 'Arroz', stock: 8, precio: 5, costo: 3 }]);
  pos.seedData('ventas', [{ id: 'V1', fecha: '2026-09-05', items: [], paymentBreakdown: null }]);
  pos.seedData('clientes', [{ id: 'C1', nombre: 'Cliente' }]);
  pos.seedData('creditos', [{ id: 'CR1', cliId: 'C1', monto: 20, pagado: 5 }]);
  pos.seedData('gastos', [{ id: 'G1', desc: 'Movilidad', monto: 3, fecha: '2026-09-05' }]);
  pos.seedData('cajMovs', [{ id: 'CM1', monto: 4, fecha: '2026-09-05' }]);
  pos.seedData('cashClosures', [{ id: 'CC1', sessionId: 'S1', contado: 100, esperado: 99, diferencia: 1 }]);
  pos.seedData('inventoryMovements', [{ id: 'IM1', productId: 'P1', type: 'AJUSTE', before: 10, delta: -2, after: 8, reason: 'Conteo', source: 'MANUAL' }]);
  pos.seedData('cart', [{ id: 'P1', name: 'Arroz', qty: 1, precio: 5 }]);
  pos.run("storage.setItem('na_cart_draft', JSON.stringify([{id:'P1',name:'Arroz',qty:2,precio:5}]))");
}

test('V1.2-02 crea JSON completo con integridad sin cambiar los datos actuales', async () => {
  const pos = createPosSandbox();
  seedCompleteState(pos);
  const before = pos.run('JSON.stringify(_naBuildSnapshot())');

  const backup = await pos.run('_naCreateCompleteBackup()');
  const plain = JSON.parse(JSON.stringify(backup));
  const serialized = JSON.stringify(plain);
  const parsed = JSON.parse(serialized);

  assert.equal(parsed.format, 'nuevo-amanecer-pos-backup');
  assert.equal(parsed.version, 1);
  assert.ok(!Number.isNaN(Date.parse(parsed.createdAt)));
  assert.equal(parsed.payload.version, 9);
  assert.ok(!Number.isNaN(Date.parse(parsed.payload.updatedAt)));
  assert.deepEqual(Object.keys(parsed.payload.data).sort(), [
    'cajEstado', 'cajMovs', 'cashClosures', 'clientes', 'creditos', 'gastos',
    'inventoryMovements', 'productos', 'ventas',
  ]);
  assert.deepEqual(Object.keys(parsed.payload).sort(), [
    'appConfig', 'cart', 'data', 'draft', 'locks', 'security', 'ui', 'updatedAt', 'version',
  ]);
  assert.equal(parsed.integrity.algorithm, 'SHA-256');
  assert.equal(parsed.integrity.scope, 'payload-json');
  assert.equal(parsed.integrity.value, sha256(parsed.payload));
  assert.match(parsed.integrity.value, /^[a-f0-9]{64}$/);

  const after = pos.run('JSON.stringify(_naBuildSnapshot())');
  const withoutTimestamp = (raw) => {
    const value = JSON.parse(raw);
    delete value.updatedAt;
    return value;
  };
  assert.deepEqual(withoutTimestamp(after), withoutTimestamp(before));
  assert.equal(json(pos, 'productos')[0].stock, 8);
});

test('exportarRespaldo descarga el documento completo como JSON', async () => {
  const pos = createPosSandbox();
  seedCompleteState(pos);
  pos.run('globalThis.__download=null; _naDownloadSnapshot=function(value,prefix){globalThis.__download={value,prefix};};');

  const result = await pos.run('exportarRespaldo()');
  const downloaded = json(pos, 'globalThis.__download');

  assert.ok(result);
  assert.equal(downloaded.prefix, 'nuevo_amanecer_backup_completo');
  assert.equal(downloaded.value.format, 'nuevo-amanecer-pos-backup');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(downloaded.value)));
  assert.equal(downloaded.value.integrity.value, sha256(downloaded.value.payload));
});

test('crea el backup aunque Web Crypto no esté disponible', async () => {
  const pos = createPosSandbox();
  seedCompleteState(pos);
  pos.run('crypto=undefined;');

  const result = await pos.run('_naCreateCompleteBackup()');
  const backup = JSON.parse(JSON.stringify(result));

  assert.equal(backup.format, 'nuevo-amanecer-pos-backup');
  assert.equal(backup.integrity, null);
  assert.equal(backup.payload.data.productos[0].stock, 8);
});
