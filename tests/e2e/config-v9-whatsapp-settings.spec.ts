import { test, expect, type Page } from '@playwright/test';

// Configuración v9 → Negocio → Ticket y comprobantes: panel «Compartir comprobantes por WhatsApp»
// (NAReceiptUI.settingsHtml). Formato y «Preguntar» van a pos.ticket (guardarConfig, solo dueño);
// «Abrir con» es de cada aparato (localStorage na_pos_share_app_v1) y nunca hace POST de pos.ticket.
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
test.use({ userAgent: ANDROID_UA, serviceWorkers: 'block' });

type Post = { key: string; value: any };
type Server = { posts: Post[]; settings: Record<string, { value: any; revision: number }> };

async function cloudPage(page: Page, role: 'owner' | 'empleado', server: Server) {
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'permissions.test') {
      if (url.pathname === '/auth/me') return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'wa-settings-device' }) });
      if (url.pathname === '/settings' && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ settings: Object.entries(server.settings).map(([key, s]) => ({ key, value: s.value, revision: s.revision })) }) });
      if (url.pathname === '/settings' && req.method() === 'POST') {
        const body = req.postDataJSON() as Post; server.posts.push(body);
        if (role !== 'owner') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'owner_only' }) });
        const revision = (server.settings[body.key]?.revision || 0) + 1; server.settings[body.key] = { value: body.value, revision };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'wa-settings-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
  await enableCloud(page);
}

// Igual que reporte-productos-vencer.spec: el fixture activa la nube (config-g lee NuevoAmanecerCanonical.enabled())
// y trae /settings del servidor simulado, como al abrir la app.
async function enableCloud(page: Page) {
  await page.waitForFunction(() => (window as any).NA_ROLES?.confirmed && (window as any).NA_MENU_NAVIGATION && (window as any).NAReceiptUI && (window as any).NA_CONFIG_G);
  await page.evaluate(async () => { const w = window as any; w.NuevoAmanecerCanonical = { ...w.NuevoAmanecerCanonical, enabled: () => true }; await w.NA_CONFIG_G.pullSettings(); });
}

async function settle(server: Server, page: Page) {
  // Espera a que terminen las sincronizaciones de fondo del arranque (config-g) antes de medir.
  let n = -1;
  for (let i = 0; i < 20 && n !== server.posts.length; i++) { n = server.posts.length; await page.waitForTimeout(800); }
}

async function openTicket(page: Page) {
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'));
  await expect(page.locator('#naCfgV9')).toBeVisible();
  await page.locator('#na9Nav [data-top="neg"]').click();
  await page.locator('#naCfgV9 [data-tab="ticket"]').click();
  await expect(page.locator('#naCfgV9 .na9-bd[data-sec="ticket"] .na9-wa #naReceiptSettings')).toBeVisible();
}

for (const width of [390, 1366]) for (const dark of [false, true]) {
  test(`panel WhatsApp en Ticket y comprobantes ${width}px ${dark ? 'Nocturno' : 'claro'}`, async ({ page }) => {
    const server: Server = { posts: [], settings: {} };
    await page.setViewportSize({ width, height: 900 });
    await cloudPage(page, 'owner', server);
    if (dark) await page.evaluate(() => (window as any).NA_THEME.setMode('noche'));
    await openTicket(page);
    const panel = page.locator('#naCfgV9 .na9-wa');
    // Los elementos de antes siguen en su lugar: el panel va después de la vista previa.
    await expect(page.locator('#naCfgV9 .na9-split')).toBeVisible();
    expect(await page.evaluate(() => { const s = document.querySelector('#naCfgV9 .na9-split'), w = document.querySelector('#naCfgV9 .na9-wa');
      return !!(s && w && (s.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING)); })).toBe(true);
    for (const id of ['#cfgReceiptFormat', '#cfgReceiptAsk', '#cfgReceiptApp']) { await expect(panel.locator(id)).toBeVisible(); await expect(panel.locator(id)).toBeEnabled(); }
    if (dark) await expect(page.locator('#naCfgV9')).toHaveClass(/na9-dk/);
    // Contraste mínimo: el texto del panel no es igual al fondo de la fila.
    const colors = await panel.locator('.cfg-setting').first().evaluate(n => { const cs = getComputedStyle(n), l = getComputedStyle(n.querySelector('label')!); return [cs.backgroundColor, l.color]; });
    expect(colors[0]).not.toBe(colors[1]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await panel.evaluate(n => { const b = n.getBoundingClientRect(); return [...n.querySelectorAll<HTMLElement>('select,input,label,.cfg-panel-title')]
      .every(c => { const r = c.getBoundingClientRect(); return r.left >= b.left - 1 && r.right <= b.right + 1; }); })).toBe(true);
    await panel.screenshot({ path: test.info().outputPath(`wa-${width}-${dark ? 'dark' : 'light'}.png`) });
  });
}

