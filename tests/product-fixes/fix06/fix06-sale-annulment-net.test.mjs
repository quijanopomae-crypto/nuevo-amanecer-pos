// FIX06 — anulación histórica y efecto económico inverso exacto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPosSandbox, json } from './lib/sandbox.mjs';

const PRODUCT={id:'P1',name:'Arroz',sku:'P1',precio:118,costo:50,stock:100,stockMin:0,controlInventario:true,unidad:'unidad',incluyeIGV:true,tipoImpuesto:'gravado'};
const LINE={id:'P1',name:'Arroz',sku:'P1',precio:118,costo:50,qty:1,unitsPerQty:1,ventaModo:'unidad',controlInventario:true,incluyeIGV:true,tipoImpuesto:'gravado'};
function fresh(product=PRODUCT){const sb=createPosSandbox();sb.seed();sb.seedData('productos',[product]);return sb;}
async function sell(sb,method='efectivo',{reference='',cash=40}={}){
  sb.run(`cart=[${JSON.stringify(LINE)}];posPayM=${JSON.stringify(method)};`);
  if(method==='efectivo')sb.el('mMontoRec').value='118';
  else if(method==='mixto'){sb.el('mMixedCash').value=String(cash);sb.el('mMixedDigitalMethod').value='transferencia';sb.el('mMixedRef').value=reference;sb.el('mMixedDigitalVerified').checked=true;}
  else if(method==='yape'||method==='transferencia'){sb.el('mDigitalRef').value=reference;sb.el('mDigitalVerified').checked=true;}
  else if(method==='credito'){sb.seedData('clientes',[{id:'C1',nombre:'Cliente Crédito',totalCompras:0,lineaCreditoManualActiva:true,lineaCreditoManual:1000,lineaCreditoManualMotivo:'Autorización FIX06'}]);sb.el('mCreditoCliente').value='C1';sb.el('mCreditoVence').value='2099-12-31';}
  await sb.run('confirmarVenta()');return json(sb,'ventas[0]');
}
async function annul(sb,id='V-001'){await sb.run(`anularV(${JSON.stringify(id)})`);}
const saleReversals=sb=>json(sb,"cajMovs.filter(m=>_naIsSaleReversalMove(m))");
const todayRange=sb=>json(sb,'({from:obtenerHoy(),to:obtenerHoy()})');

test('T1 — efectivo: venta + anulación dejan ventas y caja neta en cero',async()=>{
  const sb=fresh();await sell(sb);assert.equal(json(sb,'cajTotales().ef'),218);await annul(sb);
  const totals=json(sb,'cajTotales()');assert.equal(totals.ven,0);assert.equal(totals.ef,100);assert.equal(saleReversals(sb)[0].efectivo,118);
});

test('T2 — digital no inventa efectivo',async()=>{
  const sb=fresh();await sell(sb,'transferencia',{reference:'BANK-1'});assert.equal(json(sb,'cajTotales().ef'),100);await annul(sb);
  const reversal=saleReversals(sb)[0];assert.equal(json(sb,'cajTotales().ef'),100);assert.equal(reversal.efectivo,0);assert.equal(reversal.digital,118);assert.equal(reversal.referencia,'BANK-1');
});

test('T3 — mixto revierte solo su componente cash en caja física',async()=>{
  const sb=fresh();await sell(sb,'mixto',{reference:'MIX-1',cash:40});assert.equal(json(sb,'cajTotales().ef'),140);await annul(sb);
  const reversal=saleReversals(sb)[0];assert.equal(reversal.efectivo,40);assert.equal(reversal.digital,78);assert.equal(json(sb,'cajTotales().ef'),100);assert.equal(json(sb,'cajTotales().ven'),0);
});

test('T4 — anulada no cuenta como venta activa del día',async()=>{
  const sb=fresh();await sell(sb);await annul(sb);const range=todayRange(sb);
  assert.equal(json(sb,`_naF8SaleRows(${JSON.stringify(range)}).length`),0);assert.equal(json(sb,'calcularGanancias().ventasNetas'),0);assert.equal(json(sb,'ventas.filter(v=>v.fecha===obtenerHoy()&&!v.anulada).length'),0);
});

