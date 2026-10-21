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

// Bloqueo provisional: en CANON el Worker no deja elegir el lote de una SALIDA (descuenta primero lotes
// vigentes), así que «Rotura» y «Vencido» se desactivan en productos con lotes.
async function canonWithLots(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__ajSent = [];
    const lot = (id: string, expiry: string, quantity: number) => ({ lot_id: id, lot_code: id, expiry_date: expiry, received_at: '2026-09-01T00:00:00Z', quantity });
    const products = [
      { product_id: 'c-lot', name: 'Leche con lotes', stock: 8, lots: [lot('L-VENC', '2026-10-01', 3), lot('L-OK', '2099-12-01', 5)] },
      { product_id: 'c-plain', name: 'Pan sin lotes', stock: 4 }
    ];
    w.NuevoAmanecerCanonical = { ...(w.NuevoAmanecerCanonical || {}), enabled: () => true, snapshot: () => ({ products, inventoryMovements: [] }),
      adjustInventory: async (b: any) => { w.__ajSent.push(b); return { ok: true }; }, refresh: async () => {} };
    w.NA_AJUSTES_INVENTARIO.render();
  });
}
for (const width of [390, 768, 1280]) {
  test(`CANON a ${width}px: «Rotura» y «Vencido» desactivados en productos con lotes, con explicación; Merma y Corrección siguen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner');
    await openCard(page);
    await canonWithLots(page);
    const screen = page.locator('#pageAjustesInventario');
    const type = screen.locator('[data-aj-type]'), note = screen.locator('[data-aj-lot-note]');
    const disabled = () => type.evaluate((s: HTMLSelectElement) => [...s.options].filter(o => o.disabled).map(o => o.value));
    await expect(screen.locator('[data-aj-status]')).toContainText('CANON');
    // Sin lotes: todo habilitado y sin aviso.
    await screen.locator('[data-aj-product]').selectOption('c-plain');
    await type.selectOption('vencido');
    expect(await disabled()).toEqual([]);
    await expect(note).toBeHidden();
    // Con lotes: Rotura y Vencido desactivados; la selección pasa a Merma y se explica en español.
    await screen.locator('[data-aj-product]').selectOption('c-lot');
    expect(await disabled()).toEqual(['rotura', 'vencido']);
    await expect(type).toHaveValue('merma');
    await expect(type.locator('option[value="vencido"]')).toHaveText('Vencido (no disponible con lotes)');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Este producto tiene lotes');
    await expect(note).toContainText('Se habilitarán cuando el servidor permita elegir el lote');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    // Forzar «Vencido» saltándose la interfaz: la guardia de register no envía nada a CANON.
    await type.evaluate((s: HTMLSelectElement) => { s.value = 'vencido'; });
    await screen.locator('[data-aj-qty]').fill('1');
    await screen.locator('[data-aj-submit]').click();
    await expect(screen.locator('[data-aj-message]')).toContainText('Se habilitarán cuando el servidor permita elegir el lote');
    await expect(screen.locator('[data-aj-message]')).toHaveAttribute('data-aj-ok', 'false');
    for (const t of ['rotura', 'vencido']) {
      const res = await page.evaluate(t => (window as any).NA_AJUSTES_INVENTARIO.register({ productId: 'c-lot', type: t, quantity: 1 }), t);
      expect(res).toMatchObject({ ok: false, blocked: 'LOTS_REQUIRE_LOT_SELECTION' });
    }
    expect(await page.evaluate(() => (window as any).__ajSent.length)).toBe(0);
    // Merma sí se registra en el producto con lotes.
    await type.selectOption('merma');
    await screen.locator('[data-aj-qty]').fill('1');
    await screen.locator('[data-aj-submit]').click();
    await expect(screen.locator('[data-aj-message]')).toHaveText('Ajuste registrado.');
    const sent = await page.evaluate(() => (window as any).__ajSent.map((b: any) => [b.product_id, b.movement_type, b.reason.slice(0, 10)]));
    expect(sent).toEqual([['c-lot', 'SALIDA', 'ajuste:v1:']]);
    // Corrección también.
    await type.selectOption('correccion');
    await screen.locator('[data-aj-direction]').selectOption('sumar');
    await screen.locator('[data-aj-qty]').fill('2');
    await screen.locator('[data-aj-submit]').click();
    await expect(screen.locator('[data-aj-message]')).toHaveText('Ajuste registrado.');
    expect(await page.evaluate(() => (window as any).__ajSent.map((b: any) => b.movement_type))).toEqual(['SALIDA', 'ENTRADA']);
    // Contraste del aviso en claro y oscuro.
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
      const ratio = await note.evaluate(el => {
        const lum = (c: string) => { const v = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
        let n: Element | null = el, bg = 'rgb(255,255,255)';
        while (n) { const b = getComputedStyle(n).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(b)) { bg = b; break; } n = n.parentElement; }
        const a = lum(getComputedStyle(el).color), b = lum(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      expect(ratio, dark ? 'oscuro' : 'claro').toBeGreaterThanOrEqual(4.5);
    }
    // Volver a un producto sin lotes reactiva las opciones.
    await screen.locator('[data-aj-product]').selectOption('c-plain');
    expect(await disabled()).toEqual([]);
    await expect(type.locator('option[value="vencido"]')).toHaveText('Vencido');
    await expect(note).toBeHidden();
  });
}
