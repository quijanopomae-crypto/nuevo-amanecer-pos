import { test, expect, type Page } from '@playwright/test';

// HTML y scripts reales. Rol y compras sintéticos, solo en el navegador de la prueba; sin red externa.
function limaMonth(offset: number) {
  const d = new Date(Date.now() - 5 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}
const CUR = limaMonth(0), PREV = limaMonth(-1);
const PURCHASES = [
  { purchase_id: 'c1', status: 'aplicada', supplier: 'Proveedor Sintético SAC', created_at: CUR + '-02T15:00:00Z', lines: [{ line_number: 0, product_id: 'dc-1', quantity: 100, unit_cost_cents: 1234 }, { line_number: 1, product_id: 'dc-2', quantity: 10, unit_cost_cents: 500 }] },
  { purchase_id: 'c2', status: 'aplicada', supplier: 'Distribuidora Prueba', created_at: PREV + '-10T15:00:00Z', lines: [{ line_number: 0, product_id: 'dc-1', quantity: 50, unit_cost_cents: 1200 }] }
];
async function rolePage(page: Page, role: 'owner' | 'empleado' | '', openLock = false) {
  let purchaseReads = 0;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') {
      if (url.pathname === '/auth/purchases') { purchaseReads++; expect(route.request().method()).toBe('GET'); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
        url.pathname === '/auth/me' ? { pos_role: role || null, owner_pin_set: true, roles_ready: true, device_id: 'dc-test-device' }
          : url.pathname === '/auth/purchases' ? { purchases: PURCHASES, ready: true, truncated: false } : {}
      ) });
    }
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.addInitScript(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic' }));
    if (role) localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_DASHBOARD_COMPRAS && !!(window as any).NA_ROLES);
  if (role) await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
  else await page.evaluate(() => {
    const w = window as any, roles = w.NA_ROLES;
    w.NA_ROLES = new Proxy(roles, { get: (t, k) => k === 'role' ? '' : k === 'isOwner' ? () => false : t[k] });
  });
  // Abre el candado solo en este navegador de prueba; pos-permissions.js sigue en true.
  if (openLock) await page.evaluate(() => {
    const w = window as any, P = w.NA_PERMISSIONS;
    // Copia (el original está congelado): solo cambia featureLocked para esta función.
    w.NA_PERMISSIONS = Object.freeze({ ...P, featureLocked: (id: string) => id === 'dashboard-compras' ? false : P.featureLocked(id) });
  });
  await page.evaluate(() => {
    const w = window as any;
    // Modo nube simulado: la fuente es GET /auth/purchases.
    w.NuevoAmanecerCanonical = { enabled: () => true, snapshot: () => ({ products: [], inventoryMovements: [] }), sourceState: () => ({ source: 'remote' }) };
    // @ts-ignore POS runtime globals (let léxicos)
    productos = [{ id: 'dc-1', name: 'Aceite sintético', cat: 'Abarrotes', costo: 12.34, precio: 15 }, { id: 'dc-2', name: 'Yogur sintético', cat: 'Lácteos', costo: 5, precio: 7 }];
  });
  return { reads: () => purchaseReads };
}
const snapshot = (page: Page) => page.evaluate(() => JSON.stringify(
  ['pagePOS', 'pageMenu', 'naMobileDrawer'].map(id => (document.getElementById(id)?.innerHTML || '').replace(/ data-scanner-ready="true"| style=""| data-motion="[a-z]*"/g, '').replace(/(<main[^>]*id="posArea"[^>]*>)[\s\S]*?(<\/main>)/, '$1$2'))
));

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  const theme = dark ? 'oscuro' : 'claro';
  test(`dueño ve el dashboard de compras en ${width}px, tema ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner', true);
    await page.evaluate(dark => (window as any).NA_THEME.setMode(dark ? 'noche' : 'claro'), dark);
    const before = await snapshot(page);
    expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.FEATURE_LOCKS['dashboard-compras'])).toBe(true);
    await page.evaluate(() => (window as any).goPage('pageDashboardCompras'));
    const screen = page.locator('#pageDashboardCompras');
    await expect(screen).toHaveClass(/\bactive\b/);
    await expect(page.locator('#naNoPermission')).toHaveCount(0);
    const cards = screen.locator('.dc-card');
    await expect(cards.nth(0).locator('strong')).toHaveText('S/ 1,284.00');
    await expect(cards.nth(0).locator('.dc-prev')).toHaveText('Mes anterior: S/ 600.00 · +114.0%');
    await expect(cards.nth(1).locator('strong')).toHaveText('1');
    await expect(cards.nth(1).locator('.dc-prev')).toContainText('0.0%');
    await expect(screen.locator('.dc-section').nth(0)).toContainText('Aceite sintético');
    await expect(screen.locator('.dc-section').nth(1)).toContainText('Lácteos');
    await expect(screen.locator('.dc-section').nth(2)).toContainText('Proveedor Sintético SAC');
    await expect(screen.locator('.dc-section').nth(2)).toContainText('Distribuidora Prueba');
    await expect(screen.locator('[data-dc-status]')).toContainText('hora de Lima');
    await expect(screen).toHaveCSS('background-color', dark ? 'rgb(15, 23, 42)' : 'rgb(248, 250, 252)');
    expect(await screen.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('.dc-card, .dc-section, button')).every(n => {
        const b = n.getBoundingClientRect(); return b.left >= bounds.left - 1 && b.right <= bounds.right + 1;
      }) && document.documentElement.scrollWidth <= window.innerWidth + 1;
    })).toBe(true);
    // Solo lectura: Actualizar no escribe en el almacenamiento.
    const writes = await page.evaluate(async () => {
      const S = Storage.prototype, o = [S.setItem, S.removeItem, S.clear]; let n = 0; const f = () => { n++; };
      S.setItem = f; S.removeItem = f; S.clear = f;
      try { (document.querySelector('#pageDashboardCompras [data-dc-refresh]') as HTMLButtonElement).click(); await new Promise(r => setTimeout(r, 300)); return n; }
      finally { [S.setItem, S.removeItem, S.clear] = o; }
    });
    expect(writes).toBe(0);
    await expect(cards.nth(0).locator('strong')).toHaveText('S/ 1,284.00');
    await page.screenshot({ path: `test-results/dashboard-compras-${width}-${theme}.png` });
    const after = JSON.parse(await snapshot(page)), b = JSON.parse(before);
    expect(after[0]).toBe(b[0]); expect(after[1]).toBe(b[1]);
  });

  test(`empleado no ve el dashboard de compras en ${width}px, tema ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const net = await rolePage(page, 'empleado');
    await page.evaluate(dark => (window as any).NA_THEME.setMode(dark ? 'noche' : 'claro'), dark);
    await page.evaluate(() => (window as any).goPage('pageDashboardCompras'));
    await expect(page.locator('#naNoPermission')).toBeVisible();
    await expect(page.locator('#pageDashboardCompras')).not.toHaveClass(/\bactive\b/);
    await page.evaluate(() => (window as any).NA_DASHBOARD_COMPRAS.render());
    const report = page.locator('#pageDashboardCompras [data-dc-report]');
    await expect(report).toHaveText('Sin permiso. Pídele acceso al dueño.');
    await expect(page.locator('#pageDashboardCompras .dc-card')).toHaveCount(0);
    const pageText = await page.locator('#pageDashboardCompras').textContent();
    for (const leak of ['S/ 1,284.00', 'Proveedor Sintético', 'Distribuidora', '12.34']) expect(pageText).not.toContain(leak);
    expect(net.reads()).toBe(0);
  });
}

