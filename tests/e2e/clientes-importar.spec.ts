import { test, expect, type Page } from '@playwright/test';

test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

// Datos sintéticos. guardarCli se envuelve solo para registrar qué filas pasan por el alta manual
// (el mismo camino de «+ Cliente»); la llamada real se conserva.
async function openClients(page: Page, { dark = false, unlock = true } = {}) {
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_CLIENTES_IMPORTAR && !!(window as any).NA_MENU_NAVIGATION);
  await page.evaluate(({ dark, unlock }) => {
    const w = window as any;
    // El candado sigue cerrado en pos-permissions.js; la prueba lo abre solo en este navegador.
    if (unlock) { const perms = w.NA_PERMISSIONS; w.NA_PERMISSIONS = { ...perms, featureLocked: (id: string) => id === 'importar-clientes' ? false : perms.featureLocked(id) }; }
    document.body.classList.toggle('dark', dark);
    clientes = [{ id: 'existente', nombre: 'Cliente existente', dni: '12345678', tel: '987000111', dir: 'Calle 1', totalCompras: 0 }];
    w.__calls = [];
    const original = w.guardarCli;
    w.guardarCli = async function (...args: unknown[]) {
      w.__calls.push(['cNombre', 'cDni', 'cTel', 'cDir', 'cLinea'].map(id => (document.getElementById(id) as HTMLInputElement).value));
      return await original.apply(this, args);
    };
    w.NA_MENU_NAVIGATION.navigate('pageClientes');
    w.cliRender();
    w.NA_CLIENTES_IMPORTAR.render();
  }, { dark, unlock });
  await expect(page.locator('#pageClientes')).toHaveClass(/active/);
}

const CSV = '\uFEFFnombre;documento;telefono;direccion;linea_credito\r\n' +
  'Ana Nueva;87654321;912345678;Jr. Uno 1;150,50\r\n' +
  'Duplicado por DNI;12.345.678;;;\r\n' +
  'Sin documento;;;Av. Dos;\r\n' +
  ';11112222;;;\r\n' +
  'Doc malo;123;;;\r\n' +
  'Repetida en archivo;87654321;;;\r\n';

const layout = (page: Page) => page.evaluate(() =>
  ['pagePOS', 'pageMenu'].map(id => document.getElementById(id)!.innerHTML.replace(/ data-scanner-ready="true"| style=""/g, '')));

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`Importar clientes en ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openClients(page, { dark });
    const before = await layout(page);
    const entry = page.getByRole('button', { name: 'Importar clientes', exact: true });
    await expect(entry).toBeVisible();
    await entry.click();
    const panel = page.locator('#naImportarClientes');
    await expect(panel).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Descargar plantilla' }).click()]);
    expect(download.suggestedFilename()).toBe('plantilla-clientes.csv');

    await panel.locator('[data-ic-file]').setInputFiles({ name: 'clientes.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf-8') });
    await expect(panel.locator('[data-ic-summary]')).toHaveText('2 para importar · 2 duplicados · 2 con error');
    await expect(panel.locator('[data-ic-line="3"]')).toHaveAttribute('data-ic-row', 'duplicado');
    await expect(panel.locator('[data-ic-line="3"]')).toContainText('Cliente existente');
    await expect(panel.locator('[data-ic-line="5"]')).toContainText('Falta el nombre');
    await expect(panel.locator('[data-ic-line="6"]')).toContainText('8 dígitos');
    await expect(panel.locator('[data-ic-line="7"]')).toContainText('repetido en la fila 2');
    await expect(panel).not.toContainText(/costo|proveedor/i);

    for (const b of await panel.locator('.ic-btn:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/importar-clientes-${width}-${dark ? 'oscuro' : 'claro'}.png`, fullPage: false });

    await panel.getByRole('button', { name: 'Importar 2 clientes' }).click();
    await expect(panel.locator('[data-ic-status]')).toContainText('2 clientes importados', { timeout: 20_000 });
    await expect(page.locator('#gToast')).toContainText('2 clientes importados');
    expect(await page.locator('.toast').count()).toBe(1);
    const calls = await page.evaluate(() => (window as any).__calls);
    expect(calls).toEqual([['Ana Nueva', '87654321', '912345678', 'Jr. Uno 1', '150.50'], ['Sin documento', '', '', 'Av. Dos', '']]);
    const list = await page.evaluate(() => clientes.map((c: any) => [c.nombre, c.dni]));
    expect(list).toEqual([['Cliente existente', '12345678'], ['Ana Nueva', '87654321'], ['Sin documento', '']]);
    expect(await page.evaluate(() => clientes[0])).toMatchObject({ nombre: 'Cliente existente', tel: '987000111', dir: 'Calle 1' });
    expect(await layout(page)).toEqual(before);
  });
}

