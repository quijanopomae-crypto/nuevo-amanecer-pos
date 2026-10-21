// Scheduled (daily) encrypted logical Turso backup + restore verification.
// Run by .github/workflows/turso-daily-backup.yml. Read-only against Turso.
//
// Commands:
//   backup                      read-only snapshot of Turso -> encrypted file + manifest
//   verify <enc.json> [--manifest <manifest.json>] [--key-env <ENV_NAME>] [--out <restored.sqlite>] [--report <file>]
//                               check key fingerprint, decrypt in memory (backup and manifest),
//                               restore into a throwaway SQLite, reconcile
//   fingerprint [<enc.json|manifest.json>] [--key-env <ENV_NAME>]
//                               print the key fingerprint (never the key) and compare with a file
//
// The snapshot is the same one the canon-migration-00NN workflows take (backup() in
// turso-*-maintenance.mjs): schema + every table from sqlite_master, read in ONE batch
// (single transaction), rows selected with backupSelectSql, encrypted with encryptBackup
// (AES-256-GCM, same envelope). The only difference: the key comes from a dedicated
// secret, TURSO_BACKUP_ENCRYPTION_KEY, not from TURSO_PROD_AUTH_TOKEN, so rotating the
// Turso token does not make old backups undecryptable. No fallback to the Turso token.
//
// Secrets are only read from the environment and are never printed.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createHash, createDecipheriv } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { backupSelectSql } from './backup-select.mjs';
import { healthy, encryptBackup } from './turso-customer-contacts-maintenance.mjs';

export const BACKUP_FORMAT = 'nuevo-amanecer-turso-scheduled-backup-v1';
export const MANIFEST_FORMAT = 'nuevo-amanecer-turso-scheduled-backup-manifest-v1';
export const KEY_ENV = 'TURSO_BACKUP_ENCRYPTION_KEY';
export const ENCRYPTED_MANIFEST_FORMAT = 'nuevo-amanecer-turso-scheduled-backup-manifest-encrypted-v1';
// Fingerprint = first 16 hex of sha256(domain prefix + NUL + key). Identifies which key opens
// a backup after rotation; it is not the key and cannot be used to decrypt.
const FINGERPRINT_DOMAIN = 'nuevo-amanecer-backup-key-fingerprint-v1';
export function keyFingerprint(secret) {
  return createHash('sha256').update(FINGERPRINT_DOMAIN + '\0' + secret).digest('hex').slice(0, 16);
}
// Warn (no numbers in the log) when the single-batch snapshot gets big. 16 MiB matches the
// existing D1 backup safety limit; override with TURSO_BACKUP_WARN_BYTES.
export const DEFAULT_WARN_BYTES = 16 * 1024 * 1024;
const AAD = 'nuevo-amanecer-contact-backup-v1';
// Tables the reconciliation must find (sales, cash, receipts, stock, control, catalog, credit).
export const REQUIRED_TABLES = [
  'canonical_control', 'products', 'customers', 'credits', 'credit_payments',
  'sales', 'sale_items', 'canonical_cash_sessions', 'cash_movements',
  'canonical_command_receipts', 'canonical_live_products', 'inventory_movements',
];
const SUM_COLUMN = /(_cents|_quantity)$/;

export function requireBackupKey(env = process.env, keyEnv = KEY_ENV) {
  const key = env[keyEnv];
  if (typeof key !== 'string' || key.length < 32) {
    throw new Error(`${keyEnv} is missing or shorter than 32 characters. The owner must create this GitHub Actions secret ` +
      '(a random value of at least 32 characters, e.g. `openssl rand -base64 48`) and keep a copy outside GitHub. ' +
      'There is no fallback to TURSO_PROD_AUTH_TOKEN.');
  }
  if (keyEnv === KEY_ENV && env.TURSO_PROD_AUTH_TOKEN && key === env.TURSO_PROD_AUTH_TOKEN) {
    throw new Error(`${KEY_ENV} must be different from TURSO_PROD_AUTH_TOKEN`);
  }
  return key;
}

