import { test, expect, type Page } from '@playwright/test';
import { canonLocalWorker, routeLocalWorker, type NetEntry } from './helpers/canon-local-worker';

// T-08: con el almacenamiento del navegador lleno, los mensajes dicen qué pasó y qué hacer,
// y un abono que el servidor YA aplicó no se presenta como «No confirmado, revisando…».
// Worker REAL + SQLite en memoria; todo host externo se aborta. Datos sintéticos.
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
test.setTimeout(120_000);

type Ctx = { env: Awaited<ReturnType<typeof canonLocalWorker>>; state: { down: boolean; phase: string; net: NetEntry[]; blocked: string[] } };

async function boot(page: Page, baseURL: string): Promise<Ctx> {
  const env = await canonLocalWorker();
  const state = { down: false, phase: 'boot', net: [] as NetEntry[], blocked: [] as string[] };
  await routeLocalWorker(page, env, new URL(baseURL).origin, state);
  // Registro de avisos del mecanismo existente (#gToast), sin cambiarlo.
  await page.addInitScript(() => {
    const seen = (window as any).__t08 = [] as string[];
    document.addEventListener('DOMContentLoaded', () => {
      const t = document.getElementById('gToast'); if (!t) return;
      new MutationObserver(() => { const x = (t.textContent || '').trim(); if (x && seen[seen.length - 1] !== x) seen.push(x); }).observe(t, { childList: true, characterData: true, subtree: true });
    });
  });
  const endpoint = new URL(baseURL).origin + '/__worker';
  await page.addInitScript(([e]) => { if (!localStorage.getItem('na_cloud_sync_credentials')) localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: e, token: 'owner-token' })); }, [endpoint]);
  await page.goto('/index.html');
  const c = env.control();
  await page.evaluate(async ([e, c]: any) => { await (window as any).NuevoAmanecerCanonical.configure({ endpoint: e, promotion_id: c.promotion_id, authority_epoch: c.authority_epoch, revision: c.revision, token: 'owner-token' }); }, [endpoint, c]);
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.confirmed === true, null, { timeout: 20_000 });
  await page.waitForFunction(() => { try { return (0, eval)('productos').some((p: any) => String(p.id) === 'PX1') && (0, eval)('creditos').some((c: any) => String(c.id) === 'CR:001'); } catch { return false; } }, null, { timeout: 20_000 });
  await page.waitForFunction(() => { try { return (0, eval)('cajEstado').abierta === true; } catch { return false; } }, null, { timeout: 20_000 });
  return { env, state };
}
const toasts = (page: Page) => page.evaluate(() => (window as any).__t08.slice() as string[]);
const posts = (ctx: Ctx, phase: string, path?: string) => ctx.state.net.filter(n => n.phase === phase && n.method === 'POST' && (!path || n.path === path));
const cart = (page: Page) => page.evaluate(() => (0, eval)('cart').map((i: any) => String(i.id) + 'x' + i.qty));
const outboxCount = (page: Page) => page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.snapshot().intents.length as number);
async function fillQuota(page: Page) {
  return page.evaluate(() => {
    let i = 0, size = 1 << 20; const chunk = (n: number) => 'x'.repeat(n);
    while (size >= 1) { try { localStorage.setItem('t08_relleno_' + i, chunk(size)); i++; } catch { size = Math.floor(size / 2); } }
    let probe = 'ok'; try { localStorage.setItem('t08_probe', 'y'); } catch (e: any) { probe = e.name; }
    return { keys: i, probe };
  });
}
const freeQuota = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('t08_')).forEach(k => localStorage.removeItem(k)));
async function sellOne(page: Page) {
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pagePOS'));
  await page.locator('#pagePOS [data-product-id="PX1"]').first().click();
  await page.locator('#btnPagar').click();
  await page.locator('#mCobro.open').waitFor();
  await page.locator('#mBtnConf').click();
}
const HELP = /Qué hacer: .*sincronicen las ventas pendientes/;

test('S1 cuota real agotada: la venta no se guarda, el carrito se conserva y el aviso dice qué hacer', async ({ page, baseURL }) => {
  const ctx = await boot(page, baseURL!);
  const fill = await fillQuota(page);
  expect(fill.probe).toBe('QuotaExceededError');
  ctx.state.phase = 'venta';
  await sellOne(page);
  await expect.poll(() => toasts(page)).toContainEqual(expect.stringMatching(/almacenamiento lleno/));
  const shown = (await toasts(page)).find(t => /almacenamiento lleno/.test(t))!;
  test.info().annotations.push({ type: 'aviso', description: shown });
  expect(shown).toMatch(/Tus productos siguen en el carrito/);
  expect(shown).toMatch(HELP);
  expect(await cart(page)).toEqual(['PX1x1']);
  expect(await outboxCount(page)).toBe(0);
  expect(posts(ctx, 'venta', '/commands/sale.create')).toEqual([]);
  expect(ctx.env.counts().sales).toBe(0);
  await freeQuota(page);
});

