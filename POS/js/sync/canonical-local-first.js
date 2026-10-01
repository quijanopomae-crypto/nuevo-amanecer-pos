(function(root){
  'use strict';
  // One V10 snapshot, one small FIFO, unchanged canonical command envelopes.
  var active=false,migrating=false,paused=false,running=null,timer=null,retry=1000;
  function store(){return root.NuevoAmanecerCanonicalLocalStore;}
  function hooks(){return root.NuevoAmanecerCanonicalLocalHooks;}
  function fail(code){throw new Error(code);}
  function headers(){return {authorization:'Bearer '+hooks().session().token};}
  async function request(path,options){
    var controller=new root.AbortController(),timeout=root.setTimeout(function(){controller.abort();},15000);
    try{var response=await root.fetch(hooks().binding().endpoint+path,Object.assign({credentials:'omit',redirect:'error',cache:'no-store',headers:headers(),signal:controller.signal},options||{}));
      var body=await response.json();return {response:response,body:body};
    }finally{root.clearTimeout(timeout);}
  }
  function businessProof(s){
    var fields={customers:['customer_id','name','document','phone','address','color','total_purchases_cents','credit_policy_mode','credit_policy_manual_limit_cents','credit_policy_revision'],products:['product_id','current_stock_quantity','stock_revision'],credits:['credit_id','provenance','current_balance_cents','revision'],sales:['sale_id','operation_id','customer_id','total_cents','payment_method'],saleItems:['sale_id','line_number','product_id','quantity','unit_price_cents','line_total_cents'],cashSessions:['session_id','open_operation_id','close_operation_id','opening_cents','expected_cents','status','revision','counted_cents','difference_cents'],creditAccounts:['customer_id','account_id','name','mode'],expenses:['expense_id','operation_id','amount_cents','payment_method','cash_delta_cents'],financialEvents:['operation_id','credit_id','credit_delta_cents','cash_delta_cents','compensates_operation_id']};
    var proof={};Object.keys(fields).forEach(function(table){proof[table]=(s[table]||[]).map(function(row){return fields[table].map(function(key){return key==='credit_policy_revision'?Number(row[key]||0):row[key]==null?null:row[key];});}).sort(function(a,b){return JSON.stringify(a).localeCompare(JSON.stringify(b));});});return proof;
  }
  async function checkCloud(state){
    try{return await checkCloudProof(state);}catch(error){
      if(String(error.message)!=='STALE_AUTHORITY_BINDING')throw error;
      state=await store().update('authority-changed',function(s){s.cloud.state='AUTHORITY_CHANGED';});hooks().publish(state);return {state:'AUTHORITY_CHANGED'};
    }
  }
  async function checkCloudProof(state){
    if(['CLOUD_RECOVERY_REQUIRED','AUTHORITY_CHANGED','CONFLICT'].includes(state.cloud.state))return {state:state.cloud.state};
    var status=await request('/read/canonical/status');if(!status.response.ok)fail('CANONICAL_READ_'+status.response.status);
    hooks().verify(status.body,hooks().binding());
    if(status.body.write_authorized===false)fail('STALE_AUTHORITY_BINDING');
    if(!Number.isSafeInteger(status.body.financial_revision)||status.body.financial_revision<0)fail('INVALID_CANONICAL_STATUS');
    var condition=status.body.financial_revision<state.cloud.known_financial_revision?'CLOUD_RECOVERY_REQUIRED':status.body.financial_revision>state.cloud.known_financial_revision?'CONFLICT':null;
    if(!condition){
      var remote=await hooks().readRemote(),current=await store().read();
      if(current.sequence!==state.sequence||current.events.length)return {state:current.cloud.state};
      if(await store().hash(businessProof(remote))!==await store().hash(businessProof(state.baseline.snapshot)))condition='CLOUD_RECOVERY_REQUIRED';
    }
    if(condition){state=await store().update('cloud-proof',function(s){s.cloud.state=condition;});hooks().publish(state);}
    return {state:state.cloud.state};
  }
  var PROOF='na_canonical_local_writer_session';
  async function authorize(state,refreshProof){
    var sessionHash=await store().hash(hooks().session().token),proof;
    try{proof=JSON.parse(root.sessionStorage.getItem(PROOF)||'null');}catch(_){}
    if(proof && proof.grant_id===state.grant.grant_id && proof.session_hash===sessionHash)return;
    if(!refreshProof || root.navigator.onLine===false)fail('LOCAL_WRITER_SESSION_REVALIDATION_REQUIRED');
    var grant=await request('/auth/local-writer');
    if(!grant.response.ok || grant.body.writer!==true || grant.body.writer_id!==state.grant.writer_id || grant.body.grant_id!==state.grant.grant_id)fail('LOCAL_WRITER_SESSION_CHANGED');
    var raw=JSON.stringify({grant_id:state.grant.grant_id,session_hash:sessionHash});
    root.sessionStorage.setItem(PROOF,raw);if(root.sessionStorage.getItem(PROOF)!==raw)fail('LOCAL_WRITER_PROOF_NOT_DURABLE');
  }
  async function boot(){
    var state=await store().read();if(!state || state.migration.complete!==true)return false;
    await authorize(state,true);active=true;hooks().publish(state);schedule();return true;
  }
  async function enable(secret){
    return root.navigator.locks.request('na-canonical-sale-outbox',{mode:'exclusive'},function(){return root.navigator.locks.request('na-canonical-financial-writer',{mode:'exclusive'},function(){return enableLocked(secret);});});
  }
  async function enableLocked(secret){
    var existing=await store().read();
    if(existing && !existing.writer_released && existing.cloud.state!=='AUTHORITY_CHANGED'){
      if(await boot())return root.NuevoAmanecerCanonical.snapshot();
    }
    if(existing && (existing.events.length || existing.migration.evidence.some(function(e){return e.state==='NEEDS_REVIEW';})))fail('LOCAL_WRITER_PENDING_OPERATIONS');
    var previous=root.NuevoAmanecerCanonical.pendingSnapshot();
    var legacy=root.NuevoAmanecerCanonicalSaleOutbox;
    var intents=legacy && legacy.snapshot ? legacy.snapshot().intents : [];
    var grant=await request('/auth/local-writer',{method:'POST',headers:Object.assign(headers(),{'content-type':'application/json','x-activation-secret':String(secret||'')}),body:'{}'});
    if(!grant.response.ok || grant.body.writer!==true)fail(grant.body.error||'LOCAL_WRITER_NOT_GRANTED');
    var snapshot=await hooks().readRemote({ignoreCache:true});
    var state=existing ? await store().activateSession(snapshot,grant.body) : await store().initialize(snapshot,grant.body);await authorize(state,true);
    if(existing){active=true;paused=false;hooks().publish(state);schedule();return root.NuevoAmanecerCanonical.snapshot();}
    active=true;migrating=true;
    try{
      var evidence=[],journalState=null;
      if(previous){
        var resources=root.NuevoAmanecerCanonicalLocalReducer.resources(previous.command,previous.payload,snapshot);
        var item={source:'legacy-command-journal',operation_id:previous.payload.operation_id,state:'NEEDS_REVIEW',resources:resources,record:previous};
        try{
          if(JSON.stringify(previous.binding)!==JSON.stringify(hooks().binding()))fail('LEGACY_AUTHORITY_REQUIRES_REVIEW');
          var known=Object.keys(snapshot).some(function(k){return Array.isArray(snapshot[k]) && snapshot[k].some(function(row){return [row.operation_id,row.open_operation_id,row.close_operation_id].includes(previous.payload.operation_id);});});
          if(previous.command==='customer.credit-policy.set'){var customer=snapshot.customers.find(function(c){return c.customer_id===previous.payload.customer_id;});known=known || !!(customer && customer.credit_policy_revision===previous.payload.expected_policy_revision+1 && customer.credit_policy_mode===previous.payload.mode);}
          if(known){
            var verified=await request(previous.route,{method:'POST',headers:Object.assign(headers(),{'content-type':'application/json'}),body:JSON.stringify(previous.payload)});
            if(!verified.response.ok || !hooks().validReceipt(previous,verified.body))fail('LEGACY_RECEIPT_REQUIRES_REVIEW');
            item.state='CONFIRMED';item.receipt=verified.body;
          }else{
            var part={binding:previous.binding,command:previous.command,route:previous.route,payload:previous.payload,receipt_ids:previous.receipt_ids||{}};
            if(previous.batch_credit_provenance)part.batch_credit_provenance=previous.batch_credit_provenance;
            var original=intents.find(function(i){return i.operation_id===previous.payload.operation_id;});
            var identity=original ? {operation_id:original.operation_id,input_hash:await store().hash(original)} : null;
            await store().commit(function(){return {command:previous.command,payload:previous.payload,envelope:{parts:[part],receipts:[]}};},identity);
            item.state='MIGRATED';
          }
        }catch(error){item.error=String(error.message||error);}
        journalState=item.state;evidence.push(item);
      }
      intents.forEach(function(intent){
        var resource=root.NuevoAmanecerCanonicalLocalReducer.resources('sale.create',intent,snapshot);
        var matched=previous && previous.payload.operation_id===intent.operation_id;
        evidence.push({source:'legacy-sale-outbox',operation_id:intent.operation_id,state:matched && journalState!=='NEEDS_REVIEW'?journalState:'NEEDS_REVIEW',resources:resource,intent:intent});
      });
      state=await store().update('legacy-migration',function(s){s.migration={complete:true,evidence:evidence};});
      migrating=false;hooks().publish(state);schedule();return root.NuevoAmanecerCanonical.snapshot();
    }catch(error){active=false;migrating=false;throw error;}
  }
  async function commit(command,input){
    if(migrating)fail('LOCAL_SETUP_IN_PROGRESS');
    await authorize(await store().read(),false);
    var identity=command==='sale.create' && input && input.version===1 ? {operation_id:input.operation_id,input_hash:await store().hash(input)} : null;
    var result=await store().commit(function(projection){return hooks().build(command,input,projection);},identity);
    hooks().publish(result.state);schedule();return result.receipt;
  }
  async function finishSession(){
    var state=await store().read();if(!state)fail('LOCAL_BASELINE_REQUIRED');
    if(root.navigator.onLine===false){if(state.events.length)fail('LOCAL_WRITER_PENDING_OPERATIONS');fail('LOCAL_WRITER_RELEASE_REQUIRES_NETWORK');}
    var wasPaused=paused;paused=false;
    try{
      if(!state.writer_released)await sync();
      paused=true;if(timer){root.clearTimeout(timer);timer=null;}if(running)await running;
      state=await store().update('writer-release',function(s){
        if(s.events.length || s.migration.evidence.some(function(e){return e.state==='NEEDS_REVIEW';}))fail('LOCAL_WRITER_PENDING_OPERATIONS');
        if(!s.writer_released && s.cloud.state!=='UP_TO_DATE')fail('LOCAL_WRITER_PENDING_OPERATIONS');
        s.writer_released=true;s.cloud.state='AUTHORITY_CHANGED';
      });
      // Freeze durably before releasing remotely, including a lost release ACK.
      hooks().publish(state);
      var released=await request('/auth/local-writer',{method:'POST',headers:Object.assign(headers(),{'content-type':'application/json'}),body:JSON.stringify({release:true,grant_id:state.grant.grant_id})});
      if(!released.response.ok || released.body.released!==true)fail(released.body.error||'LOCAL_WRITER_RELEASE_UNCONFIRMED');
      return {released:true};
    }catch(error){paused=wasPaused;schedule();throw error;}
  }
  async function refresh(){var state=await store().read();hooks().publish(state);schedule();return root.NuevoAmanecerCanonical.snapshot();}
  function schedule(){
    if(!active || paused || timer || root.navigator.onLine===false)return;
    timer=root.setTimeout(function(){timer=null;sync().catch(function(){});},retry);
  }
  async function sync(){
    if(paused)return {state:'PAUSED'};
    if(!active || root.navigator.onLine===false)return {state:'OFFLINE'};
    if(running)return running;
    running=root.navigator.locks.request('na-canonical-local-sync',{mode:'exclusive'},async function(){
      var state=await store().read();
      if(!state.events.length)return checkCloud(state);
      while(state.events.length){
        if(paused)return {state:'PAUSED'};
        var head=state.events[0];
        if(['REJECTED','CONFLICT','NEEDS_REVIEW'].includes(head.state) || ['CLOUD_RECOVERY_REQUIRED','AUTHORITY_CHANGED'].includes(state.cloud.state))return {state:state.cloud.state};
        // Status is mandatory before replay; it never enters the local commit.
        try {
          var status=await request('/read/canonical/status');
          if(!status.response.ok)fail('CANONICAL_READ_'+status.response.status);
          hooks().verify(status.body,hooks().binding());
          if(status.body.write_authorized===false)fail('STALE_AUTHORITY_BINDING');
          if(!Number.isSafeInteger(status.body.financial_revision) || status.body.financial_revision<0)fail('INVALID_CANONICAL_STATUS');
          if(status.body.mode!=='ACTIVE')fail('CANONICAL_COMMERCE_CLOSED');
          if(status.body.financial_revision<state.cloud.known_financial_revision){
            state=await store().update('cloud-loss',function(s){s.cloud.state='CLOUD_RECOVERY_REQUIRED';});hooks().publish(state);return {state:'CLOUD_RECOVERY_REQUIRED'};
          }
          var binding=hooks().binding();
          state=await store().update('send',function(s){var e=s.events[0];if(!e.envelope)fail('LOCAL_ENVELOPE_MISSING');e.attempts+=1;e.state='SYNCING';});
          head=state.events[0];
          for(var index=head.envelope.receipts.length;index<head.envelope.parts.length;index++){
            var part=head.envelope.parts[index];
            var sent=await request(part.route,{method:'POST',headers:Object.assign(headers(),{'content-type':'application/json'}),body:JSON.stringify(part.payload)});
            if(!sent.response.ok){
              var blocked=sent.response.status>=400 && sent.response.status<500;
              state=await store().update('send-error',function(s){var e=s.events[0];e.last_error=sent.body.error||'HTTP_'+sent.response.status;e.state=blocked?'CONFLICT':'LOCAL_COMMITTED';s.cloud.state=blocked?'CONFLICT':'LOCAL_COMMITTED';});hooks().publish(state);
              if(!blocked){retry=Math.min(retry*2,60000);schedule();}return {state:state.cloud.state};
            }
            if(!hooks().validReceipt(part,sent.body))fail('INVALID_CANONICAL_RECEIPT');
            var receiptHash=await store().hash(sent.body);
            state=await store().update('part-ack',function(s){s.events[0].envelope.receipts.push(sent.body);s.events[0].receipt_hashes.push(receiptHash);});
          }
          var receipt=head.command==='payment.batch'?{operation_id:head.operation_id,status:'created',command:head.command,receipts:state.events[0].envelope.receipts.reduce(function(all,r){return all.concat(r.receipts);},[])}:state.events[0].envelope.receipts[0];
          state=await store().ack(head.operation_id,receipt);hooks().publish(state);retry=1000;
        }catch(error){
          if(String(error.message)==='STALE_AUTHORITY_BINDING'){state=await store().update('authority-changed',function(s){s.cloud.state='AUTHORITY_CHANGED';});hooks().publish(state);return {state:'AUTHORITY_CHANGED'};}
          state=await store().update('send-uncertain',function(s){s.events[0].last_error=String(error.message||error);s.events[0].state='LOCAL_COMMITTED';s.cloud.state='LOCAL_COMMITTED';});hooks().publish(state);retry=Math.min(retry*2,60000);schedule();return {state:'LOCAL_COMMITTED'};
        }
      }
      return checkCloud(state);
    });
    try{return await running;}finally{running=null;var latest=await store().read();if(latest.events.length && !['CONFLICT','CLOUD_RECOVERY_REQUIRED','AUTHORITY_CHANGED'].includes(latest.cloud.state))schedule();}
  }
  root.addEventListener('online',schedule);
  root.addEventListener('na:v10-commit',function(){if(active && !migrating)refresh().catch(function(){});});
  root.NuevoAmanecerCanonicalLocalFirst=Object.freeze({finishSession:finishSession,pause:async function(){paused=true;if(timer){root.clearTimeout(timer);timer=null;}if(running)await running;},resume:function(){paused=false;schedule();},migrating:function(){return migrating;},active:function(){return active;},boot:boot,enable:enable,commit:commit,refresh:refresh,sync:sync});
})(globalThis);
