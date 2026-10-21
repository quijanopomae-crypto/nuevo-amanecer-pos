import { test, expect, type Page } from '@playwright/test';

// Misión 7: ajustes de inventario (merma/rotura/vencido/corrección). Datos sintéticos, modo local.
async function rolePage(page: Page, role: 'owner' | 'empleado') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'aj-test-device' } : url.pathname === '/auth/purchases' ? { purchases: [], truncated: false } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'aj-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
}
async function seed(page: Page) {
  await page.evaluate(() => (window as any).eval(`
    productos=[{id:'aj-1',name:'Yogurt "fresa" · 1L | promo',sku:'AJ-01',stock:10,costo:4,precio:6,controlInventario:true},{id:'aj-2',name:'Pan',sku:'AJ-02',stock:5,controlInventario:true}];
    inventoryMovements=[{id:'aj-buy',productId:'aj-1',type:'ENTRADA',delta:4,timestamp:new Date().toISOString(),reason:'Compra a proveedor',fecha:new Date().toISOString().slice(0,10)}];
    ventas=[];
    window._naGetActiveCashier=()=>({id:'C-0007',nombre:'María "Mary" · Caja | 1'});
  `));
}
const sales = (page: Page) => page.evaluate(() => (window as any).eval('JSON.stringify({ventas,creditos,cajMovs,cajEstado})'));
async function openCard(page: Page) {
  await page.evaluate(() => (window as any).goPage('pageProximamente'));
  const card = page.locator('[data-feature-id="ajustes-inventario"]');
  await expect(card).toHaveClass(/is-enabled/);
  await card.click();
  await expect(page.locator('#pageAjustesInventario')).toBeVisible();
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño registra una merma a ${width}px ${dark ? 'oscuro' : 'claro'}: baja stock por movimiento, reporte y CSV`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner');
    await seed(page);
    const before = await sales(page);
    await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
    await openCard(page);
    const screen = page.locator('#pageAjustesInventario');
    await screen.locator('[data-aj-search]').fill('yogurt');
    await screen.locator('[data-aj-product]').selectOption('aj-1');
    await screen.locator('[data-aj-type]').selectOption('merma');
    await expect(screen.locator('[data-aj-direction-wrap]')).toBeHidden();
    await screen.locator('[data-aj-qty]').fill('2');
    await screen.locator('[data-aj-note]').fill('Envase "inflado" | lote · A');
    await screen.locator('[data-aj-submit]').click();
    await expect(screen.locator('[data-aj-message]')).toHaveText('Ajuste registrado.');
    const state = await page.evaluate(() => (window as any).eval('JSON.stringify({p:productos.find(x=>x.id==="aj-1"),m:inventoryMovements.filter(x=>x.productId==="aj-1")})'));
    const { p, m } = JSON.parse(state);
    expect(p.stock).toBe(8);
    const adj = m.filter((x: any) => String(x.reason).startsWith('ajuste:v1:'));
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ type: 'SALIDA', delta: -2 });
    const row = screen.locator('[data-aj-row="merma"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Yogurt "fresa" · 1L | promo');
    await expect(row).toContainText('María "Mary" · Caja | 1 · C-0007');
    await expect(row).toContainText('Envase "inflado" | lote · A');
    const limaDate = await page.evaluate(() => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()));
    await expect(row.locator('td').first()).toContainText(limaDate);
    await expect(screen.locator('[data-aj-row]')).toHaveCount(1); // la compra normal no aparece
    await expect(screen.locator('[data-aj-sum="merma"]')).toHaveText('-2');
    // Contraste mínimo del texto en filas y botón
    const ok = await screen.evaluate(node => {
      const lum = (c: string) => { const v = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
      const bg = (el: Element | null): string => { while (el) { const b = getComputedStyle(el).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; el = el.parentElement; } return 'rgb(255,255,255)'; };
      return [...node.querySelectorAll('td, [data-aj-submit], h1, h2')].every(el => { const a = lum(getComputedStyle(el).color), b = lum(bg(el)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5; });
    });
    expect(ok).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const [download] = await Promise.all([page.waitForEvent('download'), screen.locator('[data-aj-export]').click()]);
    const csv = await (await download.createReadStream()).toArray().then(c => Buffer.concat(c).toString('utf8'));
    expect(csv).toContain('"Yogurt ""fresa"" · 1L | promo",Merma,-2');
    expect(await sales(page)).toBe(before);
  });
}

test('empleado no ve ni registra ajustes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await rolePage(page, 'empleado');
  await seed(page);
  const res = await page.evaluate(async () => { const w = window as any; w.goPage?.('pageAjustesInventario'); w.NA_AJUSTES_INVENTARIO.render(); return w.NA_AJUSTES_INVENTARIO.register({ productId: 'aj-1', type: 'merma', quantity: 1 }); });
  expect(res.ok).toBe(false);
  expect(await page.evaluate(() => (window as any).eval('productos[0].stock'))).toBe(10);
  await expect(page.locator('#pageAjustesInventario [data-aj-main]')).toBeHidden();
  await expect(page.locator('#pageAjustesInventario [data-aj-report] tr')).toHaveCount(0);
});
