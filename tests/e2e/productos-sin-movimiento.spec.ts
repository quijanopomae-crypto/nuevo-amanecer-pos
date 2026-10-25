import { test, expect, type Page } from '@playwright/test';
import { isAssistantPing } from './helpers/known-background-requests';
import { readFile } from 'node:fs/promises';

// Misión 5: productos sin movimiento. Datos sintéticos; sin clientes reales.
test.use({ serviceWorkers: 'block' });
const screenId = '#pageProductosSinMovimiento';

async function rolePage(page: Page, role: 'owner' | 'empleado', dark: boolean) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  const writes: string[] = [];
  page.on('request', r => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method()) && !isAssistantPing(r)) writes.push(r.method() + ' ' + r.url()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'psm-m5' } : {}) });
    return url.hostname === '127.0.0.1' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'psm-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed && !!(window as any).NA_PRODUCTOS_SIN_MOVIMIENTO, role);
  await page.evaluate(dark => {
    const w = window as any;
    document.body.classList.toggle('dark', dark);
    const ago = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
    w.eval('productos = ' + JSON.stringify([
      { id: 'm5-1', name: 'Vendido ayer', stock: 4, costo: 2, precio: 3, activo: true },
      { id: 'm5-2', name: 'Vendido hace 45 días', sku: 'P45', stock: 8, costo: 1.5, precio: 3, activo: true },
      { id: 'm5-3', name: 'Nunca vendido <b>x</b>', stock: 10, costo: 0, precio: 3, activo: true }
    ]) + '; ventas = ' + JSON.stringify([
      { id: 'v1', fecha: ago(1), items: [{ id: 'm5-1', qty: 1, precio: 3 }] },
      { id: 'v2', fecha: ago(45), items: [{ id: 'm5-2', qty: 1, precio: 3 }] }
    ]));
  }, dark);
  return { errors, writes };
}

async function contrast(el: any) {
  return el.evaluate((node: Element) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fg = parse(getComputedStyle(node).color);
    let n: Element | null = node, bg = [255, 255, 255];
    while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) { bg = c; break; } n = n.parentElement; }
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

for (const dark of [false, true]) for (const width of [390, 768, 1280]) {
  test(`productos sin movimiento a ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const { errors, writes } = await rolePage(page, 'owner', dark);
    const before = await page.evaluate(() => (window as any).eval('JSON.stringify({productos, ventas})'));
    await page.evaluate(() => (window as any).goPage('pageProximamente'));
    const card = page.locator('[data-feature-id="productos-sin-movimiento"]');
    await expect(card.locator('.na-prox-available')).toHaveText('Disponible');
    await card.click();
    const screen = page.locator(screenId), rows = screen.locator('tbody tr');
    await expect(screen).toHaveClass(/\bactive\b/);

    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Nunca vendido');
    // #892 O4: un costo 0 real se muestra 0.00, no «Sin costo».
    await expect(rows.nth(0)).not.toContainText('Sin costo');
    await expect(rows.nth(0).locator('.psm-value')).toHaveText('S/ 0.00');
    await expect(rows.nth(1)).toContainText('Vendido hace 45 días');
    await expect(rows.nth(1).locator('.psm-value')).toHaveText('S/ 12.00');
    await expect(screen.locator('[data-psm-total-value]')).toHaveText('S/ 12.00');
    await expect(screen.locator('[data-psm-status]')).toContainText('hora de Lima');
    await expect(screen.locator('b')).toHaveCount(0);
    await screen.locator('[data-psm-period]').selectOption('60');
    await expect(rows).toHaveCount(1);
    await screen.locator('[data-psm-period]').selectOption('90');
    await expect(rows).toHaveCount(1);
    await screen.locator('[data-psm-period]').selectOption('30');
    await expect(rows).toHaveCount(2);

    for (const sel of ['[data-psm-period]', '[data-psm-export]', '[data-psm-status]', 'tbody th >> nth=0', '[data-psm-total-value]']) expect(await contrast(screen.locator(sel)), sel).toBeGreaterThanOrEqual(4.5);
    expect(await screen.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`psm-${width}-${dark ? 'oscuro' : 'claro'}.png`) });

    const download = page.waitForEvent('download');
    await screen.locator('[data-psm-export]').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^productos-sin-movimiento-\d{4}-\d{2}-\d{2}-30-dias\.csv$/);
    const lines = (await readFile((await file.path())!, 'utf8')).replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[1]).toBe('Producto,Código,Stock actual,Última venta,Costo unitario,Valor inventario');
    expect(lines).toHaveLength(4);

    // Si NA_ROLES falla, el valor y los datos se ocultan.
    await page.evaluate(() => { (window as any).NA_ROLES.isOwner = () => { throw new Error('rol roto'); }; (window as any).NA_PRODUCTOS_SIN_MOVIMIENTO.render(); });
    await expect(rows).toHaveCount(0);
    await expect(screen.locator('[data-psm-total-value]')).toHaveCount(0);
    await expect(screen.locator('[data-psm-controls]')).toBeHidden();
    expect(await page.evaluate(() => (window as any).NA_PRODUCTOS_SIN_MOVIMIENTO.exportCsv())).toBe(false);

    expect(await page.evaluate(() => (window as any).eval('JSON.stringify({productos, ventas})'))).toBe(before);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('el empleado no ve el reporte ni el valor', async ({ page }) => {
  await rolePage(page, 'empleado', false);
  expect(await page.evaluate(() => { const a = (window as any).NA_PRODUCTOS_SIN_MOVIMIENTO; return { r: a.render(), e: a.exportCsv() }; })).toEqual({ r: false, e: false });
  await expect(page.locator(`${screenId} [data-psm-content]`)).toBeEmpty();
  await expect(page.locator(`${screenId} [data-psm-status]`)).toContainText('Sin permiso');
});

// Revisión #854: sin stock (0 o negativo) no es stock inmovilizado; «Incluir sin stock» lo muestra.
test('por defecto excluye stock ≤ 0; «Incluir sin stock» lo muestra', async ({ page }) => {
  const { errors, writes } = await rolePage(page, 'owner', false);
  await page.waitForLoadState('networkidle'); // loadAllData (IndexedDB) termina antes de sembrar
  await page.evaluate(() => (window as any).eval('productos = ' + JSON.stringify([
    { id: 'm5-3', name: 'Nunca vendido', stock: 10, costo: 0, precio: 3, activo: true },
    { id: 'm5-0', name: 'Agotado', stock: 0, costo: 1, precio: 2, activo: true },
    { id: 'm5-n', name: 'Stock negativo', stock: -3, costo: 1, precio: 2, activo: true }
  ]) + '; ventas = []'));
  await page.evaluate(() => (window as any).goPage('pageProductosSinMovimiento'));
  const screen = page.locator(screenId);
  const check = screen.locator('[data-psm-no-stock]');
  await expect(check).not.toBeChecked();
  await expect(screen.locator('[data-psm-row="id:m5-3"]')).toHaveCount(1);
  await expect(screen.locator('[data-psm-row="id:m5-0"]')).toHaveCount(0);
  await expect(screen.locator('[data-psm-row="id:m5-n"]')).toHaveCount(0);
  await check.check();
  await expect(screen.locator('[data-psm-row="id:m5-0"]')).toHaveCount(1);
  await expect(screen.locator('[data-psm-row="id:m5-n"]')).toHaveCount(1);
  await check.uncheck();
  await expect(screen.locator('[data-psm-row="id:m5-0"]')).toHaveCount(0);
  await expect(screen.locator('[data-psm-row="id:m5-n"]')).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
