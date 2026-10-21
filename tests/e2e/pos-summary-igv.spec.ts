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
  // En tablet el carrito está acoplado: el botón flotante permanece oculto.
  // En teléfono táctil real, el catálogo POS de escritorio está oculto.
  const realPhone = await page.locator('body').evaluate(el => el.classList.contains('na-pos-phone-device'));
  if (realPhone) {
    await expect(page.locator('#pagePOS')).toHaveClass(/phone-sale/);
    await page.evaluate(() => window.eval("posAdd('SUMMARY-A')"));
  } else {
    await page.locator('[data-product-id="SUMMARY-A"]').click();
    if (width <= 700) await page.locator('.cart-fab').click();
  }
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

test.describe('teléfono táctil real sin cambios en el resumen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('conserva los controles móviles existentes con IGV visible y oculto', async ({ page }) => {
    await prepare(page, 390);
    await expect(page.locator('body')).toHaveClass(/na-pos-phone-device/);
    const mobileLayout = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector('#pagePOS .cart-totals')!).display,
      button: getComputedStyle(document.querySelector('#pagePOS #btnPagar')!).display,
      actions: getComputedStyle(document.querySelector('#pagePOS .cart-secondary-actions')!).display,
    }));
    expect(mobileLayout).toMatchObject({ display: 'flex', actions: 'none' });
    expect(mobileLayout.button).not.toBe('none');
    await setIgVisible(page, false);
    await expect(page.locator('#pagePOS .total-row').first()).toBeHidden();
    await expect(page.locator('#pagePOS .total-row').nth(1)).toBeHidden();
    await expect(page.locator('#posTotal')).toHaveText('S/ 4.50');
    await expect(page.locator('#posProductCount')).toContainText('1');
    await expect(page.locator('#pagePOS')).toHaveClass(/na-pos-summary-igv-hidden/);
    expect(await page.locator('#pagePOS .cart-totals').evaluate(el => getComputedStyle(el).display)).toBe('flex');
  });
});

test('tablet 768px: importe de S/ 1,000 no invade otra columna ni altera el cálculo', async ({ page }) => {
  await prepare(page, 768);
  await page.evaluate(() => window.eval('cart[0].precio=1000; posUpdateCart()'));
  await expect(page.locator('#posTotal')).toContainText('1000.00');
  await setIgVisible(page, true);
  const contained = await page.evaluate(() => {
    const root = document.querySelector('#pagePOS .cart-totals')!;
    const total = root.querySelector('.total-main')!;
    const value = total.querySelector('span:last-child')!;
    const a = total.getBoundingClientRect(), b = value.getBoundingClientRect();
    return { right: b.right <= a.right + 1, left: b.left >= a.left - 1, height: a.height };
  });
  expect(contained).toMatchObject({ right: true, left: true, height: 44 });
  await setIgVisible(page, false);
  await expect(page.locator('#posTotal')).toContainText('1000.00');
  await expect(page.locator('#posProductCount')).toHaveText('Nro. de productos: 1');
});

for (const width of [768, 1366]) {
  test(`cabecera Venta actual a ${width}px: 32px de alto, misma anchura y botones funcionales`, async ({ page }) => {
    await prepare(page, width);
    const head = page.locator('#cartDrawer .cart-head');
    const title = head.locator('.cart-head-title');
    // La etiqueta MAYORISTA permanece en el DOM aunque esté oculta.
    await expect(title).toContainText('Venta actual');
    await expect(page.locator('#posClear')).toBeVisible();
    await expect(page.locator('#btnCartMenu')).toBeVisible();

    const size = await page.evaluate(() => {
      const drawer = document.getElementById('cartDrawer')!.getBoundingClientRect();
      const head = document.querySelector('#cartDrawer .cart-head')!.getBoundingClientRect();
      const clear = document.getElementById('posClear')!.getBoundingClientRect();
      const menu = document.getElementById('btnCartMenu')!.getBoundingClientRect();
      return {
        height: head.height, widthDifference: Math.abs(drawer.width - head.width),
        clearHeight: clear.height, menuHeight: menu.height,
        withinHeader: clear.top >= head.top && clear.bottom <= head.bottom
          && menu.top >= head.top && menu.bottom <= head.bottom,
      };
    });
    expect(size).toMatchObject({ height: 32, clearHeight: 28, menuHeight: 28, withinHeader: true });
    expect(size.widthDifference).toBeLessThanOrEqual(1);
    await page.locator('#btnCartMenu').click();
    await expect(page.locator('#cartMenuDropdown')).toBeVisible();
    await page.locator('#btnCartMenu').click();
    await expect(page.locator('#cartMenuDropdown')).toBeHidden();
    await expect(page.locator('#posTotal')).toHaveText('S/ 4.50');
  });
}

