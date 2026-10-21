import { test, expect, type Page } from '@playwright/test';

// Costo ausente (#884/#886): para un empleado el servidor y la réplica offline omiten el costo.
// Ausente se muestra «—»; un costo 0 real cargado por el dueño sigue mostrando 0.00. Datos sintéticos, sin red real.
const base = { cat: 'abarrotes', marca: 'Sin marca', unidad: 'unidad', unidadCompra: 'unidad', factorCompra: 1, stockMin: 1,
  venc: null, icon: '📦', imagen: null, incluyeIGV: true, tipoImpuesto: 'gravado', impuestoComplementario: '',
  controlInventario: true, precioCaja: null, unidCaja: null, codigosAlternativos: [], codigoAlternativo: '', descripcion: '' };
const ABSENT = { ...base, id: 991001, name: 'Arroz sin costo', sku: 'CA-AUS', barcode: '', precio: 4, stock: 5 };
const ZERO = { ...base, id: 991002, name: 'Bolsa costo cero', sku: 'CA-CERO', barcode: '', costo: 0, precio: 2, stock: 3 };
const NORMAL = { ...base, id: 991003, name: 'Leche costo normal', sku: 'CA-NORM', barcode: '', costo: 1.25, precio: 2, stock: 4 };

async function rolePage(page: Page, role: 'owner' | 'empleado') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'costo-ausente-device' } : {}
    ) });
    return url.hostname === '127.0.0.1' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.continue() : route.abort();
  });
  await page.addInitScript(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic-test-only' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.goto('/index.html');
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
  await page.waitForFunction(() => !!(window as any).NA_MENU_NAVIGATION);
}

async function seed(page: Page, products: unknown[], sales: unknown[] = []) {
  await page.evaluate(({ products, sales }) => {
    (0, eval)('productos = ' + JSON.stringify(products));
    (0, eval)('ventas = ' + JSON.stringify(sales));
    (0, eval)('appConfig.margenActive = true; appConfig.stockAlertActive = true;');
    (0, eval)('_naNormalizeData()');
    (window as any).NA_MENU_NAVIGATION.navigate('pageInventario');
    (window as any).invRender();
  }, { products, sales });
}

test('empleado: fila de inventario, Costo inv. y Ganancia pot. muestran «—» sin costo; 0 real muestra 0.00', async ({ page }) => {
  await rolePage(page, 'empleado');
  await seed(page, [ABSENT, ZERO, NORMAL]);
  // La normalización no convierte el costo ausente en 0.
  expect(await page.evaluate(() => (0, eval)('productos').map((p: any) => p.costo))).toEqual([undefined, 0, 1.25]);
  const row = (name: string) => page.locator('#invBody tr', { hasText: name });
  await expect(row('Arroz sin costo')).toContainText('Costo: —');
  await expect(row('Arroz sin costo')).not.toContainText('Costo: S/');
  await expect(row('Bolsa costo cero')).toContainText('Costo: S/ 0.00');
  await expect(row('Leche costo normal')).toContainText('Costo: S/ 1.25');
  await expect(page.locator('#invS3')).toHaveText('—');
  await expect(page.locator('#invS5')).toHaveText('—');
  // Solo productos con costo conocido (0 real y normal): cifras normales.
  await seed(page, [ZERO, NORMAL]);
  await expect(page.locator('#invS3')).toHaveText('S/5');
  await expect(page.locator('#invS5')).toHaveText('S/9');
});