function assertScalar(table, row) {
  for (const [column, value] of Object.entries(row)) {
    if (value !== null && typeof value === 'object') {
      throw new Error(`unsupported non-scalar value (likely BLOB) in ${table}.${column}; the JSON backup format cannot represent it`);
    }
  }
}
const canonicalRow = row => JSON.stringify(Object.keys(row).sort().map(k => [k, row[k]]));
export function tableDigest(rows) {
  const lines = rows.map(canonicalRow).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}
function sums(rows) {
  // Sorted so float sums do not depend on row order (restored SELECT order may differ).
  const out = {};
  for (const row of [...rows].sort((a, b) => (canonicalRow(a) < canonicalRow(b) ? -1 : 1))) for (const [k, v] of Object.entries(row)) {
    if (SUM_COLUMN.test(k) && typeof v === 'number') out[k] = (out[k] || 0) + v;
  }
  return out;
}
export function summarize(tables) {
  const perTable = {};
  for (const [name, rows] of Object.entries(tables)) {
    for (const row of rows) assertScalar(name, row);
    perTable[name] = { rows: rows.length, sha256: tableDigest(rows) };
  }
  const focus = {};
  for (const name of REQUIRED_TABLES) if (tables[name]) focus[name] = { rows: tables[name].length, sums: sums(tables[name]) };
  return { perTable, focus, control: tables.canonical_control || null };
}

// Same snapshot as backup() in turso-*-maintenance.mjs; dedicated key; manifest beside it.
export async function backup(db, { env = process.env, dir = env.TURSO_BACKUP_DIR || '/tmp/turso-scheduled-backup', now = new Date() } = {}) {
  const secret = requireBackupKey(env);
  await healthy(db);
  const schema = (await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()).results;
  const names = schema.filter(s => s.type === 'table').map(s => s.name);
  const rows = await db.batch(names.map(n => db.prepare(backupSelectSql(n))));
  const tables = Object.fromEntries(names.map((n, i) => [n, rows[i].results]));
  const missing = REQUIRED_TABLES.filter(n => !tables[n]);
  if (missing.length) throw new Error('required tables missing in source: ' + missing.join(','));
  const summary = summarize(tables);
  const createdAt = now.toISOString();
  const fingerprint = keyFingerprint(secret);
  const plainBytes = Buffer.from(JSON.stringify({ format: BACKUP_FORMAT, created_at: createdAt, schema, tables }));
  const warnBytes = Number(env.TURSO_BACKUP_WARN_BYTES) > 0 ? Number(env.TURSO_BACKUP_WARN_BYTES) : DEFAULT_WARN_BYTES;
  const sizeStatus = plainBytes.length > warnBytes ? 'NEAR_LIMIT' : 'OK';
  if (sizeStatus === 'NEAR_LIMIT') console.log('::warning::Turso snapshot size is above the warning threshold for the single-batch backup; plan the redesign described in docs/MIGRATION_BACKUP_RESTORE.md (escala).');
  // Same envelope as encryptBackup, plus the key fingerprint in clear (outside the ciphertext).
  const withFingerprint = (bytes) => Buffer.from(JSON.stringify({ ...JSON.parse(encryptBackup(bytes, secret).toString('utf8')), key_fingerprint: fingerprint }));
  const encrypted = withFingerprint(plainBytes);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const encPath = join(dir, 'turso-backup.enc.json');
  const manifestPath = join(dir, 'turso-backup.manifest.json');
  writeFileSync(encPath, encrypted, { mode: 0o600 });
  const manifest = {
    format: MANIFEST_FORMAT, backup_format: BACKUP_FORMAT, created_at: createdAt,
    encryption: { algorithm: 'aes-256-gcm', key_secret: KEY_ENV, key_fingerprint: fingerprint },
    encrypted_sha256: createHash('sha256').update(encrypted).digest('hex'), encrypted_size_bytes: encrypted.length,
    tables: names.length, rows: Object.values(tables).reduce((a, r) => a + r.length, 0), schema_objects: schema.length,
    per_table: summary.perTable, focus: summary.focus,
    excluded: ['sqlite_sequence (AUTOINCREMENT counters restart after restore)', "pos_settings internal:img:% / internal:imgrate:% rows"],
  };
  // The manifest (counts, _cents sums) is encrypted with the same key; only format,
  // fingerprint and the backup hash stay in clear.
  const manifestEnvelope = { ...JSON.parse(withFingerprint(Buffer.from(JSON.stringify(manifest))).toString('utf8')),
    manifest_format: ENCRYPTED_MANIFEST_FORMAT, backup_encrypted_sha256: manifest.encrypted_sha256 };
  writeFileSync(manifestPath, JSON.stringify(manifestEnvelope) + '\n', { mode: 0o600 });
  // Log stays count-free (public repo): state, table count, encrypted file hash, key fingerprint, size status.
  console.log(JSON.stringify({ state: 'TURSO_SCHEDULED_BACKUP_READY', tables: manifest.tables, sha256: manifest.encrypted_sha256, key_fingerprint: fingerprint, size: sizeStatus }));
  if (env.GITHUB_STEP_SUMMARY) writeFileSync(env.GITHUB_STEP_SUMMARY, `- Backup key fingerprint: ${fingerprint}\n- Snapshot size: ${sizeStatus === 'OK' ? 'OK' : 'NEAR LIMIT'}\n`, { flag: 'a' });
  return { encPath, manifestPath, manifest, sizeStatus };
}

