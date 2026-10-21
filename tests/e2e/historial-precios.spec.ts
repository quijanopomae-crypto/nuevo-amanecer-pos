import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { expectAllFit } from './helpers/fits';
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
  await page.goto('/index.html');
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
}

async function openForm(page: Page) {
  const modal = page.locator('#mProd');
  if (!await modal.evaluate(el => el.classList.contains('open'))) {
    await page.locator('#invBody tr', { hasText: 'Arroz historial' }).locator('.btn-edt').click();
  }
  await expect(modal).toHaveClass(/\bopen\b/);
  const section = page.locator('#mProd details.inv-form-section').filter({ has: page.locator('summary', { hasText: 'Precios' }) }).first();
  if (!await section.evaluate(el => (el as HTMLDetailsElement).open)) await section.locator('summary').click();
  await expect(page.locator('#pPriceHistory')).toBeVisible();
}

async function saveForm(page: Page) {
  await page.locator('#mProd .mbtn-ok').click();
  await expect(page.locator('#mProd')).not.toHaveClass(/\bopen\b/, { timeout: 20000 });
  await settlePersistence(page);
}

async function samePixels(page: Page, left: Buffer, right: Buffer) {
  return page.evaluate(async ({ left: a, right: b }) => {
    const load = (raw: string) => new Promise<ImageData>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('sin lienzo'));
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      };
      img.onerror = () => reject(new Error('png'));
      img.src = 'data:image/png;base64,' + raw;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return false;
    for (let i = 0; i < ia.data.length; i++) if (ia.data[i] !== ib.data[i]) return false;
    return true;
  }, { left: left.toString('base64'), right: right.toString('base64') });
}

function listed(page: Page) {
  return page.evaluate(id => (window as any).NA_PRICE_HISTORY.list(id), PRODUCT_ID);
}

test('la ficha anota el precio nuevo, ignora el mismo precio y deja la venta anterior intacta', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await setup(page);
  await openForm(page);
  await page.locator('#pPrecio').fill('5.50');
  await saveForm(page);
  let rows = await listed(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ type: 'venta', before: 4.5, after: 5.5, user: 'Ana Dueña', userId: 'hist-owner-1', origin: 'ficha' });

  await openForm(page);
  await expect(page.locator('#pPriceHistory li')).toHaveCount(1);
  await expect(page.locator('#pPriceHistory li').first()).toContainText('Venta: S/ 4.50 → S/ 5.50');
  await expect(page.locator('#pPriceHistory li').first()).toContainText('Ana Dueña · hist-owner-1 · Ficha del producto');
  await saveForm(page);
  expect(await listed(page)).toHaveLength(1);

  await openForm(page);
  await page.locator('#pPrecio').fill('6.00');
  await saveForm(page);
  rows = await listed(page);
  expect(rows.map(row => row.after)).toEqual([6, 5.5]);
  expect(rows.every(row => row.origin === 'ficha' && row.type === 'venta')).toBe(true);
  await openForm(page);
  const items = page.locator('#pPriceHistory li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('S/ 6.00');
  await expect(items.nth(1)).toContainText('S/ 5.50');

  expect(await page.evaluate(() => (0, eval)('ventas').find((row: { id: string }) => row.id === 'V-HIST-1').items[0].precio)).toBe(4.5);
  expect(await page.evaluate(() => localStorage.getItem('na_price_history_v1') || '')).not.toContain('V-HIST-1');
});

test('la importación anota el origen importación', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await setup(page);
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageConfig'));
  await expect(page.locator('#pageConfig')).toHaveClass(/\bactive\b/);
  await page.waitForFunction(() => !!(window as any).NA_CONFIG_V9);
  const openImport = page.locator('#naCfgV9 [data-act="imp"]');
  await expect(openImport).toBeVisible();
  await openImport.click();
  await expect(page.locator('#importFile')).toBeAttached();
  await page.locator('#importFile').setInputFiles({
    name: 'precios.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Nombre,SKU,Precio\nArroz historial,ARROZ-HIST,5.75\n', 'utf8')
  });
  await page.getByRole('button', { name: /Analizar archivo/ }).click();
  await expect(page.getByRole('button', { name: /Confirmar/ })).toBeVisible();
  await page.getByRole('button', { name: /Confirmar/ }).click();
  await expect.poll(() => listed(page)).toEqual([expect.objectContaining({ type: 'venta', before: 4.5, after: 5.75, origin: 'importacion', user: 'Ana Dueña', userId: 'hist-owner-1' })]);
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageInventario'));
  await page.evaluate(() => (window as any).invRender());
  await openForm(page);
  await expect(page.locator('#pPriceHistory')).toContainText('Importación');
  await expect(page.locator('#pPriceHistory')).toContainText('S/ 5.75');
  expect(await page.evaluate(() => (0, eval)('ventas').find((row: { id: string }) => row.id === 'V-HIST-1').items[0].precio)).toBe(4.5);
});

