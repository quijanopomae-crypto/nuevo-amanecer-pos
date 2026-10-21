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

for (const role of ['owner', 'empleado'] as const) {
  test(`al registrar una compra local (${role}) el costo ${role === 'owner' ? 'se actualiza, se guarda y queda en el historial' : 'no cambia'}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await rolePage(page, role);
    const out = await page.evaluate(async () => {
      const w = window as any;
      const r = await w.NA_COSTO_COMPRA_FICHA.afterLocalPurchase('OCR-e2e', { ok: true, applied: [{ sourceIndex: 1, productId: 'cc-1', quantity: 3, unitCost: 4.8 }] });
      return { r, costo: w.eval('productos[0].costo'), hist: JSON.parse(localStorage.getItem('na_price_history_v1') || '{}')['cc-1'] || [] };
    });
    if (role === 'owner') {
      expect(out.costo).toBe(4.8);
      expect(out.hist[0]).toMatchObject({ type: 'costo', before: 4, after: 4.8, origin: 'compra', ref: 'OCR-e2e:1:costo' });
    } else {
      expect(out.costo).toBe(4);
      expect(out.hist).toHaveLength(0);
    }
  });
}

test('compra manual (CANON, dueño): costo y margen cambian sin abrir la ficha; historial «Compra» con ref', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await rolePage(page, 'owner');
  await page.evaluate(() => {
    const w = window as any, real = w.NuevoAmanecerCanonical, wrapped: Record<string, unknown> = {};
    for (const key of Object.keys(real)) { const v = real[key]; wrapped[key] = typeof v === 'function' ? v.bind(real) : v; }
    const raw = { product_id: 'cc-1', metadata_revision: 2, name: 'Aceite 1L', sku: 'CC-01', barcode: null, alternate_codes_json: '[]', category: 'abarrotes', brand: null,
      description: null, icon: null, cost_cents: 400, price_cents: 600, box_price_cents: null, units_per_box: null, stock_min_quantity: 2, expiry_date: null };
    w.__sent = [];
    wrapped.enabled = () => true;
    wrapped.commandContext = () => ({ promotion_id: 'ccf', authority_epoch: 1, expected_control_revision: 1, client_contract: 'test', created_at: new Date().toISOString() });
    wrapped.prepareCommand = async () => {};
    wrapped.refresh = async () => {};
    wrapped.snapshot = () => ({ products: [raw], inventoryMovements: [] });
    // Simula la confirmación del servidor: la réplica y el catálogo toman el costo nuevo.
    wrapped.updateProduct = async (b: any) => { w.__sent.push(b); raw.cost_cents = b.cost_cents; raw.metadata_revision++; (0, eval)('productos')[0].costo = b.cost_cents / 100; return { ok: true }; };
    w.NuevoAmanecerCanonical = wrapped;
    const original = w.NA_ROLES.api.bind(w.NA_ROLES);
    w.NA_ROLES.api = async (path: string, body: any, method?: string, headers?: any) =>
      String(path).startsWith('/auth/purchases') && method === 'POST' ? { applied: body.lines.map((l: any) => ({ line: l.line, product_id: l.product_id })), idempotent: false } : original(path, body, method, headers);
    w.NA_PURCHASES.open();
  });
  const dialog = page.locator('#naPurchaseDialog');
  await dialog.locator('.na-pur-prod').fill('Aceite 1L');
  await dialog.locator('.na-pur-qty').fill('6');
  await dialog.locator('.na-pur-cost').fill('5.00');
  await dialog.locator('.na-pur-ok').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#mProd')).not.toHaveClass(/open/);
  await expect.poll(() => page.evaluate(() => (0, eval)('productos')[0].costo)).toBe(5);
  const sent = await page.evaluate(() => (window as any).__sent);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ product_id: 'cc-1', cost_cents: 500, price_cents: 600, name: 'Aceite 1L', expected_metadata_revision: 2 });
  expect(await page.evaluate(() => (window as any).NA_COSTO_COMPRA_FICHA.margin((0, eval)('productos')[0].costo, (0, eval)('productos')[0].precio))).toBe(20);
  const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('na_price_history_v1') || '{}')['cc-1'] || []);
  expect(hist.filter((e: any) => e.type === 'costo')).toEqual([expect.objectContaining({ before: 4, after: 5, origin: 'compra', ref: expect.stringMatching(/:1:costo$/) })]);
  // Al abrir la ficha después, el margen ya refleja el costo nuevo.
  await page.evaluate(() => (window as any).editProd('cc-1'));
  await expect(page.locator('#pCosto')).toHaveValue('5');
  await expect(page.locator('#mgVal')).toHaveText('20.0%');
});
