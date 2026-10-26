// WORK: tabla honesta (A4). El tope de 30 filas × 8 columnas ya no recorta en silencio: aviso visible y accesible, contenedor con scroll
// horizontal propio, caption y scope="col". Solo cliente: no pide ni cambia datos del servidor. Estructura DOM simulada (sin navegador).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const hostSrc=readFileSync('POS/js/work-host.js','utf8');
const bridgeSrc=readFileSync('POS/work/work-canon-bridge.js','utf8');
const tick=(ms=15)=>new Promise(r=>setTimeout(r,ms));

// ---------- Host: readOnlyView vía el mensaje real «na-work:chat» ----------
function hostFixture(api){
 const nodes=new Map(),listeners={},sent=[],frames=[];
 const home={classList:{contains:()=>true}};
 const body={classList:{add(){},remove(){}},appendChild(el){if(el.id)nodes.set(el.id,el);}};
 const create=(tag)=>{const e={setAttribute(){},appendChild(){},addEventListener(){},remove(){},contentWindow:{postMessage(m){sent.push(m);}}};if(tag==='iframe')frames.push(e);return e;};
 const root={document:{body,head:{appendChild(){}},readyState:'complete',createElement:create,getElementById:id=>id==='pageMenu'?home:nodes.get(id),querySelectorAll:()=>[]},
  location:{origin:'https://pos.test',search:'',hostname:'pos.test'},NA_HOSTED_CONFIG:{environment:'production'},
  NA_ROLES:{confirmed:true,role:'owner',isOwner:()=>true,api},addEventListener:(e,fn)=>listeners[e]=fn,setInterval(){},setTimeout:fn=>setTimeout(fn,1),MutationObserver:class{observe(){}},
  NA_ASISTENTE:{engine:{ready:()=>true,owner:()=>true,prepare:t=>({text:t,context:{screen:'pageMenu',products:[]},cards:[]}),canExecute:()=>({ok:true}),accessState:()=>'ok',forget(){},forgetAll(){}}}};
 vm.runInNewContext(hostSrc,{window:root,URLSearchParams,Array,Object,String,Error,JSON,Date,Promise,Number,isFinite,Math});
 const frameWin=frames[0].contentWindow;
 return {sent,post:data=>listeners.message({origin:'https://pos.test',source:frameWin,data})};
}
async function tabla(result){
 const f=hostFixture(async()=>({reply:'ok',proposals:[{id:'q1',type:'consulta',needsConfirm:false,result}]}));
 f.post({type:'na-work:chat',id:'a',text:'muéstrame'});await tick();
 return f.sent.find(x=>x.action==='chat').cards[0];
}
const filas=(n,c)=>Array.from({length:n},(_,i)=>Array.from({length:c},(_,j)=>'r'+i+'c'+j));
const cols=c=>Array.from({length:c},(_,j)=>'Col '+j);

