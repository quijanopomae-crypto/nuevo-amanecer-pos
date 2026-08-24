// generate-evidence.test.mjs — regenerate static evidence + deterministic MANIFEST
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensureBaselineFixture, readFixtureText, PRODUCT_BLOB, BASE_COMMIT } from './lib/extract-baseline.mjs';
import { buildEvidence, EVIDENCE_DIR, KNOWN_BASELINES } from './lib/evidence.mjs';
import { canonicalJson } from './lib/fingerprint.mjs';

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const EXPECTED_FILES = [
  'structural.json', 'overrides.json', 'globals.json', 'storage-static.json',
  'startup.json', 'v10-dormancy.json', 'dom-ids.json', 'inline-handlers.json',
  'external-deps.json',
];

test('generates all evidence files and a deterministic manifest', () => {
  ensureBaselineFixture();
  const src = readFixtureText();
  const e1 = buildEvidence(src);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  for (const name of EXPECTED_FILES) {
    const data = e1.files[name];
    assert.ok(data, `missing evidence file data: ${name}`);
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), stableStringify(data) + '\n');
  }

  const manifestPath = path.join(EVIDENCE_DIR, 'MANIFEST.json');
  fs.writeFileSync(manifestPath, stableStringify(e1.manifest) + '\n');
  const h1 = sha256File(manifestPath);

  // Second run must be byte-identical (no timestamps, stable serialization).
  const e2 = buildEvidence(src);
  fs.writeFileSync(manifestPath, stableStringify(e2.manifest) + '\n');
  const h2 = sha256File(manifestPath);
  assert.equal(h2, h1, 'MANIFEST.json must be byte-identical across regenerations');
  assert.equal(canonicalJson(e1.manifest), canonicalJson(e2.manifest));

  // evidence files are valid JSON
  for (const name of EXPECTED_FILES) {
    const parsed = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, name), 'utf8'));
    assert.equal(parsed.productBlob, PRODUCT_BLOB, `${name} productBlob`);
    assert.equal(parsed.baseCommit, BASE_COMMIT, `${name} baseCommit`);
  }
});

test('manifest carries authorized blob/commit and all 7 fingerprints with sources', () => {
  ensureBaselineFixture();
  const { manifest } = buildEvidence(readFixtureText());
  assert.equal(manifest.productBlob, PRODUCT_BLOB);
  assert.equal(manifest.baseCommit, BASE_COMMIT);
  const fp = manifest.fingerprints;
  const keys = [
    'domFingerprint', 'globalApiFingerprint', 'overrideMapFingerprint', 'storageFingerprint',
    'v9BaselineFingerprint', 'v10BaselineFingerprint', 'knownFailuresFingerprint',
  ];
  for (const k of keys) {
    assert.ok(fp[k], `missing fingerprint ${k}`);
    assert.match(fp[k].value, /^[0-9a-f]{64}$/, `${k} must be sha256 hex`);
    assert.ok(typeof fp[k].source === 'string' && fp[k].source.length > 0, `${k} source`);
  }
});

test('manifest has no timestamps', () => {
  ensureBaselineFixture();
  const { manifest } = buildEvidence(readFixtureText());
  const json = JSON.stringify(manifest);
  assert.equal(/updatedAt|createdAt|timestamp|Date\(|ISOString|\d{4}-\d{2}-\d{2}T/.test(json), false, 'manifest must not contain timestamps');
});

test('known_baselines block is frozen at the documented values', () => {
  assert.deepEqual(KNOWN_BASELINES, {
    CASH: '11/13',
    cashNotes: ['HISTORICAL_COMMIT_UNVERIFIED x2'],
    CREDITS: '21/22',
    creditsNotes: ['criterion/criterio'],
    saleTransaction: 'baseline pendiente',
    INVENTORY: 'A_PLUS_B cerrado; 2 P1 + 1 P2 pendientes',
  });
});
