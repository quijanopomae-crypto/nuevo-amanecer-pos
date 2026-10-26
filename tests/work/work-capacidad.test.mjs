// WORK capacidad (A2, paquete A): reintento solo del 429 con cuenta regresiva, pregunta de aclaración, WORK oculto sin perder el chat, un solo nombre de acción.
// Se ejecuta el work-host.js REAL con un motor falso (no toca red, Worker ni datos).
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
 const nodes=new Map(),listeners={},sent=[],frames=[],props={},calls={api:[],execute:[],cancel:[],save:[],toast:[]};let clock=FIXED;
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
  addEventListener:(e,fn)=>listeners[e]=fn,setInterval(){},setTimeout:(fn,ms)=>setTimeout(fn,ms===1000?8:1),MutationObserver:class{observe(){}},
  NA_ASISTENTE_CORE:CORE,
  guardarProd:async()=>{calls.save.push(cur.product_id);local[cur.product_id].precio=cur.precio_nuevo;open.mProd=false;},
  guardarMovInv:async()=>{calls.save.push(cur.product_id);local[cur.product_id].stock=cur.stock_despues;open.mMovInv=false;},
  NA_ASISTENTE:{access,engine:{ready:()=>true,owner:()=>owner,
    prepare:t=>({text:'[tapado] '+t,context:{screen:'pageMenu',products:[]},cards:[]}),
    canExecute:()=>({ok:true}),product:id=>local[id]?{...local[id]}:null,accessState:()=>'ok',expiry:p=>expiries[p.id]??FIXED+300000,add:p=>{props[p.id]=p;return p.id;},
    catalog:catalog||(()=>[]),
    cancel:(k)=>calls.cancel.push(k),forget(){},forgetAll(){},state:()=>'pending',
    execute:execute?async(k,o)=>{calls.execute.push(k);const r=await execute(k,calls.execute.filter(x=>x===k).length);if(r.ok){cur=props[k];open.mProd=cur.type==='precio';open.mMovInv=cur.type==='ajuste';}return r;}
      :async(k)=>{calls.execute.push(k);cur=props[k];open.mProd=cur.type==='precio';open.mMovInv=cur.type==='ajuste';return {ok:true,msg:'Abrí la ficha.'};},
    go:()=>({ok:true}),openDocument:async()=>({ok:true}),...engine}}};
 vm.runInNewContext(src,{window:root,URLSearchParams,Array,Object,String,Error,JSON,Date:FakeDate,Promise,Number,isFinite,Math});
 const frameWin=frames[0].contentWindow;
 const post=data=>listeners.message({origin:'https://pos.test',source:frameWin,data});
 return {root,nodes,listeners,sent,frames,calls,post,open,local,setClock:(t)=>{clock=t;},getClock:()=>clock};
}
const pr=(n,extra={})=>({id:'pr-'+n,type:'precio',needsConfirm:true,confirm_token:'SECRETO'+n+'.firma',title:'Cambiar precio',nombre:'Galleta '+n,product_id:'P'+n,precio_actual:4.5,precio_nuevo:4.7+n/100,cambioGrande:false,bajoCosto:false,...extra});
const cardMsgs=(f,key)=>f.sent.filter(m=>m.action==='card'&&m.key===key);
const lastCards=f=>[...f.sent].reverse().find(m=>m.action==='chat'&&m.cards)?.cards||[];
const shown=f=>f.nodes.has('naWorkOverlay')&&!f.nodes.get('naWorkOverlay').hidden;
const ask=async(f,proposals,text='x')=>{f.post({type:'na-work:chat',id:'a'+Math.random(),text});await tick();};

