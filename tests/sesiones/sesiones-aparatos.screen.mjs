// Pruebas de pantalla #141 (Chromium headless). El candado se abre SOLO dentro del navegador de prueba
// (addInitScript); pos-permissions.js no se modifica. API simulada con page.route; sin red externa.
// Uso: node tests/sesiones/sesiones-aparatos.screen.mjs  (puerto temporal SA_PORT, por defecto 4392)
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
const PORT = Number(process.env.SA_PORT || 4392);
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
    set: (x) => { v = Object.freeze({ ...x, featureLocked: (id) => (id === 'sesion-unica-usuario' ? false : x.featureLocked(id)) }); } });
};
const DEVICES = () => [
  { device_id: 'session:owner-phone', status: 'active', created_at: '2026-09-01T15:00:00.000Z', last_seen_at: '2026-10-22T02:30:00.000Z', pos_role: 'owner', label: null, current: true },
  { device_id: 'session:caja2', status: 'active', created_at: '2026-10-01T03:00:00.000Z', last_seen_at: '2026-10-21T20:00:00.000Z', pos_role: 'empleado', label: 'Caja 2 de Rosa con un nombre bastante largo', current: false },
  { device_id: 'session:old', status: 'revoked', created_at: '2026-08-01T12:00:00.000Z', last_seen_at: null, pos_role: 'empleado', label: 'Viejo', current: false }
];

