import { test, expect, type Page } from '@playwright/test';
import { expectAllFit } from './helpers/fits';

// Historial de compras por producto: el contenido debe llenar el ancho disponible (sin hueco a la
// derecha ni scroll horizontal). Red simulada y datos ficticios; nada se escribe.
const products = [
  { id: 101, name: 'Producto de prueba 101', sku: 'T-101', unidad: 'unidad', stock: 5, costo: 6 },
  { id: 202, name: 'Producto de prueba 202', sku: 'T-202', unidad: 'unidad', stock: 3, costo: 4 },
  { id: 303, name: 'Producto de prueba 303', sku: 'T-303', unidad: 'unidad', stock: 1, costo: 2 },
];
const purchases = [
  { purchase_id: 'PUR-t1', status: 'aplicada', created_at: '2026-10-14T02:00:00Z', supplier: 'Proveedor de prueba A', total_cost_cents: 4550,
    lines: [{ purchase_id: 'PUR-t1', line_number: 1, product_id: '101', quantity: 7, unit_cost_cents: 650 }] },
  { purchase_id: 'PUR-t2', status: 'aplicada', created_at: '2026-10-10T02:00:00Z', supplier: 'Proveedor de prueba B', total_cost_cents: 800,
    lines: [{ purchase_id: 'PUR-t2', line_number: 1, product_id: '101', quantity: 2, unit_cost_cents: 400 }] },
];

async function open(page: Page, dark: boolean) {
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'permissions.test' || request.method() !== 'GET') return route.abort();
    if (url.pathname === '/auth/me') return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'TEST-device' }) });
    if (url.pathname === '/auth/purchases' && !url.search) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ purchases, truncated: false }) });
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'test_endpoint_unavailable' }) });
  });
  await page.addInitScript(() => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'TEST-synthetic-token' }));
  });
  await page.goto('/index.html');
  await expect.poll(() => page.evaluate(() => {
    const w = window as any;
    return typeof w.NA_ROLES?.refresh === 'function' && typeof w.NA_HISTORIAL_COMPRAS?.readPurchases === 'function';
  }), { timeout: 30_000 }).toBe(true);
  await page.evaluate(async () => { await (window as any).NA_ROLES.refresh(); });
  await expect.poll(() => page.evaluate(() => (window as any).NA_ROLES.role === 'owner' && (window as any).NA_ROLES.confirmed), { timeout: 30_000 }).toBe(true);
  // Tema «Nocturno» con la API de la app si existe; si no, la clase del body.
  await page.evaluate(dark => {
    const theme = (window as any).NA_THEME;
    if (typeof theme?.setMode === 'function') theme.setMode(dark ? 'noche' : 'claro');
    else document.body.classList.toggle('dark', dark);
  }, dark);
  await expect(page.locator('body')).toHaveClass(dark ? /\bdark\b/ : /^(?!.*\bdark\b).*$/);
  // La carga asíncrona del estado local puede reemplazar «productos» tras sembrarlos: se siembra
  // y se abre la consulta hasta que muestre exactamente el catálogo de prueba.
  await expect.poll(async () => {
    await page.evaluate(data => {
      (0, eval)('productos = ' + JSON.stringify(data));
      (window as any).NuevoAmanecerCanonical = { enabled: () => true, snapshot: () => ({}), sourceState: () => ({ source: 'remote' }) };
      (window as any).goPage('pageHistorialCompras');
    }, products);
    return page.locator('[data-hc-products] button').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.productId).join(','));
  }, { timeout: 30_000 }).toBe('101,202,303');
  await expect(page.locator('#pageHistorialCompras')).toHaveClass(/\bactive\b/);
}

/** Bordes [izquierda, derecha] de la caja de contenido de un nodo (sin padding). */
function contentEdges(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(node => {
    const r = node.getBoundingClientRect(), s = getComputedStyle(node);
    return [r.left + parseFloat(s.paddingLeft), r.right - parseFloat(s.paddingRight)];
  });
}
function edges(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(node => { const r = node.getBoundingClientRect(); return [r.left, r.right]; });
}

for (const width of [390, 768, 900, 1280]) for (const dark of [false, true]) {
  test(`historial de compras llena el ancho a ${width}px, tema ${dark ? 'nocturno' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page, dark);
    const root = page.locator('#pageHistorialCompras');

    // La hoja ocupa todo el viewport y el shell todo su ancho útil (tope de 1100 px).
    const [pageLeft, pageRight] = await edges(page, '#pageHistorialCompras');
    expect(pageLeft).toBeLessThanOrEqual(1);
    expect(pageRight).toBeGreaterThanOrEqual(width - 1);
    const [innerLeft, innerRight] = await contentEdges(page, '#pageHistorialCompras');
    const [shellLeft, shellRight] = await edges(page, '#pageHistorialCompras .hc-shell');
    expect(shellRight - shellLeft).toBeGreaterThanOrEqual(Math.min(1100, innerRight - innerLeft) - 1);

    // Con 3 productos la grilla no cambia: 1 columna en teléfono, 2 hasta 999 px, 3 desde 1000 px.
    const cols = width < 600 ? 1 : width < 1000 ? 2 : 3;
    const cards = page.locator('[data-hc-products] button');
    const [listLeft, listRight] = await contentEdges(page, '#pageHistorialCompras .hc-products');
    const listWidth = listRight - listLeft;
    const firstCard = await cards.nth(0).boundingBox();
    expect(Math.abs(firstCard!.width - (listWidth - 8 * (cols - 1)) / cols)).toBeLessThanOrEqual(2);
    // El tope de columnas se mantiene: el tercer producto baja de fila salvo con 3 columnas (≥1000 px).
    const thirdCard = await cards.nth(2).boundingBox();
    if (cols < 3) expect(thirdCard!.y, 'tercer producto en otra fila').toBeGreaterThan(firstCard!.y + 1);
    else expect(Math.abs(thirdCard!.y - firstCard!.y), 'tres productos en una fila').toBeLessThanOrEqual(1);

    // Un solo resultado de búsqueda: a 390/768/900 debe llenar la fila (antes dejaba vacía la mitad derecha).
    await page.locator('[data-hc-search]').fill('T-101');
    await expect(cards).toHaveCount(1);
    const [cardLeft, cardRight] = await edges(page, '[data-hc-products] button');
    if (cols <= 2) {
      expect(cardLeft - listLeft).toBeLessThanOrEqual(1);
      expect(listRight - cardRight, 'sin hueco a la derecha del resultado').toBeLessThanOrEqual(1);
    } else {
      // Escritorio ancho (≥1000 px) conserva su grilla de 3 columnas.
      expect(Math.abs((cardRight - cardLeft) - (listWidth - 16) / 3)).toBeLessThanOrEqual(2);
    }

    // Resultado completo: resumen y tabla llenan el ancho del shell, sin desbordes.
    await cards.click();
    await expect(page.locator('#pageHistorialCompras .hc-table tbody tr')).toHaveCount(2);
    for (const selector of ['.hc-summary', '.hc-table', '.hc-search']) {
      const [l, r] = await edges(page, '#pageHistorialCompras ' + selector);
      expect(Math.abs(l - shellLeft), selector + ' alineado a la izquierda').toBeLessThanOrEqual(1);
      expect(Math.abs(shellRight - r), selector + ' sin hueco a la derecha').toBeLessThanOrEqual(1);
    }
    await expectAllFit(root, '.hc-shell, .hc-products button, .hc-summary, .hc-stat, .hc-table');
  });
}
