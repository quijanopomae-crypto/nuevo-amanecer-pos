import { test, expect, Page } from '@playwright/test';

async function enterPos(page: Page) {
  if (await page.evaluate(() => innerWidth >= 768)) {
    const sidebar = page.locator('[data-menu-target="pagePOS"]');
    await expect(sidebar).toBeVisible();
    await sidebar.click();
    return;
  }
  await page.locator('.module-card').first().click();
}

async function prepare(page: Page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await enterPos(page);
  await page.evaluate(() => {
    // Isolated synthetic session. No remote API or actual business data.
    window.eval(`productos = [
      {id:'VIS-A',name:'Producto A',cat:'abarrotes',precio:10,costo:4,stock:10,stockMin:1,icon:'📦'},
      {id:'VIS-B',name:'Producto B',cat:'abarrotes',precio:5,costo:2,stock:8,stockMin:1,icon:'📦'}
    ]; clientes=[{id:'VIS-C',nombre:'Cliente prueba',dni:''}];
    cajEstado={abierta:true,cerrada:false,fechaApertura:obtenerHoy(),cajero:'Prueba',cajeroId:'TEST'};
    cart=[]; appConfig.margenActive=true; posRender(); posUpdateCart();`);
  });
}

test('current sale controls edit real cart and survive canonical capture', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await prepare(page);
  await expect(page.locator('#btnPagar')).toBeDisabled();
  await expect(page.locator('#posQuantity')).toBeDisabled();
  await page.locator('[data-product-id="VIS-A"]').click();
  await expect(page.locator('.cart-item')).toHaveCount(1);
  await page.locator('[data-na-cart-action="increase"]').click();
  await expect(page.locator('.qty-num')).toHaveText('2');
  await page.locator('[data-na-cart-action="decrease"]').click();
  await page.locator('#posQuantity').click();
  await page.locator('#posLineValue').fill('3');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.locator('.qty-num')).toHaveText('3');
  await page.locator('#posQuantity').click();
  await page.locator('#posLineValue').fill('11');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.locator('#posLineError')).toContainText('Stock insuficiente');
  await page.locator('#posLineEditor').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.locator('#posPrice').click();
  await page.locator('#posLineValue').fill('3');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.locator('#posLineError')).toContainText('bajo costo');
  await page.locator('#posLineValue').fill('8.50');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.locator('#posTotal')).toHaveText('S/ 25.50');
  await page.locator('[data-product-id="VIS-B"]').click();
  await expect(page.locator('.cart-item')).toHaveCount(2);
  await page.locator('.cart-item').last().locator('[data-na-cart-action="remove"]').click();
  await expect(page.locator('.cart-item')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept('10'));
  await page.locator('#posDiscount').click();
  await expect(page.locator('#posTotal')).toHaveText('S/ 22.95');
  await page.locator('.pos-customer-button').click();
  await page.locator('.na-client-picker-row').filter({ hasText: 'Cliente prueba' }).click();
  await expect(page.locator('#posCustomer')).toHaveText('Cliente prueba');
  await page.locator('#btnPagar').click();
  await expect(page.locator('#mCobro')).toHaveClass(/open/);
  await expect(page.locator('#mVentaCliente')).toHaveValue('VIS-C');
  await page.evaluate(() => {
    const root = window as any;
    root.__capturedSale = null;
    root.NuevoAmanecerCanonical = { enabled: () => true, snapshot: () => ({sales:[],products:[]}) };
    root.NuevoAmanecerCanonicalSaleOutbox = {
      snapshot: () => ({intents:[]}),
      enqueue: async (input: any) => { const intent = root.NuevoAmanecerCanonicalSaleIntent.build(input); root.__capturedSale = intent; return intent; },
      sync: async () => {},
    };
  });
  await page.locator('#mBtnConf').click();
  await expect.poll(() => page.evaluate(() => (window as any).__capturedSale)).toMatchObject({
    customer_id:'VIS-C', total_cents:2295, items:[{product_id:'VIS-A',quantity:3,unit_price_cents:765}],
  });
  await expect(page.locator('.cart-item')).toHaveCount(0);
  await expect(page.locator('#posCustomer')).toHaveText('Cliente genérico');
});

