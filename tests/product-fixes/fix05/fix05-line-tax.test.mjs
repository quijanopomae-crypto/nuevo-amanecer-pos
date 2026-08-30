// FIX05 — IGV por línea: venta, persistencia, ticket, pagos e historia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPosSandbox, json } from './lib/sandbox.mjs';

const PRODUCT=(id,type='gravado',price=118)=>({id,name:`Producto ${id}`,sku:id,precio:price,costo:10,stock:0,stockMin:0,controlInventario:false,unidad:'unidad',incluyeIGV:true,tipoImpuesto:type});
const LINE=(id,type='gravado',price=118,qty=1,extra={})=>({id,name:`Producto ${id}`,sku:id,precio:price,costo:10,qty,unitsPerQty:1,ventaModo:'unidad',controlInventario:false,incluyeIGV:true,tipoImpuesto:type,...extra});

function fresh(products=[PRODUCT('P1')]){
  const sb=createPosSandbox();sb.seed();sb.seedData('productos',products);return sb;
}
async function sell(sb,lines,{method='efectivo',client=null}={}){
  sb.run(`cart=${JSON.stringify(lines)};posPayM=${JSON.stringify(method)};`);
  const total=Number(lines.reduce((sum,line)=>sum+line.precio*line.qty,0).toFixed(2));
  if(method==='efectivo')sb.el('mMontoRec').value=String(total);
  if(method==='mixto'){
    sb.el('mMixedCash').value=String(Number((total/2).toFixed(2)));
    sb.el('mMixedDigitalMethod').value='transferencia';
    sb.el('mMixedRef').value=`MIX-${Date.now()}-${Math.random()}`;
    sb.el('mMixedDigitalVerified').checked=true;
  }
  if(method==='credito'){
    const target=client??{id:'C1',nombre:'Cliente Crédito',lineaCreditoManualActiva:true,lineaCreditoManual:10000,lineaCreditoManualMotivo:'Autorización de prueba'};
    sb.seedData('clientes',[target]);
    sb.el('mCreditoCliente').value=String(target.id);
    sb.el('mCreditoVence').value='2099-12-31';
  }
  await sb.run('confirmarVenta()');
  return json(sb,'ventas.length?ventas[0]:null');
}
function expectBreakdown(actual,expected){for(const [key,value] of Object.entries(expected))assert.equal(actual[key],value,`${key} coherente`);}

test('T1 — gravado S/118 guarda base S/100 e IGV S/18',async()=>{
  const sb=fresh();const sale=await sell(sb,[LINE('P1')]);
  expectBreakdown(sale.taxBreakdown,{totalGravado:100,totalExonerado:0,totalInafecto:0,totalIGV:18,subtotal:100,totalVenta:118});
  assert.equal(sale.items[0].tipoImpuesto,'gravado');
});

test('T2 — exonerado no genera IGV',async()=>{
  const sb=fresh([PRODUCT('P1','exonerado',50)]);const sale=await sell(sb,[LINE('P1','exonerado',50)]);
  expectBreakdown(sale.taxBreakdown,{totalGravado:0,totalExonerado:50,totalInafecto:0,totalIGV:0,subtotal:50,totalVenta:50});
});

test('T3 — inafecto no genera IGV',async()=>{
  const sb=fresh([PRODUCT('P1','inafecto',30)]);const sale=await sell(sb,[LINE('P1','inafecto',30)]);
  expectBreakdown(sale.taxBreakdown,{totalGravado:0,totalExonerado:0,totalInafecto:30,totalIGV:0,subtotal:30,totalVenta:30});
});

test('T4 — venta mixta suma cada categoría sin IGV global',async()=>{
  const sb=fresh([PRODUCT('G'),PRODUCT('E','exonerado',50),PRODUCT('I','inafecto',30)]);
  const sale=await sell(sb,[LINE('G'),LINE('E','exonerado',50),LINE('I','inafecto',30)]);
  expectBreakdown(sale.taxBreakdown,{totalGravado:100,totalExonerado:50,totalInafecto:30,totalIGV:18,subtotal:180,totalVenta:198});
  assert.notEqual(sale.taxBreakdown.totalIGV,Number((198-198/1.18).toFixed(2)),'no usa fórmula global');
});

