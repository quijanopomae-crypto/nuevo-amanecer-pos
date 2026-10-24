import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixedTime = new Date('2026-10-15T10:00:00-05:00');
const products = [
  { id: 91001, name: 'Agua de prueba 500 ml', cat: 'bebidas', precio: 2.5, costo: 1, stock: 20, stockMin: 2, icon: '💧' },
  { id: 91002, name: 'Arroz de prueba 1 kg', cat: 'abarrotes', precio: 5, costo: 3, stock: 15, stockMin: 2, icon: '📦' },
  { id: 91003, name: 'Jabón de prueba', cat: 'limpieza', precio: 3, costo: 1.5, stock: 12, stockMin: 2, icon: '🧴' },
];

// Mask only volatile chrome, preserving the business content under comparison.
const maskSelectors = [
  '#fechaHoy', '#menuDesktopDate', '#cajFechaLbl',
  '.na-mobile-activity-time', '#naMobileDrawerVersion',
  '#localStatus', '#saveStatus', '#naStatusBanner', '#gToast',
];

async function ready(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

async function load(page: Page, empty: boolean, colorScheme: 'light' | 'dark') {
  // Install before navigation; Date stays frozen while app timers can finish booting.
  await page.clock.install({ time: fixedTime });
  await page.clock.setFixedTime(fixedTime);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === 'http://127.0.0.1:4183' ? route.continue() : route.abort();
  });
  await page.addInitScript(({ products, empty, colorScheme }) => {
    localStorage.clear();
    localStorage.setItem('na_app_initialized_v1', 'true');
    localStorage.setItem('na_seed_catalog_suppressed', 'true');
    localStorage.setItem('na_productos', JSON.stringify(empty ? [] : products));
    for (const key of ['na_ventas', 'na_clientes', 'na_creditos', 'na_gastos', 'na_cajMovs', 'na_cart']) {
      localStorage.setItem(key, '[]');
    }
    // Caja del día abierta (fija) para que «Pagar» abra el diálogo real de cobro.
    localStorage.setItem('na_cajEstado', JSON.stringify({ abierta: true, cerrada: false, fechaApertura: '2026-10-15', fondo: 100, sessionId: 1 }));
    localStorage.setItem('na_v9_appearance', JSON.stringify({ mode: colorScheme === 'dark' ? 'noche' : 'claro', theme: 'azul' }));
    // No cloud credentials: deterministic local owner mode, no remote backend.
  }, { products, empty, colorScheme });
  await page.goto('/index.html');
  await expect(page.locator('#pageMenu')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).NA_MENU_NAVIGATION);
  if (colorScheme === 'dark') await expect(page.locator('body')).toHaveClass(/\bdark\b/);
  else await expect(page.locator('body')).not.toHaveClass(/\bdark\b/);
  await ready(page);
}