test('el módulo usa solo textContent', async ({ page }) => {
  const res = await page.request.get('/js/modules/clientes-importar.js');
  expect(await res.text()).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
});

test('sin permiso de clientes no aparece el botón', async ({ page }) => {
  await openClients(page);
  await page.evaluate(() => { (window as any)._naF10HasPermission = () => false; (window as any).NA_CLIENTES_IMPORTAR.render(); });
  await expect(page.locator('#naImportarClientesBtn')).toBeHidden();
});

test('si no es el dueño, la columna Línea se ignora', async ({ page }) => {
  await openClients(page);
  await page.evaluate(() => { try { Object.defineProperty(window, 'NA_ROLES', { value: { role: 'empleado', isOwner: () => false }, configurable: true, writable: true }); } catch (_) {} });
  const res = await page.evaluate(() => (window as any).NA_CLIENTES_IMPORTAR.buildPreview('nombre;linea_credito\nAna;150\n', { docs: {}, phones: {} }));
  expect(res.lineIgnored).toBe(true);
  expect(res.rows[0].lineaTexto).toBe('');
});

test('no abre la importación si «+ Cliente» tiene datos sin guardar', async ({ page }) => {
  await openClients(page);
  await page.evaluate(() => { (document.getElementById('cNombre') as HTMLInputElement).value = 'A medio escribir'; });
  await page.getByRole('button', { name: 'Importar clientes', exact: true }).click();
  await expect(page.locator('#naImportarClientes')).toBeHidden();
  expect(await page.evaluate(() => (document.getElementById('cNombre') as HTMLInputElement).value)).toBe('A medio escribir');
});

test('sin roles cargados no es dueño: la columna Línea se ignora', async ({ page }) => {
  await openClients(page);
  const res = await page.evaluate(() => {
    const w = window as any;
    Object.defineProperty(w, 'NA_ROLES', { value: undefined, configurable: true, writable: true });
    return w.NA_CLIENTES_IMPORTAR.buildPreview('nombre;linea_credito\nAna;150\n', { docs: {}, phones: {} });
  });
  expect(res.lineIgnored).toBe(true);
  expect(res.rows[0].lineaTexto).toBe('');
});

// Candado real cerrado (#904, pos-permissions.js sin tocar): ni botón ni panel, y no importa nada.
for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`candado cerrado real: sin botón ni importación ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openClients(page, { dark, unlock: false });
    expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('importar-clientes'))).toBe(true);
    expect(await page.evaluate(() => (window as any).NA_CLIENTES_IMPORTAR.unlocked())).toBe(false);
    await expect(page.getByRole('button', { name: 'Importar clientes', exact: true })).toHaveCount(0);
    await expect(page.locator('#naImportarClientes')).toHaveCount(0);
    const res = await page.evaluate(() => (window as any).NA_CLIENTES_IMPORTAR.loadText('nombre\nAna\n'));
    expect(res).toEqual({ error: 'Disponible pronto.' });
    await page.evaluate(() => (window as any).NA_CLIENTES_IMPORTAR.confirmImport());
    expect(await page.evaluate(() => (window as any).__calls)).toEqual([]);
    expect(await page.evaluate(() => clientes.length)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
