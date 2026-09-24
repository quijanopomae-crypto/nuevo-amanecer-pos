// Run from repository root: node --test tools/cloudflare-lab/test/d1-canonical-local.test.mjs
// Private inputs are mandatory. No Wrangler config, remote database, POS, or evidence is used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery as splitSQL } from 'wrangler';
import { buildManifest, normalizeBackup, normalizeWorkbook, quarantineA4TestTransactions, stableStringify } from '../src/a5-import-core.js';
import { readWorkbookSheets } from '../src/a5-workbook.js';
import { A6_API_CONTRACT } from '../src/a6-canonical.js';
import { a6PolicyHash } from '../src/a6-mapping.js';

const LAB = fileURLToPath(new URL('../', import.meta.url));
const TEMP = 'C:\\Users\\ELISER~1\\AppData\\Local\\Temp\\opencode';
const TABLES = ['products', 'customers', 'credits', 'credit_payments'];
const KEYS = ['product_id', 'customer_id', 'credit_id', 'payment_id'];
const TRAFFIC = ['sales', 'sale_items', 'cash_movements', 'inventory_movements', 'sync_operations'];
const EXPECTED = Object.freeze({ products: 408, customers: 31, credits: 313, credit_payments: 131,
  sales: 0, sale_items: 0, cash_movements: 0, inventory_movements: 0, expenses: 0, cash_closures: 0,
  credit_amount_cents: 2968150, credit_paid_cents: 864462, credit_balance_cents: 2103688,
  payment_amount_cents: 864462, sales_total_cents: 0, known_payment_dates: 73, unknown_payment_dates: 58 });
