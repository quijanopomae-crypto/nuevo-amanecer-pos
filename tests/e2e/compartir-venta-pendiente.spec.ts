import { test, expect, type Page } from '@playwright/test';
import { canonLocalWorker, routeLocalWorker, type NetEntry } from './helpers/canon-local-worker';

// T-42 (delta): el diálogo «Compartir comprobante» que aparece tras una venta aún pendiente de
// sincronizar lleva la misma marca que el ticket pendiente y no presenta el número provisional como final.
// Al sincronizar (también con renumeración 409 sale_id_conflict) muestra el número final sin marca.
// Worker REAL + SQLite en memoria; todo host externo se aborta. Datos sintéticos.
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

type Ctx = { env: Awaited<ReturnType<typeof canonLocalWorker>>; state: { down: boolean; phase: string; net: NetEntry[]; blocked: string[] } };

async function boot(page: Page, baseURL: string): Promise<Ctx> {
  const env = await canonLocalWorker();
  const state = { down: false, phase: 'boot', net: [] as NetEntry[], blocked: [] as string[] };
  await routeLocalWorker(page, env, new URL(baseURL).origin, state);
  await page.addInitScript(() => {
    const rec = (window as any).__tkp = { prints: [] as string[], opens: [] as string[] };
    window.open = function (url?: any) {
      if (typeof url === 'string' && url) rec.opens.push(url);
      const doc = document.implementation.createHTMLDocument('');
      return { document: doc, closed: false, onafterprint: null, focus() {}, close() { this.closed = true; },
        print() { rec.prints.push(doc.body ? doc.body.textContent || '' : ''); if (typeof this.onafterprint === 'function') this.onafterprint(); } } as any;
    } as any;
  });
  const endpoint = new URL(baseURL).origin + '/__worker';
  await page.addInitScript(([e]) => { if (!localStorage.getItem('na_cloud_sync_credentials')) localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: e, token: 'owner-token' })); }, [endpoint]);
  await page.goto('/index.html');
  const c = env.control();
  await page.evaluate(async ([e, c]: any) => { await (window as any).NuevoAmanecerCanonical.configure({ endpoint: e, promotion_id: c.promotion_id, authority_epoch: c.authority_epoch, revision: c.revision, token: 'owner-token' }); }, [endpoint, c]);
  await page.reload();
  await waitReady(page);
  return { env, state };
}
async function waitReady(page: Page, online = true) {
  // Sin servidor, el rol no se confirma: basta con la réplica local (productos en caché).
  if (online) await page.waitForFunction(() => (window as any).NA_ROLES?.confirmed === true, null, { timeout: 20_000 });
  await page.waitForFunction(() => { try { return (0, eval)('productos').some((p: any) => String(p.id) === 'PX1'); } catch { return false; } }, null, { timeout: 20_000 });
}
const nav = (page: Page, id: string) => page.evaluate(id => (window as any).NA_MENU_NAVIGATION.navigate(id), id);
async function closeModals(page: Page) {
  await page.evaluate(() => { for (const id of ['mPrinter', 'mTicket', 'mCobro']) { try { (0, eval)(`cerrarModal('${id}')`); } catch {} } document.querySelectorAll('.modal-overlay.open,.na-receipt-overlay.open').forEach(e => e.classList.remove('open')); });
}
async function sellOne(page: Page) {
  await closeModals(page); await nav(page, 'pagePOS');
  await page.locator('#pagePOS [data-product-id="PX1"]').first().click();
  await page.locator('#btnPagar').click();
  await page.locator('#mCobro.open').waitFor();
  await page.locator('#mBtnConf').click();
  await expect.poll(() => page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.snapshot().intents.length)).toBe(1);
  await closeModals(page);
  return page.evaluate(() => { const i = (window as any).NuevoAmanecerCanonicalSaleOutbox.snapshot().intents[0]; return { sale_id: i.sale_id as string, operation_id: i.operation_id as string }; });
}
async function clientState(page: Page) {
  return page.evaluate(() => {
    const ev = (s: string) => { try { return (0, eval)(s); } catch { return null; } };
    const ls: Record<string, string> = {};
    for (const k of ['na_canonical_sale_outbox_v1', 'na_canonical_sale_outbox_v1_quarantine', 'na_canonical_sale_journal']) ls[k] = String(localStorage.getItem(k));
    return { ls, ventas: (ev('ventas') || []).map((v: any) => v.id + '|' + (v.operation_id || '')), cajMovs: (ev('cajMovs') || []).length,
      stock: ((ev('productos') || []).find((p: any) => String(p.id) === 'PX1') || {}).stock };
  });
}
async function openPendingTicket(page: Page, operationId: string) {
  await closeModals(page); await nav(page, 'pageVentas');
  const button = page.locator(`#naCanonicalPendingSales button[data-na-pending-ticket="${operationId}"]`);
  await expect(button).toHaveText('🧾 Ticket');
  await expect(button).toHaveClass(/btn-det btn-reimp/);
  await button.click();
  await page.locator('#mTicket.open').waitFor();
  return readPreview(page);
}
async function openHistoryTicket(page: Page, saleId: string) {
  await closeModals(page); await nav(page, 'pageVentas');
  await page.evaluate(() => (window as any).ventasRender());
  const button = page.locator(`#ventasContent [data-na-sale-action="ticket"][data-sale-id="${saleId}"]`).first();
  if (!(await button.isVisible())) await page.locator('#ventasContent [data-na-sale-action="toggle"]').filter({ hasText: saleId.replace('V-', '') }).first().click();
  await button.click();
  await page.locator('#mTicket.open').waitFor();
  return readPreview(page);
}
// Texto de la vista previa (textContent: no depende de layout/animación del modal).
async function readPreview(page: Page) {
  await expect.poll(() => page.evaluate(() => document.querySelector('#ticketBody pre')?.textContent || '')).toContain('TOTAL');
  return page.evaluate(() => document.querySelector('#ticketBody pre')?.textContent || '');
}
async function printOpenTicket(page: Page) {
  const before = await page.evaluate(() => (window as any).__tkp.prints.length);
  await page.locator('#mTicket button', { hasText: 'Imprimir' }).first().click();
  await page.locator('#mPrinter.open').waitFor();
  await page.locator('#mPrinter button', { hasText: 'Abrir impresión' }).first().click();
  await expect.poll(() => page.evaluate(() => (window as any).__tkp.prints.length)).toBe(before + 1);
  await page.evaluate(() => { try { (0, eval)("cerrarModal('mPrinter')"); } catch {} document.getElementById('mPrinter')?.classList.remove('open'); });
  return page.evaluate(() => { const p = (window as any).__tkp.prints; return p[p.length - 1] as string; });
}
const norm = (t: string) => String(t || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim();
const posts = (ctx: Ctx, phase: string) => ctx.state.net.filter(n => n.phase === phase && n.method === 'POST');
async function syncNow(page: Page) {
  await page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.sync().catch(() => null));
  await expect.poll(() => page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.snapshot().intents.length), { timeout: 30_000 }).toBe(0);
}
// Bloque estable del ticket (productos, totales y pago) para comparar pendiente vs. confirmado.
const body = (t: string) => { const lines = norm(t).split('\n'); const start = lines.findIndex(l => l.includes('DETALLE DE PRODUCTOS')); return lines.slice(start).join('\n'); };


