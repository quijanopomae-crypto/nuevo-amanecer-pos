import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import ExcelJS from '../../tools/cloudflare-lab/node_modules/exceljs/excel.js';
import JSZip from '../../tools/cloudflare-lab/node_modules/jszip/lib/index.js';
import { buildManifest, normalizeBackup, normalizeWorkbook, validateManifest } from '../../tools/cloudflare-lab/src/a5-import-core.js';
import { workerFixture } from './worker-fixture.mjs';

const execFileAsync = promisify(execFile);

const backup = {
  format: 'nuevo-amanecer-pos-backup', version: 1,
  payload: { version: 9, data: {
    productos: [{ id: 'prod-1', name: 'Arroz' }], ventas: [],
    clientes: [{ id: 'cli-1', nombre: 'Ana' }],
    creditos: [{ id: 'cr-1', cliId: 'cli-1', monto: 100, pagado: 40, saldo: 60, pagos: [{ pagoId: 'p-1', monto: 40 }] }],
    gastos: [], cajMovs: [], cashClosures: [], inventoryMovements: [],
  } },
};

async function manifest(overrides = {}) {
  const rows = normalizeBackup(backup);
  return buildManifest({ importId: 'import-a5-001', sources: [{ name: 'backup.json', type: 'POS_JSON', sha256: 'a'.repeat(64), bytes: 100 }], rows, ...overrides });
}

function post(fixture, body) {
  return fixture.fetch('https://worker.test/commands/import.stage', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-id': 'writer-1', 'x-sync-token': 'writer-secret' }, body: JSON.stringify(body) });
}

async function stage(fixture, value) {
  const base = { import_id: value.import_id };
  const start = await post(fixture, { ...base, action: 'start', source_hash: value.source_hash, manifest_hash: value.manifest_hash, transform_version: value.transform_version, source_files: value.sources.length, sources: value.sources, row_count: value.rows.length, report_json: JSON.stringify(value.report) });
  for (let index = 0; index < value.rows.length; index += 50) assert.equal((await post(fixture, { ...base, action: 'rows', rows: value.rows.slice(index, index + 50) })).status, 200);
  const issues = value.report.issues.map((entry, index) => ({ issue_number: index + 1, severity: entry.severity, code: entry.code, entity_type: entry.entity_type, source_key: entry.source_key, details_json: JSON.stringify(entry.details) }));
  if (issues.length) assert.equal((await post(fixture, { ...base, action: 'issues', issues })).status, 200);
  const finish = await post(fixture, { ...base, action: 'finish', manifest_hash: value.manifest_hash, verdict: value.report.verdict, issue_count: issues.length });
  return { start, finish };
}

test('mismo origen produce manifiesto reproducible y PASS con conteos y montos exactos', async () => {
  const first = await manifest();
  const second = await manifest();
  assert.equal(first.source_hash, second.source_hash);
  assert.equal(first.manifest_hash, second.manifest_hash);
  assert.equal(first.report.verdict, 'PASS');
  assert.deepEqual(first.report.counts, { products: 1, customers: 1, credits: 1, credit_payments: 1 });
  assert.deepEqual(first.report.amounts, { credit_amount_cents: 10000, credit_paid_cents: 4000, credit_balance_cents: 6000, payment_amount_cents: 4000, sales_total_cents: 0 });
  assert.deepEqual(await validateManifest(first), first);
});

test('XLSX lógico preserva abono sin fecha como desconocida sin inventarla', async () => {
  const rows = normalizeWorkbook({ Clientes: [{ ID: 'cli-1', Nombre: 'Ana' }], Creditos: [{ ID: 'cr-1', Cliente_ID: 'cli-1', Monto: 25, Pagado: 5, Saldo: 20 }], Pagos: [{ ID: 'p-1', Credito_ID: 'cr-1', Monto: 5, Fecha: '' }] });
  const payment = rows.find((row) => row.entity_type === 'credit_payments').payload;
  assert.equal(payment.fecha, null);
  assert.equal(payment.fecha_conocida, false);
});

test('no inventa identidad ni importes financieros ausentes', () => {
  assert.throws(() => normalizeWorkbook({ Creditos: [{ ID: 'cr-1', Cliente_ID: 'cli-1', Monto: 25 }] }), /credit requires/);
  assert.throws(() => normalizeWorkbook({ Creditos: [{ ID: 'cr-1', Cliente_ID: 'cli-1', Monto: 25, Pagado: ' \t ', Saldo: 25 }] }), /credit requires/);
  assert.throws(() => normalizeWorkbook({ Pagos: [{ Credito_ID: 'cr-1', Monto: 5 }] }), /payment requires/);
});

test('CLI lee un XLSX real y genera dry-run determinista sin contactar D1', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'na-a5-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'clientes-creditos.xlsx');
  const output = join(directory, 'report.json');
  const workbook = new ExcelJS.Workbook();
  for (const [name, headers, values] of [
    ['Clientes', ['ID', 'Nombre'], ['cli-1', 'Ana']],
    ['Creditos', ['ID', 'Cliente_ID', 'Monto', 'Pagado', 'Saldo'], ['cr-1', 'cli-1', 25, 5, 20]],
    ['Pagos', ['ID', 'Credito_ID', 'Monto', 'Fecha'], ['p-1', 'cr-1', 5, '']],
  ]) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(headers); sheet.addRow(values);
  }
  await workbook.xlsx.writeFile(input);
  const command = new URL('../../tools/cloudflare-lab/scripts/a5-migrate.mjs', import.meta.url);
  const first = await execFileAsync(process.execPath, [command.pathname.slice(1), '--import-id', 'xlsx-real', '--xlsx', input, '--dry-run', '--output', output]);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.report.verdict, 'PASS');
  assert.equal(report.rows.find((row) => row.entity_type === 'credit_payments').payload.fecha, null);
  const second = await execFileAsync(process.execPath, [command.pathname.slice(1), '--import-id', 'xlsx-real', '--xlsx', input, '--dry-run']);
  assert.equal(JSON.parse(first.stdout).manifest_hash, JSON.parse(second.stdout).manifest_hash);
});

