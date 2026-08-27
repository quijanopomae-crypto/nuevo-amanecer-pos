// GATE 5 — INVENTORY ROLLBACK (winner final de guardarMovInv)
//
// Demuestra sobre el código REAL del producto:
//   - WINNER final = implementación de inline-16 (reemplaza al wrapper de
//     inline-07 y a la base legacy de inline-02), con autorización propia,
//     guard contra doble ejecución (_naInventoryMoveBusy), bloqueo de salida
//     mayor al stock y restauración del stock ante fallo de persistencia;
//   - el comportamiento actual del AJUSTE queda preservado (el motivo es solo
//     informativo: entrada/salida usan la misma aritmética).
//
// Los tests existentes de inventario son HTML congelados; este delta crea un
// test NUEVO en Node, sin tocar fixtures.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  localScriptOrder, scanDefinitions, fileMatchLines, readProductText,
} from './lib/product.mjs';
import { createPosSandbox, json } from './lib/sandbox.mjs';
import { writeEvidence } from './lib/evidence.mjs';

const facts = { checks: [], winner: {} };
function check(id, description, pass, detail = '') {
  facts.checks.push({ id, description, result: pass ? 'PASS' : 'FAIL', detail });
  assert.ok(pass, `${id}: ${description}${detail ? ` — ${detail}` : ''}`);
}

const INLINE_02 = 'js/legacy-inline/inline-02.js';
const INLINE_07 = 'js/legacy-inline/inline-07.js';
const INLINE_16 = 'js/legacy-inline/inline-16.js';

const PRODUCTO = { id: 'P1', name: 'Arroz', stock: 10, controlInventario: true, precio: 10, costo: 5, unidad: 'unidad' };

function freshTab() {
  const sb = createPosSandbox();
  sb.seed();
  sb.seedData('productos', [{ ...PRODUCTO }]);
  return sb;
}

function setMove(sb, tipo, cant) {
  sb.run(`invMovId='P1';invMovT='${tipo}';`);
  sb.el('mMovCant').value = String(cant);
}

test('G5.1 — Estático: el WINNER de guardarMovInv es inline-16 (posterior a inline-02 e inline-07)', () => {
  const order = localScriptOrder();
  const idx = (rel) => order.indexOf(rel);
  check('G5.1a', 'orden de carga: inline-02 < inline-07 < inline-16',
    idx(INLINE_02) < idx(INLINE_07) && idx(INLINE_07) < idx(INLINE_16));
  const defs02 = scanDefinitions(INLINE_02, 'guardarMovInv');
  const defs07 = scanDefinitions(INLINE_07, 'guardarMovInv');
  const defs16 = scanDefinitions(INLINE_16, 'guardarMovInv');
  check('G5.1b', 'tres definiciones históricas: base legacy (02), wrapper auth (07), winner (16)',
    defs02.length > 0 && defs07.length > 0 && defs16.length > 0,
    `02:${defs02} 07:${defs07} 16:${defs16}`);
  const later = order.slice(idx(INLINE_16) + 1).filter((rel) => /inline-\d+\.js$/.test(rel));
  const reassign = later.filter((rel) => scanDefinitions(rel, 'guardarMovInv').length > 0);
  check('G5.1c', 'ningún archivo posterior redefine guardarMovInv', reassign.length === 0);

  const src16 = readProductText(INLINE_16);
  check('G5.1d', 'inline-16 declara el guard de doble ejecución', /let\s+_naInventoryMoveBusy\s*=\s*false/.test(src16));
  check('G5.1e', 'inline-16 verifica persistencia con _naWasPersisted y restaura beforeStock en catch',
    src16.includes('if(!_naWasPersisted(result))throw') && src16.includes('product.stock=beforeStock;await saveAllData();'));
  facts.winner.chain = 'inline-02 (base legacy) → inline-07 (wrapper auth) → inline-16 WINNER (auth propia + guard + rollback)';
});

test('G5.2 — RUNTIME: el winner final tiene autorización, guard y rollback inline-16', () => {
  const sb = freshTab();
  const src = sb.run('String(guardarMovInv)');
  check('G5.2a', 'winner runtime contiene el guard _naInventoryMoveBusy', src.includes('_naInventoryMoveBusy'));
  check('G5.2b', 'winner runtime autoriza con _naF10AuthorizePermission(inventoryMoves)',
    src.includes("_naF10AuthorizePermission('inventoryMoves'"));
  check('G5.2c', 'winner runtime NO es el wrapper indirecto de inline-07 (sin delegación _naF10BaseGuardarMovInv)',
    !src.includes('_naF10BaseGuardarMovInv.apply'));
  facts.winner.runtimeWinner = 'inline-16 (autorización + guard + persistencia verificada + restauración)';
});

