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

async function posHarness(page:Page,cleanup:Array<()=>void>,options:{lostAck?:boolean}={}) {
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

test('activation preserves legacy durable intents and refuses to ignore them',async({page})=>{
  const cleanup:Array<()=>void>=[];try{
    await posHarness(page,cleanup);
    const result=await page.evaluate(async()=>{
      const w=window as any;
      w.NuevoAmanecerCanonicalSaleOutbox={snapshot:()=>({intents:[{operation_id:'original-operation',sale_id:'V-001'}]})};
      try{await w.NuevoAmanecerCanonical.enableLocalFirst('synthetic-owner-secret');return 'unexpected activation';}catch(error){return String((error as Error).message);}
    });
    expect(result).toBe('LEGACY_PENDING_REQUIRES_REVIEW');
    expect(await page.evaluate(async()=>(window as any).NuevoAmanecerCanonicalLocalStore.read())).toBeNull();
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
