import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDatabaseHealthError } from '../src/worker.js';

test('health diagnostic classifies Turso failures without echoing arbitrary messages', () => {
  assert.equal(
    classifyDatabaseHealthError(new Error('Turso HTTP 401: unauthorized')),
    'turso_http_401'
  );
  assert.equal(
    classifyDatabaseHealthError(new Error('Turso protocol returned non-JSON HTTP 502')),
    'turso_http_502'
  );
  assert.equal(
    classifyDatabaseHealthError(new Error('missing execute result')),
    'turso_protocol_execute_missing'
  );

  const sql = new Error('Turso SQL error: constraint failed');
  sql.code = 'SQLITE_CONSTRAINT';
  assert.equal(classifyDatabaseHealthError(sql), 'turso_sql_sqlite_constraint');

  assert.equal(
    classifyDatabaseHealthError(new TypeError('fetch failed')),
    'turso_fetch_failed'
  );

  const unknown = classifyDatabaseHealthError(
    new Error('unexpected secret-looking value abc.def.ghi')
  );
  assert.equal(unknown, 'backend_unknown');
  assert.doesNotMatch(unknown, /abc|def|ghi/);
});
