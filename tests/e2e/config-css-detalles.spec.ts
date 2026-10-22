import { test, expect, type Page } from '@playwright/test';
import { contrastOf, rect, overlaps, noHorizontalOverflow } from './helpers/css-contrast';
import { expectAllFit } from './helpers/fits';

// Pulido CSS/texto de Configuración: panel WhatsApp (Ticket y comprobantes), «Preguntar» deshabilitado,
// avisos de guardado (#na9Saved y #gToast) y «Reseteo» en el menú interno. Solo se mide: nunca se abre Reseteo.
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
test.use({ userAgent: ANDROID_UA, serviceWorkers: 'block' });

const WIDTHS = [390, 768, 1366] as const;
const HEIGHT: Record<number, number> = { 390: 844, 768: 1024, 1366: 768 };
const CONFLICT_BADGE = 'No se guardó: otro equipo cambió la configuración';
type Server = { posts: any[]; conflict: boolean };

async function cloudPage(page: Page, role: 'owner' | 'empleado', server: Server) {
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.hostname === 'permissions.test') {
      if (url.pathname === '/auth/me') return json(200, { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'css-detalles-device' });
      if (url.pathname === '/settings' && req.method() === 'GET') return json(200, { settings: [] });
      if (url.pathname === '/settings' && req.method() === 'POST') {
        server.posts.push(req.postDataJSON());
        if (role !== 'owner') return json(403, { error: 'owner_only' });
        if (server.conflict) return json(409, { error: 'revision_conflict', revision: 9 });
        return json(200, { revision: server.posts.length });
      }
      return json(200, {});
    }
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'css-detalles-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.confirmed && (window as any).NA_MENU_NAVIGATION && (window as any).NAReceiptUI && (window as any).NA_CONFIG_G);
  await page.evaluate(async () => { const w = window as any; w.NuevoAmanecerCanonical = { ...w.NuevoAmanecerCanonical, enabled: () => true }; await w.NA_CONFIG_G.pullSettings(); });
}

async function settle(server: Server, page: Page) {
  let n = -1;
  for (let i = 0; i < 20 && n !== server.posts.length; i++) { n = server.posts.length; await page.waitForTimeout(700); }
}

async function setTheme(page: Page, dark: boolean) {
  await page.evaluate(d => (window as any).NA_THEME.setMode(d ? 'noche' : 'claro'), dark);
}

async function openConfig(page: Page) {
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'));
  await expect(page.locator('#naCfgV9')).toBeVisible();
}

async function openTicket(page: Page) {
  await openConfig(page);
  await page.locator('#na9Nav [data-top="neg"]').click();
  await page.locator('#naCfgV9 [data-tab="ticket"]').click();
  await expect(page.locator('#naCfgV9 .na9-wa #naReceiptSettings')).toBeVisible();
}

