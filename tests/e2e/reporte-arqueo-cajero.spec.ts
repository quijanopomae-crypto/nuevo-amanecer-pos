import { test, expect, type Page } from '@playwright/test';

// Datos sintéticos; rol dueño simulado solo en el navegador de la prueba. Sin servidor (offline).
async function open(page: Page, dark: boolean, unlock = true) {
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_REPORTE_ARQUEO && !!(window as any).NA_MENU_NAVIGATION);
  await page.context().setOffline(true);
  await page.evaluate(([dark, unlock]) => {
    const w = window as any;
    const roles = w.NA_ROLES;
    w.NA_ROLES = new Proxy(roles, { get: (t, k) => k === 'role' ? 'owner' : k === 'isOwner' ? () => true : t[k] });
    if (unlock) {
      const perms = w.NA_PERMISSIONS;
      w.NA_PERMISSIONS = { ...perms, featureLocked: (id: string) => id === 'reporte-arqueo-cajero' ? false : perms.featureLocked(id) }; // NA_PERMISSIONS está congelado: copia, no Proxy
    }
    document.body.classList.toggle('dark', dark);
    const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
    const at = (t: string) => new Date(today + 'T' + t + ':00-05:00').toISOString();
    const s = (id: string, who: string, exp: number, cnt: number) => ({ session_id: id, status: 'CLOSED', opened_at: at('08:00'), closed_at: at('20:00'),
      expected_cents: exp, counted_cents: cnt, difference_cents: cnt - exp, opened_by_name: who, closed_by_name: who });
    const snap = { cashSessions: [s('a1', 'Ana Prueba', 123456789, 123456789), s('b1', 'Beto Prueba', 1000, 950), s('a2', 'Ana Prueba', 500, 500)] };
    w.NuevoAmanecerCanonical = { ...w.NuevoAmanecerCanonical, snapshot: () => snap };
    w.NA_MENU_NAVIGATION.navigate('pageReporteArqueo');
  }, [dark, unlock] as const);
  await expect(page.locator('#pageReporteArqueo')).toHaveClass(/active/);
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`arqueo filtra por cajero en ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, dark);
    const screen = page.locator('#pageReporteArqueo');
    await expect(screen.locator('tbody tr')).toHaveCount(3);
    const select = screen.getByLabel('Cajero');
    await expect(select.locator('option')).toHaveText(['Todos los cajeros', 'Ana Prueba', 'Beto Prueba']);
    await select.selectOption('Ana Prueba');
    await expect(screen.locator('tbody tr')).toHaveCount(2);
    await expect(screen.locator('tfoot th')).toHaveText('Total · 2 cierres');
    await expect(screen.locator('tfoot td').first()).toHaveText('S/ 1,234,572.89');
    await expect(screen.locator('[data-ra-status]')).toContainText('cajero: Ana Prueba');
    await expect(screen.locator('[data-ra-status]')).toContainText('hora de Lima');
    await select.selectOption('Beto Prueba');
    await expect(screen.locator('tbody tr')).toHaveCount(1);
    await expect(screen.locator('tbody tr td').last()).toHaveText('-S/ 0.50 (faltante)');
    const box = (await select.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/arqueo-cajero-${width}-${dark ? 'oscuro' : 'claro'}.png` });
  });
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`candado cerrado: sin selector Cajero ni filtro en ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, dark, false);
    const screen = page.locator('#pageReporteArqueo');
    await expect(screen.locator('tbody tr')).toHaveCount(3);
    await expect(screen.locator('[data-ra-cajero]')).toBeHidden();
    await expect(screen.locator('[data-ra-desde]')).toBeVisible();
    await expect(screen.locator('[data-ra-status]')).not.toContainText('cajero:');
    const ignored = await page.evaluate(() => {
      const w = window as any, today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
      const at = new Date(today + 'T12:00:00-05:00').toISOString();
      const rows = ['A', 'B'].map(n => ({ session_id: n, status: 'CLOSED', opened_at: at, closed_at: at, expected_cents: 1, counted_cents: 1, opened_by_name: n, closed_by_name: n }));
      return w.NA_REPORTE_ARQUEO.buildReport(rows, { cajero: 'A' }).rows.length;
    });
    expect(ignored).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('buildReport: filtro por cajero y lista de cajeros', async ({ page }) => {
  await page.goto('/index.html');
  const r = await page.evaluate(() => {
    const d = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
    const at = new Date(d + 'T12:00:00-05:00').toISOString();
    const rows = [{ session_id: 'x', status: 'CLOSED', opened_at: at, closed_at: at, expected_cents: 1, counted_cents: 1, opened_by_name: 'A', closed_by_name: 'B' }];
    const w = window as any, perms = w.NA_PERMISSIONS;
    w.NA_PERMISSIONS = { ...perms, featureLocked: (id: string) => id === 'reporte-arqueo-cajero' ? false : perms.featureLocked(id) }; // NA_PERMISSIONS está congelado: copia, no Proxy
    const R = w.NA_REPORTE_ARQUEO;
    return [R.buildReport(rows, { cajero: 'B' }).rows.length, R.buildReport(rows, { cajero: 'C' }).rows.length, R.buildReport(rows, {}).cashiers];
  });
  expect(r).toEqual([1, 0, ['A', 'B']]);
});

test('el módulo usa solo textContent', async ({ page }) => {
  const res = await page.request.get('/js/modules/reporte-arqueo.js');
  expect(await res.text()).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
});

test('servidor recortó la lista: el aviso usa el total del servidor, no el filtrado', async ({ page }) => {
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_REPORTE_ARQUEO && !!(window as any).NA_MENU_NAVIGATION);
  await page.evaluate(() => {
    const w = window as any;
    const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
    const at = (t: string) => new Date(today + 'T' + t + ':00-05:00').toISOString();
    const s = (id: string, who: string) => ({ session_id: id, status: 'CLOSED', opened_at: at('08:00'), closed_at: at('20:00'), expected_cents: 100, counted_cents: 100, difference_cents: 0, opened_by_name: who, closed_by_name: who });
    const rows = [s('a1', 'Ana Prueba'), s('b1', 'Beto Prueba'), s('a2', 'Ana Prueba')];
    const perms = w.NA_PERMISSIONS;
    w.NA_PERMISSIONS = { ...perms, featureLocked: (id: string) => id === 'reporte-arqueo-cajero' ? false : perms.featureLocked(id) }; // NA_PERMISSIONS está congelado: copia, no Proxy
    const roles = w.NA_ROLES;
    w.NA_ROLES = new Proxy(roles, { get: (t, k) => k === 'role' ? 'owner' : k === 'isOwner' ? () => true : k === 'api' ? async () => ({ cash_closes: rows, truncated: true }) : t[k] });
    w.NA_MENU_NAVIGATION.navigate('pageReporteArqueo');
  });
  const screen = page.locator('#pageReporteArqueo');
  await expect(screen.locator('[data-ra-truncated]')).toContainText('solo los 3 cierres');
  await screen.getByLabel('Cajero').selectOption('Ana Prueba');
  await expect(screen.locator('[data-ra-truncated]')).toContainText('solo los 3 cierres más recientes de este rango (2 son de este cajero)');
});
