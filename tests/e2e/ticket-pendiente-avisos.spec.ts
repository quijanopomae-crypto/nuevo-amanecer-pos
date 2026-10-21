import { test, expect, type Page } from '@playwright/test';
import { canonLocalWorker, routeLocalWorker, type NetEntry } from './helpers/canon-local-worker';

// T-42 (delta, revisión de código): «Ticket» de una venta pendiente cuya intención está dañada avisa con un
// toast de error (antes no hacía nada); si la venta pasó a revisión, el aviso apunta a «Ventas en revisión».
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
  await page.addInitScript(() => {
    const seen = (window as any).__toasts = [] as string[];
    document.addEventListener('DOMContentLoaded', () => { const t = document.getElementById('gToast'); if (!t) return;
      new MutationObserver(() => { const x = (t.textContent || '').trim(); if (x && seen[seen.length - 1] !== x) seen.push(x); }).observe(t, { childList: true, characterData: true, subtree: true }); });
  });
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



const toasts = (page: Page) => page.evaluate(() => (window as any).__toasts.slice() as string[]);

test('intención pendiente dañada: «Ticket» avisa con error y no abre un ticket a medias; 0 POST', async ({ page, baseURL }) => {
  const ctx = await boot(page, baseURL!);
  ctx.state.down = true; ctx.state.phase = 'venta';
  const pending = await sellOne(page);
  ctx.state.phase = 'danada';
  const ok = await page.evaluate(op => {
    const k = 'na_canonical_sale_outbox_v1', box = JSON.parse(localStorage.getItem(k)!);
    const i = box.intents.find((x: any) => x.operation_id === op); i.items = null; localStorage.setItem(k, JSON.stringify(box));
    // El outbox valida al leer: la intención dañada hace fallar snapshot() (OUTBOX_CORRUPT).
    try { (window as any).NuevoAmanecerCanonicalSaleOutbox.snapshot(); return 'legible'; } catch (e: any) { return String(e && e.message); }
  }, pending.operation_id);
  expect(ok).toBe('OUTBOX_CORRUPT');
  await page.evaluate(op => (window as any).verTicketPendiente(op), pending.operation_id);
  await expect.poll(() => toasts(page)).toContainEqual(expect.stringMatching(/No se pudo armar el ticket de esta venta pendiente/));
  await expect(page.locator('#mTicket.open')).toHaveCount(0);
  // El reintento automático de la cola (servidor caído) puede intentar sale.create en esta fase; el ticket no envía nada.
  expect(posts(ctx, 'danada').filter(p => !(p.path === '/commands/sale.create' && p.status === 'ABORT'))).toEqual([]);
});

test('venta pasada a revisión: el aviso dice «Caja › Ventas en revisión», no «historial»', async ({ page, baseURL }) => {
  const ctx = await boot(page, baseURL!);
  ctx.state.down = true; ctx.state.phase = 'venta';
  const pending = await sellOne(page);
  ctx.state.phase = 'revision';
  // Copia en revisión (misma forma que quarantineHead) y fuera de la cola.
  const moved = await page.evaluate(op => {
    const k = 'na_canonical_sale_outbox_v1', box = JSON.parse(localStorage.getItem(k)!);
    const intent = box.intents.find((x: any) => x.operation_id === op);
    const qk = k + '_quarantine', q = JSON.parse(localStorage.getItem(qk) || 'null') || { version: 1, entries: [] };
    q.entries = (q.entries || []).concat([{ intent, reason: 'product_not_found', status: 'QUARANTINED', quarantined_at: new Date().toISOString() }]);
    localStorage.setItem(qk, JSON.stringify(q));
    box.intents = box.intents.filter((x: any) => x.operation_id !== op); localStorage.setItem(k, JSON.stringify(box));
    const ob = (window as any).NuevoAmanecerCanonicalSaleOutbox;
    return ob.quarantine().entries.some((e: any) => e.status === 'QUARANTINED' && e.intent.operation_id === op) && !ob.snapshot().intents.some((x: any) => x.operation_id === op);
  }, pending.operation_id);
  test.skip(!moved, 'la revisión no acepta la copia sintética');
  await page.evaluate(op => (window as any).verTicketPendiente(op), pending.operation_id);
  await expect.poll(() => toasts(page)).toContainEqual(expect.stringMatching(/en revisión; ábrela en Caja › Ventas en revisión/));
  expect((await toasts(page)).some(t => /ábrela desde el historial/.test(t))).toBe(false);
  expect(posts(ctx, 'revision')).toEqual([]);
});
