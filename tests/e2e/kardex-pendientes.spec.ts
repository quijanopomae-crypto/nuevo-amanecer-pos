import { test, expect, type Page } from '@playwright/test';

// CM-082: en la nube, una venta cobrada que sigue en cola (sin conexión) ya descontó el stock
// proyectado; el Kardex la muestra «sin confirmar» y el saldo cuadra. Datos sintéticos.
async function ownerPage(page: Page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'kardex-pend-device' } : url.pathname === '/auth/purchases' ? { purchases: [], truncated: false } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'kardex-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role: 'owner' }));
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.role === 'owner' && (window as any).NA_ROLES.confirmed);
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`Kardex cuadra con venta en cola sin confirmar a ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ownerPage(page);
    const queueBefore = await page.evaluate(() => {
      const w = window as any, today = w.NA_KARDEX.periodRange().to;
      w.eval(`productos=[{id:'kp-1',name:'Paracetamol sintético',sku:'KP-01',stock:8,controlInventario:true}]; ventas=[];`);
      const queue = { version: 1, intents: [{ sale_id: 'V-900', created_at: today + 'T15:00:00.000Z', items: [{ product_id: 'kp-1', quantity: 2 }] }] };
      const moves = [{ id: 'kp-in', productId: 'kp-1', type: 'COMPRA', delta: 10, fecha: today, timestamp: today + 'T09:00:00' }];
      const canon = w.NuevoAmanecerCanonical, outbox = w.NuevoAmanecerCanonicalSaleOutbox;
      Object.defineProperty(w, 'NuevoAmanecerCanonical', { configurable: true, value: { ...canon, enabled: () => true, snapshot: () => ({ ...(canon?.snapshot?.() || {}), inventoryMovements: moves }) } });
      Object.defineProperty(w, 'NuevoAmanecerCanonicalSaleOutbox', { configurable: true, value: { ...outbox, snapshot: () => JSON.parse(JSON.stringify(queue)) } });
      return JSON.stringify(queue);
    });
    await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
    await page.evaluate(() => (window as any).goPage('pageKardex'));
    const screen = page.locator('#pageKardex');
    await expect(screen).toBeVisible();
    await screen.locator('[data-kardex-search]').fill('KP-01');
    await screen.locator('[data-product-id="kp-1"]').click();
    await expect(screen.locator('[data-kardex-row="opening"] td[data-label="Saldo"]')).toHaveText('0');
    await expect(screen.locator('tbody')).toContainText('V-900 (sin confirmar)');
    await expect(screen.locator('tbody tr')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => JSON.stringify((window as any).NuevoAmanecerCanonicalSaleOutbox.snapshot()))).toBe(queueBefore);
  });
}
