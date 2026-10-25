import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { makeDoc } from './fake-dom.mjs';
import { assistantChatRoute, createMemoryUsageStore, systemPrompt } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const catalog = [{ id: 'existing', nombre: 'Galleta Prueba 40g', stock: 5, costo: 1, precio: 2, controla: true }];
async function invoice(products = catalog, lineas = [{ nombre: '  GALLETA prueba 40g ', cantidad: 12, costo_unitario: 1 }, { nombre: 'Producto Nuevo Prueba', cantidad: 6, costo_unitario: 0 }]) {
  const request = new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text: 'Lee esta factura de compra', context: { products: [] } }) });
  const res = await assistantChatRoute(request, { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'test-secret-invoice-0123456789', DEEPSEEK_API_KEY: 'test-only' }, { principalId: 'test-owner' }, (d, s = 200) => new Response(JSON.stringify(d), {status:s}), {
    store: createMemoryUsageStore(), resolveRole: async () => 'owner', reader: { products: async () => products },
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'invoice', type: 'function', function: { name: 'leer_factura_compra', arguments: JSON.stringify({lineas}) } }] } }] }))
  });
  assert.equal(res.status, 200); return res.json();
}
test('factura busca coincidencias exactas fuera del contexto corto y conserva productos nuevos y gratuitos', async () => {
  const body = await invoice(); const purchase = body.proposals.find(p => p.type === 'compra');
  assert.equal(purchase.lineas.length, 2);
  assert.equal(purchase.lineas[0].product_id, 'existing');
  assert.equal(purchase.lineas[0].costo_actual, 1);
  assert.equal(purchase.lineas[1].product_id, null);
  assert.equal(purchase.lineas[1].costo_unitario, 0);
  assert.equal(purchase.sinProducto, 1);
  assert.match(body.reply, /[Nn]ueva compra|borrador/);
  assert.doesNotMatch(body.reply, /no puedo preparar/);
  assert.equal(catalog[0].stock, 5, 'preparar la factura no suma stock');
});
test('coincidencias ambiguas y presentaciones diferentes no asignan productos automáticamente', async () => {
  for (const products of [[...catalog, {...catalog[0], id:'duplicate'}], [{...catalog[0], nombre:'Galleta Prueba 80g'}]]) {
    const body = await invoice(products, [{nombre:'Galleta Prueba 40g',cantidad:12,costo_unitario:1}]);
    assert.equal(body.proposals.find(p=>p.type==='compra').lineas[0].product_id, null);
  }
});
test('crear producto de una compra prepara ficha sin inventar precio ni sumar stock', () => {
  const draft = C.purchaseProductDraft({nombre:'Producto Nuevo Prueba',cantidad:24,costo_unitario:1.25}, []);
  assert.equal(draft.stock_inicial, 0);
  assert.equal(draft.precio, null);
  assert.equal(draft.costo, 1.25);
  assert.equal(draft.nombre, 'Producto Nuevo Prueba');
});
test('revisar catálogo actualizado antes de crear evita duplicar un producto recién guardado', () => {
  const result = C.purchaseProductDraft({nombre:'galleta prueba 40g',cantidad:24}, catalog);
  assert.equal(result.product_id, 'existing');
  assert.equal(result.nombre, catalog[0].nombre);
});
test('factura debe transcribirse aunque falten productos o precios de venta', () => {
  const prompt = systemPrompt('owner', {products:[]});
  assert.match(prompt, /factura[\s\S]*aunque[\s\S]*catálogo/i);
  assert.match(prompt, /no inventes[\s\S]*precio de venta/i);
});

function uiHarness(list = []) {
  const doc = makeDoc(), modal = doc.createElement('div'), w = doc.createElement('div'), row = doc.createElement('div');
  modal.classList.add('open'); doc.body.appendChild(w); w.appendChild(row);
  const name = doc.createElement('input'), cost = doc.createElement('input'), formName = doc.createElement('input');
  name.value = 'Producto Nuevo Prueba'; cost.value = '1.25'; formName.value = name.value;
  row.querySelector = selector => selector === '.na-pur-prod' ? name : cost;
  w.dispatchEvent = () => {};
  doc.getElementById = id => id === 'mProd' ? modal : formName;
  let callback, opened = [], owner = true, refresh = async () => {};
  const root = { MutationObserver: class { constructor(f){callback=f;} observe(){} disconnect(){} } };
  const el = (tag, cls) => {const e=doc.createElement(tag);e.className=cls;return e;};
  const src = readFileSync('POS/js/modules/asistente/asistente-ui.js','utf8');
  const fn = src.slice(src.indexOf('  function purchaseProductButton('),src.indexOf('  var gate = C.createGate(deps);'));
  const install = new Function('C','deps','doc','root','el','isOwnerAccess',fn+'return purchaseProductButton;')(C, {refreshProducts:()=>refresh(),productos:()=>list,openNewProduct:p=>{opened.push(p);return true;}},doc,root,el,()=>owner);
  install(w,row);
  return {w,row,name,list,opened,button:row.byTag('button')[0],async close(){modal.classList.remove('open');await callback();},refreshWith(f){refresh=f;},loseRole(){owner=false;}};
}
test('la ficha se abre sobre la compra, conserva el borrador y vuelve a vincular tras guardar sin ejecutar compra', async () => {
  const h=uiHarness(); h.w.style.display='flex';h.button.click();await new Promise(r=>setImmediate(r));
  assert.equal(h.w.style.display,'none', 'hidden no basta con el CSS display:flex del overlay');
  assert.equal(h.opened[0].stock_inicial,0);assert.equal(h.opened[0].precio,null);
  h.list.push({id:'new',nombre:'Producto Nuevo Prueba',stock:0});await h.close();
  assert.equal(h.w.style.display,'flex');assert.equal(h.name.value,'Producto Nuevo Prueba');
  h.button.click();await new Promise(r=>setImmediate(r));assert.equal(h.opened.length,1,'no vuelve a crear una ficha ya guardada');
});
test('cancelar la ficha recupera la compra; perder rol impide abrir fichas', async () => {
  const h=uiHarness();h.button.click();await new Promise(r=>setImmediate(r));await h.close();assert.equal(h.w.style.display,undefined);
  h.loseRole();h.button.click();await new Promise(r=>setImmediate(r));assert.equal(h.opened.length,1);
});
test('nombre duplicado no abre otra ficha automáticamente', async () => {
  const h=uiHarness([{id:'a',nombre:'Producto Nuevo Prueba'},{id:'b',nombre:'Producto Nuevo Prueba'}]);
  h.button.click();await new Promise(r=>setImmediate(r));assert.equal(h.opened.length,0);
});

test('cierre de ficha espera catálogo actualizado antes de permitir otro intento', async () => {
 const h=uiHarness();h.button.click();await new Promise(r=>setImmediate(r));
 let release; h.refreshWith(()=>new Promise(r=>{release=r;})); const closing=h.close();
 assert.equal(h.button.disabled,true);
 h.list.push({id:'saved',nombre:'Producto Nuevo Prueba',stock:0});release();await closing;
 assert.equal(h.button.disabled,false);assert.match(h.row.textContent,/Producto vinculado/);
});
test('sin lectura fiable del catálogo no abre una ficha nueva', async () => {
 const h=uiHarness();h.refreshWith(async()=>{throw Error('offline');});h.button.click();await new Promise(r=>setImmediate(r));
 assert.equal(h.opened.length,0);assert.match(h.row.textContent,/No repitas/);
});