test('candado real cerrado: el dueño no ve nada y no se piden compras', async ({ page }) => {
  const net = await rolePage(page, 'owner');
  expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('dashboard-compras'))).toBe(true);
  await page.evaluate(() => (window as any).goPage('pageDashboardCompras'));
  await page.evaluate(() => (window as any).NA_DASHBOARD_COMPRAS.render());
  await page.evaluate(() => (window as any).NA_DASHBOARD_COMPRAS.refresh());
  await page.waitForTimeout(300);
  await expect(page.locator('#pageDashboardCompras .dc-card')).toHaveCount(0);
  await expect(page.locator('#pageDashboardCompras .dc-section')).toHaveCount(0);
  const text = (await page.locator('#pageDashboardCompras').textContent()) || '';
  for (const leak of ['S/ 1,284.00', 'Proveedor Sintético', 'Distribuidora', 'Aceite sintético']) expect(text).not.toContain(leak);
  expect(net.reads()).toBe(0);
});

test('rol desconocido: falla cerrado', async ({ page }) => {
  const net = await rolePage(page, '');
  await page.evaluate(() => (window as any).NA_DASHBOARD_COMPRAS.render());
  await expect(page.locator('#pageDashboardCompras [data-dc-report]')).toHaveText('Sin permiso. Pídele acceso al dueño.');
  await expect(page.locator('#pageDashboardCompras [data-dc-controls]')).toBeHidden();
  expect(net.reads()).toBe(0);
});

test('el módulo usa solo textContent', async ({ page }) => {
  const res = await page.request.get('/js/modules/dashboard-compras.js');
  expect(await res.text()).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
});
