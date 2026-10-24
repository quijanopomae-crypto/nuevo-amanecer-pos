import { test, expect, type Page } from '@playwright/test';

const fixture = `productos=[
  {id:9101,name:'Arroz <b>Costeño</b>',cat:'abarrotes',precio:4,costo:3.21,stock:10,stockMin:1,unidad:'unidad',unidadCompra:'unidad',factorCompra:1,icon:'📦',controlInventario:true,incluyeIGV:true,tipoImpuesto:'gravado'},
  {id:9102,name:'Azúcar rubia',cat:'abarrotes',precio:3.33,costo:2.22,stock:5,stockMin:1,unidad:'unidad',unidadCompra:'unidad',factorCompra:1,icon:'📦',controlInventario:true,incluyeIGV:true,tipoImpuesto:'gravado'},
  {id:9103,name:'Gaseosa',cat:'bebidas',precio:2.5,costo:1.11,stock:8,stockMin:1,unidad:'unidad',unidadCompra:'unidad',factorCompra:1,icon:'🥤',controlInventario:true,incluyeIGV:true,tipoImpuesto:'gravado'}
];`;
type Seen = { approvals: any[] };

async function rolePage(page: Page, role: 'owner' | 'empleado', width: number, dark: boolean, local: boolean): Promise<Seen> {
  const seen: Seen = { approvals: [] };
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'permissions.test') {
      if (url.pathname === '/auth/owner-approval') {
        seen.approvals.push(req.postDataJSON());
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ status: 'approved', approval_id: 'apr-test' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
        url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'em-test-device' } : {}) });
    }
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'em-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
  await page.evaluate(({ dark, local, fixture }) => {
    const w = window as any;
    (0, eval)(fixture);
    // El candado sigue cerrado en pos-permissions.js; aquí se abre solo en este navegador.
    if (!(w as any).__keepLock) { const perms = w.NA_PERMISSIONS; w.NA_PERMISSIONS = { ...perms, featureLocked: (id: string) => id === 'edicion-masiva-productos' ? false : perms.featureLocked(id) }; }
    (0, eval)("_naSecurity.pinEnabled=true;_naSecurity.pinHash=_naSecHash('2468');");
    if (w.NA_THEME?.setMode) w.NA_THEME.setMode(dark ? 'noche' : 'claro'); else document.body.classList.toggle('dark', dark);
    w.goPage('pageInventario');
  }, { dark, local, fixture });
  return seen;
}
async function openTool(page: Page) {
  await page.locator('#pageInventario .inv-secondary>summary').click();
  const btn = page.locator('#pageInventario .inv-secondary-menu #invEdicionMasivaBtn');
  await expect(btn).toBeVisible();
  await btn.click();
  const dlg = page.locator('#naEdicionMasiva');
  await expect(dlg).toBeVisible();
  return dlg;
}
const state = (page: Page) => page.evaluate(() => (0, eval)('productos.map(p=>[p.id,p.precio,p.cat,p.activo!==false])'));
const BASE = [[9101, 4, 'abarrotes', true], [9102, 3.33, 'abarrotes', true], [9103, 2.5, 'bebidas', true]];

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño local cambia categoría y estado en lote a ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await rolePage(page, 'owner', width, dark, true);
    const dlg = await openTool(page);
    await expect(dlg.locator('[data-pl-pick]')).toHaveCount(3);
    await expect(dlg).toContainText('Arroz <b>Costeño</b>');
    await expect(dlg).toContainText('S/ 3.33');
    await expect(dlg).not.toContainText('3.21');
    await dlg.locator('[data-pl-cat]').selectOption('abarrotes');
    await expect(dlg.locator('[data-pl-pick]')).toHaveCount(2);
    await dlg.locator('[data-pl-all]').click();
    await expect(dlg.locator('[data-pl-count]')).toHaveText('2 seleccionados');
    await dlg.locator('[data-pl-newcat]').selectOption('bebidas');
    await dlg.locator('[data-pl-activo]').selectOption('false');
    await expect(dlg.locator('[data-pl-confirm]')).toBeDisabled();
    await dlg.locator('[data-pl-preview-btn]').click();
    const rows = dlg.locator('[data-pl-row]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('DESCONTINUADO');
    await expect(dlg).not.toContainText('2.22');
    const box = await dlg.locator('.pl-box').boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(await state(page)).toEqual(BASE);
    await dlg.locator('[data-pl-confirm]').click();
    const pin = page.locator('.na-pin-overlay .na-pin-input');
    await pin.fill('1111');
    await page.locator('.na-pin-overlay .na-pin-ok').click();
    await expect(page.locator('.na-pin-overlay .na-pin-msg')).toHaveText('PIN incorrecto.');
    expect(await state(page)).toEqual(BASE);
    await pin.fill('2468');
    await page.locator('.na-pin-overlay .na-pin-ok').click();
    await expect(dlg.locator('.pl-good')).toHaveText('Listo: se guardaron 2 producto(s).');
    expect(await state(page)).toEqual([[9101, 4, 'bebidas', false], [9102, 3.33, 'bebidas', false], [9103, 2.5, 'bebidas', true]]);
    await expect(page.locator('#mProd')).not.toHaveClass(/\bopen\b/);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });
}