// Venta con el servidor caído SIN cerrar el diálogo automático «Compartir comprobante».
async function sellKeepShare(page: Page) {
  await closeModals(page); await nav(page, 'pagePOS');
  await page.locator('#pagePOS [data-product-id="PX1"]').first().click();
  await page.locator('#btnPagar').click();
  await page.locator('#mCobro.open').waitFor();
  await page.locator('#mBtnConf').click();
  await expect.poll(() => page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.snapshot().intents.length)).toBe(1);
  await page.locator('#naReceiptShare.open').waitFor();
  return page.evaluate(() => { const i = (window as any).NuevoAmanecerCanonicalSaleOutbox.snapshot().intents[0]; return { sale_id: i.sale_id as string, operation_id: i.operation_id as string }; });
}
const shareText = (page: Page) => page.evaluate(() => document.getElementById('naReceiptText')?.textContent || '');
// Texto REAL enviado a WhatsApp (formato texto): URL que abre «Abrir WhatsApp».
async function sharedWhatsapp(page: Page) {
  const before = await page.evaluate(() => (window as any).__tkp.opens.length);
  await page.locator('#naReceiptFormat').selectOption('text');
  await page.locator('#naReceiptPhone').fill('987654321');
  await expect(page.locator('#naReceiptSend')).toBeEnabled();
  await page.locator('#naReceiptSend').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tkp.opens.length)).toBe(before + 1);
  const url = await page.evaluate(() => { const o = (window as any).__tkp.opens; return o[o.length - 1] as string; });
  const u = new URL(url);
  return u.searchParams.get('text') || decodeURIComponent(u.pathname);
}
const refOf = (op: string) => op.replace(/[^0-9a-z]/gi, '').slice(0, 8).toUpperCase();
const totalLine = (t: string) => norm(t).split('\n').find(l => /^TOTAL\b/.test(l.trim())) || '';
function expectPending(text: string, pending: { sale_id: string; operation_id: string }) {
  expect(text).toContain('*** PENDIENTE DE SINCRONIZAR ***');
  // Una sola marca (el camino desde el ticket pendiente ya la traía: no se duplica).
  expect(text.split('PENDIENTE DE SINCRONIZAR').length - 1).toBe(1);
  expect(text.split('Numero provisional').length - 1).toBe(1);
  expect(text).toContain('Numero provisional. Ref. op: ' + refOf(pending.operation_id));
  expect(text).not.toContain(pending.sale_id);
  expect(text).toContain('Arroz Sintetico Pendiente');
}
function expectFinal(text: string, saleId: string) {
  expect(text).toContain(saleId);
  expect(text).not.toContain('PENDIENTE DE SINCRONIZAR');
  expect(text).not.toContain('PROVISIONAL');
  expect(text).not.toContain('Numero provisional');
}
async function shareFromHistory(page: Page, saleId: string) {
  await openHistoryTicket(page, saleId);
  await page.locator('#naTicketShare').click();
  await page.locator('#naReceiptShare.open').waitFor();
  return shareText(page);
}

