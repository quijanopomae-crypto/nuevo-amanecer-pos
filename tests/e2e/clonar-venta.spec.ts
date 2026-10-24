import { test, expect, type Page } from '@playwright/test';

test.use({ hasTouch: true });
// El candado va cerrado por defecto; la prueba lo abre solo en su copia del navegador (no cambia el archivo).
let abierto = true;
test.beforeEach(async ({ page }) => {
  abierto = true;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (abierto && url.pathname.endsWith('/js/config/pos-permissions.js')) {
      const res = await route.fetch();
      return route.fulfill({ response: res, body: (await res.text()).replace("'clonar-venta': true", "'clonar-venta': false") });
    }
    return route.continue();
  });
});

// Datos sintéticos, solo en el navegador de la prueba. No se cobra ni se guarda nada.
async function openVentas(page: Page, { dark = false } = {}) {
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_CLONAR_VENTA && !!(window as any).NA_MENU_NAVIGATION);
  await page.evaluate(({ dark }) => {
    const w = window as any;
    document.body.classList.toggle('dark', dark);
    w.saveAllData = async () => ({ persisted: true });
    productos = [
      { id: 501, name: 'Prueba arroz', sku: 'T501', precio: 1234.5, costo: 1, stock: 50, stockMin: 0, cat: 'abarrotes', icon: '🍚' },
      { id: 502, name: 'Prueba aceite', sku: 'T502', precio: 9.9, costo: 1, stock: 1, stockMin: 0, cat: 'abarrotes', icon: '🫙' }
    ];
    clientes = [{ id: 'c-77', nombre: 'Cliente prueba', dni: '', creditos: [] }];
    const base = { fecha: '2026-10-20', hora: '10:00', metodo: 'efectivo', cajero: 'Caja', estado: 'completada' };
    ventas = [
      { ...base, id: 'V-9001', clienteId: 'c-77', clienteNombre: 'Cliente prueba', total: 25, items: [
        { id: 501, name: 'Prueba arroz', precio: 1, qty: 2, unitsPerQty: 1 }, { id: 502, name: 'Prueba aceite', precio: 1, qty: 3, unitsPerQty: 1 }] },
      { ...base, id: 'V-9002', anulada: true, total: 1, items: [{ id: 501, name: 'Prueba arroz', precio: 1, qty: 1, unitsPerQty: 1 }] }
    ];
    cart.splice(0, cart.length);
    w.NA_MENU_NAVIGATION.navigate('pageVentas');
    ventasTab = 'historial';
    w.ventasRender();
  }, { dark });
  await expect(page.locator('#pageVentas')).toHaveClass(/active/);
}

const menuLayout = (page: Page) => page.evaluate(() => document.getElementById('pageMenu')!.innerHTML.replace(/ data-scanner-ready="true"| style=""/g, ''));

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`Clonar venta en ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openVentas(page, { dark });
    const menuBefore = await menuLayout(page);
    await page.locator('#ventasContent .v-header', { hasText: '#9001' }).click();
    const btn = page.locator('#ventasContent .v-detalle.open .na-clonar-venta-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('📑 Clonar venta');
    const box = await btn.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
    await btn.click();
    await expect(page.locator('#pagePOS')).toHaveClass(/active/);
    const state = await page.evaluate(() => ({
      cart: cart.map((l: any) => ({ id: l.id, qty: l.qty, precio: l.precio })), ventas: ventas.length,
      cobro: document.getElementById('mCobro')!.classList.contains('open')
    }));
    expect(state.cart).toEqual([{ id: 501, qty: 2, precio: 1234.5 }, { id: 502, qty: 1, precio: 9.9 }]);
    expect(state.ventas).toBe(2);
    expect(state.cobro).toBe(false);
    await expect(page.locator('#posTotal')).toContainText('2,478.90');
    expect(await menuLayout(page)).toBe(menuBefore);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('la venta anulada no se puede clonar', async ({ page }) => {
  await openVentas(page);
  await page.locator('#ventasContent .v-header', { hasText: '#9002' }).click();
  const btn = page.locator('#ventasContent .v-detalle.open .na-clonar-venta-btn');
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveAttribute('title', 'Las ventas anuladas no se pueden clonar');
  const r = await page.evaluate(() => (window as any).NA_CLONAR_VENTA.clone('V-9002'));
  expect(r.reason).toBe('annulled');
  expect(await page.evaluate(() => cart.length)).toBe(0);
});

test('el cliente de la venta original se propone al abrir el cobro', async ({ page }) => {
  await openVentas(page);
  await page.evaluate(() => { const s = document.getElementById('mVentaCliente') as HTMLSelectElement; const o = document.createElement('option'); o.value = 'c-77'; o.textContent = 'Cliente prueba'; s.appendChild(o); });
  await page.evaluate(() => (window as any).NA_CLONAR_VENTA.clone('V-9001'));
  await page.evaluate(() => { (document.getElementById('mVentaCliente') as HTMLSelectElement).value = ''; document.getElementById('mCobro')!.classList.add('open'); });
  await expect(page.locator('#mVentaCliente')).toHaveValue('c-77');
});

test('el módulo usa solo textContent', async ({ page }) => {
  const res = await page.request.get('/js/modules/clonar-venta.js');
  expect(await res.text()).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
});

test('con el candado puesto no aparece el botón', async ({ page }) => {
  abierto = false;
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_CLONAR_VENTA && !!(window as any).NA_MENU_NAVIGATION);
  await page.evaluate(() => { ventas = [{ id: 'V-9003', fecha: '2026-10-20', hora: '1', metodo: 'efectivo', items: [{ id: 1, name: 'x', precio: 1, qty: 1 }] }]; (window as any).NA_MENU_NAVIGATION.navigate('pageVentas'); ventasTab = 'historial'; (window as any).ventasRender(); });
  await expect(page.locator('#ventasContent .na-clonar-venta-btn')).toHaveCount(0);
});

test('si los permisos aún no cargan, Clonar venta queda bloqueado (falla cerrado)', async ({ page }) => {
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_CLONAR_VENTA);
  const r = await page.evaluate(() => {
    const w = window as any;
    w.eval(`ventas=[{id:'V-1',items:[{id:'x',name:'X',qty:1}]}]`);
    w.NA_PERMISSIONS = undefined;
    return w.NA_CLONAR_VENTA.clone('V-1');
  });
  expect(r).toEqual({ ok: false, reason: 'locked' });
  expect(await page.evaluate(() => (window as any).eval('cart.length'))).toBe(0);
});
