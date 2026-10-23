import { test, expect, type Page } from '@playwright/test';

// Edición masiva de precios (solo dueño). Datos sintéticos; rol simulado en el navegador de la prueba.
async function open(page: Page, { role = 'owner', dark = false, canon = false, unlock = true } = {}) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'pm-test-device' } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'pm-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed && !!(window as any).NA_PRECIOS_MASIVOS, role);
  await page.evaluate(({ dark, canon, unlock }) => {
    const w = window as any;
    document.body.classList.toggle('dark', dark);
    w.eval(`productos=[{id:'p1',nombre:'Arroz Prueba',cat:'Abarrotes',precio:1234.5,costo:999,stock:5},{id:'p2',nombre:'Azúcar Prueba',cat:'Abarrotes',precio:4,costo:3,stock:5},{id:'p3',nombre:'Jabón Prueba',cat:'Limpieza',precio:2.5,costo:2,stock:5}]`);
    w.eval(`ventas=[]`);
    // El candado sigue cerrado en pos-permissions.js; la prueba lo abre solo en este navegador.
    const perms = w.NA_PERMISSIONS; w.NA_PERMISSIONS = { ...perms, featureLocked: (id: string) => id === 'edicion-masiva-precios' || id === 'precio-por-margen' ? !unlock : perms.featureLocked(id) };
    (0, eval)("_naSecurity.pinEnabled=true;_naSecurity.pinHash=_naSecHash('2468');");
    w.__approvals = [];
    w.NA_ROLES = { ...w.NA_ROLES, approve: async (action: string, opId: string) => { w.__approvals.push(action); return true; } };
    if (!canon) w.NuevoAmanecerCanonical = { ...w.NuevoAmanecerCanonical, enabled: () => false };
    else {
      const products = [{ product_id: 'p1', name: 'Arroz Prueba', category: 'Abarrotes', price_cents: 123450, cost_cents: 99900, metadata_revision: 3, sku: 'A1', barcode: null, alternate_codes_json: '[]' },
        { product_id: 'p3', name: 'Jabón Prueba', category: 'Limpieza', price_cents: 250, cost_cents: 200, metadata_revision: 1 }];
      w.__updates = [];
      w.NuevoAmanecerCanonical = { ...w.NuevoAmanecerCanonical, enabled: () => true, refresh: async () => {}, snapshot: () => ({ products }),
        updateProduct: async (p: any) => { w.__updates.push(p); return { ok: true }; } };
    }
  }, { dark, canon, unlock });
  if (role === 'owner' && unlock) {
    await page.evaluate(() => (window as any).goPage('pageProximamente'));
    const card = page.locator('[data-feature-id="edicion-masiva-precios"]');
    await expect(card).toHaveClass(/is-enabled/);
    await card.click();
    await expect(page.locator('#pageEdicionPrecios')).toBeVisible();
  }
  await page.evaluate(() => (window as any).NA_PRECIOS_MASIVOS.render());
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño cambia precios por categoría y % (local) ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, { dark });
    const s = page.locator('#pageEdicionPrecios');
    await s.locator('[data-pm-category]').selectOption('Abarrotes');
    await s.locator('[data-pm-value]').fill('10');
    await expect(s.locator('tbody tr')).toHaveCount(2);
    await expect(s.locator('tbody tr').first()).toContainText('S/ 1,234.50');
    await expect(s.locator('tbody tr').first()).toContainText('S/ 1,357.95');
    await expect(s.locator('table')).not.toContainText(/Costo|999/);
    const apply = s.locator('[data-pm-apply]');
    await expect(apply).toHaveText('Aplicar a 2 productos');
    for (const sel of ['[data-pm-category]', '[data-pm-mode]', '[data-pm-value]', '[data-pm-apply]']) {
      const b = (await s.locator(sel).boundingBox())!; expect(b.height).toBeGreaterThanOrEqual(44); expect(b.x + b.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/precios-masivos-${width}-${dark ? 'oscuro' : 'claro'}.png` });
    await apply.click();
    await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
    await page.locator('.na-pin-overlay .na-pin-ok').click();
    await expect(s.locator('[data-pm-status]')).toHaveText('Listo: se cambió el precio de 2 productos.');
    const out = await page.evaluate(() => (window as any).eval('JSON.stringify({p:productos.map(p=>[p.id,p.precio,p.costo,p.stock]),v:ventas})'));
    expect(JSON.parse(out)).toEqual({ p: [['p1', 1357.95, 999, 5], ['p2', 4.4, 3, 5], ['p3', 2.5, 2, 5]], v: [] });
  });
}

test('CANON: un product.update por producto, solo cambia price_cents', async ({ page }) => {
  await open(page, { canon: true });
  const s = page.locator('#pageEdicionPrecios');
  await s.locator('[data-pm-mode]').selectOption('monto');
  await s.locator('[data-pm-value]').fill('-0.5');
  await expect(s.locator('tbody tr')).toHaveCount(2);
  await s.locator('[data-pm-apply]').click();
  await expect(s.locator('[data-pm-status]')).toContainText('Listo');
  expect(await page.evaluate(() => (window as any).__approvals)).toEqual(['product.update']);
  const ups = await page.evaluate(() => (window as any).__updates);
  expect(ups.map((u: any) => [u.product_id, u.price_cents, u.cost_cents, u.expected_metadata_revision])).toEqual([['p1', 123400, 99900, 3], ['p3', 200, 200, 1]]);
});

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño fija precio por margen sobre costo (local) ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, { dark });
    const s = page.locator('#pageEdicionPrecios');
    await s.locator('[data-pm-mode]').selectOption('margen');
    await s.locator('[data-pm-value]').fill('25');
    // p1: 999 × 1.25 = 1,248.75 ; p2: 3 × 1.25 = 3.75 ; p3: 2 × 1.25 = 2.50 = precio actual → se omite.
    await expect(s.locator('tbody tr')).toHaveCount(2);
    await expect(s.locator('thead th')).toHaveText(['Incluir', 'Producto', 'Categoría', 'Costo', 'Precio actual', 'Precio nuevo']);
    await expect(s.locator('tbody tr').first().locator('td')).toHaveText(['', 'Abarrotes', 'S/ 999.00', 'S/ 1,234.50', 'S/ 1,248.75']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/precio-margen-${width}-${dark ? 'oscuro' : 'claro'}.png` });
    await expect(s.locator('[data-pm-hint]')).toHaveText('100% = el doble del costo');
    await expect(s.locator('[data-pm-mode] option[value="margen"]')).toHaveText('Margen sobre costo (recargo) %');
    await s.locator('[data-pm-apply]').click();
    await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
    await page.locator('.na-pin-overlay .na-pin-ok').click();
    await expect(s.locator('[data-pm-status]')).toHaveText('Listo: se cambió el precio de 2 productos.');
    const out = await page.evaluate(() => (window as any).eval('JSON.stringify(productos.map(p=>[p.id,p.precio,p.costo]))'));
    expect(JSON.parse(out)).toEqual([['p1', 1248.75, 999], ['p2', 3.75, 3], ['p3', 2.5, 2]]);
  });
}

