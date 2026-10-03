import {test,expect} from '@playwright/test';

for(const count of [0,1,2,6]) {
 test(`current sale density with ${count} products`,async({page})=>{
  await page.setViewportSize({width:1536,height:1024});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/index.html');
  await page.locator('.module-card').first().click();
  await page.evaluate(count=>window.eval(`
    productos=Array.from({length:6},(_,index)=>({id:'DENSITY-'+index,name:'Producto de prueba '+(index+1),cat:'abarrotes',precio:2.5,costo:1,stock:20,stockMin:1,icon:'📦'}));
    cart=[]; posRender(); productos.slice(0,${count}).forEach(product=>posAdd(product.id));
  `),count);
  await expect(page.locator('.cart-item')).toHaveCount(count);
  const metrics=await page.evaluate(()=>{
   const box=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect();
   const items=Array.from(document.querySelectorAll('.cart-item')).map(el=>el.getBoundingClientRect());
   const head=box('.cart-head'),footer=box('.cart-footer'),pay=box('#btnPagar');
   return {head:head.height,footer:footer.height,pay:pay.height,total:box('.total-main').height,totalFont:getComputedStyle(document.querySelector('.total-main')!).fontSize,secondary:box('.cart-secondary-actions button').height,rows:items.map(r=>r.height),
    lastBottom:items.at(-1)?.bottom,footerTop:footer.top,quantity:document.querySelector('.qty-btn')?.getBoundingClientRect().height};
  });
  expect(metrics.head).toBeLessThanOrEqual(60);
  expect(metrics.footer).toBeLessThanOrEqual(180);
  expect(metrics.pay).toBe(52);
  expect(metrics.total).toBe(44);
  expect(metrics.totalFont).toBe('26px');
  expect(metrics.secondary).toBe(36);
  for(const height of metrics.rows)expect(height).toBeLessThanOrEqual(64);
  if(count){expect(metrics.quantity).toBe(26);expect(metrics.lastBottom).toBeLessThan(metrics.footerTop);}
 });
}

test('long names and VARIOS stay bounded while quantity and selected customer remain real',async({page})=>{
 await page.setViewportSize({width:1536,height:1024});
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('/index.html'); await page.locator('.module-card').first().click();
 await page.evaluate(()=>window.eval(`
  productos=[{id:'LONG',name:'PRODUCTO CON NOMBRE EXTREMADAMENTE LARGO QUE DEBE QUEDAR LIMITADO A DOS LÍNEAS SIN INFLAR LA FILA',cat:'abarrotes',precio:5,costo:1,stock:10,stockMin:1,icon:'📦'}];
  clientes=[{id:'DENSITY-C',nombre:'Cliente seleccionado',dni:''}];
  cart=[]; posRender(); posAdd('LONG');
  cart.push({id:'GENERIC:DENSITY',canonicalGenericId:'GENERIC:DENSITY',_lineKey:'GENERIC:DENSITY',ventaLibre:true,name:'VARIOS DE PRUEBA',precio:13.5,qty:1,unitsPerQty:1,icon:'📦'});posUpdateCart();
 `));
 const row=page.locator('.cart-item').first();
 expect(await row.evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(78);
 expect(await row.locator('.ci-name').evaluate(el=>getComputedStyle(el).webkitLineClamp)).toBe('2');
 await expect(page.locator('.cart-item-flag.free')).toHaveText('VARIOS');
 await row.locator('[data-na-cart-action="increase"]').click();
 await expect(row.locator('.qty-num')).toHaveText('2');
 await expect(row.locator('.cart-line-unit')).toHaveText('2 unidades');
 await page.locator('#posCustomerButton').click();
 await page.locator('.na-client-picker-row').filter({hasText:'Cliente seleccionado'}).click();
 await expect(page.locator('#posCustomer')).toHaveText('Cliente seleccionado');
});
