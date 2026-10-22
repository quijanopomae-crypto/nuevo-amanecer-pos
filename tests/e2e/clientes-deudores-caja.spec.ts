import { test, expect, type Page } from '@playwright/test';

test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

// data-scanner-ready y style="" los agrega el escáner de Venta por su cuenta; no es un cambio de diseño.
// Datos sintéticos. El rol se simula solo en el navegador de la prueba.
async function openClients(page: Page, { dark = false, role = 'empleado' } = {}) {
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_CLIENTES_DEUDORES_CAJA && !!window.NA_MENU_NAVIGATION);
  await page.evaluate(({ dark, role }) => {
    const w = window as any;
    const roles = w.NA_ROLES;
    w.NA_ROLES = new Proxy(roles, { get: (t, k) => k === 'role' ? role : k === 'isOwner' ? () => role === 'owner' : t[k] });
    document.body.classList.toggle('dark', dark);
    const day = (n: number) => new Date(Date.now() - 5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
    clientes = [
      { id: 't-venc', nombre: 'Prueba vencida', dni: '', telefono: '', creditos: [] },
      { id: 't-pronto', nombre: 'Prueba pronto', dni: '', telefono: '', creditos: [] },
      { id: 't-aldia', nombre: 'Prueba al dia', dni: '', telefono: '', creditos: [] },
      { id: 't-cero', nombre: 'Prueba sin deuda', dni: '', telefono: '', creditos: [] }
    ];
    const cr = (id: string, cli: string, monto: number, vence: string) => ({ id, credit_id: id, cliId: cli, clienteId: cli,
      monto, pagado: 0, saldo: monto, status: 'vigente', vence, fecha: day(-40), pagos: [], items: [], costo: 999 });
    creditos = [cr('C1', 't-venc', 111110, day(-3)), cr('C2', 't-pronto', 50.5, day(3)), cr('C3', 't-aldia', 20, day(30))];
    const canonical = w.NuevoAmanecerCanonical;
    w.NuevoAmanecerCanonical = { ...canonical, pendingSnapshot: () => null };
    window.NA_MENU_NAVIGATION.navigate('pageClientes');
    w.cliRender();
    w.NA_CLIENTES_DEUDORES_CAJA.render();
  }, { dark, role });
  await expect(page.locator('#pageClientes')).toHaveClass(/active/);
}

const snapshot = (page: Page) => page.evaluate(() => JSON.stringify({ clientes, creditos,
  layouts: ['pagePOS', 'pageMenu'].map(id => document.getElementById(id)!.innerHTML.replace(/ data-scanner-ready="true"| style=""/g, "")) }));

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`Clientes que deben (cajero) en ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openClients(page, { dark });
    const before = await snapshot(page);
    const entry = page.getByRole('button', { name: 'Clientes que deben', exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
    const panel = page.locator('#naDeudoresCaja');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.dc-row')).toHaveCount(3);
    await expect(panel.locator('[data-client-id="t-venc"] .dc-balance .dc-value')).toHaveText('S/ 111,110.00');
    await expect(panel.locator('[data-client-id="t-pronto"] .dc-balance .dc-value')).toHaveText('S/ 50.50');
    await expect(panel).not.toContainText(/costo|999/i);
    const group = page.getByRole('group', { name: 'Filtrar por vencimiento' });
    for (const [label, id] of [['Vencidas', 't-venc'], ['Vencen en 7 días', 't-pronto'], ['Al día', 't-aldia']]) {
      const b = group.getByRole('button', { name: label, exact: true });
      await b.click();
      await expect(b).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.locator('.dc-row')).toHaveCount(1);
      await expect(panel.locator(`[data-client-id="${id}"]`)).toBeVisible();
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await group.getByRole('button', { name: 'Todos', exact: true }).click();
    await expect(panel.locator('[data-dc-total]')).toContainText('3 clientes · Total S/ 111,180.50');
    await expect(panel.locator('[data-dc-total]')).toContainText('hora de Lima');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/deudores-caja-${width}-${dark ? 'oscuro' : 'claro'}.png`, fullPage: false });
    const after = await snapshot(page);
    const a = JSON.parse(after), b = JSON.parse(before);
    expect(JSON.stringify(a.clientes)).toBe(JSON.stringify(b.clientes));
    expect(JSON.stringify(a.creditos)).toBe(JSON.stringify(b.creditos));
    expect(a.layouts[1]).toBe(b.layouts[1]);
    expect(a.layouts[0]).toBe(b.layouts[0]);
  });
}

test('el dueño no ve el botón del cajero (usa su Reporte de deuda)', async ({ page }) => {
  await openClients(page, { role: 'owner' });
  await expect(page.locator('#naDeudoresCajaBtn')).toBeHidden();
  await expect(page.locator('#naDeudoresCaja')).toBeHidden();
});

test('rol desconocido: falla cerrado', async ({ page }) => {
  await openClients(page, { role: '' });
  await expect(page.locator('#naDeudoresCajaBtn')).toBeHidden();
});

test('el módulo usa solo textContent', async ({ page }) => {
  const res = await page.request.get('/js/modules/clientes-deudores-caja.js');
  expect(await res.text()).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
});

test('el rol llega tarde: el botón aparece con na:role y se oculta si deja de ser cajero', async ({ page }) => {
  await openClients(page, { role: '' });
  const entry = page.locator('#naDeudoresCajaBtn');
  await expect(entry).toBeHidden();
  await page.evaluate(() => {
    const w = window as any; let role = 'empleado';
    const base = Object.getPrototypeOf(w.NA_ROLES) && w.NA_ROLES;
    w.NA_ROLES = new Proxy(base, { get: (t, k) => k === 'role' ? role : k === 'isOwner' ? () => role === 'owner' : t[k] });
    w.__setRole = (r: string) => { role = r; };
    window.dispatchEvent(new Event('na:role'));
  });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.locator('#naDeudoresCaja')).toBeVisible();
  await page.evaluate(() => { (window as any).__setRole('owner'); window.dispatchEvent(new Event('na:role')); });
  await expect(entry).toBeHidden();
  await expect(page.locator('#naDeudoresCaja')).toBeHidden();
});
