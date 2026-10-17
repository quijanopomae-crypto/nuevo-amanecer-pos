import { test, expect, type Page } from '@playwright/test';

// POST /settings solo sale al guardar Configuración de verdad, y solo con las claves que cambiaron
// frente a lo último que confirmó el servidor (GET o POST con éxito en esta sesión).
test.use({ timezoneId: 'UTC', serviceWorkers: 'block' });

type Setting = { key: string; value: unknown; revision: number };
type Mock = { settings: Setting[]; getFails: boolean; conflict: null | { revision: number; then: Setting[] }; gets: number; posts: { key: string; value: unknown; expected_revision: unknown }[]; revision: number };

const KEYS = ['pos.business', 'pos.flags', 'pos.credit', 'pos.lots', 'pos.ticket'];

async function boot(page: Page, mock: Mock) {
  // La app real con nube activa: solo se fuerza enabled() del cliente canónico para que config-g sincronice.
  await page.addInitScript(() => {
    let current: any;
    Object.defineProperty(window, 'NuevoAmanecerCanonical', { configurable: true,
      get: () => current, set: value => { current = value && typeof value === 'object' ? { ...value, enabled: () => true } : value; } });
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== 'permissions.test') return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/auth/me') return json(200, { pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'settings-test-device' });
    if (url.pathname === '/settings' && request.method() === 'GET') {
      mock.gets++;
      return mock.getFails ? json(500, { error: 'boom' }) : json(200, { settings: mock.settings });
    }
    if (url.pathname === '/settings' && request.method() === 'POST') {
      const body = request.postDataJSON();
      mock.posts.push(body);
      if (mock.conflict) { const c = mock.conflict; mock.settings = c.then; return json(409, { error: 'revision_conflict', revision: c.revision }); }
      return json(200, { status: 'saved', key: body.key, revision: ++mock.revision });
    }
    return json(200, {});
  });
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'settings-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role: 'owner' }));
    localStorage.removeItem('na_pos_settings_cache_v1');
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.role === 'owner' && (window as any).NA_ROLES.confirmed && !!(window as any).NA_CONFIG_G);
}

// Misma proyección que SHARED[k].get en POS/js/config/config-g.js.
function localSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const w = window as any, c = w.eval('appConfig'), b = c.business || {};
    let allowExpiredLots = false;
    try { allowExpiredLots = w._naGetSecurityPath('rules.allowExpiredLots') === true; } catch (_) {}
    return JSON.parse(JSON.stringify({
      'pos.business': { nombre: b.nombre || '', ruc: b.ruc || '', direccion: b.direccion || '', telefono: b.telefono || '' },
      'pos.flags': { igvActive: !!c.igvActive, margenActive: !!c.margenActive, stockAlertActive: !!c.stockAlertActive, printAuto: !!c.printAuto,
        mayoristaActive: !!c.mayoristaActive, alertsEnabled: c.alertsEnabled !== false, stockMin: c.stockMin },
      'pos.credit': Object.assign({}, c.creditPolicy || {}),
      'pos.lots': { allowExpiredLots },
      'pos.ticket': Object.assign({}, c.ticket || {}),
    }));
  });
}
const asServer = (values: Record<string, unknown>, revision = 3): Setting[] => KEYS.map(key => ({ key, value: values[key], revision }));
const newMock = (): Mock => ({ settings: [], getFails: false, conflict: null, gets: 0, posts: [], revision: 10 });

async function navigate(page: Page) {
  for (const id of ['pageProximamente', 'pageClienteHistorial', 'pageInventario', 'pageClientes', 'pageMenu']) {
    await page.evaluate(id => { const w = window as any; if (document.getElementById(id)) w.goPage(id); else w.saveAppState(); }, id);
  }
  await page.evaluate(() => (window as any).saveAppState());
  // El push anterior salía 600 ms después de saveAppState; se espera más que eso.
  await page.waitForTimeout(1500);
}

test('(a) owner opens a report and other pages: 0 POST /settings even if the server values differ', async ({ page }) => {
  const mock = newMock();
  await boot(page, mock);
  const local = await localSettings(page);
  // El servidor tiene otros valores: antes, cualquier saveAppState los pisaba con los locales.
  mock.settings = asServer({ ...local, 'pos.business': { nombre: 'Otro nombre', ruc: '', direccion: 'Otra', telefono: '' } });
  await page.evaluate(() => (window as any).NA_CONFIG_G.pullSettings());
  await page.evaluate(() => (window as any).goPage('pageClienteHistorial'));
  await expect(page.locator('#pageClienteHistorial')).toHaveClass(/active/);
  await navigate(page);
  expect(mock.gets).toBeGreaterThan(0);
  expect(mock.posts).toEqual([]);
});

