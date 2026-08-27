
/* =====================================================================================
   MODULO DE CAJA V10 — GASTOS / CASH_IN / CASH_OUT (DORMANTE, NO CONECTADO A V9)
   ===================================================================================== */

function _naV10CashIdempotencyPayload(payload){
  if(!payload||typeof payload!=='object')return _naV10Clone(payload??null);
  const excluded=new Set(['operationId','logicalOperationId','attemptId','rebaseOf','expectedRevision','timestamp','_built']);
  const stable={};Object.keys(payload).forEach(key=>{if(!excluded.has(key))stable[key]=_naV10Clone(payload[key]);});return stable;
}

function _naV10CashStableEqual(a,b){try{return JSON.stringify(_naV10StableValue(a))===JSON.stringify(_naV10StableValue(b));}catch(error){return false;}}

function _naV10CashBuildReceipt(ctx,type,monto,gastoId,movId,cashierId,sessionId,timestamp,moveTipo){
  return{
    schemaVersion:1,
    operationId:ctx.operationId,
    type:type,
    idempotencyKey:_naV10IdempotencyKey(ctx.idempotencyPayload),
    expectedRevision:ctx.currentRevision+1,
    entityIds:[gastoId,movId].filter(Boolean).sort(),
    gastoId:gastoId||null,
    movId:movId||null,
    monto:Number(monto),
    cashierId:String(cashierId),
    sessionId:String(sessionId),
    timestamp:String(timestamp||''),
    moveTipo:moveTipo,
    createdAt:_naV10Now()
  };
}

function _naV10BuildExpenseIntent(intent){
  const operationId=intent.operationId||_naNewOperationId();
  let monto=Number(intent.monto);
  if(Number.isFinite(monto))monto=Math.round(monto*100)/100;
  const concepto=String(intent.concepto??'').trim();
  return{operationId,monto,concepto,categoria:intent.categoria||'Otro',metodo:intent.metodo||'efectivo',nota:String(intent.nota??''),fecha:String(intent.fecha??''),cashierId:intent.cashierId??null,sessionId:intent.sessionId??null,timestamp:_naV10Now(),_built:true};
}

function _naV10BuildCashMoveIntent(intent){
  const operationId=intent.operationId||_naNewOperationId();
  let monto=Number(intent.monto);
  if(Number.isFinite(monto))monto=Math.round(monto*100)/100;
  const motivo=String(intent.motivo??'').trim();
  return{operationId,tipo:String(intent.tipo??''),monto,motivo,categoria:String(intent.categoria??''),metodo:intent.metodo||'efectivo',cashierId:intent.cashierId??null,sessionId:intent.sessionId??null,timestamp:_naV10Now(),_built:true};
}

function _naV10RevalidateCashIdentity(canonical,intent){
  const d=canonical?.data;if(!d)return{ok:false,reason:'CANONICAL_MISSING'};
  const caj=d.cajEstado||{};
  if(caj.abierta!==true||caj.cerrada===true)return{ok:false,reason:'CAJA_CERRADA'};
  if(!caj.sessionId)return{ok:false,reason:'CAJA_SIN_SESION'};
  if(String(intent.sessionId)!==String(caj.sessionId))return{ok:false,reason:'SESION_DIFERENTE'};
  if(!caj.cajeroId)return{ok:false,reason:'CAJA_SIN_CAJERO'};
  if(!intent.cashierId||String(intent.cashierId)!==String(caj.cajeroId))return{ok:false,reason:'CAJERO_DIFERENTE'};
  return{ok:true,cajeroId:caj.cajeroId,cajeroNombre:String(caj.cajeroNombre||caj.cajero||''),sessionId:caj.sessionId,fechaApertura:String(caj.fechaApertura||'')};
}

function _naV10RevalidateExpense(canonical,intent){
  const ident=_naV10RevalidateCashIdentity(canonical,intent);if(!ident.ok)return ident;
  if(!Number.isFinite(intent.monto)||intent.monto<=0)return{ok:false,reason:'MONTO_INVALIDO'};
  if(!intent.concepto||typeof intent.concepto!=='string')return{ok:false,reason:'CONCEPTO_INVALIDO'};
  return{ok:true};
}

