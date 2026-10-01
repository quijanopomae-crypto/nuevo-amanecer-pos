import { test, expect, Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fork } from 'node:child_process';

const root = process.cwd();
async function harness(page: Page) {
  await page.route('**/local-first-harness', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><title>Local-first synthetic tests</title>' }));
  await page.goto('/local-first-harness');
  await page.addScriptTag({content:"const _NA_DB_NAME='NuevoAmanecerPOS';"});
  await page.addScriptTag({content:readFileSync(root+'/POS/js/legacy-inline/inline-17.js','utf8')});
  for(const name of ['canonical-local-reducer','canonical-local-store']) {
    const path=root+'/POS/js/sync/'+name+'.js';
    if(existsSync(path)) await page.addScriptTag({content:readFileSync(path,'utf8')});
  }
  await page.evaluate(() => {
    (window as any).__base={authority:'canonical',promotion_id:'synthetic-promotion',authority_epoch:3,revision:4,financial_revision:0,mode:'ACTIVE',read_only:false,minimum_client_contract:'a6-gate-c-v1',products:[{product_id:'p1',name:'Synthetic',tracks_inventory:1,current_stock_quantity:173,stock_revision:0,price_cents:200}],customers:[],credits:[],payments:[],creditAccounts:[],sales:[],saleItems:[],cashSessions:[],cashMovements:[],financialEvents:[],inventoryMovements:[],expenses:[]};
    (window as any).__grant={promotion_id:'synthetic-promotion',authority_epoch:3,writer_id:'writer1',grant_id:'grant1'};
  });
}

test('V10 local commit persists projection, ledger and checkpoint before returning; reload reconstructs',async({page})=>{
  await harness(page);
  expect(await page.evaluate(()=>typeof (window as any).NuevoAmanecerCanonicalLocalStore)).toBe('object');
  const result=await page.evaluate(async()=>{
    const w=window as any,s=w.NuevoAmanecerCanonicalLocalStore;
    await s.initialize(w.__base,w.__grant);
    const op=crypto.randomUUID();
    await s.commit(()=>({command:'cash.open',payload:{operation_id:op,promotion_id:'synthetic-promotion',authority_epoch:3,expected_control_revision:4,client_contract:'a6-gate-c-v1',created_at:new Date().toISOString(),session_id:'cash1',opening_cents:100}}));
    const state=await s.read();
    return {sequence:state.sequence,ledger:state.events.length,cash:state.projection.cashSessions[0].expected_cents,operation:state.events[0].operation_id,status:state.events[0].state,op,dbs:await indexedDB.databases(),backup:await s.exportBackup()};
  });
  expect(result).toMatchObject({sequence:1,ledger:1,cash:100,status:'LOCAL_COMMITTED'});
  expect(result.operation).toBe(result.op);
  expect(result.dbs.map(db=>db.name)).toEqual(['NuevoAmanecerPOS']);
  expect(JSON.stringify(result.backup)).not.toMatch(/"(?:token|pin|password|credential)"/i);
  await harness(page);
  expect(await page.evaluate(async()=>{
    const s=(window as any).NuevoAmanecerCanonicalLocalStore;
    const stored=await s.read(),rebuilt=await s.reconstruct();
    return {cash:stored.projection.cashSessions[0].expected_cents,equal:JSON.stringify(stored.projection)===JSON.stringify(rebuilt)};
  })).toEqual({cash:100,equal:true});
});

async function posHarness(page:Page,cleanup:Array<()=>void>,options:{lostAck?:boolean,shipped?:boolean}={}) {
  // Explicitly reset network emulation before the online synthetic bootstrap.
  await page.context().setOffline(false);
  const child=fork(root+'/tests/cloud-sync/canonical-local-first-browser-fixture.mjs',[],{execArgv:[]});
  cleanup.push(()=>child.kill());
  let next=0; const pending=new Map<number,{resolve:(value:any)=>void,reject:(error:Error)=>void}>();
  const control=await new Promise<any>((resolve,reject)=>{
    child.on('error',reject);
    child.on('message',(message:any)=>{
      if(message.ready)resolve(message.control);
      else {const request=pending.get(message.id);if(request){pending.delete(message.id);if(message.error)request.reject(new Error(message.error));else request.resolve(message.value);}}
    });
    child.on('exit',code=>{const error=new Error('Synthetic fixture exited '+code);reject(error);for(const request of pending.values())request.reject(error);});
  });
  function request(value:any):Promise<any>{return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});child.send({...value,id});});}
  const f={sql:(sql:string)=>request({type:'sql',sql}),fetch:async(url:string,options:any)=>{const response=await request({type:'fetch',url,options});return new Response(response.body,{status:response.status});}};
  const calls:Array<{path:string,method:string,body:any}>=[];let loseAck=options.lostAck;
  await page.route('**/read/canonical/**',async route=>{const u=new URL(route.request().url());calls.push({path:u.pathname,method:'GET',body:null});const response=await f.fetch('http://localhost'+u.pathname+u.search,{headers:route.request().headers()});await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});});
  await page.route('**/auth/local-writer',async route=>{const request=route.request(),u=new URL(request.url());const response=await f.fetch('http://localhost'+u.pathname,{method:request.method(),headers:request.headers(),body:request.method()==='POST'?request.postData():undefined});await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});});
  await page.route('**/commands/**',async route=>{const request=route.request(),u=new URL(request.url());calls.push({path:u.pathname,method:'POST',body:JSON.parse(request.postData()||'{}')});const response=await f.fetch('http://localhost'+u.pathname,{method:'POST',headers:request.headers(),body:request.postData()});if(loseAck && u.pathname==='/commands/sale.create' && response.status===201){loseAck=false;await route.abort();return;}await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});});
  if(options.shipped){
    // Existing authenticated CANON session only: no V10, injected runtime,
    // remote refresh, or programmatic local-first activation.
    await page.addInitScript(control=>{
      localStorage.setItem('na_canonical_binding',JSON.stringify({endpoint:location.origin,promotion_id:control.active_promotion_id,authority_epoch:control.authority_epoch,revision:control.revision}));
      if(!localStorage.getItem('na_cloud_sync_credentials'))localStorage.setItem('na_cloud_sync_credentials',JSON.stringify({endpoint:location.origin,token:'writer-token'}));
    },control);
    await page.goto('/index.html');
    await page.waitForFunction(()=>(window as any).NuevoAmanecerCanonical?.sourceState().validation==='activation-required');
    await page.waitForSelector('#naLocalWork');
    return {f,calls};
  }
  await harness(page);
  for(const name of ['adapters/canonical-ui-adapter','sync/canonical-client','sync/canonical-sale-intent','sync/canonical-local-first']) {
    const path=root+'/POS/js/'+name+'.js';if(existsSync(path))await page.addScriptTag({content:readFileSync(path,'utf8')});
  }
  await page.evaluate(async control=>{
    const api=(window as any).NuevoAmanecerCanonical;
    await api.configure({endpoint:location.origin,promotion_id:control.active_promotion_id,authority_epoch:control.authority_epoch,revision:control.revision,token:'writer-token'});
    await api.refresh();
  },control);
  return {f,calls};
}