test('margen: sin costo se omite; el costo no aparece en los otros modos', async ({ page }) => {
  await open(page);
  const s = page.locator('#pageEdicionPrecios');
  await s.locator('[data-pm-value]').fill('10');
  await expect(s.locator('thead th')).toHaveText(['Incluir', 'Producto', 'Categoría', 'Precio actual', 'Precio nuevo']);
  await expect(s).not.toContainText('999');
  const r = await page.evaluate(() => (window as any).NA_PRECIOS_MASIVOS.plan([{ id: 'x', name: 'X', category: 'C', priceCents: 100, costCents: null }], { mode: 'margen', value: 30 }));
  expect(r).toEqual([]);
});

test('empleado: sin permiso y sin controles', async ({ page }) => {
  await open(page, { role: 'empleado' });
  const s = page.locator('#pageEdicionPrecios');
  await expect(s.locator('[data-pm-main]')).toBeHidden();
  await expect(s.locator('[data-pm-status]')).toContainText('Sin permiso');
  expect(await page.evaluate(() => (window as any).NA_PRECIOS_MASIVOS.apply())).toBeNull();
});

test('plan: valida datos y no baja de 0', async ({ page }) => {
  await page.goto('/index.html');
  const r = await page.evaluate(() => {
    const M = (window as any).NA_PRECIOS_MASIVOS, items = [{ id: 'a', name: 'A', category: 'X', priceCents: 100 }];
    const err = (o: any) => { try { M.plan(items, o); return ''; } catch (e: any) { return e.message; } };
    return [M.newPrice(100, 'monto', -5), err({ mode: 'porcentaje', value: '' }), err({ mode: 'porcentaje', value: -100 }), M.plan(items, { mode: 'porcentaje', value: 12.5 })[0].after];
  });
  expect(r).toEqual([0, 'Escribe un valor distinto de 0.', 'El porcentaje debe estar entre -99 y 1000.', 113]);
});

test('el módulo usa solo textContent', async ({ page }) => {
  const res = await page.request.get('/js/modules/precios-masivos.js');
  expect(await res.text()).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
});

test('local: PIN incorrecto o cancelado no cambia ningún precio', async ({ page }) => {
  await open(page);
  const s = page.locator('#pageEdicionPrecios');
  await s.locator('[data-pm-value]').fill('10');
  await s.locator('[data-pm-apply]').click();
  await page.locator('.na-pin-overlay .na-pin-input').fill('1111');
  await page.locator('.na-pin-overlay .na-pin-ok').click();
  await expect(page.locator('.na-pin-overlay .na-pin-msg')).toHaveText('PIN incorrecto.');
  await page.locator('.na-pin-overlay .na-pin-cancel').click();
  await expect(s.locator('[data-pm-status]')).toContainText('falta el PIN');
  const out = await page.evaluate(() => (window as any).eval('JSON.stringify(productos.map(p=>p.precio))'));
  expect(JSON.parse(out)).toEqual([1234.5, 4, 2.5]);
});