test.describe('cabecera del teléfono sin reducción', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('conserva su altura original y el carrito táctil', async ({ page }) => {
    await prepare(page, 390);
    await expect(page.locator('body')).toHaveClass(/na-pos-phone-device/);
    const height = await page.locator('#cartDrawer .cart-head').evaluate(el => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(42);
    await expect(page.locator('#posTotal')).toHaveText('S/ 4.50');
  });
});

for (const width of [768, 1366]) {
  test(`TOTAL horizontal en mayúsculas ${width}px, con IGV visible y oculto`, async ({ page }) => {
    await prepare(page, width);
    const main = page.locator('#pagePOS .total-main');
    const label = main.locator('span').first();
    const money = page.locator('#posTotal');

    for (const enabled of [false, true]) {
      await setIgVisible(page, enabled);
      await expect(main).toHaveCSS('flex-direction', 'row');
      await expect(label).toHaveCSS('text-transform', 'uppercase');
      // La etiqueta TOTAL debe tener exactamente el mismo tamaño que S/ 4.50.
      const fonts = await page.evaluate(() => ({
        label: getComputedStyle(document.querySelector('#pagePOS .total-main>span:first-child')!).fontSize,
        amount: getComputedStyle(document.getElementById('posTotal')!).fontSize,
      }));
      expect(fonts.label).toBe(fonts.amount);
      await expect(label).toHaveText('Total');
      await expect(money).toHaveText('S/ 4.50');
      const bounds = await page.evaluate(() => {
        const bar = document.querySelector('#pagePOS .cart-totals')!.getBoundingClientRect();
        const main = document.querySelector('#pagePOS .total-main')!.getBoundingClientRect();
        const label = document.querySelector('#pagePOS .total-main>span:first-child')!.getBoundingClientRect();
        const amount = document.getElementById('posTotal')!.getBoundingClientRect();
        return {
          height: bar.height,
          sameLine: Math.abs((label.top + label.bottom) / 2 - (amount.top + amount.bottom) / 2) <= 2,
          correctOrder: label.right < amount.left,
          withinBar: label.top >= bar.top - 1 && label.bottom <= bar.bottom + 1
            && amount.top >= bar.top - 1 && amount.bottom <= bar.bottom + 1,
          withinColumn: label.left >= main.left - 1 && amount.right <= main.right + 1,
        };
      });
      expect(bounds).toMatchObject({ height: 44, sameLine: true, correctOrder: true, withinBar: true, withinColumn: true });
    }
  });
}

test.describe('TOTAL del teléfono conserva su diseño anterior', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('sin cambios en flex ni mayúsculas móviles', async ({ page }) => {
    await prepare(page, 390);
    await expect(page.locator('body')).toHaveClass(/na-pos-phone-device/);
    await setIgVisible(page, false);
    await expect(page.locator('#pagePOS .total-main')).toHaveCSS('text-transform', 'none');
    await expect(page.locator('#pagePOS .total-main>span:first-child')).not.toHaveCSS('text-transform', 'uppercase');
    await expect(page.locator('#posTotal')).toHaveText('S/ 4.50');
  });
});
