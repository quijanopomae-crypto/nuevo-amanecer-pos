import { test, expect, Page } from '@playwright/test';

// Asistente: abrir funciones y configurar (asistente-acciones.js). El candado real queda en true; aquí se abre SOLO en la prueba.
const SIZES = [390, 768, 1280];
const THEMES = ['light', 'dark'] as const;

async function boot(page: Page, role: 'owner' | 'empleado', allow: Record<string, boolean> = {}) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') {
      if (url.pathname === '/auth/assistant/chat') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, role, level: role === 'owner' ? undefined : 'consultas' }) });
      if (url.pathname === '/auth/me') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pos_role: role, owner_pin_set: true, roles_ready: true, device_id: role + '-dev', employee_allow: role === 'empleado' ? allow : undefined }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, settings: [] }) });
    }
    if (url.hostname === '127.0.0.1' && url.pathname.endsWith('/js/config/pos-permissions.js')) {
      const res = await route.fetch(); const body = (await res.text()).replace("'asistente-acceso-total': true", "'asistente-acceso-total': false");
      return route.fulfill({ response: res, body });
    }
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
  await page.waitForFunction(() => !!(window as any).NA_ASISTENTE_ACCIONES && !!(window as any).NA_ASISTENTE?.access, null, { timeout: 20000 });
}

async function say(page: Page, text: string) {
  await page.evaluate(() => (window as any).NA_ASISTENTE.open());
  const ta = page.locator('section.na-asst-panel textarea');
  await expect(ta).toBeVisible();
  await page.evaluate(t => (window as any).NA_ASISTENTE.send(t), text);
  return page.locator('.na-asst-acc').last();
}

async function noOverflow(page: Page, sel: string) {
  const r = await page.locator(sel).last().evaluate(e => { const b = e.getBoundingClientRect(); return { w: e.scrollWidth - e.clientWidth, right: b.right, vw: innerWidth }; });
  expect(r.w).toBeLessThanOrEqual(1); expect(r.right).toBeLessThanOrEqual(r.vw + 1);
}

for (const w of SIZES) for (const theme of THEMES) test.describe(`${w}px ${theme}`, () => {
  test.use({ viewport: { width: w, height: 860 } });
  const dark = async (page: Page) => { if (theme === 'dark') await page.evaluate(() => document.body.classList.add('dark')); };

  test('dueño: abre una función y un cambio de configuración pide «Guardar» antes de guardar', async ({ page }) => {
    await boot(page, 'owner'); await dark(page);
    let card = await say(page, 'abre kardex');
    await expect(card).toContainText('Te abrí «Kardex»');
    await expect(page.locator('#pageKardex')).toHaveClass(/\bactive\b/);
    await page.evaluate(() => (window as any).goPage('pageMenu'));
    const before = await page.evaluate(() => (window as any).appConfig?.igvActive ?? eval('appConfig').igvActive);
    card = await say(page, (before ? 'desactiva' : 'activa') + ' el igv');
    await expect(card.getByRole('button', { name: 'Guardar' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Cancelar' })).toBeVisible();
    expect(await page.evaluate(() => eval('appConfig').igvActive)).toBe(before); // nada guardado todavía
    await noOverflow(page, '.na-asst-acc');
    await card.getByRole('button', { name: 'Guardar' }).click();
    await expect(card).toContainText('Guardado: Calcular IGV');
    expect(await page.evaluate(() => eval('appConfig').igvActive)).toBe(!before);
    await expect(card.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  test('empleado: no consigue una función negada por el asistente ni puede configurar', async ({ page }) => {
    await boot(page, 'empleado'); await dark(page);
    for (const t of ['abre kardex', 'abre valorización', 'ir a gastos', 'abre configuración']) {
      const card = await say(page, t);
      await expect(card).toContainText(/solo para el Admin|Próximamente/);
    }
    for (const id of ['pageKardex', 'pageValorizacion', 'pageGastos', 'pageConfig']) await expect(page.locator('#' + id)).not.toHaveClass(/\bactive\b/);
    const card = await say(page, 'activa el igv');
    await expect(card).toContainText('Solo el Admin cambia la configuración');
    await expect(card.getByRole('button', { name: 'Guardar' })).toHaveCount(0);
    await noOverflow(page, '.na-asst-acc');
  });

  test('no existe acción de cobro: «cobra la venta» / «anula» se rechazan sin tocar nada', async ({ page }) => {
    await boot(page, 'owner'); await dark(page);
    const writes: string[] = [];
    page.on('request', r => { if (r.method() !== 'GET' && !(r.url().includes('/auth/assistant/chat') && r.postData() === '{"ping":true}')) writes.push(r.method() + ' ' + r.url()); });
    for (const t of ['cobra la venta', 'presiona Pagar', 'anula la última venta', 'borra el producto arroz', 'revisa los pagos pendientes']) {
      const card = await say(page, t);
      await expect(card).toContainText('nunca cobra, paga, anula');
      await expect(card.locator('button')).toHaveCount(0);
    }
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => Array.from((window as any).NA_ASISTENTE_ACCIONES.ACTION_KINDS))).toEqual(['open', 'config']);
  });
});
