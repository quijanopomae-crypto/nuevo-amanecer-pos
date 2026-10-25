import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('POS/js/work-host.js','utf8');
function fixture(confirmed=false,owner=false){
 const nodes=new Map(),listeners={},sent=[],frames=[];
 const home={classList:{contains:()=>true}};
 const body={classList:{add(){},remove(){}},appendChild(el){if(el.id)nodes.set(el.id,el);}};
 const create=(tag)=>{const element=({setAttribute(){},appendChild(){},addEventListener(){},remove(){nodes.delete(this.id);},contentWindow:{postMessage(m){sent.push(m);}}});if(tag==='iframe')frames.push(element);return element;};
 const root={document:{body,head:{appendChild(){}},readyState:'complete',createElement:create,getElementById:id=>id==='pageMenu'?home:nodes.get(id),querySelectorAll:()=>[{querySelector:q=>({textContent:q==='.qs-label'?'Ventas hoy':'S/ 100'})}]},location:{origin:'https://pos.test',search:'',hostname:'pos.test'},NA_HOSTED_CONFIG:{environment:'production'},NA_ROLES:{confirmed,role:owner?'owner':'empleado',isOwner:()=>owner,api:async()=>({reply:'real'})},addEventListener:(e,fn)=>listeners[e]=fn,setInterval(){},MutationObserver:class{observe(){}}};
 vm.runInNewContext(source,{window:root,URLSearchParams,Array,Object,String,Error});
 return {root,nodes,listeners,sent,frames};
}
test('WORK must not obscure activation or revoked session before role confirmation',()=>{
 const f=fixture(false,true);assert.equal(f.nodes.has('naWorkOverlay'),false);
});
test('confirmed employee receives no owner dashboard metrics',()=>{
 const f=fixture(true,false);f.listeners.message({origin:'https://pos.test',source:f.frames[0].contentWindow,data:{type:'na-work:metrics'}});
 assert.equal(f.sent.some(m=>m.metrics?.some(r=>r.value==='S/ 100')),false);
});

test('revoking confirmation closes WORK on role update',()=>{
 const f=fixture(true,true);assert.equal(f.nodes.has('naWorkOverlay'),true);
 f.root.NA_ROLES.confirmed=false;f.listeners['na:role']?.();
 assert.equal(f.nodes.has('naWorkOverlay'),false);
});
test('confirmed owner receives canonical metrics via same-origin bridge',()=>{
 const f=fixture(true,true);f.listeners.message({origin:'https://pos.test',source:f.frames[0].contentWindow,data:{type:'na-work:metrics'}});
 assert.equal(f.sent.some(m=>m.metrics?.some(r=>r.value==='S/ 100')),true);
});
test('cross-origin and unrelated frame messages cannot read metrics',()=>{
 const f=fixture(true,true);
 f.listeners.message({origin:'https://evil.test',source:f.frames[0].contentWindow,data:{type:'na-work:metrics'}});
 f.listeners.message({origin:'https://pos.test',source:{},data:{type:'na-work:metrics'}});
 assert.equal(f.sent.length,0);
});
test('second turn returns exact signed server history and new conversation clears it',async()=>{
 const f=fixture(true,true),calls=[];
 const turns=[{role:'user',content:'primero',sig:'signed-fixture',n:1,iat:1},{role:'assistant',content:'respuesta',sig:'signed-fixture',n:1,iat:1}];
 f.root.NA_ROLES.api=async(path,body)=>{calls.push(body);return {reply:'respuesta',turns};};
 const send=data=>f.listeners.message({origin:'https://pos.test',source:f.frames[0].contentWindow,data});
 send({type:'na-work:chat',id:'one',text:'primero'});await new Promise(setImmediate);
 send({type:'na-work:chat',id:'two',text:'continúa'});await new Promise(setImmediate);
 assert.equal(JSON.stringify(calls[1].history),JSON.stringify(turns));
 send({type:'na-work:reset'});send({type:'na-work:chat',id:'three',text:'nuevo'});await new Promise(setImmediate);
 assert.equal(calls[2].history.length,0);
});
test('confirmed identity change discards the previous WORK frame and private conversation',()=>{
 const f=fixture(true,true);assert.equal(f.frames.length,1);
 f.root.NA_ROLES.role='empleado';f.root.NA_ROLES.isOwner=()=>false;
 f.listeners['na:role']();assert.equal(f.frames.length,2);
});