test('cancelar el PIN no cambia nada y se puede reintentar', async ({ page }) => {
  await rolePage(page, 'owner', 1280, false, true);
  const dlg = await openTool(page);
  await dlg.locator('[data-pl-search]').fill('gaseosa');
  await dlg.locator('[data-pl-pick]').check();
  await dlg.locator('[data-pl-newcat]').selectOption('abarrotes');
  await dlg.locator('[data-pl-preview-btn]').click();
  await dlg.locator('[data-pl-confirm]').click();
  await page.locator('.na-pin-overlay .na-pin-cancel').click();
  expect(await state(page)).toEqual(BASE);
  await dlg.locator('[data-pl-confirm]').click();
  await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
  await page.locator('.na-pin-overlay .na-pin-ok').click();
  await expect(dlg.locator('.pl-good')).toBeVisible();
  expect((await state(page))[2]).toEqual([9103, 2.5, 'abarrotes', true]);
});

test('dueño en la nube: un solo PIN para todo el lote y sin opción de estado', async ({ page }) => {
  const seen = await rolePage(page, 'owner', 1280, true, false);
  // Solo se sustituye el envío final (no hay CANON en el banco de pruebas): se cuentan las llamadas a guardarProd.
  await page.evaluate(() => { const w = window as any; w.NuevoAmanecerCanonical = Object.assign({}, w.NuevoAmanecerCanonical, { enabled: () => true }); w.__saved = []; w.guardarProd = async () => { w.__saved.push([(0, eval)('invEditId'), (document.getElementById('pCat') as HTMLSelectElement).value]); (0, eval)("cerrarModal('mProd')"); }; });
  const dlg = await openTool(page);
  await expect(dlg.locator('[data-pl-activo-field]')).toBeHidden();
  await dlg.locator('[data-pl-all]').click();
  await dlg.locator('[data-pl-newcat]').selectOption('bebidas');
  await dlg.locator('[data-pl-preview-btn]').click();
  await expect(dlg.locator('[data-pl-row]')).toHaveCount(2);
  await dlg.locator('[data-pl-confirm]').click();
  await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
  await page.locator('.na-pin-overlay .na-pin-ok').click();
  await expect(dlg.locator('.pl-good')).toHaveText('Listo: se guardaron 2 producto(s).');
  expect(seen.approvals.length).toBe(1);
  expect(seen.approvals[0].action).toBe('product.update');
  expect(await page.evaluate(() => (window as any).__saved)).toEqual([[9101, 'bebidas'], [9102, 'bebidas']]);
});

test('el empleado no ve la edición masiva', async ({ page }) => {
  await rolePage(page, 'empleado', 1280, false, false);
  await page.locator('#pageInventario .inv-secondary>summary').click();
  await expect(page.locator('#pageInventario .inv-secondary-menu')).toBeVisible();
  await expect(page.locator('#invEdicionMasivaBtn')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).NA_EDICION_MASIVA_PRODUCTOS.open())).toBe(false);
  await expect(page.locator('#naEdicionMasiva')).toHaveCount(0);
});

