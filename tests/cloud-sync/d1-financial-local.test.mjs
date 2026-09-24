// Run from repository root: node --test tests/cloud-sync/d1-financial-local.test.mjs
// Synthetic-only integration gate. It never reads Wrangler config, private inputs, or remote services.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertedFinancialRows, syntheticManifest } from './a6-fixture.mjs';
import { sha256Hex } from '../../tools/cloudflare-lab/src/a5-import-core.js';
import { A6_MAPPING_VERSION, A6_SCHEMA_VERSION, a6PolicyHash } from '../../tools/cloudflare-lab/src/a6-mapping.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LAB = join(ROOT, 'tools', 'cloudflare-lab');
// The approved reference harness lives under the lab package; this file does not.
// Resolve its existing dependencies from that package without installing anything.
const requireLab = createRequire(new URL('../../tools/cloudflare-lab/package.json', import.meta.url));
const { build } = requireLab('esbuild');
const { Miniflare } = requireLab('miniflare');
const { unstable_splitSqlQuery: splitSQL } = requireLab('wrangler');
const TEMP = 'C:\\Users\\ELISER~1\\AppData\\Local\\Temp\\opencode';
const WRITER_ID = 'd1-financial-synthetic-writer';
const CONTRACT = 'a6-gate-c-v1';
const CREATED_AT = '2026-09-21T12:00:00.000Z';
const CASES = {
  D1F01: ['Fresh isolated D1', '0001..0008 via splitSQL', '8 migrations; FK enabled; real Miniflare D1'],
  D1F02: ['LEGACY, synthetic manifest', 'stage/freeze/prepare/publish; test-only ACTIVE', '28 products, 1 customer, 2 IMPORT credits, 4 historical payments; no LIVE traffic'],
  D1F03: ['ACTIVE, no LIVE operation', 'cash.open 1000 cents; injected marker failure then retry', 'failure rolls back all effects; first LIVE marker and one session on retry'],
  D1F04: ['IMPORT balance 700, revision 0', 'digital payment 100', 'IMPORT balance 600; imported history unchanged'],
  D1F05: ['ACTIVE, customer 000C', 'credit sale 1000 + LIVE payment 250', 'one sale/credit/cash record; LIVE balance 750'],
  D1F06: ['Open till 1000, revision 0', 'adjustment -100; compensate it', '900 then 1000; append-only compensation once'],
  D1F07: ['Committed LIVE payment', 'retry identical opId; same id different amount', '200 replay, 409 operation_id_conflict; no state change'],
  D1F08: ['IMPORT balance 600, revision 1', 'two concurrent requests, distinct ids, same stale revision', 'one 201 and one 409; one event; balance 500, revision 2'],
  D1F09: ['LIVE balance 750, revision 1', 'payment 50; discard HTTP response; retry', 'one effect; exact durable receipt; balance 700'],
  D1F10: ['Open till 1000', 'invalid amounts/body, overpayment and missing credit', '400/409, no durable mutations'],
  D1F11: ['Till 1000, revision 2', 'cash.close counted 1000', 'CLOSED, expected=counted=1000, difference 0; writes to closed till rejected'],
  D1F12: ['Nonempty immutable financial tables', 'direct UPDATE/DELETE/REPLACE and rowid REPLACE', '16 rejected mutations, state unchanged; first marker cannot reset'],
  D1F13: ['Committed financial and sale history', 'dispose Miniflare; create new instance, SAME database id/persist', 'exact state/reads/receipts durable; retries change nothing'],
  D1F14: ['Finished flow', 'FK, guards, counts, network and source checks', 'FK clean, no leaked guards/assertions, zero outbound; SUT unchanged'],
};

const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;

async function checked(response, status, label) {
  const body = await response.json();
  assert.equal(response.status, status, `${label}: ${JSON.stringify({ error: body.error, message: body.message })}`);
  return body;
}

async function apply(db, migrations) {
  for (const migration of migrations) {
    const statements = splitSQL(migration.sql).filter(sql => sql.trim());
    assert.ok(statements.length > 0, migration.name);
    await db.batch(statements.map(sql => db.prepare(sql)));
  }
}

