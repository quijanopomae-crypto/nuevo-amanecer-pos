// Pruebas de pantalla #9 (headless Chromium). El candado se abre SOLO dentro
// del navegador de prueba; pos-permissions.js no se modifica.
// Uso: node tests/ventas-espera/ventas-espera.screen.mjs  (puerto temporal VE_PORT, por defecto 4391)
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '@playwright/test', '/workspace/na-pos-cxc/node_modules/playwright']) { try { ({ chromium } = require(p)); break; } catch {} }
if (!chromium) { console.log('SKIP: playwright no disponible'); process.exit(0); }

const POS = path.resolve(new URL('../../POS', import.meta.url).pathname);
const PORT = Number(process.env.VE_PORT || 4391);
assert.notEqual(PORT, 4173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(POS, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!f.startsWith(POS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1');

const UNLOCK = () => {
  let v;
  Object.defineProperty(globalThis, 'NA_PERMISSIONS', { configurable: true, get: () => v,
    set: (x) => { v = Object.freeze({ ...x, featureLocked: (id) => (id === 'ventas-espera' ? false : x.featureLocked(id)) }); } });
};
const MONEY = /^S\/ \d{1,3}(,\d{3})*\.\d{2}$/;
const results = [];
const browser = await chromium.launch();
try {
  for (const w of [390, 768, 1280]) for (const theme of ['light', 'dark']) for (const unlocked of [true, false]) {
    const name = `${w}px ${theme} ${unlocked ? 'abierto' : 'cerrado'}`;
    const page = await browser.newPage({ viewport: { width: w, height: 800 }, colorScheme: theme });
    const errs = []; page.on('pageerror', (e) => { if (/espera/i.test(e.message)) errs.push(e.message); });
    if (unlocked) await page.addInitScript(UNLOCK);
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.waitForFunction(() => !!globalThis.NA_VENTAS_ESPERA);
    await page.waitForTimeout(800);
    await page.evaluate((dark) => { document.body.classList.toggle('dark', dark); try { goPage('pagePOS'); } catch {} }, theme === 'dark');
    await page.waitForTimeout(400);
    const posActive = await page.evaluate(() => document.getElementById('pagePOS')?.classList.contains('active'));
    assert.ok(posActive, name + ': pagePOS activa');
    if (!unlocked) {
      assert.equal(await page.locator('#btnHoldSale, #btnHeldSales').count(), 0, name);
      await page.evaluate(() => NA_VENTAS_ESPERA.abrirLista());
      assert.equal(await page.locator('#naHeldSalesOverlay').count(), 0, name);
      assert.deepEqual(errs, []); results.push(name + ': ok'); await page.close(); continue;
    }
    assert.equal(await page.locator('#cartMenuDropdown #btnHoldSale').count(), 1, name);
    assert.equal(await page.locator('#cartMenuDropdown #btnHeldSales').count(), 1, name);
    // Venta 1 (ids negativos = venta libre, no dependen del catálogo)
    const hold = async (items) => {
      await page.evaluate((it) => { cart.length = 0; it.forEach((x) => cart.push(x)); posUpdateCart(); toggleCartMenu(); }, items);
      await page.locator('#btnHoldSale').click();
      await page.waitForFunction(() => cart.length === 0);
    };
    await hold([{ id: -901, nombre: 'Prueba A', precio: 1250.5, qty: 2 }]);
    await hold([{ id: -902, nombre: 'Prueba B', precio: 3, qty: 1 }]);
    assert.equal(await page.evaluate(() => NA_VENTAS_ESPERA.list().length), 2);
    await page.evaluate(() => toggleCartMenu());
    await page.locator('#btnHeldSales').click();
    const rows = page.locator('#naHeldSalesBody .na-held-row');
    assert.equal(await rows.count(), 2);
    const totals = await rows.evaluateAll((r) => r.map((x) => x.children[1].textContent));
    totals.forEach((t) => assert.match(t, MONEY));
    assert.equal(totals[0], 'S/ 2,501.00');
    const ov = await page.evaluate(() => {
      const m = document.querySelector('#naHeldSalesOverlay .modal').getBoundingClientRect();
      const rowsOk = [...document.querySelectorAll('.na-held-row')].every((r) => r.scrollWidth <= r.clientWidth + 1);
      return { fits: m.left >= -1 && m.right <= innerWidth + 1, rowsOk, page: document.documentElement.scrollWidth <= innerWidth + 1 };
    });
    assert.deepEqual(ov, { fits: true, rowsOk: true, page: true }, name);
    // Retomar la primera (confirmación del carrito no aplica: carrito vacío)
    await rows.nth(0).locator('button', { hasText: 'Retomar' }).click();
    await page.waitForFunction(() => cart.length === 1 && NA_VENTAS_ESPERA.list().length === 1);
    assert.equal(await page.locator('#naHeldSalesOverlay').count(), 0);
    // Eliminar la restante
    await page.evaluate(() => NA_VENTAS_ESPERA.abrirLista());
    await page.locator('#naHeldSalesBody button[title="Eliminar"]').click();
    const ok = page.locator('#naConfirmOk');
    if (await ok.isVisible().catch(() => false)) await ok.click();
    await page.waitForFunction(() => NA_VENTAS_ESPERA.list().length === 0);
    assert.equal(await page.locator('#naHeldSalesBody .empty-state').textContent(), 'No hay ventas en espera');
    assert.deepEqual(errs, []);
    results.push(name + ': ok'); await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(results.join('\n')); console.log(`# pass ${results.length}`);
