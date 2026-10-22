import { test, expect, type Page } from '@playwright/test';

// HTML y scripts reales. Rol y datos sintéticos, solo en el navegador de la prueba; sin red externa.
async function rolePage(page: Page, role: 'owner' | 'empleado' | '', unlock = true) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role || null, owner_pin_set: true, roles_ready: true, device_id: 'pe-test-device' } : {}
    ) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.addInitScript(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic' }));
    if (role) localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_PUNTO_EQUILIBRIO && !!(window as any).NA_ROLES);
  if (role) await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
  else await page.evaluate(() => {
    const w = window as any, roles = w.NA_ROLES;
    w.NA_ROLES = new Proxy(roles, { get: (t, k) => k === 'role' ? '' : k === 'isOwner' ? () => false : t[k] });
  });
  // El candado real 'punto-equilibrio' sigue en true: solo en el navegador de la prueba se abre.
  if (unlock) await page.evaluate(() => {
    const p = (window as any).NA_PERMISSIONS, real = p.featureLocked;
    (window as any).NA_PERMISSIONS = Object.freeze({ ...p, featureLocked: (id: string) => id === 'punto-equilibrio' ? false : real(id) });
  });
  await page.evaluate(() => {
    const month = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 7);
    // @ts-ignore POS runtime globals (let léxicos)
    productos = [{ id: 'pe-1', name: 'Producto sintético A', cat: 'abarrotes', stock: 10, costo: 6, precio: 10 }];
    // @ts-ignore
    ventas = [
      { id: 'v1', fecha: month + '-01', items: [{ id: 'pe-1', name: 'Producto sintético A', qty: 1000, precio: 10, costo: 6 }] },
      { id: 'v2', fecha: month + '-01', anulada: true, items: [{ id: 'pe-1', qty: 999, precio: 10, costo: 6 }] }
    ];
    // @ts-ignore
    gastos = [
      { id: 'g1', fecha: month + '-01', monto: 1200, cat: 'Servicios', desc: 'Alquiler sintético' },
      { id: 'g2', fecha: month + '-01', monto: 800, cat: 'Proveedor', desc: 'Compra sintética' }
    ];
  });
}
// La grilla de productos de Venta (#posArea) se vuelve a dibujar con los datos sintéticos al navegar, y el paisaje de Inicio pausa su animación (data-motion) al ocultarse: es contenido o estado, no diseño.
const snapshot = (page: Page) => page.evaluate(() => JSON.stringify({
  // @ts-ignore POS runtime globals
  ventas, gastos, productos,
  layouts: ['pagePOS', 'pageMenu', 'naMobileDrawer'].map(id => (document.getElementById(id)?.innerHTML || '').replace(/ data-scanner-ready="true"| style=""| data-motion="[a-z]*"/g, '').replace(/(<main[^>]*id="posArea"[^>]*>)[\s\S]*?(<\/main>)/, '$1$2'))
}));

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño ve el punto de equilibrio en ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner');
    await page.evaluate(dark => (window as any).NA_THEME.setMode(dark ? 'noche' : 'claro'), dark);
    const before = await snapshot(page);
    // La tarjeta sigue bloqueada en pos-permissions.js hasta el desbloqueo final: se abre la pantalla directamente.
    await page.evaluate(() => (window as any).goPage('pagePuntoEquilibrio'));
    const screen = page.locator('#pagePuntoEquilibrio');
    await expect(screen).toHaveClass(/\bactive\b/);
    await expect(screen.getByRole('heading', { name: 'Punto de equilibrio', exact: true })).toBeVisible();
    await expect(page.locator('#naNoPermission')).toHaveCount(0);
    const cards = screen.locator('.pe-card strong');
    await expect(cards.nth(0)).toHaveText('S/ 10,000.00');
    await expect(cards.nth(1)).toHaveText('S/ 6,000.00');
    await expect(cards.nth(2)).toHaveText('S/ 1,200.00');
    await expect(cards.nth(3)).toHaveText('40.0%');
    await expect(cards.nth(4)).toHaveText('S/ 3,000.00');
    await expect(screen.locator('[data-pe-result]')).toHaveText('Vas S/ 7,000.00 por encima del punto de equilibrio.');
    await expect(screen.locator('.pe-notices')).toContainText('Pago a proveedor');
    await expect(screen.locator('[data-pe-status]')).toContainText('hora de Lima');
    await expect(screen).toHaveCSS('background-color', dark ? 'rgb(15, 23, 42)' : 'rgb(248, 250, 252)');
    expect(await screen.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('.pe-card, .pe-result, input, button')).every(n => {
        const b = n.getBoundingClientRect(); return b.left >= bounds.left - 1 && b.right <= bounds.right + 1;
      }) && document.documentElement.scrollWidth <= window.innerWidth + 1;
    })).toBe(true);
    // Solo lectura: Actualizar no escribe en el almacenamiento ni cambia los datos.
    const unchanged = await page.evaluate(() => {
      // @ts-ignore
      const data = () => JSON.stringify({ ventas, gastos, productos });
      const before = data(), S = Storage.prototype, o = [S.setItem, S.removeItem, S.clear];
      let writes = 0; const fail = () => { writes++; };
      S.setItem = fail; S.removeItem = fail; S.clear = fail;
      try { (document.querySelector('#pagePuntoEquilibrio [data-pe-refresh]') as HTMLButtonElement).click(); return writes === 0 && before === data(); }
      finally { [S.setItem, S.removeItem, S.clear] = o; }
    });
    expect(unchanged).toBe(true);
    await page.screenshot({ path: `test-results/punto-equilibrio-${width}-${dark ? 'oscuro' : 'claro'}.png` });
    const a = JSON.parse(await snapshot(page)), b = JSON.parse(before);
    expect(JSON.stringify([a.ventas, a.gastos, a.productos])).toBe(JSON.stringify([b.ventas, b.gastos, b.productos]));
    expect(a.layouts[0]).toBe(b.layouts[0]);
    expect(a.layouts[1]).toBe(b.layouts[1]);
  });

  test(`empleado no ve el punto de equilibrio en ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'empleado');
    await page.evaluate(dark => (window as any).NA_THEME.setMode(dark ? 'noche' : 'claro'), dark);
    await page.evaluate(() => (window as any).goPage('pagePuntoEquilibrio'));
    await expect(page.locator('#naNoPermission')).toBeVisible();
    await expect(page.locator('#pagePuntoEquilibrio')).not.toHaveClass(/\bactive\b/);
    await page.evaluate(() => (window as any).NA_PUNTO_EQUILIBRIO.render());
    await expect(page.locator('#pagePuntoEquilibrio [data-pe-report]')).toHaveText('Sin permiso. Pídele acceso al dueño.');
    await expect(page.locator('#pagePuntoEquilibrio .pe-card')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('rol desconocido: falla cerrado', async ({ page }) => {
  await rolePage(page, '');
  await page.evaluate(() => (window as any).NA_PUNTO_EQUILIBRIO.render());
  await expect(page.locator('#pagePuntoEquilibrio [data-pe-report]')).toHaveText('Sin permiso. Pídele acceso al dueño.');
  await expect(page.locator('#pagePuntoEquilibrio [data-pe-controls]')).toBeHidden();
});

test('margen 0 o negativo y sin ventas muestran un mensaje claro', async ({ page }) => {
  await rolePage(page, 'owner');
  await page.evaluate(() => (window as any).goPage('pagePuntoEquilibrio'));
  await page.evaluate(() => {
    // @ts-ignore
    ventas.forEach(v => v.items.forEach(i => { i.costo = 12; }));
    (window as any).NA_PUNTO_EQUILIBRIO.render();
  });
  await expect(page.locator('[data-pe-result]')).toContainText('El margen es 0% o negativo');
  // @ts-ignore
  await page.evaluate(() => { ventas = []; (window as any).NA_PUNTO_EQUILIBRIO.render(); });
  await expect(page.locator('[data-pe-result]')).toHaveText('Sin ventas en el período. No se puede calcular el punto de equilibrio.');
});

test('el módulo usa solo textContent', async ({ page }) => {
  const res = await page.request.get('/js/modules/punto-equilibrio.js');
  expect(await res.text()).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
});

test('con el candado real cerrado, ni el dueño ve el reporte', async ({ page }) => {
  await rolePage(page, 'owner', false);
  expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('punto-equilibrio'))).toBe(true);
  expect(await page.evaluate(() => (window as any).NA_PUNTO_EQUILIBRIO.render())).toBe(false);
  await expect(page.locator('#pagePuntoEquilibrio [data-pe-controls]')).toBeHidden();
  await expect(page.locator('#pagePuntoEquilibrio [data-pe-result]')).toHaveCount(0);
});
