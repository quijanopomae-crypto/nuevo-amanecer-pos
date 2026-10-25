// The "Ventas en revisión" block in Caja (owner condition 2, 2026-10-11) must
// survive every Caja redraw: legacy cajRender wipes #cajContent, and the block
// is the only place a quarantined sale stays visible once the cash is closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activeCanon,device} from './canon-browser-harness.mjs';
import {tursoSqlite} from './turso-sqlite-protocol.mjs';
const bridge=readFileSync('POS/js/sync/canonical-cash-bridge.js','utf8');
const scripts=['canonical-sale-intent','canonical-sale-outbox'].map(n=>[n,readFileSync('POS/js/sync/'+n+'.js','utf8')]);

function miniDom(){
 const detached=new Map();
 const node=(tag,id='')=>({tagName:tag,id,children:[],parentNode:null,style:{},dataset:{},textContent:'',value:'',className:'',type:'',disabled:false,attrs:{},
  classList:{add(){},remove(){},contains(){return false;},toggle(){}},focus(){},removeAttribute(){},replaceChildren(){this.children=[];},querySelector(){return null;},
  setAttribute(k,v){this.attrs[k]=String(v);},
  get firstChild(){return this.children[0]||null;},
  appendChild(n){n.parentNode=this;this.children.push(n);return n;},
  insertBefore(n,ref){n.parentNode=this;const i=this.children.indexOf(ref);i<0?this.children.push(n):this.children.splice(i,0,n);return n;},
  removeChild(n){const i=this.children.indexOf(n);if(i>=0)this.children.splice(i,1);n.parentNode=null;return n;}});
 const caja=node('div','cajContent');
 const find=(n,id)=>{if(n.id===id)return n;for(const c of n.children){const hit=find(c,id);if(hit)return hit;}return null;};
 const text=n=>(n.textContent||'')+n.children.map(text).join(' ');
 const document={getElementById(id){const hit=find(caja,id);if(hit)return hit;if(!detached.has(id))detached.set(id,node('div',id));return detached.get(id);},
  querySelector(){return null;},querySelectorAll(){return [];},createElement:tag=>node(tag),addEventListener(){}};
 // Mirrors the legacy redraw: replaces everything inside #cajContent.
 const cajRender=function(){caja.children.forEach(c=>{c.parentNode=null;});caja.children=[node('div','cajSummary')];};
 return {document,caja,cajRender,text};
}

