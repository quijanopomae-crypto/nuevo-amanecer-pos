import { test, expect, type Page } from '@playwright/test';

// Abre el candado 'catalogo-desde-pos' solo en el navegador de prueba (no toca pos-permissions.js).
async function openLock(page: Page) {
  await page.addInitScript(() => {
    const w = window as any; let real: any;
    Object.defineProperty(w, 'NA_PERMISSIONS', { configurable: true, get: () => real, set: v => {
      real = v && { ...v, featureLocked: (id: string) => id === 'catalogo-desde-pos' ? false : v.featureLocked(id) };
    } });
  });
}

async function rolePage(page: Page, role: 'owner' | 'empleado', width: number, dark: boolean, unlock = true) {
  if (unlock) await openLock(page);
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'catalogo-test-device' } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'catalogo-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
  await page.evaluate(dark => {
    (window as any).eval(`productos=[
      {id:'c-1',name:'Arroz <b>Costeño</b>',cat:'abarrotes',precio:1234.5,costo:987.65,stock:4,stockMin:1,icon:'📦',precioCaja:50,unidCaja:12},
      {id:'c-2',name:'Gaseosa agotada',cat:'bebidas',precio:2.5,costo:1.11,stock:0,stockMin:1,icon:'🥤'},
      {id:'c-3',name:'Producto oculto',cat:'bebidas',precio:9,stock:3,activo:false}
    ];`);
    document.body.classList.toggle('dark', dark);
    (window as any).goPage('pageInventario');
  }, dark);
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`catálogo del dueño a ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await rolePage(page, 'owner', width, dark);
    await page.locator('#pageInventario .inv-secondary>summary').click();
    const btn = page.locator('#pageInventario .inv-secondary-menu #invCatalogoBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('Generar catálogo');
    await btn.click();
    const dlg = page.locator('#naCatalogoPos');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('[data-cat-item]')).toHaveCount(2);
    await expect(dlg).toContainText('Arroz <b>Costeño</b>');
    await expect(dlg).toContainText('S/ 1,234.50');
    await expect(dlg).not.toContainText('987');
    await expect(dlg).not.toContainText('1.11');
    await expect(dlg).not.toContainText('Caja x12');
    await dlg.locator('[data-cat-wholesale]').check();
    await expect(dlg).toContainText('Caja x12 · S/ 50.00');
    await dlg.locator('[data-cat-stock]').check();
    await expect(dlg.locator('[data-cat-item]')).toHaveCount(1);
    await dlg.locator('[data-cat-stock]').uncheck();
    await dlg.locator('[data-cat-filter]').selectOption('bebidas');
    await expect(dlg.locator('[data-cat-item]')).toHaveCount(1);
    await expect(dlg).toContainText('Gaseosa agotada');
    const box = await dlg.locator('.cat-box').boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await page.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
    await dlg.locator('[data-cat-print]').click();
    await expect.poll(() => page.evaluate(() => (window as any).__printed)).toBe(1);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#pageInventario')).toBeHidden();
    await expect(dlg.locator('.cat-toolbar')).toBeHidden();
    await expect(dlg.locator('.cat-sheet')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/cat-printing/);
  });
}

test('el empleado no ve el botón de catálogo', async ({ page }) => {
  await rolePage(page, 'empleado', 1280, false);
  await page.locator('#pageInventario .inv-secondary>summary').click();
  await expect(page.locator('#pageInventario .inv-secondary-menu')).toBeVisible();
  await expect(page.locator('#invCatalogoBtn')).toHaveCount(0);
  await page.evaluate(() => (window as any).NA_CATALOGO_POS.open());
  await expect(page.locator('#naCatalogoPos')).toHaveCount(0);
});

test('con el candado real cerrado, el dueño no ve el botón ni abre el catálogo', async ({ page }) => {
  await rolePage(page, 'owner', 1280, false, false);
  expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('catalogo-desde-pos'))).toBe(true);
  await page.locator('#pageInventario .inv-secondary>summary').click();
  await expect(page.locator('#pageInventario .inv-secondary-menu')).toBeVisible();
  await expect(page.locator('#invCatalogoBtn')).toHaveCount(0);
  await page.evaluate(() => (window as any).NA_CATALOGO_POS.open());
  await expect(page.locator('#naCatalogoPos')).toHaveCount(0);
});
