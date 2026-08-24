// static-globals.test.mjs — presence and line of key global declarations
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureBaselineFixture, readFixtureText } from './lib/extract-baseline.mjs';
import { analyzeAll } from './lib/static-parse.mjs';

const EXPECTED_GLOBALS = {
  storage: { line: 2273, kind: 'const' },
  appConfig: { line: 2337, kind: 'let' },
  productos: { line: 2351, kind: 'let' },
  cart: { line: 2352, kind: 'let' },
  _NA_SEED_PRODUCTOS: { line: 2354, kind: 'const' },
  clientes: { line: 2687, kind: 'let' },
  creditos: { line: 2688, kind: 'let' },
  cajEstado: { line: 2727, kind: 'let' },
  cajMovs: { line: 2728, kind: 'let' },
  ventas: { line: 2751, kind: 'let' },
  gastos: { line: 3012, kind: 'let' },
};

let _a = null;
function analyzed() {
  if (!_a) {
    ensureBaselineFixture();
    _a = analyzeAll(readFixtureText());
  }
  return _a;
}

function findGlobal(name) {
  return analyzed().globals.find((g) => g.name === name);
}

for (const [name, expected] of Object.entries(EXPECTED_GLOBALS)) {
  test(`global ${name} declared at line ${expected.line} (${expected.kind})`, () => {
    const g = findGlobal(name);
    assert.ok(g, `global ${name} must be declared`);
    assert.equal(g.line, expected.line, `${name} line`);
    assert.equal(g.kind, expected.kind, `${name} kind`);
  });
}

test('_NA_SNAPSHOT_KEY === snapshot_v9 (V9 key constant)', () => {
  const a = analyzed();
  assert.equal(a.storage.constants._NA_SNAPSHOT_KEY, 'snapshot_v9');
});

test('V10 constants live at lines 6122-6131', () => {
  const a = analyzed();
  const v10Consts = [
    ['_NA_V10_DB_VERSION', 6122],
    ['_NA_V10_STATE_STORE', 6123],
    ['_NA_V10_OPERATIONS_STORE', 6124],
    ['_NA_V10_CHECKPOINTS_STORE', 6125],
    ['_NA_V10_SNAPSHOT_KEY', 6126],
  ];
  for (const [name, line] of v10Consts) {
    const g = findGlobal(name);
    assert.ok(g, `missing ${name}`);
    assert.equal(g.line, line, `${name} line`);
    assert.ok(line >= 6122 && line <= 6131, `${name} must be within 6122-6131`);
  }
});

test('storage constants: DB name and V10 stores', () => {
  const c = analyzed().storage.constants;
  assert.equal(c._NA_DB_NAME, 'NuevoAmanecerPOS');
  assert.equal(c._NA_V10_DB_VERSION, '2');
  assert.equal(c._NA_V10_STATE_STORE, 'state');
  assert.equal(c._NA_V10_OPERATIONS_STORE, 'operations');
  assert.equal(c._NA_V10_CHECKPOINTS_STORE, 'checkpoints');
});
