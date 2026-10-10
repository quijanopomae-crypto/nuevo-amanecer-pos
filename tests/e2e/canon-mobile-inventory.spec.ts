import {test,expect} from '@playwright/test';
for(const width of [320,360,390,430,768,1024,1366,1920])test('inventory controls and layout '+width,async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.setViewportSize({width,height:844});await page.goto('/index.html');await page.waitForFunction(()=>_naFreeSaleShortcutState.ready,{},{timeout:10000});
 await page.evaluate(()=>{productos=[{id:987654,name:'Producto de prueba',sku:'001234',barcode:'001234',cat:'snacks',precio:2,costo:1,stock:8,stockMin:3,unidad:'unidad',icon:'📦'}];window.NA_MENU_NAVIGATION.navigate('pageInventario');invRender();});
 const before=await page.evaluate(()=>JSON.stringify(productos));if(width===390)await page.screenshot({path:test.info().outputPath('inventario-mobile.png'),fullPage:true});
 await expect(page.locator('#invSearch')).toBeVisible();await expect(page.locator('#invBody .stock-pill')).toBeVisible();
 if(width<768){
  await expect(page.locator('#invCat')).toBeHidden();await expect(page.locator('#invS3')).toBeHidden();
  await expect(page.getByRole('button',{name:'OCR compras',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Cargar fotos',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'+ Nuevo',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Sugerencia de Compra/})).toBeVisible();
  await page.locator('.inv-more>summary').click();await expect(page.getByRole('button',{name:/Vencidos/})).toBeVisible();await page.getByRole('button',{name:/Vencidos/}).click();await page.getByRole('button',{name:/Todos/}).click();
  await page.locator('.inv-filters>summary').click();await expect(page.locator('#invCat')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#invCat')).toBeHidden();
  await page.locator('.inv-summary>summary').click();await expect(page.locator('#invS3')).toBeVisible();await page.keyboard.press('Escape');
  await page.locator('.prod-name-sm').click();await expect(page.locator('.inv-product-menu .btn-ent')).toHaveText('Entrada de stock');await expect(page.locator('.inv-product-menu .btn-sal')).toHaveText('Salida de stock');await expect(page.locator('.inv-product-menu .btn-edt')).toHaveText('Editar producto');await expect(page.locator('.inv-product-menu .btn-edt')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('.inv-product-menu .btn-edt')).toBeHidden();
 }else{await expect(page.locator('#invCat')).toBeVisible();await expect(page.locator('#invS3')).toBeVisible();await expect(page.locator('.inv-tools')).toHaveCount(0);}
 expect(await page.evaluate(()=>JSON.stringify(productos))).toBe(before);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width===390){await page.setViewportSize({width:1024,height:844});await expect(page.locator('.inv-product-menu')).toHaveCount(0);await expect(page.locator('#invCat')).toBeVisible();await page.setViewportSize({width:390,height:844});await expect(page.locator('.inv-product-menu')).toHaveCount(1);await page.locator('#invSearch').fill('inexistente');await expect(page.locator('#invBody')).toContainText('Sin productos');await page.locator('#invSearch').fill('001234');await expect(page.locator('.inv-product-menu')).toHaveCount(1);}
});
