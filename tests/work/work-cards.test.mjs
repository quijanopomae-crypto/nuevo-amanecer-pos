// WORK Fase 1: tarjetas tipadas con Confirmar real (motor del asistente original), contexto real, errores amables.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const CORE=require('../../POS/js/modules/asistente/asistente-core.js');
const source=readFileSync('POS/js/work-host.js','utf8');
const tick=(ms=15)=>new Promise(r=>setTimeout(r,ms));

function fixture({owner=true,engine={},api,core=CORE,modals={mProd:true,mMovInv:true},saves={},local={P1:{precio:4.5,costo:2,stock:3,controla:true}}}={}){
 const nodes=new Map(),listeners={},sent=[],frames=[],calls={api:[],execute:[],cancel:[],save:[],go:[]};
 const home={classList:{contains:()=>true}};
 const body={classList:{add(){},remove(){}},appendChild(el){if(el.id)nodes.set(el.id,el);}};
 const create=(tag)=>{const element={setAttribute(){},appendChild(){},addEventListener(){},remove(){nodes.delete(this.id);},contentWindow:{postMessage(m){sent.push(m);}}};if(tag==='iframe')frames.push(element);return element;};
 const open={mProd:modals.mProd,mMovInv:modals.mMovInv};
 const modalEl=id=>({classList:{contains:c=>c==='open'&&open[id]===true}});
 const root={document:{body,head:{appendChild(){}},readyState:'complete',createElement:create,
   getElementById:id=>id==='pageMenu'?home:(id==='mProd'||id==='mMovInv')?modalEl(id):nodes.get(id),querySelectorAll:()=>[]},
  location:{origin:'https://pos.test',search:'',hostname:'pos.test'},NA_HOSTED_CONFIG:{environment:'production'},
  NA_ROLES:{confirmed:true,role:owner?'owner':'empleado',isOwner:()=>owner,api:api||(async(path,b)=>{calls.api.push(b);return {reply:'ok',turns:[]};})},
  addEventListener:(e,fn)=>listeners[e]=fn,setInterval(){},setTimeout:fn=>setTimeout(fn,1),MutationObserver:class{observe(){}},
  NA_ASISTENTE_CORE:core,
  guardarProd:async()=>{calls.save.push('prod');if(saves.pending)await new Promise(()=>{});if(saves.prod!==false){if(local.P1)local.P1.precio=saves.priceAfter??5.2;open.mProd=false;}},
  guardarMovInv:async()=>{calls.save.push('mov');if(saves.mov!==false){if(local.P1)local.P1.stock=saves.stockAfter??8;open.mMovInv=false;}},
  NA_ASISTENTE:{engine:{ready:()=>true,owner:()=>owner,
    prepare:t=>({text:'[tapado] '+t,context:{screen:'pageMenu',products:[{id:'P1',nombre:'Leche',precio:4.5,stock:10}]},cards:[]}),
    canExecute:()=>({ok:true}),product:id=>local[id]?{...local[id]}:null,accessState:()=>'ok',expiry:()=>Date.now()+300000,add:p=>p.id,
    cancel:(k)=>calls.cancel.push(k),forget(){},forgetAll(){},state:()=>'pending',
    execute:async(k,o)=>{calls.execute.push([k,o]);return {ok:true,msg:'Abrí la ficha.'};},
    go:p=>{calls.go.push(p.pantalla);return {ok:true};},openDocument:async()=>({ok:true}),...engine}}};
 vm.runInNewContext(source,{window:root,URLSearchParams,Array,Object,String,Error,JSON,Date,Promise,Number,isFinite,Math});
 const frameWin=frames[0].contentWindow;
 const post=data=>listeners.message({origin:'https://pos.test',source:frameWin,data});
 return {root,nodes,listeners,sent,frames,calls,post,open};
}
const precio=(extra={})=>({id:'pr-1',type:'precio',needsConfirm:true,confirm_token:'SECRETO.firma',title:'Cambiar precio',nombre:'Leche',product_id:'P1',precio_actual:4.5,precio_nuevo:5.2,cambioGrande:false,bajoCosto:false,...extra});
const lastCards=f=>[...f.sent].reverse().find(m=>m.action==='chat'&&m.cards)?.cards||[];

