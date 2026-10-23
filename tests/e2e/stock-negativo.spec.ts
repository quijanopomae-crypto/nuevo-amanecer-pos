import { test, expect, type Page } from '@playwright/test';

// CM-073 · Stock negativo con ajuste seguro. Datos sintéticos, modo local. El candado real está cerrado;
// la prueba lo abre solo en el navegador de prueba reescribiendo la respuesta de pos-permissions.js.
async function rolePage(page: Page, role: 'owner' | 'empleado', unlock = true) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'sn-test-device' } : url.pathname === '/auth/purchases' ? { purchases: [], truncated: false } : {}) });
    if (!unlock && url.hostname === '127.0.0.1' && url.pathname.endsWith('/js/config/pos-permissions.js')) {
      const res = await route.fetch(); const body = (await res.text()).replace("'stock-negativo-configurable': false", "'stock-negativo-configurable': true");
      return route.fulfill({ response: res, body });
    }
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'sn-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
}
async function seed(page: Page) {
  await page.evaluate(() => (window as any).eval(`
    productos=[{id:'sn-1',name:'Galleta soda',sku:'SN-01',stock:-3,costo:1.2,precio:2,controlInventario:true},{id:'sn-2',name:'Pan',sku:'SN-02',stock:5,controlInventario:true}];
    inventoryMovements=[]; ventas=[];
  `));
}
async function open(page: Page) {
  await page.evaluate(() => (window as any).goPage('pageAjustesInventario'));
  await expect(page.locator('#pageAjustesInventario')).toBeVisible();
  await page.evaluate(() => (window as any).NA_STOCK_NEGATIVO.render());
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño regulariza stock negativo a ${width}px ${dark ? 'oscuro' : 'claro'} con confirmación y sin duplicar`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner'); await seed(page);
    await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
    await open(page);
    const box = page.locator('[data-sn-root]');
    await expect(box).toBeVisible();
    const rows = box.locator('[data-sn-row]');
    await expect(rows).toHaveCount(1);
    const row = rows.first();
    await expect(row.locator('[data-sn-target]')).toHaveValue('');
    await row.locator('[data-sn-review]').click();
    await expect(row.locator('[data-sn-confirm]')).toBeHidden();
    await expect(row.locator('[data-sn-message]')).toContainText('Escribe el stock final');
    expect(await page.evaluate(() => (window as any).eval('inventoryMovements.length'))).toBe(0);
    await row.locator('[data-sn-target]').fill('4');
    await row.locator('[data-sn-review]').click();
    await expect(row.locator('[data-sn-summary]')).toContainText('-3 → 4');
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noScroll).toBe(true);
    await row.locator('[data-sn-apply]').dblclick();
    await expect(box.locator('[data-sn-row]')).toHaveCount(0);
    await expect(box).toContainText('No hay productos con stock negativo.');
    const st = await page.evaluate(() => (window as any).eval('JSON.stringify({s:productos[0].stock,c:productos[0].costo,m:inventoryMovements.map(m=>[m.type,m.delta,m.source])})'));
    expect(JSON.parse(st)).toEqual({ s: 4, c: 1.2, m: [['ENTRADA', 7, 'ADJUSTMENT']] });
    await page.screenshot({ path: `test-results/sn-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: false });
  });
}

test('candado cerrado (rollback): no aparece la sección de stock negativo', async ({ page }) => {
  await rolePage(page, 'owner', false); await seed(page); await open(page);
  await expect(page.locator('[data-sn-root]')).toHaveCount(0);
});

test('empleado: no aparece aunque el candado esté abierto', async ({ page }) => {
  await rolePage(page, 'empleado'); await seed(page);
  await page.evaluate(() => (window as any).NA_STOCK_NEGATIVO.render());
  await expect(page.locator('[data-sn-root]')).toHaveCount(0);
});