test('shipped startup requires UI activation and restores V10 offline in a new tab without foreground cloud',async({page,context})=>{
 const cleanup:Array<()=>void>=[];try{
  const {calls}=await posHarness(page,cleanup,{shipped:true});
  await expect(page.locator('#naLocalWork')).toBeVisible();
  const closed=await page.evaluate(async()=>{let error='';try{await (window as any).NuevoAmanecerCanonical.openCash({session_id:'must-not-cloud',opening_cents:0});}catch(e){error=(e as Error).message;}return error;});
  expect(closed).toBe('LOCAL_BASELINE_REQUIRED');
  expect(calls).toHaveLength(0);
  const otherCommands=await page.evaluate(async()=>{const api=(window as any).NuevoAmanecerCanonical,errors=[];for(const name of ['createSale','createPayment','createPaymentBatch','closeCash','createExpense','adjustInventory','createCustomer','setCustomerCreditPolicy','createCreditAccount','createProduct']){try{await api[name](name==='createPaymentBatch'?[{}]:{});errors.push('unexpected commit');}catch(e){errors.push((e as Error).message);}}return errors;});
  expect(otherCommands).toEqual(Array(10).fill('LOCAL_BASELINE_REQUIRED'));expect(calls).toHaveLength(0);
  await page.locator('#naLocalWork').click();await page.getByLabel('Autorización del propietario').fill('synthetic-owner-secret');
  await page.locator('dialog').getByRole('button',{name:'Activar este equipo para ventas',exact:true}).click();
  await expect(page.locator('dialog [role="status"]')).toHaveText('Este equipo está activo para ventas.');
  await page.locator('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
  await context.setOffline(true);
  await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.openCash({session_id:'offline-startup',opening_cents:100});});
  // A new tab has no sessionStorage proof, but retains the same authorized session.
  const next=await context.newPage();await next.goto('/index.html');
  await next.waitForFunction(()=>(window as any).NuevoAmanecerCanonical?.sourceState().source==='local');
  const count=calls.length;
  await next.evaluate(async()=>{const w=window as any;await w.NuevoAmanecerCanonical.createExpense({expense_id:'new-tab-expense',amount_cents:100,payment_method:'efectivo',session_id:'offline-startup',concept:'Synthetic expense',category:'Other',expense_date:'2026-10-01'});});
  expect(calls.length).toBe(count);
  expect(await next.evaluate(()=>(window as any).NuevoAmanecerCanonical.snapshot().expenses.length)).toBe(1);
  await next.close();
 }finally{await context.setOffline(false);cleanup.forEach(fn=>fn());}
});

test('local sync metadata preserves the visible Config DOM and unsaved input',async({page})=>{
 const cleanup:Array<()=>void>=[];try{
  await posHarness(page,cleanup,{shipped:true});await page.locator('#naLocalWork').click();
  await page.getByLabel('Autorización del propietario').fill('synthetic-owner-secret');
  await page.locator('dialog').getByRole('button',{name:'Activar este equipo para ventas',exact:true}).click();
  await expect(page.locator('dialog [role="status"]')).toHaveText('Este equipo está activo para ventas.');
  await page.locator('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.evaluate(()=>(window as any).goPage('pageConfig'));await expect(page.locator('#cfgContent')).toBeVisible();
  const result=await page.evaluate(async()=>{const w=window as any,content=document.getElementById('cfgContent')!,input=content.querySelector('input')!;input.value='Unsaved synthetic edit';let mutations=0;const observer=new MutationObserver(records=>{mutations+=records.filter(r=>r.type==='childList').length;});observer.observe(content,{childList:true,subtree:true});await w.NuevoAmanecerCanonicalLocalStore.update('synthetic-sync-metadata',(s:any)=>{s.cloud.last_error='Synthetic temporary timeout';});await w.NuevoAmanecerCanonical.refresh();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));observer.disconnect();return {mutations,sameInput:input.isConnected,value:input.value};});
  expect(result).toEqual({mutations:0,sameInput:true,value:'Unsaved synthetic edit'});
 }finally{cleanup.forEach(fn=>fn());}
});

test('real POS UI activation → cash, consecutive sales and two customers payments before a 60s cloud ACK → offline F5 → background reconciliation',async({page,context})=>{
 test.setTimeout(100000);
 const cleanup:Array<()=>void>=[],delays:Array<()=>void>=[];try{
  await page.setViewportSize({width:393,height:851});
  const {f,calls}=await posHarness(page,cleanup,{shipped:true});
  await page.locator('#naLocalWork').click();
  await page.getByLabel('Autorización del propietario').fill('synthetic-owner-secret');
  await page.locator('dialog').getByRole('button',{name:'Activar este equipo para ventas',exact:true}).click();
  await expect(page.locator('dialog [role="status"]')).toHaveText('Este equipo está activo para ventas.');
  await page.locator('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).NuevoAmanecerCanonicalLocalFirst.active())).toBe(true);
  let slowUntil=0,waiting=false;
  await page.route('**/commands/**',async route=>{
   const req=route.request(),u=new URL(req.url());calls.push({path:u.pathname,method:'POST',body:JSON.parse(req.postData()||'{}')});
   if(!slowUntil)slowUntil=Date.now()+60000;
   waiting=true;
   await new Promise<void>(resolve=>{const timer=setTimeout(resolve,Math.max(0,slowUntil-Date.now()));delays.push(()=>{clearTimeout(timer);resolve();});});
   try{const response=await f.fetch('http://localhost'+u.pathname,{method:'POST',headers:req.headers(),body:req.postData()});await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});}catch(_){}
  });
  const metrics:Record<string,number>={},foreground:Array<number>=[];
  async function visible(name:string,action:()=>Promise<void>){const count=calls.length,t=Date.now();await action();metrics[name]=Date.now()-t;foreground.push(calls.length-count);expect(metrics[name]).toBeLessThan(2000);}
  await page.locator('.module-card[onclick*="pageCaja"]').click();
  await page.locator('#cajContent .btn-abrir-cj').click();await page.locator('#cajFondo').fill('10');
  await visible('cashOpenMs',async()=>{await page.locator('#mApertura .mbtn-ok').click();await expect(page.locator('#mApertura')).not.toHaveClass(/open/);});
  await expect.poll(()=>waiting,{timeout:5000}).toBe(true);
  async function sale(name:string){
   await page.evaluate(()=>(window as any).goPage('pagePOS'));
   await page.locator('[data-product-id="00001"]').click();await page.locator('#btnPagar').click();
   await visible(name,async()=>{await page.locator('#mBtnConf').click();await expect(page.locator('#mCobro')).not.toHaveClass(/open/);await expect(page.locator('#mBtnConf')).toBeEnabled();});
  }
  await sale('firstSaleMs');await sale('secondSaleMs');
  expect((await f.sql('SELECT COUNT(*) n FROM sales')).n).toBe(0);
  await page.evaluate(()=>(window as any).abrirModalGasto());await page.locator('#gasDesc').fill('Synthetic visible expense');await page.locator('#gasMonto').fill('1');
  await visible('expenseMs',async()=>{await page.locator('#mGasto .mbtn-ok').click();await expect(page.locator('#mGasto')).not.toHaveClass(/open/);});
  await sale('saleAfterExpenseMs');
  // A distinct synthetic customer and credit, also committed while the first ACK is held.
  const secondCredit=await page.evaluate(async()=>{const w=window as any,api=w.NuevoAmanecerCanonical,c=await api.createCustomer({name:'Synthetic second customer',document:'87654321'});await api.setCustomerCreditPolicy({customer_id:c.customer_id,mode:'MANUAL',manual_limit_cents:10000,reason:'Synthetic policy',administrator_id:'owner',administrator_name:'Owner'});const r=await api.createSale(w.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-004',customer_id:c.customer_id,payment_method:'credito',credit_due:'2026-12-01',items:[{product_id:'00001',quantity:1,precio:2}]}));return api.snapshot().credits.find((credit:any)=>credit.customer_id===c.customer_id).credit_id;});
  for(const [index,id] of ['CR:001',secondCredit].entries()){
   await page.evaluate(()=>(window as any).goPage('pageClientes'));
   await page.evaluate(id=>(window as any).abrirPago(id),id);await expect(page.locator('#mPagoCred')).toHaveClass(/open/);await page.locator('#pagoMonto').fill('1');
   await visible('payment'+index+'Ms',async()=>{await page.locator('#pagoConfirmBtn').click({timeout:3000});await expect(page.locator('#mPagoCred')).not.toHaveClass(/open/);await expect(page.locator('#pagoConfirmBtn')).toBeEnabled();});
  }
  expect(await page.evaluate(()=>(window as any).NuevoAmanecerCanonical.snapshot().payments.filter((p:any)=>p.operation_id).length)).toBe(2);
  expect(foreground).toEqual(Array(foreground.length).fill(0));
  await context.setOffline(true);const offlineCount=calls.length;
  const offline=await page.evaluate(async()=>{const w=window as any,api=w.NuevoAmanecerCanonical;const session=api.snapshot().cashSessions.find((s:any)=>s.status==='OPEN');await api.closeCash({session_id:session.session_id,counted_cents:1700});await api.openCash({session_id:'android-offline-cash',opening_cents:0});for(const sale_id of ['V-005','V-006'])await api.createSale(w.NuevoAmanecerCanonicalSaleIntent.build({sale_id,payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]}));await api.createPayment({credit_id:'CR:001',amount_cents:100,payment_method:'efectivo',session_id:'android-offline-cash'});await api.createExpense({expense_id:'android-offline-expense',amount_cents:100,payment_method:'efectivo',session_id:'android-offline-cash',concept:'Synthetic offline expense',category:'Other',expense_date:'2026-10-01'});await api.closeCash({session_id:'android-offline-cash',counted_cents:400});return {sales:api.snapshot().sales.length,events:(await w.NuevoAmanecerCanonicalLocalStore.read()).events.length};});
  expect(calls.length).toBe(offlineCount);expect(offline.sales).toBe(6);
  const reload=Date.now();await page.reload();await page.waitForFunction(()=>(window as any).NuevoAmanecerCanonical?.sourceState().source==='local');metrics.offlineStartupMs=Date.now()-reload;expect(metrics.offlineStartupMs).toBeLessThan(2000);
  expect(await page.evaluate(()=>(window as any).NuevoAmanecerCanonical.snapshot().sales.length)).toBe(6);
  expect(await page.evaluate(async()=>(await (window as any).NuevoAmanecerCanonicalLocalStore.read()).events.length)).toBe(offline.events);
  // Keep the real 60-second response delay; no timeout or retry policy is shortened.
  while(Date.now()<slowUntil+100)await page.waitForTimeout(Math.min(1000,slowUntil+100-Date.now()));
  await context.setOffline(false);await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.syncLocal();});
  await expect.poll(()=>page.evaluate(async()=>(await (window as any).NuevoAmanecerCanonicalLocalStore.read()).events.length),{timeout:15000}).toBe(0);
  expect((await f.sql('SELECT COUNT(*) n FROM sales')).n).toBe(6);
  expect((await f.sql("SELECT current_stock_quantity n FROM products WHERE product_id='00001'")).n).toBe(167);
  console.log('REAL_POS_ANDROID_FLOW_METRICS',JSON.stringify({...metrics,cloudLatencyMs:60000,foregroundNetworkOnCommit:foreground.reduce((a,b)=>a+b,0)}));
 }finally{delays.forEach(fn=>fn());await context.setOffline(false);cleanup.forEach(fn=>fn());}
});

