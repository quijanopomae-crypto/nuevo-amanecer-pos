import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const inline02 = readFileSync('POS/js/legacy-inline/inline-02.js', 'utf8');
const inline03 = readFileSync('POS/js/legacy-inline/inline-03.js', 'utf8');
const inline07 = readFileSync('POS/js/legacy-inline/inline-07.js', 'utf8');

function oneLine(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, marker + ' missing');
  const end = source.indexOf('\n', start);
  return source.slice(start, end < 0 ? source.length : end);
}

test('CANON no longer treats configuration as a commercial legacy module', () => {
  const assignment = oneLine(inline03, 'isModuleLocked=function');
  const values = new Map([
    ['na_master_lock', 'false'],
    ['na_readonly', 'false'],
    ['na_lock_configuracion', 'false'],
  ]);
  const context = vm.createContext({
    NuevoAmanecerCanonical: { enabled: () => true },
    securityIsLocked: () => false,
    LOCK_KEYS: {
      master: 'na_master_lock',
      readOnly: 'na_readonly',
      modules: {
        productos: 'na_lock_productos',
        ventas: 'na_lock_ventas',
        caja: 'na_lock_caja',
        clientes: 'na_lock_clientes',
        gastos: 'na_lock_gastos',
        importacion: 'na_lock_importacion',
        configuracion: 'na_lock_configuracion',
      },
    },
    storage: { getItem: key => values.get(key) ?? null },
  });
  vm.runInContext(assignment, context);

  assert.equal(context.isModuleLocked('configuracion'), false);
  assert.equal(context.isModuleLocked('productos'), true);
  assert.equal(context.isModuleLocked('clientes'), true);
  assert.equal(context.isModuleLocked('ventas'), true);
  assert.equal(context.isModuleLocked('ventas', { canonicalSaleCapture: true }), false);

  values.set('na_lock_configuracion', 'true');
  assert.equal(context.isModuleLocked('configuracion'), true, 'explicit configuration lock must still win');
  values.set('na_lock_configuracion', 'false');
  values.set('na_master_lock', 'true');
  assert.equal(context.isModuleLocked('configuracion'), true, 'master lock must still win');
});

test('CANON saveAppState uses verified local configuration storage while saveAllData stays fenced', () => {
  assert.match(inline02, /_NA_LOCAL_CONFIG_KEY='na_local_config_v1'/);
  assert.match(inline02, /saveAppState=function\(\)\{return _naCanonicalRuntimeEnabled\(\)\?_naPersistLocalConfigState\(\):_naQueuePersist\(\);\};/);
  assert.match(inline02, /saveAllData=function\(\)\{return _naQueuePersist\(\);\};/);
  assert.match(inline02, /CANONICAL_LEGACY_PERSISTENCE_BLOCKED/);
  assert.match(inline02, /storage\.writePersistent\(_NA_LOCAL_CONFIG_KEY,serialized\)/);
  assert.match(inline02, /local\.ok&&local\.verified/);
});

test('local configuration writer reports durable success only after persistent verification', async () => {
  const start = inline02.indexOf('function _naPersistLocalConfigState(){');
  const end = inline02.indexOf('function _naReadLocalSnapshot()', start);
  assert.ok(start >= 0 && end > start);
  const block = inline02.slice(start, end);

  const writes = new Map();
  const context = vm.createContext({
    _NA_LOCAL_CONFIG_KEY: 'na_local_config_v1',
    _naBuildLocalConfigState: () => ({ version: 1, appConfig: { alertsEnabled: false } }),
    _naPersistFailed: error => ({ ok:false, durable:false, temporary:false, storage:'none', verified:false, error }),
    _naSafePersistError: error => error ? { name:'StorageError', code:'', message:String(error.message || error) } : null,
    storage: {
      writePersistent(key, value) { writes.set(key, value); return { ok:true, verified:true, error:null }; },
      writeSession(key, value) { writes.set(key + ':session', value); return { ok:true, verified:true, error:null }; },
    },
    JSON,
    Promise,
    Error,
  });
  vm.runInContext(block, context);
  const result = await context._naPersistLocalConfigState();

  assert.equal(result.durable, true);
  assert.equal(result.verified, true);
  assert.equal(result.storage, 'localStorage');
  assert.equal(JSON.parse(writes.get('na_local_config_v1')).appConfig.alertsEnabled, false);
});

test('CANON startup overlays the dedicated local configuration after any old V9 snapshot', () => {
  const load = inline02.slice(
    inline02.indexOf('loadAllData=async function(){'),
    inline02.indexOf('loadAppState=function(){')
  );
  const legacyApply = load.indexOf('_naApplySnapshot(saved,true)');
  const localRead = load.indexOf('_naReadLocalConfigState()');
  const localApply = load.indexOf('_naApplyLocalConfigState(localConfig)');
  assert.ok(legacyApply >= 0);
  assert.ok(localRead > legacyApply);
  assert.ok(localApply > localRead);
});

test('Guardar todo persists configuration state and only announces verified durable success', () => {
  const line = oneLine(inline03, 'guardarConfig=async function');
  assert.match(line, /await saveAppState\(\)/);
  assert.match(line, /_naWasPersisted\(result\)/);
  assert.doesNotMatch(line, /_naFinalizeOperationPersistence/);
});

test('cashier, role and personal PIN settings use configuration persistence, not commercial persistence', () => {
  assert.match(oneLine(inline02, 'async function _naPersistCashierChange'), /await saveAppState\(\)/);
  for (const marker of [
    'async function _naF10SavePermissions',
    'async function _naF10SetCashierRole',
    'async function _naF10SetCashierPin',
    'cashierAddFromConfig=async function',
  ]) {
    const line = oneLine(inline07, marker);
    assert.match(line, /saveAppState\(\)/, marker);
    assert.doesNotMatch(line, /saveAllData\(\)/, marker);
  }
});
