import { test, expect, type Page } from '@playwright/test';

// Datos sintéticos, sin red externa. El candado ya está abierto en producción; unlock:false lo vuelve a cerrar SOLO en el navegador de la prueba (rollback).
async function boot(page: Page, unlock: boolean) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (!unlock && url.pathname.endsWith('/js/config/pos-permissions.js')) {
      const res = await route.fetch(); const body = (await res.text()).replace("'compartir-pdf-whatsapp': false", "'compartir-pdf-whatsapp': true");
      return route.fulfill({ response: res, body });
    }
    return route.continue();
  });
  await page.goto('/index.html');
  await page.waitForFunction(() => // @ts-ignore
    _naFreeSaleShortcutState.ready && !!(window as any).NA_PDF_WHATSAPP);
}
async function openReceipt(page: Page, tel = '987654321') {
  await page.evaluate(tel => (window as any).NAReceiptShare.onSale({ id: 'V-PDF', fecha: '2026-10-10', hora: '10:00', metodo: 'efectivo', recibido: 20, vuelto: 6, items: [{ name: 'Arroz Costeño', qty: 2, precio: 1234.5, costo: 999 }] }, { nombre: 'María Pérez', tel }), tel);
  await expect(page.locator('#naReceiptSend')).toBeEnabled();
}
const ledger = (page: Page) => page.evaluate(() => JSON.stringify({ ventas, creditos, clientes, productos }));

test('con el candado cerrado (rollback) la opción PDF por WhatsApp no aparece', async ({ page }) => {
  await boot(page, false); await openReceipt(page);
  expect(await page.evaluate(() => (window as any).NA_PERMISSIONS.featureLocked('compartir-pdf-whatsapp'))).toBe(true);
  await expect(page.locator('#naPdfWa')).toHaveCount(0);
});

for (const width of [390, 768, 1280]) for (const theme of ['light', 'dark'] as const) {
  test(`PDF por WhatsApp con menú de compartir ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await boot(page, true);
    if (theme === 'dark') await page.evaluate(() => document.body.classList.add('dark'));
    const before = await ledger(page);
    await page.evaluate(() => { const w = window as any; w.__shares = []; w.__opened = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d: any) => !!d.files?.length });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: any) => { const f = d.files[0]; w.__shares.push({ name: f.name, type: f.type, text: d.text, head: String.fromCharCode(...new Uint8Array(await f.arrayBuffer()).slice(0, 8)) }); } });
      w.open = (u: string) => { w.__opened.push(u); return {}; }; });
    await openReceipt(page);
    const btn = page.locator('#naPdfWaSend');
    await expect(btn).toBeVisible(); await expect(btn).toHaveText('📄 Enviar PDF por WhatsApp');
    await expect(page.locator('#naPdfWa')).toContainText('WhatsApp Business');
    const box = await page.locator('#naReceiptShare .modal').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await expect(page.locator('#naReceiptText')).toContainText('1,234.50');
    await btn.click();
    await page.waitForFunction(() => (window as any).__shares.length === 1);
    const s = await page.evaluate(() => (window as any).__shares[0]);
    expect(s.type).toBe('application/pdf'); expect(s.head).toBe('%PDF-1.4'); expect(s.name).toMatch(/\.pdf$/);
    expect(s.text).toBe('Hola María Pérez, te envío tu comprobante en PDF.');
    expect(await page.evaluate(() => (window as any).__opened.length)).toBe(0);
    await expect(page.locator('#naReceiptText')).not.toContainText('999');
    expect(await ledger(page)).toBe(before);
  });
}

test('respaldo sin menú de compartir: descarga el PDF y abre wa.me con texto corto', async ({ page }) => {
  await boot(page, true);
  await page.evaluate(() => { const w = window as any; w.__opened = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
    w.open = (u: string) => { w.__opened.push(u); return {}; }; });
  await openReceipt(page);
  const dl = page.waitForEvent('download');
  await page.locator('#naPdfWaSend').click();
  expect((await dl).suggestedFilename()).toBe('comprobante-V-PDF.pdf');
  const url = new URL(await page.evaluate(() => (window as any).__opened[0]));
  expect(url.hostname).toBe('wa.me'); expect(url.pathname).toBe('/51987654321');
  expect(url.searchParams.get('text')).toBe('Hola María Pérez, te envío tu comprobante en PDF.');
  await expect(page.locator('#naPdfWaStatus')).toContainText('adjunta');
});

test('cancelar el menú de compartir no descarga ni abre nada', async ({ page }) => {
  await boot(page, true);
  await page.evaluate(() => { const w = window as any; w.__opened = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('x', 'AbortError'); } });
    w.open = (u: string) => { w.__opened.push(u); return {}; }; });
  await openReceipt(page);
  await page.locator('#naPdfWaSend').click();
  await expect(page.locator('#naPdfWaStatus')).toContainText('cancelado');
  expect(await page.evaluate(() => (window as any).__opened.length)).toBe(0);
});
