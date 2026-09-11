// V1.2 RC on the exact POS files, using an isolated browser profile.
// --remote sends clearly identified test sales to the existing Worker/D1.
// Default mode uses the real Worker and SQLite fixture through browser routing.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workerFixture } from './worker-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const remote = process.argv.includes('--remote');
const endpoint = 'https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev';
const root = fileURLToPath(new URL('../../', import.meta.url));
const syncToken = remote ? process.env.SYNC_TOKEN : 'fixture-rc-write';
const readToken = remote ? process.env.READ_TOKEN : 'fixture-rc-read';
if (!syncToken || !readToken) throw new Error('Both credentials must be available in process environment');
if (syncToken === readToken) throw new Error('Credentials must differ');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!chrome) throw new Error('Chrome/Edge required');
const profile = mkdtempSync(path.join(tmpdir(), 'na-v12-rc-'));
const fixture = remote ? null : workerFixture(syncToken, readToken);
const checks = [];
const record = (name, details = {}) => { checks.push({ name, result: 'PASS', ...details }); console.log('PASS ' + name); };
const snapshot = page => page.evaluate(() => ({ sales: ventas.length, stock: productos.find(p => p.sku === 'RC-V12-TEST').stock, cloud: NuevoAmanecerOutbox.snapshot(), durable: JSON.parse(localStorage.getItem('na_snapshot_v9')) }));
let context, readerContext;
let fault = null;
async function launch(offline = false) {
  const ctx = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, viewport: { width: 1366, height: 900 } });
  await ctx.route('https://cdn.sheetjs.com/**', route => route.abort());
  if (fixture) await ctx.route(endpoint + '/**', async route => {
    const request = route.request();
    if(request.method()==='POST' && fault==='network')return route.abort('internetdisconnected');
    if(request.method()==='POST' && fault==='503')return route.fulfill({status:503,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:'{"error":"rc_injected_failure"}'});
    if(request.method()==='POST' && fault==='conflict'){
      const operation=JSON.parse(request.postData());
      fixture.insert({...operation,payload:{rc:'conflicting-record'},payload_hash:'0'.repeat(64),received_at:new Date().toISOString()});
      fault=null;
    }
    const response = await fixture.fetch(request.url(), { method: request.method(), headers: request.headers(), body: ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postData() });
    if(request.method()==='POST' && fault==='lost-ack'){fault=null;return route.abort('connectionclosed');}
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await ctx.setOffline(offline);
  ctx.on('page', p => p.on('dialog', d => d.accept()));
  return ctx;
}
async function load(ctx) {
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(pathToFileURL(path.join(root, 'POS/index.html')).href + '?na-test=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof NuevoAmanecerOutbox !== 'undefined' && !!NuevoAmanecerOutbox.snapshot());
  return page;
}
async function sale(page) {
  const result = await page.evaluate(async () => {
    const p = productos.find(p => p.sku === 'RC-V12-TEST');
    cart.push({ id: p.id, name: p.name, sku: p.sku, precio: 1, qty: 1, unitsPerQty: 1, ventaModo: 'unidad', costo: 0.5, controlInventario: true, ventaLibre: false, ventaSinStock: false, unidad: 'unidad' });
    posPayM = 'efectivo';
    document.getElementById('mMontoRec').value = '1';
    await confirmarVenta();
    return { count: ventas.length, toast: document.getElementById('gToast').textContent };
  });
  assert.ok(result.count > 0, 'Valid test sale must persist: ' + result.toast);
}
try {
  context = await launch();
  let page = await load(context);
  await page.evaluate(async () => {
    // This profile was created exclusively for this RC; no operator data exists here.
    productos=[]; ventas=[]; clientes=[]; creditos=[]; gastos=[]; cajMovs=[]; cashClosures=[]; inventoryMovements=[]; cart=[];
    appConfig.alertsEnabled=false; appConfig.printAuto=false; _naSecurity.pinEnabled=false;
    _naEnsureCashierConfig(); appConfig.activeCashierId='CAJ-001';
    const cashier=appConfig.cashiers.find(c=>c.id==='CAJ-001');
    if(cashier){cashier.role='admin';cashier.permissions=_naF10RoleDefaults('admin');}
    productos.push({id:Date.now(),name:'PRUEBA RC V1.2 — NO COMERCIAL',sku:'RC-V12-TEST',stock:10,controlInventario:true,precio:1,costo:0.5,unidad:'unidad'});
    cajEstado={abierta:false,cerrada:true,fondo:0,fechaApertura:obtenerHoy()};
    await saveAllData();
    abrirModalApertura();
    document.getElementById('cajFondo').value='10';
    document.getElementById('cajCajero').value='CAJ-001';
    await abrirCaja();
    return cajEstado.abierta;
  });
  await sale(page);
  let first = await snapshot(page);
  assert.equal(first.sales, 1); assert.equal(first.stock, 9);
  assert.equal(first.cloud.outbox.length, 3);
  assert.ok(first.cloud.outbox.every(o=>o.status==='PENDING'));
  record('local_sale_and_atomic_outbox');
  await context.setOffline(true);
  await sale(page);
  const beforeClose=await snapshot(page);
  assert.equal(beforeClose.sales, 2); assert.equal(beforeClose.stock, 8);
  assert.equal(beforeClose.cloud.outbox.length, 6);
  assert.ok(beforeClose.cloud.outbox.every(o=>o.status==='PENDING'));
  record('offline_sale_pending');
  await context.close(); context=null;
  context=await launch(true); page=await load(context);
  const reopened=await snapshot(page);
  assert.equal(reopened.sales, 2); assert.equal(reopened.stock, 8);
  assert.deepEqual(reopened.cloud, beforeClose.cloud);
  record('browser_process_close_reopen_offline_preserves_outbox');
  await page.evaluate(token=>NuevoAmanecerOutbox.configure({token,remember:false}),syncToken);
  await context.setOffline(false);
  await page.waitForFunction(() => NuevoAmanecerOutbox.snapshot().outbox.every(o=>o.status==='SYNCED'), null, { timeout: 45000 });
  const synced=await snapshot(page);
  assert.equal(synced.sales, 2); assert.equal(synced.stock, 8);
  assert.ok(synced.durable.cloudSync.outbox.every(o=>o.status==='SYNCED'));
  const serialized=JSON.stringify(synced.durable);
  assert.equal(serialized.includes(syncToken),false);
  assert.equal(serialized.includes(readToken),false);
  record(remote?'real_worker_d1_synced':'real_worker_sqlite_synced',{
    operations:6,deviceId:synced.cloud.device_id,
    expectedOperations:synced.cloud.outbox.map(o=>({operationId:o.operation_id,entityType:o.entity_type,entityId:o.entity_id})),
  });
  const op=synced.cloud.outbox[0];
  const retry=await page.evaluate(async ({endpoint,token,op})=>{
    const r=await fetch(endpoint+'/sync/operations',{method:'POST',headers:{'content-type':'application/json','x-sync-token':token},body:JSON.stringify(op)});
    return {status:r.status,body:await r.json()};
  },{endpoint,token:syncToken,op});
  assert.equal(retry.status,200);assert.equal(retry.body.status,'already_processed');
  record('same_operation_remote_idempotency');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!NuevoAmanecerOutbox.snapshot());
  assert.deepEqual((await snapshot(page)).cloud,synced.cloud);
  record('synced_state_survives_reload');
  readerContext=await chromium.launchPersistentContext(mkdtempSync(path.join(profile,'reader-')), {executablePath:chrome,headless:true,viewport:{width:390,height:844}});
  if(fixture) await readerContext.route(endpoint+'/**',async route=>{
    const r=await fixture.fetch(route.request().url(),{headers:route.request().headers()});
    await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()});
  });
  const reader=readerContext.pages()[0];
  await reader.goto(pathToFileURL(path.join(root,'POS/read-only.html')).href,{waitUntil:'domcontentloaded'});
  await reader.locator('#readToken').fill(readToken);
  await reader.locator('#connect').click();
  await reader.waitForFunction(()=>document.getElementById('connectionStatus').textContent==='Consulta actualizada.');
  assert.match(await reader.locator('#content').innerText(),/Estado de sincronización/);
  await reader.locator('[data-view="sales"]').click();
  await reader.waitForFunction(()=>document.querySelector('#content .item'));
  const saleId=synced.cloud.outbox.find(o=>o.entity_type==='sales').entity_id;
  const target=reader.locator('#content .item').filter({has:reader.locator('strong',{hasText:saleId})});
  assert.equal(await target.count(),1);
  await target.getByRole('button',{name:'Ver líneas'}).click();
  await reader.waitForFunction(()=>document.querySelector('#content h2')?.textContent.startsWith('Líneas de '));
  assert.match(await reader.locator('#content').innerText(),/RC-V12-TEST/);
  await reader.locator('[data-view="inventory-movements"]').click();
  await reader.waitForFunction(()=>document.querySelector('#content h2')?.textContent==='Movimientos de inventario');
  await reader.waitForFunction(()=>document.querySelector('#content .item'));
  assert.equal(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await reader.evaluate(()=>typeof window.NuevoAmanecerOutbox),'undefined');
  record('separate_browser_profile_mobile_read_only',{physicalSecondDevice:false});
  const dir=path.join(root,'evidence','v1.2');mkdirSync(dir,{recursive:true});
  await reader.screenshot({path:path.join(dir,remote?'reader-remote.png':'reader-local.png'),fullPage:true});
  if(!remote){
    await page.evaluate(token=>NuevoAmanecerOutbox.configure({token,remember:false}),syncToken);
    for(const scenario of [['503','HTTP_503'],['network','NETWORK'],['lost-ack','NETWORK']]){
      const count=(await snapshot(page)).sales, rowsBefore=fixture.count();
      fault=scenario[0];await sale(page);
      await page.waitForFunction(error=>NuevoAmanecerOutbox.snapshot().outbox.some(o=>o.status==='PENDING'&&o.last_error===error),scenario[1]);
      assert.equal((await snapshot(page)).sales,count+1);
      fault=null;
      await context.setOffline(true);await context.setOffline(false);
      await page.waitForFunction(()=>NuevoAmanecerOutbox.snapshot().outbox.every(o=>o.status==='SYNCED'));
      assert.equal(fixture.count(),rowsBefore+3);
      record('browser_'+scenario[0]+'_local_sale_and_safe_recovery');
    }
    await page.evaluate(()=>NuevoAmanecerOutbox.configure({token:'fixture-rc-wrong',remember:false}));
    const count401=(await snapshot(page)).sales;await sale(page);
    await page.waitForFunction(()=>NuevoAmanecerOutbox.snapshot().outbox.some(o=>o.last_error==='AUTH_401'));
    assert.equal((await snapshot(page)).sales,count401+1);
    const failed401=(await snapshot(page)).cloud.outbox.find(o=>o.last_error==='AUTH_401');
    await page.evaluate(async ({token,id})=>{NuevoAmanecerOutbox.configure({token,remember:false});await NuevoAmanecerOutbox.retryFailed(id);},{token:syncToken,id:failed401.operation_id});
    await page.waitForFunction(()=>NuevoAmanecerOutbox.snapshot().outbox.every(o=>o.status==='SYNCED'));
    record('browser_401_requires_explicit_retry_preserves_sale');
    fault='conflict';const count409=(await snapshot(page)).sales;await sale(page);
    await page.waitForFunction(()=>NuevoAmanecerOutbox.snapshot().outbox.some(o=>o.last_error==='CONFLICT_409'));
    const failed409=(await snapshot(page)).cloud.outbox.find(o=>o.last_error==='CONFLICT_409');
    assert.equal(await page.evaluate(id=>NuevoAmanecerOutbox.retryFailed(id),failed409.operation_id),false);
    await sale(page);assert.equal((await snapshot(page)).sales,count409+2);
    assert.equal(fixture.row(failed409.operation_id).payload_hash,'0'.repeat(64));
    record('browser_409_never_overwrites_and_next_local_sale_works');
    const backup=await page.evaluate(()=>_naCreateCompleteBackup());
    assert.equal(JSON.stringify(backup).includes(syncToken),false);
    assert.equal(JSON.stringify(backup).includes(readToken),false);
    assert.equal(backup.integrity.algorithm,'SHA-256');
    record('browser_complete_backup_excludes_cloud_credentials');
  }
  writeFileSync(path.join(dir,remote?'rc-remote.json':'rc-local.json'),JSON.stringify({at:new Date().toISOString(),mode:remote?'remote':'local-worker-fixture',checks,physicalSecondDevice:false},null,2)+'\n');
  console.log('RC_BROWSER '+checks.length+' PASS / 0 FAIL');
} finally {
  await readerContext?.close();await context?.close();fixture?.close();
  const absolute=path.resolve(profile), allowed=path.resolve(tmpdir())+path.sep;
  if(!absolute.startsWith(allowed)||!path.basename(absolute).startsWith('na-v12-rc-'))throw new Error('Unsafe temporary cleanup target');
  rmSync(absolute,{recursive:true,force:true});
}