test('más de 30 filas: se muestran 30 y el aviso dice «30 de N filas» (antes se recortaba en silencio)',async()=>{
 const v=await tabla({titulo:'Ventas',columnas:cols(3),filas:filas(45,3)});
 assert.equal(v.kind,'table');assert.equal(v.rows.length,30);assert.equal(v.totalRows,45);
 assert.match(v.trim,/^Mostrando 30 de 45 filas\./);assert.doesNotMatch(v.trim,/columnas/);
});
test('más de 8 columnas: se muestran 8 y el aviso dice «8 de M columnas»; filas y columnas juntas en una sola frase',async()=>{
 let v=await tabla({titulo:'Ancho',columnas:cols(11),filas:filas(5,11)});
 assert.equal(v.columns.length,8);assert.equal(v.rows[0].length,8);assert.equal(v.totalCols,11);
 assert.match(v.trim,/^Mostrando 8 de 11 columnas\./);assert.doesNotMatch(v.trim,/filas/);
 v=await tabla({titulo:'Grande',columnas:cols(10),filas:filas(31,10)});
 assert.match(v.trim,/^Mostrando 30 de 31 filas y 8 de 10 columnas\./);
});
test('columnas contadas también por la fila más ancha cuando faltan encabezados',async()=>{
 const v=await tabla({titulo:'Sin cabecera',filas:filas(2,9)});
 assert.equal(v.totalCols,9);assert.match(v.trim,/8 de 9 columnas/);
});
test('si todo cabe (30 filas y 8 columnas exactas o menos) NO sale ningún aviso y nada cambia',async()=>{
 for(const [r,c] of [[30,8],[2,2],[0,0]]){
  const v=await tabla({titulo:'T',columnas:cols(c),filas:filas(r,c)});
  assert.equal(v.trim,'');assert.equal(v.rows.length,r);assert.equal(v.totalRows,r);
 }
});
test('el recorte de datos del servidor (truncado) sigue avisando aparte y no se mezcla con el aviso del tope',async()=>{
 const v=await tabla({titulo:'T',columnas:cols(2),filas:filas(40,2),truncado:true});
 assert.equal(v.warnings.length,1);assert.match(v.warnings[0],/solo se leyó una parte de los datos/);assert.match(v.trim,/30 de 40 filas/);
});
test('el formato de los valores no cambia: enteros y textos tal cual, decimales a 2 (como antes); sin datos nuevos',async()=>{
 const v=await tabla({titulo:'T',columnas:['A','B','C'],filas:[['Leche',2,1.5],['Arroz','S/ 4.50',3]]});
 assert.deepEqual(v.rows,[['Leche','2','1.50'],['Arroz','S/ 4.50','3']]);
 assert.deepEqual(Object.keys(v).sort(),['columns','key','kind','note','rows','shownCols','shownRows','text','title','totalCols','totalRows','trim','warnings']);
});
test('una consulta con error sigue mostrando solo el texto (sin aviso de recorte)',async()=>{
 const v=await tabla({titulo:'T',error:true,texto:'No se pudo leer.'});
 assert.equal(v.rows.length,0);assert.equal(v.trim,'');assert.match(v.text,/No se pudo leer/);
});

// ---------- Alineado con na.result v1 (contrato-datos-A3.md): campos opcionales; sin ellos se calcula con las filas locales ----------
test('contrato v1: cobertura.filas_total mayor que las filas recibidas → «Mostrando N de M filas» con el total del servidor',async()=>{
 const v=await tabla({titulo:'Ventas',columnas:cols(2),filas:filas(30,2),total:null,contrato:{nombre:'na.result',v:1,cobertura:{completa:false,truncado:true,filas_total:842,filas_mostradas:30}}});
 assert.equal(v.totalRows,842);assert.equal(v.shownRows,30);assert.match(v.trim,/^Mostrando 30 de 842 filas\./);
 assert.equal(v.warnings.length,1,'cobertura.truncado también avisa de datos parciales');
});
test('contrato v1: con 12 filas y filas_total 12 NO hay aviso; paginacion.hay_mas sin total dice «hay más sin cargar»',async()=>{
 let v=await tabla({titulo:'T',columnas:cols(2),filas:filas(12,2),contrato:{cobertura:{completa:true,truncado:false,filas_total:12,filas_mostradas:12}}});
 assert.equal(v.trim,'');assert.equal(v.warnings.length,0);
 v=await tabla({titulo:'T',columnas:cols(2),filas:filas(12,2),contrato:{tabla:{paginacion:{pagina:1,tam:30,hay_mas:true}}}});
 assert.match(v.trim,/^Mostrando 12 filas \(hay más sin cargar\)\./);
});
test('contrato v1 mal formado o hostil se ignora y se calcula con las filas locales (sin NaN ni totales menores que lo recibido)',async()=>{
 for(const bad of [null,'x',5,[],{cobertura:'x'},{cobertura:{filas_total:'900'}},{cobertura:{filas_total:-3}},{cobertura:{filas_total:5}},{cobertura:{filas_total:1e12}},{cobertura:{filas_total:NaN}},{tabla:{paginacion:'x'}}]){
  const v=await tabla({titulo:'T',columnas:cols(2),filas:filas(40,2),contrato:bad});
  assert.equal(v.totalRows,40,JSON.stringify(bad));assert.match(v.trim,/^Mostrando 30 de 40 filas\./);
 }
});
test('contrato v1 no cambia el formato de dinero ni los valores: las celdas salen igual con y sin `contrato`',async()=>{
 const base={titulo:'T',columnas:['Detalle','S/'],filas:[['Ventas',10],['Ganancia',6.5],['Margen','60 %']]};
 const a=await tabla(base),b=await tabla({...base,contrato:{cobertura:{filas_total:3,filas_mostradas:3},moneda:{codigo:'PEN',escala:'soles',decimales:2}}});
 assert.deepEqual(a.rows,b.rows);assert.deepEqual(a.rows,[['Ventas','10'],['Ganancia','6.50'],['Margen','60 %']]);
});

