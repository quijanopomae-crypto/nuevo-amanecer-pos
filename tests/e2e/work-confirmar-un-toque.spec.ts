import { test, expect, type Page } from '@playwright/test';
import { settlePersistence } from './helpers/persistence';

const PRODUCT_ID = 880221;
const product = {
  id: PRODUCT_ID, name: 'Arroz historial', descripcion: 'Fixture sintético; sin clientes reales', sku: 'ARROZ-HIST',
  barcode: '', codigosAlternativos: [], codigoAlternativo: '', cat: 'abarrotes', marca: 'Marca de prueba',
  unidad: 'unidad', unidadCompra: 'unidad', factorCompra: 1, costo: 2, precio: 4.5, stock: 10, stockMin: 3,
  venc: '', icon: '📦', imagen: null, incluyeIGV: true, tipoImpuesto: 'gravado', impuestoComplementario: '',
  controlInventario: true, precioCaja: null, unidCaja: null, activo: true
};
const sale = {
  id: 'V-HIST-1', fecha: '2026-10-01', hora: '10:00', hora24: '10:00:00', timestamp: '2026-10-01T15:00:00.000Z',
  total: 4.5, metodo: 'efectivo', estado: 'completada', anulada: false, clienteId: null,
  items: [{ id: PRODUCT_ID, name: 'Arroz historial', qty: 1, cantidad: 1, precio: 4.5, costo: 2, unitsPerQty: 1 }]
};
const ownerMe = { pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'hist-owner-1', label: 'Ana Dueña' };

type Me = { status: number; body: Record<string, unknown> };

async function installRoutes(page: Page, me: Me) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') {
      if (url.pathname === '/auth/me') return route.fulfill({ status: me.status, contentType: 'application/json', body: JSON.stringify(me.body) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return url.hostname === '127.0.0.1' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.continue() : route.abort();
  });
}

async function setup(page: Page, me: Me = { status: 200, body: ownerMe }) {
  await installRoutes(page, me);
  await page.goto('/index.html?work=1');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic-test-only' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, me.body.pos_role || 'owner');
  await page.reload();
  if (me.status === 200) {
    await page.waitForFunction(role => {
      const roles = (window as any).NA_ROLES;
      return roles && roles.role === role && roles.confirmed === true;
    }, me.body.pos_role);
  }
  await page.waitForFunction(() => !!(window as any).NuevoAmanecerCanonical && !!(window as any).NA_PRICE_HISTORY && !!(window as any).NA_MENU_NAVIGATION);
  await page.evaluate(({ product: item, sale: ticket }) => {
    const w = window as any;
    const real = w.NuevoAmanecerCanonical;
    w.__histCanon = false;
    const wrapped: Record<string, unknown> = {};
    for (const key of Object.keys(real)) {
      const value = real[key];
      wrapped[key] = typeof value === 'function' ? value.bind(real) : value;
    }
    wrapped.enabled = () => !!w.__histCanon;
    wrapped.commandContext = () => ({ promotion_id: 'hist', authority_epoch: 1, expected_control_revision: 1, client_contract: 'test', created_at: '2026-10-20T18:00:00.000Z' });
    wrapped.prepareCommand = async () => {};
    wrapped.refresh = async () => {};
    w.NuevoAmanecerCanonical = wrapped;
    (0, eval)('productos = ' + JSON.stringify([item]));
    (0, eval)('ventas = ' + JSON.stringify([ticket]));
    w.NA_MENU_NAVIGATION.navigate('pageInventario');
    w.invRender();
  }, { product, sale });
  await expect(page.locator('#invBody')).toContainText('Arroz historial');
  await page.evaluate(() => (window as any).goPage('pageMenu'));
}


const proposal = (extra: Record<string, unknown> = {}) => ({
  id: 'work-precio-1', type: 'precio', needsConfirm: true, confirm_token: 'sintetico.firma', title: 'Cambiar precio', nombre: 'Arroz historial',
  product_id: PRODUCT_ID, precio_actual: 4.5, precio_nuevo: 5.2, cambioGrande: false, bajoCosto: false, ...extra
});

// Motor de prueba: hace lo mismo que el ejecutor real de precio (abre la ficha del POS con el precio nuevo); el guardado lo hace WORK con el
// formulario REAL del POS. La confirmación en el servidor (token de un solo uso) está cubierta por las pruebas del asistente.
async function installFakeEngine(page: Page, p: Record<string, unknown>) {
  await page.evaluate(prop => {
    const w = window as any;
    w.__executed = 0;
    w.NA_ROLES.api = async (path: string) => {
      if (path !== '/auth/assistant/chat') throw new Error('Ruta incorrecta');
      return { reply: 'Te preparé el cambio.', proposals: [prop] };
    };
    w.NA_ASISTENTE = { engine: {
      ready: () => true, owner: () => true,
      prepare: (t: string) => ({ text: t, context: { screen: 'pageMenu', products: [] }, cards: [] }),
      accessState: () => 'ok',
      // Lee el producto del POS (solo lectura), igual que el motor real.
      product: (id: string) => { const x = ((0, eval)('productos') as any[]).find((q: any) => String(q.id) === String(id)); return x ? { precio: x.precio, costo: x.costo, stock: x.stock, controla: x.controla } : null; },
      canExecute: () => ({ ok: true }), expiry: () => Date.now() + 300000, add: (x: any) => x.id,
      cancel() {}, forget() {}, forgetAll() {}, state: () => 'pending', go: () => ({ ok: true }), openDocument: async () => ({ ok: true }),
      execute: async () => {
        w.__executed++;
        w.editProd((prop as any).product_id);
        const i = document.getElementById('pPrecio') as HTMLInputElement;
        i.value = Number((prop as any).precio_nuevo).toFixed(2);
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true, msg: 'Abrí la ficha con el precio nuevo.' };
      }
    } };
  }, p);
}

