import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { apiResult, backupKey, manifest, requireEnv, sha256Hex } from '../../tools/cloudflare-backup/src/backup-core.js';

globalThis.crypto ??= webcrypto;

test('backup manifest records UTC timestamp, database, bookmark, size, hash and PASS', async () => {
  const timestamp = Date.parse('2026-09-21T08:00:00.000Z');
  const bytes = new TextEncoder().encode('CREATE TABLE durable(id INTEGER);');
  const sha256 = await sha256Hex(bytes);
  assert.equal(sha256.length, 64);
  const sqlKey = backupKey(timestamp, 'sql');
  assert.equal(sqlKey, 'nuevo-amanecer-prod-v2/2026-09-21T08-00-00.000Z.sql');
  assert.deepEqual(manifest({ timestamp, databaseId: 'db-id', bookmark: 'bookmark', sqlKey, size: bytes.length, sha256, status: 'PASS' }), {
    format: 'nuevo-amanecer-d1-backup-v1', timestamp: '2026-09-21T08:00:00.000Z', database_id: 'db-id', bookmark: 'bookmark',
    sql_key: sqlKey, size_bytes: bytes.length, sha256, status: 'PASS',
  });
});

test('backup helpers fail closed on missing secrets and API errors', async () => {
  assert.throws(() => requireEnv({ ACCOUNT_ID: 'a', DATABASE_ID: 'd' }), /D1_REST_API_TOKEN/);
  assert.deepEqual(await apiResult(new Response(JSON.stringify({ success: true, result: { at_bookmark: 'b' } }), { status: 200 })), { at_bookmark: 'b' });
  await assert.rejects(apiResult(new Response(JSON.stringify({ success: false }), { status: 403 })), /failed/);
  await assert.rejects(apiResult(new Response(JSON.stringify({ success: true, result: { status: 'error' } }), { status: 200 })), /job failed/);
});

// Execute the actual class with only the platform base class replaced. API/R2
// are explicit test doubles; this is not remote Workflow deployment evidence.
const require = createRequire(new URL('../../tools/cloudflare-lab/package.json', import.meta.url));
const { build } = require('esbuild');
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../../tools/cloudflare-backup/src/workflow.js', import.meta.url))],
  bundle: true, format: 'esm', write: false, plugins: [{ name: 'workflow-base-only', setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'base', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export class WorkflowEntrypoint { constructor(ctx, env) { this.env = env; } }' }));
  } }] });
const { D1BackupWorkflow, default: backupWorker } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('standard Cron starts one Workflow, awaits failure and keeps HTTP closed', async () => {
  const config = JSON.parse(await readFile(new URL('../../tools/cloudflare-backup/wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.triggers.crons, ['0 8 * * *']);
  assert.equal(config.workflows[0].schedules, undefined);
  const calls = [];
  await backupWorker.scheduled({ scheduledTime: 123 }, { BACKUP_WORKFLOW: {
    async create(value) { calls.push(value); },
  } });
  assert.deepEqual(calls, [{ params: { scheduledTime: 123 } }]);
  await assert.rejects(backupWorker.scheduled({ scheduledTime: 123 }, { BACKUP_WORKFLOW: {
    async create() { throw new Error('workflow unavailable'); },
  } }), /workflow unavailable/);
  assert.equal(backupWorker.fetch().status, 404);
});

test('actual Workflow verifies R2 bytes, records failure and rejects wrong target before network', async t => {
  for (const fault of ['none', 'target', 'download', 'corruption', 'manifest']) await t.test(fault, async t => {
    const objects = new Map(), calls = [], steps = [];
    const env = { ACCOUNT_ID: 'a'.repeat(32), DATABASE_ID: fault === 'target' ? 'wrong-db' : 'cf2c83d3-f187-472e-967b-0ad24be969eb', D1_REST_API_TOKEN: 'test-secret',
      BACKUP_BUCKET: {
        async put(key, bytes, options) {
          if (fault === 'manifest' && key.endsWith('.json') && JSON.parse(bytes).status === 'PASS') throw new Error('manifest outage');
          objects.set(key, { bytes: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes, options });
        },
        async get(key) { const value = objects.get(key); return value && { size: value.bytes.byteLength, customMetadata: value.options.customMetadata,
          arrayBuffer: async () => fault === 'corruption' ? new Uint8Array([1]).buffer : value.bytes.buffer }; },
      } };
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push(url);
      if (url === 'https://download.example/export') {
        assert.equal(options, undefined, 'never forward API credentials to download');
        return new Response('CREATE TABLE example(id INTEGER);', { status: fault === 'download' ? 503 : 200 });
      }
      const body = JSON.parse(options.body);
      assert.equal(body.output_format, 'polling');
      return Response.json({ success: true, result: body.current_bookmark
        ? { at_bookmark: 'bookmark', status: 'complete', result: { signed_url: 'https://download.example/export' } }
        : { at_bookmark: 'bookmark' } });
    });
    const step = { async do(name, options, callback) { steps.push(name); return (callback ?? options)(); } };
    const workflow = new D1BackupWorkflow({}, env);
    const run = workflow.run({ timestamp: new Date('2026-09-21T08:00:00Z') }, step);
    if (fault === 'none') { const result = await run; assert.equal(result.status, 'PASS'); assert.equal(result.bookmark, 'bookmark'); assert.equal(result.size_bytes, 33); }
    else { await assert.rejects(run); if (fault === 'target') assert.equal(calls.length, 0); else assert.ok(steps.includes('store failed backup manifest')); }
    const manifests = [...objects.entries()].filter(([key]) => key.endsWith('.json')).map(([, value]) => JSON.parse(new TextDecoder().decode(value.bytes)));
    assert.equal(manifests.length, fault === 'target' ? 0 : 1);
    if (manifests.length) assert.equal(manifests[0].status, fault === 'none' ? 'PASS' : 'FAIL');
    assert.ok(!JSON.stringify(manifests).includes('test-secret'));
  });
});
