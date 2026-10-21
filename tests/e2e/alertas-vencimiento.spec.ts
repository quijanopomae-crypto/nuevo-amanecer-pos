import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Misión 4: alertas de vencimiento (filtro por lote, resumen por tramos, CSV y aviso del dueño).
// Datos sintéticos; sin clientes reales.
test.use({ serviceWorkers: 'block' });
const screenId = '#pageReporteProductosVencer';

async function rolePage(page: Page, role: 'owner' | 'empleado', dark: boolean) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'alertas-m4' } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'alertas-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed && !!(window as any).NA_REPORTE_PRODUCTOS_VENCER, role);
  await page.evaluate(dark => {
    const w = window as any;
    document.body.classList.toggle('dark', dark);
    const today = w.NA_REPORTE_PRODUCTOS_VENCER.horizonRange(30).today;
    const day = (offset: number) => new Date(Date.parse(today) + offset * 86400000).toISOString().slice(0, 10);
    const lot = (code: string, offset: number, quantity = 5) => ({ lot_id: code, lot_code: code, expiry_date: day(offset), quantity });
    w.NuevoAmanecerCanonical = { ...(w.NuevoAmanecerCanonical || {}), enabled: () => false };
    w.eval('productos = ' + JSON.stringify([
      { id: 'm4-a', name: 'Leche prueba', stock: 20, lots: [lot('L-VENC', -3), lot('L-A30', 10), lot('L-A60', 45)] },
      { id: 'm4-b', name: 'Yogur prueba <b>x</b>', stock: 9, lots: [lot('L-B90', 80, 2), lot('LOTE-ÑU', 20, 4), lot('L-LEJOS', 120)] }
    ]));
    w.dispatchEvent(new Event('na:canonical-updated'));
  }, dark);
  return errors;
}

async function contrast(el: any) {
  return el.evaluate((node: Element) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fg = parse(getComputedStyle(node).color);
    let n: Element | null = node, bg = [255, 255, 255];
    while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) { bg = c; break; } n = n.parentElement; }
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

