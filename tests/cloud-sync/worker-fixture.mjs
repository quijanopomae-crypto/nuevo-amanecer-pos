import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../tools/cloudflare-lab/src/worker.js';

export function workerFixture(token = 'fixture-token', readToken = 'fixture-read-token') {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0001_sync_operations.sql', import.meta.url), 'utf8'));
  const binding = {
    prepare(sql) {
      const statement = database.prepare(sql);
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return statement.get(...params) || null; },
        async all() { return { results: statement.all(...params) }; },
        async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
      };
    },
  };
  return {
    database,
    binding,
    fetch(url, options) { return worker.fetch(new Request(url, options), { SYNC_TOKEN: token, READ_TOKEN: readToken, nuevo_amanecer_lab: binding }); },
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
    close() { database.close(); },
  };
}