test('S2 la venta entra a la cola pero el diario no cabe: el aviso dice que es por espacio y qué hacer; al liberar se envía una vez', async ({ page, baseURL }) => {
  const ctx = await boot(page, baseURL!);
  await page.evaluate(() => { const o = Storage.prototype.setItem; (window as any).__o = o; Storage.prototype.setItem = function (k: string, v: string) { if (k === 'na_canonical_sale_journal') throw new DOMException('cuota sintética', 'QuotaExceededError'); return o.call(this, k, v); }; });
  ctx.state.phase = 'venta';
  await sellOne(page);
  await expect.poll(() => toasts(page), { timeout: 15_000 }).toContainEqual(expect.stringMatching(/falta confirmar/));
  const shown = (await toasts(page)).filter(t => /falta confirmar/.test(t)).pop()!;
  test.info().annotations.push({ type: 'aviso', description: shown });
  expect(shown).toMatch(/almacenamiento del navegador está lleno/);
  expect(shown).toMatch(/no la cobres de nuevo/);
  expect(shown).toMatch(HELP);
  expect(await outboxCount(page)).toBe(1);
  expect(ctx.env.counts().sales).toBe(0);
  ctx.state.phase = 'liberar';
  await page.evaluate(() => { Storage.prototype.setItem = (window as any).__o; });
  await page.evaluate(() => (window as any).NuevoAmanecerCanonicalSaleOutbox.sync().catch(() => null));
  await expect.poll(() => outboxCount(page), { timeout: 30_000 }).toBe(0);
  expect(ctx.env.counts().sales).toBe(1);
  expect(new Set(posts(ctx, 'liberar', '/commands/sale.create').map(p => p.operation_id)).size).toBe(1);
});

test('abono aplicado por el servidor cuyo comprobante no cabe: no muestra «No confirmado, revisando…» sino CONFIRMADO + espacio; al liberar se reconcilia sin otro pago', async ({ page, baseURL }) => {
  const ctx = await boot(page, baseURL!);
  // Cabe el registro PENDING pero no el CONFIRMED (más grande, lleva el recibo): mismo corte que S1 de asistente 3.
  await page.evaluate(() => { const o = Storage.prototype.setItem; (window as any).__o = o; Storage.prototype.setItem = function (k: string, v: string) { if (k === 'na_canonical_sale_journal' && String(v).includes('"state":"CONFIRMED"')) throw new DOMException('cuota sintética', 'QuotaExceededError'); return o.call(this, k, v); }; });
  ctx.state.phase = 'abono';
  await page.evaluate(() => { (0, eval)("abrirPago('CR:001')"); (document.getElementById('pagoMonto') as HTMLInputElement).value = '1.00'; (document.getElementById('pagoMetodo') as HTMLSelectElement).value = 'efectivo'; });
  await page.locator('#mPagoCred.open').waitFor();
  await page.locator('#pagoConfirmBtn').click();
  await expect.poll(() => ctx.env.payments().length, { timeout: 15_000 }).toBe(1);
  const net = page.locator('#mPagoCred .na-pay-net');
  await expect(net).toContainText('CONFIRMADO', { timeout: 15_000 });
  const text = await net.innerText();
  test.info().annotations.push({ type: 'modal', description: text }, { type: 'toasts', description: JSON.stringify(await toasts(page)) });
  expect(text).not.toContain('No confirmado');
  expect(text).toMatch(/almacenamiento del navegador está lleno/);
  expect(text).toMatch(/No lo registres de nuevo/);
  expect((await toasts(page)).some(t => /CONFIRMADO por el servidor/.test(t))).toBe(true);
  // Reabrir el modal no vuelve a decir «No confirmado».
  await page.evaluate(() => (0, eval)("cerrarModal('mPagoCred')"));
  await page.evaluate(() => { (0, eval)("abrirPago('CR:001')"); });
  await page.waitForTimeout(800);
  await expect(net).not.toContainText('No confirmado');
  expect(ctx.env.payments()).toHaveLength(1);
  // Liberar espacio: se reconcilia con el MISMO operation_id, sin otro PAYMENT.
  ctx.state.phase = 'liberar';
  await page.evaluate(() => { Storage.prototype.setItem = (window as any).__o; });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => page.evaluate(() => (window as any).NuevoAmanecerCanonical.pendingSnapshot?.() || null), { timeout: 40_000 }).toBeNull();
  const pays = ctx.env.payments();
  expect(pays).toHaveLength(1);
  expect(pays[0].credit_delta_cents).toBe(-100);
  expect(new Set(posts(ctx, 'liberar', '/commands/payment.create').map(p => p.operation_id))).toEqual(new Set(posts(ctx, 'abono', '/commands/payment.create').map(p => p.operation_id)));
});
