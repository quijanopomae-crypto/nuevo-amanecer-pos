import { test, expect, type Page } from '@playwright/test';
import { isAssistantPing } from './helpers/known-background-requests';

// Datos sintéticos; sin clientes reales.
const products = [
  { id: 990101, name: 'Arroz etiqueta prueba', sku: 'ARROZ-01', barcode: 'ARROZ-01', precio: 4.5, costo: 2, stock: 10, activo: true, cat: 'abarrotes', unidad: 'unidad', icon: '📦' },
  { id: 990103, name: 'Cafe acentos', sku: '', barcode: 'CAFÉ-Ñ1', price: 7.25, costo: 3, stock: 4, activo: true, cat: 'abarrotes', unidad: 'unidad', icon: '📦' },
  { id: 990102, name: 'Galleta sin codigo <b>xss</b>', sku: '', barcode: '', precio: 1.2, costo: 0.5, stock: 5, activo: true, cat: 'abarrotes', unidad: 'unidad', icon: '📦' }
];

async function ownerPage(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  const writes: string[] = [];
  page.on('request', r => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method()) && !isAssistantPing(r)) writes.push(r.method() + ' ' + r.url()); });
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
  // El arranque normaliza el catálogo (_naNormalizeData pone sku PROD-n a los que no tienen código) y enseguida llena
  // #invCat (renderCategorySelects). Se espera a eso antes de cargar los productos de prueba: si no, la normalización
  // tardía les daba código a los «sin código» (5 barras en vez de 3).
  await page.waitForFunction(() => (document.querySelectorAll('#invCat option').length > 0));
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

    await search.fill('cafe');
    await expect(root.locator('[data-etq-add="990103"]')).toContainText('S/ 7.25');
    await root.locator('[data-etq-add="990103"]').click();
    await expect(labels).toHaveCount(6);
    const cafe = root.locator('[data-etq-sheet] [data-etq-label]').filter({ hasText: 'Cafe acentos' });
    await expect(cafe.locator('svg')).toHaveCount(0);
    await expect(cafe.locator('.etq-price')).toHaveText('S/ 7.25');
    await expect(cafe.locator('[data-etq-warn]')).toBeVisible();
    await expect(cafe.locator('[data-etq-warn]')).toHaveText('sin barras: código con caracteres no válidos');
    await expect(root.locator('[data-etq-sheet] [data-etq-warn]')).toHaveCount(1);
    await root.locator('[data-etq-remove="990103"]').click();
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
    // Al imprimir, el buscador sale del diseño (no solo se oculta): no ensancha la hoja.
    expect(await root.locator('[data-etq-search]').evaluate(el => el.getClientRects().length)).toBe(0);
    await page.emulateMedia({ media: 'screen' });

    expect(await page.evaluate(() => JSON.stringify((window as any).productos)), 'solo lectura').toBe(before);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

// Solo el dueño: un empleado confirmado no llega a Etiquetas (ni por goPage, ni forzando la clase, ni por Próximamente).
test('empleado: Etiquetas e impresión de precios no se abre ni se ve', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.pathname === '/auth/me' ? { pos_role: 'empleado', owner_pin_set: true, roles_ready: true, device_id: 'etq-empleado' } : {}) });
    return url.hostname === '127.0.0.1' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic-test-only' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role: 'empleado' }));
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.role === 'empleado' && (window as any).NA_ROLES.confirmed && !!(window as any).NA_ETIQUETAS_PRECIOS);
  const screen = page.locator('#pageEtiquetasPrecios');
  await page.evaluate(() => (window as any).goPage('pageEtiquetasPrecios'));
  await expect(page.locator('#naNoPermission')).toBeVisible();
  await expect(page.locator('#naNoPermission')).toContainText('Sin permiso');
  await expect(screen).not.toHaveClass(/\bactive\b/);
  await expect(screen).toBeHidden();
  await page.getByRole('button', { name: 'Volver a la venta', exact: true }).click();
  // Forzar la clase tampoco la abre.
  await page.evaluate(() => document.getElementById('pageEtiquetasPrecios')!.classList.add('active'));
  await expect(page.locator('#naNoPermission')).toBeVisible();
  await expect(screen).not.toHaveClass(/\bactive\b/);
  await expect(screen).toBeHidden();
  await page.getByRole('button', { name: 'Volver a la venta', exact: true }).click();
  // Próximamente (donde está la tarjeta) es solo del dueño: no se abre y la tarjeta no se ve.
  await page.evaluate(() => (window as any).goPage('pageProximamente'));
  await expect(page.locator('#pageProximamente')).not.toHaveClass(/\bactive\b/);
  await expect(page.locator('[data-feature-id="etiquetas-precios"]')).toBeHidden();
  await expect(screen).toBeHidden();
});