async function screenshot(page: Page, name: string) {
  await ready(page);
  const masks = maskSelectors.map(selector => page.locator(selector));
  const viewport = page.viewportSize();

  // El nuevo resumen de PC/tablet es el único área aprobada para rediseño.
  // Conservamos pixel-exacta la comparación del resto del POS; el pie se
  // verifica estructural y funcionalmente en pos-summary-igv.spec.ts.
  if (!name.startsWith('venta-') || !viewport || viewport.width < 701) {
    await expect(page).toHaveScreenshot(name, { mask: masks });
    return;
  }

  const cartPanel = await page.locator('#pagePOS #cartDrawer').boundingBox();
  expect(cartPanel, 'Venta actual debe existir').not.toBeNull();
  const expectedPng = readFileSync('tests/visual/__screenshots__/visual.spec.ts/' + name).toString('base64');
  const actualPng = (await page.screenshot({
    mask: masks, animations: 'disabled', caret: 'hide', scale: 'css',
  })).toString('base64');
  const comparison = await page.evaluate(async ({ expectedPng, actualPng, cartPanel }) => {
    const pixels = async (value: string) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + value;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Visual comparison canvas unavailable');
      ctx.drawImage(img, 0, 0);
      return { width: img.width, height: img.height, bytes: ctx.getImageData(0, 0, img.width, img.height).data };
    };
    const old = await pixels(expectedPng);
    const current = await pixels(actualPng);
    if (old.width !== current.width || old.height !== current.height) {
      return { sizeChanged: true, outside: 1, pixels: 0 };
    }
    // La cabecera 60→32px desplaza cada línea del carrito. Solo esa columna
    // queda exceptuada de la comparación de píxel antiguo; todo lo demás
    // continúa bajo 0.1%. Altura, textos, botones, menú, IGV y móvil tienen
    // pruebas E2E específicas. No se ignora ninguna otra región de POS.
    const left = Math.floor(cartPanel!.x) - 2;
    const right = Math.ceil(cartPanel!.x + cartPanel!.width) + 2;
    const top = Math.max(0, Math.floor(cartPanel!.y) - 2);
    const bottom = Math.ceil(cartPanel!.y + cartPanel!.height) + 2;
    let outside = 0;
    for (let y = 0; y < old.height; y++) {
      for (let x = 0; x < old.width; x++) {
        if (x >= left && x <= right && y >= top && y <= bottom) continue;
        const i = (y * old.width + x) * 4;
        const delta = Math.abs(old.bytes[i] - current.bytes[i])
          + Math.abs(old.bytes[i + 1] - current.bytes[i + 1])
          + Math.abs(old.bytes[i + 2] - current.bytes[i + 2]);
        if (delta > 42) outside++;
      }
    }
    return { sizeChanged: false, outside, pixels: old.width * old.height };
  }, { expectedPng, actualPng, cartPanel });
  expect(comparison.sizeChanged, 'No debe cambiar la resolución visual').toBe(false);
  expect(comparison.outside, 'Regresión visual FUERA de Venta actual autorizada')
    .toBeLessThanOrEqual(Math.floor(comparison.pixels * 0.001));
}

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    const combo = `${viewport.width}-${colorScheme}`;
    test.describe(combo, () => {
      test.use({ viewport, colorScheme, hasTouch: viewport.width === 390, isMobile: false });

      test('Inicio', async ({ page }) => {
        await load(page, false, colorScheme);
        await screenshot(page, `inicio-${combo}.png`);
      });

      if (viewport.width === 390) test('Inicio drawer open', async ({ page }) => {
        await load(page, false, colorScheme);
        await page.locator('#naMobileMenuToggle').click();
        await expect(page.locator('#naMobileDrawer')).toHaveAttribute('aria-hidden', 'false');
        await screenshot(page, `inicio-drawer-${combo}.png`);
      });

      for (const state of ['empty', 'cart', 'search', 'cobrar'] as const) {
        test(`Venta ${state}`, async ({ page }) => {
          await load(page, state === 'empty', colorScheme);
          await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pagePOS'));
          await expect(page.locator('#pagePOS')).toBeVisible();
          // Verify storage seeding actually reached the catalog, including zero products.
          expect(await page.evaluate(() => (window as any).eval('productos.length'))).toBe(state === 'empty' ? 0 : 3);
          if (state === 'cart' || state === 'cobrar') {
            await page.evaluate(ids => ids.forEach(id => (window as any).posAdd(id)), products.map(product => product.id));
            await expect(page.locator('.cart-item')).toHaveCount(3);
          }
          if (state === 'search' || (state === 'empty' && viewport.width === 390)) {
            if (viewport.width === 390) {
              await page.locator('#posPhoneAdd').click();
              await expect(page.locator('#posPhoneCatalog')).toBeVisible();
            }
            if (state === 'search') {
              await page.locator('#posSearch').pressSequentially('Agua');
              await expect(page.locator('#posSearch')).toHaveValue('Agua');
              await expect(page.locator('[data-product-id="91001"]')).toBeVisible();
              await expect(page.locator('[data-product-id="91002"]')).toHaveCount(0);
            }
          }
          if (state === 'cobrar') {
            // Botón real «Pagar» con la caja del día abierta (sembrada). Nunca se confirma el cobro.
            await page.locator('#btnPagar').click();
            await expect(page.locator('#mCobro')).toBeVisible();
            // Intentionally never click the confirm/pay action.
          }
          await screenshot(page, `venta-${state}-${combo}.png`);
          expect(await page.evaluate(() => (window as any).eval('ventas.length'))).toBe(0);
        });
      }
    });
  }
}
