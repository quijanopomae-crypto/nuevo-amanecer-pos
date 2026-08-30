// FIX05 harness: producto real en orden de index.html hasta inline-16.
// inline-17/18 (V10 dormante) quedan fuera por límite explícito de la misión.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export const POS_DIR=path.resolve(HERE,'..','..','..','..','POS');
const LOAD_ORDER=[
  'js/core/utils.js',
  'js/legacy-inline/inline-01.js',
  'js/modules/ticket/legacy.js',
  'js/legacy-inline/inline-02.js',
  'js/modules/ticket/overrides.js',
  'js/legacy-inline/inline-03.js',
  'js/core/state.js',
  'js/legacy-inline/inline-04.js',
  'js/legacy-inline/inline-05.js',
  'js/legacy-inline/inline-06.js',
  'js/legacy-inline/inline-07.js',
  'js/modules/ticket/zones.js',
  'js/legacy-inline/inline-08.js',
  'js/legacy-inline/inline-09.js',
  'js/legacy-inline/inline-10.js',
  'js/legacy-inline/inline-11.js',
  'js/legacy-inline/inline-12.js',
  'js/legacy-inline/inline-13.js',
  'js/modules/ticket/secure-print.js',
  'js/legacy-inline/inline-14.js',
  'js/legacy-inline/inline-15.js',
  'js/legacy-inline/inline-16.js',
];

export function makeStore(){
  const map=new Map();let broken=false;
  return{map,break_(){broken=true;},restore(){broken=false;},get broken(){return broken;},getItem(k){return map.has(String(k))?map.get(String(k)):null;},setItem(k,v){if(broken)throw new Error('SIMULATED_PERSISTENT_STORAGE_FAILURE');map.set(String(k),String(v));},removeItem(k){map.delete(String(k));},clear(){map.clear();},key(i){return Array.from(map.keys())[i]??null;},get length(){return map.size;}};
}
function makeClassList(){const set=new Set();return{add:(...c)=>c.forEach(x=>set.add(x)),remove:(...c)=>c.forEach(x=>set.delete(x)),toggle(c,force){const on=force===undefined?!set.has(c):!!force;if(on)set.add(c);else set.delete(c);return on;},contains:c=>set.has(c)};}
function makeElement(id=''){
  return{id,value:'',checked:false,textContent:'',innerHTML:'',className:'',title:'',hidden:false,disabled:false,open:false,type:'',max:'',placeholder:'',files:[],dataset:{},style:{},options:[],selectedOptions:[],selectedIndex:-1,children:[],parentNode:null,classList:makeClassList(),
    appendChild(child){if(!child)return child;if(child.parentNode?.removeChild)child.parentNode.removeChild(child);this.children.push(child);child.parentNode=this;return child;},
    insertBefore(child){if(!child)return child;this.children.unshift(child);child.parentNode=this;return child;},
    removeChild(child){const i=this.children.indexOf(child);if(i>=0)this.children.splice(i,1);child.parentNode=null;return child;},
    remove(){if(this.parentNode)this.parentNode.removeChild(this);},replaceChildren(){this.children.length=0;},add(){},insertAdjacentHTML(){},setAttribute(){},getAttribute:()=>null,removeAttribute(){},focus(){},blur(){},click(){},select(){},scrollTo(){},addEventListener(){},removeEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null,contains:()=>false};
}

