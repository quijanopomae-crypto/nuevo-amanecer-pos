// Scheduled Turso backup: same logical snapshot as canon-migration-00NN, dedicated key,
// restore verification into a throwaway SQLite (T-48 order). Local, synthetic data only.
process.env.TZ = 'America/Lima';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { backup, verify, decryptBackup, requireBackupKey, publicSummary, keyFingerprint, openManifest, REQUIRED_TABLES, KEY_ENV } from '../../tools/cloudflare-prod/scripts/turso-scheduled-backup.mjs';
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
  // Manifest in R2 is encrypted too: only format, fingerprint and backup hash in clear.
  const manifestFile = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifestFile.manifest_format, 'nuevo-amanecer-turso-scheduled-backup-manifest-encrypted-v1');
  assert.equal(manifestFile.key_fingerprint, keyFingerprint(KEY));
  assert.match(keyFingerprint(KEY), /^[0-9a-f]{16}$/);
  assert.equal(readFileSync(manifestPath, 'utf8').includes(KEY.slice(0, 12)), false);
  for (const clear of ['per_table', 'focus', '_cents', 'sales']) assert.equal(readFileSync(manifestPath, 'utf8').includes(clear), false, clear);
  assert.equal(openManifest(manifestFile, KEY).encryption.key_secret, KEY_ENV);
  assert.equal(JSON.parse(enc.toString('utf8')).key_fingerprint, keyFingerprint(KEY));
  assert.ok(manifest.tables > 40 && manifest.per_table.sales.rows === 2);

  const out = join(dir, 'restored.sqlite');
  const report = await verify(enc, { secret: KEY, manifest: manifestFile, out });
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
  // Public log/summary: only pass/fail, table count, digest ok and integrity; no row counts.
  const pub = publicSummary(report);
  assert.deepEqual(Object.keys(pub).sort(), ['failures', 'foreign_key_check', 'quick_check', 'state', 'tables', 'total_digest_match']);
  assert.equal(pub.total_digest_match, true);
  assert.equal(JSON.stringify(pub).includes('rows'), false);
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
  await assert.rejects(verify(enc, { secret: KEY + 'x' }), /encrypted with a different key/);
  // Without the fingerprint (e.g. older envelope), a wrong key still fails at GCM authentication.
  const noFp = JSON.parse(enc.toString('utf8')); delete noFp.key_fingerprint;
  await assert.rejects(verify(Buffer.from(JSON.stringify(noFp)), { secret: KEY + 'x' }), /decryption failed/);
  const tampered = structuredClone(manifest); tampered.per_table.sales.rows = 3;
  const r = await verify(enc, { secret: KEY, manifest: tampered });
  assert.equal(r.state, 'TURSO_BACKUP_RESTORE_VERIFY_FAIL');
  assert.ok(r.failures.some(x => /differs from manifest: sales/.test(x)));
  assert.ok(r.failures.every(x => !/\d+ rows|rows=\d/.test(x)), 'failure messages carry no counts');
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

