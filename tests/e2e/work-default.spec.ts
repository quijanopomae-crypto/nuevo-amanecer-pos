import { test, expect } from '@playwright/test';

test.describe('WORK hosted design integration (synthetic browser, no production writes)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('WORK is the default-design candidate while ?work=0 safely preserves the legacy shell', async ({ page }) => {
    await page.goto('/index.html?work=1');
    await expect(page.locator('#naWorkOverlay iframe')).toBeVisible();
    const work = page.frameLocator('#naWorkOverlay iframe');
    await expect(work.locator('#openMenu')).toBeVisible();
    await expect(work.locator('#promptInput')).toBeVisible();
    await expect(work.locator('#workChat')).toHaveCount(1);
    await expect(work.locator('.metric-value').first()).not.toHaveText('S/ 28.30');
    await expect(work.locator('.activity')).toHaveCount(0);
    await page.goto('/index.html?work=0');
    await expect(page.locator('#naWorkOverlay iframe')).toHaveCount(0);
    await expect(page.locator('#pageMenu')).toBeVisible();
  });

  test('WORK drawer navigates to the original protected Inventario without replacing the POS', async ({ page }) => {
    await page.goto('/index.html?work=1');
    const work = page.frameLocator('#naWorkOverlay iframe');
    await work.locator('#openMenu').click();
    await expect(work.locator('#drawer')).toHaveAttribute('aria-hidden','false');
    await work.locator('.drawer-nav-item[data-demo="Inventario"]').click();
    await expect(page.locator('#naWorkOverlay')).toHaveCount(0);
    await expect(page.locator('#pageInventario')).toHaveClass(/active/);
  });

  test('WORK chat routes text to the existing POS API bridge, no mocked demo reply', async ({ page }) => {
    await page.goto('/index.html?work=1');
    await page.evaluate(() => {
      const roles = (window as any).NA_ROLES;
      if (!roles) throw new Error('La sesión de roles no se montó');
      // El motor del asistente original (nombres tapados + contexto) se prueba en tests/asistente y tests/work; aquí solo se verifica la ruta.
      (window as any).NA_ASISTENTE = { engine: { ready: () => true, prepare: (t: string) => ({ text: t, context: { screen: 'pageMenu', products: [] }, cards: [] }) } };
      roles.api = async (path: string, body: any) => {
        if (path !== '/auth/assistant/chat') throw new Error('Ruta incorrecta');
        if (body.text !== '¿Cuánto vendí hoy?') throw new Error('Consulta incorrecta');
        return { reply: 'Resultado de prueba canónico S/ 12.34', proposals: [] };
      };
    });
    const work = page.frameLocator('#naWorkOverlay iframe');
    await work.locator('#promptInput').fill('¿Cuánto vendí hoy?');
    await work.locator('#promptForm button[type="submit"]').click();
    await expect(work.locator('#chatMessages')).toContainText('Resultado de prueba canónico S/ 12.34');
  });
});