// ---------- Puente: renderCard con un DOM mínimo simulado ----------
function el(tag){
 const e={tagName:String(tag).toUpperCase(),children:[],attrs:{},style:{},dataset:{},className:'',textContent:'',_l:{},tabIndex:undefined,disabled:false,hidden:false,scrollTop:0,
  setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k];},
  appendChild(c){this.children.push(c);return c;},append(...a){a.forEach(c=>this.children.push(c));},replaceChildren(...a){this.children=[...a];},remove(){},
  addEventListener(t,fn){(this._l[t]=this._l[t]||[]).push(fn);},removeEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},
  classList:{add(){},remove(){},contains:()=>false,toggle(){}}};
 Object.defineProperty(e,'childNodes',{get(){return e.children;}});
 return e;
}
function bridgeFixture(){
 const msgs=el('div'),listeners={},clicks=[],posted=[];
 const doc={createElement:el,querySelector:q=>q==='#chatMessages'?msgs:null,querySelectorAll:()=>[],addEventListener:(t,fn)=>{if(t==='click')clicks.push(fn);},
  head:el('head'),body:{...el('body'),classList:{add(){},remove(){}}}};
 const parent={location:{origin:'https://pos.test'},postMessage(m){posted.push(m);}};
 const win={document:doc,parent,location:{origin:'https://pos.test'},navigator:{onLine:true},addEventListener:(t,fn)=>{listeners[t]=fn;},setInterval(){return 1;},clearInterval(){}};
 vm.runInNewContext(bridgeSrc,{window:win,Date,Math,Array,Object,String,Number,Map,JSON,setInterval:()=>1,clearInterval(){}});
 // El puente solo pinta respuestas a una pregunta pendiente: se hace una pregunta real (toque en un chip) y se responde con la tarjeta.
 return {msgs,posted,card(v){
  const btn={textContent:'¿Qué vendí hoy?',querySelector:()=>null};
  const ev={target:{closest:sel=>sel==='.chips button'?btn:null},preventDefault(){},stopImmediatePropagation(){}};
  clicks.forEach(fn=>fn(ev));
  const q=posted.find(m=>m.type==='na-work:chat');assert.ok(q,'el puente mandó la pregunta al host');
  listeners.message({origin:'https://pos.test',source:parent,data:{type:'na-work:response',action:'chat',id:q.id,ok:true,text:'',cards:[v]}});}};
}
const walk=(n,fn)=>{fn(n);(n.children||[]).forEach(c=>walk(c,fn));};
const find=(n,pred)=>{const out=[];walk(n,x=>{if(pred(x))out.push(x);});return out;};
const cardOf=f=>find(f.msgs,x=>/\bna-card\b/.test(x.className))[0];
const view=(over={})=>({kind:'table',key:'ro-1',title:'Ventas por día',columns:cols(3),rows:filas(3,3),text:'',warnings:[],trim:'',note:'Datos leídos del servidor. No cambia nada.',...over});

