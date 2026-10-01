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
    var fn=null;try{if(typeof toast==='function')fn=toast;}catch(_){}
    if(!fn&&typeof root.toast==='function')fn=root.toast;
    if(typeof fn==='function')fn(message,tone||'error');
  }
  function closeModal(){
    var fn=null;try{if(typeof cerrarModal==='function')fn=cerrarModal;}catch(_){}
    if(!fn&&typeof root.cerrarModal==='function')fn=root.cerrarModal;
    if(typeof fn==='function')fn('mLineaCreditoManual');
    else root.document.getElementById('mLineaCreditoManual')?.classList.remove('open');
  }
  function renderViews(customerId){
    ['cliRender','updateDashboard'].forEach(function(name){
      var fn=root[name];if(typeof fn==='function')try{fn.call(root);}catch(_){}
    });
    var open=root.abrirEvaluacionCredito;
    if(typeof open==='function'&&customerId!=null)try{open.call(root,customerId);}catch(_){}
  }
  function pendingRecord(){
    var client=api();
    if(!client||typeof client.pendingSnapshot!=='function')return null;
    try{return client.pendingSnapshot();}catch(_){return{command:'unknown',invalid:true};}
  }
  async function refreshCanonical(){
    var client=api();
    if(!client||typeof client.refresh!=='function'||typeof client.legacySnapshot!=='function')throw new Error('CANONICAL_CLIENT_UNAVAILABLE');
    await client.refresh();
    return client.legacySnapshot();
  }
  function currentCanonicalSnapshot(){
    var client=api(),state=null;
    if(!client||typeof client.legacySnapshot!=='function')throw new Error('CANONICAL_CLIENT_UNAVAILABLE');
    if(typeof client.assertAction==='function')client.assertAction('customer.credit-policy.set');
    if(typeof client.sourceState==='function'){
      state=client.sourceState();
      if(!state||state.validation!=='current')throw new Error('CANONICAL_SNAPSHOT_NOT_CURRENT');
    }
    return client.legacySnapshot();
  }
  function projectConfirmedPolicy(input,receipt){
    var adapter=root.NuevoAmanecerCanonicalUIAdapter;
    var runtime=adapter&&adapter.runtime;
    var rows=runtime&&typeof runtime.customers==='function'?runtime.customers():(Array.isArray(root.clientes)?root.clientes:[]);
    if(!Array.isArray(rows))return false;
    var customer=rows.find(function(row){
      return row&&String(row.id!==undefined?row.id:row.customer_id)===String(input&&input.customer_id);
    });
    if(!customer)return false;
    var mode=clean(receipt&&receipt.mode||input&&input.mode).toUpperCase();
    var manual=mode==='MANUAL';
    var revision=Number(receipt&&receipt.policy_revision);
    if(!Number.isSafeInteger(revision)||revision<0)revision=(Number(customer.lineaCreditoPolicyRevision)||0)+1;
    customer.lineaCreditoPolicyRevision=revision;
    customer.lineaCreditoManualActiva=manual;
    if(manual){
      var cents=Number(receipt&&receipt.manual_limit_cents);
      if(!Number.isSafeInteger(cents)||cents<0)cents=Number(input&&input.manual_limit_cents)||0;
      customer.lineaCreditoManual=cents/100;
      customer.lineaCreditoManualMotivo=clean(input&&input.reason);
      customer.lineaCreditoManualAt=clean(input&&input.created_at)||new Date().toISOString();
      customer.lineaCreditoManualPor=clean(input&&input.administrator_name)||'Propietario';
      customer.lineaCreditoManualPorId=clean(input&&input.administrator_id);
    }else{
      customer.lineaCreditoManual=0;
      customer.lineaCreditoManualMotivo='';
      customer.lineaCreditoManualAt='';
      customer.lineaCreditoManualPor='';
      customer.lineaCreditoManualPorId='';
    }
    return true;
  }
  function reconcileCanonicalInBackground(customerId){
    Promise.resolve().then(refreshCanonical).then(function(){
      renderViews(customerId);
    }).catch(function(){});
  }
  function customerFrom(snapshot,id){
    return (snapshot&&Array.isArray(snapshot.customers)?snapshot.customers:[]).find(function(c){
      return c&&String(c.id!==undefined?c.id:c.customer_id)===String(id);
    })||null;
  }
  function pendingMessage(error){
    var pending=pendingRecord(),code=clean(error&&error.message);
    if(pending&&pending.command==='customer.credit-policy.set'&&!pending.invalid){
      if(pending.last_error)return 'CANON rechazó el cambio de línea ('+clean(pending.last_error)+'). No se modificó la política.';
      return 'El cambio de línea se envió pero CANON no confirmó la recepción ('+code+'). Reintenta la MISMA operación.';
    }
    return 'No se guardó la política de crédito CANON'+(code?': '+code:'');
  }
  async function resolveForeignPending(client,pending){
    if(!pending||pending.command==='customer.credit-policy.set')return pending;
    if(pending.invalid){
      notify('No se cambió la línea: el estado pendiente local no es válido.','error');
      return pending;
    }
    if(pending.last_error){
      notify('No se cambió la línea: la operación anterior '+clean(pending.command)+' fue rechazada ('+clean(pending.last_error)+').','error');
      return pending;
    }
    if(!client||typeof client.retryPending!=='function'){
      notify('No se cambió la línea: no se pudo recuperar automáticamente la operación anterior '+clean(pending.command)+'.','error');
      return pending;
    }
    try{
      await client.retryPending();
    }catch(error){
      var after=pendingRecord(),reason=after&&after.last_error?clean(after.last_error):clean(error&&error.message);
      notify('No se cambió la línea: la operación anterior '+clean(pending.command)+' sigue sin confirmarse'+(reason?' ('+reason+')':'')+'.','error');
      return after||pending;
    }
    return pendingRecord();
  }
  function afterCommit(receipt,replayed,customerId,input){
    closeModal();
    projectConfirmedPolicy(input||{},receipt||{});
    renderViews(customerId);
    notify(replayed
      ? 'Se confirmó el cambio de línea CANON pendiente. No se creó otra operación.'
      : receipt&&receipt.mode==='MANUAL'
        ? 'Línea manual guardada en CANON'
        : 'Se restauró la línea automática en CANON','success');
    reconcileCanonicalInBackground(customerId);
    return true;
  }
  async function commit(input){
    if(!enabled()||busy)return false;
    input=input&&typeof input==='object'?Object.assign({},input):{};
    var client=api(),pending=pendingRecord(),resolvedForeign=false;

    busy=true;
    try{
      if(pending&&pending.command!=='customer.credit-policy.set'){
        pending=await resolveForeignPending(client,pending);
        if(pending)return false;
        resolvedForeign=true;
      }

      if(pending&&pending.last_error&&typeof client.discardRejectedCustomerCreditPolicy==='function'){
        try{
          if(await client.discardRejectedCustomerCreditPolicy()){
            try{await refreshCanonical();}catch(_){}
            notify('El cambio anterior fue rechazado por CANON ('+clean(pending.last_error)+'). La vista se actualizó; revisa los datos y vuelve a intentar.','error');
            return false;
          }
        }catch(_){}
      }

      if(pending){
        var replay;
        try{replay=await client.retryPending();}catch(error){notify(pendingMessage(error),'error');return false;}
        return afterCommit(replay,true,pending.payload&&pending.payload.customer_id,pending.payload);
      }

      var snapshot;
      try{
        snapshot=resolvedForeign?await refreshCanonical():currentCanonicalSnapshot();
      }catch(error){
        try{snapshot=await refreshCanonical();}
        catch(refreshError){notify('No se guardó la línea: CANON no disponible ('+clean(refreshError&&refreshError.message)+')','error');return false;}
      }

      var customer=customerFrom(snapshot,input.customer_id);
      if(!customer){notify('No se encontró el cliente CANON','error');return false;}
      if(!client||typeof client.setCustomerCreditPolicy!=='function'){
        notify('No se guardó la línea: CANONICAL_CUSTOMER_CREDIT_POLICY_UNAVAILABLE','error');return false;
      }

      input.customer_id=String(customer.id!==undefined?customer.id:customer.customer_id);
      input.expected_policy_revision=Number(customer.lineaCreditoPolicyRevision)||0;

      var receipt;
      try{receipt=await client.setCustomerCreditPolicy(input);}
      catch(error){
        var rejected=pendingRecord();
        if(rejected&&rejected.command==='customer.credit-policy.set'&&rejected.last_error&&typeof client.discardRejectedCustomerCreditPolicy==='function'){
          try{
            if(await client.discardRejectedCustomerCreditPolicy()){
              try{await refreshCanonical();}catch(_){}
              notify('CANON rechazó el cambio ('+clean(rejected.last_error)+'). No se modificó la línea; revisa la ficha y vuelve a intentar.','error');
              return false;
            }
          }catch(_){}
        }
        notify(pendingMessage(error),'error');return false;
      }
      return afterCommit(receipt,false,input.customer_id,input);
    }finally{busy=false;}
  }

  // Called by guardarLineaCreditoManual after amount validation; audit metadata is generated by the owner UI.
  function saveManual(input){
    input=Object.assign({},input,{mode:'MANUAL'});
    return commit(input);
  }
  // Called by restaurarLineaCreditoAutomatica with owner-generated audit metadata.
  function restoreAutomatic(input){
    input=Object.assign({},input,{mode:'AUTOMATIC',manual_limit_cents:null});
    return commit(input);
  }

  root.NuevoAmanecerCanonicalCustomerCreditPolicyBridge=Object.freeze({
    enabled:enabled,
    saveManual:saveManual,
    restoreAutomatic:restoreAutomatic,
    busy:function(){return busy;}
  });
})(globalThis);
