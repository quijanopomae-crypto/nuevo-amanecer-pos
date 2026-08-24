// static-storage.test.mjs — storage key inventory tripwire
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureBaselineFixture, readFixtureText } from './lib/extract-baseline.mjs';
import { analyzeAll } from './lib/static-parse.mjs';

const EXPECTED_LOCAL = [
  'na_snapshot_v9', 'na_snapshot_v10', 'na_snapshot_v10_signal',
  'na_snapshot_v10_conflict_<commitId>', 'na_security_v26', 'na_master_lock', 'na_readonly',
  'na_lock_productos', 'na_lock_ventas', 'na_lock_caja', 'na_lock_clientes',
  'na_lock_gastos', 'na_lock_importacion', 'na_lock_configuracion',
  'na_app_initialized_v1', 'na_seed_catalog_version', 'na_seed_catalog_suppressed',
  'na_cfg_category', 'na_cart_draft', 'na_pre_restore_snapshot_v1',
].sort();

const EXPECTED_SESSION = [
  'na_snapshot_v9_session', 'na_pre_restore_snapshot_v1_session', 'na_security_locked',
  'na_v10_outbox', 'na_cart_draft',
].sort();

const EXPECTED_LEGACY = [
  'na_productos', 'na_ventas', 'na_clientes', 'na_creditos', 'na_gastos',
  'na_cajMovs', 'na_cajEstado', 'na_app_state', 'na_cart',
].sort();

let _a = null;
function analyzed() {
  if (!_a) {
    ensureBaselineFixture();
    _a = analyzeAll(readFixtureText());
  }
  return _a;
}

test('localStorage key inventory is exactly the documented set', () => {
  assert.deepEqual(analyzed().storage.localStorage, EXPECTED_LOCAL);
});

test('sessionStorage key inventory is exactly the documented set', () => {
  assert.deepEqual(analyzed().storage.sessionStorage, EXPECTED_SESSION);
});

test('legacy (read-only) key inventory is exactly the documented set', () => {
  assert.deepEqual(analyzed().storage.legacy, EXPECTED_LEGACY);
});

test('no unclassified na_* keys', () => {
  assert.deepEqual(analyzed().storage.other, [], 'all na_* keys must be classified');
});

test('dynamic conflict key is detected', () => {
  assert.equal(analyzed().storage.dynamicConflictKey, 'na_snapshot_v10_conflict_<commitId>');
});

test('IndexedDB: DB name, versions 1 and 2', () => {
  const a = analyzed();
  assert.equal(a.storage.constants._NA_DB_NAME, 'NuevoAmanecerPOS');
  const versions = a.storage.dbOpens.map((o) => o.versionExpr).sort();
  assert.deepEqual(versions, ['1', '_NA_V10_DB_VERSION'].sort());
  assert.equal(a.storage.constants._NA_V10_DB_VERSION, '2');
});

test('IndexedDB: stores state/operations/checkpoints with correct keyPaths', () => {
  const a = analyzed();
  const stores = a.storage.objectStores.map((s) => ({ name: s.name, keyPath: s.keyPath }));
  assert.equal(stores.length, 4, '4 createObjectStore calls (V9 state + V10 state/operations/checkpoints)');
  assert.deepEqual(stores.map((s) => s.name).sort(), ['checkpoints', 'operations', 'state', 'state']);
  const byName = {};
  for (const s of a.storage.objectStores) {
    byName[s.name] = byName[s.name] || [];
    byName[s.name].push(s.keyPath);
  }
  assert.deepEqual(byName.state, [null, null]);
  assert.deepEqual(byName.operations, ['operationId']);
  assert.deepEqual(byName.checkpoints, ['key']);
});
