import { test, expect, type Page } from '@playwright/test';

// Abre el candado solo dentro del navegador de prueba (pos-permissions.js sigue en true).
async function unlock(page: Page) {
  await page.addInitScript(() => {
    const w = window as any; let value: any;
    Object.defineProperty(w, 'NA_PERMISSIONS', { configurable: true, get: () => value, set: original => {
      value = original && { ...original, FEATURE_LOCKS: { ...original.FEATURE_LOCKS, 'atajos-teclado': false },
        featureLocked: (id: string) => id === 'atajos-teclado' ? false : original.featureLocked(id) };
    } });
  });
}

async function prepare(page: Page, width = 1280, dark = false, open = true) {
  if (open) await unlock(page);
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/index.html');
  await page.locator('[data-menu-target="pagePOS"]').click();
  await page.evaluate(dark => {
    window.eval(`productos=[{id:'AT-A',name:'Producto atajo',cat:'abarrotes',precio:3.20,costo:1,stock:10,stockMin:1,icon:'📦'}]; clientes=[]; cajEstado={abierta:true,cerrada:false,fechaApertura:obtenerHoy(),cajero:'Prueba',cajeroId:'TEST'}; cart=[]; posRender(); posUpdateCart();`);
    document.body.classList.toggle('dark', dark);
  }, dark);
}

for (const width of [768, 1280]) for (const dark of [false, true]) {
  test(`F3/F4/Esc/F1 en Venta a ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await prepare(page, width, dark);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F3');
    await expect(page.locator('#posSearch')).toBeFocused();
    // Sin productos el botón PAGAR está deshabilitado: F4 no hace nada.
    await page.keyboard.press('F4');
    await expect(page.locator('#mCobro')).not.toHaveClass(/open/);
    await page.locator('[data-product-id="AT-A"]').click();
    const total = await page.locator('#posTotal').textContent();
    await page.keyboard.press('F4');
    await expect(page.locator('#mCobro')).toHaveClass(/open/);
    const salesBefore = await page.evaluate(() => (window as any).eval('ventas.length'));
    await page.keyboard.press('F4'); // con el cobro abierto no confirma nada
    expect(await page.evaluate(() => (window as any).eval('ventas.length'))).toBe(salesBefore);
    // Seguro: el primer Enter después de F4 no confirma la venta.
    await page.keyboard.press('Enter');
    await expect(page.locator('#mCobro')).toHaveClass(/open/);
    expect(await page.evaluate(() => (window as any).eval('ventas.length'))).toBe(salesBefore);
    await page.keyboard.press('Escape');
    await expect(page.locator('#mCobro')).not.toHaveClass(/open/);
    await expect(page.locator('#posTotal')).toHaveText(total!);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F1');
    const help = page.locator('#naAtajosAyuda');
    await expect(help).toBeVisible();
    await expect(help).toContainText('Buscar producto');
    const box = await help.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
  });
}

test('escribir en el buscador no dispara atajos', async ({ page }) => {
  await prepare(page);
  await page.locator('#posSearch').focus();
  await page.keyboard.type('?+-');
  await expect(page.locator('#naAtajosAyuda')).toHaveCount(0);
});

test('con el candado cerrado (real) F1/F3 no hacen nada', async ({ page }) => {
  await prepare(page, 1280, false, false);
  expect(await page.evaluate(() => (window as any).NA_ATAJOS_TECLADO.isReady())).toBe(false);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('F3');
  await expect(page.locator('#posSearch')).not.toBeFocused();
  await page.keyboard.press('F1');
  await expect(page.locator('#naAtajosAyuda')).toHaveCount(0);
});

test.describe('teléfono táctil', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('los atajos no se activan', async ({ page }) => {
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto('/index.html');
    await page.evaluate(() => (window as any).goPage('pagePOS'));
    await page.keyboard.press('F1');
    await expect(page.locator('#naAtajosAyuda')).toHaveCount(0);
  });
});
