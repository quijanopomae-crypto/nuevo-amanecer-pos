
// Operación crítica: no se deja una variación de stock en memoria si no fue persistida.
let _naInventoryMoveBusy=false;
guardarMovInv=async function(){
  if(_naInventoryMoveBusy||isModuleLocked('productos')){if(isModuleLocked('productos'))toast('Módulo de productos bloqueado','error');return;}
  if(!_naF10AuthorizePermission('inventoryMoves','Guardar movimiento de inventario'))return;
  const quantity=_naInt(document.getElementById('mMovCant')?.value),product=productos.find(item=>String(item.id)===String(invMovId));
  if(!product||!_naTracksStock(product)){toast('El producto no controla inventario','error');return;}
  if(quantity<=0){toast('Ingresa una cantidad válida','error');return;}
  if(invMovT==='salida'&&quantity>product.stock){toast(`Stock insuficiente (${product.stock} disponibles)`,'error');return;}
  const beforeStock=product.stock,ledgerLength=Array.isArray(inventoryMovements)?inventoryMovements.length:0,button=document.querySelector('#mMovInv .mbtn-ok, #mMovInv .mbtn-primary');
  _naInventoryMoveBusy=true;if(button){button.disabled=true;button.textContent='Procesando…';}
  try{
    // FIX04: entrada/salida pasan por el punto central (ledger before → delta → after) y persisten juntos.
    const outcome=applyInventoryMovement({productId:product.id,type:invMovT==='entrada'?'ENTRADA':'SALIDA',delta:invMovT==='entrada'?quantity:-quantity,reason:invMovT==='entrada'?`Entrada de inventario: +${quantity}`:`Salida de inventario: -${quantity}`,source:'INVENTORY_MOVE',referenceId:String(product.id)});
    if(!outcome.ok)throw new Error(outcome.message||'Movimiento de inventario bloqueado');
    const result=await saveAllData();
    if(!_naWasPersisted(result))throw new Error('Persistencia no verificada');
    cerrarModal('mMovInv');invRender();posRender();toast(`${invMovT==='entrada'?'📥 Entrada':'📤 Salida'} de ${quantity} unidades`,'success');
  }catch(error){
    if(Array.isArray(inventoryMovements))inventoryMovements.length=Math.min(ledgerLength,inventoryMovements.length);
    product.stock=beforeStock;await saveAllData();invRender();posRender();toast('No se guardó el movimiento; el stock fue restaurado','error');
  }finally{
    _naInventoryMoveBusy=false;if(button){button.disabled=false;button.textContent='Guardar movimiento';}
  }
};