test('«Aplicar» se muestra como «Confirmar» (un solo nombre de acción) y no hay lote',async()=>{
 const f=fixture({api:async()=>({texto:'Revisa y pulsa Aplicar. Son 1 productos; cada uno se aplica aparte con su «Aplicar».',proposals:[pr(1)],turns:[]})});
 await ask(f);
 assert.ok(!lastCards(f).some(c=>c.kind==='lote'),'este paquete no trae «Confirmar todo»');
 const chat=f.sent.find(m=>m.action==='chat');assert.doesNotMatch(chat.text,/Aplicar/);assert.match(chat.text,/«Confirmar»/);
});
test('solo el Admin: un empleado nunca recibe confirmar de un toque',async()=>{
 const f=fixture({owner:false,api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]})});
 await ask(f);assert.ok(lastCards(f).every(c=>c.oneTap!==true));
});
test('un 429 en una confirmación suelta también espera y reintenta sin pedir que el dueño repita',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async(k,n)=>n===1?{ok:false,code:'rate_limited',retry_after_s:1,msg:'x'}:{ok:true,msg:'ok'}});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(80);
 assert.deepEqual(f.calls.execute,['pr-1','pr-1']);assert.equal(cardMsgs(f,'pr-1').pop().state,'done');
 assert.ok(cardMsgs(f,'pr-1').some(m=>/^Espera \d+ segundos?…$/.test(m.msg||'')));
});
test('429: la cuenta regresiva sale SOLO en la tarjeta que espera, otra tarjeta no se toca, y no se gasta un segundo token por el mismo cambio',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]}),execute:async(k,n)=>k==='pr-1'&&n===1?{ok:false,code:'rate_limited',retry_after_s:2,msg:'x'}:{ok:true,msg:'ok'}});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(150); // el segundo toque durante la espera se ignora
 assert.deepEqual(cardMsgs(f,'pr-1').filter(m=>m.state==='waiting').map(m=>m.msg),['Espera 3 segundos…','Espera 2 segundos…','Espera 1 segundo…']);
 assert.equal(cardMsgs(f,'pr-2').length,0,'la otra tarjeta no recibió nada');
 assert.deepEqual(f.calls.execute,['pr-1','pr-1']);assert.equal(cardMsgs(f,'pr-1').pop().state,'done');
});
test('429 que no se va: máximo 4 intentos y queda «Reintentar» con «no se hizo ningún cambio»; solo el 429 se reintenta solo',async()=>{
 let f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async()=>({ok:false,code:'rate_limited',retry_after_s:1,msg:'x'})});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(400);
 assert.equal(f.calls.execute.length,4);const end=cardMsgs(f,'pr-1').pop();assert.equal(end.state,'retry');assert.match(end.msg,/no se hizo ningún cambio/);
 f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async()=>({ok:false,code:'HTTP_500',msg:'x'})});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(100);
 assert.equal(f.calls.execute.length,1,'un error que no es 429 NO se repite solo');assert.ok(!cardMsgs(f,'pr-1').some(m=>m.state==='waiting'));
});
test('429: si WORK se cierra durante la espera, no se gasta ningún token más',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async(k,n)=>n===1?{ok:false,code:'rate_limited',retry_after_s:3,msg:'x'}:{ok:true,msg:'ok'}});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(30);
 f.post({type:'na-work:close'});await tick(100);
 assert.deepEqual(f.calls.execute,['pr-1']);
});
test('A1 (A4): si la firma vence antes o durante la espera del 429, no se reintenta: «venció», sin gastar nada más',async()=>{
 let f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async(k,n)=>{if(n===1){f.setClock(FIXED+400000);return {ok:false,code:'rate_limited',retry_after_s:3,msg:'x'};}return {ok:true,msg:'ok'};}});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(100);
 assert.deepEqual(f.calls.execute,['pr-1'],'no se reintentó');const e1=cardMsgs(f,'pr-1').pop();assert.equal(e1.state,'expired');assert.match(e1.msg,/Pídela otra vez/);
 assert.ok(!cardMsgs(f,'pr-1').some(m=>m.state==='waiting'),'ni siquiera empezó la cuenta regresiva con una firma vencida');
 f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async(k,n)=>({ok:false,code:'rate_limited',retry_after_s:5,msg:'x'})});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(30);
 f.setClock(FIXED+400000);await tick(100); // vence mientras cuenta
 assert.equal(f.calls.execute.length,1);assert.equal(cardMsgs(f,'pr-1').pop().state,'expired');
 f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),expiries:{'pr-1':FIXED-5000}}); // ya vencida al tocar
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(60);
 assert.equal(f.calls.execute.length,0);assert.equal(cardMsgs(f,'pr-1').pop().state,'expired');
});
test('A2 (A4): «Cancelar» sigue activo durante la cuenta regresiva y la corta: no se reintenta ni se gasta el token',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async()=>({ok:false,code:'rate_limited',retry_after_s:5,msg:'x'})});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(30);
 assert.equal(cardMsgs(f,'pr-1').pop().state,'waiting');
 f.post({type:'na-work:card-cancel',key:'pr-1'});await tick(150);
 assert.equal(f.calls.execute.length,1);assert.deepEqual(f.calls.cancel,['pr-1']);
 assert.equal(cardMsgs(f,'pr-1').pop().state,'cancelled','la espera no pisa el «Cancelado»');
});
test('el puente deja «Cancelar» activo en estado «waiting» (A2)',()=>{
 const b=readFileSync(new URL('../../POS/work/work-canon-bridge.js',import.meta.url),'utf8');
 assert.match(b,/else if\(st==='waiting'\)\{rec\.ok\.disabled=true;rec\.no\.disabled=false;/);
 assert.match(b,/st!=='waiting'\)return;ok\.disabled=true;no\.disabled=true;send\('card-cancel'\)/);
});
test('pedido ambiguo: UNA pregunta corta con opciones tocables, sin llamar al servidor; si ya trae el monto, pasa normal',async()=>{
 const catalog=()=>[{id:'1',nombre:'Galleta Soda',precio:1},{id:'2',nombre:'Galletas Oreo',precio:1.5},{id:'3',nombre:'Arroz',precio:4}];
 const f=fixture({catalog});
 f.post({type:'na-work:chat',id:'q1',text:'súbele un poco a las galletas'});await tick();
 assert.equal(f.calls.api.length,0);
 const m=f.sent.find(x=>x.action==='chat'&&x.id==='q1');
 assert.match(m.text,/¿Cuánto les subo\? Hay 2 productos con «galleta»/);
 const c=m.cards[0];assert.equal(c.kind,'clarify');
 assert.deepEqual(c.options.map(o=>o.label),['+3%','+5%','+10%','Otro monto','Solo algunas']);
 assert.match(c.options[1].text,/^Sube 5% el precio de: Galleta Soda; Galletas Oreo\.$/);
 f.post({type:'na-work:chat',id:'q2',text:'sube 5% las galletas'});await tick();
 assert.equal(f.calls.api.length,1);
});
test('la aclaración es solo del Admin (un empleado no recibe lista de productos) y no interrumpe preguntas',async()=>{
 const catalog=()=>[{id:'1',nombre:'Galleta Soda',precio:1}];
 let f=fixture({owner:false,catalog});
 f.post({type:'na-work:chat',id:'q1',text:'súbele un poco a las galletas'});await tick();
 assert.equal(f.sent.some(x=>x.cards&&x.cards.some(c=>c.kind==='clarify')),false);
 f=fixture({catalog});
 f.post({type:'na-work:chat',id:'q2',text:'¿cuánto debo subir las galletas?'});await tick();
 assert.equal(f.calls.api.length,1);
});
test('tras abrir la ficha (cambio con aviso) WORK se OCULTA sin perder el chat y vuelve con el mismo historial',async()=>{
 let n=0;
 const f=fixture({api:async(path,b)=>{n++;f.calls.api.push(b);return {texto:'ok',proposals:n===1?[pr(1,{bajoCosto:true})]:[],turns:n===1?[{role:'user',content:'u',sig:'s'},{role:'assistant',content:'a',sig:'s'}]:[]};}});
 await ask(f);
 f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(40);
 const ov=f.nodes.get('naWorkOverlay');assert.ok(ov,'el overlay sigue existiendo');assert.equal(ov.hidden,true);
 f.root.NA_WORK_HOST.open(); // «✦ WORK»
 assert.equal(ov.hidden,false);
 await ask(f);
 assert.equal(f.calls.api[1].history.length,2,'la conversación no se perdió');
});
// ---------- Paquete B: correcciones de la revisión de A3 (H-2, M-1, M-2, M-5, tope configurable, PIN único) ----------