test('T5 — descuento calcula impuesto sobre precio efectivo',async()=>{
  const sb=fresh();const sale=await sell(sb,[LINE('P1','gravado',59,1,{_precioOriginal:118,_descuento:50})]);
  expectBreakdown(sale.taxBreakdown,{totalGravado:50,totalIGV:9,subtotal:50,totalVenta:59});
  assert.equal(sale.subtotal,118);assert.equal(sale.descuentoTotal,59);
});

test('T6 — múltiples gravados agregan redondeo por línea',async()=>{
  const sb=fresh([PRODUCT('A','gravado',59),PRODUCT('B')]);const sale=await sell(sb,[LINE('A','gravado',59,2),LINE('B')]);
  expectBreakdown(sale.taxBreakdown,{totalGravado:200,totalIGV:36,subtotal:200,totalVenta:236});
});

test('T7 — ticket e impresión textual consumen el breakdown persistido',async()=>{
  const sb=fresh([PRODUCT('G'),PRODUCT('E','exonerado',50),PRODUCT('I','inafecto',30)]);
  const sale=await sell(sb,[LINE('G'),LINE('E','exonerado',50),LINE('I','inafecto',30)]);
  const built=json(sb,'_naBuildThermalTicket(ventas[0],false)');
  assert.match(built.text,/Subtotal\s*:\s*S\/ 180\.00/);assert.match(built.text,/IGV 18%\s*:\s*S\/ 18\.00/);assert.match(built.text,/TOTAL A PAGAR\s*:\s*S\/ 198\.00/);
  assert.doesNotMatch(built.text,/S\/ 30\.20/,'no reaparece el IGV global incorrecto');
  const durable=sb.durableSnapshot().data.ventas[0];assert.deepEqual(durable.taxBreakdown,sale.taxBreakdown);
});

test('T8 — cambiar catálogo no altera una venta histórica',async()=>{
  const sb=fresh();const sale=await sell(sb,[LINE('P1')]);const frozen=structuredClone(sale.taxBreakdown);
  sb.run(`productos[0].tipoImpuesto='exonerado';productos[0].precio=999;_naNormalizeData();`);
  assert.deepEqual(json(sb,'_naTaxBreakdownForSale(ventas[0])'),frozen);
  assert.deepEqual(json(sb,'ventas[0].taxBreakdown'),frozen);
});

test('T9 — venta legacy sin breakdown sigue cargando y usa sus saleItems',()=>{
  const sb=fresh();
  sb.run(`ventas=[{id:'V-LEGACY',fecha:obtenerHoy(),hora:'10:00',metodo:'efectivo',items:[{id:'P1',name:'Legacy',qty:1,precio:118}]}];_naNormalizeData();`);
  assert.equal(json(sb,'ventas.length'),1);expectBreakdown(json(sb,'_naTaxBreakdownForSale(ventas[0])'),{totalGravado:100,totalIGV:18,subtotal:100,totalVenta:118});
  assert.doesNotThrow(()=>sb.run('_naBuildThermalTicket(ventas[0],false)'));
});

test('T10 — fallo durable revierte venta y taxBreakdown sin residuo',async()=>{
  const sb=fresh();await sb.run('saveAllData()');const before=sb.memoryState();sb.breakPersistent();await sell(sb,[LINE('P1')]);sb.restorePersistent();
  const after=sb.memoryState();assert.equal(after.ventas.length,0);assert.equal(after.cajMovs.length,before.cajMovs.length);assert.equal(after.cart.length,1);assert.match(sb.toastText(),/No se registró la venta/i);
});

test('T11 — líneas pequeñas mantienen diferencia máxima de un céntimo',async()=>{
  const sb=fresh([PRODUCT('A','gravado',.07),PRODUCT('B','gravado',.07),PRODUCT('C','gravado',.07)]);
  const sale=await sell(sb,[LINE('A','gravado',.07),LINE('B','gravado',.07),LINE('C','gravado',.07)]);
  expectBreakdown(sale.taxBreakdown,{totalGravado:.18,totalIGV:.03,subtotal:.18,totalVenta:.21});
  assert.ok(Math.abs(sale.total-(sale.taxBreakdown.subtotal+sale.taxBreakdown.totalIGV))<=.01);
});

