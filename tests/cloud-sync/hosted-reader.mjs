// Real HTTPS reader in Chrome. This does not claim a physical second device.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const token = process.env.READ_TOKEN;
if (!token) throw new Error('READ_TOKEN required in process environment');
const base = 'https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev';
const evidence = new URL('../../evidence/v1.2/', import.meta.url);
const rc = JSON.parse(readFileSync(new URL('rc-remote.json', evidence), 'utf8'));
const expected = rc.checks.find(c => c.name === 'real_worker_d1_synced');
const saleId = expected.expectedOperations.find(o => o.entityType === 'sales').entityId;
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const checks = [], requests = [], errors = [];
function pass(name) { checks.push({ name, result: 'PASS' }); console.log('PASS ' + name); }
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', () => errors.push('page-error'));
  page.on('request', req => { if (req.url().startsWith(base + '/read/')) requests.push({ url: new URL(req.url()).pathname, method: req.method() }); });
  await page.goto(base + '/read-only.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#readToken').fill(token);
  await page.locator('#connect').click();
  await page.waitForFunction(() => document.getElementById('connectionStatus').textContent === 'Consulta actualizada.');
  assert.match(await page.locator('#content').innerText(), /Estado de sincronización/);
  pass('hosted_status_authenticated');
  await page.locator('[data-view="sales"]').click();
  await page.waitForFunction(() => document.querySelector('#content h2')?.textContent === 'Ventas sincronizadas');
  const sale = page.locator('#content .item').filter({ has: page.locator('strong', { hasText: saleId }) }).filter({ hasText: expected.deviceId });
  assert.equal(await sale.count(), 1);
  await sale.getByRole('button', { name: 'Ver líneas' }).click();
  await page.waitForFunction(() => document.querySelector('#content h2')?.textContent.startsWith('Líneas de '));
  assert.match(await page.locator('#content').innerText(), /RC-V12-TEST/);
  pass('hosted_expected_sale_and_lines');
  await page.locator('[data-view="inventory-movements"]').click();
  await page.waitForFunction(() => document.querySelector('#content h2')?.textContent === 'Movimientos de inventario');
  assert.match(await page.locator('#content').innerText(), new RegExp(expected.deviceId));
  pass('hosted_expected_inventory');
  const content = await page.content();
  assert.equal(content.includes(token), false);
  assert.equal(await page.evaluate(() => typeof window.NuevoAmanecerOutbox), 'undefined');
  assert.ok(requests.length >= 4 && requests.every(r => r.method === 'GET'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  pass('hosted_reader_get_only_no_overflow_no_errors');
  await page.screenshot({ path: new URL('reader-hosted.png', evidence).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true, mask: [page.locator('#readToken')] });
  writeFileSync(new URL('hosted-reader.json', evidence), JSON.stringify({ at: new Date().toISOString(), url: base + '/read-only.html', checks, requests, physicalSecondDevice: false, viewport: '390x844' }, null, 2) + '\n');
  console.log('HOSTED_READER 4 PASS / 0 FAIL');
} finally { await browser.close(); }
