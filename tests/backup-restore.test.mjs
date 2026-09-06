import test from 'node:test';
import assert from 'node:assert/strict';
import { createPosSandbox, json } from './release-invariants/lib/sandbox.mjs';

function seedState(pos, stock = 8) {
  pos.seed();
  pos.seedData('productos', [{ id: 'P1', name: 'Arroz', stock, precio: 5, costo: 3 }]);
}

async function createBackup(pos) {
  return JSON.parse(JSON.stringify(await pos.run('_naCreateCompleteBackup()')));
}

async function resolve(pos, document) {
  pos.run(`globalThis.__backupDocument=${JSON.stringify(document)}`);
  return pos.run('_naResolveBackupDocument(globalThis.__backupDocument)');
}

async function importDocument(pos, document) {
  const raw = JSON.stringify(document);
  const input = pos.el('backupFile');
  input.files = [{ name: 'respaldo.json', size: raw.length, async text() { return raw; } }];
  pos.run('_naDownloadSnapshot=function(){};');
  await pos.run('importarRespaldo()');
}

test('backup V1.2 válido se resuelve y pasa al sanitizador existente', async () => {
  const pos = createPosSandbox();
  seedState(pos);
  const backup = await createBackup(pos);

  const payload = await resolve(pos, backup);
  pos.run(`globalThis.__resolvedPayload=${JSON.stringify(payload)}`);
  const prepared = json(pos, '_naPrepareBackupSnapshot(globalThis.__resolvedPayload)');

  assert.equal(payload.version, 9);
  assert.equal(prepared.snapshot.version, 9);
  assert.equal(prepared.snapshot.data.productos[0].stock, 8);
});

test('SHA-256 válido permite resolver el payload', async () => {
  const pos = createPosSandbox();
  seedState(pos);
  const backup = await createBackup(pos);

  const payload = await resolve(pos, backup);

  assert.equal(payload.data.productos[0].name, 'Arroz');
  assert.match(backup.integrity.value, /^[a-f0-9]{64}$/);
});

test('payload modificado después de calcular SHA-256 es rechazado', async () => {
  const pos = createPosSandbox();
  seedState(pos);
  const backup = await createBackup(pos);
  backup.payload.data.productos[0].stock = 999;

  await assert.rejects(resolve(pos, backup), /integridad del respaldo no coincide/);
});

test('snapshot V9 antiguo sin wrapper conserva compatibilidad', async () => {
  const pos = createPosSandbox();
  seedState(pos);
  const legacyV9 = json(pos, '_naBuildSnapshot()');

  const resolved = await resolve(pos, legacyV9);
  pos.run(`globalThis.__legacyV9=${JSON.stringify(resolved)}`);
  const prepared = json(pos, '_naPrepareBackupSnapshot(globalThis.__legacyV9)');

  assert.deepEqual(JSON.parse(JSON.stringify(resolved)), legacyV9);
  assert.equal(prepared.snapshot.data.productos[0].stock, 8);
});

test('format y version desconocidos son rechazados', async () => {
  const pos = createPosSandbox();
  seedState(pos);
  const backup = await createBackup(pos);

  await assert.rejects(resolve(pos, { ...backup, format: 'otro-formato' }), /Formato de respaldo no compatible/);
  await assert.rejects(resolve(pos, { ...backup, version: 2 }), /Versión de documento no compatible/);
});

test('rechazo por integridad no modifica el estado del POS', async () => {
  const pos = createPosSandbox();
  seedState(pos, 8);
  const backup = await createBackup(pos);
  backup.payload.data.productos[0].stock = 999;
  const before = json(pos, '{productos,ventas,clientes,creditos,gastos,cajMovs,cajEstado,cashClosures,inventoryMovements,cart,appConfig}');

  await importDocument(pos, backup);

  const after = json(pos, '{productos,ventas,clientes,creditos,gastos,cajMovs,cajEstado,cashClosures,inventoryMovements,cart,appConfig}');
  assert.deepEqual(after, before);
  assert.equal(json(pos, 'productos')[0].stock, 8);
  assert.match(pos.toastText(), /integridad del respaldo no coincide/);
});

test('integrity null permite restaurar un snapshot válido', async () => {
  const source = createPosSandbox();
  seedState(source, 25);
  const backup = await createBackup(source);
  backup.integrity = null;

  const target = createPosSandbox();
  seedState(target, 3);
  target.run(`
    document.documentElement.style.setProperty=function(){};
    window.scrollTo=function(){};
    globalThis.__restoreErrors=[];
    console={...console,error:function(...args){globalThis.__restoreErrors.push(args.map(String).join(' '));}};
  `);
  await importDocument(target, backup);

  assert.equal(json(target, 'productos')[0].stock, 25);
  assert.match(target.toastText(), /^Respaldo restaurado(?: y validado correctamente| con \d+ advertencia\(s\))$/);
  assert.equal(json(target, 'globalThis.__restoreErrors').some(message=>message.includes('Restauración rechazada')), false);
});