test('T12 — incluyeIGV=false conserva el contrato real de precio final',async()=>{
  const sb=fresh([{...PRODUCT('P1'),incluyeIGV:false}]);const sale=await sell(sb,[LINE('P1','gravado',118,1,{incluyeIGV:false})]);
  assert.equal(sale.total,118,'no gross-up sobre el precio histórico del POS');assert.equal(sale.items[0].incluyeIGV,false);expectBreakdown(sale.taxBreakdown,{totalGravado:100,totalIGV:18,totalVenta:118});
});

test('T13 — venta a crédito comparte exactamente el breakdown tributario',async()=>{
  const sb=fresh();const sale=await sell(sb,[LINE('P1')],{method:'credito'});
  assert.equal(sale.metodo,'credito');assert.equal(json(sb,'creditos.length'),1);expectBreakdown(sale.taxBreakdown,{totalGravado:100,totalIGV:18,totalVenta:118});assert.equal(json(sb,'creditos[0].monto'),118);
});

test('T14 — pago mixto comparte total y breakdown tributario',async()=>{
  const sb=fresh([PRODUCT('G'),PRODUCT('E','exonerado',50)]);const sale=await sell(sb,[LINE('G'),LINE('E','exonerado',50)],{method:'mixto'});
  assert.equal(sale.metodo,'mixto');expectBreakdown(sale.taxBreakdown,{totalGravado:100,totalExonerado:50,totalIGV:18,subtotal:150,totalVenta:168});assert.equal(Number((sale.paymentBreakdown.efectivo+sale.paymentBreakdown.digital).toFixed(2)),168);
});

test('T15 — anulación no reescribe el breakdown original',async()=>{
  const sb=fresh([{...PRODUCT('P1'),controlInventario:true,stock:10}]);const sale=await sell(sb,[{...LINE('P1'),controlInventario:true}]);const before=structuredClone(sale.taxBreakdown);await sb.run(`anularV(${JSON.stringify(sale.id)})`);
  assert.equal(json(sb,'ventas[0].anulada'),true);assert.deepEqual(json(sb,'ventas[0].taxBreakdown'),before);
});

test('T16 — respaldo valida y conserva el breakdown nuevo',async()=>{
  const sb=fresh();const sale=await sell(sb,[LINE('P1')]);const prepared=json(sb,'_naPrepareBackupSnapshot(_naParseStoredSnapshot(storage.readPersistent(_NA_LOCAL_KEY)))');
  assert.deepEqual(prepared.snapshot.data.ventas[0].taxBreakdown,sale.taxBreakdown);
  assert.equal(sb.run(`_naApplySnapshot(${JSON.stringify(prepared.snapshot)})`),true);assert.deepEqual(json(sb,'ventas[0].taxBreakdown'),sale.taxBreakdown);
  const bad=structuredClone(prepared.snapshot);bad.data.ventas[0].taxBreakdown.totalIGV=999;assert.throws(()=>sb.run(`_naPrepareBackupSnapshot(${JSON.stringify(bad)})`),/tributario incoherente/i);
});

test('T17 — respaldo rechaza breakdown semánticamente falso aunque cuadre aritméticamente',async()=>{
  const sb=fresh();await sell(sb,[LINE('P1')]);const original=sb.durableSnapshot();
  const wrongRate=structuredClone(original);wrongRate.data.ventas[0].taxBreakdown.rate=.2;assert.throws(()=>sb.run(`_naPrepareBackupSnapshot(${JSON.stringify(wrongRate)})`),/tributario incoherente/i);
  const wrongItems=structuredClone(original);Object.assign(wrongItems.data.ventas[0].taxBreakdown,{totalGravado:101,totalIGV:17,subtotal:101,totalVenta:118});assert.throws(()=>sb.run(`_naPrepareBackupSnapshot(${JSON.stringify(wrongItems)})`),/no coincide con la venta/i);
  const inactiveWithTax=structuredClone(original);inactiveWithTax.data.ventas[0].igvActive=false;inactiveWithTax.data.ventas[0].taxBreakdown.taxActive=false;assert.throws(()=>sb.run(`_naPrepareBackupSnapshot(${JSON.stringify(inactiveWithTax)})`),/tributario incoherente/i);
});