test('REAL local workerd/D1: synthetic canonical financial flow and durable restart', { timeout: 300000 }, async t => {
  assert.ok((await stat(TEMP)).isDirectory(), 'approved TEMP parent must exist');
  const namespace = await mkdtemp(join(TEMP, 'd1-financial-local-'));
  const persist = join(namespace, 'persist');
  const databaseId = randomUUID();
  const credential = randomBytes(32).toString('hex');
  const pepper = randomBytes(32).toString('hex');
  const readToken = randomBytes(32).toString('hex');
  let mf;
  let passed = false;
  let outboundAttempts = 0;
  let activeCase = 'D1F01';
  let phase = 'HARNESS_FAILURE';
  const completed = new Set();
  const record = (id, observed) => {
    const [precondition, input, expected] = CASES[id];
    completed.add(id);
    t.diagnostic(JSON.stringify({ ID: id, environment: 'Node/workerd Miniflare D1 local (not browser)',
      precondition, input, expected, observed, status: 'PASS', evidence: 'HTTP responses + real D1 assertions in this test' }));
  };

  try {
    const migrationNames = Array.from({ length: 8 }, (_, index) => `000${index + 1}`);
    const migrationFiles = await Promise.all(migrationNames.map(async prefix => {
      const names = {
        '0001': '0001_sync_operations.sql', '0002': '0002_read_only_indexes.sql', '0003': '0003_device_auth.sql',
        '0004': '0004_sale_create.sql', '0005': '0005_import_staging.sql', '0006': '0006_canonical_promotion.sql',
        '0007': '0007_canonical_commerce.sql', '0008': '0008_canonical_financial.sql',
      };
      return { name: names[prefix], sql: await readFile(join(LAB, 'migrations', names[prefix]), 'utf8') };
    }));
    const buildOptions = {
      entryPoints: [join(LAB, 'src', 'worker.js')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
      write: false, logLevel: 'silent', absWorkingDir: LAB,
    };
    const bundle = (await build(buildOptions)).outputFiles[0].contents;
    const bundleHash = await sha256Hex(bundle);
    const manifest = await syntheticManifest('d1-financial-synthetic-run', assertedFinancialRows());
    assert.equal(manifest.report.verdict, 'PASS');

    const env = {
      DEVICE_CREDENTIAL_PEPPER: pepper,
      READ_TOKEN: readToken,
      A6_LOCAL_GATE: 'enabled',
      A6_LOCAL_DATABASE_ID: databaseId,
    };
    const options = () => ({
      host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
      resourcePersistencePath: persist, isolatedResourcePersistencePath: persist, resourceTmpPath: join(persist, 'tmp'),
      unsafeDevRegistryPath: join(persist, 'registry'),
      workers: [{
        config: {
          name: 'd1-financial-local-test', type: 'worker', compatibilityDate: '2026-09-01',
          manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: Buffer.from(bundle).toString('utf8') } } },
          env: {
            nuevo_amanecer_lab: { type: 'd1', id: databaseId, dev: { remote: false } },
            ...Object.fromEntries(Object.entries(env).map(([key, value]) => [key, { type: 'text', value }])),
          },
        },
        dev: { rootPath: persist, unsafeRegisterWorker: false, outboundService: { type: 'fetcher', handler: () => {
          outboundAttempts++;
          throw new Error('outbound network forbidden in local D1 test');
        } } },
      }],
    });
    const start = async () => {
      mf = new Miniflare(options());
      return mf.getD1Database('nuevo_amanecer_lab');
    };
    let db = await start();
    phase = 'PRODUCT_FAIL';
    await apply(db, migrationFiles);
    assert.equal((await first(db, 'PRAGMA foreign_keys')).foreign_keys, 1);
    assert.deepEqual(await all(db, 'PRAGMA foreign_key_check'), []);
    assert.equal((await first(db, "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('canonical_financial_operations','canonical_cash_sessions','canonical_cash_closures','canonical_financial_events')")).n, 4);
    const probe = await db.prepare('SELECT 1 one').all();
    assert.match(probe.meta.served_by, /miniflare/i);
    record('D1F01', { migrations: migrationFiles.map(m => m.name), served_by: probe.meta.served_by,
      foreign_keys: (await first(db, 'PRAGMA foreign_keys')).foreign_keys, worker_sha256: bundleHash });

    // In-memory comparison digest only, NOT a backup/export; no credentials in diagnostics.
    const stateTables = ['canonical_control','canonical_promotions','canonical_command_receipts','products','customers','credits','credit_payments',
      'sales','sale_items','cash_movements','inventory_movements','live_credits','canonical_sale_context','canonical_inventory_effects',
      'canonical_financial_operations','canonical_financial_events','canonical_cash_sessions','canonical_cash_closures','canonical_assertions','canonical_write_guards'];
    const fingerprint = async (tables = stateTables) => sha256Hex(JSON.stringify(await Promise.all(tables.map(async table =>
      [table, await all(db, `SELECT * FROM ${table} ORDER BY rowid`)]))));

    activeCase = 'D1F02';
    const writerHeaders = { 'x-device-id': WRITER_ID, 'x-sync-token': credential };
    await db.prepare("INSERT INTO devices(device_id,role,status,credential_hash) VALUES(?,'writer','active',?)")
      .bind(WRITER_ID, createHmac('sha256', pepper).update(credential).digest('hex')).run();
    const post = (path, body) => mf.dispatchFetch(`http://localhost${path}`, {
      method: 'POST', headers: { ...writerHeaders, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const read = path => mf.dispatchFetch(`http://localhost${path}`, { headers: { 'x-read-token': readToken } });

    const base = { import_id: manifest.import_id };
    await checked(await post('/commands/import.stage', { ...base, action: 'start', source_hash: manifest.source_hash,
      manifest_hash: manifest.manifest_hash, transform_version: manifest.transform_version, source_files: manifest.sources.length,
      sources: manifest.sources, row_count: manifest.rows.length, report_json: JSON.stringify(manifest.report) }), 201, 'stage start');
    for (let index = 0; index < manifest.rows.length; index += 50) {
      await checked(await post('/commands/import.stage', { ...base, action: 'rows', rows: manifest.rows.slice(index, index + 50) }), 200, 'stage rows');
    }
    await checked(await post('/commands/import.stage', { ...base, action: 'finish', manifest_hash: manifest.manifest_hash, verdict: 'PASS', issue_count: 0 }), 200, 'stage finish');
    const stagedRevision = (await first(db, 'SELECT revision FROM import_runs WHERE import_id=?', manifest.import_id)).revision;
    const expected = Object.fromEntries(['products','customers','credits','credit_payments','sales','sale_items','cash_movements','inventory_movements','expenses','cash_closures']
      .map(key => [key, manifest.report.counts[key] ?? 0]));
    Object.assign(expected, manifest.report.amounts, {
      known_payment_dates: manifest.rows.filter(row => row.entity_type === 'credit_payments' && row.payload.fecha_conocida).length,
      unknown_payment_dates: manifest.rows.filter(row => row.entity_type === 'credit_payments' && !row.payload.fecha_conocida).length,
    });
    env.A6_OPERATIONAL_MANIFEST = JSON.stringify({
      environment: 'local', database_id: databaseId, worker_hash: await sha256Hex(bundle), client_hash: await sha256Hex('synthetic-local-test-client'),
      operator: 'synthetic-local-test', backup_hash: await sha256Hex('synthetic-required-manifest-field-no-backup-performed'),
      run: { import_id: manifest.import_id, source_hash: manifest.source_hash, manifest_hash: manifest.manifest_hash,
        transform_version: manifest.transform_version, staging_revision: stagedRevision },
      mapping_version: A6_MAPPING_VERSION, schema_version: A6_SCHEMA_VERSION, policy_hash: await a6PolicyHash(), expected,
      local_pending_count: 0, local_delta_count: 0,
    });
    await mf.setOptions(options());
    db = await mf.getD1Database('nuevo_amanecer_lab');
    await checked(await post('/commands/canonical.freeze', { operation_id: 'd1-freeze', expected_control_revision: 0 }), 201, 'freeze');
    const frozen = await first(db, 'SELECT * FROM canonical_control WHERE id=1');
    const promotion = {
      operation_id: 'd1-promote', promotion_id: 'd1-financial-promotion', import_id: manifest.import_id,
      expected_source_hash: manifest.source_hash, expected_manifest_hash: manifest.manifest_hash,
      expected_transform_version: manifest.transform_version, expected_staging_revision: stagedRevision,
      mapping_version: A6_MAPPING_VERSION, schema_version: A6_SCHEMA_VERSION, policy_hash: await a6PolicyHash(),
      expected_control_revision: frozen.revision,
    };
    await checked(await post('/commands/import.promote', { ...promotion, phase: 'prepare' }), 200, 'promote prepare');
    await checked(await post('/commands/import.promote', { ...promotion, phase: 'publish' }), 201, 'promote publish');

    // Explicitly test-only activation. Reapplying 0007+0008 immediately restores every production trigger.
    await db.prepare('DROP TRIGGER canonical_control_no_legacy').run();
    await db.prepare("UPDATE canonical_control SET mode='ACTIVE',revision=revision+1,authority_epoch=authority_epoch+1,minimum_client_contract='a6-gate-c-v1' WHERE id=1").run();
    await apply(db, migrationFiles.slice(6));
    const control = await first(db, 'SELECT * FROM canonical_control WHERE id=1');
    assert.equal(control.mode, 'ACTIVE');
    assert.equal(control.first_live_operation_id, null);
    const imported = await fingerprint(['credits','credit_payments']);
    const counts = {};
    for (const [table, expectedCount] of Object.entries({ products: 28, customers: 1, credits: 2, credit_payments: 4,
      sales: 0, cash_movements: 0, canonical_financial_operations: 0, canonical_financial_events: 0 })) {
      counts[table] = (await first(db, `SELECT COUNT(*) n FROM ${table}`)).n;
      assert.equal(counts[table], expectedCount, table);
    }
    assert.ok((await first(db, "SELECT sql FROM sqlite_master WHERE name='canonical_control_no_legacy'")).sql.includes('canonical_financial_operations'));
    record('D1F02', { mode: control.mode, first_live_operation_id: control.first_live_operation_id, counts });

    const common = operation_id => ({ operation_id, device_id: WRITER_ID, promotion_id: control.active_promotion_id,
      client_contract: CONTRACT, authority_epoch: control.authority_epoch, expected_control_revision: control.revision, created_at: CREATED_AT });
    const command = (name, body) => post(`/commands/${name}`, body);
    const exactReplay = async (name, body) => {
      const receipt = await first(db, 'SELECT result_json FROM canonical_financial_operations WHERE operation_id=?', body.operation_id);
      assert.ok(receipt, 'durable receipt must exist before replay');
      const replay = await checked(await command(name, body), 200, `exact replay ${name}`);
      assert.deepEqual(replay, { ...JSON.parse(receipt.result_json), status: 'already_processed', idempotent: true });
      return replay;
    };
    activeCase = 'D1F03';
    const opening = { ...common('first-live-open'), session_id: 'till-synthetic', opening_cents: 1000 };
    const beforeOpen = await fingerprint();
    // Real D1 failure AFTER receipt and session writes, while installing first-live marker.
    // This adds one test trigger; it does not replace or weaken any production guard.
    await db.prepare(`CREATE TRIGGER test_fail_first_marker BEFORE UPDATE ON canonical_control
      WHEN OLD.first_live_operation_id IS NULL AND NEW.first_live_operation_id='first-live-open'
      BEGIN SELECT RAISE(ABORT,'test_injected_constraint'); END`).run();
    try {
      const failure = await checked(await command('cash.open', opening), 409, 'injected first marker failure');
      assert.equal(failure.error, 'financial_conflict');
      assert.equal(await fingerprint(), beforeOpen, 'receipt, session, marker and guards all rolled back');
    } finally {
      await db.prepare('DROP TRIGGER test_fail_first_marker').run();
    }
    await checked(await command('cash.open', opening), 201, 'cash.open first LIVE');
    const afterOpen = await first(db, 'SELECT * FROM canonical_control WHERE id=1');
    assert.deepEqual(afterOpen, { ...control, first_live_operation_id: opening.operation_id });
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM canonical_cash_sessions')).n, 1);
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM canonical_financial_operations')).n, 1);
    record('D1F03', { injected_status: 409, rollback_digest: beforeOpen, first_live_operation_id: afterOpen.first_live_operation_id });

    activeCase = 'D1F04';
    const importPayment = { ...common('import-payment'), credit_id: 'CR:001', expected_credit_revision: 0,
      amount_cents: 100, payment_method: 'yape' };
    const importResult = await checked(await command('payment.create', importPayment), 201, 'IMPORT payment');
    assert.equal(importResult.credit_provenance, 'IMPORT');
    assert.equal(importResult.current_balance_cents, 600);
    assert.equal(importResult.credit_revision, 1);
    assert.equal(importResult.cash_delta_cents, 0);
    assert.equal(await fingerprint(['credits','credit_payments']), imported);
    record('D1F04', { provenance: importResult.credit_provenance, balance_cents: importResult.current_balance_cents, revision: importResult.credit_revision });

    activeCase = 'D1F05';
    const creditSale = { ...common('live-credit-sale'), sale_id: 'live-credit-sale', payment_method: 'credito', customer_id: '000C',
      credit_due: '2026-10-20', total_cents: 1000, payment: { cash_cents: 0, digital_cents: 0, credit_cents: 1000 },
      items: [{ product_id: '00000', quantity: 1, unit_price_cents: 1000, line_total_cents: 1000, expected_stock_revision: 0 }] };
    await checked(await command('sale.create', creditSale), 201, 'LIVE credit sale');
    const livePayment = { ...common('live-payment'), credit_id: 'live-credit-sale:credit', expected_credit_revision: 0,
      amount_cents: 250, payment_method: 'plin' };
    const liveResult = await checked(await command('payment.create', livePayment), 201, 'LIVE payment');
    assert.equal(liveResult.current_balance_cents, 750);
    assert.equal(liveResult.credit_provenance, 'LIVE');
    assert.equal((await first(db, "SELECT current_balance_cents FROM canonical_credit_balances WHERE credit_id='live-credit-sale:credit'")).current_balance_cents, 750);
    for (const table of ['sales','sale_items','live_credits','cash_movements']) assert.equal((await first(db, `SELECT COUNT(*) n FROM ${table}`)).n, 1, table);
    const saleCash = await first(db, 'SELECT cash_cents,digital_cents,credit_cents FROM cash_movements');
    assert.deepEqual(saleCash, { cash_cents: 0, digital_cents: 0, credit_cents: 1000 });
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM inventory_movements')).n, 0, 'fixture product 00000 does not track stock');
    const untracked = await first(db, "SELECT current_stock_quantity,stock_revision FROM products WHERE product_id='00000'");
    assert.deepEqual(untracked, { current_stock_quantity: -2.75, stock_revision: 0 });
    const beforeSaleRetry = await fingerprint();
    assert.equal((await checked(await command('sale.create', creditSale), 200, 'sale retry')).idempotent, true);
    assert.equal(await fingerprint(), beforeSaleRetry);
    record('D1F05', { balance_cents: liveResult.current_balance_cents, credit_provenance: liveResult.credit_provenance, sale_cash: saleCash, untracked });

    activeCase = 'D1F06';
    const adjustment = { ...common('cash-adjustment'), session_id: 'till-synthetic', expected_session_revision: 0,
      amount_cents: -100, reason: 'Salida sintetica documentada' };
    const adjusted = await checked(await command('adjustment.create', adjustment), 201, 'adjustment');
    assert.equal(adjusted.expected_cents, 900);
    const compensation = { ...common('cash-adjustment-undo'), compensates_operation_id: adjustment.operation_id,
      session_id: 'till-synthetic', expected_session_revision: 1, reason: 'Correccion sintetica' };
    const compensated = await checked(await command('compensation.create', compensation), 201, 'compensation');
    assert.equal(compensated.expected_cents, 1000);
    assert.equal((await first(db, "SELECT expected_cents FROM canonical_cash_state WHERE session_id='till-synthetic'")).expected_cents, 1000);
    const beforeDoubleUndo = await fingerprint();
    await exactReplay('compensation.create', compensation);
    assert.equal((await checked(await command('compensation.create', { ...compensation, operation_id: 'double-undo', expected_session_revision: 2 }),
      409, 'second compensation blocked')).error, 'already_compensated');
    assert.equal(await fingerprint(), beforeDoubleUndo);
    record('D1F06', { adjusted_cents: adjusted.expected_cents, compensated_cents: compensated.expected_cents, session_revision: compensated.session_revision });

    activeCase = 'D1F07';
    const beforeRetry = await fingerprint();
    const retryFirst = await exactReplay('payment.create', livePayment);
    assert.equal(retryFirst.status, 'already_processed');
    assert.equal(retryFirst.idempotent, true);
    assert.equal((await checked(await command('payment.create', { ...livePayment, amount_cents: 251 }), 409, 'same id conflict')).error, 'operation_id_conflict');
    assert.equal(await fingerprint(), beforeRetry);
    record('D1F07', { retry_status: retryFirst.status, conflict: 'operation_id_conflict', unchanged_digest: beforeRetry });

    activeCase = 'D1F08';
    const staleA = { ...common('stale-credit-a'), credit_id: 'CR:001', expected_credit_revision: 1, amount_cents: 100, payment_method: 'yape' };
    const staleB = { ...staleA, operation_id: 'stale-credit-b' };
    const race = await Promise.all([command('payment.create', staleA), command('payment.create', staleB)]);
    assert.deepEqual(race.map(response => response.status).sort(), [201, 409]);
    const raceBodies = await Promise.all(race.map(response => response.json()));
    assert.ok(['stale_credit','financial_conflict'].includes(raceBodies[race.findIndex(response => response.status === 409)].error));
    assert.equal((await first(db, "SELECT COUNT(*) n FROM canonical_financial_operations WHERE operation_id IN ('stale-credit-a','stale-credit-b')")).n, 1);
    assert.equal((await first(db, "SELECT COUNT(*) n FROM canonical_financial_events WHERE operation_id IN ('stale-credit-a','stale-credit-b')")).n, 1);
    assert.equal((await first(db, "SELECT current_balance_cents FROM canonical_credit_balances WHERE credit_id='CR:001'")).current_balance_cents, 500);
    const racedCredit = await first(db, "SELECT current_balance_cents,revision FROM canonical_credit_balances WHERE credit_id='CR:001'");
    assert.deepEqual(racedCredit, { current_balance_cents: 500, revision: 2 });
    // Concurrent HTTP dispatches, not a forced barrier inside the Worker and not two browser tabs.
    record('D1F08', { statuses: race.map(response => response.status), credit: racedCredit });

    activeCase = 'D1F09';
    const lostAck = { ...common('discarded-ack-payment'), credit_id: 'live-credit-sale:credit', expected_credit_revision: 1,
      amount_cents: 50, payment_method: 'transferencia' };
    const discarded = await command('payment.create', lostAck);
    assert.equal(discarded.status, 201);
    await discarded.arrayBuffer();
    const beforeLostRetry = await fingerprint();
    const recovered = await exactReplay('payment.create', lostAck);
    assert.equal(recovered.status, 'already_processed');
    assert.equal(recovered.current_balance_cents, 700);
    assert.equal(await fingerprint(), beforeLostRetry);
    record('D1F09', { discarded_status: discarded.status, recovered_status: recovered.status, balance_cents: recovered.current_balance_cents });

    activeCase = 'D1F10';
    const beforeInvalid = await fingerprint();
    const invalidStatuses = [];
    for (const amount_cents of [0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1, '1']) {
      const response = await command('payment.create', { ...importPayment, operation_id: 'invalid-amount', expected_credit_revision: 2, amount_cents });
      invalidStatuses.push(response.status);
      await checked(response, 400, 'invalid cents');
    }
    await checked(await command('payment.create', {}), 400, 'empty body');
    await checked(await command('payment.create', { ...importPayment, operation_id: 'missing-credit', credit_id: 'not-present', expected_credit_revision: 2 }), 409, 'missing credit');
    await checked(await command('payment.create', { ...importPayment, operation_id: 'overpay', expected_credit_revision: 2, amount_cents: 501 }), 409, 'overpayment');
    await checked(await command('adjustment.create', { ...adjustment, operation_id: 'bad-reason', expected_session_revision: 2, reason: '  ' }), 400, 'empty reason');
    assert.equal(await fingerprint(), beforeInvalid);
    record('D1F10', { invalid_amount_statuses: invalidStatuses, unchanged_digest: beforeInvalid });

    activeCase = 'D1F11';
    const cash = await first(db, "SELECT * FROM canonical_cash_state WHERE session_id='till-synthetic'");
    const closure = { ...common('cash-close'), session_id: 'till-synthetic', expected_session_revision: cash.revision, counted_cents: cash.expected_cents };
    const closed = await checked(await command('cash.close', closure), 201, 'reconciled close');
    assert.equal(closed.difference_cents, 0);
    assert.equal(closed.expected_cents, 1000);
    assert.equal(closed.counted_cents, 1000);
    assert.equal(closed.session_revision, 3);
    assert.equal((await first(db, "SELECT status FROM canonical_cash_state WHERE session_id='till-synthetic'")).status, 'CLOSED');
    const afterClose = await fingerprint();
    await checked(await command('adjustment.create', { ...adjustment, operation_id: 'after-close', expected_session_revision: 3 }), 409, 'closed till rejects adjustment');
    await checked(await command('cash.close', { ...closure, operation_id: 'double-close', expected_session_revision: 3 }), 409, 'double close');
    assert.equal(await fingerprint(), afterClose);
    record('D1F11', { expected_cents: closed.expected_cents, counted_cents: closed.counted_cents, difference_cents: closed.difference_cents, session_revision: closed.session_revision });

    activeCase = 'D1F12';
    await db.prepare('PRAGMA recursive_triggers=OFF').run();
    const beforeDirect = await fingerprint();
    let blocked = 0;
    for (const table of ['canonical_financial_operations','canonical_financial_events','canonical_cash_sessions','canonical_cash_closures']) {
      assert.ok((await first(db, `SELECT COUNT(*) n FROM ${table}`)).n > 0, 'nonempty target, not a vacuous pass');
      await assert.rejects(db.prepare(`UPDATE ${table} SET rowid=rowid`).run(), /immutable_financial_history/);
      await assert.rejects(db.prepare(`DELETE FROM ${table}`).run(), /immutable_financial_history/);
      await assert.rejects(db.prepare(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`).run(), /financial_replace_forbidden/);
      const columns = (await all(db, `PRAGMA table_info(${table})`)).map(column => column.name).join(',');
      await assert.rejects(db.prepare(`INSERT OR REPLACE INTO ${table}(rowid,${columns}) SELECT rowid,* FROM ${table}`).run(), /financial_replace_forbidden/);
      blocked += 4;
      assert.equal(await fingerprint(), beforeDirect);
    }
    await assert.rejects(db.prepare('UPDATE canonical_control SET first_live_operation_id=NULL WHERE id=1').run(), /gate_p_control|immutable_first_live/);
    await checked(await post('/commands/canonical.rollback', { operation_id: 'rollback-after-live', promotion_id: promotion.promotion_id,
      expected_control_revision: control.revision }), 409, 'rollback after LIVE forbidden');
    assert.equal(await fingerprint(), beforeDirect);
    record('D1F12', { rejected_mutations: blocked, unchanged_digest: beforeDirect });
    assert.deepEqual(await all(db, 'PRAGMA foreign_key_check'), []);
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM canonical_assertions')).n, 0);
    const receiptCount = (await first(db, 'SELECT COUNT(*) n FROM canonical_financial_operations')).n;
    const eventCount = (await first(db, 'SELECT COUNT(*) n FROM canonical_financial_events')).n;

    activeCase = 'D1F13';
    const paginate = async route => {
      const items = [], seen = new Set();
      let cursor;
      do {
        const page = await checked(await read(`/read/canonical/${route}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), 200, `paginated ${route}`);
        assert.equal(page.mode, 'ACTIVE');
        assert.equal(page.read_only, false);
        assert.equal(page.promotion_id, promotion.promotion_id);
        items.push(...page.items);
        cursor = page.next_cursor;
        if (cursor) { assert.ok(!seen.has(cursor), 'cursor progresses'); seen.add(cursor); }
      } while (cursor);
      return items;
    };
    const routes = ['credits','credit-payments','financial-events','cash-sessions','sales','sale-items','cash-movements'];
    const beforeReads = Object.fromEntries(await Promise.all(routes.map(async route => [route, await paginate(route)])));
    const beforeRestart = await fingerprint();
    await mf.dispose();
    mf = undefined;
    phase = 'HARNESS_FAILURE';
    db = await start();
    phase = 'PRODUCT_FAIL';
    assert.equal(await fingerprint(), beforeRestart, 'new Miniflare instance restores exact application state without reseeding');
    assert.equal((await checked(await mf.dispatchFetch('http://localhost/health'), 200, 'health after restart')).d1, 'ok');
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM canonical_financial_operations')).n, receiptCount);
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM canonical_financial_events')).n, eventCount);
    assert.equal((await first(db, "SELECT current_balance_cents FROM canonical_credit_balances WHERE credit_id='CR:001'")).current_balance_cents, 500);
    assert.equal((await first(db, "SELECT current_balance_cents FROM canonical_credit_balances WHERE credit_id='live-credit-sale:credit'")).current_balance_cents, 700);
    assert.equal((await first(db, "SELECT status FROM canonical_cash_state WHERE session_id='till-synthetic'")).status, 'CLOSED');
    for (const [name, body] of [['cash.open', opening], ['payment.create', importPayment], ['payment.create', livePayment],
      ['adjustment.create', adjustment], ['compensation.create', compensation], ['payment.create', lostAck], ['cash.close', closure]]) {
      await exactReplay(name, body);
    }
    assert.equal((await checked(await command('sale.create', creditSale), 200, 'durable sale receipt')).idempotent, true);
    for (const route of routes) assert.deepEqual(await paginate(route), beforeReads[route], `durable read ${route}`);
    assert.equal(await fingerprint(), beforeRestart, 'all durable retries leave exact state unchanged');
    const credits = await checked(await read('/read/canonical/credits?limit=100'), 200, 'durable credit read');
    assert.equal(credits.items.find(row => row.credit_id === 'CR:001').current_balance_cents, 500);
    assert.equal(credits.items.find(row => row.credit_id === 'live-credit-sale:credit').current_balance_cents, 700);
    record('D1F13', { state_digest: beforeRestart, receipts: receiptCount, events: eventCount,
      read_counts: Object.fromEntries(Object.entries(beforeReads).map(([route, items]) => [route, items.length])) });

    activeCase = 'D1F14';
    assert.equal(receiptCount, 8);
    assert.equal(eventCount, 6);
    assert.equal(await fingerprint(['credits','credit_payments']), imported);
    assert.equal((await first(db, 'SELECT first_live_operation_id FROM canonical_control WHERE id=1')).first_live_operation_id, opening.operation_id);
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM canonical_write_guards')).n, 0);
    assert.equal((await first(db, 'SELECT COUNT(*) n FROM canonical_assertions')).n, 0);
    assert.deepEqual(await all(db, 'PRAGMA foreign_key_check'), []);
    assert.equal(await sha256Hex((await build(buildOptions)).outputFiles[0].contents), bundleHash, 'worker source unchanged during run');
    for (const migration of migrationFiles) assert.equal(await readFile(join(LAB, 'migrations', migration.name), 'utf8'), migration.sql);
    assert.equal(outboundAttempts, 0);
    record('D1F14', { outbound_attempts: outboundAttempts, receipts: receiptCount, events: eventCount, worker_sha256: bundleHash });
    passed = true;
  } catch (error) {
    t.diagnostic(JSON.stringify({ ID: activeCase, status: 'FAIL', classification: phase,
      expected: CASES[activeCase][2], observed: 'See failing assertion; credentials are never logged by this harness' }));
    for (const [id, [precondition, input, expected]] of Object.entries(CASES)) {
      if (!completed.has(id) && id !== activeCase) t.diagnostic(JSON.stringify({ ID: id, precondition, input, expected,
        observed: 'Not executed after prerequisite failed', status: 'PENDING' }));
    }
    throw error;
  } finally {
    if (mf) await mf.dispose();
    if (passed) {
      await rm(namespace, { recursive: true, force: true });
      await assert.rejects(stat(namespace), { code: 'ENOENT' });
      t.diagnostic('CLEANUP PASS: Miniflare disposed; isolated synthetic TEMP namespace removed.');
    }
    else t.diagnostic(`Retained failed synthetic local namespace: ${namespace}`);
  }
});