for (const dark of [false, true]) for (const width of [390, 768, 1280]) {
  test(`alertas de vencimiento a ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const errors = await rolePage(page, 'owner', dark);

    // Aviso del dueño: tarjeta flotante con vencidos y por vencer en 30 días, fecha de Lima.
    const alert = page.locator('#naRpvAlert');
    await expect(alert).toBeVisible();
    const lima = await page.evaluate(() => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()));
    await expect(alert).toContainText('1 lote vencido');
    await expect(alert).toContainText('2 lotes vencen en 30 días');
    await expect(alert).toContainText(lima + ', hora de Lima');
    for (const sel of ['.rpv-alert-text', '[data-rpv-alert-view]', '[data-rpv-alert-close]']) expect(await contrast(alert.locator(sel)), sel).toBeGreaterThanOrEqual(4.5);
    const box = await alert.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    // No cambia el diseño de Inicio: el aviso vive fuera de las páginas.
    expect(await alert.evaluate(el => el.parentElement === document.body && !el.closest('.page'))).toBe(true);

    await alert.locator('[data-rpv-alert-view]').click();
    await expect(alert).toHaveCount(0);
    const screen = page.locator(screenId), rows = screen.locator('tbody tr');
    await expect(screen).toHaveClass(/\bactive\b/);

    // 30/60/90 + vencidos con resumen por tramos.
    await expect(rows).toHaveCount(3);
    const summary = screen.locator('[data-rpv-summary]');
    await expect(summary).toHaveText('Vencidos: 1 · Hasta 30 días: 2 · 31 a 60 días: 0 · 61 a 90 días: 0');
    await screen.locator('[data-rpv-horizon]').selectOption('90');
    await expect(rows).toHaveCount(5);
    await expect(summary).toHaveText('Vencidos: 1 · Hasta 30 días: 2 · 31 a 60 días: 1 · 61 a 90 días: 1');
    await expect(screen.locator('b')).toHaveCount(0);

    // Filtro por lote (sin distinguir mayúsculas ni tildes).
    const lotInput = screen.locator('[data-rpv-lot]');
    await lotInput.fill('lote-nu');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('LOTE-ÑU');
    await expect(screen.locator('[data-rpv-status]')).toContainText('lote contiene «lote-nu»');
    await lotInput.fill('zzz');
    await expect(rows).toHaveCount(0);
    await expect(screen.locator('.rpv-empty')).toContainText('Ningún lote coincide');
    await lotInput.fill('L-A');

    for (const sel of ['[data-rpv-lot]', '[data-rpv-horizon]', '[data-rpv-summary]', '[data-rpv-export]']) expect(await contrast(screen.locator(sel)), sel).toBeGreaterThanOrEqual(4.5);
    expect(await screen.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`alertas-${width}-${dark ? 'oscuro' : 'claro'}.png`) });

    // CSV con el filtro de lote activo.
    const download = page.waitForEvent('download');
    await screen.locator('[data-rpv-export]').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^productos-por-vencer-\d{4}-\d{2}-\d{2}-90-dias-lote\.csv$/);
    const csv = await readFile((await file.path())!, 'utf8');
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toContain('lote contiene «L-A»');
    expect(lines.slice(2).map(l => l.split(',')[1])).toEqual(['L-A30', 'L-A60']);

    // Cerrado por el dueño: no vuelve a salir el mismo día.
    await page.evaluate(() => (window as any).NA_REPORTE_PRODUCTOS_VENCER.showAlert());
    await expect(alert).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('el empleado no ve el aviso ni datos de lotes', async ({ page }) => {
  await rolePage(page, 'empleado', false);
  expect(await page.evaluate(() => (window as any).NA_REPORTE_PRODUCTOS_VENCER.showAlert())).toBe(false);
  await expect(page.locator('#naRpvAlert')).toHaveCount(0);
});

test('Cerrar oculta el aviso; si NA_ROLES falla, el aviso se oculta', async ({ page }) => {
  await rolePage(page, 'owner', false);
  const alert = page.locator('#naRpvAlert');
  await expect(alert).toBeVisible();
  await page.evaluate(() => { (window as any).NA_ROLES.isOwner = () => { throw new Error('rol roto'); }; (window as any).NA_REPORTE_PRODUCTOS_VENCER.showAlert(); });
  await expect(alert).toHaveCount(0);
});

test('a 390px el aviso no aparece en Venta ni tapa la barra inferior; cerrado no vuelve en la sesión', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await rolePage(page, 'owner', false);
  const alert = page.locator('#naRpvAlert');
  await expect(alert).toBeVisible();
  // No se superpone con elementos fijos de la parte inferior (barra inferior / botones).
  const overlap = await alert.evaluate(a => {
    const r = a.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('body *')].filter(el => el !== a && !a.contains(el) && el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .filter(el => el !== a && !a.contains(el) && ['fixed', 'sticky'].includes(getComputedStyle(el).position))
      .filter(el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.top > window.innerHeight / 2 && !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom); })
      .map(el => el.id || el.className);
  });
  expect(overlap).toEqual([]);
  // En Venta (pagePOS) el aviso se quita y no tapa el botón de cobrar.
  await page.evaluate(() => (window as any).goPage('pagePOS'));
  await expect(page.locator('#pagePOS')).toHaveClass(/\bactive\b/);
  await expect(alert).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).NA_REPORTE_PRODUCTOS_VENCER.showAlert())).toBe(false);
  await expect(alert).toHaveCount(0);
  // En otros módulos tampoco aparece (no tapa sus botones, p. ej. «Actualizar» de Valorización).
  await page.evaluate(() => (window as any).goPage('pageValorizacion'));
  await expect(alert).toHaveCount(0);
  // Al volver a Inicio vuelve a mostrarse.
  await page.evaluate(() => (window as any).goPage('pageMenu'));
  await expect(alert).toBeVisible();
  // Cerrar: no vuelve en la misma sesión, ni tras recargar.
  await alert.locator('[data-rpv-alert-close]').click();
  await expect(alert).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('na:canonical-updated')));
  await page.reload();
  await page.waitForFunction(() => !!(window as any).NA_REPORTE_PRODUCTOS_VENCER && (window as any).NA_ROLES?.confirmed);
  await page.waitForTimeout(1800);
  expect(await page.evaluate(() => (window as any).NA_REPORTE_PRODUCTOS_VENCER.showAlert())).toBe(false);
  await expect(alert).toHaveCount(0);
});