function _naV10RevalidateCashMove(canonical,intent){
  const ident=_naV10RevalidateCashIdentity(canonical,intent);if(!ident.ok)return ident;
  if(intent.tipo!=='CASH_IN'&&intent.tipo!=='CASH_OUT')return{ok:false,reason:'TIPO_INVALIDO'};
  if(!Number.isFinite(intent.monto)||intent.monto<=0)return{ok:false,reason:'MONTO_INVALIDO'};
  if(!intent.motivo||typeof intent.motivo!=='string')return{ok:false,reason:'MOTIVO_INVALIDO'};
  return{ok:true};
}

function _naV10ApplyExpense(draft,intent,ctx){
  const d=draft.data||(draft.data={});d.gastos=d.gastos||[];d.cajMovs=d.cajMovs||[];
  const caj=d.cajEstado||{};
  const cajeroId=caj.cajeroId,cajeroNombre=String(caj.cajeroNombre||caj.cajero||''),sessionId=caj.sessionId;
  const gastoId=ctx.operationId+'_gasto';
  const movId=ctx.operationId+'_mov';
  const fecha=intent.fecha||caj.fechaApertura||new Date().toISOString().slice(0,10);
  let hora,hora24;
  try{
    const ts=new Date(intent.timestamp);
    hora=ts.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
    hora24=ts.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  }catch(error){
    const ts=new Date(_naV10Now());
    hora=ts.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
    hora24=ts.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  }
  d.gastos.unshift({id:gastoId,operationId:ctx.operationId,desc:intent.concepto,monto:intent.monto,cat:intent.categoria,metodo:intent.metodo,fecha,nota:intent.nota,timestamp:intent.timestamp,cashierId:cajeroId,sessionId:sessionId});
  d.cajMovs.push({id:movId,operationId:ctx.operationId,tipo:'gas',monto:intent.monto,efectivo:intent.metodo==='efectivo'?intent.monto:0,desc:intent.concepto,cat:intent.categoria,metodo:intent.metodo,hora,hora24,timestamp:intent.timestamp,cajero:cajeroNombre,cajeroNombre,cajeroId:cajeroId,fecha,sessionId:sessionId});
  d.cashReceipts=d.cashReceipts||{};
  if(d.cashReceipts[ctx.operationId])throw new Error('CASH_RECEIPT_ALREADY_EXISTS');
  d.cashReceipts[ctx.operationId]=_naV10CashBuildReceipt(ctx,'EXPENSE',intent.monto,gastoId,movId,cajeroId,sessionId,intent.timestamp,'gas');
  return d;
}

function _naV10ApplyCashMove(draft,intent,ctx){
  const d=draft.data||(draft.data={});d.cajMovs=d.cajMovs||[];
  const caj=d.cajEstado||{};
  const cajeroId=caj.cajeroId,cajeroNombre=String(caj.cajeroNombre||caj.cajero||''),sessionId=caj.sessionId;
  const movId=ctx.operationId+'_mov';
  const v9Tipo=intent.tipo==='CASH_IN'?'ing':'egr';
  const fecha=intent.fecha||caj.fechaApertura||new Date().toISOString().slice(0,10);
  let hora,hora24;
  try{
    const ts=new Date(intent.timestamp);
    hora=ts.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
    hora24=ts.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  }catch(error){
    const ts=new Date(_naV10Now());
    hora=ts.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
    hora24=ts.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  }
  d.cajMovs.push({id:movId,operationId:ctx.operationId,movTipo:intent.tipo,tipo:v9Tipo,monto:intent.monto,efectivo:intent.metodo==='efectivo'?intent.monto:0,desc:intent.motivo,cat:intent.categoria,metodo:intent.metodo,hora,hora24,timestamp:intent.timestamp,cajero:cajeroNombre,cajeroNombre,cajeroId:cajeroId,fecha,sessionId:sessionId});
  d.cashReceipts=d.cashReceipts||{};
  if(d.cashReceipts[ctx.operationId])throw new Error('CASH_RECEIPT_ALREADY_EXISTS');
  d.cashReceipts[ctx.operationId]=_naV10CashBuildReceipt(ctx,'CASH_MOVE',intent.monto,null,movId,cajeroId,sessionId,intent.timestamp,intent.tipo);
  return d;
}

