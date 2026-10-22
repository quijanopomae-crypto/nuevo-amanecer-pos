import { test, expect, type Page } from '@playwright/test';

// Misión 7: ajustes de inventario (merma/rotura/vencido/corrección). Datos sintéticos, modo local.
async function rolePage(page: Page, role: 'owner' | 'empleado') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: role, owner_pin_set: true, roles_ready: true, device_id: 'aj-test-device' } : url.pathname === '/auth/purchases' ? { purchases: [], truncated: false } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(role => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'aj-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role }));
  }, role);
  await page.reload();
  await page.waitForFunction(role => (window as any).NA_ROLES?.role === role && (window as any).NA_ROLES.confirmed, role);
}
async function seed(page: Page) {
  await page.evaluate(() => (window as any).eval(`
    productos=[{id:'aj-1',name:'Yogurt "fresa" · 1L | promo',sku:'AJ-01',stock:10,costo:4,precio:6,controlInventario:true},{id:'aj-2',name:'Pan',sku:'AJ-02',stock:5,controlInventario:true}];
    inventoryMovements=[{id:'aj-buy',productId:'aj-1',type:'ENTRADA',delta:4,timestamp:new Date().toISOString(),reason:'Compra a proveedor',fecha:new Date().toISOString().slice(0,10)}];
    ventas=[];
    window._naGetActiveCashier=()=>({id:'C-0007',nombre:'María "Mary" · Caja | 1'});
  `));
}
const sales = (page: Page) => page.evaluate(() => (window as any).eval('JSON.stringify({ventas,creditos,cajMovs,cajEstado})'));
async function openCard(page: Page) {
  await page.evaluate(() => (window as any).goPage('pageProximamente'));
  const card = page.locator('[data-feature-id="ajustes-inventario"]');
  await expect(card).toHaveClass(/is-enabled/);
  await card.click();
  await expect(page.locator('#pageAjustesInventario')).toBeVisible();
}

for (const width of [390, 768, 1280]) for (const dark of [false, true]) {
  test(`dueño registra una merma a ${width}px ${dark ? 'oscuro' : 'claro'}: baja stock por movimiento, reporte y CSV`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner');
    await seed(page);
    const before = await sales(page);
    await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
    await openCard(page);
    const screen = page.locator('#pageAjustesInventario');
    await screen.locator('[data-aj-search]').fill('yogurt');
    await screen.locator('[data-aj-product]').selectOption('aj-1');
    await screen.locator('[data-aj-type]').selectOption('merma');
    await expect(screen.locator('[data-aj-direction-wrap]')).toBeHidden();
    await screen.locator('[data-aj-qty]').fill('2');
    await screen.locator('[data-aj-note]').fill('Envase "inflado" | lote · A');
    await screen.locator('[data-aj-submit]').click();
    await expect(screen.locator('[data-aj-message]')).toHaveText('Ajuste registrado.');
    const state = await page.evaluate(() => (window as any).eval('JSON.stringify({p:productos.find(x=>x.id==="aj-1"),m:inventoryMovements.filter(x=>x.productId==="aj-1")})'));
    const { p, m } = JSON.parse(state);
    expect(p.stock).toBe(8);
    const adj = m.filter((x: any) => String(x.reason).startsWith('ajuste:v1:'));
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ type: 'SALIDA', delta: -2 });
    const row = screen.locator('[data-aj-row="merma"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Yogurt "fresa" · 1L | promo');
    await expect(row).toContainText('María "Mary" · Caja | 1 · C-0007');
    await expect(row).toContainText('Envase "inflado" | lote · A');
    const limaDate = await page.evaluate(() => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()));
    await expect(row.locator('td').first()).toContainText(limaDate);
    await expect(screen.locator('[data-aj-row]')).toHaveCount(1); // la compra normal no aparece
    await expect(screen.locator('[data-aj-sum="merma"]')).toHaveText('-2');
    // Contraste mínimo del texto en filas y botón
    const ok = await screen.evaluate(node => {
      const lum = (c: string) => { const v = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
      const bg = (el: Element | null): string => { while (el) { const b = getComputedStyle(el).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; el = el.parentElement; } return 'rgb(255,255,255)'; };
      return [...node.querySelectorAll('td, [data-aj-submit], h1, h2')].every(el => { const a = lum(getComputedStyle(el).color), b = lum(bg(el)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5; });
    });
    expect(ok).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const [download] = await Promise.all([page.waitForEvent('download'), screen.locator('[data-aj-export]').click()]);
    const csv = await (await download.createReadStream()).toArray().then(c => Buffer.concat(c).toString('utf8'));
    expect(csv).toContain('"Yogurt ""fresa"" · 1L | promo",Merma,-2');
    expect(await sales(page)).toBe(before);
  });
}