// Parse without echoing content in errors (Node puts a text fragment in JSON.parse messages).
function parseJson(text, what) {
  try { return JSON.parse(text); } catch { throw new Error(what + ' is not valid JSON'); }
}
export function checkFingerprint(envelope, secret, what = 'backup') {
  if (envelope && envelope.key_fingerprint && envelope.key_fingerprint !== keyFingerprint(secret)) {
    throw new Error(`${what} was encrypted with a different key: fingerprint ${envelope.key_fingerprint}, provided key ${keyFingerprint(secret)}. Use the key whose fingerprint matches (keep old keys after a rotation).`);
  }
}
export function decryptBackup(encryptedBytes, secret, what = 'backup') {
  const e = parseJson(Buffer.from(encryptedBytes).toString('utf8'), what + ' file');
  if (e.format !== 'nuevo-amanecer-contact-backup-encrypted-v1') throw new Error('unknown encrypted envelope format');
  checkFingerprint(e, secret, what);
  const key = createHash('sha256').update(AAD + '\0' + secret).digest();
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
  d.setAAD(Buffer.from(AAD)); d.setAuthTag(Buffer.from(e.tag, 'base64'));
  let plain;
  try { plain = Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]); }
  catch { throw new Error('decryption failed (wrong key, rotated secret or corrupted file)'); }
  return parseJson(plain.toString('utf8'), 'decrypted ' + what);
}
// Accepts the encrypted manifest written by backup(), or an already decrypted object (tests).
export function openManifest(manifest, secret) {
  if (!manifest) return null;
  if (manifest.manifest_format === ENCRYPTED_MANIFEST_FORMAT) return decryptBackup(Buffer.from(JSON.stringify(manifest)), secret, 'manifest');
  if (manifest.format === MANIFEST_FORMAT) return manifest;
  throw new Error('unknown manifest format');
}

const q = name => '"' + String(name).replaceAll('"', '""') + '"';

