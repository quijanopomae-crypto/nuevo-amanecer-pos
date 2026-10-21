import { test, expect, type Page } from '@playwright/test';

// Misión 1: impresión de etiquetas (@page, A4 por hojas, rollo), tema oscuro, sin precio, tope y fecha de Lima.
// Datos sintéticos; sin clientes reales.
const products = [
  { id: 990201, name: 'Arroz impresion', sku: 'ARROZ-02', barcode: 'ARROZ-02', precio: 4.5, costo: 2, stock: 10, activo: true, cat: 'abarrotes', unidad: 'unidad', icon: '📦' },
  { id: 990202, name: 'Fideo sin precio', sku: 'FID-0', barcode: 'FID-0', precio: 0, costo: 1, stock: 3, activo: true, cat: 'abarrotes', unidad: 'unidad', icon: '📦' },
  { id: 990203, name: 'Azucar impresion', sku: 'AZU-1', barcode: 'AZU-1', precio: 3.2, costo: 2, stock: 8, activo: true, cat: 'abarrotes', unidad: 'unidad', icon: '📦' }
];

async function open(page: Page, dark: boolean) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.pathname === '/auth/me' ? { pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'etq-m1' } : {}) });
    return url.hostname === '127.0.0.1' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic-test-only' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role: 'owner' }));
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.role === 'owner' && (window as any).NA_ROLES.confirmed && !!(window as any).NA_ETIQUETAS_PRECIOS);
  await page.evaluate(items => { (0, eval)('productos = ' + JSON.stringify(items)); }, products);
  await page.evaluate(d => document.body.classList.toggle('dark', d), dark);
  await page.evaluate(() => (window as any).goPage('pageEtiquetasPrecios'));
  const root = page.locator('#pageEtiquetasPrecios');
  await expect(root).toHaveClass(/\bactive\b/);
  return { root, errors };
}

async function pick(root: any, query: string, id: number) {
  const search = root.locator('[data-etq-search]');
  await search.fill(query);
  await root.locator(`[data-etq-add="${id}"]`).click();
  // Al elegir, las sugerencias se cierran y el buscador queda vacío.
  await expect(root.locator('[data-etq-matches] [data-etq-add]')).toHaveCount(0);
  await expect(search).toHaveValue('');
}

