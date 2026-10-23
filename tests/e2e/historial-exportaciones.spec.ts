import { test, expect, type Page } from '@playwright/test';

// #95 Historial de exportaciones. HTML y scripts reales; rol sintético; sin red externa.
// Para probar la pantalla desbloqueada se sirve pos-permissions.js con ese candado en false SOLO en la prueba.
async function rolePage(page: Page, role: 'owner' | 'empleado', unlock: boolean) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'hx-test', label: 'Caja 1' } : {}) });
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (unlock && url.pathname.endsWith('/js/config/pos-permissions.js')) {
      const res = await route.fetch(); const body = (await res.text()).replace("'historial-exportaciones': true", "'historial-exportaciones': false");
      return route.fulfill({ response: res, body });
    }
    return route.continue();
  });
  await page.addInitScript(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.goto('/index.html');
  await page.waitForFunction(role => (window as any).NA_HISTORIAL_EXPORTACIONES && (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
}
const snapshot = (page: Page) => page.evaluate(() => JSON.stringify(
  ['pagePOS', 'pageMenu', 'naMobileDrawer'].map(id => (document.getElementById(id)?.innerHTML || '').replace(/ data-scanner-ready="true"| style=""| data-motion="[a-z]*"/g, '').replace(/(<main[^>]*id="posArea"[^>]*>)[\s\S]*?(<\/main>)/, '$1$2'))
));

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  const theme = dark ? 'oscuro' : 'claro';
  test(`dueño ve el historial tras exportar un CSV en ${width}px, tema ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner', true);
    await page.evaluate(dark => (window as any).NA_THEME.setMode(dark ? 'noche' : 'claro'), dark);
    const before = await snapshot(page);
    await page.evaluate(() => {
      // @ts-ignore POS runtime globals
      productos = [{ id: 'hx1', name: 'Arroz sintético', stock: 4, costo: 3.21 }]; ventas = [];
      (window as any).goPage('pageProductosSinMovimiento');
    });
    const dl = page.waitForEvent('download');
    await page.locator('#pageProductosSinMovimiento [data-psm-export]').click();
    expect((await dl).suggestedFilename()).toMatch(/^productos-sin-movimiento-/);
    await page.waitForFunction(() => (window as any).NA_HISTORIAL_EXPORTACIONES.load()[0]?.rows != null);
    await page.evaluate(() => (window as any).goPage('pageHistorialExportaciones'));
    const screen = page.locator('#pageHistorialExportaciones');
    await expect(screen).toHaveClass(/\bactive\b/);
    const row = screen.locator('[data-hx-row]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Productos sin movimiento');
    await expect(row).toContainText('CSV');
    await expect(row).toContainText('Dueño · Caja 1');
    await expect(row.locator('td[data-label="Filas"]')).toHaveText('1');
    await expect(screen.locator('[data-hx-status]')).toContainText('hora de Lima');
    for (const leak of ['3.21', 'Arroz']) expect(await screen.textContent()).not.toContain(leak);
    await expect(screen).toHaveCSS('background-color', dark ? 'rgb(15, 23, 42)' : 'rgb(248, 250, 252)');
    expect(await screen.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('tr, button, select')).every(n => { const b = n.getBoundingClientRect(); return b.left >= bounds.left - 1 && b.right <= bounds.right + 1; })
        && document.documentElement.scrollWidth <= window.innerWidth + 1;
    })).toBe(true);
    await page.screenshot({ path: `test-results/historial-exportaciones-${width}-${theme}.png` });
    const after = JSON.parse(await snapshot(page)), b = JSON.parse(before);
    expect(after[0]).toBe(b[0]); expect(after[1]).toBe(b[1]);
  });

  test(`empleado no ve el historial en ${width}px, tema ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'empleado', true);
    await page.evaluate(dark => (window as any).NA_THEME.setMode(dark ? 'noche' : 'claro'), dark);
    await page.evaluate(() => (window as any).NA_HISTORIAL_EXPORTACIONES.record({ fileName: 'kardex-secreto.csv', rows: 9 }));
    await page.evaluate(() => (window as any).goPage('pageHistorialExportaciones'));
    await expect(page.locator('#pageHistorialExportaciones')).not.toHaveClass(/\bactive\b/);
    await page.evaluate(() => (window as any).NA_HISTORIAL_EXPORTACIONES.render());
    await expect(page.locator('#pageHistorialExportaciones [data-hx-status]')).toHaveText('Sin permiso. Pídele acceso al dueño.');
    await expect(page.locator('#pageHistorialExportaciones [data-hx-row]')).toHaveCount(0);
    await expect(page.locator('#pageHistorialExportaciones [data-hx-controls]')).toBeHidden();
  });
}

test('candado cerrado: el dueño no ve nada y no se registra', async ({ page }) => {
  await rolePage(page, 'owner', false);
  expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('historial-exportaciones'))).toBe(true);
  await page.evaluate(() => { (window as any).NA_HISTORIAL_EXPORTACIONES.record({ fileName: 'x.csv' }); (window as any).goPage('pageHistorialExportaciones'); (window as any).NA_HISTORIAL_EXPORTACIONES.render(); });
  expect(await page.evaluate(() => localStorage.getItem('na_export_history_v1'))).toBeNull();
  await expect(page.locator('#pageHistorialExportaciones [data-hx-status]')).toHaveText('Esta función todavía no está disponible.');
  await expect(page.locator('#pageHistorialExportaciones [data-hx-controls]')).toBeHidden();
});
