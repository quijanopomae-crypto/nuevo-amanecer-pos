import { test, expect, type Page } from '@playwright/test';
import { isAssistantPing } from './helpers/known-background-requests';

// Revisión #854 y #855: un nombre de producto muy largo debe envolverse dentro de su celda y no tapar
// Stock, Última venta, Valor ni las columnas de la sugerencia. Datos sintéticos; sin clientes reales.
test.use({ serviceWorkers: 'block' });

const LONG = 'Aceite vegetal de girasol extra refinado botella familiar retornable edición especial ' +
  'SUPERCALIFRAGILISTICOESPIALIDOSOCONCODIGOINTERNOSINESPACIOS0123456789 marca premium x12';

async function ownerPage(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  const writes: string[] = [];
  page.on('request', r => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method()) && !isAssistantPing(r)) writes.push(r.method() + ' ' + r.url()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'nombres-largos' } : {}) });
    return url.hostname === '127.0.0.1' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'nl-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role: 'owner' }));
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.role === 'owner' && (window as any).NA_ROLES.confirmed
    && !!(window as any).NA_SUGERENCIA_COMPRA && !!(window as any).NA_PRODUCTOS_SIN_MOVIMIENTO);
  await page.waitForLoadState('networkidle'); // loadAllData (IndexedDB) termina antes de sembrar
  await page.evaluate(long => {
    (window as any).eval('productos = ' + JSON.stringify([
      { id: 'nl-1', name: long, sku: 'NL-1', stock: 1, stockMin: 5, costo: 2, precio: 3, proveedor: 'Distribuidora Sol', activo: true },
      { id: 'nl-2', name: 'Corto', stock: 2, stockMin: 6, costo: 1, precio: 2, proveedor: 'Distribuidora Sol', activo: true }
    ]) + '; ventas = []');
  }, LONG);
  return { errors, writes };
}

// Caja del TEXTO del nombre (no de la celda: con nowrap la celda conserva su ancho y el texto se desborda).
async function assertNoOverlap(page: Page, rowSelector: string, why: string) {
  const geo = await page.locator(rowSelector).evaluate(row => {
    const name = row.querySelector('th') as HTMLElement;
    const range = document.createRange(); range.selectNodeContents(name);
    const box = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
    return {
      text: box(range.getBoundingClientRect()), cell: box(name.getBoundingClientRect()), row: box(row.getBoundingClientRect()),
      overflowX: name.scrollWidth - name.clientWidth,
      others: Array.from(row.querySelectorAll('td')).map(td => ({ label: td.getAttribute('data-label') || td.className, ...box(td.getBoundingClientRect()) }))
    };
  });
  const tol = 1;
  expect(geo.overflowX, `${why}: el nombre no se desborda de su celda`).toBeLessThanOrEqual(tol);
  expect(geo.text.right, `${why}: el texto del nombre termina dentro de su celda`).toBeLessThanOrEqual(geo.cell.right + tol);
  expect(geo.text.left, `${why}: el texto del nombre empieza dentro de su celda`).toBeGreaterThanOrEqual(geo.cell.left - tol);
  expect(geo.text.right, `${why}: el texto no sale de la fila`).toBeLessThanOrEqual(geo.row.right + tol);
  expect(geo.text.height, `${why}: el nombre largo ocupa varias líneas`).toBeGreaterThan(30);
  expect(geo.others.length).toBeGreaterThan(0);
  for (const o of geo.others) {
    const w = Math.min(geo.text.right, o.right) - Math.max(geo.text.left, o.left);
    const h = Math.min(geo.text.bottom, o.bottom) - Math.max(geo.text.top, o.top);
    expect(w > tol && h > tol, `${why}: el nombre tapa «${o.label}» (${JSON.stringify({ text: geo.text, cell: o })})`).toBe(false);
  }
}

for (const width of [390, 768, 1280]) {
  test(`nombres largos no tapan columnas a ${width}px (#854 y #855)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const { errors, writes } = await ownerPage(page);

    // #854 productos sin movimiento: Stock actual, Última venta y Valor inventario.
    await page.evaluate(() => (window as any).goPage('pageProductosSinMovimiento'));
    const psm = page.locator('#pageProductosSinMovimiento [data-psm-row="id:nl-1"]');
    await expect(psm).toBeVisible();
    await expect(psm.locator('td')).toHaveCount(3);
    // Reintenta mientras la pantalla termina de renderizar; un solape real persiste y falla.
    await expect(async () => { await assertNoOverlap(page, '#pageProductosSinMovimiento [data-psm-row="id:nl-1"]', `#854 a ${width}px`); }).toPass({ timeout: 5000 });

    // #855 sugerencia de compra: Stock, Mínimo, Vendido, Sugerido, A pedir y Quitar.
    await page.evaluate(() => (window as any).goPage('pageSugerenciaCompra'));
    const sc = page.locator('#pageSugerenciaCompra [data-sc-row="id:nl-1"]');
    await expect(sc).toBeVisible();
    // Reintenta mientras la pantalla termina de renderizar; un solape real persiste y falla.
    await expect(async () => { await assertNoOverlap(page, '#pageSugerenciaCompra [data-sc-row="id:nl-1"]', `#855 a ${width}px`); }).toPass({ timeout: 5000 });
    // El campo «A pedir» cabe en su celda.
    const qty = await sc.evaluate(row => { const i = row.querySelector('[data-sc-qty]')!.getBoundingClientRect(), c = row.querySelector('[data-sc-qty]')!.parentElement!.getBoundingClientRect(); return { i: [i.left, i.right], c: [c.left, c.right] }; });
    expect(qty.i[0]).toBeGreaterThanOrEqual(qty.c[0] - 1);
    expect(qty.i[1]).toBeLessThanOrEqual(qty.c[1] + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`nombres-largos-${width}.png`), fullPage: false });

    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
