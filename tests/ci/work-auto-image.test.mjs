import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizePhotoPurchaseLine,checkPhotoDocument} from '../../tools/cloudflare-lab/src/pos-assistant-image-review.js';
import {buildDeepSeekRequest,toProposal} from '../../tools/cloudflare-lab/src/pos-assistant.js';
import {writeInvoiceMemory,readInvoiceMemory} from '../../tools/cloudflare-lab/src/pos-assistant-invoice-memory.js';
const IMG='data:image/jpeg;base64,YWJj';
const known={nombre:'Valle Verde Blanco 1 L',presentacion:'1 L',unidad:'UND',cantidad:5,paquetes:5,unidades_por_paquete:12,costo_unitario:2.23,total_linea:133.80};
// Las otras 7 filas SON SINTETICAS: comprueban aritmetica 8/311/1093.35.
// No sustituyen la imagen original, que sigue siendo necesaria para verificar cada producto.
const extra=[40,40,40,40,40,50,1].map((cantidad,i)=>({nombre:'FILA SINTETICA '+(i+2),cantidad,costo_unitario:i<5?3:i===5?7:9.55}));
const invoice={numero_productos:8,total_unidades:311,total_documento:1093.35,lineas:[known,...extra]};
test('clasificacion: una sola llamada multimodal, texto escrito tiene prioridad, sin segundo OCR',()=>{
  const req=buildDeepSeekRequest({role:'owner',ctx:{products:[]},history:[],text:'Explica el error de esta captura',image:IMG});
  assert.match(req.messages[0].content,/captura de pantalla/i);
  assert.match(req.messages[0].content,/instruccion de texto.*prioridad/i);
  const last=req.messages.at(-1);
  assert.equal(last.content.length,2);
  assert.match(last.content[0].text,/Explica el error/);
  assert.equal(last.content[1].type,'image_url');
  const auto=buildDeepSeekRequest({role:'owner',ctx:{products:[]},history:[],text:'',image:IMG});
  assert.match(auto.messages.at(-1).content[0].text,/sin instrucciones/i);
  assert.match(auto.messages[0].content,/BOLETA O FACTURA/);
  assert.equal(auto.messages.filter(m=>Array.isArray(m.content)).length,1);
});
test('Valle Verde: 5 paquetes x 12 UND = 60 UND x S/2.23 = S/133.80',()=>{
  const x=normalizePhotoPurchaseLine(known);
  assert.equal(x.cantidad,60);
  assert.equal(x.revisar.length,0);
  assert.equal(x.total_linea,133.8);
  assert.equal(Math.round(x.cantidad*x.costo_unitario*100),13380);
});
test('boleta de control: 8 filas, 311 unidades, S/1093.35 (7 filas sinteticas)',()=>{
  const p=toProposal({name:'leer_factura_compra',arguments:invoice},'owner',{products:[]},1);
  assert.equal(p.type,'compra');
  assert.equal(p.lineas.length,8);
  assert.equal(p.lineas[0].cantidad,60);
  assert.equal(p.lineas[0].presentacion,'1 L');
  assert.equal(p.lineas.reduce((a,x)=>a+x.cantidad,0),311);
  assert.equal(p.total_calculado,1093.35);
  assert.deepEqual(p.revisar_documento,[]);
});
test('la propuesta S/970.65 se bloquea por diferencia en el total',()=>{
  const p=toProposal({name:'leer_factura_compra',arguments:{...invoice,total_documento:970.65}},'owner',{products:[]},1);
  assert.equal(p.total_calculado,1093.35);
  assert.ok(p.revisar_documento.includes('total_documento'));
  const src=readFileSync('tools/cloudflare-lab/src/pos-assistant.js','utf8');
  assert.match(src,/invoice_total_mismatch/);
  const ui=readFileSync('POS/js/work-host.js','utf8');
  assert.match(ui,/p\.revisar_documento/);
});
test('filas inconsistentes, cantidades y datos ilegibles exigen revision',()=>{
  const wrong=normalizePhotoPurchaseLine({...known,cantidad:57,total_linea:120});
  assert.equal(wrong.cantidad,60);
  assert.ok(wrong.revisar.includes('cantidad_empaque'));
  assert.ok(wrong.revisar.includes('importe_fila'));
  const noUnit=normalizePhotoPurchaseLine({...known,unidades_por_paquete:null});
  assert.ok(noUnit.revisar.includes('unidades_por_paquete'));
  const bonus=normalizePhotoPurchaseLine({nombre:'Bonificacion',cantidad:1,costo_unitario:0,total_linea:0});
  assert.deepEqual(bonus.revisar,[]);
  assert.ok(checkPhotoDocument([],{}).flags.includes('total_documento_ilegible'));
});
test('Work envia foto sin texto ni prompt del usuario y conserva token firmado por sesion',()=>{
  const bridge=readFileSync('POS/work/work-canon-bridge.js','utf8');
  const host=readFileSync('POS/js/work-host.js','utf8');
  assert.match(bridge,/ask\(txt,'chat',photo,attached\[0\]\.name\)/);
  assert.doesNotMatch(bridge,/txt\|\|'Analiza esta imagen'/);
  assert.match(host,/autoImage = hasImage/);
  assert.match(host,/chatBody\.invoice_memory=invoiceMemory/);
  assert.match(host,/invoiceMemory = null; generation\+\+/);
});
test('memoria de boleta conserva presentaciones y se aísla por sesion y aparato',async()=>{
  const secret='test-secret-work-image-1234',auth={principalId:'adminA',sessionId:'sessionA'},now=100000;
  const prop=toProposal({name:'leer_factura_compra',arguments:invoice},'owner',{products:[]},1);
  const token=await writeInvoiceMemory({previous:null,image:IMG,proposals:[prop],reply:'Leido',text:'',secret,auth,now,clean:x=>String(x)});
  assert.equal(typeof token,'string');
  const mem=await readInvoiceMemory(token,secret,auth,now+1);
  assert.equal(mem.invoices[0].lineas[0].cantidad,60);
  assert.equal(mem.invoices[0].lineas[0].paquetes,5);
  assert.equal(mem.invoices[0].lineas[0].unidades_por_paquete,12);
  assert.equal(mem.invoices[0].total_documento,1093.35);
  assert.equal(await readInvoiceMemory(token,secret,{...auth,sessionId:'otra'},now+1),null);
  assert.equal(await readInvoiceMemory(token,secret,{...auth,principalId:'otro'},now+1),null);
});
