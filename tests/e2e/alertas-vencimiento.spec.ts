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
    // Solo elementos que se ven: se descartan los de modales cerrados (opacity 0) u ocultos.
    const seen = (el: Element | null): boolean => { for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false; } return true; };
    return [...document.querySelectorAll<HTMLElement>('body *')].filter(el => el !== a && !a.contains(el) && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed'))
      .filter(el => el !== a && !a.contains(el) && ['fixed', 'sticky'].includes(getComputedStyle(el).position) && seen(el))
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

// Bloqueante de la revisión: el aviso no tapa Inicio y queda debajo del menú lateral y de los modales.
const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
async function noticeHits(page: Page) {
  // elementFromPoint en el centro y cerca de las esquinas del aviso: true si el aviso es lo que se ve encima.
  return page.locator('#naRpvAlert').evaluate(a => {
    const r = a.getBoundingClientRect();
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 6, r.top + 6], [r.right - 6, r.top + 6], [r.left + 6, r.bottom - 6], [r.right - 6, r.bottom - 6]];
    return pts.map(([x, y]) => { const el = document.elementFromPoint(x, y); return !!(el && el.closest('#naRpvAlert')); });
  });
}
for (const [width, height] of [[390, 844], [768, 900], [1280, 900]]) {
  test(`a ${width}px el aviso no tapa Inicio y queda debajo del menú lateral y de los modales`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await rolePage(page, 'owner', false);
    const alert = page.locator('#naRpvAlert');
    await expect(alert).toBeVisible();
    await expect(page.locator('#pageMenu')).toHaveClass(/\bactive\b/);
    const box = (await alert.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    // No se cruza con las tarjetas de Inicio («Ventas hoy», «En caja», …) ni con el resto del contenido visible.
    const cards = page.locator('#pageMenu .qs-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    const content = page.locator('#pageMenu :is(.qs-card, .menu-side-link, .menu-desktop-heading, .menu-desktop-sections > *, #naMobileWelcome, #naMobileActivity)');
    const overlapped: string[] = [];
    for (let i = 0; i < await content.count(); i++) {
      const el = content.nth(i), b = await el.boundingBox();
      if (b && b.width > 0 && b.height > 0 && intersects(box, b)) overlapped.push(await el.evaluate(n => (n.id || n.className) + ': ' + (n.textContent || '').trim().slice(0, 30)));
    }
    expect(overlapped).toEqual([]);
    expect(await noticeHits(page)).toEqual([true, true, true, true, true]);

    // Con un modal abierto, el modal queda encima del aviso.
    await page.evaluate(() => (window as any).abrirModalGasto());
    await expect(page.locator('#mGasto')).toHaveClass(/\bopen\b/);
    await page.waitForTimeout(300);
    expect(await noticeHits(page)).toEqual([false, false, false, false, false]);
    await page.evaluate(() => document.getElementById('mGasto')!.classList.remove('open'));
    await page.waitForTimeout(300);
    expect(await noticeHits(page)).toEqual([true, true, true, true, true]);

    if (width < 768) {
      // Con el menú lateral abierto, el cajón (y su fondo) quedan encima del aviso.
      await page.locator('#naMobileMenuToggle').click();
      await expect(page.locator('#naMobileDrawer')).toHaveClass(/\bis-open\b/);
      await page.waitForTimeout(400);
      expect(await noticeHits(page)).toEqual([false, false, false, false, false]);
    } else {
      // Tablet/PC: la barra lateral está siempre visible; el aviso no tapa ninguno de sus enlaces.
      await expect(page.locator('#pageMenu .menu-side-link').first()).toBeVisible();
      expect(overlapped.filter(o => o.includes('menu-side-link'))).toEqual([]);
    }
    const z = await alert.evaluate(el => Number(getComputedStyle(el).zIndex));
    expect(z).toBeLessThan(200);
    expect(errors).toEqual([]);
  });
}

// Revisión #861: con poca altura (horizontal / ventana baja) el aviso es una fila compacta (≤ 48 px)
// que no tapa las tarjetas de Inicio, «Actividad reciente» ni «Pendientes».
for (const [width, height, dark] of [[844, 390, false], [915, 412, false], [740, 360, false], [1024, 600, false], [1280, 600, false], [1440, 600, false], [844, 390, true]] as const) {
  test(`a ${width}x${height}${dark ? ' (oscuro)' : ''} el aviso es una fila compacta y no tapa Inicio`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await rolePage(page, 'owner', dark);
    const alert = page.locator('#naRpvAlert');
    await expect(alert).toBeVisible();
    await expect(page.locator('#pageMenu')).toHaveClass(/\bactive\b/);
    const box = (await alert.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(48);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    // Una sola fila: texto con «…», «Ver» y «×» a la misma altura; sin flex-basis 100 %.
    const layout = await alert.evaluate(a => {
      const t = a.querySelector('.rpv-alert-text')!, v = a.querySelector('.rpv-alert-view')!, c = a.querySelector('.rpv-alert-close')!;
      const cs = getComputedStyle(t), mid = (el: Element) => { const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
      return { basis: cs.flexBasis, ws: cs.whiteSpace, ellipsis: cs.textOverflow, mids: [mid(t), mid(v), mid(c)],
        labels: [getComputedStyle(v, '::before').content, getComputedStyle(c, '::before').content], z: getComputedStyle(a).zIndex };
    });
    expect(layout.basis).not.toBe('100%');
    expect(layout.ws).toBe('nowrap');
    expect(layout.ellipsis).toBe('ellipsis');
    expect(Math.max(...layout.mids) - Math.min(...layout.mids)).toBeLessThanOrEqual(2);
    expect(layout.labels[0]).toContain('Ver');
    expect(layout.labels[1]).toContain('×');
    expect(layout.z).toBe('150');
    // El texto completo y los nombres accesibles siguen (el «…» es solo visual).
    await expect(alert).toContainText('1 lote vencido');
    await expect(alert).toContainText('2 lotes vencen en 30 días');
    await expect(alert.getByRole('button', { name: 'Ver reporte' })).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Cerrar aviso de vencimientos' })).toBeVisible();
    for (const sel of ['.rpv-alert-text', '[data-rpv-alert-view]', '[data-rpv-alert-close]']) expect(await contrast(alert.locator(sel)), sel).toBeGreaterThanOrEqual(4.5);

    // No se cruza con las 4 tarjetas, «Actividad reciente», «Pendientes», la barra lateral ni el encabezado.
    const cards = page.locator('#pageMenu .qs-card:visible');
    await expect(cards).toHaveCount(4);
    const content = page.locator('#pageMenu :is(.qs-card, .menu-data-panel, #naMobileActivity, .menu-side-link, .menu-desktop-heading h1, #menuDesktopDate, .menu-desktop-live), #naMobileMenuToggle, #topBusinessName, #saveStatus');
    const overlapped: string[] = [];
    for (let i = 0; i < await content.count(); i++) {
      const el = content.nth(i), b = await el.boundingBox();
      if (b && b.width > 0 && b.height > 0 && intersects(box, b)) overlapped.push(await el.evaluate(n => (n.id || n.className) + ': ' + (n.textContent || '').trim().slice(0, 30)));
    }
    expect(overlapped).toEqual([]);
    expect(await noticeHits(page)).toEqual([true, true, true, true, true]);

    // Modal encima del aviso.
    await page.evaluate(() => (window as any).abrirModalGasto());
    await expect(page.locator('#mGasto')).toHaveClass(/\bopen\b/);
    await page.waitForTimeout(300);
    expect(await noticeHits(page)).toEqual([false, false, false, false, false]);
    await page.evaluate(() => document.getElementById('mGasto')!.classList.remove('open'));
    await page.waitForTimeout(300);
    expect(await noticeHits(page)).toEqual([true, true, true, true, true]);
    if (width < 768) {
      await page.locator('#naMobileMenuToggle').click();
      await expect(page.locator('#naMobileDrawer')).toHaveClass(/\bis-open\b/);
      await page.waitForTimeout(400);
      expect(await noticeHits(page)).toEqual([false, false, false, false, false]);
      await page.keyboard.press('Escape');
    }
    await page.screenshot({ path: test.info().outputPath(`aviso-${width}x${height}${dark ? '-oscuro' : ''}.png`) });
    expect(errors).toEqual([]);
  });
}

// El mismo aviso no se rehace con cada evento (na:canonical-updated, temporizador de 1,5 s, clases de Inicio): antes se quitaba y
// volvía a poner varias veces en los primeros segundos y las medidas caían sobre el nodo ya quitado (fallas intermitentes a 740x360).
test('a 740x360 el aviso queda estable (mismo nodo) si los datos no cambian', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 360 });
  const errors = await rolePage(page, 'owner', false);
  const alert = page.locator('#naRpvAlert');
  await expect(alert).toBeVisible();
  const node = await alert.elementHandle();
  await page.evaluate(() => { window.dispatchEvent(new Event('na:canonical-updated')); window.dispatchEvent(new Event('na:canonical-updated')); });
  await page.waitForTimeout(1800);
  expect(await node!.evaluate(n => n.isConnected && document.querySelectorAll('#naRpvAlert').length === 1)).toBe(true);
  // Si los datos cambian, el texto sí se actualiza.
  await page.evaluate(() => { const w = window as any; w.eval('productos = productos.slice(0, 1)'); w.dispatchEvent(new Event('na:canonical-updated')); });
  await expect(alert).toContainText('1 lote vencido');
  await expect(alert).toContainText('1 lote vence en 30 días');
  expect(errors).toEqual([]);
});

