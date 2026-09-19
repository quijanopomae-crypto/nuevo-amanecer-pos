import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../tools/cloudflare-lab/src/worker.js';

export function workerFixture(token = 'fixture-token', readToken = 'fixture-read-token') {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0001_sync_operations.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0002_read_only_indexes.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0003_device_auth.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0004_sale_create.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0005_import_staging.sql', import.meta.url), 'utf8'));
  const pepper = 'fixture-device-pepper';
  const hash = (credential) => createHmac('sha256', pepper).update(credential).digest('hex');
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
  return {
    database,
    binding,
    env: { READ_TOKEN: readToken, DEVICE_CREDENTIAL_PEPPER: pepper, nuevo_amanecer_lab: binding },
    fetch(url, options) { return worker.fetch(new Request(url, options), { READ_TOKEN: readToken, DEVICE_CREDENTIAL_PEPPER: pepper, nuevo_amanecer_lab: binding }); },
    addDevice(deviceId, role, status, credential) {
      database.prepare('INSERT INTO devices (device_id, role, status, credential_hash) VALUES (?, ?, ?, ?)').run(deviceId, role, status, hash(credential));
    },
    device(deviceId) { return database.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId); },
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
