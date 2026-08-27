
// Operación crítica: no se deja una variación de stock en memoria si no fue persistida.
let _naInventoryMoveBusy=false;
guardarMovInv=async function(){
  if(_naInventoryMoveBusy||isModuleLocked('productos')){if(isModuleLocked('productos'))toast('Módulo de productos bloqueado','error');return;}
  if(!_naF10AuthorizePermission('inventoryMoves','Guardar movimiento de inventario'))return;
  const quantity=_naInt(document.getElementById('mMovCant')?.value),product=productos.find(item=>String(item.id)===String(invMovId));
  if(!product||!_naTracksStock(product)){toast('El producto no controla inventario','error');return;}
  if(quantity<=0){toast('Ingresa una cantidad válida','error');return;}
  if(invMovT==='salida'&&quantity>product.stock){toast(`Stock insuficiente (${product.stock} disponibles)`,'error');return;}
  const beforeStock=product.stock,button=document.querySelector('#mMovInv .mbtn-ok, #mMovInv .mbtn-primary');
  _naInventoryMoveBusy=true;if(button){button.disabled=true;button.textContent='Procesando…';}
  try{
    product.stock=invMovT==='entrada'?beforeStock+quantity:beforeStock-quantity;
    const result=await saveAllData();
    if(!_naWasPersisted(result))throw new Error('Persistencia no verificada');
    cerrarModal('mMovInv');invRender();posRender();toast(`${invMovT==='entrada'?'📥 Entrada':'📤 Salida'} de ${quantity} unidades`,'success');
  }catch(error){
    product.stock=beforeStock;await saveAllData();invRender();posRender();toast('No se guardó el movimiento; el stock fue restaurado','error');
  }finally{
    _naInventoryMoveBusy=false;if(button){button.disabled=false;button.textContent='Guardar movimiento';}
  }
};
