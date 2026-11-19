import { test, expect } from '@playwright/test';

test.describe('WORK hosted design integration (synthetic browser, no production writes)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('WORK is the primary home and does not expose the retired POS landing', async ({ page }) => {
    await page.goto('/index.html?work=1');
    await expect(page.locator('#naWorkOverlay iframe')).toBeVisible();
    const work = page.frameLocator('#naWorkOverlay iframe');
    await expect(work.locator('#openMenu')).toBeVisible();
    await expect(work.locator('#promptInput')).toBeVisible();
    await expect(work.locator('#workChat')).toHaveCount(1);
    await expect(work.locator('.metric-value').first()).not.toHaveText('S/ 28.30');
    await expect(work.locator('.activity')).toHaveCount(0);
    await expect(work.getByRole('button', { name: 'Volver al POS' })).toHaveCount(0);
    // The original business-page DOM remains behind WORK to feed the live summary.
    await expect(page.locator('#pageMenu')).toHaveCount(1);
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

  test('WORK muestra Enviar al adjuntar foto y envia imagen real al puente CANON', async ({ page }) => {
    await page.goto('/index.html?work=1');
    await page.evaluate(() => {
      const roles = (window as any).NA_ROLES;
      if (!roles) throw Error('Sin sesion de prueba');
      (window as any).__workPhotoCalls = [];
      (window as any).NA_ASISTENTE = { engine: { ready: () => true, prepare: (t: string) => ({ text: t, context: { screen: 'pageMenu', products: [] }, cards: [] }) } };
      roles.api = async (path: string, body: any) => {
        (window as any).__workPhotoCalls.push({ path, body });
        if (body.ping) return { ok: true, role: 'owner', vision: true };
        if (path === '/auth/assistant/chat?image=1') {
          if (!String(body.image || '').startsWith('data:image/jpeg;base64,')) throw Error('Falta la foto real');
          return { reply: 'Foto procesada por el puente de prueba', proposals: [] };
        }
        if (path === '/auth/assistant/chat') return { reply: 'Chat abierto', proposals: [] };
        throw Error('Ruta inesperada: ' + path);
      };
    });
    const work = page.frameLocator('#naWorkOverlay iframe');
    await work.locator('#promptInput').fill('Hola');
    await work.locator('#promptForm button[type="submit"]').click();
    await expect(work.locator('#chatMessages')).toContainText('Chat abierto');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64');
    await work.locator('#workFiles').setInputFiles({ name: 'foto-prueba.png', mimeType: 'image/png', buffer: png });
    await expect(work.locator('#attachmentSendHint')).toContainText('Toca la flecha azul');
    await expect(work.locator('#chatSend')).toHaveAttribute('aria-label', 'Enviar mensaje');
    await expect(work.locator('#chatSend')).toBeEnabled();
    await work.locator('#chatSend').click();
    await expect(work.locator('#chatMessages')).toContainText('foto-prueba.png');
    await expect(work.locator('#chatMessages')).toContainText('Foto procesada por el puente de prueba');
    await expect(work.locator('#attachmentTray')).toBeHidden();
    const calls = await page.evaluate(() => (window as any).__workPhotoCalls);
    expect(calls.filter((c: any) => c.path === '/auth/assistant/chat?image=1')).toHaveLength(1);
  });

});
