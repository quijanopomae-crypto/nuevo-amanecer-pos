// A3 watchdog: tope de 10 min al estado «ocupado» de WORK (NAWorkBusy). Ejecuta el work-host.js REAL con un motor falso y reloj falso (Date.now);
// un `execute` que nunca responde simula el bug (finally que no limpia). No toca red, Worker ni datos.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const CORE=require('../../POS/js/modules/asistente/asistente-core.js');
const source=readFileSync('POS/js/work-host.js','utf8');
const tick=(ms=15)=>new Promise(r=>setTimeout(r,ms));
const FIXED=1700000010000; // 30 s dentro de un minuto de reloj: los tests de espera no dependen de la hora real

function fixture({owner=true,engine={},api,catalog,execute,products=3,access,approve,src=source,expiries={}}={}){
 const nodes=new Map(),listeners={},sent=[],frames=[],props={},calls={api:[],execute:[],cancel:[],save:[],toast:[],forget:[]};let clock=FIXED;const warns=[],timers=[];const forgotten=new Set(); // como la puerta real: si la tarjeta se «olvida» con la petición en vuelo, al volver la respuesta no hay propuesta que aplicar

 const local={};for(let i=1;i<=products;i++)local['P'+i]={precio:4.5,costo:2,stock:3,controla:true};
 const open={mProd:false,mMovInv:false};let cur=null;
 const home={classList:{contains:()=>true}};
 const body={classList:{add(){},remove(){}},appendChild(el){if(el.id)nodes.set(el.id,el);}};
 const create=(tag)=>{const element={setAttribute(){},appendChild(){},addEventListener(){},remove(){nodes.delete(this.id);},contentWindow:{postMessage(m){sent.push(m);}}};if(tag==='iframe')frames.push(element);return element;};
 const modalEl=id=>({classList:{contains:c=>c==='open'&&open[id]===true}});
 class FakeDate extends Date{static now(){return clock;}}
 const root={document:{body,head:{appendChild(){}},readyState:'complete',createElement:create,
   getElementById:id=>id==='pageMenu'?home:(id==='mProd'||id==='mMovInv')?modalEl(id):nodes.get(id),querySelectorAll:()=>[]},
  location:{origin:'https://pos.test',search:'',hostname:'pos.test'},NA_HOSTED_CONFIG:{environment:'production'},
  toast:(m,k)=>calls.toast.push([k,m]),
  NA_ROLES:{confirmed:true,role:owner?'owner':'empleado',isOwner:()=>owner,...(approve?{approve}:{}),api:api||(async(path,b)=>{calls.api.push(b);return {reply:'ok',turns:[]};})},
  addEventListener:(e,fn)=>listeners[e]=fn,console:{warn:(...a)=>warns.push(a.join(' '))},setInterval(...a){timers.push(['interval',a[1]]);},setTimeout:(fn,ms)=>{timers.push(['timeout',ms]);return setTimeout(fn,ms===1000?8:1);},MutationObserver:class{observe(){}},
  NA_ASISTENTE_CORE:CORE,
  guardarProd:async()=>{calls.save.push(cur.product_id);local[cur.product_id].precio=cur.precio_nuevo;open.mProd=false;},
  guardarMovInv:async()=>{calls.save.push(cur.product_id);local[cur.product_id].stock=cur.stock_despues;open.mMovInv=false;},
  NA_ASISTENTE:{access,engine:{ready:()=>true,owner:()=>owner,
    prepare:t=>({text:'[tapado] '+t,context:{screen:'pageMenu',products:[]},cards:[]}),
    canExecute:()=>({ok:true}),product:id=>local[id]?{...local[id]}:null,accessState:()=>'ok',expiry:p=>expiries[p.id]??FIXED+300000,add:p=>{props[p.id]=p;return p.id;},
    catalog:catalog||(()=>[]),
    cancel:(k)=>calls.cancel.push(k),forget:(k)=>{calls.forget.push(k);forgotten.add(k);},forgetAll(){},state:()=>'pending',
    execute:execute?async(k,o)=>{calls.execute.push(k);const r=await execute(k,calls.execute.filter(x=>x===k).length);if(forgotten.has(k))throw new TypeError('propuesta olvidada con la petición en vuelo');if(r.ok){cur=props[k];open.mProd=cur.type==='precio';open.mMovInv=cur.type==='ajuste';}return r;}
      :async(k)=>{calls.execute.push(k);if(forgotten.has(k))throw new TypeError('olvidada');cur=props[k];open.mProd=cur.type==='precio';open.mMovInv=cur.type==='ajuste';return {ok:true,msg:'Abrí la ficha.'};},
    go:()=>({ok:true}),openDocument:async()=>({ok:true}),...engine}}};
 vm.runInNewContext(src,{window:root,URLSearchParams,Array,Object,String,Error,JSON,Date:FakeDate,Promise,Number,isFinite,Math});
 const frameWin=frames[0].contentWindow;
 const post=data=>listeners.message({origin:'https://pos.test',source:frameWin,data});
 return {root,nodes,listeners,sent,frames,calls,post,open,local,warns,timers,setClock:(t)=>{clock=t;},getClock:()=>clock};
}