test('«Abrir con» se guarda en este aparato: sin POST de pos.ticket, sobrevive a recarga y a un pull del servidor', async ({ page }) => {
  const server: Server = { posts: [], settings: { 'pos.ticket': { value: { shareFormat: 'image', shareAsk: true, shareApp: 'whatsapp' }, revision: 3 } } };
  await page.setViewportSize({ width: 1366, height: 900 });
  await cloudPage(page, 'owner', server);
  await settle(server, page);
  await openTicket(page);
  // Valor viejo del servidor (pos.ticket.shareApp) como respaldo mientras el aparato no elija.
  await expect(page.locator('#cfgReceiptApp')).toHaveValue('whatsapp');
  expect(await page.evaluate(() => localStorage.getItem('na_pos_share_app_v1'))).toBeNull();
  // Abrir Configuración guarda la navegación y config-g puede re-sincronizar en segundo plano (escritura
  // conocida, ver helpers/known-background-keys.ts y PR #823). Se espera a que termine antes de medir.
  await settle(server, page);
  server.posts.length = 0;
  await page.locator('#cfgReceiptApp').selectOption('business');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('na_pos_share_app_v1'))).toBe('business');
  await page.waitForTimeout(2500); // más que el autosave (500 ms) y el push diferido de config-g (600 ms)
  expect(server.posts.filter(p => p.key === 'pos.ticket'), 'Abrir con no debe enviar pos.ticket').toEqual([]);
  expect(server.posts).toEqual([]);
  expect(await page.evaluate(() => (window as any).eval('appConfig').ticket.shareApp)).toBe('whatsapp');

  // Pull de settings del servidor (con shareApp distinto): no pisa la elección del aparato.
  await page.evaluate(() => (window as any).NA_CONFIG_G.pullSettings());
  expect(await page.evaluate(() => (window as any).NAReceiptShare.settings().app)).toBe('business');
  // Tras recargar, lo que se sincronice no lleva la elección del aparato.
  server.posts.length = 0;
  await page.reload();
  await enableCloud(page);
  await openTicket(page);
  await settle(server, page);
  expect(server.posts.filter(p => p.key === 'pos.ticket' && p.value.shareApp === 'business')).toEqual([]);
  await expect(page.locator('#cfgReceiptApp')).toHaveValue('business');
  expect(await page.evaluate(() => (window as any).NAReceiptShare.settings().app)).toBe('business');
});

test('formato y «Preguntar» siguen compartidos: se guardan en pos.ticket con guardarConfig y persisten', async ({ page }) => {
  const server: Server = { posts: [], settings: {} };
  await page.setViewportSize({ width: 1366, height: 900 });
  await cloudPage(page, 'owner', server);
  await settle(server, page);
  await page.evaluate(() => localStorage.setItem('na_pos_share_app_v1', 'business'));
  await openTicket(page);
  server.posts.length = 0;
  await page.locator('#cfgReceiptFormat').selectOption('pdf');
  await expect.poll(() => server.posts.filter(p => p.key === 'pos.ticket').length).toBeGreaterThan(0);
  let ticket = server.posts.filter(p => p.key === 'pos.ticket').at(-1)!.value;
  expect(ticket.shareFormat).toBe('pdf');
  expect(ticket).not.toHaveProperty('shareApp');
  await page.locator('#cfgReceiptAsk').uncheck();
  await expect.poll(() => server.posts.filter(p => p.key === 'pos.ticket' && p.value.shareAsk === false).length).toBeGreaterThan(0);
  ticket = server.posts.filter(p => p.key === 'pos.ticket').at(-1)!.value;
  expect(ticket).toMatchObject({ shareFormat: 'pdf', shareAsk: false });
  expect(ticket).not.toHaveProperty('shareApp');
  await page.reload();
  await enableCloud(page);
  await openTicket(page);
  await expect(page.locator('#cfgReceiptFormat')).toHaveValue('pdf');
  await expect(page.locator('#cfgReceiptAsk')).not.toBeChecked();
  await expect(page.locator('#cfgReceiptApp')).toHaveValue('business');
});