test('empleado no ve ni registra ajustes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await rolePage(page, 'empleado');
  await seed(page);
  const res = await page.evaluate(async () => { const w = window as any; w.goPage?.('pageAjustesInventario'); w.NA_AJUSTES_INVENTARIO.render(); return w.NA_AJUSTES_INVENTARIO.register({ productId: 'aj-1', type: 'merma', quantity: 1 }); });
  expect(res.ok).toBe(false);
  expect(await page.evaluate(() => (window as any).eval('productos[0].stock'))).toBe(10);
  await expect(page.locator('#pageAjustesInventario [data-aj-main]')).toBeHidden();
  await expect(page.locator('#pageAjustesInventario [data-aj-report] tr')).toHaveCount(0);
});

// Bloqueo provisional: en CANON el Worker no deja elegir el lote de una SALIDA (descuenta primero lotes
// vigentes), así que «Rotura» y «Vencido» se desactivan en productos con lotes.
async function canonWithLots(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__ajSent = [];
    const lot = (id: string, expiry: string, quantity: number) => ({ lot_id: id, lot_code: id, expiry_date: expiry, received_at: '2026-09-01T00:00:00Z', quantity });
    const products = [
      { product_id: 'c-lot', name: 'Leche con lotes', stock: 8, lots: [lot('L-VENC', '2026-10-01', 3), lot('L-OK', '2099-12-01', 5)] },
      { product_id: 'c-plain', name: 'Pan sin lotes', stock: 4 }
    ];
    w.NuevoAmanecerCanonical = { ...(w.NuevoAmanecerCanonical || {}), enabled: () => true, snapshot: () => ({ products, inventoryMovements: [] }),
      adjustInventory: async (b: any) => { w.__ajSent.push(b); return { ok: true }; }, refresh: async () => {} };
    w.NA_AJUSTES_INVENTARIO.render();
  });
}
for (const width of [390, 768, 1280]) {
  test(`CANON a ${width}px: «Rotura» y «Vencido» desactivados en productos con lotes, con explicación; Merma y Corrección siguen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner');
    await openCard(page);
    await canonWithLots(page);
    const screen = page.locator('#pageAjustesInventario');
    const type = screen.locator('[data-aj-type]'), note = screen.locator('[data-aj-lot-note]');
    const disabled = () => type.evaluate((s: HTMLSelectElement) => [...s.options].filter(o => o.disabled).map(o => o.value));
    await expect(screen.locator('[data-aj-status]')).toContainText('CANON');
    // Sin lotes: todo habilitado y sin aviso.
    await screen.locator('[data-aj-product]').selectOption('c-plain');
    await type.selectOption('vencido');
    expect(await disabled()).toEqual([]);
    await expect(note).toBeHidden();
    // Con lotes: Rotura y Vencido desactivados; la selección pasa a Merma y se explica en español.
    await screen.locator('[data-aj-product]').selectOption('c-lot');
    expect(await disabled()).toEqual(['rotura', 'vencido']);
    await expect(type).toHaveValue('merma');
    await expect(type.locator('option[value="vencido"]')).toHaveText('Vencido (no disponible con lotes)');
    // Las opciones desactivadas se ven en gris, distinto de las habilitadas, en claro y en oscuro.
    for (const [dark, expected] of [[false, 'rgb(100, 116, 139)'], [true, 'rgb(148, 163, 184)']] as const) {
      await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
      const colors = await type.evaluate((s: HTMLSelectElement) => Object.fromEntries([...s.options].map(o => [o.value, getComputedStyle(o).color])));
      expect(colors.rotura, dark ? 'oscuro' : 'claro').toBe(expected);
      expect(colors.vencido).toBe(expected);
      expect(colors.merma).not.toBe(expected);
      expect(colors.correccion).not.toBe(expected);
    }
    await page.evaluate(() => document.body.classList.remove('dark'));
    await expect(note).toBeVisible();
    await expect(note).toContainText('Este producto tiene lotes');
    await expect(note).toContainText('Se habilitarán cuando el servidor permita elegir el lote');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    // Forzar «Vencido» saltándose la interfaz: la guardia de register no envía nada a CANON.
    await type.evaluate((s: HTMLSelectElement) => { s.value = 'vencido'; });
    await screen.locator('[data-aj-qty]').fill('1');
    await screen.locator('[data-aj-submit]').click();
    await expect(screen.locator('[data-aj-message]')).toContainText('Se habilitarán cuando el servidor permita elegir el lote');
    await expect(screen.locator('[data-aj-message]')).toHaveAttribute('data-aj-ok', 'false');
    for (const t of ['rotura', 'vencido']) {
      const res = await page.evaluate(t => (window as any).NA_AJUSTES_INVENTARIO.register({ productId: 'c-lot', type: t, quantity: 1 }), t);
      expect(res).toMatchObject({ ok: false, blocked: 'LOTS_REQUIRE_LOT_SELECTION' });
    }
    expect(await page.evaluate(() => (window as any).__ajSent.length)).toBe(0);
    // Merma sí se registra en el producto con lotes.
    await type.selectOption('merma');
    await screen.locator('[data-aj-qty]').fill('1');
    await screen.locator('[data-aj-submit]').click();
    await expect(screen.locator('[data-aj-message]')).toHaveText('Ajuste registrado.');
    const sent = await page.evaluate(() => (window as any).__ajSent.map((b: any) => [b.product_id, b.movement_type, b.reason.slice(0, 10)]));
    expect(sent).toEqual([['c-lot', 'SALIDA', 'ajuste:v1:']]);
    // Corrección también.
    await type.selectOption('correccion');
    await screen.locator('[data-aj-direction]').selectOption('sumar');
    await screen.locator('[data-aj-qty]').fill('2');
    await screen.locator('[data-aj-submit]').click();
    await expect(screen.locator('[data-aj-message]')).toHaveText('Ajuste registrado.');
    expect(await page.evaluate(() => (window as any).__ajSent.map((b: any) => b.movement_type))).toEqual(['SALIDA', 'ENTRADA']);
    // Contraste del aviso en claro y oscuro.
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
      const ratio = await note.evaluate(el => {
        const lum = (c: string) => { const v = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
        let n: Element | null = el, bg = 'rgb(255,255,255)';
        while (n) { const b = getComputedStyle(n).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(b)) { bg = b; break; } n = n.parentElement; }
        const a = lum(getComputedStyle(el).color), b = lum(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      expect(ratio, dark ? 'oscuro' : 'claro').toBeGreaterThanOrEqual(4.5);
    }
    // Volver a un producto sin lotes reactiva las opciones.
    await screen.locator('[data-aj-product]').selectOption('c-plain');
    expect(await disabled()).toEqual([]);
    await expect(type.locator('option[value="vencido"]')).toHaveText('Vencido');
    await expect(note).toBeHidden();
  });
}

test('CANON: una Merma rechazada por lotes vencidos muestra el mensaje en español, no el código crudo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await rolePage(page, 'owner');
  await openCard(page);
  await page.evaluate(() => {
    const w = window as any;
    const products = [{ product_id: 'c-exp', name: 'Leche solo vencida', stock: 2, lots: [{ lot_id: 'L-V', lot_code: 'L-V', expiry_date: '2026-10-01', received_at: '2026-09-01T00:00:00Z', quantity: 2 }] }];
    let journal: any = null;
    w.NuevoAmanecerCanonical = { ...(w.NuevoAmanecerCanonical || {}), enabled: () => true, snapshot: () => ({ products, inventoryMovements: [] }), refresh: async () => {},
      adjustInventory: async (b: any) => { journal = { state: 'PENDING', command: 'inventory.adjust', payload: b, last_error: 'expired_lots_confirmation_required', last_status: 409 }; throw new Error('CANONICAL_FINANCIAL_REJECTED_409'); },
      pendingSnapshot: () => journal, discardRejectedInventory: async () => { journal = null; w.__ajDiscarded = true; return true; } };
    w.NA_AJUSTES_INVENTARIO.render();
  });
  const screen = page.locator('#pageAjustesInventario'), msg = screen.locator('[data-aj-message]');
  await screen.locator('[data-aj-product]').selectOption('c-exp');
  await expect(screen.locator('[data-aj-type]')).toHaveValue('merma');
  await screen.locator('[data-aj-qty]').fill('1');
  await screen.locator('[data-aj-submit]').click();
  await expect(msg).toContainText('Este producto solo tiene stock en lotes vencidos');
  await expect(msg).toContainText('botón «Salida»');
  await expect(msg).toHaveAttribute('data-aj-ok', 'false');
  await expect(msg).not.toContainText('EXPIRED');
  await expect(msg).not.toContainText('CANONICAL_FINANCIAL');
  expect(await page.evaluate(() => (window as any).__ajDiscarded)).toBe(true);
});

test('cantidad: el campo valida en vivo (enteros, stock, tope) y register() rechaza lo mismo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await rolePage(page, 'owner');
  await seed(page);
  await openCard(page);
  const screen = page.locator('#pageAjustesInventario'), qty = screen.locator('[data-aj-qty]'), err = screen.locator('[data-aj-qty-error]');
  await screen.locator('[data-aj-product]').selectOption('aj-1');
  await screen.locator('[data-aj-type]').selectOption('merma');
  // Campo de texto (no type=number): el navegador no altera lo tecleado; la validación lee el texto crudo.
  await expect(qty).toHaveAttribute('type', 'text');
  await expect(qty).toHaveAttribute('inputmode', 'decimal');
  for (const [value, text] of [['0.5', 'unidades enteras'], ['11', 'más que el stock actual (10)'], ['0', 'mayor que 0'], ['1000000000000', 'no puede superar']]) {
    await qty.fill(value);
    await expect(err).toBeVisible();
    await expect(err).toContainText(text);
    await expect(qty).toHaveAttribute('aria-invalid', 'true');
  }
  await qty.fill('0.5');
  await screen.locator('[data-aj-submit]').click();
  await expect(screen.locator('[data-aj-message]')).toContainText('unidades enteras');
  expect(await page.evaluate(() => (window as any).eval('productos.find(x=>x.id==="aj-1").stock'))).toBe(10);
  await qty.fill('2');
  await expect(err).toBeHidden();
  await expect(qty).not.toHaveAttribute('aria-invalid', 'true');
  await screen.locator('[data-aj-submit]').click();
  await expect(screen.locator('[data-aj-message]')).toHaveText('Ajuste registrado.');
  expect(await page.evaluate(() => (window as any).eval('productos.find(x=>x.id==="aj-1").stock'))).toBe(8);
});

// Seguimiento #869 (B2): con type=number el navegador convertía «1,5» en 15 y «0x10» en 010. Se teclea de verdad.
async function seedUnits(page: Page) {
  await page.evaluate(() => (window as any).eval(`
    productos=[{id:'kg-1',name:'Arroz a granel',sku:'KG-01',unit:'kilogramo',stock:10,controlInventario:true},{id:'un-1',name:'Galleta',sku:'UN-01',unit:'unidad',stock:10,controlInventario:true}];
    inventoryMovements=[]; ventas=[];
  `));
}
const stockOf = (page: Page, id: string) => page.evaluate(id => (window as any).eval(`productos.find(x=>x.id===${JSON.stringify(id)}).stock`), id);
const adjDeltas = (page: Page, id: string) => page.evaluate(id => (window as any).eval(`JSON.stringify(inventoryMovements.filter(x=>x.productId===${JSON.stringify(id)}&&String(x.reason).startsWith('ajuste:v1:')).map(x=>x.delta))`), id).then(JSON.parse);

test('cantidad tecleada: «1,5»/«2,5»/«.5» en kg valen 1.5/2.5/0.5; en unidad «1,5» se rechaza; «0x10», «+2» y «1e12» se rechazan', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await rolePage(page, 'owner');
  await seedUnits(page);
  await openCard(page);
  const screen = page.locator('#pageAjustesInventario'), qty = screen.locator('[data-aj-qty]'), err = screen.locator('[data-aj-qty-error]'), msg = screen.locator('[data-aj-message]');
  async function type(value: string) {
    await qty.fill('');
    await qty.click();
    await page.keyboard.type(value);
    await expect(qty).toHaveValue(value); // el navegador no lo altera (antes «1,5» quedaba en «15»)
  }
  await screen.locator('[data-aj-type]').selectOption('merma');
  // Producto por kilogramo: la coma decimal se respeta.
  await screen.locator('[data-aj-product]').selectOption('kg-1');
  // Se mira el delta registrado de cada ajuste (el ledger local trunca el stock fraccionario previo; ver PR).
  const expected: number[] = [];
  for (const [typed, delta] of [['1,5', -1.5], ['2,5', -2.5], ['.5', -0.5], [',5', -0.5]] as const) {
    await type(typed);
    await expect(err).toBeHidden();
    await expect(qty).not.toHaveAttribute('aria-invalid', 'true');
    await screen.locator('[data-aj-submit]').click();
    expected.push(delta);
    await expect.poll(() => adjDeltas(page, 'kg-1'), { message: typed }).toEqual(expected);
    await expect(msg).toHaveText('Ajuste registrado.');
  }
  expect(await adjDeltas(page, 'kg-1')).toEqual([-1.5, -2.5, -0.5, -0.5]);
  const kgBefore = await stockOf(page, 'kg-1');
  for (const [typed, text] of [['0x10', 'Ingresa una cantidad válida mayor que 0.'], ['+2', 'Ingresa una cantidad válida mayor que 0.'], ['1e12', 'no puede superar 1,000,000 por ajuste']]) {
    await type(typed);
    await expect(err).toContainText(text);
    await expect(qty).toHaveAttribute('aria-invalid', 'true');
    await screen.locator('[data-aj-submit]').click();
    await expect(msg).toContainText(text);
    await expect(msg).toHaveAttribute('data-aj-ok', 'false');
  }
  // Los rechazados no cambian stock ni registran movimiento.
  expect(await stockOf(page, 'kg-1')).toBe(kgBefore);
  expect(await adjDeltas(page, 'kg-1')).toEqual(expected);
  // Producto por unidad: «1,5» no es entero; «0x10» y «+2» tampoco valen; «.5» tampoco.
  await screen.locator('[data-aj-product]').selectOption('un-1');
  for (const [typed, text] of [['1,5', 'unidades enteras'], ['2,5', 'unidades enteras'], ['.5', 'unidades enteras'], ['0x10', 'mayor que 0'], ['+2', 'mayor que 0']]) {
    await type(typed);
    await expect(err).toContainText(text);
    await screen.locator('[data-aj-submit]').click();
    await expect(msg).toContainText(text);
  }
  expect(await stockOf(page, 'un-1')).toBe(10);
  expect(await adjDeltas(page, 'un-1')).toEqual([]);
  await type('2');
  await screen.locator('[data-aj-submit]').click();
  await expect(msg).toHaveText('Ajuste registrado.');
  expect(await stockOf(page, 'un-1')).toBe(8);
});

for (const width of [390, 1280]) {
  test(`campo Cantidad (texto) a ${width}px: misma altura y relleno que los demás campos; el error no estira «Tipo»`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner');
    await seedUnits(page);
    await openCard(page);
    const screen = page.locator('#pageAjustesInventario');
    await screen.locator('[data-aj-product]').selectOption('un-1');
    const box = (sel: string) => screen.locator(sel).evaluate(el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return { h: Math.round(r.height), p: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft, s.borderTopWidth, s.fontSize].join(' ') }; });
    const qty = await box('[data-aj-qty]'), search = await box('[data-aj-search]'), type = await box('[data-aj-type]');
    expect(qty.h).toBe(44); expect(type.h).toBe(44);
    expect(qty).toEqual(search);
    await screen.locator('[data-aj-qty]').fill('1,5');
    await expect(screen.locator('[data-aj-qty-error]')).toBeVisible();
    expect((await box('[data-aj-type]')).h).toBe(44);
    expect((await box('[data-aj-qty]')).h).toBe(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

// Seguimiento #869 (B1): si falla la lectura de estado previa al envío, el ajuste queda pendiente en el diario
// de CANON y se reintentará solo. Aviso ámbar (no rojo) y «Registrar» desactivado mientras siga pendiente.
for (const width of [390, 1280]) {
  test(`CANON a ${width}px: ajuste pendiente por fallo de la lectura de estado → aviso ámbar, «Registrar» desactivado hasta que se confirma`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await rolePage(page, 'owner');
    await openCard(page);
    await page.evaluate(() => {
      const w = window as any;
      const products = [{ product_id: 'c-1', name: 'Pan', unit: 'unidad', stock: 20 }];
      w.__aj = { journal: null as any, receipt: null as any, sent: 0 };
      w.NuevoAmanecerCanonical = { ...(w.NuevoAmanecerCanonical || {}), enabled: () => true, snapshot: () => ({ products, inventoryMovements: [] }), refresh: async () => {},
        // Como canonical-client: guarda la entrada PENDING y falla el GET /read/canonical/status (503).
        adjustInventory: async (b: any) => { w.__aj.sent++; w.__aj.journal = { state: 'PENDING', command: 'inventory.adjust', payload: b }; throw new Error('CANONICAL_READ_503'); },
        pendingSnapshot: () => w.__aj.journal && JSON.parse(JSON.stringify(w.__aj.journal)), receiptSnapshot: () => w.__aj.receipt,
        discardRejectedInventory: async () => false };
      w.NA_AJUSTES_INVENTARIO.render();
    });
    const screen = page.locator('#pageAjustesInventario'), msg = screen.locator('[data-aj-message]'), btn = screen.locator('[data-aj-submit]');
    await screen.locator('[data-aj-product]').selectOption('c-1');
    await screen.locator('[data-aj-qty]').fill('1');
    await btn.click();
    await expect(msg).toContainText('El ajuste quedó pendiente y se reintentará solo');
    await expect(msg).toContainText('No lo registres de nuevo.');
    await expect(msg).not.toContainText('no registró');
    await expect(msg).toHaveAttribute('data-aj-ok', 'pending');
    await expect(btn).toBeDisabled();
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
      const look = await msg.evaluate(el => {
        const lum = (c: string) => { const v = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
        let n: Element | null = el, bg = 'rgb(255,255,255)';
        while (n) { const b = getComputedStyle(n).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(b)) { bg = b; break; } n = n.parentElement; }
        const color = getComputedStyle(el).color, a = lum(color), b = lum(bg);
        return { color, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      });
      // Ámbar del tema (#92400e claro / #fcd34d oscuro), no el rojo de error (#991b1b / #fca5a5).
      expect(look.color, dark ? 'oscuro' : 'claro').toBe(dark ? 'rgb(252, 211, 77)' : 'rgb(146, 64, 14)');
      expect(look.ratio, dark ? 'oscuro' : 'claro').toBeGreaterThanOrEqual(4.5);
    }
    await page.evaluate(() => document.body.classList.remove('dark'));
    // Aunque llegue una actualización de CANON, sigue desactivado mientras la entrada propia siga pendiente.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('na:canonical-updated')));
    await expect(btn).toBeDisabled();
    await btn.click({ force: true });
    expect(await page.evaluate(() => (window as any).__aj.sent)).toBe(1);
    // El reintento (banner al reconectar) la confirma: se libera «Registrar».
    await page.evaluate(() => { const a = (window as any).__aj; a.receipt = { operation_id: a.journal.payload.operation_id }; a.journal = null; window.dispatchEvent(new CustomEvent('na:canonical-updated')); });
    await expect(btn).toBeEnabled();
    await expect(msg).toHaveText('El ajuste pendiente se confirmó en CANON.');
    await expect(msg).toHaveAttribute('data-aj-ok', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}
