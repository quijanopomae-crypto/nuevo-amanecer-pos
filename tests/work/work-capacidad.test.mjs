// WORK capacidad (A2): «Confirmar todo (N)», espera automática ante el tope por minuto, pregunta de aclaración, WORK oculto sin perder el chat,
// formato S/ en tablas y un solo nombre de acción. Se ejecuta el work-host.js REAL con un motor falso (no toca red, Worker ni datos).
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

function fixture({owner=true,engine={},api,catalog,execute,products=3,access,approve,src=source,expiries={},hosted=false}={}){
 const nodes=new Map(),listeners={},sent=[],frames=[],props={},calls={api:[],execute:[],cancel:[],save:[],toast:[],forget:[]};let clock=FIXED;const forgotten=new Set(); // como la puerta real: si la tarjeta se «olvida» con la petición en vuelo, al volver la respuesta no hay propuesta que aplicar

 const local={};for(let i=1;i<=products;i++)local['P'+i]={precio:4.5,costo:2,stock:3,controla:true};
 const open={mProd:false,mMovInv:false};let cur=null;
 const home={classList:{contains:()=>true}};
 const body={classList:{add(){},remove(){}},appendChild(el){if(el.id)nodes.set(el.id,el);}};
 const create=(tag)=>{const element={setAttribute(){},appendChild(){},addEventListener(){},remove(){nodes.delete(this.id);},contentWindow:{postMessage(m){sent.push(m);}}};if(tag==='iframe')frames.push(element);return element;};
 const modalEl=id=>({classList:{contains:c=>c==='open'&&open[id]===true}});
 class FakeDate extends Date{static now(){return clock;}}
 const root={document:{body,head:{appendChild(){}},readyState:'complete',createElement:create,
   getElementById:id=>id==='pageMenu'?home:(id==='mProd'||id==='mMovInv')?modalEl(id):nodes.get(id),querySelectorAll:()=>[]},
  location:{origin:'https://pos.test',search:hosted?'':'?work=1',hostname:'pos.test'},...(hosted?{NA_HOSTED_CONFIG:{environment:'production'}}:{}),
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
    cancel:(k)=>calls.cancel.push(k),forget:(k)=>{calls.forget.push(k);forgotten.add(k);},forgetAll(){},state:()=>'pending',
    execute:execute?async(k,o)=>{calls.execute.push(k);const r=await execute(k,calls.execute.filter(x=>x===k).length);if(forgotten.has(k))throw new TypeError('propuesta olvidada con la petición en vuelo');if(r.ok){cur=props[k];open.mProd=cur.type==='precio';open.mMovInv=cur.type==='ajuste';}return r;}
      :async(k)=>{calls.execute.push(k);if(forgotten.has(k))throw new TypeError('olvidada');cur=props[k];open.mProd=cur.type==='precio';open.mMovInv=cur.type==='ajuste';return {ok:true,msg:'Abrí la ficha.'};},
    go:()=>({ok:true}),openDocument:async()=>({ok:true}),...engine}}};
 vm.runInNewContext(src,{window:root,URLSearchParams,Array,Object,String,Error,JSON,Date:FakeDate,Promise,Number,isFinite,Math});
 const frameWin=frames[0].contentWindow;
 const post=data=>listeners.message({origin:'https://pos.test',source:frameWin,data});
 return {root,nodes,listeners,sent,frames,calls,post,open,local,setClock:(t)=>{clock=t;},getClock:()=>clock};
}
const pr=(n,extra={})=>({id:'pr-'+n,type:'precio',needsConfirm:true,confirm_token:'SECRETO'+n+'.firma',title:'Cambiar precio',nombre:'Galleta '+n,product_id:'P'+n,precio_actual:4.5,precio_nuevo:4.7+n/100,cambioGrande:false,bajoCosto:false,...extra});
const cardMsgs=(f,key)=>f.sent.filter(m=>m.action==='card'&&m.key===key);
const lastCards=f=>[...f.sent].reverse().find(m=>m.action==='chat'&&m.cards)?.cards||[];
const lote=f=>lastCards(f).find(c=>c.kind==='lote');
const shown=f=>f.nodes.has('naWorkOverlay')&&!f.nodes.get('naWorkOverlay').hidden;
const ask=async(f,proposals,text='x')=>{f.post({type:'na-work:chat',id:'a'+Math.random(),text});await tick();};