// Contraste WCAG contra el primer fondo opaco hacia arriba.
async function contrast(el: any) {
  return el.evaluate((node: Element) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fg = parse(getComputedStyle(node).color);
    let bgNode: Element | null = node, bg = [255, 255, 255];
    while (bgNode) { const c = parse(getComputedStyle(bgNode).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) { bg = c; break; } bgNode = bgNode.parentElement; }
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

for (const dark of [false, true]) {
  for (const width of [390, 768, 1280]) {
    test(`impresión de etiquetas a ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const { root, errors } = await open(page, dark);
      await pick(root, 'arroz', 990201);
      await pick(root, 'fideo', 990202);

      // Sin precio: aviso visible en la lista y la etiqueta no dice «S/ 0.00».
      await expect(root.locator('[data-etq-noprice-warn="990202"]')).toBeVisible();
      await expect(root.locator('[data-etq-noprice-warn="990201"]')).toHaveCount(0);
      const noPrice = root.locator('[data-etq-sheet] [data-etq-label]').filter({ hasText: 'Fideo sin precio' });
      await expect(noPrice.locator('.etq-price')).toHaveText('Sin precio');
      await expect(root.locator('[data-etq-sheet]')).not.toContainText('S/ 0.00');

      // Contraste ≥ 4.5:1 en buscador, selector, Quitar y notas.
      for (const sel of ['[data-etq-search]', '[data-etq-format]', '[data-etq-remove="990201"]', '.etq-note >> nth=0', '[data-etq-noprice-warn="990202"]']) {
        expect(await contrast(root.locator(sel)), `${sel} contraste`).toBeGreaterThanOrEqual(4.5);
      }
      if (dark) expect(await root.locator('[data-etq-search]').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');

      // Fecha de Lima: igual a la que calcula Intl con America/Lima.
      const lima = await page.evaluate(() => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()));
      await expect(root.locator('.etq-date').first()).toHaveText(lima);

      // Tope: 3 × 100 = 300 pedidas, la vista previa llega a 240 con aviso.
      await pick(root, 'azucar', 990203);
      for (const id of [990201, 990202, 990203]) { await root.locator(`[data-etq-qty="${id}"]`).fill('100'); await root.locator(`[data-etq-qty="${id}"]`).blur(); }
      const labels = root.locator('[data-etq-sheet] [data-etq-label]');
      await expect(labels).toHaveCount(240);
      await expect(root.locator('[data-etq-count]')).toHaveText('240 etiquetas (máximo)');
      await expect(root.locator('[data-etq-cap]')).toBeVisible();
      await expect(root.locator('[data-etq-cap]')).toContainText('240');

      // A4: 240 / 24 = 10 grids, cada uno 3 × 8.
      await root.locator('[data-etq-format]').selectOption('a4');
      const pages = root.locator('[data-etq-a4-page]');
      await expect(pages).toHaveCount(10);
      await expect(pages.first().locator('[data-etq-label]')).toHaveCount(24);
      expect(await pages.first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);

      const overflow = await root.evaluate(el => el.scrollWidth - el.clientWidth);
      expect(overflow, 'la página no se desborda').toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`etq-m1-${width}-${dark ? 'oscuro' : 'claro'}.png`) });

      // Imprimir con un producto sin precio pide confirmación; si se cancela, no imprime.
      await page.evaluate(() => { (window as any).__printed = 0; (window as any).__asked = ''; window.print = () => { (window as any).__printed++; }; window.confirm = (m?: string) => { (window as any).__asked = String(m); return false; }; });
      await root.locator('[data-etq-print]').click();
      expect(await page.evaluate(() => (window as any).__printed)).toBe(0);
      expect(await page.evaluate(() => (window as any).__asked)).toContain('Sin precio');

      // Confirmado: inserta @page A4 margen 0 y un salto de página entre grids.
      await page.evaluate(() => { window.confirm = () => true; });
      await root.locator('[data-etq-print]').click();
      expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
      await expect(page.locator('style[data-etq-page-style]')).toHaveJSProperty('textContent', '@page { size: A4; margin: 0; }');
      await page.emulateMedia({ media: 'print' });
      expect(await pages.nth(0).evaluate(el => getComputedStyle(el).breakAfter)).toBe('page');
      expect(await pages.nth(9).evaluate(el => getComputedStyle(el).breakAfter)).toBe('auto');
      // 8 × 37 mm = 296 mm: sin altura de 297 mm que por redondeo agregue una hoja en blanco.
      expect(await pages.nth(0).evaluate(el => Math.round(el.getBoundingClientRect().height / 96 * 25.4))).toBeLessThanOrEqual(296);
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await expect(page.locator('style[data-etq-page-style]')).toHaveCount(0);

      // Rollo chica: @page 38 × 25 mm y una etiqueta por página.
      await root.locator('[data-etq-format]').selectOption('chica');
      await root.locator('[data-etq-print]').click();
      await expect(page.locator('style[data-etq-page-style]')).toHaveJSProperty('textContent', '@page { size: 38mm 25mm; margin: 0; }');
      await page.emulateMedia({ media: 'print' });
      expect(await labels.first().evaluate(el => getComputedStyle(el).breakAfter)).toBe('page');
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await root.locator('[data-etq-format]').selectOption('mediana');
      await root.locator('[data-etq-print]').click();
      await expect(page.locator('style[data-etq-page-style]')).toHaveJSProperty('textContent', '@page { size: 50mm 30mm; margin: 0; }');
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      expect(errors).toEqual([]);
    });
  }
}
