import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root=resolve('POS');
const server=createServer(async(req,res)=>{
  try{
    let file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(file===root)file=resolve(root,'index.html');
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>typeof securitySetPin==='function');
  // Durable snapshot with PIN disabled emulates the old replica restored at F5.
  await page.evaluate(async()=>{await loadAllData();await saveAllData();window.NuevoAmanecerCanonical={enabled:()=>true};});
  page.on('dialog',dialog=>dialog.accept('7391')); // Synthetic fixture PIN only.
  assert.equal(await page.evaluate(()=>securitySetPin()),true);
  await page.reload();
  await page.evaluate(()=>loadAllData());
  assert.equal(await page.evaluate(()=>_naPinValid('7391')),true);
  await page.evaluate(()=>securityLockNow());
  assert.equal(await page.locator('#securityLockScreen').evaluate(el=>el.classList.contains('open')),true);
  await page.locator('#securityUnlockPin').fill('7391');
  await page.locator('.security-unlock-btn').click();
  assert.equal(await page.evaluate(()=>securityIsLocked()),false);
  assert.deepEqual(errors,[]);
  console.log('CANON_SECURITY_BROWSER_PASS PIN persisted across reload with stale snapshot; lock/unlock succeeds');
}finally{await browser.close();await new Promise(done=>server.close(done));}
