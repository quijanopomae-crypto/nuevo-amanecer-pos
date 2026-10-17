import { test, expect, type Page } from '@playwright/test';

// POST /settings solo sale al guardar Configuración de verdad, y solo con las claves que cambiaron
// frente a lo último que confirmó el servidor (GET o POST con éxito en esta sesión).
test.use({ timezoneId: 'UTC', serviceWorkers: 'block' });

type Setting = { key: string; value: unknown; revision: number };
type Mock = { settings: Setting[]; getFails: boolean; conflict: null | { revision: number; then: Setting[] }; gets: number; posts: { key: string; value: unknown; expected_revision: unknown }[]; revision: number };

const KEYS = ['pos.business', 'pos.flags', 'pos.credit', 'pos.lots', 'pos.ticket'];

async function boot(page: Page, mock: Mock, cache?: Setting[]) {
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
      const revision = ++mock.revision;
      mock.settings = [...mock.settings.filter(item => item.key !== body.key), { key: body.key, value: body.value, revision }];
      return json(200, { status: 'saved', key: body.key, revision });
    }
    return json(200, {});
  });
  await page.goto('/index.html');
  await page.evaluate(cache => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'settings-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role: 'owner' }));
    // cache: copia del servidor de una sesión anterior (lo que tenía este aparato).
    if (cache) localStorage.setItem('na_pos_settings_cache_v1', JSON.stringify(Object.fromEntries(cache.map(item => [item.key, { value: item.value, revision: item.revision }]))));
    else localStorage.removeItem('na_pos_settings_cache_v1');
  }, cache);
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

const CONFLICT = 'Otro equipo cambió la configuración; se cargó la versión del servidor, revisa y guarda de nuevo';
const serverValue = (mock: Mock, key: string) => mock.settings.find(item => item.key === key)?.value;
const flip = (page: Page, key: string) => page.evaluate(key => { const c = (window as any).eval('appConfig'); c[key] = !c[key]; }, key);

// Abre Configuración v9 en un tema y pestaña (PC, 1366 px).
async function openConfig(page: Page, top: string, tab: string) {
  if (!(await page.locator('#pageConfig').evaluate(node => node.classList.contains('active')))) await page.evaluate(() => (window as any).goPage('pageConfig'));
  await page.locator(`#naCfgV9 [data-top="${top}"]`).click();
  await page.locator(`#naCfgV9 [data-tab="${tab}"]`).click();
}
async function clickSwitch(page: Page, id: string) {
  // El checkbox real está oculto detrás del interruptor: se hace clic en el interruptor visible, como el usuario.
  const input = page.locator(`#naCfgV9 input[data-na9="${id}"]`), before = await input.isChecked();
  await page.locator(`#naCfgV9 label.na9-sw:has(input[data-na9="${id}"])`).click();
  await expect(input).toBeChecked({ checked: !before });
}

// Cada clave compartida (SHARED en config-g.js) con su control real de Configuración v9.
const V9_CONTROL: Record<string, (page: Page) => Promise<void>> = {
  'pos.business': async page => { await openConfig(page, 'neg', 'datos'); await page.locator('#naCfgV9 input[data-na9="biz.telefono"]').fill('987654321'); },
  'pos.flags': async page => { await openConfig(page, 'prod', 'igv'); await clickSwitch(page, 'igvActive'); },
  'pos.credit': async page => { await openConfig(page, 'ventas', 'cred'); await clickSwitch(page, 'credEnabled'); },
  'pos.lots': async page => { await openConfig(page, 'prod', 'stock'); await clickSwitch(page, 'expiredLots'); },
  'pos.ticket': async page => { await openConfig(page, 'neg', 'ticket'); await clickSwitch(page, 'tk.showLogo'); },
};

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
  expect(result).toMatchObject({ ok: false, reason: 'revision_conflict', conflicts: ['pos.flags'] });
  // Aviso visible con el sistema de avisos existente (no «Revisa internet»).
  await expect(page.locator('#gToast')).toHaveText(CONFLICT);
  expect(await page.locator('#gToast').textContent()).toBe(CONFLICT);
  await expect(page.locator('#gToast')).toHaveClass(/show/);
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0]).toMatchObject({ key: 'pos.flags', expected_revision: 3 });
  expect(mock.gets).toBeGreaterThan(getsBefore);
  // Se aplicó lo del servidor (no lo local) y no hubo un segundo POST.
  expect((await localSettings(page))['pos.flags']).toEqual(serverFlags);
  mock.conflict = null;
  await navigate(page);
  expect(mock.posts).toHaveLength(1);
});