test('puente: la tabla va dentro de un contenedor con scroll horizontal propio, con caption y encabezados scope="col"',()=>{
 const f=bridgeFixture();f.card(view());
 const c=cardOf(f);assert.ok(c,'la tarjeta se pintó');
 const wrap=find(c,x=>/\bna-tscroll\b/.test(x.className))[0];
 assert.ok(wrap,'hay contenedor .na-tscroll');assert.equal(wrap.tabIndex,0,'se puede enfocar con teclado para desplazarse');
 assert.equal(wrap.attrs.role,'region');assert.match(wrap.attrs['aria-label'],/Tabla: Ventas por día\. Se desliza a los lados\./);
 const table=wrap.children[0];assert.equal(table.tagName,'TABLE');
 assert.equal(table.children[0].tagName,'CAPTION');assert.equal(table.children[0].textContent,'Ventas por día');
 const ths=find(table,x=>x.tagName==='TH');assert.equal(ths.length,3);assert.ok(ths.every(t=>t.attrs.scope==='col'));
 assert.ok(find(table,x=>x.tagName==='THEAD').length===1&&find(table,x=>x.tagName==='TBODY').length===1);
 assert.equal(find(table,x=>x.tagName==='TD').length,9);
});
test('puente: aviso de recorte visible (role=status) ANTES de la tabla y repetido en el caption',()=>{
 const f=bridgeFixture();
 const trim='Mostrando 30 de 45 filas y 8 de 11 columnas. Pídeme una lista más corta (por ejemplo, un solo día o una categoría) para ver el resto.';
 f.card(view({columns:cols(8),rows:filas(30,8),trim}));
 const c=cardOf(f);
 const notice=find(c,x=>/\bna-trim\b/.test(x.className))[0];
 assert.ok(notice);assert.equal(notice.attrs.role,'status');assert.equal(notice.textContent,trim);
 const order=c.children.map(x=>x.className);assert.ok(order.findIndex(n=>/na-trim/.test(n))<order.findIndex(n=>/na-tscroll/.test(n)),'el aviso va antes de la tabla');
 const cap=find(c,x=>x.tagName==='CAPTION')[0];assert.match(cap.textContent,/Mostrando 30 de 45 filas y 8 de 11 columnas/);
});
test('puente: sin recorte no hay aviso; con 4 o más columnas la tabla fija un ancho mínimo para que el scroll aparezca (no ensancha la página)',()=>{
 let f=bridgeFixture();f.card(view());
 assert.equal(find(cardOf(f),x=>/\bna-trim\b/.test(x.className)).length,0);
 assert.equal(find(cardOf(f),x=>x.tagName==='TABLE')[0].style.minWidth,undefined,'3 columnas caben en 390 px: sin ancho mínimo');
 f=bridgeFixture();f.card(view({columns:cols(8),rows:filas(2,8)}));
 assert.equal(find(cardOf(f),x=>x.tagName==='TABLE')[0].style.minWidth,'640px');
});
test('puente: tabla vacía o solo texto no crea contenedor ni aviso; se ve «Sin datos.»',()=>{
 let f=bridgeFixture();f.card(view({rows:[],columns:[]}));
 assert.equal(find(cardOf(f),x=>/na-tscroll/.test(x.className)).length,0);
 assert.ok(find(cardOf(f),x=>x.textContent==='Sin datos.').length===1);
});
test('puente: el contenido va siempre como texto (textContent), nunca como HTML',()=>{
 const f=bridgeFixture();f.card(view({title:'<img src=x onerror=alert(1)>',columns:['<b>A</b>','B','C'],rows:[['<script>x</script>','2','3']]}));
 const td=find(cardOf(f),x=>x.tagName==='TD')[0];assert.equal(td.textContent,'<script>x</script>');
 assert.ok(!('innerHTML' in td)||td.innerHTML===undefined);
});

// ---------- Reglas de código (estáticas) ----------
test('CSS del puente: scroll horizontal propio y caption oculto solo visualmente; sin colores nuevos (respeta claro/oscuro actual)',()=>{
 assert.match(bridgeSrc,/\.na-card \.na-tscroll\{overflow-x:auto;max-width:100%;min-width:0;/);
 assert.match(bridgeSrc,/\.na-card caption\.na-cap\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\);white-space:nowrap\}/);
 assert.doesNotMatch(bridgeSrc,/prefers-color-scheme|na_v9_appearance|data-theme/);
});
test('sin innerHTML / insertAdjacentHTML / eval en el código tocado (host y puente)',()=>{
 for(const s of [hostSrc,bridgeSrc])assert.doesNotMatch(s,/innerHTML|insertAdjacentHTML|outerHTML|\beval\(|new Function/);
});
test('tope intacto: 30 filas y 8 columnas en el host; el dinero se sigue formateando como antes (toFixed(2) solo a decimales)',()=>{
 assert.match(hostSrc,/r\.filas\.slice\(0, 30\)/);assert.match(hostSrc,/\.slice\(0, 8\)/);
 assert.match(hostSrc,/typeof c === 'number' && !Number\.isInteger\(c\) \? c\.toFixed\(2\) : str\(c, 120\)/);
});