test('G5.3 — RUNTIME: salida mayor al stock queda BLOQUEADA (sin persistir nada)', async () => {
  const sb = freshTab();
  await sb.run('saveAllData()');
  let persistCalls = 0;
  sb.run(`
    globalThis.__persistCount=0;
    const __q=_naQueuePersist;
    _naQueuePersist=function(){globalThis.__persistCount++;return __q.call(this);};
  `);
  setMove(sb, 'salida', 20); // stock 10
  await sb.run('guardarMovInv()');
  const toast = sb.toastText();
  assert.equal(sb.memoryState().productos[0].stock, 10, 'stock intacto');
  assert.equal(json(sb, 'globalThis.__persistCount'), 0, 'no se intentó persistir');
  check('G5.3', 'bloqueo con mensaje de stock insuficiente', /Stock insuficiente/i.test(toast), `toast: "${toast}"`);
});

test('G5.4 — RUNTIME: guard contra doble ejecución (_naInventoryMoveBusy)', async () => {
  const sb = freshTab();
  await sb.run('saveAllData()');
  setMove(sb, 'salida', 2); // 10 → 8
  // Congela la persistencia con una promesa controlada por el test.
  sb.run(`
    const __realSave=saveAllData;
    globalThis.__realSave=__realSave;
    saveAllData=function(){return new Promise(r=>{globalThis.__releaseSave=r;});};
  `);
  const p1 = sb.run('guardarMovInv()');
  assert.equal(sb.memoryState().productos[0].stock, 8, 'primer llamado aplicó el movimiento (en vuelo)');
  assert.equal(json(sb, '_naInventoryMoveBusy'), true, 'busy=true durante la operación');
  const p2 = sb.run('guardarMovInv()'); // segundo llamado mientras la primera está en vuelo
  await p2;
  assert.equal(sb.memoryState().productos[0].stock, 8, 'el segundo llamado fue ignorado (sin doble descuento)');
  // Libera la primera operación y deja el producto en estado original.
  sb.run('globalThis.__releaseSave({ok:true,durable:true,verified:true,storage:"indexedDB"});');
  await p1;
  sb.run('saveAllData=globalThis.__realSave;');
  assert.equal(json(sb, '_naInventoryMoveBusy'), false, 'busy liberado al terminar');
  check('G5.4', 'doble ejecución bloqueada: un solo movimiento aplicado', true);
  facts.winner.doubleExecGuard = 'PASS (segunda llamada ignorada mientras busy=true)';
});

test('G5.5 — RUNTIME: fallo de persistencia restaura el stock anterior', async () => {
  const sb = freshTab();
  await sb.run('saveAllData()');
  const durableBefore = sb.durableSnapshot();
  setMove(sb, 'salida', 5); // 10 → 5 → fallo → 10
  sb.breakPersistent();
  await sb.run('guardarMovInv()');
  sb.restorePersistent();
  const toast = sb.toastText();
  assert.equal(sb.memoryState().productos[0].stock, 10, 'stock restaurado');
  assert.equal(json(sb, '_naInventoryMoveBusy'), false, 'busy liberado');
  check('G5.5a', 'mensaje informa restauración', /restaurado/i.test(toast), `toast: "${toast}"`);
  check('G5.5b', 'durable previo intacto',
    JSON.stringify(sb.durableSnapshot()) === JSON.stringify(durableBefore));
});

test('G5.6 — RUNTIME: sin autorización F10 el movimiento no se ejecuta', async () => {
  const sb = freshTab();
  await sb.run('saveAllData()');
  sb.run(`
    appConfig.cashiers[0].role='cajero';
    appConfig.cashiers[0].permissions=_naF10RoleDefaults('cajero'); // inventoryMoves:false
  `);
  setMove(sb, 'entrada', 5);
  await sb.run('guardarMovInv()');
  const toast = sb.toastText();
  assert.equal(sb.memoryState().productos[0].stock, 10, 'stock sin cambios');
  check('G5.6', 'movimiento denegado por permisos', /permiso/i.test(toast), `toast: "${toast}"`);
});

test('G5.7 — RUNTIME: comportamiento actual del AJUSTE queda preservado', async () => {
  const sb = freshTab();
  await sb.run('saveAllData()');
  // El "ajuste" es una entrada/salida con motivo informativo (select mMovMotivo);
  // el winner no lee el motivo: la aritmética es idéntica a entrada/salida.
  const src = sb.run('String(guardarMovInv)');
  check('G5.7a', 'el winner no consulta el motivo (mMovMotivo) — ajuste = entrada/salida',
    !src.includes('mMovMotivo'));
  setMove(sb, 'entrada', 7);
  await sb.run('guardarMovInv()');
  assert.equal(sb.memoryState().productos[0].stock, 17, 'entrada de ajuste aplica suma directa');
  setMove(sb, 'salida', 7);
  await sb.run('guardarMovInv()');
  assert.equal(sb.memoryState().productos[0].stock, 10, 'salida de ajuste aplica resta directa');
  check('G5.7b', 'aritmética de ajuste (entrada/salida) preservada', true);
  facts.winner.adjustBehavior = 'ajuste = entrada/salida; motivo solo informativo (sin lógica propia)';
});

after(() => {
  writeEvidence('gate5-inventory-rollback.json', {
    gate: 'GATE 5 — INVENTORY ROLLBACK',
    verdict: facts.checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL',
    winner: facts.winner,
    note: 'tests existentes de inventario son HTML frozen; este delta crea test nuevo (tests/release-invariants/)',
    ...facts,
  });
});