test('(b) a real change in Configuración sends exactly one POST with that key and the confirmed revision', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const mock = newMock();
  await boot(page, mock);
  mock.settings = asServer(await localSettings(page));
  await page.evaluate(() => (window as any).NA_CONFIG_G.pullSettings());
  await navigate(page);
  expect(mock.posts).toEqual([]);
  const before = await page.evaluate(() => !!(window as any).eval('appConfig').igvActive);
  await page.evaluate(() => (window as any).goPage('pageConfig'));
  await page.locator('#naCfgV9 [data-top="prod"]').click();
  await page.locator('#naCfgV9 [data-tab="igv"]').click();
  // El checkbox real está oculto detrás del interruptor: se hace clic en el interruptor visible, como el usuario.
  const toggle = page.locator('#naCfgV9 input[data-na9="igvActive"]');
  await expect(toggle).toBeChecked({ checked: before });
  await page.locator('#naCfgV9 label.na9-sw:has(input[data-na9="igvActive"])').click();
  await expect(toggle).toBeChecked({ checked: !before });
  await expect(page.locator('#na9Saved')).toHaveText('Guardado ✓');
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0].key).toBe('pos.flags');
  expect(mock.posts[0].expected_revision).toBe(3);
  expect((mock.posts[0].value as any).igvActive).toBe(!before);
  // Lo recién confirmado no se vuelve a enviar al navegar ni al guardar sin cambios.
  await navigate(page);
  await page.evaluate(() => (window as any).NA_CONFIG_G.flush());
  expect(mock.posts).toHaveLength(1);
});

test('(c) failed GET /settings + navigation: 0 POST, and saving reports not synced instead of pushing', async ({ page }) => {
  const mock = newMock();
  mock.getFails = true;
  await boot(page, mock);
  await page.evaluate(() => (window as any).goPage('pageClienteHistorial'));
  await navigate(page);
  expect(mock.gets).toBeGreaterThan(0);
  expect(mock.posts).toEqual([]);
  // Ni la caché local sirve como base para enviar: sin un GET exitoso no hay push.
  await page.evaluate(() => localStorage.setItem('na_pos_settings_cache_v1', JSON.stringify({ 'pos.flags': { value: {}, revision: 1 } })));
  const result = await page.evaluate(async () => { const w = window as any; w.eval('appConfig').igvActive = !w.eval('appConfig').igvActive; return w.NA_CONFIG_G.flush(); });
  expect(result).toMatchObject({ ok: false, reason: 'not_synced' });
  expect(mock.posts).toEqual([]);
});

test('(d) revision_conflict: one POST, then a fresh GET, no retry with local values; the server value wins', async ({ page }) => {
  const mock = newMock();
  await boot(page, mock);
  const local = await localSettings(page);
  mock.settings = asServer(local);
  await page.evaluate(() => (window as any).NA_CONFIG_G.pullSettings());
  const flags = local['pos.flags'] as Record<string, unknown>;
  // Otro aparato guardó pos.flags (revisión 4) con igvActive distinto al cambio que hará este aparato.
  const serverFlags = { ...flags, igvActive: !!flags.igvActive, margenActive: !flags.margenActive };
  mock.conflict = { revision: 4, then: asServer({ ...local, 'pos.flags': serverFlags }).map(s => s.key === 'pos.flags' ? { ...s, revision: 4 } : s) };
  const getsBefore = mock.gets;
  const result = await page.evaluate(async () => { const w = window as any; w.eval('appConfig').igvActive = !w.eval('appConfig').igvActive; return w.NA_CONFIG_G.flush(); });
  expect(result).toMatchObject({ ok: false, reason: 'revision_conflict', failed: ['pos.flags'] });
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0]).toMatchObject({ key: 'pos.flags', expected_revision: 3 });
  expect(mock.gets).toBeGreaterThan(getsBefore);
  // Se aplicó lo del servidor (no lo local) y no hubo un segundo POST.
  expect((await localSettings(page))['pos.flags']).toEqual(serverFlags);
  mock.conflict = null;
  await navigate(page);
  expect(mock.posts).toHaveLength(1);
});