test('desktop fidelity uses one header, aligned categories and five product columns', async ({ page }) => {
  await page.setViewportSize({width:1536,height:1024}); await prepare(page);
  const dimensions = await page.evaluate(() => {
    const style = (selector:string) => getComputedStyle(document.querySelector(selector)!);
    return { columns:style('#posArea').gridTemplateColumns.split(' ').length,
      categoryHeight:document.querySelector('.cat-btn:nth-child(2)')!.getBoundingClientRect().height,
      sidebarScroll:style('#posSidebar').overflowY, cart:style('#cartDrawer').position };
  });
  expect(dimensions).toEqual({columns:5,categoryHeight:41,sidebarScroll:'auto',cart:'relative'});
  await expect(page.locator('#posSidebar .ci svg')).toHaveCount(await page.locator('#posSidebar .cat-btn').count());
  await expect(page.locator('#posClear')).toBeVisible();
  await expect(page.locator('#posRuntimeStatus')).toHaveAttribute('data-state','disconnected');
  await page.locator('#btnMayorista').click();
  await expect(page.locator('#modoMayoristaTag')).toBeVisible();
  await page.locator('#btnMayorista').click();
  await page.locator('#btnVentaLibre').click();
  await expect(page.locator('#mVentaLibre')).toHaveClass(/open/);
  await page.locator('#mVentaLibre .mbtn-cancel').click();
  await page.locator('#backBtn').click();
  await expect(page.locator('#pageMenu')).toBeVisible();
});

test('quick payment and clear keep their existing workflows', async ({ page }) => {
  await page.setViewportSize({width:1536,height:1024}); await prepare(page);
  await page.locator('[data-product-id="VIS-A"]').click();
  await page.locator('#btnRapido').click();
  await expect(page.locator('#mCobroRapido')).toHaveClass(/open/);
  await page.evaluate(() => window.eval("cerrarModal('mCobroRapido')"));
  await page.locator('#posClear').click();
  await page.locator('#naConfirmOk').click();
  await expect(page.locator('.cart-item')).toHaveCount(0);
  await expect(page.locator('#btnPagar')).toBeDisabled();
  await page.locator('[data-product-id="VIS-A"]').click();
  await page.evaluate(() => {
    const root=window as any;
    root.NuevoAmanecerCanonical={enabled:()=>true,snapshot:()=>({sales:[],products:[]})};
    root.NuevoAmanecerCanonicalSaleOutbox={snapshot:()=>({intents:[]}),
      enqueue:async(input:any)=>{const intent=root.NuevoAmanecerCanonicalSaleIntent.build(input);root.__quickSale=intent;return intent;},sync:async()=>{}};
  });
  await page.locator('#btnRapido').click();
  await page.locator('#mQuickCash').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__quickSale)).toMatchObject({total_cents:1000,payment_method:'efectivo'});
  await expect(page.locator('.cart-item')).toHaveCount(0);
});

