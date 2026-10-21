import { test, expect, type Page } from '@playwright/test';

// Montos y cantidades escritos a mano (incluido Cobrar). Se teclea de verdad (keyboard.type, no fill):
// con <input type="number"> Chrome descartaba la coma («4,50» → 450). Formato del dueño: coma de miles, punto decimal
// («1,000.00»); una coma con 1 o 2 dígitos es decimal («4,50»). Datos sintéticos, sin servidor real.
test.use({ locale: 'es-PE' });

async function typeInto(page: Page, selector: string, text: string, how: 'click' | 'focus' = 'click') {
  const field = page.locator(selector);
  // Tras escribir en el campo de producto (datalist), Firefox deja abierta la lista nativa y un clic de
  // Playwright puede quedarse colgado; ahí se entra al campo con el foco (como con Tab), no con el ratón.
  if (how === 'focus') await field.focus(); else await field.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
}
const ev = <T = any>(page: Page, code: string) => page.evaluate(c => (0, eval)(c), code) as Promise<T>;

async function localPage(page: Page, width = 390) {
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).NA_DECIMAL && typeof (window as any).editProd === 'function' && typeof (window as any).guardarGasto === 'function');
}

// Dueño con CANON simulado (mismo patrón que costo-compra-ficha.spec.ts).
async function ownerCanon(page: Page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'coma-device' } : url.pathname === '/auth/purchases' ? { purchases: [], truncated: false } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'coma-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role: 'owner' }));
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.role === 'owner' && (window as any).NA_ROLES.confirmed);
  await page.evaluate(() => {
    (0, eval)(`productos=[{id:'cc-1',name:'Aceite 1L',nombre:'Aceite 1L',sku:'CC-01',stock:20,stockMin:2,costo:4,precio:6,controlInventario:true,unidad:'unidad',cat:'abarrotes',marca:'Sin marca'}];inventoryMovements=[];ventas=[];`);
    const w = window as any, real = w.NuevoAmanecerCanonical, wrapped: Record<string, unknown> = {};
    for (const key of Object.keys(real)) { const v = real[key]; wrapped[key] = typeof v === 'function' ? v.bind(real) : v; }
    const raw = { product_id: 'cc-1', metadata_revision: 2, name: 'Aceite 1L', sku: 'CC-01', barcode: null, alternate_codes_json: '[]', category: 'abarrotes', brand: null,
      description: null, icon: null, cost_cents: 400, price_cents: 600, box_price_cents: null, units_per_box: null, stock_min_quantity: 2, expiry_date: null };
    w.__sent = []; w.__purchases = [];
    wrapped.enabled = () => true;
    wrapped.commandContext = () => ({ promotion_id: 'coma', authority_epoch: 1, expected_control_revision: 1, client_contract: 'test', created_at: new Date().toISOString() });
    wrapped.prepareCommand = async () => {};
    wrapped.refresh = async () => {};
    wrapped.snapshot = () => ({ products: [raw], inventoryMovements: [] });
    wrapped.updateProduct = async (b: any) => { w.__sent.push(b); raw.cost_cents = b.cost_cents; raw.metadata_revision++; (0, eval)('productos')[0].costo = b.cost_cents / 100; return { ok: true }; };
    w.NuevoAmanecerCanonical = wrapped;
    const original = w.NA_ROLES.api.bind(w.NA_ROLES);
    w.NA_ROLES.api = async (path: string, body: any, method?: string, headers?: any) => {
      if (String(path).startsWith('/auth/purchases') && method === 'POST') { w.__purchases.push(body); return { applied: body.lines.map((l: any) => ({ line: l.line, product_id: l.product_id })), idempotent: false }; }
      return original(path, body, method, headers);
    };
  });
}

for (const [typed, cents] of [['4,50', 450], ['4,5', 450], [',50', 50], ['4.50', 450], ['1,000.00', 100000], ['1,000', 100000]] as const) {
  test(`Compras: costo «${typed}» tecleado → compra ${cents} céntimos y costo del producto ${cents} céntimos`, async ({ page }) => {
    await ownerCanon(page);
    await page.evaluate(() => (window as any).NA_PURCHASES.open());
    const dialog = page.locator('#naPurchaseDialog');
    await expect(dialog.locator('.na-pur-cost')).toHaveAttribute('type', 'text');
    await expect(dialog.locator('.na-pur-cost')).toHaveAttribute('inputmode', 'decimal');
    await typeInto(page, '#naPurchaseDialog .na-pur-prod', 'Aceite 1L');
    await typeInto(page, '#naPurchaseDialog .na-pur-qty', '2', 'focus');
    await typeInto(page, '#naPurchaseDialog .na-pur-cost', typed, 'focus');
    await expect(dialog.locator('.na-pur-total')).toContainText('S/ ' + (cents * 2 / 100).toFixed(2));
    await dialog.locator('.na-pur-ok').click();
    await expect(dialog).toHaveCount(0);
    const posted = await page.evaluate(() => (window as any).__purchases);
    expect(posted).toHaveLength(1);
    expect(posted[0].lines).toEqual([expect.objectContaining({ product_id: 'cc-1', quantity: 2, unit_cost_cents: cents })]);
    await expect.poll(() => page.evaluate(() => (window as any).__sent.length)).toBe(1);
    expect((await page.evaluate(() => (window as any).__sent))[0]).toMatchObject({ product_id: 'cc-1', cost_cents: cents });
    expect(await ev(page, 'productos[0].costo')).toBe(cents / 100);
  });
}

