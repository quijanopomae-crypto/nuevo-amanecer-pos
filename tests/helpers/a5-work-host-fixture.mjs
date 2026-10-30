// Ayuda de pruebas (ASISTENTE 5 / GROKBOT 5): ejecuta el work-host.js REAL en un contexto vm con un motor FALSO (sin red, sin Worker, sin datos reales).
// Es una copia mínima del `fixture` de tests/work/work-capacidad.test.mjs (que no lo exporta) para reutilizarlo en pruebas nuevas sin tocar ese archivo.
// NO es una prueba: no tiene `.test.` en el nombre.
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export const CORE=require('../../POS/js/modules/asistente/asistente-core.js');
export const source=readFileSync('POS/js/work-host.js','utf8');
export const tick=(ms=15)=>new Promise(r=>setTimeout(r,ms));
export const FIXED=1700000010000; // 30 s dentro de un minuto de reloj
export function fixture({owner=true,engine={},api,catalog,execute,products=3,access,approve,src=source,expiries={}}={}){
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
    cancel:(k)=>calls.cancel.push(k),forget:(k)=>{calls.forget.push(k);forgotten.add(k);},forgetAll(){},state:()=>'pending',
    execute:execute?async(k,o)=>{calls.execute.push(k);const r=await execute(k,calls.execute.filter(x=>x===k).length);if(forgotten.has(k))throw new TypeError('propuesta olvidada con la petición en vuelo');if(r.ok){cur=props[k];open.mProd=cur.type==='precio';open.mMovInv=cur.type==='ajuste';}return r;}
      :async(k)=>{calls.execute.push(k);if(forgotten.has(k))throw new TypeError('olvidada');cur=props[k];open.mProd=cur.type==='precio';open.mMovInv=cur.type==='ajuste';return {ok:true,msg:'Abrí la ficha.'};},
    go:()=>({ok:true}),openDocument:async()=>({ok:true}),...engine}}};
 vm.runInNewContext(src,{window:root,URLSearchParams,Array,Object,String,Error,JSON,Date:FakeDate,Promise,Number,isFinite,Math});
 const frameWin=frames[0].contentWindow;
 const post=data=>listeners.message({origin:'https://pos.test',source:frameWin,data});
 return {root,nodes,listeners,sent,frames,calls,post,open,local,setClock:(t)=>{clock=t;},getClock:()=>clock};
}

export const pr=(n,extra={})=>({id:'pr-'+n,type:'precio',needsConfirm:true,confirm_token:'SECRETO'+n+'.firma',title:'Cambiar precio',nombre:'Galleta '+n,product_id:'P'+n,precio_actual:4.5,precio_nuevo:4.7+n/100,cambioGrande:false,bajoCosto:false,...extra});
export const aj=(n,extra={})=>({id:'aj-'+n,type:'ajuste',needsConfirm:true,confirm_token:'SECRETO'+n+'.firma',title:'Entrada de stock',nombre:'Galleta '+n,product_id:'P'+n,tipo:'entrada',cantidad:7,motivo:'Ajuste de inventario',stock_actual:3,stock_despues:10,quedaNegativo:false,grande:false,...extra});
export const cardMsgs=(f,key)=>f.sent.filter(m=>m.action==='card'&&m.key===key);
export const lastCards=f=>[...f.sent].reverse().find(m=>m.action==='chat'&&m.cards)?.cards||[];
export const lote=f=>lastCards(f).find(c=>c.kind==='lote');
export const ask=async(f,text='x')=>{f.post({type:'na-work:chat',id:'a'+Math.random(),text});await tick();};
