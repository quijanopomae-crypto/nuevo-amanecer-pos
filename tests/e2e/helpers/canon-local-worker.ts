// Worker REAL (mismo commit) + SQLite en memoria para pruebas e2e. Datos sintéticos; sin red externa.
// El navegador habla con el Worker por /__worker en el MISMO origen y la ruta lo resuelve en este proceso.
import type { Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'infra/database/migrations');

export type NetEntry = { phase: string; method: string; path: string; status: number | string; operation_id?: string };

export async function canonLocalWorker() {
  const H = await import(path.join(ROOT, 'tests/cloud-sync/canon-browser-harness.mjs'));
  const f = await H.activeCanon({ after() {} }, {});
  try { f.database.exec(readFileSync(path.join(MIGRATIONS, '0010_session_auth.sql'), 'utf8').replace(/DROP INDEX[^;]*;/, '')); } catch {}
  // 0033 ya la aplica activeCanon().
  for (const name of readdirSync(MIGRATIONS).filter(n => /^00(1[4-9]|2\d|3[0-2])_/.test(n)).sort()) {
    try { f.database.exec(readFileSync(path.join(MIGRATIONS, name), 'utf8')); } catch {}
  }
  f.addDevice('owner-phone', 'writer', 'active', 'owner-token');
  f.addDevice('other-phone', 'writer', 'active', 'other-token');
  const call = async (p: string, token: string, body?: unknown) => {
    const r = await f.fetch('http://localhost' + p, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  await call('/auth/owner-pin', 'owner-token', { new_pin: '4821' });
  const owner = await H.device(f, { token: 'owner-token', globals: { document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } } } });
  await owner.api.createProduct({ product_id: 'PX1', name: 'Arroz Sintetico Pendiente', sku: 'TKP-SKU', barcode: '7750000000017', alternate_codes: [], category: 'abarrotes', brand: 'Marca Prueba', description: null, icon: '📦', image: null, unit: 'unidad', purchase_unit: 'unidad', purchase_factor: 1, cost_cents: 400, price_cents: 600, box_price_cents: null, units_per_box: null, initial_stock_quantity: 10, stock_min_quantity: 0, expiry_date: null, includes_igv: true, tax_type: 'gravado', complementary_tax: '', tracks_inventory: true });
  await owner.api.refresh();
  const c0 = f.control();
  await call('/commands/cash.open', 'owner-token', { promotion_id: c0.active_promotion_id, client_contract: 'a6-gate-c-v1', authority_epoch: c0.authority_epoch, expected_control_revision: c0.revision, operation_id: 'open-tkp-1', created_at: new Date().toISOString(), session_id: 'sess-tkp-1', opening_cents: 1000 });
  const control = () => { const c = f.control(); return { promotion_id: c.active_promotion_id, authority_epoch: c.authority_epoch, revision: c.revision }; };
  const count = (table: string) => (f.database.prepare(`SELECT COUNT(*) n FROM "${table}"`).get() as { n: number }).n;
  const sales = () => f.database.prepare('SELECT sale_id, operation_id, total_cents FROM sales ORDER BY sale_id').all() as Array<{ sale_id: string; operation_id: string; total_cents: number }>;
  const counts = () => Object.fromEntries(['sales', 'sale_items', 'cash_movements', 'inventory_movements'].map(t => [t, count(t)]));
  // Otro equipo vende con un número dado (para provocar sale_id_conflict).
  const otherDeviceSale = async (saleId: string) => {
    const intentSource = readFileSync(path.join(ROOT, 'POS/js/sync/canonical-sale-intent.js'), 'utf8');
    const other = await H.device(f, { token: 'other-token', scripts: [['canonical-sale-intent', intentSource]] });
    await other.api.refresh();
    const I = other.context.NuevoAmanecerCanonicalSaleIntent;
    return other.api.createSale(I.build({ sale_id: saleId, payment_method: 'efectivo', items: [{ product_id: 'PX1', quantity: 1, precio: 6 }] }));
  };
  const payments = () => f.database.prepare("SELECT operation_id, credit_id, credit_delta_cents FROM canonical_financial_events WHERE event_type='PAYMENT'").all() as Array<{ operation_id: string; credit_id: string; credit_delta_cents: number }>;
  return { f, call, control, counts, sales, payments, otherDeviceSale };
}

// Enruta /__worker al Worker local; todo host distinto del origen de la prueba se aborta y se registra.
export async function routeLocalWorker(page: Page, env: Awaited<ReturnType<typeof canonLocalWorker>>, origin: string, state: { down: boolean; phase: string; net: NetEntry[]; blocked: string[] }) {
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const local = (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.origin === origin;
    if (local && url.pathname.startsWith('/__worker/')) {
      const wpath = url.pathname.slice('/__worker'.length);
      let operation_id: string | undefined; try { operation_id = JSON.parse(req.postData() || 'null')?.operation_id; } catch {}
      const entry: NetEntry = { phase: state.phase, method: req.method(), path: wpath, status: 0, operation_id };
      state.net.push(entry);
      if (req.method() === 'OPTIONS') { entry.status = 204; return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } }); }
      if (state.down) { entry.status = 'ABORT'; return route.abort('connectionrefused'); }
      const headers = { ...req.headers() }; delete headers.host;
      const res = await env.f.fetch('http://localhost' + wpath + url.search, { method: req.method(), headers, body: req.postData() ?? undefined });
      entry.status = res.status;
      const h: Record<string, string> = {}; res.headers.forEach((v: string, k: string) => { h[k] = v; }); h['access-control-allow-origin'] = '*';
      return route.fulfill({ status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) });
    }
    if (local) return route.continue();
    state.blocked.push(req.method() + ' ' + url.origin + url.pathname);
    return route.abort();
  });
}