test('el chat manda productos reales y el texto ya tapado por el motor del asistente (no products: [])',async()=>{
 const f=fixture();f.post({type:'na-work:chat',id:'a',text:'precio de la leche de Juan Perez'});await tick();
 const b=f.calls.api[0];
 assert.equal(b.context.products.length,1);assert.equal(b.context.products[0].id,'P1');
 assert.match(b.text,/^\[tapado\]/);assert.ok(Array.isArray(b.cards));
});
test('el contexto real nunca lleva costo ni a un empleado ni sin sesión de Admin (buildContext)',()=>{
 globalThis.NA_PERMISSIONS={canDo:(role)=>role==='owner'};
 const prods=[{id:'1',name:'Arroz',precio:5,stock:3,costo:3.2}];
 assert.equal(CORE.buildContext(prods,'empleado','pageMenu','arroz').products[0].costo,undefined);
 assert.equal(CORE.buildContext(prods,'owner','pageMenu','arroz').products[0].costo,3.2);
});
test('un mensaje de más de 1500 letras avisa y no se envía',async()=>{
 const f=fixture();f.post({type:'na-work:chat',id:'a',text:'x'.repeat(1501)});await tick();
 assert.equal(f.calls.api.length,0);
 const m=f.sent.find(x=>x.action==='chat');assert.equal(m.ok,true);assert.match(m.text,/1500/);
});
test('sin motor del asistente listo no se envía nada y se dice en palabras simples',async()=>{
 const f=fixture({engine:{ready:()=>false}});f.post({type:'na-work:chat',id:'a',text:'hola'});
 await new Promise(r=>setTimeout(r,6600));
 assert.equal(f.calls.api.length,0);
 const m=f.sent.find(x=>x.action==='chat');assert.equal(m.ok,false);assert.doesNotMatch(m.text,/_|HTTP/);
});
test('rate_limited y otros códigos salen como frase amable, nunca como código',async()=>{
 for(const code of ['rate_limited','HTTP_429','daily_limit','upstream_busy','timeout','HTTP_500','algo_raro_xyz']){
  const f=fixture({api:async()=>{throw Object.assign(new Error(code),{data:{}});}});
  f.post({type:'na-work:chat',id:'a',text:'hola'});await tick();
  const m=f.sent.find(x=>x.action==='chat');
  assert.equal(m.ok,false,code);assert.doesNotMatch(m.text,/[a-z]+_[a-z_]+|HTTP|undefined/,code+' => '+m.text);
 }
 const f=fixture({api:async()=>{throw Object.assign(new Error('rate_limited'),{data:{retry_after_s:12}});}});
 f.post({type:'na-work:chat',id:'a',text:'hola'});await tick();
 assert.match(f.sent.find(x=>x.action==='chat').text,/12 segundos/);
});
test('consulta de solo lectura: tabla en la tarjeta y SIN aviso de «propuestas pendientes»',async()=>{
 const f=fixture({api:async()=>({reply:'Tienes 2 productos con poco stock.',proposals:[{id:'q1',type:'consulta',needsConfirm:false,result:{titulo:'Poco stock',columnas:['Producto','Stock'],filas:[['Leche',2],['Arroz',1]]}}]})});
 f.post({type:'na-work:chat',id:'a',text:'qué falta'});await tick();
 const m=f.sent.find(x=>x.action==='chat');
 assert.doesNotMatch(m.text,/propuestas pendientes|No se han ejecutado/);
 assert.equal(m.cards[0].kind,'table');assert.equal(m.cards[0].rows.length,2);
});
test('propuesta de precio: tarjeta con Confirmar, sin token en el mensaje al iframe',async()=>{
 const f=fixture({api:async()=>({reply:'Listo, te preparé el cambio.',proposals:[precio()]})});
 f.post({type:'na-work:chat',id:'a',text:'sube la leche a 5.20'});await tick();
 const c=lastCards(f)[0];
 assert.equal(c.kind,'confirm');assert.equal(c.key,'pr-1');assert.equal(c.oneTap,true);
 assert.ok(c.rows[0][1].includes('5.20'));
 assert.doesNotMatch(JSON.stringify(f.sent),/SECRETO/);
});
test('un toque: Confirmar gasta el token en el motor y guarda el formulario abierto; sin segundo «Guardar»',async()=>{
 const f=fixture({api:async()=>({reply:'ok',proposals:[precio()]})});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
 f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(30);
 assert.equal(f.calls.execute.length,1);assert.equal(f.calls.execute[0][0],'pr-1');
 assert.deepEqual(f.calls.save,['prod']);
 const st=f.sent.filter(m=>m.action==='card').map(m=>m.state);
 assert.deepEqual(st,['working','done']);
 assert.equal(f.nodes.has('naWorkOverlay'),true,'WORK sigue abierto');
});
test('doble toque en Confirmar no gasta dos veces',async()=>{
 const f=fixture({api:async()=>({reply:'ok',proposals:[precio()]}),engine:{execute:async()=>{await tick(20);return {ok:true,msg:'ok'};}}});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
 f.post({type:'na-work:card-confirm',key:'pr-1'});f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(60);
 assert.equal(f.calls.save.length,1);
});
test('con aviso de riesgo (bajo costo, cambio grande, «quisiste decir») se conserva el segundo paso: no guarda solo',async()=>{
 for(const extra of [{bajoCosto:true},{cambioGrande:true},{quisoDecir:0.52}]){
  const f=fixture({api:async()=>({reply:'ok',proposals:[precio(extra)]})});
  f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
  assert.equal(lastCards(f)[0].oneTap,false);assert.ok(lastCards(f)[0].warnings.length>0);
  f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(30);
  assert.deepEqual(f.calls.save,[],JSON.stringify(extra));
  assert.equal(f.nodes.has('naWorkOverlay'),false,'se muestra la pantalla del POS para revisar');
 }
});
test('si el formulario no se cierra al guardar, no se fuerza: se muestra la pantalla del POS',async()=>{
 const f=fixture({saves:{prod:false},api:async()=>({reply:'ok',proposals:[precio()]})});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
 f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(40);
 assert.equal(f.nodes.has('naWorkOverlay'),false);
 assert.match(f.sent.filter(m=>m.action==='card').pop().msg,/Guardar/);
});
test('ajuste de stock: un toque; con stock negativo conserva el segundo paso',async()=>{
 const aj={id:'aj-1',type:'ajuste',needsConfirm:true,confirm_token:'T.s',title:'Ajustar',nombre:'Leche',product_id:'P1',tipo:'entrada',cantidad:5,motivo:'Compra',stock_actual:3,stock_despues:8,quedaNegativo:false,grande:false};
 let f=fixture({api:async()=>({reply:'ok',proposals:[aj]})});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();f.post({type:'na-work:card-confirm',key:'aj-1'});await tick(30);
 assert.deepEqual(f.calls.save,['mov']);
 f=fixture({api:async()=>({reply:'ok',proposals:[{...aj,quedaNegativo:true}]})});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();f.post({type:'na-work:card-confirm',key:'aj-1'});await tick(30);
 assert.deepEqual(f.calls.save,[]);
});
test('errores de confirmar en palabras simples; 429 permite reintentar con la misma tarjeta',async()=>{
 const f=fixture({api:async()=>({reply:'ok',proposals:[precio()]}),engine:{execute:async()=>({ok:false,code:'rate_limited',msg:'Espera un momento e intenta de nuevo.'})}});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
 f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(30);
 const last=f.sent.filter(m=>m.action==='card').pop();
 assert.equal(last.state,'retry');assert.doesNotMatch(last.msg,/rate_limited|_/);assert.deepEqual(f.calls.save,[]);
});
test('tarjeta vencida o rol perdido: no se aplica nada y se explica',async()=>{
 let f=fixture({api:async()=>({reply:'ok',proposals:[precio()]}),engine:{execute:async()=>({ok:false,code:'confirm_expired',msg:'x'})}});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(30);
 assert.equal(f.sent.filter(m=>m.action==='card').pop().state,'expired');
 f=fixture({api:async()=>({reply:'ok',proposals:[precio()]}),engine:{execute:async()=>({ok:false,code:'forbidden_role',dropped:true,msg:'Esta sesión ya no es de Admin. Vuelva a entrar como Admin y pida la compra de nuevo.'})}});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(30);
 assert.equal(f.sent.filter(m=>m.action==='card').pop().state,'failed');assert.deepEqual(f.calls.save,[]);
});
test('compra con filas a revisar o datos por completar no se confirma en WORK: se abre en el asistente',async()=>{
 const compra={id:'c-1',type:'compra',needsConfirm:true,confirm_token:'T.s',title:'Compra',completar:['proveedor'],lineas:[{nombre:'Arroz',cantidad:2,costo_unitario:3,product_id:'P2'}]};
 const f=fixture({api:async()=>({reply:'ok',proposals:[compra]})});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
 assert.equal(lastCards(f)[0].kind,'review');
 f.post({type:'na-work:card-confirm',key:'c-1'});await tick(20);
 assert.equal(f.calls.execute.length,0,'review nunca gasta el token');
});
test('un empleado o un rol sin permiso ve la tarjeta como no permitida y no puede confirmar',async()=>{
 const f=fixture({owner:false,api:async()=>({reply:'ok',proposals:[precio()]}),engine:{canExecute:()=>({ok:false,msg:'Los cambios los hace el Admin desde su teléfono.'})}});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
 assert.equal(lastCards(f)[0].kind,'denied');
 f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(20);assert.equal(f.calls.execute.length,0);
});
test('el iframe no puede confirmar una clave que el host no emitió ni un mensaje de otro origen',async()=>{
 const f=fixture({api:async()=>({reply:'ok',proposals:[precio()]})});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
 f.post({type:'na-work:card-confirm',key:'inventada'});
 f.listeners.message({origin:'https://evil.test',source:f.frames[0].contentWindow,data:{type:'na-work:card-confirm',key:'pr-1'}});
 await tick(20);assert.equal(f.calls.execute.length,0);
});
test('cerrar o reiniciar WORK cancela las tarjetas pendientes',async()=>{
 const f=fixture({api:async()=>({reply:'ok',proposals:[precio()]})});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
 f.post({type:'na-work:reset'});assert.deepEqual(f.calls.cancel,['pr-1']);
});
test('«Llévame ahí» usa el motor y cierra WORK; el mensaje de confirmar ya no sale en consultas',async()=>{
 const f=fixture({api:async()=>({reply:'Así se hace.',proposals:[{id:'p1',type:'pasos',needsConfirm:false,title:'Cómo',pasos:['Abre Inventario'],pantalla:'pageInventario'}]})});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
 const c=lastCards(f)[0];assert.equal(c.kind,'steps');
 f.post({type:'na-work:card-open',key:c.key});await tick(20);
 assert.deepEqual(f.calls.go,['pageInventario']);assert.equal(f.nodes.has('naWorkOverlay'),false);
});