test('workflows: daily schedule + dispatch, read-only Turso, private R2 only after verify, hotfix backs up before deploy', () => {
  const wf = readFileSync('.github/workflows/turso-daily-backup.yml', 'utf8');
  assert.match(wf, /schedule:\n(?:\s*#[^\n]*\n)*\s*- cron: "30 8 \* \* \*"/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /TURSO_BACKUP_ENCRYPTION_KEY: \$\{\{ secrets\.TURSO_BACKUP_ENCRYPTION_KEY \}\}/);
  assert.match(wf, /turso-scheduled-backup\.mjs backup/);
  assert.match(wf, /turso-scheduled-backup\.mjs verify/);
  // Public repo: no GitHub artifact; private R2 via the same put/get/sha256 step as the hotfix, after verify.
  assert.doesNotMatch(wf, /upload-artifact|retention-days/);
  assert.doesNotMatch(wf, /wrangler (deploy|d1|secret)|maintenance\.mjs (migrate|apply)|group: nuevo-amanecer-production-change|set -x|workflow_run/);
  const verifyAt = wf.indexOf('turso-scheduled-backup.mjs verify');
  const r2Block = wf.slice(wf.indexOf('- name: Store and verify backup in private remote R2'));
  assert.ok(verifyAt > 0 && wf.indexOf('- name: Store and verify backup in private remote R2') > verifyAt, 'R2 upload only after verification');
  assert.match(r2Block, /KEY="turso-daily-backup\/\$\(date -u \+%Y-%m-%dT%H-%M-%SZ\)-\$GITHUB_SHA\.json"/);
  assert.match(r2Block, /npx wrangler r2 object put "\$R2_BUCKET\/\$KEY" --remote/);
  assert.match(r2Block, /npx wrangler r2 object get "\$R2_BUCKET\/\$KEY" --remote/);
  assert.match(wf, /R2_BUCKET: nuevo-amanecer-prod-v2-backups/);
  assert.match(wf, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.doesNotMatch(wf, /per_table|\.rows\b/, 'no per-table counts in the workflow log or summary');
  const hf = readFileSync('.github/workflows/v1.3-turso-prod-worker-hotfix.yml', 'utf8');
  const bk = hf.indexOf('- name: Create consistent encrypted logical Turso backup');
  const vf = hf.indexOf('- name: Restore-verify pre-deploy Turso backup');
  const r2h = hf.indexOf('- name: Store and verify backup in private remote R2');
  const health = hf.indexOf('- name: Verify production health before hotfix');
  const deploy = hf.indexOf('- name: Deploy Turso production Worker hotfix');
  assert.ok(bk > 0 && vf > bk && r2h > vf && health > r2h && deploy > health, 'backup -> verify -> R2 -> deploy');
  assert.match(hf.slice(bk, vf), /turso-scheduled-backup\.mjs backup/);
  assert.match(hf.slice(bk, vf), /TURSO_BACKUP_ENCRYPTION_KEY: \$\{\{ secrets\.TURSO_BACKUP_ENCRYPTION_KEY \}\}/);
  assert.match(hf.slice(vf, r2h), /turso-scheduled-backup\.mjs verify[\s\S]*\|\| \{ echo "::error::[^"]*NOT deployed"; exit 1; \}/);
  assert.doesNotMatch(hf.slice(bk, deploy), /continue-on-error|turso-expense-server-received-maintenance/);
  assert.match(hf.slice(r2h, health), /KEY="v1\.3-turso-worker-hotfix\//);
  // Daily: default-branch check is the first step, before any step that receives secrets; no job-level secrets.
  const firstSecret = wf.indexOf('${{ secrets.');
  assert.ok(wf.indexOf('- name: Require default branch') > 0 && wf.indexOf('- name: Require default branch') < firstSecret);
  assert.doesNotMatch(wf.slice(wf.indexOf('jobs:'), wf.indexOf('steps:')), /secrets\./);
});

test('key fingerprint: verify refuses a different key with a clear message; CLI prints fingerprint, never the key; size warning has no numbers', async (t) => {
  const f = await populated(t);
  const dir = mkdtempSync(join(tmpdir(), 'turso-bk-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const summary = join(dir, 'summary.md');
  const { encPath, manifestPath, sizeStatus } = await backup(d1(f.database), { env: { [KEY_ENV]: KEY, GITHUB_STEP_SUMMARY: summary }, dir });
  assert.equal(sizeStatus, 'OK');
  assert.match(readFileSync(summary, 'utf8'), new RegExp('Backup key fingerprint: ' + keyFingerprint(KEY)));
  const other = 'rotated-synthetic-key-' + 'r'.repeat(40);
  await assert.rejects(verify(readFileSync(encPath), { secret: other }), new RegExp('backup was encrypted with a different key: fingerprint ' + keyFingerprint(KEY) + ', provided key ' + keyFingerprint(other)));
  await assert.rejects(verify(readFileSync(encPath), { secret: other, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) }), /manifest was encrypted with a different key/);
  const script = 'tools/cloudflare-prod/scripts/turso-scheduled-backup.mjs';
  const ok = spawnSync(process.execPath, [script, 'fingerprint', encPath], { env: { ...process.env, [KEY_ENV]: KEY }, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp('"key_fingerprint":"' + keyFingerprint(KEY) + '"'));
  assert.match(ok.stdout, /"match":true/);
  assert.equal(ok.stdout.includes(KEY.slice(0, 12)), false);
  const bad = spawnSync(process.execPath, [script, 'fingerprint', manifestPath], { env: { ...process.env, [KEY_ENV]: other }, encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.match(bad.stdout, /"match":false/);
  // Size warning above threshold: GitHub ::warning:: without byte counts.
  const lines = []; const log = console.log; console.log = (...a) => lines.push(a.join(' '));
  try { const r = await backup(d1(f.database), { env: { [KEY_ENV]: KEY, TURSO_BACKUP_WARN_BYTES: '1000' }, dir }); assert.equal(r.sizeStatus, 'NEAR_LIMIT'); }
  finally { console.log = log; }
  const warn = lines.find(l => l.startsWith('::warning::'));
  assert.ok(warn); assert.doesNotMatch(warn, /\d{3,}/);
  assert.match(lines.find(l => l.includes('TURSO_SCHEDULED_BACKUP_READY')), /"size":"NEAR_LIMIT"/);
});