test('T5 — la venta original permanece completa en el historial',async()=>{
  const sb=fresh();const original=await sell(sb);await annul(sb);const after=json(sb,'ventas[0]');
  assert.equal(json(sb,'ventas.length'),1);assert.equal(after.id,original.id);assert.equal(after.items.length,1);assert.equal(after.total,118);assert.equal(after.anulada,true);assert.equal(after.estado,'anulada');
});

test('T6 — reversal separado, enlazado y con timestamp propio',async()=>{
  const sb=fresh();const sale=await sell(sb);await annul(sb,sale.id);const reversals=saleReversals(sb);
  assert.equal(reversals.length,1);assert.equal(reversals[0].reversalOf,sale.id);assert.equal(reversals[0].ventaId,sale.id);assert.equal(reversals[0].tipo,'egr');assert.ok(reversals[0].timestamp);assert.ok(reversals[0].id);
});

test('T7 — doble anulación queda bloqueada e idempotente',async()=>{
  const sb=fresh();const sale=await sell(sb);await annul(sb,sale.id);const before=sb.memoryState();await annul(sb,sale.id);
  assert.equal(saleReversals(sb).length,1);assert.deepEqual(sb.memoryState(),before);assert.match(sb.toastText(),/ya fue anulada/i);
});

test('T8 — dos anulaciones concurrentes producen un solo reversal',async()=>{
  const sb=fresh();const sale=await sell(sb);sb.run(`globalThis.__fix06Calls=0;globalThis.__fix06Resolve=null;_naConfirmAction=()=>{globalThis.__fix06Calls++;return new Promise(resolve=>{globalThis.__fix06Resolve=resolve;});};`);
  const first=sb.run(`anularV(${JSON.stringify(sale.id)})`),second=sb.run(`anularV(${JSON.stringify(sale.id)})`);assert.equal(sb.run('__fix06Calls'),1);sb.run('__fix06Resolve(true)');await Promise.all([first,second]);assert.equal(saleReversals(sb).length,1);assert.equal(json(sb,'ventas[0].anulada'),true);
});

test('T9 — cross-day atribuye el inverso al día del reversal sin cambiar fecha original',async()=>{
  const sb=fresh();const sale=await sell(sb),today=json(sb,'obtenerHoy()'),yesterday='2026-08-29';
  sb.run(`ventas[0].fecha=${JSON.stringify(yesterday)};cajMovs[0].fecha=${JSON.stringify(yesterday)};cajMovs[0].timestamp=${JSON.stringify(yesterday+'T10:00:00.000Z')};cajMovs[0].sessionId=1600000000000;cajEstado.sessionId=1700000000001;`);await sb.run('saveAllData()');await annul(sb,sale.id);
  const oldFlow=json(sb,`_naF8BuildReport({from:${JSON.stringify(yesterday)},to:${JSON.stringify(yesterday)}}).cashFlow`),newFlow=json(sb,`_naF8BuildReport({from:${JSON.stringify(today)},to:${JSON.stringify(today)}}).cashFlow`),reversal=saleReversals(sb)[0];
  assert.equal(json(sb,'ventas[0].fecha'),yesterday);assert.equal(reversal.fecha,today);assert.equal(oldFlow.net,118);assert.equal(newFlow.net,-118);assert.equal(newFlow.saleOutflow,118);assert.equal(json(sb,'cajTotales().ven'),-118);
});

test('T10 — fallo durable revierte venta, caja, stock y reversal',async()=>{
  const sb=fresh();const sale=await sell(sb),before=sb.memoryState();sb.breakPersistent();await annul(sb,sale.id);sb.restorePersistent();const after=sb.memoryState();
  assert.deepEqual(after,before);assert.equal(after.ventas[0].anulada,false);assert.equal(saleReversals(sb).length,0);assert.equal(after.productos[0].stock,99);assert.match(sb.toastText(),/No se pudo guardar la anulación/i);
});

test('T11 — cierre de caja congela el esperado neto correcto',async()=>{
  const sb=fresh();await sell(sb);await annul(sb);assert.equal(json(sb,'cajTotales().ef'),100);sb.el('cajContado').value='100';await sb.run('cerrarCaja()');
  const closure=json(sb,'cashClosures[0]');assert.equal(closure.esperado,100);assert.equal(closure.contado,100);assert.equal(closure.diferencia,0);
});

