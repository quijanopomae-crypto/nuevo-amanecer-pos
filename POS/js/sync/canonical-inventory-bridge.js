(function(root){
  'use strict';

  if(!root||!root.document)return;
  var busy=false;

  function api(){return root.NuevoAmanecerCanonical;}
  function enabled(){
    var client=api();
    try{return !!(client&&typeof client.enabled==='function'&&client.enabled());}catch(_){return false;}
  }
  function clean(value){return String(value==null?'':value).trim().replace(/\s+/g,' ');}
  function notify(message,tone){
    if(tone==='success' && root.NuevoAmanecerCanonicalLocalFirst && root.NuevoAmanecerCanonicalLocalFirst.active()){message=String(message).replace(/CONFIRMAD[OA] en CANON|CANON CONFIRMAD[OA]|CONFIRMAD[OA]/g,'guardado localmente')+' · pendiente de sincronización';}

    var fn=null;try{if(typeof toast==='function')fn=toast;}catch(_){}
    if(!fn&&typeof root.toast==='function')fn=root.toast;
    if(typeof fn==='function')fn(message,tone||'error');
  }
  function closeModal(){
    var fn=null;try{if(typeof cerrarModal==='function')fn=cerrarModal;}catch(_){}
    if(!fn&&typeof root.cerrarModal==='function')fn=root.cerrarModal;
    if(typeof fn==='function')fn('mMovInv');
    else root.document.getElementById('mMovInv')?.classList.remove('open');
  }
  function renderViews(){
    ['invRender','posRender','updateDashboard'].forEach(function(name){
      var fn=root[name];if(typeof fn==='function')fn.call(root);
    });
  }
  function movementContext(){
    var productId=null,type=null;
    try{if(typeof invMovId!=='undefined'&&invMovId!=null)productId=String(invMovId);}catch(_){}
    try{if(typeof invMovT!=='undefined'&&invMovT!=null)type=String(invMovT);}catch(_){}
    return{productId:clean(productId),type:clean(type).toLowerCase()};
  }
  function userLocked(){
    try{if(typeof securityIsLocked==='function'&&securityIsLocked())return true;}catch(_){}
    try{
      if(typeof storage!=='undefined'&&typeof LOCK_KEYS!=='undefined'&&storage&&LOCK_KEYS){
        if(storage.getItem(LOCK_KEYS.master)==='true'||storage.getItem(LOCK_KEYS.readOnly)==='true')return true;
        var key=LOCK_KEYS.modules&&LOCK_KEYS.modules.productos;
        if(key&&storage.getItem(key)==='true')return true;
      }
    }catch(_){}
    return false;
  }
  function pendingRecord(){
    var client=api();
    if(!client||typeof client.pendingSnapshot!=='function')return null;
    try{return client.pendingSnapshot();}catch(_){return{command:'unknown',invalid:true};}
  }
  async function refreshCanonical(){
    var client=api();
    if(!client||typeof client.refresh!=='function')throw new Error('CANONICAL_CLIENT_UNAVAILABLE');
    return client.refresh();
  }
  function pendingMessage(error){
    var pending=pendingRecord(),code=clean(error&&error.message);
    if(pending&&pending.command==='inventory.adjust'&&!pending.invalid){
      if(pending.last_error)return 'CANON rechazó el movimiento ('+clean(pending.last_error)+'). No se modificó el stock.';
      return 'El movimiento se envió pero CANON no confirmó la recepción ('+code+'). Pulsa Guardar nuevamente para reintentar la MISMA operación.';
    }
    return 'No se registró el movimiento CANON'+(code?': '+code:'');
  }
  async function afterCommit(receipt,replayed){
    closeModal();
    var operation=clean(receipt&&receipt.operation_id);
    try{
      await refreshCanonical();
      renderViews();
      var label=receipt&&receipt.movement_type==='ENTRADA'?'📥 Entrada':'📤 Salida';
      notify((replayed?'Se confirmó el movimiento CANON pendiente. ':label+' registrada. ')+
        'Stock: '+String(receipt&&receipt.stock_after!=null?receipt.stock_after:'—'),'success');
    }catch(error){
      notify('Movimiento CONFIRMADO en CANON (operación '+operation+'). No se pudo actualizar la vista: '+
        clean(error&&error.message)+'. NO vuelvas a guardarlo; recarga la pantalla.','success');
    }
    return true;
  }

  async function save(){
    if(!enabled()||busy)return false;
    if(userLocked()){notify('Módulo de productos bloqueado','error');return false;}

    var ctx=movementContext();
    var quantity=Number(root.document.getElementById('mMovCant')?.value);
    if(!ctx.productId||!['entrada','salida'].includes(ctx.type)){notify('No se encontró el movimiento de inventario','error');return false;}
    if(!Number.isSafeInteger(quantity)||quantity<=0){notify('Ingresa una cantidad válida','error');return false;}

    var client=api(),pending=pendingRecord();
    if(pending){
      if(pending.command!=='inventory.adjust'||pending.invalid){
        notify('Hay otra operación CANON pendiente ('+clean(pending.command)+'). Resuélvela antes de mover inventario.','error');
        return false;
      }
      if(pending.last_error&&typeof client.discardRejectedInventory==='function'){
        try{
          if(await client.discardRejectedInventory()){
            notify('El movimiento anterior fue rechazado por CANON ('+clean(pending.last_error)+'). No se modificó el stock; corrige los datos y vuelve a intentar.','error');
            return false;
          }
        }catch(_){}
      }
    }

    var button=root.document.querySelector('#mMovInv .mbtn-ok, #mMovInv .mbtn-primary');
    var label=button?.textContent||'Guardar movimiento';
    busy=true;if(button){button.disabled=true;button.textContent='Procesando…';}
    try{
      if(pending){
        var replay;
        try{replay=await client.retryPending();}catch(error){notify(pendingMessage(error),'error');return false;}
        return await afterCommit(replay,true);
      }

      try{await refreshCanonical();}
      catch(error){notify('No se registró el movimiento: CANON no disponible ('+clean(error&&error.message)+')','error');return false;}

      if(!client||typeof client.adjustInventory!=='function'){notify('No se registró el movimiento: CANONICAL_INVENTORY_UNAVAILABLE','error');return false;}

      var movementType=ctx.type==='entrada'?'ENTRADA':'SALIDA';
      var receipt;
      try{
        receipt=await client.adjustInventory({
          product_id:ctx.productId,
          movement_type:movementType,
          quantity:quantity,
          reason:movementType==='ENTRADA'?'Entrada de inventario: +'+quantity:'Salida de inventario: -'+quantity
        });
      }catch(error){
        var pendingAfter=pendingRecord();
        if(pendingAfter&&pendingAfter.command==='inventory.adjust'&&pendingAfter.last_error&&typeof client.discardRejectedInventory==='function'){
          try{
            if(await client.discardRejectedInventory()){
              notify('CANON rechazó el movimiento ('+clean(pendingAfter.last_error)+'). No se modificó el stock; puedes corregirlo y volver a intentar.','error');
              return false;
            }
          }catch(_){}
        }
        notify(pendingMessage(error),'error');return false;
      }
      return await afterCommit(receipt,false);
    }finally{
      busy=false;if(button){button.disabled=false;button.textContent=label;}
    }
  }

  root.NuevoAmanecerCanonicalInventoryBridge=Object.freeze({
    enabled:enabled,
    save:save,
    busy:function(){return busy;},
    userLocked:userLocked
  });
})(globalThis);