async function open(browser, { width, dark, role, unlocked }) {
  const page = await browser.newPage({ viewport: { width, height: 850 }, colorScheme: dark ? 'dark' : 'light' });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const net = { list: 0, revoke: [] }; let devices = DEVICES();
  await page.route('**/*', (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'permissions.test') {
      let body = {};
      if (url.pathname === '/auth/me') body = { pos_role: role || null, owner_pin_set: false, roles_ready: true, device_id: 'session:owner-phone' };
      else if (url.pathname === '/auth/devices') { net.list++; assert.equal(req.method(), 'POST'); assert.match(req.headers().authorization, /^Bearer /); body = { devices }; }
      else if (url.pathname === '/auth/devices/revoke') {
        const b = JSON.parse(req.postData() || '{}'); net.revoke.push(b);
        if (b.device_id === 'session:owner-phone') return route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"cannot_revoke_self"}' });
        devices = devices.map(d => d.device_id === b.device_id ? { ...d, status: 'revoked' } : d); body = { status: 'revoked', device_id: b.device_id };
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.addInitScript((role) => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic' }));
    if (role) localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  if (unlocked) await page.addInitScript(UNLOCK);
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => !!globalThis.NA_SESIONES && !!globalThis.NA_ROLES);
  if (role) await page.waitForFunction((r) => globalThis.NA_ROLES.role === r && globalThis.NA_ROLES.confirmed, role);
  else await page.evaluate(() => { const r = globalThis.NA_ROLES; globalThis.NA_ROLES = new Proxy(r, { get: (t, k) => k === 'role' ? '' : k === 'isOwner' ? () => false : t[k] }); });
  await page.evaluate((d) => { try { NA_THEME.setMode(d ? 'noche' : 'claro'); } catch { document.body.classList.toggle('dark', d); } }, dark);
  return { page, net, errs };
}
const goScreen = (page) => page.evaluate(() => { goPage('pageSesionesAparatos'); return document.getElementById('pageSesionesAparatos').classList.contains('active'); });
const results = [];
const browser = await chromium.launch();
try {
  for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
    const tag = `${width}px ${dark ? 'oscuro' : 'claro'}`;
    // 1) Dueño con candado abierto (solo en este navegador)
    { const { page, net, errs } = await open(browser, { width, dark, role: 'owner', unlocked: true });
      assert.equal(await page.evaluate(() => NA_PERMISSIONS.featureLocked('sesion-unica-usuario')), false);
      assert.ok(await goScreen(page), tag + ': pantalla activa');
      const s = page.locator('#pageSesionesAparatos');
      await s.locator('.sa-item').first().waitFor();
      assert.equal(await s.locator('.sa-item').count(), 2, tag + ': solo sesiones activas');
      const cur = s.locator('.sa-item[data-sa-current]');
      assert.equal(await cur.locator('.sa-badge').textContent(), 'Este aparato');
      assert.equal(await cur.locator('button').count(), 0, tag + ': sin botón en el propio aparato');
      assert.match(await cur.textContent(), /01\/09\/2026 10:00.*21\/10\/2026 21:30/);
      const other = s.locator('.sa-item[data-sa-device="session:caja2"]');
      assert.match(await other.textContent(), /30\/09\/2026 22:00/, tag + ': hora de Lima');
      const bg = await s.evaluate(el => getComputedStyle(el).backgroundColor);
      assert.equal(bg, dark ? 'rgb(15, 23, 42)' : 'rgb(248, 250, 252)', tag + ': tema');
      assert.ok(await s.evaluate(el => { const B = el.getBoundingClientRect(); return [...el.querySelectorAll('.sa-item, button')].every(n => { const b = n.getBoundingClientRect(); return b.left >= B.left - 1 && b.right <= B.right + 1; }) && document.documentElement.scrollWidth <= innerWidth + 1; }), tag + ': sin desborde');
      // Cancelar no llama al Worker
      await other.locator('button.sa-revoke').click();
      await page.locator('#naConfirm.open').waitFor();
      assert.match(await page.locator('#naConfirmBody').textContent(), /Caja 2 de Rosa/);
      await page.locator('#naConfirmCancel').click();
      await page.waitForTimeout(150); assert.equal(net.revoke.length, 0, tag + ': cancelar no cierra');
      // Confirmar cierra y recarga la lista
      await other.locator('button.sa-revoke').click();
      await page.locator('#naConfirm.open').waitFor(); await page.locator('#naConfirmOk').click();
      await page.waitForFunction(() => document.querySelectorAll('#pageSesionesAparatos .sa-item').length === 1);
      assert.deepEqual(net.revoke, [{ device_id: 'session:caja2' }]);
      assert.equal(await page.evaluate(() => NA_PERMISSIONS.FEATURE_LOCKS['sesion-unica-usuario']), true, 'archivo intacto');
      await page.screenshot({ path: `/tmp/sesiones-141-${width}-${dark ? 'dark' : 'light'}.png` });
      assert.deepEqual(errs.filter(e => /sesion|NA_SESIONES/i.test(e)), []);
      results.push(tag + ' dueño abierto: ok'); await page.close(); }
    // 2) Dueño con candado cerrado (archivo real)
    { const { page, net } = await open(browser, { width, dark, role: 'owner', unlocked: false });
      await goScreen(page); await page.evaluate(() => NA_SESIONES.load()); await page.waitForTimeout(150);
      assert.equal(await page.locator('#pageSesionesAparatos [data-sa-list]').textContent(), 'Esta función todavía no está disponible.');
      assert.equal(await page.locator('#pageSesionesAparatos .sa-item').count(), 0);
      assert.ok(await page.locator('#pageSesionesAparatos [data-sa-controls]').isHidden());
      assert.equal(net.list, 0, tag + ': cerrado no consulta');
      results.push(tag + ' candado cerrado: ok'); await page.close(); }
    // 3) Empleado con candado abierto
    { const { page, net } = await open(browser, { width, dark, role: 'empleado', unlocked: true });
      await goScreen(page); await page.evaluate(() => NA_SESIONES.load()); await page.waitForTimeout(150);
      assert.equal(await page.locator('#pageSesionesAparatos [data-sa-list]').textContent(), 'Sin permiso. Solo el dueño puede ver esta pantalla.');
      assert.equal(await page.evaluate(() => document.getElementById('pageSesionesAparatos').classList.contains('active')), false, tag + ': empleado no entra');
      assert.equal(net.list, 0); assert.equal(net.revoke.length, 0);
      results.push(tag + ' empleado: ok'); await page.close(); }
  }
  // 4) Rol desconocido, candado abierto: falla cerrado
  { const { page, net } = await open(browser, { width: 390, dark: false, role: '', unlocked: true });
    assert.equal(await page.evaluate(() => NA_SESIONES.load()), false);
    assert.equal(await page.locator('#pageSesionesAparatos [data-sa-list]').textContent(), 'Sin permiso. Solo el dueño puede ver esta pantalla.');
    assert.equal(net.list, 0);
    results.push('rol desconocido: ok'); await page.close(); }
  // 5) Si el Worker responde 409 al propio aparato, no se cierra nada (llamada directa forzada)
  { const { page, net } = await open(browser, { width: 1280, dark: false, role: 'owner', unlocked: true });
    assert.equal(await page.evaluate(() => NA_SESIONES.revoke({ id: 'session:owner-phone', label: 'yo', current: true })), false);
    assert.equal(net.revoke.length, 0);
    results.push('propio aparato protegido: ok'); await page.close(); }
} finally { await browser.close(); server.close(); }
console.log(results.join('\n')); console.log(`${results.length}/${results.length} ok`);