test('compartir tras venta pendiente: marca PENDIENTE + Ref. op, sin número provisional (vista y WhatsApp), 0 POST; al sincronizar pasa al número final sin marca', async ({ page, baseURL }) => {
  const ctx = await boot(page, baseURL!);
  ctx.state.down = true; ctx.state.phase = 'venta';
  const pending = await sellKeepShare(page);
  ctx.state.phase = 'compartir-pendiente';
  const preview = await shareText(page);
  expectPending(preview, pending);
  const sent = await sharedWhatsapp(page);
  expectPending(sent, pending);
  expect(sent).toContain(norm(preview).split('\n')[0].trim());
  expect(posts(ctx, 'compartir-pendiente')).toEqual([]);
  expect(ctx.env.counts().sales).toBe(0);
  // Mismo comprobante que el ticket pendiente (mismas líneas de detalle y TOTAL).
  const ticket = await openPendingTicket(page, pending.operation_id);
  expect(totalLine(preview)).toBe(totalLine(ticket));
  expect(body(preview).split('\n').slice(0, 6)).toEqual(body(ticket).split('\n').slice(0, 6));
  // «Compartir comprobante» desde el ticket pendiente: misma marca.
  await page.locator('#naTicketShare').click();
  await page.locator('#naReceiptShare.open').waitFor();
  expectPending(await shareText(page), pending);
  expect(posts(ctx, 'compartir-pendiente')).toEqual([]);

  // Con el diálogo aún abierto, la venta se sincroniza: el texto pasa al número final.
  ctx.state.down = false; ctx.state.phase = 'sync';
  await page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.sync().catch(() => null));
  await expect.poll(() => page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.snapshot().intents.length), { timeout: 30_000 }).toBe(0);
  await expect.poll(() => shareText(page), { timeout: 15_000 }).toContain(pending.sale_id);
  expectFinal(await shareText(page), pending.sale_id);
  expect(totalLine(await shareText(page))).toBe(totalLine(preview));
  ctx.state.phase = 'compartir-final';
  expectFinal(await sharedWhatsapp(page), pending.sale_id);

  const history = await shareFromHistory(page, pending.sale_id);
  expectFinal(history, pending.sale_id);
  expect(totalLine(history)).toBe(totalLine(preview));
  expect(posts(ctx, 'compartir-final')).toEqual([]);
  expect(ctx.env.sales().map(s => s.sale_id + '|' + s.operation_id)).toEqual([pending.sale_id + '|' + pending.operation_id]);
  test.info().annotations.push({ type: 'compartido', description: JSON.stringify({ pendiente: norm(sent), final: norm(history) }) });
});

