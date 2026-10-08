import {test,expect} from '@playwright/test';

test.beforeEach(async ({page}) => {await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());});

for(const width of [320,360,390,430,768,1024,1366,1920])test('settings '+width,async({page})=>{await page.setViewportSize({width,height:844});await page.goto('/index.html');await page.evaluate(()=>window.NA_MENU_NAVIGATION.navigate('pageConfig'));await expect(page.locator('#cfgNombre')).toBeVisible();if(width<768)await expect(page.locator('#naMobileMenuToggle')).toBeHidden();for(const cat of ['pos','apariencia','ticket','control','reseteo','importar','info','negocio']){await page.evaluate(cat=>window.switchCfgCategory(cat),cat);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}});
