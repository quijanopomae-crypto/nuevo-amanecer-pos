import { test, expect, type Page } from '@playwright/test';

// HTML y scripts reales; rol, movimientos y ventas sintéticos solo en el navegador de la prueba. Sin red externa.
// El candado 'kardex-documentos' se abre SOLO dentro de este navegador; pos-permissions.js no cambia.
async function rolePage(page: Page, role: 'owner' | 'empleado' | '', unlock = true) {
  const requests: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') {
      requests.push(route.request().method() + ' ' + url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
        url.pathname === '/auth/me' ? { pos_role: role || null, owner_pin_set: true, roles_ready: true, device_id: 'kdoc-test-device' } : url.pathname === '/auth/purchases' ? { purchases: [], truncated: false } : {}) });
    }
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    // Toda escritura en almacenamiento que venga de este módulo queda registrada (el resto de la app autoguarda por su cuenta).
    const w = window as any; w.__kdocWrites = [];
    for (const name of ['setItem', 'removeItem', 'clear']) {
      const original = (Storage.prototype as any)[name];
      (Storage.prototype as any)[name] = function (...args: any[]) { if (/kardex-documentos\.js/.test(new Error().stack || '')) w.__kdocWrites.push(name + ' ' + args[0]); return original.apply(this, args); };
    }
  });
  await page.addInitScript(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic' }));
    if (role) localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_KARDEX_DOCUMENTOS && !!(window as any).NA_ROLES);
  if (role) await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
  else await page.evaluate(() => {
    const w = window as any, roles = w.NA_ROLES;
    w.NA_ROLES = new Proxy(roles, { get: (t, k) => k === 'role' ? '' : k === 'isOwner' ? () => false : t[k] });
  });
  const today = await page.evaluate(unlock => {
    const w = window as any, P = w.NA_PERMISSIONS;
    if (unlock) w.NA_PERMISSIONS = Object.freeze(Object.assign({}, P, { featureLocked: (id: string) => id === 'kardex-documentos' ? false : P.featureLocked(id) }));
    const today = w.NA_KARDEX_DOCUMENTOS.periodRange().to;
    w.eval(`
      productos=[{id:'d-1',name:'Arroz sintético',sku:'D-01',stock:10,costo:4,controlInventario:true},{id:'d-2',name:'Azúcar sintética',sku:'D-02',stock:5,costo:3,controlInventario:true}];
      inventoryMovements=[
        {id:'m1',productId:'d-1',type:'SALE',delta:-2,fecha:'${today}',timestamp:'${today}T10:00:00',referenceId:'V-000777'},
        {id:'m2',productId:'d-2',type:'SALE',delta:-1,fecha:'${today}',timestamp:'${today}T10:00:01',referenceId:'V-000777'},
        {id:'m3',productId:'d-1',type:'ENTRADA',delta:6,fecha:'${today}',timestamp:'${today}T08:00:00',referenceId:'PUR-55:1',reason:'Compra <img src=x onerror=alert(1)>',unit_cost_cents:400},
        {id:'m4',productId:'d-2',type:'ENTRADA',delta:4,fecha:'${today}',timestamp:'${today}T08:00:00',referenceId:'PUR-55:2',reason:'Compra <img src=x onerror=alert(1)>',unit_cost_cents:300},
        {id:'m5',productId:'d-1',type:'SALIDA',delta:-1,fecha:'${today}',timestamp:'${today}T07:00:00',reason:'ajuste:v1:{"t":"merma","u":{"n":"Ana <b>Prueba</b>","i":"u1"},"n":""}'}
      ];
      ventas=[{id:'V-000777',fecha:'${today}',cajeroNombre:'Luis Cajero',total:25,items:[{id:'d-1',qty:2},{id:'d-2',qty:1}]}];
    `);
    return today;
  }, unlock);
  return { requests, today };
}
const state = (page: Page) => page.evaluate(() => JSON.stringify({ writes: (window as any).__kdocWrites, data: (window as any).eval('JSON.stringify({productos,ventas,inventoryMovements})') }));
async function openKardex(page: Page) {
  await page.evaluate(() => { (window as any).NA_MENU_NAVIGATION?.closeMobileDrawer?.(); (window as any).goPage('pageKardex'); });
  await expect(page.locator('#pageKardex')).toHaveClass(/\bactive\b/);
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  const theme = dark ? 'oscuro' : 'claro';
  test(`dueño ve los documentos que movieron stock en ${width}px, tema ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { requests } = await rolePage(page, 'owner');
    await page.evaluate(dark => (window as any).NA_THEME.setMode(dark ? 'noche' : 'claro'), dark);
    const before = await state(page);
    await openKardex(page);
    const box = page.locator('[data-kdoc]');
    await expect(box).toBeVisible();
    await expect(box.locator('[data-kdoc-controls]')).toBeVisible();
    const rows = box.locator('[data-kdoc-row]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Venta'); await expect(rows.nth(0)).toContainText('V-000777'); await expect(rows.nth(0)).toContainText('Luis Cajero'); await expect(rows.nth(0)).toContainText('−3');
    await expect(rows.nth(1)).toContainText('Compra'); await expect(rows.nth(1)).toContainText('+10');
    await expect(rows.nth(2)).toContainText('Ajuste'); await expect(rows.nth(2)).toContainText('Ana <b>Prueba</b>');
    await expect(rows.nth(0)).toContainText('10:00');
    expect(await box.locator('img, b').count()).toBe(0);
    await expect(box.locator('[data-kdoc-content]')).not.toContainText(/S\/|costo/i);
    await box.locator('[data-kdoc-type]').selectOption('compra');
    await expect(rows).toHaveCount(1);
    await box.locator('[data-kdoc-type]').selectOption('todos');
    const day = await page.evaluate(() => (window as any).NA_KARDEX_DOCUMENTOS.periodRange().to);
    const yesterday = new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    await box.locator('[data-kdoc-to]').fill(yesterday);
    await expect(box.locator('.kardex-note')).toContainText('Sin documentos');
    await box.locator('[data-kdoc-to]').fill(day);
    await expect(rows).toHaveCount(3);
    expect(await page.locator('#pageKardex').evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const color = await box.locator('h2').evaluate(n => getComputedStyle(n).color);
    expect(color).toBe(dark ? 'rgb(248, 250, 252)' : 'rgb(15, 23, 42)');
    await page.screenshot({ path: `test-results/kardex-documentos-${width}-${theme}.png`, fullPage: false });
    expect(await state(page)).toBe(before);
    expect(requests.filter(r => !r.startsWith('GET /auth/me') && !r.startsWith('GET /auth/purchases'))).toEqual([]);
    expect(requests.some(r => /inventory-movements/.test(r))).toBe(false);
  });
}

for (const role of ['empleado', ''] as const) test(`rol ${role || 'desconocido'}: sección oculta y ninguna lectura`, async ({ page }) => {
  const { requests } = await rolePage(page, role);
  const before = await state(page);
  await page.evaluate(() => (window as any).NA_KARDEX_DOCUMENTOS.render());
  const box = page.locator('[data-kdoc]');
  await expect(box).toBeHidden();
  await expect(box.locator('[data-kdoc-controls]')).toBeHidden();
  await expect(box.locator('[data-kdoc-status]')).toHaveText('');
  await expect(box.getByText('Sin permiso')).toHaveCount(0);
  await expect(box.locator('[data-kdoc-row]')).toHaveCount(0);
  expect(await state(page)).toBe(before);
  expect(requests.filter(r => !r.startsWith('GET /auth/me'))).toEqual([]);
});

test('candado cerrado (repositorio real): la sección no aparece ni para el dueño', async ({ page }) => {
  await rolePage(page, 'owner', false);
  expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('kardex-documentos'))).toBe(true);
  await openKardex(page);
  await expect(page.locator('[data-kdoc]')).toBeHidden();
  await expect(page.locator('[data-kdoc-row]')).toHaveCount(0);
});

test('el módulo no usa innerHTML ni escribe', async ({ page }) => {
  const res = await page.request.get('/js/modules/kardex-documentos.js');
  const src = (await res.text()).replace(/\/\*[\s\S]*?\*\//g, '');
  expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|fetch\(|\.api\(/);
});