for (const width of [320,360,390,430,768,1024,1366,1920]) {
  test(`responsive layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:900}); await prepare(page);
    const geometry = await page.evaluate(() => {
      const area=document.querySelector('#posArea')!.getBoundingClientRect();
      return {right:area.right,width:area.width,viewport:innerWidth,
        cart:getComputedStyle(document.querySelector('#cartDrawer')!).position};
    });
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.width).toBeGreaterThan(width < 700 ? 200 : 400);
    expect(geometry.cart).toBe(width<1100?'absolute':'relative');
    if(width<1100) {
      await page.locator('.cart-fab').click();
      await expect(page.locator('.cart-mobile-close')).toBeVisible();
      await page.locator('.cart-mobile-close').click();
      await expect(page.locator('#cartDrawer')).not.toHaveClass(/open/);
    }
  });
}

test('Android desktop-site keeps mobile drawer on a wide viewport', async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:1280,height:900},screen:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage(); await prepare(page);
  await expect(page.locator('body')).toHaveClass(/na-pos-phone-device/);
  expect(await page.locator('#posArea').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);
  expect(await page.locator('#cartDrawer').evaluate(el=>getComputedStyle(el).position)).toBe('absolute');
  await page.locator('.cart-fab').click();
  await expect(page.locator('.cart-mobile-close')).toBeVisible();
  await context.close();
});


test('current sale panel matches the approved desktop hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await prepare(page);
  await page.locator('[data-product-id="VIS-A"]').click();

  await expect(page.locator('#cartDrawer .cart-head-title')).toContainText('Venta actual');
  await expect(page.locator('#posClear')).toBeVisible();
  await expect(page.locator('#posCustomerButton')).toBeVisible();
  await expect(page.locator('#cartDrawer .cart-item')).toHaveCount(1);
  await expect(page.locator('#cartDrawer .cart-line-unit')).toContainText('1 unidad');
  await expect(page.locator('#posProductCount')).toHaveText('Nro. de productos: 1');
  await expect(page.locator('#posUnitCount')).toBeHidden();
  await expect(page.locator('#posTotal')).toHaveText('S/ 10.00');
  await expect(page.locator('#posQuantity')).toBeEnabled();
  await expect(page.locator('#posDiscount')).toBeEnabled();
  await expect(page.locator('#posPrice')).toBeEnabled();
  await expect(page.locator('#btnRapido')).toBeEnabled();
  await expect(page.locator('#btnPagar')).toBeEnabled();
  await expect(page.getByPlaceholder('Nota de venta (opcional)')).toHaveCount(0);
});

test('short desktop viewport compacts the current-sale footer without changing tall desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 627 });
  await prepare(page);
  await page.locator('[data-product-id="VIS-A"]').click();
  const compact = await page.evaluate(() => ({
    total: document.querySelector('.total-main')!.getBoundingClientRect().height,
    secondary: document.querySelector('.cart-secondary-actions button')!.getBoundingClientRect().height,
    pay: document.querySelector('#btnPagar')!.getBoundingClientRect().height,
  }));
  expect(compact.total).toBeLessThanOrEqual(36);
  expect(compact.secondary).toBeLessThanOrEqual(32);
  expect(compact.pay).toBeLessThanOrEqual(44);

  await page.setViewportSize({ width: 1366, height: 900 });
  const tall = await page.evaluate(() => ({
    total: document.querySelector('.total-main')!.getBoundingClientRect().height,
    secondary: document.querySelector('.cart-secondary-actions button')!.getBoundingClientRect().height,
    pay: document.querySelector('#btnPagar')!.getBoundingClientRect().height,
  }));
  expect(tall.total).toBeGreaterThanOrEqual(44);
  expect(tall.secondary).toBeGreaterThanOrEqual(36);
  expect(tall.pay).toBeGreaterThanOrEqual(52);
});
for (const count of [1, 6]) {
  test(`short CANON footer renders compactly at 1366x625 with ${count} products`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 625 });
    await prepare(page);
    await page.evaluate((lineCount) => window.eval(`
      productos = Array.from({length:6}, (_, index) => ({id:'FOOTER-'+index,name:'Producto de prueba '+(index+1),cat:'abarrotes',precio:2.5,costo:1,stock:20,stockMin:1,icon:'📦'}));
      cart = []; posRender(); productos.slice(0,${lineCount}).forEach(product => posAdd(product.id));
    `), count);
    await expect(page.locator('.cart-item')).toHaveCount(count);
    const dimensions = await page.evaluate(() => ({
      total: document.querySelector('.total-main')!.getBoundingClientRect().height,
      secondary: document.querySelector('.cart-secondary-actions button')!.getBoundingClientRect().height,
      pay: document.querySelector('#btnPagar')!.getBoundingClientRect().height,
      footer: document.querySelector('.cart-footer')!.getBoundingClientRect().height,
    }));
    expect(dimensions.total).toBeLessThanOrEqual(36);
    expect(dimensions.secondary).toBeLessThanOrEqual(32);
    expect(dimensions.pay).toBeLessThanOrEqual(44);
    expect(dimensions.footer).toBeLessThanOrEqual(150);
    await testInfo.attach(`canon-1366x625-${count}-products`, {
      body: await page.screenshot({ type: 'png' }), contentType: 'image/png',
    });    await testInfo.attach(`canon-1366x625-${count}-products-cart-panel`, {
      body: await page.locator('#cartDrawer').screenshot({ type: 'png' }), contentType: 'image/png',
    });
  });
}

test('scaled 625px physical capture compacts; 768px and tall layouts remain unchanged', async ({ browser }, testInfo) => {
  const scaled = await browser.newContext({ viewport: { width: 1821, height: 833 }, deviceScaleFactor: 0.75 });
  const scaledPage = await scaled.newPage();
  await prepare(scaledPage);
  const media = '(min-width:1100px) and (max-height:700px), (min-width:1100px) and (max-resolution:0.9dppx) and (max-height:850px)';
  const at625 = await scaledPage.evaluate((query) => ({
    width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    physicalWidth: innerWidth * devicePixelRatio, physicalHeight: innerHeight * devicePixelRatio,
    short: matchMedia(query).matches,
    total: document.querySelector('.total-main')!.getBoundingClientRect().height,
    secondary: document.querySelector('.cart-secondary-actions button')!.getBoundingClientRect().height,
    pay: document.querySelector('#btnPagar')!.getBoundingClientRect().height,
  }), media);
  expect(at625.physicalWidth).toBeCloseTo(1366, 0);
  expect(at625.physicalHeight).toBeCloseTo(625, 0);
  expect(at625.short).toBe(true);
  expect(at625.total).toBeLessThanOrEqual(36);
  expect(at625.secondary).toBeLessThanOrEqual(32);
  expect(at625.pay).toBeLessThanOrEqual(44);
  await testInfo.attach('canon-1366x625-dpr075', { body: await scaledPage.screenshot({ type: 'png' }), contentType: 'image/png' });

  await scaledPage.setViewportSize({ width: 1821, height: 1024 });
  const at768 = await scaledPage.evaluate((query) => ({
    short: matchMedia(query).matches,
    total: document.querySelector('.total-main')!.getBoundingClientRect().height,
    secondary: document.querySelector('.cart-secondary-actions button')!.getBoundingClientRect().height,
    pay: document.querySelector('#btnPagar')!.getBoundingClientRect().height,
  }), media);
  expect(at768.short).toBe(false);
  expect(at768.total).toBeGreaterThanOrEqual(44);
  expect(at768.secondary).toBeGreaterThanOrEqual(36);
  expect(at768.pay).toBeGreaterThanOrEqual(52);

  await scaledPage.setViewportSize({ width: 1821, height: 1200 });
  const at900 = await scaledPage.evaluate((query) => ({
    short: matchMedia(query).matches,
    total: document.querySelector('.total-main')!.getBoundingClientRect().height,
    secondary: document.querySelector('.cart-secondary-actions button')!.getBoundingClientRect().height,
    pay: document.querySelector('#btnPagar')!.getBoundingClientRect().height,
  }), media);
  expect(at900.short).toBe(false);
  expect(at900.total).toBeGreaterThanOrEqual(44);
  expect(at900.secondary).toBeGreaterThanOrEqual(36);
  expect(at900.pay).toBeGreaterThanOrEqual(52);
  await scaled.close();

  const cssPixels = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const cssPage = await cssPixels.newPage();
  await prepare(cssPage);
  const atCss768 = await cssPage.evaluate((query) => ({
    short: matchMedia(query).matches,
    total: document.querySelector('.total-main')!.getBoundingClientRect().height,
    secondary: document.querySelector('.cart-secondary-actions button')!.getBoundingClientRect().height,
    pay: document.querySelector('#btnPagar')!.getBoundingClientRect().height,
  }), media);
  expect(atCss768.short).toBe(false);
  expect(atCss768.total).toBeGreaterThanOrEqual(44);
  expect(atCss768.secondary).toBeGreaterThanOrEqual(36);
  expect(atCss768.pay).toBeGreaterThanOrEqual(52);

  await cssPage.setViewportSize({ width: 1366, height: 900 });
  const atCss900 = await cssPage.evaluate((query) => ({
    short: matchMedia(query).matches,
    total: document.querySelector('.total-main')!.getBoundingClientRect().height,
    secondary: document.querySelector('.cart-secondary-actions button')!.getBoundingClientRect().height,
    pay: document.querySelector('#btnPagar')!.getBoundingClientRect().height,
  }), media);
  expect(atCss900.short).toBe(false);
  expect(atCss900.total).toBeGreaterThanOrEqual(44);
  expect(atCss900.secondary).toBeGreaterThanOrEqual(36);
  expect(atCss900.pay).toBeGreaterThanOrEqual(52);
  await cssPixels.close();
});