test('cajero: formato y «Preguntar» deshabilitados; «Abrir con» usable y local; Configuración sigue bloqueada', async ({ page }) => {
  const server: Server = { posts: [], settings: {} };
  await page.setViewportSize({ width: 390, height: 900 });
  await cloudPage(page, 'empleado', server);
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'));
  await page.waitForTimeout(800);
  // Configuración es solo del admin: el cajero no ve la pantalla v9 ni el panel.
  await expect(page.locator('#naCfgV9 .na9-wa')).toHaveCount(0);
  await expect(page.locator('#pageConfig #cfgReceiptFormat')).toHaveCount(0);
  await page.evaluate(() => { const h = document.createElement('div'); h.id = 'cfgHost'; h.innerHTML = (window as any).NAReceiptUI.settingsHtml(); document.body.append(h); });
  await expect(page.locator('#cfgHost #cfgReceiptFormat')).toBeDisabled();
  await expect(page.locator('#cfgHost #cfgReceiptAsk')).toBeDisabled();
  await expect(page.locator('#cfgHost #cfgReceiptApp')).toBeEnabled();
  server.posts.length = 0;
  await page.locator('#cfgHost #cfgReceiptApp').selectOption('whatsapp');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('na_pos_share_app_v1'))).toBe('whatsapp');
  await page.waitForTimeout(1500);
  expect(server.posts.filter(p => p.key === 'pos.ticket')).toEqual([]);
});

// Permiso (no CSS): sharedEditable() falla cerrado. Si NA_ROLES no está o lanza un error, Formato y «Preguntar»
// quedan deshabilitados y no se envía nada; el dueño sigue editando vía NA_ROLES.isOwner().
for (const broken of ['ausente', 'isOwner lanza', 'getter lanza'] as const) {
  test(`NA_ROLES ${broken}: Formato y «Preguntar» deshabilitados, 0 POST`, async ({ page }) => {
    const server: Server = { posts: [], settings: {} };
    await page.setViewportSize({ width: 390, height: 900 });
    await cloudPage(page, 'owner', server);
    await settle(server, page);
    // Control: con NA_ROLES sano el dueño puede editar.
    expect(await page.evaluate(() => { const h = document.createElement('div'); h.innerHTML = (window as any).NAReceiptUI.settingsHtml(); return (h.querySelector('#cfgReceiptFormat') as HTMLSelectElement).disabled; })).toBe(false);
    await page.evaluate(kind => {
      const w = window as any;
      if (kind === 'ausente') { delete w.NA_ROLES; w.NA_ROLES = undefined; }
      else if (kind === 'isOwner lanza') w.NA_ROLES = { ...w.NA_ROLES, isOwner() { throw new Error('roles rotos'); } };
      else Object.defineProperty(w, 'NA_ROLES', { configurable: true, get() { throw new Error('roles rotos'); } });
    }, broken);
    server.posts.length = 0;
    await page.evaluate(() => { const h = document.createElement('div'); h.id = 'cfgHost'; h.innerHTML = (window as any).NAReceiptUI.settingsHtml(); document.body.prepend(h); });
    await expect(page.locator('#cfgHost #naReceiptSettings')).toHaveClass(/is-readonly/);
    await expect(page.locator('#cfgHost #cfgReceiptFormat')).toBeDisabled();
    await expect(page.locator('#cfgHost #cfgReceiptAsk')).toBeDisabled();
    await expect(page.locator('#cfgHost #cfgReceiptApp')).toBeEnabled(); // «Abrir con» es de este aparato
    // Aunque se fuerce el cambio y se llame al guardado, no se guarda ni se envía nada.
    const before = await page.evaluate(() => (window as any).NAReceiptShare.settings());
    await page.evaluate(async () => { (document.querySelector('#cfgHost #cfgReceiptFormat') as HTMLSelectElement).value = 'pdf'; (document.querySelector('#cfgHost #cfgReceiptAsk') as HTMLInputElement).checked = false; await (window as any).NAReceiptUI.changeSettings(); });
    await page.waitForTimeout(2000);
    expect(server.posts).toEqual([]);
    expect(await page.evaluate(() => (window as any).NAReceiptShare.settings())).toEqual(before);
  });
}
