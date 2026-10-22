import { test, expect, type Page } from '@playwright/test';
import { expectAllFit } from './helpers/fits';

// #164: panel de tesorería dentro del reporte de arqueo (solo dueño), réplica sintética y sin backend real.
async function rolePage(page: Page, role: 'owner' | 'empleado') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'pt-test-device' } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'pt-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
}
// Abre el candado solo dentro del navegador de prueba; pos-permissions.js no cambia.
async function unlock(page: Page) {
  await page.evaluate(() => {
    const w = window as any, original = w.NA_PERMISSIONS;
    w.NA_PERMISSIONS = { ...original, featureLocked: (id: string) => id === 'dashboard-tesoreria' ? false : original.featureLocked(id) };
  });
}
async function seed(page: Page) {
  await page.evaluate(() => {
    const win = window as any;
    const today = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
    const at = (time: string) => new Date(today + 'T' + time + ':00-05:00').toISOString();
    const snapshot = Object.freeze({
      cashSessions: [
        { session_id: 't1', status: 'OPEN', opened_at: at('08:00'), closed_at: null, opening_cents: 5000, expected_cents: 105000, opened_by_name: 'Cajera Ana' },
        { session_id: 't2', status: 'OPEN', opened_at: at('14:30'), closed_at: null, opening_cents: 2000, expected_cents: 2000, opened_by_name: 'Cajero Luis con nombre bastante largo' },
      ],
      cashMovements: [
        { session_id: 't1', sale_id: 'a', amount_cents: 150000, cash_cents: 100000, digital_cents: 50000, digital_method: 'yape', credit_cents: 0 },
        { session_id: 't2', sale_id: 'b', amount_cents: 5050, cash_cents: 0, digital_cents: 2050, digital_method: 'plin', credit_cents: 3000 },
      ],
      financialEvents: [], expenses: [],
    });
    win.__ptRefresh = 0;
    win.NuevoAmanecerCanonical = Object.assign({}, win.NuevoAmanecerCanonical, {
      snapshot: () => snapshot, refresh: () => { win.__ptRefresh++; throw new Error('no refrescar'); },
    });
  });
}
async function openAndRender(page: Page) {
  await page.evaluate(() => { (document.querySelector('[data-pt-details]') as HTMLDetailsElement).open = true; (window as any).NA_PANEL_TESORERIA.render(); });
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`tesorería ${width}px ${dark ? 'oscuro' : 'claro'}: efectivo por caja, por acreditar y total, sin escrituras`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner'); await unlock(page); await seed(page);
    const writes: string[] = [];
    page.on('request', r => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method())) writes.push(r.method() + ' ' + r.url()); });
    await page.evaluate(dark => { document.body.classList.toggle('dark', dark); (window as any).goPage('pageReporteArqueo'); }, dark);
    const sec = page.locator('#pageReporteArqueo [data-pt-section]');
    await expect(sec).toBeVisible();
    await expect(sec.locator('table')).toHaveCount(0); // plegado
    await sec.locator('summary').click();
    await expect(sec.locator('tbody tr')).toHaveCount(2);
    await expect(sec.locator('.pt-card strong')).toHaveText(['S/ 1,070.00', 'S/ 520.50', 'S/ 1,590.50']);
    await expect(sec.locator('tfoot th')).toHaveText('Total · 2 cajas');
    await expect(sec.locator('tfoot td')).toHaveText(['S/ 1,070.00', 'S/ 500.00', 'S/ 20.50', 'S/ 0.00', 'S/ 520.50', 'S/ 1,590.50']);
    await expect(sec).not.toContainText(/costo|tarjeta/i);
    await expectAllFit(sec, 'h2,p,.pt-card');
    const box = await page.locator('#pageReporteArqueo').boundingBox();
    const wrap = await sec.locator('.pt-table-wrap').boundingBox();
    expect(wrap!.x).toBeGreaterThanOrEqual(box!.x - 1);
    expect(wrap!.x + wrap!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => (window as any).__ptRefresh)).toBe(0);
  });
}

test('empleado con el candado abierto: la sección no se muestra', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await rolePage(page, 'empleado'); await unlock(page); await seed(page); await openAndRender(page);
  await expect(page.locator('[data-pt-section]')).toBeHidden();
  await expect(page.locator('[data-pt-section] table')).toHaveCount(0);
});
test('dueño con el candado real cerrado: la sección no se muestra', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await rolePage(page, 'owner'); await seed(page); await openAndRender(page);
  await expect(page.locator('[data-pt-section]')).toBeHidden();
  await expect(page.locator('[data-pt-section] table')).toHaveCount(0);
});