test('T12 — crédito crea reversal económico sin inventar cash',async()=>{
  const sb=fresh();const sale=await sell(sb,'credito');assert.equal(json(sb,'cajTotales().ef'),100);await annul(sb,sale.id);const reversal=saleReversals(sb)[0];
  assert.equal(reversal.metodo,'credito');assert.equal(reversal.efectivo,0);assert.equal(reversal.digital,0);assert.equal(json(sb,'cajTotales().ef'),100);assert.equal(json(sb,'cajTotales().ven'),0);assert.equal(json(sb,'cajTotales().ret'),0);assert.equal(json(sb,'creditos[0].anulado'),true);
});

test('T13 — sin referencia bancaria no se usa operation interno',async()=>{
  const sb=fresh();const sale=await sell(sb,'transferencia',{reference:''});assert.ok(sale.operation);assert.equal(sale.paymentRef,'');await annul(sb,sale.id);assert.equal(saleReversals(sb)[0].referencia,'');assert.notEqual(saleReversals(sb)[0].referencia,sale.operation);
});

test('T14 — reporte diario netea el movimiento sin contar venta activa',async()=>{
  const sb=fresh();await sell(sb);await annul(sb);const report=json(sb,'_naF8BuildReport({from:obtenerHoy(),to:obtenerHoy()})');
  assert.equal(report.metrics.revenue,0);assert.equal(report.metrics.transactions,0);assert.equal(report.cashFlow.saleInflow,118);assert.equal(report.cashFlow.saleOutflow,118);assert.equal(report.cashFlow.net,0);
});

test('T15 — reload conserva original anulada y reversal enlazado',async()=>{
  const sb=fresh();const sale=await sell(sb);await annul(sb,sale.id);const durable=sb.durableSnapshot();assert.equal(sb.run('_naApplySnapshot(_naParseStoredSnapshot(storage.readPersistent(_NA_LOCAL_KEY)))'),true);
  assert.equal(json(sb,'ventas[0].anulada'),true);assert.equal(saleReversals(sb).length,1);assert.equal(saleReversals(sb)[0].reversalOf,sale.id);assert.equal(durable.data.cajMovs.filter(m=>m.reversal&&m.ventaId===sale.id).length,1);
});

test('T16 — combinación con pago y reversión de crédito mantiene caja neta',async()=>{
  const sb=fresh();const sale=await sell(sb);await annul(sb,sale.id);
  sb.seedData('clientes',[{id:'C2',nombre:'Cliente Macro',lineaCreditoManualActiva:true,lineaCreditoManual:1000}]);sb.run(`cliCredId='C2'`);sb.el('crDesc').value='Crédito macro';sb.el('crMonto').value='50';sb.el('crVence').value='2099-12-31';sb.el('crTipo').value='venta';await sb.run('guardarCred()');
  sb.run('pagoCredId=String(creditos[0].id)');sb.el('pagoMonto').value='50';sb.el('pagoMetodo').value='efectivo';sb.el('pagoOperacion').value='';await sb.run('confirmarPago()');const paymentId=json(sb,'creditos[0].pagos[0].pagoId');await sb.run(`revertirPagoCredito(String(creditos[0].id),${JSON.stringify(paymentId)})`);
  assert.equal(json(sb,'cajTotales().ef'),100);assert.equal(json(sb,'cajTotales().ven'),0);assert.equal(saleReversals(sb).length,1);assert.equal(json(sb,"cajMovs.filter(m=>m.reversal&&m.creditoId!=null).length"),1);
});

test('T17 — venta sin control de inventario también puede anularse',async()=>{
  const sb=fresh({...PRODUCT,controlInventario:false,stock:0});sb.run(`cart=[${JSON.stringify({...LINE,controlInventario:false})}]`);sb.el('mMontoRec').value='118';const sale=await sell(sb);await annul(sb,sale.id);
  assert.equal(json(sb,'ventas[0].anulada'),true);assert.equal(saleReversals(sb).length,1);assert.equal(json(sb,"inventoryMovements.filter(m=>m.type==='SALE_REVERSAL').length"),0);
});