test('Compras: cantidad «2,5» tecleada se envía como 2.5', async ({ page }) => {
  await ownerCanon(page);
  await page.evaluate(() => (window as any).NA_PURCHASES.open());
  await typeInto(page, '#naPurchaseDialog .na-pur-prod', 'Aceite 1L');
  await typeInto(page, '#naPurchaseDialog .na-pur-qty', '2,5', 'focus');
  await typeInto(page, '#naPurchaseDialog .na-pur-cost', '4,00', 'focus');
  await expect(page.locator('#naPurchaseDialog .na-pur-total')).toContainText('S/ 10.00');
  await page.locator('#naPurchaseDialog .na-pur-ok').click();
  await expect(page.locator('#naPurchaseDialog')).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__purchases))[0].lines[0]).toMatchObject({ quantity: 2.5, unit_cost_cents: 400 });
});

for (const [field, typed, message] of [
  ['cost', '1.234,50', /Línea 1, costo: Formato europeo no válido/],
  ['cost', '1,2345', /Línea 1, costo: Tras la coma: 1-2 decimales o 3 dígitos/],
  ['cost', '1e2', /Línea 1, costo: Sin exponentes/],
  ['cost', '+2', /Línea 1, costo: Sin signos/],
  ['qty', '1e2', /Línea 1, cantidad: Sin exponentes/],
] as const) {
  test(`Compras: ${field} «${typed}» se rechaza con aviso y no se envía nada`, async ({ page }) => {
    await ownerCanon(page);
    await page.evaluate(() => (window as any).NA_PURCHASES.open());
    await typeInto(page, '#naPurchaseDialog .na-pur-prod', 'Aceite 1L');
    await typeInto(page, '#naPurchaseDialog .na-pur-qty', field === 'qty' ? typed : '2', 'focus');
    await typeInto(page, '#naPurchaseDialog .na-pur-cost', field === 'cost' ? typed : '4,50', 'focus');
    await page.locator('#naPurchaseDialog .na-pur-ok').click();
    await expect(page.locator('#naPurchaseDialog .na-pur-err')).toHaveText(message);
    await expect(page.locator(`#naPurchaseDialog .na-pur-${field}`)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#naPurchaseDialog')).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).__purchases.length)).toBe(0);
    expect(await page.evaluate(() => (window as any).__sent.length)).toBe(0);
    expect(await ev(page, 'productos[0].costo')).toBe(4);
  });
}

test('Ficha de producto (local): «4,50» / «6,50» se guardan como 4.5 / 6.5; «1.234,50» avisa y no guarda', async ({ page }) => {
  await localPage(page);
  await ev(page, `productos=[{id:'pf-1',name:'Arroz 1kg',nombre:'Arroz 1kg',sku:'PF-01',stock:5,stockMin:1,costo:3,precio:5,controlInventario:true,unidad:'unidad',cat:'abarrotes',marca:'Sin marca'}];`);
  await page.evaluate(() => (window as any).editProd('pf-1'));
  await page.evaluate(() => { document.querySelectorAll('#mProd details').forEach(d => ((d as HTMLDetailsElement).open = true)); });
  for (const id of ['pCosto', 'pPrecio', 'pPrecioCaja', 'pFactorCompra']) {
    await expect(page.locator('#' + id)).toHaveAttribute('type', 'text');
    await expect(page.locator('#' + id)).toHaveAttribute('inputmode', 'decimal');
  }
  await typeInto(page, '#pCosto', '1.234,50');
  await typeInto(page, '#pPrecio', '6,50');
  await page.locator('#mProd .mbtn-ok').click();
  await expect(page.locator('#gToast')).toContainText('Costo: Formato europeo no válido');
  await expect(page.locator('#pCosto')).toHaveAttribute('aria-invalid', 'true');
  expect(await ev(page, 'productos[0].costo')).toBe(3);
  await typeInto(page, '#pCosto', '4,50');
  await expect(page.locator('#pCosto')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#mgVal')).toHaveText('44.4%');
  await page.locator('#mProd .mbtn-ok').click();
  await expect.poll(() => ev(page, 'productos[0].costo')).toBe(4.5);
  expect(await ev(page, 'productos[0].precio')).toBe(6.5);
});

test('Editar producto guardado con 3.3333 / 6.300000000000001 / 80.30000000000001: se muestra 3.33 / 6.30 / 80.30; sin tocar guarda el original (3.3333) y al teclear «3.33» guarda 3.33', async ({ page }) => {
  await localPage(page);
  await ev(page, `productos=[{id:'pe-1',name:'Queso',nombre:'Queso',sku:'PE-01',stock:5,stockMin:1,costo:3.3333,precio:6.300000000000001,precioCaja:80.30000000000001,unidCaja:12,factorCompra:24,controlInventario:true,unidad:'unidad',cat:'abarrotes',marca:'Sin marca'}];`);
  await page.evaluate(() => (window as any).editProd('pe-1'));
  await page.evaluate(() => { document.querySelectorAll('#mProd details').forEach(d => ((d as HTMLDetailsElement).open = true)); });
  await expect(page.locator('#pCosto')).toHaveValue('3.33');
  await expect(page.locator('#pPrecio')).toHaveValue('6.30');
  await expect(page.locator('#pPrecioCaja')).toHaveValue('80.30');
  await expect(page.locator('#pFactorCompra')).toHaveValue('24');
  // Entrar y salir de los campos sin cambiar nada tampoco los marca.
  for (const id of ['#pCosto', '#pPrecio', '#pPrecioCaja']) { await page.locator(id).click(); await page.keyboard.press('Tab'); }
  await expect(page.locator('#mProd [aria-invalid="true"]')).toHaveCount(0);
  await page.locator('#mProd .mbtn-ok').click();
  await expect(page.locator('#mProd')).not.toHaveClass(/open/);
  // Sin tocar los campos se guarda el valor ORIGINAL, no el redondeado que se mostró.
  expect(await ev(page, 'productos[0].costo')).toBe(3.3333);
  expect(await ev(page, 'productos[0].precio')).toBe(6.300000000000001);
  expect(await ev(page, 'productos[0].precioCaja')).toBe(80.30000000000001);
  expect(await ev(page, 'productos[0].factorCompra')).toBe(24);
  // Al teclear «3.33» (aunque sea el mismo texto mostrado) se guarda 3.33.
  await page.waitForTimeout(400); // termina la animación de cierre
  await page.evaluate(() => (window as any).editProd('pe-1'));
  await page.evaluate(() => { document.querySelectorAll('#mProd details').forEach(d => ((d as HTMLDetailsElement).open = true)); });
  await expect(page.locator('#pCosto')).toBeVisible();
  await expect(page.locator('#pCosto')).toHaveValue('3.33');
  await typeInto(page, '#pCosto', '3.33');
  await page.locator('#mProd .mbtn-ok').click();
  await expect.poll(() => ev(page, 'productos[0].costo')).toBe(3.33);
  expect(await ev(page, 'productos[0].precio')).toBe(6.300000000000001);
});

test('Venta libre y línea manual prellenadas: sin tocar conservan el original; al teclear vale lo tecleado', async ({ page }) => {
  await localPage(page);
  await page.evaluate(() => (window as any).abrirVentaLibre({ precio: 3.3333, cantidad: 1 }));
  await expect(page.locator('#vlPrecio')).toHaveValue('3.33');
  expect(await page.evaluate(() => (window as any).NA_DECIMAL.value('vlPrecio'))).toBe(3.3333);
  await typeInto(page, '#vlPrecio', '3.33');
  expect(await page.evaluate(() => (window as any).NA_DECIMAL.value('vlPrecio'))).toBe(3.33);
  await page.evaluate(() => { document.getElementById('mVentaLibre')?.classList.remove('open'); (window as any).NA_DECIMAL.fill('lineaManualMonto', 1234.5678); });
  await expect(page.locator('#lineaManualMonto')).toHaveValue('1,234.57');
  expect(await page.evaluate(() => (window as any).NA_DECIMAL.value('lineaManualMonto'))).toBe(1234.5678);
});

test('Política de crédito guardada con decimales largos se muestra con 2 decimales y no avisa', async ({ page }) => {
  await localPage(page);
  await ev(page, `appConfig.creditPolicy={..._naCreditPolicy(),initialLine:3.3333,minPurchases:1000,minProfit:0.1+0.2,dueDays:30};`);
  const html = await ev<string>(page, '_naCreditPolicyConfigHtml()');
  const values = await page.evaluate(h => { const d = document.createElement('div'); d.innerHTML = h; return Object.fromEntries([...d.querySelectorAll('.credit-policy-input[onchange*="creditPolicySetNumber"]')].map(i => [String(i.getAttribute('onchange')).match(/'(\w+)'/)![1], (i as HTMLInputElement).value])); }, html);
  expect(values).toMatchObject({ initialLine: '3.33', minPurchases: '1,000.00', minProfit: '0.30', dueDays: '30' });
  for (const v of Object.values(values)) expect(await page.evaluate(x => (window as any).NA_DECIMAL.check(x).ok, v), v).toBe(true);
});

test('Gastos (local): «4,50» se guarda 4.5; «1e2» avisa y no guarda', async ({ page }) => {
  await localPage(page);
  await page.evaluate(() => (window as any).abrirModalGasto());
  await expect(page.locator('#gasMonto')).toHaveAttribute('type', 'text');
  await typeInto(page, '#gasDesc', 'Luz sintética');
  await typeInto(page, '#gasMonto', '1e2');
  const before = await ev<number>(page, 'gastos.length');
  await page.locator('#mGasto .mbtn-ok').click();
  await expect(page.locator('#gToast')).toContainText('Monto: Sin exponentes');
  expect(await ev(page, 'gastos.length')).toBe(before);
  await typeInto(page, '#gasMonto', '4,50');
  await page.locator('#mGasto .mbtn-ok').click();
  await expect.poll(() => ev(page, 'gastos.length')).toBe(before + 1);
  expect(await ev(page, 'gastos[gastos.length-1].monto')).toBe(4.5);
});

test('Caja (local): fondo «100,50», ingreso «4,50»; en el cierre «1e2» avisa y «105,00» cuadra', async ({ page }) => {
  await localPage(page);
  await page.evaluate(() => (window as any).abrirModalApertura());
  await expect(page.locator('#cajFondo')).toHaveAttribute('type', 'text');
  await typeInto(page, '#cajFondo', '100,50');
  await page.locator('#mApertura .mbtn-ok').click();
  await expect.poll(() => ev(page, 'cajEstado.abierta===true&&cajEstado.fondo')).toBe(100.5);
  await page.evaluate(() => (window as any).abrirMovCaja('ing'));
  await typeInto(page, '#cajMovMonto', '4,50');
  await typeInto(page, '#cajMovDesc', 'Ingreso sintético');
  await page.locator('#cajMovBtn').click();
  await expect.poll(() => ev(page, 'cajMovs.length&&cajMovs[cajMovs.length-1].monto')).toBe(4.5);
  await page.evaluate(() => (window as any).prepCierre());
  await typeInto(page, '#cajContado', '1e2');
  await page.locator('#mCierre .mbtn-ok').click();
  await expect(page.locator('#gToast')).toContainText('Efectivo contado: Sin exponentes');
  expect(await ev(page, 'cajEstado.cerrada')).not.toBe(true);
  await typeInto(page, '#cajContado', '105,00');
  await expect(page.locator('#difLbl')).toContainText('Cuadra');
});

const CREDIT_SEED = `
  clientes=[{id:'c-coma',nombre:'CLIENTE COMA',dni:'',tel:'',creditCategories:[]}];
  creditos=[{id:'cr-coma',credit_id:'cr-coma',cliId:'c-coma',clienteId:'c-coma',desc:'Crédito coma',monto:20,pagado:0,saldo:20,fecha:'2026-10-01',vence:'2099-01-31',status:'vigente',estado:'vigente',anulado:false,pagos:[],items:[]}];`;

test('Abono (local): «1,50» se registra como 1.5; «1.234,50» avisa y no cobra', async ({ page }) => {
  await localPage(page);
  await page.evaluate(() => (window as any).abrirModalApertura());
  await typeInto(page, '#cajFondo', '50');
  await page.locator('#mApertura .mbtn-ok').click();
  await expect.poll(() => ev(page, 'cajEstado.abierta')).toBe(true);
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageClientes'));
  await ev(page, CREDIT_SEED + 'cliRender();');
  await page.evaluate(() => (window as any).abrirPago('cr-coma'));
  await expect(page.locator('#mPagoCred')).toHaveClass(/open/);
  await expect(page.locator('#pagoMonto')).toHaveAttribute('type', 'text');
  await typeInto(page, '#pagoMonto', '1.234,50');
  await page.evaluate(() => (window as any).confirmarPago());
  await expect(page.locator('#gToast')).toContainText('Monto del abono: Formato europeo no válido');
  expect(await ev(page, 'creditos[0].pagado')).toBe(0);
  await typeInto(page, '#pagoMonto', '1,50');
  await expect(page.locator('#abonoSaldo')).toContainText('18.50');
  await page.evaluate(() => (window as any).confirmarPago());
  await expect.poll(() => ev(page, 'creditos[0].pagado')).toBe(1.5);
});

test('Nuevo crédito y nuevo cliente (local): «1e2» en el monto avisa; línea «150,50» queda 150.5', async ({ page }) => {
  await localPage(page);
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageClientes'));
  await ev(page, CREDIT_SEED + 'cliRender();');
  await page.evaluate(() => { const w = window as any; w.eval("cliCredId='c-coma'"); document.getElementById('mCred')!.classList.add('open'); });
  await expect(page.locator('#crMonto')).toHaveAttribute('type', 'text');
  await typeInto(page, '#crDesc', 'Préstamo sintético');
  await typeInto(page, '#crMonto', '1e2');
  const before = await ev<number>(page, 'creditos.length');
  await page.evaluate(() => (window as any).guardarCred());
  await expect(page.locator('#gToast')).toContainText('Monto: Sin exponentes');
  expect(await ev(page, 'creditos.length')).toBe(before);
  expect(await page.evaluate(() => (window as any).NA_DECIMAL.value('crMonto'))).toBeNaN();
  await typeInto(page, '#crMonto', '4,50');
  expect(await page.evaluate(() => (window as any).NA_DECIMAL.value('crMonto'))).toBe(4.5);
  await page.evaluate(() => { document.getElementById('mCred')!.classList.remove('open'); (window as any).abrirModalCli(); });
  await expect(page.locator('#cLinea')).toHaveAttribute('type', 'text');
  await typeInto(page, '#cNombre', 'Cliente Línea Coma');
  await typeInto(page, '#cLinea', '150,50');
  await page.evaluate(() => (window as any).guardarCli());
  await expect.poll(() => ev(page, "(clientes.find(c=>c.nombre&&/L[ií]nea Coma/i.test(c.nombre))||{}).lineaCreditoManual")).toBe(150.5);
});

test('Movimiento de inventario y venta libre: «1e2» avisa; venta libre «4,50» × «2» = S/ 9.00 y «2,5» unidades avisa', async ({ page }) => {
  await localPage(page);
  await ev(page, `productos=[{id:'mv-1',name:'Fideos',nombre:'Fideos',sku:'MV-01',stock:5,stockMin:1,costo:1,precio:2,controlInventario:true,unidad:'unidad',cat:'abarrotes',marca:'Sin marca',icon:'📦'}];`);
  await page.evaluate(() => (window as any).abrirMovInv('mv-1', 'entrada'));
  await expect(page.locator('#mMovCant')).toHaveAttribute('inputmode', 'decimal');
  await typeInto(page, '#mMovCant', '1e2');
  await page.evaluate(() => (window as any).guardarMovInv());
  await expect(page.locator('#gToast')).toContainText('Cantidad: Sin exponentes');
  expect(await ev(page, 'productos[0].stock')).toBe(5);
  await typeInto(page, '#mMovCant', '3');
  await page.evaluate(() => (window as any).guardarMovInv());
  await expect.poll(() => ev(page, 'productos[0].stock')).toBe(8);
  await page.evaluate(() => { const m = document.getElementById('mMovInv'); m && m.classList.remove('open'); document.getElementById('mVentaLibre')!.classList.add('open'); });
  await expect(page.locator('#vlCantidad')).toHaveAttribute('inputmode', 'numeric');
  await typeInto(page, '#vlPrecio', '4,50');
  await typeInto(page, '#vlCantidad', '2');
  await expect(page.locator('#vlSubtotal')).toContainText('9.00');
  await typeInto(page, '#vlCantidad', '2,5');
  const cart = await ev<number>(page, 'cart.length');
  await page.evaluate(() => (window as any).confirmarVentaLibre());
  await expect(page.locator('#gToast')).toContainText('Cantidad: Debe ser entero');
  expect(await ev(page, 'cart.length')).toBe(cart);
});

test('Política de crédito: «4,50» en línea inicial = 4.5; «4,5» días avisa; campos de texto con teclado numérico', async ({ page }) => {
  await localPage(page);
  const html = await ev<string>(page, '_naCreditPolicyConfigHtml()');
  const box = await page.evaluate(h => { const d = document.createElement('div'); d.innerHTML = h; return [...d.querySelectorAll('.credit-policy-input[onchange*="creditPolicySetNumber"]')].map(i => [i.getAttribute('type'), i.getAttribute('inputmode')]); }, html);
  expect(box).toEqual([['text', 'decimal'], ['text', 'decimal'], ['text', 'decimal'], ['text', 'numeric'], ['text', 'numeric'], ['text', 'numeric']]);
  await page.evaluate(() => (window as any).creditPolicySetNumber('initialLine', '4,50'));
  await expect.poll(() => ev(page, 'appConfig.creditPolicy.initialLine')).toBe(4.5);
  const days = await ev(page, 'appConfig.creditPolicy.dueDays');
  await page.evaluate(() => (window as any).creditPolicySetNumber('dueDays', '4,5'));
  await expect(page.locator('#gToast')).toContainText('Debe ser entero');
  expect(await ev(page, 'appConfig.creditPolicy.dueDays')).toBe(days);
  await page.evaluate(() => (window as any).creditPolicySetNumber('minPurchases', '1e2'));
  await expect(page.locator('#gToast')).toContainText('Sin exponentes');
});

test('Cobrar: mMontoRec, mMixedCash y lineaManualMonto son de texto; Venta (total) e Inicio sin campos nuevos', async ({ page }) => {
  await localPage(page, 1280);
  for (const id of ['mMontoRec', 'mMixedCash', 'lineaManualMonto']) {
    await expect(page.locator('#' + id)).toHaveAttribute('type', 'text');
    await expect(page.locator('#' + id)).toHaveAttribute('inputmode', 'decimal');
  }
  expect(await page.locator('#pagePOS [data-na-decimal], #pageMenu [data-na-decimal]').count()).toBe(0);
});

test('Cobrar efectivo: «1,000» da vuelto 990.50 y al salir muestra «1,000.00»; «1e2» avisa en línea y no deja cobrar', async ({ page }) => {
  await localPage(page);
  await page.evaluate(() => (window as any).abrirModalApertura());
  await typeInto(page, '#cajFondo', '50');
  await page.locator('#mApertura .mbtn-ok').click();
  await expect.poll(() => ev(page, 'cajEstado.abierta')).toBe(true);
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pagePOS'));
  await ev(page, `productos=[{id:'CB-1',name:'Prueba cobro',nombre:'Prueba cobro',precio:9.5,costo:1,stock:10,cat:'bebidas'}];cart=[{id:'CB-1',name:'Prueba cobro',precio:9.5,qty:1}];posPayM='efectivo';document.getElementById('mCobroTotal').textContent='S/ 9.50';document.getElementById('mMontoRec').value='9.50';_naRenderCashQuickOptions(9.5);calcCambio();document.getElementById('mCobro').classList.add('open');toggleOtherCashAmounts(true);`);
  await expect(page.locator('#mMontoRec')).toBeVisible();
  await typeInto(page, '#mMontoRec', '1,000');
  await expect(page.locator('#mCambio')).toHaveText('S/ 990.50');
  await page.keyboard.press('Tab');
  await expect(page.locator('#mMontoRec')).toHaveValue('1,000.00');
  await typeInto(page, '#mMontoRec', '1e2');
  await expect(page.locator('#mPaymentHint')).toContainText('Efectivo recibido: Sin exponentes');
  await expect(page.locator('#mBtnConf')).toHaveAttribute('data-valid', 'false');
  await expect(page.locator('#mBtnConf')).toHaveText('Revisar datos');
  const sales = await ev<number>(page, 'ventas.length');
  await page.locator('#mBtnConf').click();
  expect(await ev(page, 'ventas.length')).toBe(sales);
  await page.keyboard.press('Tab');
  await expect(page.locator('#mMontoRec')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#mMontoRecNaDecimalMsg')).toContainText('Sin exponentes');
  await typeInto(page, '#mMontoRec', '20');
  await expect(page.locator('#mMontoRecNaDecimalMsg')).toHaveCount(0);
  await expect(page.locator('#mCambio')).toHaveText('S/ 10.50');
  await expect(page.locator('#mBtnConf')).toHaveAttribute('data-valid', 'true');
  await typeInto(page, '#mMontoRec', '1,000.00');
  await page.locator('#mBtnConf').click();
  await expect.poll(() => ev(page, 'ventas.length')).toBe(sales + 1);
  expect(await ev(page, 'ventas[ventas.length-1].recibido')).toBe(1000);
  expect(await ev(page, 'ventas[ventas.length-1].vuelto')).toBe(990.5);
});

test('Cobrar mixto: efectivo «4,50» = 4.50 (digital 5.00); «1.000,50» avisa', async ({ page }) => {
  await localPage(page);
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pagePOS'));
  await ev(page, `productos=[{id:'CB-1',name:'Prueba cobro',nombre:'Prueba cobro',precio:9.5,costo:1,stock:10,cat:'bebidas'}];cart=[{id:'CB-1',name:'Prueba cobro',precio:9.5,qty:1}];posPayM='efectivo';document.getElementById('mCobroTotal').textContent='S/ 9.50';document.getElementById('mMontoRec').value='9.50';_naRenderCashQuickOptions(9.5);calcCambio();document.getElementById('mCobro').classList.add('open');`);
  await page.locator('#mCobro [data-method="mixto"]').click();
  await typeInto(page, '#mMixedCash', '4,50');
  expect(await ev(page, '_naMixedPaymentData().cash')).toBe(4.5);
  expect(await ev(page, '_naMixedPaymentData().digital')).toBe(5);
  await typeInto(page, '#mMixedCash', '1.000,50');
  await expect(page.locator('#mPaymentHint')).toContainText('Efectivo recibido: Formato europeo no válido');
});

test('Línea manual de crédito: «1,500» se muestra «1,500.00» al salir; «1,23,456» avisa', async ({ page }) => {
  await localPage(page);
  await page.evaluate(() => document.getElementById('mLineaManual')?.classList.add('open'));
  await page.locator('#lineaManualMonto').evaluate(e => { (e as HTMLInputElement).value = ''; e.closest('.modal-overlay')?.classList.add('open'); });
  await typeInto(page, '#lineaManualMonto', '1,500');
  await page.keyboard.press('Tab');
  await expect(page.locator('#lineaManualMonto')).toHaveValue('1,500.00');
  expect(await page.evaluate(() => (window as any).NA_DECIMAL.value('lineaManualMonto'))).toBe(1500);
  await typeInto(page, '#lineaManualMonto', '1,23,456');
  await page.keyboard.press('Tab');
  await expect(page.locator('#lineaManualMontoNaDecimalMsg')).toContainText('Coma de miles mal ubicada');
});

// Especificación final del dueño, campo por campo con teclado real (Gastos como campo de prueba; Compras arriba).
const ACCEPT: [string, number, string][] = [
  ['1,000', 1000, '1,000.00'], ['4,500', 4500, '4,500.00'], ['1,000,000', 1000000, '1,000,000.00'], ['1,000.50', 1000.5, '1,000.50'],
  ['4,50', 4.5, '4.50'], ['1,5', 1.5, '1.50'], ['1,00', 1, '1.00'], ['0,500', 0.5, '0.50'], [',500', 0.5, '0.50'], [',50', 0.5, '0.50'],
  ['1.000', 1, '1.00'], ['2.', 2, '2.00'], ['1,000.', 1000, '1,000.00'], ['450', 450, '450.00'], ['4.50', 4.5, '4.50'], ['1000', 1000, '1,000.00'],
];
const REJECT: [string, RegExp][] = [
  ['1,2345', /1-2 decimales o 3 dígitos/], ['1,0000', /1-2 decimales o 3 dígitos/], ['12,3456', /1-2 decimales o 3 dígitos/], ['1,23,456', /Coma de miles mal ubicada/],
  ['12,34,56', /Coma de miles mal ubicada/], ['1.000,50', /Formato europeo no válido/], ['1e2', /Sin exponentes/],
  ['+2', /Sin signos/], ['-2', /Sin signos/], ['4.505', /Máximo 2 decimales/], ['0x10', /Número no válido/], ['abc', /Número no válido/], ['2,', /Termina en coma/],
];
test('Formato del dueño: cada entrada válida tecleada se lee bien y al salir se muestra con miles y 2 decimales; re-editar no cambia el valor', async ({ page }) => {
  await localPage(page);
  await page.evaluate(() => (window as any).abrirModalGasto());
  for (const [typed, value, shown] of ACCEPT) {
    await typeInto(page, '#gasMonto', typed);
    expect(await page.evaluate(() => (window as any).NA_DECIMAL.value('gasMonto')), typed).toBe(value);
    await page.keyboard.press('Tab');
    await expect(page.locator('#gasMonto'), typed).toHaveValue(shown);
    expect(await page.evaluate(() => (window as any).NA_DECIMAL.value('gasMonto')), shown).toBe(value);
    await expect(page.locator('#gasMontoNaDecimalMsg')).toHaveCount(0);
    // Re-editar «1,000.00»: entrar y salir sin cambiar nada deja el mismo valor.
    await page.locator('#gasMonto').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    await expect(page.locator('#gasMonto')).toHaveValue(shown);
  }
  await typeInto(page, '#gasDesc', 'Formato sintético');
  await typeInto(page, '#gasMonto', '1,000.00');
  const before = await ev<number>(page, 'gastos.length');
  await page.locator('#mGasto .mbtn-ok').click();
  await expect.poll(() => ev(page, 'gastos.length')).toBe(before + 1);
  expect(await ev(page, 'gastos[gastos.length-1].monto')).toBe(1000);
});

test('Formato del dueño: cada entrada inválida tecleada avisa en línea junto al campo y no guarda', async ({ page }) => {
  await localPage(page);
  await page.evaluate(() => (window as any).abrirModalGasto());
  await typeInto(page, '#gasDesc', 'Rechazo sintético');
  const before = await ev<number>(page, 'gastos.length');
  for (const [typed, message] of REJECT) {
    await typeInto(page, '#gasMonto', typed);
    await page.keyboard.press('Tab');
    await expect(page.locator('#gasMonto'), typed).toHaveValue(typed);
    await expect(page.locator('#gasMonto'), typed).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#gasMontoNaDecimalMsg'), typed).toHaveText(message);
    await page.locator('#mGasto .mbtn-ok').click();
    await expect(page.locator('#gToast'), typed).toContainText('Monto: ');
    expect(await ev(page, 'gastos.length'), typed).toBe(before);
  }
  // Corregir quita el aviso en cuanto el valor es válido.
  await typeInto(page, '#gasMonto', '4,50');
  await expect(page.locator('#gasMontoNaDecimalMsg')).toHaveCount(0);
  await expect(page.locator('#gasMonto')).not.toHaveAttribute('aria-invalid', 'true');
});

test('Gasto con CANON (bridge): «4,50» tecleado envía amount_cents 450; «1.234,50» no envía nada', async ({ page }) => {
  await localPage(page);
  await page.evaluate(() => {
    const w = window as any; w.__expenses = [];
    const known: Record<string, unknown> = {
      enabled: () => true,
      prepareCommand: async () => ({ cashState: null }),
      createExpense: async (input: any) => { w.__expenses.push(input); return { ok: true, expense_id: 'exp-coma' }; },
      legacySnapshot: () => ({ expenses: [] }),
    };
    w.NuevoAmanecerCanonical = new Proxy(known, { get: (t, k: string) => k in t ? t[k] : async () => null });
  });
  await page.evaluate(() => (window as any).abrirModalGasto());
  await typeInto(page, '#gasDesc', 'Agua sintética');
  await typeInto(page, '#gasMonto', '1.234,50');
  await page.locator('#mGasto .mbtn-ok').click();
  await expect(page.locator('#gToast')).toContainText('Monto: Formato europeo no válido');
  expect(await page.evaluate(() => (window as any).__expenses.length)).toBe(0);
  await typeInto(page, '#gasMonto', '4,50');
  await page.locator('#mGasto .mbtn-ok').click();
  await expect.poll(() => page.evaluate(() => (window as any).__expenses.length)).toBe(1);
  expect((await page.evaluate(() => (window as any).__expenses))[0]).toMatchObject({ amount_cents: 450, concept: 'Agua sintética' });
});

test('Cobro múltiple (ficha del cliente): «4,50» tecleado reparte 4.50; «1e2» avisa', async ({ page }) => {
  await localPage(page);
  await page.waitForFunction(() => typeof (window as any).naCanonOpenClientAccount === 'function');
  await page.evaluate(() => (window as any).NA_MENU_NAVIGATION.navigate('pageClientes'));
  await ev(page, CREDIT_SEED + 'cliRender();');
  await page.evaluate(() => (window as any).naCanonOpenClientAccount('c-coma'));
  await page.evaluate(() => (window as any).naCanonOpenCreditCategory('small'));
  const amount = page.locator('#naV2BatchAmount');
  await expect(amount).toHaveAttribute('type', 'text');
  await expect(amount).toHaveAttribute('inputmode', 'decimal');
  await typeInto(page, '#naV2BatchAmount', '1e2');
  await page.locator('.na-v2-batch-auto').click();
  await expect(page.locator('#gToast')).toContainText('Monto total: Sin exponentes');
  await typeInto(page, '#naV2BatchAmount', '4,50');
  await expect(page.locator('#naV2BatchAmountNaDecimalMsg')).toHaveCount(0); // el aviso se quitó y la pantalla ya no se mueve
  await expect(page.locator('#naV2BatchAmount')).toHaveValue('4,50');
  await page.locator('.na-v2-batch-auto').click();
  await expect(page.locator('#naV2BatchSummary')).toContainText('4.50');
});

test('Lotes de un ingreso: «Cantidad física» «4,5» se lee 4.5 (antes 45); «1e2» avisa', async ({ page }) => {
  await localPage(page);
  await ev(page, `productos=[{id:'lt-1',name:'Leche',nombre:'Leche',sku:'LT-01',stock:5,stockMin:1,costo:1,precio:2,controlInventario:true,unidad:'unidad',cat:'abarrotes',marca:'Sin marca',icon:'📦'}];`);
  await page.evaluate(() => (window as any).abrirMovInv('lt-1', 'entrada'));
  await page.evaluate(() => { document.getElementById('naMovementLots')!.hidden = false; });
  await page.locator('#naMovementLotsEnabled').check();
  const qty = page.locator('#naMovementLotsRows .na-lot-qty').first();
  await expect(qty).toHaveAttribute('type', 'text');
  await expect(qty).toHaveAttribute('inputmode', 'decimal');
  await expect(qty).toHaveAttribute('data-na-decimal', 'qty');
  await typeInto(page, '#naMovementLotsRows .na-lot-code', 'L-01');
  await page.locator('#naMovementLotsRows .na-lot-expiry').fill('2099-12-31'); // fecha: no es un monto
  await typeInto(page, '#mMovCant', '5');
  await typeInto(page, '#naMovementLotsRows .na-lot-qty', '4,5');
  const product = { product_id: 'lt-1', name: 'Leche', unit: 'unidad', lots_json: '[]', current_stock_quantity: 5 };
  const read = await page.evaluate(p => { try { return { ok: (window as any).NA_STOCK_LOTS_UI.readMovementLots(p) }; } catch (e: any) { return { error: String(e.message) }; } }, product);
  expect(JSON.stringify(read)).toContain('4.5');
  expect(JSON.stringify(read)).not.toContain('45');
  await typeInto(page, '#naMovementLotsRows .na-lot-qty', '1e2');
  const bad = await page.evaluate(p => { try { (window as any).NA_STOCK_LOTS_UI.readMovementLots(p); return ''; } catch (e: any) { return String(e.message); } }, product);
  expect(bad).toMatch(/^Lote 1, cantidad física: Sin exponentes/);
  await expect(qty).toHaveAttribute('aria-invalid', 'true');
});