for (const width of WIDTHS) for (const dark of [false, true]) {
  const name = `${width}px ${dark ? 'Nocturno' : 'claro'}`;

  test(`panel WhatsApp: «Automático» entero y selects alineados ${name}`, async ({ page }) => {
    const server: Server = { posts: [], conflict: false };
    await page.setViewportSize({ width, height: HEIGHT[width] });
    await cloudPage(page, 'owner', server);
    await setTheme(page, dark);
    await openTicket(page);
    const app = page.locator('#cfgReceiptApp'), format = page.locator('#cfgReceiptFormat');
    await app.selectOption('auto');
    await page.locator('#naCfgV9 .na9-wa').screenshot({ path: test.info().outputPath(`wa-${width}-${dark ? 'noche' : 'claro'}.png`) });
    // 1) La opción se llama «Automático» y cabe completa en el select (texto medido con la fuente del select).
    expect(await app.locator('option[value="auto"]').textContent()).toBe('Automático');
    const fit = await app.evaluate((s: HTMLSelectElement) => {
      const cs = getComputedStyle(s), ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = s.options[s.selectedIndex].text, arrow = cs.appearance === 'none' ? 0 : 20;
      return { text: ctx.measureText(text).width, room: s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - arrow };
    });
    expect(fit.text, JSON.stringify(fit)).toBeLessThanOrEqual(fit.room);
    // Panel sin desbordes: ni el documento ni sus filas, selects y textos salen del ancho (helpers/fits.ts, #830).
    await expectAllFit(page.locator('#naCfgV9 .na9-wa .cfg-panel'), '.cfg-setting, select, label, .cfg-panel-title');
    // 2) Formato y «Abrir con» terminan en el mismo borde derecho (y cada select dentro de su fila).
    const f = await rect(page, '#cfgReceiptFormat'), a = await rect(page, '#cfgReceiptApp');
    expect(Math.abs(f.right - a.right), JSON.stringify({ f, a })).toBeLessThanOrEqual(1);
    for (const sel of ['#cfgReceiptFormat', '#cfgReceiptApp']) {
      const inRow = await page.locator(sel).evaluate(n => { const r = n.getBoundingClientRect(), row = n.closest('.cfg-setting')!.getBoundingClientRect(); return r.left >= row.left && r.right <= row.right; });
      expect(inRow, sel).toBe(true);
    }
    if (width > 700) {
      const rowRight = await app.evaluate(n => { const row = n.closest('.cfg-setting')!, cs = getComputedStyle(row); return row.getBoundingClientRect().right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth); });
      expect(Math.abs(a.right - rowRight)).toBeLessThanOrEqual(1);
    } else {
      expect(Math.abs(f.left - a.left)).toBeLessThanOrEqual(1);
    }
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test(`avisos de guardado: conflicto legible y sin taparse ${name}`, async ({ page }) => {
    const server: Server = { posts: [], conflict: false };
    await page.setViewportSize({ width, height: HEIGHT[width] });
    await cloudPage(page, 'owner', server);
    await setTheme(page, dark);
    await openTicket(page);
    await settle(server, page);
    // Guardado normal: el aviso de estado tiene contraste ≥ 4.5:1.
    const sw = page.locator('#naCfgV9 .na9-bd[data-sec="ticket"] label.na9-sw:has(input[data-na9^="tk."])').first();
    await sw.click();
    await expect(page.locator('#na9Saved')).toHaveText('Guardando…');
    const wait = await contrastOf(page, '#na9Saved');
    expect(wait.ratio, JSON.stringify(wait)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator('#na9Saved')).toHaveText('Guardado ✓');
    const ok = await contrastOf(page, '#na9Saved');
    expect(ok.ratio, JSON.stringify(ok)).toBeGreaterThanOrEqual(4.5);
    // Conflicto (409 revision_conflict): toast rojo + aviso de estado, los dos legibles y sin taparse.
    await expect(page.locator('#na9Saved')).not.toHaveClass(/show/, { timeout: 5000 });
    server.conflict = true;
    await sw.click();
    await expect(page.locator('#na9Saved')).toHaveText(CONFLICT_BADGE);
    await expect(page.locator('#na9Saved')).toHaveClass(/err/);
    await expect(page.locator('#gToast')).toHaveClass(/show/);
    await expect(page.locator('#gToast')).toHaveClass(/error/);
    await page.waitForTimeout(400); // transición del toast (.3s)
    await page.screenshot({ path: test.info().outputPath(`avisos-${width}-${dark ? 'noche' : 'claro'}.png`) });
    const toast = await contrastOf(page, '#gToast'), err = await contrastOf(page, '#na9Saved');
    expect(toast.ratio, JSON.stringify(toast)).toBeGreaterThanOrEqual(4.5);
    expect(err.ratio, JSON.stringify(err)).toBeGreaterThanOrEqual(4.5);
    const t = await rect(page, '#gToast'), b = await rect(page, '#na9Saved');
    expect(overlaps(t, b), JSON.stringify({ toast: t, badge: b })).toBe(false);
    for (const r of [t, b]) { expect(r.left).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(width); expect(r.bottom).toBeLessThanOrEqual(HEIGHT[width]); }
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test(`menú interno: «Reseteo» se alcanza sin abrirlo ${name}`, async ({ page }) => {
    const server: Server = { posts: [], conflict: false };
    await page.setViewportSize({ width, height: HEIGHT[width] });
    await cloudPage(page, 'owner', server);
    await setTheme(page, dark);
    const reset = page.locator('#na9Nav [data-top="reset"]');
    if (width > 700) {
      // Con una sección larga abierta (Ticket y comprobantes) el menú se estira: «Reseteo» debe verse sin desplazar.
      await openTicket(page);
      await page.screenshot({ path: test.info().outputPath(`menu-${width}-${dark ? 'noche' : 'claro'}.png`) });
      const before = await page.evaluate(() => [...document.querySelectorAll('#na9Nav [data-top]:not([data-top="reset"])')].map(n => Math.round(n.getBoundingClientRect().top)));
      expect(await page.evaluate(() => scrollY)).toBe(0);
      const r = await rect(page, '#na9Nav [data-top="reset"]');
      expect(r.top, JSON.stringify(r)).toBeGreaterThanOrEqual(0);
      expect(r.bottom, JSON.stringify(r)).toBeLessThanOrEqual(HEIGHT[width]);
      // Los demás ítems siguen uno tras otro desde arriba, y «Reseteo» va después del último.
      expect(before.every((t, i) => i === 0 || t > before[i - 1])).toBe(true);
      expect(r.top).toBeGreaterThan(before[before.length - 1]);
    } else {
      // Teléfono: el menú es la lista inicial; se llega a «Reseteo» desplazando con la rueda/dedo.
      await openConfig(page);
      for (let i = 0; i < 12; i++) {
        const r = await rect(page, '#na9Nav [data-top="reset"]');
        if (r.top >= 0 && r.bottom <= HEIGHT[width]) break;
        await page.mouse.move(width / 2, HEIGHT[width] / 2);
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(150);
      }
      await page.screenshot({ path: test.info().outputPath(`menu-${width}-${dark ? 'noche' : 'claro'}.png`) });
      const r = await rect(page, '#na9Nav [data-top="reset"]');
      expect(r.top, JSON.stringify(r)).toBeGreaterThanOrEqual(0);
      expect(r.bottom, JSON.stringify(r)).toBeLessThanOrEqual(HEIGHT[width]);
    }
    await expect(reset).toBeVisible();
    // Es lo que hay en su centro (no queda tapado ni recortado). No se hace clic: Reseteo nunca se abre.
    const hit = await reset.evaluate(n => { const r = n.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && n.contains(e); });
    expect(hit).toBe(true);
    await expect(reset).not.toHaveClass(/\bon\b/);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
}

for (const dark of [false, true]) test(`cajero: «Preguntar» deshabilitado se ve (contraste ≥ 3:1) ${dark ? 'Nocturno' : 'claro'}`, async ({ page }) => {
  const server: Server = { posts: [], conflict: false };
  await page.setViewportSize({ width: 390, height: 844 });
  await cloudPage(page, 'empleado', server);
  await setTheme(page, dark);
  // El cajero no abre Configuración v9: se monta el panel tal como lo arma NAReceiptUI (solo lectura).
  await page.evaluate(() => { const h = document.createElement('div'); h.id = 'cfgHost'; h.innerHTML = (window as any).NAReceiptUI.settingsHtml(); document.body.prepend(h); });
  const ask = page.locator('#cfgHost #cfgReceiptAsk');
  await expect(ask).toBeDisabled();
  await expect(page.locator('#cfgHost #naReceiptSettings')).toHaveClass(/is-readonly/);
  await page.locator('#cfgHost .cfg-setting:has(#cfgReceiptAsk)').screenshot({ path: test.info().outputPath(`preguntar-${dark ? 'noche' : 'claro'}.png`) });
  for (const checked of [false, true]) {
    await ask.evaluate((n: HTMLInputElement, c) => { n.checked = c; }, checked);
    const style = await ask.evaluate(n => { let o = 1; for (let e: Element | null = n; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return { appearance: getComputedStyle(n).appearance, opacity: o, w: n.getBoundingClientRect().width }; });
    // appearance:none: lo que se pinta es el borde/fondo calculado, así que el contraste medido es el real.
    expect(style.appearance).toBe('none');
    expect(style.opacity).toBe(1);
    expect(style.w).toBeGreaterThanOrEqual(20);
    const prop = checked ? 'backgroundColor' : 'borderTopColor';
    const c = await contrastOf(page, '#cfgHost #cfgReceiptAsk', prop, 'parent');
    expect(c.ratio, `${checked ? 'marcado' : 'sin marcar'} ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(3);
  }
});

test('Venta e Inicio no reciben los ajustes de Configuración (toast igual que antes)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.goto('/index.html');
  await page.waitForFunction(() => (window as any).NA_MENU_NAVIGATION);
  for (const id of ['pagePOS', 'pageMenu']) {
    await page.evaluate(id => (window as any).NA_MENU_NAVIGATION.navigate(id), id);
    const s = await page.evaluate(() => { const t = document.getElementById('gToast')!; t.className = 'toast error'; const cs = getComputedStyle(t); const out = { bottom: cs.bottom, bg: cs.backgroundColor }; t.className = 'toast'; return out; });
    expect(s, id).toEqual({ bottom: '22px', bg: 'rgb(239, 68, 68)' });
  }
});
