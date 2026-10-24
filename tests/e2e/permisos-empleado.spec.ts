import { test, expect, Page } from '@playwright/test';

// Permisos por empleado en Configuración › Usuarios y PIN. Servidor simulado (permperm.test), sin datos de clientes.
type Calls = { posts: any[]; approvals: any[] };
async function boot(page: Page, { role = 'owner', allow = {} as Record<string, boolean>, unlock = true, getFails = false, width = 390, dark = false } = {}): Promise<Calls> {
  const calls: Calls = { posts: [], approvals: [] };
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'permperm.test') {
      const ok = (b: any) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.pathname === '/auth/me') return ok({ pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'session:dev-1' });
      if (u.pathname === '/auth/owner-approval') { calls.approvals.push(route.request().postDataJSON()); return ok({ approval_id: 'apr-1' }); }
      if (u.pathname === '/auth/employee-permissions') {
        if (route.request().method() === 'GET') return getFails ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"x"}' }) : ok({ allow });
        const body = route.request().postDataJSON(); calls.posts.push({ body, approval: route.request().headers()['x-owner-approval'] });
        const out: Record<string, boolean> = {}; Object.keys(body.allow).forEach(k => { if (body.allow[k]) out[k] = true; });
        return ok({ status: 'saved', allow: out });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
    }
    return u.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permperm.test', token: 'synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(r => (window as any).NA_ROLES?.role === r && (window as any).NA_ROLES.confirmed && (window as any).NA_THEME && (window as any).NA_MENU_NAVIGATION, role);
  await page.evaluate(dark => { const w = window as any; if (w.NA_THEME.isDark() !== dark) w.NA_THEME.toggle(); }, dark);
  // El candado ya está en false en pos-permissions.js (#924); unlock:false simula volver a cerrarlo (rollback).
  await page.evaluate(unlock => { const w = window as any, p = w.NA_PERMISSIONS, orig = p.featureLocked;
    w.NA_PERMISSIONS = Object.assign({}, p, { featureLocked: (id: string) => id === 'permisos-por-empleado' ? !unlock : orig(id) }); }, unlock);
  return calls;
}
async function openUsuarios(page: Page) {
  await expect(page.locator('[data-top="pers"]').first()).toBeAttached();
  await page.locator('[data-top="pers"]').first().evaluate(n => (n as HTMLElement).click());
  await expect(page.locator('[data-tab="pin"]').first()).toBeAttached();
  await page.locator('[data-tab="pin"]').first().evaluate(n => (n as HTMLElement).click());
}

test('candado cerrado (rollback): el panel no aparece', async ({ page }) => {
  await boot(page, { unlock: false });
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'));
  await openUsuarios(page);
  await expect(page.locator('[data-tab="pin"][aria-selected="true"]')).toBeAttached();
  await expect(page.locator('#naPinNew')).toBeAttached();
  await expect(page.locator('#naEmpPerm')).toHaveCount(0);
});

test('candado real de pos-permissions.js: abierto para el desbloqueo #924', async ({ page }) => {
  await page.goto('/index.html');
  expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('permisos-por-empleado'))).toBe(false);
});

test('empleado: nunca ve el panel', async ({ page }) => {
  await boot(page, { role: 'empleado' });
  expect(await page.evaluate(() => (window as any).NA_EMPLOYEE_PERMS_UI.canShow())).toBe(false);
});

test('dueño: todo arranca apagado; marca, guarda con PIN ligado a operation_id', async ({ page }) => {
  const calls = await boot(page);
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'));
  await openUsuarios(page);
  const panel = page.locator('#naEmpPerm');
  await expect(panel.locator('.cfg-panel-title')).toHaveText('Qué puede hacer o ver el empleado');
  const boxes = panel.locator('input[type=checkbox]');
  await expect(boxes).toHaveCount(10);
  await expect(boxes.first()).toBeEnabled();
  for (let i = 0; i < 10; i++) await expect(boxes.nth(i)).not.toBeChecked();
  await panel.getByText('El empleado puede: dejar ventas en espera').click();
  await panel.locator('#naEmpPermSave').click();
  await page.locator('.na-pin-input').fill('4821');
  await page.locator('.na-pin-ok').click();
  await expect(panel.locator('.na-emp-perm-status')).toHaveText('Permisos guardados.');
  expect(calls.approvals[0].action).toBe('employee.permissions');
  expect(calls.posts[0].approval).toBe('apr-1');
  expect(calls.posts[0].body.operation_id).toBe(calls.approvals[0].operation_id);
  expect(calls.posts[0].body.allow['ventas-espera']).toBe(true);
  expect(calls.posts[0].body.allow['clonar-venta']).toBe(false);
  await expect(panel.locator('input[data-perm="ventas-espera"]')).toBeChecked();
});