test('la compra anota el origen compra; sin revisión de producto en la réplica no se actualiza el costo ni la venta', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await setup(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__histCanon = true;
    const original = w.NA_ROLES.api.bind(w.NA_ROLES);
    w.NA_ROLES.api = async (path: string, body: { lines?: Array<{ line: number; product_id: string }> }, method?: string, headers?: Record<string, string>) => {
      if (String(path).startsWith('/auth/purchases') && method === 'POST') {
        return { applied: (body.lines || []).map(line => ({ line: line.line, product_id: line.product_id })), idempotent: false, total_cost_cents: 620 };
      }
      return original(path, body, method, headers);
    };
    w.NA_PURCHASES.open();
  });
  const dialog = page.locator('#naPurchaseDialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('.na-pur-prod').fill('Arroz historial');
  await dialog.locator('.na-pur-qty').fill('2');
  await dialog.locator('.na-pur-cost').fill('3.10');
  await dialog.locator('.na-pur-ok').click();
  await expect.poll(async () => {
    if (await dialog.count() === 0) return 'ok';
    const err = dialog.locator('.na-pur-err');
    if (await err.isVisible()) return await err.innerText();
    return 'espera';
  }).toBe('ok');
  const rows = await listed(page);
  expect(rows).toEqual([expect.objectContaining({ type: 'costo', before: 2, after: 3.1, origin: 'compra', user: 'Ana Dueña', userId: 'hist-owner-1' })]);
  expect(await page.evaluate(() => (0, eval)('productos').find((item: { id: number }) => item.id === 880221).costo)).toBe(2);
  expect(await page.evaluate(() => (0, eval)('ventas').find((row: { id: string }) => row.id === 'V-HIST-1').items[0].precio)).toBe(4.5);
  await openForm(page);
  await expect(page.locator('#pPriceHistory')).toContainText('Compra');
  await expect(page.locator('#pPriceHistory')).toContainText('Costo: S/ 2.00 → S/ 3.10');
});

test('el dueño ve el costo; el empleado y el dueño en caché no lo tienen en el HTML', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 768, height: 1024 });
  const me: Me = { status: 200, body: { ...ownerMe } };
  await setup(page, me);
  await openForm(page);
  await page.locator('#pPrecio').fill('5.10');
  await page.locator('#pCosto').fill('2.40');
  await saveForm(page);
  await openForm(page);
  await expect(page.locator('#pPriceHistory')).toContainText('Costo: S/ 2.00 → S/ 2.40');
  await expect(page.locator('#pPriceHistory')).toContainText('Venta: S/ 4.50 → S/ 5.10');
  await page.locator('#mProd .mbtn-cancel').click();

  me.body = { pos_role: 'empleado', owner_pin_set: true, roles_ready: true, device_id: 'hist-emp-1', label: 'Luis Caja' };
  await page.reload();
  await page.waitForFunction(() => {
    const roles = (window as any).NA_ROLES;
    return roles && roles.role === 'empleado' && roles.confirmed === true && roles.isOwner() === false;
  });
  await page.evaluate(() => { (window as any).NA_MENU_NAVIGATION.navigate('pageInventario'); (window as any).invRender(); });
  await openForm(page);
  const employeeHtml = await page.locator('#pPriceHistory').innerHTML();
  expect(employeeHtml).not.toContain('Costo');
  expect(employeeHtml).not.toContain('2.40');
  await expect(page.locator('#pPriceHistory')).toContainText('Venta');
  await expect(page.locator('#pPriceHistory')).not.toContainText('Costo');
  await page.locator('#mProd .mbtn-cancel').click();

  me.status = 500;
  me.body = { error: 'unavailable' };
  await page.evaluate(() => localStorage.setItem('na_pos_role_v1', JSON.stringify({ role: 'owner', label: 'Ana Dueña' })));
  const denied = page.waitForResponse(response => response.url().includes('/auth/me'));
  await page.reload();
  expect((await denied).status()).toBe(500);
  await page.waitForFunction(() => {
    const roles = (window as any).NA_ROLES;
    return roles && roles.role === 'owner' && roles.confirmed === false && roles.isOwner() === false;
  });
  await page.evaluate(() => { (window as any).NA_MENU_NAVIGATION.navigate('pageInventario'); (window as any).invRender(); });
  await openForm(page);
  const cachedHtml = await page.locator('#pPriceHistory').innerHTML();
  expect(cachedHtml).not.toContain('Costo');
  expect(cachedHtml).not.toContain('2.40');
  await expect(page.locator('#pPriceHistory')).toContainText('Venta');
  await expect(page.locator('#pPriceHistory')).not.toContainText('Costo');
});