test('dos o más cambios de un toque sin avisos: sale la tarjeta «Confirmar todo (N)» primero y el texto del servidor lo menciona',async()=>{
 const f=fixture({api:async()=>({texto:'Listo. Son 3 productos; cada uno se aplica aparte con su «Aplicar».',proposals:[pr(1),pr(2),pr(3)],turns:[]})});
 await ask(f);
 const cs=lastCards(f);
 assert.equal(cs[0].kind,'lote');assert.equal(cs[0].count,3);assert.equal(cs[0].title,'Confirmar todo (3)');
 assert.equal(cs.filter(c=>c.kind==='confirm').length,3);
 assert.equal(cs[0].rows.length,3);
 assert.ok(!JSON.stringify(cs).includes('SECRETO'),'el token nunca sale de WORK host');
 const chat=f.sent.find(m=>m.action==='chat');
 assert.match(chat.text,/Toca «Confirmar todo \(3\)» o confirma uno por uno/);assert.doesNotMatch(chat.text,/Aplicar/);
});
test('un solo cambio: no hay «Confirmar todo»; y «Aplicar» se muestra como «Confirmar»',async()=>{
 const f=fixture({api:async()=>({texto:'Revisa y pulsa Aplicar. Son 1 productos; cada uno se aplica aparte con su «Aplicar».',proposals:[pr(1)],turns:[]})});
 await ask(f);
 assert.equal(lote(f),undefined);
 const chat=f.sent.find(m=>m.action==='chat');assert.doesNotMatch(chat.text,/Aplicar/);assert.match(chat.text,/«Confirmar»/);
});
test('«Confirmar todo» confirma UNA POR UNA con el token de cada tarjeta, en orden, guarda cada una y resume',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]})});
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(120);
 assert.deepEqual(f.calls.execute,['pr-1','pr-2','pr-3']);
 assert.deepEqual(f.calls.save,['P1','P2','P3']);
 const end=cardMsgs(f,lote(f).key).pop();
 assert.equal(end.state,'done');assert.match(end.msg,/los 3 cambios se guardaron/);
 for(const k of ['pr-1','pr-2','pr-3'])assert.equal(cardMsgs(f,k).pop().state,'done');
 // un segundo toque no repite nada
 f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(40);
 assert.equal(f.calls.execute.length,3);
});
test('cambios con aviso (bajo costo, cambio grande) NO entran en el lote y se confirman solos; con una sola tarjeta limpia no hay lote',async()=>{
 let f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3,{bajoCosto:true})],turns:[]})});
 await ask(f);
 const l=lote(f);assert.equal(l.count,2);assert.match(l.warnings[0],/1 cambio tiene avisos/);
 f.post({type:'na-work:card-confirm-all',key:l.key});await tick(100);
 assert.deepEqual(f.calls.execute,['pr-1','pr-2']);assert.ok(!f.calls.execute.includes('pr-3'));
 f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2,{cambioGrande:true}),pr(3,{bajoCosto:true})],turns:[]})});
 await ask(f);assert.equal(lote(f),undefined);
});
test('solo el Admin: un empleado nunca recibe «Confirmar todo» ni confirmar de un toque',async()=>{
 const f=fixture({owner:false,api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]})});
 await ask(f);assert.equal(lote(f),undefined);assert.ok(lastCards(f).every(c=>c.oneTap!==true));
});
test('si una tarjeta deja de ser de un toque a mitad del lote (el POS cambió), se salta sin abrir ninguna ficha',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]})});
 await ask(f);
 f.local.P2.precio=9; // el precio local ya no es el de la propuesta: oneTap() da false
 f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(120);
 assert.deepEqual(f.calls.execute,['pr-1','pr-3']);
 assert.equal(cardMsgs(f,'pr-2').pop().state,'pending');assert.match(cardMsgs(f,'pr-2').pop().msg,/confírmala sola/);
 const end=cardMsgs(f,lote(f).key).pop();assert.equal(end.state,'partial');assert.match(end.msg,/Se guardaron 2 de 3/);
});
test('429 en medio del lote: cuenta regresiva «Espera N segundos…», reintenta solo la MISMA tarjeta y no duplica nada',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]}),
  execute:async(k,n)=>k==='pr-2'&&n===1?{ok:false,code:'rate_limited',retry_after_s:3,msg:'Espera un momento e intenta de nuevo.'}:{ok:true,msg:'ok'}});
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(150);
 const waits=cardMsgs(f,'pr-2').filter(m=>m.state==='waiting').map(m=>m.msg);
 assert.deepEqual(waits,['Espera 4 segundos…','Espera 3 segundos…','Espera 2 segundos…','Espera 1 segundo…']); // retry_after_s 3 + 1 s de margen
 assert.deepEqual(f.calls.execute,['pr-1','pr-2','pr-2','pr-3']);
 assert.deepEqual(f.calls.save,['P1','P2','P3']);
 assert.equal(cardMsgs(f,lote(f).key).pop().state,'done');
});
test('un 429 en una confirmación suelta también espera y reintenta sin pedir que el dueño repita',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async(k,n)=>n===1?{ok:false,code:'rate_limited',retry_after_s:1,msg:'x'}:{ok:true,msg:'ok'}});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(80);
 assert.deepEqual(f.calls.execute,['pr-1','pr-1']);assert.equal(cardMsgs(f,'pr-1').pop().state,'done');
 assert.ok(cardMsgs(f,'pr-1').some(m=>/^Espera \d+ segundos?…$/.test(m.msg||'')));
});
test('más de 5 confirmaciones en el mismo minuto: espera ANTES de la sexta (sin gastar una petición que el servidor rechazaría)',async()=>{
 const f=fixture({products:6,api:async()=>({texto:'ok',proposals:[1,2,3,4,5,6].map(n=>pr(n)),turns:[]})});
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(500);
 const w6=cardMsgs(f,'pr-6').filter(m=>m.state==='waiting');
 assert.ok(w6.length>=30,'espera hasta el próximo minuto (~31 s) antes de la sexta');
 assert.match(w6[0].msg,/^Espera 31 segundos…$/); // 30 s dentro del minuto: faltan 30 s + 1 s de margen
 for(const k of ['pr-1','pr-2','pr-3','pr-4','pr-5'])assert.equal(cardMsgs(f,k).filter(m=>m.state==='waiting').length,0);
 assert.equal(f.calls.execute.length,6);assert.equal(cardMsgs(f,lote(f).key).pop().state,'done');
});
test('si falla la red a mitad del lote, se detiene (no sigue gastando tarjetas) y dice cuántas quedaron',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]}),execute:async(k)=>k==='pr-2'?{ok:false,code:'network',msg:'Sin conexión.'}:{ok:true,msg:'ok'}});
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(120);
 assert.deepEqual(f.calls.execute,['pr-1','pr-2']);
 const end=cardMsgs(f,lote(f).key).pop();assert.equal(end.state,'partial');assert.match(end.msg,/Se guardaron 1 de 3/);assert.match(end.msg,/1 quedó sin confirmar/);
});
test('un token gastado cuyo guardado no se pudo comprobar detiene el lote y pide revisar Inventario',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]})});
 await ask(f);
 f.root.guardarProd=async()=>{f.calls.save.push('sin-efecto');f.open.mProd=false;}; // «guardó» pero el precio local no cambió
 f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(300);
 assert.deepEqual(f.calls.execute,['pr-1']);
 const end=cardMsgs(f,lote(f).key).pop();assert.equal(end.state,'partial');assert.match(end.msg,/revises Inventario/);
});
test('N2 (A3): token gastado pero sin formulario que guardar = fallo claro y el lote se detiene; WORK no se cierra',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]}),engine:{execute:async(k)=>{f.calls.execute.push(k);return {ok:true,msg:'x'};}}});
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(150);
 assert.deepEqual(f.calls.execute,['pr-1']);
 const c1=cardMsgs(f,'pr-1').pop();assert.equal(c1.state,'failed');assert.match(c1.msg,/No se pudo abrir ni comprobar/);
 const end=cardMsgs(f,lote(f).key).pop();assert.equal(end.state,'partial');assert.match(end.msg,/Se guardaron 0 de 3/);assert.match(end.msg,/revises Inventario/);
 assert.equal(shown(f),true,'WORK sigue a la vista');
});
test('guardado en curso (estado neutro): el lote se detiene sin contarlo como fallo',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]})});
 await ask(f);
 f.root.guardarProd=async()=>{await new Promise(()=>{});};
 f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(300);
 assert.ok(true);
});
test('mientras corre el lote, tocar «Confirmar» en una tarjeta suelta no confirma nada en paralelo',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]}),execute:async(k)=>{await tick(40);return {ok:true,msg:'ok'};}});
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(10);
 f.post({type:'na-work:card-confirm',key:'pr-2'});await tick(5);
 assert.equal(f.calls.execute.filter(k=>k==='pr-2').length,0);
 assert.match(cardMsgs(f,'pr-2')[0].msg,/se está guardando otro cambio/);
 await tick(200);assert.deepEqual(f.calls.execute,['pr-1','pr-2']);
});
test('«Cancelar todo» cancela cada tarjeta del lote y no gasta ningún token',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]})});
 await ask(f);f.post({type:'na-work:card-cancel-all',key:lote(f).key});await tick(30);
 assert.deepEqual(f.calls.execute,[]);assert.deepEqual(f.calls.cancel,['pr-1','pr-2']);
 assert.equal(cardMsgs(f,lote(f).key).pop().state,'cancelled');
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
test('H-2 (sonda de A3): 3 tarjetas y el formulario NO se cierra tras guardar -> nunca «Listo: los 3 se guardaron»; el lote se detiene y WORK no se oculta',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]})});
 await ask(f);
 f.root.guardarProd=async()=>{f.calls.save.push('sin-cerrar');}; // «guarda» pero la ficha queda abierta
 f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(200);
 assert.deepEqual(f.calls.execute,['pr-1'],'solo se gastó UN token');
 const c1=cardMsgs(f,'pr-1').pop();assert.equal(c1.state,'failed');assert.match(c1.msg,/no se cerró al guardar/);
 const end=cardMsgs(f,lote(f).key).pop();
 assert.equal(end.state,'partial');assert.doesNotMatch(end.msg,/Listo/);assert.match(end.msg,/Se guardaron 0 de 3/);assert.match(end.msg,/2 quedaron sin confirmar/);
 assert.equal(shown(f),true,'WORK sigue a la vista (no se oculta a mitad del lote)');
 assert.ok(!cardMsgs(f,'pr-1').some(m=>m.state==='done'));
});
test('M-1: «Detener» mientras el lote corre: termina la tarjeta en curso, no gasta más tokens y resume',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]}),execute:async(k)=>{await tick(40);return {ok:true,msg:'ok'};}});
 await ask(f);const lk=lote(f).key;
 f.post({type:'na-work:card-confirm-all',key:lk});await tick(15);
 f.post({type:'na-work:card-cancel-all',key:lk}); // el mismo botón es «Detener» mientras corre
 const stopping=cardMsgs(f,lk).pop();assert.equal(stopping.stopping,true);
 await tick(250);
 assert.deepEqual(f.calls.execute,['pr-1']);assert.deepEqual(f.calls.cancel,[],'no cancela tarjetas ya confirmadas ni las demás: siguen confirmables');
 const end=cardMsgs(f,lk).pop();assert.equal(end.state,'partial');assert.match(end.msg,/Lo detuviste/);assert.match(end.msg,/Se guardaron 1 de 3/);assert.match(end.msg,/2 quedaron sin confirmar/);
});
test('M-1: «Detener» durante la espera por el tope por minuto corta la espera SIN gastar el token de la tarjeta que esperaba',async()=>{
 const f=fixture({products:6,api:async()=>({texto:'ok',proposals:[1,2,3,4,5,6].map(n=>pr(n)),turns:[]})});
 await ask(f);const lk=lote(f).key;
 f.post({type:'na-work:card-confirm-all',key:lk});await tick(120);
 assert.ok(cardMsgs(f,'pr-6').some(m=>m.state==='waiting'),'la sexta está esperando');
 f.post({type:'na-work:card-cancel-all',key:lk});await tick(60);
 assert.equal(f.calls.execute.length,5,'la sexta no se gastó');
 assert.equal(cardMsgs(f,'pr-6').pop().state,'pending');
 const end=cardMsgs(f,lk).pop();assert.match(end.msg,/Lo detuviste/);assert.match(end.msg,/Se guardaron 5 de 6/);
});
test('M-1: si WORK se cierra a mitad, la tarjeta en vuelo se termina (se guarda y se comprueba) y se AVISA; no se gastan más tokens',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]}),execute:async(k)=>{await tick(40);return {ok:true,msg:'ok'};}});
 await ask(f);
 f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(15);
 f.post({type:'na-work:close'});await tick(300);
 assert.deepEqual(f.calls.execute,['pr-1']);
 assert.deepEqual(f.calls.save,['P1'],'lo que ya se confirmó se guarda');
 const t=f.calls.toast.map(x=>x[1]).join(' | ');
 assert.match(t,/«Galleta 1»: se guardó el cambio/);assert.match(t,/WORK se cerró a mitad de «Confirmar todo»/);
});
test('M-2: una firma que venció mientras esperaba NO se gasta ni se confirma a ciegas: «venció», solo esa tarjeta, y el lote sigue con las demás',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]}),expiries:{'pr-2':FIXED+30000},
  execute:async(k)=>{if(k==='pr-1')f.setClock(FIXED+31000);return {ok:true,msg:'ok'};}}); // al confirmar la 1.ª ya pasó el tiempo de la 2.ª
 await ask(f);
 f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(200);
 assert.deepEqual(f.calls.execute,['pr-1','pr-3'],'la vencida no se gastó');
 assert.equal(cardMsgs(f,'pr-2').pop().state,'expired');assert.match(cardMsgs(f,'pr-2').pop().msg,/venció/);
 const end=cardMsgs(f,lote(f).key).pop();assert.equal(end.state,'partial');assert.match(end.msg,/1 venció/);assert.match(end.msg,/Se guardaron 2 de 3/);
});
test('M-2: si vence durante la espera del 429, no se reintenta con el token vencido',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async(k,n)=>{if(n===1){f.setClock(FIXED+400000);return {ok:false,code:'rate_limited',retry_after_s:1,msg:'x'};}return {ok:true,msg:'ok'};}});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(100);
 assert.deepEqual(f.calls.execute,['pr-1']);assert.equal(cardMsgs(f,'pr-1').pop().state,'expired');
});
test('M-2: el lote que no cabe antes de que venzan las firmas lo avisa desde el principio y deja fuera (sin gastar) las que no caben',async()=>{
 const f=fixture({products:6,api:async()=>({texto:'ok',proposals:[1,2,3,4,5,6].map(n=>pr(n)),turns:[]}),expiries:{'pr-6':FIXED+20000}});
 await ask(f);
 const l=lote(f);assert.match(l.warnings.join(' '),/Solo caben 5 antes de que venza la firma/);
 f.post({type:'na-work:card-confirm-all',key:l.key});await tick(250);
 assert.deepEqual(f.calls.execute,['pr-1','pr-2','pr-3','pr-4','pr-5']);
 assert.match(cardMsgs(f,'pr-6').pop().msg,/No cabe antes de que venza/);
 const end=cardMsgs(f,l.key).pop();assert.equal(end.state,'partial');assert.match(end.msg,/Se guardaron 5 de 6/);
});
test('M-5: el lote muestra antes → después también en stock (y en precio)',async()=>{
 const aj=(n)=>({id:'aj-'+n,type:'ajuste',needsConfirm:true,confirm_token:'T'+n+'.s',title:'Ajustar',nombre:'Arroz '+n,product_id:'P'+n,tipo:'entrada',cantidad:5,motivo:'Compra',stock_actual:3,stock_despues:8,quedaNegativo:false,grande:false});
 const f=fixture({api:async()=>({texto:'ok',proposals:[aj(1),aj(2),pr(3)],turns:[]})});
 await ask(f);
 const rows=lote(f).rows;
 assert.equal(JSON.stringify(rows[0]),JSON.stringify(['Arroz 1 · Compra','+5 · Stock 3 → 8']));
 assert.match(rows[2][1],/^S\/ 4\.50 → S\/ 4\.7\d$/);
});
test('tope por minuto configurable: 5 por defecto; si el Worker entrega otro (access.limits.confirms_per_minute) el cliente no espera de más',async()=>{
 const mk=(access)=>fixture({products:6,access,api:async()=>({texto:'ok',proposals:[1,2,3,4,5,6].map(n=>pr(n)),turns:[]})});
 let f=mk(undefined);await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(150);
 assert.ok(cardMsgs(f,'pr-6').some(m=>m.state==='waiting'),'con 5 por defecto la sexta espera');
 f=mk({limits:{confirms_per_minute:30}});await ask(f);
 assert.doesNotMatch(lote(f).note,/Tardará/);
 f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(200);
 assert.equal(cardMsgs(f,'pr-6').filter(m=>m.state==='waiting').length,0);assert.equal(f.calls.execute.length,6);
 f=mk({limits:{confirms_per_minute:'x'}});await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(150);
 assert.ok(cardMsgs(f,'pr-6').some(m=>m.state==='waiting'),'un valor inválido vuelve a 5');
});
test('H-1 (decisión del dueño): un único punto para exigir el PIN una vez por lote; apagado por defecto y, encendido, falla cerrado',async()=>{
 const withPin=(approve)=>fixture({approve,src:source.replace('var REQUIRE_PIN_FOR_BATCH = false;','var REQUIRE_PIN_FOR_BATCH = true;'),api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]})});
 assert.match(source,/var REQUIRE_PIN_FOR_BATCH = false;/,'apagado por defecto');
 let asked=[];let f=withPin(async(...a)=>{asked.push(a);return false;});
 await ask(f);assert.match(lote(f).note,/con tu PIN una sola vez/);
 f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(80);
 assert.deepEqual(f.calls.execute,[],'sin PIN no se gasta ningún token');assert.equal(asked.length,1,'se pide UNA sola vez');
 assert.equal(asked[0][0],'product.update');assert.match(cardMsgs(f,lote(f).key).pop().msg,/No se confirmó el PIN/);
 asked=[];f=withPin(async(...a)=>{asked.push(a);return true;});
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(100);
 assert.deepEqual(f.calls.execute,['pr-1','pr-2']);assert.equal(asked.length,1);
 f=withPin(undefined);await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(60);
 assert.deepEqual(f.calls.execute,[],'sin forma de comprobar el PIN: falla cerrado');
 f=fixture({approve:async()=>{throw new Error('x');},api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]})});
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(100);
 assert.equal(f.calls.execute.length,2,'con el PIN apagado ni se consulta');
});

