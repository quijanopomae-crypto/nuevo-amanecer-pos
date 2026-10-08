import {test,expect} from '@playwright/test';

for(const width of [320,360,390,430,768,1024,1366,1920]) {
  test('credit evaluation and manual line replace the workspace at '+width+'px',async({page},testInfo)=>{
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await page.setViewportSize({width,height:900});
    await page.goto('/index.html');
    await page.waitForFunction(()=>window.NA_MENU_NAVIGATION);
    await page.evaluate(()=>window.NA_MENU_NAVIGATION.navigate('pageClientes'));
    await page.waitForFunction(()=>typeof window.naCanonOpenClientAccount==='function');
    await page.evaluate(()=>{
      clientes=[{id:'ui-credit-test',nombre:'CLIENTE DE PRUEBA',dni:'',telefono:'',creditos:[]}];
      creditos=[];
      window.naCanonOpenClientAccount('ui-credit-test');
      window.naCanonOpenCreditLine();
    });
    const workspace=page.locator('.na-client-account-screen');
    await expect(workspace).toBeVisible();
    const before=await page.evaluate(()=>JSON.stringify({clientes,creditos}));
    await workspace.getByRole('button',{name:'Ver evaluación existente'}).click();
    await expect(page.locator('#mEvaluacionCredito')).toBeVisible();
    await expect(workspace).toBeHidden();
    await expect(workspace).toHaveJSProperty('inert',true);
    expect(await page.locator('#mEvaluacionCredito').evaluate(el=>getComputedStyle(el).zIndex)).toBe('1300');
    await page.locator('#mEvaluacionCredito').getByRole('button',{name:/Ajustar línea de crédito/}).click();
    await expect(page.locator('#mLineaCreditoManual')).toBeVisible();
    await expect(page.locator('#mEvaluacionCredito')).not.toHaveClass(/open/);
    await expect(workspace).toBeHidden();
    await expect(page.locator('#lineaManualMonto')).toBeVisible();
    expect(await page.locator('#mLineaCreditoManual').evaluate(el=>getComputedStyle(el).zIndex)).toBe('1300');
    await page.locator('#lineaManualMonto').fill('100');
    if(width===390 || width===1024) await testInfo.attach('manual-line-preview',{body:await page.screenshot(),contentType:'image/png'});
    await page.locator('#mLineaCreditoManual .btn-close-m').click();
    await expect(page.locator('#mLineaCreditoManual')).not.toHaveClass(/open/);
    await expect(workspace).toBeVisible();
    await expect(workspace).toHaveJSProperty('inert',false);
    await expect(workspace.getByRole('button',{name:'Ver evaluación existente'})).toBeVisible();
    expect(await page.evaluate(()=>JSON.stringify({clientes,creditos}))).toBe(before);
  });
}
