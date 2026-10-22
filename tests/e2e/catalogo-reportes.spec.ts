import { test, expect, type Page } from '@playwright/test';

// HTML y scripts reales; rol sintético y sin red externa. El candado real sigue cerrado:
// para probar la pantalla abierta, solo en el navegador de la prueba se abre 'catalogo-reportes'.
async function rolePage(page: Page, role: 'owner' | 'empleado' | '', unlock = true) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role || null, owner_pin_set: true, roles_ready: true, device_id: 'cr-test-device' } : {}
    ) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.addInitScript(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic' }));
    if (role) localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_CATALOGO_REPORTES && !!(window as any).NA_ROLES && !!(window as any).NA_PERMISSIONS);
  if (role) await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
  else await page.evaluate(() => {
    const w = window as any, roles = w.NA_ROLES;
    w.NA_ROLES = new Proxy(roles, { get: (t, k) => k === 'role' ? '' : k === 'isOwner' ? () => false : t[k] });
  });
  if (unlock) await page.evaluate(() => {
    const w = window as any, P = w.NA_PERMISSIONS;
    // NA_PERMISSIONS está congelado: se reemplaza por una copia, solo en esta prueba.
    w.NA_PERMISSIONS = { ...P, featureLocked: (id: string) => id === 'catalogo-reportes' ? false : P.featureLocked(id) };
  });
}
const layouts = (page: Page) => page.evaluate(() => ['pagePOS', 'pageMenu', 'naMobileDrawer'].map(id => (document.getElementById(id)?.innerHTML || '').replace(/ data-scanner-ready="true"| style=""| data-motion="[a-z]*"| aria-current="page"/g, '').replace(/(<main[^>]*id="posArea"[^>]*>)[\s\S]*?(<\/main>)/, '$1$2')).join('|'));
const items = '#pageCatalogoReportes [data-cr-report]';

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño ve el catálogo agrupado en ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner');
    const before = await layouts(page);
    await page.evaluate(dark => (window as any).NA_THEME.setMode(dark ? 'noche' : 'claro'), dark);
    await page.evaluate(() => (window as any).goPage('pageCatalogoReportes'));
    const screen = page.locator('#pageCatalogoReportes');
    await expect(screen).toHaveClass(/\bactive\b/);
    const expected = await page.evaluate(() => (window as any).NA_CATALOGO_REPORTES.visible('').length);
    expect(expected).toBeGreaterThanOrEqual(15);
    await expect(page.locator(items)).toHaveCount(expected);
    await expect(screen.locator('[data-cr-category]')).toHaveCount(4);
    await expect(screen.locator('h2')).toHaveText(['Ventas', 'Caja', 'Inventario', 'Clientes']);
    await expect(screen.locator('[data-cr-search]')).toBeVisible();
    expect(await screen.locator('[data-cr-list]').textContent()).not.toMatch(/S\/|\d+[.,]\d{2}/);
    await expect(screen).toHaveCSS('background-color', dark ? 'rgb(15, 23, 42)' : 'rgb(248, 250, 252)');
    expect(await screen.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('.cr-item, input, button')).every(n => { const b = n.getBoundingClientRect(); return b.left >= bounds.left - 1 && b.right <= bounds.right + 1; })
        && document.documentElement.scrollWidth <= window.innerWidth + 1;
    })).toBe(true);
    await page.screenshot({ path: `test-results/catalogo-reportes-${width}-${dark ? 'oscuro' : 'claro'}.png` });
    await page.locator('#pageCatalogoReportes input[type=search]').fill('kardex');
    await expect(page.locator(items)).toHaveCount(1);
    await page.getByRole('button', { name: 'Abrir Kardex por producto' }).click();
    await expect(page.locator('#pageKardex')).toHaveClass(/\bactive\b/);
    expect(await layouts(page)).toBe(before);
  });

  test(`empleado no ve el catálogo en ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'empleado');
    await page.evaluate(dark => (window as any).NA_THEME.setMode(dark ? 'noche' : 'claro'), dark);
    await page.evaluate(() => (window as any).goPage('pageCatalogoReportes'));
    await expect(page.locator('#naNoPermission')).toBeVisible();
    await expect(page.locator('#pageCatalogoReportes')).not.toHaveClass(/\bactive\b/);
    await page.evaluate(() => (window as any).NA_CATALOGO_REPORTES.render());
    await expect(page.locator('#pageCatalogoReportes [data-cr-list]')).toHaveText('Sin permiso. Pídele acceso al dueño.');
    await expect(page.locator(items)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('rol desconocido: falla cerrado', async ({ page }) => {
  await rolePage(page, '');
  await page.evaluate(() => (window as any).NA_CATALOGO_REPORTES.render());
  await expect(page.locator('#pageCatalogoReportes [data-cr-list]')).toHaveText('Sin permiso. Pídele acceso al dueño.');
  await expect(page.locator('#pageCatalogoReportes [data-cr-search]')).toBeHidden();
  expect(await page.evaluate(() => (window as any).NA_CATALOGO_REPORTES.open('kardex'))).toBe(false);
});

test('candado real cerrado: el dueño no ve ningún reporte', async ({ page }) => {
  await rolePage(page, 'owner', false);
  expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('catalogo-reportes'))).toBe(true);
  await page.evaluate(() => (window as any).NA_CATALOGO_REPORTES.render());
  await expect(page.locator('#pageCatalogoReportes [data-cr-list]')).toHaveText('Esta función todavía no está disponible.');
  await expect(page.locator(items)).toHaveCount(0);
});

test('sin NA_PERMISSIONS: falla cerrado', async ({ page }) => {
  await rolePage(page, 'owner');
  await page.evaluate(() => { (window as any).NA_PERMISSIONS = undefined; (window as any).NA_CATALOGO_REPORTES.render(); });
  await expect(page.locator(items)).toHaveCount(0);
});

test('un destino con su candado cerrado no aparece', async ({ page }) => {
  await rolePage(page, 'owner');
  await page.evaluate(() => {
    const w = window as any, P = w.NA_PERMISSIONS;
    w.NA_PERMISSIONS = { ...P, featureLocked: (id: string) => id === 'kardex' ? true : P.featureLocked(id) };
    w.goPage('pageCatalogoReportes'); w.NA_CATALOGO_REPORTES.render();
  });
  await expect(page.locator('#pageCatalogoReportes [data-cr-report="kardex"]')).toHaveCount(0);
  await expect(page.locator('#pageCatalogoReportes [data-cr-report="valorizacion"]')).toHaveCount(1);
});

test('cada destino existe y abre su página; Reportes abre la pestaña', async ({ page }) => {
  await rolePage(page, 'owner');
  const reports = await page.evaluate(() => (window as any).NA_CATALOGO_REPORTES.REPORTS.map((r: any) => ({ id: r.id, page: r.page })));
  for (const r of reports) {
    expect(await page.locator(`#${r.page}.page`).count(), r.page).toBe(1);
    const ok = await page.evaluate(id => { const w = window as any; w.goPage('pageCatalogoReportes'); return w.NA_CATALOGO_REPORTES.open(id); }, r.id);
    if (ok) await expect(page.locator(`#${r.page}`), r.id).toHaveClass(/\bactive\b/);
  }
  await page.evaluate(() => (window as any).NA_CATALOGO_REPORTES.open('reportes-ventas'));
  // @ts-ignore let global del POS
  expect(await page.evaluate(() => ventasTab)).toBe('reportes');
  await expect(page.locator('#ventasReportControls')).toBeVisible();
});

test('el módulo usa solo textContent', async ({ page }) => {
  const res = await page.request.get('/js/modules/catalogo-reportes.js');
  expect(await res.text()).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
});
