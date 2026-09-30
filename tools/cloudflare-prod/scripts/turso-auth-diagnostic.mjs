import { randomUUID, createHash } from 'node:crypto';
import { TursoD1Adapter } from '../../cloudflare-lab/src/turso-d1-adapter.js';

const db = new TursoD1Adapter({
  url: process.env.TURSO_PROD_DATABASE_URL,
  authToken: process.env.TURSO_PROD_AUTH_TOKEN
});

async function rows(sql) {
  return (await db.prepare(sql).all()).results || [];
}

function safeIndex(rows) {
  return rows.map((row) => ({
    name: String(row.name || ''),
    unique: Number(row.unique || 0),
    partial: Number(row.partial || 0),
    origin: String(row.origin || '')
  }));
}

const devices = (await rows("SELECT COUNT(*) total, SUM(CASE WHEN role='writer' AND status='active' THEN 1 ELSE 0 END) active_writers FROM devices"))[0] || {};
const sessions = (await rows("SELECT COUNT(*) total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active_sessions FROM auth_sessions"))[0] || {};
const control = (await rows("SELECT writer_device_id IS NOT NULL has_writer, EXISTS(SELECT 1 FROM devices d WHERE d.device_id=canonical_control.writer_device_id) writer_exists FROM canonical_control WHERE id=1"))[0] || {};
const deviceIndexes = safeIndex(await rows("PRAGMA index_list(devices)"));
const sessionIndexes = safeIndex(await rows("PRAGMA index_list(auth_sessions)"));

console.log('AUTH_DIAG_COUNTS=' + JSON.stringify({
  devices:Number(devices.total || 0),
  active_writers:Number(devices.active_writers || 0),
  sessions:Number(sessions.total || 0),
  active_sessions:Number(sessions.active_sessions || 0),
  control_has_writer:Number(control.has_writer || 0),
  control_writer_exists:Number(control.writer_exists || 0)
}));
console.log('AUTH_DIAG_DEVICE_INDEXES=' + JSON.stringify(deviceIndexes));
console.log('AUTH_DIAG_SESSION_INDEXES=' + JSON.stringify(sessionIndexes));

const sessionId = randomUUID();
const principalId = 'session:' + sessionId;
const tokenHash = createHash('sha256').update('candidate-auth-diagnostic-' + randomUUID()).digest('hex');

try {
  await db.batch([
    db.prepare(
      "INSERT INTO devices (device_id, role, status, credential_hash, last_seen_at) VALUES (?1, 'writer', 'active', ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(device_id) DO UPDATE SET role='writer', status='active', credential_hash=excluded.credential_hash, last_seen_at=excluded.last_seen_at"
    ).bind(principalId, tokenHash),
    db.prepare(
      "INSERT INTO auth_sessions (session_id, token_hash, status, last_seen_at) VALUES (?1, ?2, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"
    ).bind(sessionId, tokenHash)
  ]);
  console.log('AUTH_DIAG_DIRECT_BATCH=PASS');
} catch (error) {
  console.log('AUTH_DIAG_DIRECT_BATCH=FAIL');
  console.log('AUTH_DIAG_DIRECT_ERROR=' + String(error?.message || error).slice(0, 700));
  process.exitCode = 2;
} finally {
  try {
    await db.batch([
      db.prepare('DELETE FROM auth_sessions WHERE session_id=?1').bind(sessionId),
      db.prepare('DELETE FROM devices WHERE device_id=?1').bind(principalId)
    ]);
    console.log('AUTH_DIAG_CLEANUP=PASS');
  } catch (error) {
    console.log('AUTH_DIAG_CLEANUP=FAIL');
    console.log('AUTH_DIAG_CLEANUP_ERROR=' + String(error?.message || error).slice(0, 500));
    process.exitCode = 3;
  }
}
