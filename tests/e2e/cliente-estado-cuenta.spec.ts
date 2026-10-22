import { test, expect, type Page } from '@playwright/test';

test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

// Datos sintéticos; el rol se simula solo en el navegador de la prueba.
async function openClients(page: Page, { dark = false, role = 'empleado' } = {}) {
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_CLIENTE_ESTADO_CUENTA && !!window.NA_MENU_NAVIGATION);
  await page.evaluate(({ dark, role }) => {
    const w = window as any;
    const roles = w.NA_ROLES;
    w.NA_ROLES = new Proxy(roles, { get: (t, k) => k === 'role' ? role : k === 'isOwner' ? () => role === 'owner' : t[k] });
    // El candado sigue en true en pos-permissions.js; solo esta prueba lo abre.
    const perms = w.NA_PERMISSIONS;
    w.NA_PERMISSIONS = { ...perms, featureLocked: (id: string) => id === 'estado-cuenta-cliente' ? false : perms.featureLocked(id) };
    document.body.classList.toggle('dark', dark);
    clientes = [
      { id: 't-ana', nombre: 'Ana Prueba', dni: '', telefono: '', creditos: [] },
      { id: 't-beto', nombre: 'Beto Prueba', dni: '', telefono: '', creditos: [] },
      { id: 't-sin', nombre: 'Sin creditos', dni: '', telefono: '', creditos: [] }
    ];
    const cr = (id: string, cli: string, monto: number, fecha: string, pagos: any[], extra: any = {}) => ({ id, credit_id: id, cliId: cli, clienteId: cli,
      monto, pagado: pagos.filter(p => !p.status).reduce((s, p) => s + p.monto, 0), status: 'vigente', fecha, vence: '', pagos, items: [], costo: 999, desc: 'Venta ' + id, ...extra });
    creditos = [
      // 2026-10-02 03:00 UTC = 2026-10-01 22:00 en Lima.
      cr('C1', 't-ana', 1500, '2026-10-01', [{ id: 'P1', monto: 200, timestamp: '2026-10-02T03:00:00Z', metodo: 'Efectivo' },
        { id: 'P2', monto: 50, timestamp: '2026-10-05T15:00:00Z', status: 'REVERTED' }]),
      cr('C2', 't-ana', 10.5, '2026-10-10', []),
      cr('C3', 't-ana', 999999, '2026-10-11', [], { anulado: true }),
      cr('C4', 't-beto', 20, '2026-10-12', [])
    ];
    const canonical = w.NuevoAmanecerCanonical;
    w.NuevoAmanecerCanonical = { ...canonical, pendingSnapshot: () => null };
    window.NA_MENU_NAVIGATION.navigate('pageClientes');
    w.cliRender();
    w.NA_CLIENTE_ESTADO_CUENTA.render();
  }, { dark, role });
  await expect(page.locator('#pageClientes')).toHaveClass(/active/);
}

const snapshot = (page: Page) => page.evaluate(() => JSON.stringify({ clientes, creditos,
  layouts: ['pagePOS', 'pageMenu'].map(id => document.getElementById(id)!.innerHTML.replace(/ data-scanner-ready="true"| style=""/g, '')) }));

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`Movimientos de cuenta en ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openClients(page, { dark });
    const before = await snapshot(page);
    const entry = page.getByRole('button', { name: 'Movimientos de cuenta', exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
    const panel = page.locator('#naEstadoCuenta');
    const select = panel.locator('select[data-ec-client]');
    await expect(select.locator('option')).toHaveText(['Elige un cliente', 'Ana Prueba', 'Beto Prueba']);
    await select.selectOption('t-ana');
    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('01/10/2026');
    await expect(rows.nth(0).locator('td').nth(1)).toHaveText('S/ 1,500.00');
    await expect(rows.nth(1)).toContainText('01/10/2026');
    await expect(rows.nth(1)).toContainText('22:00');
    await expect(rows.nth(1).locator('td').nth(2)).toHaveText('S/ 200.00');
    await expect(rows.nth(1).locator('td').nth(3)).toHaveText('S/ 1,300.00');
    await expect(rows.nth(2).locator('td').nth(3)).toHaveText('S/ 1,310.50');
    await expect(panel.locator('[data-ec-total]')).toHaveText('Cargos S/ 1,510.50 · Abonos S/ 200.00 · Saldo S/ 1,310.50');
    await expect(panel).toContainText('hora de Lima');
    await expect(panel).not.toContainText(/costo|999/i);
    const box = (await select.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/estado-cuenta-${width}-${dark ? 'oscuro' : 'claro'}.png` });
    const a = JSON.parse(await snapshot(page)), b = JSON.parse(before);
    expect(JSON.stringify(a.clientes)).toBe(JSON.stringify(b.clientes));
    expect(JSON.stringify(a.creditos)).toBe(JSON.stringify(b.creditos));
    expect(a.layouts).toEqual(b.layouts);
  });
}

test('el dueño también lo ve', async ({ page }) => {
  await openClients(page, { role: 'owner' });
  await expect(page.locator('#naEstadoCuentaBtn')).toBeVisible();
});

test('rol desconocido: falla cerrado', async ({ page }) => {
  await openClients(page, { role: '' });
  await expect(page.locator('#naEstadoCuentaBtn')).toBeHidden();
});

test('el módulo usa solo textContent', async ({ page }) => {
  const res = await page.request.get('/js/modules/cliente-estado-cuenta.js');
  expect(await res.text()).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
});

test('candado en true o permisos sin cargar: el botón no aparece (falla cerrado)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openClients(page, { role: 'owner' });
  const entry = page.getByRole('button', { name: 'Movimientos de cuenta', exact: true });
  await expect(entry).toBeVisible();
  await page.evaluate(() => { const w = window as any; w.NA_PERMISSIONS = { ...w.NA_PERMISSIONS, featureLocked: () => true }; w.NA_CLIENTE_ESTADO_CUENTA.render(); });
  await expect(entry).toBeHidden();
  await page.evaluate(() => { const w = window as any; w.NA_PERMISSIONS = { ...w.NA_PERMISSIONS, featureLocked: undefined }; w.NA_CLIENTE_ESTADO_CUENTA.render(); });
  await expect(entry).toBeHidden();
});

test('limaMoment: con zona se pasa a Lima, sin zona se usa la hora local tal cual', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_CLIENTE_ESTADO_CUENTA);
  const r = await page.evaluate(() => { const m = (window as any).NA_CLIENTE_ESTADO_CUENTA.limaMoment;
    return [m('2026-10-02T03:00:00Z'), m('2026-10-02T03:00:00-05:00'), m('2026-10-02T03:00:00'), m('', '2026-10-03')]; });
  expect(r[0]).toEqual({ key: '2026-10-01T22:00', day: '2026-10-01', time: '22:00' });
  expect(r[1]).toEqual({ key: '2026-10-02T03:00', day: '2026-10-02', time: '03:00' });
  expect(r[2]).toEqual({ key: '2026-10-02T03:00', day: '2026-10-02', time: '03:00' });
  expect(r[3]).toEqual({ key: '2026-10-03T00:00', day: '2026-10-03', time: '' });
});
