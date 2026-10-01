import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {activeCanon,device} from './canon-browser-harness.mjs';
import {tursoSqlite} from './turso-sqlite-protocol.mjs';
async function fixture(t){
 const f=await activeCanon(t,{migrations:['0014_canonical_live_products.sql','0015_canonical_inventory_adjust.sql','0016_canonical_generic_sale_lines.sql','0017_canonical_live_customers.sql','0018_canonical_customer_credit_policy.sql']});
 const path='infra/database/migrations/0019_canonical_local_first.sql';if(existsSync(path))f.database.exec(readFileSync(path,'utf8'));
 f.env.POS_ACTIVATION_SECRET='synthetic-owner-secret';const turso=tursoSqlite(f.database);f.env.DB=turso.adapter;f.env.nuevo_amanecer_lab={prepare(){throw Error('D1 forbidden');}};
 const first=await device(f,{token:'writer-token',deviceId:'first'}),second=await device(f,{token:'reader-token',deviceId:'second'});return {f,first,second};
}
test('owner explicitly grants exactly one browser session; other sessions read but cannot write',async t=>{
 const {f,first,second}=await fixture(t);
 const denied=await f.fetch('http://localhost/auth/local-writer',{method:'POST',headers:{authorization:'Bearer writer-token','content-type':'application/json'},body:'{}'});assert.equal(denied.status,401);
 const response=await f.fetch('http://localhost/auth/local-writer',{method:'POST',headers:{authorization:'Bearer writer-token','x-activation-secret':'synthetic-owner-secret','content-type':'application/json'},body:'{}'});assert.equal(response.status,201);const grant=await response.json();assert.equal(grant.writer_id,'session:first');assert.equal(grant.promotion_id,f.control().active_promotion_id);
 await second.api.refresh();assert.equal(second.api.snapshot().products.length,first.api.snapshot().products.length);assert.equal(second.api.snapshot().write_authorized,false);
 await assert.rejects(second.api.openCash({session_id:'not-writer',opening_cents:0}));assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_cash_sessions').n,0);
 await first.api.openCash({session_id:'writer-cash',opening_cents:0});assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_cash_sessions').n,1);
 const session=await f.fetch('http://localhost/auth/session',{headers:{authorization:'Bearer reader-token'}});assert.equal(session.status,200);
 const state=await f.fetch('http://localhost/auth/local-writer',{headers:{authorization:'Bearer reader-token'}});assert.equal(state.status,200);assert.equal((await state.json()).writer,false);
});
test('grant refuses implicit promotion and preserves the current writer',async t=>{
 const {f}=await fixture(t);const grant=token=>f.fetch('http://localhost/auth/local-writer',{method:'POST',headers:{authorization:'Bearer '+token,'x-activation-secret':'synthetic-owner-secret','content-type':'application/json'},body:'{}'});
 assert.equal((await grant('writer-token')).status,201);assert.equal((await grant('reader-token')).status,409);assert.equal(f.sql('SELECT principal_id FROM canonical_local_writer WHERE id=1').principal_id,'session:first');
});

test('owner credential cannot promote a read-only role into an unusable writer',async t=>{
 const {f}=await fixture(t);f.exec("UPDATE devices SET role='read_only' WHERE device_id='session:second'");
 const response=await f.fetch('http://localhost/auth/local-writer',{method:'POST',headers:{authorization:'Bearer reader-token','x-activation-secret':'synthetic-owner-secret','content-type':'application/json'},body:'{}'});
 assert.equal(response.status,403);assert.equal((await response.json()).error,'read_only_session');assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_local_writer').n,0);
});

test('a granted principal downgraded to reader cannot revalidate local writer authority',async t=>{
 const {f}=await fixture(t);
 const grant=await f.fetch('http://localhost/auth/local-writer',{method:'POST',headers:{authorization:'Bearer writer-token','x-activation-secret':'synthetic-owner-secret','content-type':'application/json'},body:'{}'});
 assert.equal(grant.status,201);
 f.exec("UPDATE devices SET role='read_only' WHERE device_id='session:first'");
 const response=await f.fetch('http://localhost/auth/local-writer',{headers:{authorization:'Bearer writer-token'}});
 assert.equal(response.status,200);
 assert.equal((await response.json()).writer,false);
});