test('compartir desde el ticket pendiente tras recargar: marca; sincronizado con el diálogo abierto: número final', async ({ page, baseURL }) => {
  const ctx = await boot(page, baseURL!);
  ctx.state.down = true; ctx.state.phase = 'venta';
  const pending = await sellKeepShare(page);
  await closeModals(page);
  ctx.state.phase = 'recarga';
  await page.reload(); await waitReady(page, false); await page.waitForTimeout(1500);
  ctx.state.phase = 'compartir-pendiente';
  await openPendingTicket(page, pending.operation_id);
  await page.locator('#naTicketShare').click();
  await page.locator('#naReceiptShare.open').waitFor();
  expectPending(await shareText(page), pending);
  expectPending(await sharedWhatsapp(page), pending);
  expect(posts(ctx, 'compartir-pendiente')).toEqual([]);
  // Abierto desde el ticket pendiente y sincronizado con el diálogo abierto: número final, sin marca.
  ctx.state.down = false; ctx.state.phase = 'sync';
  await page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.sync().catch(() => null));
  await expect.poll(() => page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.snapshot().intents.length), { timeout: 30_000 }).toBe(0);
  await expect.poll(() => shareText(page), { timeout: 15_000 }).toContain(pending.sale_id);
  expectFinal(await shareText(page), pending.sale_id);
  expectFinal(await sharedWhatsapp(page), pending.sale_id);
});

test('renumeración 409 sale_id_conflict: el compartido pendiente no mostró el número provisional y, sincronizado, muestra el número final asignado', async ({ page, baseURL }) => {
  const ctx = await boot(page, baseURL!);
  ctx.state.down = true; ctx.state.phase = 'venta';
  const pending = await sellKeepShare(page);
  ctx.state.phase = 'compartir-pendiente';
  const sent = await sharedWhatsapp(page);
  expectPending(sent, pending);
  expect(posts(ctx, 'compartir-pendiente')).toEqual([]);

  ctx.state.phase = 'otro-equipo';
  await ctx.env.otherDeviceSale(pending.sale_id);
  ctx.state.down = false; ctx.state.phase = 'sync';
  await page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.sync().catch(() => null));
  await expect.poll(() => page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.snapshot().intents.length), { timeout: 30_000 }).toBe(0);
  const creates = posts(ctx, 'sync').filter(p => p.path === '/commands/sale.create');
  expect(creates[0].status).toBe(409);
  const mine = ctx.env.sales().find(s => s.operation_id === pending.operation_id)!;
  expect(mine.sale_id).not.toBe(pending.sale_id);
  // El diálogo abierto pasa al número FINAL (no al provisional que ahora es de otro equipo).
  await expect.poll(() => shareText(page), { timeout: 15_000 }).toContain(mine.sale_id);
  const live = await shareText(page);
  expectFinal(live, mine.sale_id);
  expect(live).not.toContain(pending.sale_id);
  ctx.state.phase = 'compartir-final';
  const finalSent = await sharedWhatsapp(page);
  expectFinal(finalSent, mine.sale_id);
  expect(finalSent).not.toContain(pending.sale_id);
  const history = await shareFromHistory(page, mine.sale_id);
  expectFinal(history, mine.sale_id);
  expect(history).not.toContain(pending.sale_id);
  expect(totalLine(history)).toBe(totalLine(sent));
  expect(posts(ctx, 'compartir-final')).toEqual([]);
  test.info().annotations.push({ type: 'renumeracion', description: `${pending.sale_id} -> ${mine.sale_id}` });
});
