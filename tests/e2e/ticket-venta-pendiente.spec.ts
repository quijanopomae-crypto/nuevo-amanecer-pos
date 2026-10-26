import { test, expect, type Page } from '@playwright/test';
import { canonLocalWorker, routeLocalWorker, type NetEntry } from './helpers/canon-local-worker';

// T-42: una venta que sigue en el outbox (servidor caído) debe poder abrir e imprimir su ticket
// desde «Ventas pendientes», también tras recargar, sin ningún POST ni cambio de venta/caja/stock/outbox.
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
    const rec = (window as any).__tkp = { prints: [] as string[] };
    window.open = function () {
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

test('venta pendiente: Ticket tras recargar imprime con marca, sin número provisional y con 0 POST; tras sincronizar el ticket normal sale igual sin marca', async ({ page, baseURL }) => {
  const ctx = await boot(page, baseURL!);
  ctx.state.down = true; ctx.state.phase = 'venta';
  const pending = await sellOne(page);
  expect(ctx.env.counts().sales).toBe(0);

  ctx.state.phase = 'recarga';
  await page.reload(); await waitReady(page, false);
  await page.waitForTimeout(1500);
  const before = await clientState(page), server0 = ctx.env.counts();
  expect(JSON.parse(before.ls.na_canonical_sale_outbox_v1).intents.map((i: any) => i.operation_id)).toEqual([pending.operation_id]);

  ctx.state.phase = 'ticket-pendiente';
  const preview = await openPendingTicket(page, pending.operation_id);
  const printed = await printOpenTicket(page);
  const ref = pending.operation_id.replace(/[^0-9a-z]/gi, '').slice(0, 8).toUpperCase();
  test.info().annotations.push({ type: 'preview-pendiente', description: norm(preview) }, { type: 'impreso-pendiente', description: norm(printed) });
  expect(norm(printed)).toBe(norm(preview));
  expect(printed).toContain('PENDIENTE DE SINCRONIZAR');
  expect(printed).toContain('Ref. op: ' + ref);
  expect(printed).toContain('PROVISIONAL');
  expect(printed).not.toContain(pending.sale_id);
  expect(printed).toContain('Arroz Sintetico Pendiente');
  expect(printed).toMatch(/6\.00/);
  // Reimpresión del pendiente: idéntica.
  const printed2 = await printOpenTicket(page);
  expect(norm(printed2)).toBe(norm(printed));
  expect(posts(ctx, 'ticket-pendiente')).toEqual([]);
  expect(await clientState(page)).toEqual(before);
  expect(ctx.env.counts()).toEqual(server0);

  ctx.state.down = false; ctx.state.phase = 'sync';
  await closeModals(page);
  await syncNow(page);
  expect(posts(ctx, 'sync').filter(p => p.path === '/commands/sale.create').map(p => p.operation_id)).toEqual([pending.operation_id]);
  expect(ctx.env.sales().map(s => s.sale_id + '|' + s.operation_id)).toEqual([pending.sale_id + '|' + pending.operation_id]);
  await expect.poll(() => page.evaluate(id => (0, eval)('ventas').some((v: any) => v.id === id), pending.sale_id)).toBe(true);
  await expect(page.locator('#naCanonicalPendingSales')).toHaveCount(0);

  ctx.state.phase = 'ticket-confirmado';
  const confirmedPreview = await openHistoryTicket(page, pending.sale_id);
  const confirmed = await printOpenTicket(page);
  expect(norm(confirmed)).toBe(norm(confirmedPreview));
  expect(confirmed).not.toContain('PENDIENTE DE SINCRONIZAR');
  expect(confirmed).not.toContain('PROVISIONAL');
  expect(confirmed).toContain(pending.sale_id);
  expect(body(confirmed)).toBe(body(printed));
  const again = await openHistoryTicket(page, pending.sale_id);
  expect(norm(await printOpenTicket(page))).toBe(norm(confirmed));
  expect(norm(again)).toBe(norm(confirmedPreview));
  expect(posts(ctx, 'ticket-confirmado')).toEqual([]);
  expect(ctx.state.blocked.filter(b => /workers\.dev|turso|cloudflare/.test(b))).toEqual([]);
  test.info().annotations.push({ type: 'tickets', description: JSON.stringify({ pendiente: norm(printed), confirmado: norm(confirmed) }) });
});

test('el número pendiente no es definitivo: otro equipo usa el mismo número, el servidor responde sale_id_conflict y la venta se renumera; el ticket pendiente no lo imprimió', async ({ page, baseURL }) => {
  const ctx = await boot(page, baseURL!);
  ctx.state.down = true; ctx.state.phase = 'venta';
  const pending = await sellOne(page);
  ctx.state.phase = 'ticket-pendiente';
  await openPendingTicket(page, pending.operation_id);
  const printed = await printOpenTicket(page);
  expect(printed).not.toContain(pending.sale_id);
  expect(posts(ctx, 'ticket-pendiente')).toEqual([]);

  // Otro equipo confirma primero una venta con el MISMO número.
  ctx.state.phase = 'otro-equipo';
  await ctx.env.otherDeviceSale(pending.sale_id);
  expect(ctx.env.sales().map(s => s.sale_id)).toEqual([pending.sale_id]);

  ctx.state.down = false; ctx.state.phase = 'sync';
  await closeModals(page);
  await syncNow(page);
  const creates = posts(ctx, 'sync').filter(p => p.path === '/commands/sale.create');
  expect(creates.length).toBeGreaterThanOrEqual(2);
  expect(new Set(creates.map(p => p.operation_id))).toEqual(new Set([pending.operation_id]));
  expect(creates[0].status).toBe(409);
  const mine = ctx.env.sales().find(s => s.operation_id === pending.operation_id)!;
  expect(mine).toBeTruthy();
  expect(mine.sale_id).not.toBe(pending.sale_id);
  expect(ctx.env.sales().filter(s => s.operation_id === pending.operation_id)).toHaveLength(1);
  await expect.poll(() => page.evaluate(id => (0, eval)('ventas').some((v: any) => v.id === id), mine.sale_id)).toBe(true);

  await openHistoryTicket(page, mine.sale_id);
  const confirmed = await printOpenTicket(page);
  expect(confirmed).toContain(mine.sale_id);
  expect(confirmed).not.toContain('PROVISIONAL');
  expect(body(confirmed)).toBe(body(printed));
  test.info().annotations.push({ type: 'renumeracion', description: `${pending.sale_id} -> ${mine.sale_id} (operation_id ${pending.operation_id})` });
});
