// static-startup.test.mjs — main entry sequence + lifecycle listeners
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureBaselineFixture, readFixtureText } from './lib/extract-baseline.mjs';
import { analyzeAll } from './lib/static-parse.mjs';

let _a = null;
function analyzed() {
  if (!_a) {
    ensureBaselineFixture();
    _a = analyzeAll(readFixtureText());
  }
  return _a;
}

test('main entry is DOMContentLoaded async at line 4273', () => {
  assert.equal(analyzed().startup.mainEntryLine, 4273);
});

test('entry sequence: loadAllData before posRender', () => {
  const seq = analyzed().startup.entrySequence;
  assert.ok(seq.indexOf('loadAllData') < seq.indexOf('posRender'), 'loadAllData must run before posRender');
});

test('entry sequence: saveAllData at the end', () => {
  const seq = analyzed().startup.entrySequence;
  assert.equal(seq[seq.length - 1], 'saveAllData', 'saveAllData must be the final call');
});

test('entry sequence contains the full documented chain in order', () => {
  const seq = analyzed().startup.entrySequence;
  const expected = [
    'loadAllData', 'loadAppState', 'loadMasterConfig', '_naInitSecurity', '_naNormalizeData',
    'renderCategorySelects', '_naApplyConfigUI', '_naInitFreeSaleShortcut', '_naInitBarcodeScanner',
    'creditos.forEach', 'posRender', 'posUpdateCart', 'invRender', 'cfgUpdateStats', 'updateDashboard',
    'saveAllData',
  ];
  assert.deepEqual(seq, expected, 'entry sequence must match the documented chain exactly');
});

test('beforeunload listener is registered', () => {
  const listeners = analyzed().startup.listeners;
  assert.ok(listeners.some((l) => l.event === 'beforeunload'), 'beforeunload must be registered');
});

test('DOMContentLoaded listener is registered (at least the main entry)', () => {
  const listeners = analyzed().startup.listeners;
  assert.ok(listeners.some((l) => l.event === 'DOMContentLoaded'), 'DOMContentLoaded must be registered');
});