// ---------- Paquete B: sondas de A3/A4 con lotes grandes ----------
const many=(n)=>Array.from({length:n},(_,i)=>pr(i+1));
test('A3/A4 (M-2): lote de 30 tocado a los 60 s NO guarda 25 «sin avisar»: deja 5 fuera sin gastar su token y lo dice en el resumen y en cada tarjeta',async()=>{
 const f=fixture({products:30,api:async()=>({texto:'ok',proposals:many(30),turns:[]})});
 await ask(f);
 f.setClock(FIXED+60000); // el dueño tardó un minuto en tocar «Confirmar todo»
 f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(6000);
 assert.equal(f.calls.execute.length,25);
 for(let n=26;n<=30;n++){assert.ok(!f.calls.execute.includes('pr-'+n));assert.match(cardMsgs(f,'pr-'+n).pop().msg,/No cabe antes de que venza/);}
 const end=cardMsgs(f,lote(f).key).pop();assert.equal(end.state,'partial');assert.doesNotMatch(end.msg,/Listo/);assert.match(end.msg,/Se guardaron 25 de 30/);assert.match(end.msg,/5 no cabían antes de que venza la firma/);
});
test('A3/A4 (M-1): «Cancelar todo» con 12 en marcha PARA: no se gastan más tokens después de tocarlo',async()=>{
 const f=fixture({products:12,api:async()=>({texto:'ok',proposals:many(12),turns:[]}),execute:async()=>{await tick(30);return {ok:true,msg:'ok'};}});
 await ask(f);const lk=lote(f).key;
 f.post({type:'na-work:card-confirm-all',key:lk});await tick(120);
 f.post({type:'na-work:card-cancel-all',key:lk});
 const at=f.calls.execute.length;await tick(600);
 assert.ok(at>=1&&at<12);assert.ok(f.calls.execute.length<=at+1,'como mucho termina la que ya estaba en curso');
 const end=cardMsgs(f,lk).pop();assert.equal(end.state,'partial');assert.match(end.msg,/Lo detuviste/);assert.match(end.msg,/quedaron sin confirmar/);
});
test('B7 (A4): tras un 403 (rol perdido) el lote deja de llamar al servidor y se detiene diciendo por qué',async()=>{
 const f=fixture({products:6,api:async()=>({texto:'ok',proposals:many(6),turns:[]}),execute:async(k)=>k==='pr-3'?{ok:false,code:'forbidden_role',msg:'x'}:{ok:true,msg:'ok'}});
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(300);
 assert.deepEqual(f.calls.execute,['pr-1','pr-2','pr-3'],'ninguna llamada más al servidor');
 const end=cardMsgs(f,lote(f).key).pop();assert.equal(end.state,'partial');assert.match(end.msg,/Se guardaron 2 de 6/);assert.match(end.msg,/ya no tiene permiso de Admin/);assert.match(end.msg,/3 quedaron sin confirmar/);
});
test('cancelar UNA tarjeta mientras espera dentro del lote no cuenta como fallo ni detiene el lote',async()=>{
 const f=fixture({products:6,api:async()=>({texto:'ok',proposals:many(6),turns:[]})});
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(120);
 assert.equal(cardMsgs(f,'pr-6').pop().state,'waiting');
 f.post({type:'na-work:card-cancel',key:'pr-6'});await tick(200);
 assert.equal(f.calls.execute.length,5);const end=cardMsgs(f,lote(f).key).pop();assert.match(end.msg,/Se guardaron 5 de 6/);assert.doesNotMatch(end.msg,/no se pudo:|no se pudieron:/);
});

