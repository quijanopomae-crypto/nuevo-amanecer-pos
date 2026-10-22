import { test, expect, type Page } from '@playwright/test';

// PNG sintético 8x8 (no es un QR real).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///8AAABVwtN+AAAAEklEQVQI12P4z8DwHwrhDAYGAPl9C/WzSzsrAAAAAElFTkSuQmCC', 'base64');

async function setup(page: Page, role: 'owner' | 'empleado', unlocked: boolean) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'qr-test-device' } : {}) });
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (unlocked && url.pathname.endsWith('/js/config/pos-permissions.js')) {
      const res = await route.fetch(); const body = (await res.text()).replace("'cobro-qr-yape-plin': true", "'cobro-qr-yape-plin': false");
      return route.fulfill({ response: res, body });
    }
    return route.continue();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'qr-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
}
async function openCobro(page: Page) {
  await page.evaluate(() => (window as any).eval(`
    cajEstado={abierta:true,cerrada:false,fechaApertura:obtenerHoy(),fondo:10,sessionId:'qr-synthetic'};
    productos=[{id:'qr-1',name:'Producto QR',sku:'QR-1',stock:5,precio:1234.5,controlInventario:true}];
    cart=[{id:'qr-1',name:'Producto QR',precio:1234.5,qty:1}];
    abrirCobro();`));
  await expect(page.locator('#mCobroTotal')).toBeVisible();
}
const snapshot = (page: Page) => page.evaluate(() => (window as any).eval('JSON.stringify({cart,ventas,cajMovs,posPayM,total:document.getElementById("mCobroTotal").textContent})'));

test('dueño sube QR en Configuración y se muestra al cobrar con Yape, sin alterar el cobro', async ({ page }) => {
  await setup(page, 'owner', true);
  await page.evaluate(() => { sessionStorage.setItem('na_v9_nav', JSON.stringify({ top: 'ventas', tab: { ventas: 'pv' } })); (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'); });
  const card = page.locator('#naQrCfgCard');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-wallet="yape"] .na-qr-cfg-status')).toHaveText('Sin QR');
  await card.locator('[data-qr-input="yape"]').setInputFiles({ name: 'yape.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('#naQrCfgCard [data-wallet="yape"] .na-qr-cfg-status')).toHaveText('QR guardado');
  expect(await page.evaluate(() => (window as any).NA_COBRO_QR.getQr('yape').startsWith('data:image/png;base64,'))).toBe(true);

  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pagePOS'));
  await openCobro(page);
  await expect(page.locator('#naQrShowBtn')).toBeHidden();
  await page.locator('#mCobro .pm-btn[data-method="yape"]').click();
  const btn = page.locator('#naQrShowBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('Mostrar QR de Yape');
  const before = await snapshot(page);
  await btn.click();
  const overlay = page.locator('#naQrOverlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.na-qr-title')).toHaveText('Paga con Yape');
  await expect(page.locator('#naQrAmount')).toHaveText('S/ 1,234.50');
  expect(await page.locator('#naQrAmount').textContent()).toBe(await page.locator('#mCobroTotal').textContent());
  await page.locator('#naQrClose').click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('#mCobroTotal')).toBeVisible();
  expect(await snapshot(page)).toBe(before);

  // Plin sin QR: no hay botón.
  await page.locator('#mDigitalChannels [data-digital-method="plin"]').click();
  await expect(btn).toBeHidden();
  // Transferencia nunca muestra QR.
  await page.locator('#mDigitalChannels [data-digital-method="transferencia"]').click();
  await expect(btn).toBeHidden();
});

test('empleado ve el QR guardado pero no la tarjeta de Configuración', async ({ page }) => {
  await setup(page, 'empleado', true);
  await page.evaluate(() => localStorage.setItem('na_cobro_qr_v1', JSON.stringify({ plin: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///8AAABVwtN+AAAAEklEQVQI12P4z8DwHwrhDAYGAPl9C/WzSzsrAAAAAElFTkSuQmCC' })));
  await expect(page.locator('#naQrCfgCard')).toHaveCount(0);
  await openCobro(page);
  await page.locator('#mCobro .pm-btn[data-method="yape"]').click();
  await page.locator('#mDigitalChannels [data-digital-method="plin"]').click();
  await expect(page.locator('#naQrShowBtn')).toHaveText('Mostrar QR de Plin');
  await page.locator('#naQrShowBtn').click();
  await expect(page.locator('#naQrOverlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#naQrOverlay')).toHaveCount(0);
  // Enter con el QR abierto solo lo cierra: no confirma el cobro.
  await page.locator('#naQrShowBtn').click();
  await expect(page.locator('#naQrOverlay')).toBeVisible();
  const before = await snapshot(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('#naQrOverlay')).toHaveCount(0);
  await expect(page.locator('#mCobro')).toHaveClass(/open/);
  expect(await snapshot(page)).toBe(before);
});

test('con la tarjeta bloqueada no aparece nada', async ({ page }) => {
  await setup(page, 'owner', false);
  await page.evaluate(() => localStorage.setItem('na_cobro_qr_v1', JSON.stringify({ yape: 'data:image/png;base64,QUJD' })));
  await page.reload();
  await page.evaluate(() => { sessionStorage.setItem('na_v9_nav', JSON.stringify({ top: 'ventas', tab: { ventas: 'pv' } })); (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'); });
  await expect(page.locator('#naQrCfgCard')).toHaveCount(0);
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pagePOS'));
  await openCobro(page);
  await page.locator('#mCobro .pm-btn[data-method="yape"]').click();
  await expect(page.locator('#naQrShowBtn')).toHaveCount(0);
});

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`ventana del QR cabe en ${width}px ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await setup(page, 'owner', true);
    await page.evaluate(d => { localStorage.setItem('na_cobro_qr_v1', JSON.stringify({ yape: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///8AAABVwtN+AAAAEklEQVQI12P4z8DwHwrhDAYGAPl9C/WzSzsrAAAAAElFTkSuQmCC' })); document.body.classList.toggle('dark', d); }, dark);
    await openCobro(page);
    await page.locator('#mCobro .pm-btn[data-method="yape"]').click();
    const btn = page.locator('#naQrShowBtn');
    await expect(btn).toBeVisible();
    const b = (await btn.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(width + 1);
    await btn.click();
    const box = (await page.locator('.na-qr-box').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    const colors = await page.locator('.na-qr-box').evaluate(n => { const s = getComputedStyle(n); return [s.backgroundColor, s.color]; });
    expect(colors[0]).not.toBe(colors[1]);
    if (dark) expect(colors[0]).toBe('rgb(30, 41, 59)'); else expect(colors[0]).toBe('rgb(255, 255, 255)');
    await expect(page.locator('#naQrAmount')).toHaveText('S/ 1,234.50');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.locator('#naQrClose').click();
  });
}