test('offline POS cash→two sales→payment→expense→close commits locally, survives reload and syncs in FIFO through Turso adapter',async({page,context})=>{
  const cleanup:Array<()=>void>=[];try{
    const {f,calls}=await posHarness(page,cleanup);
    expect(await page.evaluate(()=>typeof (window as any).NuevoAmanecerCanonical.enableLocalFirst)).toBe('function');
    await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');});
    await context.setOffline(true);const count=calls.length;
    const result=await page.evaluate(async()=>{
      const api=(window as any).NuevoAmanecerCanonical,t0=performance.now();
      await api.openCash({session_id:'local-cash',opening_cents:0});
      const build=(window as any).NuevoAmanecerCanonicalSaleIntent;
      for(const sale_id of ['V-001','V-002']) await api.createSale(build.build({sale_id,payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]}));
      await api.createPayment({credit_id:'CR:001',amount_cents:100,payment_method:'efectivo',session_id:'local-cash'});
      await api.createExpense({expense_id:'local-expense',amount_cents:100,payment_method:'efectivo',session_id:'local-cash',concept:'Synthetic expense',category:'Other',expense_date:'2026-10-01'});
      await api.closeCash({session_id:'local-cash',counted_cents:400});
      const s=api.snapshot();return {ms:performance.now()-t0,stock:s.products.find((p:any)=>p.product_id==='00001').current_stock_quantity,sales:s.sales.map((s:any)=>s.sale_id),cash:s.cashSessions[0],balance:s.credits[0].current_balance_cents,source:api.sourceState(),pending:api.pendingSnapshot()};
    });
    expect(calls.length).toBe(count);expect(result.stock).toBe(171);expect(result.sales).toEqual(['V-001','V-002']);expect(result.balance).toBe(600);expect(result.cash).toMatchObject({status:'CLOSED',expected_cents:400,counted_cents:400,difference_cents:0,revision:5});expect(result.pending).toBeNull();
    console.log('LOCAL_FIRST_OFFLINE_METRIC',JSON.stringify({sixCommitsMs:result.ms,requestsBeforeCommit:0}));
    // Reload the JS/runtime; real IndexedDB survives.
    await harness(page);
    for(const name of ['adapters/canonical-ui-adapter','sync/canonical-client','sync/canonical-sale-intent','sync/canonical-local-first'])await page.addScriptTag({content:readFileSync(root+'/POS/js/'+name+'.js','utf8')});
    await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.startPOS();});
    expect(await page.evaluate(()=>(window as any).NuevoAmanecerCanonical.snapshot().sales.length)).toBe(2);
    await context.setOffline(false);
    await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.syncLocal();});
    expect((await f.sql("SELECT current_stock_quantity n FROM products WHERE product_id='00001'")).n).toBe(171);expect((await f.sql('SELECT COUNT(*) n FROM sales')).n).toBe(2);expect((await f.sql('SELECT COUNT(*) n FROM cash_movements')).n).toBe(2);
    expect((await f.sql("SELECT status,expected_cents,counted_cents,difference_cents FROM canonical_cash_state WHERE session_id='local-cash'"))).toMatchObject({status:'CLOSED',expected_cents:400,counted_cents:400,difference_cents:0});
    expect(await page.evaluate(async()=>(await (window as any).NuevoAmanecerCanonicalLocalStore.read()).events.length)).toBe(0);
    expect(calls.filter(c=>c.method==='POST').map(c=>c.path)).toEqual(['/commands/cash.open','/commands/sale.create','/commands/sale.create','/commands/payment.create','/commands/expense.create','/commands/cash.close']);
  }finally{cleanup.forEach(fn=>fn());}
});

test('lost cloud ACK never blocks the next local sale, exact retry changes neither stock nor cash twice',async({page})=>{
  const cleanup:Array<()=>void>=[];try{
    const {f,calls}=await posHarness(page,cleanup,{lostAck:true});
    expect(await page.evaluate(()=>typeof (window as any).NuevoAmanecerCanonical.enableLocalFirst)).toBe('function');
    await page.evaluate(async()=>{const w=window as any;await w.NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');await w.NuevoAmanecerCanonical.openCash({session_id:'cash',opening_cents:0});await w.NuevoAmanecerCanonical.syncLocal();});
    await page.addScriptTag({content:readFileSync(root+'/POS/js/sync/canonical-sale-intent.js','utf8')});
    await page.evaluate(async()=>{const w=window as any;const b=w.NuevoAmanecerCanonicalSaleIntent;await w.NuevoAmanecerCanonical.createSale(b.build({sale_id:'V-001',payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]}));await w.NuevoAmanecerCanonical.syncLocal();await w.NuevoAmanecerCanonical.createSale(b.build({sale_id:'V-002',payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]}));await w.NuevoAmanecerCanonical.syncLocal();});
    const posts=calls.filter(c=>c.path==='/commands/sale.create');expect(posts).toHaveLength(3);expect(posts[0].body).toEqual(posts[1].body);
    expect((await f.sql('SELECT COUNT(*) n FROM sales')).n).toBe(2);expect((await f.sql("SELECT current_stock_quantity n FROM products WHERE product_id='00001'")).n).toBe(171);expect((await f.sql('SELECT COUNT(*) n FROM cash_movements')).n).toBe(2);
  }finally{cleanup.forEach(fn=>fn());}
});

