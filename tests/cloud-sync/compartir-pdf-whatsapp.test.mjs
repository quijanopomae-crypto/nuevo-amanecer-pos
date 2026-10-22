import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SHARE='POS/js/modules/ticket/share-receipt.js',MOD='POS/js/modules/ticket/compartir-pdf-whatsapp.js',PERM='POS/js/config/pos-permissions.js';
function load(extra={}){const ctx=vm.createContext({console,Blob,TextEncoder,Uint8Array,atob,...extra});vm.runInContext(readFileSync(SHARE,'utf8'),ctx);vm.runInContext(readFileSync(MOD,'utf8'),ctx);return ctx;}
const perms=locked=>({featureLocked:id=>id==='compartir-pdf-whatsapp'?locked:true});

test('el candado compartir-pdf-whatsapp está abierto en pos-permissions.js',()=>{
  const ctx=vm.createContext({});vm.runInContext(readFileSync(PERM,'utf8'),ctx);
  assert.equal(ctx.NA_PERMISSIONS.FEATURE_LOCKS['compartir-pdf-whatsapp'],false);
  assert.equal(ctx.NA_PERMISSIONS.featureLocked('compartir-pdf-whatsapp'),false);
});
test('falla cerrado: sin NA_PERMISSIONS, con candado o si featureLocked lanza error',()=>{
  assert.equal(load().NA_PDF_WHATSAPP.available(),false);
  assert.equal(load({NA_PERMISSIONS:{}}).NA_PDF_WHATSAPP.available(),false);
  assert.equal(load({NA_PERMISSIONS:perms(true)}).NA_PDF_WHATSAPP.available(),false);
  assert.equal(load({NA_PERMISSIONS:{featureLocked(){throw new Error('x');}}}).NA_PDF_WHATSAPP.available(),false);
  assert.equal(load({NA_PERMISSIONS:{featureLocked:()=>'false'}}).NA_PDF_WHATSAPP.available(),false);
  assert.equal(load({NA_PERMISSIONS:perms(false)}).NA_PDF_WHATSAPP.available(),false,'sin rol: cerrado');
  assert.equal(load({NA_PERMISSIONS:perms(false),NA_ROLES:{isOwner:()=>true}}).NA_PDF_WHATSAPP.available(),true);
});
test('con candado send() no hace nada',async()=>{
  assert.equal(await load({NA_PERMISSIONS:perms(true)}).NA_PDF_WHATSAPP.send(),'locked');
});
test('mensaje corto en español, sin saludo con cliente genérico',()=>{
  const a=load().NA_PDF_WHATSAPP;
  assert.equal(a.chatText({customerName:'María Pérez'}),'Hola María Pérez, te envío tu comprobante en PDF.');
  for(const n of ['Sin cliente','Consumidor final','','Varios'])assert.equal(a.chatText({customerName:n}),'Hola, te envío tu comprobante en PDF.');
});
test('respaldo: wa.me al número, wa.me sin número y WhatsApp Business en Android',()=>{
  const a=load().NA_PDF_WHATSAPP,r={customerName:'Luis'};
  const u=new URL(a.chatUrl('987 654 321',r));assert.equal(u.hostname,'wa.me');assert.equal(u.pathname,'/51987654321');assert.equal(u.searchParams.get('text'),'Hola Luis, te envío tu comprobante en PDF.');
  const v=new URL(a.chatUrl('',r));assert.equal(v.pathname,'/');assert.match(v.searchParams.get('text'),/PDF/);
  const b=a.chatUrl('987654321',r,'business','Mozilla/5.0 (Linux; Android 14)');assert.match(b,/^intent:\/\/send\?phone=51987654321/);assert.match(b,/package=com\.whatsapp\.w4b/);
  const w=a.chatUrl('987654321',r,'business','Mozilla/5.0 (iPhone)');assert.match(w,/^https:\/\/wa\.me\/51987654321/);
});
test('canShareFile exige share y canShare({files}) y no revienta',()=>{
  assert.equal(load({navigator:{}}).NA_PDF_WHATSAPP.canShareFile({}),false);
  assert.equal(load({navigator:{share(){},canShare:()=>false}}).NA_PDF_WHATSAPP.canShareFile({}),false);
  assert.equal(load({navigator:{share(){},canShare(){throw new Error('x');}}}).NA_PDF_WHATSAPP.canShareFile({}),false);
  let seen;assert.equal(load({navigator:{share(){},canShare:d=>{seen=d;return true;}}}).NA_PDF_WHATSAPP.canShareFile({name:'a.pdf'}),true);assert.equal(seen.files[0].name,'a.pdf');
});
test('el módulo no usa innerHTML ni CDN y no lee costos ni proveedores',()=>{
  const src=readFileSync(MOD,'utf8');
  assert.doesNotMatch(src,/innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(src,/https?:\/\/(?!wa\.me)/);
  assert.doesNotMatch(src,/costo|proveedor|cost\b|supplier/i);
});
test('index.html y sw.js cargan el módulo después de share-receipt-ui.js',()=>{
  const html=readFileSync('POS/index.html','utf8'),sw=readFileSync('POS/sw.js','utf8');
  assert.ok(html.indexOf('js/modules/ticket/compartir-pdf-whatsapp.js')>html.indexOf('js/modules/ticket/share-receipt-ui.js'));
  assert.match(html,/css\/compartir-pdf-whatsapp\.css/);
  assert.match(sw,/\.\/js\/modules\/ticket\/compartir-pdf-whatsapp\.js/);assert.match(sw,/\.\/css\/compartir-pdf-whatsapp\.css/);
});
test('currentReceipt devuelve null sin diálogo abierto',()=>{assert.equal(load().NAReceiptShare.currentReceipt(),null);});

function fakeDom(withDialog){
  const calls=[];let dialog=withDialog?{id:'naReceiptShare',classList:{contains:()=>false}}:null;const body={tag:'body'};
  class MO{constructor(cb){this.cb=cb;this.on=false;MO.all.push(this);}observe(t,o){this.on=true;this.t=t;calls.push({t,o});}disconnect(){this.on=false;}}
  MO.all=[];
  const document={readyState:'complete',body,documentElement:body,getElementById:id=>id==='naReceiptShare'?dialog:null,addEventListener(){}};
  return {calls,MO,document,setDialog(d){dialog=d;},get dialog(){return dialog;}};
}
test('observa solo el diálogo si ya existe, sin subtree sobre body',()=>{
  const f=fakeDom(true);load({document:f.document,MutationObserver:f.MO});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].t,f.dialog);
  assert.deepEqual({...f.calls[0].o,attributeFilter:[...f.calls[0].o.attributeFilter]},{attributes:true,attributeFilter:['class']});
  assert.ok(!f.calls.some(c=>c.o.subtree));
});
test('sin diálogo espera en body solo con childList y luego cambia al diálogo',()=>{
  const f=fakeDom(false);load({document:f.document,MutationObserver:f.MO});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].t,f.document.body);
  assert.deepEqual({...f.calls[0].o},{childList:true});
  const wait=f.MO.all[0];wait.cb([]);assert.equal(wait.on,true,'sigue esperando sin diálogo');
  f.setDialog({id:'naReceiptShare',classList:{contains:()=>false}});wait.cb([]);
  assert.equal(wait.on,false,'desconecta el observador de body');
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].t,f.dialog);assert.ok(!f.calls.some(c=>c.o.subtree));
});

test('empleado: solo con NA_EMPLOYEE_PERMS.may(compartir-pdf-whatsapp) === true; el candado siempre gana',()=>{
  const emp=(may,locked=false)=>load({NA_PERMISSIONS:perms(locked),NA_ROLES:{isOwner:()=>false},NA_EMPLOYEE_PERMS:{may:id=>id==='compartir-pdf-whatsapp'&&may}}).NA_PDF_WHATSAPP.available();
  assert.equal(emp(true),true);
  assert.equal(emp(false),false);
  assert.equal(emp(true,true),false,'candado cerrado');
  assert.equal(load({NA_PERMISSIONS:perms(false),NA_ROLES:{isOwner:()=>false},NA_EMPLOYEE_PERMS:{may(){throw new Error('x');}}}).NA_PDF_WHATSAPP.available(),false);
  assert.equal(load({NA_PERMISSIONS:perms(false),NA_ROLES:{isOwner:()=>false},NA_EMPLOYEE_PERMS:{may:()=>'true'}}).NA_PDF_WHATSAPP.available(),false);
  assert.match(readFileSync(MOD,'utf8'),/e\.may\(LOCK\)===true/);
});