function price(page: Page) {
  return page.evaluate(id => ((0, eval)('productos') as any[]).find((x: any) => x.id === id).precio, PRODUCT_ID);
}

test('WORK: Confirmar aplica el precio con un solo toque, sin segundo «Guardar»', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.locator('#naWorkOverlay iframe')).toBeVisible();
  await installFakeEngine(page, proposal());
  const work = page.frameLocator('#naWorkOverlay iframe');
  await work.locator('#promptInput').fill('sube el arroz a 5.20');
  await work.locator('#promptForm button[type="submit"]').click();
  const card = work.locator('.na-card[data-kind="confirm"]');
  await expect(card).toContainText('S/ 5.20');
  await expect(card.getByRole('button', { name: 'Confirmar' })).toBeVisible();
  expect(await price(page)).toBe(4.5);
  await card.getByRole('button', { name: 'Confirmar' }).click();
  await expect(card).toHaveAttribute('data-st', 'done', { timeout: 20000 });
  await expect(card).toContainText('Se guardó al instante');
  await expect(page.locator('#naWorkOverlay')).toHaveCount(1);
  await expect(page.locator('#mProd')).not.toHaveClass(/\bopen\b/);
  await settlePersistence(page);
  expect(await price(page)).toBe(5.2);
  expect(await page.evaluate(() => (window as any).__executed)).toBe(1);
});

test('WORK: con aviso de riesgo (bajo costo) el cambio NO se guarda solo: se abre la ficha para revisar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.locator('#naWorkOverlay iframe')).toBeVisible();
  await installFakeEngine(page, proposal({ precio_nuevo: 1.5, bajoCosto: true }));
  const work = page.frameLocator('#naWorkOverlay iframe');
  await work.locator('#promptInput').fill('baja el arroz a 1.50');
  await work.locator('#promptForm button[type="submit"]').click();
  const card = work.locator('.na-card[data-kind="confirm"]');
  await expect(card).toContainText('por debajo del costo');
  await card.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.locator('#naWorkOverlay')).toBeHidden({ timeout: 10000 }); // WORK queda oculto (no destruido): el chat se conserva
  await expect(page.locator('#mProd')).toHaveClass(/\bopen\b/);
  expect(await price(page)).toBe(4.5);
});

test('WORK: una consulta de solo lectura no muestra «propuestas pendientes» y un error 429 sale en palabras simples', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await installFakeEngine(page, { id: 'q1', type: 'consulta', needsConfirm: false, result: { titulo: 'Poco stock', columnas: ['Producto', 'Stock'], filas: [['Arroz historial', 2]] } });
  const work = page.frameLocator('#naWorkOverlay iframe');
  await work.locator('#promptInput').fill('qué falta');
  await work.locator('#promptForm button[type="submit"]').click();
  await expect(work.locator('.na-card[data-kind="table"]')).toContainText('Arroz historial');
  await expect(work.locator('#chatMessages')).not.toContainText('propuestas pendientes');
  await page.evaluate(() => { (window as any).NA_ROLES.api = async () => { const e: any = new Error('rate_limited'); e.status = 429; e.data = {}; throw e; }; });
  await work.locator('#chatInput').fill('otra');
  await work.locator('#chatComposeForm button[type="submit"]').click();
  await expect(work.locator('#chatMessages')).toContainText('Espera un momento');
  await expect(work.locator('#chatMessages')).not.toContainText('rate_limited');
});

// B v3 (A3 N-2): con 30 tarjetas el botón «Confirmar todo» debe quedar a la vista (el chat no se va hasta la última tarjeta).
test('WORK: con 30 tarjetas, la tarjeta «Confirmar todo» queda a la vista en el teléfono', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.locator('#naWorkOverlay iframe')).toBeVisible();
  const props = Array.from({ length: 30 }, (_, i) => proposal({ id: 'work-precio-' + (i + 1), nombre: 'Arroz ' + (i + 1), precio_nuevo: 4.6 }));
  await installFakeEngine(page, proposal());
  if (!(await page.evaluate(() => !!(window as any).NA_ASISTENTE_CORE))) await page.addScriptTag({ path: 'POS/js/modules/asistente/asistente-core.js' }); // lógica del lote (pura)
  await page.evaluate(list => {
    const w = window as any;
    w.NA_ROLES.api = async () => ({ reply: 'Te preparé 30 cambios.', proposals: list });
  }, props);
  const work = page.frameLocator('#naWorkOverlay iframe');
  await work.locator('#promptInput').fill('sube todo un poco');
  await work.locator('#promptForm button[type="submit"]').click();
  const lote = work.locator('.na-card[data-kind="lote"]');
  await expect(lote).toBeVisible();
  await expect(work.locator('.na-card[data-kind="confirm"]')).toHaveCount(30);
  await expect(lote.getByRole('button', { name: /Confirmar todo \(30\)/ })).toBeInViewport();
  const view = await work.locator('#chatMessages').evaluate(el => { const r = el.getBoundingClientRect(); const c = document.querySelector('.na-card[data-kind="lote"]')!.getBoundingClientRect(); return { chatTop: r.top, chatBottom: r.bottom, top: c.top }; });
  expect(view.top).toBeGreaterThanOrEqual(view.chatTop - 2);
  expect(view.top).toBeLessThan(view.chatBottom);
});
