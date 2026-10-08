import {test,expect} from '@playwright/test';

test.use({hasTouch:true});
test.beforeEach(async({page})=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
});
for(const width of [320,360,390,430]) test(`phone sale ${width}: hidden catalog and real cart controls`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.goto('/index.html');
 await page.evaluate(()=>window.NA_MENU_NAVIGATION.navigate('pagePOS'));
 await expect(page.locator('#cartItems')).toBeVisible();
 await expect(page.locator('#posArea')).toBeHidden();
 await expect(page.locator('#posPhoneAdd')).toBeVisible();
 await expect(page.locator('#posPhoneAccount')).toBeHidden();
 await page.evaluate(()=>window.eval(`productos=[{id:'PHONE-1',name:'Agua de prueba',precio:3.5,costo:1,stock:10,cat:'bebidas'}];cart=[];posRender();`));
 await page.locator('#posPhoneAdd').click();
 await expect(page.locator('#posPhoneCatalog')).toBeVisible();
 await page.locator('#posSearch').fill('Agua');
 await page.locator('[data-product-id="PHONE-1"]').click();
 await page.locator('#posPhoneCatalogClose').click();
 await expect(page.locator('#posTotal')).toHaveText('S/ 3.50');
 await page.locator('[data-na-cart-action="increase"]').click();
 await expect(page.locator('#posTotal')).toHaveText('S/ 7.00');
 await expect(page.locator('#posPhonePayLabel')).toHaveText('Cobrar S/ 7.00');
 await expect(page.locator('#posCustomerButton')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#posPhoneScan').click();
 await expect(page.locator('#posPhoneCamera')).toBeVisible();
 await expect(page.locator('#posPhoneCameraStatus')).toContainText('cámara');
 await page.locator('#posPhoneCameraClose').click();
 await expect(page.locator('#posPhoneCamera')).toBeHidden();
});
for(const width of [768,1024,1366,1920]) test(`tablet / PC ${width} keeps catalog`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/index.html');
 await page.evaluate(()=>window.NA_MENU_NAVIGATION.navigate('pagePOS'));
 await expect(page.locator('#posSearch')).toBeVisible();
 await expect(page.locator('#posArea')).toBeVisible();
 await expect(page.locator('#posPhoneAdd')).toBeHidden();
 await expect(page.locator('#btnPagar')).toContainText('Pagar');
});

test('phone selects a real customer; credit account appears only for assigned line; VARIOS modal is accessible',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/index.html');
 await page.evaluate(()=>window.NA_MENU_NAVIGATION.navigate('pagePOS'));
 await page.evaluate(()=>window.eval(`clientes=[{id:'PHONE-C',nombre:'Cliente prueba',lineaCreditoManualActiva:false}];`));
 await page.locator('#posCustomerButton').click();
 await page.locator('.na-client-picker-row').filter({hasText:'Cliente prueba'}).click();
 await expect(page.locator('#posCustomer')).toHaveText('Cliente prueba');
 await expect(page.locator('#posPhoneAccount')).toBeHidden();
 await page.evaluate(()=>window.eval(`clientes[0].lineaCreditoManualActiva=true;clientes[0].lineaCreditoManual=100;document.getElementById('mVentaCliente').dispatchEvent(new Event('change'));`));
 await expect(page.locator('#posPhoneAccount')).toBeVisible();
 await page.locator('#posPhoneAdd').click();await page.locator('#btnVentaLibre').click();
 await expect(page.locator('#posPhoneCatalog')).toBeHidden();
 await expect(page.locator('#mVentaLibre')).toBeVisible();
 await page.locator('#vlNombre').fill('Prueba manual');
});

test('camera reads barcode once through existing stock-aware handler and stops tracks',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{
  (window as any).phoneStopped=0;
  (window as any).BarcodeDetector=class {static async getSupportedFormats(){return ['ean_13'];}async detect(){return [{rawValue:'7750000000001'}];}};
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>{(window as any).phoneStopped++;}}]})}});
  Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{get(){return null;},set(){},configurable:true});
  HTMLMediaElement.prototype.play=async()=>{};
 });
 await page.goto('/index.html');await page.evaluate(()=>window.NA_MENU_NAVIGATION.navigate('pagePOS'));
 await page.evaluate(()=>window.eval(`productos=[{id:'CAM-1',name:'Escaneo prueba',barcode:'7750000000001',precio:4,costo:1,stock:10,cat:'bebidas'}];cart=[];posRender();`));
 await page.locator('#posPhoneScan').click();
 await expect(page.locator('#posTotal')).toHaveText('S/ 4.00');
 await expect(page.locator('.cart-item')).toHaveCount(1);
 await expect(page.locator('.qty-num')).toHaveText('1');
 await expect(page.locator('#posPhoneCamera')).toBeHidden();
 expect(await page.evaluate(()=>(window as any).phoneStopped)).toBe(1);
});

test('closing camera while permission is pending stops late stream without adding products',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{
  (window as any).phoneStopped=0;
  (window as any).BarcodeDetector=class {static async getSupportedFormats(){return ['ean_13'];}async detect(){throw new Error('must not detect');}};
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>new Promise(resolve=>{(window as any).grantPhoneCamera=()=>resolve({getTracks:()=>[{stop:()=>{(window as any).phoneStopped++;}}]});})}});
 });
 await page.goto('/index.html');await page.evaluate(()=>window.NA_MENU_NAVIGATION.navigate('pagePOS'));
 await page.locator('#posPhoneScan').click();
 await page.waitForFunction(()=>typeof (window as any).grantPhoneCamera==='function');
 await page.locator('#posPhoneCameraClose').click();
 await page.evaluate(()=>(window as any).grantPhoneCamera());
 await expect.poll(()=>page.evaluate(()=>(window as any).phoneStopped)).toBe(1);
 await expect(page.locator('.cart-item')).toHaveCount(0);
});