const pr=(n,extra={})=>({id:'pr-'+n,type:'precio',needsConfirm:true,confirm_token:'SECRETO'+n+'.firma',title:'Cambiar precio',nombre:'Galleta '+n,product_id:'P'+n,precio_actual:4.5,precio_nuevo:4.7+n/100,cambioGrande:false,bajoCosto:false,...extra});
const lastCards=f=>[...f.sent].reverse().find(m=>m.action==='chat'&&m.cards)?.cards||[];
const lote=f=>lastCards(f).find(c=>c.kind==='lote');
const cardKey=f=>lastCards(f).find(c=>c.kind==='confirm').key;
const ask=async(f)=>{f.post({type:'na-work:chat',id:'a'+Math.random(),text:'x'});await tick();};
const MIN=60000, LIMIT=10*MIN;
const LONG={'pr-1':FIXED+60*MIN,'pr-2':FIXED+60*MIN,'pr-3':FIXED+60*MIN}; // firmas que no vencen durante el test (el reloj falso salta minutos)
const hang=()=>new Promise(()=>{}); // nunca responde: el estado «ocupado» queda pegado
const watchdogTimers=f=>f.timers.filter(([,ms])=>ms>=LIMIT);

test('el tope es una constante con nombre de 600000 ms', () => {
  assert.match(source, /BUSY_MAX_MS = 600000/);
});
test('sin operación: NAWorkBusy es false y no avisa', async () => {
  const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]})});
  assert.equal(f.root.NAWorkBusy(), false);
  f.setClock(FIXED+3*LIMIT);
  assert.equal(f.root.NAWorkBusy(), false);
  assert.deepEqual(f.warns, []);
});
test('tarjeta pegada: ocupado a los 9:59 min, libre pasados 10 min, con un solo aviso sin datos', async () => {
  const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:hang});
  await ask(f);
  f.post({type:'na-work:card-confirm',key:cardKey(f)});await tick(40);
  assert.deepEqual(f.calls.execute, ['pr-1']);
  assert.equal(f.root.NAWorkBusy(), true, 'ocupado mientras guarda');
  f.setClock(FIXED+9*MIN+59000);
  assert.equal(f.root.NAWorkBusy(), true, '9:59 sigue ocupado');
  assert.deepEqual(f.warns, []);
  f.setClock(FIXED+LIMIT+1000);
  assert.equal(f.root.NAWorkBusy(), false, 'pasados 10 min vuelve a false');
  assert.equal(f.root.NAWorkBusy(), false);
  assert.equal(f.warns.length, 1, 'un solo console.warn por episodio');
  assert.match(f.warns[0], /tarjeta/);
  assert.doesNotMatch(f.warns[0], /SECRETO|Galleta|pr-1|P1/, 'el aviso no lleva datos');
});
test('lote pegado: mismo tope y el aviso dice «lote»', async () => {
  const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]}),execute:hang});
  await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(60);
  assert.equal(f.root.NAWorkBusy(), true);
  f.setClock(FIXED+9*MIN+59000);assert.equal(f.root.NAWorkBusy(), true);
  f.setClock(FIXED+LIMIT+1000);assert.equal(f.root.NAWorkBusy(), false);
  assert.equal(f.warns.length, 1);assert.match(f.warns[0], /lote/);
});
test('lote normal de ~6 min no se ve afectado: ocupado todo el tiempo y libre al terminar, sin aviso ni timers de tope', async () => {
  let release;const gate=new Promise(r=>{release=r;});
  const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]}),expiries:LONG,execute:async()=>{await gate;return {ok:true,msg:'ok'};}});
  await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(60);
  for (const m of [1,3,5,6]) { f.setClock(FIXED+m*MIN); assert.equal(f.root.NAWorkBusy(), true, 'minuto '+m); }
  release();await tick(200);
  assert.equal(f.calls.save.length, 2, 'el lote terminó y guardó');
  assert.equal(f.root.NAWorkBusy(), false, 'libre al terminar');
  assert.deepEqual(f.warns, []);
  assert.deepEqual(watchdogTimers(f), [], 'el tope no programa timers');
  f.setClock(FIXED+3*LIMIT);
  assert.equal(f.root.NAWorkBusy(), false);assert.deepEqual(f.warns, [], 'tras terminar no queda nada pendiente que avise');
});
test('operación normal que termina limpia: sin timers colgados ni aviso aunque pase mucho tiempo', async () => {
  const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async()=>({ok:true,msg:'ok'})});
  await ask(f);const before=f.timers.filter(([k])=>k==='interval').length;
  f.post({type:'na-work:card-confirm',key:cardKey(f)});await tick(80);
  assert.deepEqual(f.calls.save, ['P1']);
  assert.equal(f.root.NAWorkBusy(), false);
  assert.deepEqual(watchdogTimers(f), []);
  assert.equal(f.timers.filter(([k])=>k==='interval').length, before, 'el tope no añade intervalos');
  f.setClock(FIXED+5*LIMIT);assert.equal(f.root.NAWorkBusy(), false);assert.deepEqual(f.warns, []);
});
test('una operación nueva reinicia el reloj (en un lote, cada tarjeta nueva cuenta sus 10 min desde que empieza)', async () => {
  const gates=[];
  const f=fixture({products:3,expiries:LONG,api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]}),
    execute:async(k)=>{await new Promise(r=>gates.push(r));return {ok:true,msg:'ok'};}});
  await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(60);
  f.setClock(FIXED+9*MIN+59000);assert.equal(f.root.NAWorkBusy(), true, 'tarjeta 1 casi en el tope');
  gates.shift()();await tick(60);          // termina la 1.ª y empieza la 2.ª (reinicia el reloj en 9:59)
  f.setClock(FIXED+9*MIN+59000+9*MIN+59000);
  assert.equal(f.root.NAWorkBusy(), true, 'la tarjeta 2 lleva 9:59 desde que empezó');
  f.setClock(FIXED+9*MIN+59000+LIMIT+1000);
  assert.equal(f.root.NAWorkBusy(), false, 'y pasa a libre pasados 10 min de la 2.ª');
});
