// baseline-fixture.test.mjs — verify the authorized baseline fixture
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ensureBaselineFixture, PRODUCT_BLOB, BASE_COMMIT, FIXTURE_PATH } from './lib/extract-baseline.mjs';
import { gitBlobSha1 } from './lib/blob-hash.mjs';

test('baseline fixture regenerates and verifies authorized product blob', () => {
  const { path, blob, lines } = ensureBaselineFixture();
  assert.equal(blob, PRODUCT_BLOB, 'fixture blob must match authorized product blob');
  assert.equal(path, FIXTURE_PATH, 'fixture path must be the canonical fixture path');
  assert.equal(lines, 7164, 'authorized baseline must have exactly 7164 lines');
});

test('fixture first line is an HTML5 doctype', () => {
  ensureBaselineFixture();
  const raw = fs.readFileSync(FIXTURE_PATH);
  const firstLine = raw.toString('utf8').split(/\r?\n/, 1)[0];
  assert.match(firstLine, /<!doctype html>/i, 'first line must be <!doctype html>');
});

test('fixture blob re-verified directly from disk bytes', () => {
  const raw = fs.readFileSync(FIXTURE_PATH);
  assert.equal(gitBlobSha1(raw), PRODUCT_BLOB, 'disk bytes must hash to the authorized blob');
});

test('base commit constant is non-empty and stable', () => {
  assert.equal(BASE_COMMIT, 'b4003e2f0d84cdb832de9eff730f60dc946cbbbe');
});
