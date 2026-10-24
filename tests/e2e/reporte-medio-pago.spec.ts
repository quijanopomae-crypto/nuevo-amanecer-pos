import { test, expect, type Page } from '@playwright/test';
import { expectAllFit } from './helpers/fits';
import { isAssistantPing } from './helpers/known-background-requests';

// #159: sección dentro del reporte de arqueo (solo dueño), réplica sintética y sin backend real.
async function rolePage(page: Page, role: 'owner' | 'empleado') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'rmp-test-device' } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'rmp-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
}
// Abre el candado solo dentro del navegador de prueba; pos-permissions.js no cambia.
async function unlock(page: Page) {
  await page.evaluate(() => {
    const w = window as any, original = w.NA_PERMISSIONS;
    w.NA_PERMISSIONS = { ...original, featureLocked: (id: string) => id === 'reporte-medio-pago' ? false : original.featureLocked(id) };
  });
}
async function seed(page: Page) {
  await page.evaluate(() => {
    const win = window as any;
    const today = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
    const at = (time: string) => new Date(today + 'T' + time + ':00-05:00').toISOString();
    const snapshot = Object.freeze({
      cashSessions: [
        { session_id: 'm1', status: 'CLOSED', opened_at: at('08:00'), closed_at: at('14:00'), opened_by_name: 'Cajera Ana', closed_by_name: 'Cajera Ana' },
        { session_id: 'm2', status: 'CLOSED', opened_at: at('14:30'), closed_at: at('22:00'), opened_by_name: 'Cajero Luis con nombre bastante largo', closed_by_name: 'Cajero Luis con nombre bastante largo' },
      ],
      cashMovements: [
        { session_id: 'm1', sale_id: 'a', amount_cents: 150000, cash_cents: 100000, digital_cents: 50000, digital_method: 'yape', credit_cents: 0 },
        { session_id: 'm2', sale_id: 'b', amount_cents: 2050, cash_cents: 0, digital_cents: 2050, digital_method: 'plin', credit_cents: 0 },
      ],
      financialEvents: [], expenses: [],
    });
    win.__rmpRefresh = 0;
    win.NuevoAmanecerCanonical = Object.assign({}, win.NuevoAmanecerCanonical, {
      snapshot: () => snapshot, refresh: () => { win.__rmpRefresh++; throw new Error('no refrescar'); },
    });
  });
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`medios de pago ${width}px ${dark ? 'oscuro' : 'claro'}: totales, filtro de cajero, CSV y sin escrituras`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner'); await unlock(page); await seed(page);
    const writes: string[] = [];
    page.on('request', r => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method()) && !isAssistantPing(r)) writes.push(r.method() + ' ' + r.url()); });
    await page.evaluate(dark => { document.body.classList.toggle('dark', dark); (window as any).goPage('pageReporteArqueo'); }, dark);
    const sec = page.locator('#pageReporteArqueo [data-rmp-section]');
    await expect(sec).toBeVisible();
    await expect(sec.locator('table')).toHaveCount(0); // plegado: no pinta nada hasta abrirlo
    await sec.locator('summary').click();
    await expect(sec.locator('tbody tr')).toHaveCount(2);
    await expect(sec.locator('tfoot th')).toHaveText('Total · 2 turnos');
    await expect(sec.locator('tfoot td')).toHaveText(['S/ 1,000.00', 'S/ 500.00', 'S/ 20.50', 'S/ 0.00', 'S/ 0.00', 'S/ 1,520.50', 'S/ 1,520.50', 'S/ 0.00']);
    await expect(sec).not.toContainText(/costo/i);
    await sec.locator('[data-rmp-cajero]').selectOption('Cajera Ana');
    await expect(sec.locator('tbody tr')).toHaveCount(1);
    await expect(sec.locator('tfoot td').nth(5)).toHaveText('S/ 1,500.00');
    await expectAllFit(sec, 'h2,p,label,input,select,button');
    const box = await page.locator('#pageReporteArqueo').boundingBox();
    const wrap = await sec.locator('.rmp-table-wrap').boundingBox();
    expect(wrap!.x).toBeGreaterThanOrEqual(box!.x - 1);
    expect(wrap!.x + wrap!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
    const download = page.waitForEvent('download');
    await sec.locator('[data-rmp-export]').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^medios-pago-turno-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => (window as any).__rmpRefresh)).toBe(0);
  });
}

test('empleado: la sección no se muestra', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await rolePage(page, 'empleado'); await seed(page);
  await page.evaluate(() => { (document.querySelector('[data-rmp-details]') as HTMLDetailsElement).open = true; (window as any).NA_REPORTE_MEDIO_PAGO.render(); });
  await expect(page.locator('[data-rmp-section]')).toBeHidden();
  await expect(page.locator('[data-rmp-section] table')).toHaveCount(0);
});

test('dueño con el candado cerrado: la sección no se muestra', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await rolePage(page, 'owner'); await seed(page);
  await page.evaluate(() => { (document.querySelector('[data-rmp-details]') as HTMLDetailsElement).open = true; (window as any).NA_REPORTE_MEDIO_PAGO.render(); });
  await expect(page.locator('[data-rmp-section]')).toBeHidden();
  await expect(page.locator('[data-rmp-section] table')).toHaveCount(0);
});