test('a 844x390 «Ver» abre el reporte y «×» cierra el aviso', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await rolePage(page, 'owner', false);
  const alert = page.locator('#naRpvAlert');
  await alert.getByRole('button', { name: 'Ver reporte' }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.locator(screenId)).toHaveClass(/\bactive\b/);
  await page.evaluate(() => { sessionStorage.removeItem('na_rpv_alert_closed_v1'); });
  await page.reload();
  await page.waitForFunction(() => !!(window as any).NA_REPORTE_PRODUCTOS_VENCER && (window as any).NA_ROLES?.confirmed);
  await page.evaluate(() => (window as any).goPage('pageMenu'));
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'Cerrar aviso de vencimientos' }).click();
  await expect(alert).toHaveCount(0);
});

// Revisión #861: en tablet/PC (≥ 768 de ancho y ≥ 640 de alto) un texto largo no hace crecer el aviso
// sobre los enlaces de la barra lateral («Gastos», «Configuración»): el texto se recorta a 3 líneas.
for (const [width, height] of [[768, 640], [900, 700], [1280, 720], [1440, 900]]) {
  test(`a ${width}x${height} un texto largo no hace que el aviso tape la barra lateral`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await rolePage(page, 'owner', false);
    const alert = page.locator('#naRpvAlert');
    await expect(alert).toBeVisible();
    const long = '⏳ 128 lotes vencidos · 1.024 lotes vencen en 30 días en Leche entera, Yogur natural, Queso fresco, Mantequilla con sal y Pan de molde integral (21/10/2026, hora de Lima)';
    await alert.locator('.rpv-alert-text').evaluate((p, t) => { p.textContent = t; }, long);
    const box = (await alert.boundingBox())!;
    const links = page.locator('#pageMenu .menu-side-link:visible');
    expect(await links.count()).toBeGreaterThanOrEqual(8);
    const hit: string[] = [];
    for (let i = 0; i < await links.count(); i++) {
      const b = await links.nth(i).boundingBox();
      if (b && intersects(box, b)) hit.push((await links.nth(i).innerText()).trim() + ` (${Math.round(b.y)}–${Math.round(b.y + b.height)})`);
    }
    test.info().annotations.push({ type: 'rect', description: `${width}x${height} aviso ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}` });
    expect(hit, `aviso y=${Math.round(box.y)}–${Math.round(box.y + box.height)}`).toEqual([]);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    // El texto completo sigue en el DOM y los botones conservan sus nombres accesibles.
    await expect(alert.locator('.rpv-alert-text')).toHaveText(long);
    await expect(alert.getByRole('button', { name: 'Ver reporte' })).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Cerrar aviso de vencimientos' })).toBeVisible();
    expect(await noticeHits(page)).toEqual([true, true, true, true, true]);
    expect(errors).toEqual([]);
  });
}