test('two tabs serialize local commits without duplicate sequence or cash session',async({page,context})=>{
  await harness(page);
  await page.evaluate(async()=>{const w=window as any;await w.NuevoAmanecerCanonicalLocalStore.initialize(w.__base,w.__grant);});
  const second=await context.newPage();await harness(second);
  const open=(tab:Page,id:string)=>tab.evaluate(async(id)=>{
    try {await (window as any).NuevoAmanecerCanonicalLocalStore.commit(()=>({command:'cash.open',payload:{operation_id:crypto.randomUUID(),promotion_id:'synthetic-promotion',authority_epoch:3,expected_control_revision:4,client_contract:'a6-gate-c-v1',created_at:new Date().toISOString(),session_id:id,opening_cents:0}}));return 'saved';}
    catch(error){return (error as Error).message;}
  },id);
  const results=await Promise.all([open(page,'a'),open(second,'b')]);
  expect(results.filter(r=>r==='saved')).toHaveLength(1);
  expect(await page.evaluate(async()=>{const state=await (window as any).NuevoAmanecerCanonicalLocalStore.read();return {sequence:state.sequence,cash:state.projection.cashSessions.length};})).toEqual({sequence:1,cash:1});
});

test('credit account and offline payment batch sync without a false cloud-loss warning',async({page,context})=>{
  const cleanup:Array<()=>void>=[];try{
    const {f,calls}=await posHarness(page,cleanup);
    await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');});
    await context.setOffline(true);const count=calls.length;
    const receipt=await page.evaluate(async()=>{
      const api=(window as any).NuevoAmanecerCanonical;
      await api.createCreditAccount({customer_id:'000C',account_id:'large',name:'Large',mode:'separate'});
      await api.openCash({session_id:'batch-cash',opening_cents:0});
      return api.createPaymentBatch([{credit_id:'CR:001',amount_cents:100,payment_method:'efectivo',session_id:'batch-cash'}]);
    });
    expect(receipt[0]).toMatchObject({status:'local_committed',local_committed:true});expect(calls.length).toBe(count);
    await context.setOffline(false);
    expect(await page.evaluate(async()=>(window as any).NuevoAmanecerCanonical.syncLocal())).toEqual({state:'UP_TO_DATE'});
    expect((await f.sql("SELECT current_balance_cents n FROM canonical_credit_balances WHERE credit_id='CR:001'")).n).toBe(600);
    expect(calls.filter(c=>c.method==='POST').map(c=>c.path)).toEqual(['/commands/credit-account.create','/commands/cash.open','/commands/payment.batch']);
  }finally{cleanup.forEach(fn=>fn());}
});

test('activation preserves unknown legacy intents as NEEDS_REVIEW and blocks only their resources',async({page})=>{
  const cleanup:Array<()=>void>=[];try{
    await posHarness(page,cleanup);
    const result=await page.evaluate(async()=>{
      const w=window as any,original={operation_id:'original-operation',sale_id:'V-001',items:[{product_id:'00001',quantity:1}]};
      w.NuevoAmanecerCanonicalSaleOutbox={snapshot:()=>({intents:[original]})};
      await w.NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');
      const state=await w.NuevoAmanecerCanonicalLocalStore.read();
      let blocked='';try{await w.NuevoAmanecerCanonical.adjustInventory({product_id:'00001',movement_type:'ENTRADA',quantity:1,reason:'Synthetic inventory'});}catch(e){blocked=(e as Error).message;}
      await w.NuevoAmanecerCanonical.createCustomer({name:'Unrelated synthetic customer',document:'12345678'});
      return {evidence:state.migration.evidence[0],complete:state.migration.complete,original:w.NuevoAmanecerCanonicalSaleOutbox.snapshot().intents[0],blocked,customers:w.NuevoAmanecerCanonical.snapshot().customers.length};
    });
    expect(result.evidence).toMatchObject({operation_id:'original-operation',state:'NEEDS_REVIEW',source:'legacy-sale-outbox'});
    expect(result.original.operation_id).toBe('original-operation');expect(result.blocked).toBe('LOCAL_RESOURCE_REQUIRES_REVIEW');expect(result.complete).toBe(true);expect(result.customers).toBe(2);
  }finally{cleanup.forEach(fn=>fn());}
});

test('migration reconciles a legacy sale with lost ACK by its original UUID and payload',async({page})=>{
  const cleanup:Array<()=>void>=[];try{
    const {f,calls}=await posHarness(page,cleanup,{lostAck:true});
    const result=await page.evaluate(async()=>{
      const w=window as any,api=w.NuevoAmanecerCanonical;
      await api.openCash({session_id:'legacy-cash',opening_cents:0});
      const intent=w.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-001',payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]});
      try{await api.createSale(intent);}catch(_){}
      w.NuevoAmanecerCanonicalSaleOutbox={snapshot:()=>({intents:[intent]})};
      await api.enableLocalFirst('synthetic-owner-secret');
      const state=await w.NuevoAmanecerCanonicalLocalStore.read();return {operation:intent.operation_id,evidence:state.migration.evidence,pending:state.events.length,sales:state.projection.sales.length};
    });
    expect(result.pending).toBe(0);expect(result.sales).toBe(1);expect(result.evidence.every((e:any)=>e.operation_id===result.operation && e.state==='CONFIRMED')).toBe(true);
    const posts=calls.filter(c=>c.path==='/commands/sale.create');expect(posts).toHaveLength(2);expect(posts[0].body).toEqual(posts[1].body);expect((await f.sql("SELECT current_stock_quantity n FROM products WHERE product_id='00001'")).n).toBe(172);
  }finally{cleanup.forEach(fn=>fn());}
});

