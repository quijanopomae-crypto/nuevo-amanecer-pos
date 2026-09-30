import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Fresh local contexts only: no production authority or customer data.
const root = resolve('POS'), output = resolve(process.env.MOTION_OUTPUT || 'outputs/canon-motion');
await mkdir(output, { recursive: true });
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.json':'application/json' };
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const file = path === root ? resolve(root, 'index.html') : path;
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'no-preference' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.NA_MOTION?.scroll);
    await page.evaluate(() => { window.__entries = []; window.addEventListener('animationstart', e => window.__entries.push(e.animationName)); goPage('pageClientes'); });
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => ({ active: document.querySelector('.page.active')?.id, entries: window.__entries, scroll: NA_MOTION.scroll.inspect('pageClientes'), body: document.body.className }));
    console.log(JSON.stringify({ width, state, errors }));
    assert.equal(state.active, 'pageClientes');
    assert.ok(state.entries.includes('na-page-arrive'));
    assert.equal(state.scroll.active, width <= 700);
    await page.screenshot({ path: resolve(output, `clientes-${width}.png`), fullPage: false });
    if (width <= 700) {
      await page.evaluate(() => { const spacer = document.createElement('div'); spacer.style.height = '1600px'; document.querySelector('#pageClientes').append(spacer); });
      await page.evaluate(() => window.scrollTo(0, 150));
      await page.waitForTimeout(120);
      assert.ok((await page.evaluate(() => NA_MOTION.scroll.inspect('pageClientes'))).progress > 0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(100);
      assert.equal((await page.evaluate(() => NA_MOTION.scroll.inspect('pageClientes'))).active, false);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#pageClientes')).animationName), 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
    for (const id of ['pageInventario', 'pageVentas', 'pageCaja', 'pageGastos']) {
      await page.evaluate(id => { goPage(id); }, id);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => document.querySelector('.page.active')?.id), id);
      assert.equal((await page.evaluate(id => NA_MOTION.scroll.inspect(id), id)).active, width <= 700);
    }
    await page.evaluate(() => { abrirModalGasto(); toast('Prueba visual local', 'success'); });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#mGasto > .modal')).animationName), 'na-panel-arrive');
    assert.ok(await page.evaluate(() => document.querySelector('#gToast').classList.contains('na-feedback-enter')));
    await page.screenshot({ path: resolve(output, `modal-${width}.png`), fullPage: false });
    await page.evaluate(() => {
      const overlay = document.querySelector('#mGasto'), panel = overlay.firstElementChild;
      panel.classList.add('na-motion-panel');
      NA_MOTION.modal.bindSwipeDismiss(overlay, { panel });
      const touch = y => new Touch({ identifier: 1, target: panel, clientX: 20, clientY: y });
      panel.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(20)], bubbles: true }));
      panel.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(50)], bubbles: true, cancelable: true }));
      panel.dispatchEvent(new TouchEvent('touchcancel', { touches: [], bubbles: true }));
    });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.querySelector('#mGasto').dataset.naMotionState), 'open');
    await page.evaluate(() => cerrarModal('mGasto'));
    await page.evaluate(() => NA_MOTION.cart.pulse(document.querySelector('.g-topbar')));
    await page.waitForTimeout(70);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.g-topbar')).animationName), 'na-cart-pulse-keyframes');
    await page.evaluate(() => {
      NA_MOTION.core.controller('scroll:pageClientes').destroy();
      if (NA_MOTION.scroll.inspect('pageClientes') !== null) throw new Error('Destroyed controller retained');
      NA_MOTION.scroll.enablePreset('clientes');
    });
    await page.evaluate(() => { goPage('pageClientes'); goPage('pageVentas'); });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelector('.page.active')?.id), 'pageVentas');
    assert.deepEqual(errors, []);
    console.log(`CANON_MOTION_BROWSER_PASS width=${width} modules=5 native-scroll reduced-motion modal feedback rapid-navigation`);
    await context.close();
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
