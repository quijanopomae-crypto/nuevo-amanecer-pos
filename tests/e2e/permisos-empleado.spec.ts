import { test, expect, type Page } from '@playwright/test';

// Ítem 3: permisos del empleado frente a CasaMarket. Servidor simulado; nada real se guarda.
async function setup(page: Page, role: 'owner' | 'empleado', { pin = true, dark = false } = {}) {
  const saved: any[] = [];
  let value: any = pin ? undefined : false;
  await page.route('**/*', route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'permissions.test') {
      if (url.pathname === '/settings' && req.method() === 'POST') { const b = JSON.parse(req.postData() || '{}'); saved.push(b); value = b.value;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"saved"}' }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
        url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'pe-device' }
        : url.pathname === '/settings' ? { settings: value === undefined ? [] : [{ key: 'compras.pin_empleado', value, revision: 1 }] } : {}) });
    }
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'pe-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed && !!(window as any).NA_PERMISOS_EMPLEADO, role);
  await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
  return saved;
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño ve los permisos y apaga el PIN de compras ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const saved = await setup(page, 'owner', { dark });
    await page.evaluate(() => (window as any).goPage('pageConfig'));
    await page.evaluate(() => (window as any).NA_PERMISOS_EMPLEADO.render());
    const card = page.locator('#naPermisosEmpleado');
    await expect(card).toBeVisible();
    await expect(card.locator('.pe-row')).toHaveCount(6);
    await expect(card).toContainText('Anular una venta');
    const box = card.locator('[data-pe-compras]');
    await expect(box).toBeChecked();
    await card.scrollIntoViewIfNeeded();
    const b = (await card.locator('.pe-toggle').boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44); expect(b.x + b.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/permisos-empleado-${width}-${dark ? 'oscuro' : 'claro'}.png` });
    await box.uncheck();
    await expect(card.locator('[data-pe-status]')).toHaveText('Listo: el empleado registra compras sin tu PIN.');
    expect(saved).toEqual([{ key: 'compras.pin_empleado', value: false, expected_revision: 0 }]);
  });
}

test('empleado: no ve la tarjeta', async ({ page }) => {
  await setup(page, 'empleado');
  expect(await page.evaluate(() => (window as any).NA_PERMISOS_EMPLEADO.render())).toBe(false);
  await expect(page.locator('#naPermisosEmpleado')).toHaveCount(0);
});

for (const pin of [true, false]) {
  test(`compra del empleado ${pin ? 'pide' : 'no pide'} PIN según el ajuste`, async ({ page }) => {
    await setup(page, 'empleado', { pin });
    const asked = await page.evaluate(async () => {
      const w = window as any;
      let asked = 0;
      w.NA_ROLES.approve = async () => { asked++; return null; };
      w.NuevoAmanecerCanonical = { ...w.NuevoAmanecerCanonical, prepareCommand: async () => {}, refresh: async () => {},
        commandContext: () => ({ promotion_id: 'p', authority_epoch: 1, expected_control_revision: 1, client_contract: 'c', created_at: new Date().toISOString() }) };
      try { await w.NA_PURCHASES.submit('pe-op', [{ line: 1, product_id: 'x', quantity: 1, unit_cost_cents: null }], {}); } catch (_) {}
      return asked;
    });
    expect(asked).toBe(pin ? 1 : 0);
  });
}

test('el módulo usa solo textContent', async ({ page }) => {
  const res = await page.request.get('/js/modules/permisos-empleado.js');
  expect(await res.text()).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
});