const APPROVED_ID = 'a5-mery43250-2026-09-20-v3';
const SOURCE_HASH = '50f73791a6762fbb38357fa0e09de74ef39bcc4fb07fc9ab7a10e941bb482589';
const MANIFEST_HASH = '6b3ee021113fc960c5bd8b0663160a037fa9acc106b7745eed4e7e64485b7cde';
const SOURCES = [
  { name: 'ef4fc9a1-7a5e-4f12-a539-7dfe17ebf2bc.json', type: 'POS_JSON', sha256: '51229f1c1b37ab28a6865ac9935450207a56d5f3a48073c75b9527c5b68e7d8f', bytes: 332160 },
  { name: 'creditos_clientes_corregido_saldo_298_mery43250_2026-09-20.xlsx', type: 'CLIENT_CREDIT_XLSX', sha256: 'cba956295eb2f59eee82eb5551c02b58731bda9ae8756b0e3017c86bf6ae7e39', bytes: 62751 },
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = name => `"${name.replaceAll('"', '""')}"`;
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const control = db => first(db, 'SELECT * FROM canonical_control WHERE id=1');

async function checked(response, status, label) {
  const value = await response.json();
  // Never include source payloads, customer records, or credentials in failure output.
  assert.equal(response.status, status, `${label}: ${JSON.stringify({ error: value.error, message: value.message, details: value.details })}`);
  return value;
}

async function baseline() {
  const bytes = await Promise.all(SOURCES.map(source => readFile(join(LAB, 'private', 'a5-inputs', source.name))));
  for (let i = 0; i < SOURCES.length; i++) {
    assert.equal(sha(bytes[i]), SOURCES[i].sha256, `private source hash ${i}`);
    assert.equal(bytes[i].length, SOURCES[i].bytes, `private source size ${i}`);
  }
  const document = JSON.parse(bytes[0]);
  if (document.integrity != null) {
    assert.equal(document.integrity.algorithm, 'SHA-256');
    assert.equal(document.integrity.scope, 'payload-json');
    assert.equal(sha(JSON.stringify(document.payload)), document.integrity.value);
  }
  const rawRows = [...normalizeBackup(document, SOURCES[0].name), ...normalizeWorkbook(await readWorkbookSheets(bytes[1]), SOURCES[1].name)];
  const quarantine = quarantineA4TestTransactions(rawRows, SOURCES);
  const manifest = await buildManifest({ importId: APPROVED_ID, sources: SOURCES, ...quarantine });
  assert.equal(manifest.source_hash, SOURCE_HASH);
  assert.equal(manifest.manifest_hash, MANIFEST_HASH);
  assert.equal(manifest.transform_version, 'a5-v2-date-fidelity-a4-quarantine-v1');
  assert.equal(manifest.import_id, APPROVED_ID);
  assert.equal(manifest.rows.length, 883);
  assert.equal(manifest.report.verdict, 'PASS');
  assert.equal(manifest.report.issue_count, 0);
  for (const type of TABLES) assert.equal(manifest.report.counts[type], EXPECTED[type], type);
  for (const [key, amount] of Object.entries(manifest.report.amounts)) assert.equal(amount, EXPECTED[key], key);
  for (const type of ['sales', 'cash_movements', 'inventory_movements']) assert.equal(manifest.report.counts[type], 0);
  const payments = manifest.rows.filter(row => row.entity_type === 'credit_payments');
  assert.equal(payments.filter(row => row.payload.fecha_conocida).length, 73);
  assert.equal(payments.filter(row => !row.payload.fecha_conocida).length, 58);
  return manifest;
}

// Logical backup of every application table, plus the exact schema. Cloudflare's
// own _cf_* and sqlite_* implementation tables are not application state.
async function exportDatabase(db) {
  const schema = await all(db, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY type,name");
  const tables = {};
  for (const entry of schema.filter(row => row.type === 'table')) {
    tables[entry.name] = (await all(db, `SELECT * FROM ${quote(entry.name)}`))
      .sort((a, b) => { const x = stableStringify(a), y = stableStringify(b); return x < y ? -1 : x > y ? 1 : 0; });
  }
  return { format: 'a6-local-logical-d1-v1', schema, tables };
}

async function persistExport(db, root, name) {
  const snapshot = await exportDatabase(db);
  const bytes = Buffer.from(stableStringify(snapshot));
  const path = join(root, name);
  await writeFile(path, bytes, { flag: 'wx' });
  assert.equal(sha(await readFile(path)), sha(bytes));
  return { snapshot, hash: sha(bytes), path };
}

async function applyMigrations(db, migrations) {
  for (const migration of migrations) {
    const statements = splitSQL(migration.sql).filter(sql => sql.trim());
    assert.ok(statements.length, migration.name);
    // A single real D1 transaction per migration, including trigger bodies.
    await db.batch(statements.map(sql => db.prepare(sql)));
  }
}

async function noTraffic(db) {
  for (const table of [...TRAFFIC, 'canonical_assertions']) assert.equal((await first(db, `SELECT COUNT(*) n FROM ${table}`)).n, 0, table);
  assert.equal((await control(db)).first_live_operation_id, null);
  assert.deepEqual(await all(db, 'PRAGMA foreign_key_check'), []);
}

// The wrapper never implements storage or invents meta.changes. Bound statements
// are unwrapped before passing to Miniflare's real workerd D1 proxy.
function injectBatch(db, kind, action) {
  let fired = 0;
  let durableCommit = false;
  const observed = [];
  const statements = new WeakMap();
  const wrap = (sql, actual) => {
    const wrapper = { bind: (...values) => wrap(sql, actual.bind(...values)) };
    for (const method of ['first', 'all', 'run', 'raw']) wrapper[method] = (...args) => actual[method](...args);
    statements.set(wrapper, { sql, actual });
    return wrapper;
  };
  const binding = {
    prepare: sql => wrap(sql, db.prepare(sql)),
    async batch(batch) {
      const entries = batch.map(statement => statements.get(statement));
      assert.ok(entries.every(Boolean), 'only real D1 statements may be batched');
      const actual = entries.map(entry => entry.actual);
      const phase = entries.some(entry => entry.sql.includes("SET status='COMMITTED'")) ? 'publish'
        : entries.some(entry => /^INSERT INTO (products|customers|credits|credit_payments)\(/.test(entry.sql)) ? 'prepare'
        : entries.some(entry => entry.sql.includes("'rollback'")) ? 'rollback'
        : entries.some(entry => entry.sql.includes("'freeze'")) ? 'freeze' : 'other';
      if (phase !== kind || fired) return db.batch(actual);
      fired++;
      if (action === 'observe') {
        try {
          const results = await db.batch(actual);
          observed.push({ phase, changes: results.map(result => result.meta?.changes), success: results.map(result => result.success) });
          return results;
        } catch (error) {
          observed.push({ phase, error: error.message });
          throw error;
        }
      }
      if (action === 'sql-failure') {
        // Last statement fails after all legitimate mutations, exercising rollback.
        actual.push(db.prepare("INSERT INTO canonical_assertions(assertion_id,ok) VALUES('local-injected-failure',0)"));
        return db.batch(actual);
      }
      const result = await db.batch(actual);
      durableCommit = true;
      assert.ok(result.every(entry => entry.success));
      throw new Error('LOCAL_TEST_ACK_LOST_AFTER_DURABLE_D1_COMMIT');
    },
  };
  return { binding, observed, get fired() { return fired; }, get durableCommit() { return durableCommit; } };
}

test('REAL local workerd/D1: exact private A5 baseline, canonical generations and recovery', { timeout: 600000 }, async t => {
  assert.ok((await stat(TEMP)).isDirectory(), 'approved TEMP parent must already exist');
  const root = await mkdtemp(join(TEMP, 'a6-d1-canonical-'));
  const instances = [];
  let auditDb;
  const metrics = { namespace: root, local_only: true, operator: 'explicit-local-test:node-test:d1-canonical-local', tests: {} };
  t.diagnostic(`Retained private local namespace: ${root}`);
  t.after(async () => {
    try {
      if (auditDb) {
        const saved = await persistExport(auditDb, root, 'retained-state.json');
        metrics.retained_state_hash = saved.hash;
        metrics.retained_control = saved.snapshot.tables.canonical_control?.[0] ?? null;
        metrics.retained_table_counts = Object.fromEntries(Object.entries(saved.snapshot.tables).map(([table, rows]) => [table, rows.length]));
      }
    } finally {
      await Promise.all(instances.map(instance => instance.dispose()));
      await writeFile(join(root, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`, { flag: 'wx' });
      t.diagnostic(JSON.stringify(metrics));
    }
  });
  const step = async (name, run) => {
    let failure;
    await t.test(name, async () => {
      try { await run(); metrics.tests[name] = 'PASS'; }
      catch (error) { failure = error; metrics.tests[name] = `FAIL: ${error.message}`; throw error; }
    });
    if (failure) throw new Error(`Required local gate failed: ${name}`, { cause: failure });
  };
  let approved;
  await step('private bytes reproduce supplied A5 hashes, counts, amounts and dates', async () => {
    approved = await baseline();
    Object.assign(metrics, { import_id: approved.import_id, source_hash: approved.source_hash, manifest_hash: approved.manifest_hash, transform_version: approved.transform_version });
  });
  const migrationNames = (await readdir(join(LAB, 'migrations'))).filter(name => /^000[1-7]_.*\.sql$/.test(name)).sort();
  assert.equal(migrationNames.length, 7);
  const migrations = await Promise.all(migrationNames.map(async name => ({ name, sql: await readFile(join(LAB, 'migrations', name), 'utf8') })));
  const buildOptions = { entryPoints: [join(LAB, 'src', 'worker.js')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent', absWorkingDir: LAB };
  const bundle = (await build(buildOptions)).outputFiles[0].contents;
  const bundlePath = join(root, 'worker-bundle.mjs');
  await writeFile(bundlePath, bundle, { flag: 'wx' });
  metrics.worker_hash = sha(bundle);
  metrics.client_hash = sha(await readFile(fileURLToPath(import.meta.url)));
  metrics.migration_hashes = Object.fromEntries(migrations.map(m => [m.name, sha(m.sql)]));
  const nodeWorker = (await import(pathToFileURL(bundlePath).href)).default;
  let outboundAttempts = 0;
  const withBindings = (options, bindings) => ({ ...options, workers: options.workers.map(worker => ({ ...worker,
    config: { ...worker.config, env: { nuevo_amanecer_lab: worker.config.env.nuevo_amanecer_lab,
      ...Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, { type: 'text', value }])) } } })) });
  const makeInstance = async (label, bindings = {}) => {
    const persist = await mkdtemp(join(root, `${label}-`));
    const databaseId = randomUUID();
    const options = withBindings({ host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
      resourcePersistencePath: persist, isolatedResourcePersistencePath: persist, resourceTmpPath: join(persist, 'tmp'),
      unsafeDevRegistryPath: join(persist, 'registry'), workers: [{ config: { name: 'a6-local-test', type: 'worker', compatibilityDate: '2026-09-01',
        manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: Buffer.from(bundle).toString('utf8') } } },
        env: { nuevo_amanecer_lab: { type: 'd1', id: databaseId, dev: { remote: false } } } },
      dev: { rootPath: persist, unsafeRegisterWorker: false, outboundService: { type: 'fetcher', handler: () => {
        outboundAttempts++; throw new Error('No outbound network allowed in local D1 test');
      } } } }] }, bindings);
    const mf = new Miniflare(options);
    instances.push(mf);
    return { mf, options, persist, databaseId, db: await mf.getD1Database('nuevo_amanecer_lab') };
  };
  const f = await makeInstance('primary');
  metrics.local_database_id = f.databaseId;
  metrics.persistence = f.persist;
  let db = f.db;
  auditDb = db;
  await step('empty namespace applies migrations 0001..0007 with real D1 FK enforcement', async () => {
    assert.equal((await all(db, "SELECT name FROM sqlite_master WHERE name='devices'")).length, 0);
    await applyMigrations(db, migrations);
    assert.equal((await first(db, 'PRAGMA foreign_keys')).foreign_keys, 1);
    assert.equal((await control(db)).mode, 'LEGACY');
    const health = await checked(await f.mf.dispatchFetch('http://localhost/health'), 200, 'workerd health');
    assert.equal(health.d1, 'ok');
    const probe = await db.prepare('SELECT 1 one').all();
    assert.match(probe.meta.served_by, /miniflare/i);
    metrics.d1_served_by = probe.meta.served_by;
    await assert.rejects(db.prepare("INSERT INTO sale_items(sale_id,line_number,operation_id,product_id,quantity,unit_price_cents,line_total_cents,created_at) VALUES('missing',1,'fk-check','missing',1,1,1,'2026-09-19')").run(), /FOREIGN KEY/i);
    await noTraffic(db);
  });
  await step('upgrade from populated 0001..0005 preserves legacy rows and FK', async () => {
    const upgrade = await makeInstance('upgrade');
    await applyMigrations(upgrade.db, migrations.slice(0, 5));
    const payload = '{"fixture":"synthetic-upgrade-only"}';
    await upgrade.db.prepare('INSERT INTO sync_operations(operation_id,device_id,device_sequence,entity_type,entity_id,payload,payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind('upgrade-synthetic', 'upgrade-device', 1, 'sales', 'upgrade-sale', payload, sha(payload), '2026-09-19T00:00:00Z').run();
    const before = await all(upgrade.db, 'SELECT * FROM sync_operations');
    await applyMigrations(upgrade.db, migrations.slice(5));
    assert.deepEqual(await all(upgrade.db, 'SELECT * FROM sync_operations'), before);
    assert.equal((await control(upgrade.db)).mode, 'LEGACY');
    assert.deepEqual(await all(upgrade.db, 'PRAGMA foreign_key_check'), []);
  });
  await step('empty migration reapply is idempotent on real D1', async () => {
    const before = await exportDatabase(db);
    await applyMigrations(db, migrations);
    assert.equal(sha(stableStringify(await exportDatabase(db))), sha(stableStringify(before)));
  });

  const credential = randomBytes(32).toString('hex');
  const env = { DEVICE_CREDENTIAL_PEPPER: randomBytes(32).toString('hex'), READ_TOKEN: randomBytes(32).toString('hex'),
    A6_LOCAL_GATE: A6_API_CONTRACT.env.A6_LOCAL_GATE, A6_LOCAL_DATABASE_ID: f.databaseId };
  const writer = { 'x-device-id': 'a6-local-writer', 'x-sync-token': credential };
  await db.prepare("INSERT INTO devices(device_id,role,status,credential_hash) VALUES(?,'writer','active',?)")
    .bind(writer['x-device-id'], createHmac('sha256', env.DEVICE_CREDENTIAL_PEPPER).update(credential).digest('hex')).run();
  const configure = async () => {
    await f.mf.setOptions(withBindings(f.options, env));
    db = await f.mf.getD1Database('nuevo_amanecer_lab');
    auditDb = db;
  };
  await configure();
  const request = (path, body, headers = writer) => new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const send = (path, body, headers) => {
    const req = request(path, body, headers);
    return f.mf.dispatchFetch(req.url, { method: req.method, headers: req.headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  const read = path => send(path, undefined, {});
  const nodeSend = (path, body, binding) => nodeWorker.fetch(request(path, body), { ...env, nuevo_amanecer_lab: binding });

  // This is NOT a second approved source: a materialized, clearly labelled JSON
  // derivative of the exact normalized rows, with its own genuine byte digest.
  const syntheticBytes = Buffer.from(stableStringify({ label: 'SYNTHETIC GENERATION ONLY; derived from approved A5 normalized rows', rows: approved.rows.map(({ entity_type, source_key, source_name, source_row, payload }) => ({ entity_type, source_key, source_name, source_row, payload })) }));
  await writeFile(join(root, 'synthetic-generation.json'), syntheticBytes, { flag: 'wx' });
  const synthetic = await buildManifest({ importId: 'a6-local-synthetic-generation',
    sources: [{ name: 'synthetic-generation.json', type: 'POS_JSON', sha256: sha(syntheticBytes), bytes: syntheticBytes.length }],
    rows: approved.rows.map(({ entity_type, source_key, source_name, source_row, payload }) => ({ entity_type, source_key, source_name, source_row, payload })) });
  assert.notEqual(synthetic.source_hash, approved.source_hash);
  assert.equal(synthetic.manifest_hash, approved.manifest_hash);
  await step('workerd stages both 883-row generations before freeze; approved retry is idempotent', async () => {
    assert.equal((await first(db, "SELECT COUNT(*) n FROM devices WHERE role='writer' AND status='active'")).n, 1);
    for (const manifest of [synthetic, approved]) {
      const base = { import_id: manifest.import_id };
      const relevantState = async () => ({
        import_run: await first(db, 'SELECT * FROM import_runs WHERE import_id=?', APPROVED_ID),
        import_staging: await all(db, 'SELECT * FROM import_staging WHERE import_id=? ORDER BY entity_type,source_name,source_row,source_key', APPROVED_ID),
        import_issues: await all(db, 'SELECT * FROM import_issues ORDER BY import_id,issue_number'),
        canonical: Object.fromEntries(await Promise.all(TABLES.map(async table => [table, await all(db, `SELECT * FROM ${table} ORDER BY promotion_id,${KEYS[TABLES.indexOf(table)]}`)]))),
        canonical_control: await all(db, 'SELECT * FROM canonical_control ORDER BY id'),
        canonical_promotions: await all(db, 'SELECT * FROM canonical_promotions ORDER BY promotion_id'),
        canonical_command_receipts: await all(db, 'SELECT * FROM canonical_command_receipts ORDER BY operation_id'),
        canonical_assertions: await all(db, 'SELECT * FROM canonical_assertions ORDER BY assertion_id'),
        financial_traffic: Object.fromEntries(await Promise.all(TRAFFIC.map(async table => [table, await all(db, `SELECT * FROM ${table}`)]))),
        devices: (await all(db, 'SELECT * FROM devices ORDER BY device_id')).map(({ last_seen_at, ...stable }) => stable),
      });
      const start = { ...base, action: 'start', source_hash: manifest.source_hash, manifest_hash: manifest.manifest_hash,
        transform_version: manifest.transform_version, source_files: manifest.sources.length, sources: manifest.sources, row_count: manifest.rows.length, report_json: JSON.stringify(manifest.report) };
      await checked(await send('/commands/import.stage', start), 201, 'stage start');
      for (let i = 0; i < manifest.rows.length; i += 50) {
        const rows = manifest.rows.slice(i, i + 50);
        const result = await checked(await send('/commands/import.stage', { ...base, action: 'rows', rows }), 200, `stage rows ${i}`);
        assert.equal(result.accepted, rows.length);
        if (manifest === approved) {
          const revision = (await first(db, 'SELECT revision FROM import_runs WHERE import_id=?', manifest.import_id)).revision;
          const replay = await checked(await send('/commands/import.stage', { ...base, action: 'rows', rows }), 200, `stage rows retry ${i}`);
          assert.equal(replay.accepted, rows.length);
          assert.equal((await first(db, 'SELECT revision FROM import_runs WHERE import_id=?', manifest.import_id)).revision, revision);
        }
      }
      if (manifest === approved) {
        const beforeConflict = await relevantState();
        assert.equal(beforeConflict.import_staging.length, 883);
        for (const rows of Object.values(beforeConflict.financial_traffic)) assert.equal(rows.length, 0);
        assert.equal((await checked(await send('/commands/import.stage', { ...start, manifest_hash: 'f'.repeat(64) }), 409, 'stage identity conflict')).error, 'import_id_conflict');
        assert.deepEqual(await relevantState(), beforeConflict);
        const replay = await checked(await send('/commands/import.stage', start), 200, 'stage start retry');
        assert.deepEqual(replay, { status: 'STAGING', import_id: APPROVED_ID, idempotent: true });
      }
      const result = await checked(await send('/commands/import.stage', { ...base, action: 'finish', manifest_hash: manifest.manifest_hash, verdict: 'PASS', issue_count: 0 }), 200, 'stage finish');
      assert.equal(result.status, 'PASS');
      assert.equal(result.row_count, 883);
      assert.equal((await first(db, 'SELECT revision FROM import_runs WHERE import_id=?', manifest.import_id)).revision, 883);
      if (manifest === approved) {
        const beforeRetry = await relevantState();
        const replay = await checked(await send('/commands/import.stage', { ...base, action: 'finish', manifest_hash: manifest.manifest_hash, verdict: 'PASS', issue_count: 0 }), 200, 'stage finish retry');
        assert.deepEqual(replay, { status: 'PASS', import_id: APPROVED_ID, idempotent: true, reconciliation: 'PASS' });
        assert.deepEqual(await relevantState(), beforeRetry);
        assert.equal((await first(db, 'SELECT COUNT(*) n FROM import_runs WHERE import_id=?', APPROVED_ID)).n, 1);
        assert.equal((await first(db, 'SELECT COUNT(*) n FROM import_staging WHERE import_id=?', APPROVED_ID)).n, 883);
        metrics.staging_idempotence = { start: 'PASS', row_batches: 'PASS', finish: 'PASS', conflict_no_mutation: 'PASS', rows: 883, revision: 883 };
      }
    }
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM import_staging')).n, 1766);
    await noTraffic(db);
  });
  const backup = await persistExport(db, root, 'prefreeze-backup.json');
  metrics.backup_hash = backup.hash;
  const selectRun = async manifest => {
    const operational = { environment: 'local', database_id: f.databaseId, worker_hash: metrics.worker_hash, client_hash: metrics.client_hash,
      operator: metrics.operator, backup_hash: backup.hash,
      run: { import_id: manifest.import_id, source_hash: manifest.source_hash, manifest_hash: manifest.manifest_hash, transform_version: manifest.transform_version,
        staging_revision: (await first(db, 'SELECT revision FROM import_runs WHERE import_id=?', manifest.import_id)).revision },
      mapping_version: A6_API_CONTRACT.env.A6_OPERATIONAL_MANIFEST.mapping_version, schema_version: A6_API_CONTRACT.env.A6_OPERATIONAL_MANIFEST.schema_version,
      policy_hash: await a6PolicyHash(), expected: EXPECTED, local_pending_count: 0, local_delta_count: 0 };
    env.A6_OPERATIONAL_MANIFEST = JSON.stringify(operational);
    await writeFile(join(root, `${manifest === approved ? 'approved' : 'synthetic'}-operational-manifest.json`), env.A6_OPERATIONAL_MANIFEST, { flag: 'wx' });
    await configure();
    return { operation_id: `promote-${manifest.import_id}`, promotion_id: `promotion-${manifest.import_id}`, import_id: manifest.import_id,
      expected_source_hash: manifest.source_hash, expected_manifest_hash: manifest.manifest_hash, expected_transform_version: manifest.transform_version,
      expected_staging_revision: operational.run.staging_revision, mapping_version: operational.mapping_version, schema_version: operational.schema_version,
      policy_hash: operational.policy_hash, expected_control_revision: (await control(db)).revision };
  };
  let syntheticRequest = await selectRun(synthetic);
  const freezeRequest = { operation_id: 'local-freeze', expected_control_revision: (await control(db)).revision };
  await step('freeze SQL failure rolls back control and receipt; lost ACK replays durable freeze', async () => {
    const before = await control(db);
    const failure = injectBatch(db, 'freeze', 'sql-failure');
    assert.equal((await checked(await nodeSend('/commands/canonical.freeze', freezeRequest, failure.binding), 409, 'freeze injected failure')).error, 'freeze_conflict');
    assert.equal(failure.fired, 1);
    assert.deepEqual(await control(db), before);
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM canonical_command_receipts')).n, 0);
    const lost = injectBatch(db, 'freeze', 'lost-ack');
    const result = await checked(await nodeSend('/commands/canonical.freeze', freezeRequest, lost.binding), 200, 'freeze lost ACK');
    assert.equal(lost.fired, 1);
    assert.equal(lost.durableCommit, true);
    assert.equal(result.status, 'FROZEN');
    assert.deepEqual(await checked(await send('/commands/canonical.freeze', freezeRequest), 200, 'freeze workerd retry'), result);
    syntheticRequest.expected_control_revision = (await control(db)).revision;
    await noTraffic(db);
  });
  const fence = async () => {
    const payload = '{"synthetic":"must-not-write"}';
    const sale = { operation_id: 'fenced-sale', device_id: writer['x-device-id'], sale_id: 'fenced-sale', created_at: '2026-09-19T00:00:00Z', payment_method: 'efectivo', total_cents: 100,
      items: [{ product_id: approved.rows.find(row => row.entity_type === 'products').source_key, quantity: 1, unit_price_cents: 100, line_total_cents: 100, inventory_quantity: 1 }] };
    const sync = { operation_id: 'fenced-sync', device_id: writer['x-device-id'], device_sequence: 1, entity_type: 'sales', entity_id: 'fenced-sale', payload, payload_hash: sha(payload), created_at: sale.created_at };
    for (const [path, body] of [['/commands/sale.create', sale], ['/sync/operations', sync], ['/commands/import.stage', { import_id: approved.import_id, action: 'finish' }]]) {
      assert.equal((await checked(await send(path, body), 409, `fenced ${path}`)).error, 'authority_frozen');
    }
    await assert.rejects(db.prepare('INSERT INTO sync_operations(operation_id,device_id,device_sequence,entity_type,entity_id,payload,payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(sync.operation_id, sync.device_id, 1, sync.entity_type, sync.entity_id, payload, sync.payload_hash, sync.created_at).run(), /authority_frozen/);
    await noTraffic(db);
  };
  await step('freeze fences stale sale.create, sync and staging at HTTP and SQL', fence);
  await step('prepare SQL failure is atomic and candidate remains invisible', async () => {
    const injected = injectBatch(db, 'prepare', 'sql-failure');
    assert.equal((await checked(await nodeSend('/commands/import.promote', { ...syntheticRequest, phase: 'prepare' }, injected.binding), 409, 'prepare injected SQL')).error, 'promotion_prepare_conflict');
    assert.equal(injected.fired, 1);
    for (const table of TABLES) assert.equal((await first(db, `SELECT COUNT(*) n FROM ${table}`)).n, 0);
    assert.equal((await first(db, 'SELECT candidate_revision FROM canonical_promotions')).candidate_revision, 0);
    assert.equal((await checked(await read('/read/canonical/status'), 409, 'invisible failed candidate')).error, 'canonical_not_published');
    await noTraffic(db);
  });
  // Reconciliation failures are data blockers, not successful fault injections.
  // Collect both generations through the real Worker, then keep the GO gate red.
  const captureReconciliationBlocker = async (promotionRequest, manifest, response, label) => {
    const body = await response.json();
    const diagnostic = { label, expected_publish_status: 201, observed_publish_status: response.status,
      error: body.error, response_details: Object.fromEntries(['field', 'expected', 'actual']
        .filter(key => body.details?.[key] !== undefined).map(key => [key, body.details[key]])) };
    metrics.reconciliation_blockers ??= [];
    metrics.reconciliation_blockers.push(diagnostic);
    metrics.go = 'FAIL';
    assert.equal(response.status, 409, `${label}: fail-closed response`);
    assert.equal(body.error, 'canonical_reconciliation_failed');
    const promotion = await first(db, 'SELECT promotion_id,status,candidate_revision,sealed_revision,canonical_digest,result_json,source_hash,manifest_hash FROM canonical_promotions WHERE promotion_id=?', promotionRequest.promotion_id);
    Object.assign(diagnostic, promotion);
    assert.equal(promotion.status, 'PREPARED');
    assert.equal(promotion.candidate_revision, 883);
    for (const field of ['sealed_revision', 'canonical_digest', 'result_json']) assert.equal(promotion[field], null);
    assert.equal(promotion.source_hash, manifest.source_hash);
    assert.equal(promotion.manifest_hash, manifest.manifest_hash);
    const beforeControl = await control(db);
    diagnostic.control_before_rollback = beforeControl;
    assert.equal(beforeControl.mode, 'FROZEN');
    assert.equal(beforeControl.active_promotion_id, null);
    await noTraffic(db);
    const rowsByTable = {};
    for (const table of TABLES) rowsByTable[table] = await all(db, `SELECT * FROM ${table} WHERE promotion_id=? ORDER BY source_name,source_row,source_key`, promotionRequest.promotion_id);
    diagnostic.counts = Object.fromEntries(TABLES.map(table => [table, rowsByTable[table].length]));
    assert.deepEqual(diagnostic.counts, Object.fromEntries(TABLES.map(table => [table, EXPECTED[table]])));
    diagnostic.amounts = await first(db, 'SELECT SUM(original_amount_cents) credit_amount_cents,SUM(import_paid_cents) credit_paid_cents,SUM(opening_balance_cents) credit_balance_cents FROM credits WHERE promotion_id=?', promotionRequest.promotion_id);
    diagnostic.amounts.payment_amount_cents = (await first(db, 'SELECT SUM(amount_cents) amount FROM credit_payments WHERE promotion_id=?', promotionRequest.promotion_id)).amount;
    for (const [key, value] of Object.entries(diagnostic.amounts)) assert.equal(value, EXPECTED[key], key);
    let known = 0, unknown = 0, sourceBytes = 0;
    for (const table of TABLES) for (const row of rowsByTable[table]) {
      const source = manifest.rows.find(candidate => candidate.entity_type === table && candidate.source_name === row.source_name && candidate.source_row === row.source_row && candidate.source_key === row.source_key);
      assert.ok(source, `${label}: exact source identity`);
      assert.equal(Buffer.compare(Buffer.from(row.source_payload_json), Buffer.from(source.payload_json)), 0, `${table}: retained source bytes`);
      assert.equal(row.source_payload_hash, source.payload_hash);
      sourceBytes++;
      const payload = JSON.parse(source.payload_json);
      if (table === 'products') {
        assert.equal(row.opening_stock_quantity, payload.stock ?? null);
        assert.equal(row.current_stock_quantity, payload.stock ?? null);
        assert.equal(row.stock_revision, 0);
      }
      if (table === 'credit_payments') {
        assert.equal(row.payment_date_known, payload.fecha_conocida ? 1 : 0);
        assert.equal(row.payment_date, payload.fecha);
        if (payload.fecha_conocida) {
          known++;
          const original = payload['Fecha y hora'] ?? payload.Fecha;
          assert.equal(row.payment_timestamp, original?.includes('T') ? original : null);
          assert.equal(row.date_precision, original?.includes('T') ? 'TIMESTAMP' : 'DATE');
        } else {
          unknown++;
          assert.equal(row.payment_date, null);
          assert.equal(row.payment_timestamp, null);
          assert.equal(row.date_precision, 'UNKNOWN');
        }
      }
    }
    assert.equal(sourceBytes, 883); assert.equal(known, 73); assert.equal(unknown, 58);
    diagnostic.date_fidelity = { checked_payments: known + unknown, known_payment_dates: known, unknown_payment_dates: unknown };
    diagnostic.source_payloads_byte_equal = sourceBytes;
    diagnostic.stock_rows_verified = rowsByTable.products.length;
    // Join on business identities internally, but project only amounts and source rows.
    diagnostic.mismatches = [];
    for (const [creditField, customerField] of [
      ['source_customer_image_balance_cents', 'source_image_balance_cents'],
      ['source_customer_document_balance_cents', 'source_document_balance_cents'],
      ['source_customer_difference_cents', 'source_difference_cents'],
    ]) {
      const mismatches = await all(db, `SELECT c.source_row AS credit_source_row,u.source_row AS customer_source_row,
        u.${customerField} AS expected,c.${creditField} AS actual
        FROM credits c JOIN customers u ON u.promotion_id=c.promotion_id AND u.customer_id=c.customer_id
        WHERE c.promotion_id=? AND c.${creditField} IS NOT NULL AND (u.${customerField} IS NULL OR c.${creditField}<>u.${customerField})
        ORDER BY c.source_row,u.source_row`, promotionRequest.promotion_id);
      diagnostic.mismatches.push(...mismatches.map(row => ({ field: creditField, ...row })));
    }
    const rowsDigest = sha(stableStringify(rowsByTable));
    const rollbackBody = { operation_id: `rollback-blocked-${manifest.import_id}`, promotion_id: promotionRequest.promotion_id, expected_control_revision: beforeControl.revision };
    diagnostic.rollback = await checked(await send('/commands/canonical.rollback', rollbackBody), 201, `${label}: rollback PREPARED`);
    assert.equal(diagnostic.rollback.status, 'ROLLED_BACK');
    assert.equal(diagnostic.rollback.write_permission_restored, false);
    const afterPromotion = await first(db, 'SELECT status,candidate_revision,canonical_digest FROM canonical_promotions WHERE promotion_id=?', promotionRequest.promotion_id);
    assert.deepEqual(afterPromotion, { status: 'ABANDONED', candidate_revision: 883, canonical_digest: null });
    const afterRows = {};
    for (const table of TABLES) afterRows[table] = await all(db, `SELECT * FROM ${table} WHERE promotion_id=? ORDER BY source_name,source_row,source_key`, promotionRequest.promotion_id);
    assert.equal(sha(stableStringify(afterRows)), rowsDigest, `${label}: rollback preserves all candidate bytes`);
    diagnostic.state_after_rollback = afterPromotion;
    diagnostic.rows_preserved = Object.values(afterRows).reduce((count, rows) => count + rows.length, 0);
    diagnostic.control_after_rollback = await control(db);
    assert.equal(diagnostic.control_after_rollback.mode, 'FROZEN');
    assert.equal(diagnostic.control_after_rollback.active_promotion_id, null);
    await fence();
    diagnostic.traffic_counts = {};
    for (const table of TRAFFIC) diagnostic.traffic_counts[table] = (await first(db, `SELECT COUNT(*) n FROM ${table}`)).n;
  };
  let syntheticResult;
  await step('synthetic generation prepares all rows in workerd then publishes with durable lost ACK', async () => {
    const response = await send('/commands/import.promote', { ...syntheticRequest, phase: 'prepare' });
    if (response.status !== 200) {
      const observer = injectBatch(db, 'prepare', 'observe');
      const before = await first(db, 'SELECT candidate_revision,status FROM canonical_promotions WHERE promotion_id=?', syntheticRequest.promotion_id);
      const diagnostic = await nodeSend('/commands/import.promote', { ...syntheticRequest, phase: 'prepare' }, observer.binding);
      metrics.prepare_blocker = { before, node_status: diagnostic.status, node_body: await diagnostic.json(), batches: observer.observed,
        after: await first(db, 'SELECT candidate_revision,status FROM canonical_promotions WHERE promotion_id=?', syntheticRequest.promotion_id) };
    }
    const prepared = await checked(response, 200, 'synthetic prepare');
    assert.equal(prepared.prepared_rows, 883);
    assert.equal(prepared.remaining, 0);
    assert.equal((await control(db)).active_promotion_id, null);
    assert.equal((await read('/read/canonical/products')).status, 409);
    const before = await control(db);
    const failed = injectBatch(db, 'publish', 'sql-failure');
    const failedPublish = await nodeSend('/commands/import.promote', { ...syntheticRequest, phase: 'publish' }, failed.binding);
    const failedBody = await failedPublish.clone().json();
    if (failedBody.error === 'canonical_reconciliation_failed') {
      assert.equal(failed.fired, 0, 'reconciliation blocked publication before SQL injection');
      const syntheticPublish = await send('/commands/import.promote', { ...syntheticRequest, phase: 'publish' });
      await captureReconciliationBlocker(syntheticRequest, synthetic, syntheticPublish, 'synthetic derived generation');
      const exactApprovedRequest = await selectRun(approved);
      const preparedApproved = await checked(await send('/commands/import.promote', { ...exactApprovedRequest, phase: 'prepare' }), 200, 'blocked approved prepare');
      assert.equal(preparedApproved.prepared_rows, 883);
      assert.equal(preparedApproved.remaining, 0);
      const approvedPublish = await send('/commands/import.promote', { ...exactApprovedRequest, phase: 'publish' });
      await captureReconciliationBlocker(exactApprovedRequest, approved, approvedPublish, 'exact approved A5 baseline');
      metrics.final_mode = (await control(db)).mode;
      metrics.authority_epoch = (await control(db)).authority_epoch;
      metrics.first_live_operation_id = (await control(db)).first_live_operation_id;
      metrics.promotion_id = exactApprovedRequest.promotion_id;
      metrics.canonical_digest = (await first(db, 'SELECT canonical_digest FROM canonical_promotions WHERE promotion_id=?', exactApprovedRequest.promotion_id)).canonical_digest;
      assert.equal(outboundAttempts, 0);
      assert.equal(sha((await build(buildOptions)).outputFiles[0].contents), metrics.worker_hash, 'SUT changed during diagnostic run');
      assert.equal(sha(await readFile(fileURLToPath(import.meta.url))), metrics.client_hash);
      for (const migration of migrations) assert.equal(sha(await readFile(join(LAB, 'migrations', migration.name), 'utf8')), metrics.migration_hashes[migration.name]);
      for (const source of SOURCES) assert.equal(sha(await readFile(join(LAB, 'private', 'a5-inputs', source.name))), source.sha256);
      assert.fail('GO_FAIL baseline-invariant failure: expected approved publication HTTP 201 COMMITTED; observed HTTP 409 canonical_reconciliation_failed. Both PREPARED candidates rolled back to ABANDONED with all rows retained.');
    }
    assert.equal((await checked(failedPublish, 409, 'publish injected SQL')).error, 'promotion_publish_conflict');
    assert.equal(failed.fired, 1);
    assert.deepEqual(await control(db), before);
    const pending = await first(db, 'SELECT status,sealed_revision,result_json,canonical_digest FROM canonical_promotions WHERE promotion_id=?', syntheticRequest.promotion_id);
    assert.deepEqual(pending, { status: 'PREPARED', sealed_revision: null, result_json: null, canonical_digest: null });
    const lost = injectBatch(db, 'publish', 'lost-ack');
    syntheticResult = await checked(await nodeSend('/commands/import.promote', { ...syntheticRequest, phase: 'publish' }, lost.binding), 200, 'publish lost ACK');
    assert.equal(lost.fired, 1);
    assert.equal(lost.durableCommit, true);
    assert.equal(syntheticResult.status, 'COMMITTED');
    assert.equal(syntheticResult.mode, 'CANONICAL_READ_ONLY');
    assert.deepEqual(await checked(await send('/commands/import.promote', { ...syntheticRequest, phase: 'publish' }), 200, 'synthetic retry'), syntheticResult);
    metrics.synthetic_generation = { label: 'SYNTHETIC ONLY', promotion_id: syntheticRequest.promotion_id, digest: syntheticResult.canonical_digest };
    await noTraffic(db);
  });
  await step('pretraffic rollback SQL failure preserves publication; lost ACK restores FROZEN', async () => {
    const body = { operation_id: 'rollback-synthetic', promotion_id: syntheticRequest.promotion_id, expected_control_revision: (await control(db)).revision };
    const before = await control(db);
    const failed = injectBatch(db, 'rollback', 'sql-failure');
    assert.equal((await checked(await nodeSend('/commands/canonical.rollback', body, failed.binding), 409, 'rollback SQL failure')).error, 'rollback_conflict');
    assert.equal(failed.fired, 1);
    assert.deepEqual(await control(db), before);
    const lost = injectBatch(db, 'rollback', 'lost-ack');
    const result = await checked(await nodeSend('/commands/canonical.rollback', body, lost.binding), 200, 'rollback lost ACK');
    assert.equal(lost.fired, 1);
    assert.equal(lost.durableCommit, true);
    assert.equal(result.mode, 'FROZEN');
    assert.equal(result.active_promotion_id, null);
    assert.equal(result.write_permission_restored, false);
    assert.deepEqual(await checked(await send('/commands/canonical.rollback', body), 200, 'rollback retry'), result);
    assert.equal((await first(db, 'SELECT status FROM canonical_promotions WHERE promotion_id=?', body.promotion_id)).status, 'ABANDONED');
    assert.equal((await read('/read/canonical/status')).status, 409);
    metrics.rollback = result;
    await fence();
  });
  const approvedRequest = await selectRun(approved);
  let approvedResult;
  await step('approved baseline workerd prepare is invisible; publish is canonical_readonly', async () => {
    const prepared = await checked(await send('/commands/import.promote', { ...approvedRequest, phase: 'prepare' }), 200, 'approved prepare');
    assert.equal(prepared.prepared_rows, 883);
    assert.equal(prepared.remaining, 0);
    assert.equal((await control(db)).active_promotion_id, null);
    for (const table of TABLES) assert.equal((await read(`/read/canonical/${table.replaceAll('_', '-')}`)).status, 409);
    approvedResult = await checked(await send('/commands/import.promote', { ...approvedRequest, phase: 'publish' }), 201, 'approved publish in workerd');
    assert.equal(approvedResult.status, 'COMMITTED');
    assert.equal(approvedResult.read_only, true);
    assert.equal(approvedResult.mode, 'CANONICAL_READ_ONLY');
    const c = await control(db);
    assert.equal(c.active_promotion_id, approvedRequest.promotion_id);
    assert.equal(c.first_live_operation_id, null);
    metrics.promotion_id = approvedResult.promotion_id;
    metrics.authority_epoch = approvedResult.authority_epoch;
    metrics.canonical_digest = approvedResult.canonical_digest;
    metrics.counts = approvedResult.counts;
    metrics.amounts = approvedResult.amounts;
    await noTraffic(db);
  });

  const paginate = async (path, admin = false) => {
    const items = [], cursors = new Set();
    let cursor = null;
    do {
      const url = `${path}${path.includes('?') ? '&' : '?'}limit=37${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await checked(await (admin ? send(url) : read(url)), 200, 'paginated read');
      if (!admin) {
        assert.equal(page.promotion_id, approvedRequest.promotion_id);
        assert.equal(page.authority_epoch, approvedResult.authority_epoch);
        assert.equal(page.read_only, true);
      }
      assert.ok(page.items.length <= 37);
      items.push(...page.items);
      cursor = page.next_cursor;
      if (cursor) { assert.ok(!cursors.has(cursor), 'cursor must progress'); cursors.add(cursor); }
    } while (cursor);
    return items;
  };
  await step('all four paginated reads and admin export exactly match 883 source payload bytes', async () => {
    let exported = 0, known = 0, unknown = 0;
    const digests = [], entityDigests = {};
    for (let i = 0; i < TABLES.length; i++) {
      const table = TABLES[i], key = KEYS[i];
      const items = await paginate(`/read/canonical/${table.replaceAll('_', '-')}`);
      assert.equal(items.length, EXPECTED[table], table);
      assert.equal(new Set(items.map(row => row[key])).size, items.length);
      const provenance = await paginate(`/imports/canonical/${approvedRequest.promotion_id}?entity_type=${table}`, true);
      assert.equal(provenance.length, EXPECTED[table]);
      const staged = approved.rows.filter(row => row.entity_type === table);
      const entityRows = [];
      const durable = await all(db, `SELECT * FROM ${table} WHERE promotion_id=? ORDER BY ${key}`, approvedRequest.promotion_id);
      assert.equal(durable.length, items.length);
      for (let j = 0; j < items.length; j++) {
        const item = items[j], stored = durable[j];
        assert.equal(stored[key], item[key]);
        for (const field of Object.keys(item)) assert.equal(stableStringify(item[field]), stableStringify(stored[field]), `${table}.${field}`);
        const source = staged.find(row => row.source_key === stored.source_key && row.source_name === stored.source_name && row.source_row === stored.source_row);
        assert.ok(source, `${table}: exact source identity`);
        const admin = provenance.find(row => row.source_key === source.source_key && row.source_name === source.source_name && row.source_row === source.source_row);
        assert.ok(admin, `${table}: admin bijection`);
        assert.equal(Buffer.compare(Buffer.from(admin.source_payload_json), Buffer.from(source.payload_json)), 0, `${table}: source bytes`);
        assert.equal(admin.source_payload_hash, source.payload_hash);
        assert.equal(sha(admin.source_payload_json), source.payload_hash);
        assert.equal(admin.source_import_id, APPROVED_ID);
        // ExcelJS retains Date objects; compare the exact JSON representation staged in D1.
        const payload = JSON.parse(source.payload_json);
        exported++;
        if (table === 'products') {
          assert.equal(item.opening_stock_quantity, payload.stock ?? null);
          assert.equal(item.current_stock_quantity, payload.stock ?? null);
          assert.equal(item.stock_revision, 0);
        }
        if (table === 'credit_payments') {
          assert.equal(item.payment_date_known, payload.fecha_conocida ? 1 : 0);
          assert.equal(item.payment_date, payload.fecha);
          if (payload.fecha_conocida) {
            known++;
            const original = payload['Fecha y hora'] ?? payload.Fecha;
            assert.equal(item.payment_timestamp, original?.includes('T') ? original : null);
            assert.equal(item.date_precision, original?.includes('T') ? 'TIMESTAMP' : 'DATE');
          } else {
            unknown++;
            assert.equal(item.payment_date, null);
            assert.equal(item.payment_timestamp, null);
            assert.equal(item.date_precision, 'UNKNOWN');
          }
        }
        const digestRow = { entity_type: table, row: { ...item, source_name: stored.source_name, source_row: stored.source_row, source_key: stored.source_key, source_payload_hash: stored.source_payload_hash } };
        entityRows.push(digestRow); digests.push(digestRow);
      }
      entityDigests[table] = sha(stableStringify(entityRows));
    }
    assert.equal(exported, 883);
    assert.equal(known, 73); assert.equal(unknown, 58);
    assert.equal(sha(stableStringify(digests)), approvedResult.canonical_digest);
    assert.deepEqual(entityDigests, approvedResult.entity_digests);
    for (const change of approved.report.exclusions.stock_restorations) {
      const row = await first(db, 'SELECT opening_stock_quantity,current_stock_quantity FROM products WHERE promotion_id=? AND product_id=?', approvedRequest.promotion_id, change.product_id);
      assert.equal(row.opening_stock_quantity, change.to_stock);
      assert.equal(row.current_stock_quantity, change.to_stock);
    }
    const amounts = await first(db, 'SELECT SUM(original_amount_cents) credit_amount_cents,SUM(import_paid_cents) credit_paid_cents,SUM(opening_balance_cents) credit_balance_cents FROM credits WHERE promotion_id=?', approvedRequest.promotion_id);
    for (const [key, value] of Object.entries(amounts)) assert.equal(value, EXPECTED[key]);
    assert.equal((await first(db, 'SELECT SUM(amount_cents) n FROM credit_payments WHERE promotion_id=?', approvedRequest.promotion_id)).n, 864462);
    for (const table of TRAFFIC.filter(table => table !== 'sync_operations')) assert.deepEqual(await paginate(`/read/canonical/${table.replaceAll('_', '-')}`), []);
    Object.assign(metrics, { exported_payloads: exported, known_payment_dates: known, unknown_payment_dates: unknown, stock_restorations: approved.report.exclusions.stock_restorations });
    await noTraffic(db);
  });
  await step('same request and discarded workerd ACK keep one result/digest; competitor conflicts', async () => {
    const body = { ...approvedRequest, phase: 'publish' };
    // Deliberately discard a successful HTTP response, then replay identical bytes.
    const discarded = await send('/commands/import.promote', body);
    assert.equal(discarded.status, 200);
    await discarded.arrayBuffer();
    const before = await control(db);
    assert.deepEqual(await checked(await send('/commands/import.promote', body), 200, 'approved retry'), approvedResult);
    const competitor = { ...body, operation_id: 'competing-operation', promotion_id: 'competing-promotion' };
    await checked(await send('/commands/import.promote', competitor), 409, 'competing promotion');
    await checked(await send('/commands/import.promote', { ...body, promotion_id: 'same-operation-different-promotion' }), 409, 'operation collision');
    assert.deepEqual(await control(db), before);
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM canonical_promotions')).n, 2);
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM canonical_promotions WHERE import_id=?', APPROVED_ID)).n, 1);
    for (let i = 0; i < 3; i++) {
      const table = TABLES[i], key = KEYS[i];
      assert.equal((await first(db, `SELECT COUNT(*) n FROM ${table} a JOIN ${table} b ON a.${key}=b.${key} WHERE a.promotion_id=? AND b.promotion_id=?`, syntheticRequest.promotion_id, approvedRequest.promotion_id)).n, EXPECTED[table]);
    }
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM credit_payments a JOIN credit_payments b ON a.credit_id=b.credit_id AND a.source_payment_id=b.source_payment_id WHERE a.promotion_id=? AND b.promotion_id=?', syntheticRequest.promotion_id, approvedRequest.promotion_id)).n, 131);
    await fence();
  });
  await step('reapplying migrations preserves populated canonical generations', async () => {
    const before = await exportDatabase(db);
    await applyMigrations(db, migrations);
    assert.equal(sha(stableStringify(await exportDatabase(db))), sha(stableStringify(before)));
  });
  await step('complete backup restores only into an independent NEW real D1, preserving all tables and NULLs', async () => {
    const saved = await persistExport(db, root, 'final-backup.json');
    const restore = await makeInstance('restore');
    assert.notEqual(restore.databaseId, f.databaseId);
    assert.notEqual(restore.persist, f.persist);
    assert.equal((await all(restore.db, "SELECT name FROM sqlite_master WHERE name='canonical_control'")).length, 0);
    const snapshot = JSON.parse(await readFile(saved.path, 'utf8'));
    const schemaTables = snapshot.schema.filter(row => row.type === 'table');
    await restore.db.batch(schemaTables.map(row => restore.db.prepare(row.sql)));
    // Restore data BEFORE installing triggers: immutable/frozen triggers must not
    // replay history, increment revisions, or forbid restoring sealed generations.
    // No trigger is removed from an existing database, and FK checks stay enabled.
    const order = ['devices', 'sync_operations', 'sales', 'sale_items', 'inventory_movements', 'cash_movements', 'import_runs', 'import_staging', 'import_issues', 'canonical_promotions', 'canonical_control', 'canonical_command_receipts', 'canonical_assertions', ...TABLES,
      'canonical_write_guards', 'canonical_sale_context', 'live_credits', 'canonical_inventory_effects'];
    assert.deepEqual(Object.keys(snapshot.tables).sort(), [...order].sort(), 'every application table is explicitly restored');
    for (const table of order) {
      const rows = snapshot.tables[table];
      for (let i = 0; i < rows.length; i += 25) {
        const batch = rows.slice(i, i + 25).map(row => {
          const columns = Object.keys(row);
          return restore.db.prepare(`INSERT INTO ${quote(table)}(${columns.map(quote).join(',')}) VALUES(${columns.map(() => '?').join(',')})`).bind(...columns.map(key => row[key]));
        });
        await restore.db.batch(batch);
      }
    }
    await restore.db.batch(snapshot.schema.filter(row => row.type !== 'table').map(row => restore.db.prepare(row.sql)));
    assert.equal((await first(restore.db, 'PRAGMA foreign_keys')).foreign_keys, 1);
    assert.deepEqual(await all(restore.db, 'PRAGMA foreign_key_check'), []);
    const roundtrip = await persistExport(restore.db, root, 'restored-backup.json');
    assert.equal(roundtrip.hash, saved.hash, 'all schemas, generations, staging, receipts and NULLs round-trip byte-identically');
    assert.equal((await control(restore.db)).first_live_operation_id, null);
    assert.equal((await control(restore.db)).active_promotion_id, approvedRequest.promotion_id);
    assert.equal((await first(restore.db, 'SELECT COUNT(*) n FROM credit_payments WHERE payment_timestamp IS NULL AND payment_date IS NULL')).n, 116);
    await assert.rejects(restore.db.prepare('DELETE FROM canonical_command_receipts').run(), /immutable_receipt/);
    await noTraffic(restore.db);
    const restoredEnv = { ...JSON.parse(env.A6_OPERATIONAL_MANIFEST), database_id: restore.databaseId };
    await restore.mf.setOptions(withBindings(restore.options, { ...env, A6_LOCAL_DATABASE_ID: restore.databaseId, A6_OPERATIONAL_MANIFEST: JSON.stringify(restoredEnv) }));
    const status = await checked(await restore.mf.dispatchFetch('http://localhost/read/canonical/status'), 200, 'restored workerd read');
    assert.equal(status.promotion_id, approvedRequest.promotion_id);
    assert.deepEqual(status.counts, Object.fromEntries(TABLES.map(table => [table, EXPECTED[table]])));
    metrics.restore = { database_id: restore.databaseId, namespace: restore.persist, hash: roundtrip.hash, tables: order.length, generations: snapshot.tables.canonical_promotions.length };
    assert.equal(sha(stableStringify(await exportDatabase(db))), saved.hash, 'restore never mutates primary');
  });
  await step('retained primary reopens with approved baseline, no traffic and unchanged SUT bytes', async () => {
    const before = await exportDatabase(db);
    await f.mf.dispose();
    instances.splice(instances.indexOf(f.mf), 1);
    const reopened = new Miniflare(withBindings(f.options, env));
    instances.push(reopened);
    const durable = await reopened.getD1Database('nuevo_amanecer_lab');
    auditDb = durable;
    assert.equal(sha(stableStringify(await exportDatabase(durable))), sha(stableStringify(before)));
    assert.equal((await control(durable)).active_promotion_id, approvedRequest.promotion_id);
    assert.equal((await control(durable)).first_live_operation_id, null);
    await noTraffic(durable);
    assert.equal(outboundAttempts, 0);
    assert.equal(sha((await build(buildOptions)).outputFiles[0].contents), metrics.worker_hash, 'SUT changed during this run; rerun against stable bytes');
    assert.equal(sha(await readFile(fileURLToPath(import.meta.url))), metrics.client_hash);
    for (const migration of migrations) assert.equal(sha(await readFile(join(LAB, 'migrations', migration.name), 'utf8')), metrics.migration_hashes[migration.name]);
    metrics.final_mode = (await control(durable)).mode;
    metrics.first_live_operation_id = (await control(durable)).first_live_operation_id;
    metrics.pending_count = 0;
    metrics.delta_count = 0;
  });
});
