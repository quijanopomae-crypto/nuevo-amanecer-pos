// static-overrides.test.mjs — OVERRIDE_MAP tripwire
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE
// These exact definition lines are verified against the authorized blob. If any
// of them changes, the baseline changed — this test is the tripwire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureBaselineFixture, readFixtureText } from './lib/extract-baseline.mjs';
import { analyzeAll } from './lib/static-parse.mjs';

const EXPECTED_OVERRIDES = {
  confirmarVenta: [3508, 4791],
  guardarMovInv: [3558, 4799, 6099],
  posRender: [3410, 5976],
  cliRender: [3598, 5571],
  cajRender: [3647, 5415],
  abrirCred: [2712, 4501, 4805, 5603],
  ventasRender: [3651, 4590, 5260],
  gasRender: [3016, 6060],
  posUpdateCart: [3416, 6025],
  invRender: [3745, 4649],
  previewImagen: [3532, 5066, 5855],
};

let _map = null;
function overrideMap() {
  if (!_map) {
    ensureBaselineFixture();
    _map = analyzeAll(readFixtureText()).overrideMap;
  }
  return _map;
}

for (const [name, definedAt] of Object.entries(EXPECTED_OVERRIDES)) {
  test(`override ${name}: definitions at exact documented lines`, () => {
    const entry = overrideMap()[name];
    assert.ok(entry, `missing override map entry for ${name}`);
    assert.deepEqual(entry.definedAt, definedAt, `definitions for ${name} must be exactly ${JSON.stringify(definedAt)}`);
    assert.equal(entry.finalImplementation, definedAt[definedAt.length - 1], `final implementation of ${name} must be the last definition`);
  });
}

test('ventasRender line 5260 is an alias capture (assignment, not function literal)', () => {
  const entry = overrideMap().ventasRender;
  const kinds = entry.kinds;
  assert.equal(kinds[kinds.length - 1], 'alias', 'ventasRender final must be captured as alias');
});

test('confirmarVenta has no definition after line 6120 (V10 must not replace it)', () => {
  const entry = overrideMap().confirmarVenta;
  assert.ok(entry.definedAt.every((l) => l < 6120), 'confirmarVenta must not be redefined inside V10 range');
});
