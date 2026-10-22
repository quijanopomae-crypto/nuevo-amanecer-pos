import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Recalcular stock: vista previa (solo dueño) (solo lectura). Datos sintéticos, modo local.
async function rolePage(page: Page, role: 'owner' | 'empleado') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'rs-test-device' } : url.pathname === '/auth/purchases' ? { purchases: [], truncated: false } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'rs-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
}
async function seed(page: Page) {
  await page.evaluate(() => (window as any).eval(`
    var t=(d)=>new Date(Date.now()-d*864e5).toISOString();
    productos=[
      {id:'rs-1',name:'Arroz 1kg',sku:'RS-01',stock:12,costo:3,precio:5,controlInventario:true},
      {id:'rs-2',name:'Leche',sku:'RS-02',stock:7,costo:2,precio:4,controlInventario:true},
      {id:'rs-3',name:'Pan antiguo',sku:'RS-03',stock:9,controlInventario:true}];
    inventoryMovements=[
      {id:'m1',productId:'rs-1',type:'ALTA',delta:10,timestamp:t(5),reason:'Alta de producto con stock inicial 10'},
      {id:'m2',productId:'rs-1',type:'ENTRADA',delta:5,timestamp:t(3),reason:'Compra a proveedor'},
      {id:'m3',productId:'rs-2',type:'ALTA',delta:7,timestamp:t(4),reason:'Alta de producto con stock inicial 7'},
      {id:'m4',productId:'rs-3',type:'ENTRADA',delta:2,timestamp:t(2),reason:'Ingreso'},
      {id:'m5',productId:'rs-1',type:'SALE',delta:-1,timestamp:t(1),reason:'Venta',referenceId:'v1'}];
    ventas=[];
    window._naGetActiveCashier=()=>({id:'C-0001',nombre:'Dueño'});
  `));
}
async function openScreen(page: Page) {
  await page.evaluate(() => (window as any).goPage('pageProximamente'));
  await page.locator('[data-feature-id="ajustes-inventario"]').click();
  await expect(page.locator('#pageAjustesInventario')).toBeVisible();
  await page.evaluate(() => (window as any).NA_RECALCULAR_STOCK.render());
}

test('el módulo no usa innerHTML', () => {
  const src = readFileSync('POS/js/modules/recalcular-stock.js', 'utf8');
  expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
});

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño ve la vista previa de diferencias a ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner');
    await seed(page);
    await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
    await openScreen(page);
    const box = page.locator('[data-rs-section]');
    await expect(box).toBeVisible();
    // Arroz: 10 + 5 - 1 = 14 según movimientos; stock actual 12 → diferencia -2.
    const arroz = box.locator('[data-rs-row="rs-1"]');
    await expect(arroz).toHaveAttribute('data-rs-status', 'diferencia');
    await expect(arroz.locator('td[data-label="Stock según movimientos"]')).toHaveText('14');
    await expect(arroz.locator('td[data-label="Diferencia"]')).toHaveText('-2');
    await expect(box.locator('[data-rs-row="rs-2"]')).toHaveAttribute('data-rs-status', 'ok');
    await expect(box.locator('[data-rs-row="rs-3"]')).toHaveAttribute('data-rs-status', 'sin-alta');
    await expect(box.locator('[data-rs-row="rs-3"] [data-rs-fix]')).toHaveCount(0);
    await expect(box).not.toContainText(/costo/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    // Solo lectura: no hay botón de corregir y no cambia stock ni movimientos.
    await expect(box.locator('button')).toHaveText(['Volver a calcular']);
    await box.locator('[data-rs-refresh]').click();
    const state = JSON.parse(await page.evaluate(() => (window as any).eval('JSON.stringify({s:productos.map(x=>x.stock),m:inventoryMovements.length})')));
    expect(state).toEqual({ s: [12, 7, 9], m: 5 });
  });
}

test('empleado no ve Recalcular stock', async ({ page }) => {
  await rolePage(page, 'empleado');
  await seed(page);
  await page.evaluate(() => { (window as any).goPage('pageAjustesInventario'); (window as any).NA_RECALCULAR_STOCK.render(); });
  await expect(page.locator('[data-rs-section]')).toBeHidden();
  await expect(page.locator('[data-rs-row]')).toHaveCount(0);
});