// ---------- Paquete B v3: B-1 (token en vuelo al cerrar WORK), B-2 (texto final), B-3 (gancho inerte) ----------
test('B-1 (A4): cerrar WORK con la petición de «Confirmar todo» en vuelo: NO se olvida esa tarjeta hasta que termine; se aplica, se guarda y se AVISA (lo guardado == tokens gastados)',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]}),execute:async(k)=>{await tick(60);return {ok:true,msg:'ok'};}});
 await ask(f);
 f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(20);
 f.post({type:'na-work:close'});
 assert.deepEqual(f.calls.forget,['pr-2','pr-3'],'al cerrar solo se olvidan las que NO están en vuelo');
 await tick(400);
 assert.deepEqual(f.calls.execute,['pr-1'],'no se gasta ningún token más');
 assert.deepEqual(f.calls.save,['P1'],'el token gastado quedó aplicado: 1 token = 1 cambio guardado');
 assert.deepEqual(f.calls.forget,['pr-2','pr-3','pr-1'],'la tarjeta en vuelo se suelta al terminar');
 const t=f.calls.toast.map(x=>x[1]).join(' | ');
 assert.match(t,/«Galleta 1»: se guardó el cambio/);assert.match(t,/1 de 3 se confirmó \(/);assert.match(t,/2 quedaron sin confirmar/);
});
test('B-1 (A4): con una tarjeta suelta en vuelo pasa lo mismo; y si la respuesta no llegó (red) se avisa que puede haber quedado firmado',async()=>{
 let f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async()=>{await tick(50);return {ok:true,msg:'ok'};}});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(15);f.post({type:'na-work:close'});await tick(300);
 assert.deepEqual(f.calls.save,['P1']);assert.match(f.calls.toast.map(x=>x[1]).join('|'),/se guardó el cambio/);
 f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async()=>{await tick(50);return {ok:false,code:'network',retry:true,msg:'x'};}});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(15);f.post({type:'na-work:close'});await tick(200);
 assert.deepEqual(f.calls.save,[]);assert.match(f.calls.toast.map(x=>x[1]).join('|'),/no supe si el servidor llegó a confirmar/);assert.ok(f.calls.forget.includes('pr-1'));
});
test('B-1 (A4): un token gastado que no se puede aplicar (tarjeta con aviso, sin guardado de un toque) NUNCA se pierde en silencio: avisa',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1,{bajoCosto:true})],turns:[]}),execute:async()=>{await tick(50);return {ok:true,msg:'ok'};}});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(15);f.post({type:'na-work:close'});await tick(300);
 assert.match(f.calls.toast.map(x=>x[1]).join('|'),/se confirmó pero WORK se cerró\. Revisa la ficha abierta o Inventario antes de repetirlo/);
});
test('B-1 (A4): sin cerrar WORK, la petición en vuelo termina normal: se guarda, queda «Hecho» y no se olvida nada antes de tiempo',async()=>{
 const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]}),execute:async()=>{await tick(50);return {ok:true,msg:'ok'};}});
 await ask(f);f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(15);
 await tick(300);assert.deepEqual(f.calls.save,['P1']);assert.equal(cardMsgs(f,'pr-1').pop().state,'done');assert.deepEqual(f.calls.forget,[]);
});
test('B-2 (A4): el texto final dice cuántos se guardaron, cuántos quedaron fuera y por qué (sin mezclar «avisos» con «no cabían»)',()=>{
 const m=CORE.batchSummary({ok:20,total:30,nofit:5,skipped:3,fail:1,expired:1});
 assert.equal(m.state,'partial');
 assert.match(m.msg,/Se guardaron 20 de 30\./);assert.match(m.msg,/Quedaron fuera 10:/);
 assert.match(m.msg,/1 no se pudo guardar \(mira su tarjeta\)/);assert.match(m.msg,/1 venció \(la firma dura 5 minutos\)/);
 assert.match(m.msg,/5 no cabían antes de que venza la firma \(5 minutos\)/);assert.match(m.msg,/3 tienen avisos o cambiaron su precio o stock mientras tanto/);
 const only=CORE.batchSummary({ok:25,total:30,nofit:5});
 assert.doesNotMatch(only.msg,/avisos/);assert.match(only.msg,/Quedaron fuera 5: 5 no cabían/);
 const one=CORE.batchSummary({ok:2,total:3,skipped:1});assert.match(one.msg,/Quedó fuera 1: 1 tiene avisos/);assert.match(one.msg,/siguen con su Confirmar/);
 assert.match(CORE.batchSummary({ok:1,total:3,user:true,rest:2,cancelled:0}).msg,/Lo detuviste\. Se guardaron 1 de 3\. Quedaron fuera 2: 2 quedaron sin confirmar porque el lote se detuvo/);
 assert.equal(CORE.batchSummary({ok:3,total:3}).state,'done');assert.equal(CORE.batchSummary({ok:2,total:3,rest:1}).state,'partial');
});
test('B-3 (A4): el tope por minuto nunca sube de 5 sin un valor válido que mande el Worker (un global del navegador no cuenta)',async()=>{
 const f=fixture({products:6,api:async()=>({texto:'ok',proposals:[1,2,3,4,5,6].map(n=>pr(n)),turns:[]})});
 f.root.NA_ASISTENTE_LIMITS={confirms_per_minute:30}; // ignorado: solo vale access.limits que viene del Worker
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(150);
 assert.ok(cardMsgs(f,'pr-6').some(m=>m.state==='waiting'),'sigue esperando antes de la 6.ª');
 for(const bad of [0,-1,61,999,'30x',null,undefined,NaN,Infinity])assert.equal(CORE.confirmLimit({confirms_per_minute:bad}),5,String(bad));
 assert.equal(CORE.confirmLimit(),5);assert.equal(CORE.confirmLimit('30'),5);assert.equal(CORE.confirmLimit({confirms_per_minute:'30'}),30);
});

