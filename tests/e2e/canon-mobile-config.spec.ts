import {test,expect} from '@playwright/test';

test.beforeEach(async ({page}) => {await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());});

for(const width of [320,360,390,430,768,1024,1366,1920])test('settings '+width,async({page})=>{await page.setViewportSize({width,height:844});await page.goto('/index.html');
    await page.waitForFunction(()=>_naFreeSaleShortcutState.ready);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));await page.evaluate(()=>window.NA_MENU_NAVIGATION.navigate('pageConfig'));await expect(page.locator('#cfgNombre')).toBeVisible();if(width<768)await expect(page.locator('#naMobileMenuToggle')).toBeHidden();for(const cat of ['pos','apariencia','ticket','control','reseteo','importar','info','negocio']){await page.evaluate(cat=>window.switchCfgCategory(cat),cat);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}});

for (const width of [320, 360, 390, 430]) {
  test(`configuration help opens and closes without changing data at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:844});
    await page.goto('/index.html');
    await page.waitForFunction(()=>_naFreeSaleShortcutState.ready);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
    await page.evaluate(()=>window.NA_MENU_NAVIGATION.navigate('pageConfig'));
    for (const cat of ['negocio','pos','apariencia','ticket','control','reseteo','importar','info']) {
      await page.evaluate(cat=>window.switchCfgCategory(cat),cat);
      const before=await page.evaluate(()=>JSON.stringify(appConfig));
      const buttons=page.locator('#cfgContent .cfg-help-toggle');
      expect(await buttons.count()).toBeGreaterThan(0);
      for (let i=0;i<await buttons.count();i++) {
        const button=buttons.nth(i),id=await button.getAttribute('aria-controls');
        const text=page.locator('#'+id);
        await expect(text).toBeHidden();
        await button.click();
        await expect(button).toHaveAttribute('aria-expanded','true');
        await expect(text).toBeVisible();
        await button.click();
        await expect(text).toBeHidden();
      }
      expect(await page.evaluate(()=>JSON.stringify(appConfig))).toBe(before);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
  });
}

test('configuration help adapts to rotation without duplicates',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/index.html');
    await page.waitForFunction(()=>_naFreeSaleShortcutState.ready);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
  await page.evaluate(()=>window.NA_MENU_NAVIGATION.navigate('pageConfig'));
  await expect(page.locator('#cfgNombre')).toBeVisible();
  expect(await page.locator('.cfg-help-toggle').count()).toBeGreaterThan(0);
  const count=await page.locator('.cfg-help-toggle').count();
  await page.setViewportSize({width:1024,height:768});
  await expect(page.locator('.cfg-help-toggle')).toHaveCount(0);
  await expect(page.locator('.cfg-screen-head-sub')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.cfg-help-toggle')).toHaveCount(count);
  await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  await expect(page.locator('.cfg-help-toggle')).toHaveCount(count);
});
