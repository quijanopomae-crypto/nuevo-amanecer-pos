import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../tools/cloudflare-lab/src/worker.js';

export function workerFixture(token = 'fixture-token') {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0001_sync_operations.sql', import.meta.url), 'utf8'));
  const binding = {
    prepare(sql) {
      const statement = database.prepare(sql);
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return statement.get(...params) || null; },
        async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
      };
    },
  };
  return {
    database,
    binding,
    fetch(url, options) { return worker.fetch(new Request(url, options), { SYNC_TOKEN: token, nuevo_amanecer_lab: binding }); },
    count() { return database.prepare('SELECT COUNT(*) AS n FROM sync_operations').get().n; },
    row(id) { return database.prepare('SELECT * FROM sync_operations WHERE operation_id = ?').get(id); },
    close() { database.close(); },
  };
}
