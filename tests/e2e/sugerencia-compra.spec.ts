import { test, expect, type Page } from '@playwright/test';
import { isAssistantPing } from './helpers/known-background-requests';
import { readFile } from 'node:fs/promises';

// Misión 6: sugerencia de compra. Datos sintéticos; sin clientes reales.
test.use({ serviceWorkers: 'block' });
const screenId = '#pageSugerenciaCompra';

async function rolePage(page: Page, role: 'owner' | 'empleado', dark: boolean) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  const writes: string[] = [];
  page.on('request', r => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method()) && !isAssistantPing(r)) writes.push(r.method() + ' ' + r.url()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'sc-m6' } : {}) });
    return url.hostname === '127.0.0.1' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'sc-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed && !!(window as any).NA_SUGERENCIA_COMPRA, role);
  await seedM6(page, dark);
  return { errors, writes };
}

async function seedM6(page: Page, dark: boolean) {
  await page.evaluate(dark => {
    const w = window as any;
    document.body.classList.toggle('dark', dark);
    const ago = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
    w.eval('productos = ' + JSON.stringify([
      { id: 'm6-1', name: 'Arroz sugerido', stock: 2, stockMin: 5, costo: 3, precio: 5, proveedor: 'Distribuidora Sol', activo: true },
      { id: 'm6-2', name: 'Azucar sugerida <b>x</b>', stock: 1, stockMin: 4, costo: 2, precio: 3, proveedor: 'Mayorista Norte', activo: true },
      { id: 'm6-3', name: 'Sobrado', stock: 99, stockMin: 5, costo: 1, precio: 2, activo: true }
    ]) + '; ventas = ' + JSON.stringify([{ id: 'v1', fecha: ago(2), items: [{ id: 'm6-1', qty: 4, precio: 5 }] }]));
  }, dark);
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
  test(`sugerencia de compra a ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const { errors, writes } = await rolePage(page, 'owner', dark);
    const before = await page.evaluate(() => (window as any).eval('JSON.stringify({productos, ventas})'));
    await page.evaluate(() => (window as any).goPage('pageProximamente'));
    const card = page.locator('[data-feature-id="sugerencia-compra"]');
    await expect(card.locator('.na-prox-available')).toHaveText('Disponible');
    await card.click();
    const screen = page.locator(screenId);
    await expect(screen).toHaveClass(/\bactive\b/);

    // Agrupado por proveedor; sugerido = mínimo + vendido − stock.
    const groups = screen.locator('[data-sc-group]');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0).locator('h2')).toHaveText('Distribuidora Sol');
    await expect(groups.nth(1).locator('h2')).toHaveText('Mayorista Norte');
    await expect(screen.locator('[data-sc-row="id:m6-3"]')).toHaveCount(0);
    const arroz = screen.locator('[data-sc-row="id:m6-1"]');
    await expect(arroz.locator('[data-sc-qty]')).toHaveValue('7');
    await expect(screen.locator('[data-sc-totals]')).toHaveText('2 productos · 10 unidades · costo estimado S/ 27.00');
    await expect(screen.locator('b')).toHaveCount(0);
    await expect(screen.locator('[data-sc-status]')).toContainText('hora de Lima');

    // Editar y quitar antes de exportar.
    await arroz.locator('[data-sc-qty]').fill('12');
    await expect(screen.locator('[data-sc-totals]')).toHaveText('2 productos · 15 unidades · costo estimado S/ 42.00');
    await screen.locator('[data-sc-row="id:m6-2"] [data-sc-remove]').click();
    await expect(screen.locator('[data-sc-row="id:m6-2"] [data-sc-qty]')).toHaveValue('0');
    await expect(screen.locator('[data-sc-totals]')).toHaveText('1 producto · 12 unidades · costo estimado S/ 36.00');

    for (const sel of ['[data-sc-qty] >> nth=0', '[data-sc-remove] >> nth=0', '[data-sc-export]', '[data-sc-status]', '[data-sc-totals]', 'h2 >> nth=0']) expect(await contrast(screen.locator(sel)), sel).toBeGreaterThanOrEqual(4.5);
    expect(await screen.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`sc-${width}-${dark ? 'oscuro' : 'claro'}.png`) });

    const download = page.waitForEvent('download');
    await screen.locator('[data-sc-export]').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^sugerencia-compra-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = (await readFile((await file.path())!, 'utf8')).replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('Distribuidora Sol,Arroz sugerido,,2,5,4,7,12,3.00,36.00');

    // Imprimir: solo la lista, sin las líneas en 0 ni botones.
    await page.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
    await screen.locator('[data-sc-print]').click();
    expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
    await page.emulateMedia({ media: 'print' });
    expect(await arroz.evaluate(el => getComputedStyle(el).visibility)).toBe('visible');
    expect(await screen.locator('[data-sc-row="id:m6-2"]').evaluate(el => getComputedStyle(el).display)).toBe('none');
    expect(await screen.locator('[data-sc-export]').evaluate(el => getComputedStyle(el).visibility)).toBe('hidden');
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

    // Si NA_ROLES falla, todo se oculta.
    await page.evaluate(() => { (window as any).NA_ROLES.isOwner = () => { throw new Error('rol roto'); }; (window as any).NA_SUGERENCIA_COMPRA.render(); });
    await expect(screen.locator('[data-sc-group]')).toHaveCount(0);
    await expect(screen.locator('[data-sc-controls]')).toBeHidden();
    expect(await page.evaluate(() => (window as any).NA_SUGERENCIA_COMPRA.exportCsv())).toBe(false);

    expect(await page.evaluate(() => (window as any).eval('JSON.stringify({productos, ventas})'))).toBe(before);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('el empleado no ve la sugerencia', async ({ page }) => {
  await rolePage(page, 'empleado', false);
  expect(await page.evaluate(() => { const a = (window as any).NA_SUGERENCIA_COMPRA; return { r: a.render(), e: a.exportCsv(), p: a.printPlan() }; })).toEqual({ r: false, e: false, p: false });
  await expect(page.locator(`${screenId} [data-sc-content]`)).toBeEmpty();
  await expect(page.locator(`${screenId} [data-sc-status]`)).toContainText('Sin permiso');
});

// Revisión #855: lo editado en «A pedir» no se pierde al volver a renderizar (na:role, clase active,
// salir y volver a la pantalla, Recalcular); «Usar sugeridos» vuelve a la sugerencia.
test('las cantidades editadas sobreviven a na:role, al cambio de clase y a salir y volver', async ({ page }) => {
  const { errors, writes } = await rolePage(page, 'owner', false);
  // La carga inicial (loadAllData: IndexedDB + normalización) es asíncrona; se espera a que termine y se
  // vuelven a sembrar los datos sintéticos para que no los reemplace a mitad de la prueba.
  await page.waitForLoadState('networkidle');
  await seedM6(page, false);
  const screen = page.locator(screenId);
  await page.evaluate(() => (window as any).goPage('pageSugerenciaCompra'));
  await expect(screen).toHaveClass(/\bactive\b/);
  const arroz = screen.locator('[data-sc-row="id:m6-1"] [data-sc-qty]');
  const azucar = screen.locator('[data-sc-row="id:m6-2"] [data-sc-qty]');
  const reset = screen.locator('[data-sc-reset]');
  const totals = screen.locator('[data-sc-totals]');
  await expect(arroz).toHaveValue('7');
  await expect(reset).toBeDisabled();

  await arroz.fill('12');
  await arroz.blur();
  await screen.locator('[data-sc-row="id:m6-2"] [data-sc-remove]').click();
  const edited = '1 producto · 12 unidades · costo estimado S/ 36.00';
  await expect(totals).toHaveText(edited);
  await expect(reset).toBeEnabled();

  const expectEdited = async (why: string) => {
    await expect(arroz, why).toHaveValue('12');
    await expect(azucar, why).toHaveValue('0');
    await expect(screen.locator('[data-sc-row="id:m6-2"]'), why).toHaveAttribute('data-sc-zero', '');
    await expect(totals, why).toHaveText(edited);
    await expect(reset, why).toBeEnabled();
  };

  // 1) Evento de rol (render(true) desde el listener de na:role); se marca el DOM para probar que se redibujó.
  await arroz.evaluate(el => { (el as any).__old = true; });
  await page.evaluate(() => window.dispatchEvent(new Event('na:role')));
  await expect.poll(() => arroz.evaluate(el => !!(el as any).__old)).toBe(false);
  await expectEdited('tras na:role');

  // 2) La pantalla deja de estar activa y vuelve (MutationObserver de clase).
  await arroz.evaluate(el => { (el as any).__old = true; });
  await screen.evaluate(el => { el.classList.remove('active'); });
  await screen.evaluate(el => { el.classList.add('active'); });
  await expect.poll(() => arroz.evaluate(el => !!(el as any).__old)).toBe(false);
  await expectEdited('tras alternar la clase active');

  // 3) Salir a otra pantalla y volver.
  await page.evaluate(() => (window as any).goPage('pageProximamente'));
  await expect(screen).not.toHaveClass(/\bactive\b/);
  await page.evaluate(() => (window as any).goPage('pageSugerenciaCompra'));
  await expect(screen).toHaveClass(/\bactive\b/);
  await expectEdited('tras salir y volver');

  // 4) Recalcular conserva lo editado.
  await screen.locator('[data-sc-recalc]').click();
  await expectEdited('tras Recalcular');

  // 5) Usar sugeridos descarta lo editado y también tras otro render.
  await reset.click();
  await expect(arroz).toHaveValue('7');
  await expect(azucar).toHaveValue('3');
  await expect(totals).toHaveText('2 productos · 10 unidades · costo estimado S/ 27.00');
  await expect(reset).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event('na:role')));
  await expect(arroz).toHaveValue('7');

  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