async function _naV10VerifyCashHistoricalCommit(operationId,expectedType,idempotencyPayload){
  try{
    const canonical=await _naV10ReadCanonical();
    if(!canonical||!_naV10ValidSnapshot(canonical))return{intercept:true,verified:false,code:'HISTORICAL_COMMIT_UNVERIFIED',message:'CANONICAL_MISSING_OR_INVALID',issues:['CANONICAL_MISSING_OR_INVALID']};
    const data=canonical.data||{};
    const receipt=data.cashReceipts?data.cashReceipts[operationId]:undefined;
    const gastos=(data.gastos||[]).filter(g=>g&&g.operationId===operationId);
    const movs=(data.cajMovs||[]).filter(m=>m&&m.operationId===operationId);
    if(!receipt&&gastos.length===0&&movs.length===0)return{intercept:false};

    const issues=[];
    let journal=null,checkpoint=null;
    try{journal=await _naV10GetOperation(operationId);}catch(error){journal=null;}

    if(!journal){
      issues.push('JOURNAL_MISSING');
    }else{
      const journalValidation=_naV10ValidateJournalRecordStrict(journal,'CASH_HISTORICAL_RETRY');
      if(!journalValidation.valid)issues.push('JOURNAL_INVALID:'+journalValidation.reason);
      if(journal.status!=='COMMITTED')issues.push('JOURNAL_NOT_COMMITTED');
      if(journal.type!==expectedType)issues.push('JOURNAL_TYPE_MISMATCH');
      if(!(Number.isSafeInteger(journal.committedRevision)&&journal.committedRevision>=0))issues.push('JOURNAL_INVALID_COMMITTED_REVISION');
      if(!(typeof journal.commitId==='string'&&journal.commitId))issues.push('JOURNAL_MISSING_COMMIT_ID');
      if(journal.checkpointKey!==''+journal.committedRevision+':'+journal.commitId)issues.push('JOURNAL_INVALID_CHECKPOINT_KEY');
    }

    if(journal&&journal.status==='COMMITTED'&&Number.isSafeInteger(journal.committedRevision)&&canonical.revision<journal.committedRevision)issues.push('CANONICAL_BEHIND_COMMIT');

    if(!receipt){
      issues.push('RECEIPT_MISSING');
    }else if(!_naV10IsPlainObject(receipt)){
      issues.push('RECEIPT_NOT_PLAIN_OBJECT');
    }else if(!_naV10IsJsonSafe(receipt,new Set())){
      issues.push('RECEIPT_NOT_JSON_SAFE');
    }else{
      if(receipt.schemaVersion!==1)issues.push('RECEIPT_SCHEMA_VERSION_MISMATCH');
      if(receipt.operationId!==operationId)issues.push('RECEIPT_OPERATION_MISMATCH');
      if(receipt.type!==expectedType)issues.push('RECEIPT_TYPE_MISMATCH');
      if(journal&&journal.status==='COMMITTED'&&receipt.expectedRevision!==journal.committedRevision)issues.push('RECEIPT_EXPECTED_REVISION_MISMATCH');
      if(!(Number.isFinite(receipt.monto)&&receipt.monto>0))issues.push('RECEIPT_INVALID_MONTO');
      if(!(typeof receipt.cashierId==='string'&&receipt.cashierId))issues.push('RECEIPT_INVALID_CASHIER_ID');
      if(!(typeof receipt.sessionId==='string'&&receipt.sessionId))issues.push('RECEIPT_INVALID_SESSION_ID');
    }

    let requestKey=null,requestHash=null;
    try{requestKey=_naV10IdempotencyKey(idempotencyPayload);}catch(error){issues.push('IDEMPOTENCY_KEY_INVALID');}
    if(requestKey!==null){
      if(receipt&&receipt.idempotencyKey!==requestKey)issues.push('RECEIPT_IDEMPOTENCY_KEY_MISMATCH');
      if(journal&&journal.idempotencyKey!==requestKey)issues.push('JOURNAL_IDEMPOTENCY_KEY_MISMATCH');
      try{requestHash=await _naV10PayloadHash(idempotencyPayload);}catch(error){issues.push('PAYLOAD_HASH_FAILED');}
      if(requestHash!==null){
        if(journal&&journal.idempotencyHash!==requestHash)issues.push('JOURNAL_IDEMPOTENCY_HASH_MISMATCH');
        if(journal&&journal.payloadHash!==requestHash)issues.push('JOURNAL_PAYLOAD_HASH_MISMATCH');
      }
    }

    if(receipt&&journal){
      if(!_naV10CashStableEqual(receipt.entityIds,journal.entityIds))issues.push('ENTITY_IDS_MISMATCH');
      if(!_naV10CashStableEqual(receipt.entityIds,[receipt.gastoId,receipt.movId].filter(Boolean).sort()))issues.push('RECEIPT_ENTITY_IDS_INCONSISTENT');
    }

    if(expectedType==='EXPENSE'){
      if(gastos.length!==1)issues.push('GASTOS_COUNT_MISMATCH');
      if(movs.length!==1)issues.push('MOVS_COUNT_MISMATCH');
      if(receipt&&gastos.length===1){
        if(gastos[0].id!==receipt.gastoId)issues.push('GASTO_ID_MISMATCH');
        if(gastos[0].monto!==receipt.monto)issues.push('GASTO_MONTO_MISMATCH');
        if(String(gastos[0].cashierId)!==receipt.cashierId)issues.push('GASTO_CASHIER_MISMATCH');
        if(String(gastos[0].sessionId)!==receipt.sessionId)issues.push('GASTO_SESSION_MISMATCH');
      }
      if(receipt&&movs.length===1){
        if(movs[0].id!==receipt.movId)issues.push('MOV_ID_MISMATCH');
        if(movs[0].monto!==receipt.monto)issues.push('MOV_MONTO_MISMATCH');
        if(String(movs[0].cashierId)!==receipt.cashierId)issues.push('MOV_CASHIER_MISMATCH');
        if(String(movs[0].sessionId)!==receipt.sessionId)issues.push('MOV_SESSION_MISMATCH');
        if(movs[0].tipo!=='gas')issues.push('MOV_TIPO_MISMATCH');
      }
      if(receipt&&receipt.moveTipo!=='gas')issues.push('RECEIPT_MOVE_TIPO_MISMATCH');
    }else if(expectedType==='CASH_MOVE'){
      if(gastos.length!==0)issues.push('GASTOS_COUNT_MISMATCH');
      if(receipt&&receipt.gastoId!==null)issues.push('RECEIPT_GASTO_ID_NOT_NULL');
      if(movs.length!==1)issues.push('MOVS_COUNT_MISMATCH');
      if(receipt&&movs.length===1){
        if(movs[0].id!==receipt.movId)issues.push('MOV_ID_MISMATCH');
        if(movs[0].monto!==receipt.monto)issues.push('MOV_MONTO_MISMATCH');
        if(String(movs[0].cashierId)!==receipt.cashierId)issues.push('MOV_CASHIER_MISMATCH');
        if(String(movs[0].sessionId)!==receipt.sessionId)issues.push('MOV_SESSION_MISMATCH');
        if(movs[0].movTipo!==receipt.moveTipo)issues.push('MOV_MOV_TIPO_MISMATCH');
        if(movs[0].tipo!==(receipt.moveTipo==='CASH_IN'?'ing':'egr'))issues.push('MOV_TIPO_MISMATCH');
      }
    }

    if(journal&&journal.status==='COMMITTED'&&journal.checkpointKey){
      try{checkpoint=await _naV10GetCheckpoint(journal.checkpointKey);}catch(error){checkpoint=null;}
      if(!checkpoint||!_naV10IsPlainObject(checkpoint)){
        issues.push('CHECKPOINT_MISSING');
      }else{
        if(checkpoint.key!==journal.checkpointKey)issues.push('CHECKPOINT_KEY_MISMATCH');
        if(checkpoint.operationId!==operationId)issues.push('CHECKPOINT_OPERATION_MISMATCH');
        if(checkpoint.revision!==journal.committedRevision)issues.push('CHECKPOINT_REVISION_MISMATCH');
        if(checkpoint.commitId!==journal.commitId)issues.push('CHECKPOINT_COMMIT_MISMATCH');
        const cpSnapshot=checkpoint.snapshot;
        if(!_naV10ValidSnapshot(cpSnapshot)){
          issues.push('CHECKPOINT_INVALID_SNAPSHOT');
        }else{
          if(cpSnapshot.revision!==journal.committedRevision)issues.push('CHECKPOINT_SNAPSHOT_REVISION_MISMATCH');
          if(cpSnapshot.commitId!==journal.commitId)issues.push('CHECKPOINT_SNAPSHOT_COMMIT_MISMATCH');
          if(cpSnapshot.lastOperationId!==operationId)issues.push('CHECKPOINT_SNAPSHOT_OPERATION_MISMATCH');
          const cpData=cpSnapshot.data||{};
          const cpReceipts=cpData.cashReceipts||{};
          if(!cpData.cashReceipts||!_naV10CashStableEqual(cpReceipts[operationId],receipt))issues.push('CHECKPOINT_SNAPSHOT_RECEIPT_MISMATCH');
          const cpGastos=(cpData.gastos||[]).filter(g=>g&&g.operationId===operationId);
          const cpMovs=(cpData.cajMovs||[]).filter(m=>m&&m.operationId===operationId);
          if(expectedType==='EXPENSE'){
            if(cpGastos.length!==1||cpMovs.length!==1)issues.push('CHECKPOINT_SNAPSHOT_ENTITY_COUNT_MISMATCH');
            else{
              if(cpGastos[0].id!==receipt.gastoId)issues.push('CHECKPOINT_SNAPSHOT_GASTO_ID_MISMATCH');
              if(cpMovs[0].id!==receipt.movId)issues.push('CHECKPOINT_SNAPSHOT_MOV_ID_MISMATCH');
            }
          }else{
            if(cpGastos.length!==0||cpMovs.length!==1)issues.push('CHECKPOINT_SNAPSHOT_ENTITY_COUNT_MISMATCH');
            else if(cpMovs[0].id!==receipt.movId)issues.push('CHECKPOINT_SNAPSHOT_MOV_ID_MISMATCH');
          }
        }
      }
    }

    if(issues.length){
      return{
        intercept:true,verified:false,code:'HISTORICAL_COMMIT_UNVERIFIED',message:'La evidencia CASH no demuestra el commit historico',issues,
        evidence:{
          receipt:_naV10Clone(receipt??null),
          journal:journal?_naV10Clone({status:journal.status,type:journal.type,committedRevision:journal.committedRevision,commitId:journal.commitId,checkpointKey:journal.checkpointKey,idempotencyKey:journal.idempotencyKey,entityIds:journal.entityIds}):null,
          checkpoint:checkpoint?_naV10Clone({key:checkpoint.key,revision:checkpoint.revision,commitId:checkpoint.commitId,operationId:checkpoint.operationId}):null,
          canonical:_naV10Clone({revision:canonical.revision,commitId:canonical.commitId})
        }
      };
    }

    return{
      intercept:true,verified:true,revision:journal.committedRevision,commitId:journal.commitId,
      evidence:{
        receipt:_naV10Clone(receipt),
        journal:_naV10Clone({status:journal.status,type:journal.type,committedRevision:journal.committedRevision,commitId:journal.commitId,checkpointKey:journal.checkpointKey,idempotencyKey:journal.idempotencyKey}),
        checkpoint:_naV10Clone({key:checkpoint.key,revision:checkpoint.revision,commitId:checkpoint.commitId,operationId:checkpoint.operationId}),
        canonical:_naV10Clone({revision:canonical.revision,commitId:canonical.commitId})
      }
    };
  }catch(error){
    return{intercept:true,verified:false,code:'HISTORICAL_COMMIT_UNVERIFIED',message:'VERIFY_FAILED: '+String(error&&error.message||error),issues:['VERIFY_FAILED']};
  }
}

