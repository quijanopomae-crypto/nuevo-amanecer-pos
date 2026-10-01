import { test, expect, Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

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
