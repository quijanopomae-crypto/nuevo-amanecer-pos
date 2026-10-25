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
  await expect(page.locator('#posTotal')).toContainText('S/ 1,000.00');
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
  await expect(page.locator('#posTotal')).toContainText('S/ 1,000.00');
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
      // Sin IGV, TOTAL y S/ 4.50 tienen el mismo tamaño. Con IGV visible (dueño 14:45) ambos se
      // achican para que entren montos con miles; TOTAL queda algo menor que el importe.
      const fonts = await page.evaluate(() => ({
        label: getComputedStyle(document.querySelector('#pagePOS .total-main>span:first-child')!).fontSize,
        amount: getComputedStyle(document.getElementById('posTotal')!).fontSize,
      }));
      if (enabled) expect(parseFloat(fonts.label)).toBeLessThan(parseFloat(fonts.amount));
      else expect(fonts.label).toBe(fonts.amount);
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

for (const width of [390, 768, 1024, 1280]) {
  for (const dark of [false, true]) {
    test(`miles S/ 111,110.00 a ${width}px ${dark ? 'oscuro' : 'claro'}: resumen, cobro, vuelto y ticket, sin desbordar ni cambiar cálculos`, async ({ page }) => {
      await prepare(page, width);
      await page.evaluate(d => document.body.classList.toggle('dark', d), dark);
      await page.evaluate(() => window.eval('productos[0].precio=111110; cart[0].precio=111110; posRender(); posUpdateCart()'));
      if (width <= 700) {
        // En 390px el carrito es un panel: abrirlo antes de medir el Total.
        const fab = page.locator('.cart-fab');
        if (await fab.isVisible()) await fab.click();
        await expect(page.locator('#posTotal')).toBeInViewport();
        await page.waitForTimeout(600); // fin de la animación del panel
      }
      const total = page.locator('#posTotal');
      await expect(total).toHaveText('S/ 111,110.00');
      await expect(page.locator('#pagePOS .ci-sub').first()).toHaveText('S/ 111,110.00');
      const fits = () => page.evaluate(() => {
        const t = document.querySelector('#posTotal') as HTMLElement;
        const main = (t.closest('.total-main') || t.parentElement)!.getBoundingClientRect();
        const r = t.getBoundingClientRect();
        const lab = (t.closest('.total-main')!.querySelector('span:first-child') as HTMLElement).getBoundingClientRect();
        return { inMain: r.right <= main.right + 1 && r.left >= main.left - 1 && lab.left >= main.left - 1 && lab.right <= r.left + 1, inView: r.right <= window.innerWidth, oneLine: r.height < 2 * parseFloat(getComputedStyle(t).lineHeight || '40') };
      });
      for (const enabled of [false, true]) {
        await setIgVisible(page, enabled);
        await expect(total).toHaveText('S/ 111,110.00');
        { const f = await fits(); expect(f, JSON.stringify(f)).toEqual({ inMain: true, inView: true, oneLine: true }); }
      }
      const raw = await page.evaluate(() => window.eval('({precio:cart[0].precio, total:_naTaxBreakdownForSaleItems(cart, !!appConfig.igvActive).totalVenta})'));
      expect(raw).toMatchObject({ precio: 111110, total: 111110 });

      // Cobro y vuelto: mismos números, con miles; el input sigue siendo numérico.
      // Caja abierta simulada solo para abrir el cobro (sin tocar datos de caja).
      await page.evaluate(() => window.eval("cajEstado={...(cajEstado||{}),abierta:true,cerrada:false,fechaApertura:obtenerHoy()}; abrirCobro('normal')"));
      await expect(page.locator('#mCobroTotal')).toHaveText('S/ 111,110.00');
      expect(await page.locator('#mMontoRec').inputValue()).toBe('111110.00');
      await page.evaluate(() => { const i = document.getElementById('mMontoRec') as HTMLInputElement; i.value = '112345.5'; window.eval('calcCambio()'); });
      await expect(page.locator('#mCambio')).toHaveText('S/ 1,235.50');
      const change = await page.locator('#mCambio').evaluate(el => {
        const box = el.getBoundingClientRect(); return el.scrollWidth <= (el as HTMLElement).clientWidth + 1 && box.right <= window.innerWidth;
      });
      expect(change).toBe(true);

      // Ticket (impreso / texto para WhatsApp): mismo formato y mismo céntimo que la venta.
      const ticket = await page.evaluate(() => {
        const sale = { id: 1, fecha: '2026-10-21', hora: '14:30', items: [{ name: 'Producto prueba', qty: 1, precio: 111110 }], total: 111110, metodo: 'efectivo', recibido: 112345.5, vuelto: 1235.5 };
        const out = (window as any)._naBuildThermalTicket(sale, false);
        return String(out.text);
      });
      expect(ticket).toContain('111,110.00');
      expect(ticket).toContain('1,235.50');
      expect(ticket).not.toMatch(/111110\.00/);
    });
  }
}
