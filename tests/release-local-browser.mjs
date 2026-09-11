// Smoke test of the prepared package. Uses a fresh browser context, never a commercial profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const token = process.env.SYNC_TOKEN;
if (!token) throw new Error('SYNC_TOKEN required in process environment');
const directory = resolve(process.argv[2] || '.');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const server = spawn(process.execPath, ['tools/pos-local/server.mjs', '--port=0'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
const checks = [], cloudRequests = [], errors = [], localFailures = [];
let browser;
try {
  const info = await new Promise((resolve, reject) => {
    let text = '';
    server.stdout.on('data', data => { text += data; if (text.includes('\n')) { try { resolve(JSON.parse(text.split('\n')[0])); } catch (error) { reject(error); } } });
    server.once('error', reject);
    server.once('exit', code => reject(new Error('Local server exited: ' + code)));
  });
  const base = new URL(info.url).origin;
  const pass = name => { checks.push({ name, result: 'PASS' }); console.log('PASS ' + name); };
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://cdn.sheetjs.com/**', route => route.abort());
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  await context.route('https://fonts.gstatic.com/**', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', () => errors.push('page-error'));
  page.on('request', req => { if (req.url().startsWith('https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev/')) cloudRequests.push({ method: req.method(), path: new URL(req.url()).pathname }); });
  page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) localFailures.push(new URL(response.url()).pathname); });
  await page.goto(base + '/tools/pos-local/setup.html');
  await page.locator('#syncToken').fill('invalid-release-setup-check');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('no fue aceptada'));
  assert.equal(await page.evaluate(() => localStorage.getItem('na_cloud_sync_credentials')), null);
  assert.equal(await page.locator('#syncToken').inputValue(), '');
  pass('invalid_sync_credential_not_saved');
  await page.locator('#syncToken').fill(token);
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('verificada y guardada'));
  assert.equal(await page.evaluate(expected => JSON.parse(localStorage.getItem('na_cloud_sync_credentials')).token === expected, token), true);
  assert.equal(await page.locator('#syncToken').inputValue(), '');
  assert.equal((await page.content()).includes(token), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  pass('current_sync_credential_verified_saved_and_hidden');
  await page.reload();
  assert.equal(await page.evaluate(expected => JSON.parse(localStorage.getItem('na_cloud_sync_credentials')).token === expected, token), true);
  await page.locator('#syncToken').fill('invalid-release-setup-check');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('no fue aceptada'));
  assert.equal(await page.evaluate(expected => JSON.parse(localStorage.getItem('na_cloud_sync_credentials')).token === expected, token), true);
  pass('invalid_replacement_preserves_saved_configuration');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(info.url);
  await page.waitForFunction(() => typeof NuevoAmanecerOutbox !== 'undefined' && !!NuevoAmanecerOutbox.snapshot() && typeof extractOcrText === 'function');
  assert.equal(await page.evaluate(() => location.protocol), 'http:');
  assert.equal(await page.evaluate(() => NuevoAmanecerOutbox.snapshot().outbox.length), 0);
  pass('prepared_package_pos_boots_with_empty_isolated_outbox');
  const ocr = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 240;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 900, 240);
    ctx.fillStyle = 'black'; ctx.font = 'bold 64px Arial'; ctx.fillText('ARROZ 12345', 30, 100);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const result = await extractOcrText(blob);
    return { ok: result.ok, recognized: result.rawText.toUpperCase().includes('ARROZ'), error: result.error?.code || null };
  });
  assert.equal(ocr.ok, true, ocr.error || 'OCR must succeed');
  assert.equal(ocr.recognized, true);
  pass('real_ocr_worker_wasm_and_spanish_resources_from_package');
  assert.ok(cloudRequests.length >= 3 && cloudRequests.every(req => ['GET', 'OPTIONS'].includes(req.method)));
  assert.deepEqual(errors, []); assert.deepEqual(localFailures, []);
  pass('no_cloud_writes_no_local_missing_assets_no_page_errors');
  writeFileSync(new URL('../evidence/v1.2/local-package-browser.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), directory, checks, cloudRequests, physicalSecondDevice: false, commercialProfileConfigured: false, commercialDataBackupCreated: false, isolatedBrowserContext: true, ocr }, null, 2) + '\n');
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; }
}