test('ficha: costo ausente queda vacío con «—» y margen «—»; 0 real conserva 0 y normal calcula el margen', async ({ page }) => {
  await rolePage(page, 'empleado');
  await seed(page, [ABSENT, ZERO, NORMAL]);
  const open = async (id: number) => page.evaluate(id => (window as any).editProd(id), id);
  await open(ABSENT.id);
  await expect(page.locator('#mProd')).toHaveClass(/\bopen\b/);
  await expect(page.locator('#pCosto')).toHaveValue('');
  await expect(page.locator('#pCosto')).toHaveAttribute('placeholder', '—');
  await expect(page.locator('#mgVal')).toHaveText('—');
  await page.locator('#pPrecio').evaluate((el: HTMLInputElement) => { el.value = '9'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#mgVal')).toHaveText('—');
  await open(ZERO.id);
  await expect(page.locator('#pCosto')).toHaveValue('0');
  await expect(page.locator('#pCosto')).toHaveAttribute('placeholder', '0.00');
  await expect(page.locator('#mgVal')).toHaveText('∞%');
  await open(NORMAL.id);
  await expect(page.locator('#pCosto')).toHaveValue('1.25');
  await expect(page.locator('#mgVal')).toHaveText('60.0%');
  // Alta nueva: el placeholder vuelve a 0.00.
  await page.evaluate(() => (window as any).abrirModalProd());
  await expect(page.locator('#pCosto')).toHaveAttribute('placeholder', '0.00');
});

test('guardar (modo local): costo ausente con campo vacío no guarda 0 y no aplica el control bajo costo; 0 real se conserva', async ({ page }) => {
  await rolePage(page, 'owner');
  await seed(page, [ABSENT, ZERO, NORMAL]);
  const save = async (id: number, price: string) => {
    await page.evaluate(id => (window as any).editProd(id), id);
    await page.locator('#pPrecio').evaluate((el: HTMLInputElement, v) => { el.value = v; }, price);
    await page.evaluate(() => (window as any).guardarProd());
  };
  await save(ABSENT.id, '0.50');
  await expect.poll(() => page.evaluate(id => { const p = (0, eval)('productos').find((x: any) => x.id === id); return [p.precio, p.costo === undefined ? 'ausente' : p.costo]; }, ABSENT.id))
    .toEqual([0.5, 'ausente']);
  await save(ZERO.id, '2.50');
  await expect.poll(() => page.evaluate(id => { const p = (0, eval)('productos').find((x: any) => x.id === id); return [p.precio, p.costo]; }, ZERO.id))
    .toEqual([2.5, 0]);
  // Con costo conocido el control bajo costo sigue activo.
  await save(NORMAL.id, '1.00');
  await expect(page.locator('#gToast')).toContainText('menor al costo');
  expect(await page.evaluate(id => (0, eval)('productos').find((x: any) => x.id === id).precio, NORMAL.id)).toBe(2);
});

test('Ventas: sin costo en la venta la Ganancia bruta/neta es «—»; con costo 0 es un monto', async ({ page }) => {
  await rolePage(page, 'empleado');
  const today = await page.evaluate(() => (0, eval)('obtenerHoy()'));
  const sale = (id: string, item: Record<string, unknown>) => ({ id, fecha: today, hora: '10:00', hora24: '10:00:00', timestamp: today + 'T15:00:00.000Z',
    total: 8, metodo: 'efectivo', estado: 'completada', anulada: false, clienteId: null,
    items: [{ id: ABSENT.id, name: 'Arroz sin costo', qty: 2, cantidad: 2, precio: 4, subtotal: 8, unitsPerQty: 1, ...item }] });
  const kpis = async () => {
    await page.evaluate(() => { (window as any).NA_MENU_NAVIGATION.navigate('pageVentas'); (window as any).ventasRender(); });
    const values = page.locator('#ventasKPI .vkpi-val');
    await expect(values).toHaveCount(4);
    await expect(values.first()).not.toHaveText('—');
    return values;
  };
  await seed(page, [ABSENT], [sale('V-AUS', {})]);
  let values = await kpis();
  await expect(values.nth(1)).toHaveText('—');
  await expect(values.nth(3)).toHaveText('—');
  await seed(page, [ZERO], [sale('V-CERO', { id: ZERO.id, costo: 0 })]);
  values = await kpis();
  await expect(values.nth(1)).toHaveText('S/ 8.00');
});
