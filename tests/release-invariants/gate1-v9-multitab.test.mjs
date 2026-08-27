// GATE 1 — V9 MULTI-TAB CHARACTERIZATION
//
// Caracteriza el comportamiento ACTUAL de la persistencia V9 (sin arreglar nada):
//   1. V9 serializa escrituras DENTRO de una pestaña (_naPersistChain, FIFO).
//   2. V9 NO tiene CAS cross-tab (ni Web Locks, ni BroadcastChannel, ni 'storage'
//      listener, ni comparación de revisiones en el camino de guardado).
//   3. Riesgo last-writer-wins entre pestañas: cada guardado escribe el snapshot
//      COMPLETO tomado de la MEMORIA de esa pestaña; el último escritor pisa todo.
//      → demostrado en runtime con dos contextos reales compartiendo localStorage.
//   4. V10 contiene la mitigación futura (Web Locks + BroadcastChannel + expectedRevision).
//   5. V10 permanece dormante (sin referencias activas).
//   6. Release V9 queda condicionado a UNA SOLA PESTAÑA ACTIVA DE ESCRITURA
//      (documentado en evidence/release-invariants/SINGLE_TAB_WRITE_RESTRICTION.md).
//
// PASS = la characterization refleja fielmente el comportamiento actual.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  readProductText, localScriptOrder, fileMatchLines, allProductJsFiles,
  RELEASE_BASE,
} from './lib/product.mjs';
import { createPosSandbox, makeStore, json } from './lib/sandbox.mjs';
import { writeEvidence, writeEvidenceText } from './lib/evidence.mjs';

const facts = { checks: [], runtime: {} };
function check(id, description, pass, detail = '') {
  facts.checks.push({ id, description, result: pass ? 'PASS' : 'FAIL', detail });
  assert.ok(pass, `${id}: ${description}${detail ? ` — ${detail}` : ''}`);
}

const V9_FILES = allProductJsFiles().filter(
  (f) => !/inline-17\.js$|inline-18\.js$/.test(f)
);
const INLINE_02 = 'js/legacy-inline/inline-02.js';
const INLINE_17 = 'js/legacy-inline/inline-17.js';

test('G1.1 — V9 serializa escrituras dentro de una pestaña (_naPersistChain FIFO)', () => {
  const lines = fileMatchLines(INLINE_02, '_naPersistChain\\s*=\\s*_naPersistChain\\s*\\.then\\(\\s*persist\\s*,\\s*persist\\s*\\)');
  check('G1.1a', 'inline-02 encadena cada guardado sobre _naPersistChain (serialización in-tab)',
    lines.length === 1, `línea ${lines[0] ?? 'no encontrada'}`);

  const queue = readProductText(INLINE_02);
  const queueBody = queue.slice(queue.indexOf('function _naQueuePersist'), queue.indexOf('const _naWasPersisted'));
  check('G1.1b', '_naQueuePersist construye el snapshot desde la MEMORIA de esta pestaña (_naBuildSnapshot)',
    queueBody.includes('_naBuildSnapshot()'));
  check('G1.1c', '_naQueuePersist NO lee el snapshot previo del storage (no hay merge ni CAS en escritura)',
    !queueBody.includes('_naReadLocalSnapshot') && !queueBody.includes('getItem'));
});

