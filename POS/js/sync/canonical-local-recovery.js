(function(root){
  'use strict';
  // Recovery replaces a local baseline only after owner authorization, a
  // verified export and a final sequence check. Cloud is never auto-restored.
  async function restoreCloud(options){
    if(!options || options.confirmed!==true)throw new Error('OWNER_CONFIRMATION_REQUIRED');
    var store=root.NuevoAmanecerCanonicalLocalStore,hooks=root.NuevoAmanecerCanonicalLocalHooks,engine=root.NuevoAmanecerCanonicalLocalFirst;
    if(!options.backup || !options.backup.backup || await store.hash(options.backup.backup)!==options.backup.digest)throw new Error('VERIFIED_LOCAL_BACKUP_REQUIRED');
    await engine.pause();
    try{
      var response=await root.fetch(hooks.binding().endpoint+'/auth/local-writer',{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{authorization:'Bearer '+hooks.session().token,'content-type':'application/json','x-activation-secret':String(options.ownerSecret||'')},body:'{}'});
      var grant=await response.json();if(!response.ok || grant.writer!==true)throw new Error(grant.error||'OWNER_AUTHORIZATION_REQUIRED');
      var snapshot=await hooks.readRemote({ignoreCache:true});
      var state=await store.restoreCloud(snapshot,grant,{confirmed:true,backup:options.backup});
      await engine.boot();hooks.publish(state);return state;
    }finally{engine.resume();}
  }
  root.NuevoAmanecerCanonicalLocalRecovery=Object.freeze({restoreCloud:restoreCloud,exportBackup:function(){return root.NuevoAmanecerCanonicalLocalStore.exportBackup();}});
  function mount(){
    var api=root.NuevoAmanecerCanonical,anchor=root.document.getElementById('saveStatus');
    if(!api || !api.enabled() || !anchor || root.document.getElementById('naLocalWork'))return;
    var button=root.document.createElement('button');button.id='naLocalWork';button.type='button';button.textContent='Activar este equipo para ventas';anchor.parentNode.appendChild(button);
    button.addEventListener('click',async function(){
      var engine=root.NuevoAmanecerCanonicalLocalFirst,local=engine.active(),state=null,corrupt=false;
      try{state=await root.NuevoAmanecerCanonicalLocalStore.read();if(state)local=true;}catch(error){local=true;corrupt=true;}
      var restoring=local && !(state && (state.writer_released || state.cloud.state==='AUTHORITY_CHANGED'));
      var dialog=root.document.createElement('dialog'),busy=false,backup=null;
      function node(tag,text){var e=root.document.createElement(tag);e.textContent=text||'';dialog.appendChild(e);return e;}
      node('h2',restoring?'Datos de esta sesión':'Activar este equipo para ventas');
      node('p',local?'Tus operaciones siguen guardadas en este dispositivo. La nube se sincroniza en segundo plano.':'Este dispositivo guardará las operaciones sin conexión y las sincronizará en segundo plano. Se requiere autorización del propietario.');
      if(corrupt)node('p','No se pudo validar la copia local. Conserva un archivo de evidencia antes de restaurar desde la nube.');
      if(local){
        if(state)node('p',state.projection.sales.length+' ventas · '+state.events.length+' operaciones pendientes de sincronización');
        var review=(state?state.migration.evidence:[]).filter(function(e){return e.state==='NEEDS_REVIEW';});
        if(review.length){node('p','Hay pendientes anteriores que requieren revisión. Se conservan sus datos y operaciones originales.');review.forEach(function(e){node('p',String(e.operation_id)+' · '+String(e.command||e.record && e.record.command||'venta')+' · requiere revisión');});}
        if(state && state.cloud.state==='CLOUD_RECOVERY_REQUIRED')node('p','La copia de la nube requiere recuperación. Puedes seguir trabajando localmente. La nube no se reemplaza automáticamente.');
        var download=node('button','Descargar respaldo local');download.type='button';
        download.addEventListener('click',async function(){
          backup=await root.NuevoAmanecerCanonicalLocalStore[corrupt?'exportRecoveryEvidence':'exportBackup']();
          var blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=root.document.createElement('a');link.href=url;link.download='nuevo-amanecer-local-'+new Date().toISOString().slice(0,10)+'.json';link.click();root.setTimeout(function(){URL.revokeObjectURL(url);},1000);status.textContent='Respaldo preparado. Guarda el archivo antes de continuar.';
        });
      }
      var label=node('label','Autorización del propietario'),secret=root.document.createElement('input');secret.type='password';secret.autocomplete='off';secret.setAttribute('aria-label','Autorización del propietario');label.appendChild(secret);
      var consent=null;
      if(restoring){var warning=node('label','Ya guardé el respaldo y autorizo reemplazar los datos de este dispositivo con la copia validada de la nube. ');consent=root.document.createElement('input');consent.type='checkbox';warning.prepend(consent);}
      var cloudBehind=state && state.cloud.state==='CLOUD_RECOVERY_REQUIRED';
      if(cloudBehind)node('p','La nube contiene una copia anterior. Conserva el respaldo local y solicita la recuperación de Turso mediante el procedimiento oficial; restaurar este dispositivo desde esa copia está bloqueado.');
      var submit=node('button',restoring?'Restaurar este dispositivo desde la nube':'Activar este equipo para ventas'),cancel=node('button',local?'Seguir trabajando':'Cancelar'),status=node('p');submit.disabled=!!cloudBehind;submit.type='button';cancel.type='button';status.setAttribute('role','status');
      function message(error){var code=String(error.message||error);return code==='LOCAL_WRITER_PENDING_OPERATIONS'?'Hay operaciones pendientes. Sincronízalas antes de cambiar.':code==='writer_handover_required'?'Termina la sesión de ventas en el otro equipo antes de cambiar.':code==='LOCAL_WRITER_RELEASE_REQUIRES_NETWORK'?'Conecta este equipo para terminar la sesión de ventas.':'No se completó la operación: '+code;}
      if(state && !state.writer_released && !corrupt){
        var finish=node('button','Terminar sesión de ventas');finish.type='button';
        finish.addEventListener('click',async function(){if(busy)return;busy=true;finish.disabled=true;submit.disabled=true;cancel.disabled=true;status.textContent='Sincronizando pendientes…';try{await engine.finishSession();secret.value='';closeAfterRelease();}catch(error){status.textContent=message(error);}finally{busy=false;finish.disabled=false;submit.disabled=!!cloudBehind;cancel.disabled=false;}});
        function closeAfterRelease(){button.textContent='Activar este equipo para ventas';dialog.close();dialog.remove();}
      }
      function close(){if(busy)return;dialog.close();dialog.remove();}
      cancel.addEventListener('click',close);dialog.addEventListener('cancel',function(event){if(busy)event.preventDefault();else dialog.remove();});
      submit.addEventListener('click',async function(){
        if(busy || cloudBehind)return;
        if(restoring && (!backup || !consent.checked)){status.textContent='Guarda el respaldo y confirma el reemplazo antes de restaurar.';return;}
        var ownerSecret=secret.value;secret.value='';busy=true;submit.disabled=true;cancel.disabled=true;status.textContent=restoring?'Validando y restaurando…':'Activando esta sesión…';
        try{
          if(restoring)await restoreCloud({confirmed:true,ownerSecret:ownerSecret,backup:backup});else await api.enableLocalFirst(ownerSecret);
          status.textContent=restoring?'Dispositivo restaurado desde la copia validada de la nube.':'Este equipo está activo para ventas.';
          button.textContent='Datos locales';
        }catch(error){status.textContent=message(error);}
        finally{ownerSecret='';busy=false;submit.disabled=false;cancel.disabled=false;}
      });
      root.document.body.appendChild(dialog);dialog.showModal();
    });
    root.addEventListener('na:canonical-updated',function(){var state=api.sourceState();button.textContent=state.sync_state==='AUTHORITY_CHANGED' || state.source!=='local'?'Activar este equipo para ventas':state.review_pending?'Revisar pendientes':state.sync_state==='CLOUD_RECOVERY_REQUIRED'?'Revisar respaldo':'Datos locales';});
  }
  if(root.document && typeof root.document.addEventListener==='function')root.document.addEventListener('DOMContentLoaded',mount);
})(globalThis);
