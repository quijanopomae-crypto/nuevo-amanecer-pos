import { test, expect } from '@playwright/test';

// WORK: tabla honesta a 390 px (navegador sintético, sin escrituras): aviso «Mostrando N de M», scroll horizontal propio, página sin desbordar.
test.describe('WORK tabla honesta (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('consulta de 45 filas × 11 columnas: aviso visible, tabla se desliza dentro de la tarjeta y la página no se ensancha', async ({ page }) => {
    await page.goto('/index.html?work=1');
    await page.evaluate(() => {
      const roles = (window as any).NA_ROLES;
      if (!roles) throw new Error('La sesión de roles no se montó');
      (window as any).NA_ASISTENTE = { engine: { ready: () => true, prepare: (t: string) => ({ text: t, context: { screen: 'pageMenu', products: [] }, cards: [] }) } };
      const cols = Array.from({ length: 11 }, (_, j) => 'Columna ' + (j + 1));
      const filas = Array.from({ length: 45 }, (_, i) => cols.map((_, j) => (j === 0 ? 'Producto de prueba con nombre largo ' + (i + 1) : i + j)));
      roles.api = async () => ({ reply: 'Aquí tienes la tabla de prueba.', proposals: [{ id: 'q1', type: 'consulta', needsConfirm: false, result: { titulo: 'Tabla de prueba', columnas: cols, filas } }] });
    });
    const work = page.frameLocator('#naWorkOverlay iframe');
    await work.locator('#promptInput').fill('muéstrame la tabla');
    await work.locator('#promptForm button[type="submit"]').click();
    const notice = work.locator('.na-card .na-trim');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Mostrando 30 de 45 filas y 8 de 11 columnas');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(work.locator('.na-card tbody tr')).toHaveCount(30);
    await expect(work.locator('.na-card thead th')).toHaveCount(8);
    await expect(work.locator('.na-card thead th[scope="col"]')).toHaveCount(8);
    const wrap = work.locator('.na-card .na-tscroll');
    await expect(wrap).toHaveAttribute('role', 'region');
    const m = await wrap.evaluate((el) => {
      const d = el.ownerDocument.documentElement;
      return { sw: el.scrollWidth, cw: el.clientWidth, docSw: d.scrollWidth, docCw: d.clientWidth, ox: getComputedStyle(el).overflowX };
    });
    expect(m.ox).toBe('auto');
    expect(m.sw).toBeGreaterThan(m.cw); // la tabla ancha se desliza dentro de su contenedor
    expect(m.docSw).toBeLessThanOrEqual(m.docCw); // la página (iframe de WORK) no se desborda a los lados
  });

  test('si todo cabe no hay aviso', async ({ page }) => {
    await page.goto('/index.html?work=1');
    await page.evaluate(() => {
      const roles = (window as any).NA_ROLES;
      (window as any).NA_ASISTENTE = { engine: { ready: () => true, prepare: (t: string) => ({ text: t, context: { screen: 'pageMenu', products: [] }, cards: [] }) } };
      roles.api = async () => ({ reply: 'Listo.', proposals: [{ id: 'q1', type: 'consulta', needsConfirm: false, result: { titulo: 'Poco stock', columnas: ['Producto', 'Stock'], filas: [['Leche', 2], ['Arroz', 1]] } }] });
    });
    const work = page.frameLocator('#naWorkOverlay iframe');
    await work.locator('#promptInput').fill('qué falta');
    await work.locator('#promptForm button[type="submit"]').click();
    await expect(work.locator('.na-card tbody tr')).toHaveCount(2);
    await expect(work.locator('.na-card .na-trim')).toHaveCount(0);
  });
});