test('quarantined sale stays visible in Caja across repeated redraws, with verify/retry and no-recharge warning',async t=>{
 const f=await activeCanon(t,{migrations:['0014_canonical_live_products.sql','0015_canonical_inventory_adjust.sql','0016_canonical_generic_sale_lines.sql']});
 f.env.DB=tursoSqlite(f.database).adapter;
 const dom=miniDom();
 const d=await device(f,{token:'rp',deviceId:'rp',scripts:[...scripts,['bridge',bridge]],
  globals:{document:dom.document,cajRender:dom.cajRender,_naAuthorize(){return true;},confirm(){return true;}},
  onFetch:async url=>{if(url.endsWith('/commands/sale.create'))return Response.json({error:'product_not_found'},{status:409});}});
 await d.api.openCash({session_id:'rp-session',opening_cents:107250});
 const outbox=d.context.NuevoAmanecerCanonicalSaleOutbox;
 await outbox.enqueue(d.context.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-085',payment_method:'efectivo',items:[{product_id:'00000',quantity:1,precio:2}]}));
 await outbox.sync();
 assert.equal(outbox.quarantine().entries[0].status,'QUARANTINED');
 d.context.dispatchEvent(new d.context.CustomEvent('na:canonical-sale-projection'));
 for(let i=0;i<3;i++){
  d.context.cajRender();
  const block=dom.document.getElementById('cajContentReview');
  assert.equal(block.parentNode,dom.caja,'redraw '+i+': block still inside Caja');
  const shown=dom.text(block);
  assert.match(shown,/V-085/); assert.match(shown,/el producto no existe/); assert.match(shown,/No las cobres de nuevo/);
  const kinds=[];(function walk(n){if(n.attrs&&n.attrs['data-review'])kinds.push(n.attrs['data-review'].split(':')[0]);n.children.forEach(walk);})(block);
  assert.deepEqual(kinds.sort(),['retry','verify'],'annul only after verify proves absence');
  assert.equal(dom.caja.children.filter(c=>c.id==='cajContentReview').length,1,'never duplicated');
 }
 assert.equal(f.sql('SELECT COUNT(*) n FROM sales').n,0);
 assert.equal(outbox.quarantine().entries.length,1,'record kept');
});

test('SPEC-885: venta en revisión por operation_id_conflict muestra «Descartar venta no registrada» al dueño (sin PIN); al pulsarlo se archiva y la caja deja de estar bloqueada',async t=>{
 const f=await activeCanon(t,{migrations:['0014_canonical_live_products.sql','0015_canonical_inventory_adjust.sql','0016_canonical_generic_sale_lines.sql']});
 f.env.DB=tursoSqlite(f.database).adapter;
 const dom=miniDom();
 const roles={confirmed:true,role:'owner',isOwner:()=>true,approve(){throw new Error('NO_DEBE_PEDIR_PIN');}};
 let pinAsked=0;
 const d=await device(f,{token:'rp2',deviceId:'rp2',scripts:[...scripts,['bridge',bridge]],
  globals:{document:dom.document,cajRender:dom.cajRender,NA_ROLES:roles,_naAuthorize(){pinAsked++;return true;},confirm(){return true;}},
  onFetch:async url=>{if(url.endsWith('/commands/sale.create'))return Response.json({error:'operation_id_conflict',conflict:'cross_ledger',ledger:'expenses'},{status:409});}});
 await d.api.openCash({session_id:'rp2-session',opening_cents:1000});
 const outbox=d.context.NuevoAmanecerCanonicalSaleOutbox;
 await outbox.enqueue(d.context.NuevoAmanecerCanonicalSaleIntent.build({sale_id:'V-885',payment_method:'efectivo',items:[{product_id:'00000',quantity:1,precio:2}]}));
 await outbox.sync();
 d.context.dispatchEvent(new d.context.CustomEvent('na:canonical-sale-projection'));
 d.context.cajRender();
 const block=dom.document.getElementById('cajContentReview');
 assert.match(dom.text(block),/V-885/); assert.match(dom.text(block),/un gasto/);
 const buttons=[];(function walk(n){if(n.attrs&&n.attrs['data-review'])buttons.push(n);n.children.forEach(walk);})(block);
 assert.deepEqual(buttons.map(b=>b.attrs['data-review'].split(':')[0]).sort(),['discard','verify']);
 assert.equal(outbox.blocking().length,1);
 await buttons.find(b=>b.attrs['data-review'].startsWith('discard:')).onclick();
 assert.equal(pinAsked,0,'sin PIN nuevo');
 const said=dom.text(dom.document.getElementById('cajCloseStatus'));
 assert.match(said,/Si la cobraste, vuélvela a registrar/,'SPEC-891: aviso de volver a registrarla');
 assert.equal(outbox.quarantine().entries[0].status,'DISCARDED_CONFLICT');
 assert.equal(outbox.blocking().length,0,'la caja se puede cerrar');
 assert.equal(f.sql('SELECT COUNT(*) n FROM sales').n,0);
 // Empleado: no ve el botón.
 roles.isOwner=()=>false; roles.role='empleado';
 assert.equal(outbox.quarantineDiscardable({status:'QUARANTINED',reason:'operation_id_conflict'}),true,'la condición de datos no depende del rol; el botón sí');
});

test('SPEC-891: lo retenido que no es venta (abono en revisión) se muestra como texto en el bloque de Caja y NO frena el cierre',async t=>{
 const f=await activeCanon(t,{migrations:['0014_canonical_live_products.sql','0015_canonical_inventory_adjust.sql','0016_canonical_generic_sale_lines.sql']});
 f.env.DB=tursoSqlite(f.database).adapter;
 const dom=miniDom();
 const roles={confirmed:true,role:'owner',isOwner:()=>true};
 const d=await device(f,{token:'rp3',deviceId:'rp3',scripts:[...scripts,['bridge',bridge]],
  globals:{document:dom.document,cajRender:dom.cajRender,NA_ROLES:roles,_naAuthorize(){return true;},confirm(){return true;}},
  onFetch:async url=>{if(url.endsWith('/commands/payment.create'))return Response.json({error:'forbidden_role',action:'payment.create'},{status:403});}});
 await d.api.openCash({session_id:'rp3-session',opening_cents:1000});
 await d.api.refresh();
 await assert.rejects(d.api.createPayment({credit_id:'CR:001',amount_cents:100,payment_method:'yape',reference:'ID-RP3'}));
 const outbox=d.context.NuevoAmanecerCanonicalSaleOutbox;
 d.context.dispatchEvent(new d.context.CustomEvent('na:canonical-sale-projection'));
 d.context.cajRender();
 const block=dom.document.getElementById('cajContentReview');
 assert.equal(block.parentNode,dom.caja,'bloque visible en Caja');
 assert.match(dom.text(block),/Otras operaciones en revisión \(1\)/);
 assert.match(dom.text(block),/no impiden cerrar la caja/);
 assert.match(dom.text(block),/Abono/i);
 assert.equal(outbox.blocking().length,0,'no frena el cierre (decisión del dueño pendiente)');
});
