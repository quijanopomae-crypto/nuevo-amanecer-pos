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

// Servidor simulado del historial en la nube (#857). El filtro de costo para empleados lo hace el Worker
// (probado en price-history-backend.test.mjs); aquí el simulado responde igual que él.
const cloudRows = [
  { change_id: 'ph1:tablet:1', product_id: String(PRODUCT_ID), field: 'venta', before_cents: 450, after_cents: 520, origin: 'ficha', ref: null,
    user_name: 'Rosa · "Caja 2" | tarde', user_id: 'C-9', changed_at: '2026-10-21T03:30:00.000Z', received_at: '2026-10-21T03:31:00.000Z' },
  { change_id: 'ph1:tablet:2', product_id: String(PRODUCT_ID), field: 'costo', before_cents: 200, after_cents: 230, origin: 'compra', ref: 'PUR-77:1',
    user_name: 'Rosa', user_id: 'C-9', changed_at: '2026-10-21T04:00:00.000Z', received_at: '2026-10-21T04:01:00.000Z' }
];
async function installRoutes(page: Page, me: Me, cloud = true) {
  const owner = me.body.pos_role === 'owner';
  const seen: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') {
      seen.push(route.request().method() + ' ' + url.pathname);
      const ok = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/auth/me') return route.fulfill({ status: me.status, contentType: 'application/json', body: JSON.stringify(me.body) });
      if (!cloud && url.pathname.startsWith('/auth/price-history')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
      if (url.pathname === '/auth/price-history/batch') {
        const body = JSON.parse(route.request().postData() || '{}');
        return ok({ results: (body.entries || []).map((e: { change_id: string }) => ({ change_id: e.change_id, status: 'inserted' })) });
      }
      if (url.pathname === '/auth/price-history/changes') {
        const rows = url.searchParams.get('since') ? [] : cloudRows.filter(r => owner || r.field !== 'costo');
        return ok({ rows, cursor: { since: '2026-10-21T04:01:00.000Z', since_id: 'ph1:tablet:2' }, more: false });
      }
      return ok({});
    }
    return url.hostname === '127.0.0.1' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.continue() : route.abort();
  });
  return seen;
}

async function setup(page: Page, me: Me = { status: 200, body: ownerMe }, cloud = true) {
  const seen = await installRoutes(page, me, cloud);
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
  return seen;
}

async function openForm(page: Page) {
  const modal = page.locator('#mProd');
  if (!await modal.evaluate(el => el.classList.contains('open'))) {
    await page.locator('#invBody tr', { hasText: 'Arroz historial' }).locator('.btn-edt').click();
  }
  await expect(modal).toHaveClass(/\bopen\b/);
  const section = page.locator('#mProd details.inv-form-section').filter({ has: page.locator('summary', { hasText: 'Precios' }) }).first();
  if (!await section.evaluate(el => (el as HTMLDetailsElement).open)) await section.locator('summary').click();
  await expect(page.locator('#pPriceHistory')).toBeVisible();
}


const localEntry = { id: PRODUCT_ID + ':2026-10-01T15:00:00.000Z:venta:change:1', seq: 1, at: '2026-10-01T15:00:00.000Z', user: 'Ana Dueña', userId: 'hist-owner-1', type: 'venta', before: 4, after: 4.5, origin: 'ficha' };

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño: backfill primero y luego ve lo de otro aparato en hora de Lima (${width}px ${dark ? 'oscuro' : 'claro'})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(entry => {
      if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); localStorage.setItem('na_price_history_v1', JSON.stringify({ [String(entry.id).split(':')[0]]: [entry] })); }
    }, localEntry);
    const seen = await setup(page);
    await page.evaluate(d => document.body.classList.toggle('dark', d), dark);
    await page.evaluate(() => (window as any).NA_PRICE_HISTORY_SYNC.sync());
    const order = seen.filter(s => s.includes('/price-history'));
    expect(order[0]).toBe('POST /auth/price-history/batch');
    expect(order).toContain('GET /auth/price-history/changes');
    const local = await page.evaluate(id => JSON.parse(localStorage.getItem('na_price_history_v1') || '{}')[String(id)], PRODUCT_ID);
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({ synced: true, after: 4.5 });
    expect(local[0].cid).toMatch(/^ph1:legacy:[0-9a-f]{64}$/);
    await openForm(page);
    const items = page.locator('#pPriceHistory li');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('20/10/2026 23:00');
    await expect(items.nth(0)).toContainText('Costo: S/ 2.00 → S/ 2.30');
    await expect(items.nth(1)).toContainText('20/10/2026 22:30');
    await expect(items.nth(1)).toContainText('Venta: S/ 4.50 → S/ 5.20');
    await expect(items.nth(1)).toContainText('Rosa · "Caja 2" | tarde · C-9 · Ficha del producto');
    await expect(items.nth(2)).toContainText('S/ 4.00 → S/ 4.50');
    const box = await page.locator('#pPriceHistory').boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width + 1).toBe(true);
    const contrast = await items.nth(1).locator('span').evaluate(el => {
      const lum = (c: string) => { const m = c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      let bg = 'rgba(0, 0, 0, 0)', n: Element | null = el;
      while (n && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
      if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = 'rgb(255, 255, 255)';
      const a = lum(getComputedStyle(el).color), b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
}

test('empleado: la nube no le trae costo, su caché no lo guarda y no se muestra', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await setup(page, { status: 200, body: { ...ownerMe, pos_role: 'empleado', device_id: 'hist-emp-1', label: 'Beto' } });
  await page.evaluate(() => (window as any).NA_PRICE_HISTORY_SYNC.sync());
  const cache = await page.evaluate(() => localStorage.getItem('na_price_history_cloud_v1') || '');
  expect(cache).toContain('ph1:tablet:1');
  expect(cache).not.toContain('"costo"');
  const rows = await page.evaluate(id => (window as any).NA_PRICE_HISTORY.list(id), PRODUCT_ID);
  expect(rows.map((r: { type: string }) => r.type)).toEqual(['venta']);
});

test('sin la función en el servidor (404) el historial sigue solo local y no se activa', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page, { status: 200, body: ownerMe }, false);
  const r = await page.evaluate(() => (window as any).NA_PRICE_HISTORY_SYNC.sync());
  expect(r).toMatchObject({ ok: false, reason: 'no_disponible' });
  expect(await page.evaluate(() => (window as any).NA_PRICE_HISTORY_SYNC.enabled())).toBe(false);
  await page.evaluate(id => { (window as any).NA_PRICE_HISTORY.recordDiff({ productId: id, origin: 'ficha', before: { venta: 4.5, mayorista: null, costo: 2 }, after: { venta: 4.9, mayorista: null, costo: 2 } }); }, PRODUCT_ID);
  const r2 = await page.evaluate(() => (window as any).NA_PRICE_HISTORY_SYNC.sync());
  expect(r2).toMatchObject({ ok: false, reason: 'no_disponible' });
  const local = await page.evaluate(id => JSON.parse(localStorage.getItem('na_price_history_v1') || '{}')[String(id)], PRODUCT_ID);
  expect(local).toHaveLength(1);
  expect(local[0].synced).toBeFalsy();
});
