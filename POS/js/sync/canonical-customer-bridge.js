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
    if(typeof fn==='function')fn('mCli');
    else root.document.getElementById('mCli')?.classList.remove('open');
  }
  function renderViews(){
    ['cliRender','posRender','updateDashboard'].forEach(function(name){
      var fn=root[name];
      if(typeof fn==='function')try{fn.call(root);}catch(_){}
    });
  }
  function userLocked(){
    try{if(typeof securityIsLocked==='function'&&securityIsLocked())return true;}catch(_){}
    try{
      if(typeof storage!=='undefined'&&typeof LOCK_KEYS!=='undefined'&&storage&&LOCK_KEYS){
        if(storage.getItem(LOCK_KEYS.master)==='true'||storage.getItem(LOCK_KEYS.readOnly)==='true')return true;
        var key=LOCK_KEYS.modules&&LOCK_KEYS.modules.clientes;
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
    if(pending&&pending.command==='customer.create'&&!pending.invalid){
      if(pending.last_error)return 'CANON rechazó el cliente ('+clean(pending.last_error)+'). No se creó ningún cliente.';
      return 'El cliente se envió pero CANON no confirmó la recepción ('+code+'). Pulsa Guardar nuevamente para reintentar la MISMA operación.';
    }
    return 'No se registró el cliente CANON'+(code?': '+code:'');
  }
  function value(id){return root.document.getElementById(id)?.value;}
  function currentCustomers(){
    var client=api();
    try{
      var snapshot=client&&typeof client.snapshot==='function'?client.snapshot():null;
      return Array.isArray(snapshot?.customers)?snapshot.customers:[];
    }catch(_){return[];}
  }
  function buildInput(){
    var name=clean(value('cNombre')),documentId=clean(value('cDni')),phone=clean(value('cTel')),address=clean(value('cDir'));
    if(!name){notify('El nombre es obligatorio','error');return null;}
    if(name.length>240||documentId.length>32||phone.length>64||address.length>500){
      notify('Uno de los datos del cliente es demasiado largo','error');return null;
    }
    if(documentId){
      var duplicate=currentCustomers().find(function(customer){
        return clean(customer.document).toLowerCase()===documentId.toLowerCase();
      });
      if(duplicate){notify('Ya existe un cliente con ese DNI / RUC','error');return null;}
    }
    return{
      name:name,
      document:documentId||null,
      phone:phone||null,
      address:address||null
    };
  }
  async function afterCommit(receipt,replayed){
    closeModal();
    var operation=clean(receipt&&receipt.operation_id),customerId=clean(receipt&&receipt.customer_id);
    try{
      await refreshCanonical();
      renderViews();
      notify(replayed
        ? 'Se confirmó el cliente CANON pendiente'+(customerId?' ('+customerId+')':'')+'. No se creó un duplicado.'
        : 'Cliente registrado en CANON'+(customerId?' ('+customerId+')':''),'success');
    }catch(error){
      notify('Cliente CONFIRMADO en CANON (operación '+operation+'). No se pudo actualizar la vista: '+
        clean(error&&error.message)+'. NO vuelvas a guardarlo; recarga la pantalla para verlo.','success');
    }
    return true;
  }

  async function save(){
    if(!enabled()||busy)return false;
    if(userLocked()){notify('Módulo de clientes bloqueado','error');return false;}

    var client=api(),pending=pendingRecord();
    if(pending){
      if(pending.command!=='customer.create'||pending.invalid){
        notify('Hay otra operación CANON pendiente ('+clean(pending.command)+'). Resuélvela antes de guardar un cliente.','error');
        return false;
      }
      if(pending.last_error&&typeof client.discardRejectedCustomer==='function'){
        try{
          if(await client.discardRejectedCustomer()){
            notify('El alta anterior fue rechazada por CANON ('+clean(pending.last_error)+'). No se creó ningún cliente; corrige los datos y vuelve a guardar.','error');
            return false;
          }
        }catch(_){}
      }
    }

    var input=pending?null:buildInput();
    if(!pending&&!input)return false;
    var button=root.document.querySelector('#mCli .mbtn-ok');
    var label=button?.textContent||'💾 Guardar';
    busy=true;if(button){button.disabled=true;button.textContent='Procesando…';}
    try{
      if(pending){
        var replay;
        try{replay=await client.retryPending();}catch(error){notify(pendingMessage(error),'error');return false;}
        return await afterCommit(replay,true);
      }

      try{await refreshCanonical();}
      catch(error){notify('No se registró el cliente: CANON no disponible ('+clean(error&&error.message)+')','error');return false;}

      if(!client||typeof client.createCustomer!=='function'){
        notify('No se registró el cliente: CANONICAL_CUSTOMER_UNAVAILABLE','error');return false;
      }

      var receipt;
      try{receipt=await client.createCustomer(input);}
      catch(error){
        var pendingAfter=pendingRecord();
        if(pendingAfter&&pendingAfter.command==='customer.create'&&pendingAfter.last_error&&typeof client.discardRejectedCustomer==='function'){
          try{
            if(await client.discardRejectedCustomer()){
              notify('CANON rechazó el cliente ('+clean(pendingAfter.last_error)+'). No se creó ningún cliente; puedes corregir los datos y volver a intentar.','error');
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

  root.NuevoAmanecerCanonicalCustomerBridge=Object.freeze({
    enabled:enabled,
    save:save,
    busy:function(){return busy;},
    userLocked:userLocked
  });
})(globalThis);