export function createPosSandbox(opts={}){
  const localStorage=opts.stores?.localStorage??makeStore(),sessionStorage=opts.stores?.sessionStorage??makeStore(),elements=new Map();
  const documentStub={readyState:'complete',hidden:false,activeElement:null,body:{classList:makeClassList(),style:{},dataset:{},appendChild(){},insertAdjacentHTML(){}},documentElement:{classList:makeClassList(),style:{},dataset:{}},getElementById(id){if(!elements.has(id))elements.set(id,makeElement(id));return elements.get(id);},querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>makeElement(''),createTextNode:text=>({textContent:String(text),children:[],parentNode:null,appendChild(){},removeChild(){}}),addEventListener(){},removeEventListener(){},dispatchEvent:()=>true};
  const popup={document:{write(){},close(){},body:makeElement('popupBody')},focus(){},print(){},close(){}};
  const sandbox={console,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,structuredClone,URL,Blob,TextEncoder,TextDecoder,performance:globalThis.performance,crypto:globalThis.crypto,localStorage,sessionStorage,document:documentStub,navigator:{userAgent:'POS-FIX05-Harness/1.0'},location:{href:'file:///POS/index.html',protocol:'file:',search:''},innerWidth:1280,scrollY:0,requestAnimationFrame:fn=>setTimeout(fn,0),prompt:()=>null,confirm:()=>true,alert(){},open:()=>popup,print(){},scrollTo(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),MutationObserver:class{observe(){}disconnect(){}},addEventListener(){},removeEventListener(){},dispatchEvent:()=>true,Event:class{constructor(t){this.type=t;}},CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail;}}};
  sandbox.window=sandbox;sandbox.globalThis=sandbox;sandbox.self=sandbox;sandbox.top=sandbox;sandbox.parent=sandbox;sandbox.frames=sandbox;
  const ctx=vm.createContext(sandbox);
  for(const rel of LOAD_ORDER)new vm.Script(readFileSync(path.join(POS_DIR,rel),'utf8'),{filename:`POS/${rel}`}).runInContext(ctx);
  vm.runInContext(`appConfig.alertsEnabled=false;appConfig.printAuto=false;appConfig.igvActive=true;appConfig.ticket=Object.assign({},appConfig.ticket,{showIGV:true});_naSecurity.pinEnabled=false;_naSecurity.logs=[];_naEnsureCashierConfig();appConfig.activeCashierId='CAJ-001';const __fix05Admin=appConfig.cashiers.find(c=>c.id==='CAJ-001');if(__fix05Admin){__fix05Admin.role='admin';__fix05Admin.permissions=_naF10RoleDefaults('admin');}appConfig.creditPolicy=Object.assign({},_naCreditPolicy(),{enabled:true});`,ctx,{filename:'fix05-bootstrap.js'});
  return{ctx,stores:{localStorage,sessionStorage},run(code){return vm.runInContext(code,ctx,{filename:'fix05-harness.js'});},el(id){return this.run(`document.getElementById(${JSON.stringify(id)})`);},memoryState(){return JSON.parse(this.run('JSON.stringify({productos,ventas,clientes,creditos,gastos,cajMovs,cajEstado,cashClosures,inventoryMovements,cart})'));},durableRaw(){return this.run('storage.readPersistent(_NA_LOCAL_KEY)');},durableSnapshot(){const raw=this.durableRaw();return raw?JSON.parse(raw):null;},breakPersistent(){localStorage.break_();},restorePersistent(){localStorage.restore();},toastText(){return String(this.run("document.getElementById('gToast').textContent")??'');},seed(){this.run(`productos=[];ventas=[];clientes=[];creditos=[];gastos=[];cajMovs=[];cashClosures=[];inventoryMovements=[];cart=[];posPayM='efectivo';posProc=false;pagoProc=false;pagoRevProc=false;gastoProc=false;cajMovProc=false;cajCloseProc=false;_naInventoryMoveBusy=false;_naSaleAnnulmentProc=false;invMovId=null;invMovT='entrada';cliCredId=null;pagoCredId=null;imagenProducto=null;invEditId=null;cajMovTipo='egr';cajEstado={abierta:true,cerrada:false,fondo:100,cajero:'Cajero 1',cajeroNombre:'Cajero 1',cajeroId:'CAJ-001',fechaApertura:obtenerHoy(),timestampApertura:new Date().toISOString(),sessionId:1700000000000,hora:nowT(),hora24:_naTime24(new Date()),horaCierre:null,contado:null,esperado:null,diferencia:null};`);},seedData(target,values){this.run(`${target}.push(...${JSON.stringify(values)})`);}};
}
export function json(sb,expr){return JSON.parse(sb.run(`JSON.stringify(${expr})`));}
