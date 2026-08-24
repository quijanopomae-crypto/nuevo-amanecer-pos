// static-v10-dormant.test.mjs — V10 must remain dormant in the authorized baseline
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureBaselineFixture, readFixtureText } from './lib/extract-baseline.mjs';
import { analyzeAll } from './lib/static-parse.mjs';
import { splitLines } from './lib/extract-baseline.mjs';

let _a = null;
function analyzed() {
  if (!_a) {
    ensureBaselineFixture();
    _a = analyzeAll(readFixtureText());
  }
  return _a;
}

test('V10 is dormant: no references outside the V10 range', () => {
  const v10 = analyzed().v10;
  assert.equal(v10.dormant, true, 'V10 must be dormant');
  assert.deepEqual(v10.externalRefs, [], 'no external V10 references');
  assert.ok(v10.v10Start >= 6120, 'V10 range must start at/after line 6120');
});

test('key V10 dormancy comments are present verbatim', () => {
  const src = readFixtureText();
  assert.ok(src.includes('Nucleo V10 inactivo'), 'missing comment: Nucleo V10 inactivo');
  assert.ok(src.includes('sin reemplazar confirmarVenta'), 'missing comment: sin reemplazar confirmarVenta');
  assert.ok(src.includes('DORMANTE, NO CONECTADO A V9'), 'missing comment: DORMANTE, NO CONECTADO A V9');
});

test('confirmarVenta has no definition after line 6120', () => {
  const a = analyzed();
  const defs = a.functions.filter((f) => f.name === 'confirmarVenta');
  assert.ok(defs.length > 0);
  assert.ok(defs.every((d) => d.line < 6120), 'confirmarVenta must not be defined in V10 range');
});

test('bootstrap (DOMContentLoaded entry) does not call any _naV10* function', () => {
  const src = readFixtureText();
  const lines = splitLines(src);
  const bootstrap = lines.slice(4272, 4285).join('\n'); // lines 4273-4285 (1-based)
  assert.equal(/_naV10\w*\s*\(/.test(bootstrap), false, 'bootstrap must not invoke _naV10*');
});
