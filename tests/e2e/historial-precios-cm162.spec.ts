import { test, expect, type Page } from '@playwright/test';

const PRODUCT_ID = 880221;
const product = {
  id: PRODUCT_ID, name: 'Arroz historial', descripcion: 'Fixture sintético; sin clientes reales', sku: 'ARROZ-HIST',
  barcode: '', codigosAlternativos: [], codigoAlternativo: '', cat: 'abarrotes', marca: 'Marca de prueba',
  unidad: 'unidad', unidadCompra: 'unidad', factorCompra: 1, costo: 2, precio: 4.5, stock: 10, stockMin: 3,
  venc: '', icon: '📦', imagen: null, incluyeIGV: true, tipoImpuesto: 'gravado', impuestoComplementario: '',
  controlInventario: true, precioCaja: null, unidCaja: null, activo: true
};
const sale = {
  id: 'V-HIST-1', fecha: '2026-10-01', hora: '10:00', hora24: '10:00:00', timestamp: '2026-10-01T15:00:00.000Z',
  total: 4.5, metodo: 'efectivo', estado: 'completada', anulada: false, clienteId: null,
  items: [{ id: PRODUCT_ID, name: 'Arroz historial', qty: 1, cantidad: 1, precio: 4.5, costo: 2, unitsPerQty: 1 }]
};
const ownerMe = { pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'hist-owner-1', label: 'Ana Dueña' };

type Me = { status: number; body: Record<string, unknown> };

let lockClosed = false;
async function installRoutes(page: Page, me: Me) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (lockClosed && url.hostname === '127.0.0.1' && url.pathname.endsWith('/js/config/pos-permissions.js')) {
      const res = await route.fetch(); return route.fulfill({ response: res, body: (await res.text()).replace("'historial-precios-producto': false", "'historial-precios-producto': true") });
    }
    if (url.hostname === 'permissions.test') {
      if (url.pathname === '/auth/me') return route.fulfill({ status: me.status, contentType: 'application/json', body: JSON.stringify(me.body) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return url.hostname === '127.0.0.1' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.continue() : route.abort();
  });
}

async function setup(page: Page, me: Me = { status: 200, body: ownerMe }) {
  await installRoutes(page, me);
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic-test-only' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, me.body.pos_role || 'owner');
  await page.reload();
  if (me.status === 200) {
    await page.waitForFunction(role => {
      const roles = (window as any).NA_ROLES;
      return roles && roles.role === role && roles.confirmed === true;
    }, me.body.pos_role);
  }
  await page.waitForFunction(() => !!(window as any).NuevoAmanecerCanonical && !!(window as any).NA_PRICE_HISTORY && !!(window as any).NA_MENU_NAVIGATION);
  await page.evaluate(({ product: item, sale: ticket }) => {
    const w = window as any;
    const real = w.NuevoAmanecerCanonical;
    w.__histCanon = false;
    const wrapped: Record<string, unknown> = {};
    for (const key of Object.keys(real)) {
      const value = real[key];
      wrapped[key] = typeof value === 'function' ? value.bind(real) : value;
    }
    wrapped.enabled = () => !!w.__histCanon;
    wrapped.commandContext = () => ({ promotion_id: 'hist', authority_epoch: 1, expected_control_revision: 1, client_contract: 'test', created_at: '2026-10-20T18:00:00.000Z' });
    wrapped.prepareCommand = async () => {};
    wrapped.refresh = async () => {};
    w.NuevoAmanecerCanonical = wrapped;
    (0, eval)('productos = ' + JSON.stringify([item]));
    (0, eval)('ventas = ' + JSON.stringify([ticket]));
    w.NA_MENU_NAVIGATION.navigate('pageInventario');
    w.invRender();
  }, { product, sale });
  await expect(page.locator('#invBody')).toContainText('Arroz historial');
}

async function openForm(page: Page) {
  const modal = page.locator('#mProd');
  if (!await modal.evaluate(el => el.classList.contains('open'))) {
    await page.locator('#invBody tr', { hasText: 'Arroz historial' }).locator('.btn-edt').click();
  }
  await expect(modal).toHaveClass(/\bopen\b/);
  const section = page.locator('#mProd details.inv-form-section').filter({ has: page.locator('summary', { hasText: 'Precios' }) }).first();
  if (!await section.evaluate(el => (el as HTMLDetailsElement).open)) await section.locator('summary').click();
}


const empMe = { pos_role: 'empleado', owner_pin_set: true, roles_ready: true, device_id: 'hist-emp-1', label: 'Beto' };
async function seedHistory(page: Page) {
  await page.evaluate(id => {
    const h = (window as any).NA_PRICE_HISTORY;
    localStorage.removeItem(h.KEY);
    h.recordDiff({ productId: id, origin: 'ficha', user: 'Ana Dueña', userId: 'C-0001', before: { venta: 4, mayorista: null, costo: 2 }, after: { venta: 4.5, mayorista: null, costo: 2.2 } });
    h.recordDiff({ productId: id, origin: 'masivo', ref: 'op-e2e:' + id, partial: true, user: 'Ana Dueña', userId: 'C-0001', before: { venta: 4.5 }, after: { venta: 4.95 } });
  }, PRODUCT_ID);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  const tag = `${width}px ${dark ? 'oscuro' : 'claro'}`;
  test(`CM-162 dueño ${tag}: ve venta, costo y origen masivo; filtra por tipo`, async ({ page }) => {
    lockClosed = false;
    await page.setViewportSize({ width, height: 900 });
    await setup(page); await seedHistory(page);
    await page.evaluate(d => document.body.classList.toggle('dark', d), dark);
    await openForm(page);
    const box = page.locator('#pPriceHistory');
    await expect(box).toBeVisible();
    await expect(box.locator('li')).toHaveCount(3);
    await expect(box).toContainText('Edición masiva');
    await expect(box).toContainText('Ana Dueña · C-0001');
    await box.locator('[data-ph-type-filter="costo"]').click();
    await expect(box.locator('[data-ph-type-filter="costo"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(box.locator('li')).toHaveCount(1);
    await expect(box.locator('li').first()).toContainText('Costo: S/ 2.00 → S/ 2.20');
    await noOverflow(page);
    await page.screenshot({ path: `test-results/cm162-owner-${width}-${dark ? 'dark' : 'light'}.png` });
  });
  test(`CM-162 empleado ${tag}: ve precio de venta, nunca costo ni filtro`, async ({ page }) => {
    lockClosed = false;
    await page.setViewportSize({ width, height: 900 });
    await setup(page, { status: 200, body: empMe }); await seedHistory(page);
    await page.evaluate(d => document.body.classList.toggle('dark', d), dark);
    await openForm(page);
    const box = page.locator('#pPriceHistory');
    await expect(box).toBeVisible();
    await expect(box.locator('li')).toHaveCount(2);
    await expect(box).not.toContainText('Costo');
    await expect(box.locator('[data-ph-filter]')).toHaveCount(0);
    await noOverflow(page);
  });
  test(`CM-162 candado cerrado ${tag}: no hay historial ni registro`, async ({ page }) => {
    lockClosed = true;
    await page.setViewportSize({ width, height: 900 });
    await setup(page); await seedHistory(page);
    await page.evaluate(d => document.body.classList.toggle('dark', d), dark);
    await openForm(page);
    await expect(page.locator('#pPriceHistory')).toBeHidden();
    expect(await page.evaluate(id => (window as any).NA_PRICE_HISTORY.list(id).length, PRODUCT_ID)).toBe(0);
    expect(await page.evaluate(k => localStorage.getItem(k), 'na_price_history_v1')).toBeNull();
  });
}
