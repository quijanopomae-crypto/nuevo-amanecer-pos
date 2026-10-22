import { test, expect, type Page } from '@playwright/test';

// Datos sintéticos; rol dueño simulado solo en el navegador de la prueba. Sin servidor (offline).
async function open(page: Page, dark: boolean) {
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_REPORTE_ARQUEO && !!(window as any).NA_MENU_NAVIGATION);
  await page.context().setOffline(true);
  await page.evaluate(dark => {
    const w = window as any;
    const roles = w.NA_ROLES;
    w.NA_ROLES = new Proxy(roles, { get: (t, k) => k === 'role' ? 'owner' : k === 'isOwner' ? () => true : t[k] });
    document.body.classList.toggle('dark', dark);
    const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
    const at = (t: string) => new Date(today + 'T' + t + ':00-05:00').toISOString();
    const s = (id: string, who: string, exp: number, cnt: number) => ({ session_id: id, status: 'CLOSED', opened_at: at('08:00'), closed_at: at('20:00'),
      expected_cents: exp, counted_cents: cnt, difference_cents: cnt - exp, opened_by_name: who, closed_by_name: who });
    const snap = { cashSessions: [s('a1', 'Ana Prueba', 123456789, 123456789), s('b1', 'Beto Prueba', 1000, 950), s('a2', 'Ana Prueba', 500, 500)] };
    w.NuevoAmanecerCanonical = { ...w.NuevoAmanecerCanonical, snapshot: () => snap };
    w.NA_MENU_NAVIGATION.navigate('pageReporteArqueo');
  }, dark);
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

test('buildReport: filtro por cajero y lista de cajeros', async ({ page }) => {
  await page.goto('/index.html');
  const r = await page.evaluate(() => {
    const d = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
    const at = new Date(d + 'T12:00:00-05:00').toISOString();
    const rows = [{ session_id: 'x', status: 'CLOSED', opened_at: at, closed_at: at, expected_cents: 1, counted_cents: 1, opened_by_name: 'A', closed_by_name: 'B' }];
    const R = (window as any).NA_REPORTE_ARQUEO;
    return [R.buildReport(rows, { cajero: 'B' }).rows.length, R.buildReport(rows, { cajero: 'C' }).rows.length, R.buildReport(rows, {}).cashiers];
  });
  expect(r).toEqual([1, 0, ['A', 'B']]);
});

test('el módulo usa solo textContent', async ({ page }) => {
  const res = await page.request.get('/js/modules/reporte-arqueo.js');
  expect(await res.text()).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
});