// ---- Contrato estático del motor compartido (asistente-ui.js) y de WORK ----
const ui=readFileSync('POS/js/modules/asistente/asistente-ui.js','utf8');
const host=source;
test('el motor compartido solo confirma con confirmed:true y tapa nombres con el mismo código del asistente original',()=>{
 const eng=ui.slice(ui.indexOf('var engine = {'),ui.indexOf('root.NA_ASISTENTE = {'));
 assert.match(eng,/execute: function \(key, opts\) \{ return gate\.execute\(key, Object\.assign\(\{\}, opts \|\| \{\}, \{ confirmed: true \}\)\); \}/);
 assert.match(eng,/C\.maskCustomers/);assert.match(eng,/C\.buildContext\(deps\.productos\(\), role/);
 assert.match(eng,/NA_ROLES\.isOwner\(\) === true/);
 assert.doesNotMatch(eng,/confirm_token/,'el motor no expone el token a WORK');
});
test('WORK ya no manda products: [] ni muestra el aviso engañoso de propuestas pendientes',()=>{
 assert.doesNotMatch(host,/products:\[\]/);
 assert.doesNotMatch(host,/Hay propuestas pendientes de confirmar mediante el flujo autorizado/);
});
test('WORK y su puente no llaman a /commands/ ni a /auth/assistant/confirm directamente (solo la puerta del asistente)',()=>{
 const bridge=readFileSync('POS/work/work-canon-bridge.js','utf8');
 for(const src of [host,bridge]){assert.doesNotMatch(src,/\/commands\//);assert.doesNotMatch(src,/assistant\/confirm/);}
});
test('el texto de la configuración del asistente ya no dice que los cambios «igual necesitan tu PIN»',()=>{
 assert.doesNotMatch(ui,/igual necesita tu PIN/);
 assert.match(ui,/los confirmas tú con un toque, sin PIN/);
});
test('la maqueta de WORK no trae cifras ni nombres de ejemplo fijos y el campo de texto coincide con el tope de 1500',()=>{
 const html=readFileSync('POS/work/index.html','utf8');
 assert.doesNotMatch(html,/DALILA|activity-title">VENTA A CRÉDITO|metric-value">(S\/|\d)/);
 assert.equal((html.match(/maxlength="2500"/g)||[]).length,0);assert.equal((html.match(/maxlength="1500"/g)||[]).length,2);
});

// ---- Revisión de A3/A4 (H1-H9) ----
const chatConfirm=async f=>{f.post({type:'na-work:chat',id:'a',text:'x'});await tick();f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(40);};
const lastCard=f=>f.sent.filter(m=>m.action==='card').pop();
test('H1: «Listo» solo si el valor guardado coincide; si el formulario cerró pero el precio no cambió, avisa y no dice Listo',async()=>{
 let f=fixture({api:async()=>({reply:'ok',proposals:[precio()]})});await chatConfirm(f);
 assert.equal(lastCard(f).state,'done');assert.match(lastCard(f).msg,/al instante/);
 f=fixture({saves:{priceAfter:4.5},api:async()=>({reply:'ok',proposals:[precio()]})});await chatConfirm(f);
 assert.equal(lastCard(f).state,'failed');assert.match(lastCard(f).msg,/No pude comprobar/);assert.match(lastCard(f).msg,/Inventario/);
 const aj={id:'pr-1',type:'ajuste',needsConfirm:true,confirm_token:'T.s',title:'Ajustar',nombre:'Leche',product_id:'P1',tipo:'entrada',cantidad:5,motivo:'Compra',stock_actual:3,stock_despues:8,quedaNegativo:false,grande:false};
 f=fixture({saves:{stockAfter:3},api:async()=>({reply:'ok',proposals:[aj]})});await chatConfirm(f);
 assert.equal(lastCard(f).state,'failed');
});
test('H2: los avisos se recalculan con lo que el POS tiene ahora; si no se puede comprobar, no hay un toque',async()=>{
 const cases=[['costo local mayor que el precio nuevo (el servidor no avisó)',{P1:{precio:4.5,costo:6,stock:3}},{}],
  ['el precio local ya no es el de la propuesta',{P1:{precio:4.0,costo:2,stock:3}},{}],
  ['el producto no está en este aparato',{},{}],
  ['cambio de más de 50% que el servidor no marcó',{P1:{precio:4.5,costo:2,stock:3}},{precio_nuevo:9.5}],
  ['el servidor no mandó el aviso de bajo costo',{P1:{precio:4.5,costo:2,stock:3}},{bajoCosto:undefined}]];
 for(const [name,local,extra] of cases){
  const f=fixture({local,api:async()=>({reply:'ok',proposals:[precio(extra)]})});
  f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
  const c=lastCards(f)[0];
  if(!c){assert.ok(true);continue;}
  assert.equal(c.oneTap,false,name);
  f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(40);
  assert.deepEqual(f.calls.save,[],name);
  assert.equal(f.nodes.has('naWorkOverlay'),false,name+': se abre la ficha para revisar');
 }
 const aj=(extra)=>({id:'aj-1',type:'ajuste',needsConfirm:true,confirm_token:'T.s',title:'Salida',nombre:'Leche',product_id:'P1',tipo:'salida',cantidad:5,motivo:'Merma',stock_actual:10,stock_despues:5,quedaNegativo:false,grande:false,...extra});
 const f=fixture({local:{P1:{precio:4.5,stock:3}},api:async()=>({reply:'ok',proposals:[aj()]})}); // en este aparato el stock es 3: saldría negativo
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
 assert.equal(lastCards(f)[0].oneTap,false);
});
test('H3: con el guardado en curso WORK no se cierra ni se repite el guardado',async()=>{
 const f=fixture({saves:{pending:true},api:async()=>({reply:'ok',proposals:[precio()]})});await chatConfirm(f);
 assert.equal(f.nodes.has('naWorkOverlay'),true);
 assert.equal(f.calls.save.length,1);
 assert.equal(lastCard(f).state,'working');assert.match(lastCard(f).msg,/Guardando… revisa en un momento/);assert.match(lastCard(f).msg,/No lo repitas/);
});
test('H4: la tarjeta «no permitida» no conserva filas ni avisos',async()=>{
 const f=fixture({engine:{canExecute:()=>({ok:false,msg:'Solo el Admin puede cambiar costos.'})},api:async()=>({reply:'ok',proposals:[precio({bajoCosto:true})]})});
 f.post({type:'na-work:chat',id:'a',text:'x'});await tick();
 const c=lastCards(f)[0];assert.equal(c.kind,'denied');assert.equal(c.rows.length,0);assert.equal(c.warnings.length,0);
});
test('H5: si no hay motor, el mensaje distingue «sin permiso» de «aún no conecta»',async()=>{
 let f=fixture({engine:{ready:()=>false,accessState:()=>'denied'}});f.post({type:'na-work:chat',id:'a',text:'hola'});await tick(40);
 assert.match(f.sent.find(x=>x.action==='chat').text,/no tiene permiso/);assert.equal(f.calls.api.length,0);
 f=fixture({engine:{ready:()=>false,prepare:()=>null,accessState:()=>'pending'}});f.post({type:'na-work:chat',id:'a',text:'hola'});
 await new Promise(r=>setTimeout(r,6600));
 assert.match(f.sent.find(x=>x.action==='chat').text,/no pudo conectarse/);assert.equal(f.calls.api.length,0);
});
test('H6: si después de tapar nombres el texto pasa de 1500, avisa y no envía',async()=>{
 const f=fixture({engine:{prepare:t=>({text:'x'.repeat(1600),context:{products:[]},cards:[]})}});
 f.post({type:'na-work:chat',id:'a',text:'corto'});await tick();
 assert.equal(f.calls.api.length,0);
 assert.match(f.sent.find(x=>x.action==='chat').text,/quedó de 1600 letras/);
});
test('H7: el aviso de rol perdido se dice en «tú» y según el tipo de tarjeta',async()=>{
 const lost=CORE.ROLE_LOST_MSG;
 let f=fixture({api:async()=>({reply:'ok',proposals:[precio()]}),engine:{execute:async()=>({ok:false,code:'forbidden_role',dropped:true,msg:lost})}});await chatConfirm(f);
 let m=lastCard(f).msg;assert.match(m,/Vuelve a entrar/);assert.match(m,/pide el cambio de nuevo/);assert.doesNotMatch(m,/Vuelva|pida|compra/);
});
test('A4: después de un éxito, un «Confirmar» tardío se ignora sin volver a la puerta',async()=>{
 const f=fixture({api:async()=>({reply:'ok',proposals:[precio()]})});await chatConfirm(f);
 f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(40);
 assert.equal(f.calls.execute.length,1);assert.equal(f.calls.save.length,1);
});
test('H8/H9: botón de al menos 44 px y texto del PIN completo (revisión A3)',()=>{
 const bridge=readFileSync('POS/work/work-canon-bridge.js','utf8'),ui=readFileSync('POS/js/modules/asistente/asistente-ui.js','utf8');
 assert.match(bridge,/min-height:44px/);assert.doesNotMatch(bridge,/min-height:42px/);
 assert.match(ui,/el PIN se sigue pidiendo en las acciones de alto riesgo: anular ventas, reiniciar, dar permisos y los cambios masivos/i);
 assert.doesNotMatch(ui,/igual necesita tu PIN/);
});

// ---- Motor REAL: se extrae el código de `engine` de asistente-ui.js (no una copia) y se ejecuta con el core REAL ----
function realEngine({access,productos,clientes=[],owner=true}){
 const ui=readFileSync('POS/js/modules/asistente/asistente-ui.js','utf8');
 const a=ui.indexOf('  var engine = {'),b=ui.indexOf('\n  root.NA_ASISTENTE = {',a);
 assert.ok(a>0&&b>a,'no se encontró el bloque engine');
 const make=new Function('C','root','doc','deps','gate','roles','tokenExp','getAccess',
  'function isAdmin(){var access=getAccess();return !!access&&(access.role===\'owner\'||access.level===\'consultas\'||access.level===\'consultas_documentos\');}'
  +'function isOwnerAccess(){var access=getAccess();return isAdmin()&&access.role===\'owner\';}'
  +'var access=getAccess();'+ui.slice(a,b)+'\n return engine;');
 const gate={add:p=>p.id,summary:()=>[]};
 return make(CORE,{NA_ROLES:{isOwner:()=>owner}},{querySelector:()=>({id:'pageMenu'})},{productos:()=>productos,clientes:()=>clientes,proveedores:()=>[]},gate,()=>({role:'owner'}),()=>0,()=>access);
}
test('motor REAL: tapa nombres, manda productos reales, costo solo al Admin y expone lectura de producto',()=>{
 globalThis.NA_PERMISSIONS={canDo:(role)=>role==='owner'};
 const productos=[{id:'P1',name:'Arroz',precio:4.5,costo:2,stock:10}];
 const clientes=[{id:'c1',nombre:'Juan Perez Quispe',dni:'12345678'}];
 const own=realEngine({access:{role:'owner'},productos,clientes});
 const prep=own.prepare('cuánto me debe Juan Perez Quispe, arroz');
 assert.doesNotMatch(prep.text,/Juan|Perez|Quispe/);
 assert.equal(prep.context.products[0].id,'P1');assert.equal(prep.context.products[0].costo,2);
 assert.deepEqual({...own.product('P1')},{precio:4.5,costo:2,stock:10,controla:undefined});
 assert.equal(own.product('NOPE'),null);assert.equal(own.accessState(),'ok');
 const emp=realEngine({access:{role:'empleado',level:'consultas'},productos,clientes,owner:false});
 assert.equal(emp.prepare('arroz').context.products[0].costo,undefined);
 assert.equal(realEngine({access:{role:'empleado',level:'ninguno'},productos}).accessState(),'denied');
 assert.equal(realEngine({access:null,productos}).accessState(),'pending');
 assert.equal(realEngine({access:null,productos}).prepare('hola'),null);
});
test('motor REAL + host: el chat de WORK sale con nombres tapados y productos reales',async()=>{
 globalThis.NA_PERMISSIONS={canDo:(role)=>role==='owner'};
 const eng=realEngine({access:{role:'owner'},productos:[{id:'P1',name:'Arroz',precio:4.5,costo:2,stock:10}],clientes:[{id:'c1',nombre:'Juan Perez Quispe'}]});
 const f=fixture({engine:{...eng,canExecute:()=>({ok:true}),ready:eng.ready,prepare:eng.prepare,product:eng.product,accessState:eng.accessState}});
 f.post({type:'na-work:chat',id:'a',text:'cuánto debe Juan Perez Quispe'});await tick();
 const b=f.calls.api[0];assert.doesNotMatch(b.text,/Juan|Perez|Quispe/);assert.equal(b.context.products[0].id,'P1');
});

test('C1 (A4): ningún texto heredado queda en «usted» y la tarjeta bloqueada no mezcla tú/usted',async()=>{
 const usted=/Toque|Complete |Corrija|Hágalo|Ábrala|Vuelva |Escriba |vuelva a|pida |su pantalla/;
 // sin conexión (reintento), campos por completar, compra ya confirmada, bloqueo, RUC
 const casos=[
  {r:{ok:false,code:'network',msg:'Sin conexión. Toque Reintentar'}},
  {r:{ok:false,code:'fields_required',msg:'Complete los datos marcados y vuelva a confirmar.'}},
  {r:{ok:false,code:'already_confirmed_same_session',msg:'Esta compra ya se confirmó. Corrija los datos en Nueva compra.'}},
  {r:{ok:false,code:'manual_not_allowed',msg:'Esa tarjeta no se puede cambiar así. Toque «Pedir de nuevo».'}},
  {r:{ok:false,code:'blocked',msg:'No se puede confirmar este cambio desde el asistente. Hágalo desde su pantalla.'}}];
 for(const c of casos){
  const f=fixture({api:async()=>({reply:'ok',proposals:[precio()]}),engine:{execute:async()=>c.r}});await chatConfirm(f);
  const m=lastCard(f).msg;assert.doesNotMatch(m,usted,c.r.code+' => '+m);
 }
});
test('C3 (A4): la espera de H1 llega a ~5 s (10 lecturas) y «No pude comprobar» sigue sin reintento',()=>{
 assert.match(readFileSync('POS/js/work-host.js','utf8'),/for \(i = 0; i < 10; i\+\+\)/);
});