test('con el candado cerrado (rollback) el botón no aparece (falla cerrado)', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_PERMISSIONS);
  expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('edicion-masiva-productos'))).toBe(false);
  await page.evaluate(() => { const w = window as any, p = w.NA_PERMISSIONS; w.NA_PERMISSIONS = { ...p, featureLocked: (id: string) => id === 'edicion-masiva-productos' ? true : p.featureLocked(id) }; w.goPage('pageMenu'); w.goPage('pageInventario'); });
  await expect(page.locator('#invEdicionMasivaBtn')).toHaveCount(0);
  await page.evaluate(() => { const w = window as any; w.NA_PERMISSIONS = { ...w.NA_PERMISSIONS, featureLocked: undefined }; w.goPage('pageMenu'); (window as any).goPage('pageInventario'); });
  await expect(page.locator('#invEdicionMasivaBtn')).toHaveCount(0);
});

// CM-062: marca/unidad, excluir fila, empaque intacto, registro y deshacer. Capturas 390/768/1280 claro/oscuro.
const full = (page: Page) => page.evaluate(() => (0, eval)('JSON.stringify(productos.map(p=>[p.id,p.precio,p.costo,p.stock,p.cat,p.marca||"Sin marca",p.unidad,p.unidadCompra,p.factorCompra]))')).then(JSON.parse);
for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`CM-062 marca y unidad, excluir fila y deshacer ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await rolePage(page, 'owner', width, dark, true);
    const before = await full(page);
    const dlg = await openTool(page);
    await dlg.locator('[data-pl-all]').click();
    await dlg.locator('[data-pl-marca]').fill('Nuevo Amanecer');
    await dlg.locator('[data-pl-unidad]').selectOption('paquete');
    await dlg.locator('[data-pl-preview-btn]').click();
    await expect(dlg.locator('[data-pl-row]')).toHaveCount(3);
    await dlg.locator('[data-pl-include="9102"]').uncheck();
    await expect(dlg.locator('[data-pl-summary]')).toContainText('2 producto(s) se cambiarán (excluidos: 1)');
    await expect(dlg.locator('[data-pl-row]').first()).toContainText('Nuevo Amanecer (antes: Sin marca)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/cm062-preview-${width}-${dark ? 'oscuro' : 'claro'}.png`, fullPage: true });
    await dlg.locator('[data-pl-confirm]').click();
    await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
    await page.locator('.na-pin-overlay .na-pin-ok').click();
    await expect(dlg.locator('.pl-good')).toHaveText('Listo: se guardaron 2 producto(s).');
    const after = await full(page);
    expect(after.map((r: any[]) => [r[0], r[5], r[6]])).toEqual([[9101, 'Nuevo Amanecer', 'paquete'], [9102, 'Sin marca', 'unidad'], [9103, 'Nuevo Amanecer', 'paquete']]);
    // precio, costo, stock, categoría y empaque intactos
    expect(after.map((r: any[]) => [r[0], r[1], r[2], r[3], r[4], r[7], r[8]])).toEqual(before.map((r: any[]) => [r[0], r[1], r[2], r[3], r[4], r[7], r[8]]));
    await expect(dlg.locator('.pl-log li')).toHaveCount(1);
    const undo = dlg.locator('[data-pl-undo]');
    await expect(undo).toHaveText('Deshacer último lote (2)');
    await page.screenshot({ path: `test-results/cm062-registro-${width}-${dark ? 'oscuro' : 'claro'}.png`, fullPage: true });
    await undo.click();
    await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
    await page.locator('.na-pin-overlay .na-pin-ok').click();
    await expect(dlg.locator('.pl-good')).toContainText('se devolvieron 2 producto(s)');
    expect(await full(page)).toEqual(before);
    await expect(undo).toBeHidden();
  });
}