async function _naV10ConfirmExpenseIntent(intent){
  if(!intent._built)intent=_naV10BuildExpenseIntent(intent);
  if(!Number.isFinite(intent.monto)||intent.monto<=0||!intent.concepto||typeof intent.concepto!=='string'||!intent.cashierId||!intent.sessionId)return{status:'REJECTED',code:'INVALID_INPUT',operationId:intent.operationId,reason:'La operación requiere monto, concepto, cashierId real y sessionId real'};
  let canonical;
  try{canonical=await _naV10ReadCanonical();}catch(error){return{status:_NA_V10_RESULTS.PERSISTENCE_ERROR,operationId:intent.operationId,error:{code:error.code||error.name||'PERSISTENCE_ERROR',message:error.message||String(error)}};}
  if(!canonical)return{status:_NA_V10_RESULTS.PERSISTENCE_ERROR,operationId:intent.operationId,error:{code:'NO_CANONICAL',message:'No existe snapshot V10 canonico. Ejecuta la migracion o inicializacion primero.'}};
  const idempotencyPayload=_naV10CashIdempotencyPayload(intent);
  let historical;
  try{historical=await _naV10VerifyCashHistoricalCommit(intent.operationId,'EXPENSE',idempotencyPayload);}catch(verifyError){return{status:_NA_V10_RESULTS.PERSISTENCE_ERROR,operationId:intent.operationId,recoverable:true,error:{code:'HISTORICAL_COMMIT_UNVERIFIED',message:'La verificacion historica CASH fallo: '+(verifyError&&verifyError.message||String(verifyError))}};}
  if(historical.intercept){
    if(historical.verified)return{status:_NA_V10_RESULTS.ALREADY_COMMITTED,operationId:intent.operationId,revision:historical.revision,commitId:historical.commitId,cashReceiptVerified:true,evidence:historical.evidence};
    return{status:_NA_V10_RESULTS.PERSISTENCE_ERROR,operationId:intent.operationId,recoverable:true,error:{code:'HISTORICAL_COMMIT_UNVERIFIED',message:historical.message||'La evidencia CASH no demuestra el commit historico'},issues:historical.issues||[],evidence:historical.evidence||null};
  }
  const spec={operationId:intent.operationId,type:'EXPENSE',expectedRevision:canonical.revision,payload:_naV10Clone(intent),idempotencyPayload:idempotencyPayload,entityIds:[intent.operationId+'_gasto',intent.operationId+'_mov'],revalidate:function(c){return _naV10RevalidateExpense(c,intent);},mutate:function(draft,ctx){return _naV10ApplyExpense(draft,intent,ctx);}};
  try{return await _naRunCriticalOperation(spec);}catch(error){return{status:_NA_V10_RESULTS.PERSISTENCE_ERROR,operationId:intent.operationId,error:{code:error.code||error.name||'PERSISTENCE_ERROR',message:error.message||String(error)}};}
}

