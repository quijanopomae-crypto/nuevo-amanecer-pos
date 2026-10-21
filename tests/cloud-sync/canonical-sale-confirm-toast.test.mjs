// «Venta V-00X confirmada» solo cuando el servidor la confirmó. Si tras el envío quedó en revisión
// (409 operation_id_conflict), se muestra el aviso de revisión existente, nunca «confirmada».
// Worker real + SQLite en memoria (harness del repo). Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';
import { tursoSqlite } from './turso-sqlite-protocol.mjs';

const source = (name) => readFileSync(new URL('../../POS/js/' + name, import.meta.url), 'utf8');
const SALE_SCRIPTS = ['canonical-sale-intent', 'canonical-sale-outbox', 'canonical-sale-projection', 'canonical-sale-integration', 'canonical-sale-view'];
const MIGRATIONS = ['0014_canonical_live_products.sql', '0015_canonical_inventory_adjust.sql', '0016_canonical_generic_sale_lines.sql', '0017_canonical_live_customers.sql', '0018_canonical_customer_credit_policy.sql', '0024_pos_roles_owner_pin.sql'];
const LEXICAL = `let cart=[],productos=[],ventas=[],clientes=[],creditos=[],cajEstado={},cajMovs=[],posProc=false,posPayM='efectivo';
const _naSessionOpen=()=>true,_naTracksStock=()=>true,_naUnitsSold=i=>Number(i.qty)*(Number(i.unitsPerQty)||1),_naUnitsPerQty=i=>Number(i.unitsPerQty)||1;`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(t, conflict) {
  const f = await activeCanon(t, { migrations: MIGRATIONS });
  f.env.DB = tursoSqlite(f.database).adapter;
  f.env.nuevo_amanecer_lab = { prepare() { throw Error('no D1'); } };
  const onFetch = async (url) => {
    if (conflict.on && new URL(url).pathname === '/commands/sale.create')
      return new Response(JSON.stringify({ error: 'operation_id_conflict', conflict: 'cross_ledger', ledger: 'expenses' }), { status: 409, headers: { 'content-type': 'application/json' } });
  };
  const tab = await device(f, { token: 'toast-session', deviceId: 'toast-device', onFetch, scripts: [['lexical-runtime', LEXICAL], ...SALE_SCRIPTS.map((n) => [n, source('sync/' + n + '.js')])],
    globals: { isModuleLocked: () => false, _naPaymentState: () => ({ valid: true }), posUpdateCart() {}, posRender() {} } });
  await tab.api.adjustInventory({ product_id: '00001', movement_type: 'ENTRADA', quantity: 5, reason: 'Stock sintético' });
  await tab.api.refresh();
  await tab.api.openCash({ session_id: 'cash-toast', opening_cents: 0 });
  await tab.api.refresh();
  tab.context.__legacy = tab.api.legacySnapshot();
  vm.runInContext('productos=__legacy.products;ventas=__legacy.sales;clientes=__legacy.customers;', tab.context);
  vm.runInContext("cart=[{...productos.find(p=>p.id==='00001'),qty:1,precio:2}];", tab.context);
  return { f, tab };
}
const toastText = (tab) => tab.toasts.map((x) => x[0]).join('\n');

test('toast: una venta que tras el envío queda en revisión (409 operation_id_conflict) NO dice «confirmada»; muestra el aviso de revisión', async (t) => {
  const conflict = { on: true };
  const { tab } = await fixture(t, conflict);
  assert.ok(await vm.runInContext('confirmarVenta()', tab.context), 'capturada localmente');
  await sleep(300);
  const queue = tab.context.NuevoAmanecerCanonicalSaleOutbox;
  const held = queue.quarantine().entries.filter((e) => e.status === 'QUARANTINED');
  assert.equal(held.length, 1, 'en revisión');
  assert.equal(held[0].reason, 'operation_id_conflict');
  assert.doesNotMatch(toastText(tab), /Venta V-\d+ confirmada/, toastText(tab));
  assert.match(toastText(tab), /en revisión/);
});

test('toast control: sin conflicto, la venta confirmada por el servidor sí dice «confirmada»', async (t) => {
  const { f, tab } = await fixture(t, { on: false });
  assert.ok(await vm.runInContext('confirmarVenta()', tab.context));
  await sleep(300);
  assert.equal(f.sql('SELECT COUNT(*) n FROM sales').n, 1);
  assert.match(toastText(tab), /Venta V-\d+ confirmada/);
});