test('a changed session cannot use the previous writer snapshot offline',async({page,context})=>{
  const cleanup:Array<()=>void>=[];try{
    await posHarness(page,cleanup);
    await page.evaluate(async()=>{const w=window as any;await w.NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');const credentials=JSON.parse(localStorage.getItem('na_cloud_sync_credentials')||'{}');credentials.token='different-principal';localStorage.setItem('na_cloud_sync_credentials',JSON.stringify(credentials));});
    await context.setOffline(true);
    const result=await page.evaluate(async()=>{try{await (window as any).NuevoAmanecerCanonical.openCash({session_id:'wrong-writer',opening_cents:0});return 'unexpected commit';}catch(error){return String((error as Error).message);}});
    expect(result).toBe('LOCAL_WRITER_SESSION_REVALIDATION_REQUIRED');
    expect(await page.evaluate(async()=>(await (window as any).NuevoAmanecerCanonicalLocalStore.read()).events.length)).toBe(0);
  }finally{cleanup.forEach(fn=>fn());}
});

test('durable retry envelopes cannot be rewritten by metadata updates',async({page,context})=>{
  const cleanup:Array<()=>void>=[];try{
    await posHarness(page,cleanup);
    await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');});
    await context.setOffline(true);
    const error=await page.evaluate(async()=>{
      const w=window as any;await w.NuevoAmanecerCanonical.openCash({session_id:'immutable-cash',opening_cents:100});
      try{await w.NuevoAmanecerCanonicalLocalStore.update('invalid-rewrite',(state:any)=>{state.events[0].envelope.parts[0].payload.opening_cents=999;});return 'accepted';}catch(e){return (e as Error).message;}
    });
    expect(error).toBe('LOCAL_ENVELOPE_CONFLICT');
    expect(await page.evaluate(async()=>(await (window as any).NuevoAmanecerCanonicalLocalStore.read()).events[0].envelope.parts[0].payload.opening_cents)).toBe(100);
  }finally{cleanup.forEach(fn=>fn());}
});

test('Confirmar venta uses real global let, closes both payment modals after local durability and refreshes history offline',async({page,context})=>{
  const cleanup:Array<()=>void>=[];try{
    await posHarness(page,cleanup);
    await page.addScriptTag({content:`
      let cart=[],productos=[],ventas=[],clientes=[],posProc=false,posPayM='efectivo';
      const toast=(message)=>globalThis.__messages.push(message);
      const cerrarModal=(id)=>document.getElementById(id)?.classList.remove('open');
      globalThis.__messages=[];
      globalThis.isModuleLocked=()=>false;globalThis._naSessionOpen=()=>true;
      globalThis._naPaymentState=()=>({valid:true});
      globalThis.NuevoAmanecerCanonicalSaleOutbox={snapshot:()=>({intents:[]}),enqueue:()=>{throw Error('legacy queue forbidden');}};
      addEventListener('na:canonical-updated',()=>{const view=NuevoAmanecerCanonical.legacySnapshot();productos=view.products;ventas=view.sales;clientes=view.customers;});
    `});
    await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');await (window as any).NuevoAmanecerCanonical.openCash({session_id:'ui-cash',opening_cents:0});document.body.insertAdjacentHTML('beforeend','<div id="mCobro" class="open"></div><div id="mCobroRapido" class="open"></div><button id="mBtnConf">Confirmar</button>');});
    await page.addScriptTag({content:readFileSync(root+'/POS/js/sync/canonical-sale-integration.js','utf8')});
    await context.setOffline(true);
    const result=await page.evaluate(async()=>{
      const w=window as any;
      const setCart=new Function("cart=[{id:productos.find(p=>p.id==='00001').id,qty:1,precio:2}];");setCart();
      const receipt=await w.confirmarVenta();
      return {receipt,lexical:new Function('return {cart:cart.length,processing:posProc,stock:productos.find(p=>p.id===\'00001\').stock,sales:ventas.length};')(),globals:['cart','productos','ventas','clientes','posProc','posPayM'].filter(key=>Object.hasOwn(w,key)),modal:document.getElementById('mCobro')?.classList.contains('open'),quick:document.getElementById('mCobroRapido')?.classList.contains('open'),button:(document.getElementById('mBtnConf') as HTMLButtonElement).disabled,messages:w.__messages};
    });
    expect(result).toMatchObject({receipt:{status:'LOCAL_COMMITTED',sale_id:'V-001'},lexical:{cart:0,processing:false,stock:172,sales:1},globals:[],modal:false,quick:false,button:false});
    expect(result.messages.at(-1)).toContain('pendiente de sincronización');
  }finally{cleanup.forEach(fn=>fn());}
});

test('retrying the identical sale intent before and after ACK returns the original sale without new effects',async({page})=>{
  const cleanup:Array<()=>void>=[];try{
    const {f}=await posHarness(page,cleanup);
    const result=await page.evaluate(async()=>{
      const w=window as any,api=w.NuevoAmanecerCanonical;
      await api.enableLocalFirst('synthetic-owner-secret');await api.openCash({session_id:'retry-cash',opening_cents:0});
      const intent=w.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-001',payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]});
      const first=await api.createSale(intent),pending=await api.createSale(intent);await api.syncLocal();const acked=await api.createSale(intent);
      return {ids:[first.sale_id,pending.sale_id,acked.sale_id],sales:api.snapshot().sales.length,stock:api.snapshot().products.find((p:any)=>p.product_id==='00001').current_stock_quantity};
    });
    expect(result).toEqual({ids:['V-001','V-001','V-001'],sales:1,stock:172});expect((await f.sql('SELECT COUNT(*) n FROM sales')).n).toBe(1);
  }finally{cleanup.forEach(fn=>fn());}
});

test('fabricated saved batch receipts cannot bypass POST or acknowledge an unsent local payment',async({page,context})=>{
  const cleanup:Array<()=>void>=[];try{
    const {f}=await posHarness(page,cleanup);
    await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');});
    await context.setOffline(true);
    const result=await page.evaluate(async()=>{
      const w=window as any;await w.NuevoAmanecerCanonical.createPaymentBatch([{credit_id:'CR:001',amount_cents:100,payment_method:'yape',reference:'synthetic-batch'}]);
      try{await w.NuevoAmanecerCanonicalLocalStore.update('corrupt-receipt',(s:any)=>{s.events[0].envelope.receipts=[{receipts:[]}];});return 'accepted';}catch(error){return (error as Error).message;}
    });
    expect(result).toBe('LOCAL_RECEIPT_CONFLICT');expect((await f.sql('SELECT COUNT(*) n FROM canonical_financial_operations')).n).toBe(0);
  }finally{cleanup.forEach(fn=>fn());}
});

test('cloud loss after an empty outbox is detected without overwriting or blocking a new local sale',async({page})=>{
  const cleanup:Array<()=>void>=[];try{
    await posHarness(page,cleanup);
    const status=await page.evaluate(async()=>{const api=(window as any).NuevoAmanecerCanonical;await api.enableLocalFirst('synthetic-owner-secret');await api.openCash({session_id:'loss-cash',opening_cents:0});await api.syncLocal();return {...api.snapshot(),financial_revision:0};});
    await page.route('**/read/canonical/status',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(status)}));
    expect(await page.evaluate(async()=>(window as any).NuevoAmanecerCanonical.syncLocal())).toEqual({state:'CLOUD_RECOVERY_REQUIRED'});
    const result=await page.evaluate(async()=>{const w=window as any;const receipt=await w.NuevoAmanecerCanonical.createSale(w.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-001',payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]}));const state=await w.NuevoAmanecerCanonicalLocalStore.read();return {receipt:receipt.status,stock:state.projection.products.find((p:any)=>p.product_id==='00001').current_stock_quantity,sync:state.cloud.state,pending:state.events.length};});
    expect(result).toEqual({receipt:'local_committed',stock:172,sync:'CLOUD_RECOVERY_REQUIRED',pending:1});
  }finally{cleanup.forEach(fn=>fn());}
});

test('cloud-to-local recovery needs owner confirmation and a matching exported backup; cancel keeps every local operation',async({page,context})=>{
  const cleanup:Array<()=>void>=[];try{
    await posHarness(page,cleanup);
    const path=root+'/POS/js/sync/canonical-local-recovery.js';if(existsSync(path))await page.addScriptTag({content:readFileSync(path,'utf8')});
    expect(await page.evaluate(()=>typeof (window as any).NuevoAmanecerCanonicalLocalRecovery)).toBe('object');
    await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');});
    await context.setOffline(true);
    const backup=await page.evaluate(async()=>{const w=window as any;await w.NuevoAmanecerCanonical.openCash({session_id:'recovery-cash',opening_cents:0});await w.NuevoAmanecerCanonical.createSale(w.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-001',payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]}));return w.NuevoAmanecerCanonicalLocalStore.exportBackup();});
    const cancelled=await page.evaluate(async backup=>{const w=window as any,before=JSON.stringify(await w.NuevoAmanecerCanonicalLocalStore.read());let error='';try{await w.NuevoAmanecerCanonicalLocalRecovery.restoreCloud({confirmed:false,backup:backup});}catch(e){error=(e as Error).message;}return {error,unchanged:before===JSON.stringify(await w.NuevoAmanecerCanonicalLocalStore.read())};},backup);
    expect(cancelled).toEqual({error:'OWNER_CONFIRMATION_REQUIRED',unchanged:true});
    await context.setOffline(false);
    await page.evaluate(async backup=>{await (window as any).NuevoAmanecerCanonicalLocalRecovery.restoreCloud({confirmed:true,ownerSecret:'synthetic-owner-secret',backup:backup});},backup);
    const restored=await page.evaluate(async()=>{const w=window as any,state=await w.NuevoAmanecerCanonicalLocalStore.read();return {sales:state.projection.sales.length,stock:state.projection.products.find((p:any)=>p.product_id==='00001').current_stock_quantity,pending:state.events.length,previous:state.recovery.previous.sequence,backup:state.recovery.backup_digest};});
    expect(restored).toEqual({sales:0,stock:173,pending:0,previous:2,backup:backup.digest});
    expect(backup.backup.state.events).toHaveLength(2);
    const oldRetry=await page.evaluate(async backup=>{const w=window as any,event=backup.backup.state.events[0];try{await w.NuevoAmanecerCanonicalLocalStore.commit(()=>({command:event.command,payload:event.payload}));return 'incorrect-success';}catch(e){return (e as Error).message;}},backup);
    expect(oldRetry).toBe('LOCAL_OPERATION_REPLACED_BY_RECOVERY');
  }finally{cleanup.forEach(fn=>fn());}
});

test('a corrupt local projection is preserved as recovery evidence before owner-authorized cloud restoration',async({page})=>{
  const cleanup:Array<()=>void>=[];try{
    await posHarness(page,cleanup);await page.addScriptTag({content:readFileSync(root+'/POS/js/sync/canonical-local-recovery.js','utf8')});
    expect(await page.evaluate(()=>typeof (window as any).NuevoAmanecerCanonicalLocalStore.exportRecoveryEvidence)).toBe('function');
    const result=await page.evaluate(async()=>{
      const w=window as any,s=w.NuevoAmanecerCanonicalLocalStore;
      await w.NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');await w.NuevoAmanecerCanonicalLocalFirst.pause();
      await w._naRunCriticalOperation({operationId:crypto.randomUUID(),type:'SYNTHETIC_CORRUPTION',expectedRevision:(await w._naV10ReadCanonical()).revision,payload:{},mutate:(draft:any)=>{draft.data.canonicalLocalFirst.projection.products.find((p:any)=>p.product_id==='00001').current_stock_quantity=999;return draft.data;}});
      let failed='';try{await s.read();}catch(e){failed=(e as Error).message;}
      const evidence=await s.exportRecoveryEvidence();
      await w.NuevoAmanecerCanonicalLocalRecovery.restoreCloud({confirmed:true,ownerSecret:'synthetic-owner-secret',backup:evidence});
      const restored=await s.read();return {failed,exported:evidence.backup.state.projection.products.find((p:any)=>p.product_id==='00001').current_stock_quantity,stock:restored.projection.products.find((p:any)=>p.product_id==='00001').current_stock_quantity,backup:restored.recovery.backup_digest,evidence:evidence.digest};
    });
    expect(result).toMatchObject({failed:'LOCAL_DIGEST_MISMATCH',exported:999,stock:173});expect(result.backup).toBe(result.evidence);
  }finally{cleanup.forEach(fn=>fn());}
});

test('the shipped POS loads its local snapshot on F5 while cloud reads fail',async({page})=>{
  const cleanup:Array<()=>void>=[];try{
    await posHarness(page,cleanup);
    await page.evaluate(async()=>{const w=window as any;await w.NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');await w.NuevoAmanecerCanonical.openCash({session_id:'shipped-cash',opening_cents:0});await w.NuevoAmanecerCanonical.createSale(w.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-001',payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]}));await w.NuevoAmanecerCanonicalLocalFirst.pause();});
    await page.route('**/read/canonical/**',route=>route.abort());
    await page.goto('/index.html');
    await page.waitForFunction(()=>(window as any).NuevoAmanecerCanonical?.sourceState().source==='local');
    expect(await page.evaluate(()=>new Function("return {stock:productos.find(p=>p.id==='00001').stock,sales:ventas.length,local:typeof window.cart==='undefined'};")())).toEqual({stock:172,sales:1,local:true});
    await expect(page.locator('#naLocalWork')).toBeVisible();
    await page.reload();
    await page.waitForFunction(()=>(window as any).NuevoAmanecerCanonical?.sourceState().source==='local');
    expect(await page.evaluate(()=>(window as any).NuevoAmanecerCanonical.snapshot().sales.length)).toBe(1);
  }finally{cleanup.forEach(fn=>fn());}
});

test('real POS product card → Confirmar venta and Pago rápido use the same durable offline path',async({page,context})=>{
  const cleanup:Array<()=>void>=[];try{
    const {f,calls}=await posHarness(page,cleanup);
    await page.evaluate(async()=>{const w=window as any;await w.NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');await w.NuevoAmanecerCanonical.openCash({session_id:'buttons-cash',opening_cents:0});await w.NuevoAmanecerCanonicalLocalFirst.pause();});
    await page.goto('/index.html');await page.waitForFunction(()=>(window as any).NuevoAmanecerCanonical?.sourceState().source==='local');
    await page.locator('.module-card').first().click();await expect(page.locator('#pagePOS')).toBeVisible();
    await context.setOffline(true);const count=calls.filter(c=>c.method==='POST').length;
    await page.locator('[data-product-id="00001"]').click();
    await page.locator('#btnPagar').click();await expect(page.locator('#mCobro')).toHaveClass(/open/);
    await page.locator('#mBtnConf').click();await expect(page.locator('#mCobro')).not.toHaveClass(/open/);await expect(page.locator('#mBtnConf')).toBeEnabled();
    await page.locator('[data-product-id="00001"]').click();await page.locator('#btnRapido').click();await expect(page.locator('#mCobroRapido')).toHaveClass(/open/);
    await page.locator('#mQuickCash').click();await expect(page.locator('#mCobroRapido')).not.toHaveClass(/open/);
    const local=await page.evaluate(()=>new Function("return {cart:cart.length,stock:productos.find(p=>p.id==='00001').stock,ids:ventas.map(v=>v.id),processing:posProc};")());
    expect(local).toEqual({cart:0,stock:171,ids:['V-001','V-002'],processing:false});expect(calls.filter(c=>c.method==='POST').length).toBe(count);
    await context.setOffline(false);expect(await page.evaluate(async()=>(window as any).NuevoAmanecerCanonical.syncLocal())).toEqual({state:'UP_TO_DATE'});
    expect((await f.sql('SELECT COUNT(*) n FROM sales')).n).toBe(2);expect((await f.sql('SELECT COUNT(*) n FROM cash_movements')).n).toBe(2);expect((await f.sql("SELECT current_stock_quantity n FROM products WHERE product_id='00001'")).n).toBe(171);
  }finally{cleanup.forEach(fn=>fn());}
});

test('offline customer, product, policy, inventory, account, credit sale and compensation agree with Turso projections',async({page,context})=>{
  const cleanup:Array<()=>void>=[];try{
    const {calls}=await posHarness(page,cleanup);
    await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');});
    await context.setOffline(true);const count=calls.length;
    const local=await page.evaluate(async()=>{
      const w=window as any,api=w.NuevoAmanecerCanonical;
      const customer=await api.createCustomer({name:'Synthetic full-flow customer',document:'87654321'});
      await api.createProduct({product_id:'LIVE-FLOW',name:'Synthetic full-flow product',sku:'LIVE-FLOW-SKU',barcode:'775003333333',alternate_codes:[],category:'abarrotes',brand:'Test',description:null,icon:'box',image:null,unit:'unidad',purchase_unit:'unidad',purchase_factor:1,cost_cents:100,price_cents:200,box_price_cents:null,units_per_box:null,initial_stock_quantity:5,stock_min_quantity:1,expiry_date:null,includes_igv:true,tax_type:'gravado',complementary_tax:'',tracks_inventory:true});
      await api.setCustomerCreditPolicy({customer_id:customer.customer_id,mode:'MANUAL',manual_limit_cents:10000,reason:'Synthetic owner approved policy',administrator_id:'owner',administrator_name:'Owner'});
      await api.adjustInventory({product_id:'LIVE-FLOW',movement_type:'ENTRADA',quantity:2,reason:'Synthetic supply'});
      await api.createCreditAccount({customer_id:customer.customer_id,account_id:'large',name:'Large',mode:'separate'});
      await api.openCash({session_id:'flow-cash',opening_cents:0});
      const sale=await api.createSale(w.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-001',payment_method:'credito',customer_id:customer.customer_id,credit_due:'2026-12-01',credit_account:{account_id:'large',name:'Large',mode:'separate'},items:[{product_id:'LIVE-FLOW',quantity:1,precio:2}]}));
      const payment=await api.createPayment({credit_id:sale.operation_id+':credit',amount_cents:100,payment_method:'efectivo',session_id:'flow-cash'});
      await api.createCompensation({compensates_operation_id:payment.operation_id,session_id:'flow-cash',reason:'Synthetic owner-approved reversal'});
      await api.closeCash({session_id:'flow-cash',counted_cents:0});
      return {customer:customer.customer_id,credit:sale.operation_id+':credit',stock:api.snapshot().products.find((p:any)=>p.product_id==='LIVE-FLOW').current_stock_quantity,payments:api.snapshot().payments.filter((p:any)=>p.credit_id===sale.operation_id+':credit').map((p:any)=>p.amount_cents)};
    });
    expect(calls.length).toBe(count);expect(local.stock).toBe(6);expect(local.payments).toEqual([100,-100]);
    await context.setOffline(false);
    const sync=await page.evaluate(async()=>(window as any).NuevoAmanecerCanonical.syncLocal());
    expect(sync).toEqual({state:'UP_TO_DATE'});
    const remote=await page.evaluate(async ids=>{const snapshot=await (window as any).NuevoAmanecerCanonicalLocalHooks.readRemote();return {stock:snapshot.products.find((p:any)=>p.product_id==='LIVE-FLOW').current_stock_quantity,balance:snapshot.credits.find((c:any)=>c.credit_id===ids.credit).current_balance_cents,policy:snapshot.customers.find((c:any)=>c.customer_id===ids.customer).credit_policy_revision,payments:snapshot.payments.filter((p:any)=>p.credit_id===ids.credit).map((p:any)=>p.amount_cents),cash:snapshot.cashSessions.find((c:any)=>c.session_id==='flow-cash')};},local);
    expect(remote).toMatchObject({stock:6,balance:200,policy:1,cash:{status:'CLOSED',expected_cents:0,counted_cents:0,revision:3}});expect(remote.payments.sort((a:number,b:number)=>a-b)).toEqual([-100,100]);
  }finally{cleanup.forEach(fn=>fn());}
});

test('local transaction failure never publishes a successful operation',async({page})=>{
  await harness(page);
  expect(await page.evaluate(()=>typeof (window as any).NuevoAmanecerCanonicalLocalStore)).toBe('object');
  const result=await page.evaluate(async()=>{
    const w=window as any,s=w.NuevoAmanecerCanonicalLocalStore;await s.initialize(w.__base,w.__grant);
    const before=JSON.stringify(await s.read()),original=w._naRunCriticalOperation;
    w._naRunCriticalOperation=async()=>({status:'PERSISTENCE_ERROR',error:{code:'QuotaExceededError'}});
    let error='';try{await s.commit(()=>({command:'cash.open',payload:{operation_id:crypto.randomUUID(),promotion_id:'synthetic-promotion',authority_epoch:3,expected_control_revision:4,client_contract:'a6-gate-c-v1',created_at:new Date().toISOString(),session_id:'a',opening_cents:0}}));}catch(e){error=(e as Error).message;}
    w._naRunCriticalOperation=original;
    return {error,unchanged:before===JSON.stringify(await s.read())};
  });
  expect(result).toEqual({error:'QuotaExceededError',unchanged:true});
});

test('verified ACK compacts the small FIFO into a checkpoint; retry cannot duplicate local effects',async({page})=>{
  await harness(page);
  const result=await page.evaluate(async()=>{
    const w=window as any,s=w.NuevoAmanecerCanonicalLocalStore;
    if(typeof s.ack!=='function')return {missingAck:true};
    await s.initialize(w.__base,w.__grant);
    const p={operation_id:crypto.randomUUID(),promotion_id:'synthetic-promotion',authority_epoch:3,expected_control_revision:4,client_contract:'a6-gate-c-v1',created_at:new Date().toISOString(),session_id:'cash1',opening_cents:100};
    await s.commit(()=>({command:'cash.open',payload:p}));
    await s.ack(p.operation_id,{status:'created',idempotent:false,operation_id:p.operation_id,command:'cash.open',promotion_id:p.promotion_id,authority_epoch:3,session_id:'cash1',session_revision:0,expected_cents:100});
    const retry=await s.commit(()=>({command:'cash.open',payload:p})),state=await s.read();
    return {outbox:state.events.length,sequence:state.sequence,checkpoint:state.baseline.sequence,cash:state.projection.cashSessions.length,idempotent:retry.idempotent,equal:JSON.stringify(state.projection)===JSON.stringify(await s.reconstruct())};
  });
  expect(result).toEqual({outbox:0,sequence:1,checkpoint:1,cash:1,idempotent:true,equal:true});
});


test('empty FIFO authority change closes local commits instead of silently ignoring status',async({page})=>{
  const cleanup:Array<()=>void>=[];try{
    const {f}=await posHarness(page,cleanup);await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');});
    await page.route('**/read/canonical/status',async route=>{const response=await f.fetch('http://localhost/read/canonical/status',{headers:route.request().headers()});const body=await response.json();body.authority_epoch+=1;await route.fulfill({json:body});});
    const result=await page.evaluate(async()=>{const w=window as any;try{await w.NuevoAmanecerCanonical.syncLocal();}catch(_){}let error='';try{await w.NuevoAmanecerCanonical.openCash({session_id:'stale-cash',opening_cents:0});}catch(e){error=(e as Error).message;}return {state:(await w.NuevoAmanecerCanonicalLocalStore.read()).cloud.state,error};});
    expect(result.state).toBe('AUTHORITY_CHANGED');expect(result.error).toBeTruthy();
  }finally{cleanup.forEach(fn=>fn());}
});


for (const queued of [false,true]) test(`reader downgrade closes local commits with ${queued?'pending':'empty'} FIFO`,async({page})=>{
 const cleanup:Array<()=>void>=[];try{
  const {f}=await posHarness(page,cleanup);
  await page.evaluate(async queued=>{const w=window as any;await w.NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');if(queued)await w.NuevoAmanecerCanonical.openCash({session_id:'pending-cash',opening_cents:0});},queued);
  await page.route('**/read/canonical/status',async route=>{const response=await f.fetch('http://localhost/read/canonical/status',{headers:route.request().headers()});const body=await response.json();body.write_authorized=false;await route.fulfill({json:body});});
  const result=await page.evaluate(async()=>{const w=window as any;try{await w.NuevoAmanecerCanonical.syncLocal();}catch(_){}let error='';try{await w.NuevoAmanecerCanonical.openCash({session_id:'reader-cash',opening_cents:0});}catch(e){error=(e as Error).message;}return {state:(await w.NuevoAmanecerCanonicalLocalStore.read()).cloud.state,error};});
  expect(result.state).toBe('AUTHORITY_CHANGED');expect(result.error).toBeTruthy();
 }finally{cleanup.forEach(fn=>fn());}
});

test('handover preserves offline pending operations, then releases A and lets session B sell without another key',async({page,context})=>{
 const cleanup:Array<()=>void>=[];try{
  const {f}=await posHarness(page,cleanup);
  await page.evaluate(async()=>{const w=window as any;await w.NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');await w.NuevoAmanecerCanonicalLocalFirst.pause();await w.NuevoAmanecerCanonical.openCash({session_id:'handover-cash',opening_cents:0});});
  await context.setOffline(true);
  const pending=await page.evaluate(async()=>{const w=window as any,s=w.NuevoAmanecerCanonicalLocalStore,before=JSON.stringify(await s.read());let error='';try{await w.NuevoAmanecerCanonicalLocalFirst.finishSession();}catch(e){error=(e as Error).message;}return {error,unchanged:before===JSON.stringify(await s.read())};});
  expect(pending).toEqual({error:'LOCAL_WRITER_PENDING_OPERATIONS',unchanged:true});
  const denied=await f.fetch('http://localhost/auth/local-writer',{method:'POST',headers:{authorization:'Bearer second-token','x-activation-secret':'synthetic-owner-secret','content-type':'application/json'},body:'{}'});expect(denied.status).toBe(409);
  await context.setOffline(false);
  const released=await page.evaluate(async()=>{const w=window as any;w.NuevoAmanecerCanonicalLocalFirst.resume();await w.NuevoAmanecerCanonicalLocalFirst.finishSession();let error='';try{await w.NuevoAmanecerCanonical.openCash({session_id:'old-A',opening_cents:0});}catch(e){error=(e as Error).message;}return {error,pending:(await w.NuevoAmanecerCanonicalLocalStore.read()).events.length};});
  expect(released.pending).toBe(0);expect(released.error).toBeTruthy();
  const b=await page.evaluate(async()=>{const w=window as any,api=w.NuevoAmanecerCanonical,old=await w.NuevoAmanecerCanonicalLocalStore.read(),binding=w.NuevoAmanecerCanonicalLocalHooks.binding();await api.configure({...binding,token:'second-token'});await api.enableLocalFirst('synthetic-owner-secret');const receipt=await api.createSale(w.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-001',payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]}));await api.syncLocal();const state=await w.NuevoAmanecerCanonicalLocalStore.read();return {receipt:receipt.status,writer:state.grant.writer_id,rotated:old.grant.grant_id!==state.grant.grant_id,stock:state.projection.products.find((p:any)=>p.product_id==='00001').current_stock_quantity,backup:await w.NuevoAmanecerCanonicalLocalStore.exportBackup()};});
  expect(b).toMatchObject({receipt:'local_committed',writer:'session:second',rotated:true,stock:172});expect(JSON.stringify(b.backup)).not.toContain('synthetic-owner-secret');expect((await f.sql('SELECT COUNT(*) n FROM sales')).n).toBe(1);
  const a=await f.fetch('http://localhost/read/canonical/status',{headers:{authorization:'Bearer writer-token'}});expect((await a.json()).write_authorized).toBe(false);
  const returned=await page.evaluate(async()=>{const w=window as any,api=w.NuevoAmanecerCanonical;await w.NuevoAmanecerCanonicalLocalFirst.finishSession();await api.configure({...w.NuevoAmanecerCanonicalLocalHooks.binding(),token:'writer-token'});await api.enableLocalFirst('synthetic-owner-secret');await api.createSale(w.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-002',payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]}));await api.syncLocal();return (await w.NuevoAmanecerCanonicalLocalStore.read()).grant.writer_id;});
  expect(returned).toBe('session:first');expect((await f.sql('SELECT COUNT(*) n FROM sales')).n).toBe(2);
 }finally{cleanup.forEach(fn=>fn());}
});

test('release ACK loss keeps A durably read-only and retry needs no owner key',async({page})=>{
 const cleanup:Array<()=>void>=[];try{
  const {f}=await posHarness(page,cleanup);await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');});
  let lost=true;
  await page.route('**/auth/local-writer',async route=>{const req=route.request(),response=await f.fetch('http://localhost/auth/local-writer',{method:req.method(),headers:req.headers(),body:req.method()==='POST'?req.postData():undefined});if(lost && req.postData()?.includes('"release":true')){lost=false;await route.abort();}else await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});});
  const result=await page.evaluate(async()=>{const w=window as any;let releaseError='';try{await w.NuevoAmanecerCanonicalLocalFirst.finishSession();}catch(e){releaseError=(e as Error).message;}const before=await w.NuevoAmanecerCanonicalLocalStore.read();let commitError='';try{await w.NuevoAmanecerCanonical.openCash({session_id:'after-lost-release',opening_cents:0});}catch(e){commitError=(e as Error).message;}await w.NuevoAmanecerCanonicalLocalFirst.finishSession();return {releaseError,commitError,released:before.writer_released,pending:before.events.length};});
  expect(result.released).toBe(true);expect(result.pending).toBe(0);expect(result.releaseError).toBeTruthy();expect(result.commitError).toBeTruthy();
 }finally{cleanup.forEach(fn=>fn());}
});

test('session B on a separate browser activates after A releases and sells from its own IndexedDB',async({page,browser})=>{
 const cleanup:Array<()=>void>=[],second=await browser.newContext({baseURL:test.info().project.use.baseURL});try{
  const {f}=await posHarness(page,cleanup);
  const binding=await page.evaluate(async()=>{const w=window as any;await w.NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');await w.NuevoAmanecerCanonical.openCash({session_id:'separate-cash',opening_cents:0});await w.NuevoAmanecerCanonicalLocalFirst.finishSession();return w.NuevoAmanecerCanonicalLocalHooks.binding();});
  const b=await second.newPage();await second.setOffline(false);
  await b.route('**/read/canonical/**',async route=>{const req=route.request(),u=new URL(req.url()),response=await f.fetch('http://localhost'+u.pathname+u.search,{headers:req.headers()});await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});});
  for(const path of ['auth/local-writer','commands/**'])await b.route('**/'+path,async route=>{const req=route.request(),u=new URL(req.url()),response=await f.fetch('http://localhost'+u.pathname,{method:req.method(),headers:req.headers(),body:req.method()==='POST'?req.postData():undefined});await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});});
  await harness(b);for(const name of ['adapters/canonical-ui-adapter','sync/canonical-client','sync/canonical-sale-intent','sync/canonical-local-first'])await b.addScriptTag({content:readFileSync(root+'/POS/js/'+name+'.js','utf8')});
  const result=await b.evaluate(async binding=>{const w=window as any,api=w.NuevoAmanecerCanonical;await api.configure({...binding,token:'second-token'});await api.enableLocalFirst('synthetic-owner-secret');const r=await api.createSale(w.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-001',payment_method:'efectivo',items:[{product_id:'00001',quantity:1,precio:2}]}));await api.syncLocal();return {status:r.status,writer:(await w.NuevoAmanecerCanonicalLocalStore.read()).grant.writer_id};},binding);
  expect(result).toEqual({status:'local_committed',writer:'session:second'});expect((await f.sql('SELECT COUNT(*) n FROM sales')).n).toBe(1);
  expect(await page.evaluate(async()=>(await (window as any).NuevoAmanecerCanonicalLocalStore.read()).writer_released)).toBe(true);
 }finally{await second.close();cleanup.forEach(fn=>fn());}
});

test('real POS finishes and reactivates its sales session using simple buttons without clearing storage',async({page})=>{
 const cleanup:Array<()=>void>=[];try{
  await posHarness(page,cleanup);await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');});
  await page.goto('/index.html');await page.waitForFunction(()=>(window as any).NuevoAmanecerCanonical?.sourceState().source==='local');
  await page.locator('#naLocalWork').click();await page.getByRole('button',{name:'Terminar sesión de ventas',exact:true}).click();
  await expect(page.locator('dialog')).toHaveCount(0);await expect(page.locator('#naLocalWork')).toHaveText('Activar este equipo para ventas');
  await page.reload();await page.waitForFunction(()=>(window as any).NuevoAmanecerCanonical?.sourceState().source==='local');
  expect(await page.evaluate(()=>(window as any).NuevoAmanecerCanonical.snapshot().write_authorized)).toBe(false);
  await page.locator('#naLocalWork').click();await page.getByLabel('Autorización del propietario').fill('synthetic-owner-secret');await page.locator('dialog').getByRole('button',{name:'Activar este equipo para ventas',exact:true}).click();
  await expect(page.locator('dialog [role="status"]')).toHaveText('Este equipo está activo para ventas.');
  expect(await page.evaluate(async()=>(await (window as any).NuevoAmanecerCanonicalLocalStore.read()).writer_released)).toBe(false);
 }finally{cleanup.forEach(fn=>fn());}
});

test('a local commit during a slow empty-FIFO cloud scan is automatically sent after the scan',async({page})=>{
 const cleanup:Array<()=>void>=[];try{
  await posHarness(page,cleanup);await page.evaluate(async()=>{const w=window as any;await w.NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');await w.NuevoAmanecerCanonicalLocalFirst.pause();const original=w.NuevoAmanecerCanonicalLocalHooks;let release:any;const gate=new Promise(resolve=>release=resolve);w.__releaseScan=release;w.NuevoAmanecerCanonicalLocalHooks={...original,readRemote:async(...args:any[])=>{w.__scanStarted=true;await gate;return original.readRemote(...args);}};w.NuevoAmanecerCanonicalLocalFirst.resume();w.__scan=w.NuevoAmanecerCanonical.syncLocal();});
  await expect.poll(()=>page.evaluate(()=>(window as any).__scanStarted)).toBe(true);
  await page.evaluate(async()=>{await (window as any).NuevoAmanecerCanonical.openCash({session_id:'during-scan',opening_cents:0});});
  await page.waitForTimeout(1300);await page.evaluate(async()=>{const w=window as any;w.__releaseScan();await w.__scan;});
  await expect.poll(()=>page.evaluate(async()=>(await (window as any).NuevoAmanecerCanonicalLocalStore.read()).events.length),{timeout:10000}).toBe(0);
 }finally{cleanup.forEach(fn=>fn());}
});
