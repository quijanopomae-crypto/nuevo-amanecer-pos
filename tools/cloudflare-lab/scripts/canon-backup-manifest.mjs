import { createHash } from 'node:crypto';

export const CANON_BACKUP_FORMAT = 'nuevo-amanecer-d1-backup-v1';
export const DEFAULT_CANON_DATABASE_ID = 'cf2c83d3-f187-472e-967b-0ad24be969eb';

function fail(message) {
  throw new Error('Invalid CANON backup manifest: ' + message);
}

export function parseAndValidateCanonManifest({
  raw,
  sqlKey,
  sqlBytes,
  expectedDatabaseId = DEFAULT_CANON_DATABASE_ID,
}) {
  let manifest;
  try {
    manifest = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
  } catch {
    fail('invalid JSON');
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('root must be an object');
  if (manifest.format !== CANON_BACKUP_FORMAT) fail('unexpected format');
  if (manifest.status !== 'PASS') fail('status must be PASS');
  if (typeof manifest.timestamp !== 'string' || !Number.isFinite(Date.parse(manifest.timestamp))) fail('invalid timestamp');
  if (typeof manifest.database_id !== 'string' || !manifest.database_id) fail('database_id missing');
  if (expectedDatabaseId && manifest.database_id !== expectedDatabaseId) fail('database_id mismatch');
  if (typeof manifest.bookmark !== 'string' || !manifest.bookmark) fail('bookmark missing');
  if (typeof manifest.sql_key !== 'string' || manifest.sql_key !== sqlKey) fail('sql_key mismatch');
  if (!Number.isInteger(manifest.size_bytes) || manifest.size_bytes <= 0) fail('invalid size_bytes');
  if (!Buffer.isBuffer(sqlBytes)) sqlBytes = Buffer.from(sqlBytes);
  if (manifest.size_bytes !== sqlBytes.length) fail('size_bytes mismatch');
  if (typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) fail('invalid sha256');

  const sourceHash = createHash('sha256').update(sqlBytes).digest('hex');
  if (manifest.sha256.toLowerCase() !== sourceHash) fail('sha256 mismatch');

  return {
    manifest,
    sourceHash,
  };
}