test.describe('fecha en la zona del navegador', () => {
  test.use({ timezoneId: 'Pacific/Auckland' });
  test('no usa el desfase fijo de −5 h', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await setup(page);
    await page.evaluate(id => {
      (window as any).NA_PRICE_HISTORY.recordDiff({
        productId: id, origin: 'ficha', user: 'Ana Dueña', userId: 'hist-owner-1', at: '2026-10-20T18:30:00.000Z',
        partial: true, before: { venta: 4.5 }, after: { venta: 5.5 }
      });
    }, PRODUCT_ID);
    const label = await page.evaluate(() => {
      const d = new Date('2026-10-20T18:30:00.000Z');
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    });
    const fixed = await page.evaluate(() => {
      const d = new Date(Date.parse('2026-10-20T18:30:00.000Z') - 5 * 60 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    });
    expect(label).not.toBe(fixed);
    await openForm(page);
    await expect(page.locator('#pPriceHistory time')).toHaveText(label);
  });
});

test('el historial no se desborda a 390, 768 ni 1366, en claro y en nocturno', async ({ page }) => {
  test.setTimeout(60_000);
  await setup(page);
  await page.evaluate(id => {
    const api = (window as any).NA_PRICE_HISTORY;
    api.recordDiff({
      productId: id, origin: 'ficha', user: 'Ana Dueña del puesto de abarrotes con nombre bien largo',
      userId: 'hist-owner-device-identifier-largo', at: '2026-10-20T18:30:00.000Z',
      before: { venta: 4.5, mayorista: null, costo: 2 }, after: { venta: 5.5, mayorista: 48, costo: 2.4 }
    });
    api.recordDiff({
      productId: id, origin: 'importacion', user: 'Ana Dueña', userId: 'hist-owner-1', at: '2026-10-19T12:00:00.000Z',
      partial: true, before: { venta: 4 }, after: { venta: 4.5 }
    });
  }, PRODUCT_ID);
  await openForm(page);
  for (const width of [390, 768, 1366]) for (const dark of [false, true]) {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
    await page.evaluate(night => (window as any).NA_THEME.setMode(night ? 'noche' : 'claro'), dark);
    if (dark) await expect(page.locator('body')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('body')).not.toHaveClass(/\bdark\b/);
    await expect(page.locator('#pPriceHistory li').first()).toBeVisible();
    await expectAllFit(page.locator('#mProd .modal'), '#pPriceHistory, #pPriceHistory *');
  }
});

test('Venta e Inicio quedan igual que sin la hoja del historial', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await setup(page);
  for (const id of ['pageMenu', 'pagePOS'] as const) {
    await page.evaluate(target => target === 'pageMenu' ? (window as any).goMenu() : (window as any).NA_MENU_NAVIGATION.navigate(target), id);
    await expect(page.locator('#' + id)).toHaveClass(/\bactive\b/);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.locator(`#${id} #pPriceHistory`).count()).toBe(0);
    await page.evaluate(() => {
      for (const nodeId of ['saveStatus', 'gToast', 'localStatus']) {
        const node = document.getElementById(nodeId);
        if (node) node.style.visibility = 'hidden';
      }
    });
    const side = page.locator('#posSidebar');
    const sideVisible = await side.isVisible();
    const before = await page.screenshot({ animations: 'disabled' });
    const sideBefore = sideVisible ? await side.screenshot({ animations: 'disabled' }) : null;
    const geometry = await page.evaluate(pageId => {
      const root = document.getElementById(pageId);
      const side = document.getElementById('posSidebar');
      const sheet = [...document.styleSheets].find(item => item.href?.endsWith('/css/price-history.css'));
      if (!root || !sheet) throw new Error('Falta la pantalla o price-history.css');
      const measure = () => [...root.querySelectorAll(':scope > *, .pos-body > *, .home-shell > *'), ...(side ? [...side.querySelectorAll(':scope > *')] : [])].map(node => {
        const rect = node.getBoundingClientRect();
        const css = getComputedStyle(node);
        return [node.className, Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height), css.display, css.gridTemplateColumns];
      });
      const withFeature = measure();
      sheet.disabled = true;
      const baseline = measure();
      return { withFeature, baseline };
    }, id);
    expect(geometry.withFeature.length).toBeGreaterThan(3);
    expect(geometry.withFeature).toEqual(geometry.baseline);
    const after = await page.screenshot({ animations: 'disabled' });
    const sideAfter = sideVisible ? await side.screenshot({ animations: 'disabled' }) : null;
    writeFileSync(test.info().outputPath(`${id}-con-historial.png`), before);
    writeFileSync(test.info().outputPath(`${id}-base.png`), after);
    expect(await samePixels(page, before, after)).toBe(true);
    if (sideBefore && sideAfter) expect(await samePixels(page, sideBefore, sideAfter)).toBe(true);
    await page.evaluate(() => {
      const sheet = [...document.styleSheets].find(item => item.href?.endsWith('/css/price-history.css'));
      if (sheet) sheet.disabled = false;
    });
  }
  const sideText = await page.locator('#posSidebar').innerText();
  expect(sideText).not.toContain('Historial de precios');
});
