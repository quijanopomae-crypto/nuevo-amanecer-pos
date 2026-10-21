// Scheduled Turso backup: same logical snapshot as canon-migration-00NN, dedicated key,
// restore verification into a throwaway SQLite (T-48 order). Local, synthetic data only.
process.env.TZ = 'America/Lima';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { backup, verify, decryptBackup, requireBackupKey, REQUIRED_TABLES, KEY_ENV } from '../../tools/cloudflare-prod/scripts/turso-scheduled-backup.mjs';
import { backup as migrationBackup, backupPath as migrationBackupPath } from '../../tools/cloudflare-prod/scripts/turso-expense-server-received-maintenance.mjs';

const MIGS = readdirSync('infra/database/migrations').filter(n => /^00(1[4-9]|2\d|3[0-4])_/.test(n)).sort();
const KEY = 'synthetic-backup-key-' + 'k'.repeat(40);
const TOKEN = 'synthetic-turso-token-' + 't'.repeat(40);

function d1(database) { // D1 contract with SELECT-capable batch in one transaction (as the Turso adapter)
  return {
    prepare(sql) { const st = database.prepare(sql); let p = [];
      return { bind(...v) { p = v; return this; }, async first() { return st.get(...p) || null; }, async all() { return { results: st.all(...p) }; },
        async run() { return { meta: { changes: Number(st.run(...p).changes) } }; },
        _x() { return /^\s*(SELECT|PRAGMA|WITH)/i.test(sql) ? { results: st.all(...p) } : { meta: { changes: Number(st.run(...p).changes) } }; } }; },
    async batch(sts) { database.exec('BEGIN'); try { const r = sts.map(s => s._x()); database.exec('COMMIT'); return r; } catch (e) { database.exec('ROLLBACK'); throw e; } },
  };
}

async function populated(t) {
  const f = await activeCanon(t, { migrations: MIGS });
  const tab = await device(f, { token: 'device-a-token', deviceId: 'device-a' });
  await tab.api.openCash({ session_id: 'bk-cash', opening_cents: 5000 });
  const pid = 'BK-P1';
  await tab.api.createProduct({ product_id: pid, name: 'Sintetico', sku: pid + '-S', barcode: pid + '-B', alternate_codes: [], category: 'test', brand: 'T', description: null, icon: 'x', image: null,
    unit: 'unidad', purchase_unit: 'unidad', purchase_factor: 1, cost_cents: 100, price_cents: 250, box_price_cents: null, units_per_box: null, initial_stock_quantity: 20, stock_min_quantity: 0,
    expiry_date: null, includes_igv: true, tax_type: 'gravado', complementary_tax: '', tracks_inventory: true });
  await tab.api.refresh();
  await tab.api.createSale({ items: [{ product_id: pid, quantity: 2 }], payment_method: 'efectivo' });
  await tab.api.createSale({ items: [{ product_id: pid, quantity: 1 }], payment_method: 'credito', customer_id: '000C', credit_due: '2099-12-31' });
  await tab.api.refresh();
  const credit = tab.api.snapshot().credits.find(c => c.provenance === 'LIVE');
  await tab.api.createPayment({ credit_id: credit.credit_id, amount_cents: 100, payment_method: 'efectivo' });
  return f;
}