test('CLI soporta la estructura OOXML real y conserva diferencias', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'na-a5-real-structure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'creditos-clientes.xlsx');
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('Resumen clientes');
  for (let index = 0; index < 9; index++) summary.addRow(index === 0 ? ['Resumen sintético'] : []);
  summary.addRow(['Documento', 'Cliente', 'Saldo imágenes', 'Saldo documentos', 'Diferencia']);
  for (let index = 1; index <= 31; index++) summary.addRow([`customer-${index}`, `Customer ${index}`, index === 1 ? 10 : 0, index === 1 ? 119 : 0, index === 1 ? 109 : 0]);
  const credits = workbook.addWorksheet('Detalle créditos');
  credits.addRow(['Detalle sintético']); credits.addRow([]);
  credits.addRow(['Documento cliente', 'Cliente', 'Documento crédito', 'Crédito original', 'Total abonado', 'Saldo']);
  for (let index = 1; index <= 314; index++) credits.addRow([`customer-${((index - 1) % 31) + 1}`, `Customer ${index}`, `credit-${index}`, 10, index <= 134 ? 1 : 0, index <= 134 ? 9 : 10]);
  const payments = workbook.addWorksheet('Historial pagos');
  payments.addRow(['Pagos sintéticos']); payments.addRow([]);
  payments.addRow(['Documento cliente', 'Cliente', 'Documento crédito', 'Pago N.º (secuencia)', 'Fecha y hora', 'Importe del pago']);
  for (let index = 1; index <= 134; index++) payments.addRow([`customer-${((index - 1) % 31) + 1}`, `Customer ${index}`, `credit-${index}`, 1, index % 2 ? '' : 'No registrada', 1]);
  workbook.addWorksheet('Notas y control').addRow(['Tema', 'Detalle']);
  workbook.addWorksheet('Plan cuotas nuevas').addRow(['Cliente', 'Concepto']);
  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.endsWith('.xml')) continue;
    const xml = await entry.async('string');
    if (!xml.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) continue;
    zip.file(name, xml.replaceAll('<worksheet', '<x:worksheet').replaceAll('</worksheet>', '</x:worksheet>').replaceAll('<workbook', '<x:workbook').replaceAll('</workbook>', '</x:workbook>').replaceAll('<sst', '<x:sst').replaceAll('</sst>', '</x:sst>').replace('xmlns=', 'xmlns:x='));
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(input, await zip.generateAsync({ type: 'nodebuffer' }));
  const command = new URL('../../tools/cloudflare-lab/scripts/a5-migrate.mjs', import.meta.url);
  await assert.rejects(execFileAsync(process.execPath, [command.pathname.slice(1), '--import-id', 'xlsx-real-shape', '--xlsx', input, '--dry-run']), (error) => {
    const report = JSON.parse(error.stdout);
    assert.equal(report.report.verdict, 'FAIL');
    assert.deepEqual(report.report.counts, { customers: 31, credits: 314, credit_payments: 134 });
    assert.equal(report.rows.filter((row) => row.entity_type === 'credit_payments' && row.payload.fecha === null && row.payload.fecha_conocida === false).length, 134);
    assert.equal(report.report.issues.some((entry) => entry.code === 'CUSTOMER_BALANCE_DIFFERENCE' && entry.details.difference_cents === 10900), true);
    return true;
  });
});

