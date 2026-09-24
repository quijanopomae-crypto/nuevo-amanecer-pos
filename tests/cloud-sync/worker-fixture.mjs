import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../tools/cloudflare-lab/src/worker.js';

export function workerFixture(token = 'fixture-token', readToken = 'fixture-read-token') {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0001_sync_operations.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0002_read_only_indexes.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0003_device_auth.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0004_sale_create.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0005_import_staging.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0006_canonical_promotion.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0010_session_auth.sql', import.meta.url), 'utf8'));
  const hash = (credential) => createHash('sha256').update(credential).digest('hex');
  let batchFailureAt = null;
  const binding = {
    prepare(sql) {
      const statement = database.prepare(sql);
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return statement.get(...params) || null; },
        async all() { return { results: statement.all(...params) }; },
        async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
        _run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
      };
    },
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = [];
        for (const [index, statement] of statements.entries()) {
          if (batchFailureAt === index) throw new Error('forced batch failure');
          results.push(statement._run());
        }
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const env = { READ_TOKEN: readToken, POS_ACTIVATION_SECRET: token, nuevo_amanecer_lab: binding };
  return {
    database,
    binding,
    env,
    async fetch(url, options = {}) {
      const headers = new Headers(options.headers || {});
      const legacyToken = headers.get('x-sync-token');
      const legacyDevice = headers.get('x-device-id');
      if (legacyToken && legacyDevice) {
        const existing = database.prepare('SELECT session_id FROM auth_sessions WHERE session_id = ?').get(legacyDevice);
        if (!existing) {
          const tokenHash = hash(legacyToken);
          database.prepare("INSERT INTO devices (device_id, role, status, credential_hash) VALUES (?, 'writer', 'active', ?)").run('session:' + legacyDevice, tokenHash);
          database.prepare("INSERT INTO auth_sessions (session_id, token_hash, status) VALUES (?, ?, 'active')").run(legacyDevice, tokenHash);
        }
        headers.delete('x-sync-token');
        headers.delete('x-device-id');
        headers.set('authorization', 'Bearer ' + legacyToken);
      }
      return worker.fetch(new Request(url, { ...options, headers }), env);
    },
    async activate(secret = token) {
      const response = await worker.fetch(new Request('https://worker.test/auth/activate', {
        method: 'POST',
        headers: { 'x-activation-secret': secret },
      }), env);
      const body = await response.clone().json().catch(() => null);
      return { response, token: body?.session_token || null };
    },
    addDevice(deviceId, role, status, credential) {
      const tokenHash = hash(credential);
      database.prepare('INSERT INTO devices (device_id, role, status, credential_hash) VALUES (?, ?, ?, ?)').run('session:' + deviceId, role, status, tokenHash);
      database.prepare('INSERT INTO auth_sessions (session_id, token_hash, status) VALUES (?, ?, ?)').run(deviceId, tokenHash, status);
    },
    rotateSession(sessionId, credential) {
      const tokenHash = hash(credential);
      database.prepare('UPDATE auth_sessions SET token_hash=? WHERE session_id=?').run(tokenHash, sessionId);
      database.prepare('UPDATE devices SET credential_hash=? WHERE device_id=?').run(tokenHash, 'session:' + sessionId);
    },
    device(deviceId) { return database.prepare('SELECT * FROM devices WHERE device_id = ?').get('session:' + deviceId); },
    insert(operation) {
      database.prepare(`INSERT INTO sync_operations
        (operation_id, device_id, device_sequence, entity_type, entity_id, payload, payload_hash, created_at, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        operation.operation_id, operation.device_id, operation.device_sequence, operation.entity_type,
        operation.entity_id, JSON.stringify(operation.payload), operation.payload_hash || '0'.repeat(64),
        operation.created_at, operation.received_at,
      );
    },
    count() { return database.prepare('SELECT COUNT(*) AS n FROM sync_operations').get().n; },
    row(id) { return database.prepare('SELECT * FROM sync_operations WHERE operation_id = ?').get(id); },
    failBatchAt(index) { batchFailureAt = index; },
    close() { database.close(); },
  };
}