test('el candado está abierto en pos-permissions.js (OK dueño 2026-10-23)', async ({ page }) => {
  await page.goto('/index.html');
  expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('edicion-masiva-precios'))).toBe(false);
});

// Candado cerrado de nuevo (rollback simulado en el navegador): dueño no ve controles ni puede aplicar.
for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`candado cerrado (rollback): dueño sin controles ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, { dark, unlock: false });
    await page.evaluate(() => (window as any).goPage('pageProximamente'));
    await expect(page.locator('[data-feature-id="edicion-masiva-precios"]')).not.toHaveClass(/is-enabled/);
    await page.evaluate(() => { document.getElementById('pageEdicionPrecios')!.classList.add('active'); (window as any).NA_PRECIOS_MASIVOS.render(); });
    const s = page.locator('#pageEdicionPrecios');
    await expect(s.locator('[data-pm-main]')).toBeHidden();
    await expect(s.locator('[data-pm-status]')).toHaveText('Disponible pronto.');
    expect(await page.evaluate(() => (window as any).NA_PRECIOS_MASIVOS.unlocked())).toBe(false);
    expect(await page.evaluate(() => (window as any).NA_PRECIOS_MASIVOS.apply())).toBeNull();
    expect(JSON.parse(await page.evaluate(() => (window as any).eval('JSON.stringify(productos.map(p=>p.precio))')))).toEqual([1234.5, 4, 2.5]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('margen 0 % pide confirmación; si se cancela no cambia nada ni pide PIN', async ({ page }) => {
  await open(page);
  const s = page.locator('#pageEdicionPrecios');
  await s.locator('[data-pm-mode]').selectOption('margen');
  await s.locator('[data-pm-value]').fill('0');
  await page.evaluate(() => { (window as any).__asked = 0; window.confirm = () => { (window as any).__asked++; return false; }; });
  await s.locator('[data-pm-apply]').click();
  await expect(s.locator('[data-pm-status]')).toHaveText('No se cambió nada.');
  expect(await page.evaluate(() => (window as any).__asked)).toBe(1);
  await expect(page.locator('.na-pin-overlay')).toHaveCount(0);
  const out = await page.evaluate(() => (window as any).eval('JSON.stringify(productos.map(p=>p.precio))'));
  expect(JSON.parse(out)).toEqual([1234.5, 4, 2.5]);
});

test('en otros modos no se ve la ayuda del margen', async ({ page }) => {
  await open(page);
  await expect(page.locator('#pageEdicionPrecios [data-pm-hint]')).toBeHidden();
});

// CM-061: excluir filas, reintento idempotente, registro y deshacer. Capturas 390/768/1280, claro y oscuro.
for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`CM-061 excluir fila, registro y deshacer ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, { dark });
    const s = page.locator('#pageEdicionPrecios');
    await s.locator('[data-pm-category]').selectOption('Abarrotes');
    await s.locator('[data-pm-value]').fill('10');
    await s.locator('[data-pm-pick="p2"]').uncheck();
    await expect(s.locator('[data-pm-apply]')).toHaveText('Aplicar a 1 producto');
    await expect(s.locator('[data-pm-status]')).toContainText('Excluidos: 1.');
    await page.screenshot({ path: `test-results/cm061-preview-${width}-${dark ? 'oscuro' : 'claro'}.png`, fullPage: true });
    await s.locator('[data-pm-apply]').click();
    await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
    await page.locator('.na-pin-overlay .na-pin-ok').click();
    await expect(s.locator('[data-pm-status]')).toHaveText('Listo: se cambió el precio de 1 producto.');
    let out = JSON.parse(await page.evaluate(() => (window as any).eval('JSON.stringify(productos.map(p=>[p.id,p.precio,p.costo,p.stock]))')));
    expect(out).toEqual([['p1', 1357.95, 999, 5], ['p2', 4, 3, 5], ['p3', 2.5, 2, 5]]);
    await expect(s.locator('.pm-log li')).toHaveCount(1);
    await expect(s.locator('.pm-log li').first()).toContainText('+10 % · 1 producto');
    const undo = s.locator('[data-pm-undo]');
    await expect(undo).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/cm061-registro-${width}-${dark ? 'oscuro' : 'claro'}.png`, fullPage: true });
    page.once('dialog', d => d.accept());
    await undo.click();
    await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
    await page.locator('.na-pin-overlay .na-pin-ok').click();
    await expect(s.locator('[data-pm-status]')).toHaveText('Listo: se devolvió el precio anterior a 1 producto.');
    out = JSON.parse(await page.evaluate(() => (window as any).eval('JSON.stringify(productos.map(p=>[p.id,p.precio,p.costo,p.stock]))')));
    expect(out).toEqual([['p1', 1234.5, 999, 5], ['p2', 4, 3, 5], ['p3', 2.5, 2, 5]]);
    await expect(undo).toBeHidden();
  });
}