test('reconciliación conserva diferencias de cliente positivas y negativas', async () => {
  const rows = normalizeWorkbook({
    'Resumen clientes': [
      { Documento: 'customer-positive', Cliente: 'Positive', 'Saldo imágenes': 10, 'Saldo documentos': 119, Diferencia: 109 },
      { Documento: 'customer-negative', Cliente: 'Negative', 'Saldo imágenes': 119, 'Saldo documentos': 10, Diferencia: -109 },
    ],
  });
  const result = await buildManifest({ importId: 'signed-differences', sources: [{ name: 'input.xlsx', type: 'CLIENT_CREDIT_XLSX', sha256: 'c'.repeat(64), bytes: 1 }], rows });
  assert.deepEqual(result.report.issues.map((entry) => entry.details.difference_cents).sort((a, b) => a - b), [-10900, 10900]);
  assert.equal(result.report.verdict, 'FAIL');
});

test('duplicados, huérfanos y diferencias quedan preservados y reportan FAIL', async () => {
  const rows = normalizeWorkbook({
    Clientes: [{ ID: 'cli-1', Nombre: 'Ana' }, { ID: 'cli-1', Nombre: 'Ana duplicada' }],
    Creditos: [{ ID: 'cr-1', Cliente_ID: 'missing', Monto: 100, Pagado: 20, Saldo: 90 }],
    Pagos: [{ ID: 'p-1', Credito_ID: 'missing-credit', Monto: 5 }],
  });
  const result = await buildManifest({ importId: 'import-fail', sources: [{ name: 'input.xlsx', type: 'CLIENT_CREDIT_XLSX', sha256: 'b'.repeat(64), bytes: 200 }], rows });
  assert.equal(result.report.verdict, 'FAIL');
  assert.deepEqual(new Set(result.report.issues.map((entry) => entry.code)), new Set(['DUPLICATE_SOURCE_KEY', 'ORPHAN_CREDIT_CUSTOMER', 'ORPHAN_PAYMENT_CREDIT', 'CREDIT_PAYMENT_TOTAL_DIFFERENCE', 'CREDIT_BALANCE_DIFFERENCE']));
  assert.equal(result.rows.filter((row) => row.entity_type === 'customers').some((row) => row.validation_status === 'REVIEW'), true);
});

test('Worker carga staging con writer único, reconcilia y no toca tablas comerciales', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const value = await manifest();
  const { start, finish } = await stage(fixture, value);
  assert.equal(start.status, 201);
  assert.deepEqual(await finish.json(), { status: 'PASS', import_id: value.import_id, row_count: value.rows.length, issue_count: 0, reconciliation: 'PASS' });
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM import_staging').get().count, value.rows.length);
  for (const table of ['sales', 'sale_items', 'inventory_movements', 'cash_movements']) assert.equal(fixture.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
});

test('retry del mismo import es idempotente y contenido diferente entra en conflicto', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const value = await manifest();
  assert.equal((await stage(fixture, value)).finish.status, 200);
  const retry = await post(fixture, { import_id: value.import_id, action: 'start', source_hash: value.source_hash, manifest_hash: value.manifest_hash, transform_version: value.transform_version, source_files: 1, sources: value.sources, row_count: value.rows.length, report_json: JSON.stringify(value.report) });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).idempotent, true);
  const conflict = await post(fixture, { import_id: value.import_id, action: 'start', source_hash: 'f'.repeat(64), manifest_hash: value.manifest_hash, transform_version: value.transform_version, source_files: 1, sources: value.sources, row_count: value.rows.length, report_json: JSON.stringify(value.report) });
  assert.equal(conflict.status, 409);
  const duplicateSource = await post(fixture, { import_id: 'import-a5-copy', action: 'start', source_hash: value.source_hash, manifest_hash: value.manifest_hash, transform_version: value.transform_version, source_files: 1, sources: value.sources, row_count: value.rows.length, report_json: JSON.stringify(value.report) });
  assert.equal(duplicateSource.status, 409);
  assert.equal((await duplicateSource.json()).error, 'duplicate_source');
});

