import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildManifest, normalizeBackup, normalizeWorkbook, quarantineA4TestTransactions } from '../src/a5-import-core.js';
import { readWorkbookSheets } from '../src/a5-workbook.js';

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const has = (name) => args.includes(name);
const jsonPath = option('--json');
const xlsxPath = option('--xlsx');
const importId = option('--import-id');
const outputPath = option('--output');
const stage = has('--stage');
const quarantineA4Tests = has('--quarantine-a4-tests');
if (!importId || (!jsonPath && !xlsxPath) || (stage && (!option('--endpoint') || !process.env.DEVICE_ID || !process.env.SYNC_TOKEN))) {
  console.error('Usage: node scripts/a5-migrate.mjs --import-id ID [--json FILE] [--xlsx FILE] [--quarantine-a4-tests] [--output REPORT.json] [--dry-run | --stage --endpoint URL]');
  process.exitCode = 2;
} else {
  try {
    const rows = [];
    const sources = [];
    if (jsonPath) {
      const bytes = await readFile(resolve(jsonPath));
      const document = JSON.parse(bytes.toString('utf8'));
      if (document.integrity !== null && document.integrity !== undefined) {
        if (document.integrity.algorithm !== 'SHA-256' || document.integrity.scope !== 'payload-json' || !/^[0-9a-f]{64}$/.test(document.integrity.value || '')) throw new Error('unsupported backup integrity declaration');
        const actual = createHash('sha256').update(JSON.stringify(document.payload)).digest('hex');
        if (actual !== document.integrity.value) throw new Error('backup integrity hash mismatch');
      }
      sources.push({ name: basename(jsonPath), type: 'POS_JSON', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
      rows.push(...normalizeBackup(document, basename(jsonPath)));
    }
    if (xlsxPath) {
      const bytes = await readFile(resolve(xlsxPath));
      const sheets = await readWorkbookSheets(bytes);
      sources.push({ name: basename(xlsxPath), type: 'CLIENT_CREDIT_XLSX', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
      rows.push(...normalizeWorkbook(sheets, basename(xlsxPath)));
    }
    const quarantine = quarantineA4Tests ? quarantineA4TestTransactions(rows, sources) : { rows, exclusions: null };
    const manifest = await buildManifest({ importId, sources, rows: quarantine.rows, exclusions: quarantine.exclusions });
    let result = { mode: 'dry-run', ...manifest };
    if (stage) {
      const endpoint = new URL('/commands/import.stage', option('--endpoint'));
      const headers = { 'content-type': 'application/json', 'x-device-id': process.env.DEVICE_ID, 'x-sync-token': process.env.SYNC_TOKEN };
      const send = async (body) => {
        const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ import_id: manifest.import_id, ...body }) });
        const responseBody = await response.json();
        if (!response.ok) throw new Error(`stage failed (${response.status}): ${JSON.stringify(responseBody)}`);
        return responseBody;
      };
      const started = await send({ action: 'start', source_hash: manifest.source_hash, manifest_hash: manifest.manifest_hash, transform_version: manifest.transform_version, source_files: manifest.sources.length, sources: manifest.sources, row_count: manifest.rows.length, report_json: JSON.stringify(manifest.report) });
      if (started.status !== 'STAGING') {
        result = { mode: 'stage', manifest, server: started };
      } else {
      for (let index = 0; index < manifest.rows.length; index += 50) await send({ action: 'rows', rows: manifest.rows.slice(index, index + 50) });
      const issues = manifest.report.issues.map((entry, index) => ({ issue_number: index + 1, severity: entry.severity, code: entry.code, entity_type: entry.entity_type, source_key: entry.source_key, details_json: JSON.stringify(entry.details) }));
      for (let index = 0; index < issues.length; index += 50) await send({ action: 'issues', issues: issues.slice(index, index + 50) });
      const server = await send({ action: 'finish', manifest_hash: manifest.manifest_hash, verdict: manifest.report.verdict, issue_count: issues.length });
      result = { mode: 'stage', manifest, server };
      }
    }
    const rendered = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) await writeFile(resolve(outputPath), rendered, { flag: 'wx' });
    process.stdout.write(rendered);
    if (manifest.report.verdict === 'FAIL') process.exitCode = 1;
  } catch (error) {
    console.error(`A5 FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