test('(e) initial GET failed, server changed pos.ticket, owner changes only IGV: exactly 1 POST pos.flags and pos.ticket stays as on the server', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const mock = newMock();
  mock.getFails = true;
  // Primero se lee lo local para armar la caché de la sesión anterior (= lo que tenía este aparato).
  await boot(page, mock);
  const local = await localSettings(page);
  const cache = asServer(local);
  const ticketFromOtherDevice = { ...(local['pos.ticket'] as object), pie: 'Cambiado en otro equipo' };
  mock.settings = cache.map(item => item.key === 'pos.ticket' ? { ...item, value: ticketFromOtherDevice, revision: 4 } : item);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await boot(page, mock, cache);
  expect(mock.posts).toEqual([]);
  mock.getFails = false;
  await openConfig(page, 'prod', 'igv');
  const igvBefore = !!(local['pos.flags'] as any).igvActive;
  await clickSwitch(page, 'igvActive');
  await expect(page.locator('#na9Saved')).toHaveText('Guardado ✓');
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0]).toMatchObject({ key: 'pos.flags', expected_revision: 3 });
  expect((mock.posts[0].value as any).igvActive).toBe(!igvBefore);
  // pos.ticket no se envió: el servidor conserva su versión y el aparato la tomó.
  expect(serverValue(mock, 'pos.ticket')).toEqual(ticketFromOtherDevice);
  expect((await localSettings(page))['pos.ticket']).toEqual(ticketFromOtherDevice);
  await navigate(page);
  expect(mock.posts).toHaveLength(1);
});

test('(f) a change saved while GET failed is sent once with the new revision when the server did not touch that key', async ({ page }) => {
  const mock = newMock();
  await boot(page, mock);
  const cache = asServer(await localSettings(page));
  mock.settings = cache.map(item => item.key === 'pos.flags' ? { ...item, revision: 5 } : item); // misma configuración, otra revisión
  mock.getFails = true;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await boot(page, mock, cache);
  await flip(page, 'igvActive');
  const wanted = (await localSettings(page))['pos.flags'];
  expect(await page.evaluate(() => (window as any).NA_CONFIG_G.flush())).toMatchObject({ ok: false, reason: 'not_synced' });
  expect(mock.posts).toEqual([]);
  // Vuelve la conexión: el siguiente pull completa el guardado pendiente (no lo descarta).
  mock.getFails = false;
  await page.evaluate(() => (window as any).NA_CONFIG_G.pullSettings());
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0]).toMatchObject({ key: 'pos.flags', expected_revision: 5, value: wanted });
  expect((await localSettings(page))['pos.flags']).toEqual(wanted);
  await page.evaluate(() => (window as any).NA_CONFIG_G.pullSettings());
  await navigate(page);
  expect(mock.posts).toHaveLength(1);
});

test('(g) a change saved while GET failed loses against a server change to the same key, with the visible notice', async ({ page }) => {
  const mock = newMock();
  await boot(page, mock);
  const local = await localSettings(page);
  const cache = asServer(local);
  const flags = local['pos.flags'] as Record<string, unknown>;
  const serverFlags = { ...flags, margenActive: !flags.margenActive };
  mock.settings = cache.map(item => item.key === 'pos.flags' ? { ...item, value: serverFlags, revision: 6 } : item);
  mock.getFails = true;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await boot(page, mock, cache);
  await flip(page, 'igvActive');
  expect(await page.evaluate(() => (window as any).NA_CONFIG_G.flush())).toMatchObject({ ok: false, reason: 'not_synced' });
  mock.getFails = false;
  await page.evaluate(() => (window as any).NA_CONFIG_G.pullSettings());
  expect(mock.posts).toEqual([]);
  expect((await localSettings(page))['pos.flags']).toEqual(serverFlags);
  await expect(page.locator('#gToast')).toHaveText(CONFLICT);
  expect(await page.locator('#gToast').textContent()).toBe(CONFLICT);
});

test('(h) every SHARED key has a Configuración v9 control that sends exactly one POST with that key', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const mock = newMock();
  await boot(page, mock);
  mock.settings = asServer(await localSettings(page));
  await page.evaluate(() => (window as any).NA_CONFIG_G.pullSettings());
  const keys: string[] = await page.evaluate(() => (window as any).NA_CONFIG_G.sharedKeys());
  // Si SHARED gana una clave sin control cubierto aquí, la prueba falla.
  expect(keys.filter(key => !V9_CONTROL[key])).toEqual([]);
  expect(keys.length).toBeGreaterThan(0);
  for (const [index, key] of keys.entries()) {
    await V9_CONTROL[key](page);
    await expect.poll(() => mock.posts.length, { message: `POST de ${key}` }).toBe(index + 1);
    await expect(page.locator('#na9Saved')).toHaveText('Guardado ✓');
    await page.waitForTimeout(800); // el guardado automático espera 500 ms: no debe salir un segundo POST
    expect(mock.posts.map(post => post.key)).toEqual(keys.slice(0, index + 1));
  }
});