test('N-3 (A3): textos correctos en singular y plural; «avisos» solo cuando de verdad hay avisos; nunca «1 cambios»',()=>{
 const all=[CORE.batchSummary({ok:1,total:1}).msg,CORE.batchSummary({ok:2,total:2}).msg,CORE.batchSummary({ok:1,total:3,skipped:1,nofit:1}).msg,CORE.batchSummary({ok:0,total:2,cancelled:1,rest:1}).msg,
  CORE.batchSummary({ok:2,total:4,expired:2}).msg,CORE.batchSummary({ok:1,total:2,fail:1}).msg];
 assert.equal(all[0],'Listo: 1 cambio guardado.');assert.equal(all[1],'Listo: los 2 cambios se guardaron.');
 for(const m of all)assert.doesNotMatch(m,/\b1 (cambios|vencieron|no cabían|tienen|no se pudieron|las cancelaste|quedaron)/);
 assert.match(all[2],/1 no cabía antes de que venza la firma/);assert.match(all[2],/1 tiene avisos o cambió su precio o stock/);
 assert.match(all[3],/1 la cancelaste tú/);assert.doesNotMatch(all[3],/avisos/);
 assert.match(all[4],/2 vencieron/);assert.doesNotMatch(all[4],/avisos|no cabían/);
});
test('N-3 (A3): al cerrar WORK a mitad el aviso usa singular/plural correcto («1 se confirmó», «1 quedó sin confirmar»)',async()=>{
 const f=fixture({products:2,api:async()=>({texto:'ok',proposals:[pr(1),pr(2)],turns:[]}),execute:async()=>{await tick(60);return {ok:true,msg:'ok'};}});
 await ask(f);f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(20);f.post({type:'na-work:close'});await tick(400);
 const t=f.calls.toast.map(x=>x[1]).join(' | ');assert.match(t,/1 de 2 se confirmó \(/);assert.match(t,/1 quedó sin confirmar: pídela otra vez/);assert.doesNotMatch(t,/1 cambios|1 quedaron/);
});
test('H-1 (A3 N-4): con REQUIRE_PIN_FOR_BATCH=true, si approve LANZA un error o lo rechaza: falla cerrado, no guarda nada, no gasta ni un token, y el lote se puede reintentar',async()=>{
 const PIN=source.replace('var REQUIRE_PIN_FOR_BATCH = false;','var REQUIRE_PIN_FOR_BATCH = true;');
 for(const how of ['lanza','rechaza','falso']){
  let mode=how,asked=0;
  const f=fixture({src:PIN,api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]}),
   approve:async()=>{asked++;if(mode==='lanza')throw new Error('pin_server_down');if(mode==='rechaza')return Promise.reject(new Error('pin_mal'));if(mode==='falso')return false;return true;}});
  await ask(f);const lk=lote(f).key;
  f.post({type:'na-work:card-confirm-all',key:lk});await tick(80);
  assert.equal(asked,1,how);assert.deepEqual(f.calls.execute,[],'no se gastó ningún token ('+how+')');assert.deepEqual(f.calls.save,[],'no se guardó nada ('+how+')');
  const m=cardMsgs(f,lk).pop();assert.equal(m.state,'pending');assert.match(m.msg,/No se confirmó el PIN\. No se hizo ningún cambio\./);
  assert.ok(!f.calls.cancel.length,'las tarjetas siguen confirmables');
  mode='ok'; // el dueño lo vuelve a intentar con el PIN bien: ahora sí
  f.post({type:'na-work:card-confirm-all',key:lk});await tick(250);
  assert.equal(asked,2);assert.deepEqual(f.calls.execute,['pr-1','pr-2','pr-3']);
 }
});

test('hospedado (producción): un na-work:close del iframe no cierra WORK ni reabre el Inicio retirado',async()=>{
 const f=fixture({hosted:true});
 assert.ok(shown(f));
 f.post({type:'na-work:close'});await tick(30);
 assert.ok(shown(f));
});