test('G1.2 — V9 NO tiene CAS cross-tab (sin Web Locks / BroadcastChannel / storage listener / revisiones)', () => {
  for (const rel of V9_FILES) {
    const src = readProductText(rel);
    check(`G1.2:${rel}`, 'sin navigator.locks / BroadcastChannel / storage-listener',
      !/navigator\.locks/.test(src) && !/BroadcastChannel/.test(src) && !/addEventListener\(\s*['"]storage['"]/.test(src));
  }
  const html = readProductText('index.html');
  check('G1.2:index.html', 'index.html sin primitivas cross-tab',
    !/navigator\.locks/.test(html) && !/BroadcastChannel/.test(html));
  check('G1.2:persist-path', 'el commit V9 no compara revisiones ni versiones concurrentes',
    !/expectedRevision/.test(readProductText(INLINE_02)));
});

test('G1.3 — Escritura V9 = overwrite completo del snapshot (superficie last-writer-wins)', () => {
  const commit = readProductText(INLINE_02).slice(
    readProductText(INLINE_02).indexOf('async function _naCommitSnapshot'),
    readProductText(INLINE_02).indexOf('function _naPublishPersistResult')
  );
  check('G1.3a', '_naCommitSnapshot escribe el snapshot serializado completo',
    commit.includes('_naWriteLocalSnapshot(serialized)') && commit.includes('_naWriteSessionSnapshot(serialized)'));
  check('G1.3b', 'el commit no fusiona con el snapshot existente (sin read-modify-write)',
    !commit.includes('_naReadLocalSnapshot') && !commit.includes('getItem'));
});

test('G1.4 — RUNTIME: dos pestañas reales + localStorage compartido → last-writer-wins', async () => {
  const shared = { localStorage: makeStore(), sessionStorage: makeStore() };
  const tabA = createPosSandbox({ stores: shared });
  const tabB = createPosSandbox({ stores: shared });

  // Ambas pestañas parten del mismo estado visible (P1 stock 10).
  for (const tab of [tabA, tabB]) {
    tab.seed();
    tab.seedData('productos', [{ id: 'P1', name: 'Arroz', stock: 10, controlInventario: true, precio: 10, costo: 5, unidad: 'unidad' }]);
  }
  // P2 existe SOLO en la pestaña B (cambio local de B aún no visto por A).
  tabB.seedData('productos', [{ id: 'P2', name: 'Azúcar', stock: 5, controlInventario: true, precio: 12, costo: 6, unidad: 'unidad' }]);

  // B guarda después que A: B pisa el durable con SU copia completa.
  await tabA.run('saveAllData()');
  await tabB.run('saveAllData()');
  const afterB = tabB.durableSnapshot();
  check('G1.4a', 'tras guardar B, el durable contiene el mundo de B (P1+P2)',
    afterB?.data?.productos?.length === 2);

  // A muta LOCALMENTE P1 (cambio que B desconoce) y guarda DESPUÉS de B:
  // el snapshot COMPLETO de A pisa el durable — el cambio exclusivo de B (P2)
  // desaparece sin aviso y el stock de A (8) reemplaza el de B (10).
  tabA.run('productos[0].stock=8;');
  await tabA.run('saveAllData()');
  const afterA = tabA.durableSnapshot();
  const aIds = (afterA?.data?.productos ?? []).map((p) => p.id).sort();
  facts.runtime.lastWriterWins = {
    durable_despues_de_B: (afterB?.data?.productos ?? []).map((p) => p.id),
    stock_P1_en_B: afterB?.data?.productos?.find((p) => p.id === 'P1')?.stock,
    durable_despues_de_A: aIds,
    stock_P1_final: afterA?.data?.productos?.find((p) => p.id === 'P1')?.stock,
  };
  check('G1.4b', 'el último escritor (A) pisa el durable completo — P2 de B desaparece y el stock de A (8) reemplaza el de B (10) sin aviso',
    aIds.join(',') === 'P1' && afterA?.data?.productos?.find((p) => p.id === 'P1')?.stock === 8);
  check('G1.4c', 'V9 no detecta el conflicto: el guardado de A reporta durable/verificado OK',
    json(tabA, '_naLastPersistOK') === true && tabA.durableSnapshot() !== null);

  // 1.1 en runtime: la cola in-tab resuelve ambas escrituras concurrentes en orden.
  tabA.run('globalThis.__seq=[]; const __ppr=_naPublishPersistResult; _naPublishPersistResult=function(r){globalThis.__seq.push(r.durable?1:0);return __ppr(r);};');
  const p1 = tabA.run('saveAllData()');
  const p2 = tabA.run('saveAllData()');
  await Promise.all([p1, p2]);
  const seq = json(tabA, 'globalThis.__seq');
  facts.runtime.concurrent_saves_resolved = seq.length;
  check('G1.4d', 'dos saveAllData concurrentes en la MISMA pestaña se resuelven ambos por la cola',
    seq.length === 2 && seq.every((x) => x === 1));
});

test('G1.5 — V10 contiene la mitigación futura y permanece dormante', () => {
  const v10 = readProductText(INLINE_17);
  check('G1.5a', 'V10 usa Web Locks (exclusión cross-tab futura)', /navigator\.locks\?\.\s*request/.test(v10));
  check('G1.5b', 'V10 usa BroadcastChannel (aviso cross-tab futuro)', /new BroadcastChannel\(/.test(v10));
  check('G1.5c', 'V10 usa CAS por revisión (expectedRevision + comparación de snapshots)',
    /expectedRevision/.test(v10) && /_naV10CompareSnapshots/.test(v10));
  check('G1.5d', 'V10 dormante: ningún archivo fuera de inline-17/18 referencia símbolos _naV10*',
    V9_FILES.every((rel) => !/_naV10/.test(readProductText(rel))));
});

test('G1.6 — El orden de carga real mantiene el comportamiento caracterizado', () => {
  const order = localScriptOrder();
  const idx = (name) => order.indexOf(name);
  check('G1.6a', 'inline-02 (persistencia V9) carga antes que los wrappers de permisos y V10',
    idx('js/legacy-inline/inline-02.js') > -1 &&
    idx('js/legacy-inline/inline-02.js') < idx('js/legacy-inline/inline-07.js') &&
    idx('js/legacy-inline/inline-07.js') < idx('js/legacy-inline/inline-17.js'));
});

test('G1.7 — Evidencia: documentación de la restricción UNA SOLA PESTAÑA ACTIVA DE ESCRITURA', () => {
  const md = [
    '# Restricción de release V9: UNA SOLA PESTAÑA ACTIVA DE ESCRITURA',
    '',
    `BASE: ${RELEASE_BASE}`,
    '',
    '## Caracterización demostrada (GATE 1)',
    '',
    '1. **Serialización in-tab**: `saveAllData()` encadena cada guardado en',
    '   `_naPersistChain` (inline-02). Dos escrituras concurrentes en la MISMA',
    '   pestaña se aplican en orden FIFO; no se pierden entre sí.',
    '2. **Sin CAS cross-tab**: el código V9 no usa Web Locks, ni BroadcastChannel,',
    '   ni escucha el evento `storage`, ni compara revisiones al escribir.',
    '3. **Last-writer-wins**: cada guardado escribe el snapshot COMPLETO tomado de',
    '   la memoria de esa pestaña (`_naCommitSnapshot` → overwrite de `na_snapshot_v9`).',
    '   El runtime de este gate demostró, con dos contextos reales compartiendo',
    '   localStorage, que el último guardado pisa todo lo hecho por la otra pestaña',
    '   (un producto creado solo en B desapareció del durable cuando A guardó) y que',
    '   V9 NO reporta ningún conflicto (`_naLastPersistOK === true`).',
    '4. **Mitigación futura**: el núcleo V10 (inline-17) ya contiene Web Locks',
    '   exclusivos, BroadcastChannel y CAS por `expectedRevision`, pero está DORMANTE',
    '   (ver gate 8): ningún camino activo del producto lo invoca.',
    '',
    '## Condición de release',
    '',
    'El release V9 es válido ÚNICAMENTE bajo la operación **UNA SOLA PESTAÑA',
    'ACTIVA DE ESCRITURA**. Abrir el POS en dos o más pestañas del mismo dispositivo',
    'puede provocar pérdida silenciosa de datos (ventas, pagos, movimientos) por',
    'last-writer-wins. Esta restricción es de operación, no de código: el producto',
    'hoy no la detecta ni la avisa.',
    '',
  ].join('\n');
  const file = writeEvidenceText('SINGLE_TAB_WRITE_RESTRICTION.md', md);
  facts.singleWriterDocumentedAt = 'evidence/release-invariants/SINGLE_TAB_WRITE_RESTRICTION.md';
  check('G1.7', 'restricción single-writer documentada como evidencia', Boolean(file));
});

after(() => {
  writeEvidence('gate1-v9-multitab.json', {
    gate: 'GATE 1 — V9 MULTI-TAB CHARACTERIZATION',
    verdict: facts.checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL',
    singleWriterRestriction: 'DOCUMENTED',
    ...facts,
  });
});