async function _naV10ConfirmCashMoveIntent(intent){
  if(!intent._built)intent=_naV10BuildCashMoveIntent(intent);
  if(!Number.isFinite(intent.monto)||intent.monto<=0||!intent.motivo||typeof intent.motivo!=='string'||(intent.tipo!=='CASH_IN'&&intent.tipo!=='CASH_OUT')||!intent.cashierId||!intent.sessionId)return{status:'REJECTED',code:'INVALID_INPUT',operationId:intent.operationId,reason:'La operación requiere monto, motivo, tipo, cashierId real y sessionId real'};
  let canonical;
  try{canonical=await _naV10ReadCanonical();}catch(error){return{status:_NA_V10_RESULTS.PERSISTENCE_ERROR,operationId:intent.operationId,error:{code:error.code||error.name||'PERSISTENCE_ERROR',message:error.message||String(error)}};}
  if(!canonical)return{status:_NA_V10_RESULTS.PERSISTENCE_ERROR,operationId:intent.operationId,error:{code:'NO_CANONICAL',message:'No existe snapshot V10 canonico. Ejecuta la migracion o inicializacion primero.'}};
  const idempotencyPayload=_naV10CashIdempotencyPayload(intent);
  let historical;
  try{historical=await _naV10VerifyCashHistoricalCommit(intent.operationId,'CASH_MOVE',idempotencyPayload);}catch(verifyError){return{status:_NA_V10_RESULTS.PERSISTENCE_ERROR,operationId:intent.operationId,recoverable:true,error:{code:'HISTORICAL_COMMIT_UNVERIFIED',message:'La verificacion historica CASH fallo: '+(verifyError&&verifyError.message||String(verifyError))}};}
  if(historical.intercept){
    if(historical.verified)return{status:_NA_V10_RESULTS.ALREADY_COMMITTED,operationId:intent.operationId,revision:historical.revision,commitId:historical.commitId,cashReceiptVerified:true,evidence:historical.evidence};
    return{status:_NA_V10_RESULTS.PERSISTENCE_ERROR,operationId:intent.operationId,recoverable:true,error:{code:'HISTORICAL_COMMIT_UNVERIFIED',message:historical.message||'La evidencia CASH no demuestra el commit historico'},issues:historical.issues||[],evidence:historical.evidence||null};
  }
  const spec={operationId:intent.operationId,type:'CASH_MOVE',expectedRevision:canonical.revision,payload:_naV10Clone(intent),idempotencyPayload:idempotencyPayload,entityIds:[intent.operationId+'_mov'],revalidate:function(c){return _naV10RevalidateCashMove(c,intent);},mutate:function(draft,ctx){return _naV10ApplyCashMove(draft,intent,ctx);}};
  try{return await _naRunCriticalOperation(spec);}catch(error){return{status:_NA_V10_RESULTS.PERSISTENCE_ERROR,operationId:intent.operationId,error:{code:error.code||error.name||'PERSISTENCE_ERROR',message:error.message||String(error)}};}
}
