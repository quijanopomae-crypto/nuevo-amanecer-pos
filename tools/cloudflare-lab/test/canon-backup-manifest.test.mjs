import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CANON_BACKUP_FORMAT, DEFAULT_CANON_DATABASE_ID, parseAndValidateCanonManifest } from '../scripts/canon-backup-manifest.mjs';

function fixture(overrides = {}) {
  const sqlBytes = Buffer.from('CREATE TABLE x(id INTEGER);');
  const sqlKey = 'nuevo-amanecer-prod-v2/sample.sql';
  const manifest = {
    format: CANON_BACKUP_FORMAT,
    timestamp: '2026-09-24T08:00:00.000Z',
    database_id: DEFAULT_CANON_DATABASE_ID,
    bookmark: 'bookmark-1',
    sql_key: sqlKey,
    size_bytes: sqlBytes.length,
    sha256: createHash('sha256').update(sqlBytes).digest('hex'),
    status: 'PASS',
    ...overrides,
  };
  return { sqlBytes, sqlKey, raw: Buffer.from(JSON.stringify(manifest)) };
}

test('accepts a PASS manifest bound to the SQL bytes', () => {
  const result = parseAndValidateCanonManifest(fixture());
  assert.equal(result.manifest.status, 'PASS');
});

test('rejects invalid or incomplete manifests', () => {
  assert.throws(() => parseAndValidateCanonManifest({ ...fixture(), raw: Buffer.from('{') }), /invalid JSON/);
  assert.throws(() => parseAndValidateCanonManifest(fixture({ status: 'FAIL' })), /status must be PASS/);
  assert.throws(() => parseAndValidateCanonManifest(fixture({ database_id: 'wrong-db' })), /database_id mismatch/);
  assert.throws(() => parseAndValidateCanonManifest(fixture({ bookmark: null })), /bookmark missing/);
  assert.throws(() => parseAndValidateCanonManifest(fixture({ sql_key: 'other.sql' })), /sql_key mismatch/);
  assert.throws(() => parseAndValidateCanonManifest(fixture({ size_bytes: 1 })), /size_bytes mismatch/);
  assert.throws(() => parseAndValidateCanonManifest(fixture({ sha256: '0'.repeat(64) })), /sha256 mismatch/);
});