test('daily backup: dedicated key, restore verify PASS with FK off, per-table digests and focused reconciliation', async (t) => {
  const f = await populated(t);
  const dir = mkdtempSync(join(tmpdir(), 'turso-bk-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { [KEY_ENV]: KEY, TURSO_PROD_AUTH_TOKEN: TOKEN };
  const { encPath, manifestPath, manifest } = await backup(d1(f.database), { env, dir });
  const enc = readFileSync(encPath);
  assert.equal(enc.includes('Sintetico'), false, 'backup must be encrypted');
  assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8')).encryption.key_secret, KEY_ENV);
  assert.ok(manifest.tables > 40 && manifest.per_table.sales.rows === 2);

  const out = join(dir, 'restored.sqlite');
  const report = await verify(enc, { secret: KEY, manifest, out });
  assert.deepEqual(report.failures, []);
  assert.equal(report.state, 'TURSO_BACKUP_RESTORE_VERIFY_PASS');
  assert.equal(report.quick_check, 'ok');
  assert.equal(report.foreign_key_violations, 0);
  for (const name of REQUIRED_TABLES) assert.ok(report.per_table[name]?.digest_match, name);
  assert.equal(report.focus.sales.rows, 2);
  assert.equal(report.focus.sales.sums.total_cents, 750);
  assert.equal(report.focus.canonical_cash_sessions.rows, 1);
  assert.ok(report.focus.canonical_command_receipts.rows > 0);
  // The restored file equals the live DB at backup time.
  const R = new DatabaseSync(out);
  assert.equal(R.prepare('SELECT COUNT(*) n FROM sales').get().n, f.database.prepare('SELECT COUNT(*) n FROM sales').get().n);
  assert.equal(R.prepare('SELECT current_stock_quantity q FROM canonical_live_products WHERE product_id=?').get('BK-P1').q, 17);
  R.close();
});

test('runbook literal order (FK on during load) fails with FOREIGN KEY constraint failed', async (t) => {
  const f = await populated(t);
  const dir = mkdtempSync(join(tmpdir(), 'turso-bk-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { encPath } = await backup(d1(f.database), { env: { [KEY_ENV]: KEY }, dir });
  const plain = decryptBackup(readFileSync(encPath), KEY);
  const P = new DatabaseSync(':memory:'); P.exec('PRAGMA foreign_keys=ON');
  for (const s of plain.schema.filter(s => s.sql && s.type === 'table')) P.exec(s.sql);
  assert.throws(() => { for (const [name, rows] of Object.entries(plain.tables)) for (const row of rows) { const c = Object.keys(row);
    P.prepare(`INSERT INTO "${name}" (${c.map(x => '"' + x + '"').join(',')}) VALUES (${c.map(() => '?').join(',')})`).run(...c.map(x => row[x])); } }, /FOREIGN KEY constraint failed/);
  P.close();
});

test('failures are loud: missing/short key, key equal to Turso token, wrong key, tampered backup', async (t) => {
  assert.throws(() => requireBackupKey({}), new RegExp(KEY_ENV + ' is missing.*no fallback to TURSO_PROD_AUTH_TOKEN', 'i'));
  assert.throws(() => requireBackupKey({ [KEY_ENV]: 'short' }), /missing or shorter/);
  assert.throws(() => requireBackupKey({ [KEY_ENV]: TOKEN, TURSO_PROD_AUTH_TOKEN: TOKEN }), /must be different/);
  let message = '';
  try { requireBackupKey({ [KEY_ENV]: 'short-secret-value' }); } catch (e) { message = e.message; }
  assert.equal(message.includes('short-secret-value'), false, 'secret value never appears in errors');
  const f = await populated(t);
  const dir = mkdtempSync(join(tmpdir(), 'turso-bk-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(backup(d1(f.database), { env: { TURSO_PROD_AUTH_TOKEN: TOKEN }, dir }), /TURSO_BACKUP_ENCRYPTION_KEY is missing/);
  assert.equal(existsSync(join(dir, 'turso-backup.enc.json')), false);
  const { encPath, manifest } = await backup(d1(f.database), { env: { [KEY_ENV]: KEY }, dir });
  const enc = readFileSync(encPath);
  await assert.rejects(verify(enc, { secret: KEY + 'x' }), /decryption failed/);
  const tampered = structuredClone(manifest); tampered.per_table.sales.rows = 3;
  const r = await verify(enc, { secret: KEY, manifest: tampered });
  assert.equal(r.state, 'TURSO_BACKUP_RESTORE_VERIFY_FAIL');
  assert.ok(r.failures.some(x => /differs from manifest: sales/.test(x)));
  const wrongSha = { ...manifest, encrypted_sha256: '0'.repeat(64) };
  assert.ok((await verify(enc, { secret: KEY, manifest: wrongSha })).failures.some(x => /sha256/.test(x)));
});

test('the same verifier restores an existing canon-migration backup (token-derived key) for the runbook', async (t) => {
  const f = await populated(t);
  const prev = process.env.TURSO_PROD_AUTH_TOKEN; process.env.TURSO_PROD_AUTH_TOKEN = TOKEN;
  t.after(() => { if (prev === undefined) delete process.env.TURSO_PROD_AUTH_TOKEN; else process.env.TURSO_PROD_AUTH_TOKEN = prev; if (existsSync(migrationBackupPath)) rmSync(migrationBackupPath); });
  await migrationBackup(d1(f.database));
  const report = await verify(readFileSync(migrationBackupPath), { secret: TOKEN });
  assert.deepEqual(report.failures, []);
  assert.equal(report.format, 'nuevo-amanecer-turso-migration-0033-backup-v1');
});

test('workflows: daily schedule + dispatch, read-only Turso, artifact retention, hotfix backs up before deploy', () => {
  const wf = readFileSync('.github/workflows/turso-daily-backup.yml', 'utf8');
  assert.match(wf, /schedule:\n(?:\s*#[^\n]*\n)*\s*- cron: "30 8 \* \* \*"/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /TURSO_BACKUP_ENCRYPTION_KEY: \$\{\{ secrets\.TURSO_BACKUP_ENCRYPTION_KEY \}\}/);
  assert.match(wf, /turso-scheduled-backup\.mjs backup/);
  assert.match(wf, /turso-scheduled-backup\.mjs verify/);
  assert.match(wf, /retention-days: 90/);
  assert.doesNotMatch(wf, /wrangler|npx|maintenance\.mjs (migrate|apply)|CLOUDFLARE_API_TOKEN|group: nuevo-amanecer-production-change|set -x|workflow_run/);
  assert.ok(wf.indexOf('turso-scheduled-backup.mjs verify') < wf.indexOf('upload-artifact'), 'only verified backups are uploaded');
  const hf = readFileSync('.github/workflows/v1.3-turso-prod-worker-hotfix.yml', 'utf8');
  const bk = hf.indexOf('Create consistent encrypted logical Turso backup');
  const r2 = hf.indexOf('Store and verify backup in private remote R2');
  const deploy = hf.indexOf('Deploy Turso production Worker hotfix');
  assert.ok(bk > 0 && r2 > bk && deploy > r2);
  assert.match(hf.slice(bk, r2), /turso-expense-server-received-maintenance\.mjs backup/);
});
