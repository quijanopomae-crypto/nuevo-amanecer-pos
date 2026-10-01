(function (root) {
  'use strict';
  // V10 is the only database/transaction engine. This activates a canonical
  // payload inside its snapshot; legacy V9 and any dormant V10 data are retained.
  var FIELD = 'canonicalLocalFirst';
  var LOCK = 'na-canonical-local-commit';
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function fail(code) { throw new Error(code); }
  function stable(v) { if (Array.isArray(v)) return v.map(stable); if (v && typeof v === 'object') { var out={}; Object.keys(v).sort().forEach(function(k){out[k]=stable(v[k]);}); return out; } return v; }
  function safe(v) {
    if (v == null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (Array.isArray(v)) return v.every(safe);
    if (typeof v !== 'object' || Object.prototype.toString.call(v) !== '[object Object]') return false;
    return Object.keys(v).every(function(k){ return !/^(?:token|pin|password|secret|credential|credentials|security|api_key|session_token|credential_hash)$/i.test(k) && safe(v[k]); });
  }
  async function hash(value) {
    if (!safe(value)) fail('UNSAFE_LOCAL_BACKUP');
    if (!root.crypto || !root.crypto.subtle) fail('SHA256_REQUIRED');
    var bytes=new TextEncoder().encode(JSON.stringify(stable(value)));
    var digest=await root.crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest)).map(function(n){return n.toString(16).padStart(2,'0');}).join('');
  }
  function requireEngine() {
    if (typeof _naV10ReadCanonical !== 'function' || typeof _naRunCriticalOperation !== 'function') fail('V10_ENGINE_UNAVAILABLE');
  }
  async function lock(work) {
    requireEngine();
    if (!root.navigator.locks || !root.navigator.locks.request) fail('WEB_LOCKS_REQUIRED');
    return root.navigator.locks.request(LOCK,{mode:'exclusive'},work);
  }
  async function rawSnapshot() { requireEngine(); await _naV10PrepareUpgrade(); return _naV10ReadCanonical(); }
  function validateShape(state) {
    if (!state || state.version!==1 || !state.baseline || !state.projection || !state.grant || !Array.isArray(state.events) || !Number.isSafeInteger(state.sequence) || state.sequence<0 || state.events.length!==state.sequence-state.baseline.sequence || !safe(state)) fail('LOCAL_STATE_CORRUPT');
    if (state.baseline.snapshot.promotion_id!==state.grant.promotion_id || state.baseline.snapshot.authority_epoch!==state.grant.authority_epoch) fail('LOCAL_BASELINE_AUTHORITY_CONFLICT');
    var seen=new Set();
    state.events.forEach(function(e,i){
      if (e.sequence!==state.baseline.sequence+i+1 || !e.operation_id || seen.has(e.operation_id) || e.operation_id!==e.payload.operation_id || !['LOCAL_COMMITTED','SYNCING','SYNCED','REJECTED','CONFLICT','NEEDS_REVIEW'].includes(e.state) || !Array.isArray(e.resources) || !e.payload_hash) fail('LOCAL_LEDGER_CORRUPT');
      seen.add(e.operation_id);
    });
  }
  async function validate(state) {
    validateShape(state);
    if (await hash(state.baseline.snapshot)!==state.baseline.digest || await hash(state.projection)!==state.projection_digest) fail('LOCAL_DIGEST_MISMATCH');
    for (var e of state.events) if (await hash({command:e.command,payload:e.payload})!==e.payload_hash) fail('LOCAL_PAYLOAD_CONFLICT');
    return state;
  }
  async function read() {
    var snapshot=await rawSnapshot();
    if (!snapshot || !snapshot.data || !snapshot.data[FIELD]) return null;
    return copy(await validate(snapshot.data[FIELD]));
  }
  function notify(state) {
    try { root.dispatchEvent(new root.CustomEvent('na:local-committed',{detail:{sequence:state.sequence,grant:copy(state.grant)}})); } catch (_) {}
  }
  async function writeSnapshot(current,next,type,operationId,identity) {
    next.projection_digest=await hash(next.projection);
    await validate(next);
    var result=await _naRunCriticalOperation({operationId:operationId,type:type,expectedRevision:current.revision,payload:copy(identity),idempotencyPayload:copy(identity),mutate:function(draft){draft.data[FIELD]=copy(next);return draft.data;}});
    if (!result || !['SUCCESS','ALREADY_COMMITTED'].includes(result.status)) fail(result && result.error && result.error.code || result && result.reason || 'LOCAL_STORAGE_NOT_DURABLE');
    var durable=result.snapshot && result.snapshot.data && result.snapshot.data[FIELD];
    if (!durable) fail('LOCAL_COMMIT_NOT_VERIFIED');
    notify(durable); return copy(durable);
  }
  async function initialize(snapshot,grant) {
    return lock(async function(){
      if (!snapshot || snapshot.authority!=='canonical' || snapshot.mode!=='ACTIVE' || snapshot.read_only!==false || snapshot.minimum_client_contract!=='a6-gate-c-v1' || !grant || !grant.writer_id || !grant.grant_id || grant.promotion_id!==snapshot.promotion_id || grant.authority_epoch!==snapshot.authority_epoch || !safe(snapshot) || !safe(grant)) fail('INVALID_LOCAL_BASELINE');
      var current=await rawSnapshot();
      if (current && current.data && current.data[FIELD]) return copy(await validate(current.data[FIELD]));
      var baselineDigest=await hash(snapshot);
      var state={version:1,baseline:{id:root.crypto.randomUUID(),sequence:0,snapshot:copy(snapshot),digest:baselineDigest,created_at:new Date().toISOString()},grant:copy(grant),projection:copy(snapshot),projection_digest:baselineDigest,sequence:0,events:[],cloud:{known_financial_revision:snapshot.financial_revision || 0,acked_sequence:0,last_ack:null,state:'UP_TO_DATE'},migration:{complete:false,evidence:[]}};
      if (!current) {
        var initial=await _naV10CreateInitialSnapshot({canonicalLocalFirst:state},{type:'CANONICAL_BASELINE',payload:{baseline_digest:baselineDigest}});
        if (!initial || !['SUCCESS','ALREADY_COMMITTED'].includes(initial.status)) fail(initial && initial.error && initial.error.code || 'LOCAL_BASELINE_NOT_DURABLE');
        notify(state);
      } else await writeSnapshot(current,state,'CANONICAL_BASELINE',root.crypto.randomUUID(),{baseline_digest:baselineDigest});
      try { if (root.navigator.storage && root.navigator.storage.persist) root.navigator.storage.persist().catch(function(){}); } catch (_) {}
      return copy(state);
    });
  }
  async function commit(build) {
    return lock(async function(){
      var current=await rawSnapshot(),state=current && current.data && current.data[FIELD];
      if (!state) fail('LOCAL_BASELINE_REQUIRED');
      await validate(state);
      if (state.cloud.state==='AUTHORITY_CHANGED') fail('LOCAL_WRITER_AUTHORITY_CHANGED');
      var requested=typeof build==='function' ? build(copy(state.projection),copy(state)) : build;
      if (!requested || typeof requested.then==='function' || !requested.command || !requested.payload) fail('INVALID_LOCAL_COMMAND');
      var identity={command:requested.command,payload:copy(requested.payload)},payloadHash=await hash(identity);
      var existing=state.events.find(function(e){return e.operation_id===requested.payload.operation_id;});
      if (!existing) {
        var prior=await _naV10GetOperation(requested.payload.operation_id);
        if (prior && prior.status==='COMMITTED' && prior.type==='CANONICAL_LOCAL_COMMAND') {
          if (await hash(prior.payload)!==payloadHash) fail('LOCAL_OPERATION_ID_CONFLICT');
          var checkpoint=await _naV10GetCheckpoint(prior.checkpointKey);
          if (!checkpoint || checkpoint.operationId!==prior.operationId || checkpoint.commitId!==prior.commitId || checkpoint.revision!==prior.committedRevision || !checkpoint.snapshot || checkpoint.snapshot.lastOperationId!==prior.operationId || checkpoint.snapshot.commitId!==prior.commitId) fail('LOCAL_COMMIT_EVIDENCE_MISSING');
          var archived=checkpoint.snapshot.data && checkpoint.snapshot.data[FIELD];
          await validate(archived);
          var committed=archived.events.find(function(e){return e.operation_id===requested.payload.operation_id;});
          if (!committed || committed.payload_hash!==payloadHash) fail('LOCAL_COMMIT_EVIDENCE_MISSING');
          return {state:copy(state),receipt:copy(committed.local_receipt),event:copy(committed),idempotent:true};
        }
      }
      if (existing) { if (existing.payload_hash!==payloadHash) fail('LOCAL_OPERATION_ID_CONFLICT'); return {state:copy(state),receipt:copy(existing.local_receipt),event:copy(existing),idempotent:true}; }
      var reducer=root.NuevoAmanecerCanonicalLocalReducer;
      if (!reducer || !reducer.apply) fail('LOCAL_REDUCER_UNAVAILABLE');
      var applied=reducer.apply(state.projection,identity),resources=applied.resources;
      var conflicted=state.events.find(function(e){return ['REJECTED','CONFLICT','NEEDS_REVIEW'].includes(e.state) && e.resources.some(function(r){return resources.includes(r);});});
      if (conflicted) fail('LOCAL_RESOURCE_REQUIRES_REVIEW');
      var next=copy(state),sequence=state.sequence+1;
      if (!Number.isSafeInteger(sequence)) fail('LOCAL_SEQUENCE_OVERFLOW');
      var event={operation_id:requested.payload.operation_id,command:requested.command,payload:copy(requested.payload),payload_hash:payloadHash,sequence:sequence,state:'LOCAL_COMMITTED',created_at:requested.payload.created_at,attempts:0,last_error:null,resources:resources,baseline_id:state.baseline.id,baseline_digest:state.baseline.digest,local_receipt:copy(applied.receipt),envelope:null,receipt:null};
      next.events.push(event);next.sequence=sequence;next.projection=applied.projection;next.cloud.state=next.cloud.state==='CLOUD_RECOVERY_REQUIRED'?'CLOUD_RECOVERY_REQUIRED':'LOCAL_COMMITTED';
      var saved=await writeSnapshot(current,next,'CANONICAL_LOCAL_COMMAND',event.operation_id,identity);
      return {state:saved,receipt:copy(event.local_receipt),event:copy(event),idempotent:false};
    });
  }
  async function update(label,change) {
    return lock(async function(){
      var current=await rawSnapshot(),state=current && current.data && current.data[FIELD];if(!state) fail('LOCAL_BASELINE_REQUIRED');
      await validate(state);var next=copy(state),before=JSON.stringify(next.projection);change(next);
      if (before!==JSON.stringify(next.projection)) fail('REPLICA_METADATA_CANNOT_MUTATE_PROJECTION');
      return writeSnapshot(current,next,'CANONICAL_REPLICA_METADATA',root.crypto.randomUUID(),{label:label,sequence:state.sequence,nonce:root.crypto.randomUUID()});
    });
  }
  async function ack(operationId,receipt) {
    return lock(async function(){
      var current=await rawSnapshot(),state=current && current.data && current.data[FIELD];
      if (!state) fail('LOCAL_BASELINE_REQUIRED');await validate(state);
      var head=state.events[0];
      if (!head || head.operation_id!==operationId) {
        if (state.cloud.last_ack && state.cloud.last_ack.operation_id===operationId) return copy(state);
        fail('LOCAL_OUTBOX_HEAD_CHANGED');
      }
      if (!receipt || receipt.operation_id!==operationId || !['created','already_processed'].includes(receipt.status)) fail('INVALID_LOCAL_ACK');
      var next=copy(state),applied=root.NuevoAmanecerCanonicalLocalReducer.apply(next.baseline.snapshot,{command:head.command,payload:head.payload});
      next.baseline={id:root.crypto.randomUUID(),sequence:head.sequence,snapshot:applied.projection,digest:await hash(applied.projection),created_at:new Date().toISOString()};
      next.events.shift();next.cloud.acked_sequence=head.sequence;next.cloud.last_ack=copy(receipt);
      next.cloud.known_financial_revision=applied.projection.financial_revision || 0;
      next.cloud.state=next.events.length?'LOCAL_COMMITTED':'UP_TO_DATE';
      return writeSnapshot(current,next,'CANONICAL_REPLICA_ACK',root.crypto.randomUUID(),{operation_id:operationId,receipt:copy(receipt)});
    });
  }
  async function reconstruct() {
    var state=await read();if(!state)return null;
    var projection=copy(state.baseline.snapshot);
    state.events.forEach(function(e){projection=root.NuevoAmanecerCanonicalLocalReducer.apply(projection,{command:e.command,payload:e.payload}).projection;});
    if (await hash(projection)!==state.projection_digest) fail('LOCAL_RECONSTRUCTION_CONFLICT');
    return projection;
  }
  async function exportBackup() {
    var state=await read();if(!state)fail('LOCAL_BASELINE_REQUIRED');
    var backup={schema:'nuevo-amanecer.local-first-backup/v1',created_at:new Date().toISOString(),sequence:state.sequence,state:state};
    return {backup:backup,digest:await hash(backup)};
  }
  root.NuevoAmanecerCanonicalLocalStore=Object.freeze({initialize:initialize,read:read,commit:commit,update:update,ack:ack,reconstruct:reconstruct,exportBackup:exportBackup,hash:hash,validate:validate});
})(globalThis);
