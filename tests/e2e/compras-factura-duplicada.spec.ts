import { test, expect, type Page } from '@playwright/test';

// Aviso de factura repetida en Nueva compra. Servidor simulado; datos sintéticos; nada real se registra.
async function setup(page: Page, role: 'owner' | 'empleado', dark = false, opts: { locked?: boolean, truncated?: boolean, docRef?: string } = {}) {
  const posts: string[] = [];
  // Ninguna compra llega al servidor en estas pruebas.
  await page.route('**/*', route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'permissions.test') {
      if (url.pathname === '/auth/purchases' && req.method() === 'POST') { posts.push(req.postData() || ''); return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test_stop"}' }); }
      const prior = { purchase_id: 'old-1', document_ref: opts.docRef || 'F001-123', created_at: '2026-10-02T03:00:00Z', status: 'completa', line_count: 1,
        ...(role === 'owner' ? { supplier: 'Distribuidora Prueba', total_cost_cents: 99900 } : {}) };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
        url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'dup-device' }
        : url.pathname === '/auth/purchases' ? { purchases: [prior], truncated: !!opts.truncated } : {}) });
    }
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'dup-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
  // Esperar a que la purga de identidad confirmada termine: si no, puede vaciar el catálogo sintético que se carga a continuación.
  await page.waitForFunction(role => {
    try { const t = JSON.parse(localStorage.getItem('na_cache_identity_v1') || 'null'); return !!t && t.why === 'confirmed' && t.role === role; } catch (_) { return false; }
  }, role);
  await page.evaluate(({ dark, locked }) => {
    const w = window as any;
    // El candado sigue en true en pos-permissions.js; solo la prueba lo abre.
    const perms = w.NA_PERMISSIONS;
    if (!locked) w.NA_PERMISSIONS = { ...perms, featureLocked: (id: string) => id === 'aviso-factura-duplicada' ? false : perms.featureLocked(id) };
    w.__toasts = []; const t0 = w.toast; w.toast = (m: string, k: string) => { w.__toasts.push(m); try { t0 && t0(m, k); } catch (_) {} };
    document.body.classList.toggle('dark', dark);
    w.eval(`productos=[{id:'dp-1',nombre:'Arroz Prueba',name:'Arroz Prueba',stock:5,costo:3,precio:4,controlInventario:true}]`);
    w.NuevoAmanecerCanonical = { ...w.NuevoAmanecerCanonical, enabled: () => true, refresh: async () => {},
      // Llegar aquí = se intentó registrar. Se corta antes de cualquier envío.
      prepareCommand: async () => { w.__submits = (w.__submits || 0) + 1; throw Object.assign(new Error('test_stop'), { status: 0 }); },
      commandContext: () => { w.__submits = (w.__submits || 0) + 1; throw Object.assign(new Error('test_stop'), { status: 0 }); } };
    w.NA_PURCHASES.open();
  }, { dark, locked: !!opts.locked });
  return posts;
}
async function fill(page: Page, supplier: string, docRef: string) {
  const d = page.locator('#naPurchaseDialog');
  await d.locator('#naPurSupplier').fill(supplier);
  await d.locator('#naPurDoc').fill(docRef);
  await d.locator('.na-pur-prod').first().fill('Arroz Prueba');
  await d.locator('.na-pur-qty').first().fill('2');
  return d;
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`aviso de factura repetida (dueño) ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const posts = await setup(page, 'owner', dark);
    const d = await fill(page, 'distribuidora  prueba', 'f001 123');
    await d.locator('.na-pur-ok').click();
    const err = d.locator('.na-pur-err');
    await expect(err).toBeVisible();
    await expect(err).toContainText('Ya hay una compra registrada con el documento «F001-123» (01/10/2026, hora de Lima)');
    expect(await page.evaluate(() => (window as any).__submits || 0)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/compra-duplicada-${width}-${dark ? 'oscuro' : 'claro'}.png` });
    // Segundo clic: el usuario confirma que es otra factura y se intenta registrar.
    await d.locator('.na-pur-ok').click();
    await expect.poll(() => page.evaluate(() => (window as any).__submits || 0)).toBe(1);
  });
}

