import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sanitizeContext,buildDeepSeekRequest,toProposal,toolsForRole,assistantConfirmRoute,issueConfirmToken,createMemoryUsageStore,dedupeActions} from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require=createRequire(import.meta.url);const C=require('../../POS/js/modules/asistente/asistente-core.js');
const snapshot={modo:'claro',tema:'verde',tamano:100,lector_sonido:true,stock_minimo:5,stock_avisos:true,impresion_automatica:false};
const ctx=()=>sanitizeContext({products:[],settings:snapshot},'owner');
const proposal=(ajuste,valor,role='owner')=>toProposal({name:'configurar_app',arguments:{ajuste,valor}},role,ctx(),1);
test('Admin conoce opciones reales y valores sin subir capturas; datos personales quedan fuera',()=>{
 const s=sanitizeContext({products:[],settings:{...snapshot,pin:'9999',ruc:'12345678901',secreto:'no'}},'owner');
 const r=buildDeepSeekRequest({role:'owner',ctx:s,history:[],text:'Qué opciones hay en configuración'});
 const payload=JSON.stringify(r.messages);assert.match(payload,/stock_minimo/);assert.match(payload,/este aparato|aparato/);assert.match(payload,/tamano/);assert.doesNotMatch(payload,/9999|12345678901|secreto/);
});
test('configuración solo Admin incluso ante empleado de nivel 3 con costos',()=>{
 assert.ok(toolsForRole('owner').some(t=>t.function.name==='configurar_app'));
 // #967: el nivel 3 con «costos y cambios» recibe configurar_app SOLO con datos del negocio y del ticket; los ajustes de este catálogo siguen del Admin.
 const l3c=toolsForRole('empleado:completo+costos').find(t=>t.function.name==='configurar_app');
 assert.ok(l3c&&!l3c.function.parameters.properties.ajuste.enum.some(k=>Object.hasOwn(snapshot,k)||['lector_activo','lector_intervalo','lector_minimo'].includes(k)));
 for(const role of ['empleado:consultas','empleado:consultas_documentos','empleado:completo','empleado:completo+costos']){
  if(role!=='empleado:completo+costos')assert.ok(!toolsForRole(role).some(t=>t.function.name==='configurar_app'));
  assert.equal(proposal('modo','noche',role).dropped,'forbidden_role');
  assert.equal(sanitizeContext({settings:snapshot},role).settings,undefined);
 }
});
test('propuestas validadas muestran antes/después y alcance sin ejecutar cambios',()=>{
 const p=proposal('modo','noche');assert.equal(p.type,'configuracion');assert.equal(p.antes,'claro');assert.equal(p.valor,'noche');assert.equal(p.alcance,'este aparato');assert.equal(p.needsConfirm,true);
 assert.equal(proposal('stock_minimo',8).alcance,'todos los aparatos');assert.equal(snapshot.stock_minimo,5);
 for(const [k,v] of [['pin','1234'],['modo','javascript:alert(1)'],['tamano',999],['stock_minimo',-1],['stock_avisos','false'],['__proto__',1]]) assert.ok(proposal(k,v).dropped,k);
});
test('valor actual desconocido no inventa antes ni permite confirmar',()=>{
 const p=toProposal({name:'configurar_app',arguments:{ajuste:'modo',valor:'noche'}},'owner',sanitizeContext({},'owner'),1);assert.equal(p.dropped,'settings_unavailable');
});
test('cambios distintos no se eliminan como duplicados; mismo ajuste una sola vez',()=>{
 const a=proposal('modo','noche'),b=proposal('tamano',115),d=[];
 const list=[a,b,{...a,id:'another'}];dedupeActions(list,d);assert.equal(list.length,2);
});
test('confirmación remota exige tarjeta firmada intacta y devuelve acción a ejecutar una vez',async()=>{
 const secret='settings-test-secret-12345678',auth={principalId:'owner',sessionId:'s'},p=proposal('modo','noche'),now=Date.now();p.id='setting-test';
 const token=await issueConfirmToken(p,'owner',auth,secret,now),store=createMemoryUsageStore();
 async function confirm(prop,role='owner'){return assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm',{method:'POST',body:JSON.stringify({proposal:prop,token})}),{ASSISTANT_ENABLED:'1',ASSISTANT_CONFIRM_SECRET:secret},auth,(d,s=200)=>new Response(JSON.stringify(d),{status:s}),{store,resolveRole:async()=>role,audit:async()=>1});}
 assert.equal((await confirm({...p,valor:'auto'})).status,409);assert.equal((await confirm(p,'empleado:consultas')).status,403);
 const r=await confirm(p);assert.equal(r.status,200);assert.equal((await r.json()).proposal.valor,'noche');
});
test('ejecutor cliente bloquea empleado y solo aplica el valor confirmado',async()=>{
 const p=proposal('modo','noche');assert.equal(C.canExecute({role:'owner',isOwner:()=>true},p).ok,true);assert.equal(C.canExecute({role:'empleado',level:'consultas'},p).ok,false);
 let received;const result=await C.EXECUTORS.configuracion(p,{applyConfiguration:async q=>{received=q;return {ok:true,msg:'Guardado en este aparato'};}});
 assert.equal(received.valor,'noche');assert.equal(result.ok,true);
});
function configHarness(){
 const storage=new Map();const root={document:{readyState:'loading',addEventListener(){},getElementById(){return null;},documentElement:{setAttribute(){}}},matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},NA_ROLES:{isOwner:()=>true,confirmed:true},NA_THEME:{mode:()=>root.mode||'claro',setMode:v=>root.mode=v,apply:()=>false},NA_CONFIG_E2:{read:()=>JSON.parse(storage.get('na_appearance_v1')||'{"text":100}'),clamp:v=>Math.max(85,Math.min(125,v)),apply(){}},navigator:{onLine:true},mode:'claro'};
 const appConfig={stockMin:5,stockAlertActive:true,printAuto:false};vm.runInNewContext(readFileSync('POS/js/config/config-v9.js','utf8'),{window:root,appConfig,console,setTimeout,clearTimeout});return {root,appConfig,storage};
}
test('usa configuración existente, respeta cambios posteriores y persiste apariencia',async()=>{
 const h=configHarness(),api=h.root.NA_CONFIG_V9;
 assert.equal(api.assistantSnapshot().modo,'claro');
 const r=await api.assistantApply({ajuste:'modo',antes:'claro',valor:'noche'});assert.equal(r.ok,true);assert.equal(h.root.mode,'noche');
 assert.equal((await api.assistantApply({ajuste:'modo',antes:'claro',valor:'auto'})).ok,false);assert.equal(h.root.mode,'noche');
 assert.equal((await api.assistantApply({ajuste:'tamano',antes:100,valor:115})).ok,true);assert.equal(JSON.parse(h.storage.get('na_appearance_v1')).text,115);
 h.root.NA_ROLES.isOwner=()=>false;assert.equal((await api.assistantApply({ajuste:'modo',antes:'noche',valor:'claro'})).ok,false);
});
function sharedHarness({remote=5,local=5,fail=false,dirty=false,throwConflict=false}={}){
 const app={stockMin:local,stockAlertActive:true,printAuto:false,igvActive:true},calls=[];
 const flags=()=>({...app}),known={stockMin:dirty?3:local,stockAlertActive:true,printAuto:false,igvActive:true};
 const w={NA_ROLES:{isOwner:()=>true,confirmed:true},localStorage:{setItem(){}},_naApplyConfigUI(){}};
 const source=readFileSync('POS/js/config/config-g.js','utf8');const fn=source.slice(source.indexOf('  async function setAssistantFlag('),source.indexOf('  root.NA_CONFIG_G ='));
 const context={root:w,R:()=>w.NA_ROLES,cloud:()=>true,appReady:true,pendingBase:null,cfg:()=>app,SHARED:{'pos.flags':{get:flags}},confirmed:{'pos.flags':{value:known,revision:2}},server:{},sameKey:(_k,a,b)=>JSON.stringify(a)===JSON.stringify(b),copy:x=>JSON.parse(JSON.stringify(x)),CACHE_KEY:'test',baseSave:async()=>{}};
 w.NA_ROLES.api=async(path,payload,method)=>{calls.push({path,payload,method});if(fail)throw Error('network');if(!payload)return {settings:[{key:'pos.flags',value:{stockMin:remote,stockAlertActive:true,printAuto:false,igvActive:false},revision:7}]};if(throwConflict)throw Error('revision_conflict');return {revision:8};};
 vm.createContext(context);vm.runInContext(fn+'\nthis.apply=setAssistantFlag;',context);return {apply:context.apply,app,calls,w};
}
test('guardado compartido modifica solo la bandera pedida y usa la revisión remota',async()=>{
 const h=sharedHarness();const r=await h.apply('stockMin',8,5);assert.equal(r.ok,true);
 const writes=h.calls.filter(c=>c.payload);assert.equal(writes.length,1);assert.equal(writes[0].path,'/settings');assert.equal(writes[0].payload.key,'pos.flags');assert.equal(writes[0].payload.expected_revision,7);
 assert.equal(writes[0].payload.value.stockMin,8);assert.equal(writes[0].payload.value.igvActive,false,'no revierte un ajuste ajeno que cambió remotamente');assert.equal(h.app.stockMin,8);
});
test('cambio remoto, red caída, pendiente local y conflicto no anuncian guardado ni pisan el valor',async()=>{
 for(const opts of [{remote:9},{fail:true},{dirty:true},{throwConflict:true}]){
  const h=sharedHarness(opts);assert.equal((await h.apply('stockMin',8,5)).ok,false);assert.equal(h.app.stockMin,5);
  if(!opts.throwConflict)assert.equal(h.calls.filter(c=>c.payload).length,0);
 }
});
test('reintento tras guardado ya aplicado no duplica POST; rechaza claves de seguridad',async()=>{
 const h=sharedHarness({remote:8});assert.equal((await h.apply('stockMin',8,5)).ok,true);assert.equal(h.calls.filter(c=>c.payload).length,0);assert.equal(h.app.stockMin,8);
 assert.equal((await h.apply('allowExpiredLots',true,false)).ok,false);
});
test('lector espera su guardado existente y detecta rollback antes de anunciar éxito',async()=>{
 const h=configHarness();let release,finished=false;const scanner={sound:true};h.root._naScannerCfg=()=>scanner;
 h.root.scannerToggleSetting=async()=>{scanner.sound=false;await new Promise(r=>{release=r;});scanner.sound=true;return false;};
 h.root.saveAppState=async()=>{throw Error('no debe duplicar el guardado');};
 const p=h.root.NA_CONFIG_V9.assistantApply({ajuste:'lector_sonido',antes:true,valor:false}).then(r=>{finished=true;return r;});
 await new Promise(r=>setImmediate(r));assert.equal(finished,false);release();assert.equal((await p).ok,false);assert.equal(scanner.sound,true);
});
test('solo adjunta configuración en consultas pertinentes y respuestas breves de seguimiento',()=>{
 assert.equal(C.configurationIntent('Cambia al modo oscuro',false),true);
 assert.equal(C.configurationIntent('115',true),true);
 assert.equal(C.configurationIntent('hazlo',true),true);
 assert.equal(C.configurationIntent('115',false),false);
 assert.equal(C.configurationIntent('hazlo',false),false);
 assert.equal(C.configurationIntent('¿Cuánto vendí hoy?',true),false);
});
test('regresión captura Web196: configurar → interfas → Color → Azul conserva herramienta y valores',()=>{
 let previous=false;
 for(const text of ['Una pregunta puedes configurar','Puedes cambiar la interfas','Color','Azul']){
  previous=C.configurationIntent(text,previous);assert.equal(previous,true,text);
  const context=sanitizeContext({products:[],settings:previous?snapshot:undefined},'owner');
  const req=buildDeepSeekRequest({role:'owner',ctx:context,history:[],text});
  assert.ok(req.tools.some(t=>t.function.name==='configurar_app'),text);
  assert.match(JSON.stringify(req.messages),/Color y estilo/);
  assert.equal(context.settings.tema,'verde');
 }
 const card=proposal('tema','azul');assert.equal(card.type,'configuracion');assert.equal(card.antes,'verde');assert.equal(card.valor,'azul');assert.equal(card.needsConfirm,true);
 assert.equal(C.configurationIntent('¿Cuánto vendí hoy?',previous),false);
});
test('Color y colores admitidos mantienen catálogo aun sin snapshot; empleados siguen sin herramienta',()=>{
 for(const text of ['Color','Qué colores hay','Pon azul','Celeste','Verde esmeralda','Naranja','Simple claro']){
  assert.equal(C.configurationIntent(text,false),true,text);
  const req=buildDeepSeekRequest({role:'owner',ctx:sanitizeContext({products:[]},'owner'),history:[],text});
  assert.ok(req.tools.some(t=>t.function.name==='configurar_app'),text);
  const denied=buildDeepSeekRequest({role:'empleado:completo+costos',ctx:sanitizeContext({products:[],settings:snapshot},'empleado:completo+costos'),history:[],text});
  const t=denied.tools.find(t=>t.function.name==='configurar_app');assert.ok(!t||!t.function.parameters.properties.ajuste.enum.includes('tema'),text); // #967: solo negocio y ticket
  assert.doesNotMatch(JSON.stringify(denied.messages),/Color y estilo/,text);
 }
});