// Restore order (T-48, tested): FK off -> tables -> rows in ONE transaction ->
// indexes and views -> triggers last -> FK on -> foreign_key_check + quick_check.
export async function restoreInto(plain, file = ':memory:') {
  const { DatabaseSync } = await import('node:sqlite');
  const R = new DatabaseSync(file);
  R.exec('PRAGMA foreign_keys=OFF');
  const objs = (plain.schema || []).filter(s => s.sql);
  const tablesDDL = objs.filter(s => s.type === 'table');
  for (const s of tablesDDL) R.exec(s.sql);
  let inserted = 0;
  R.exec('BEGIN');
  try {
    for (const [name, rows] of Object.entries(plain.tables)) for (const row of rows) {
      assertScalar(name, row);
      const cols = Object.keys(row);
      R.prepare(`INSERT INTO ${q(name)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => row[c]));
      inserted++;
    }
    R.exec('COMMIT');
  } catch (error) { R.exec('ROLLBACK'); throw error; }
  for (const s of objs.filter(s => s.type === 'index')) R.exec(s.sql);
  // Views may reference other views: retry until no progress.
  let views = objs.filter(s => s.type === 'view');
  while (views.length) {
    const left = [];
    let lastError = null;
    for (const s of views) { try { R.exec(s.sql); } catch (e) { left.push(s); lastError = e; } }
    if (left.length === views.length) throw lastError;
    views = left;
  }
  for (const s of objs.filter(s => s.type === 'trigger')) R.exec(s.sql);
  R.exec('PRAGMA foreign_keys=ON');
  const fk = R.prepare('PRAGMA foreign_key_check').all();
  const qc = R.prepare('PRAGMA quick_check').all().map(r => String(Object.values(r)[0]));
  return { db: R, inserted, objects: objs.length, fk_violations: fk.length, quick_check: qc.join('; ') };
}

export async function verify(encryptedBytes, { secret, manifest: manifestInput = null, out = null } = {}) {
  const manifest = openManifest(manifestInput, secret);
  const plain = decryptBackup(encryptedBytes, secret);
  const failures = [];
  if (!/^nuevo-amanecer-turso-.*backup-v1$/.test(String(plain.format || ''))) failures.push('unexpected backup format');
  if (!plain.tables || !Array.isArray(plain.schema)) throw new Error('backup has no schema/tables');
  const source = summarize(plain.tables);
  const missing = REQUIRED_TABLES.filter(n => !plain.tables[n]);
  if (missing.length) failures.push('required tables missing: ' + missing.join(','));
  if (manifest) {
    const got = createHash('sha256').update(encryptedBytes).digest('hex');
    if (manifest.encrypted_sha256 && manifest.encrypted_sha256 !== got) failures.push('encrypted sha256 differs from manifest');
    if (manifestInput.backup_encrypted_sha256 && manifestInput.backup_encrypted_sha256 !== got) failures.push('encrypted sha256 differs from manifest envelope');
    if (manifest.encryption?.key_fingerprint && manifest.encryption.key_fingerprint !== keyFingerprint(secret)) failures.push('manifest key fingerprint differs from provided key');
    for (const name of new Set([...Object.keys(manifest.per_table || {}), ...Object.keys(source.perTable)])) {
      if (JSON.stringify(manifest.per_table?.[name]) !== JSON.stringify(source.perTable[name])) failures.push('decrypted table differs from manifest: ' + name);
    }
  }
  if (out && existsSync(out)) rmSync(out);
  const r = await restoreInto(plain, out || ':memory:');
  try {
    if (r.fk_violations !== 0) failures.push('foreign_key_check reported violations');
    if (r.quick_check !== 'ok') failures.push('quick_check failed (details only in --report)');
    const perTable = {};
    for (const name of Object.keys(plain.tables)) {
      const rows = r.db.prepare(`SELECT * FROM ${q(name)}`).all().map(x => ({ ...x }));
      const restored = { rows: rows.length, sha256: tableDigest(rows) };
      const expected = source.perTable[name];
      const match = restored.rows === expected.rows && restored.sha256 === expected.sha256;
      perTable[name] = { rows: restored.rows, expected_rows: expected.rows, digest_match: match };
      if (!match) failures.push(`table ${name}: restored ${restored.rows === expected.rows ? 'digest' : 'row count'} differs from backup`);
      if (REQUIRED_TABLES.includes(name)) {
        const restoredSums = sums(rows);
        if (JSON.stringify(restoredSums) !== JSON.stringify(source.focus[name]?.sums)) failures.push(`table ${name}: amount/quantity totals differ from backup`);
      }
    }
    const ctl = r.db.prepare('SELECT * FROM canonical_control').all().map(x => ({ ...x }));
    if (ctl.length !== 1) failures.push('canonical_control must have exactly 1 row');
    else if (canonicalRow(ctl[0]) !== canonicalRow(plain.tables.canonical_control[0])) failures.push('canonical_control differs after restore');
    else if (ctl[0].mode !== 'ACTIVE' || !ctl[0].active_promotion_id) failures.push('canonical_control is not ACTIVE in backup');
    const report = {
      state: failures.length ? 'TURSO_BACKUP_RESTORE_VERIFY_FAIL' : 'TURSO_BACKUP_RESTORE_VERIFY_PASS',
      format: plain.format, created_at: plain.created_at,
      tables: Object.keys(plain.tables).length, rows: r.inserted, schema_objects: r.objects,
      foreign_key_violations: r.fk_violations, quick_check: r.quick_check,
      focus: Object.fromEntries(REQUIRED_TABLES.filter(n => source.focus[n]).map(n => [n, source.focus[n]])),
      per_table: perTable,
      total_digest_match: Object.values(perTable).every(t => t.digest_match),
      total_digest: createHash('sha256').update(Object.keys(source.perTable).sort().map(n => n + ':' + source.perTable[n].sha256).join('\n')).digest('hex'),
      failures,
    };
    return report;
  } finally { r.db.close(); }
}

// What may appear in a public log: pass/fail, table count, digest ok, integrity checks. No row counts.
export function publicSummary(report) {
  return { state: report.state, tables: report.tables, total_digest_match: report.total_digest_match,
    quick_check: report.quick_check === 'ok' ? 'ok' : 'FAIL', foreign_key_check: report.foreign_key_violations === 0 ? 'ok' : 'FAIL',
    failures: report.failures };
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (command === 'backup') {
    requireBackupKey();
    const { TursoD1Adapter } = await import('../../cloudflare-lab/src/turso-d1-adapter.js');
    if (!process.env.TURSO_PROD_DATABASE_URL || !process.env.TURSO_PROD_AUTH_TOKEN) throw new Error('TURSO_PROD_DATABASE_URL / TURSO_PROD_AUTH_TOKEN missing');
    const db = new TursoD1Adapter({ url: process.env.TURSO_PROD_DATABASE_URL, authToken: process.env.TURSO_PROD_AUTH_TOKEN });
    return backup(db);
  }
  if (command === 'verify') {
    const file = argv[1];
    if (!file) throw new Error('usage: verify <enc.json> [--manifest f] [--key-env NAME] [--out restored.sqlite] [--report full-report.json]');
    const keyEnv = arg(argv, '--key-env') || KEY_ENV;
    const secret = requireBackupKey(process.env, keyEnv);
    const manifestPath = arg(argv, '--manifest');
    const report = await verify(readFileSync(file), { secret, manifest: manifestPath ? parseJson(readFileSync(manifestPath, 'utf8'), 'manifest file') : null, out: arg(argv, '--out') });
    // Full report (per-table counts, sums) only to a file the operator asks for; never to the log.
    const reportPath = arg(argv, '--report');
    if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(publicSummary(report)));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const p = publicSummary(report);
      const lines = [`## Turso backup restore verification: ${report.failures.length ? 'FAIL' : 'PASS'}`,
        `- Tables: ${p.tables}`, `- Total digest: ${p.total_digest_match ? 'ok' : 'MISMATCH'}`,
        `- quick_check: ${p.quick_check}; foreign_key_check: ${p.foreign_key_check}`,
        ...p.failures.map(f => `- FAIL: ${f}`)];
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' });
    }
    if (report.failures.length) process.exitCode = 1;
    return report;
  }
  if (command === 'fingerprint') {
    // Owner check: export the key (e.g. `read -rs TURSO_BACKUP_ENCRYPTION_KEY && export TURSO_BACKUP_ENCRYPTION_KEY`)
    // and compare with "Backup key fingerprint" in the run summary or key_fingerprint in the .enc.json.
    const keyEnv = arg(argv, '--key-env') || KEY_ENV;
    const secret = keyEnv === KEY_ENV ? requireBackupKey(process.env, keyEnv) : process.env[keyEnv];
    if (!secret) throw new Error(keyEnv + ' is not set');
    console.log(JSON.stringify({ key_env: keyEnv, key_fingerprint: keyFingerprint(secret) }));
    const file = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
    if (file) {
      const env = parseJson(readFileSync(file, 'utf8'), 'file');
      const stored = env.key_fingerprint || null;
      console.log(JSON.stringify({ file_key_fingerprint: stored, match: stored ? stored === keyFingerprint(secret) : null }));
      if (stored && stored !== keyFingerprint(secret)) process.exitCode = 1;
    }
    return;
  }
  throw new Error('unknown command (backup | verify | fingerprint)');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) { console.error('ERROR: ' + error.message); process.exitCode = 1; }
}