test('CM-062: kg con stock decimal no pasa a UND; se marca y se omite', async ({ page }) => {
  await rolePage(page, 'owner', 390, false, true);
  await page.evaluate(() => (0, eval)("productos[0].unidad='kilogramo';productos[0].stock=2.5;productos[1].unidad='litro';productos[1].stock=4"));
  const dlg = await openTool(page);
  await dlg.locator('[data-pl-all]').click();
  await dlg.locator('[data-pl-unidad]').selectOption('unidad');
  await dlg.locator('[data-pl-preview-btn]').click();
  await expect(dlg.locator('[data-pl-row]')).toHaveCount(2);
  await expect(dlg.locator('[data-pl-row="9101"] [data-pl-blocked]')).toHaveText('Stock con decimales (2.5): no se puede pasar a UNIDAD. Se omite.');
  await expect(dlg.locator('[data-pl-include="9101"]')).toBeDisabled();
  await expect(dlg.locator('[data-pl-summary]')).toContainText('1 producto(s) se cambiarán · omitidos por stock con decimales: 1');
  await page.screenshot({ path: 'test-results/cm062-decimales-390-claro.png', fullPage: true });
  await dlg.locator('[data-pl-confirm]').click();
  await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
  await page.locator('.na-pin-overlay .na-pin-ok').click();
  await expect(dlg.locator('.pl-good')).toHaveText('Listo: se guardaron 1 producto(s).');
  const u = await page.evaluate(() => (0, eval)('productos.map(p=>[p.id,p.unidad,p.stock])'));
  expect(u).toEqual([[9101, 'kilogramo', 2.5], [9102, 'unidad', 4], [9103, 'unidad', 8]]);
});

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`CM-062: UND→kg, venta de 1.5 kg, deshacer omite y no redondea ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await rolePage(page, 'owner', width, dark, true);
    const dlg = await openTool(page);
    await dlg.locator('[data-pl-cat]').selectOption('abarrotes');
    await dlg.locator('[data-pl-all]').click();
    await dlg.locator('[data-pl-unidad]').selectOption('kilogramo');
    await dlg.locator('[data-pl-preview-btn]').click();
    await expect(dlg.locator('[data-pl-row]')).toHaveCount(2);
    await dlg.locator('[data-pl-confirm]').click();
    await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
    await page.locator('.na-pin-overlay .na-pin-ok').click();
    await expect(dlg.locator('.pl-good')).toHaveText('Listo: se guardaron 2 producto(s).');
    // Venta de 1.5 kg de Arroz (stock 10 → 8.5)
    await page.evaluate(() => (0, eval)('productos[0].stock=Number((productos[0].stock-1.5).toFixed(3))'));
    await dlg.locator('[data-pl-cat]').selectOption('abarrotes');
    const undo = dlg.locator('[data-pl-undo]');
    await expect(undo).toHaveText('Deshacer último lote (1)');
    await expect(dlg.locator('[data-pl-undo-warn="9101"]')).toContainText('Stock con decimales (8.5): no se puede pasar a UNIDAD. Se omite.');
    await undo.click();
    await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
    await page.locator('.na-pin-overlay .na-pin-ok').click();
    await expect(dlg.locator('.pl-good')).toContainText('se devolvieron 1 producto(s) a como estaban. Omitidos por stock con decimales: 1.');
    await expect(dlg.locator('[data-pl-undo-blocked="9101"]')).toContainText('Stock con decimales (8.5)');
    await page.screenshot({ path: `test-results/cm062-deshacer-decimales-${width}-${dark ? 'oscuro' : 'claro'}.png`, fullPage: true });
    const u = await page.evaluate(() => (0, eval)('productos.map(p=>[p.id,p.unidad,p.stock])'));
    expect(u).toEqual([[9101, 'kilogramo', 8.5], [9102, 'unidad', 5], [9103, 'unidad', 8]]);
  });
}
test('CM-062: UND con stock decimal (legado) no pasa a paquete', async ({ page }) => {
  await rolePage(page, 'owner', 1280, false, true);
  await page.evaluate(() => (0, eval)("productos[1].stock=2.5"));
  const dlg = await openTool(page);
  await dlg.locator('[data-pl-all]').click();
  await dlg.locator('[data-pl-unidad]').selectOption('paquete');
  await dlg.locator('[data-pl-preview-btn]').click();
  await expect(dlg.locator('[data-pl-row="9102"] [data-pl-blocked]')).toHaveText('Stock con decimales (2.5): no se puede pasar a PAQUETE. Se omite.');
  await dlg.locator('[data-pl-confirm]').click();
  await page.locator('.na-pin-overlay .na-pin-input').fill('2468');
  await page.locator('.na-pin-overlay .na-pin-ok').click();
  await expect(dlg.locator('.pl-good')).toHaveText('Listo: se guardaron 2 producto(s).');
  const u = await page.evaluate(() => (0, eval)('productos.map(p=>[p.id,p.unidad,p.stock])'));
  expect(u).toEqual([[9101, 'paquete', 10], [9102, 'unidad', 2.5], [9103, 'paquete', 8]]);
});