test('(i) «No se guardó en el servidor» disappears after a later successful save', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const mock = newMock();
  await boot(page, mock);
  const cache = asServer(await localSettings(page));
  mock.settings = cache;
  mock.getFails = true;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await boot(page, mock, cache);
  await openConfig(page, 'prod', 'igv');
  await clickSwitch(page, 'igvActive');
  const failure = page.getByText('No se guardó en el servidor', { exact: false });
  await expect(failure).toBeVisible();
  expect(mock.posts).toEqual([]);
  mock.getFails = false;
  await openConfig(page, 'neg', 'ticket');
  await clickSwitch(page, 'tk.showLogo');
  await expect(page.locator('#na9Saved')).toHaveText('Guardado ✓');
  await expect(failure).toHaveCount(0);
  // El cambio pendiente de IGV y el del ticket llegan, una vez cada uno.
  expect(mock.posts.map(post => post.key).sort()).toEqual(['pos.flags', 'pos.ticket']);
});

test('(j) conflict from Configuración v9: exact label «No se guardó: otro equipo cambió la configuración» and exact toast', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const mock = newMock();
  await boot(page, mock);
  const local = await localSettings(page);
  mock.settings = asServer(local);
  await page.evaluate(() => (window as any).NA_CONFIG_G.pullSettings());
  const flags = local['pos.flags'] as Record<string, unknown>;
  const serverFlags = { ...flags, margenActive: !flags.margenActive };
  mock.conflict = { revision: 4, then: asServer({ ...local, 'pos.flags': serverFlags }).map(s => s.key === 'pos.flags' ? { ...s, revision: 4 } : s) };
  await openConfig(page, 'prod', 'igv');
  await clickSwitch(page, 'igvActive');
  await expect.poll(() => mock.posts.length).toBe(1);
  // Textos exactos (texto completo, no subcadena).
  await expect(page.locator('#na9Saved')).toHaveText('No se guardó: otro equipo cambió la configuración');
  expect(await page.locator('#na9Saved').textContent()).toBe('No se guardó: otro equipo cambió la configuración');
  await expect(page.locator('#gToast')).toHaveText(CONFLICT);
  expect(await page.locator('#gToast').textContent()).toBe(CONFLICT);
  expect(mock.posts).toHaveLength(1);
  expect((await localSettings(page))['pos.flags']).toEqual(serverFlags);
});

// GET fallido -> el dueño cambia IGV en Configuración v9 -> recarga la app con el GET ya funcionando.
async function changeIgvOfflineThenReload(page: Page, mock: Mock, serverChange?: (local: Record<string, unknown>) => Setting[]) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page, mock);
  const local = await localSettings(page);
  const cache = asServer(local);
  mock.settings = cache;
  mock.getFails = true;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await boot(page, mock, cache);
  await openConfig(page, 'prod', 'igv');
  await clickSwitch(page, 'igvActive');
  await expect(page.locator('#na9Saved')).toHaveText('No se guardó en el servidor: revisa internet');
  expect(await page.evaluate(() => localStorage.getItem('na_pos_settings_pending_v1'))).not.toBeNull();
  expect(mock.posts).toEqual([]);
  const ownerFlags = (await localSettings(page))['pos.flags'];
  if (serverChange) mock.settings = serverChange(local);
  mock.getFails = false;
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.role === 'owner' && (window as any).NA_ROLES.confirmed && !!(window as any).NA_CONFIG_G);
  return { local, ownerFlags };
}
const pendingKey = (page: Page) => page.evaluate(() => localStorage.getItem('na_pos_settings_pending_v1'));

test('(k) GET failed, owner changed IGV and reloaded: with GET OK, exactly 1 POST pos.flags and IGV keeps the owner value', async ({ page }) => {
  const mock = newMock();
  const { ownerFlags } = await changeIgvOfflineThenReload(page, mock);
  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0]).toMatchObject({ key: 'pos.flags', expected_revision: 3, value: ownerFlags });
  await expect.poll(() => pendingKey(page)).toBeNull();
  expect((await localSettings(page))['pos.flags']).toEqual(ownerFlags);
  await navigate(page);
  await page.evaluate(() => (window as any).NA_CONFIG_G.pullSettings());
  expect(mock.posts).toHaveLength(1);
  expect((await localSettings(page))['pos.flags']).toEqual(ownerFlags);
});

test('(l) GET failed, owner changed IGV and reloaded, but the server changed pos.flags: 0 POST, server wins, exact notice, pending cleared', async ({ page }) => {
  const mock = newMock();
  let serverFlags: Record<string, unknown> = {};
  await changeIgvOfflineThenReload(page, mock, local => {
    const flags = local['pos.flags'] as Record<string, unknown>;
    serverFlags = { ...flags, margenActive: !flags.margenActive };
    return asServer(local).map(item => item.key === 'pos.flags' ? { ...item, value: serverFlags, revision: 6 } : item);
  });
  await expect.poll(() => pendingKey(page)).toBeNull();
  await expect(page.locator('#gToast')).toHaveText(CONFLICT);
  expect(await page.locator('#gToast').textContent()).toBe(CONFLICT);
  expect(mock.posts).toEqual([]);
  expect((await localSettings(page))['pos.flags']).toEqual(serverFlags);
  await navigate(page);
  expect(mock.posts).toEqual([]);
});
