import { test, expect, type Page } from '@playwright/test';

// Misión 2: costo de última compra en la ficha (solo dueño). Datos sintéticos, modo local.
async function rolePage(page: Page, role: 'owner' | 'empleado') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'ccf-device' } : url.pathname === '/auth/purchases' ? { purchases: [], truncated: false } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'ccf-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
  await page.evaluate(() => (window as any).eval(`
    productos=[{id:'cc-1',name:'Aceite 1L',sku:'CC-01',stock:20,stockMin:2,costo:4,precio:6,controlInventario:true,unidad:'unidad',cat:'abarrotes',marca:'Sin marca'}];
    inventoryMovements=[
      {id:'cc-a',productId:'cc-1',type:'ENTRADA',delta:10,reason:'Compra a proveedor',unit_cost_cents:300,timestamp:'2026-10-01T15:00:00Z',fecha:'2026-10-01'},
      {id:'cc-b',productId:'cc-1',type:'ENTRADA',delta:10,reason:'Compra a proveedor',unit_cost_cents:450,timestamp:'2026-10-10T15:00:00Z',fecha:'2026-10-10'}];
    ventas=[];
  `));
}
const openFicha = (page: Page) => page.evaluate(() => (window as any).editProd('cc-1'));

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño usa el costo de la última compra a ${width}px ${dark ? 'oscuro' : 'claro'}, guarda y queda en el historial`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner');
    await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
    const before = await page.evaluate(() => (window as any).eval('JSON.stringify({ventas,creditos,cajMovs})'));
    await openFicha(page);
    const box = page.locator('#naCostoCompraFicha');
    await expect(box).toContainText('Última compra: S/ 4.50 · 10/10/2026 10:00');
    await expect(box).toContainText('Promedio ponderado: S/ 3.75');
    await page.evaluate(() => { const d = document.getElementById('pCosto')!.closest('details'); if (d) d.open = true; });
    await box.scrollIntoViewIfNeeded();
    await box.getByRole('button', { name: 'Usar promedio' }).click();
    await expect(page.locator('#pCosto')).toHaveValue('3.75');
    await box.getByRole('button', { name: 'Usar costo de última compra' }).click();
    await expect(page.locator('#pCosto')).toHaveValue('4.50');
    await expect(page.locator('#mgVal')).toHaveText('33.3%');
    const ok = await box.evaluate(node => {
      const lum = (c: string) => { const v = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
      const bg = (el: Element | null): string => { while (el) { const b = getComputedStyle(el).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; el = el.parentElement; } return 'rgb(255,255,255)'; };
      return [...node.querySelectorAll('p, button')].every(el => { const a = lum(getComputedStyle(el).color), b = lum(bg(el)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5; })
        && node.scrollWidth <= node.clientWidth + 1;
    });
    expect(ok).toBe(true);
    await page.locator('#mProd .mbtn-ok').click();
    await expect.poll(() => page.evaluate(() => (window as any).eval('productos.find(p=>p.id==="cc-1").costo'))).toBe(4.5);
    const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('na_price_history_v1') || '{}')['cc-1']?.find((e: any) => e.type === 'costo'));
    expect(entry).toMatchObject({ type: 'costo', before: 4, after: 4.5, origin: 'ficha' });
    expect(await page.evaluate(() => (window as any).eval('productos.find(p=>p.id==="cc-1").stock'))).toBe(20);
    expect(await page.evaluate(() => (window as any).eval('JSON.stringify({ventas,creditos,cajMovs})'))).toBe(before);
  });
}

test('empleado no ve el costo de compra en la ficha', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await rolePage(page, 'empleado');
  await openFicha(page).catch(() => {});
  await page.waitForTimeout(300);
  await expect(page.locator('#naCostoCompraFicha')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).NA_COSTO_COMPRA_FICHA.apply('ultima', { lastPurchase: { unitCostCents: 999 } }))).toBe(false);
});
