import { test, expect, type Page } from '@playwright/test';

async function prepare(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  if (width >= 768) {
    await page.locator('[data-menu-target="pagePOS"]').click();
  } else {
    await page.locator('#naMobileMenuToggle').click();
    const next = page.getByRole('button', { name: 'Nueva venta', exact: true });
    if (await next.isVisible()) await next.click();
    else await page.locator('.module-card').first().click();
  }
  await page.evaluate(() => {
    window.eval(`productos=[{id:'SUMMARY-A',name:'Producto prueba',cat:'abarrotes',precio:4.50,costo:2,stock:10,stockMin:1,icon:'📦'}]; clientes=[]; cart=[]; appConfig.igvActive=true; posRender(); posUpdateCart();`);
  });
  await page.locator('[data-product-id="SUMMARY-A"]').click();
  if (width <= 1099) await page.locator('.cart-fab').click();
  if (width >= 701) await expect(page.locator('#posProductCount')).toHaveText('Nro. de productos: 1');
  await expect(page.locator('#posTotal')).toHaveText('S/ 4.50');
}

async function setIgVisible(page: Page, visible: boolean) {
  await page.evaluate(value => {
    localStorage.setItem('na_show_igv_line', value ? '1' : '0');
    (window as any).NA_CONFIG_E2.syncIgvRow();
  }, visible);
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('#pagePOS .cart-totals')!;
    const count = document.querySelector('#pagePOS .cart-count-line')!;
    const main = document.querySelector('#pagePOS .total-main')!;
    const rect = bar.getBoundingClientRect();
    const countRect = count.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return {
      barHeight: rect.height,
      columnCount: getComputedStyle(bar).gridTemplateColumns.trim().split(/\s+/).length,
      counterAbove: countRect.bottom <= rect.top + 1,
      counterInside: countRect.top >= rect.top - 1 && countRect.bottom <= rect.bottom + 1,
      totalInside: mainRect.left >= rect.left && mainRect.right <= rect.right + 1,
    };
  });
}

for (const width of [768, 1366]) {
  test(`PC/tablet ${width}px: mismo alto, tres columnas con IGV y dos sin él`, async ({ page }) => {
    await prepare(page, width);
    await setIgVisible(page, true);
    await expect(page.locator('#pagePOS .total-row').first()).toBeVisible();
    await expect(page.locator('#pagePOS .total-row').nth(1)).toBeVisible();
    expect(await geometry(page)).toMatchObject({
      barHeight: 44, columnCount: 3, counterAbove: true, totalInside: true,
    });

    await setIgVisible(page, false);
    await expect(page.locator('#pagePOS .total-row').first()).toBeHidden();
    await expect(page.locator('#pagePOS .total-row').nth(1)).toBeHidden();
    expect(await geometry(page)).toMatchObject({
      barHeight: 44, columnCount: 2, counterInside: true, totalInside: true,
    });
    await expect(page.locator('#posProductCount')).toHaveText('Nro. de productos: 1');
    await expect(page.locator('#posTotal')).toHaveText('S/ 4.50');

    await setIgVisible(page, true);
    expect(await geometry(page)).toMatchObject({ barHeight: 44, columnCount: 3, counterAbove: true });
    await expect(page.locator('#posTotal')).toHaveText('S/ 4.50');
  });
}

test('teléfono 390px mantiene subtotal y estructura anterior cuando se oculta IGV', async ({ page }) => {
  await prepare(page, 390);
  await setIgVisible(page, false);
  await expect(page.locator('#pagePOS .total-row').first()).toBeVisible();
  await expect(page.locator('#pagePOS .total-row').nth(1)).toBeHidden();
  // El diseño de teléfono es el legado: su contenedor no es la barra verde.
  const mobile = await page.evaluate(() => ({
    wrapper: getComputedStyle(document.querySelector('#pagePOS .cart-totals')!).backgroundColor,
    total: getComputedStyle(document.querySelector('#pagePOS .total-main')!).backgroundColor,
  }));
  expect(mobile.wrapper).not.toBe(mobile.total);
  await expect(page.locator('#posTotal')).toHaveText('S/ 4.50');
});