test('reconciliación no finaliza si faltan filas y rechaza read_only', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const value = await manifest();
  await post(fixture, { import_id: value.import_id, action: 'start', source_hash: value.source_hash, manifest_hash: value.manifest_hash, transform_version: value.transform_version, source_files: 1, sources: value.sources, row_count: value.rows.length, report_json: JSON.stringify(value.report) });
  const finish = await post(fixture, { import_id: value.import_id, action: 'finish', manifest_hash: value.manifest_hash, verdict: 'PASS', issue_count: 0 });
  assert.equal(finish.status, 409);
  assert.equal((await finish.json()).error, 'reconciliation_incomplete');

  const reader = workerFixture(); t.after(() => reader.close());
  reader.addDevice('writer-1', 'read_only', 'active', 'writer-secret');
  assert.equal((await post(reader, { import_id: value.import_id, action: 'start' })).status, 403);
});

test('Worker reconstruye el manifiesto y rechaza una fila sustituida', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const value = await manifest();
  const start = { import_id: value.import_id, action: 'start', source_hash: value.source_hash, manifest_hash: value.manifest_hash, transform_version: value.transform_version, source_files: 1, sources: value.sources, row_count: value.rows.length, report_json: JSON.stringify(value.report) };
  assert.equal((await post(fixture, start)).status, 201);
  const changed = structuredClone(value.rows);
  const payload = JSON.parse(changed[0].payload_json);
  payload.name = 'Contenido sustituido';
  changed[0].payload_json = JSON.stringify(payload);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(changed[0].payload_json));
  changed[0].payload_hash = Buffer.from(digest).toString('hex');
  assert.equal((await post(fixture, { import_id: value.import_id, action: 'rows', rows: changed })).status, 200);
  const finish = await post(fixture, { import_id: value.import_id, action: 'finish', manifest_hash: value.manifest_hash, verdict: 'PASS', issue_count: 0 });
  assert.equal(finish.status, 409);
  assert.equal((await finish.json()).error, 'manifest_integrity_mismatch');
  assert.equal(fixture.database.prepare('SELECT status FROM import_runs WHERE import_id = ?').get(value.import_id).status, 'STAGING');
});

test('retry de start con metadatos diferentes entra en conflicto', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const value = await manifest();
  const start = { import_id: value.import_id, action: 'start', source_hash: value.source_hash, manifest_hash: value.manifest_hash, transform_version: value.transform_version, source_files: 1, sources: value.sources, row_count: value.rows.length, report_json: JSON.stringify(value.report) };
  assert.equal((await post(fixture, start)).status, 201);
  assert.equal((await post(fixture, { ...start, row_count: value.rows.length + 1 })).status, 409);
});

test('fallo de batch revierte el lote y permite reanudar sin duplicados', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const value = await manifest();
  const start = { import_id: value.import_id, action: 'start', source_hash: value.source_hash, manifest_hash: value.manifest_hash, transform_version: value.transform_version, source_files: 1, sources: value.sources, row_count: value.rows.length, report_json: JSON.stringify(value.report) };
  assert.equal((await post(fixture, start)).status, 201);
  fixture.failBatchAt(1);
  assert.equal((await post(fixture, { import_id: value.import_id, action: 'rows', rows: value.rows })).status, 500);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM import_staging').get().count, 0);
  fixture.failBatchAt(null);
  assert.equal((await post(fixture, { import_id: value.import_id, action: 'rows', rows: value.rows })).status, 200);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM import_staging').get().count, value.rows.length);
});

test('run finalizado solo acepta retry de finish con el mismo manifiesto', async (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  fixture.addDevice('writer-1', 'writer', 'active', 'writer-secret');
  const value = await manifest();
  assert.equal((await stage(fixture, value)).finish.status, 200);
  const retry = await post(fixture, { import_id: value.import_id, action: 'finish', manifest_hash: value.manifest_hash, verdict: 'PASS', issue_count: 0 });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).idempotent, true);
  const altered = await post(fixture, { import_id: value.import_id, action: 'rows', rows: value.rows });
  assert.equal(altered.status, 409);
  assert.equal((await altered.json()).error, 'import_finalized');
});

test('migración A5 es reaplicable y las rutas están configuradas', (t) => {
  const fixture = workerFixture(); t.after(() => fixture.close());
  const migration = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0005_import_staging.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => fixture.database.exec(migration));
  assert.match(readFileSync(new URL('../../tools/cloudflare-lab/wrangler.jsonc', import.meta.url), 'utf8'), /"\/imports\/\*"/);
});