test('si no se puede leer: casillas apagadas y deshabilitadas; texto con datos va como texto', async ({ page }) => {
  await boot(page, { getFails: true });
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'));
  await openUsuarios(page);
  const boxes = page.locator('#naEmpPerm input[type=checkbox]');
  await expect(page.locator('#naEmpPerm .na-emp-perm-status')).toContainText('No se pudo leer los permisos');
  for (let i = 0; i < 10; i++) { await expect(boxes.nth(i)).toBeDisabled(); await expect(boxes.nth(i)).not.toBeChecked(); }
  await expect(page.locator('#naEmpPermSave')).toBeDisabled();
});

test('valores raros del servidor: solo marca ids de la lista con true', async ({ page }) => {
  await boot(page, { allow: { 'etiquetas-precios': true, kardex: true, 'clonar-venta': 'true' as any } });
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'));
  await openUsuarios(page);
  await expect(page.locator('input[data-perm="etiquetas-precios"]')).toBeChecked();
  await expect(page.locator('input[data-perm="clonar-venta"]')).not.toBeChecked();
  await expect(page.locator('input[data-perm="kardex"]')).toHaveCount(0);
});

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`pantalla ${width}px ${dark ? 'oscuro' : 'claro'}: sin desbordes y casillas tocables`, async ({ page }) => {
    await boot(page, { width, dark });
    await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'));
    await openUsuarios(page);
    const panel = page.locator('#naEmpPerm');
    await expect(panel.locator('input[type=checkbox]').first()).toBeEnabled();
    await panel.scrollIntoViewIfNeeded();
    const m = await panel.evaluate(n => ({ sw: n.scrollWidth, cw: n.clientWidth, rows: [...n.querySelectorAll('.na-emp-perm-row')].map(r => r.getBoundingClientRect().height),
      color: getComputedStyle(n.querySelector('.na-emp-perm-row span') as Element).color, bg: getComputedStyle(n).backgroundColor, dark: document.body.classList.contains('dark') }));
    expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
    expect(Math.min(...m.rows)).toBeGreaterThanOrEqual(44);
    expect(m.dark).toBe(dark);
    expect(m.color).not.toBe(m.bg);
    await panel.screenshot({ path: `test-results/permisos-empleado-${width}-${dark ? 'dark' : 'light'}.png` });
  });
}

test('rol confirmado tarde: na:role vuelve a montar el panel sin duplicarlo', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'));
  await openUsuarios(page);
  await expect(page.locator('#naEmpPerm')).toHaveCount(1);
  // Simula una pestaña dibujada antes de confirmar: se quita el panel y luego llega la confirmación del servidor.
  await page.evaluate(() => document.getElementById('naEmpPerm')!.remove());
  await expect(page.locator('#naEmpPerm')).toHaveCount(0);
  await page.evaluate(() => (window as any).NA_ROLES.refresh());
  await expect(page.locator('#naEmpPerm')).toHaveCount(1);
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.dispatchEvent(new CustomEvent('na:role', { detail: { role: 'owner' } })); });
  await expect(page.locator('#naEmpPerm')).toHaveCount(1);
  await expect(page.locator('#naEmpPerm input[type=checkbox]')).toHaveCount(10);
});

test('dueño en modo local (sin nube): ve el panel; sin sesión no carga y queda todo apagado', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/index.html');
  await page.waitForFunction(() => (window as any).NA_ROLES && (window as any).NA_MENU_NAVIGATION);
  expect(await page.evaluate(() => (window as any).NA_ROLES.isOwner())).toBe(true);
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'));
  await openUsuarios(page);
  await expect(page.locator('#naEmpPerm')).toHaveCount(1);
  await expect(page.locator('#naEmpPerm .na-emp-perm-status')).toContainText('No se pudo leer los permisos');
  await expect(page.locator('#naEmpPermSave')).toBeDisabled();
});
