import { test, expect, type Page } from '@playwright/test';

// Datos sintéticos; sin clientes reales.
const products = [
  { id: 990101, name: 'Arroz etiqueta prueba', sku: 'ARROZ-01', barcode: 'ARROZ-01', precio: 4.5, costo: 2, stock: 10, activo: true, cat: 'abarrotes', unidad: 'unidad', icon: '📦' },
  { id: 990102, name: 'Galleta sin codigo <b>xss</b>', sku: '', barcode: '', precio: 1.2, costo: 0.5, stock: 5, activo: true, cat: 'abarrotes', unidad: 'unidad', icon: '📦' }
];

async function ownerPage(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  const writes: string[] = [];
  page.on('request', r => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method())) writes.push(r.method() + ' ' + r.url()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.pathname === '/auth/me' ? { pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'etq-owner' } : {}) });
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
  return { errors, writes };
}

for (const width of [390, 768, 1280]) {
  test(`etiquetas a ${width}px: entra por Próximamente, 2 productos con cantidades, sin código no rompe`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const { errors, writes } = await ownerPage(page);
    const before = await page.evaluate(() => JSON.stringify((window as any).productos));
    await page.evaluate(() => (window as any).goPage('pageProximamente'));
    const card = page.locator('[data-feature-id="etiquetas-precios"]');
    await expect(card.locator('.na-prox-available')).toHaveText('Disponible');
    await card.click();
    const root = page.locator('#pageEtiquetasPrecios');
    await expect(root).toHaveClass(/\bactive\b/);

    const search = root.locator('[data-etq-search]');
    await search.fill('arroz');
    await root.locator('[data-etq-add="990101"]').click();
    await search.fill('galleta');
    await root.locator('[data-etq-add="990102"]').click();
    await root.locator('[data-etq-qty="990101"]').fill('3');
    await root.locator('[data-etq-qty="990102"]').fill('2');
    await root.locator('[data-etq-qty="990102"]').blur();

    const labels = root.locator('[data-etq-sheet] [data-etq-label]');
    await expect(labels).toHaveCount(5);
    await expect(root.locator('[data-etq-count]')).toHaveText('5 etiquetas');
    await expect(root.locator('[data-etq-sheet] svg.etq-bars')).toHaveCount(3);
    await expect(root.locator('[data-etq-sheet] .etq-no-bars')).toHaveCount(2);
    await expect(labels.first().locator('.etq-price')).toHaveText('S/ 4.50');
    await expect(root.locator('[data-etq-sheet] .etq-no-bars').first()).toContainText('Sin código');
    expect(await root.locator('[data-etq-sheet] b').count(), 'el nombre se escapa').toBe(0);

    await root.locator('[data-etq-format]').selectOption('chica');
    const box = await labels.first().boundingBox();
    expect(Math.round(box!.width / 96 * 25.4)).toBe(38);
    await root.locator('[data-etq-format]').selectOption('a4');
    await expect(labels).toHaveCount(5);

    const overflow = await root.evaluate(el => el.scrollWidth - el.clientWidth);
    expect(overflow, 'la página no se desborda').toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath(`etiquetas-${width}.png`), fullPage: true });

    await page.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
    await root.locator('[data-etq-print]').click();
    expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
    await expect(page.locator('body')).toHaveClass(/\betq-printing\b/);
    await page.emulateMedia({ media: 'print' });
    expect(await labels.first().evaluate(el => getComputedStyle(el).visibility)).toBe('visible');
    expect(await root.locator('[data-etq-search]').evaluate(el => getComputedStyle(el).visibility)).toBe('hidden');
    await page.emulateMedia({ media: 'screen' });

    expect(await page.evaluate(() => JSON.stringify((window as any).productos)), 'solo lectura').toBe(before);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