test('el dueño con otro proveedor y el mismo número no recibe aviso', async ({ page }) => {
  const posts = await setup(page, 'owner');
  const d = await fill(page, 'Otro Proveedor', 'F001-123');
  await d.locator('.na-pur-ok').click();
  await expect.poll(() => page.evaluate(() => (window as any).__submits || 0)).toBe(1);
});

test('empleado: aviso solo por documento, sin mostrar proveedor ni costo', async ({ page }) => {
  const posts = await setup(page, 'empleado');
  const d = await fill(page, '', 'F001-123');
  await d.locator('.na-pur-ok').click();
  const err = d.locator('.na-pur-err');
  await expect(err).toContainText('F001-123');
  await expect(err).not.toContainText(/Distribuidora|999/);
  expect(await page.evaluate(() => (window as any).__submits || 0)).toBe(0);
});

test('sin documento no se consulta ni se avisa', async ({ page }) => {
  const posts = await setup(page, 'owner');
  const d = await fill(page, 'Distribuidora Prueba', '');
  await d.locator('.na-pur-ok').click();
  await expect.poll(() => page.evaluate(() => (window as any).__submits || 0)).toBe(1);
});

test('nunca se envía una compra al servidor simulado', async ({ page }) => {
  const posts = await setup(page, 'owner');
  const d = await fill(page, 'X', 'F001-123');
  await d.locator('.na-pur-ok').click(); await d.locator('.na-pur-ok').click();
  await page.waitForTimeout(300);
  expect(posts.length).toBe(0);
});

test('_findDuplicate normaliza espacios, guiones y mayúsculas', async ({ page }) => {
  await page.goto('/index.html');
  const r = await page.evaluate(() => {
    const f = (window as any).NA_PURCHASES._findDuplicate;
    const rows = [{ document_ref: 'B002-0045', supplier: 'Ácme' }, { document_ref: 'X-1' }];
    return [!!f(rows, { documentRef: 'b002 0045', supplier: 'acme' }), !!f(rows, { documentRef: 'B002-0045', supplier: 'Otro' }),
      !!f(rows, { documentRef: 'x1', supplier: 'Cualquiera' }), !!f(rows, { documentRef: '' })];
  });
  expect(r).toEqual([true, false, true, false]);
});

test('candado en true (el de pos-permissions.js): no se consulta ni se avisa', async ({ page }) => {
  await setup(page, 'owner', false, { locked: true });
  expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('aviso-factura-duplicada'))).toBe(true);
  const d = await fill(page, 'Distribuidora Prueba', 'F001-123');
  await d.locator('.na-pur-ok').click();
  await expect.poll(() => page.evaluate(() => (window as any).__submits || 0)).toBe(1);
});

test('lista cortada por el servidor: el aviso lo menciona', async ({ page }) => {
  await setup(page, 'owner', false, { truncated: true });
  const d = await fill(page, 'Distribuidora Prueba', 'F001-123');
  await d.locator('.na-pur-ok').click();
  await expect(d.locator('.na-pur-err')).toContainText('Solo se revisaron las compras más recientes');
});

test('lista cortada y sin coincidencia: toast informativo y sigue el registro', async ({ page }) => {
  await setup(page, 'owner', false, { truncated: true, docRef: 'F999-1' });
  const d = await fill(page, 'Distribuidora Prueba', 'F001-123');
  await d.locator('.na-pur-ok').click();
  await expect.poll(() => page.evaluate(() => (window as any).__submits || 0)).toBe(1);
  expect(await page.evaluate(() => (window as any).__toasts.join(' | '))).toContain('Solo se revisaron las compras más recientes');
});
